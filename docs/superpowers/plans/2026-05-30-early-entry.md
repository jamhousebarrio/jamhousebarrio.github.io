# Early Entry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin "Early Entry" page that lists members arriving before the gate (≤ 5 Jul 2026), lets an admin assign each one an early-entry pass (Barrio / NoOrg / Artist), tracks the barrio allocation against its cap, and highlights early arrivers with no pass assigned.

**Architecture:** A dedicated admin page (`admin/early-entry.html` + `assets/js/admin-early-entry.js`) renders the view. Pure date/cap logic lives in a unit-tested module (`assets/js/early-entry-logic.js`). The backend reuses `api/logistics.js` (two new actions) to respect the 12/12 Vercel function cap; assignments are stored in a new name-keyed `EarlyEntry` Google Sheet tab.

**Tech Stack:** Jekyll static page, vanilla JS ES module, `node --test` for unit tests, Vercel serverless (`api/logistics.js`), Google Sheets via `api/_lib/sheets.js` helpers.

**Spec:** `docs/superpowers/specs/2026-05-30-early-entry-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `assets/js/early-entry-logic.js` (create) | Pure logic: `parseDate`, `isEarlyArrival`, `hasSetupNoOrg`, `barrioCap`, `GATE`. No browser/node globals — imported by both the page and the test. |
| `test/early-entry-logic.test.js` (create) | Unit tests for the logic module (`node --test`). |
| `api/logistics.js` (modify) | Add `early-entry-fetch` (read `EarlyEntry`) and `set-early-entry` (upsert/clear) actions. |
| `admin/early-entry.html` (create) | The page markup (Jekyll front-matter, head, stats bar, table, "arrival unknown" group). |
| `assets/js/admin-early-entry.js` (create, ES module) | Page logic: fetch members + logistics + EE, compute rows, render, save on change. |
| `assets/js/admin-auth.js` (modify) | Add one `JH.sidebarNav` entry (admin-only). |
| `vercel.json` (modify) | Add the `/admin/early-entry` rewrite. |
| `CLAUDE.md` (modify) | Document the new page + `EarlyEntry` tab. |

---

## Chunk 1: Logic module, tests, and API

### Task 1: Pure logic module (TDD)

**Files:**
- Create: `assets/js/early-entry-logic.js`
- Test: `test/early-entry-logic.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/early-entry-logic.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../assets/js/early-entry-logic.js'` (or import error).

- [ ] **Step 3: Write the minimal implementation**

Create `assets/js/early-entry-logic.js`:

```js
// Pure helpers for Early Entry. No browser or node globals — safe to import in
// the browser (admin-early-entry.js, loaded as a module) and in Node tests
// (test/early-entry-logic.test.js via `node --test`).
//
// Dates in the sheet are stored as yyyy-mm-dd: both ArrivalDate and the
// comma-separated NoOrgDates (Flatpickr is configured dateFormat:'Y-m-d' — the
// d/m/Y a user sees is altInput display only). parseDate also accepts dd/mm/yyyy
// defensively for any legacy or hand-entered values, and returns a UTC Date at
// midnight so comparisons are date-only and timezone-safe.

export function parseDate(s) {
  if (!s) return null;
  s = s.toString().trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(dt.getTime()) ? null : dt;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dt = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

// Gate opens Monday 6 July 2026. Anyone arriving strictly before it (<= 5 Jul)
// is in the setup period and needs an early-entry pass.
export const GATE = parseDate('2026-07-06');

export function isEarlyArrival(arrivalDate, gate) {
  const d = parseDate(arrivalDate);
  return !!d && d.getTime() < gate.getTime();
}

export function hasSetupNoOrg(noOrgDates, gate) {
  return String(noOrgDates || '').split(',').some(function (part) {
    const d = parseDate(part.trim());
    return !!d && d.getTime() < gate.getTime();
  });
}

export function barrioCap(approvedCount) {
  return Math.max(10, Math.ceil(0.25 * (approvedCount || 0)));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all assertions green, existing `inventory-labels` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add assets/js/early-entry-logic.js test/early-entry-logic.test.js
git commit -m "Early Entry: tested date/cap logic module"
```

---

### Task 2: API actions in `api/logistics.js`

