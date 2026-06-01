import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, perPerson, scaledTotal, ingredientKcalPerPerson, mealKcalPerPerson, targetFor, energyStatus, MEAL_TARGETS, DAILY_TARGET, isSetupOrStrike, noorgFedCount, effectiveHeadcount } from '../assets/js/meals-logic.js';

test('isSetupOrStrike: before 7 Jul or after 12 Jul (event days excluded)', () => {
  assert.equal(isSetupOrStrike('2026-07-05'), true);   // setup
  assert.equal(isSetupOrStrike('2026-07-06'), true);   // setup
  assert.equal(isSetupOrStrike('2026-07-07'), false);  // event start
  assert.equal(isSetupOrStrike('2026-07-12'), false);  // event end
  assert.equal(isSetupOrStrike('2026-07-13'), true);   // strike
  assert.equal(isSetupOrStrike(''), false);            // unscheduled
  assert.equal(isSetupOrStrike('not-a-date'), false);
});

test('noorgFedCount counts members whose NoOrgDates include the day', () => {
  const log = [
    { NoOrgDates: '2026-07-05, 2026-07-06' },
    { NoOrgDates: '2026-07-05' },
    { NoOrgDates: '' },
    { NoOrgDates: '2026-07-13' },
  ];
  assert.equal(noorgFedCount(log, '2026-07-05'), 2);
  assert.equal(noorgFedCount(log, '2026-07-06'), 1);
  assert.equal(noorgFedCount(log, '2026-07-13'), 1);
  assert.equal(noorgFedCount(log, '2026-07-09'), 0);
  assert.equal(noorgFedCount([], '2026-07-05'), 0);
  assert.equal(noorgFedCount(log, ''), 0);
});

test('effectiveHeadcount subtracts NoOrg only on setup/strike days, floored at 0', () => {
  const log = [{ NoOrgDates: '2026-07-05' }, { NoOrgDates: '2026-07-05' }, { NoOrgDates: '2026-07-13' }];
  assert.equal(effectiveHeadcount(30, log, '2026-07-05'), 28); // setup, 2 on noorg
  assert.equal(effectiveHeadcount(30, log, '2026-07-13'), 29); // strike, 1 on noorg
  assert.equal(effectiveHeadcount(30, log, '2026-07-09'), 30); // event day -> no adjustment
  assert.equal(effectiveHeadcount(30, log, ''), 30);           // unscheduled -> no adjustment
  assert.equal(effectiveHeadcount(1, log, '2026-07-05'), 0);   // floored at 0
});

test('num coerces strings, guards NaN/blank to 0', () => {
  assert.equal(num('4.5'), 4.5);
  assert.equal(num(3), 3);
  assert.equal(num('2 big pieces'), 0); // count-word -> 0
  assert.equal(num(''), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num(null), 0);
  assert.equal(num('Infinity'), 0); // runaway value -> 0, not Infinity
});

test('perPerson divides by servings, falls back to 30, guards 0', () => {
  assert.equal(perPerson('4.5', 30), 0.15);
  assert.equal(perPerson('4.5', ''), 0.15);   // blank servings -> 30
  assert.equal(perPerson('4.5', 0), 0.15);     // 0 servings -> 30
  assert.equal(perPerson('', 30), 0);
});

test('scaledTotal = perPerson * headcount', () => {
  assert.equal(scaledTotal('4.5', 30, 30), 4.5);
  assert.equal(scaledTotal('4.5', 30, 25), 3.75);
  assert.equal(scaledTotal('4.5', 30, 0), 0);
});

test('ingredientKcalPerPerson = perPerson * kcalPerUnit', () => {
  assert.equal(ingredientKcalPerPerson('4.5', 30, '3300'), 495);
  assert.equal(ingredientKcalPerPerson('2 big pieces', 30, '50'), 0);
});

test('mealKcalPerPerson sums rows, blank rows add 0', () => {
  const ings = [
    { Quantity: '4.5', KcalPerUnit: '3300' }, // 495
    { Quantity: '4',   KcalPerUnit: '2475' }, // 330
    { Quantity: '',    KcalPerUnit: '100' },  // 0
  ];
  assert.equal(Math.round(mealKcalPerPerson(ings, 30)), 825);
});

test('targets and status', () => {
  assert.equal(DAILY_TARGET, 2300);
  assert.deepEqual(MEAL_TARGETS, { breakfast: 550, lunch: 750, dinner: 1000, dessert: 250 });
  assert.equal(targetFor('Dinner'), 1000);
  assert.equal(targetFor('unknown'), 0);
  assert.equal(energyStatus(1000, 1000), 'ok');
  assert.equal(energyStatus(720, 1000), 'under');
  assert.equal(energyStatus(0, 0), 'ok');     // no target (unknown type) -> ok
  assert.equal(energyStatus(500, 0), 'ok');
});
