#!/usr/bin/env node
// One-shot: add an "Id" column to the Events tab and backfill UUIDs for
// every existing row. Required before deploying the code change that keys
// upsert/delete on Id instead of Name (so the same event can be repeated
// with the same name on different dates).
//
// Run inspect (read-only):  node scripts/add-events-ids.mjs
// Run apply (writes sheet): node scripts/add-events-ids.mjs --apply
//
// Idempotent: rows that already have an Id are left alone.
//
// Requires in .env:
//   SHEET_ID
//   GOOGLE_SERVICE_ACCOUNT_KEY

import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
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
// New schema: append Id as the 9th column.
const NEW_HEADERS = ['Name', 'Date', 'Time', 'EndTime', 'Description', 'Responsible', 'Status', 'Notes', 'Id'];

const auth = new GoogleAuth({
  credentials: JSON.parse(SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });

// Read A:I so we can see whether an Id column already exists with values.
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: `${TAB}!A1:I`,
});
const rows = res.data.values || [];
if (rows.length === 0) {
  console.error(`No data in ${TAB} tab.`);
  process.exit(1);
}

const currentHeaders = rows[0];
const dataRows = rows.slice(1);
const idColIdx = currentHeaders.indexOf('Id');

console.log('Current header row:');
console.log('  ', currentHeaders);
console.log(`${dataRows.length} data row(s)\n`);

// Build the new rows: pad to 9 columns, add a UUID in column I if missing.
const updates = [];
dataRows.forEach((row, i) => {
  const rowNum = i + 2;
  const padded = row.slice(0, 8);
  while (padded.length < 8) padded.push('');
  const existingId = idColIdx >= 0 ? (row[idColIdx] || '') : '';
  const id = existingId || randomUUID();
  padded.push(id);
  updates.push({ rowNum, values: padded, generatedId: !existingId });
  console.log(`Row ${rowNum}: ${row[0]} → Id=${id}${existingId ? ' (existing)' : ' (NEW)'}`);
});

const apply = process.argv.includes('--apply');
if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write the changes.');
  process.exit(0);
}

console.log('\nApplying...');

// 1. Update header row.
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `${TAB}!A1:I1`,
  valueInputOption: 'RAW',
  requestBody: { values: [NEW_HEADERS] },
});
console.log('Header row updated.');

// 2. Update each data row (rewrites all 9 columns, idempotent).
for (const u of updates) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A${u.rowNum}:I${u.rowNum}`,
    valueInputOption: 'RAW',
    requestBody: { values: [u.values] },
  });
  console.log(`Row ${u.rowNum} written.`);
}
console.log('\nDone.');
