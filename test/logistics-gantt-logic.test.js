import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseISO, daysBetween, enumerateDays, ganttRange, barCells, isEventDay, eeColorKey, EVENT_START, EVENT_END } from '../assets/js/logistics-gantt-logic.js';

test('parseISO normalizes yyyy-mm-dd and dd/mm/yyyy, rejects junk', () => {
  assert.equal(parseISO('2026-07-05'), '2026-07-05');
  assert.equal(parseISO('2026-7-5'), '2026-07-05');   // unpadded -> padded
  assert.equal(parseISO('5/7/2026'), '2026-07-05');   // dd/mm/yyyy
  assert.equal(parseISO(''), null);
  assert.equal(parseISO('nope'), null);
  assert.equal(parseISO(undefined), null);
});

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween('2026-07-05', '2026-07-08'), 3);
  assert.equal(daysBetween('2026-07-08', '2026-07-08'), 0);
  assert.equal(daysBetween('2026-07-08', '2026-07-05'), -3);
});

test('enumerateDays is inclusive, empty when reversed', () => {
  assert.deepEqual(enumerateDays('2026-07-05', '2026-07-07'), ['2026-07-05', '2026-07-06', '2026-07-07']);
  assert.deepEqual(enumerateDays('2026-07-07', '2026-07-05'), []);
});

test('ganttRange = min arrival .. max departure (arrival fallback)', () => {
  assert.deepEqual(
    ganttRange([{ ArrivalDate: '2026-07-05', DepartureDate: '2026-07-13' }, { ArrivalDate: '2026-07-04', DepartureDate: '2026-07-12' }]),
    { startISO: '2026-07-04', endISO: '2026-07-13' }
  );
  assert.deepEqual(ganttRange([{ ArrivalDate: '2026-07-06' }]), { startISO: '2026-07-06', endISO: '2026-07-06' });
  assert.equal(ganttRange([{ ArrivalDate: '', DepartureDate: '' }]), null);
  assert.equal(ganttRange([]), null);
});

test('barCells gives clamped [startIdx, endIdx], null without arrival', () => {
  assert.deepEqual(barCells('2026-07-06', '2026-07-08', '2026-07-04', '2026-07-13'), { startIdx: 2, endIdx: 4 });
  assert.deepEqual(barCells('2026-07-06', '', '2026-07-04', '2026-07-13'), { startIdx: 2, endIdx: 2 }); // no departure -> single day
  assert.deepEqual(barCells('2026-07-01', '2026-07-20', '2026-07-04', '2026-07-13'), { startIdx: 0, endIdx: 9 }); // clamped
  assert.equal(barCells('', '2026-07-08', '2026-07-04', '2026-07-13'), null);
});

test('isEventDay covers 7-12 Jul only', () => {
  assert.equal(EVENT_START, '2026-07-07');
  assert.equal(EVENT_END, '2026-07-12');
  assert.equal(isEventDay('2026-07-07'), true);
  assert.equal(isEventDay('2026-07-12'), true);
  assert.equal(isEventDay('2026-07-06'), false);
  assert.equal(isEventDay('2026-07-13'), false);
});

test('eeColorKey normalizes to known sources or empty', () => {
  assert.equal(eeColorKey('Barrio'), 'barrio');
  assert.equal(eeColorKey(' noorg '), 'noorg');
  assert.equal(eeColorKey('Artist'), 'artist');
  assert.equal(eeColorKey(''), '');
  assert.equal(eeColorKey('whatever'), '');
});
