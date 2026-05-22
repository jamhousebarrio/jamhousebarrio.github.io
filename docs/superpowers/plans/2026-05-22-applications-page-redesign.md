# Applications page redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the Applications page header to 5 status buckets, move column controls into a popover, and add a Kanban view alongside the existing AG Grid — without any backend changes.

**Architecture:** Frontend-only. A new `STATUS_BUCKETS` constant in `admin-applications.js` maps each of the 8 sub-statuses to one of 5 buckets and is the single source of truth for stat cards, filter dropdown, and Kanban column placement. Kanban is a sibling DOM tree to the AG Grid container, toggled via localStorage-backed view state. Drag-and-drop on Kanban cards calls the same `updateStatus()` function the grid dropdown uses, so all popup / silent-demotion / promotion-invite logic from the Observer work applies automatically.

**Tech Stack:** Jekyll static markup + vanilla JS (no frameworks), AG Grid (existing, Grid view only), native HTML5 drag-and-drop for Kanban. CSS variables for theming live in `assets/css/admin.css`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-22-applications-page-redesign.md`

**Project convention:** No automated test framework (prototype-grade per CLAUDE.md). Verification is grep + dev-server browser check + manual smoke tests on the Vercel preview after each chunk's commit.

---

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `admin/applications.html` | Modify | Stat-card markup (5 cells), filter row markup (view toggle, Columns ▾ button, status filter), Kanban container div, Columns popover scaffold, in-card menu template |
| `assets/js/admin-applications.js` | Modify | Add `STATUS_BUCKETS` + `BUCKET_ORDER`. Refactor `refreshStats` + filter handler + column-toggle wiring. Add Kanban rendering, view toggle, drag-and-drop, in-card menu, localStorage state. Add small `relativeDays()` helper inline |
| `assets/css/admin.css` | Modify | Styles for Kanban lanes, cards, spine, drag-over state, tag pills; Columns popover; view-toggle pill |

No other files touched. No backend changes. No new dependencies.

---

## Chunk 1: Status taxonomy

Adds `STATUS_BUCKETS` + `BUCKET_ORDER` constants, collapses the 8 stat cards to 5, collapses the filter dropdown to 5 options, and teaches AG Grid's status filter to accept a bucket value and match any of its sub-statuses.

### Task 1: Add STATUS_BUCKETS and BUCKET_ORDER constants

**Files:**
- Modify: `assets/js/admin-applications.js:8-10`

- [ ] **Step 1: Insert the constants right after `ALL_STATUSES` / `STATUS_IDS`**

Open `assets/js/admin-applications.js` around lines 8-10. After the existing `STATUS_IDS` declaration, insert:

```js
  var STATUS_BUCKETS = {
    'Pending':         'Pending',
    'Review':          'In Progress',
    'Vibe Check':      'In Progress',
    'Team Discussion': 'In Progress',
    'On-boarding':     'In Progress',
    'Approved':        'Approved',
    'Observer':        'Observer',
    'Rejected':        'Rejected',
  };
  var BUCKET_ORDER = ['Pending', 'In Progress', 'Approved', 'Observer', 'Rejected'];
  var BUCKET_STAT_IDS = {
    'Pending': 'stat-pending',
    'In Progress': 'stat-in-progress',
    'Approved': 'stat-approved',
    'Observer': 'stat-observer',
    'Rejected': 'stat-rejected',
  };
  function bucketOf(status) {
    var norm = normalizeStatus(status);
    return STATUS_BUCKETS[norm] || 'Pending';
  }
```

- [ ] **Step 2: Verify**

```bash
grep -n "STATUS_BUCKETS\|BUCKET_ORDER\|bucketOf" assets/js/admin-applications.js | head -5
```

Expected: at least 4 matches (constants + helper).

---

### Task 2: Replace stat-card markup (8 → 5)

**Files:**
- Modify: `admin/applications.html:135-161`

- [ ] **Step 1: Replace the stat-card block**

Locate the `<div class="stat-cards">` (or equivalent container) that holds the 8 stat-card divs. Replace its inner children with these 5 cards (preserving the outer container):

```html
<div class="stat-card">
  <div class="stat-label">Pending</div>
  <div class="stat-number" id="stat-pending" style="color:#ffa726;">-</div>
</div>
<div class="stat-card">
  <div class="stat-label">In Progress</div>
  <div class="stat-number" id="stat-in-progress" style="color:#29b6f6;">-</div>
</div>
<div class="stat-card">
  <div class="stat-label">Approved</div>
  <div class="stat-number" id="stat-approved" style="color:#4caf50;">-</div>
</div>
<div class="stat-card">
  <div class="stat-label">Observer</div>
  <div class="stat-number" id="stat-observer" style="color:#9e9e9e;">-</div>
</div>
<div class="stat-card">
  <div class="stat-label">Rejected</div>
  <div class="stat-number" id="stat-rejected" style="color:#f44336;">-</div>
</div>
```

- [ ] **Step 2: Verify**

```bash
grep -n "stat-pending\|stat-in-progress\|stat-approved\|stat-observer\|stat-rejected\|stat-review\|stat-vibe-check\|stat-team-discussion\|stat-on-boarding" admin/applications.html
```

Expected: only 5 ids (`stat-pending`, `stat-in-progress`, `stat-approved`, `stat-observer`, `stat-rejected`). No `stat-review`, `stat-vibe-check`, `stat-team-discussion`, `stat-on-boarding` left over.

---

### Task 3: Update `refreshStats` to aggregate by bucket

**Files:**
- Modify: `assets/js/admin-applications.js` (`refreshStats` function, around line 20-30)

- [ ] **Step 1: Locate the existing `refreshStats` function**

```bash
grep -n "function refreshStats\|refreshStats =" assets/js/admin-applications.js
```

- [ ] **Step 2: Replace its body**

Replace the function body with:

```js
  function refreshStats() {
    var counts = { 'Pending': 0, 'In Progress': 0, 'Approved': 0, 'Observer': 0, 'Rejected': 0 };
    allMembers.forEach(function(m) {
      var b = bucketOf(val(m, 'Status'));
      if (counts.hasOwnProperty(b)) counts[b] += 1;
    });
    BUCKET_ORDER.forEach(function(bucket) {
      var el = document.getElementById(BUCKET_STAT_IDS[bucket]);
      if (el) el.textContent = counts[bucket];
    });
  }
