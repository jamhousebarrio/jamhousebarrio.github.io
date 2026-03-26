import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const b = req.body || {};

  if (!b.name || !b.email) {
    return res.status(400).json({ error: "Name and Email are required" });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const row = [
      new Date().toISOString(),
      b.name || "",
      b.playaName || "",
      b.email || "",
      b.phone || "",
      b.contactMethods || "",
      b.contactOther || "",
      b.location || "",
      b.nationality || "",
      b.gender || "",
      b.age || "",
      b.language || "",
      b.otherLanguages || "",
      b.firstBurn || "",
      b.firstElsewhere || "",
      b.knowCoreTeam || "",
      b.leaveNoTrace || "",
      b.consent || "",
      b.whyElsewhere || "",
      b.background || "",
      b.artProject || "",
      b.skills || "",
      b.liftKg || "",
      b.deepestSecrets || "",
      b.talents || "",
      b.hasTicket || "",
      b.canBuild || "",
      b.hasCar || "",
      b.movingCar || "",
      b.otherCamp || "",
      b.volunteer || "",
      b.howHeard || "",
      b.specialNeeds || "",
      b.needsDescription || "",
      "Pending",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Sheet1!A:AI",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Failed to save registration" });
  }
};
