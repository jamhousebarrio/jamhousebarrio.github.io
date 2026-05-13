import { getSheets, toObjects, getRows, deleteRowById, upsertRow, ensureTab } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

const TAB = 'ToDo';
const HEADERS = ['Id', 'Task', 'Week', 'Responsible', 'Done', 'Category'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};
    const { sheets, spreadsheetId } = auth;

    if (!action) {
      const rows = await getRows(sheets, spreadsheetId, TAB);
      return res.status(200).json({ tasks: toObjects(rows) });
    }

    switch (action) {
      case 'add':
      case 'update': {
        const { id, task, week, responsible, done, category } = payload;
        if (!id || !task) return res.status(400).json({ error: 'id and task required' });
        await upsertRow(sheets, spreadsheetId, TAB, 'Id', id, HEADERS,
          [id, task, week || '', responsible || '', done === true || done === 'true' ? 'true' : 'false', category || 'General']);
        break;
      }
      case 'delete': {
        const { id } = payload;
        if (!id) return res.status(400).json({ error: 'id required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, TAB, 'Id', id);
        if (!deleted) return res.status(404).json({ error: 'Task not found' });
        break;
      }
      case 'seed': {
        const { tasks } = payload;
        if (!Array.isArray(tasks) || !tasks.length) return res.status(400).json({ error: 'tasks array required' });
        const existing = await getRows(sheets, spreadsheetId, TAB);
        if (existing.length > 1) return res.status(200).json({ skipped: true });
        await ensureTab(sheets, spreadsheetId, TAB);
        const rows = tasks.map(t => [t.id, t.task, t.week, '', 'false']);
        if (existing.length === 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId, range: TAB + '!A1', valueInputOption: 'RAW',
            requestBody: { values: [HEADERS, ...rows] },
          });
        } else {
          await sheets.spreadsheets.values.append({
            spreadsheetId, range: TAB, valueInputOption: 'RAW',
            requestBody: { values: rows },
          });
        }
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('ToDo API error:', e);
    return res.status(500).json({ error: e.message || 'Failed', detail: e.stack });
  }
}
