#!/usr/bin/env node
// Read-only: dump any tab. Usage: node scripts/dump-tab.mjs <TabName>
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });
const auth = new GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = sheetsApi({ version: 'v4', auth });
const tab = process.argv[2];
const res = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: tab });
const rows = res.data.values || [];
console.log(`${tab}: ${rows.length ? rows.length - 1 : 0} data rows`);
rows.forEach((r, i) => console.log(`${i === 0 ? 'H' : i + 1}: ${r.join(' | ')}`));
