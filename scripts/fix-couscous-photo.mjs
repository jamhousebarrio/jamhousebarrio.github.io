#!/usr/bin/env node
// One-shot: replace the PhotoURL for MealID `couscous` in the Meals tab with a
// verified-working Wikimedia Commons image that clearly shows a couscous dish.
// The old PhotoURL (Restaurant_Bahia tagine) did not clearly read as couscous.
// New URL = the Wikipedia "Couscous" article lead image (Moroccan couscous),
// confirmed HTTP 200 + content-type image/jpeg.
// Run once (2026-06-02). Safe to re-run: overwrites only the couscous row's PhotoURL.
//   node scripts/fix-couscous-photo.mjs
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });

const MEAL_ID = 'couscous';
const NEW_URL =
  'https://commons.wikimedia.org/wiki/Special:FilePath/Moroccan_cuscus%2C_from_Casablanca%2C_September_2018.jpg';

const colToLetter = (i) => {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Meals' });
const rows = res.data.values || [];
if (!rows.length) throw new Error('Meals tab is empty');

const header = rows[0];
const idCol = header.indexOf('MealID');
const photoCol = header.indexOf('PhotoURL');
if (idCol === -1) throw new Error('No MealID column');
if (photoCol === -1) throw new Error('No PhotoURL column');
const photoLetter = colToLetter(photoCol);

const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === MEAL_ID);
if (rowIdx === -1) throw new Error(`MealID "${MEAL_ID}" not found in Meals tab`);

const rowNum = rowIdx + 1; // 1-based sheet row
const range = `Meals!${photoLetter}${rowNum}`;
const old = rows[rowIdx][photoCol];

await sheets.spreadsheets.values.update({
  spreadsheetId,
  range,
  valueInputOption: 'RAW',
  requestBody: { values: [[NEW_URL]] },
});

console.log(`updated ${MEAL_ID} (${range})`);
console.log(`  old: ${old}`);
console.log(`  new: ${NEW_URL}`);
