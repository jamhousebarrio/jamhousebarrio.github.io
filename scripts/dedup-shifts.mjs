#!/usr/bin/env node
// One-shot: collapse duplicate ShiftID rows in the ShiftData tab down to a
// single row each, merging AssignedTo (union, first-seen casing wins) so no
// signup is lost. Caused by api/shifts.js `create` appending without checking
// for an existing ShiftID; the API wrote to the first duplicate while the grid
// rendered the last, making signups appear to vanish.
//
// Inspect (read-only):  node scripts/dedup-shifts.mjs
// Apply (writes sheet):  node scripts/dedup-shifts.mjs --apply
//
// Requires in .env: SHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY

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
const TAB = 'ShiftData';
const apply = process.argv.includes('--apply');

const auth = new GoogleAuth({
  credentials: JSON.parse(SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });

const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TAB });
const rows = res.data.values || [];
const headers = rows[0];
const idCol = headers.indexOf('ShiftID');
const assignedCol = headers.indexOf('AssignedTo');

const parseAssigned = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

// Group data-row indices (0-based into `rows`) by ShiftID, in sheet order.
const groups = new Map();
for (let i = 1; i < rows.length; i++) {
  const id = rows[i][idCol] || '';
  if (!id) continue;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(i);
}

const rowsToDelete = []; // 0-based indices into `rows`
const merges = [];       // { keepIdx, rowNum, mergedAssigned }

for (const [id, idxs] of groups) {
  if (idxs.length < 2) continue;
  const keep = idxs[0];
  // Union of assignees across the group, case-insensitive, first casing wins.
  const seen = new Set();
  const merged = [];
  for (const idx of idxs) {
    for (const name of parseAssigned(rows[idx][assignedCol])) {
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(name);
    }
  }
  merges.push({ id, keepIdx: keep, rowNum: keep + 1, mergedAssigned: merged.join(', '), dropping: idxs.slice(1).map(i => i + 1) });
  idxs.slice(1).forEach(i => rowsToDelete.push(i));
}

if (!merges.length) {
  console.log('No duplicate ShiftIDs found. Nothing to do.');
  process.exit(0);
}

console.log(`${merges.length} ShiftID(s) with duplicates; ${rowsToDelete.length} row(s) to delete.\n`);
merges.forEach(m => {
  console.log(`[${m.id}]`);
  console.log(`  keep row ${m.rowNum}, set AssignedTo = "${m.mergedAssigned}"`);
  console.log(`  delete rows ${m.dropping.join(', ')}`);
});

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write the changes.');
  process.exit(0);
}

console.log('\nApplying...');

// 1. Update AssignedTo on the kept rows (merged union).
const assignedLetter = String.fromCharCode(65 + assignedCol);
const data = merges.map(m => ({
  range: `${TAB}!${assignedLetter}${m.rowNum}`,
  values: [[m.mergedAssigned]],
}));
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: { valueInputOption: 'RAW', data },
});
console.log(`Merged AssignedTo on ${merges.length} kept row(s).`);

// 2. Delete duplicate rows, bottom-up so indices stay valid.
const metaRes = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' });
const sheet = metaRes.data.sheets.find(s => s.properties.title === TAB);
const requests = rowsToDelete
  .sort((a, b) => b - a)
  .map(idx => ({
    deleteDimension: {
      range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
    },
  }));
await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
console.log(`Deleted ${requests.length} duplicate row(s).\nDone.`);
