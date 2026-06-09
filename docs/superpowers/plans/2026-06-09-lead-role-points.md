# Lead / Role Points Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Award fairness-leaderboard points to members holding a Roles-tab role (default 10 pts/role, admin-editable), summed across roles, and surface the full point math in the per-person breakdown popup.

**Architecture:** Reuse the existing `ShiftWeights` tab with a new `Kind='role'` row type (mirrors `Kind='type'`). Pure scoring lives in `assets/js/shift-points-logic.js` (unit-tested). Role weights are edited in the existing ⚖ Points modal; role assignments come from the `Roles` tab (`AssignedTo`, matched by playa/legal name — the same rule as `api/_lib/roles.js`).

**Tech Stack:** Vanilla JS ES modules, Node's built-in test runner (`node --test`), Vercel serverless (`api/shifts.js`), Google Sheets.

**Decisions (from brainstorm):**
- Every role in the Roles tab gets an editable weight, default **10**. Admin sets non-lead roles (Decor, Shit Ninja, Financial genious) to 0 to exclude.
- A member holding multiple roles earns the **sum** of their role weights.
- Breakdown popup shows per-line point math + a bold grand total.
- "Shit Ninja" is both a role and a shift type; they score independently by design.

---

## Chunk 1: Pure scoring logic

### Task 1: Role weights in `buildWeightIndex` + `rolePoints`

**Files:**
- Modify: `assets/js/shift-points-logic.js`
- Test: `test/shift-points-logic.test.js`

- [ ] **Step 1: Write failing tests**

Add to `test/shift-points-logic.test.js` (import `rolePoints` and `DEFAULT_ROLE_POINTS` in the existing import block):

```js
test('DEFAULT_ROLE_POINTS is 10', () => {
  assert.equal(DEFAULT_ROLE_POINTS, 10);
});

test('buildWeightIndex: reads role rows into index.roles', () => {
  const idx = buildWeightIndex([
    { Kind: 'role', Name: 'Barrio Lead', Points: '15' },
    { Kind: 'role', Name: 'Decor', Points: '0' },
  ]);
  assert.equal(idx.roles['barrio lead'], 15);
  assert.equal(idx.roles['decor'], 0);
});

test('rolePoints: configured wins, unset defaults to 10, case-insensitive', () => {
  const idx = buildWeightIndex([{ Kind: 'role', Name: 'Barrio Lead', Points: '15' }]);
  assert.equal(rolePoints(idx, 'barrio lead'), 15);
  assert.equal(rolePoints(idx, 'BARRIO LEAD'), 15);
  assert.equal(rolePoints(idx, 'Consent Lead'), DEFAULT_ROLE_POINTS); // unset -> 10
  assert.equal(rolePoints(idx, 'Decor'), 0); // explicit 0 is NOT default
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/shift-points-logic.test.js`
Expected: FAIL — `rolePoints`/`DEFAULT_ROLE_POINTS` not exported.

- [ ] **Step 3: Implement**

In `assets/js/shift-points-logic.js`, add the constant near the other defaults:

```js
export const DEFAULT_ROLE_POINTS = 10;   // a role with no configured weight
```

In `buildWeightIndex`, add a `roles` map alongside `types`:

```js
export function buildWeightIndex(weightRows) {
  const types = {};
  const roles = {};
  let buildPts = DEFAULT_DAY_POINTS;
  let strikePts = DEFAULT_DAY_POINTS;
  (weightRows || []).forEach(function (w) {
    const kind = (w.Kind || '').toString().toLowerCase().trim();
    const pts = parseInt(w.Points, 10);
    if (isNaN(pts)) return;
    if (kind === 'type') types[(w.Name || '').toString().toLowerCase().trim()] = pts;
    else if (kind === 'role') roles[(w.Name || '').toString().toLowerCase().trim()] = pts;
    else if (kind === 'build') buildPts = pts;
    else if (kind === 'strike') strikePts = pts;
  });
  return { types: types, roles: roles, buildPts: buildPts, strikePts: strikePts };
}
```

Add `rolePoints` mirroring `typePoints` (note the default differs — 10, not 1):

