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
  if (!rows.length) {
    // Tab might not exist yet or is empty — append with headers first
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: tab, valueInputOption: 'RAW',
      requestBody: { values: [['ItemID', 'Name', 'Category', 'Description', 'PhotoURL', 'Quantity', 'Location', 'Notes'], rowValues] }
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
  if (!action) return res.status(400).json({ error: 'action required' });

  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID;

  try {
    switch (action) {
      case 'upsert': {
        const { itemId, name, category, description, photoUrl, quantity, location, notes } = payload;
        if (!itemId || !name) return res.status(400).json({ error: 'itemId and name required' });
        await upsertRow(sheets, spreadsheetId, 'Inventory', 'ItemID', itemId,
          [itemId, name, category || '', description || '', photoUrl || '', quantity || '', location || '', notes || '']);
        break;
      }
      case 'delete': {
        const { itemId } = payload;
        if (!itemId) return res.status(400).json({ error: 'itemId required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, 'Inventory', 'ItemID', itemId);
        if (!deleted) return res.status(404).json({ error: 'Item not found' });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('inventory-update error:', e);
    return res.status(500).json({ error: 'Failed to update inventory' });
  }
}
