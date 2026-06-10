import { colToLetter, getSheetId, ensureTab, getRows } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';
import { logError } from './_lib/error-log.js';
import { shouldInvite, sendMemberInvite, getSupabaseAdmin, PORTAL_STATUSES, diffMissingInvites, listUserEmails } from './_lib/invite.js';

const SETTINGS_TAB = 'Settings';
const LOW_INCOME_ENABLED_KEY = 'low_income_enabled';

async function getSetting(sheets, spreadsheetId, key, defaultValue) {
  const rows = await getRows(sheets, spreadsheetId, SETTINGS_TAB);
  if (!rows.length) return defaultValue;
  const headers = rows[0];
  const keyCol = headers.indexOf('key');
  const valCol = headers.indexOf('value');
  if (keyCol === -1 || valCol === -1) return defaultValue;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][keyCol] || '') === key) return rows[i][valCol] || defaultValue;
  }
  return defaultValue;
}

async function setSetting(sheets, spreadsheetId, key, value) {
  let rows = await getRows(sheets, spreadsheetId, SETTINGS_TAB);
  if (!rows.length) {
    await ensureTab(sheets, spreadsheetId, SETTINGS_TAB);
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: SETTINGS_TAB + '!A1', valueInputOption: 'RAW',
      requestBody: { values: [['key', 'value'], [key, value]] },
    });
    return;
  }
  const headers = rows[0];
  const keyCol = headers.indexOf('key');
  const valCol = headers.indexOf('value');
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][keyCol] || '') === key) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: SETTINGS_TAB + '!' + colToLetter(valCol) + (i + 1),
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      });
      return;
    }
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: SETTINGS_TAB, valueInputOption: 'RAW',
    requestBody: { values: [[key, value]] },
  });
}

function settingIsTrue(v) {
  const s = (v == null ? '' : String(v)).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

const ALLOWED_STATUSES = ['Pending', 'Review', 'Vibe Check', 'Team Discussion', 'On-boarding', 'Approved', 'Observer', 'Rejected'];
const BARRIO_FEE = 280;
const LOW_INCOME_FEE = 180;
const FEE_COLUMNS = ['fee_total_sent', 'fee_received', 'low_income_request', 'low_income_status'];
const DIETARY_COLUMNS = ['FoodType', 'DietaryNotes', 'LastDietaryPromptedAt'];
const ALLOWED_FOOD_TYPES = ['', 'Carnivore', 'Pescatarian', 'Vegetarian', 'Vegan'];

async function tgSend(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  try {
    const body = { chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' };
    if (process.env.TELEGRAM_TOPIC_ID) body.message_thread_id = parseInt(process.env.TELEGRAM_TOPIC_ID);
    await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) { console.error('Telegram send failed:', e); }
}

function displayName(member) {
  const playa = (member['Playa Name'] || '').toString().trim();
  if (playa) return playa;
  const name = (member['Name'] || '').toString().trim();
  return name.split(/\s+/)[0] || 'Someone';
}

// Best-effort invite + welcome ping after a status transition into portal
// access. Never throws — a failed email must not roll back the status write
// (the admin can re-send via the Invite button or Sync invites). `rowData`/
// `hdrs` are already-fetched arrays for the member's row. Caller must have
// already confirmed shouldInvite(oldStatus, newStatus).
async function inviteOnTransition({ sheets, hdrs, rowData, newStatus }) {
  const get = (col) => { const i = hdrs.indexOf(col); return i === -1 ? '' : (rowData[i] || ''); };
  const email = get('Email').toString().trim();
  if (!email) { console.error('inviteOnTransition: no email on row'); return; }
  const member = {}; hdrs.forEach((h, j) => { member[h] = rowData[j] || ''; });
  try {
    const r = await sendMemberInvite({ supabase: getSupabaseAdmin(), sheets, email, status: newStatus, member });
    const name = (member['Playa Name'] || member['Name'] || email).toString().trim() || email;
    if (String(newStatus).toLowerCase() === 'observer') {
      if (r.isNewUser) await tgSend('👀 *' + name + '* joined us as a lurker.');
    } else {
      await tgSend('🎉 Welcome to the barrio! *' + name + '* has been approved — say hi!');
    }
  } catch (e) {
    console.error('inviteOnTransition failed for', email, e.message);
  }
}

async function ensureFeeColumns(sheets, spreadsheetId, headers) {
  const missing = FEE_COLUMNS.filter(c => headers.indexOf(c) === -1);
  if (!missing.length) return headers;
  const newHeaders = headers.concat(missing);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1:' + colToLetter(newHeaders.length - 1) + '1',
    valueInputOption: 'RAW',
    requestBody: { values: [newHeaders] },
  });
  return newHeaders;
}

