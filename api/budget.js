import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

function colToLetter(col) {
  var letter = '';
  var c = col;
  while (c >= 0) {
    letter = String.fromCharCode(65 + (c % 26)) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { password, action, ...payload } = req.body || {};

  const isWrite = password === process.env.ADMIN_WRITE_PASSWORD;
  const isRead = isWrite || password === process.env.ADMIN_PASSWORD;
  if (!isRead) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const writeActions = ['add', 'update', 'delete', 'approve-request', 'reject-request', 'shopping-request'];
    const needsWrite = writeActions.includes(action);
    const auth = new GoogleAuth({
      credentials,
      scopes: [needsWrite
        ? 'https://www.googleapis.com/auth/spreadsheets'
        : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = sheetsApi({ version: 'v4', auth });
    const spreadsheetId = process.env.BUDGET_SHEET_ID;

    // ── Fetch budget totals (default) ─────────────────────────────────────
    if (!action || action === 'fetch') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Total',
      });
      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(200).json([]);
      }
      const headers = rows[0];
      const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
      return res.status(200).json(data);
    }

    // ── Fetch budget items, fees, shopping requests ───────────────────────
    if (action === 'fetch-items') {
      const budgetRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Budget',
      });
      const budgetRows = budgetRes.data.values || [];
      const headers = budgetRows[0] || [];
      const items = budgetRows.slice(1).map((row, i) => {
        const obj = { _row: i + 2 };
        headers.forEach((h, j) => { obj[h] = row[j] || ''; });
        return obj;
      }).filter(item => item.Item || item.Category);

      const feeRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Barrio Fee'",
      });
      const feeRows = feeRes.data.values || [];
      const feeHeaders = feeRows[0] || [];
      let totalExpected = 0, totalPaid = 0;
      const feeMembers = [];
      feeRows.slice(1).forEach((r, i) => {
        const expected = parseFloat(r[2]) || 0;
        const paid = parseFloat(r[3]) || 0;
        totalExpected += expected;
        totalPaid += paid;
        const obj = { _row: i + 2 };
        feeHeaders.forEach((h, j) => { obj[h] = r[j] || ''; });
        obj._expected = expected;
        obj._paid = paid;
        feeMembers.push(obj);
      });

      let shoppingRequests = [];
      try {
        const srRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'ShoppingRequests',
        });
        const srRows = srRes.data.values || [];
        if (srRows.length > 1) {
          const srHeaders = srRows[0];
          shoppingRequests = srRows.slice(1).map(row => {
            const obj = {};
            srHeaders.forEach((h, j) => { obj[h] = row[j] || ''; });
            return obj;
          });
        }
      } catch (e) {
        // Tab missing or unreadable
      }

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      return res.status(200).json({
        items,
        headers,
        fees: { expected: totalExpected, paid: totalPaid, members: feeMembers, feeHeaders: feeHeaders },
        sheetUrl,
        shoppingRequests,
      });
    }

    // ── Shopping request (read or write auth) ─────────────────────────────
    if (action === 'shopping-request') {
      const { requestId, item, description, link, price, submittedBy } = payload;
      if (!requestId || !item || !submittedBy) {
        return res.status(400).json({ error: 'requestId, item, submittedBy required' });
      }
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'ShoppingRequests',
        valueInputOption: 'RAW',
        requestBody: { values: [[requestId, item, description || '', link || '', price || '', submittedBy, 'pending']] },
      });
      return res.status(200).json({ success: true });
    }

    // ── Write actions below require write password ────────────────────────
    if (!isWrite) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Read headers for add/update/delete
    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Budget!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];
    if (headers.length === 0) {
      return res.status(500).json({ error: "Budget sheet has no headers" });
    }

    if (action === 'add') {
      const { data } = payload;
      if (!data || !data.Category || !data.Item) {
        return res.status(400).json({ error: 'Category and Item are required' });
      }
      const newRow = headers.map(h => {
        if (h === 'Total Actual') return '';
        return data[h] || '';
      });
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Budget!A:A',
        valueInputOption: 'RAW',
        requestBody: { values: [newRow] },
      });
      const updatedRange = appendRes.data.updates.updatedRange;
      const addedRow = parseInt(updatedRange.match(/\d+$/)[0]);
      const totalCol = headers.indexOf('Total Actual');
      if (totalCol !== -1) {
        const qtyCol = colToLetter(headers.indexOf('Qty'));
        const priceCol = colToLetter(headers.indexOf('Price'));
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Budget!' + colToLetter(totalCol) + addedRow,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['=' + qtyCol + addedRow + '*' + priceCol + addedRow]] },
        });
      }
      const paidCol = headers.indexOf('Paid');
      if (paidCol !== -1) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Budget!' + colToLetter(paidCol) + addedRow,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[false]] },
        });
      }
      return res.status(200).json({ success: true, row: addedRow });
    }

    if (action === 'update') {
      const { row, data } = payload;
      if (!row || !data) {
        return res.status(400).json({ error: 'Row and data are required' });
      }
      var updates = [];
      for (var key in data) {
        var col = headers.indexOf(key);
        if (col === -1) continue;
        if (key === 'Total Actual') continue;
        var colLetter = colToLetter(col);
        var val = data[key];
        if (key === 'Paid') {
          val = val === true || val === 'true' || val === 'TRUE';
        }
        updates.push({ range: 'Budget!' + colLetter + row, values: [[val]] });
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      const { row } = payload;
      if (!row) {
        return res.status(400).json({ error: 'Row is required' });
      }
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const budgetSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'Budget');
      const sheetId = budgetSheet.properties.sheetId;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row }
            }
          }]
        }
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'approve-request' || action === 'reject-request') {
      const { requestId } = payload;
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      const reqRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShoppingRequests' });
      const reqRows = reqRes.data.values || [];
      if (!reqRows.length) return res.status(404).json({ error: 'Not found' });
      const reqHeaders = reqRows[0];
      const idCol = reqHeaders.indexOf('RequestID');
      const statusCol = reqHeaders.indexOf('Status');
      const rowIdx = reqRows.findIndex((r, i) => i > 0 && r[idCol] === requestId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Request not found' });
      const cl = String.fromCharCode(65 + statusCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `ShoppingRequests!${cl}${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[action === 'approve-request' ? 'approved' : 'rejected']] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'update-fee') {
      const { row, amount, paidInFull } = payload;
      if (!row) return res.status(400).json({ error: 'row required' });
      // Update Paid (col D) and Paid in full (col E) in Barrio Fee tab
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "'Barrio Fee'!D" + row + ":E" + row,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[amount != null ? amount : '', paidInFull ? 'TRUE' : 'FALSE']] },
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('Budget API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
