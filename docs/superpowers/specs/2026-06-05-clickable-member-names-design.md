# Clickable member names + "Current Members" rename — design

**Date:** 2026-06-05
**Status:** Approved (design); pending spec review
**Component tier:** Load-bearing (shared `JH` helper used across 5 admin pages)

## Problem

Two related changes to the JamHouse admin dashboard:

1. The sidebar nav item **"Approved Members"** should read **"Current Members"**.
2. Playa names on the **Shifts, Logistics, Roles & Leads, and Fee Paid** pages should be
   clickable, opening the same basic-info panel that the (renamed) Current Members page
   already shows when you click a name.

Today that basic-info panel exists only on `demographics.html` — its CSS, HTML, and the
`openMemberPanel()` function are all local to that one page. To reuse it on four more
pages without copy-pasting, it must be extracted into the shared `JH` layer.

## Goals

- Rename the nav label (and the page's own title/heading) to "Current Members".
- One shared, lazily-injected basic-info panel reused by all 5 pages (demographics +
  the 4 target pages), with a single source of truth for the field list.
- Clicking a playa name anywhere it appears on the 4 target pages opens that member's
  panel.
- Names that don't resolve to a member record render as plain text (no broken panel).

## Non-goals

- **Not** renaming the route `/admin/demographics` → no file rename, no `vercel.json`
  rewrite changes, no nav `href` churn. Only display text changes. (Bookmarks/links keep
  working; the rename is purely cosmetic.)
- Not changing the panel's field list or styling.
- Not touching pages outside the four named (e.g. Early Entry, Timeline, Meals), even
  though they also show names. Out of scope per the agreed request.
- Not removing or merging the Shifts page's existing "Volunteer detail popover" (hours
  summary). The new basic-info panel is additive.

## Current state (verified)

- **Nav** is a shared array in `assets/js/admin-auth.js` (~line 159):
  `{ href: '/admin/demographics', icon: '…', text: 'Approved Members', access: 'general' }`.
  Single source — no per-page nav duplication.
- **Panel** lives only in `admin/demographics.html`:
  - CSS for `.member-overlay`, `.member-panel`, `.member-panel-header`, `.member-field`,
    `.member-field-label`, `.member-field-value` (incl. a `@media` mobile rule) is in that
    file's `<style>` block.
  - HTML: `<div class="member-overlay" id="member-overlay">` + `<div class="member-panel"
    id="member-panel">` with `member-panel-title` / `member-panel-body` /
    `member-panel-close`.
  - `openMemberPanel(m)` in `assets/js/admin-demographics.js` builds the field list
    (Real Name, Age, Gender, Nationality, Location, Roles, Phone, Email, Admin, Last
    Login, First Burn, First Elsewhere, Has Ticket, Volunteer) and toggles `.active`.
  - `NameCellRenderer` (AG Grid) wires the name cell's click to `openMemberPanel`.
  - **Important:** two of those fields are NOT columns on the member record —
    **Roles** is computed from a page-local `rolesByMember`/`memberRoles()` map, and
    **Last Login** comes from an admin-only `/api/auth` `list-last-signin` fetch that only
    the demographics page performs. The other 12 fields read directly off the member
    object via `JH.val(m, …)`.
  - The close button uses `class="panel-close"`; `.panel-close`/`.panel-close:hover` are
    styled **only** in `demographics.html`'s `<style>` (not in `admin.css`).
  - The demographics `.name-link` style (lines ~20-21) includes a `:hover` underline.
  - The mobile `@media (max-width: 480px)` block in `demographics.html` is **mixed**: it
    interleaves panel rules (`.member-panel`, `.member-field-label`) with
    demographics-only rules (`.charts-3col`, `#roster-grid`).
- **`JH.authenticate()`** (admin-auth.js ~line 97) fetches `/api/members` and already has
  the full roster as `data.members` (array of member objects with all columns). It
  currently returns this array to callers but does **not** cache it on `JH`.
