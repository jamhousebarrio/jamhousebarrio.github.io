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
  return isNaN(n) ? 0 : n;
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

export function energyStatus(kcal, target) {
  if (!target) return 'ok';
  return kcal >= target ? 'ok' : 'under';
}
