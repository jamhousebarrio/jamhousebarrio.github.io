#!/usr/bin/env node
// One-shot: merge duplicate MemberLogistics rows that belong to the SAME member.
//
// A member can end up with two rows — one under their legal Name, one under their
// Playa Name — because api/logistics.js `upsert` keyed on the literal MemberName
// string, so a save under a second name appended a new row instead of updating
// the old one. The member-centric logistics page renders one row per member, so
// the extra row is invisible there, but presence headcounts (drinks/meals charts)
// count raw sheet rows and double-count the member (e.g. David Burgess +
// Engineer Dave, Daniela Olivia Sabau + Olivia → 31 present vs 29 approved).
//
// This collapses each member's rows into ONE, kept under the name the logistics
// page edits (Playa Name if present, else legal). Per field: the single non-empty
// value wins; if two rows disagree on a field it's a CONFLICT — resolved from
// CONFLICT_OVERRIDES if listed, else the kept row's value, and always printed so
// nothing is silently dropped.
//
// Inspect (read-only):  node scripts/merge-logistics-dupes.mjs
// Apply (writes sheet):  node scripts/merge-logistics-dupes.mjs --apply
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
if (!SHEET_ID || !SERVICE_ACCOUNT) {
  console.error('Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_KEY in .env');
  process.exit(1);
}

const TAB = 'MemberLogistics';
const MEMBERS_TAB = 'Sheet1';
const apply = process.argv.includes('--apply');

// Field-level conflict resolutions, keyed by the kept row's normalized MemberName.
// Olivia (Daniela) arrives by ride-share, not the 'vehicle' on her playa-name row.
const CONFLICT_OVERRIDES = {
  'olivia': { Transport: 'ride-share' },
};

const norm = (s) => (s || '').toString().trim().toLowerCase();

const auth = new GoogleAuth({
  credentials: JSON.parse(SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });

// ── Members → map every name (legal + playa) to one stable member key ─────────
const mres = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: MEMBERS_TAB });
const mrows = mres.data.values || [];
const mheaders = mrows[0] || [];
const mNameCol = mheaders.indexOf('Name');
const mPlayaCol = mheaders.indexOf('Playa Name');
const nameToKey = new Map();    // normalized name -> memberKey
const keyToMember = new Map();  // memberKey -> { legal, playa }
for (let i = 1; i < mrows.length; i++) {
  const legal = (mrows[i][mNameCol] || '').trim();
  const playa = (mPlayaCol >= 0 ? (mrows[i][mPlayaCol] || '') : '').trim();
  const key = norm(legal) || norm(playa);
  if (!key) continue;
  if (legal) nameToKey.set(norm(legal), key);
  if (playa) nameToKey.set(norm(playa), key);
  if (!keyToMember.has(key)) keyToMember.set(key, { legal, playa });
}

// ── Logistics → group rows by member key ──────────────────────────────────────
const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TAB });
const rows = res.data.values || [];
const headers = rows[0] || [];
const mnCol = headers.indexOf('MemberName');
if (mnCol < 0) { console.error(`No MemberName column in ${TAB}`); process.exit(1); }

const cell = (idx, col) => (rows[idx][col] || '').toString().trim();

const groups = new Map(); // memberKey -> [rowIdx,...] (0-based into `rows`)
for (let i = 1; i < rows.length; i++) {
  const key = nameToKey.get(norm(rows[i][mnCol]));
  if (!key) continue; // row matches no member — leave it alone
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(i);
}

// ── Build a merge plan per duplicated member ──────────────────────────────────
const plans = [];
for (const [key, idxs] of groups) {
  if (idxs.length < 2) continue;
  const member = keyToMember.get(key);
  // Keep the row the logistics page edits: playa-name row, else legal, else first.
  let keep = idxs.find((i) => norm(cell(i, mnCol)) === norm(member.playa));
  if (keep === undefined) keep = idxs.find((i) => norm(cell(i, mnCol)) === norm(member.legal));
  if (keep === undefined) keep = idxs[0];
  const keepName = cell(keep, mnCol);
  const overrides = CONFLICT_OVERRIDES[norm(keepName)] || {};
  const ordered = [keep, ...idxs.filter((i) => i !== keep)]; // kept row first

  const merged = [];
  const conflicts = [];
  headers.forEach((h, c) => {
    if (c === mnCol) { merged[c] = keepName; return; } // identity stays the kept name
    const seen = [];
    for (const i of ordered) { const v = cell(i, c); if (v && !seen.includes(v)) seen.push(v); }
    if (seen.length <= 1) { merged[c] = seen[0] || ''; return; }
    const chosen = overrides[h] !== undefined ? overrides[h] : (cell(keep, c) || seen[0]);
    merged[c] = chosen;
    conflicts.push({ field: h, chosen, values: seen, overridden: overrides[h] !== undefined });
  });

  plans.push({
    keepName,
    keepRowNum: keep + 1,
    dropRowNums: idxs.filter((i) => i !== keep).map((i) => i + 1),
    dropIdxs: idxs.filter((i) => i !== keep),
    allNames: idxs.map((i) => cell(i, mnCol)),
    merged,
    conflicts,
  });
}

if (!plans.length) {
  console.log('No duplicate logistics rows found. Nothing to do.');
  process.exit(0);
}

// ── Report ────────────────────────────────────────────────────────────────────
const dropTotal = plans.reduce((n, p) => n + p.dropRowNums.length, 0);
console.log(`${plans.length} member(s) with duplicate logistics rows; ${dropTotal} row(s) to delete.\n`);
for (const p of plans) {
  console.log(`• ${p.keepName}  (rows: ${p.allNames.join(' + ')})`);
  console.log(`    keep row ${p.keepRowNum}, delete row(s) ${p.dropRowNums.join(', ')}`);
  for (const c of p.conflicts) {
    const tag = c.overridden ? 'OVERRIDE' : 'kept-row wins';
    console.log(`    conflict ${c.field}: [${c.values.join(' | ')}] -> "${c.chosen}" (${tag})`);
  }
}

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write the changes.');
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────────
console.log('\nApplying...');

// 1. Overwrite each kept row with its merged values (full width).
const data = plans.map((p) => ({ range: `${TAB}!A${p.keepRowNum}`, values: [p.merged] }));
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: { valueInputOption: 'RAW', data },
});
console.log(`Merged ${plans.length} kept row(s).`);

// 2. Delete the orphan rows, bottom-up so indices stay valid.
const metaRes = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' });
const sheet = metaRes.data.sheets.find((s) => s.properties.title === TAB);
const dropIdxs = plans.flatMap((p) => p.dropIdxs).sort((a, b) => b - a);
const requests = dropIdxs.map((idx) => ({
  deleteDimension: {
    range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
  },
}));
await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
console.log(`Deleted ${requests.length} orphan row(s).\nDone.`);
