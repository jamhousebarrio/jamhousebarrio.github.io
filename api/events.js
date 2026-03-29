import { getSheets, toObjects, getRows, deleteRowById, upsertRow } from './_lib/sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, ...payload } = req.body || {};

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const spreadsheetId = process.env.SHEET_ID;
  const TAB = 'Events';
  const HEADERS = ['Name', 'Date', 'Time', 'EndTime', 'Description', 'Responsible', 'Status', 'Notes'];

  try {
    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = getSheets(false);
      const rows = await getRows(sheets, spreadsheetId, TAB);
      return res.status(200).json({ events: toObjects(rows) });
    }

    // ── Write actions require write password ──────────────────────────────
    if (!isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const sheets = getSheets(true);

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
    console.error('Events API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
