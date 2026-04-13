import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

function sanitize(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/^[=@]+/, '');
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
    const spreadsheetId = process.env.SHEET_ID;

    // Read headers to map data by column name, not position
    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId, range: 'Sheet1!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];

    // Map field name -> value
    const data = {
      'Timestamp': new Date().toISOString(),
      'Name': sanitize(b.name || ""),
      'Playa Name': sanitize(b.playaName || ""),
      'Email': sanitize(b.email || ""),
      'Phone': sanitize(b.phone || ""),
      'Telegram': sanitize(b.telegram || ""),
      'Contact Methods': sanitize(b.contactMethods || ""),
      'Contact Other': sanitize(b.contactOther || ""),
      'Location': sanitize(b.location || ""),
      'Nationality': sanitize(b.nationality || ""),
      'Gender': sanitize(b.gender || ""),
      'Age': sanitize(b.age || ""),
      'Language': sanitize(b.language || ""),
      'Other Languages': sanitize(b.otherLanguages || ""),
      'First Burn': sanitize(b.firstBurn || ""),
      'First Elsewhere/Nowhere': sanitize(b.firstElsewhere || ""),
      'Know Core Team': sanitize(b.knowCoreTeam || ""),
      'Leave No Trace': sanitize(b.leaveNoTrace || ""),
      'Consent': sanitize(b.consent || ""),
      'Why Elsewhere': sanitize(b.whyElsewhere || ""),
      'Background': sanitize(b.background || ""),
      'Art Project': sanitize(b.artProject || ""),
      'Skills': sanitize(b.skills || ""),
      'Lift Kg': sanitize(b.liftKg || ""),
      'Deepest Secrets': sanitize(b.deepestSecrets || ""),
      'Talents': sanitize(b.talents || ""),
      'Has Ticket': sanitize(b.hasTicket || ""),
      'Can Build': sanitize(b.canBuild || ""),
      'Has Car': sanitize(b.hasCar || ""),
      'Moving Car': sanitize(b.movingCar || ""),
      'Other Camp': sanitize(b.otherCamp || ""),
      'Volunteer': sanitize(b.volunteer || ""),
      'How Heard': sanitize(b.howHeard || ""),
      'Special Needs': sanitize(b.specialNeeds || ""),
      'Needs Description': sanitize(b.needsDescription || ""),
      'Status': "Pending",
    };

    // Build row array matching actual sheet header order
    const row = headers.map(h => data[h] !== undefined ? data[h] : "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1",
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
