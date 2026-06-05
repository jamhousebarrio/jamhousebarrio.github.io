# Clickable Member Names + "Current Members" Rename — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "Approved Members" nav label to "Current Members", and make playa names clickable on the Shifts, Logistics, Roles & Leads, and Fee Paid pages — opening the same basic-info panel the Current Members page already shows.

**Architecture:** Extract the member basic-info panel (currently local to `demographics.html`) into shared `JH` helpers in `assets/js/admin-auth.js` (a classic, non-module script loaded on every admin page). The shared layer provides: a cached roster (`JH.roster`), a name→member resolver (`JH.findMemberByName`), a lazily-injected slide-in panel (`JH.openMemberPanel(member, extras)`), a string helper that renders a name as a clickable link only when it resolves (`JH.nameLink`), and one document-level delegated click handler. Each page that renders names swaps `JH.esc(name)` → `JH.nameLink(name)`. Demographics is refactored to call the shared panel (passing its computed Roles/Last-Login as `extras`), and its local panel CSS/HTML is removed.

**Tech Stack:** Vanilla JS (ES5-style, classic `<script>`), the global `JH` namespace, `admin.css`, Jekyll static pages. No new dependencies. No build step.

**Spec:** `docs/superpowers/specs/2026-06-05-clickable-member-names-design.md`

