import { safeGet, toObjects, ensureTab, deleteRowById, upsertRow } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

const PHOTO_TAB = 'BuildPhotos';
const PHOTO_HEADERS = ['Id', 'Url', 'Labels', 'UploadedBy', 'UploadedAt'];
const LEGACY_PHOTO_COUNT = 26;
const PHOTO_BUCKET = 'build-photos';
const LEGACY_PHOTO_PREFIX =
  `${process.env.SUPABASE_URL || ''}/storage/v1/object/public/${PHOTO_BUCKET}/build-`;

async function ensurePhotosSeeded(sheets, spreadsheetId) {
  const rows = await safeGet(sheets, spreadsheetId, PHOTO_TAB);
  if (rows.length > 0) return;
  await ensureTab(sheets, spreadsheetId, PHOTO_TAB);
  const legacy = [];
  for (let i = 1; i <= LEGACY_PHOTO_COUNT; i++) {
    legacy.push([`legacy-${i}`, `${LEGACY_PHOTO_PREFIX}${i}.jpg`, '', 'legacy', '2025-07-01']);
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${PHOTO_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [PHOTO_HEADERS, ...legacy] },
  });
}

async function deleteStorageObject(path) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key || !path) return false;
  const res = await fetch(`${base}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};

    const spreadsheetId = auth.spreadsheetId;
    const sheets = auth.sheets;
    const HEADERS = ['ItemID', 'Name', 'Category', 'Description', 'PhotoURL', 'Quantity', 'Location', 'Notes'];

    // ── Build Photos (any authenticated member) ───────────────────────────
    if (action === 'photo-list') {
      await ensurePhotosSeeded(sheets, spreadsheetId);
      const rows = await safeGet(sheets, spreadsheetId, PHOTO_TAB);
      const photos = toObjects(rows).map(p => ({
        id: p.Id,
        url: p.Url,
        labels: (p.Labels || '').split(',').map(s => s.trim()).filter(Boolean),
        uploadedBy: p.UploadedBy,
        uploadedAt: p.UploadedAt,
      }));
      return res.status(200).json({ photos });
    }

    if (action === 'photo-add') {
      const { url, labels } = payload;
      if (!url) return res.status(400).json({ error: 'url required' });
      await ensurePhotosSeeded(sheets, spreadsheetId);
      const labelsStr = Array.isArray(labels) ? labels.join(',') : (labels || '');
      const newId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: PHOTO_TAB,
        valueInputOption: 'RAW',
        requestBody: { values: [[newId, url, labelsStr, auth.email, now]] },
      });
      return res.status(200).json({ ok: true, id: newId });
    }

    if (action === 'photo-update-labels') {
      const { id, labels } = payload;
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await safeGet(sheets, spreadsheetId, PHOTO_TAB);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const headers = rows[0];
      const idCol = headers.indexOf('Id');
      const labelsCol = headers.indexOf('Labels');
      const byCol = headers.indexOf('UploadedBy');
      if (idCol === -1 || labelsCol === -1) return res.status(500).json({ error: 'Sheet missing columns' });
      const rowIdx = rows.findIndex((r, i) => i > 0 && (r[idCol] || '') === id);
      if (rowIdx === -1) return res.status(404).json({ error: 'Not found' });
      const uploader = (rows[rowIdx][byCol] || '').toLowerCase();
      if (!auth.admin && uploader !== auth.email.toLowerCase() && uploader !== 'legacy') {
        return res.status(403).json({ error: 'Only the uploader or an admin can edit' });
      }
      const labelsStr = Array.isArray(labels) ? labels.join(',') : (labels || '');
      const colLetter = String.fromCharCode(65 + labelsCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${PHOTO_TAB}!${colLetter}${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[labelsStr]] },
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'photo-delete') {
      const { id } = payload;
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await safeGet(sheets, spreadsheetId, PHOTO_TAB);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const headers = rows[0];
      const idCol = headers.indexOf('Id');
      const urlCol = headers.indexOf('Url');
      const byCol = headers.indexOf('UploadedBy');
      const row = rows.slice(1).find(r => (r[idCol] || '') === id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      const uploader = (row[byCol] || '').toLowerCase();
      if (!auth.admin && uploader !== auth.email.toLowerCase() && uploader !== 'legacy') {
        return res.status(403).json({ error: 'Only the uploader or an admin can delete' });
      }
      const photoUrl = row[urlCol] || '';
      const marker = `/${PHOTO_BUCKET}/`;
      const mIdx = photoUrl.indexOf(marker);
      if (mIdx !== -1) {
        const objectPath = photoUrl.slice(mIdx + marker.length);
        if (objectPath) await deleteStorageObject(objectPath);
      }
      await deleteRowById(sheets, spreadsheetId, PHOTO_TAB, 'Id', id);
      return res.status(200).json({ ok: true });
    }

    // ── Inventory fetch (default) ─────────────────────────────────────────
    if (!action) {
      const rows = await safeGet(sheets, spreadsheetId, 'Inventory');
      return res.status(200).json({ items: toObjects(rows) });
    }

    // ── Inventory write actions require admin ─────────────────────────────
    if (!auth.admin) {
      return res.status(401).json({ error: 'Admin required' });
    }

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
