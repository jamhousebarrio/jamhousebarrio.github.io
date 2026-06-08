# Shift Point System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace clock-hours with admin-set point weights as the fairness currency on the Shifts page, so effort can be balanced across the camp regardless of how long each job takes.

**Architecture:** A new `ShiftWeights` Google Sheet tab stores one flat point weight per shift type plus a build-day and strike-day value. Two new actions on the existing `api/shifts.js` (`get-weights`, `set-weights`) read/write it — no new serverless function (stays at the 12/12 Vercel cap). All scoring math moves into a new pure, unit-tested module `assets/js/shift-points-logic.js` (mirrors `early-entry-logic.js` / `meals-logic.js`). The Shifts page gains an admin-only "⚖ Points" modal and re-ranks its leaderboard by points, keeping hours as a supporting detail.

**Tech Stack:** Vanilla ES modules in the browser, Node `--test` for unit tests, `@googleapis/sheets` via the shared `api/_lib/sheets.js` helpers.

**Spec:** `docs/superpowers/specs/2026-06-08-shift-points-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `assets/js/shift-points-logic.js` | Pure scoring math: weight index, per-type lookup, NoOrg-bounded build/strike day counts, per-member points + hours breakdown. No DOM/node globals. | **Create** |
| `test/shift-points-logic.test.js` | Unit tests for the module (`npm test`). | **Create** |
| `api/shifts.js` | Add `get-weights` / `set-weights` actions; sync the weight row on `rename-type`. | Modify |
| `admin/shifts.html` | "⚖ Points" button + modal markup; load `admin-shifts.js` as a module. | Modify |
| `assets/js/admin-shifts.js` | Fetch weights; Points modal logic; leaderboard ranks by points; hours-as-detail; delete-type weight cleanup. | Modify |
| `CLAUDE.md` | Document the `ShiftWeights` tab + a Change Enforcement rule. | Modify |

**Key integration facts (verified against current code):**
- `ShiftData` columns: `ShiftID, Name, Description, Date, StartTime, EndTime, AssignedTo, MaxPerSlot`. Shift "types" = rows grouped by `Name`.
- Logistics `NoOrgDates` is a comma-separated list of `YYYY-MM-DD` (parsed at `admin-shifts.js:718`). `ArrivalDate` / `DepartureDate` likewise.
- Current scoring lives inline in `computeContributions()` (`admin-shifts.js:584-622`): `setupDays = daysInclusive(arrival, MAIN_START-1)` when `arrival < MAIN_START`; `strikeDays = daysInclusive(MAIN_END+1, departure)` when `departure > MAIN_END`; `score = (setupDays+strikeDays)*8 + eventHours`.
- `_lib/sheets.js` exports `safeGet, toObjects, ensureTab, getSheetId, upsertRow, colToLetter` — reuse these; do **not** reinvent.
- `shifts.js` has a local 2-arg `getRows(sheets, spreadsheetId)` hardcoded to the `ShiftData` tab — leave it for `ShiftData`; read the weights tab with the imported `safeGet`.
- `admin-shifts.js` is loaded as a **plain** `<script>` today; pages that import modules (`meals.html:309`, `early-entry.html:60`) load their page JS with `type="module"` after the plain `admin-auth.js`. We follow that.

---

## Chunk 1: Pure scoring module (TDD)

### Task 1: Create `shift-points-logic.js` with the math

**Files:**
- Create: `assets/js/shift-points-logic.js`
- Test: `test/shift-points-logic.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/shift-points-logic.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/shift-points-logic.js'`.

- [ ] **Step 3: Write the module**

Create `assets/js/shift-points-logic.js`:

