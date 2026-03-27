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
  const { password, row, updates } = req.body || {};
  if (!password || password !== process.env.ADMIN_WRITE_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!row || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: "Row and updates are required" });
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
    var data = [];
    for (var key in updates) {
      var col = headers.indexOf(key);
      if (col === -1) continue;
      var colLetter = colToLetter(col);
      data.push({ range: 'Sheet1!' + colLetter + row, values: [[updates[key]]] });
    }
    if (data.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: data },
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Update member error:", err);
    return res.status(500).json({ error: "Failed to update member" });
  }
}
