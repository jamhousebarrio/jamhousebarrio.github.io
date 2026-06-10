import { getSheets, safeGet, toObjects, upsertRow, deleteRowById, ensureTab, getSheetId } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';
import { logError } from './_lib/error-log.js';

const RIDES_TAB = 'Rideshare';
const RIDES_HEADERS = ['RideID', 'DriverName', 'OriginTo', 'DestFrom', 'SeatsTotal', 'ClaimedTo', 'ClaimedFrom', 'Notes', 'CreatedAt'];

function parseClaimed(s) {
  return (s || '').split(',').map(x => x.trim()).filter(Boolean);
}
function joinClaimed(arr) { return arr.join(', '); }
function displayName(member) {
  return ((member && (member['Playa Name'] || member.Name)) || '').trim();
}
async function fetchRides(sheets, id) {
  const rows = await safeGet(sheets, id, RIDES_TAB);
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => { o[h] = r[j] || ''; });
    o.claimedTo = parseClaimed(o.ClaimedTo);
    o.claimedFrom = parseClaimed(o.ClaimedFrom);
    o.SeatsTotal = parseInt(o.SeatsTotal, 10) || 0;
    return o;
  }).filter(r => r.RideID);
}
async function findRideRow(sheets, id, rideId) {
  const rows = await safeGet(sheets, id, RIDES_TAB);
  if (!rows.length) return null;
  const headers = rows[0];
  const idCol = headers.indexOf('RideID');
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][idCol] || '') === rideId) {
      return { rowIndex: i + 1, headers, row: rows[i] };
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await authenticateRequest(req);
    const { action, memberName, arrivalDate, arrivalTime, transport, needsPickup, departureDate, campingType, tentSize, notes, noOrgDates } = req.body || {};

    const id = auth.spreadsheetId;
    const sheets = auth.sheets;

    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const [logiRows, eeRows] = await Promise.all([
        safeGet(sheets, id, 'MemberLogistics'),
        safeGet(sheets, id, 'EarlyEntry'),
      ]);
      // Lightweight EE source map (MemberName + Source only) so the logistics
      // Gantt can colour bars by early-entry type for ALL viewers. Notes/audit
      // stay admin-only via the `early-entry-fetch` action.
      const earlyEntrySources = toObjects(eeRows).map(r => ({ MemberName: r.MemberName, Source: r.Source }));
      return res.status(200).json({ logistics: toObjects(logiRows), earlyEntrySources });
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

      // Match this member's existing row even if it was saved under their OTHER
      // name (legal vs playa). Without this, a member who later adds/changes a
      // playa name and saves again appends a SECOND row (orphan) instead of
      // updating — the bug that produced the David Burgess/Engineer Dave dupes.
      // The found row's MemberName is rewritten to the current `memberName`.
      const variants = new Set([target.toLowerCase()]);
      if (target === myName || target === myPlaya) {
        if (myName) variants.add(myName.toLowerCase());
        if (myPlaya) variants.add(myPlaya.toLowerCase());
      } else if (auth.admin) {
        // Admin editing someone else: look up that member's alternate name.
        const mrows = await safeGet(sheets, id, 'Sheet1');
        const tnorm = target.toLowerCase();
        for (const m of toObjects(mrows)) {
          const ml = (m.Name || '').trim().toLowerCase();
          const mp = (m['Playa Name'] || '').trim().toLowerCase();
          if (ml === tnorm || mp === tnorm) { if (ml) variants.add(ml); if (mp) variants.add(mp); break; }
        }
      }

      const nameCol = existingHeaders.indexOf('MemberName');
      let foundRowIndex = -1;
      for (let i = 1; i < existing.length; i++) {
        if (variants.has((existing[i][nameCol] || '').trim().toLowerCase())) {
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

    // ── Rideshare: list all rides (any approved member) ──────────────────
    if (action === 'rides-list') {
      const rides = await fetchRides(sheets, id);
      return res.status(200).json({ rides });
    }

    // ── Rideshare: create a new ride offer ────────────────────────────────
    if (action === 'ride-create') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const { originTo, destFrom, seatsTotal, notes: rideNotes } = req.body || {};
      const seats = parseInt(seatsTotal, 10) || 0;
      if (!seats || seats < 1 || seats > 50) return res.status(400).json({ error: 'seatsTotal must be 1–50' });
      const driver = displayName(auth.member);
      if (!driver) return res.status(400).json({ error: 'Driver name unavailable' });
      await ensureTab(sheets, id, RIDES_TAB);
      const existing = await safeGet(sheets, id, RIDES_TAB);
      let liveHeaders;
      if (!existing.length) {
        liveHeaders = RIDES_HEADERS.slice();
        await sheets.spreadsheets.values.update({
          spreadsheetId: id, range: `${RIDES_TAB}!A1`, valueInputOption: 'RAW',
          requestBody: { values: [liveHeaders] }
        });
      } else {
        liveHeaders = existing[0].slice();
        // Add any new columns that aren't on the sheet yet
        const missing = RIDES_HEADERS.filter(h => liveHeaders.indexOf(h) === -1);
        if (missing.length) {
          const startCol = liveHeaders.length;
          liveHeaders = liveHeaders.concat(missing);
          let colLetter = '';
          let c = startCol;
          while (c >= 0) { colLetter = String.fromCharCode(65 + (c % 26)) + colLetter; c = Math.floor(c / 26) - 1; }
          await sheets.spreadsheets.values.update({
            spreadsheetId: id, range: `${RIDES_TAB}!${colLetter}1`,
            valueInputOption: 'RAW', requestBody: { values: [missing] }
          });
        }
      }
      const rideId = 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const createdAt = new Date().toISOString();
      const fieldMap = {
        RideID: rideId,
        DriverName: driver,
        OriginTo: (originTo || '').trim(),
        DestFrom: (destFrom || '').trim(),
        SeatsTotal: seats,
        ClaimedTo: '',
        ClaimedFrom: '',
        Notes: (rideNotes || '').trim(),
        CreatedAt: createdAt,
      };
      // Build the row in the order of the live sheet headers; unknown columns get ''
      const newRow = liveHeaders.map(h => fieldMap[h] !== undefined ? fieldMap[h] : '');
      await sheets.spreadsheets.values.append({
        spreadsheetId: id, range: `${RIDES_TAB}!A1`, valueInputOption: 'RAW',
        requestBody: { values: [newRow] }
      });
      return res.status(200).json({ ok: true, rideId });
    }

    // ── Rideshare: update fields (driver or admin) ────────────────────────
    if (action === 'ride-update') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const { rideId, originTo, destFrom, seatsTotal, notes: rideNotes } = req.body || {};
      if (!rideId) return res.status(400).json({ error: 'rideId required' });
      const found = await findRideRow(sheets, id, rideId);
      if (!found) return res.status(404).json({ error: 'Ride not found' });
      const driver = displayName(auth.member);
      const currentDriver = (found.row[found.headers.indexOf('DriverName')] || '').trim();
      if (driver !== currentDriver && !auth.admin) return res.status(403).json({ error: 'Only the driver or an admin can edit a ride' });
      const seats = parseInt(seatsTotal, 10);
      if (seatsTotal !== undefined && (isNaN(seats) || seats < 1 || seats > 50)) return res.status(400).json({ error: 'seatsTotal must be 1–50' });
      const claimedToCol = found.headers.indexOf('ClaimedTo');
      const claimedFromCol = found.headers.indexOf('ClaimedFrom');
      const claimedToLen = claimedToCol === -1 ? 0 : parseClaimed(found.row[claimedToCol]).length;
      const claimedFromLen = claimedFromCol === -1 ? 0 : parseClaimed(found.row[claimedFromCol]).length;
      const maxClaim = Math.max(claimedToLen, claimedFromLen);
      if (!isNaN(seats) && seats < maxClaim) return res.status(400).json({ error: `Cannot shrink to ${seats} seats — ${maxClaim} already claimed` });
      // Add any missing headers so old rows can be updated with the new columns.
      let liveHeaders = found.headers.slice();
      const missingHeaders = RIDES_HEADERS.filter(h => liveHeaders.indexOf(h) === -1);
      if (missingHeaders.length) {
        const startCol = liveHeaders.length;
        liveHeaders = liveHeaders.concat(missingHeaders);
        let colLetter = '';
        let c = startCol;
        while (c >= 0) { colLetter = String.fromCharCode(65 + (c % 26)) + colLetter; c = Math.floor(c / 26) - 1; }
        await sheets.spreadsheets.values.update({
          spreadsheetId: id, range: `${RIDES_TAB}!${colLetter}1`,
          valueInputOption: 'RAW', requestBody: { values: [missingHeaders] }
        });
      }
      const updates = [];
      const setField = (name, value) => {
        const col = liveHeaders.indexOf(name);
        if (col === -1) return;
        const cl = String.fromCharCode(65 + col);
        updates.push({ range: `${RIDES_TAB}!${cl}${found.rowIndex}`, values: [[value]] });
      };
      if (originTo !== undefined) setField('OriginTo', (originTo || '').trim());
      if (destFrom !== undefined) setField('DestFrom', (destFrom || '').trim());
      if (!isNaN(seats)) setField('SeatsTotal', seats);
      if (rideNotes !== undefined) setField('Notes', (rideNotes || '').trim());
      if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: updates }
      });
      return res.status(200).json({ ok: true });
    }

    // ── Rideshare: delete (driver or admin) ───────────────────────────────
    if (action === 'ride-delete') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const { rideId } = req.body || {};
      if (!rideId) return res.status(400).json({ error: 'rideId required' });
      const found = await findRideRow(sheets, id, rideId);
      if (!found) return res.status(404).json({ error: 'Ride not found' });
      const driver = displayName(auth.member);
      const currentDriver = (found.row[found.headers.indexOf('DriverName')] || '').trim();
      if (driver !== currentDriver && !auth.admin) return res.status(403).json({ error: 'Only the driver or an admin can delete a ride' });
      const sheetId = await getSheetId(sheets, id, RIDES_TAB);
      if (sheetId === null) return res.status(404).json({ error: 'Rideshare tab not found' });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: [{
          deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: found.rowIndex - 1, endIndex: found.rowIndex } }
        }] }
      });
      return res.status(200).json({ ok: true });
    }

    // ── Rideshare: claim a seat on a given leg ────────────────────────────
    if (action === 'ride-claim') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const { rideId, direction } = req.body || {};
      if (!rideId) return res.status(400).json({ error: 'rideId required' });
      if (direction !== 'to' && direction !== 'from') return res.status(400).json({ error: 'direction must be "to" or "from"' });
      const found = await findRideRow(sheets, id, rideId);
      if (!found) return res.status(404).json({ error: 'Ride not found' });
      const me = displayName(auth.member);
      if (!me) return res.status(400).json({ error: 'Your name is not set' });
      const colName = direction === 'to' ? 'ClaimedTo' : 'ClaimedFrom';
      const seatsCol = found.headers.indexOf('SeatsTotal');
      const claimedCol = found.headers.indexOf(colName);
      if (claimedCol === -1) return res.status(500).json({ error: `${colName} column missing — driver needs to re-save the ride first` });
      const seats = parseInt(found.row[seatsCol], 10) || 0;
      const claimed = parseClaimed(found.row[claimedCol]);
      if (claimed.indexOf(me) !== -1) return res.status(409).json({ error: 'You already have a seat on this leg' });
      if (claimed.length >= seats) return res.status(409).json({ error: 'No seats left on this leg' });
      claimed.push(me);
      const cl = String.fromCharCode(65 + claimedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId: id, range: `${RIDES_TAB}!${cl}${found.rowIndex}`,
        valueInputOption: 'RAW', requestBody: { values: [[joinClaimed(claimed)]] }
      });
      return res.status(200).json({ ok: true, seatsLeft: seats - claimed.length });
    }

    // ── Rideshare: release a seat on a given leg (driver or seat-holder) ──
    if (action === 'ride-release') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      const { rideId, name, direction } = req.body || {};
      if (!rideId) return res.status(400).json({ error: 'rideId required' });
      if (direction !== 'to' && direction !== 'from') return res.status(400).json({ error: 'direction must be "to" or "from"' });
      const found = await findRideRow(sheets, id, rideId);
      if (!found) return res.status(404).json({ error: 'Ride not found' });
      const me = displayName(auth.member);
      const target = ((name || '').trim()) || me;
      const rideDriver = (found.row[found.headers.indexOf('DriverName')] || '').trim();
      const iAmDriver = me === rideDriver;
      if (target !== me && !iAmDriver) return res.status(403).json({ error: 'Only the driver or the seat-holder can release a seat' });
      const colName = direction === 'to' ? 'ClaimedTo' : 'ClaimedFrom';
      const claimedCol = found.headers.indexOf(colName);
      if (claimedCol === -1) return res.status(500).json({ error: `${colName} column missing` });
      const claimed = parseClaimed(found.row[claimedCol]);
      const next = claimed.filter(n => n !== target);
      if (next.length === claimed.length) return res.status(404).json({ error: 'Name not in claimed list for this leg' });
      const cl = String.fromCharCode(65 + claimedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId: id, range: `${RIDES_TAB}!${cl}${found.rowIndex}`,
        valueInputOption: 'RAW', requestBody: { values: [[joinClaimed(next)]] }
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Logistics API error:', e);
    await logError(req, e, { status: 500 });
    return res.status(500).json({ error: e.message || 'Failed', detail: e.message });
  }
}