```js
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
  if (mins <= 0) mins += 24 * 60; // wrap past midnight
  return mins / 60;
}

// Turn raw ShiftWeights rows ({Kind, Name, Points}) into a fast lookup with
// defaults applied for the two day-values. Type points default per-lookup in
// typePoints(), so unknown types never need a row.
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `shift-points-logic` tests green, existing suites unaffected.

- [ ] **Step 5: Commit**

```bash
git add assets/js/shift-points-logic.js test/shift-points-logic.test.js
git commit -m "feat(shifts): pure shift-points scoring module + tests"
```

---

## Chunk 2: API — weight storage on `shifts.js`

### Task 2: Add `get-weights` and `set-weights` actions

**Files:**
- Modify: `api/shifts.js` (imports at top; new action blocks before the final `return res.status(400)`)

- [ ] **Step 1: Add the imports and tab constants**

At the top of `api/shifts.js`, after the existing two imports, add:

```js
import { safeGet, toObjects, ensureTab, getSheetId, upsertRow, colToLetter } from './_lib/sheets.js';
```

Below the existing `const TAB = 'ShiftData';` / `BASE_HEADERS` lines add:

```js
const WEIGHTS_TAB = 'ShiftWeights';
const WEIGHTS_HEADERS = ['Kind', 'Name', 'Points'];
```

- [ ] **Step 2: Add `get-weights` (any authed user)**

Insert this block among the other `if (action === ...)` blocks (e.g. right after the no-action fetch block):

```js
if (action === 'get-weights') {
  const rows = await safeGet(sheets, spreadsheetId, WEIGHTS_TAB);
  return res.status(200).json({ weights: toObjects(rows) });
}
```

- [ ] **Step 3: Add `set-weights` (admin only)**

Insert this block (e.g. after `get-weights`):

```js
if (action === 'set-weights') {
  if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
  const { types, buildPts, strikePts } = payload;

  await ensureTab(sheets, spreadsheetId, WEIGHTS_TAB);
  let rows = await safeGet(sheets, spreadsheetId, WEIGHTS_TAB);
  if (!rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${WEIGHTS_TAB}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [WEIGHTS_HEADERS] },
    });
    rows = [WEIGHTS_HEADERS];
  }

  // 1. Delete every existing Kind=type row (bottom-up so indices stay valid) —
  //    same deleteDimension pattern as delete-slot. build/strike rows are left
  //    in place and upserted below.
  const kindCol = rows[0].indexOf('Kind');
  const sheetId = await getSheetId(sheets, spreadsheetId, WEIGHTS_TAB);
  const typeRowIdxs = [];
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][kindCol] || '').toLowerCase() === 'type') typeRowIdxs.push(i);
  }
  typeRowIdxs.sort((a, b) => b - a);
  if (typeRowIdxs.length && sheetId !== null) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: typeRowIdxs.map(idx => ({
        deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } },
      })) },
    });
  }

  // 2. Append the supplied type rows.
  const typeRows = (types || [])
    .filter(t => t && t.name)
    .map(t => ['type', String(t.name), String(parseInt(t.points, 10) || 0)]);
  if (typeRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: WEIGHTS_TAB, valueInputOption: 'RAW',
      requestBody: { values: typeRows },
    });
  }

  // 3. Upsert the two day-value singletons by Kind.
  await upsertRow(sheets, spreadsheetId, WEIGHTS_TAB, 'Kind', 'build',
    WEIGHTS_HEADERS, ['build', '', String(parseInt(buildPts, 10) || 0)]);
  await upsertRow(sheets, spreadsheetId, WEIGHTS_TAB, 'Kind', 'strike',
    WEIGHTS_HEADERS, ['strike', '', String(parseInt(strikePts, 10) || 0)]);

  return res.status(200).json({ success: true });
}
```

- [ ] **Step 4: Manual smoke test against the dev server**

Run the dev server (`npm run dev`), then from the browser console while logged in as an admin:

```js
await (await JH.apiFetch('/api/shifts', { action: 'set-weights',
  types: [{ name: 'Cooking', points: 5 }, { name: 'Shit Ninja', points: 2 }],
  buildPts: 10, strikePts: 10 })).json();
