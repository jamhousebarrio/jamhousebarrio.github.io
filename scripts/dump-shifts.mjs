#!/usr/bin/env node
// Read-only diagnostic: dump ShiftData rows and flag duplicate ShiftIDs.
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
const auth = new GoogleAuth({
  credentials: JSON.parse(SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = sheetsApi({ version: 'v4', auth });

const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'ShiftData' });
const rows = res.data.values || [];
const headers = rows[0] || [];
console.log('HEADERS:', headers);
const idCol = headers.indexOf('ShiftID');
const nameCol = headers.indexOf('Name');

const idCount = {};
rows.slice(1).forEach((r, i) => {
  const id = r[idCol] || '';
  idCount[id] = (idCount[id] || 0) + 1;
});

console.log(`\n${rows.length - 1} data rows\n`);
rows.slice(1).forEach((r, i) => {
  const id = r[idCol] || '';
  const dup = idCount[id] > 1 ? '  <<< DUPLICATE ShiftID' : '';
  console.log(`row ${i + 2}: [${id}] name="${r[nameCol]}" date=${r[headers.indexOf('Date')]} ${r[headers.indexOf('StartTime')]}-${r[headers.indexOf('EndTime')]} assigned="${r[headers.indexOf('AssignedTo')]}" max=${r[headers.indexOf('MaxPerSlot')]}${dup}`);
});

const dups = Object.entries(idCount).filter(([, n]) => n > 1);
console.log('\nDUPLICATE ShiftIDs:', dups.length ? dups : 'none');
