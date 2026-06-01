#!/usr/bin/env node
// One-shot: seed the DrinksSnacks tab from the camp PDF's Drinks & Snacks
// sections. The drinks page models each item as a per-person-per-day rate and
// scales by headcount, so the PDF totals are converted to rates at a baseline
// of 30 people x 6 days = 180 person-days (the original total is kept in Notes).
//
// Inspect (read-only):  node scripts/seed-drinks.mjs
// Apply (writes sheet):  node scripts/seed-drinks.mjs --apply
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
const TAB = 'DrinksSnacks';
const HEADERS = ['Name', 'Category', 'Unit', 'PerPersonPerDay', 'Notes'];
const PERSON_DAYS = 180; // 30 people x 6 days
const apply = process.argv.includes('--apply');

const rate = (total) => Math.round((total / PERSON_DAYS) * 1000) / 1000; // 3dp

// [name, category, unit, totalForEvent, notes]
const ITEMS = [
  ['Beer', 'Drinks', 'cans', 500, '≈500 cans for the event (kind TBD)'],
  ['Sangria', 'Drinks', 'L', 100, '≈100 L for the event'],
  ['Aquarius', 'Drinks', 'L', 100, '≈100 L for the event'],
  ['Soft drinks', 'Drinks', 'L', 50, '≈50 L: cola, schweppes, ice tea, orange juice, ABC juice, ginger beer, kiwi juice'],
  ['Chips', 'Snacks', 'kg', 15, '≈15 kg for the event'],
  ['Candy', 'Snacks', 'kg', 5, '≈5 kg for the event'],
  ['Small cakes / pastries', 'Snacks', 'kg', 5, '≈5 kg for the event'],
  ['Hummus', 'Snacks', 'kg', 5, '≈5 kg for the event'],
  ['Baba ganoush', 'Snacks', 'kg', 5, '≈5 kg for the event'],
  ['Pretzels', 'Snacks', 'kg', 3, '≈3 kg for the event'],
  ['Olives', 'Snacks', 'kg', 3, '≈3 kg for the event'],
];

const rows = ITEMS.map(([name, category, unit, total, notes]) =>
  [name, category, unit, String(rate(total)), notes]);

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });

console.log(`=== ${apply ? 'APPLY' : 'DRY-RUN'}: seed-drinks.mjs (rate = total / ${PERSON_DAYS} person-days) ===\n`);
console.log(HEADERS.join(' | '));
rows.forEach((r, i) => console.log(`${i + 2}: ${r.join(' | ')}  (total ${ITEMS[i][3]} ${ITEMS[i][2]})`));
console.log(`\nWould clear + rewrite "${TAB}": 1 header + ${rows.length} rows.`);

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write the sheet.');
  process.exit(0);
}

console.log('\nApplying…');
await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: TAB });
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `${TAB}!A1`,
  valueInputOption: 'RAW',
  requestBody: { values: [HEADERS, ...rows] },
});
console.log(`✓ ${TAB} written (${rows.length} rows + header).\nDone.`);