- **All four target pages build names with `innerHTML` strings, not AG Grid:**
  - **Logistics** (`admin-logistics.js`): iterates member objects `m`; renders
    `<strong>${name}</strong>` per row (desktop table) and in mobile cards.
    Name = `m['Playa Name'] || m['Name']`.
  - **Fee Paid** (`admin-fee-paid.js`): hand-built `<table>` + mobile `.m-card`;
    renders `r.name` and `r.playa_name` from the fee roster.
  - **Roles** (`admin-roles.js`): assigned members shown as
    `<span class="assigned-chip">${p}</span>`, where `p` is a name string from a
    comma-separated `assigned` field.
  - **Shifts** (`admin-shifts.js`): assignees shown as
    `<span class="shift-chip filled">${person}</span>` inside `renderShiftCellInner`,
    where `person` is a name string from comma-separated `s.AssignedTo`. (Note: the
    `data-name` attributes on the shift grid are **shift-type** names; the contribution
    leaderboard's `.vol-open-btn[data-name]` IS a member name but uses a different
    selector/attribute than our `a.name-link[data-member-name]`, so there's no collision.)

## Design

### Part 1 — Rename (display only)

- `admin-auth.js`: nav item `text: 'Approved Members'` → `'Current Members'`.
- `admin/demographics.html`: **three** occurrences → "Current Members": the Jekyll
  front-matter `title:` (line ~3), the page `<title>`, and the visible `<h1>`/heading.
- Route, filename, and `href` unchanged.

### Part 2 — Shared basic-info panel

New shared pieces (one source of truth):

1. **CSS moves to `assets/css/admin.css`.** Cut these rules from `demographics.html` into
   `admin.css`: `.member-overlay`(+`.active`), `.member-panel`(+`.active`),
   `.member-panel-header`(+`h3`), `.member-field`(+`:last-child`), `.member-field-label`,
   `.member-field-value`, **and `.panel-close`(+`:hover`)** (the close button's style lives
   only here — easy to miss). From the mixed mobile `@media (max-width:480px)` block, move
   **only** the panel lines (`.member-panel`, `.member-field-label`) and **leave** the
   demographics-layout rules (`.charts-3col`, `#roster-grid`, `#location-wrap`) in
   `demographics.html`. Add a shared `.name-link` rule (accent color, pointer cursor, weight 600, no
   underline) **plus its `:hover { text-decoration: underline }`** — matching the existing
   demographics `.name-link` exactly so every page styles clickable names identically.
   (`admin.css` currently has no `.member-*`/`.panel-close`/`.name-link` rules, so no
   collision.)

2. **`JH.openMemberPanel(member, extras)` in `admin-auth.js`.**
   - On first call, lazily creates and appends the overlay + panel DOM to `<body>`
     (idempotent: checks for an existing `#member-overlay`). This means target pages need
     **no** panel HTML of their own.
   - Renders the **12 member-record fields** (Real Name, Age, Gender, Nationality,
     Location, Phone, Email, Admin, First Burn, First Elsewhere, Has Ticket, Volunteer)
     directly from the member object via `JH.val`. This field list lives **once**, here.
   - **Roles** and **Last Login** are not on the member record. The signature takes an
     optional `extras` object — `{ roles, lastLogin }` — and renders those two rows
     **only when provided**. The demographics page (which already computes both) passes
     them in; the four target pages call `JH.openMemberPanel(member)` with no extras, so
     those two rows are simply omitted there. This keeps "basic info" coherent without
     making every page build a roles map or do an admin-only fetch (YAGNI).
   - Field rows render in the demographics order, with Roles/Last Login slotted into their
     existing positions when present.
   - Wires close-on-overlay-click and close button (the helper now owns this).
   - Uses `JH.val(member, field)` and `JH.esc`; formats `extras.lastLogin` the same way
     demographics does (`fmtDateTime`/`JH.formatDateLong`).

3. **`JH.roster` + `JH.findMemberByName(name)` in `admin-auth.js`.**
   - `authenticate()` caches the fetched roster: `JH.roster = data.members || []`.
   - `JH.findMemberByName(name)` returns the first member whose **Playa Name** or **Name**
     equals `name` compared **case-insensitively and trimmed**, else `null`. (Chip/cell
     names — Roles `assigned`, Shifts `AssignedTo` — are stored verbatim but may differ in
     case/whitespace, so insensitive matching is deliberate. Logistics' own row lookup uses
     an exact match; we intentionally use a looser rule here.) Duplicate display names →
     first match (acceptable for a ~50-person barrio; documented in Edge cases).

4. **One delegated global click handler in `admin-auth.js`.**
   - A single `document`-level listener: on click of a `closest('a.name-link[data-member-name]')`,
     `preventDefault()`, resolve via `JH.findMemberByName(el.dataset.memberName)`, and if
     found call `JH.openMemberPanel(member)`.
   - Because all 4 pages render HTML strings, each page change is only: wrap the name in
     `<a href="#" class="name-link" data-member-name="${JH.esc(name)}">${JH.esc(name)}</a>`
     **when** `JH.findMemberByName(name)` resolves; otherwise emit the existing plain text.
   - This avoids per-page click wiring and works identically for tables, chips, and cards.

5. **Demographics refactor.** `admin-demographics.js`'s `NameCellRenderer` calls
   `JH.openMemberPanel(memberData, { roles: memberRoles(memberData), lastLogin:
   memberLastLogin(memberData) })` — it has the full `_member` object directly, so it skips
   name resolution and passes the computed Roles/Last Login as extras. The local
   `openMemberPanel`, `closeMemberPanel`, and the close-button/overlay click wiring
   (`admin-demographics.js:178-184`) are **all removed** (the shared helper owns them now —
   removing them avoids double-binding). The local panel HTML and the moved CSS are removed
   from `demographics.html`. Net: one source of truth; demographics behavior unchanged
   (Roles + Last Login still show there because they're passed as extras).

### Per-page edits (Part 2 application)

Each is a small render change wrapping the name when it resolves to a member:

- **Logistics:** wrap the `<strong>` name in desktop rows + the mobile-card name.
- **Fee Paid:** **three** render sites — the roster `<tr>` cell, the roster `.m-card`
  title, **and** the low-income requests `.who` div (`admin-fee-paid.js:~280`,
  `name (playa_name)`). Wrap the name in all three for consistency.
- **Roles:** wrap each `assigned-chip` label.
- **Shifts:** wrap each `shift-chip` assignee label. The remove `×` is a separate
  `.remove-person-btn` with its own delegated handler, and the new global handler only
  matches `closest('a.name-link')`, so the two don't conflict — but keep the `×` button
  markup intact inside the chip. (The Shifts "Volunteer detail popover" is triggered by a
  separate leaderboard's `.vol-open-btn`, not the chips, so no overlap.)

A tiny shared helper keeps these DRY, e.g.
`JH.nameLink(name)` → returns the `<a class="name-link" …>` string if the name resolves,
else `JH.esc(name)`. Pages call `JH.nameLink(person)` instead of `JH.esc(person)`.

## Data flow

```
authenticate() ──fetch /api/members──> data.members
        │                                  │
        ├─ returns members to page         └─ cached as JH.roster
        ▼
page render: JH.nameLink(name)
        │  (uses JH.findMemberByName against JH.roster)
        ▼
<a class="name-link" data-member-name="…">…</a>   OR   plain esc(name)
        │ click
        ▼
delegated handler ─ JH.findMemberByName ─> JH.openMemberPanel(member) ─> slide-in panel
```

## Edge cases & error handling

- **Unmatched name** (external/noorg guest, legacy spelling): `JH.nameLink` returns plain
  text — no link, no panel. No error.
- **Duplicate display names**: `findMemberByName` returns the first match. Acceptable for a
  ~50-person barrio; documented assumption.
- **Name stored as legal name vs playa name**: matching checks both fields, so either form
  resolves.
- **Observer / non-admin viewers**: the panel is read-only info already visible on the
  Current Members page to all `general`-access users; no new permission surface. (Fee Paid
  is admin-gated at the page level already; unchanged.)
- **Re-render safety**: the delegated listener is bound once at the document level, so
  pages that re-render their lists (shifts grid, logistics) don't accumulate handlers.
- **Panel double-injection**: `JH.openMemberPanel` checks for existing DOM before creating.

## Testing / verification

- Pure-logic unit test for `JH.findMemberByName` matching (playa vs legal, case/space
  insensitivity, no-match → null) if it can be extracted to a testable pure function;
  otherwise verify in-browser. (Matches repo convention of unit-testing pure helpers via
  `npm test`.)
- Manual in-browser verification on local dev for each of the 5 pages: click a name →
  correct member's panel opens; an unmatched name is plain text; demographics still works;
  mobile panel is full-width; shifts remove-`×` still works.

## Files touched

- `assets/js/admin-auth.js` — nav label; `JH.roster`; `JH.findMemberByName`;
  `JH.openMemberPanel`; `JH.nameLink`; delegated click handler.
- `assets/css/admin.css` — panel + `.panel-close` + `.name-link`(+`:hover`) styles (moved
  from demographics); panel-only lines from the mobile `@media` block.
- `admin/demographics.html` — rename in front-matter `title:`, `<title>`, and `<h1>`;
  remove local panel CSS (incl. splitting the mixed `@media` block) + panel HTML.
- `assets/js/admin-demographics.js` — `NameCellRenderer` calls shared `JH.openMemberPanel`
  with `{roles, lastLogin}` extras; remove local `openMemberPanel`/`closeMemberPanel` +
  close-button wiring.
- `assets/js/admin-logistics.js` — wrap names.
- `assets/js/admin-fee-paid.js` — wrap names.
- `assets/js/admin-roles.js` — wrap names.
- `assets/js/admin-shifts.js` — wrap assignee names.