```js
export function rolePoints(index, roleName) {
  const key = (roleName || '').toString().toLowerCase().trim();
  if (index && index.roles && Object.prototype.hasOwnProperty.call(index.roles, key)) {
    return index.roles[key];
  }
  return DEFAULT_ROLE_POINTS;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test test/shift-points-logic.test.js` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/js/shift-points-logic.js test/shift-points-logic.test.js
git commit -m "feat(shifts): role point weights in buildWeightIndex + rolePoints"
```

### Task 2: Role points in `memberPoints`

**Files:**
- Modify: `assets/js/shift-points-logic.js`
- Test: `test/shift-points-logic.test.js`

- [ ] **Step 1: Write failing tests**

```js
test('memberPoints: sums role points into total', () => {
  const idx = buildWeightIndex([
    { Kind: 'role', Name: 'Barrio Lead', Points: '10' },
    { Kind: 'role', Name: 'Build lead', Points: '10' },
  ]);
  const r = memberPoints({
    arrivalDate: '', departureDate: '', noOrgDates: '',
    eventShifts: [], roleNames: ['Barrio Lead', 'Build lead'], index: idx,
  });
  assert.equal(r.rolePoints, 20);
  assert.equal(r.points, 20);
});

test('memberPoints: unconfigured role defaults to 10', () => {
  const idx = buildWeightIndex([]);
  const r = memberPoints({
    arrivalDate: '', departureDate: '', noOrgDates: '',
    eventShifts: [], roleNames: ['Consent Lead'], index: idx,
  });
  assert.equal(r.rolePoints, 10);
});

test('memberPoints: no roles -> 0 role points', () => {
  const idx = buildWeightIndex([]);
  const r = memberPoints({
    arrivalDate: '', departureDate: '', noOrgDates: '', eventShifts: [], index: idx,
  });
  assert.equal(r.rolePoints, 0);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test test/shift-points-logic.test.js`
Expected: FAIL — `r.rolePoints` is undefined.

- [ ] **Step 3: Implement**

In `memberPoints`, update the index default to include `roles: {}`:

```js
  const index = args.index || { types: {}, roles: {}, buildPts: DEFAULT_DAY_POINTS, strikePts: DEFAULT_DAY_POINTS };
```

After the `eventShifts` loop, add role-point summation:

```js
  let rolePts = 0;
  (args.roleNames || []).forEach(function (rn) {
    rolePts += rolePoints(index, rn);
  });
```

Update the return object:

```js
  return {
    buildDays: buildDays,
    strikeDays: strikeDays,
    buildPoints: buildPoints,
    strikePoints: strikePoints,
    eventPoints: eventPoints,
    eventHours: eventHours,
    rolePoints: rolePts,
    points: buildPoints + strikePoints + eventPoints + rolePts,
  };
```

- [ ] **Step 4: Run full suite, verify pass**

Run: `npm test` → all PASS (existing 14 + new 6).

- [ ] **Step 5: Commit**

```bash
git add assets/js/shift-points-logic.js test/shift-points-logic.test.js
git commit -m "feat(shifts): fold role points into memberPoints total"
```

---

## Chunk 2: Backend persistence

### Task 3: `set-weights` persists `Kind='role'` rows

**Files:**
- Modify: `api/shifts.js` (the `set-weights` block, ~lines 76-134)

**Why backward-compat matters:** `cleanupWeightsAfterDelete` in `admin-shifts.js` calls `set-weights` WITHOUT a `roles` field. Role-row replacement MUST therefore be guarded on `Array.isArray(roles)` so that call leaves role rows untouched. (Type rows stay unconditional — `types` is already required.)

- [ ] **Step 1: Implement role handling**

In the `set-weights` block, destructure `roles`:

```js
      const { types, roles, buildPts, strikePts } = payload;
      if (!Array.isArray(types)) return res.status(400).json({ error: 'types array required' });
```

After the existing type append (step 2) and BEFORE the build/strike upsert (step 3), insert a guarded role-replace block. Re-read rows fresh so indices are correct after the type delete/append mutated the sheet:

```js
      // 2b. If `roles` provided, full-replace Kind=role rows (same pattern as
      //     types). Guarded on Array so callers that omit roles (e.g.
      //     cleanupWeightsAfterDelete) don't wipe them. Re-read for fresh indices.
      if (Array.isArray(roles)) {
        const rRows = await safeGet(sheets, spreadsheetId, WEIGHTS_TAB);
        const rKindCol = rRows[0].indexOf('Kind');
        const roleRowIdxs = [];
        for (let i = 1; i < rRows.length; i++) {
          if ((rRows[i][rKindCol] || '').toLowerCase() === 'role') roleRowIdxs.push(i);
        }
        roleRowIdxs.sort((a, b) => b - a);
        if (roleRowIdxs.length && sheetId !== null) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: roleRowIdxs.map(idx => ({
              deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } },
            })) },
          });
        }
        const roleRows = roles
          .filter(t => t && t.name)
          .map(t => ['role', String(t.name), String(parseInt(t.points, 10) || 0)]);
        if (roleRows.length) {
          await sheets.spreadsheets.values.append({
            spreadsheetId, range: WEIGHTS_TAB, valueInputOption: 'RAW',
            requestBody: { values: roleRows },
          });
        }
      }
