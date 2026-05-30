# Early Entry — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)
**Component type:** Load-bearing (admin coordination tool inherited by next coordinator)

## Problem

Anyone on-site **before the gate opens** (Monday lunch, 6 July 2026) is in the
setup period and needs an **early-entry (EE) pass**. EE passes come from three
pools:

1. **Barrio** — the camp is allocated a limited number (`max(10, 25% of the barrio)`).
2. **NoOrg** — granted by the festival org to people doing a NoOrg (festival-crew)
   duty during the setup period; does **not** consume the barrio allocation.
3. **Artist EE** — granted via the art department; does not consume the barrio
   allocation.

The volunteer coordinator (Frank) needs to: see who is arriving before the gate,
assign each of them an EE from one of the three pools, track the barrio pool
against its cap, and **highlight early arrivers who have no EE assigned yet**.

## Decisions (from brainstorming)

- **Cutoff is date-only.** Early = `ArrivalDate ≤ 2026-07-05`. Gate date is
  `2026-07-06` (the Monday). Time-of-day on the gate day is ignored.
  - *Known edge case / assumption:* someone arriving the morning of Mon 6 Jul to
    do a pre-gate setup shift is **not** flagged as early under the date-only
    rule. Accepted for simplicity; revisit if it bites.
- **Barrio cap is computed and tracked:** `cap = max(10, ceil(0.25 × approvedCount))`.
  Show `used / cap (remaining)`; warn when `used > cap`. Only `Source = barrio`
  rows count against the cap.
- **NoOrg eligibility is auto-suggested** from existing `MemberLogistics.NoOrgDates`:
  any NoOrg day `≤ 2026-07-05` marks the member NoOrg-EE-eligible (a hint badge;
  the admin still assigns the source).
- **Approach A:** dedicated admin page for the UI, backend reuses `logistics.js`
  (the Vercel function cap is 12/12 — no new `api/*.js` allowed), assignments
  stored in a new `EarlyEntry` Google Sheet tab.
- **`EarlyEntry` is keyed by member name** (playa-preferred display, same
  convention as `MemberLogistics`/`ShiftData`), with a playa↔legal fallback on
  lookup. (Email keying was considered for stability but rejected to stay
  consistent with the rest of the app.)

## Data model

### New tab: `EarlyEntry` (Members sheet, `SHEET_ID`)

| Column | Purpose |
|--------|---------|
| `MemberName` | Row key — playa-preferred display name (`Playa Name \|\| Name`) |
| `Source` | `barrio` \| `noorg` \| `artist` (blank / no row = unassigned) |
| `Notes` | Optional free text (e.g. "art grant EE") |
| `UpdatedAt` | ISO timestamp of last write |
| `UpdatedBy` | Authed admin's name/email — EE is a scarce resource, so light audit |

Auto-created on first write, matching the auto-create-tab pattern used by every
other API.

### Reused, unchanged

- `MemberLogistics` — `MemberName`, `ArrivalDate` and `NoOrgDates`
  (comma-separated) both stored as `yyyy-mm-dd` (Flatpickr `dateFormat:'Y-m-d'`;
  the `d/m/Y` shown in the input is `altInput` display only).
- `Sheet1` (members) — approved members + their `Playa Name` / `Name`.

Nothing is duplicated: arrival and NoOrg facts stay in `MemberLogistics`; only the
EE assignment lives in `EarlyEntry`.

## Computation (pure logic — unit-tested)

Extracted to `assets/js/early-entry-logic.js`, mirroring the unit-tested
`assets/js/inventory-labels.js`:

- `parseDate(s)` — accepts `yyyy-mm-dd` (both ArrivalDate and NoOrgDates are
  stored this way) plus a defensive `dd/mm/yyyy` fallback; returns a UTC `Date`
  or `null`.
- `isEarlyArrival(arrivalDate, gate)` — `true` when a parseable arrival date is
  strictly before `gate` (i.e. `≤ 2026-07-05` for `gate = 2026-07-06`).
- `hasSetupNoOrg(noOrgDates, gate)` — `true` when any comma-separated NoOrg day
  parses to before `gate`.
- `barrioCap(approvedCount)` — `max(10, ceil(0.25 × approvedCount))`.

Constants: `GATE = 2026-07-06`.

**`approvedCount` source:** the page fetches members (the same `JH.authenticate()`
member list the other admin pages use) and counts those with
`Status === 'approved'` — the filter already used in `admin-demographics.js` and
`admin-shifts.js`. No new endpoint.

