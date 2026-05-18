import { getSheets, ensureTab, getRows } from './sheets.js';

const TAB = 'ErrorLog';
const HEADERS = ['Timestamp', 'Endpoint', 'Action', 'Method', 'Status', 'ErrorMessage', 'ErrorStack', 'Context'];

async function ensureTabWithHeaders(sheets, spreadsheetId) {
  await ensureTab(sheets, spreadsheetId, TAB);
  const rows = await getRows(sheets, spreadsheetId, TAB);
  if (!rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
  }
}

export async function logError(req, error, extra = {}) {
  try {
    const sheets = getSheets(true);
    const spreadsheetId = process.env.SHEET_ID;
    if (!spreadsheetId) return;
    await ensureTabWithHeaders(sheets, spreadsheetId);

    const url = (req && req.url) || '';
    const endpoint = url.split('?')[0].replace(/^\/api\//, '').replace(/\/$/, '') || extra.endpoint || '';
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const action = body.action || '';
    const method = (req && req.method) || '';
    const status = extra.status || '';
    const msg = (error && error.message ? error.message : String(error || '')).slice(0, 500);
    const stack = (error && error.stack ? error.stack : '').slice(0, 2000);

    const ctx = { ...extra };
    delete ctx.endpoint;
    delete ctx.status;
    const contextStr = JSON.stringify(ctx).slice(0, 1000);

    const row = [new Date().toISOString(), endpoint, action, method, String(status), msg, stack, contextStr];
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: TAB,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
  } catch (logErr) {
    console.error('logError failed:', logErr && logErr.message);
  }
}
