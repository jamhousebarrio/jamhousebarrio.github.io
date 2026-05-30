import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, isEarlyArrival, hasSetupNoOrg, barrioCap, GATE } from '../assets/js/early-entry-logic.js';

test('parseDate handles dd/mm/yyyy and yyyy-mm-dd, rejects junk', () => {
  assert.equal(parseDate('05/07/2026').getTime(), Date.UTC(2026, 6, 5));
  assert.equal(parseDate('2026-07-05').getTime(), Date.UTC(2026, 6, 5));
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(undefined), null);
});

test('GATE is 6 July 2026 (UTC midnight)', () => {
  assert.equal(GATE.getTime(), Date.UTC(2026, 6, 6));
});

test('isEarlyArrival: strictly before the gate (<= 5 Jul) is early', () => {
  assert.equal(isEarlyArrival('04/07/2026', GATE), true);
  assert.equal(isEarlyArrival('05/07/2026', GATE), true);   // boundary: still early
  assert.equal(isEarlyArrival('06/07/2026', GATE), false);  // boundary: gate day, not early
  assert.equal(isEarlyArrival('07/07/2026', GATE), false);
  assert.equal(isEarlyArrival('2026-07-03', GATE), true);   // yyyy-mm-dd form too
  assert.equal(isEarlyArrival('', GATE), false);            // no date = not early
  assert.equal(isEarlyArrival('garbage', GATE), false);
});

test('hasSetupNoOrg: any comma-listed NoOrg day before the gate counts', () => {
  assert.equal(hasSetupNoOrg('2026-07-04', GATE), true);
  assert.equal(hasSetupNoOrg('2026-07-05', GATE), true);            // boundary
  assert.equal(hasSetupNoOrg('2026-07-06,2026-07-10', GATE), false); // both on/after gate
  assert.equal(hasSetupNoOrg('2026-07-10, 2026-07-03', GATE), true); // mixed, one early
  assert.equal(hasSetupNoOrg('', GATE), false);
});

test('barrioCap: max(10, ceil(25% of approved))', () => {
  assert.equal(barrioCap(0), 10);
  assert.equal(barrioCap(10), 10);   // ceil(2.5)=3 -> max(10,3)=10
  assert.equal(barrioCap(40), 10);   // ceil(10)=10 -> max(10,10)=10
  assert.equal(barrioCap(44), 11);   // ceil(11)=11
  assert.equal(barrioCap(45), 12);   // ceil(11.25)=12
});
