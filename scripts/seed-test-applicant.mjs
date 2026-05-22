// One-shot helper to seed a Pending applicant row for local testing.
// Bypasses /api/register so the public "new application" Telegram doesn't
// fire. Delete the row from the sheet (or via /api/members action:delete)
// when you're done.
//
// Usage:
//   node --env-file=.env scripts/seed-test-applicant.mjs <email> <name> [playa-name]

import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const [email, name, playa] = process.argv.slice(2);
if (!email || !name) {
  console.error('usage: node --env-file=.env scripts/seed-test-applicant.mjs <email> <name> [playa-name]');
  process.exit(1);
}

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

const headersRes = await sheets.spreadsheets.values.get({
  spreadsheetId, range: 'Sheet1!1:1',
});
const headers = (headersRes.data.values || [[]])[0] || [];

const data = {
  Timestamp: new Date().toISOString(),
  Name: name,
  'Playa Name': playa || '',
  Email: email,
  Status: 'Pending',
};
const row = headers.map(h => data[h] !== undefined ? data[h] : '');

await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: 'Sheet1',
  valueInputOption: 'RAW',
  requestBody: { values: [row] },
});

console.log('Seeded Pending row for', email);
