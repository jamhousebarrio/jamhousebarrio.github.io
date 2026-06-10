// One-shot: remove a test account fully — Members sheet rows (all rows
// matching the email) + Supabase auth user (hard delete).
//
// Usage: node --env-file=.env --env-file=.env.supabase scripts/delete-test-account.mjs <email> [<email> ...]

import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

const emails = process.argv.slice(2);
if (!emails.length) {
  console.error('usage: node --env-file=.env --env-file=.env.supabase scripts/delete-test-account.mjs <email> [<email> ...]');
  process.exit(1);
}

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = sheetsApi({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Pull all sheet rows once, then delete in reverse-index order so later
// deletions don't shift earlier rows.
const all = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
const rows = all.data.values || [];
const headers = rows[0] || [];
const emailCol = headers.indexOf('Email');
if (emailCol === -1) { console.error('Email column not found'); process.exit(1); }

const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
const sheet1 = (meta.data.sheets || []).find(s => s.properties?.title === 'Sheet1');
if (!sheet1) { console.error('Sheet1 not found'); process.exit(1); }
const sheetId = sheet1.properties.sheetId;

const lcTargets = new Set(emails.map(e => e.toLowerCase().trim()));
const toDelete = [];
for (let i = 1; i < rows.length; i++) {
  if (lcTargets.has((rows[i][emailCol] || '').toLowerCase().trim())) toDelete.push(i);
}

if (toDelete.length) {
  const requests = toDelete.sort((a, b) => b - a).map(i => ({
    deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } }
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  console.log(`Deleted ${toDelete.length} sheet row(s)`);
} else {
  console.log('No matching sheet rows');
}

const users = [];
for (let page = 1; page <= 20; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error('listUsers failed:', error); process.exit(1); }
  users.push(...data.users);
  if (data.users.length < 1000) break;
}
for (const email of emails) {
  const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (!target) { console.log(`Supabase: no user for ${email}`); continue; }
  const { error: delErr } = await supabase.auth.admin.deleteUser(target.id, false);
  if (delErr) console.error(`Supabase delete failed for ${email}:`, delErr);
  else console.log(`Supabase: hard-deleted ${email}`);
}
