import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, requestId, item, description, link, price, submittedBy } = req.body || {};
  if (password !== process.env.ADMIN_PASSWORD && password !== process.env.ADMIN_WRITE_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!requestId || !item || !submittedBy) return res.status(400).json({ error: 'requestId, item, submittedBy required' });
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.BUDGET_SHEET_ID,
      range: 'ShoppingRequests',
      valueInputOption: 'RAW',
      requestBody: { values: [[requestId, item, description || '', link || '', price || '', submittedBy, 'pending']] },
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('shopping-request error:', e);
    return res.status(500).json({ error: 'Failed to submit request' });
  }
}
