import { authenticateRequest } from './_lib/auth.js';

const TAB = 'ShiftData';
const BASE_HEADERS = ['ShiftID', 'Name', 'Description', 'Date', 'StartTime', 'EndTime', 'AssignedTo', 'MaxPerSlot'];

function isSelfName(auth, name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  const playa = (auth.member['Playa Name'] || '').trim().toLowerCase();
  const legal = (auth.member.Name || '').trim().toLowerCase();
  return n === playa || n === legal;
}

function parseAssigned(v) {
  return (v || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function getRows(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: TAB });
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

async function ensureColumn(sheets, spreadsheetId, headers, name) {
  if (headers.indexOf(name) !== -1) return headers;
  const colIdx = headers.length;
  const colLetter = String.fromCharCode(65 + colIdx);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB}!${colLetter}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[name]] },
  });
  return headers.concat(name);
}

function buildRow(headers, fields) {
  return headers.map(h => fields[h] !== undefined ? fields[h] : '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};

    const spreadsheetId = auth.spreadsheetId;
    const sheets = auth.sheets;

    if (!action) {
      const rows = await getRows(sheets, spreadsheetId);
      return res.status(200).json({ shifts: parseShifts(rows) });
    }

    if (action === 'create') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const { shiftId, name, description, date, startTime, endTime, maxPerSlot } = payload;
      if (!shiftId || !name || !date) return res.status(400).json({ error: 'shiftId, name, date required' });
      const fields = {
        ShiftID: shiftId,
        Name: name,
        Description: description || '',
        Date: date,
        StartTime: startTime || '',
        EndTime: endTime || '',
        AssignedTo: '',
        MaxPerSlot: maxPerSlot === undefined || maxPerSlot === null || maxPerSlot === '' ? '' : String(maxPerSlot),
      };
      const existing = await getRows(sheets, spreadsheetId);
      if (!existing.length) {
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
          });
        } catch (e) { /* tab exists */ }
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: `${TAB}!A1`, valueInputOption: 'RAW',
          requestBody: { values: [BASE_HEADERS, buildRow(BASE_HEADERS, fields)] },
        });
        return res.status(200).json({ success: true });
      }
      let headers = existing[0];
      headers = await ensureColumn(sheets, spreadsheetId, headers, 'Description');
      headers = await ensureColumn(sheets, spreadsheetId, headers, 'MaxPerSlot');
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: TAB, valueInputOption: 'RAW',
        requestBody: { values: [buildRow(headers, fields)] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'rename-type') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const { oldName, newName, description } = payload;
      if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'No shifts' });
      let headers = rows[0];
      headers = await ensureColumn(sheets, spreadsheetId, headers, 'Description');
      const nameCol = headers.indexOf('Name');
      const descCol = headers.indexOf('Description');
      const rows2 = await getRows(sheets, spreadsheetId);
      const updates = [];
      for (let i = 1; i < rows2.length; i++) {
        if ((rows2[i][nameCol] || '') !== oldName) continue;
        updates.push({
          range: `${TAB}!${String.fromCharCode(65 + nameCol)}${i + 1}`,
          values: [[newName]],
        });
        if (descCol !== -1 && description !== undefined) {
          updates.push({
            range: `${TAB}!${String.fromCharCode(65 + descCol)}${i + 1}`,
            values: [[description || '']],
          });
        }
      }
      if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'RAW', data: updates },
        });
      }
      return res.status(200).json({ success: true, updated: updates.length });
    }

    if (action === 'update-slot-max') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const { name, startTime, endTime, maxPerSlot } = payload;
      if (!name) return res.status(400).json({ error: 'name required' });
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'No shifts' });
      let headers = rows[0];
      headers = await ensureColumn(sheets, spreadsheetId, headers, 'MaxPerSlot');
      const nameCol = headers.indexOf('Name');
      const startCol = headers.indexOf('StartTime');
      const endCol = headers.indexOf('EndTime');
      const maxCol = headers.indexOf('MaxPerSlot');
      const rows2 = await getRows(sheets, spreadsheetId);
      const newVal = maxPerSlot === null || maxPerSlot === undefined || maxPerSlot === '' ? '' : String(maxPerSlot);
      const updates = [];
      for (let i = 1; i < rows2.length; i++) {
        if ((rows2[i][nameCol] || '') !== name) continue;
        if ((rows2[i][startCol] || '') !== (startTime || '')) continue;
        if ((rows2[i][endCol] || '') !== (endTime || '')) continue;
        updates.push({
          range: `${TAB}!${String.fromCharCode(65 + maxCol)}${i + 1}`,
          values: [[newVal]],
        });
      }
      if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'RAW', data: updates },
        });
      }
      return res.status(200).json({ success: true, updated: updates.length });
    }

    if (action === 'delete-slot') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const { name, startTime, endTime } = payload;
      if (!name) return res.status(400).json({ error: 'name required' });
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'No shifts' });
      const headers = rows[0];
      const nameCol = headers.indexOf('Name');
      const startCol = headers.indexOf('StartTime');
      const endCol = headers.indexOf('EndTime');
      const metaRes = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
      const sheet = metaRes.data.sheets.find(s => s.properties.title === TAB);
      if (!sheet) return res.status(500).json({ error: `${TAB} tab not found` });
      const rowsToDelete = [];
      for (let i = 1; i < rows.length; i++) {
        if ((rows[i][nameCol] || '') !== name) continue;
        if ((rows[i][startCol] || '') !== (startTime || '')) continue;
        if ((rows[i][endCol] || '') !== (endTime || '')) continue;
        rowsToDelete.push(i);
      }
      // Delete from bottom up so indices stay valid
      rowsToDelete.sort((a, b) => b - a);
      const requests = rowsToDelete.map(idx => ({
        deleteDimension: {
          range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
        },
      }));
      if (requests.length) {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      }
      return res.status(200).json({ success: true, deleted: requests.length });
    }

    // Add a single assignee to a shift. Server owns the roster — the client
    // passes only the name being added, never the full list. Non-admins can
    // only add themselves; admins can add anyone and pass override:true to
    // exceed the cap.
    if (action === 'add-assignee') {
      const { shiftId, memberName, override } = payload;
      if (!shiftId || !memberName) return res.status(400).json({ error: 'shiftId and memberName required' });
      const clean = memberName.trim();
      if (!clean) return res.status(400).json({ error: 'memberName required' });
      if (!auth.admin && !isSelfName(auth, clean)) {
        return res.status(403).json({ error: 'Only an admin can sign up another member' });
      }
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Shifts tab not found or empty' });
      const headers = rows[0];
      const idCol = headers.indexOf('ShiftID');
      const assignedCol = headers.indexOf('AssignedTo');
      const maxCol = headers.indexOf('MaxPerSlot');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === shiftId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Shift not found' });

      const existing = parseAssigned(rows[rowIdx][assignedCol]);
      if (existing.some(n => n.toLowerCase() === clean.toLowerCase())) {
        return res.status(200).json({ success: true, alreadyAssigned: true });
      }
      if (maxCol !== -1) {
        const maxNum = parseInt(rows[rowIdx][maxCol] || '', 10);
        if (!isNaN(maxNum) && maxNum > 0 && existing.length + 1 > maxNum) {
          if (!auth.admin) return res.status(409).json({ error: 'This shift is full' });
          if (!override) return res.status(409).json({ error: 'This shift is full — admins must pass override:true' });
        }
      }
      const newList = existing.concat(clean).join(', ');
      const colLetter = String.fromCharCode(65 + assignedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${TAB}!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [[newList]] },
      });
      return res.status(200).json({ success: true });
    }

    // Remove a single assignee from a shift. Non-admins can only remove
    // themselves; admins can remove anyone.
    if (action === 'remove-assignee') {
      const { shiftId, memberName } = payload;
      if (!shiftId || !memberName) return res.status(400).json({ error: 'shiftId and memberName required' });
      const clean = memberName.trim();
      if (!auth.admin && !isSelfName(auth, clean)) {
        return res.status(403).json({ error: 'Only an admin can remove another member' });
      }
      const rows = await getRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Shifts tab not found or empty' });
      const headers = rows[0];
      const idCol = headers.indexOf('ShiftID');
      const assignedCol = headers.indexOf('AssignedTo');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === shiftId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Shift not found' });

      const existing = parseAssigned(rows[rowIdx][assignedCol]);
      const newList = existing.filter(n => n.toLowerCase() !== clean.toLowerCase()).join(', ');
      const colLetter = String.fromCharCode(65 + assignedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${TAB}!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [[newList]] },
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
      const sheet = metaRes.data.sheets.find(s => s.properties.title === TAB);
      if (!sheet) return res.status(500).json({ error: `${TAB} tab not found` });
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
