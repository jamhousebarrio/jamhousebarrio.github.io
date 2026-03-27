import { google } from 'googleapis';

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
  const { password, action, row, data } = req.body || {};
  if (!password || password !== process.env.ADMIN_WRITE_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.BUDGET_SHEET_ID;

    // Read headers
    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Budget!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];
    if (headers.length === 0) {
      return res.status(500).json({ error: "Budget sheet has no headers" });
    }

    if (action === 'add') {
      // Add new row
      if (!data || !data.Category || !data.Item) {
        return res.status(400).json({ error: 'Category and Item are required' });
      }
      const newRow = headers.map(h => {
        if (h === 'Total Actual') return ''; // formula will be set separately
        return data[h] || '';
      });
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Budget!A:A',
        valueInputOption: 'RAW',
        requestBody: { values: [newRow] },
      });
      // Get the row number that was added
      const updatedRange = appendRes.data.updates.updatedRange;
      const addedRow = parseInt(updatedRange.match(/\d+$/)[0]);
      // Set formula for Total Actual column
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
      // Set Paid checkbox to FALSE
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
        // Paid column: use USER_ENTERED for booleans
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
      if (!row) {
        return res.status(400).json({ error: 'Row is required' });
      }
      // Get sheet ID
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
      const { requestId } = req.body;
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      const reqRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShoppingRequests' });
      const reqRows = reqRes.data.values || [];
      if (!reqRows.length) return res.status(404).json({ error: 'Not found' });
      const reqHeaders = reqRows[0];
      const idCol = reqHeaders.indexOf('RequestID');
      const statusCol = reqHeaders.indexOf('Status');
      const rowIdx = reqRows.findIndex((r, i) => i > 0 && r[idCol] === requestId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Request not found' });
      const colLetter = String.fromCharCode(65 + statusCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `ShoppingRequests!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[action === 'approve-request' ? 'approved' : 'rejected']] },
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action. Use "add", "update", or "delete".' });
  } catch (err) {
    console.error('Update budget error:', err);
    return res.status(500).json({ error: 'Failed to update budget' });
  }
}
