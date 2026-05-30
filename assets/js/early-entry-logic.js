// Pure helpers for Early Entry. No browser or node globals — safe to import in
// the browser (admin-early-entry.js, loaded as a module) and in Node tests
// (test/early-entry-logic.test.js via `node --test`).
//
// Dates in the sheet are stored as yyyy-mm-dd: both ArrivalDate and the
// comma-separated NoOrgDates (Flatpickr is configured dateFormat:'Y-m-d' — the
// d/m/Y a user sees is altInput display only). parseDate also accepts dd/mm/yyyy
// defensively for any legacy or hand-entered values, and returns a UTC Date at
// midnight so comparisons are date-only and timezone-safe.

export function parseDate(s) {
  if (!s) return null;
  s = s.toString().trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(dt.getTime()) ? null : dt;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dt = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

// Gate opens Monday 6 July 2026. Anyone arriving strictly before it (<= 5 Jul)
// is in the setup period and needs an early-entry pass.
export const GATE = parseDate('2026-07-06');

export function isEarlyArrival(arrivalDate, gate) {
  const d = parseDate(arrivalDate);
  return !!d && d.getTime() < gate.getTime();
}

export function hasSetupNoOrg(noOrgDates, gate) {
  return String(noOrgDates || '').split(',').some(function (part) {
    const d = parseDate(part.trim());
    return !!d && d.getTime() < gate.getTime();
  });
}

export function barrioCap(approvedCount) {
  return Math.max(10, Math.ceil(0.25 * (approvedCount || 0)));
}