```

- [ ] **Step 3: Verify locally**

```bash
node --check assets/js/admin-applications.js && echo OK
```

Expected: `OK`. Then start the dev server (`npm run dev`) and load `/admin/applications` — the 5 stat-card numbers should populate with non-`-` values and their sum should equal `allMembers.length`.

---

### Task 4: Collapse the status filter dropdown (8 → 5)

**Files:**
- Modify: `admin/applications.html` (the `<select id="statusFilter">` block, around line 165-174)

- [ ] **Step 1: Replace the options**

Replace the inner `<option>` elements of `#statusFilter` with:

```html
<option value="" selected>All Applications</option>
<option value="Pending">Pending</option>
<option value="In Progress">In Progress</option>
<option value="Approved">Approved</option>
<option value="Observer">Observer</option>
<option value="Rejected">Rejected</option>
```

- [ ] **Step 2: Verify**

```bash
grep -A 10 'id="statusFilter"' admin/applications.html | grep '<option'
```

Expected: 6 lines (the All option + 5 buckets). No `<option value="Review">`, no `Vibe Check`, etc.

---

### Task 5: Update the filter handler to match by bucket

**Files:**
- Modify: `assets/js/admin-applications.js` (around line 230-240, the `statusFilter` `change` listener)

- [ ] **Step 1: Locate the handler**

```bash
grep -n "statusFilter\|setColumnFilterModel" assets/js/admin-applications.js
```

You'll find a `document.getElementById('statusFilter').addEventListener('change', ...)` block that sets an AG Grid column filter on `Status`.

- [ ] **Step 2: Rewrite the handler to use a bucket-aware filter**

Replace the listener body. The change: a non-bucket value (i.e., `Pending` / `Approved` / `Observer` / `Rejected`) still uses an equals filter on `Status`; the bucket `"In Progress"` uses a set/match filter against the 4 sub-statuses.

```js
document.getElementById('statusFilter').addEventListener('change', function () {
  var filterVal = this.value;
  if (!filterVal) {
    gridApi.setGridOption('quickFilterText', null);
    gridApi.setColumnFilterModel('Status', null).then(function () {
      gridApi.onFilterChanged();
    });
    return;
  }
  // Sub-status filter values are exact strings; "In Progress" needs to
  // match any of the 4 underlying statuses.
  var model;
  if (filterVal === 'In Progress') {
    model = { filterType: 'text', type: 'in', values: ['Review', 'Vibe Check', 'Team Discussion', 'On-boarding'] };
  } else {
    model = { type: 'equals', filter: filterVal };
  }
  gridApi.setColumnFilterModel('Status', model).then(function () {
    gridApi.onFilterChanged();
  });
});
```

NOTE: AG Grid's default text filter doesn't have an `in` operator. If the above doesn't trigger filtering, swap to a custom filter via the column def. Easier alternative: configure the `Status` column with a custom `filter` function and call `setQuickFilter(null)` + manually filter `rowData`. See Step 3 fallback.

- [ ] **Step 3: Fallback — use a custom column filter if `in` isn't supported**

If AG Grid 31+ rejects `type: 'in'`, switch the `Status` column def (around line 164) to use a function filter:

```js
// In columnDefs: { field: 'Status', ..., filter: BucketFilter }
function BucketFilter() {}
BucketFilter.prototype.init = function(params) {
  this.filterActive = false;
  this.targetBucket = null;
  this.targetStatus = null;
};
BucketFilter.prototype.doesFilterPass = function(params) {
  var v = params.data && params.data.Status;
  if (this.targetBucket === 'In Progress') return bucketOf(v) === 'In Progress';
  if (this.targetStatus) return v === this.targetStatus;
  return true;
};
BucketFilter.prototype.isFilterActive = function() { return this.filterActive; };
BucketFilter.prototype.getModel = function() {
  if (!this.filterActive) return null;
  return { bucket: this.targetBucket, status: this.targetStatus };
};
BucketFilter.prototype.setModel = function(model) {
  if (!model) { this.filterActive = false; this.targetBucket = null; this.targetStatus = null; return; }
  this.filterActive = true;
  this.targetBucket = model.bucket || null;
  this.targetStatus = model.status || null;
};
BucketFilter.prototype.getGui = function() { return document.createElement('div'); };
```

Then the dropdown handler calls:

```js
var model = filterVal === 'In Progress'
  ? { bucket: 'In Progress' }
  : { status: filterVal };
gridApi.setColumnFilterModel('Status', model).then(function () { gridApi.onFilterChanged(); });
```

- [ ] **Step 4: Verify**

```bash
node --check assets/js/admin-applications.js && echo OK
```

Reload `/admin/applications` and click each filter option. Confirm: `Pending` shows only pending rows; `In Progress` shows rows whose Status is Review / Vibe Check / Team Discussion / On-boarding (verify count matches the In Progress stat card); `All Applications` shows everything.

---

### Task 6: Stat-card click sets the bucket filter

**Files:**
- Modify: `assets/js/admin-applications.js` (existing stat-card click handler, if any; otherwise add one)

- [ ] **Step 1: Locate or add the click handler**

Existing code may already wire clicks on stat cards to set the filter to a specific status. With buckets, click `#stat-in-progress` → set filter to `"In Progress"`. If no handler exists, add:

```js
BUCKET_ORDER.forEach(function(bucket) {
  var el = document.getElementById(BUCKET_STAT_IDS[bucket]);
  if (!el) return;
  var card = el.closest('.stat-card');
  if (!card) return;
  card.style.cursor = 'pointer';
  card.addEventListener('click', function() {
    var filter = document.getElementById('statusFilter');
    filter.value = bucket;
    filter.dispatchEvent(new Event('change'));
  });
});
```

If the existing code already does this for the old 8 cards, just update the loop to iterate over `BUCKET_ORDER` instead of `ALL_STATUSES` and read `BUCKET_STAT_IDS`.

- [ ] **Step 2: Verify**

Reload the page, click the "In Progress" stat card, confirm the grid filters down to Review/Vibe Check/Team Discussion/On-boarding rows and `#statusFilter` shows `"In Progress"`.

---

### Task 7: Commit Chunk 1