await (await JH.apiFetch('/api/shifts', { action: 'get-weights' })).json();
```

Expected: `set-weights` → `{success:true}`; `get-weights` → `{weights:[{Kind:'type',Name:'Cooking',Points:'5'},{Kind:'type',Name:'Shit Ninja',Points:'2'},{Kind:'build',Name:'',Points:'10'},{Kind:'strike',Name:'',Points:'10'}]}` (order may vary). Re-run `set-weights` with only `Cooking` and confirm `Shit Ninja` is gone (delete-all-types worked).

- [ ] **Step 5: Commit**

```bash
git add api/shifts.js
git commit -m "feat(shifts): get-weights/set-weights actions for ShiftWeights tab"
```

### Task 3: Sync the weight row on `rename-type`

**Files:**
- Modify: `api/shifts.js` (inside the existing `if (action === 'rename-type')` block, after the `ShiftData` rename `batchUpdate` and before its `return`)

- [ ] **Step 1: Add the weight-row rename**

Just before the `return res.status(200).json({ success: true, updated: updates.length });` line in `rename-type`, insert:

```js
// Keep the type's ShiftWeights row in sync, or the weight orphans and the
// renamed type silently drops to the default. (Change Enforcement Rule.)
const wRows = await safeGet(sheets, spreadsheetId, WEIGHTS_TAB);
if (wRows.length) {
  const wKindCol = wRows[0].indexOf('Kind');
  const wNameCol = wRows[0].indexOf('Name');
  const wUpdates = [];
  for (let i = 1; i < wRows.length; i++) {
    if ((wRows[i][wKindCol] || '').toLowerCase() !== 'type') continue;
    if ((wRows[i][wNameCol] || '') !== oldName) continue;
    wUpdates.push({
      range: `${WEIGHTS_TAB}!${colToLetter(wNameCol)}${i + 1}`,
      values: [[newName]],
    });
  }
  if (wUpdates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId, requestBody: { valueInputOption: 'RAW', data: wUpdates },
    });
  }
}
```

- [ ] **Step 2: Manual smoke test**

With a `Cooking` weight set (from Task 2), rename `Cooking` → `Kitchen` via the edit-type modal on the Shifts page, then run `get-weights` in the console. Expected: the `type` row now reads `Name: 'Kitchen'`, points preserved.

- [ ] **Step 3: Commit**

```bash
git add api/shifts.js
git commit -m "feat(shifts): rename-type also renames its ShiftWeights row"
```

---

## Chunk 3: Frontend — Points modal, points leaderboard, hours detail

### Task 4: Load the module + fetch weights

**Files:**
- Modify: `admin/shifts.html:216` (script tag → module)
- Modify: `assets/js/admin-shifts.js` (import; `weights`/`weightIndex` state; `fetchWeights`; include in `reload`)

- [ ] **Step 1: Make the page JS a module**

In `admin/shifts.html`, change line 216 from:

```html
<script src="/assets/js/admin-shifts.js"></script>
```

to:

```html
<script type="module" src="/assets/js/admin-shifts.js"></script>
```

- [ ] **Step 2: Import the module and add weight state**

At the very top of `assets/js/admin-shifts.js` (line 1, before the IIFE), add:

```js
import { buildWeightIndex, typePoints, durationHours, memberPoints } from '/assets/js/shift-points-logic.js';
```

Inside the IIFE, alongside `var shifts = [];` / `var logistics = [];`, add:

```js
var weights = [];
var weightIndex = buildWeightIndex([]);
```

- [ ] **Step 3: Add `fetchWeights` and call it in `reload`**

Add next to `fetchLogistics`:

```js
async function fetchWeights() {
  var r = await JH.apiFetch('/api/shifts', { action: 'get-weights' });
  if (!r.ok) { weights = []; weightIndex = buildWeightIndex([]); return; }
  var data = await r.json();
  weights = data.weights || [];
  weightIndex = buildWeightIndex(weights);
}
```

In `reload`, change the `Promise.all` to include it:

```js
await Promise.all([fetchShifts(), fetchLogistics(), fetchWeights()]);
```

- [ ] **Step 4: Verify the page still loads**

Run `npm run dev`, open `/admin/shifts.html` as admin. Expected: grid + leaderboard render exactly as before (no behavior change yet); no console errors (confirms the module + `import` resolve and the script-as-module conversion is clean).

- [ ] **Step 5: Commit**

```bash
git add admin/shifts.html assets/js/admin-shifts.js
git commit -m "feat(shifts): load points module + fetch weights"
```

### Task 5: Re-rank the leaderboard by points; hours as detail

**Files:**
- Modify: `assets/js/admin-shifts.js` — `computeContributions` (lines ~584-622), `renderRow` (~629-641), and the vol-modal event section (~740-755)

- [ ] **Step 1: Replace `computeContributions` scoring with the module**

Replace the body of `computeContributions` so it delegates the math to `memberPoints`. Keep the existing per-member name/logistics resolution; build `eventShifts` from the member's signed-up shifts within the event window, then call the module:

```js
function computeContributions() {
  return approvedMembers.map(function (m) {
    var name = displayName(m);
    if (!name) return null;
    var log = logisticsFor(name) || logisticsFor(JH.val(m, 'Name'));

    var eventShifts = shiftsForMember(m).filter(function (s) {
      var dt = parseDate(s.Date);
      return dt && dt >= MAIN_START && dt <= MAIN_END;
    });

    var r = memberPoints({
      arrivalDate: log ? log.ArrivalDate : '',
      departureDate: log ? log.DepartureDate : '',
      noOrgDates: log ? log.NoOrgDates : '',
      eventShifts: eventShifts,
      index: weightIndex,
    });

    return {
      name: name,
      setupDays: r.buildDays,
      strikeDays: r.strikeDays,
      eventHours: r.eventHours,
      eventPoints: r.eventPoints,
      buildPoints: r.buildPoints,
      strikePoints: r.strikePoints,
      score: r.points,
    };
  }).filter(Boolean);
}
```

> Note: `shiftsForMember` (defined at ~691) already resolves playa/legal names; reusing it removes the duplicate `hoursByKey` accumulation the old function did. `MAIN_START`/`MAIN_END` here are the existing module-local `Date` consts in `admin-shifts.js` (lines 15-16) — identical to the module's, so no change needed.

- [ ] **Step 2a: Widen the `.lb-row` grid to fit the new score column**

`renderRow` is about to add a 4th child (`.lb-score`), but `.lb-row` is a **3-column** CSS grid (`admin/shifts.html:73`: `grid-template-columns: 28px 1fr auto`). A 4th grid child would wrap and break the layout. In `admin/shifts.html`'s `<style>` block, change the `.lb-row` rule's columns and add a `.lb-score` rule right after `.lb-name` (line ~79):

```css
.lb-row { display: grid; grid-template-columns: 28px 1fr auto auto; gap: 10px; align-items: center; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.lb-score { font-family: var(--heading); font-weight: 700; font-size: 0.9rem; color: var(--accent); white-space: nowrap; }
.lb-score strong { font-size: 1.05rem; }
```

(Only the `grid-template-columns` value changed in `.lb-row` — `28px 1fr auto` → `28px 1fr auto auto`. Leave the rest of the rule as-is.)

- [ ] **Step 2b: Show points in the leaderboard row, hours as detail**

In `renderRow`, change the stats line so points lead and hours trail:

```js
function renderRow(entry, rank, isTop) {
  var rankClass = isTop && rank <= 3 ? ' top-' + rank : '';
  var stats = [];
  if (entry.setupDays) stats.push('<strong>' + entry.setupDays + 'd</strong> build');
  if (entry.strikeDays) stats.push('<strong>' + entry.strikeDays + 'd</strong> strike');
  if (entry.eventPoints) stats.push('<strong>' + entry.eventPoints + '</strong> event pts');
  if (entry.eventHours) stats.push('<span style="opacity:0.7">' + fmtHours(entry.eventHours) + '</span>');
  if (!stats.length) stats.push('<em style="opacity:0.6">no contribution logged</em>');
  return '<div class="lb-row vol-open-btn' + rankClass + '" data-name="' + JH.esc(entry.name) + '" title="Click for breakdown">' +
    '<div class="lb-rank">' + rank + '</div>' +
    '<div class="lb-name">' + JH.esc(entry.name) + '</div>' +
    '<div class="lb-score"><strong>' + entry.score + '</strong> pts</div>' +
    '<div class="lb-stats">' + stats.join(' · ') + '</div>' +
    '</div>';
}
```

(The `.lb-score` rule and the widened grid were added in Step 2a, so this 4th child lands in its own column.)

- [ ] **Step 3a: Widen the `.vol-shift-row` grid for the points span**

Same trap as the leaderboard row: `.vol-shift-row` is a **3-column** grid (`admin/shifts.html:86`: `grid-template-columns: 1fr auto auto`) and Step 3b adds a 4th span. In `admin/shifts.html`'s `<style>`, change that rule's columns and add a `.vol-shift-pts` rule:

```css
.vol-shift-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 10px; padding: 4px 0; }
.vol-shift-row .vol-shift-pts { color: var(--accent); font-weight: 600; font-size: 0.8rem; white-space: nowrap; }
```

(Only `grid-template-columns` changed: `1fr auto auto` → `1fr auto auto auto`.)

- [ ] **Step 3b: Annotate each event shift with points in the vol modal**

In `openVolModal`, where `eventBody` is built (~745), add the per-shift point weight next to the time:

```js
var eventBody = eventShifts.length
  ? eventShifts.map(function (s) {
      var t = slotLabel(s.StartTime, s.EndTime) || '—';
      var pts = typePoints(weightIndex, s.Name);
      return '<div class="vol-shift-row"><span>' + JH.esc(s.Name || '') + '</span>' +
        '<span class="vol-shift-time">' + JH.esc(t) + '</span>' +
        '<span class="vol-shift-date">' + JH.esc(JH.formatDateLong(s.Date)) + '</span>' +
        '<span class="vol-shift-pts">' + pts + ' pts</span></div>';
    }).join('')
  : '<span class="muted">No event shifts signed up for.</span>';