The page reads/writes the new `EarlyEntry` tab through two new actions. Reuse the
`upsertRow` / `deleteRowById` / `safeGet` / `toObjects` helpers already in
`api/_lib/sheets.js`. The `set-early-entry` branch must read its own fields and
return before reaching the logistics `upsert` path (the spec's handler-collision
note).

**Files:**
- Modify: `api/logistics.js`

- [ ] **Step 1: Widen the helper import**

Find (top of `api/logistics.js`):

```js
import { getSheets, safeGet, toObjects } from './_lib/sheets.js';
```

Replace with:

```js
import { getSheets, safeGet, toObjects, upsertRow, deleteRowById } from './_lib/sheets.js';
```

- [ ] **Step 2: Add the two actions**

In `api/logistics.js`, immediately **after** the `if (!action) { ... }` fetch
block (the one returning `{ logistics: ... }`) and **before** the
`if (action === 'upsert')` block, insert:

```js
    // ── Early Entry: read assignments ─────────────────────────────────────
    if (action === 'early-entry-fetch') {
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const rows = await safeGet(sheets, id, 'EarlyEntry');
      return res.status(200).json({ earlyEntry: toObjects(rows) });
    }

    // ── Early Entry: assign / clear a member's pass ───────────────────────
    if (action === 'set-early-entry') {
      if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
      if (!auth.admin) return res.status(401).json({ error: 'Admin required' });
      const eeName = (memberName || '').trim();
      const source = (req.body.source || '').trim();
      const eeNotes = (req.body.notes || '').trim();
      if (!eeName) return res.status(400).json({ error: 'memberName required' });
      if (['', 'barrio', 'noorg', 'artist'].indexOf(source) === -1) {
        return res.status(400).json({ error: 'invalid source' });
      }
      if (source === '') {
        // Clearing the pass removes the row entirely.
        await deleteRowById(sheets, id, 'EarlyEntry', 'MemberName', eeName);
        return res.status(200).json({ ok: true, cleared: true });
      }
      const EE_HEADERS = ['MemberName', 'Source', 'Notes', 'UpdatedAt', 'UpdatedBy'];
      const updatedBy = ((auth.member && (auth.member['Playa Name'] || auth.member.Name)) || '').trim();
      const updatedAt = new Date().toISOString();
      await upsertRow(sheets, id, 'EarlyEntry', 'MemberName', eeName, EE_HEADERS,
        [eeName, source, eeNotes, updatedAt, updatedBy]);
      return res.status(200).json({ ok: true });
    }
```

> Note: `memberName` is already destructured from `req.body` at the top of the
> handler (the logistics `upsert` uses it). `source` and `notes` are read
> directly off `req.body` here so the EE branch is self-contained and never
> falls through to the logistics `upsert`.

- [ ] **Step 3: Sanity-check the file parses**

Run: `node --check api/logistics.js`
Expected: no output (exit 0).

- [ ] **Step 4: Verify no test regressions**