async function ensureDietaryColumns(sheets, spreadsheetId, headers) {
  const missing = DIETARY_COLUMNS.filter(c => headers.indexOf(c) === -1);
  if (!missing.length) return headers;
  const newHeaders = headers.concat(missing);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1:' + colToLetter(newHeaders.length - 1) + '1',
    valueInputOption: 'RAW',
    requestBody: { values: [newHeaders] },
  });
  return newHeaders;
}

async function writeCell(sheets, spreadsheetId, headers, row, colName, value) {
  const col = headers.indexOf(colName);
  if (col === -1) return false;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!' + colToLetter(col) + row,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
  return true;
}

export default async function handler(req, res) {
  // ── Cron: weekly chase (Saturday 10:00 UTC) ──────────────────────────
  if (req.method === 'GET' && (req.query || {}).cron === 'chase') {
    const expected = 'Bearer ' + (process.env.CRON_SECRET || '');
    const got = req.headers.authorization || req.headers.Authorization || '';
    if (!process.env.CRON_SECRET || got !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const { getSheets } = await import('./_lib/sheets.js');
      const sheets = getSheets(false);
      const spreadsheetId = process.env.SHEET_ID;
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
      const rows = r.data.values || [];
      if (rows.length < 2) return res.status(200).json({ outstanding: 0 });
      const headers = rows[0];
      const statusCol = headers.indexOf('Status');
      const recvCol = headers.indexOf('fee_received');
      const outstanding = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (((row[statusCol] || '').toLowerCase()) !== 'approved') continue;
        const received = ((row[recvCol] || '').toString().toUpperCase() === 'TRUE');
        if (received) continue;
        const m = {};
        headers.forEach((h, j) => { m[h] = row[j] || ''; });
        outstanding.push(displayName(m));
      }
      if (outstanding.length) {
        await tgSend('🔔 *Weekly barrio fee reminder*\nStill outstanding: ' + outstanding.join(', ') + '\nBank details & status: [Fee Paid page](https://jamhouse.space/admin/fee-paid)');
      }
      return res.status(200).json({ outstanding: outstanding.length });
    } catch (e) {
      console.error('Cron chase error:', e);
      return res.status(500).json({ error: 'Cron failed' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};
    const sheets = auth.sheets;
    const spreadsheetId = auth.spreadsheetId;

    // ── Fetch members (default) ───────────────────────────────────────────
    if (!action) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1',
      });
      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(200).json({ members: [], admin: auth.admin });
      }
      const headers = rows[0];
      const members = rows.slice(1).map((row, i) => {
        const obj = { _row: i + 2 };
        headers.forEach((h, j) => { obj[h] = row[j] || ''; });
        return obj;
      });
      return res.status(200).json({ members, admin: auth.admin, observer: auth.observer });
    }

    // ── Fee: fetch (own status for member; full roster for admin) ────────
    if (action === 'fee-fetch') {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
      const rows = r.data.values || [];
      let headers = rows[0] || [];
      headers = await ensureFeeColumns(sheets, spreadsheetId, headers);
      const liReq = headers.indexOf('low_income_request');
      const liStatus = headers.indexOf('low_income_status');
      const sentCol = headers.indexOf('fee_total_sent');
      const recvCol = headers.indexOf('fee_received');
      const statusCol = headers.indexOf('Status');
      const nameCol = headers.indexOf('Name');
      const playaCol = headers.indexOf('Playa Name');
      const emailCol = headers.indexOf('Email');
      const phoneCol = headers.indexOf('Phone');
      const tgCol = headers.indexOf('Telegram');

      const me = rows.find((row, i) => i > 0 && (row[emailCol] || '').toLowerCase().trim() === auth.email.toLowerCase().trim());
      const myFee = me ? {
        fee_total_sent: parseFloat(me[sentCol]) || 0,
        fee_received: ((me[recvCol] || '').toString().toUpperCase() === 'TRUE'),
        low_income_request: me[liReq] || '',
        low_income_status: me[liStatus] || '',
      } : null;

      let roster = null;
      if (auth.admin) {
        roster = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (((row[statusCol] || '').toLowerCase()) !== 'approved') continue;
          roster.push({
            _row: i + 1,
            name: row[nameCol] || '',
            playa_name: row[playaCol] || '',
            phone: phoneCol >= 0 ? (row[phoneCol] || '') : '',
            telegram: tgCol >= 0 ? (row[tgCol] || '') : '',
            fee_total_sent: parseFloat(row[sentCol]) || 0,
            fee_received: ((row[recvCol] || '').toString().toUpperCase() === 'TRUE'),
            low_income_request: row[liReq] || '',
            low_income_status: row[liStatus] || '',
          });
        }
      }
      const lowIncomeEnabled = settingIsTrue(await getSetting(sheets, spreadsheetId, LOW_INCOME_ENABLED_KEY, 'true'));
      return res.status(200).json({ expected: BARRIO_FEE, low_income_fee: LOW_INCOME_FEE, low_income_enabled: lowIncomeEnabled, me: myFee, roster, admin: auth.admin });
    }

    // ── Fee: member saves total sent ─────────────────────────────────────
    if (action === 'save-fee-sent') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const amount = parseFloat(payload.amount);
      if (!isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Invalid amount' });
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let headers = (r.data.values || [[]])[0] || [];
      headers = await ensureFeeColumns(sheets, spreadsheetId, headers);
      // Read current row to detect change
      const cur = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!' + auth.row + ':' + auth.row });
      const curRow = (cur.data.values || [[]])[0] || [];
      const sentCol = headers.indexOf('fee_total_sent');
      const recvCol = headers.indexOf('fee_received');
      const oldAmount = parseFloat(curRow[sentCol]) || 0;
      await writeCell(sheets, spreadsheetId, headers, auth.row, 'fee_total_sent', amount);
      // Auto-uncheck received if amount changed
      const wasReceived = ((curRow[recvCol] || '').toString().toUpperCase() === 'TRUE');
      if (wasReceived && oldAmount !== amount) {
        await writeCell(sheets, spreadsheetId, headers, auth.row, 'fee_received', 'FALSE');
      }
      const name = displayName(auth.member);
      await tgSend('💸 *' + name + '* marked their barrio fee as sent. Awaiting admin confirmation.');
      return res.status(200).json({ success: true });
    }

    // ── Fee: member submits low income request ───────────────────────────
    if (action === 'submit-low-income') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const enabled = settingIsTrue(await getSetting(sheets, spreadsheetId, LOW_INCOME_ENABLED_KEY, 'true'));
      if (!enabled) return res.status(403).json({ error: 'Low income applications are no longer available' });
      const text = (payload.justification || '').toString().trim();
      if (!text) return res.status(400).json({ error: 'Justification required' });
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let headers = (r.data.values || [[]])[0] || [];
      headers = await ensureFeeColumns(sheets, spreadsheetId, headers);
      await writeCell(sheets, spreadsheetId, headers, auth.row, 'low_income_request', text);
      await writeCell(sheets, spreadsheetId, headers, auth.row, 'low_income_status', 'pending');
      await tgSend('📝 A low income ticket request has been submitted. An admin will review it shortly.');
      return res.status(200).json({ success: true });
    }

    // ── Fee: member withdraws low income request ─────────────────────────
    if (action === 'withdraw-low-income') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let headers = (r.data.values || [[]])[0] || [];
      headers = await ensureFeeColumns(sheets, spreadsheetId, headers);
      await writeCell(sheets, spreadsheetId, headers, auth.row, 'low_income_request', '');
      await writeCell(sheets, spreadsheetId, headers, auth.row, 'low_income_status', '');
      await tgSend('🗑 A low income ticket request has been withdrawn.');
      return res.status(200).json({ success: true });
    }

    // ── Dietary: any authenticated member saves their own info ──────────
    if (action === 'save-dietary') {
      const foodType = (payload.foodType || '').toString().trim();
      const dietaryNotes = (payload.dietaryNotes || '').toString().trim();
      if (ALLOWED_FOOD_TYPES.indexOf(foodType) === -1) {
        return res.status(400).json({ error: 'Invalid food type' });
      }
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let hdrs = (r.data.values || [[]])[0] || [];
      hdrs = await ensureDietaryColumns(sheets, spreadsheetId, hdrs);
      await writeCell(sheets, spreadsheetId, hdrs, auth.row, 'FoodType', foodType);
      await writeCell(sheets, spreadsheetId, hdrs, auth.row, 'DietaryNotes', dietaryNotes);
      // Clear the prompt timestamp once filled (keeps "incomplete" check in sync)
      await writeCell(sheets, spreadsheetId, hdrs, auth.row, 'LastDietaryPromptedAt', '');
      return res.status(200).json({ success: true });
    }

    // ── Write actions require admin ──────────────────────────────────────
    if (!auth.admin) {
      return res.status(401).json({ error: 'Admin required' });
    }

    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];

    // ── Fee: admin marks received ────────────────────────────────────────
    if (action === 'mark-fee-received') {
      const { row, received } = payload;
      if (!row) return res.status(400).json({ error: 'Row required' });
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let hdrs = (r.data.values || [[]])[0] || [];
      hdrs = await ensureFeeColumns(sheets, spreadsheetId, hdrs);
      const newVal = received ? 'TRUE' : 'FALSE';
      await writeCell(sheets, spreadsheetId, hdrs, row, 'fee_received', newVal);
      if (received) {
        // Look up name for notification
        const rowRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!' + row + ':' + row });
        const rowData = (rowRes.data.values || [[]])[0] || [];
        const m = {};
        hdrs.forEach((h, j) => { m[h] = rowData[j] || ''; });
        await tgSend('✅ *' + displayName(m) + "*'s barrio fee received. Thanks!");
      }
      return res.status(200).json({ success: true });
    }

    // ── Fee: admin updates total sent amount ─────────────────────────────
    if (action === 'admin-update-fee-sent') {
      const { row } = payload;
      const amount = parseFloat(payload.amount);
      if (!row) return res.status(400).json({ error: 'Row required' });
      if (!isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Invalid amount' });
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let hdrs = (r.data.values || [[]])[0] || [];
      hdrs = await ensureFeeColumns(sheets, spreadsheetId, hdrs);
      const cur = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!' + row + ':' + row });
      const curRow = (cur.data.values || [[]])[0] || [];
      const sentCol = hdrs.indexOf('fee_total_sent');
      const recvCol = hdrs.indexOf('fee_received');
      const oldAmount = parseFloat(curRow[sentCol]) || 0;
      await writeCell(sheets, spreadsheetId, hdrs, row, 'fee_total_sent', amount);
      const wasReceived = ((curRow[recvCol] || '').toString().toUpperCase() === 'TRUE');
      if (wasReceived && oldAmount !== amount) {
        await writeCell(sheets, spreadsheetId, hdrs, row, 'fee_received', 'FALSE');
      }
      return res.status(200).json({ success: true });
    }

    // ── Fee: admin toggles low income availability ───────────────────────
    if (action === 'set-low-income-enabled') {
      const enabled = !!payload.enabled;
      await setSetting(sheets, spreadsheetId, LOW_INCOME_ENABLED_KEY, enabled ? 'true' : 'false');
      return res.status(200).json({ success: true, low_income_enabled: enabled });
    }

    // ── Fee: admin reviews low income request ────────────────────────────
    if (action === 'review-low-income') {
      const { row, decision } = payload;
      if (!row || !['approved', 'declined'].includes(decision)) {
        return res.status(400).json({ error: 'Row and valid decision required' });
      }
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let hdrs = (r.data.values || [[]])[0] || [];
      hdrs = await ensureFeeColumns(sheets, spreadsheetId, hdrs);
      await writeCell(sheets, spreadsheetId, hdrs, row, 'low_income_status', decision);
      return res.status(200).json({ success: true });
    }

    // ── Update member fields ──────────────────────────────────────────────
    if (action === 'update') {
      const { row, updates } = payload;
      if (!row || !updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Row and updates are required' });
      }
      // Block Admin column changes from non-admins (already checked above, but explicit)
      if ('Admin' in updates && !auth.admin) {
        return res.status(403).json({ error: 'Only admins can change admin status' });
      }

      // Detect a Status transition into portal access (modal "Save All" / bulk edit).
      let statusTransition = null;
      if ('Status' in updates) {
        const sCol = headers.indexOf('Status');
        const rowRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!' + row + ':' + row });
        const rowData = (rowRes.data.values || [[]])[0] || [];
        const oldStatus = sCol === -1 ? '' : (rowData[sCol] || '');
        if (shouldInvite(oldStatus, updates['Status'])) {
          // Patch rowData with the incoming edits so email/names reflect this save.
          for (const k in updates) { const ci = headers.indexOf(k); if (ci !== -1) rowData[ci] = updates[k]; }
          statusTransition = { rowData, newStatus: updates['Status'] };
        }
      }

      var data = [];
      for (var key in updates) {
        var col = headers.indexOf(key);
        if (col === -1) continue;
        data.push({ range: 'Sheet1!' + colToLetter(col) + row, values: [[updates[key]]] });
      }
      if (data.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: data },
      });

      let invited = false;
      if (statusTransition) {
        await inviteOnTransition({ sheets, hdrs: headers, ...statusTransition });
        invited = true;
      }
      return res.status(200).json({ success: true, invited });
    }

    // ── Refund + demote-to-Observer (single atomic admin op) ─────────────
    if (action === 'refund-and-demote') {
      const { row } = payload;
      if (!row) return res.status(400).json({ error: 'Row required' });

      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let hdrs = (r.data.values || [[]])[0] || [];
      hdrs = await ensureFeeColumns(sheets, spreadsheetId, hdrs);

      // Capture current row for the Telegram message and the refunded amount
      const rowRes = await sheets.spreadsheets.values.get({
        spreadsheetId, range: 'Sheet1!' + row + ':' + row,
      });
      const rowData = (rowRes.data.values || [[]])[0] || [];
      const sentCol = hdrs.indexOf('fee_total_sent');
      const statusCol = hdrs.indexOf('Status');
      const refundedAmount = parseFloat(rowData[sentCol]) || 0;
      const oldStatus = (statusCol !== -1 && rowData[statusCol]) || 'Unknown';
      const m = {};
      hdrs.forEach((h, j) => { m[h] = rowData[j] || ''; });
      const memberName = displayName(m);

      // Batch the five writes
      const liReqCol = hdrs.indexOf('low_income_request');
      const liStatusCol = hdrs.indexOf('low_income_status');
      const recvCol = hdrs.indexOf('fee_received');
      const data = [
        { range: 'Sheet1!' + colToLetter(sentCol) + row, values: [[0]] },
        { range: 'Sheet1!' + colToLetter(recvCol) + row, values: [['FALSE']] },
        { range: 'Sheet1!' + colToLetter(liReqCol) + row, values: [['']] },
        { range: 'Sheet1!' + colToLetter(liStatusCol) + row, values: [['']] },
        { range: 'Sheet1!' + colToLetter(statusCol) + row, values: [['Observer']] },
      ].filter(d => d.range.match(/[A-Z]+[0-9]+$/)); // drop any if column index is -1

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });

      await tgSend('💸 *' + memberName + '* refunded €' + refundedAmount + ' and demoted from ' + oldStatus + ' → Observer.');

      return res.status(200).json({ success: true, refunded: refundedAmount });
    }

    // ── Update status ─────────────────────────────────────────────────────
    if (action === 'update-status') {
      const { row, status } = payload;
      if (!row || !status) {
        return res.status(400).json({ error: 'Row and status are required' });
      }
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status', allowed: ALLOWED_STATUSES });
      }
      const col = headers.indexOf('Status');
      if (col === -1) {
        return res.status(500).json({ error: 'Status column not found' });
      }

      // Read current row BEFORE the write to detect a transition into access.
      const rowRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!' + row + ':' + row });
      const rowData = (rowRes.data.values || [[]])[0] || [];
      const oldStatus = rowData[col] || '';

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!' + colToLetter(col) + row,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] },
      });

      let invited = false;
      if (shouldInvite(oldStatus, status)) {
        await inviteOnTransition({ sheets, hdrs: headers, rowData, newStatus: status });
        invited = true;
      }
      return res.status(200).json({ success: true, invited });
    }

    // ── Reconciliation: invite every Approved/Observer member with no account ──
    // Catches the one path the live hooks can't: hand-edits to the Sheet's
    // Status column. Telegram pings are SUPPRESSED here — backfilling weeks-late
    // approvals must not spam the group. (Admin-gated above at "Write actions".)
    if (action === 'sync-invites') {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
      const rows = r.data.values || [];
      const hdrs = rows[0] || [];
      const statusCol = hdrs.indexOf('Status');
      const emailCol = hdrs.indexOf('Email');
      const nameCol = hdrs.indexOf('Name');
      const playaCol = hdrs.indexOf('Playa Name');

      const roster = [];
      for (let i = 1; i < rows.length; i++) {
        const memberStatus = (rows[i][statusCol] || '').trim();
        if (!PORTAL_STATUSES.has(memberStatus.toLowerCase())) continue;
        roster.push({
          email: (rows[i][emailCol] || '').trim(),
          status: memberStatus,
          member: { Name: rows[i][nameCol] || '', 'Playa Name': rows[i][playaCol] || '' },
        });
      }

      const supabase = getSupabaseAdmin();
      const existing = await listUserEmails(supabase);
      const missing = diffMissingInvites(roster, existing);

      const invited = [], failed = [];
      for (const m of missing) {
        try {
          await sendMemberInvite({ supabase, sheets, email: m.email, status: m.status, member: m.member });
          invited.push({ name: m.member['Playa Name'] || m.member.Name || m.email, email: m.email });
        } catch (e) {
          failed.push({ email: m.email, error: e.message });
        }
      }
      return res.status(200).json({
        success: true,
        rosterCount: roster.length,
        alreadyHadAccount: roster.length - missing.length,
        invited, failed,
      });
    }

    // ── Delete member by email ─────────────────────────────────────────────
    if (action === 'delete') {
      const { email: targetEmail } = payload;
      if (!targetEmail) return res.status(400).json({ error: 'Email is required' });
      const allRows = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
      const rows = allRows.data.values || [];
      if (rows.length < 2) return res.status(404).json({ error: 'Member not found' });
      const emailCol = rows[0].indexOf('Email');
      if (emailCol === -1) return res.status(500).json({ error: 'Email column not found' });
      const rowIdx = rows.findIndex((r, i) => i > 0 && (r[emailCol] || '').toLowerCase().trim() === targetEmail.toLowerCase().trim());
      if (rowIdx === -1) return res.status(404).json({ error: 'Member not found' });
      const sheetId = await getSheetId(sheets, spreadsheetId, 'Sheet1');
      if (sheetId === null) return res.status(500).json({ error: 'Sheet not found' });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
        }
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Members API error:', e);
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.message });
  }
}