```

Also update that section's meta to show points with hours as detail:

```js
body += section(
  'Event shifts',
  eventBody,
  eventShifts.reduce(function (sum, s) { return sum + typePoints(weightIndex, s.Name); }, 0) +
    ' pts' + (eventHours ? ' · ' + fmtHours(eventHours) : '')
);
```

- [ ] **Step 4: Update the stale leaderboard lede**

The panel lede still describes the old hours model (`admin/shifts.html:151`). Change it to:

```html
<p class="panel-lede">Ranked by points. Build/strike days earn points per day present (NoOrg days excluded); each event shift earns its type's point weight. Hours shown as a detail.</p>
```

- [ ] **Step 5: Verify in the running app**

Run `npm run dev`. On `/admin/shifts.html`: set some weights via the console `set-weights` call from Task 2, reload, and confirm the leaderboard now ranks by points (a member on a 15-min Shit Ninja shift with weight 2 outranks a longer-but-cheaper shift), each row shows `N pts` with hours dimmed, and the volunteer modal shows `Cooking … 5 pts` rows.

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin-shifts.js admin/shifts.html
git commit -m "feat(shifts): leaderboard ranks by points, hours shown as detail"
```

### Task 6: The "⚖ Points" admin modal

**Files:**
- Modify: `admin/shifts.html` — add the button near `#add-shift-btn` and the modal markup near the other modals
- Modify: `assets/js/admin-shifts.js` — open/populate/save logic

