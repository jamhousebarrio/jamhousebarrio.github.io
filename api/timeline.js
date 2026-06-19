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
      const { person, date, period, task, team } = payload;
      if (!person || !date || !period) return res.status(400).json({ error: 'person, date, period required' });

      // We only touch fields the caller actually included so partial updates
      // (team only / task only) don't clobber the other column.
      const taskProvided = Object.prototype.hasOwnProperty.call(payload, 'task');
      const teamProvided = Object.prototype.hasOwnProperty.call(payload, 'team');
      const taskVal = (task || '').toString();
      const teamVal = (team || '').toString();

      let rows = await safeGet(sheets, spreadsheetId, tab);
      if (!rows.length) {
        await ensureTab(sheets, spreadsheetId, tab);
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: tab + '!A1', valueInputOption: 'RAW',
          requestBody: { values: [['Person', 'Date', 'Period', 'Task', 'Team'], [person, date, period, taskVal, teamVal]] },
        });
        return res.status(200).json({ success: true });
      }

      let headers = rows[0];
      // Migrate: append Team column if missing.
      if (headers.indexOf('Team') === -1) {
        const newCol = headers.length;
        const newLetter = String.fromCharCode(65 + newCol);
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: tab + '!' + newLetter + '1',
          valueInputOption: 'RAW',
          requestBody: { values: [['Team']] },
        });
        rows = await safeGet(sheets, spreadsheetId, tab);
        headers = rows[0];
      }

      const personCol = headers.indexOf('Person');
      const dateCol = headers.indexOf('Date');
      const periodCol = headers.indexOf('Period');
      const taskCol = headers.indexOf('Task');
      const teamCol = headers.indexOf('Team');

      const existingIdx = rows.findIndex((r, i) =>
        i > 0 && (r[personCol] || '') === person && (r[dateCol] || '') === date && (r[periodCol] || '') === period
      );

      // Compute final cell values after this upsert.
      const existingRow = existingIdx === -1 ? [] : rows[existingIdx];
      const finalTask = taskProvided ? taskVal : (existingRow[taskCol] || '');
      const finalTeam = teamProvided ? teamVal : (existingRow[teamCol] || '');

      if (existingIdx === -1) {
        if (!finalTask && !finalTeam) return res.status(200).json({ success: true });
        const newRow = new Array(headers.length).fill('');
        newRow[personCol] = person;
        newRow[dateCol] = date;
        newRow[periodCol] = period;
        newRow[taskCol] = finalTask;
        newRow[teamCol] = finalTeam;
        await sheets.spreadsheets.values.append({
          spreadsheetId, range: tab, valueInputOption: 'RAW',
          requestBody: { values: [newRow] },
        });
      } else if (!finalTask && !finalTeam) {
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
        const updates = [];
        if (taskProvided) {
          updates.push({ range: tab + '!' + String.fromCharCode(65 + taskCol) + (existingIdx + 1), values: [[finalTask]] });
        }
        if (teamProvided) {
          updates.push({ range: tab + '!' + String.fromCharCode(65 + teamCol) + (existingIdx + 1), values: [[finalTeam]] });
        }
        if (updates.length) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: 'RAW', data: updates },
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
