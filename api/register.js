import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

// Sanitize user input to prevent formula injection in spreadsheets
function sanitize(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/^[=+\-@]+/, '');
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const b = req.body || {};

  if (!b.name || !b.email) {
    return res.status(400).json({ error: "Name and Email are required" });
  }
  if (!b.email.includes('@') || !b.email.includes('.')) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = sheetsApi({ version: "v4", auth });

    const row = [
      new Date().toISOString(),
      sanitize(b.name || ""),
      sanitize(b.playaName || ""),
      sanitize(b.email || ""),
      sanitize(b.phone || ""),
      sanitize(b.contactMethods || ""),
      sanitize(b.contactOther || ""),
      sanitize(b.location || ""),
      sanitize(b.nationality || ""),
      sanitize(b.gender || ""),
      sanitize(b.age || ""),
      sanitize(b.language || ""),
      sanitize(b.otherLanguages || ""),
      sanitize(b.firstBurn || ""),
      sanitize(b.firstElsewhere || ""),
      sanitize(b.knowCoreTeam || ""),
      sanitize(b.leaveNoTrace || ""),
      sanitize(b.consent || ""),
      sanitize(b.whyElsewhere || ""),
      sanitize(b.background || ""),
      sanitize(b.artProject || ""),
      sanitize(b.skills || ""),
      sanitize(b.liftKg || ""),
      sanitize(b.deepestSecrets || ""),
      sanitize(b.talents || ""),
      sanitize(b.hasTicket || ""),
      sanitize(b.canBuild || ""),
      sanitize(b.hasCar || ""),
      sanitize(b.movingCar || ""),
      sanitize(b.otherCamp || ""),
      sanitize(b.volunteer || ""),
      sanitize(b.howHeard || ""),
      sanitize(b.specialNeeds || ""),
      sanitize(b.needsDescription || ""),
      "Pending",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Sheet1!A:AI",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });

    // Telegram notification
    try {
      var playaName = b.playaName || b.name || 'Unknown';
      var tgBody = {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: 'New JamHouse application from ' + playaName
      };
      if (process.env.TELEGRAM_TOPIC_ID) tgBody.message_thread_id = parseInt(process.env.TELEGRAM_TOPIC_ID);
      var tgRes = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tgBody)
      });
      var tgData = await tgRes.json();
      if (!tgData.ok) console.error('Telegram error:', tgData);
    } catch (tgErr) {
      console.error('Telegram send failed:', tgErr);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Failed to save registration" });
  }
};
