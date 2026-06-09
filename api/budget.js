import { getSheets, colToLetter, ensureTab, getSheetId } from './_lib/sheets.js';
import { verifyToken, getMemberByEmail, isAdmin as checkAdmin } from './_lib/auth.js';
import { logError } from './_lib/error-log.js';

const HISTORY_TAB = 'BudgetHistory';
const HISTORY_HEADERS = ['Date', 'Category', 'Total', 'Spent', 'LineItems', 'EventBudget', 'FeesReceived', 'Headroom'];

async function computeSnapshot(sheets) {
  const budgetSheetId = process.env.BUDGET_SHEET_ID;
  const membersSheetId = process.env.SHEET_ID;
  const budgetRes = await sheets.spreadsheets.values.get({ spreadsheetId: budgetSheetId, range: 'Budget' });
  const rows = budgetRes.data.values || [];
  const headers = rows[0] || [];
  const catCol = headers.indexOf('Category');
  const qtyCol = headers.indexOf('Qty');
  const priceCol = headers.indexOf('Price');
  const paidCol = headers.indexOf('Paid');
  const totals = {}, spent = {}, lineCounts = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cat = (row[catCol] || '').trim();
    if (!cat) continue;
    const t = (parseFloat(row[qtyCol]) || 0) * (parseFloat(row[priceCol]) || 0);
    totals[cat] = (totals[cat] || 0) + t;
    lineCounts[cat] = (lineCounts[cat] || 0) + 1;
    if (((row[paidCol] || '') + '').toUpperCase() === 'TRUE') {
      spent[cat] = (spent[cat] || 0) + t;
    }
  }
  const feeRes = await sheets.spreadsheets.values.get({ spreadsheetId: budgetSheetId, range: "'Barrio Fee'" }).catch(() => ({ data: { values: [] } }));
  const feeRows = feeRes.data.values || [];
  let eventBudget = 0;
  feeRows.slice(1).forEach(r => { eventBudget += parseFloat(r[2]) || 0; });
  let feesReceived = 0;
  try {
    const memRes = await sheets.spreadsheets.values.get({ spreadsheetId: membersSheetId, range: 'Sheet1' });
    const memRows = memRes.data.values || [];
    if (memRows.length > 1) {
      const mh = memRows[0];
      const recvCol = mh.indexOf('fee_received');
      const sentCol = mh.indexOf('fee_total_sent');
      if (recvCol !== -1 && sentCol !== -1) {
        for (let i = 1; i < memRows.length; i++) {
          if (((memRows[i][recvCol] || '') + '').toUpperCase() !== 'TRUE') continue;
          feesReceived += parseFloat(memRows[i][sentCol]) || 0;
        }
      }
    }
  } catch (e) { /* missing tab → 0 */ }
  const totalBudgeted = Object.values(totals).reduce((a, b) => a + b, 0);
  const headroom = eventBudget - totalBudgeted;
  return { totals, spent, lineCounts, eventBudget, feesReceived, headroom };
}

async function writeSnapshot(sheets, snap) {
  const spreadsheetId = process.env.BUDGET_SHEET_ID;
  const today = new Date().toISOString().slice(0, 10);
  await ensureTab(sheets, spreadsheetId, HISTORY_TAB);
  const histRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: HISTORY_TAB }).catch(() => ({ data: { values: [] } }));
  let histRows = histRes.data.values || [];
  if (!histRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: HISTORY_TAB + '!A1', valueInputOption: 'RAW',
      requestBody: { values: [HISTORY_HEADERS] }
    });
    histRows = [HISTORY_HEADERS];
  }
  const todayRowIdxs = [];
  for (let i = 1; i < histRows.length; i++) {
    if ((histRows[i][0] || '') === today) todayRowIdxs.push(i);
  }
  if (todayRowIdxs.length) {
    const sheetId = await getSheetId(sheets, spreadsheetId, HISTORY_TAB);
    if (sheetId !== null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: todayRowIdxs.slice().reverse().map(idx => ({
            deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } }
          }))
        }
      });
    }
  }
  const cats = Object.keys(snap.totals);
  if (!cats.length) return { written: 0, date: today };
  const newRows = cats.map(c => [
    today, c, snap.totals[c] || 0, snap.spent[c] || 0, snap.lineCounts[c] || 0,
    snap.eventBudget, snap.feesReceived, snap.headroom
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: HISTORY_TAB + '!A:A', valueInputOption: 'RAW',
    requestBody: { values: newRows }
  });
  return { written: newRows.length, date: today };
}

