import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { colToLetter } from './_lib/sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { password, action, ...payload } = req.body || {};
  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const needsWrite = action === 'update' || action === 'update-status';
    const auth = new GoogleAuth({
      credentials,
      scopes: [needsWrite
        ? 'https://www.googleapis.com/auth/spreadsheets'
        : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = sheetsApi({ version: 'v4', auth });
    const spreadsheetId = process.env.SHEET_ID;

    // ── Fetch members (default) ───────────────────────────────────────────
    if (!action) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1',
      });
      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(200).json({ members: [], admin: isAdmin });
      }
      const headers = rows[0];
      const members = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
      return res.status(200).json({ members, admin: isAdmin });
    }

    // ── Write actions require write password ──────────────────────────────
    if (!isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];

    // ── Update member fields ──────────────────────────────────────────────
    if (action === 'update') {
      const { row, updates } = payload;
      if (!row || !updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Row and updates are required' });
      }
      var data = [];
      for (var key in updates) {
        var col = headers.indexOf(key);
        if (col === -1) continue;
        data.push({ range: 'Sheet1!' + colToLetter(col) + row, values: [[updates[key]]] });
      }
      if (data.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: data },
      });
      return res.status(200).json({ success: true });
    }

    // ── Update status ─────────────────────────────────────────────────────
    if (action === 'update-status') {
      const { row, status } = payload;
      if (!row || !status) {
        return res.status(400).json({ error: 'Row and status are required' });
      }
      const col = headers.indexOf('Status');
      if (col === -1) {
        return res.status(500).json({ error: 'Status column not found' });
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!' + colToLetter(col) + row,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] },
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('Members API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
