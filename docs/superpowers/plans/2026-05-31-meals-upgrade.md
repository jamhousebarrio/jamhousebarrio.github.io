# Meals Upgrade + Camp-Menu Seed Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Meals tool (date-optional meals, lunch/dinner/breakfast/dessert + per-day view, adjustable headcount scaling with per-person portions, per-ingredient pre-cook flag + per-meal verbatim prep notes, calorie check vs targets, meal photos, edit access for admins + Kitchen leads) and seed it with the camp menu from the PDF.

**Architecture:** Pure quantity/calorie math in a unit-tested ES module (`assets/js/meals-logic.js`). Backend stays on `api/meals.js` (no new serverless function — 12/12 Vercel cap) with a shared role helper (`api/_lib/roles.js`) for the Kitchen-lead permission. The page (`admin/meals.html` + `assets/js/admin-meals.js`) renders the new UI. A one-shot `scripts/seed-meals.mjs` loads the menu. Two new Google-Sheet columns each on `Meals` and `MealIngredients` (backward-compatible).

**Tech Stack:** Jekyll static page, vanilla JS ES modules, `node --test`, Vercel serverless, Google Sheets via `api/_lib/sheets.js`.

**Spec:** `docs/superpowers/specs/2026-05-31-meals-upgrade-design.md`

**Working dir:** the `feat/meals-upgrade` worktree. `.env` and `node_modules` are symlinked, so `npm test` and the seed script work.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `assets/js/meals-logic.js` (create) | Pure math: `num`, `perPerson`, `scaledTotal`, kcal aggregation, `MEAL_TARGETS`, `targetFor`, `energyStatus`. No globals; imported by page + tests. |
| `test/meals-logic.test.js` (create) | Unit tests for the math (string/blank/0 guards, boundaries). |
| `api/_lib/roles.js` (create) | `isAssignedToRole(sheets, spreadsheetId, roleName, member)` — reads Roles tab, matches playa/legal name in AssignedTo. |
| `api/meals.js` (modify) | Date optional; new fields (`servings,preCook,photoURL,prep,kcalPerUnit`); writes gated on admin∥Kitchen-lead with observer-first reject; fetch returns `canEdit`. |
| `admin/meals.html` (modify) | Headcount counter, energy/prep CSS, photo + prep-ahead markup, new modal fields. |
| `assets/js/admin-meals.js` (modify) | Headcount counter, per-day + Unscheduled grouping, inline type/date assign, photo banner, energy strip, pre-cook toggle + callout, prep-ahead list, `canEdit` gating, updated modals. |
| `scripts/seed-meals.mjs` (create) | One-shot: clear test rows, write the PDF menu (quantities, prep defaults, kcal densities, verbatim recipe notes, photos). |
| `CLAUDE.md` (modify) | Document new columns + Kitchen-lead write tier. |

---

## Chunk 1: Pure logic module + tests

### Task 1: `meals-logic.js` (TDD)

**Files:**
- Create: `assets/js/meals-logic.js`
- Test: `test/meals-logic.test.js`

- [ ] **Step 1: Write the failing test** — create `test/meals-logic.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, perPerson, scaledTotal, ingredientKcalPerPerson, mealKcalPerPerson, targetFor, energyStatus, MEAL_TARGETS, DAILY_TARGET } from '../assets/js/meals-logic.js';

test('num coerces strings, guards NaN/blank to 0', () => {
  assert.equal(num('4.5'), 4.5);
  assert.equal(num(3), 3);
  assert.equal(num('2 big pieces'), 0); // count-word -> 0
  assert.equal(num(''), 0);
  assert.equal(num(undefined), 0);
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
  // 4.5 kg / 30 = 0.15 kg/person; 0.15 * 3300 kcal/kg = 495
  assert.equal(ingredientKcalPerPerson('4.5', 30, '3300'), 495);
  assert.equal(ingredientKcalPerPerson('2 big pieces', 30, '50'), 0); // non-numeric qty -> 0
});

test('mealKcalPerPerson sums rows, blank rows add 0', () => {
  const ings = [
    { Quantity: '4.5', KcalPerUnit: '3300' }, // 495
    { Quantity: '4',   KcalPerUnit: '2475' }, // 4/30=0.1333*2475=330
    { Quantity: '',    KcalPerUnit: '100' },  // 0
  ];
  assert.equal(Math.round(mealKcalPerPerson(ings, 30)), 825);
});

test('targets and status', () => {
  assert.equal(DAILY_TARGET, 2300);
  assert.deepEqual(MEAL_TARGETS, { breakfast: 550, lunch: 750, dinner: 1000, dessert: 250 });
  assert.equal(targetFor('Dinner'), 1000);   // case-insensitive
  assert.equal(targetFor('unknown'), 0);
  assert.equal(energyStatus(1000, 1000), 'ok');
  assert.equal(energyStatus(720, 1000), 'under');
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `assets/js/meals-logic.js`:

```js
// Pure quantity & calorie math for the Meals page. No browser/node globals —
// imported in the browser (admin-meals.js, as a module) and in Node tests
// (test/meals-logic.test.js via `node --test`).
//
// Quantities are stored as TOTALS at a meal's `Servings` baseline (default 30).
// Sheet values arrive as strings; `num` coerces and guards non-numeric
// count-words (e.g. "2 big pieces") and blanks to 0 so one bad cell can't
// NaN-poison a meal's totals.

