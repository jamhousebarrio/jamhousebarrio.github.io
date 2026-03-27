import { google } from 'googleapis';

function colToLetter(col) {
  var letter = '';
  var c = col;
  while (c >= 0) {
    letter = String.fromCharCode(65 + (c % 26)) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { password, row, status } = req.body || {};
  if (!password || password !== process.env.ADMIN_WRITE_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!row || !status) {
    return res.status(400).json({ error: "Row and status are required" });
  }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Sheet1!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];
    const col = headers.indexOf('Status');
    if (col === -1) {
      return res.status(500).json({ error: "Status column not found" });
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Sheet1!' + colToLetter(col) + row,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] },
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Update status error:", err);
    return res.status(500).json({ error: "Failed to update status" });
  }
}
