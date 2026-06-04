// Read-only audit: which Approved/Observer members have a Supabase auth user
// (i.e. were sent the welcome/invite email)? An Approved/Observer member with
// NO Supabase user never received the invite.
//
// Usage: node --env-file=.env --env-file=.env.supabase scripts/audit-welcome-emails.mjs

import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = sheetsApi({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const all = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
const rows = all.data.values || [];
const headers = rows[0] || [];
const col = (name) => headers.indexOf(name);
const emailCol = col('Email');
const statusCol = col('Status');
const nameCol = headers.findIndex(h => /name/i.test(h)); // best-effort name column

// Pull all Supabase users (paginate).
const userByEmail = new Map();
let page = 1;
for (;;) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error('listUsers failed:', error); process.exit(1); }
  for (const u of data.users) if (u.email) userByEmail.set(u.email.toLowerCase().trim(), u);
  if (data.users.length < 1000) break;
  page++;
}

const PORTAL = new Set(['approved', 'observer']);
const audited = [];
for (let i = 1; i < rows.length; i++) {
  const status = (rows[i][statusCol] || '').trim();
  if (!PORTAL.has(status.toLowerCase())) continue;
  const email = (rows[i][emailCol] || '').trim();
  const name = nameCol >= 0 ? (rows[i][nameCol] || '').trim() : '';
  const u = userByEmail.get(email.toLowerCase().trim());
  audited.push({
    name, email, status,
    hasUser: !!u,
    confirmed: u ? !!u.email_confirmed_at : false,
    lastSignIn: u?.last_sign_in_at || '',
    createdAt: u?.created_at || '',
  });
}

console.log(`\nApproved/Observer members: ${audited.length}\n`);
const missing = audited.filter(a => !a.hasUser);
console.log(`=== NO Supabase user (welcome email NEVER sent): ${missing.length} ===`);
for (const a of missing) console.log(`  ✗ ${a.name || '(no name)'} <${a.email || 'NO EMAIL'}> [${a.status}]`);

const invitedNotConfirmed = audited.filter(a => a.hasUser && !a.lastSignIn);
console.log(`\n=== Has user but NEVER signed in (invited, not yet activated): ${invitedNotConfirmed.length} ===`);
for (const a of invitedNotConfirmed) console.log(`  • ${a.name || '(no name)'} <${a.email}> [${a.status}] created ${a.createdAt}`);

const active = audited.filter(a => a.hasUser && a.lastSignIn);
console.log(`\n=== Signed in at least once: ${active.length} ===`);
for (const a of active) console.log(`  ✓ ${a.name || '(no name)'} <${a.email}> [${a.status}]`);

// Spotlight requested names.
console.log(`\n=== Spotlight (smoochi / yappy) ===`);
const spot = audited.filter(a => /smoochi|yappy/i.test(a.name) || /smoochi|yappy/i.test(a.email));
if (!spot.length) console.log('  (no Approved/Observer rows matched "smoochi" or "yappy")');
for (const a of spot) {
  console.log(`  ${a.hasUser ? (a.lastSignIn ? '✓ active' : '• invited, not signed in') : '✗ NO USER — not invited'}: ${a.name} <${a.email}> [${a.status}]`);
}
