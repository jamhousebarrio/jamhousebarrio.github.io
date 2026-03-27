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
      case 'upsert-meal': {
        const { mealId, name, date, mealType, description, instructions } = payload;
        if (!mealId || !name || !date) return res.status(400).json({ error: 'mealId, name, date required' });
        await upsertRow(sheets, spreadsheetId, 'Meals', 'MealID', mealId,
          [mealId, name, date, mealType || '', description || '', instructions || '']);
        break;
      }
      case 'delete-meal': {
        const { mealId } = payload;
        if (!mealId) return res.status(400).json({ error: 'mealId required' });
        // Delete the meal row first
        await deleteRowById(sheets, spreadsheetId, 'Meals', 'MealID', mealId);
        // Delete all ingredient rows for this meal (fetch fresh, delete in reverse order)
        const ingRows = await getRows(sheets, spreadsheetId, 'MealIngredients');
        if (ingRows.length > 1) {
          const headers = ingRows[0];
          const mealIdCol = headers.indexOf('MealID');
          const sheetId = await getSheetId(sheets, spreadsheetId, 'MealIngredients');
          if (sheetId !== null) {
            // Collect row indices (1-based in sheet, so rowIdx is already 1-indexed from findIndex)
            const toDelete = [];
            ingRows.forEach((r, i) => {
              if (i > 0 && r[mealIdCol] === mealId) toDelete.push(i);
            });
            // Delete in reverse order to preserve indices
            for (let k = toDelete.length - 1; k >= 0; k--) {
              const rowIdx = toDelete[k];
              await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                  requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
                }
              });
            }
          }
        }
        break;
      }
      case 'upsert-ingredient': {
        const { ingredientId, mealId, name, quantity, unit } = payload;
        if (!ingredientId || !mealId || !name) return res.status(400).json({ error: 'ingredientId, mealId, name required' });
        await upsertRow(sheets, spreadsheetId, 'MealIngredients', 'IngredientID', ingredientId,
          [ingredientId, mealId, name, quantity != null ? String(quantity) : '', unit || '']);
        break;
      }
      case 'delete-ingredient': {
        const { ingredientId } = payload;
        if (!ingredientId) return res.status(400).json({ error: 'ingredientId required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, 'MealIngredients', 'IngredientID', ingredientId);
        if (!deleted) return res.status(404).json({ error: 'Ingredient not found' });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('meals-update error:', e);
    return res.status(500).json({ error: 'Failed to update' });
  }
}
