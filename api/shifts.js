import { getSheets } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

async function getRows(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShiftData' });
    return res.data.values || [];
  } catch (e) { return []; }
}

function parseShifts(rows) {
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  }).filter(r => r.ShiftID);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};

    const spreadsheetId = auth.spreadsheetId;
    const sheets = auth.sheets;

    // No action = fetch all shifts
    if (!action) {
      const rows = await getRows(sheets, spreadsheetId);
      return res.status(200).json({ shifts: parseShifts(rows) });
    }

    if (action === 'create') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const { shiftId, name, date, startTime, endTime } = payload;
      if (!shiftId || !name || !date) return res.status(400).json({ error: 'shiftId, name, date required' });
      const existing = await getRows(sheets, spreadsheetId);
      if (!existing.length) {
        // Tab may not exist — create it first
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title: 'ShiftData' } } }] },
          });
        } catch (e) {
          // Tab already exists, ignore
        }
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: 'ShiftData!A1', valueInputOption: 'RAW',
          requestBody: { values: [
            ['ShiftID', 'Name', 'Date', 'StartTime', 'EndTime', 'AssignedTo'],
            [shiftId, name, date, startTime || '', endTime || '', ''],
          ] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId, range: 'ShiftData', valueInputOption: 'RAW',
          requestBody: { values: [[shiftId, name, date, startTime || '', endTime || '', '']] },
        });
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'assign') {
      const { shiftId, memberName } = payload;
      if (!shiftId || !memberName) return res.status(400).json({ error: 'shiftId and memberName required' });
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Shifts tab not found or empty' });
      const headers = rows[0];
      const idCol = headers.indexOf('ShiftID');
      const assignedCol = headers.indexOf('AssignedTo');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === shiftId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Shift not found' });
      const colLetter = String.fromCharCode(65 + assignedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `ShiftData!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [[memberName]] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'unassign') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const { shiftId } = payload;
      if (!shiftId) return res.status(400).json({ error: 'shiftId required' });
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Shifts tab not found or empty' });
      const headers = rows[0];
      const idCol = headers.indexOf('ShiftID');
      const assignedCol = headers.indexOf('AssignedTo');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === shiftId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Shift not found' });
      const colLetter = String.fromCharCode(65 + assignedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `ShiftData!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [['']] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const { shiftId } = payload;
      if (!shiftId) return res.status(400).json({ error: 'shiftId required' });
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Shifts tab not found or empty' });
      const headers = rows[0];
      const idCol = headers.indexOf('ShiftID');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === shiftId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Shift not found' });
      const metaRes = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
      const sheet = metaRes.data.sheets.find(s => s.properties.title === 'ShiftData');
      if (!sheet) return res.status(500).json({ error: 'ShiftData tab not found' });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteDimension: { range: {
          sheetId: sheet.properties.sheetId, dimension: 'ROWS',
          startIndex: rowIdx, endIndex: rowIdx + 1,
        }}}]},
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('shifts error:', e.message, e.stack);
    return res.status(500).json({ error: 'Failed', detail: e.message });
  }
}
