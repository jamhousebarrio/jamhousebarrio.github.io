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

    // Read Budget tab
    const budgetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.BUDGET_SHEET_ID,
      range: 'Budget',
    });
    const budgetRows = budgetRes.data.values || [];
    const headers = budgetRows[0] || [];
    const items = budgetRows.slice(1).map((row, i) => {
      const obj = { _row: i + 2 };
      headers.forEach((h, j) => { obj[h] = row[j] || ''; });
      return obj;
    }).filter(item => item.Item || item.Category);

    // Read Barrio Fee tab for fee stats
    const feeRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.BUDGET_SHEET_ID,
      range: "'Barrio Fee'",
    });
    const feeRows = feeRes.data.values || [];
    let totalExpected = 0, totalPaid = 0;
    feeRows.slice(1).forEach(r => {
      totalExpected += parseFloat(r[2]) || 0;
      totalPaid += parseFloat(r[3]) || 0;
    });

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.BUDGET_SHEET_ID}`;
    return res.status(200).json({
      items,
      headers,
      fees: { expected: totalExpected, paid: totalPaid },
      sheetUrl,
    });
  } catch (e) {
    console.error('Budget items error:', e);
    return res.status(500).json({ error: 'Failed to fetch budget items' });
  }
}
