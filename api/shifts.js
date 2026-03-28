import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

function getSheets(write = false) {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: [write
      ? 'https://www.googleapis.com/auth/spreadsheets'
      : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return sheetsApi({ version: 'v4', auth });
}

async function getRows(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Shifts' });
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
  const { password, action, ...payload } = req.body || {};

  const isRead = password === process.env.ADMIN_PASSWORD || password === process.env.ADMIN_WRITE_PASSWORD;
  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;

  if (!isRead) return res.status(401).json({ error: 'Unauthorized' });

  const spreadsheetId = process.env.SHEET_ID;

  // No action = fetch all shifts
  if (!action) {
    const sheets = getSheets(false);
    const rows = await getRows(sheets, spreadsheetId);
    return res.status(200).json({ shifts: parseShifts(rows) });
  }

  const sheets = getSheets(true);

  try {
    if (action === 'create') {
      if (!isAdmin) return res.status(401).json({ error: 'Admin required' });
      const { shiftId, name, date, startTime, endTime } = payload;
      if (!shiftId || !name || !date) return res.status(400).json({ error: 'shiftId, name, date required' });
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: 'Shifts', valueInputOption: 'RAW',
        requestBody: { values: [[shiftId, name, date, startTime || '', endTime || '', '']] },
      });
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
        spreadsheetId, range: `Shifts!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [[memberName]] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'unassign') {
      if (!isAdmin) return res.status(401).json({ error: 'Admin required' });
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
        spreadsheetId, range: `Shifts!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [['']] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      if (!isAdmin) return res.status(401).json({ error: 'Admin required' });
      const { shiftId } = payload;
      if (!shiftId) return res.status(400).json({ error: 'shiftId required' });
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Shifts tab not found or empty' });
      const headers = rows[0];
      const idCol = headers.indexOf('ShiftID');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === shiftId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Shift not found' });
      const metaRes = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
      const sheet = metaRes.data.sheets.find(s => s.properties.title === 'Shifts');
      if (!sheet) return res.status(500).json({ error: 'Shifts tab not found' });
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
    console.error('shifts error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