- [ ] **Step 1: Add the button + modal markup**

In `admin/shifts.html`, add the button to the existing toolbar row (the `div` holding `#add-shift-btn` / `#print-shifts-btn`, line ~144), styled with the **same `.add-type-btn`** class those buttons use so it matches the toolbar. Admins-only visibility is handled in JS like `add-shift-btn`:

```html
<button class="add-type-btn" id="points-btn" style="display:none;flex:1">⚖ Points</button>
```

Near the other modal overlays (after the `#add-modal` block), add the modal. **Match this page's real modal conventions** (verified against `#add-modal`, `admin/shifts.html:156-179`): title is an `<h2>` (the `.modal h2` rule at line 92 supplies the accent color + close-button float), the save button is `.btn-primary` (line 99 — there is **no** `.primary` class), and there is **no global `.muted`** class (the only `.muted` is scoped `.vol-list .muted`), so muted text uses inline `color:var(--text-muted)`:

```html
<!-- Points (weights) modal -->
<div class="modal-overlay" id="points-modal">
  <div class="modal">
    <h2>Set point weights <button class="modal-close" id="points-modal-close">&times;</button></h2>
    <p class="panel-lede" style="margin:0">Points are the fairness currency. Build/strike count per day present (NoOrg days excluded). Unset types default to 1.</p>
    <div class="pts-day-row">
      <label>Build day <input type="number" min="0" step="1" id="pts-build"> pts/day</label>
      <label>Strike day <input type="number" min="0" step="1" id="pts-strike"> pts/day</label>
    </div>
    <div id="pts-types-list"></div>
    <div class="modal-actions">
      <button id="points-save" class="btn-primary">Save</button>
      <span id="points-msg" class="msg"></span>
    </div>
  </div>
</div>
```

