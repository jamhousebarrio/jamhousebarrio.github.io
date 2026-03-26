import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD && password !== process.env.ADMIN_WRITE_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.BUDGET_SHEET_ID,
      range: 'Total',
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(200).json([]);
    }
    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
    return res.status(200).json(data);
  } catch (e) {
    console.error('Budget fetch error:', e);
    return res.status(500).json({ error: 'Failed to fetch budget data' });
  }
}