export default async function handler(req, res) {
  // ── Cron: nightly budget snapshot ─────────────────────────────────────
  if (req.method === 'GET' && (req.query || {}).cron === 'snapshot') {
    const expected = 'Bearer ' + (process.env.CRON_SECRET || '');
    const got = req.headers.authorization || req.headers.Authorization || '';
    if (!process.env.CRON_SECRET || got !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const sheets = getSheets(true);
      const snap = await computeSnapshot(sheets);
      const result = await writeSnapshot(sheets, snap);
      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      console.error('Snapshot cron error:', e);
      await logError(req, e, { action: 'snapshot-cron', status: 500 });
      return res.status(500).json({ error: e.message || 'Snapshot failed' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = verifyToken(req);
    const memberSheets = getSheets(true);
    const memberResult = await getMemberByEmail(memberSheets, process.env.SHEET_ID, user.email);
    if (!memberResult) {
      return res.status(403).json({ error: 'Member not found or not approved' });
    }
    const isWrite = checkAdmin(memberResult.member);

    const { action, ...payload } = req.body || {};
    const sheets = getSheets(true);
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

      // Per-member fee contributions are admin-only
      const feesPayload = isWrite
        ? { expected: totalExpected, paid: totalPaid, members: feeMembers, feeHeaders: feeHeaders }
        : { expected: totalExpected, paid: 0, members: [], feeHeaders: [] };

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
        fees: feesPayload,
        sheetUrl,
        shoppingRequests,
      });
    }

    // ── Fetch BudgetHistory snapshots (read-only) ────────────────────────
    if (action === 'fetch-history') {
      let histRows = [];
      try {
        const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: HISTORY_TAB });
        histRows = r.data.values || [];
      } catch (e) { /* tab missing → empty */ }
      if (!histRows.length) {
        return res.status(200).json({ snapshots: [] });
      }
      const histHeaders = histRows[0];
      const snapshots = histRows.slice(1).map(row => {
        const o = {};
        histHeaders.forEach((h, i) => { o[h] = row[i] || ''; });
        return o;
      });
      return res.status(200).json({ snapshots });
    }

    // ── Shopping request (open to approved members; not observers) ───────
    if (action === 'shopping-request') {
      if ((memberResult.member.Status || '').toLowerCase() === 'observer') {
        return res.status(403).json({ error: 'Observer accounts are read-only' });
      }
      const { requestId, category, item, description, link, price, submittedBy } = payload;
      if (!requestId || !category || !item || !submittedBy) {
        return res.status(400).json({ error: 'requestId, category, item, submittedBy required' });
      }
      const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShoppingRequests!1:1' });
      let srHeaders = (headerRes.data.values || [[]])[0] || [];
      if (!srHeaders.length) {
        srHeaders = ['RequestID','Item','Description','Link','Price','SubmittedBy','Status','Category'];
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'ShoppingRequests!1:1',
          valueInputOption: 'RAW',
          requestBody: { values: [srHeaders] },
        });
      } else if (srHeaders.indexOf('Category') === -1) {
        const newHeaders = srHeaders.concat(['Category']);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'ShoppingRequests!1:1',
          valueInputOption: 'RAW',
          requestBody: { values: [newHeaders] },
        });
        srHeaders = newHeaders;
      }
      const fieldVals = {
        RequestID: requestId, Item: item, Description: description || '', Link: link || '',
        Price: price || '', SubmittedBy: submittedBy, Status: 'pending', Category: category,
      };
      const row = srHeaders.map(h => fieldVals[h] !== undefined ? fieldVals[h] : '');
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'ShoppingRequests',
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
      });
      return res.status(200).json({ success: true });
    }

    // ── Write actions below require admin ─────────────────────────────────
    if (!isWrite) {
      return res.status(401).json({ error: 'Admin required' });
    }

    // Manual snapshot trigger (admin) — same effect as the nightly cron.
    if (action === 'snapshot') {
      const snap = await computeSnapshot(sheets);
      const result = await writeSnapshot(sheets, snap);
      return res.status(200).json({ ok: true, ...result });
    }

    // Read headers for add/update/delete
    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Budget!1:1',
    });
    let headers = (headersRes.data.values || [[]])[0] || [];
    if (headers.length === 0) {
      return res.status(500).json({ error: "Budget sheet has no headers" });
    }
    // Ensure audit columns exist; add them at the end of the header row if missing.
    const auditCols = ['UpdatedAt', 'UpdatedBy'].filter(h => headers.indexOf(h) === -1);
    if (auditCols.length) {
      const startCol = headers.length;
      headers = headers.concat(auditCols);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Budget!' + colToLetter(startCol) + '1',
        valueInputOption: 'RAW',
        requestBody: { values: [auditCols] },
      });
    }
    const updatedBy = ((memberResult.member['Playa Name'] || memberResult.member.Name) || '').trim();
    const updatedAt = new Date().toISOString();
    const stampAudit = async (row) => {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: 'Budget!' + colToLetter(headers.indexOf('UpdatedAt')) + row, values: [[updatedAt]] },
            { range: 'Budget!' + colToLetter(headers.indexOf('UpdatedBy')) + row, values: [[updatedBy]] },
          ],
        },
      });
    };

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
      // Write Paid as a real boolean so the grid's checkbox renderer reads it
      // correctly. Honor the submitted value (the row append wrote it as text).
      const paidCol = headers.indexOf('Paid');
      if (paidCol !== -1) {
        const paidVal = data.Paid === true || data.Paid === 'true' || data.Paid === 'TRUE';
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Budget!' + colToLetter(paidCol) + addedRow,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[paidVal]] },
        });
      }
      await stampAudit(addedRow);
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
        var cl = colToLetter(col);
        var val = data[key];
        if (key === 'Paid') {
          val = val === true || val === 'true' || val === 'TRUE';
        }
        updates.push({ range: 'Budget!' + cl + row, values: [[val]] });
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
      });
      await stampAudit(row);
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

    if (action === 'update-request') {
      const { requestId, updates } = payload;
      if (!requestId || !updates) return res.status(400).json({ error: 'requestId and updates required' });
      const reqRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShoppingRequests' });
      const reqRows = reqRes.data.values || [];
      if (!reqRows.length) return res.status(404).json({ error: 'Not found' });
      let reqHeaders = reqRows[0];
      const idCol = reqHeaders.indexOf('RequestID');
      const rowIdx = reqRows.findIndex((r, i) => i > 0 && r[idCol] === requestId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Request not found' });
      const fieldMap = {
        category: 'Category',
        item: 'Item',
        description: 'Description',
        link: 'Link',
        price: 'Price',
        submittedBy: 'SubmittedBy',
        status: 'Status',
      };
      const neededHeaders = [];
      for (const key in updates) {
        const header = fieldMap[key];
        if (header && reqHeaders.indexOf(header) === -1 && neededHeaders.indexOf(header) === -1) {
          neededHeaders.push(header);
        }
      }
      if (neededHeaders.length) {
        const newHeaders = reqHeaders.concat(neededHeaders);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'ShoppingRequests!1:1',
          valueInputOption: 'RAW',
          requestBody: { values: [newHeaders] },
        });
        reqHeaders = newHeaders;
      }
      const data = [];
      for (const key in updates) {
        const header = fieldMap[key];
        if (!header) continue;
        const col = reqHeaders.indexOf(header);
        if (col === -1) continue;
        const cl = String.fromCharCode(65 + col);
        data.push({ range: `ShoppingRequests!${cl}${rowIdx + 1}`, values: [[updates[key] || '']] });
      }
      if (!data.length) return res.status(400).json({ error: 'No valid fields to update' });
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete-request') {
      const { requestId } = payload;
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      const reqRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShoppingRequests' });
      const reqRows = reqRes.data.values || [];
      if (!reqRows.length) return res.status(404).json({ error: 'Not found' });
      const idCol = reqRows[0].indexOf('RequestID');
      const rowIdx = reqRows.findIndex((r, i) => i > 0 && r[idCol] === requestId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Request not found' });
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const srSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'ShoppingRequests');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId: srSheet.properties.sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 }
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
      const currentStatus = (reqRows[rowIdx][statusCol] || '').toLowerCase().trim();
      if (currentStatus !== 'pending' && currentStatus !== '') {
        return res.status(409).json({ error: `Request is already ${currentStatus}`, currentStatus });
      }
      const cl = String.fromCharCode(65 + statusCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `ShoppingRequests!${cl}${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[action === 'approve-request' ? 'approved' : 'rejected']] },
      });

      let createdBudgetRow = null;
      if (action === 'approve-request') {
        const reqRow = reqRows[rowIdx];
        const get = (h) => { const c = reqHeaders.indexOf(h); return c === -1 ? '' : (reqRow[c] || ''); };
        const category = get('Category');
        const itemName = get('Item');
        const reqPrice = get('Price');
        const reqLink = get('Link');
        const reqDesc = get('Description');
        const reqSubmitter = get('SubmittedBy');
        if (category && itemName) {
          const commentParts = [];
          if (reqDesc) commentParts.push(reqDesc);
          if (reqSubmitter) commentParts.push('Requested by ' + reqSubmitter);
          const comment = commentParts.join(' — ');
          const newBudgetRow = headers.map(h => {
            if (h === 'Category') return category;
            if (h === 'Item') return itemName;
            if (h === 'Qty') return 1;
            if (h === 'Price') return reqPrice || 0;
            if (h === 'Link') return reqLink || '';
            if (h === 'Comment') return comment;
            if (h === 'Total Actual') return '';
            return '';
          });
          const appendRes = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Budget!A:A',
            valueInputOption: 'RAW',
            requestBody: { values: [newBudgetRow] },
          });
          const updatedRange = appendRes.data.updates.updatedRange;
          const addedRow = parseInt(updatedRange.match(/\d+$/)[0]);
          createdBudgetRow = addedRow;
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
          await stampAudit(addedRow);
        }
      }
      return res.status(200).json({ success: true, budgetRow: createdBudgetRow });
    }

    if (action === 'update-fee') {
      const { row, amount, paidInFull, name, expectedFee } = payload;

      if (row) {
        // Update existing row: Paid (col D) and Paid in full (col E)
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "'Barrio Fee'!D" + row + ":E" + row,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[amount != null ? amount : '', paidInFull ? 'TRUE' : 'FALSE']] },
        });
        return res.status(200).json({ success: true, row: row });
      }

      // No row — create new entry for this member
      if (!name) return res.status(400).json({ error: 'name required for new fee entry' });

      // Read existing to find next number
      const feeRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Barrio Fee'" });
      const feeRows = feeRes.data.values || [];
      const nextNum = feeRows.length; // row count = next number (header is row 1)

      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "'Barrio Fee'",
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[nextNum, name, expectedFee || 250, amount != null ? amount : '', paidInFull ? 'TRUE' : 'FALSE']] },
      });

      // Extract the row number that was added
      const updatedRange = appendRes.data.updates.updatedRange;
      const newRow = parseInt(updatedRange.match(/\d+$/)[0]);
      return res.status(200).json({ success: true, row: newRow });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Budget API error:', e);
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.stack });
  }
}