export function num(v) {
  const n = parseFloat(v);
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

// Dessert is informational (soft target) — callers decide whether to warn.
export function energyStatus(kcal, target) {
  if (!target) return 'ok';
  return kcal >= target ? 'ok' : 'under';
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS (existing inventory-labels tests still green).

- [ ] **Step 5: Commit**

```bash
git add assets/js/meals-logic.js test/meals-logic.test.js
git commit -m "Meals: tested quantity/calorie logic module"
```

---

## Chunk 2: API — roles helper + meals.js

### Task 2: `api/_lib/roles.js` (Kitchen-lead check)

**Files:**
- Create: `api/_lib/roles.js`

- [ ] **Step 1: Implement** — create `api/_lib/roles.js`:

```js
import { getRows } from './sheets.js';

// True if `member` (its Playa Name or legal Name) appears in the comma-separated
// AssignedTo of the Roles row whose Name matches `roleName` (case-insensitive).
// Reads the whole Roles tab per call (no caching) — consistent with other
// per-request sheet reads in this codebase; fine at this scale.
export async function isAssignedToRole(sheets, spreadsheetId, roleName, member) {
  if (!member) return false;
  const rows = await getRows(sheets, spreadsheetId, 'Roles');
  if (!rows.length) return false;
  const headers = rows[0];
  const nameCol = headers.indexOf('Name');
  const assignedCol = headers.indexOf('AssignedTo');
  if (nameCol === -1 || assignedCol === -1) return false;
  const target = (roleName || '').trim().toLowerCase();
  const playa = (member['Playa Name'] || '').trim().toLowerCase();
  const legal = (member.Name || '').trim().toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][nameCol] || '').trim().toLowerCase() !== target) continue;
    const assigned = (rows[i][assignedCol] || '').split(',').map(s => s.trim().toLowerCase());
    if ((playa && assigned.indexOf(playa) !== -1) || (legal && assigned.indexOf(legal) !== -1)) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 2: Syntax check** — `node --check api/_lib/roles.js` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add api/_lib/roles.js
git commit -m "Meals API: shared isAssignedToRole helper (Kitchen-lead check)"
```

### Task 3: `api/meals.js` — date optional, new fields, permission, canEdit

**Files:**
- Modify: `api/meals.js`

- [ ] **Step 1: Import the helper + widen headers.** At the top, after the existing `_lib` imports, add:

```js
import { isAssignedToRole } from './_lib/roles.js';
```

Replace the two header consts:

```js
    const MEAL_HEADERS = ['MealID', 'Name', 'Date', 'MealType', 'Description', 'Instructions'];
    const INGREDIENT_HEADERS = ['IngredientID', 'MealID', 'Name', 'Quantity', 'Unit'];
```

with:

```js
    const MEAL_HEADERS = ['MealID', 'Name', 'Date', 'MealType', 'Servings', 'Description', 'Instructions', 'PreCook', 'PhotoURL'];
    const INGREDIENT_HEADERS = ['IngredientID', 'MealID', 'Name', 'Quantity', 'Unit', 'Prep', 'KcalPerUnit'];
```

- [ ] **Step 2: Compute `canEdit` and return it on fetch.** Replace the fetch block:

```js
    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = auth.sheets;
      const [mealsRows, ingredientsRows, logisticsRows] = await Promise.all([
        safeGet(sheets, spreadsheetId, 'Meals'),
        safeGet(sheets, spreadsheetId, 'MealIngredients'),
        safeGet(sheets, spreadsheetId, 'MemberLogistics'),
      ]);
      return res.status(200).json({
        meals: toObjects(mealsRows),
        ingredients: toObjects(ingredientsRows),
        logistics: toObjects(logisticsRows),
      });
    }
```

with:

```js
    // ── Fetch (default) ───────────────────────────────────────────────────
    if (!action) {
      const sheets = auth.sheets;
      const [mealsRows, ingredientsRows, logisticsRows, kitchenLead] = await Promise.all([
        safeGet(sheets, spreadsheetId, 'Meals'),
        safeGet(sheets, spreadsheetId, 'MealIngredients'),
        safeGet(sheets, spreadsheetId, 'MemberLogistics'),
        isAssignedToRole(sheets, spreadsheetId, 'Kitchen lead', auth.member),
      ]);
      const canEdit = !auth.observer && (auth.admin || kitchenLead);
      return res.status(200).json({
        meals: toObjects(mealsRows),
        ingredients: toObjects(ingredientsRows),
        logistics: toObjects(logisticsRows),
        canEdit,
      });
    }
```

- [ ] **Step 3: Gate writes on admin∥Kitchen-lead, observer-first.** Replace:

```js
    // ── Write actions require admin ───────────────────────────────────────
    if (!auth.admin) {
      return res.status(401).json({ error: 'Admin required' });
    }

    const sheets = auth.sheets;
```

with:

```js
    // ── Write actions: admin or Kitchen lead; observers always read-only ──
    const sheets = auth.sheets;
    if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
    const kitchenLead = await isAssignedToRole(sheets, spreadsheetId, 'Kitchen lead', auth.member);
    if (!auth.admin && !kitchenLead) {
      return res.status(401).json({ error: 'Admin or Kitchen lead required' });
    }
```

- [ ] **Step 4: Make date optional + write new meal fields.** Replace the `upsert-meal` case:

```js
      case 'upsert-meal': {
        const { mealId, name, date, mealType, description, instructions } = payload;
        if (!mealId || !name || !date) return res.status(400).json({ error: 'mealId, name, date required' });
        await upsertRow(sheets, spreadsheetId, 'Meals', 'MealID', mealId, MEAL_HEADERS,
          [mealId, name, date, mealType || '', description || '', instructions || '']);
        break;
      }
```

with:

```js
      case 'upsert-meal': {
        const { mealId, name, date, mealType, servings, description, instructions, preCook, photoURL } = payload;
        if (!mealId || !name) return res.status(400).json({ error: 'mealId, name required' });
        await upsertRow(sheets, spreadsheetId, 'Meals', 'MealID', mealId, MEAL_HEADERS,
          [mealId, name, date || '', mealType || '', servings != null ? String(servings) : '',
           description || '', instructions || '', preCook || '', photoURL || '']);
        break;
      }
```

- [ ] **Step 5: Write new ingredient fields.** Replace the `upsert-ingredient` case:

```js
      case 'upsert-ingredient': {
        const { ingredientId, mealId, name, quantity, unit } = payload;
        if (!ingredientId || !mealId || !name) return res.status(400).json({ error: 'ingredientId, mealId, name required' });
        await upsertRow(sheets, spreadsheetId, 'MealIngredients', 'IngredientID', ingredientId, INGREDIENT_HEADERS,
          [ingredientId, mealId, name, quantity != null ? String(quantity) : '', unit || '']);
        break;
      }
```

with:

```js
      case 'upsert-ingredient': {
        const { ingredientId, mealId, name, quantity, unit, prep, kcalPerUnit } = payload;
        if (!ingredientId || !mealId || !name) return res.status(400).json({ error: 'ingredientId, mealId, name required' });
        await upsertRow(sheets, spreadsheetId, 'MealIngredients', 'IngredientID', ingredientId, INGREDIENT_HEADERS,
          [ingredientId, mealId, name, quantity != null ? String(quantity) : '', unit || '',
           prep || '', kcalPerUnit != null ? String(kcalPerUnit) : '']);
        break;
      }
```

- [ ] **Step 6: Verify** — `node --check api/meals.js` (exit 0) and `npm test` (10 logic + existing pass).

- [ ] **Step 7: Commit**

```bash
git add api/meals.js
git commit -m "Meals API: optional date, pre-cook/calorie/photo fields, Kitchen-lead edit + canEdit"
```

---

## Chunk 3: UI — meals.html + admin-meals.js

> The page is a large existing file. Make **targeted** changes; don't rewrite unrelated parts (the dietary panel, headcount chart, PDF export, shopping list stay). New behaviour reuses `meals-logic.js`.

### Task 4: `admin/meals.html` — counter, CSS, photo/prep markup, modal fields

**Files:**
- Modify: `admin/meals.html`

- [ ] **Step 1:** Add `<style>` rules (append inside the page's existing `<style>` block) for the headcount counter, energy strip, pre-cook callout/badge/toggle, and meal photo. (Use the classes from the approved mockup: `.ee`-equivalents renamed `meal-*`.) Exact CSS:

```css
.headcount-bar{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;flex-wrap:wrap}
.headcount-bar input{width:60px;background:var(--bg);border:1px solid var(--accent);border-radius:6px;color:var(--text);font-size:17px;font-weight:700;padding:3px 8px;text-align:center}
.headcount-bar .lab{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)}
.meal-photo{height:120px;background:#1a1a1a center/cover no-repeat;border-radius:10px 10px 0 0;position:relative}
.meal-photo .change-photo{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.6);border:1px solid #555;border-radius:6px;color:#fff;font-size:11px;padding:3px 9px;cursor:pointer}
.energy-strip{display:flex;align-items:center;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:7px 11px;margin:8px 0}
.energy-strip .kc{font-weight:700}.energy-strip .vs{font-size:12px;color:var(--text-muted)}
.energy-bar{flex:1;height:7px;background:#000;border-radius:5px;overflow:hidden;min-width:90px}
.energy-bar>i{display:block;height:100%}.energy-bar>i.ok{background:#5fae6a}.energy-bar>i.under{background:#e8a84c}
.energy-tag{font-size:11px;font-weight:700;border-radius:8px;padding:2px 8px}
.energy-tag.ok{background:#1d3a22;color:#5fae6a}.energy-tag.under{background:#3a3320;color:#e8a84c}
.precook-callout{background:rgba(91,192,222,.08);border:1px solid #2f5b66;border-left:3px solid #5bc0de;border-radius:8px;padding:8px 11px;margin:8px 0;font-size:12.5px}
.precook-callout b{color:#5bc0de}
tr.precook td{background:rgba(91,192,222,.06)}
.prep-toggle{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;border-radius:9px;padding:2px 8px;cursor:pointer;border:1px solid transparent;user-select:none}
.prep-toggle.pre{background:#11343d;color:#5bc0de;border-color:#2f5b66}
.prep-toggle.site{background:var(--surface2);color:var(--text-muted);border-color:var(--border)}
.prep-toggle:hover{border-color:var(--accent)}
```

- [ ] **Step 2:** Add the headcount counter markup immediately before the existing `#date-filter` element:

```html
<div class="headcount-bar">
  <span class="lab">Cooking for</span>
  <input type="number" id="headcount-input" min="1">
  <span class="lab">people</span>
  <button class="btn-secondary btn-sm" id="headcount-reset">⟳ Approved (<span id="approved-count">0</span>)</button>
  <span class="lab" style="margin-left:auto">per-person portions &amp; kcal don't change with this</span>
</div>
```

- [ ] **Step 3:** In the meal modal: add fields for Servings, PreCook, PhotoURL (Date already exists; remove its `required` if present), and in the existing `<select id="meal-type">` (≈ line 196) **replace the `snack` option with `dessert`** (the targets cover breakfast/lunch/dinner/dessert). In the ingredient modal, add Prep (select pre-cook/on-site) and KcalPerUnit. Match the existing modal markup; add inputs with ids `meal-servings`, `meal-precook`, `meal-photo`, `ingredient-prep`, `ingredient-kcal`. (The chart tooltip's now-dead `snack` branch is harmless; leave it.)

- [ ] **Step 4:** Add a "Prep-ahead" view container near the shopping list (e.g. after `#shopping-list-content`):

```html
<div id="prep-ahead-content"></div>
```

- [ ] **Step 5: Commit**

```bash
git add admin/meals.html
git commit -m "Meals UI: headcount counter, energy/pre-cook/photo styles + modal fields"
```

### Task 5: `assets/js/admin-meals.js` — wire the new behaviour

**Files:**
- Modify: `assets/js/admin-meals.js`

> Reference implementation below. Apply as described; keep the existing dietary panel, headcount chart, PDF export and shopping list intact.

- [ ] **Step 1:** Add the import as the first line of `admin-meals.js`. **REQUIRED first:** in `admin/meals.html`, change the script tag `<script src="/assets/js/admin-meals.js"></script>` (≈ line 245) to `<script type="module" src="/assets/js/admin-meals.js"></script>` — without this the top-level `import` throws and the page dies. (This mirrors `admin/inventory.html:150` + `admin-inventory.js`, which use the identical top-level-`import` + IIFE pattern. Keep `admin-auth.js` as a **classic** script loaded *before* the module — it defines `window.JH`; do not convert it or reorder.) The absolute import path is proven (the shipped `admin-early-entry.js` imports `/assets/js/early-entry-logic.js` this way):

```js
import { perPerson, scaledTotal, mealKcalPerPerson, targetFor, energyStatus, DAILY_TARGET } from '/assets/js/meals-logic.js';
```

- [ ] **Step 2:** Replace `var isAdmin = JH.isAdmin();` with edit state driven by the server's `canEdit` (default false until fetch):

```js
  var canEdit = false; // set from /api/meals fetch (admin or Kitchen lead)
```

Then in `fetchData()`, capture it: after `state.logistics = data.logistics || [];` add `canEdit = !!data.canEdit;`. Replace **every** `isAdmin` reference (current file lines 5, 151, 205, 224, 232, 245, 283, 714) with `canEdit`. **Important — line 714** (`if (isAdmin) document.getElementById('admin-controls').style.display = '';`) runs once at init *before* the first fetch, when `canEdit` is still false. **Move that `admin-controls` visibility toggle into `reload()`** (after `fetchData()` sets `canEdit`), e.g. `document.getElementById('admin-controls').style.display = canEdit ? '' : 'none';` — so the Add-Meal controls appear only after the server confirms edit rights.

- [ ] **Step 3:** Add headcount state + helpers near the top:

```js
  function approvedCount() {
    return members.filter(function (m) { return (JH.val(m, 'Status') || '').toLowerCase() === 'approved'; }).length;
  }
  state.headcount = approvedCount() || 30;
  function headcount() { return state.headcount; }
```

Wire the counter control (after first render / in init):

```js
  var hcInput = document.getElementById('headcount-input');
  document.getElementById('approved-count').textContent = approvedCount();
  hcInput.value = state.headcount;
  hcInput.addEventListener('input', function () {
    var n = parseInt(hcInput.value, 10);
    state.headcount = (!isNaN(n) && n > 0) ? n : approvedCount();
    renderMeals(); renderShoppingList(); renderPrepAhead();
  });
  document.getElementById('headcount-reset').addEventListener('click', function () {
    state.headcount = approvedCount() || 30; hcInput.value = state.headcount;
    renderMeals(); renderShoppingList(); renderPrepAhead();
  });
```

- [ ] **Step 4:** Replace `getHeadcount(dateStr)` usage in meal/ingredient math with the global `headcount()`. Specifically, in `renderMeals` and `renderShoppingList`, compute totals as `scaledTotal(ing.Quantity, meal.Servings, headcount())` and per-person as `perPerson(ing.Quantity, meal.Servings)` (from `meals-logic.js`) instead of the old `qty * headcount` per-person model. (Leave `renderHeadcountChart` — the logistics attendance chart — unchanged; it counts attendance, not quantities.)

- [ ] **Step 4b: Migrate the PDF export to the new quantity model.** The `btn-export-pdf` handler / `buildPrintHtml` (current file ≈ lines 488–558) computes `var qty = parseFloat(ing.Quantity) || 0; var total = qty * headcount;` against the **old per-person** model — with the new model (`Quantity` = total at `Servings`) this prints wrong numbers. Replace its per-person/total math with `perPerson(ing.Quantity, meal.Servings)` and `scaledTotal(ing.Quantity, meal.Servings, headcount())`, and source headcount from the counter (`headcount()`), not `getHeadcount(meal.Date)`. Update the "Total (Np)" column header to use `headcount()`. (Do NOT leave the export on the old model.)

- [ ] **Step 5:** Replace `renderMeals()` with a version that: groups by date **plus an "Unscheduled" group** (date-less meals first); renders a **photo banner**, inline **type dropdown** + **date picker**, **energy strip**, **pre-cook callout**, and an ingredient table with **Per-person / Total(headcount) / Unit / kcal-p / Prep-toggle** columns; highlights `Prep==='pre-cook'` rows. Full function:

```js
  function mealKcalLine(meal, ings) {
    var kc = Math.round(mealKcalPerPerson(ings, meal.Servings));
    var target = targetFor(meal.MealType);
    var soft = (meal.MealType || '').toLowerCase() === 'dessert';
    var status = energyStatus(kc, target);
    var pct = target ? Math.min(100, Math.round(kc / target * 100)) : 100;
    var tag = (!target || soft) ? '' :
      '<span class="energy-tag ' + status + '">' + (status === 'ok' ? '✓ enough' : '⚠ a bit light') + '</span>';
    return '<div class="energy-strip"><span class="kc">~' + kc + ' kcal/person</span>' +
      '<div class="energy-bar"><i class="' + status + '" style="width:' + pct + '%"></i></div>' +
      '<span class="vs">' + (target ? 'target ~' + target + ' (' + JH.esc(meal.MealType || '') + ')' : 'no target') + '</span>' + tag + '</div>';
  }

  function fmtNum(n) { return n === Math.floor(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''); }

  function mealCardHtml(meal) {
    var ings = state.ingredients.filter(function (i) { return i.MealID === meal.MealID; });
    var hc = headcount();
    var photo = meal.PhotoURL
      ? '<div class="meal-photo" style="background-image:url(\'' + JH.esc(meal.PhotoURL) + '\')">' + (canEdit ? '<button class="change-photo" data-meal-id="' + JH.esc(meal.MealID) + '">📷 Change</button>' : '') + '</div>'
      : '';
    var typeSel = canEdit
      ? '<select class="meal-type-inline" data-meal-id="' + JH.esc(meal.MealID) + '">' +
        ['breakfast', 'lunch', 'dinner', 'dessert'].map(function (t) {
          return '<option value="' + t + '"' + ((meal.MealType || '').toLowerCase() === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select>'
      : '<span class="meal-type-badge">' + JH.esc(meal.MealType || 'other') + '</span>';
    var dateCtl = canEdit
      ? '<input class="meal-date-inline datebox" data-meal-id="' + JH.esc(meal.MealID) + '" placeholder="📅 assign date" value="' + JH.esc(meal.Date || '') + '">'
      : '';

    var rows = ings.map(function (ing) {
      var pre = (ing.Prep || '').toLowerCase() === 'pre-cook';
      var pp = perPerson(ing.Quantity, meal.Servings);
      var tot = scaledTotal(ing.Quantity, meal.Servings, hc);
      var kcp = Math.round(perPerson(ing.Quantity, meal.Servings) * (parseFloat(ing.KcalPerUnit) || 0));
      var prepCtl = canEdit
        ? '<span class="prep-toggle ' + (pre ? 'pre' : 'site') + '" data-ingredient-id="' + JH.esc(ing.IngredientID) + '">' + (pre ? '❄ pre-cook' : 'on-site') + '</span>'
        : (pre ? '<span class="prep-toggle pre">❄ pre-cook</span>' : '<span class="prep-toggle site">on-site</span>');
      return '<tr' + (pre ? ' class="precook"' : '') + '>' +
        '<td>' + (pre ? '❄ ' : '') + JH.esc(ing.Name) + '</td>' +
        '<td>' + fmtNum(pp) + '</td><td><strong>' + fmtNum(tot) + '</strong></td><td>' + JH.esc(ing.Unit || '') + '</td>' +
        '<td style="color:var(--text-muted)">' + (kcp || '—') + '</td><td>' + prepCtl + '</td>' +
        (canEdit ? '<td><button class="btn-icon edit-ingredient-btn" data-ingredient-id="' + JH.esc(ing.IngredientID) + '" data-meal-id="' + JH.esc(ing.MealID) + '">&#9998;</button><button class="btn-icon danger delete-ingredient-btn" data-ingredient-id="' + JH.esc(ing.IngredientID) + '">&#10005;</button></td>' : '') +
        '</tr>';
    }).join('');

    var html = '<div class="meal-card" data-meal-id="' + JH.esc(meal.MealID) + '">' + photo + '<div style="padding:12px 14px">';
    html += '<div class="meal-card-header"><div class="meal-card-title"><h3>' + JH.esc(meal.Name) + '</h3>' + typeSel +
      '<span class="headcount-note">serves ~' + (parseInt(meal.Servings, 10) || 30) + '</span>' + dateCtl + '</div>';
    if (canEdit) html += '<div class="meal-card-actions"><button class="btn-secondary btn-sm edit-meal-btn" data-meal-id="' + JH.esc(meal.MealID) + '">Edit</button><button class="btn-danger btn-sm delete-meal-btn" data-meal-id="' + JH.esc(meal.MealID) + '">Delete</button></div>';
    html += '</div>';
    if (meal.Description) html += '<p class="meal-desc">' + JH.esc(meal.Description) + '</p>';
    html += mealKcalLine(meal, ings);
    if (meal.PreCook) html += '<div class="precook-callout"><b>❄ Pre-cook ahead:</b> ' + JH.esc(meal.PreCook) + '</div>';
    if (meal.Instructions) {
      html += '<button class="instructions-toggle" data-meal-id="' + JH.esc(meal.MealID) + '">Show instructions</button>';
      html += '<div class="instructions-text" id="instructions-' + JH.esc(meal.MealID) + '" style="display:none">' + JH.esc(meal.Instructions) + '</div>';
    }
    html += '<div class="ingredients-section"><div class="ingredients-header"><span>Ingredients</span>' +
      (canEdit ? '<button class="btn-secondary btn-sm add-ingredient-btn" data-meal-id="' + JH.esc(meal.MealID) + '">+ Add Ingredient</button>' : '') + '</div>';
    html += ings.length
      ? '<table class="ingredients-table"><thead><tr><th>Name</th><th>Per-person</th><th>Total (' + hc + ')</th><th>Unit</th><th>kcal/p</th><th>Prep</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div style="font-size:0.82rem;color:var(--text-muted);padding:6px 0">No ingredients yet.</div>';
    html += '</div></div></div>';
    return html;
  }

  function renderMeals() {
    var wrap = document.getElementById('meals-wrap');
    var withDate = state.meals.filter(function (m) { return m.Date; });
    var unscheduled = state.meals.filter(function (m) { return !m.Date; });
    if (!state.meals.length) {
      wrap.innerHTML = '<div class="empty-state">No meals yet.' + (canEdit ? ' Use "+ Add Meal".' : '') + '</div>';
      return;
    }
    var dates = {};
    withDate.forEach(function (m) { dates[m.Date] = true; });
    var sortedDates = Object.keys(dates).sort();
    var order = ['breakfast', 'lunch', 'dinner', 'dessert'];
    function sortMeals(a, b) {
      var ai = order.indexOf((a.MealType || '').toLowerCase()), bi = order.indexOf((b.MealType || '').toLowerCase());
      return (ai === -1 ? 9 : ai) - (bi === -1 ? 9 : bi);
    }
    var html = '';
    if ((activeFilter === 'all' || activeFilter === 'unscheduled') && unscheduled.length) {
      html += '<div class="meals-date-group"><div class="meals-date-heading">Unscheduled</div><div class="meal-cards">' +
        unscheduled.slice().sort(sortMeals).map(mealCardHtml).join('') + '</div></div>';
    }
    sortedDates.filter(function (d) { return activeFilter === 'all' || activeFilter === d; }).forEach(function (d) {
      var dayMeals = withDate.filter(function (m) { return m.Date === d; }).sort(sortMeals);
      var dayKcal = dayMeals.reduce(function (s, m) {
        return s + mealKcalPerPerson(state.ingredients.filter(function (i) { return i.MealID === m.MealID; }), m.Servings);
      }, 0);
      var dcls = dayKcal >= DAILY_TARGET ? '' : ' style="color:var(--accent)"';
      html += '<div class="meals-date-group"><div class="meals-date-heading">' + JH.esc(formatDate(d)) +
        '<span class="headcount-note"' + dcls + '>⚡ ~' + Math.round(dayKcal) + ' / ' + DAILY_TARGET + ' kcal/person</span></div>' +
        '<div class="meal-cards">' + dayMeals.map(mealCardHtml).join('') + '</div></div>';
    });
    wrap.innerHTML = html;
  }
```

- [ ] **Step 6:** Add inline handlers (in the existing `#meals-wrap` click/change delegation, guarded by `if (!canEdit) return;` after the instructions-toggle): the **prep-toggle** click (flip Prep + save), **change-photo** click (prompt for URL + save meal), plus `change` listeners for **meal-type-inline** and **meal-date-inline** (save meal). Each calls the meals API then `reload()`. Add a `change` delegation listener on `#meals-wrap`:

```js
  document.getElementById('meals-wrap').addEventListener('change', async function (e) {
    if (!canEdit) return;
    var sel = e.target.closest('.meal-type-inline');
    var dt = e.target.closest('.meal-date-inline');
    var el = sel || dt; if (!el) return;
    var meal = state.meals.find(function (m) { return m.MealID === el.dataset.mealId; });
    if (!meal) return;
    await saveMeal(Object.assign({}, meal, sel ? { MealType: sel.value } : { Date: dt.value }));
    await reload();
  });
```

Add a `saveMeal(meal)` helper that POSTs `upsert-meal` with all fields (`mealId, name, date, mealType, servings, description, instructions, preCook, photoURL`), and in the existing click delegation add (after the instructions-toggle block, before/with the `if (!canEdit) return;`):

```js
    var pt = e.target.closest('.prep-toggle');
    if (pt && canEdit) {
      var ing = state.ingredients.find(function (i) { return i.IngredientID === pt.dataset.ingredientId; });
      if (ing) { await saveIngredient(Object.assign({}, ing, { Prep: (ing.Prep || '').toLowerCase() === 'pre-cook' ? 'on-site' : 'pre-cook' })); await reload(); }
      return;
    }
    var cp = e.target.closest('.change-photo');
    if (cp && canEdit) {
      var m = state.meals.find(function (x) { return x.MealID === cp.dataset.mealId; });
      var url = prompt('Photo URL for "' + (m ? m.Name : '') + '":', m ? (m.PhotoURL || '') : '');
      if (url !== null && m) { await saveMeal(Object.assign({}, m, { PhotoURL: url })); await reload(); }
      return;
    }
```

Where `saveMeal`/`saveIngredient` map object fields to the API payload (camelCase), e.g.:

```js
  async function saveMeal(m) {
    return JH.apiFetch('/api/meals', { action: 'upsert-meal', mealId: m.MealID, name: m.Name, date: m.Date || '', mealType: m.MealType || '', servings: m.Servings || '', description: m.Description || '', instructions: m.Instructions || '', preCook: m.PreCook || '', photoURL: m.PhotoURL || '' });
  }
  async function saveIngredient(i) {
    return JH.apiFetch('/api/meals', { action: 'upsert-ingredient', ingredientId: i.IngredientID, mealId: i.MealID, name: i.Name, quantity: i.Quantity || '', unit: i.Unit || '', prep: i.Prep || '', kcalPerUnit: i.KcalPerUnit || '' });
  }
```

- [ ] **Step 7:** Update the meal & ingredient **modals**' open/save to include the new fields (`meal-servings`, `meal-precook`, `meal-photo`, optional date; `ingredient-prep`, `ingredient-kcal`). In `openMealModal`, populate them; in the meal save handler, send them via `saveMeal`-style payload and **drop the `!date` requirement** (only name required). In `openIngredientModal`/save, populate and send `prep` + `kcalPerUnit`.

- [ ] **Step 8:** Add `renderPrepAhead()` — aggregates every `Prep==='pre-cook'` ingredient across meals (name, total at `headcount()`, which meals) + each meal's `PreCook` note — into `#prep-ahead-content`; call it from `reload()`. In `renderDateFilter()`, after the "All" pill, **emit an "Unscheduled" pill (`data-date="unscheduled"`) only when `state.meals.some(m => !m.Date)`** — `uniqueSortedDates()` only returns dated meals, so without this the date-less meals have no filter entry. The existing `#date-filter` click handler already sets `activeFilter` from `data-date`, and `renderMeals` already honors `activeFilter==='unscheduled'`.

- [ ] **Step 9:** Verify — `node --check assets/js/admin-meals.js` (exit 0), `npm test` (still green).

- [ ] **Step 10: Commit**

```bash
git add admin/meals.html assets/js/admin-meals.js
git commit -m "Meals UI: headcount scaling, per-day+unscheduled view, pre-cook toggle, energy strip, photos, Kitchen-lead edit"
```

---

## Chunk 4: Seed script + docs

### Task 6: `scripts/seed-meals.mjs`

**Files:**
- Create: `scripts/seed-meals.mjs`

- [ ] **Step 1:** Create the seed with the full menu data object (quantities = PDF totals at Servings 30; Prep defaults; KcalPerUnit per ingredient from standard values; **PreCook/Instructions VERBATIM from the PDF**, jokes & profanity intact; representative PhotoURL per meal). Dry-run by default, `--apply` writes. It clears existing `Meals`/`MealIngredients` rows, then writes the new rows. Model the auth/boilerplate on `scripts/dump-meals.mjs`. The `MENU` array must encode every meal from the spec's table; mealId = slug of the name. Each ingredient gets `{ name, quantity, unit, prep, kcal }`. Use the flagged-item readings from the spec (Falafel 4.5 kg, Marinated chicken 5 kg, Pizza dough 60, dessert fruits blank qty, count items as pieces/heads).

> **Source PDF:** `/home/frank/Downloads/Telegram Desktop/liste-ingrédients-et-quantités-1.pdf` (read it with the Read tool — it's 8 pages). The exact verbatim recipe text for `preCook` comes from **pages 5–7** (Falafels & Meatballs → Pita Night; Marinated chicken #1 "for the dhal" → Dal & Mango; Marinated chicken #2 "for the couscous" → Couscous; Vegan + Meatlovers prep → Pizza Night). **Transcribe VERBATIM — keep all jokes and profanity** (the user explicitly required this). Ingredient quantities come from pages 1–4. Keep everything in the in-script data object.

- [ ] **Step 2: Dry-run** — `node scripts/seed-meals.mjs` → prints the meals/ingredients it would write and the rows it would clear; writes nothing.

- [ ] **Step 3: Review** the dry-run output against the PDF; fix any transcription errors.

- [ ] **Step 4: Apply** — `node scripts/seed-meals.mjs --apply` → writes to the live sheet. Then `node scripts/dump-meals.mjs` to confirm.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-meals.mjs
git commit -m "Meals: one-shot seed of the camp menu (verbatim recipes, kcal, pre-cook, photos)"
```

### Task 7: Docs + manual verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Update the Members-Sheet tab table rows for `Meals` and `MealIngredients` with the new columns, and add a note (near the Inventory write-tier note) that meal/ingredient editing is open to **admins + members in the "Kitchen lead" role** (server-enforced in `meals.js`), observers read-only.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Docs: meals new columns + Kitchen-lead write tier"
```

- [ ] **Step 3: Manual verification** (run the app from the worktree — `npm run dev`, http://localhost:3000/admin/meals):
  1. As an admin: counter defaults to approved count; changing it rescales totals; per-person & kcal/p stay fixed.
  2. Unscheduled group shows the seeded meals; assign a date + type inline → meal moves into that day; per-day kcal roll-up shows.
  3. Energy strip shows kcal/person vs target; "a bit light" on under-target dinners; dessert shows no warning.
  4. Click a Prep tag → flips pre-cook/on-site, row highlight + prep-ahead list update.
  5. Change photo → prompt sets the banner.
  6. Prep-ahead list aggregates all ❄ items + verbatim notes; recipe profanity intact.
  7. Permission: sign in as a Kitchen lead (Gautier/Edward) → can edit; as a non-admin non-lead → read-only (no edit controls; API rejects writes).

Record results. Use superpowers:systematic-debugging on any failure.

- [ ] **Step 4: Version bump** — feature → **minor** (`v0.2.1` → `v0.3.0`): update `package.json` and tag once verification passes and the user confirms.

---

## Done criteria

- `npm test` passes (meals-logic covered).
- `node --check` clean on `api/meals.js`, `api/_lib/roles.js`, `assets/js/admin-meals.js`.
- Meals: date-optional with per-day + Unscheduled view; headcount counter scales totals; per-person + kcal/person vs targets; per-ingredient pre-cook toggle + per-meal verbatim notes + prep-ahead list; photos; admin+Kitchen-lead edit, observers read-only.
- Seed loaded; `dump-meals.mjs` shows the 10 meals + ingredients.
- Still 12 `api/*.js` functions. CLAUDE.md updated.
