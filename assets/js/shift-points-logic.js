// Pure scoring helpers for the Shifts fairness leaderboard. No browser or node
// globals — safe to import in admin-shifts.js (module) and in Node tests
// (test/shift-points-logic.test.js via `node --test`).
//
// Points (admin-set, in ShiftWeights) replace clock hours as the ranking
// currency. Hours are still computed and returned as a supporting detail.
// parseDate is reused from early-entry-logic.js (the canonical pure date parser:
// accepts yyyy-mm-dd and dd/mm/yyyy, returns UTC midnight, null on junk).
import { parseDate } from './early-entry-logic.js';

export const MAIN_START = parseDate('2026-07-07');
export const MAIN_END = parseDate('2026-07-12');
export const DEFAULT_TYPE_POINTS = 1;   // a shift type with no configured weight
export const DEFAULT_DAY_POINTS = 10;   // build/strike day with no configured value

const DAY_MS = 86400000;

export function daysInclusive(from, to) {
  if (!from || !to || to < from) return 0;
  return Math.floor((to - from) / DAY_MS) + 1;
}

export function durationHours(start, end) {
  if (!start || !end) return 0;
  const sp = String(start).split(':');
  const ep = String(end).split(':');
  if (sp.length < 2 || ep.length < 2) return 0;
  let mins = (+ep[0] * 60 + +ep[1]) - (+sp[0] * 60 + +sp[1]);
  // Wrap only on a genuine overnight shift (mins < 0). A zero-length slot
  // (start === end, a data-entry slip) stays 0h rather than becoming 24h.
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

// Turn raw ShiftWeights rows ({Kind, Name, Points}) into a fast lookup with
// defaults applied for the two day-values. Type points default per-lookup in
// typePoints(), so unknown types never need a row. Duplicate type rows with the
// same (case-folded) Name follow last-write-wins.
export function buildWeightIndex(weightRows) {
  const types = {};
  let buildPts = DEFAULT_DAY_POINTS;
  let strikePts = DEFAULT_DAY_POINTS;
  (weightRows || []).forEach(function (w) {
    const kind = (w.Kind || '').toString().toLowerCase().trim();
    const pts = parseInt(w.Points, 10);
    if (isNaN(pts)) return;
    if (kind === 'type') types[(w.Name || '').toString().toLowerCase().trim()] = pts;
    else if (kind === 'build') buildPts = pts;
    else if (kind === 'strike') strikePts = pts;
  });
  return { types: types, buildPts: buildPts, strikePts: strikePts };
}

export function typePoints(index, typeName) {
  const key = (typeName || '').toString().toLowerCase().trim();
  if (index && index.types && Object.prototype.hasOwnProperty.call(index.types, key)) {
    return index.types[key];
  }
  return DEFAULT_TYPE_POINTS;
}

// Count NoOrg dates that fall within [from, to] inclusive (a per-member build or
// strike window). NoOrgDates: comma-separated yyyy-mm-dd, trimmed, empties dropped.
export function noOrgDaysInWindow(noOrgDates, from, to) {
  if (!from || !to) return 0;
  return String(noOrgDates || '').split(',').reduce(function (n, part) {
    const d = parseDate(part.trim());
    return (d && d >= from && d <= to) ? n + 1 : n;
  }, 0);
}

// Full points + hours breakdown for one member.
// args:
//   arrivalDate, departureDate, noOrgDates : strings from the member's logistics row
//   eventShifts : [{Name, StartTime, EndTime}] the member is signed up for, already
//                 filtered to the event window by the caller
//   index       : output of buildWeightIndex
export function memberPoints(args) {
  const arr = parseDate(args.arrivalDate);
  const dep = parseDate(args.departureDate);
  const index = args.index || { types: {}, buildPts: DEFAULT_DAY_POINTS, strikePts: DEFAULT_DAY_POINTS };

  const lastSetup = new Date(MAIN_START.getTime() - DAY_MS);
  const firstStrike = new Date(MAIN_END.getTime() + DAY_MS);

  let buildDays = 0;
  let strikeDays = 0;
  if (arr && arr < MAIN_START) {
    const gross = daysInclusive(arr, lastSetup);
    buildDays = Math.max(0, gross - noOrgDaysInWindow(args.noOrgDates, arr, lastSetup));
  }
  if (dep && dep > MAIN_END) {
    const gross = daysInclusive(firstStrike, dep);
    strikeDays = Math.max(0, gross - noOrgDaysInWindow(args.noOrgDates, firstStrike, dep));
  }

  const buildPoints = buildDays * index.buildPts;
  const strikePoints = strikeDays * index.strikePts;

  let eventPoints = 0;
  let eventHours = 0;
  (args.eventShifts || []).forEach(function (s) {
    eventPoints += typePoints(index, s.Name);
    eventHours += durationHours(s.StartTime, s.EndTime);
  });

  return {
    buildDays: buildDays,
    strikeDays: strikeDays,
    buildPoints: buildPoints,
    strikePoints: strikePoints,
    eventPoints: eventPoints,
    eventHours: eventHours,
    points: buildPoints + strikePoints + eventPoints,
  };
}