- [ ] **Step 1: Stage + commit**

```bash
git add admin/applications.html assets/js/admin-applications.js
git commit -m "Applications: collapse 8 statuses into 5 display buckets

- New STATUS_BUCKETS / BUCKET_ORDER constants in admin-applications.js
  are the single source of truth for bucket display logic
- Stat cards collapsed from 8 to 5; refreshStats aggregates by bucket
- Status filter dropdown collapsed from 8 to 5 options; 'In Progress'
  matches any of Review / Vibe Check / Team Discussion / On-boarding
- Per-row Status dropdown and modal still show all 8 sub-statuses
- Backend ALL_STATUSES is unchanged"
```

---

## Chunk 2: Columns popover

Replaces the inline column-toggle row with a `Columns ▾` button + popover, changes default-visible columns, and persists user preferences in localStorage.

### Task 8: Mark up the `Columns ▾` button and popover container

**Files:**
- Modify: `admin/applications.html` (filter row markup, around line 163-178)

- [ ] **Step 1: Replace the existing `<div id="colToggles">` row**

Locate the existing inline column-toggle container (likely `<div class="col-toggles" id="colToggles"></div>`). Replace the filter row to read:

```html
<div class="filter-row">
  <select id="statusFilter">
    <option value="" selected>All Applications</option>
    <option value="Pending">Pending</option>
    <option value="In Progress">In Progress</option>
    <option value="Approved">Approved</option>
    <option value="Observer">Observer</option>
    <option value="Rejected">Rejected</option>
  </select>
  <div class="columns-control">
    <button type="button" id="columns-btn" class="btn-secondary">Columns &#9662;</button>
    <div id="columns-popover" class="columns-popover" hidden></div>
  </div>
  <span class="count" id="filter-count"></span>
</div>
```

- [ ] **Step 2: Verify**

```bash
grep -n 'columns-btn\|columns-popover\|colToggles' admin/applications.html
```

Expected: matches on `columns-btn` and `columns-popover`; **no** match on `colToggles`.

---

### Task 9: Style the popover and button

**Files:**
- Modify: `assets/css/admin.css`

- [ ] **Step 1: Append popover + button styles**

Add to the end of `admin.css`:

```css
.columns-control { position: relative; display: inline-block; }
.columns-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.columns-popover[hidden] { display: none; }
.columns-popover label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
}
.columns-popover label:hover { color: var(--accent); }
.columns-popover input[type="checkbox"] { accent-color: var(--accent); }
```

- [ ] **Step 2: Verify**

```bash
grep -n "columns-popover\|columns-control" assets/css/admin.css
```

Expected: 4+ matches.

---

### Task 10: Verify column field names + replace toggle wiring with popover

**Files:**
- Modify: `assets/js/admin-applications.js` (around line 211-225, the `Column toggles` block)

- [ ] **Step 1: Verify the canonical field names match `DEFAULT_VISIBLE`**

```bash
grep -n "field:.*['\"]Name['\"]\|field:.*Playa\|field:.*Responsible\|field:.*Status" assets/js/admin-applications.js
```

Expected: matches confirming the AG Grid columns use exactly `'Name'`, `'Playa Name'`, `'Responsible HR'`, `'Status'`. If any of these strings is camelCase in the column defs (e.g. `playaName`), update `DEFAULT_VISIBLE` in Step 3 to match — otherwise first-load defaults silently fail and the grid shows only the View/Invite buttons.

- [ ] **Step 2: Locate the existing toggle-building block**

```bash
grep -n "colToggles\|col-toggle\|setColumnsVisible" assets/js/admin-applications.js
```

Also confirm grid-init ordering — the popover-build code below must run **before** `agGrid.createGrid(gridDiv, gridOptions)` so the mutation to `col.hide` is consumed by the grid on first init. If grid init currently sits above the toggle-build block, move the popover block above it as part of this task.

- [ ] **Step 3: Replace the toggle block with popover logic, gated on `!JH.isMobile`**

Find the block that does:

```js
var togglesEl = document.getElementById('colToggles');
columnDefs.filter(...).forEach(function(col) { ... });
```

Replace it with:

```js
  // ── Columns popover ─────────────────────────────────────────────────────
  // Keys under jh.applications.* prefix — see "Notes for the implementing
  // engineer" at the bottom of this plan for the full list.
  var LS_COLS_KEY = 'jh.applications.columns';
  var DEFAULT_VISIBLE = ['Name', 'Playa Name', 'Responsible HR', 'Status'];

  function readVisibleCols() {
    try {
      var raw = localStorage.getItem(LS_COLS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { /* fall through */ }
    return DEFAULT_VISIBLE.slice();
  }
  function writeVisibleCols(arr) {
    try { localStorage.setItem(LS_COLS_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  // visibleSet must be readable in the popover-build block below — declare
  // outside the mobile gate. On mobile, JH.mobileColumns is the only
  // authority on column visibility; we read visibleSet only to check the
  // popover boxes (the popover itself is hidden on mobile via CSS), but
  // we DO NOT mutate columnDefs[i].hide on mobile.
  var visibleSet = readVisibleCols();
  if (!JH.isMobile) {
    columnDefs.forEach(function(col) {
      if (!col.field || col.field.indexOf('_') === 0) return; // skip View/Invite buttons
      col.hide = visibleSet.indexOf(col.field) === -1;
    });
  }

  // Build popover (idempotent — runs on both desktop and mobile, but the
  // popover button is hidden on mobile via CSS @media query)
  var popoverEl = document.getElementById('columns-popover');
  var btnEl = document.getElementById('columns-btn');
  columnDefs.filter(function(col) { return col.field && col.field.indexOf('_') !== 0; }).forEach(function(col) {
    var label = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = visibleSet.indexOf(col.field) !== -1;
    cb.addEventListener('change', function() {
      var current = readVisibleCols();
      if (cb.checked && current.indexOf(col.field) === -1) current.push(col.field);
      if (!cb.checked) current = current.filter(function(c) { return c !== col.field; });
      writeVisibleCols(current);
      gridApi.setColumnsVisible([col.field], cb.checked);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + (col.headerName || col.field)));
    popoverEl.appendChild(label);
  });

  // Toggle popover visibility; close on outside click
  btnEl.addEventListener('click', function(e) {
    e.stopPropagation();
    popoverEl.hidden = !popoverEl.hidden;
  });
  document.addEventListener('click', function(e) {
    if (popoverEl.hidden) return;
    if (popoverEl.contains(e.target) || btnEl.contains(e.target)) return;
    popoverEl.hidden = true;
  });
```

