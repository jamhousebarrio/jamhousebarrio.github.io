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
      b.arrival || "",
      b.canBuild || "",
      b.hasCar || "",
      b.movingCar || "",
      b.departure || "",
      b.otherCamp || "",
      b.volunteer || "",
      b.skills || "",
      b.liftKg || "",
      b.foodAllergies || "",
      b.foodIntolerance || "",
      b.otherIntolerance || "",
      b.intoleranceDetails || "",
      b.dietaryRestrictions || "",
      b.healthInfo || "",
      b.talents || "",
      b.emergencyName || "",
      b.emergencyPhone || "",
      b.emergencyRelationship || "",
      b.howHeard || "",
      b.specialNeeds || "",
      b.needsDescription || "",
      b.hasTicket || "",
      b.comments || "",
      "Pending",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Sheet1!A:AS",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Failed to save registration" });
  }
};
