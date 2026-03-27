import { google } from 'googleapis';

function getSheets(readonly) {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: readonly
      ? ['https://www.googleapis.com/auth/spreadsheets.readonly']
      : ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function safeGet(sheets, spreadsheetId, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (e) {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, memberName, arrivalDate, departureDate, campingType, tentSize, notes } = req.body || {};

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  if (!action) return res.status(400).json({ error: 'action required' });
  if (!memberName) return res.status(400).json({ error: 'memberName required' });

  try {
    const sheets = getSheets(false);
    const id = process.env.SHEET_ID;
    const tabName = 'MemberLogistics';
    const headers = ['MemberName', 'ArrivalDate', 'DepartureDate', 'CampingType', 'TentSize', 'Notes'];
    const newRow = [memberName, arrivalDate || '', departureDate || '', campingType || '', tentSize || '', notes || ''];

    if (action === 'upsert') {
      // Read existing rows to find if member already has an entry
      const existing = await safeGet(sheets, id, tabName);

      if (!existing.length) {
        // Tab doesn't exist yet — write headers + row
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [headers, newRow] },
        });
        return res.status(200).json({ ok: true });
      }

      // Find existing row index (1-based, row 1 is headers)
      const existingHeaders = existing[0];
      const nameCol = existingHeaders.indexOf('MemberName');
      let foundRowIndex = -1;
      for (let i = 1; i < existing.length; i++) {
        if ((existing[i][nameCol] || '') === memberName) {
          foundRowIndex = i + 1; // 1-based sheet row
          break;
        }
      }

      if (foundRowIndex > 0) {
        // Update existing row
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!A${foundRowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values: [newRow] },
        });
      } else {
        // Append new row
        await sheets.spreadsheets.values.append({
          spreadsheetId: id,
          range: `${tabName}!A1`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [newRow] },
        });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('logistics-update.js error:', e);
    return res.status(500).json({ error: 'Failed to update logistics data' });
  }
}