Run: `npm test`
Expected: PASS (logic tests unaffected; this confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add api/logistics.js
git commit -m "Early Entry API: fetch + set actions on logistics.js (admin-only)"
```

---

## Chunk 2: Page, navigation, and docs

### Task 3: Page markup

**Files:**
- Create: `admin/early-entry.html`

- [ ] **Step 1: Create the page**

Create `admin/early-entry.html` (mirrors `admin/inventory.html`'s head/scripts;
note `admin-early-entry.js` is loaded as a **module** so it can import the logic
module):

```html
---
layout: none
title: Early Entry - JamHouse Admin
access: admin
---
<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Early Entry - JamHouse Admin</title>
  <meta name="access" content="admin">
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/admin.css">
  <style>
    .ee-stats { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; }
    .ee-stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; }
    .ee-stat .num { font-family: var(--heading); font-size: 1.3rem; font-weight: 700; color: var(--text); }
    .ee-stat .lbl { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .ee-stat.warn .num { color: #f44336; }
    .ee-stat.over { border-color: #f44336; }
    .ee-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .ee-table th, .ee-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
    .ee-table th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
    .ee-table tr.uncovered td { background: rgba(244,67,54,0.08); }
    .ee-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; background: var(--surface2); color: var(--accent); }
    .ee-select, .ee-notes { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--body); font-size: 0.82rem; padding: 5px 8px; }
    .ee-notes { width: 100%; }
    .ee-warn-tag { color: #f44336; font-size: 0.8rem; margin-left: 6px; }
    .muted { color: var(--text-muted); }
    .ee-unknown { margin-top: 28px; }
    .ee-unknown h2 { font-family: var(--heading); font-size: 0.95rem; color: var(--text-muted); }
    .empty-state { color: var(--text-muted); font-size: 0.9rem; padding: 40px; text-align: center; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="/assets/js/supabase-client.js"></script>
</head>
<body>
<nav class="sidebar"></nav>

<div class="main">
  <div class="page-header">
    <h1><span class="icon" style="color:var(--accent)">&#127903;</span> Early Entry</h1>
    <div class="subtitle">Who arrives before the gate (Mon 6 Jul) &mdash; assign each a pass</div>
  </div>

  <div class="ee-stats" id="ee-stats"></div>

  <div id="ee-table-wrap">
    <div class="empty-state">Loading&hellip;</div>
  </div>

  <div class="ee-unknown" id="ee-unknown"></div>
</div>

<script src="/assets/js/admin-auth.js"></script>
<script type="module" src="/assets/js/admin-early-entry.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add admin/early-entry.html
git commit -m "Early Entry: page markup"
```

---

### Task 4: Navigation + rewrite

**Files:**
- Modify: `assets/js/admin-auth.js` (the `JH.sidebarNav` array, ~line 164)
- Modify: `vercel.json`

- [ ] **Step 1: Add the nav entry**

In `assets/js/admin-auth.js`, find the Logistics entry:

```js
  { href: '/admin/logistics', icon: '&#9992;', text: 'Logistics', access: 'general' },
```

Insert **immediately after** it:

```js
  { href: '/admin/early-entry', icon: '&#127903;', text: 'Early Entry', access: 'admin' },
```

- [ ] **Step 2: Add the rewrite**

In `vercel.json`, find:

```json
    { "source": "/admin/logistics", "destination": "/admin/logistics.html" },
```

Insert **immediately after** it:

```json
    { "source": "/admin/early-entry", "destination": "/admin/early-entry.html" },
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin-auth.js vercel.json
git commit -m "Early Entry: sidebar nav (admin-only) + vercel rewrite"
```

---

### Task 5: Page logic

**Files:**
- Create: `assets/js/admin-early-entry.js`

- [ ] **Step 1: Create the page module**

Create `assets/js/admin-early-entry.js`:

```js
import { GATE, parseDate, isEarlyArrival, hasSetupNoOrg, barrioCap } from '/assets/js/early-entry-logic.js';

(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isObserver = !!(JH.currentUser && JH.currentUser.observer);

  var approvedMembers = members.filter(function (m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  var logistics = [];
  var earlyEntry = [];

  function norm(s) { return (s || '').toString().trim().toLowerCase(); }
  function displayName(m) { return JH.val(m, 'Playa Name') || JH.val(m, 'Name') || ''; }

  // Resolve a member's row in a name-keyed list, trying playa then legal name
  // (mirrors admin-logistics.js findLogisticsRow's playa<->legal fallback).
  function findByMemberName(list, m) {
    var playa = norm(JH.val(m, 'Playa Name'));
    var legal = norm(JH.val(m, 'Name'));
    return list.find(function (r) {
      var key = norm(r.MemberName);
      return (playa && key === playa) || (legal && key === legal);
    }) || null;
  }

  async function fetchAll() {
    var r1 = await JH.apiFetch('/api/logistics', {});
    logistics = r1.ok ? ((await r1.json()).logistics || []) : [];
    var r2 = await JH.apiFetch('/api/logistics', { action: 'early-entry-fetch' });
    earlyEntry = r2.ok ? ((await r2.json()).earlyEntry || []) : [];
  }

  function buildRows() {
    return approvedMembers.map(function (m) {
      var name = displayName(m);
      if (!name) return null;
      var log = findByMemberName(logistics, m) || {};
      var ee = findByMemberName(earlyEntry, m);
      return {
        name: name,
        arrival: log.ArrivalDate || '',
        arrivalDate: parseDate(log.ArrivalDate || ''),
        early: isEarlyArrival(log.ArrivalDate || '', GATE),
        setupNoOrg: hasSetupNoOrg(log.NoOrgDates || '', GATE),
        source: ee ? (ee.Source || '') : '',
        notes: ee ? (ee.Notes || '') : '',
      };
    }).filter(Boolean);
  }

  function renderStats(rows) {
    var early = rows.filter(function (r) { return r.early; });
    var covered = early.filter(function (r) { return r.source; }).length;
    var uncovered = early.length - covered;
    var cap = barrioCap(approvedMembers.length);
    var barrioUsed = rows.filter(function (r) { return r.source === 'barrio'; }).length;
    var remaining = cap - barrioUsed;
    var over = barrioUsed > cap;

    var html = '';
    html += '<div class="ee-stat"><div class="num">' + early.length + '</div><div class="lbl">Early arrivals</div></div>';
    html += '<div class="ee-stat"><div class="num">' + covered + '</div><div class="lbl">Covered</div></div>';
    html += '<div class="ee-stat' + (uncovered ? ' warn' : '') + '"><div class="num">' + uncovered + '</div><div class="lbl">Uncovered</div></div>';
    html += '<div class="ee-stat' + (over ? ' over warn' : '') + '"><div class="num">' + barrioUsed + ' / ' + cap + '</div><div class="lbl">Barrio pool' + (over ? ' (over!)' : ' (' + remaining + ' left)') + '</div></div>';
    document.getElementById('ee-stats').innerHTML = html;
    return { cap: cap, barrioUsed: barrioUsed };
  }

  var SOURCES = [['', '— none —'], ['barrio', 'Barrio'], ['noorg', 'NoOrg'], ['artist', 'Artist']];

  function sourceSelect(row) {
    var opts = SOURCES.map(function (s) {
      return '<option value="' + s[0] + '"' + (row.source === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');
    var dis = isObserver ? ' disabled' : '';
    return '<select class="ee-select" data-name="' + JH.esc(row.name) + '"' + dis + '>' + opts + '</select>';
  }

  function renderTable(rows, pool) {
    var early = rows.filter(function (r) { return r.early; })
      .sort(function (a, b) {
        var ta = a.arrivalDate ? a.arrivalDate.getTime() : Infinity;
        var tb = b.arrivalDate ? b.arrivalDate.getTime() : Infinity;
        return ta - tb;
      });

    if (!early.length) {
      document.getElementById('ee-table-wrap').innerHTML = '<div class="empty-state">No early arrivals yet.</div>';
      return;
    }

    var html = '<table class="ee-table"><thead><tr>';
    html += '<th>Name</th><th>Arrives</th><th>NoOrg setup</th><th>EE source</th><th>Notes</th>';
    html += '</tr></thead><tbody>';
    early.forEach(function (r) {
      var cls = r.source ? '' : ' class="uncovered"';
      html += '<tr' + cls + ' data-name="' + JH.esc(r.name) + '">';
      html += '<td><strong>' + JH.esc(r.name) + '</strong></td>';
      html += '<td>' + (r.arrival ? JH.esc(JH.formatDate(r.arrival)) : '<span class="muted">—</span>') + '</td>';
      html += '<td>' + (r.setupNoOrg ? '<span class="ee-badge">✓ setup</span>' : '<span class="muted">—</span>') + '</td>';
      html += '<td>' + sourceSelect(r) + (r.source ? '' : '<span class="ee-warn-tag">⚠</span>') + '</td>';
      html += '<td><input class="ee-notes" data-name="' + JH.esc(r.name) + '" value="' + JH.esc(r.notes) + '"' + (isObserver ? ' disabled' : '') + ' placeholder="optional"></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('ee-table-wrap').innerHTML = html;

    wireRow(pool);
  }

  function renderUnknown(rows) {
    var unknown = rows.filter(function (r) { return !r.arrivalDate; });
    var wrap = document.getElementById('ee-unknown');
    if (!unknown.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<h2>Arrival unknown (chase these — no arrival date filled in)</h2>' +
      '<p class="muted">' + unknown.map(function (r) { return JH.esc(r.name); }).join(', ') + '</p>';
  }

  function notesValueFor(name) {
    var input = document.querySelector('.ee-notes[data-name="' + cssEscape(name) + '"]');
    return input ? input.value : '';
  }
  function cssEscape(s) { return (s || '').replace(/"/g, '\\"'); }

  async function save(name, source, notes) {
    var r = await JH.apiFetch('/api/logistics', {
      action: 'set-early-entry', memberName: name, source: source, notes: notes,
    });
    if (!r.ok) {
      var msg = 'Save failed.';
      try { var j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      alert(msg);
      return false;
    }
    return true;
  }

  function wireRow(pool) {
    document.querySelectorAll('.ee-select').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        var name = sel.dataset.name;
        var source = sel.value;
        // Warn (but allow) if assigning Barrio would exceed the pool.
        if (source === 'barrio' && pool.barrioUsed >= pool.cap) {
          if (!confirm('Barrio pool is full (' + pool.barrioUsed + '/' + pool.cap + '). Assign anyway?')) {
            await reload();
            return;
          }
        }
        if (await save(name, source, notesValueFor(name))) await reload();
      });
    });
    document.querySelectorAll('.ee-notes').forEach(function (inp) {
      inp.addEventListener('blur', async function () {
        var name = inp.dataset.name;
        var row = buildRows().find(function (r) { return r.name === name; });
        var source = row ? row.source : '';
        // Notes only persist alongside a source (no source = no EE row).
        if (!source) return;
        await save(name, source, inp.value);
      });
    });
  }

  async function reload() {
    await fetchAll();
    var rows = buildRows();
    var pool = renderStats(rows);
    renderTable(rows, pool);
    renderUnknown(rows);
  }

  await reload();
})();
```

- [ ] **Step 2: Sanity-check the module parses**

Run: `node --check assets/js/admin-early-entry.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add assets/js/admin-early-entry.js
git commit -m "Early Entry: page logic (compute, render, save-on-change)"
```

---

### Task 6: Docs + manual verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the new tab and page**

In `CLAUDE.md`, in the **Members Sheet (SHEET_ID)** tab table, add a row after the
`Timeline` row:

```
| EarlyEntry | logistics.js | Early-entry passes. Cols: MemberName, Source (barrio/noorg/artist), Notes, UpdatedAt, UpdatedBy |
```

In the **Project Structure** block, add under `admin/` after the `logistics.html`
line:

```
  early-entry.html              # Early-entry assignment (who arrives before the gate)
```

and under `assets/js/` after the `admin-logistics.js` line:

```
  admin-early-entry.js          # Early Entry page logic
  early-entry-logic.js          # Pure date/cap logic (unit-tested)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Docs: Early Entry page + EarlyEntry tab"
```

- [ ] **Step 3: Manual verification (per doctrine — exercise the feature)**

Start the dev server and exercise the page as an admin:

```bash
npm run dev
```

Then in the browser at `http://localhost:3000/admin/early-entry`:
1. Confirm the page loads, the sidebar shows "Early Entry" (admin only), and the
   stats bar renders.
2. Confirm members with an arrival date ≤ 5 Jul appear in the table, sorted by
   date; members with a setup-period NoOrg day show the "✓ setup" badge.
3. Assign a Barrio pass → row stops being highlighted, "Covered" increments,
   "Barrio pool" used increments. Reload the page → assignment persists.
4. Assign passes past the barrio cap → confirm the "Assign anyway?" prompt
   appears and the pool stat turns red/over.
5. Set a source back to "— none —" → row becomes highlighted again and the
   `EarlyEntry` row is cleared.
6. Add Notes to an assigned row, blur, reload → notes persist.
7. Confirm members with no arrival date appear in the "Arrival unknown" group.

Record the result. If anything fails, use superpowers:systematic-debugging
before patching.

- [ ] **Step 4: Suggest a version bump**

Per the project release flow, this is a feature → **minor** bump (`v0.1.0` →
`v0.2.0`): update `package.json` `version` and tag `v0.2.0` once the user
confirms the manual verification passed.

---

## Done criteria

- `npm test` passes (logic module covered).
- `node --check` clean on `api/logistics.js` and `assets/js/admin-early-entry.js`.
- The page lists early arrivers, assigns/clears passes (persisted in `EarlyEntry`),
  tracks the barrio pool with an over-cap warning, auto-flags setup NoOrg, and
  highlights uncovered early arrivers.
- Still 12 `api/*.js` functions (no new endpoint).
- CLAUDE.md documents the page and the `EarlyEntry` tab.