- [ ] **Step 4: Confirm View / Invite buttons survive**

The popover skips columns without a `field` or whose field starts with `_`. Confirm with:

```bash
grep -n "cellRenderer.*View\|cellRenderer.*Invite\|field: '_view'\|field: '_invite'" assets/js/admin-applications.js
```

Expected: matches confirming both action columns use `_view` / `_invite` fields. If they use `field: 'View'` (no underscore), update the popover filter's predicate to `col.field && col.field !== 'View' && col.field !== 'Invite'` in the snippet above.

- [ ] **Step 5: Verify column defaults**

```bash
node --check assets/js/admin-applications.js && echo OK
```

Reload `/admin/applications` (desktop browser). Default visible columns should be: View, Invite, Name, Playa Name, Responsible HR, Status. Everything else (Location, Phone, Email, etc.) hidden.

- [ ] **Step 6: Verify popover behavior**

Click `Columns ▾`. Popover opens. Toggle on Phone — Phone column appears in grid. Click outside the popover — popover closes. Reload the page — Phone column is still visible (localStorage persisted).

---

### Task 11: Mobile media query

**Files:**
- Modify: `assets/css/admin.css`

- [ ] **Step 1: Hide the Columns button on mobile**

Append (or merge into the existing `@media (max-width: 768px)` block from Task 9 if one exists):

```css
@media (max-width: 768px) {
  .columns-control { display: none; }
}
```

Chunk 3 Task 14 adds a separate `@media (max-width: 768px)` block for `.view-toggle` + `#view-kanban-wrap`. When you reach Chunk 3, merge both rules into one media block rather than stacking two.

- [ ] **Step 2: Verify on dev server**

Resize the dev-server browser to ~700px wide. The Columns button should hide; the grid should show the mobile column set (`JH.mobileColumns(columnDefs, ['Name', 'Phone', 'Status'])`). On mobile, `columnDefs[i].hide` is NOT touched by Task 10 (the mobile gate), so the JH-mobile logic is the only authority.

---

### Task 12: Commit Chunk 2

- [ ] **Step 1: Stage + commit**

```bash
git add admin/applications.html assets/js/admin-applications.js assets/css/admin.css
git commit -m "Applications: replace column-toggle row with Columns popover

- Default visible: Name, Playa Name, Responsible HR, Status (+ View/Invite)
- Removed from default: Location, Phone, Email, all demographics, etc.
- Toggles live in a Columns ▾ popover; closes on outside click
- Visible-column set persists per browser via localStorage key
  jh.applications.columns
- Mobile keeps its own column override (popover hidden via CSS)"
```

---

## Chunk 3: Kanban scaffold (view toggle + cards, no DnD)

Adds the Grid / Kanban view toggle, the Kanban container, and renders cards into their bucket columns. No drag-and-drop yet (next chunk). Cards are clickable → open the existing modal.

### Task 13: Add view toggle + Kanban container markup

**Files:**
- Modify: `admin/applications.html`

- [ ] **Step 1: Insert the view toggle just above the filter row**

Locate the `<div class="panel">` that wraps the grid, and insert at the top of it:

```html
<div class="view-toggle">
  <button type="button" id="view-grid" class="view-btn active" data-view="grid">Grid</button>
  <button type="button" id="view-kanban" class="view-btn" data-view="kanban">Kanban</button>
</div>
```

- [ ] **Step 2: Wrap the existing AG Grid div + add a sibling Kanban container**

Find `<div id="app-grid" class="ag-theme-alpine-dark"></div>`. Replace it with:

```html
<div id="view-grid-wrap" class="view-pane">
  <div id="app-grid" class="ag-theme-alpine-dark"></div>
</div>
<div id="view-kanban-wrap" class="view-pane" hidden>
  <div id="kanban-board" class="kanban-board"></div>
</div>
```

- [ ] **Step 3: Verify**

```bash
grep -n "view-grid\|view-kanban\|kanban-board" admin/applications.html
```

Expected: 6+ matches.

---

### Task 14: Style the view toggle and Kanban scaffolding

**Files:**
- Modify: `assets/css/admin.css`

- [ ] **Step 1: Append styles**

```css
.view-toggle { display: inline-flex; gap: 0; margin-bottom: 12px; }
.view-btn {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 6px 14px;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.view-btn:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.view-btn:last-child  { border-top-right-radius: 6px; border-bottom-right-radius: 6px; border-left: none; }
.view-btn.active { background: var(--accent); color: #1a1612; border-color: var(--accent); }

.kanban-board {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
  border-radius: 6px;
  overflow-x: auto;
  min-height: 60vh;
}
.kb-col {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  min-width: 220px;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.kb-col-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  color: var(--text-muted);
}
.kb-col-header .count {
  background: var(--surface2);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.7rem;
}
.kb-col.bucket-pending     .kb-col-header { color: #ffa726; }
.kb-col.bucket-in-progress .kb-col-header { color: #29b6f6; }
.kb-col.bucket-approved    .kb-col-header { color: #4caf50; }
.kb-col.bucket-observer    .kb-col-header { color: #9e9e9e; }
.kb-col.bucket-rejected    .kb-col-header { color: #f44336; }

.kb-cards { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }

.kb-card {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 0.85rem;
  cursor: pointer;
  position: relative;
}
.kb-card .kb-name { font-weight: 600; color: var(--text); }
.kb-card .kb-playa { color: var(--text-muted); font-size: 0.72rem; }
.kb-card .kb-meta { color: var(--text-muted); font-size: 0.7rem; margin-top: 3px; }
.kb-card .kb-tags { margin-top: 4px; display: flex; gap: 3px; flex-wrap: wrap; }
.kb-card .kb-tag {
  font-size: 0.62rem;
  padding: 1px 5px;
  border-radius: 8px;
  background: rgba(232, 168, 76, 0.15);
  color: var(--accent);
}
.kb-card .kb-tag.first-burn {
  background: rgba(255, 167, 38, 0.15);
  color: #ffa726;
}
.kb-card .kb-menu-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 2px 6px;
  line-height: 1;
}
.kb-card .kb-menu-btn:hover { color: var(--text); }

/* Collapsed spine state for terminal columns */
.kb-col.collapsed {
  min-width: 60px;
  max-width: 60px;
  padding: 8px 4px;
  cursor: pointer;
}
.kb-col.collapsed .kb-cards { display: none; }
.kb-col.collapsed .kb-col-header {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  height: 140px;
  margin: 0 auto;
  text-align: center;
}

/* Mobile: hide the view toggle and Kanban entirely; force Grid */
@media (max-width: 768px) {
  .view-toggle { display: none; }
  #view-kanban-wrap { display: none !important; }
}
```