```

Note: `sheetId` is already in scope (declared for the type delete). `safeGet` and `append`/`batchUpdate` are already imported/used in this block.

- [ ] **Step 2: Smoke-test parse**

Run: `node --check api/shifts.js`
Expected: clean (no output).

- [ ] **Step 3: Commit**

```bash
git add api/shifts.js
git commit -m "feat(shifts): persist Kind=role weights in set-weights"
```

---

## Chunk 3: Shifts page wiring + weights modal

### Task 4: Fetch roles + resolve member→roles on the Shifts page

**Files:**
- Modify: `assets/js/admin-shifts.js`

- [ ] **Step 1: Add roles state + fetch**

Near the other state vars (`var weights = [];`), add:

```js
  var roles = [];
```

Add a fetch function beside `fetchWeights`:

```js
  async function fetchRoles() {
    var r = await JH.apiFetch('/api/roles', {});
    if (!r.ok) { roles = []; return; }
    var data = await r.json();
    roles = data.roles || [];
  }
```

Find where the page loads data (the `reload()` / initial `Promise.all` or sequential fetches — search for `fetchWeights()` calls) and add `fetchRoles()` alongside, so `roles` is populated before `renderLeaderboard()` and before `openPointsModal` can run.

- [ ] **Step 2: Add `rolesForMember` helper**

Beside `shiftsForMember` (uses the same `norm()` already defined):

```js
  // Role names assigned to this member (playa or legal name in AssignedTo).
  // Mirrors api/_lib/roles.js isAssignedToRole matching.
  function rolesForMember(member) {
    var playa = norm(JH.val(member, 'Playa Name'));
    var legal = norm(JH.val(member, 'Name'));
    return roles.filter(function (role) {
      var assigned = (role.AssignedTo || '').split(',').map(norm).filter(Boolean);
      return (playa && assigned.indexOf(playa) !== -1) || (legal && legal !== playa && assigned.indexOf(legal) !== -1) || (playa && assigned.indexOf(playa) !== -1);
    }).map(function (role) { return role.Name; });
  }
```

(Keep it simple — match if playa OR legal name is in AssignedTo:)

```js
  function rolesForMember(member) {
    var playa = norm(JH.val(member, 'Playa Name'));
    var legal = norm(JH.val(member, 'Name'));
    return roles.filter(function (role) {
      var assigned = (role.AssignedTo || '').split(',').map(norm).filter(Boolean);
      return (playa && assigned.indexOf(playa) !== -1) || (legal && assigned.indexOf(legal) !== -1);
    }).map(function (role) { return role.Name; });
  }
```

- [ ] **Step 3: Pass roleNames into `memberPoints` in `computeContributions`**

In `computeContributions`, add the roleNames and surface `rolePoints`:

```js
      var memberRoles = rolesForMember(m);
      var r = memberPoints({
        arrivalDate: log ? log.ArrivalDate : '',
        departureDate: log ? log.DepartureDate : '',
        noOrgDates: log ? log.NoOrgDates : '',
        eventShifts: eventShifts,
        roleNames: memberRoles,
        index: weightIndex,
      });

      return {
        name: name,
        roles: memberRoles,
        setupDays: r.buildDays,
        strikeDays: r.strikeDays,
        eventHours: r.eventHours,
        eventPoints: r.eventPoints,
        buildPoints: r.buildPoints,
        strikePoints: r.strikePoints,
        rolePoints: r.rolePoints,
        score: r.points,
      };
