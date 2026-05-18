import { getSheets, safeGet, toObjects, ensureTab, getRows, upsertRow, deleteRowById } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';
import { logError } from './_lib/error-log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};

    const spreadsheetId = auth.spreadsheetId;
    const sheets = auth.sheets;
    const tab = 'Timeline';

    // Fetch all entries
    if (!action) {
      const [rows, logRows] = await Promise.all([
        safeGet(sheets, spreadsheetId, tab),
        safeGet(sheets, spreadsheetId, 'MemberLogistics'),
      ]);
      return res.status(200).json({ entries: toObjects(rows), logistics: toObjects(logRows) });
    }

    if (!auth.admin) return res.status(401).json({ error: 'Admin required' });

    if (action === 'upsert') {
      const { person, date, period, task } = payload;
      if (!person || !date || !period) return res.status(400).json({ error: 'person, date, period required' });

      const rows = await safeGet(sheets, spreadsheetId, tab);
      if (!rows.length) {
        await ensureTab(sheets, spreadsheetId, tab);
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: tab + '!A1', valueInputOption: 'RAW',
          requestBody: { values: [['Person', 'Date', 'Period', 'Task'], [person, date, period, task || '']] },
        });
        return res.status(200).json({ success: true });
      }

      const headers = rows[0];
      const personCol = headers.indexOf('Person');
      const dateCol = headers.indexOf('Date');
      const periodCol = headers.indexOf('Period');
      const taskCol = headers.indexOf('Task');

      // Find existing row matching person+date+period
      const existingIdx = rows.findIndex((r, i) =>
        i > 0 && (r[personCol] || '') === person && (r[dateCol] || '') === date && (r[periodCol] || '') === period
      );

      if (existingIdx === -1) {
        if (!task) return res.status(200).json({ success: true }); // don't add empty
        await sheets.spreadsheets.values.append({
          spreadsheetId, range: tab, valueInputOption: 'RAW',
          requestBody: { values: [[person, date, period, task]] },
        });
      } else {
        if (!task) {
          // Delete row if task cleared
          const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
          const sheet = meta.data.sheets.find(s => s.properties.title === tab);
          if (sheet) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: existingIdx, endIndex: existingIdx + 1 } } }]
              },
            });
          }
        } else {
          // Update task column
          var colLetter = String.fromCharCode(65 + taskCol);
          await sheets.spreadsheets.values.update({
            spreadsheetId, range: tab + '!' + colLetter + (existingIdx + 1),
            valueInputOption: 'RAW',
            requestBody: { values: [[task]] },
          });
        }
      }
      return res.status(200).json({ success: true });
    }

    // ── To-Do actions ────────────────────────────────────────────────────────
    const TODO_TAB = 'ToDo';
    const TODO_HEADERS = ['Id', 'Task', 'Week', 'Responsible', 'Done', 'Category'];

    if (action === 'todo-fetch') {
      const rows = await getRows(sheets, spreadsheetId, TODO_TAB);
      return res.status(200).json({ tasks: toObjects(rows) });
    }

    if (action === 'todo-add' || action === 'todo-update') {
      const { id, task, week, responsible, done, category } = payload;
      if (!id || !task) return res.status(400).json({ error: 'id and task required' });
      await upsertRow(sheets, spreadsheetId, TODO_TAB, 'Id', id, TODO_HEADERS,
        [id, task, week || '', responsible || '', done === true || done === 'true' ? 'true' : 'false', category || 'General']);
      return res.status(200).json({ success: true });
    }

    if (action === 'todo-delete') {
      const { id } = payload;
      if (!id) return res.status(400).json({ error: 'id required' });
      const deleted = await deleteRowById(sheets, spreadsheetId, TODO_TAB, 'Id', id);
      if (!deleted) return res.status(404).json({ error: 'Task not found' });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Timeline API error:', e.message);
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: 'Failed', detail: e.message });
  }
}
