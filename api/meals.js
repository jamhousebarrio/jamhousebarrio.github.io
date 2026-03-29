import { getSheets, safeGet, toObjects, getRows, getSheetId, deleteRowById, upsertRow } from './_lib/sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, ...payload } = req.body || {};

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const spreadsheetId = process.env.SHEET_ID;
  const MEAL_HEADERS = ['MealID', 'Name', 'Date', 'MealType', 'Description', 'Instructions'];
  const INGREDIENT_HEADERS = ['IngredientID', 'MealID', 'Name', 'Quantity', 'Unit'];

  try {
    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = getSheets(false);
      const [mealsRows, ingredientsRows, logisticsRows] = await Promise.all([
        safeGet(sheets, spreadsheetId, 'Meals'),
        safeGet(sheets, spreadsheetId, 'MealIngredients'),
        safeGet(sheets, spreadsheetId, 'MemberLogistics'),
      ]);
      return res.status(200).json({
        meals: toObjects(mealsRows),
        ingredients: toObjects(ingredientsRows),
        logistics: toObjects(logisticsRows),
      });
    }

    // ── Write actions require write password ──────────────────────────────
    if (!isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const sheets = getSheets(true);

    switch (action) {
      case 'upsert-meal': {
        const { mealId, name, date, mealType, description, instructions } = payload;
        if (!mealId || !name || !date) return res.status(400).json({ error: 'mealId, name, date required' });
        await upsertRow(sheets, spreadsheetId, 'Meals', 'MealID', mealId, MEAL_HEADERS,
          [mealId, name, date, mealType || '', description || '', instructions || '']);
        break;
      }
      case 'delete-meal': {
        const { mealId } = payload;
        if (!mealId) return res.status(400).json({ error: 'mealId required' });
        await deleteRowById(sheets, spreadsheetId, 'Meals', 'MealID', mealId);
        const ingRows = await getRows(sheets, spreadsheetId, 'MealIngredients');
        if (ingRows.length > 1) {
          const headers = ingRows[0];
          const mealIdCol = headers.indexOf('MealID');
          const sheetId = await getSheetId(sheets, spreadsheetId, 'MealIngredients');
          if (sheetId !== null) {
            const toDelete = [];
            ingRows.forEach((r, i) => {
              if (i > 0 && r[mealIdCol] === mealId) toDelete.push(i);
            });
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
        await upsertRow(sheets, spreadsheetId, 'MealIngredients', 'IngredientID', ingredientId, INGREDIENT_HEADERS,
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
    console.error('Meals API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
