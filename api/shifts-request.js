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

async function getAllAssignmentRows(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShiftAssignments' });
    return res.data.values || [];
  } catch (e) { return []; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, shiftId, slotId, memberName, assignmentId } = req.body || {};

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (!action || !memberName) return res.status(400).json({ error: 'action and memberName required' });

  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID;

  try {
    if (action === 'request') {
      if (!shiftId || !slotId) return res.status(400).json({ error: 'shiftId and slotId required' });

      // Only block duplicate sign-up by the same person — multiple members CAN share a slot
      const rows = await getAllAssignmentRows(sheets, spreadsheetId);
      if (rows.length > 1) {
        const headers = rows[0];
        const shiftIdCol = headers.indexOf('ShiftID');
        const slotIdCol = headers.indexOf('SlotID');
        const statusCol = headers.indexOf('Status');
        const memberCol = headers.indexOf('MemberName');
        const alreadySignedUp = rows.slice(1).some(r =>
          r[shiftIdCol] === shiftId && r[slotIdCol] === slotId &&
          r[memberCol] === memberName && r[statusCol] !== 'bailed'
        );
        if (alreadySignedUp) return res.status(409).json({ error: 'You are already signed up for this slot' });
      }

      const newId = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'ShiftAssignments',
        valueInputOption: 'RAW',
        requestBody: { values: [[newId, slotId, shiftId, memberName, 'requested']] },
      });
      return res.status(200).json({ success: true, assignmentId: newId });
    }

    if (action === 'cancel' || action === 'bail') {
      if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

      const rows = await getAllAssignmentRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });

      const headers = rows[0];
      const idCol = headers.indexOf('AssignmentID');
      const statusCol = headers.indexOf('Status');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === assignmentId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Assignment not found' });

      if (action === 'cancel') {
        const sheetId = await getSheetId(sheets, spreadsheetId, 'ShiftAssignments');
        if (sheetId === null) return res.status(500).json({ error: 'ShiftAssignments tab not found' });
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
          }
        });
      } else {
        const colLetter = String.fromCharCode(65 + statusCol);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `ShiftAssignments!${colLetter}${rowIdx + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [['bailed']] },
        });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('shifts-request error:', e);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