> `.panel-lede` (line 67) is reused for the helper text since it's already the muted-small-text style on this page. Add these page-scoped layout rules to the `<style>` block (the type list can be long, so cap its height and scroll):

```css
.pts-day-row { display: flex; gap: 16px; flex-wrap: wrap; }
.pts-day-row label, .pts-type-row label { font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
.pts-day-row input, .pts-type-row input { width: 60px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--body); font-size: 0.85rem; padding: 6px 8px; }
.pts-type-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 0; border-top: 1px solid var(--border); }
#pts-types-list { max-height: 320px; overflow-y: auto; margin-top: 4px; }
```

- [ ] **Step 2: Wire open/populate**

In `admin-shifts.js`, near the other modal setup, add:

```js
if (isAdmin) document.getElementById('points-btn').style.display = '';

var pointsModal = document.getElementById('points-modal');

function openPointsModal() {
  document.getElementById('pts-build').value = weightIndex.buildPts;
  document.getElementById('pts-strike').value = weightIndex.strikePts;
  var list = document.getElementById('pts-types-list');
  var types = getShiftTypes();
  if (!types.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-style:italic;padding:8px 0">No shift types yet.</div>';
  } else {
    list.innerHTML = types.map(function (t) {
      var key = t.name.toLowerCase().trim();
      var hasWeight = Object.prototype.hasOwnProperty.call(weightIndex.types, key);
      var val = hasWeight ? weightIndex.types[key] : 1;
      return '<div class="pts-type-row">' +
        '<label>' + JH.esc(t.name) + (hasWeight ? '' : ' <span style="opacity:0.6;font-style:italic">(default)</span>') + '</label>' +
        '<input type="number" min="0" step="1" class="pts-type-input" data-name="' + JH.esc(t.name) + '" value="' + val + '"></div>';
    }).join('');
  }
  document.getElementById('points-msg').textContent = '';
  pointsModal.classList.add('active');
}

document.getElementById('points-btn').addEventListener('click', openPointsModal);
document.getElementById('points-modal-close').addEventListener('click', function () { pointsModal.classList.remove('active'); });
pointsModal.addEventListener('click', function (e) { if (e.target === pointsModal) pointsModal.classList.remove('active'); });
```