```

- [ ] **Step 4: Add role pts to the leaderboard row stat**

In `renderRow`, after the `eventPoints` stat push:

```js
    if (entry.rolePoints) stats.push('<strong>' + entry.rolePoints + '</strong> role pts');
```

- [ ] **Step 5: Verify parse**

Run: `node --check assets/js/admin-shifts.js` → clean.

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin-shifts.js
git commit -m "feat(shifts): resolve member roles and score role points on leaderboard"
```

### Task 5: Role weights in the ⚖ Points modal

**Files:**
- Modify: `admin/shifts.html` (points-modal markup ~lines 192-206)
- Modify: `assets/js/admin-shifts.js` (`openPointsModal`, `points-save` handler)

- [ ] **Step 1: Add markup**

In `admin/shifts.html`, update the modal lede and add a roles list container after `#pts-types-list`:

```html
    <p class="panel-lede" style="margin:0">Points are the fairness currency. Build/strike count per day present (NoOrg days excluded). Unset types default to 1; unset roles default to 10. Set a role to 0 to exclude it.</p>
```

```html
    <div id="pts-types-list"></div>
    <h4 style="margin:14px 0 2px;font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Lead / responsibility roles</h4>
    <div id="pts-roles-list"></div>
```

(Optionally add a matching `<h4>` "Shift types" above `#pts-types-list` for symmetry.)

- [ ] **Step 2: Render role inputs in `openPointsModal`**

After the existing types-list rendering, add:

```js
    var rolesList = document.getElementById('pts-roles-list');
    var roleNames = roles.map(function (r) { return r.Name; }).filter(Boolean);
    if (!roleNames.length) {
      rolesList.innerHTML = '<div style="color:var(--text-muted);font-style:italic;padding:8px 0">No roles defined yet.</div>';
    } else {
      rolesList.innerHTML = roleNames.map(function (name) {
        var key = name.toLowerCase().trim();
        var hasWeight = Object.prototype.hasOwnProperty.call(weightIndex.roles, key);
        var val = hasWeight ? weightIndex.roles[key] : 10;
        return '<div class="pts-type-row">' +
          '<label>' + JH.esc(name) + (hasWeight ? '' : ' <span style="opacity:0.6;font-style:italic">(default)</span>') + '</label>' +
          '<input type="number" min="0" step="1" class="pts-role-input" data-name="' + JH.esc(name) + '" value="' + val + '"></div>';
      }).join('');
    }
```

- [ ] **Step 3: Send roles in the save handler**

In the `points-save` click handler, after collecting `types`, collect roles and add to the payload:

```js
    var rolesPayload = [];
    document.querySelectorAll('.pts-role-input').forEach(function (inp) {
      rolesPayload.push({ name: inp.dataset.name, points: parseInt(inp.value, 10) || 0 });
    });
    var r = await JH.apiFetch('/api/shifts', { action: 'set-weights', types: types, roles: rolesPayload, buildPts: buildPts, strikePts: strikePts });
```

- [ ] **Step 4: Verify parse**

Run: `node --check assets/js/admin-shifts.js` → clean.

- [ ] **Step 5: Commit**

```bash
git add admin/shifts.html assets/js/admin-shifts.js
git commit -m "feat(shifts): edit role point weights in the Points modal"
```

---

## Chunk 4: Breakdown popup math

### Task 6: Lead-roles section + per-line math + grand total in `openVolModal`

**Files:**
- Modify: `assets/js/admin-shifts.js` (`openVolModal`, ~lines 779-845)

- [ ] **Step 1: Compute role + point figures**

In `openVolModal`, after `memberShifts` is computed, add:

```js
    var memberRoleNames = rolesForMember(member);
    var buildPts = setupEarnDays * weightIndex.buildPts;     // setupEarnDays defined below; reorder so it's available
    var strikePts = strikeEarnDays * weightIndex.strikePts;
    var rolePts = memberRoleNames.reduce(function (sum, rn) { return sum + rolePoints(weightIndex, rn); }, 0);
    var eventPts = eventShifts.reduce(function (sum, s) { return sum + typePoints(weightIndex, s.Name); }, 0);
    var totalPts = buildPts + strikePts + rolePts + eventPts;
```

Note: `setupEarnDays`/`strikeEarnDays` are computed in the current code right before the body sections — make sure they're declared before this block (move them up if needed). Import `rolePoints` at the top of the file:

