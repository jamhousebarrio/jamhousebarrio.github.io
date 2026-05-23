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
    const HEADERS = ['Name', 'Date', 'Time', 'EndTime', 'Description', 'Responsible', 'Status', 'Notes'];

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
        const { name, originalName, date, time, endTime, description, responsible, status, notes } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });

        // Honor originalName on edits: look up by the OLD name, then write the new
        // row (including the renamed Name column). Without this, renaming an event
        // to a name that already exists silently overwrites that other row.
        const lookupName = originalName || name;
        const isEdit = !!originalName;

        if (!isEdit) {
          // Create: reject if an event with this name already exists.
          const rows = await getRows(sheets, spreadsheetId, TAB);
          if (rows.length > 1) {
            const nameCol = rows[0].indexOf('Name');
            const collision = rows.slice(1).some(r => (r[nameCol] || '') === name);
            if (collision) return res.status(409).json({ error: 'An event with this name already exists' });
          }
        } else if (name !== originalName) {
          // Rename: reject if the new name already belongs to a different event.
          const rows = await getRows(sheets, spreadsheetId, TAB);
          if (rows.length > 1) {
            const nameCol = rows[0].indexOf('Name');
            const collision = rows.slice(1).some(r => (r[nameCol] || '') === name);
            if (collision) return res.status(409).json({ error: 'Another event already uses this name' });
          }
        }

        await upsertRow(sheets, spreadsheetId, TAB, 'Name', lookupName, HEADERS,
          [name, date || '', time || '', endTime || '', description || '', responsible || '', status || '', notes || '']);
        break;
      }
      case 'delete': {
        if (!auth.admin) return res.status(403).json({ error: 'Admin required to delete events' });
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
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.stack });
  }
}