- [ ] **Step 3: Wire save**

```js
document.getElementById('points-save').addEventListener('click', async function () {
  var msg = document.getElementById('points-msg');
  msg.textContent = 'Saving...'; msg.style.color = '#888';
  var types = [];
  document.querySelectorAll('.pts-type-input').forEach(function (inp) {
    types.push({ name: inp.dataset.name, points: parseInt(inp.value, 10) || 0 });
  });
  var buildPts = parseInt(document.getElementById('pts-build').value, 10) || 0;
  var strikePts = parseInt(document.getElementById('pts-strike').value, 10) || 0;
  var r = await JH.apiFetch('/api/shifts', { action: 'set-weights', types: types, buildPts: buildPts, strikePts: strikePts });
  if (!r.ok) {
    var err = 'Failed.';
    try { var j = await r.json(); if (j && j.error) err = j.error; } catch (e) {}
    msg.textContent = err; msg.style.color = '#f44336'; return;
  }
  pointsModal.classList.remove('active');
  await reload(); // refetches weights + re-ranks the leaderboard
});
```

- [ ] **Step 4: Verify end-to-end in the app**

Run `npm run dev`. As admin: click **⚖ Points**, confirm every shift type is listed (unset ones flagged "(default)") with build/strike inputs prefilled at 10. Change Shit Ninja to 3, Build to 12, Save. Confirm the modal closes, the leaderboard re-ranks, and reopening the modal shows the saved values (no longer "(default)" for Shit Ninja). Log in as a non-admin and confirm the **⚖ Points** button is hidden.

- [ ] **Step 5: Commit**

```bash
git add admin/shifts.html assets/js/admin-shifts.js
git commit -m "feat(shifts): admin Points modal to set type/build/strike weights"
```

### Task 7: Clean up the weight row when a type is deleted

**Files:**
- Modify: `assets/js/admin-shifts.js` — both delete-type paths (the grid `delete-type-btn` handler ~281-291 and the modal `delete-type-btn` handler ~406-420)

- [ ] **Step 1: Add a best-effort cleanup helper**

Add near the other helpers:

```js
// After a type's shifts are all deleted, drop its weight row so it doesn't
// linger. Best-effort: re-save the surviving types (set-weights deletes all
// type rows then rewrites), keeping the current build/strike values. An orphan
// row is harmless (the type no longer exists), so failures are ignored.
async function cleanupWeightsAfterDelete() {
  var surviving = getShiftTypes().map(function (t) {
    var key = t.name.toLowerCase().trim();
    var pts = Object.prototype.hasOwnProperty.call(weightIndex.types, key) ? weightIndex.types[key] : 1;
    return { name: t.name, points: pts };
  });
  try {
    await JH.apiFetch('/api/shifts', { action: 'set-weights', types: surviving, buildPts: weightIndex.buildPts, strikePts: weightIndex.strikePts });
  } catch (e) { /* harmless if it fails */ }
}
```

- [ ] **Step 2: Call it after each delete-type loop**

In the grid `delete-type-btn` handler, after the `for` loop deleting `typeShifts` and before `await reload();`, the local `shifts` array is stale, so refresh it first:

```js
await fetchShifts();        // so getShiftTypes() reflects the deletion
await cleanupWeightsAfterDelete();
await reload();
```

Apply the same three lines (replacing the existing `await reload();`) in the modal `#delete-type-btn` handler.

- [ ] **Step 3: Verify**

Run `npm run dev`. Set a weight for a throwaway type, delete that type, then run `get-weights` in the console. Expected: no `type` row remains for the deleted name; other types' weights and build/strike values are unchanged.

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin-shifts.js
git commit -m "feat(shifts): drop weight row when a shift type is deleted"
```

---

## Chunk 4: Docs + final verification

### Task 8: Document the tab and the enforcement rule

**Files:**
- Modify: `CLAUDE.md` (Members-sheet tab table; Change Enforcement Rules section)

- [ ] **Step 1: Add `ShiftWeights` to the Members Sheet tab table**

In the `### Members Sheet (SHEET_ID)` table, add a row:

```
| ShiftWeights | shifts.js | Point weights for the fairness leaderboard. Cols: Kind (type/build/strike), Name (type name; blank for build/strike), Points. Defaults applied in shift-points-logic.js: type=1, build/strike=10. |
```

And add a note under the table, mirroring the existing Inventory/Meals notes:

```
> Shift point weights live in the ShiftWeights tab and are set via the admin-only "⚖ Points" modal on the Shifts page (`set-weights` action; `get-weights` is open to any authed user since the leaderboard needs it). Points replace clock hours as the leaderboard's ranking currency; hours remain a displayed detail. Build/strike days earn points per day present, **minus** any NoOrg days in that member's build/strike window. Pure scoring math (incl. defaults type=1, build/strike=10) is in `assets/js/shift-points-logic.js`, unit-tested via `npm test`.
```

- [ ] **Step 2: Add the Change Enforcement Rule**

Under `## Change Enforcement Rules`, add:

```
- **If you rename or delete a shift type** → its `ShiftWeights` row must follow: `rename-type` renames it server-side (`api/shifts.js`); type deletion re-saves weights client-side (`cleanupWeightsAfterDelete` in `admin-shifts.js`). Skipping this orphans the weight or silently drops the type to the default (1 pt).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document ShiftWeights tab + shift-type rename/delete enforcement"
```

### Task 9: Full verification pass

- [ ] **Step 1: Run the unit suite**

Run: `npm test`
Expected: PASS — `shift-points-logic` plus all pre-existing suites green.

- [ ] **Step 2: End-to-end smoke on the running app**

Run `npm run dev`, then as admin on `/admin/shifts.html`:
1. **⚖ Points** → set Cooking=5, Shit Ninja=2, Build=12, Strike=8, Save.
2. Sign a member up for a Shit Ninja slot; confirm they gain 2 pts (not 0.25h-worth) and the leaderboard re-ranks.
3. Give a member an early arrival + a NoOrg build day in logistics; confirm their build days = (present − NoOrg) × 12 in the volunteer modal.
4. Rename a weighted type; confirm the weight survives (`get-weights`).
5. Delete a weighted type; confirm its weight row is gone.
6. Confirm the volunteer modal shows each event shift's `N pts` and the hours detail.
7. Log in as a non-admin: **⚖ Points** button hidden; leaderboard still shows points (read-only).

- [ ] **Step 3: Confirm no regressions to the existing grid**

Verify add/edit/delete shift type, slot signup/remove, cap/override, and the print/PDF export all still work unchanged.

- [ ] **Step 4: Suggest a version bump**

Per the project's release discipline, this is a feature → suggest a **minor** version bump (currently `0.6.0` in `package.json`) and summarize the change for release notes.

---

## Notes for the implementer

- **DRY:** `parseDate` is imported from `early-entry-logic.js` (the canonical parser) — do not add a third copy. `durationHours` now lives in the module; the inline copy in `admin-shifts.js` (lines ~53-60) can be left as-is (still used by the print/PDF path) or swapped to the import — not required by this plan.
- **YAGNI:** No per-slot weights, no NoOrg point tracking, no weight-change audit log (explicitly out of scope in the spec).
- **12-function cap:** Do **not** add an `api/*.js` file. All weight logic is actions on `shifts.js`.
- **Module conversion risk:** Converting `admin-shifts.js` to `type="module"` is the one structural change. It defers like the current end-of-body script and `window.JH` (from the plain `admin-auth.js`) stays available — same setup `meals.html` and `early-entry.html` already use. Verify no console errors in Task 4 Step 4 before building on it.
