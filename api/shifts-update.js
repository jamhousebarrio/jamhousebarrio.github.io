import { google } from 'googleapis';

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getSheetId(sheets, spreadsheetId, name) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const sheet = meta.data.sheets.find(s => s.properties.title === name);
  return sheet ? sheet.properties.sheetId : null;
}

async function getRows(sheets, spreadsheetId, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tab });
    return res.data.values || [];
  } catch (e) { return []; }
}

async function deleteRowById(sheets, spreadsheetId, tab, idColName, idValue) {
  const rows = await getRows(sheets, spreadsheetId, tab);
  if (!rows.length) return false;
  const headers = rows[0];
  const idCol = headers.indexOf(idColName);
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === idValue);
  if (rowIdx === -1) return false;
  const sheetId = await getSheetId(sheets, spreadsheetId, tab);
  if (sheetId === null) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
    }
  });
  return true;
}

async function upsertRow(sheets, spreadsheetId, tab, idColName, idValue, rowValues) {
  const rows = await getRows(sheets, spreadsheetId, tab);
  if (!rows.length) return;
  const headers = rows[0];
  const idCol = headers.indexOf(idColName);
  const existingIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === idValue);
  if (existingIdx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: tab, valueInputOption: 'RAW',
      requestBody: { values: [rowValues] }
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${tab}!A${existingIdx + 1}`, valueInputOption: 'RAW',
      requestBody: { values: [rowValues] }
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, ...payload } = req.body || {};

  if (!password || password !== process.env.ADMIN_WRITE_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!action) return res.status(400).json({ error: 'action required' });

  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID;

  try {
    switch (action) {
      case 'confirm-assignment': {
        const { assignmentId } = payload;
        if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
        const rows = await getRows(sheets, spreadsheetId, 'ShiftAssignments');
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        const headers = rows[0];
        const idCol = headers.indexOf('AssignmentID');
        const statusCol = headers.indexOf('Status');
        const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === assignmentId);
        if (rowIdx === -1) return res.status(404).json({ error: 'Assignment not found' });
        const colLetter = String.fromCharCode(65 + statusCol);
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: `ShiftAssignments!${colLetter}${rowIdx + 1}`,
          valueInputOption: 'RAW', requestBody: { values: [['confirmed']] }
        });
        break;
      }
      case 'remove-assignment': {
        const { assignmentId } = payload;
        if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, 'ShiftAssignments', 'AssignmentID', assignmentId);
        if (!deleted) return res.status(404).json({ error: 'Assignment not found' });
        break;
      }
      case 'upsert-shift': {
        const { shiftId, name, description, timeExpectation, kbText, kbLinks } = payload;
        if (!shiftId || !name) return res.status(400).json({ error: 'shiftId and name required' });
        await upsertRow(sheets, spreadsheetId, 'ShiftDefs', 'ShiftID', shiftId,
          [shiftId, name, description || '', timeExpectation || '', kbText || '', kbLinks || '']);
        break;
      }
      case 'delete-shift': {
        const { shiftId } = payload;
        if (!shiftId) return res.status(400).json({ error: 'shiftId required' });
        await deleteRowById(sheets, spreadsheetId, 'ShiftDefs', 'ShiftID', shiftId);
        break;
      }
      case 'upsert-slot': {
        const { slotId, label, date, startTime, endTime } = payload;
        if (!slotId || !label || !date) return res.status(400).json({ error: 'slotId, label, date required' });
        await upsertRow(sheets, spreadsheetId, 'ShiftConfig', 'SlotID', slotId,
          [slotId, label, date, startTime || '', endTime || '']);
        break;
      }
      case 'delete-slot': {
        const { slotId } = payload;
        if (!slotId) return res.status(400).json({ error: 'slotId required' });
        await deleteRowById(sheets, spreadsheetId, 'ShiftConfig', 'SlotID', slotId);
        break;
      }
      case 'update-member-meta': {
        const { memberName, otherResponsibilities } = payload;
        if (!memberName) return res.status(400).json({ error: 'memberName required' });
        await upsertRow(sheets, spreadsheetId, 'MemberMeta', 'MemberName', memberName,
          [memberName, otherResponsibilities || '']);
        break;
      }
      case 'admin-add-assignment': {
        const { assignmentId, slotId, shiftId, memberName } = payload;
        if (!assignmentId || !slotId || !shiftId || !memberName) {
          return res.status(400).json({ error: 'assignmentId, slotId, shiftId, memberName required' });
        }
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'ShiftAssignments',
          valueInputOption: 'RAW',
          requestBody: { values: [[assignmentId, slotId, shiftId, memberName, 'confirmed']] },
        });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('shifts-update error:', e);
    return res.status(500).json({ error: 'Failed to update' });
  }
}
