#!/usr/bin/env node
// One-shot: fix the Events tab header row so it matches the 8 columns the API
// actually writes. Existing data values are already in the right positions —
// only the header row is mislabeled (and column H was unlabeled, which made
// EndTime values land under "Description" in API responses).
//
// Run inspect (read-only):  node scripts/fix-events-headers.mjs
// Run apply (writes sheet): node scripts/fix-events-headers.mjs --apply
//
// Requires in .env:
//   SHEET_ID
//   GOOGLE_SERVICE_ACCOUNT_KEY

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

const TAB = 'Events';
const NEW_HEADERS = ['Name', 'Date', 'Time', 'EndTime', 'Description', 'Responsible', 'Status', 'Notes'];

const credentials = JSON.parse(SERVICE_ACCOUNT);
const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });

// Read columns A:H so we can see anything in the previously-unlabeled column H.
const range = `${TAB}!A1:H`;
const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
const rows = res.data.values || [];

if (rows.length === 0) {
  console.error(`No data in ${TAB} tab.`);
  process.exit(1);
}

const currentHeaders = rows[0];
const dataRows = rows.slice(1);

console.log('Current header row:');
console.log('  ', currentHeaders);
console.log('Proposed header row:');
console.log('  ', NEW_HEADERS);
console.log(`\n${dataRows.length} data row(s) found.\n`);

dataRows.forEach((row, i) => {
  console.log(`Row ${i + 2}: ${JSON.stringify(row)}`);
});

const apply = process.argv.includes('--apply');
if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write the new header row.');
  process.exit(0);
}

console.log('\nApplying...');
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `${TAB}!A1:H1`,
  valueInputOption: 'RAW',
  requestBody: { values: [NEW_HEADERS] },
});
console.log('Header row updated.');
