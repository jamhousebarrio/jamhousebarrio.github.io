#!/usr/bin/env node
// One-shot: assign event-night dates to the 7 dinner meals (Mon 6 → Sun 12 Jul).
// Pizza on Sat 11, Burger on Wed 8; the rest arranged across the week.
//
// Inspect (read-only):  node scripts/schedule-dinners.mjs
// Apply (writes sheet):  node scripts/schedule-dinners.mjs --apply
//
// Requires in .env: SHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });

const SHEET_ID = process.env.SHEET_ID;
const TAB = 'Meals';
const apply = process.argv.includes('--apply');

// mealId -> ISO date (yyyy-mm-dd)
const SCHEDULE = {
  'smoky-shakshuka': '2026-07-06',       // Mon
  'dal-mango': '2026-07-07',             // Tue
  'chef-gautier-s-burger': '2026-07-08', // Wed
  'pita-night': '2026-07-09',            // Thu
  'couscous': '2026-07-10',              // Fri
  'pizza-night': '2026-07-11',           // Sat
  'big-pot-pasta': '2026-07-12',         // Sun
};

function colToLetter(c) { let s = ''; while (c >= 0) { s = String.fromCharCode(65 + (c % 26)) + s; c = Math.floor(c / 26) - 1; } return s; }

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });

const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TAB });
const rows = res.data.values || [];
const headers = rows[0] || [];
const idCol = headers.indexOf('MealID');
const dateCol = headers.indexOf('Date');
const nameCol = headers.indexOf('Name');
if (idCol === -1 || dateCol === -1) { console.error('Missing MealID/Date column'); process.exit(1); }

console.log(`=== ${apply ? 'APPLY' : 'DRY-RUN'}: schedule-dinners.mjs ===\n`);
const updates = [];
Object.keys(SCHEDULE).forEach(function (mealId) {
  const i = rows.findIndex((r, idx) => idx > 0 && r[idCol] === mealId);
  if (i === -1) { console.log(`  ! ${mealId} — not found in sheet, skipping`); return; }
  const name = rows[i][nameCol] || mealId;
  console.log(`  ${name} (${mealId}) -> ${SCHEDULE[mealId]}`);
  updates.push({ range: `${TAB}!${colToLetter(dateCol)}${i + 1}`, values: [[SCHEDULE[mealId]]] });
});

if (!apply) { console.log('\nDry run only. Re-run with --apply to write.'); process.exit(0); }

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: { valueInputOption: 'RAW', data: updates },
});
console.log(`\n✓ Dated ${updates.length} dinners. Done.`);
