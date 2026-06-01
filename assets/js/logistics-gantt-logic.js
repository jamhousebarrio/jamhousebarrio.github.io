// Pure date helpers for the logistics Arrivals & Departures Gantt. No browser or
// node globals — imported by the page (admin-logistics.js, as a module) and by
// Node tests (test/logistics-gantt-logic.test.js via `node --test`).
//
// Dates are stored yyyy-mm-dd (Flatpickr Y-m-d); dd/mm/yyyy is accepted
// defensively for any legacy/hand-entered values. All work is done on
// yyyy-mm-dd strings (which sort lexically = chronologically).

function pad(n) { return n < 10 ? '0' + n : '' + n; }

export function parseISO(s) {
  s = (s || '').toString().trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  return null;
}

function toUTC(iso) { const p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }

export function daysBetween(aISO, bISO) {
  return Math.round((toUTC(bISO) - toUTC(aISO)) / 86400000);
}

export function enumerateDays(startISO, endISO) {
  const out = [];
  if (!startISO || !endISO) return out;
  const n = daysBetween(startISO, endISO);
  if (n < 0) return out;
  let t = toUTC(startISO);
  for (let i = 0; i <= n; i++) {
    const d = new Date(t);
    out.push(d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()));
    t += 86400000;
  }
  return out;
}

// Overall date span from logistics rows: min arrival .. max departure (a row's
// arrival is used as its end when departure is missing). Rows without a parseable
// arrival don't define the range. Returns null when there are no arrivals.
export function ganttRange(rows) {
  let start = null, end = null;
  (rows || []).forEach(function (r) {
    const a = parseISO(r && r.ArrivalDate);
    if (!a) return;
    const d = parseISO(r && r.DepartureDate) || a;
    if (!start || a < start) start = a;
    if (!end || d > end) end = d;
  });
  if (!start) return null;
  return { startISO: start, endISO: end };
}

// Bar cell indices [startIdx, endIdx] within a day axis starting at startISO,
// clamped to [startISO, endISO]. Arrival required; missing departure -> single
// day at arrival. Returns null without a parseable arrival.
export function barCells(arrivalISO, departureISO, startISO, endISO) {
  let a = parseISO(arrivalISO);
  if (!a) return null;
  let d = parseISO(departureISO) || a;
  if (a < startISO) a = startISO;
  if (d > endISO) d = endISO;
  if (d < a) d = a;
  return { startIdx: daysBetween(startISO, a), endIdx: daysBetween(startISO, d) };
}

export const EVENT_START = '2026-07-07';
export const EVENT_END = '2026-07-12';
export function isEventDay(iso) { return iso >= EVENT_START && iso <= EVENT_END; }

// Normalize an EE source to a known colour key, or '' (no pass / unknown).
export function eeColorKey(source) {
  const s = (source || '').toString().trim().toLowerCase();
  return (s === 'barrio' || s === 'noorg' || s === 'artist') ? s : '';
}