- [ ] **Step 2: Verify**

```bash
grep -c "kanban-board\|kb-col\|kb-card\|view-toggle" assets/css/admin.css
```

Expected: 10+ matches.

---

### Task 15: View-toggle wiring + localStorage state

**Files:**
- Modify: `assets/js/admin-applications.js` (anywhere reasonable; suggest a `// ── Kanban view ──` section near the bottom of the IIFE, before the `})();` close)

- [ ] **Step 1: Add view-toggle constants and helpers**

Add near the existing localStorage section (after Columns popover code):

```js
  // ── Kanban view ─────────────────────────────────────────────────────────
  var LS_VIEW_KEY = 'jh.applications.view';
  var LS_KB_EXPANDED_KEY = 'jh.applications.kanban.expanded';
  var DEFAULT_EXPANDED_BUCKETS = ['Pending', 'In Progress'];

  function readView() {
    try { return localStorage.getItem(LS_VIEW_KEY) || 'grid'; } catch (e) { return 'grid'; }
  }
  function writeView(v) {
    try { localStorage.setItem(LS_VIEW_KEY, v); } catch (e) {}
  }
  function readExpandedBuckets() {
    try {
      var raw = localStorage.getItem(LS_KB_EXPANDED_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_EXPANDED_BUCKETS.slice();
  }
  function writeExpandedBuckets(arr) {
    try { localStorage.setItem(LS_KB_EXPANDED_KEY, JSON.stringify(arr)); } catch (e) {}
  }
```

- [ ] **Step 2: Wire the toggle**

Add after the helpers:

```js
  var gridWrap = document.getElementById('view-grid-wrap');
  var kanbanWrap = document.getElementById('view-kanban-wrap');
  var gridBtn = document.getElementById('view-grid');
  var kanbanBtn = document.getElementById('view-kanban');

  function applyView(v) {
    if (v === 'kanban') {
      gridWrap.hidden = true;
      kanbanWrap.hidden = false;
      gridBtn.classList.remove('active');
      kanbanBtn.classList.add('active');
      renderKanban();
    } else {
      gridWrap.hidden = false;
      kanbanWrap.hidden = true;
      kanbanBtn.classList.remove('active');
      gridBtn.classList.add('active');
    }
    writeView(v);
  }

  gridBtn.addEventListener('click', function() { applyView('grid'); });
  kanbanBtn.addEventListener('click', function() { applyView('kanban'); });

  // Restore last-used view on load (mobile is forced to grid via CSS;
  // we still set the JS state to grid to be safe)
  applyView(JH.isMobile ? 'grid' : readView());
```

- [ ] **Step 3: Verify (next task will implement `renderKanban`)**

`renderKanban` doesn't exist yet — Step 2 will throw at view-toggle click. That's expected; we wire the view here and implement the renderer in Task 16. For now confirm:

```bash
node --check assets/js/admin-applications.js && echo OK
```

