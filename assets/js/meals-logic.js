// Pure quantity & calorie math for the Meals page. No browser/node globals —
// imported in the browser (admin-meals.js, as a module) and in Node tests
// (test/meals-logic.test.js via `node --test`).
//
// Quantities are stored as TOTALS at a meal's `Servings` baseline (default 30).
// Sheet values arrive as strings; `num` coerces and guards non-numeric
// count-words (e.g. "2 big pieces") and blanks to 0 so one bad cell can't
// NaN-poison a meal's totals.

export function num(v) {
  const n = Number(v);
  return (isNaN(n) || !isFinite(n)) ? 0 : n; // count-words, blanks, and Infinity -> 0
}

export function perPerson(quantity, servings) {
  const s = num(servings) || 30;
  return num(quantity) / s;
}

export function scaledTotal(quantity, servings, headcount) {
  return perPerson(quantity, servings) * num(headcount);
}

export function ingredientKcalPerPerson(quantity, servings, kcalPerUnit) {
  return perPerson(quantity, servings) * num(kcalPerUnit);
}

export function mealKcalPerPerson(ingredients, servings) {
  return (ingredients || []).reduce(function (sum, ing) {
    return sum + ingredientKcalPerPerson(ing.Quantity, servings, ing.KcalPerUnit);
  }, 0);
}

export const MEAL_TARGETS = { breakfast: 550, lunch: 750, dinner: 1000, dessert: 250 };
export const DAILY_TARGET = 2300;

export function targetFor(mealType) {
  return MEAL_TARGETS[(mealType || '').toLowerCase()] || 0;
}

// Dessert is informational (soft target) — callers decide whether to warn.
// A 0/absent target (unknown meal type) is treated as "no target" -> 'ok'.
export function energyStatus(kcal, target) {
  if (!target) return 'ok';
  return kcal >= target ? 'ok' : 'under';
}

// ── NoOrg meal-headcount adjustment (setup/strike only) ──────────────────────
// Dates are stored yyyy-mm-dd, which sorts lexically = chronologically.
export const EVENT_START = '2026-07-07';
export const EVENT_END = '2026-07-12';

// A meal day is "setup or strike" if it's a real date outside the main event
// (before 7 Jul or after 12 Jul). Blank/unscheduled/invalid -> false (no adjustment).
export function isSetupOrStrike(dateStr) {
  const d = (dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d < EVENT_START || d > EVENT_END;
}

// How many people are on full-day NoOrg duty on `dateStr` (their NoOrgDates
// includes it) — they're fed by NoOrg, so the barrio doesn't cook for them.
export function noorgFedCount(logistics, dateStr) {
  const d = (dateStr || '').trim();
  if (!d) return 0;
  return (logistics || []).reduce(function (n, row) {
    const days = String((row && row.NoOrgDates) || '').split(',').map(function (s) { return s.trim(); });
    return n + (days.indexOf(d) !== -1 ? 1 : 0);
  }, 0);
}

// Mouths the barrio actually feeds for a meal on `dateStr`: the planning counter,
// minus NoOrg-fed people on setup/strike days only (event days are unchanged).
export function effectiveHeadcount(counter, logistics, dateStr) {
  const base = num(counter);
  if (!isSetupOrStrike(dateStr)) return base;
  return Math.max(0, base - noorgFedCount(logistics, dateStr));
}
