# Meals Upgrade + Camp-Menu Seed — Design

**Date:** 2026-05-31
**Status:** Draft for review
**Component type:** Load-bearing (the camp's working meal plan; inherited by cooks/coordinators)

## Problem

The platform's meals data is empty (test rows only). We have the real camp menu in
a PDF (`liste-ingrédients-et-quantités`): ~10 meals with ingredient quantities, plus
jokey precooking recipe notes. We want to seed the platform from it — and, while doing
so, upgrade the meals tool so it actually fits how the kitchen works:

- Meals planned **without a date**, assignable later; tagged **lunch/dinner** (also
  breakfast/dessert), with a **per-day view**.
- Quantities that **scale to an adjustable headcount** (aiming for 30, currently 25
  approved) while showing **per-person portions** so nobody goes hungry.
- **Pre-cook flagging** (proteins, spice mixes pre-made & frozen before the playa; all
  veg cooked on-site) to minimise work at the event — both a per-ingredient flag and a
  per-meal prep-ahead note, with a roll-up "prep-ahead list".
- A **calorie check** per meal (≈kcal/person vs a target) and per day, since heat,
  physical load, alcohol and poor sleep raise needs.
- **Meal photos** (changeable).
- Editable by **admins and Kitchen leads** (not just admins).

## Decisions (from brainstorming)

- **Scope:** meals + ingredients + the verbatim recipe notes. **Drinks & Snacks are
  out of scope** for now (separate `DrinksSnacks` tab, totals-vs-rate mismatch) — a later phase.
- **Quantity model:** store **total quantities at a baseline of 30 servings**; an
  adjustable **headcount counter** rescales totals; **per-person portion = total ÷ baseline**.
- **Recipe notes kept VERBATIM** — Chef Gautier's jokes and profanity stay. This is
  internal admin/kitchen content, never public-facing.
- **Calories:** seed a per-ingredient kcal density; show kcal/person per meal vs a
  per-meal-type target and a per-day roll-up. **Daily target 2300 kcal/person**, split
  **breakfast 550 / lunch 750 / dinner 1000** (+ dessert ~250 soft; snacks/drinks
  untargeted on top). Targets are constants (editable in code).
- **Edit permission:** **admins OR members assigned to the "Kitchen lead" role** (an
  existing Roles entry — `AssignedTo: Edward, Goutière`). Enforced server-side.
- **Approach:** extend the existing Meals subsystem — new columns, new behaviour on
  `meals.js` (no new serverless function; stays within the 12/12 Vercel cap), enhanced
  `admin-meals.js`, a unit-tested pure-logic module, and a one-shot seed script.
- **Phasing:** Phase 1 = capability (model + API + logic + UI). Phase 2 = seed the menu.

## Data model

### `Meals` tab — add columns; `Date` optional

`MealID, Name, Date(optional), MealType, Servings, Description, Instructions, PreCook, PhotoURL`

- `MealType`: `breakfast | lunch | dinner | dessert`
- `Servings`: baseline headcount the quantities are calibrated for (default `30`)
- `Instructions`: on-site cooking notes (verbatim)
- `PreCook`: prep-ahead notes — the precooking recipes (verbatim)
- `PhotoURL`: meal image (any URL; Drive/Unsplash/uploaded)
- `Date` may be blank → meal shows under an **"Unscheduled"** group until assigned.

### `MealIngredients` tab — add columns

`IngredientID, MealID, Name, Quantity, Unit, Prep, KcalPerUnit`

- `Quantity`: **total** at the meal's `Servings` baseline (not per-person)
- `Prep`: `pre-cook | on-site` (default seeded; toggleable inline)
- `KcalPerUnit`: kcal per **one `Unit`** of this ingredient (e.g. per kg / per piece / per L)

Adding columns is backward-compatible (existing rows get blanks). The lone test rows
are cleared by the seed.

## Computation (pure logic — unit-tested)

New module `assets/js/meals-logic.js` (no browser/node globals; dual-use, mirrors the
unit-tested `inventory-labels.js`):

- `num(v)` → `Number(v)` coercion with a NaN→0 guard. **Sheet values arrive as strings**
  (`Quantity` is stored via `String(quantity)`), and a few seed quantities are count-words
  (e.g. "2 big pieces", flagged item #5) that don't parse — those coerce to 0 and contribute
  no calories rather than `NaN`-poisoning a meal's total.
- `perPerson(quantity, servings)` → `num(quantity) / (num(servings) || 30)` (baseline fallback 30; 0/blank-safe)
- `scaledTotal(quantity, servings, headcount)` → `perPerson × headcount`
- `ingredientKcalPerPerson(quantity, servings, kcalPerUnit)` → `perPerson × num(kcalPerUnit)`
- `mealKcalPerPerson(ingredients, servings)` → Σ over ingredients (blank/non-numeric rows add 0)
- `MEAL_TARGETS = { breakfast:550, lunch:750, dinner:1000, dessert:250 }`, `DAILY_TARGET = 2300`
- `targetFor(mealType)` and `energyStatus(kcal, target)` → `'ok' | 'under'`

All quantity/calorie math lives here so it's testable and the page/seed stay thin. Tests must
cover string quantities (`"4.5"`), non-numeric count-words (`"2 big pieces"` → 0), blank
quantity, and the baseline-fallback/0-servings guard.

## Permissions

- **View:** any signed-in member (Meals page stays `access: general`); observers read-only.
- **Edit (write meals/ingredients):** **admin OR Kitchen lead.**
  - New shared helper `api/_lib/roles.js` → `isAssignedToRole(sheets, spreadsheetId, roleName, member)`:
    reads the `Roles` tab, finds the row whose `Name` equals `roleName` (case-insensitive),
    splits `AssignedTo` on commas, and matches the member's `Playa Name` **or** `Name`
    (normalized/trim/lowercase). Returns boolean. (Reads the whole Roles tab per call — no
    caching, consistent with the codebase's other per-request sheet reads. Fine at this scale.)
  - `meals.js` write actions, in order: **observers rejected first** —
    `if (auth.observer) return 403` — then
    `const canEdit = auth.admin || await isAssignedToRole(sheets, id, 'Kitchen lead', auth.member); if (!canEdit) return 401`.
    (Observer-first means a Kitchen-lead-who-is-also-an-observer stays read-only, matching the
    inventory/logistics observer rule.)
  - `meals.js` default fetch returns a **`canEdit`** boolean — `!auth.observer && (auth.admin || isAssignedToRole(...))`
    — so the frontend shows edit controls without re-implementing role logic. Server remains
    the source of truth.

| Action | Observer | Member | Kitchen lead | Admin |
|--------|----------|--------|--------------|-------|
| view / fetch | ✅ ro | ✅ ro | ✅ | ✅ |
| upsert/delete meal & ingredient | ❌ | ❌ 401 | ✅ | ✅ |

## API — changes to `api/meals.js` (no new function)

- `upsert-meal`: **drop the required-`date` check** (date optional); accept and write
  `servings, preCook, photoURL` alongside existing fields. `MEAL_HEADERS` updated.
- `upsert-ingredient`: accept and write `prep, kcalPerUnit`. `INGREDIENT_HEADERS` updated.
- Write actions gated on `admin || Kitchen lead` (above); default fetch returns `canEdit`.
- `delete-meal` / `delete-ingredient`: unchanged except the new permission gate.

## UI — `admin/meals.html` + `assets/js/admin-meals.js`

(Lo-fi approved in the visual companion.)

- **Headcount counter** (top): number input driving every total + the per-person column;
  defaults to the **approved-member count** — `members.filter(Status === 'approved').length`,
  using the member list the page already loads via `JH.authenticate()` (same filter as
  `admin-shifts.js`/`admin-demographics.js`) — with one-click reset and a manual override
  (e.g. 30). Client-side only (a viewing control; not persisted). Per-person & kcal/person are
  headcount-independent.
- **Per-day view**: meals grouped by `Date`, plus an **"Unscheduled"** group for date-less
  meals; each meal card has an inline **type dropdown** and **date picker** (assign/change).
  Date-filter pills gain an "Unscheduled" pill. Day headers show the B/L/D slot dots and a
  **day kcal roll-up vs 2300**.
- **Meal photo banner** per card with a **"Change photo"** control (edits `PhotoURL`).
- **Energy strip** per card: `≈ kcal/person` (Σ ingredients) with a bar vs `targetFor(type)`,
  tagged "✓ enough" / "⚠ a bit light". A `kcal/p` column per ingredient (blank/non-numeric
  quantity shows "—" and adds 0). **Dessert** uses its soft target and is informational only —
  no "a bit light" warning (its fruit quantities are intentionally blank at seed time).
- **Pre-cook** (the "both"): a per-meal **❄ Pre-cook ahead** callout (`PreCook` text), and
  per-ingredient **❄ pre-cook rows highlighted** with an inline **Prep toggle** (click to flip
  pre-cook ↔ on-site → writes `Prep`; the row, ❄, callout count and prep-ahead list update).
- **Prep-ahead list** view (beside Shopping list): aggregates every `pre-cook` ingredient
  across meals + each meal's `PreCook` notes — the "do this before the playa" sheet.
- **Modals**: meal modal gains Servings, PreCook, PhotoURL, optional Date, `dessert` type;
  ingredient modal gains Prep and KcalPerUnit. Edit controls render when `canEdit` is true.

## The seed — `scripts/seed-meals.mjs`

One-shot (dry-run default, `--apply` writes), modelled on existing seed/migration scripts.
Clears the test `Meals`/`MealIngredients` rows, then writes the PDF menu from a reviewable
in-script data object.

**Meals** (all date-less; admin assigns days later):

| Meal | Type | Pre-cook defaults | Photo |
|------|------|-------------------|-------|
| Smoky Shakshuka | dinner | merguez, smoky spice mix, brown lentils | seeded |
| Dal & Mango | dinner | marinated chicken, smoked tofu, curry paste | seeded |
| Pita Night | dinner | falafel, spiced meatballs | seeded |
| Couscous | dinner | marinated chicken (2nd recipe), chickpeas, spice mix | seeded |
| Big Pot Pasta | dinner | sausages, seitan | seeded |
| Pizza Night | dinner | dough, pre-cooked toppings, minced beef | seeded |
| Chef Gautier's Burger | dinner | patties, tomato chutney | seeded |
| Quinoa Salad | lunch | quinoa | seeded |
| Dessert | dessert | — | seeded |
| Breakfast | breakfast | (bacon optional) | seeded |

- **Quantities** = PDF totals at `Servings = 30`.
- **`PreCook`/`Instructions`** = the PDF recipe notes **verbatim** (jokes, profanity, the
  Bolivia flight threat — all kept).
- **`KcalPerUnit`** seeded per ingredient from standard food-energy values (approximate,
  editable). E.g. falafel ≈3300 kcal/kg, merguez ≈3000 kcal/kg, olive oil ≈8800 kcal/L,
  eggs ≈78 kcal/piece.
- **`Prep` defaults**: proteins & spice mixes → `pre-cook`; all veg/pasta/rice/assembly → `on-site`.
- **`PhotoURL`** seeded with a representative image per meal (changeable).
- **Pizza Night** is one meal; variant ingredients prefixed (`Vegan – …`, `Meatlovers – …`,
  `4 formaggi – …`) plus shared base (dough, chili oil).

**Flagged items (first reading; correct after seeding):**
1. "Falafel — 150 pieces / 4.5 kg" → `4.5 kg` (name notes "≈150 pcs").
2. "Marinated — 5 kg" (Couscous) → **marinated chicken 5 kg**.
3. "Pizza dough ×60 (…120 small)?" → `60` large bases (note "=120 small").
4. **Dessert** mixed fruits have **no PDF quantities** → seed the fruit list with blank/estimated qty.
5. Count items ("3 large red onions", "Lettuce — 2 big pieces") → unit `pieces`/`heads` as written.

## Testing

- **TDD** for `assets/js/meals-logic.js` via `test/meals-logic.test.js` (`npm test`):
  per-person & scaled-total math (incl. baseline fallback, 0/blank guards), kcal/person
  aggregation, `targetFor`, `energyStatus` boundaries.
- The page wiring, `meals.js` actions, the roles permission helper, and the seed follow
  existing patterns and are not separately unit-tested (consistent with the codebase).
- Manual verification: run the app as a Kitchen lead and as a non-admin/non-lead to confirm
  the edit gate; exercise headcount scaling, date assignment, prep toggle, energy strip.

## Out of scope (YAGNI / later)

Drinks & Snacks seed (separate tab); in-app photo **upload** (use a URL now — the inventory
upload script exists if needed later); per-ingredient veg/non-veg headcount precision
(whole-menu scaling is used; manual tweak per item); user-editable calorie targets
(constants for now); persisting the headcount counter.

## Change-enforcement notes

- New `Meals`/`MealIngredients` columns → update the CLAUDE.md "Google Sheet Tabs" table.
- New permission tier (Kitchen lead) → document it next to the Inventory write-tier note.
- Backend stays on `meals.js` to respect the 12/12 Vercel function cap.
