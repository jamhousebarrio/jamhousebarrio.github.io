import { getSheets, toObjects, getRows, deleteRowById, upsertRow } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};

    const spreadsheetId = auth.spreadsheetId;
    const TAB = 'Events';
    const HEADERS = ['Name', 'Date', 'Time', 'EndTime', 'Description', 'Responsible', 'Status', 'Notes'];

    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = auth.sheets;
      const rows = await getRows(sheets, spreadsheetId, TAB);
      return res.status(200).json({ events: toObjects(rows) });
    }

    // ── Write actions require admin ───────────────────────────────────────
    if (!auth.admin) {
      return res.status(401).json({ error: 'Admin required' });
    }

    const sheets = auth.sheets;

    switch (action) {
      case 'upsert': {
        const { name, date, time, endTime, description, responsible, status, notes } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });
        await upsertRow(sheets, spreadsheetId, TAB, 'Name', name, HEADERS,
          [name, date || '', time || '', endTime || '', description || '', responsible || '', status || '', notes || '']);
        break;
      }
      case 'delete': {
        const { name } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, TAB, 'Name', name);
        if (!deleted) return res.status(404).json({ error: 'Event not found' });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Events API error:', e);
    return res.status(500).json({ error: e.message || 'Failed', detail: e.stack });
  }
}
