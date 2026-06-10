import { getSheets, toObjects, getRows, deleteRowById, upsertRow } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';
import { logError } from './_lib/error-log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};

    const spreadsheetId = auth.spreadsheetId;
    const TAB = 'Events';
    const HEADERS = ['Name', 'Date', 'Time', 'EndTime', 'Description', 'Responsible', 'Status', 'Notes', 'Id'];

    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = auth.sheets;
      const rows = await getRows(sheets, spreadsheetId, TAB);
      return res.status(200).json({ events: toObjects(rows) });
    }

    // Observers (read-only members) cannot write.
    if (auth.observer) {
      return res.status(403).json({ error: 'Observers cannot modify events' });
    }

    const sheets = auth.sheets;

    switch (action) {
      case 'upsert': {
        const { id, name, date, time, endTime, description, responsible, status, notes } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });
        if (!id) return res.status(400).json({ error: 'id required' });
        // Events are keyed on Id, so the same name can be reused across days
        // (e.g. a recurring workshop). The client generates the Id on create
        // and sends back the same Id on edit.
        await upsertRow(sheets, spreadsheetId, TAB, 'Id', id, HEADERS,
          [name, date || '', time || '', endTime || '', description || '', responsible || '', status || '', notes || '', id]);
        break;
      }
      case 'delete': {
        if (!auth.admin) return res.status(403).json({ error: 'Admin required to delete events' });
        const { id } = payload;
        if (!id) return res.status(400).json({ error: 'id required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, TAB, 'Id', id);
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
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.message });
  }
}
