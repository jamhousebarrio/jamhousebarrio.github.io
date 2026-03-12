import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password, row, status } = req.body || {};

  if (password !== process.env.ADMIN_WRITE_PASSWORD) {
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

    // Status is in column AI (column 35)
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `Sheet1!AI${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Update status error:", err);
    return res.status(500).json({ error: "Failed to update status" });
  }
};
