# Shift Point System — Design

**Date:** 2026-06-08
**Status:** Approved (brainstorm)
**Area:** Admin → Shifts (`admin/shifts.html`, `assets/js/admin-shifts.js`, `api/shifts.js`)

## Problem

The Shifts page already has a fairness leaderboard that ranks members by a
contribution score. Today that score is duration-based:

```js
score = (setupDays + strikeDays) * 8 + eventHours
```

Pure clock duration is a poor proxy for effort. A 15-minute "Shit Ninja" run
(check the toilets, restock paper/gel) scores 0.25 even though nobody wants it,
while a flat 8-hour credit for any build/strike day ignores whether the person
was actually doing barrio setup or was away on festival-wide (NoOrg) duty.

We want **admin-set point weights** to become the fairness currency, so effort
can be distributed evenly across the camp regardless of how long each job takes.

## Decisions (from brainstorm)

1. **Points replace hours** as the ranking currency. Hours stay visible as a
   supporting detail, not as the score.
2. **Granularity: per shift type, flat.** One weight per type (e.g.
   "Cooking = 5") applies to every slot of that type on every day. ~10–15
   numbers total.
3. **Build/strike days: flat points per day, NoOrg excluded.** A present
   setup/strike day earns its point value unless that date is in the member's
   `NoOrgDates` (festival duty, not barrio → 0 barrio points).
4. **Weights UI: one "Points" modal on the Shifts page.** A single admin button
   opens a modal listing every shift type plus Build-day and Strike-day inputs —
   all weights visible at once for balancing. No new admin page / nav entry.
5. **Defaults:** type with no weight = **1 pt**; build day and strike day default
   to **10 pts** until an admin sets them. Nothing silently scores zero.

## Data Model

New tab **`ShiftWeights`** in the Members sheet (`SHEET_ID`). Explicit `Kind`
column so a build/strike value can never collide with a shift-type name.

| Column | Meaning |
|--------|---------|
| `Kind` | `type` \| `build` \| `strike` |
| `Name` | shift type name (for `Kind=type`); ignored for build/strike |
| `Points` | integer point value |

Example rows:

| Kind | Name | Points |
|------|------|--------|
| type | Cooking | 5 |
| type | Shit Ninja | 2 |
| build | | 10 |
| strike | | 10 |

- Keyed to `ShiftData.Name` by exact string match for `Kind=type`.
- Auto-created on first write, consistent with every other tab.
- Unset reads fall back to the defaults above (handled in the pure logic layer,
  not by writing default rows).

## API — actions on `api/shifts.js`

No new serverless function (project is at the 12/12 Vercel Hobby cap). Two new
actions on the existing `shifts.js`:

- **`get-weights`** — returns all weight rows. Available to any authenticated
  user, because the leaderboard (visible to all members) needs them to compute
  points. Returns `{ weights: [{Kind, Name, Points}], buildPts, strikePts }`
  with defaults already applied for the two day-values.
- **`set-weights`** — **admin-only.** Upserts the full weight set from the modal
  in a single call: `{ types: [{name, points}], buildPts, strikePts }`. Replaces
  the tab contents (or upserts row-by-row) so removed types don't linger.

### Change-enforcement on existing actions

- **`rename-type`** must also rename the matching `ShiftWeights` row
  (`Kind=type`, `Name=oldName` → `newName`). Otherwise the weight orphans and the
  renamed type silently falls back to the 1-pt default.
- **`delete` / delete-type flow** cleans up the type's `ShiftWeights` row when
  the last shift of a type is removed. (Best-effort; an orphaned weight row is
  harmless but should be groomed.)

## Points Modal (Shifts page)

Admin-only **"⚖ Points"** button near the existing "+ Add Shift Type" /
"Print" controls. Opens a modal:

```
Set point weights
─────────────────────────────
Build day      [ 10 ]  pts/day
Strike day     [ 10 ]  pts/day
─────────────────────────────
Cooking            [ 5 ]
Shit Ninja         [ 2 ]
Stage Management   [ 4 ]
… (one row per existing shift type, prefilled with current or default 1)
─────────────────────────────
              [ Save ]
```

- Type rows generated from the shift types already loaded on the page
  (`getShiftTypes()`), so the list always matches what exists.
- Types still at the default value are visually flagged ("default") so admins
  know what they haven't reviewed.
- One **Save** posts `set-weights`, then the page reloads and the leaderboard
  re-ranks.

## Scoring — pure, unit-tested module

Extract the scoring math out of the inline `computeContributions()` in
`admin-shifts.js` into **`assets/js/shift-points-logic.js`**, following the
existing pattern of `early-entry-logic.js`, `inventory-labels.js`, and
`meals-logic.js` (pure logic, no DOM, unit-tested via `npm test`).

New formula per member:

```
points = (buildDays  − noOrgBuildDays)  × buildPts
       + (strikeDays − noOrgStrikeDays) × strikePts
       + Σ pointsWeight(type) for each event shift the member is signed up for
```

Where:

- `buildDays` / `strikeDays` derive from logistics arrival/departure vs. the
  event window (July 7–12, 2026), as today.
- `noOrgBuildDays` / `noOrgStrikeDays` = count of the member's `NoOrgDates` that
  fall inside the build window and strike window respectively, subtracted out.
- `pointsWeight(type)` = the type's `ShiftWeights` value, or **1** if unset.

The module exposes the per-member breakdown (build pts, strike pts, event pts,
plus the underlying hours) so the UI can show points as the rank and hours as a
detail.

### Leaderboard / detail display

- Leaderboard **ranks by points**. Row shows points prominently with a short
  breakdown (e.g. `3d build · 12 event pts`).
- Per-volunteer modal keeps the existing per-shift list but annotates each shift
  with its point weight alongside the hours
  (e.g. `Cooking — 5 pts · 2.0h`).
- Top vs. "Needs encouragement" split stays the same logic (points > 0 vs. 0).

## Testing

- `shift-points-logic.js` gets unit tests covering: type-weight lookup with and
  without a configured weight (default 1), build/strike day counting, NoOrg
  exclusion within each window, and total points aggregation.
- Manual verification on the running app: set weights in the modal, confirm the
  leaderboard re-ranks and the hours detail still renders.

## Out of scope (YAGNI)

- Per-slot or duration-scaled weights (chose flat per-type).
- Separate point tracking for NoOrg contribution (NoOrg simply earns 0 barrio
  points).
- Historical/audit log of weight changes.

## Files touched

- `api/shifts.js` — `get-weights`, `set-weights`, rename/delete enforcement.
- `assets/js/shift-points-logic.js` — **new**, pure scoring module.
- `assets/js/admin-shifts.js` — Points modal, call `set-weights`/`get-weights`,
  use the pure module for the leaderboard, hours-as-detail display.
- `admin/shifts.html` — "⚖ Points" button + modal markup.
- Test file for `shift-points-logic.js` (alongside existing JS unit tests).
- `CLAUDE.md` — document the `ShiftWeights` tab and the rename change-enforcement
  rule.
