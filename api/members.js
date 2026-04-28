import { colToLetter, getSheetId } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

const ALLOWED_STATUSES = ['Pending', 'Review', 'Vibe Check', 'Team Discussion', 'On-boarding', 'Approved', 'Rejected'];
const BARRIO_FEE = 280;
const LOW_INCOME_FEE = 180;
const FEE_COLUMNS = ['fee_total_sent', 'fee_received', 'low_income_request', 'low_income_status'];

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
      return res.status(200).json({ members, admin: auth.admin });
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
            fee_total_sent: parseFloat(row[sentCol]) || 0,
            fee_received: ((row[recvCol] || '').toString().toUpperCase() === 'TRUE'),
            low_income_request: row[liReq] || '',
            low_income_status: row[liStatus] || '',
          });
        }
      }
      return res.status(200).json({ expected: BARRIO_FEE, low_income_fee: LOW_INCOME_FEE, me: myFee, roster, admin: auth.admin });
    }

    // ── Fee: member saves total sent ─────────────────────────────────────
    if (action === 'save-fee-sent') {
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
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
      let headers = (r.data.values || [[]])[0] || [];
      headers = await ensureFeeColumns(sheets, spreadsheetId, headers);
      await writeCell(sheets, spreadsheetId, headers, auth.row, 'low_income_request', '');
      await writeCell(sheets, spreadsheetId, headers, auth.row, 'low_income_status', '');
      await tgSend('🗑 A low income ticket request has been withdrawn.');
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
      return res.status(200).json({ success: true });
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

      // Get member name for notification
      const rowRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!' + row + ':' + row,
      });
      const rowData = (rowRes.data.values || [[]])[0];
      const nameCol = headers.indexOf('Playa Name');
      const realNameCol = headers.indexOf('Name');
      const memberName = (nameCol !== -1 && rowData[nameCol]) || (realNameCol !== -1 && rowData[realNameCol]) || 'Unknown';
      const oldStatus = (col !== -1 && rowData[col]) || 'Unknown';

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!' + colToLetter(col) + row,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] },
      });

      // Telegram notification
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        try {
          const tgBody = {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: status.toLowerCase() === 'approved'
              ? '🎉 Welcome to the barrio! ' + memberName + ' has been approved — say hi!'
              : '📋 Application update: ' + memberName + ' moved from ' + oldStatus + ' → ' + status,
          };
          if (process.env.TELEGRAM_TOPIC_ID) tgBody.message_thread_id = parseInt(process.env.TELEGRAM_TOPIC_ID);
          await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tgBody),
          });
        } catch (tgErr) {
          console.error('Telegram send failed:', tgErr);
        }
      }

      return res.status(200).json({ success: true });
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
    return res.status(500).json({ error: 'Failed' });
  }
}