```js
import { buildWeightIndex, typePoints, rolePoints, memberPoints } from '/assets/js/shift-points-logic.js';
```

- [ ] **Step 2: Build/strike section headers show math**

Change the build section meta from `setupEarnDays + 'd'` to the full calc:

```js
      setupDays.length ? setupEarnDays + 'd × ' + weightIndex.buildPts + ' = ' + buildPts + ' pts' : ''
```

And strike:

```js
      strikeDays.length ? strikeEarnDays + 'd × ' + weightIndex.strikePts + ' = ' + strikePts + ' pts' : ''
```

- [ ] **Step 3: Add the Lead roles section**

Insert a new section (e.g. after NoOrg, before Event shifts):

```js
    var rolesBody = memberRoleNames.length
      ? memberRoleNames.map(function (rn) {
          return '<div class="vol-shift-row"><span>' + JH.esc(rn) + '</span>' +
            '<span class="vol-shift-pts">' + rolePoints(weightIndex, rn) + ' pts</span></div>';
        }).join('')
      : '<span class="muted">No roles assigned.</span>';
    body += section('Lead roles', rolesBody, memberRoleNames.length ? rolePts + ' pts' : '');
```

- [ ] **Step 4: Add the grand-total line**

After the strike section (end of body), append:

```js
    body += '<div class="vol-section vol-total"><h4>Total <span style="color:var(--accent)">' + totalPts + ' pts</span></h4></div>';
```

(Optional: add a tiny CSS rule in the page `<style>` for `.vol-total { border-top:1px solid var(--border); margin-top:8px; }`.)

- [ ] **Step 5: Verify parse**

Run: `node --check assets/js/admin-shifts.js` → clean.

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin-shifts.js admin/shifts.html
git commit -m "feat(shifts): show full point math + lead roles in breakdown popup"
```

---

## Chunk 5: Docs + verification

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (ShiftWeights tab row + the shift-points paragraph + Change Enforcement Rules)

- [ ] **Step 1: Update the ShiftWeights tab description**

In the Members-sheet table, update the ShiftWeights row to mention `Kind=role`:

> ShiftWeights | shifts.js | Point weights. Cols: Kind (type/role/build/strike), Name (type or role name; blank for build/strike), Points. Defaults in shift-points-logic.js: type=1, role=10, build/strike=10.

- [ ] **Step 2: Extend the shift-points paragraph**

Add to the `> Shift point weights…` blockquote: role weights (default 10/role, summed across a member's roles, editable in the ⚖ Points modal); role assignment matched by playa/legal name in the Roles tab `AssignedTo`; the breakdown popup shows per-line math and a grand total.

- [ ] **Step 3: Add a Change Enforcement Rule**

> **If you add a new `Kind` to ShiftWeights** → update `buildWeightIndex` in `shift-points-logic.js` AND the full-replace delete/append logic in `api/shifts.js` `set-weights`, or the new kind will be silently dropped or wiped on the next save.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document role point weights in CLAUDE.md"
```

### Task 8: Bump version + deploy + verify

- [ ] **Step 1: Bump `package.json`** `0.7.2` → `0.7.3` (feature = minor? this repo uses patch-style bumps per release history; use `0.8.0` if treating role points as a feature — confirm with Frank).

- [ ] **Step 2: Run full suite** `npm test` → all PASS.

- [ ] **Step 3: Commit the release + push** (only when Frank approves push).

- [ ] **Step 4: Verify on deployed site** — open `/admin/shifts`, open ⚖ Points modal, confirm role inputs appear (default 10), set one, save; open a lead's breakdown popup (e.g. Frank: Barrio Lead + Build lead) and confirm the Lead roles section + grand total render correctly.

---

## Notes / risks
- **Backward compat:** `cleanupWeightsAfterDelete` omits `roles` → role rows preserved (guarded by `Array.isArray`). Verify this still holds after Task 3.
- **Name overlap:** "Shit Ninja" role vs shift type score independently — expected. Frank zeroes the role weight if undesired.
- **No server-side scoring change:** points are computed client-side in `admin-shifts.js`; the backend only stores weights. No new API function (stays within the 12-function cap).
- **Scale:** Roles tab is tiny (~11 rows); reading it on the Shifts page adds one cheap fetch.