**Branch:** `feat/clickable-member-names` (created off `main` and rebased after the budget fix PR #8 merged, so it includes that fix).

---

## Testing note (read before starting)

The repo unit-tests **pure logic** modules (`assets/js/*-logic.js`, ESM) via `npm test` (`node --test test/`). The name-matching here would be a candidate, BUT the helpers must live in `admin-auth.js`, which is loaded as a **classic script** (`<script src=...>`, no `type="module"`) on demographics/fee-paid/roles/shifts. A classic script cannot `import`/`export`, and converting `admin-auth.js` to a module is out of scope and risky (it's loaded on every page and defines `JH` synchronously). The matching logic is trivial (compare two fields, case-insensitive + trimmed). **Decision:** keep it inline in `admin-auth.js` and verify in-browser (the spec explicitly permits this). `npm test` must still pass unchanged (no existing tests touched).

After each chunk, run `npm test` (expect 34 passing, unchanged) and `node --check` on any edited `.js` to catch syntax errors before committing.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `assets/js/admin-auth.js` | Shared `JH` layer | Nav label; `JH.roster`; `JH.findMemberByName`; `JH.openMemberPanel`; `JH.nameLink`; delegated click handler |
| `assets/css/admin.css` | Shared admin styles | Add panel + `.panel-close` + `.name-link`(+hover) styles (moved from demographics) |
| `admin/demographics.html` | Current Members page | Rename (3 spots); remove local panel CSS (split mixed `@media`) + panel HTML |
| `assets/js/admin-demographics.js` | Current Members logic | `NameCellRenderer` → `JH.openMemberPanel(m, {roles,lastLogin})`; remove local panel code |
| `assets/js/admin-logistics.js` | Logistics page | Wrap member name (desktop `<strong>` + mobile card) |
| `assets/js/admin-fee-paid.js` | Fee Paid page | Wrap names in 3 render sites |
| `assets/js/admin-roles.js` | Roles page | Wrap `.assigned-chip` labels |
| `assets/js/admin-shifts.js` | Shifts page | Wrap `.shift-chip` assignee labels |

---

## Chunk 1: Shared panel + helpers in `admin-auth.js` and `admin.css`

This chunk builds the reusable machinery and the nav rename. Nothing is wired into the four target pages yet; demographics still uses its own local panel (so the app keeps working until Chunk 2). After this chunk, the helpers exist and can be smoke-tested from any admin page's console.

### Task 1: Rename nav label

**Files:**
- Modify: `assets/js/admin-auth.js` (the nav array entry, ~line 159)

- [ ] **Step 1: Edit the nav label**

Find:
```js
  { href: '/admin/demographics', icon: '&#9776;', text: 'Approved Members', access: 'general' },
```
Change `text: 'Approved Members'` → `text: 'Current Members'`. Leave `href` and `icon` unchanged.

- [ ] **Step 2: Verify**

Run: `grep -n "Current Members" assets/js/admin-auth.js`
Expected: one match on the nav line. `grep -n "Approved Members" assets/js/admin-auth.js` → no matches.

### Task 2: Cache the roster in `authenticate()`

**Files:**
- Modify: `assets/js/admin-auth.js` (inside `JH.authenticate`, where `data.members` is available — right after `var data = await res.json();`, ~line 117)

- [ ] **Step 1: Cache roster**

Immediately after the line that parses the members response (`var data = await res.json();`) and before the `JH.currentUser` assignment, add:
```js
    JH.roster = data.members || [];
```

- [ ] **Step 2: Verify**

Run: `node --check assets/js/admin-auth.js` → no output (OK).

### Task 3: Add `JH.findMemberByName` and `JH.nameLink`

**Files:**
- Modify: `assets/js/admin-auth.js` (add near the other `JH.*` renderer/util definitions, e.g. just after `JH.NameLinkRenderer`/`getGui` block ~line 276)

- [ ] **Step 1: Implement the resolver + link helper**

```js
// Resolve a displayed name to a full member record from the cached roster.
// Matches Playa Name OR Real Name, case-insensitive and trimmed. Returns the
// first match (duplicate display names are rare in a ~50-person barrio) or null.
JH.findMemberByName = function(name) {
  var key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  var roster = JH.roster || [];
  for (var i = 0; i < roster.length; i++) {
    var m = roster[i];
    var playa = String(JH.val(m, 'Playa Name') || '').trim().toLowerCase();
    var real = String(JH.val(m, 'Name') || '').trim().toLowerCase();
    if (playa === key || real === key) return m;
  }
  return null;
};

// Render a name as a clickable basic-info link IF it resolves to a member,
// else as plain escaped text. Returns an HTML string for use in innerHTML.
JH.nameLink = function(name) {
  var safe = JH.esc(name || '');
  if (!name || !JH.findMemberByName(name)) return safe;
  return '<a href="#" class="name-link" data-member-name="' + safe + '">' + safe + '</a>';
};
```

- [ ] **Step 2: Verify** — `node --check assets/js/admin-auth.js` → OK.

### Task 4: Add `JH.openMemberPanel(member, extras)` (lazy-injected panel)

**Files:**
- Modify: `assets/js/admin-auth.js` (add after Task 3 helpers)

Reference — the demographics field list this replaces (`admin-demographics.js:155-169`): Real Name, Age, Gender, Nationality, Location, **Roles**, Phone, Email, Admin, **Last Login**, First Burn, First Elsewhere, Has Ticket, Volunteer. Only **Roles** and **Last Login** are non-record (passed via `extras`).

- [ ] **Step 1: Implement the panel**

```js
// Lazily-injected, shared member basic-info slide-in panel. `extras` is optional:
// { roles, lastLogin } — rendered only when provided (demographics passes them;
// other pages omit them). All other fields read off the member record via JH.val.
JH.ensureMemberPanel = function() {
  if (document.getElementById('member-overlay')) return;
  var ov = document.createElement('div');
  ov.className = 'member-overlay';
  ov.id = 'member-overlay';
  var panel = document.createElement('div');
  panel.className = 'member-panel';
  panel.id = 'member-panel';
  panel.innerHTML =
    '<div class="member-panel-header">' +
      '<h3 id="member-panel-title"></h3>' +
      '<button class="panel-close" id="member-panel-close">&times;</button>' +
    '</div>' +
    '<div id="member-panel-body"></div>';
  document.body.appendChild(ov);
  document.body.appendChild(panel);
  function close() { ov.classList.remove('active'); panel.classList.remove('active'); }
  document.getElementById('member-panel-close').addEventListener('click', close);
  ov.addEventListener('click', close);
};

JH.openMemberPanel = function(m, extras) {
  if (!m) return;
  JH.ensureMemberPanel();
  extras = extras || {};
  document.getElementById('member-panel-title').textContent =
    JH.val(m, 'Playa Name') || JH.val(m, 'Name') || 'Member';
  // [label, value] in demographics order; Roles + Last Login come from extras.
  var fields = [
    ['Real Name', JH.val(m, 'Name')],
    ['Age', JH.val(m, 'Age')],
    ['Gender', JH.val(m, 'Gender')],
    ['Nationality', JH.val(m, 'Nationality')],
    ['Location', JH.val(m, 'Location')],
    ['Roles', extras.roles || ''],
    ['Phone', JH.val(m, 'Phone')],
    ['Email', JH.val(m, 'Email')],
    ['Admin', JH.val(m, 'Admin')],
    ['Last Login', extras.lastLogin || ''],
    ['First Burn', JH.val(m, 'First Burn')],
    ['First Elsewhere', JH.val(m, 'First Elsewhere/Nowhere')],
    ['Has Ticket', JH.val(m, 'Has Ticket')],
    ['Volunteer', JH.val(m, 'Volunteer')]
  ];
  document.getElementById('member-panel-body').innerHTML = fields.filter(function(f) {
    return f[1];
  }).map(function(f) {
    return '<div class="member-field"><span class="member-field-label">' + JH.esc(f[0]) +
      '</span><span class="member-field-value">' + JH.esc(f[1]) + '</span></div>';
  }).join('');
  document.getElementById('member-overlay').classList.add('active');
  document.getElementById('member-panel').classList.add('active');
};
```

- [ ] **Step 2: Verify** — `node --check assets/js/admin-auth.js` → OK.

### Task 5: Add the delegated click handler

**Files:**
- Modify: `assets/js/admin-auth.js` (add at top level, after the panel helpers)

- [ ] **Step 1: Bind one document-level listener**

```js
// One delegated handler for every clickable name link across all admin pages.
// Resolves the clicked name to a member and opens the shared panel. Names that
// don't resolve are never rendered as links (see JH.nameLink), so this is a no-op
// for plain text. The remove-buttons on Shifts use a different selector, no clash.
document.addEventListener('click', function(e) {
  var a = e.target.closest && e.target.closest('a.name-link[data-member-name]');
  if (!a) return;
  e.preventDefault();
  var m = JH.findMemberByName(a.getAttribute('data-member-name'));
  if (m) JH.openMemberPanel(m);
});
```

- [ ] **Step 2: Verify** — `node --check assets/js/admin-auth.js` → OK.

### Task 6: Move panel CSS into `admin.css`

**Files:**
- Modify: `assets/css/admin.css` (append the rules)
- Modify: `admin/demographics.html` (remove the moved rules from its `<style>`; carefully split the mixed `@media` block)

Reference — current demographics `<style>` rules to move (`demographics.html`, lines ~20-44): `.name-link`(+`:hover`), `.member-overlay`(+`.active`), `.member-panel`(+`.active`), `.member-panel-header`(+`h3`), `.panel-close`(+`:hover`), `.member-field`(+`:last-child`), `.member-field-label`, `.member-field-value`; and inside `@media (max-width:480px)` (runs to line ~44): `.member-panel { width:100vw; right:-100vw; }` and `.member-field-label { font-size:0.75rem; }` (the same `@media` block ALSO contains `.charts-3col`, `#roster-grid`, `#location-wrap` — those STAY).

- [ ] **Step 1: Read the exact current rules**

Run: `sed -n '18,45p' admin/demographics.html` and copy the exact rule bodies (don't hand-retype values — preserve them verbatim).

- [ ] **Step 2: Append the moved rules to `admin.css`**

Add a clearly-commented block at the end of `assets/css/admin.css`:
```css
/* ── Shared member basic-info panel (used by Current Members, Shifts, Logistics,
   Roles, Fee Paid). Moved out of demographics.html so all pages share it. ── */
.name-link { color: var(--accent); cursor: pointer; font-weight: 600; text-decoration: none; }
.name-link:hover { text-decoration: underline; }
.member-overlay { /* …verbatim from demographics… */ }
.member-overlay.active { display: block; }
.member-panel { /* …verbatim… */ }
.member-panel.active { right: 0; }
.member-panel-header { /* …verbatim… */ }
.member-panel-header h3 { /* …verbatim… */ }
.panel-close { /* …verbatim… */ }
.panel-close:hover { /* …verbatim… */ }
.member-field { /* …verbatim… */ }
.member-field:last-child { border-bottom: none; }
.member-field-label { /* …verbatim… */ }
.member-field-value { /* …verbatim… */ }
@media (max-width: 480px) {
  .member-panel { width: 100vw; right: -100vw; }
  .member-field-label { font-size: 0.75rem; }
}
```
(Fill each `/* …verbatim… */` with the exact body from Step 1. If `.panel-close` is also used by other panels elsewhere, that's fine — it's a shared class now.)

- [ ] **Step 3: Remove the moved rules from `demographics.html`**

Delete the panel rules from the `<style>` block (Step-1 list). In the `@media (max-width:480px)` block, delete ONLY the `.member-panel` and `.member-field-label` lines; KEEP `.charts-3col`, `#roster-grid`, `#location-wrap`.

- [ ] **Step 4: Verify CSS didn't break parse / no leftover dup**

Run: `grep -n "member-panel\|member-field\|panel-close\|name-link" assets/css/admin.css` → present.
Run: `grep -n "\.member-panel\|\.member-field\|\.panel-close" admin/demographics.html` → only inside-`@media` lines should be GONE; the only remaining `.member-*` hits should be none (all moved). Confirm `.charts-3col`/`#roster-grid` still present in demographics.html.

- [ ] **Step 5: Commit chunk 1**

```bash
git add assets/js/admin-auth.js assets/css/admin.css admin/demographics.html
git commit -m "feat(members): shared member-info panel + helpers in JH; rename nav to Current Members"
```
(Note: demographics.html still has its local panel HTML + still-working `openMemberPanel` from `admin-demographics.js`; we removed only the CSS here. Demographics will momentarily render its panel using the moved `admin.css` rules — still works. Chunk 2 finishes the demographics refactor.)

---

## Chunk 2: Refactor demographics to the shared panel

### Task 7: Rename the three "Approved Members" strings in `demographics.html`

**Files:**
- Modify: `admin/demographics.html` (front-matter `title:` ~line 3, `<title>`, visible `<h1>`/heading)

- [ ] **Step 1: Find them** — Run: `grep -n "Approved Members" admin/demographics.html` (expect ~3 hits: front-matter, `<title>`, heading).
- [ ] **Step 2: Replace** each "Approved Members" → "Current Members".
- [ ] **Step 3: Verify** — `grep -n "Approved Members" admin/demographics.html` → no matches; `grep -n "Current Members" admin/demographics.html` → ~3.

### Task 8: Point demographics callers at the shared panel; remove local panel code

**Files:**
- Modify: `assets/js/admin-demographics.js` (`NameCellRenderer` ~line 186-198; the mobile `onRowClicked` handler ~line 328-330; local `openMemberPanel` ~153-176; `closeMemberPanel` + close wiring ~178-184)
- Modify: `admin/demographics.html` (remove the static panel HTML ~line 109-115)

> **There are TWO callers of the local `openMemberPanel`** — the `NameCellRenderer` click (desktop) AND the AG Grid `onRowClicked` mobile handler. Both must be rewired before the local function is deleted, or mobile row-tap throws `ReferenceError`. To avoid repetition, define one small local helper and call it from both sites.

- [ ] **Step 1a: Add a local extras-passing helper**

Near the top of the IIFE (after `memberRoles`/`memberLastLogin`/`fmtDateTime` are defined), add:
```js
  function showMember(m) {
    JH.openMemberPanel(m, { roles: memberRoles(m), lastLogin: fmtDateTime(memberLastLogin(m)) });
  }
```

- [ ] **Step 1b: Rewire `NameCellRenderer`**

In `NameCellRenderer.prototype.init`, replace the click handler body that calls the local `openMemberPanel(memberData)`:
```js
    this.eGui.addEventListener('click', function(e) {
      e.preventDefault();
      showMember(memberData);
    });
```

- [ ] **Step 1c: Rewire the mobile `onRowClicked`** (~line 328-330)

```js
    onRowClicked: JH.isMobile ? function(event) {
      if (event.data._member) showMember(event.data._member);
    } : undefined
```

- [ ] **Step 2: Delete the local panel functions**

Remove the local `function openMemberPanel(m) { … }` and `function closeMemberPanel() { … }` and their close/overlay wiring (`document.getElementById('member-panel-close').addEventListener(...)` and `memberOverlay.addEventListener(...)`), plus the now-unused `memberOverlay`/`memberPanel`/`memberPanelTitle`/`memberPanelBody` lookups (~lines 146-184). The shared `JH.openMemberPanel` owns all of this now. Keep `memberRoles`, `memberLastLogin`, `fmtDateTime`, and `esc` (still used elsewhere — verify with grep before deleting any).

- [ ] **Step 3: Remove the static panel HTML**

In `demographics.html`, delete the `<div class="member-overlay" id="member-overlay"></div>` and the `<div class="member-panel" id="member-panel"> … </div>` block (~lines 109-115). The shared helper injects these on first open.

- [ ] **Step 4: Verify no dangling references**

Run: `grep -n "openMemberPanel\|closeMemberPanel\|memberOverlay\|memberPanel\b" assets/js/admin-demographics.js` → the only `openMemberPanel` hit is the single `JH.openMemberPanel(...)` call inside the `showMember` helper; both `NameCellRenderer` and `onRowClicked` now go through `showMember`. No bare `openMemberPanel(`/`closeMemberPanel(`/`memberOverlay`/`memberPanel` references remain.
Run: `node --check assets/js/admin-demographics.js` → OK.
Run: `grep -n "member-overlay\|member-panel" admin/demographics.html` → no matches (HTML removed; CSS already moved in Chunk 1).

- [ ] **Step 5: In-browser check (demographics)** — see Verification Procedure below; confirm a name still opens the panel with **Roles + Last Login present** and styling intact (incl. mobile full-width).

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin-demographics.js admin/demographics.html
git commit -m "refactor(demographics): use shared JH.openMemberPanel; drop local panel; finish Current Members rename"
```

---

## Chunk 3: Wrap names on the four target pages

Each task swaps the name's `JH.esc(name)` for `JH.nameLink(name)` at its render site(s). `JH.nameLink` returns plain escaped text when the name doesn't resolve, so non-members stay non-clickable automatically.

### Task 9: Logistics

**Files:**
- Modify: `assets/js/admin-logistics.js` (desktop row name ~line 329; mobile-card name — find with grep)

- [ ] **Step 1: Locate render sites** — Run: `grep -n "m\['Playa Name'\] || m\['Name'\]\|<strong>" assets/js/admin-logistics.js`. Identify the desktop `<td>…<strong>{name}</strong>` and the mobile-card name cell.
- [ ] **Step 2: Wrap** — In the desktop row, change the name output from `JH.esc(name)` to `JH.nameLink(name)` (keep the `(you)` suffix and any edit pencil button as-is — only the name text becomes a link). Do the same in the mobile card's name.
- [ ] **Step 3: Verify** — `node --check assets/js/admin-logistics.js` → OK.
- [ ] **Step 4: In-browser** — Logistics: a member row's name is an accent link; clicking opens the panel (no Roles/Last Login rows — expected). The `(you)` marker + edit pencil still work.
- [ ] **Step 5: Commit** — `git add assets/js/admin-logistics.js && git commit -m "feat(logistics): clickable member names → basic-info panel"`

### Task 10: Fee Paid (three sites)

**Files:**
- Modify: `assets/js/admin-fee-paid.js` (roster `<tr>` cell ~135-136; roster `.m-card` title ~146-147; low-income requests `.who` ~280)

- [ ] **Step 1: Locate** — Run: `grep -n "esc(r.name)\|esc(r.playa_name)\|playa_name\|m-card-title\|class=\"who\"" assets/js/admin-fee-paid.js`.
- [ ] **Step 2: Wrap** — At each site, wrap the **playa name** (and where both are shown, the playa name) with `JH.nameLink(...)` instead of `esc(...)`. For the `.who` line `esc(r.name) (esc(r.playa_name))`, make the playa name the link (fall back to wrapping `r.name` if `playa_name` is blank). Keep status badges/`(...)` punctuation outside the link.
- [ ] **Step 3: Verify** — `node --check assets/js/admin-fee-paid.js` → OK.
- [ ] **Step 4: In-browser** — Fee Paid (admin login): names in the roster table, roster mobile cards, and the low-income requests list are clickable and open the panel.
- [ ] **Step 5: Commit** — `git add assets/js/admin-fee-paid.js && git commit -m "feat(fee-paid): clickable member names in roster + requests"`

### Task 11: Roles & Leads

**Files:**
- Modify: `assets/js/admin-roles.js` (`.assigned-chip` render ~line 95-97)

- [ ] **Step 1: Locate** — Run: `grep -n "assigned-chip" assets/js/admin-roles.js`.
- [ ] **Step 2: Wrap** — Change `'<span class="assigned-chip">' + JH.esc(p) + '</span>'` → `'<span class="assigned-chip">' + JH.nameLink(p) + '</span>'`.
- [ ] **Step 3: Verify** — `node --check assets/js/admin-roles.js` → OK.
- [ ] **Step 4: In-browser** — Roles: assigned-member chips are clickable → panel. Editing/deleting a role still works.
- [ ] **Step 5: Commit** — `git add assets/js/admin-roles.js && git commit -m "feat(roles): clickable assigned-member names → basic-info panel"`

### Task 12: Shifts

**Files:**
- Modify: `assets/js/admin-shifts.js` (`.shift-chip filled` assignee render inside `renderShiftCellInner`, ~line 124-130)

- [ ] **Step 1: Locate** — Run: `grep -n "shift-chip filled\|remove-person-btn" assets/js/admin-shifts.js`.
- [ ] **Step 2: Wrap** — Change the chip's person text from `JH.esc(person)` to `JH.nameLink(person)`. **Critical:** keep the remove-`×` button (`.remove-person-btn`, with its `data-person`/`data-id`) exactly as-is inside the chip — only the name text becomes a link. The button keeps `JH.esc(person)` in its `title`/`data-person` (those are attribute values, not display text).
- [ ] **Step 3: Verify** — `node --check assets/js/admin-shifts.js` → OK.
- [ ] **Step 4: In-browser** — Shifts: an assignee's name in a filled chip is clickable → panel. The remove-`×` on the same chip still removes the assignment (no panel opens when clicking `×`). The separate volunteer-leaderboard popover is unaffected.
- [ ] **Step 5: Commit** — `git add assets/js/admin-shifts.js && git commit -m "feat(shifts): clickable assignee names → basic-info panel"`

---

## Chunk 4: Full verification & PR

### Task 13: Cross-page verification + tests + PR

- [ ] **Step 1: Static checks** — `npm test` (expect **34 passing**, unchanged) and `node --check` on all five edited JS files (already done per-task; re-run as a batch).
- [ ] **Step 2: Full in-browser pass** — Using the Verification Procedure below, confirm on the local dev server, while logged in as an admin: nav reads "Current Members"; each of the 5 pages opens the correct member's panel on name click; an **unmatched** name (e.g. an external/noorg name not in the roster, if present) renders as plain text (not a link); mobile (≤480px) panel is full-width; demographics shows Roles + Last Login, the other four don't.
- [ ] **Step 3: Push + PR**
```bash
git push -u origin feat/clickable-member-names
gh pr create --base main --head feat/clickable-member-names \
  --title "feat: clickable member names + Current Members rename" \
  --body "Implements docs/superpowers/specs/2026-06-05-clickable-member-names-design.md. See plan docs/superpowers/plans/2026-06-05-clickable-member-names.md."
```
- [ ] **Step 4:** Report PR URL; do NOT merge (deploy is the user's call, per the budget-fix precedent).

---

## Verification Procedure (local, in-browser)

The dev server may already be running (`npm run dev` → `http://localhost:3000`). If not, start it. Admin pages require a Supabase login, which only the user can perform — so this procedure is **driven with the user** (they log in; the agent drives via the browser tools, or the user clicks through). For each page: open it, click a known member's playa name, confirm the slide-in panel shows that member's info, close it. Use a clearly-known member to confirm identity. No data is written by this feature, so no cleanup is needed.

Pages to check: Current Members (demographics), Logistics, Fee Paid, Roles & Leads, Shifts.

## Edge cases to spot-check
- A name that isn't in the roster → plain text, no link, no panel.
- A member whose stored assignment name differs in case/whitespace → still resolves (case-insensitive/trimmed).
- Re-rendering a list (e.g. logistics filter, shift signup) → names stay clickable; no duplicate handlers (the listener is bound once at document level).
