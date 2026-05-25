#!/usr/bin/env node
// One-shot: reshape the Inventory tab.
//   - Rename column C header  Category -> Labels  (values unchanged; an existing
//     single category is already a valid 1-element comma list).
//   - Fold the Notes column (H) into Description (D): empty Description becomes
//     the Notes text; otherwise Description + "\n" + Notes. No note is lost.
//   - Drop the Notes column.
// Result: 7 columns  ItemID | Name | Labels | Description | PhotoURL | Quantity | Location
//
// Run inspect (read-only):  node scripts/migrate-inventory-labels.mjs
// Run apply (writes sheet):  node scripts/migrate-inventory-labels.mjs --apply
//
// Idempotent: after migration there is no Notes column, so the fold no-ops and
// the rewrite reproduces the same 7-column shape. Safe to re-run.
//
// Requires in .env:  SHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
config({ path: path.join(repoRoot, '.env') });

const SHEET_ID = process.env.SHEET_ID;
const SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!SHEET_ID || !SERVICE_ACCOUNT) {
  console.error('Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_KEY in .env');
  process.exit(1);
}

const TAB = 'Inventory';
const NEW_HEADERS = ['ItemID', 'Name', 'Labels', 'Description', 'PhotoURL', 'Quantity', 'Location'];
// Old layout: ItemID | Name | Category | Description | PhotoURL | Quantity | Location | Notes
const OLD = { ItemID: 0, Name: 1, Category: 2, Description: 3, PhotoURL: 4, Quantity: 5, Location: 6, Notes: 7 };

const credentials = JSON.parse(SERVICE_ACCOUNT);
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = sheetsApi({ version: 'v4', auth });

const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A1:H` });
const rows = res.data.values || [];
if (rows.length === 0) {
  console.error(`No data in ${TAB} tab.`);
  process.exit(1);
}

const dataRows = rows.slice(1);

function foldDescription(row) {
  const description = (row[OLD.Description] || '').trim();
  const notes = (row[OLD.Notes] || '').trim();
  if (!notes) return description;
  if (!description) return notes;
  return `${description}\n${notes}`;
}

const newRows = dataRows.map((row) => [
  row[OLD.ItemID] || '',
  row[OLD.Name] || '',
  row[OLD.Category] || '',   // Category values carry over unchanged as Labels
  foldDescription(row),
  row[OLD.PhotoURL] || '',
  row[OLD.Quantity] || '',
  row[OLD.Location] || '',
]);

console.log('Current header row:\n  ', rows[0]);
console.log('Proposed header row:\n  ', NEW_HEADERS);
console.log(`\n${dataRows.length} data row(s). Description fold preview:\n`);
dataRows.forEach((row, i) => {
  const before = { Description: row[OLD.Description] || '', Notes: row[OLD.Notes] || '' };
  console.log(`Row ${i + 2} (${row[OLD.Name] || ''}):`);
  console.log(`   Labels:      ${newRows[i][2]}`);
  console.log(`   Description: ${JSON.stringify(before)} -> ${JSON.stringify(newRows[i][3])}`);
});

const apply = process.argv.includes('--apply');
if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write the reshaped sheet.');
  process.exit(0);
}

console.log('\nApplying...');
// 1) Clear the full old width (A:H) so the dropped Notes column leaves no residue.
await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${TAB}!A1:H` });
// 2) Write the 7-column header + data.
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `${TAB}!A1`,
  valueInputOption: 'RAW',
  requestBody: { values: [NEW_HEADERS, ...newRows] },
});
console.log(`Done. Wrote ${newRows.length + 1} rows in 7 columns; Notes column dropped.`);
