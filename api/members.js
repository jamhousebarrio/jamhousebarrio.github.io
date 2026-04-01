import { colToLetter, getSheetId } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

export default async function handler(req, res) {
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
      const members = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
      return res.status(200).json({ members, admin: auth.admin });
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

    // ── Delete member row ──────────────────────────────────────────────────
    if (action === 'delete') {
      const { row } = payload;
      if (!row) return res.status(400).json({ error: 'Row is required' });
      const sheetId = await getSheetId(sheets, spreadsheetId, 'Sheet1');
      if (sheetId === null) return res.status(500).json({ error: 'Sheet not found' });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }]
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