**Name lookup / playa↔legal fallback:** an `EarlyEntry.MemberName` is matched
against a member by comparing it to **either** the member's `Playa Name` **or**
`Name`, reusing the two-field comparison already in `api/logistics.js` upsert
(the `target !== myName && target !== myPlaya` pattern) and the frontend
`findLogisticsRow` fallback in `admin-logistics.js`. This keeps EE rows resolvable
even if a member is later edited to prefer their other name.

## UI — `admin/early-entry.html` + `assets/js/admin-early-entry.js`

Admin-only page (coordinator tool). New nav link added to **every** admin
sidebar; rewrite added to `vercel.json`.

```
┌─ Early Entry ───────────────────────────────────────────────┐
│  Early arrivals: 12   Covered: 8   Uncovered: 4 ⚠           │
│  Barrio pool: 6 / 11 used  (5 left)                          │
├─────────────────────────────────────────────────────────────┤
│ Name        Arrives   NoOrg setup?  EE source      Notes     │
│ Goutière    Fri 3 Jul   —           [Barrio ▾]     …         │
│ Dima        Sat 4 Jul   ✓ 4 Jul     [NoOrg  ▾]     …         │
│ Sara        Sun 5 Jul   —           [— none —]  ⚠  …         │ ← highlighted
│ Engineer D. Sun 5 Jul   —           [Artist ▾]     …         │
├─ Arrival unknown (chase these) ─────────────────────────────┤
│ Ben, Claudiu, …  (no arrival date filled in)                │
└─────────────────────────────────────────────────────────────┘
```

- **Stats bar:** early count, covered, uncovered (warning), barrio pool
  `used / cap (remaining)` with a red state when over cap.
- **Table**, sorted by arrival date via **`parseDate` (numeric Date compare)** —
  robust regardless of stored format, and the natural choice since the page
  already parses each date: Name · Arrives · NoOrg-setup badge · EE-source
  `<select>` (— none — / Barrio / NoOrg / Artist) · Notes (inline).
- **Uncovered rows** (no source) get the highlighted/warning background — the
  "highlight those who don't have it" requirement.
- **Barrio when pool full →** confirm dialog ("Barrio pool is full — assign
  anyway?"), mirroring the shift-override pattern. Other sources unlimited.
- **Source select saves immediately**; Notes save on blur. Reload refreshes
  stats.
- **"Arrival unknown" group:** approved members with no arrival date, so they can
  be chased.
- Observers read-only.

## API — actions added to `api/logistics.js`

- **`early-entry-fetch`** → `{ earlyEntry: [...] }` (rows of the `EarlyEntry`
  tab). Admin-only.
- **`set-early-entry`** `{ memberName, source, notes }` → upsert the row keyed by
  `MemberName`; `source = ''` clears it. Validates
  `source ∈ {'', barrio, noorg, artist}`. Auto-creates the tab. Stamps
  `UpdatedAt` + `UpdatedBy` from the authed admin. Admin-only; observers rejected
  (403).
- Default `fetch` (arrival data) unchanged — the page makes both calls.

**Handler-collision note:** `logistics.js` currently destructures a fixed field
list (including `memberName` and `notes`) from `req.body` at the top of the
handler. The EE actions reuse those same field names but for a *different* tab —
the existing `upsert` writes `notes` to `MemberLogistics.Notes`. To avoid any
cross-action bleed, the `set-early-entry` branch must read its own
`memberName` / `source` / `notes` and write only to `EarlyEntry`; it must not
fall through into the logistics `upsert` path.

### Permissions

| Action | Observer | Member | Admin |
|--------|----------|--------|-------|
| view page / fetch EE | — (no nav) | — (no nav) | ✅ |
| `set-early-entry` | ❌ 403 | ❌ 401 | ✅ |

## Testing

- **TDD** for `assets/js/early-entry-logic.js` via `test/early-entry-logic.test.js`
  (`npm test`), written before the implementation. Covers date-boundary cases
  (exactly 5 Jul vs 6 Jul), mixed date formats, empty/garbage input, and the
  `barrioCap` rounding (e.g. 10 floor, 25% above 40 members).
- Page wiring, the `logistics.js` actions, and sheet I/O follow existing patterns
  and are not separately unit-tested, consistent with the rest of the codebase.

## Out of scope (YAGNI)

PDF/print export, email notifications, per-source caps beyond barrio, and any
audit UI beyond the `UpdatedBy` stamp.

## Change-enforcement note

This adds a new admin page → per CLAUDE.md "Adding an Admin Page", the nav link
must be added to **all** admin sidebars, and a rewrite added to `vercel.json`.
The backend reuses `logistics.js` to respect the 12/12 Vercel function cap.
Update CLAUDE.md's "Google Sheet Tabs" table with the new `EarlyEntry` tab.
