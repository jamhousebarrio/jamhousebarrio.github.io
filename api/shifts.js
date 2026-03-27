import { google } from 'googleapis';

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function safeGet(sheets, spreadsheetId, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (e) {
    return [];
  }
}

function toObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password } = req.body || {};
  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  try {
    const sheets = getSheets();
    const id = process.env.SHEET_ID;
    const [shiftDefsRows, slotConfigRows, assignmentsRows, memberMetaRows] = await Promise.all([
      safeGet(sheets, id, 'ShiftDefs'),
      safeGet(sheets, id, 'ShiftConfig'),
      safeGet(sheets, id, 'ShiftAssignments'),
      safeGet(sheets, id, 'MemberMeta'),
    ]);
    return res.status(200).json({
      shifts: toObjects(shiftDefsRows),
      slots: toObjects(slotConfigRows),
      assignments: toObjects(assignmentsRows),
      memberMeta: toObjects(memberMetaRows),
    });
  } catch (e) {
    console.error('shifts.js error:', e);
    return res.status(500).json({ error: 'Failed to fetch shift data' });
  }
}
