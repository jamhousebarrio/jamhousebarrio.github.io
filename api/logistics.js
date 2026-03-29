import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

function getSheets(write) {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: [write
      ? 'https://www.googleapis.com/auth/spreadsheets'
      : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return sheetsApi({ version: 'v4', auth });
}

async function safeGet(sheets, spreadsheetId, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (e) {
    return [];
  }
}

function toObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, memberName, arrivalDate, arrivalTime, transport, needsPickup, departureDate, campingType, tentSize, notes } = req.body || {};

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const id = process.env.SHEET_ID;

  try {
    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = getSheets(false);
      const rows = await safeGet(sheets, id, 'MemberLogistics');
      return res.status(200).json({ logistics: toObjects(rows) });
    }

    // ── Upsert ────────────────────────────────────────────────────────────
    if (action === 'upsert') {
      if (!memberName) return res.status(400).json({ error: 'memberName required' });

      const sheets = getSheets(true);
      const tabName = 'MemberLogistics';
      const allHeaders = ['MemberName', 'ArrivalDate', 'ArrivalTime', 'Transport', 'NeedsPickup', 'DepartureDate', 'CampingType', 'TentSize', 'Notes'];
      const fieldMap = {
        MemberName: memberName,
        ArrivalDate: arrivalDate || '',
        ArrivalTime: arrivalTime || '',
        Transport: transport || '',
        NeedsPickup: needsPickup || '',
        DepartureDate: departureDate || '',
        CampingType: campingType || '',
        TentSize: tentSize || '',
        Notes: notes || '',
      };

      const existing = await safeGet(sheets, id, tabName);

      if (!existing.length) {
        // Tab empty or missing — create with full headers
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: id,
            requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
          });
        } catch (e) { /* tab exists */ }
        const newRow = allHeaders.map(h => fieldMap[h] || '');
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [allHeaders, newRow] },
        });
        return res.status(200).json({ ok: true });
      }

      let existingHeaders = existing[0];

      // Add any missing headers to the sheet
      const missingHeaders = allHeaders.filter(h => existingHeaders.indexOf(h) === -1);
      if (missingHeaders.length) {
        const startCol = existingHeaders.length;
        existingHeaders = existingHeaders.concat(missingHeaders);
        // Write new headers
        let colLetter = '';
        let c = startCol;
        while (c >= 0) { colLetter = String.fromCharCode(65 + (c % 26)) + colLetter; c = Math.floor(c / 26) - 1; }
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!${colLetter}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [missingHeaders] },
        });
      }

      // Build row matching existing header order
      const newRow = existingHeaders.map(h => fieldMap[h] !== undefined ? fieldMap[h] : '');

      const nameCol = existingHeaders.indexOf('MemberName');
      let foundRowIndex = -1;
      for (let i = 1; i < existing.length; i++) {
        if ((existing[i][nameCol] || '') === memberName) {
          foundRowIndex = i + 1;
          break;
        }
      }

      if (foundRowIndex > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!A${foundRowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values: [newRow] },
        });
      } else {
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
    console.error('Logistics API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
