import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

function getSheets(write) {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: [write
      ? 'https://www.googleapis.com/auth/spreadsheets'
      : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return sheetsApi({ version: 'v4', auth });
}

async function safeGet(sheets, spreadsheetId, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (e) {
    return [];
  }
}

function toObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
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

async function ensureTab(sheets, spreadsheetId, tab) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  } catch (e) { /* tab already exists */ }
}

async function upsertRow(sheets, spreadsheetId, tab, idColName, idValue, rowValues) {
  const rows = await getRows(sheets, spreadsheetId, tab);
  if (!rows.length) {
    await ensureTab(sheets, spreadsheetId, tab);
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: tab + '!A1', valueInputOption: 'RAW',
      requestBody: { values: [['Name', 'Category', 'Unit', 'PerPersonPerDay', 'Notes'], rowValues] }
    });
    return;
  }
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

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const spreadsheetId = process.env.SHEET_ID;

  try {
    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = getSheets(false);
      const [drinksRows, logisticsRows] = await Promise.all([
        safeGet(sheets, spreadsheetId, 'DrinksSnacks'),
        safeGet(sheets, spreadsheetId, 'MemberLogistics'),
      ]);
      return res.status(200).json({
        items: toObjects(drinksRows),
        logistics: toObjects(logisticsRows),
      });
    }

    // ── Write actions require write password ──────────────────────────────
    if (!isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const sheets = getSheets(true);

    switch (action) {
      case 'upsert': {
        const { name, category, unit, perPersonPerDay, notes } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });
        await upsertRow(sheets, spreadsheetId, 'DrinksSnacks', 'Name', name,
          [name, category || '', unit || '', perPersonPerDay != null ? String(perPersonPerDay) : '', notes || '']);
        break;
      }
      case 'delete': {
        const { name } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, 'DrinksSnacks', 'Name', name);
        if (!deleted) return res.status(404).json({ error: 'Item not found' });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Drinks API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
