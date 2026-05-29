#!/usr/bin/env node
// One-shot: normalize names stored in ShiftData.AssignedTo to each member's
// playa name (the display the shift picker uses: Playa Name, falling back to
// legal Name). Past signups stored a mix of playa and legal names for the same
// person; this rewrites legal-name entries to the playa display and dedupes any
// row that ends up with the same person twice (e.g. "Gautier Lavallart, Goutière").
//
// A stored name is replaced only when it matches a member's Playa Name or legal
// Name. Unrecognized names are left untouched.
//
// Inspect (read-only):  node scripts/normalize-shift-names.mjs
// Apply (writes sheet):  node scripts/normalize-shift-names.mjs --apply
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

// Build playa(lowercased) -> legal Name lookup from the Members tab.
const memRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Sheet1' });
const memRows = memRes.data.values || [];
const memHeaders = memRows[0];
const mNameCol = memHeaders.indexOf('Name');
const mPlayaCol = memHeaders.indexOf('Playa Name');
// Map both a member's playa name and legal name (lowercased) to their canonical
// display = Playa Name || legal Name. Compare on NFC to dodge accent-encoding
// mismatches between the Members and ShiftData tabs.
const norm = (s) => (s || '').normalize('NFC').trim().toLowerCase();
const toCanonical = new Map();
for (const r of memRows.slice(1)) {
  const legal = (r[mNameCol] || '').trim();
  const playa = (r[mPlayaCol] || '').trim();
  const canonical = playa || legal;
  if (!canonical) continue;
  if (playa) toCanonical.set(norm(playa), canonical);
  if (legal) toCanonical.set(norm(legal), canonical);
}

const shiftRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TAB });
const rows = shiftRes.data.values || [];
const headers = rows[0];
const assignedCol = headers.indexOf('AssignedTo');
const idCol = headers.indexOf('ShiftID');
const assignedLetter = String.fromCharCode(65 + assignedCol);

const parseAssigned = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

const updates = [];
for (let i = 1; i < rows.length; i++) {
  const original = rows[i][assignedCol] || '';
  const names = parseAssigned(original);
  if (!names.length) continue;
  const seen = new Set();
  const out = [];
  for (const nm of names) {
    const mapped = toCanonical.get(norm(nm)) || nm;
    const k = norm(mapped);
    if (seen.has(k)) continue; // dedupe after mapping
    seen.add(k);
    out.push(mapped);
  }
  const next = out.join(', ');
  if (next !== original) {
    updates.push({ rowNum: i + 1, id: rows[i][idCol], from: original, to: next });
  }
}

if (!updates.length) {
  console.log('All AssignedTo values already use playa names. Nothing to do.');
  process.exit(0);
}

console.log(`${updates.length} row(s) to rewrite:\n`);
updates.forEach(u => console.log(`row ${u.rowNum} [${u.id}]\n  "${u.from}"  ->  "${u.to}"`));

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write the changes.');
  process.exit(0);
}

console.log('\nApplying...');
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: {
    valueInputOption: 'RAW',
    data: updates.map(u => ({ range: `${TAB}!${assignedLetter}${u.rowNum}`, values: [[u.to]] })),
  },
});
console.log(`Rewrote ${updates.length} row(s).\nDone.`);
