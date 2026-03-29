import { getSheets, toObjects, getRows, deleteRowById, upsertRow } from './_lib/sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, ...payload } = req.body || {};

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const spreadsheetId = process.env.SHEET_ID;
  const TAB = 'Roles';
  const HEADERS = ['Name', 'Description', 'AssignedTo', 'Status', 'Notes'];

  try {
    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = getSheets(false);
      const rows = await getRows(sheets, spreadsheetId, TAB);
      return res.status(200).json({ roles: toObjects(rows) });
    }

    // ── Write actions require write password ──────────────────────────────
    if (!isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const sheets = getSheets(true);

    switch (action) {
      case 'upsert': {
        const { name, description, assignedTo, status, notes } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });
        await upsertRow(sheets, spreadsheetId, TAB, 'Name', name, HEADERS,
          [name, description || '', assignedTo || '', status || '', notes || '']);
        break;
      }
      case 'delete': {
        const { name } = payload;
        if (!name) return res.status(400).json({ error: 'name required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, TAB, 'Name', name);
        if (!deleted) return res.status(404).json({ error: 'Role not found' });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Roles API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
