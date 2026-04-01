/**
 * Fix missing Phone column in members sheet.
 *
 * Problem: Sheet has no "Phone" column. For form-submitted rows,
 * phone numbers landed in "Contact Methods" and contact methods
 * shifted to "Contact Other".
 *
 * Fix:
 * 1. Insert "Phone" column after "Email"
 * 2. For rows where Contact Methods looks like a phone number,
 *    move it to Phone and shift Contact Other → Contact Methods
 *
 * Usage: GOOGLE_SERVICE_ACCOUNT_KEY=... SHEET_ID=... node scripts/fix-phone-column.js
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

function getSheetsClient() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
  // Strip outer quotes if present
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  // Re-escape literal newlines so JSON.parse works
  raw = raw.replace(/\n/g, '\\n');
  const creds = JSON.parse(raw);
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return sheetsApi({ version: 'v4', auth });
}

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;

  // Read all data
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
  const rows = res.data.values || [];
  if (!rows.length) { console.log('No data'); return; }

  const headers = rows[0];
  console.log('Current headers:', headers.join(' | '));

  const emailIdx = headers.indexOf('Email');
  const adminIdx = headers.indexOf('Admin');
  const contactMethodsIdx = headers.indexOf('Contact Methods');
  const contactOtherIdx = headers.indexOf('Contact Other');
  const phoneIdx = headers.indexOf('Phone');

  if (phoneIdx !== -1) {
    console.log('Phone column already exists at position', phoneIdx);
    return;
  }
  if (emailIdx === -1) { console.log('Email column not found'); return; }

  // Insert Phone column after Email (before Admin)
  const insertAt = emailIdx + 1; // insert after Email
  console.log(`\nInserting "Phone" column at position ${insertAt} (after Email)`);

  // Get sheet ID for batchUpdate
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const sheet = meta.data.sheets.find(s => s.properties.title === 'Sheet1');
  const sheetId = sheet.properties.sheetId;

  // Detect which rows have phone numbers in wrong columns
  // Phone numbers: start with + or digits, 7+ chars, mostly digits
  function looksLikePhone(val) {
    if (!val) return false;
    const cleaned = val.replace(/[\s\-\(\)]/g, '');
    return /^\+?\d{7,15}$/.test(cleaned);
  }

  console.log('\nAnalyzing rows for misplaced phone data:');
  const fixes = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue; // skip empty rows

    const name = row[1] || '';
    const contactMethods = (row[contactMethodsIdx] || '').trim();
    const contactOther = (row[contactOtherIdx] || '').trim();
    const admin = (row[adminIdx] || '').trim();

    if (looksLikePhone(contactMethods)) {
      fixes.push({
        row: i + 1, // 1-based sheet row
        name,
        phone: contactMethods,
        realContactMethods: contactOther,
        clearContactOther: true,
      });
      console.log(`  Row ${i + 1} (${name}): Phone="${contactMethods}" → move from Contact Methods, shift Contact Other="${contactOther}" → Contact Methods`);
    } else if (looksLikePhone(admin)) {
      // Some rows might have phone in Admin column
      fixes.push({
        row: i + 1,
        name,
        phone: admin,
        clearAdmin: true,
        realContactMethods: null,
      });
      console.log(`  Row ${i + 1} (${name}): Phone="${admin}" → move from Admin`);
    } else {
      console.log(`  Row ${i + 1} (${name}): OK (no misplaced phone)`);
    }
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN --- No changes made.');
    return;
  }

  // Step 1: Insert column
  console.log('\nInserting Phone column...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: insertAt, endIndex: insertAt + 1 },
          inheritFromBefore: false,
        }
      }]
    }
  });

  // Step 2: Set header
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Sheet1!${colLetter(insertAt)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Phone']] },
  });
  console.log('Phone header set.');

  // After insertion, column indices shifted:
  // New Phone column is at insertAt
  // Old Contact Methods shifted right by 1
  // Old Contact Other shifted right by 1
  // Old Admin shifted right by 1
  const newPhoneCol = insertAt;
  const newContactMethodsCol = contactMethodsIdx + 1;
  const newContactOtherCol = contactOtherIdx + 1;
  const newAdminCol = adminIdx + 1;

  // Step 3: Fix data
  if (fixes.length) {
    console.log(`\nFixing ${fixes.length} rows...`);
    const updates = [];
    for (const fix of fixes) {
      // Set phone value in new Phone column
      updates.push({
        range: `Sheet1!${colLetter(newPhoneCol)}${fix.row}`,
        values: [[fix.phone]],
      });

      if (fix.clearContactOther) {
        // Move Contact Other → Contact Methods, clear Contact Other
        updates.push({
          range: `Sheet1!${colLetter(newContactMethodsCol)}${fix.row}`,
          values: [[fix.realContactMethods || '']],
        });
        updates.push({
          range: `Sheet1!${colLetter(newContactOtherCol)}${fix.row}`,
          values: [['']],
        });
      }

      if (fix.clearAdmin) {
        updates.push({
          range: `Sheet1!${colLetter(newAdminCol)}${fix.row}`,
          values: [['']],
        });
      }
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
    console.log('Data fixed.');
  }

  // Verify
  const verify = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
  console.log('\nNew headers:', (verify.data.values[0] || []).join(' | '));
  console.log('Done!');
}

function colLetter(idx) {
  let letter = '';
  let c = idx;
  while (c >= 0) {
    letter = String.fromCharCode(65 + (c % 26)) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

main().catch(e => { console.error(e); process.exit(1); });
