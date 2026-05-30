import { getSheets, safeGet, toObjects, upsertRow, deleteRowById } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';
import { logError } from './_lib/error-log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, memberName, arrivalDate, arrivalTime, transport, needsPickup, departureDate, campingType, tentSize, notes, noOrgDates } = req.body || {};

    const id = auth.spreadsheetId;
    const sheets = auth.sheets;

    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const rows = await safeGet(sheets, id, 'MemberLogistics');
      return res.status(200).json({ logistics: toObjects(rows) });
    }

    // ── Early Entry: read assignments ─────────────────────────────────────
    if (action === 'early-entry-fetch') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const rows = await safeGet(sheets, id, 'EarlyEntry');
      return res.status(200).json({ earlyEntry: toObjects(rows) });
    }

    // ── Early Entry: assign / clear a member's pass ───────────────────────
    if (action === 'set-early-entry') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const eeName = (memberName || '').trim();
      const source = (req.body.source || '').trim();
      const eeNotes = (req.body.notes || '').trim();
      if (!eeName) return res.status(400).json({ error: 'memberName required' });
      if (['', 'barrio', 'noorg', 'artist'].indexOf(source) === -1) {
        return res.status(400).json({ error: 'invalid source' });
      }
      // A row with neither a pass nor notes carries no information — remove it.
      // Notes alone (no source yet) are kept, so context can be jotted before a
      // pass type is picked.
      if (source === '' && eeNotes === '') {
        await deleteRowById(sheets, id, 'EarlyEntry', 'MemberName', eeName);
        return res.status(200).json({ ok: true, cleared: true });
      }
      const EE_HEADERS = ['MemberName', 'Source', 'Notes', 'UpdatedAt', 'UpdatedBy'];
      const updatedBy = ((auth.member && (auth.member['Playa Name'] || auth.member.Name)) || '').trim();
      const updatedAt = new Date().toISOString();
      await upsertRow(sheets, id, 'EarlyEntry', 'MemberName', eeName, EE_HEADERS,
        [eeName, source, eeNotes, updatedAt, updatedBy]);
      return res.status(200).json({ ok: true });
    }

    // ── Upsert ────────────────────────────────────────────────────────────
    if (action === 'upsert') {
      if (!memberName) return res.status(400).json({ error: 'memberName required' });
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });

      const myName = ((auth.member && auth.member.Name) || '').trim();
      const myPlaya = ((auth.member && auth.member['Playa Name']) || '').trim();
      const target = memberName.trim();
      if (target !== myName && target !== myPlaya && !auth.admin) {
        return res.status(403).json({ error: 'Only admins can edit other members' });
      }

      const tabName = 'MemberLogistics';
      const allHeaders = ['MemberName', 'ArrivalDate', 'ArrivalTime', 'Transport', 'NeedsPickup', 'DepartureDate', 'CampingType', 'TentSize', 'Notes', 'NoOrgDates'];
      const fieldMap = {
        MemberName: memberName,
        ArrivalDate: arrivalDate || '',
        ArrivalTime: arrivalTime || '',
        Transport: transport || '',
        NeedsPickup: needsPickup || '',
        DepartureDate: departureDate || '',
        CampingType: campingType || '',
        TentSize: tentSize || '',
        Notes: notes || '',
        NoOrgDates: noOrgDates || '',
      };

      const existing = await safeGet(sheets, id, tabName);

      if (!existing.length) {
        // Tab empty or missing — create with full headers
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: id,
            requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
          });
        } catch (e) { /* tab exists */ }
        const newRow = allHeaders.map(h => fieldMap[h] || '');
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [allHeaders, newRow] },
        });
        return res.status(200).json({ ok: true });
      }

      let existingHeaders = existing[0];

      // Add any missing headers to the sheet
      const missingHeaders = allHeaders.filter(h => existingHeaders.indexOf(h) === -1);
      if (missingHeaders.length) {
        const startCol = existingHeaders.length;
        existingHeaders = existingHeaders.concat(missingHeaders);
        // Write new headers
        let colLetter = '';
        let c = startCol;
        while (c >= 0) { colLetter = String.fromCharCode(65 + (c % 26)) + colLetter; c = Math.floor(c / 26) - 1; }
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!${colLetter}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [missingHeaders] },
        });
      }

      // Build row matching existing header order
      const newRow = existingHeaders.map(h => fieldMap[h] !== undefined ? fieldMap[h] : '');

      const nameCol = existingHeaders.indexOf('MemberName');
      let foundRowIndex = -1;
      for (let i = 1; i < existing.length; i++) {
        if ((existing[i][nameCol] || '') === memberName) {
          foundRowIndex = i + 1;
          break;
        }
      }

      if (foundRowIndex > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `${tabName}!A${foundRowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values: [newRow] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId: id,
          range: `${tabName}!A1`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [newRow] },
        });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Logistics API error:', e);
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.stack });
  }
}
