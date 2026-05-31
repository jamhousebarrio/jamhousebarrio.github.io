#!/usr/bin/env node
// Read-only diagnostic: dump Meals, MealIngredients, and DrinksSnacks tabs so we
// can compare the live platform data against the camp menu PDF.
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = sheetsApi({ version: 'v4', auth });
const SHEET_ID = process.env.SHEET_ID;

async function dump(tab) {
  let rows = [];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tab });
    rows = res.data.values || [];
  } catch (e) { console.log(`\n### ${tab}: (missing or unreadable: ${e.message})`); return; }
  console.log(`\n### ${tab}: ${rows.length ? rows.length - 1 : 0} data rows`);
  if (!rows.length) return;
  console.log('HEADERS:', rows[0].join(' | '));
  rows.slice(1).forEach((r, i) => console.log(`${i + 2}: ${r.join(' | ')}`));
}

await dump('Meals');
await dump('MealIngredients');
await dump('DrinksSnacks');
