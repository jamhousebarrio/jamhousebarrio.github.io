import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIN_START, MAIN_END, DEFAULT_TYPE_POINTS, DEFAULT_DAY_POINTS,
  daysInclusive, durationHours, buildWeightIndex, typePoints,
  noOrgDaysInWindow, memberPoints,
} from '../assets/js/shift-points-logic.js';

test('event window constants', () => {
  assert.equal(MAIN_START.getTime(), Date.UTC(2026, 6, 7));
  assert.equal(MAIN_END.getTime(), Date.UTC(2026, 6, 12));
});

test('daysInclusive counts both ends, 0 when reversed/empty', () => {
  const a = new Date(Date.UTC(2026, 6, 4));
  const b = new Date(Date.UTC(2026, 6, 6));
  assert.equal(daysInclusive(a, b), 3);
  assert.equal(daysInclusive(a, a), 1);
  assert.equal(daysInclusive(b, a), 0);
  assert.equal(daysInclusive(null, b), 0);
});

test('durationHours handles HH:MM and past-midnight', () => {
  assert.equal(durationHours('09:00', '11:00'), 2);
  assert.equal(durationHours('23:00', '00:30'), 1.5); // wraps midnight
  assert.equal(durationHours('', '11:00'), 0);
});

test('buildWeightIndex: defaults when build/strike rows absent', () => {
  const idx = buildWeightIndex([{ Kind: 'type', Name: 'Cooking', Points: '5' }]);
  assert.equal(idx.buildPts, DEFAULT_DAY_POINTS);
  assert.equal(idx.strikePts, DEFAULT_DAY_POINTS);
  assert.equal(idx.types['cooking'], 5);
});

test('buildWeightIndex: reads build/strike rows, ignores bad Points', () => {
  const idx = buildWeightIndex([
    { Kind: 'build', Name: '', Points: '12' },
    { Kind: 'strike', Name: '', Points: '8' },
    { Kind: 'type', Name: 'Shit Ninja', Points: 'oops' }, // ignored
  ]);
  assert.equal(idx.buildPts, 12);
  assert.equal(idx.strikePts, 8);
  assert.equal(typePoints(idx, 'Shit Ninja'), DEFAULT_TYPE_POINTS); // bad row -> default
});

test('typePoints: configured wins, unset falls back to 1, case-insensitive', () => {
  const idx = buildWeightIndex([{ Kind: 'type', Name: 'Cooking', Points: '5' }]);
  assert.equal(typePoints(idx, 'cooking'), 5);
  assert.equal(typePoints(idx, 'COOKING'), 5);
  assert.equal(typePoints(idx, 'Unknown'), DEFAULT_TYPE_POINTS);
  assert.equal(DEFAULT_TYPE_POINTS, 1);
});

test('noOrgDaysInWindow: counts only dates inside [from,to] inclusive', () => {
  const from = new Date(Date.UTC(2026, 6, 4));
  const to = new Date(Date.UTC(2026, 6, 6));
  assert.equal(noOrgDaysInWindow('2026-07-04,2026-07-06', from, to), 2); // both boundaries
  assert.equal(noOrgDaysInWindow('2026-07-03,2026-07-07', from, to), 0); // both outside
  assert.equal(noOrgDaysInWindow('2026-07-05, 2026-07-10', from, to), 1);
  assert.equal(noOrgDaysInWindow('', from, to), 0);
});

test('memberPoints: build days minus NoOrg, times buildPts', () => {
  // Arrives 4 Jul -> build window [4 Jul, 6 Jul] = 3 days; 1 NoOrg day in window.
  const idx = buildWeightIndex([{ Kind: 'build', Name: '', Points: '10' }]);
  const r = memberPoints({
    arrivalDate: '2026-07-04', departureDate: '2026-07-12',
    noOrgDates: '2026-07-05', eventShifts: [], index: idx,
  });
  assert.equal(r.buildDays, 2);          // 3 present - 1 NoOrg
  assert.equal(r.buildPoints, 20);       // 2 * 10
  assert.equal(r.strikePoints, 0);
  assert.equal(r.points, 20);
});

test('memberPoints: strike days open-ended after event', () => {
  const idx = buildWeightIndex([{ Kind: 'strike', Name: '', Points: '10' }]);
  const r = memberPoints({
    arrivalDate: '2026-07-07', departureDate: '2026-07-14', // strike [13,14] = 2 days
    noOrgDates: '', eventShifts: [], index: idx,
  });
  assert.equal(r.strikeDays, 2);
  assert.equal(r.strikePoints, 20);
  assert.equal(r.buildDays, 0);
});

test('memberPoints: event shifts sum type points and hours', () => {
  const idx = buildWeightIndex([
    { Kind: 'type', Name: 'Cooking', Points: '5' },
    { Kind: 'type', Name: 'Shit Ninja', Points: '2' },
  ]);
  const r = memberPoints({
    arrivalDate: '', departureDate: '', noOrgDates: '',
    eventShifts: [
      { Name: 'Cooking', StartTime: '18:00', EndTime: '20:00' }, // 5 pts, 2h
      { Name: 'Shit Ninja', StartTime: '09:00', EndTime: '09:15' }, // 2 pts, 0.25h
      { Name: 'Unweighted', StartTime: '', EndTime: '' }, // default 1 pt, 0h
    ],
    index: idx,
  });
  assert.equal(r.eventPoints, 8);   // 5 + 2 + 1
  assert.equal(r.eventHours, 2.25); // 2 + 0.25 + 0
  assert.equal(r.points, 8);
});

test('memberPoints: NoOrg cannot push net days negative', () => {
  const idx = buildWeightIndex([{ Kind: 'build', Name: '', Points: '10' }]);
  const r = memberPoints({
    arrivalDate: '2026-07-06', departureDate: '2026-07-12', // build [6,6] = 1 day
    noOrgDates: '2026-07-06,2026-07-06,2026-07-06', index: idx, eventShifts: [],
  });
  assert.equal(r.buildDays, 0);     // max(0, 1 - 3)
  assert.equal(r.buildPoints, 0);
});
