import { getSheets, safeGet, toObjects, deleteRowById, upsertRow } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};

    const spreadsheetId = auth.spreadsheetId;
    const HEADERS = ['ItemID', 'Name', 'Category', 'Description', 'PhotoURL', 'Quantity', 'Location', 'Notes'];

    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = auth.sheets;
      const rows = await safeGet(sheets, spreadsheetId, 'Inventory');
      return res.status(200).json({ items: toObjects(rows) });
    }

    // ── Write actions require admin ───────────────────────────────────────
    if (!auth.admin) {
      return res.status(401).json({ error: 'Admin required' });
    }

    const sheets = auth.sheets;

    switch (action) {
      case 'upsert': {
        const { itemId, name, category, description, photoUrl, quantity, location, notes } = payload;
        if (!itemId || !name) return res.status(400).json({ error: 'itemId and name required' });
        await upsertRow(sheets, spreadsheetId, 'Inventory', 'ItemID', itemId, HEADERS,
          [itemId, name, category || '', description || '', photoUrl || '', quantity || '', location || '', notes || '']);
        break;
      }
      case 'delete': {
        const { itemId } = payload;
        if (!itemId) return res.status(400).json({ error: 'itemId required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, 'Inventory', 'ItemID', itemId);
        if (!deleted) return res.status(404).json({ error: 'Item not found' });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Inventory API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