(Loading the page may still work — `applyView('grid')` doesn't call `renderKanban`. Only clicking Kanban fails.)

---

### Task 16: Implement `renderKanban` (card rendering, columns, spine state)

**Files:**
- Modify: `assets/js/admin-applications.js`

- [ ] **Step 1: Add `relativeDays` helper inline**

```js
  function relativeDays(timestamp) {
    if (!timestamp) return '';
    var t = Date.parse(timestamp);
    if (isNaN(t)) return '';
    var diff = Date.now() - t;
    var days = Math.floor(diff / (24 * 60 * 60 * 1000));
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 7) return days + ' days ago';
    var weeks = Math.floor(days / 7);
    if (weeks === 1) return '1 week ago';
    if (weeks < 5) return weeks + ' weeks ago';
    var months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    return months + ' months ago';
  }
```

- [ ] **Step 2: Implement `renderKanban`**

```js
  function bucketCssClass(bucket) {
    return 'bucket-' + bucket.toLowerCase().replace(/\s+/g, '-');
  }

  function renderKanbanCardHtml(m) {
    var name = val(m, 'Name') || '(no name)';
    var playa = val(m, 'Playa Name');
    var location = (val(m, 'Location') || '').split(',')[0].trim();
    var applied = relativeDays(m['Timestamp']);
    var metaBits = [];
    if (applied) metaBits.push('Applied ' + applied);
    if (location) metaBits.push(location);
    var firstBurn = (val(m, 'First Burn') || '').toLowerCase();
    var hasTicket = (val(m, 'Has Ticket') || '').toLowerCase();
    var tags = '';
    if (firstBurn === 'yes' || firstBurn === 'true' || firstBurn === '1') tags += '<span class="kb-tag first-burn">First Burn</span>';
    if (hasTicket === 'yes' || hasTicket === 'true' || hasTicket === '1') tags += '<span class="kb-tag">Has Ticket</span>';
    return '<div class="kb-card" data-row="' + m._row + '"' + (isAdmin ? ' draggable="true"' : '') + '>' +
      (isAdmin ? '<button type="button" class="kb-menu-btn" data-row="' + m._row + '">&#8942;</button>' : '') +
      '<div class="kb-name">' + JH.esc(name) + '</div>' +
      (playa ? '<div class="kb-playa">' + JH.esc(playa) + '</div>' : '') +
      (metaBits.length ? '<div class="kb-meta">' + JH.esc(metaBits.join(' · ')) + '</div>' : '') +
      (tags ? '<div class="kb-tags">' + tags + '</div>' : '') +
      '</div>';
  }

  function renderKanban() {
    var board = document.getElementById('kanban-board');
    if (!board) return;
    var expanded = readExpandedBuckets();
    var byBucket = { 'Pending': [], 'In Progress': [], 'Approved': [], 'Observer': [], 'Rejected': [] };
    allMembers.forEach(function(m) {
      var b = bucketOf(val(m, 'Status'));
      if (byBucket[b]) byBucket[b].push(m);
    });
    var html = '';
    BUCKET_ORDER.forEach(function(bucket) {
      var isExpanded = expanded.indexOf(bucket) !== -1;
      var cls = 'kb-col ' + bucketCssClass(bucket) + (isExpanded ? '' : ' collapsed');
      var cards = byBucket[bucket].map(renderKanbanCardHtml).join('');
      html += '<div class="' + cls + '" data-bucket="' + bucket + '">' +
        '<div class="kb-col-header"><span>' + bucket + '</span><span class="count">' + byBucket[bucket].length + '</span></div>' +
        '<div class="kb-cards">' + cards + '</div>' +
        '</div>';
    });
    board.innerHTML = html;
    wireKanbanEvents(board);
  }

  function wireKanbanEvents(board) {
    // Spine click → expand. Click on header of an expanded column → collapse.
    board.querySelectorAll('.kb-col').forEach(function(col) {
      var header = col.querySelector('.kb-col-header');
      header.addEventListener('click', function() {
        var bucket = col.getAttribute('data-bucket');
        var expanded = readExpandedBuckets();
        var i = expanded.indexOf(bucket);
        if (i === -1) expanded.push(bucket); else expanded.splice(i, 1);
        writeExpandedBuckets(expanded);
        renderKanban();
      });
    });
    // Card click → modal (ignore clicks on the menu button / drag handle)
    board.querySelectorAll('.kb-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        if (e.target.closest('.kb-menu-btn')) return;
        var row = parseInt(card.getAttribute('data-row'));
        var member = allMembers.find(function(m) { return m._row === row; });
        if (member) openModal(member);
      });
    });
    // ⋯ menu button handled in Chunk 4 / a follow-up; leave a stub here
    board.querySelectorAll('.kb-menu-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        // Implemented alongside DnD in Chunk 4
        openStatusMenu(btn);
      });
    });
  }

  function openStatusMenu(/* btn */) {
    // Stub for Chunk 4
  }
```

- [ ] **Step 3: Re-render Kanban when data changes**

`updateStatus` already calls `gridApi.setGridOption('rowData', getRowData())` on success. After the rowData refresh, also call `renderKanban()` if it exists. Find the lines that update grid rowData in `updateStatus` (around line 269+) and add `renderKanban();` after each:

```js
member['Status'] = newStatus;
refreshStats();
gridApi.setGridOption('rowData', getRowData());
renderKanban();  // ← add this
```

- [ ] **Step 4: Verify**

```bash
node --check assets/js/admin-applications.js && echo OK
```

Reload `/admin/applications`. Click `Kanban` toggle. Expect:
- 5 columns rendered
- Pending + In Progress full-width with cards
- Approved / Observer / Rejected as thin spines with vertical labels
- Click a spine → it expands inline
- Click an expanded card → existing modal opens
- Toggle back to Grid; reload; the page comes back in last-used view (Grid or Kanban)

---

### Task 17: Commit Chunk 3

- [ ] **Step 1: Stage + commit**

```bash
git add admin/applications.html assets/js/admin-applications.js assets/css/admin.css
git commit -m "Applications: scaffold Kanban view alongside Grid

- View toggle (Grid | Kanban) above the filter row; selection
  persists in localStorage jh.applications.view
- Kanban renders one column per bucket from STATUS_BUCKETS, with
  Approved / Observer / Rejected defaulting to a collapsed spine
  (admin clicks the spine to expand; state persists)
- Cards show name, playa name, applied-X-days-ago, first
  segment of location, First Burn + Has Ticket tags
- Card click opens the existing detail modal
- Mobile hides the view toggle and falls back to Grid via CSS
- No drag-and-drop yet — next chunk wires that"
```

---

## Chunk 4: Kanban drag-and-drop + in-card status menu

Adds HTML5 drag-and-drop so admins can move cards between bucket columns, plus a `⋯` per-card menu that exposes all 8 sub-statuses (the only way to set a specific In Progress sub-status from Kanban). Drops reuse `updateStatus()`, so all popup logic from the Observer work applies automatically.

### Task 18: Wire `draggable` cards + drag/drop handlers

**Files:**
- Modify: `assets/js/admin-applications.js` (inside `wireKanbanEvents`)

- [ ] **Step 1: Add drag event handlers to cards**

Inside `wireKanbanEvents`, **wrap the new code in an explicit `if (isAdmin)` block** (not an early return — Chunk 3's spine + card-click handlers run before this and must stay registered for Observers). Append:

```js
  if (isAdmin) {
    var draggedRow = null;

    board.querySelectorAll('.kb-card').forEach(function(card) {
      card.addEventListener('dragstart', function(e) {
        draggedRow = parseInt(card.getAttribute('data-row'));
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.4';
      });
      card.addEventListener('dragend', function() {
        draggedRow = null;
        card.style.opacity = '';
      });
    });

    // Drop targets include collapsed spines (same .kb-col class, same
    // data-bucket attribute). On drop into a collapsed spine, updateStatus
    // → renderKanban re-reads jh.applications.kanban.expanded and re-renders
    // with the spine still collapsed; only the count badge ticks up.
    board.querySelectorAll('.kb-col').forEach(function(col) {
      col.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', function() {
        col.classList.remove('drag-over');
      });
      col.addEventListener('drop', function(e) {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (draggedRow == null) return;
        var bucket = col.getAttribute('data-bucket');
        var member = allMembers.find(function(m) { return m._row === draggedRow; });
        if (!member) return;
        var currentBucket = bucketOf(val(member, 'Status'));
        if (currentBucket === bucket) return; // No-op (same bucket — use ⋯ menu to sub-shuffle)
        // Pick the sub-status to set:
        //   Pending / Approved / Observer / Rejected → unambiguous
        //   In Progress → land on 'Review' (first sub-status)
        var newStatus = bucket === 'In Progress' ? 'Review' : bucket;
        updateStatus(member, newStatus);
      });
    });
  }
```

- [ ] **Step 2: Add `.drag-over` styling**

Append to `admin.css`:

```css
.kb-col.drag-over { box-shadow: inset 0 0 0 2px var(--accent); }
```

- [ ] **Step 3: Verify**

Reload Kanban. Run through each path:

1. **Pending → Approved (promote-to-Approved popup).** Drag a Pending card onto the Approved column. "Send invite email to X?" popup fires (existing `sendInvite` flow). Card moves to Approved; Kanban re-renders.
2. **Pending → Observer (promote-to-Observer popup, Observer template).** Drag a Pending card onto the Observer column (you may need to first click the Observer spine to expand it as a drop target, OR drag onto the spine directly per Step 4). The same `sendInvite` popup fires but uses `tplObserverWelcome`; on send, Telegram fires "joined as a lurker".
3. **Approved → Observer (silent demotion).** Drag an Approved card onto Observer. No popup, no email, no Telegram. Card moves; Kanban re-renders.
4. **Approved → Rejected (silent).** Drag an Approved card onto the Rejected spine. No popup. Card vanishes from Approved; Rejected count badge ticks up; spine stays collapsed.
5. **Drop into In Progress lands as Review.** Drag a Pending card onto the In Progress column. Open the destination card's modal — Status is `Review` (the first In Progress sub-status). Use the per-card `⋯` menu (Task 19) to refine to a different sub-status.

- [ ] **Step 4: Verify drop on collapsed spine**

Without first expanding the Rejected column, drag a Pending card directly onto the Rejected spine. Expect:
- Card disappears from Pending.
- Rejected count badge increments.
- Spine stays collapsed (does NOT auto-expand).
- Stat-card "Rejected" count updates.

---

### Task 19: Implement the in-card `⋯` status menu

**Files:**
- Modify: `assets/js/admin-applications.js` (replace the `openStatusMenu` stub from Chunk 3)

- [ ] **Step 1: Replace the stub with a real menu**

```js
  function openStatusMenu(btn) {
    var row = parseInt(btn.getAttribute('data-row'));
    var member = allMembers.find(function(m) { return m._row === row; });
    if (!member) return;
    // Tear down any existing menu
    var prev = document.querySelector('.kb-status-menu');
    if (prev) prev.remove();
    var menu = document.createElement('div');
    menu.className = 'kb-status-menu';
    ALL_STATUSES.forEach(function(s) {
      var item = document.createElement('button');
      item.type = 'button';
      item.textContent = s;
      if (s === val(member, 'Status')) item.classList.add('current');
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        menu.remove();
        updateStatus(member, s);
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect();
    menu.style.left = (r.right - menu.offsetWidth) + 'px';
    menu.style.top = (r.bottom + 4 + window.scrollY) + 'px';
    setTimeout(function() {
      document.addEventListener('click', function dismiss() {
        menu.remove();
        document.removeEventListener('click', dismiss);
      });
    }, 0);
  }
```

- [ ] **Step 2: Style the menu**

Append to `admin.css`:

```css
.kb-status-menu {
  position: absolute;
  z-index: 50;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.kb-status-menu button {
  background: transparent;
  border: none;
  color: var(--text);
  padding: 6px 10px;
  text-align: left;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  border-radius: 4px;
}
.kb-status-menu button:hover { background: var(--surface2); }
.kb-status-menu button.current { color: var(--accent); }
```

- [ ] **Step 3: Verify**

Reload Kanban. Click `⋯` on a card. Expect:
- Menu opens with all 8 sub-statuses, current one highlighted in accent color.
- Click a different status → menu closes, status updates (Kanban re-renders, popups fire as appropriate).
- Click outside the menu → menu closes.

---

### Task 20: Commit Chunk 4

- [ ] **Step 1: Stage + commit**

```bash
git add admin/applications.html assets/js/admin-applications.js assets/css/admin.css
git commit -m "Applications: Kanban drag-and-drop + per-card status menu

- HTML5 DnD wired on cards (admin only); drop into a different bucket
  fires updateStatus() so the existing silent-demotion + promote-to-
  Approved-popup + Observer-welcome flows apply automatically
- Drops into the In Progress column land on 'Review' (the first
  sub-status); admins refine via the per-card ⋯ menu
- Per-card ⋯ menu lists all 8 sub-statuses; current status highlighted
- .drag-over CSS state gives the column a visible accent border"
```

---

## Chunk 5: Polish (Observer + mobile gates, smoke test)

Final pass: confirm the Observer experience is read-only (no drag, no menu, click-only), confirm the mobile fallback works, and run a manual smoke test. Bug fixes only — no new functionality.

### Task 21: Confirm Observer gates

**Files:**
- Read: `assets/js/admin-applications.js` (already-written code)

- [ ] **Step 1: Verify code gates**

From Task 16 (`renderKanbanCardHtml`): `draggable="true"` is only emitted when `isAdmin` is true.
From Task 16 (`renderKanbanCardHtml`): the `⋯` button is only emitted when `isAdmin` is true.
From Task 18 (`wireKanbanEvents`): drag wiring lives inside an `if (isAdmin) { ... }` block, so Observers never get drag handlers attached but still keep the spine-click + card-click handlers registered earlier in the function.

Confirm by reading the file:

```bash
grep -n "isAdmin" assets/js/admin-applications.js | head -10
```

Expected: multiple matches in `renderKanbanCardHtml` and the start of the drag-wiring block.

- [ ] **Step 2: Mental check — Observer columns popover access**

Observer is non-admin, so per the spec note in Section 3e, Observers can still use the Columns popover (it controls only personal view prefs, not data). The Columns popover wiring in Task 10 doesn't check `isAdmin`. Good — no change needed.

- [ ] **Step 3: Mental check — modal click-through**

Observer is allowed to click a Kanban card to open the modal (read-only modal). The card-click handler in `wireKanbanEvents` doesn't check `isAdmin`. Good — no change needed.

---

### Task 22: Mobile gate sanity check

**Files:**
- Read: `assets/css/admin.css`

- [ ] **Step 1: Confirm `.view-toggle` and `#view-kanban-wrap` are display:none on mobile**

```bash
grep -A 3 "@media.*768px" assets/css/admin.css | head -20
```

Expected: a media query hiding `.view-toggle` and `#view-kanban-wrap` (and `.columns-control` from Chunk 2).

- [ ] **Step 2: Confirm JS doesn't render Kanban on mobile**

In Task 15 the toggle wiring does `applyView(JH.isMobile ? 'grid' : readView())`. Confirm:

```bash
grep "JH.isMobile.*grid.*readView\|readView.*isMobile" assets/js/admin-applications.js
```

Expected: one match.

---

### Task 23: Manual smoke test on dev server

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Open `http://localhost:3000/admin/applications` and log in as an admin.

- [ ] **Step 2: Status taxonomy**

- Confirm 5 stat cards (Pending / In Progress / Approved / Observer / Rejected).
- Open dropdown — 6 options (All Applications + 5 buckets). No Review / Vibe Check / etc.
- Click "In Progress" filter — grid shows only Review/Vibe Check/Team Discussion/On-boarding rows. Count card "In Progress" matches the displayed row count.
- Click "All Applications" — grid resets.

- [ ] **Step 3: Columns popover**

- Confirm default visible columns: View, Invite, Name, Playa Name, Responsible HR, Status.
- Click `Columns ▾` — popover opens with checkboxes.
- Toggle Phone on — column appears. Toggle Location on — column appears.
- Reload — Phone and Location still visible.
- Click outside popover — closes.

- [ ] **Step 4: Kanban**

- Click `Kanban` — view switches. Reload — comes back in Kanban.
- 5 columns visible. Approved / Observer / Rejected start as spines.
- Click Approved spine — expands.
- Click a card — modal opens (same content as Grid row click). Close modal.
- Drag a Pending card onto In Progress — card moves, no popup. Open modal, status is now Review.
- Drag a Review card onto Approved — "Send invite email?" popup fires. Cancel — card stays in Approved (status was already updated; only the email step was canceled).
- Drag an Approved card onto Observer — silent demotion. Card moves; no popup.
- Click `⋯` on a card — menu opens with 8 statuses. Pick a different sub-status — card status updates.

- [ ] **Step 5: Observer perspective**

Use `scripts/local-login-link.mjs <observer-email>` to mint a magic link and paste into the browser.

- Kanban toggle visible. Click Kanban.
- Cards have no `⋯` button, no drag cursor.
- Try to drag a card — nothing happens (no `draggable` attribute).
- Click a card — modal opens. All inputs read-only (existing behavior from Observer work).
- Open Columns popover — still works. Toggle a column on — column appears (personal pref, not a data write).

- [ ] **Step 6: Mobile sanity**

Resize browser to ~700px wide.
- View toggle hidden.
- Kanban view (if it was last-used in localStorage) doesn't show — falls back to Grid.
- Columns popover button hidden.
- Mobile column layout intact.

---

### Task 24: Commit Chunk 5 (smoke-test sign-off)

- [ ] **Step 1: Empty/noop commit to mark completion**

```bash
git commit --allow-empty -m "Applications: smoke-test sign-off for redesign

Manually verified on dev server:
- Status buckets (5 cards, dropdown filter, counts match)
- Columns popover (default visible set, toggle + persist)
- Kanban (view toggle, spine collapse, card render, modal click-
  through, drag-and-drop, ⋯ menu, Observer disable, mobile fallback)

No code changes in this commit — gate marker before opening PR."
```

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin <feature-branch>
gh pr create --base main --title "Applications page redesign" \
  --body "$(cat <<'EOF'
## Summary

Slims the Applications page header (5 buckets instead of 8 stat cards / dropdown options), moves column control behind a Columns ▾ popover, and adds a Kanban view alongside the existing Grid.

Frontend-only. STATUS_BUCKETS is a display layer; backend ALL_STATUSES is unchanged. Kanban DnD calls updateStatus(), so all popup / silent-demotion / promote-invite logic from the Observer work applies automatically.

## Spec

docs/superpowers/specs/2026-05-22-applications-page-redesign.md

## Test plan

- [ ] Visit Vercel preview. Confirm 5 stat cards, 6-option filter dropdown, Columns ▾ button (not the inline toggle row).
- [ ] Click "In Progress" filter; grid shows Review/Vibe Check/Team Discussion/On-boarding rows.
- [ ] Toggle Phone on via the Columns popover; reload — still visible.
- [ ] Switch to Kanban; verify spine collapse on Approved/Observer/Rejected; expand by clicking spine.
- [ ] Drag a Pending card to In Progress — lands as Review; popup behavior matches dropdown changes.
- [ ] Log in as an Observer; verify no drag, no ⋯ menu, can still open Columns popover + click cards.
- [ ] Mobile (≤768px): view toggle hidden, Kanban hidden, Grid only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementing engineer

- **No test framework here.** Project doctrine is prototype-grade (CLAUDE.md). Don't add Jest or similar as part of this work. Verification is grep + dev server + browser smoke.
- **`updateStatus` is the load-bearing function for status changes.** Both Grid dropdown and Kanban drag call it. The popup / silent-demotion / promote-invite logic is already in there from the Observer work — don't reimplement, don't duplicate.
- **AG Grid filter API quirks.** The Status filter section in Task 5 has a fallback path because AG Grid's built-in filter operators vary by version. If `type: 'in'` doesn't work on first try, take the custom-filter path immediately rather than wrestling with it.
- **localStorage keys are user-facing in the sense that they persist behavior.** All three (`jh.applications.view`, `jh.applications.columns`, `jh.applications.kanban.expanded`) live under the `jh.applications.*` prefix. Add a one-line comment near the constants pointing at this convention so future devs don't sprinkle new keys with different prefixes.
- **Kanban + Grid stay in sync via `updateStatus`'s `renderKanban()` call.** If you add a new path that mutates member status, remember to also call `renderKanban()` after the local `member['Status'] = ...` update.
- **First Burn / Has Ticket cell truthiness** — the Members sheet stores these as string values. Cover `'yes'`, `'true'`, `'1'` as truthy; everything else as falsy. Adjust if the data shows other truthy variants.
- **The dev scripts in `scripts/`** (seed-test-applicant.mjs, local-login-link.mjs, clear-must-change-password.mjs, delete-test-account.mjs if you keep it) are useful for setting up test rows fast without disturbing live data. The local-login script is the fastest path into an Observer session on localhost.
