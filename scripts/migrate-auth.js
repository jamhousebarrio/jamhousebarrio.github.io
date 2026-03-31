import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Read all members from Sheet1
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = sheetsApi({ version: 'v4', auth });
  const spreadsheetId = process.env.SHEET_ID;

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
  const rows = res.data.values;
  if (!rows || rows.length < 2) {
    console.log('No members found in Sheet1');
    return;
  }

  const headers = rows[0];
  const emailCol = headers.indexOf('Email');
  const statusCol = headers.indexOf('Status');
  if (emailCol === -1 || statusCol === -1) {
    console.error('Email or Status column not found');
    return;
  }

  // 2. Check for duplicate emails
  const approved = [];
  const emailMap = {};
  for (let i = 1; i < rows.length; i++) {
    const email = (rows[i][emailCol] || '').toLowerCase().trim();
    const status = (rows[i][statusCol] || '').toLowerCase();
    if (status !== 'approved' || !email) continue;
    if (emailMap[email]) {
      console.warn(`DUPLICATE EMAIL: "${email}" at rows ${emailMap[email]} and ${i + 1} — SKIPPING BOTH`);
      emailMap[email] = -1; // mark as duplicate
      continue;
    }
    emailMap[email] = i + 1;
    approved.push({ email, row: i + 1, name: rows[i][headers.indexOf('Name')] || '' });
  }

  // Filter out duplicates
  const toMigrate = approved.filter(m => emailMap[m.email] !== -1);
  console.log(`Found ${toMigrate.length} approved members to migrate`);

  // 3. Ensure Admin column exists
  let adminCol = headers.indexOf('Admin');
  if (adminCol === -1) {
    // Add Admin header
    adminCol = headers.length;
    const colLetter = String.fromCharCode(65 + adminCol);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!${colLetter}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Admin']] },
    });
    console.log(`Added "Admin" column at column ${colLetter}`);
  }

  // 4. Create Supabase accounts and set Admin=Yes
  let created = 0, skipped = 0, errors = 0;

  for (const member of toMigrate) {
    // Create Supabase user
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email: member.email,
        password: 'jamhouse2026',
        email_confirm: true,
        user_metadata: { must_change_password: true },
      });
      if (error) {
        if (error.message && error.message.includes('already been registered')) {
          console.log(`SKIP: ${member.email} (already exists in Supabase)`);
          skipped++;
        } else {
          console.error(`ERROR: ${member.email} — ${error.message}`);
          errors++;
        }
      } else {
        console.log(`CREATED: ${member.email} (${member.name})`);
        created++;
      }
    } catch (e) {
      console.error(`ERROR: ${member.email} — ${e.message}`);
      errors++;
    }

    // Set Admin=Yes in sheet
    const colLetter = String.fromCharCode(65 + adminCol);
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!${colLetter}${member.row}`,
        valueInputOption: 'RAW',
        requestBody: { values: [['Yes']] },
      });
    } catch (e) {
      console.error(`Failed to set Admin for ${member.email}: ${e.message}`);
    }
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
