# NoOrg Duty Tracking + Admin Logistics Editing

## Problem

Members of JamHouse also take festival-wide shifts with NoOrg (the event
organisation). On those days they can't do barrio setup/strike work. We need
a way to track per-member NoOrg duty days so the setup timeline can visibly
block those cells, and so planners can see at a glance who's available.

## Goals

- Members can mark which days they're on NoOrg duty (full days only)
- Admins can edit any member's logistics (including NoOrg days)
- Setup timeline shows those days as non-assignable, styled distinctly from
  "not arrived yet"

## Data model

Extend the `MemberLogistics` Google Sheet tab with one new column:

- `NoOrgDates` — comma-separated `YYYY-MM-DD` list (e.g. `2026-07-05,2026-07-08`)

No new tabs. `/api/logistics.js` already auto-creates the tab — we let its
`ensureTab` / upsert flow pick up the new column when it first appears in a
payload.

## API changes

`/api/logistics.js` `upsert` action:

- Accept new field `noOrgDates` (string — comma-separated `YYYY-MM-DD` list,
  already normalised client-side)
- Admin-check: if the request's `memberName` differs from the authenticated
  member's name, require admin. Non-admins can only upsert their own row.

Existing `fetch` action already returns the full row; no change.

## UI — Logistics page (`/admin/logistics`)

### Member's own form ("My Info")

Add a new field below "Camping Type / Size":

- **Label:** "NoOrg duty days"
- **Hint:** *"Days you're on festival crew — barrio setup tasks won't be
  assigned to you on these days."*
- **Input:** Flatpickr multi-date (`mode: 'multiple'`, dateFormat
  `Y-m-d`, altFormat `d/m/Y`), allow any date between arrival and departure
  (or the whole event window if those aren't set yet)

### All Members table

- Add a **"NoOrg"** column (between Camping/Size and Notes) showing a short
  summary: `—` if empty, otherwise `N day(s)` with a `title` tooltip listing
  the dates in `dd/mm` form.
- For admins only: add a small pencil icon at the start of each row. Clicking
  it enters an "editing someone else" mode.

### Admin "edit someone else" mode

- When the pencil is clicked, the "My Info" panel re-renders, pre-filled with
  the target member's logistics, and the panel header becomes
  *"Editing **\<name\>**"* with a **"Back to my info"** link.
- Save button writes to the target member's row (calls upsert with
  `memberName: targetName`).
- Returning to "my info" restores the normal self-edit view.
- Implementation: add `state.editingMember` alongside `state.myName`. When
  set, all form reads/writes use `editingMember`; when null, they use
  `myName`. Render logic checks `state.editingMember || state.myName`.

## UI — Setup timeline (`/admin/timeline`)

For each (person, date) pair where the date is in that person's
`NoOrgDates`, both the Morning and Evening cells render as blocked:

- Cell class: `.task-cell.noorg` (new)
- Styling: dim red tint background (e.g. `rgba(244,67,54,0.08)`), italic
  "NoOrg" label in muted red, `cursor: not-allowed`
- Not editable — click handler ignores cells with class `noorg`
- Drag-drop drops onto these cells are rejected
- Tooltip: *"On NoOrg duty"*

Distinct from the existing `.task-cell.unavailable` ("Not arrived yet") so
planners can tell the difference at a glance.

Add a short legend line above the timeline table:

> *Grey = not arrived yet. Red = on NoOrg duty.*

Data plumbing: `admin-timeline.js` currently fetches members + timeline
entries. Extend it to also fetch `/api/logistics` and build a map
`{ personName: Set<date> }` of NoOrg dates. Cell render consults the map.

## Behaviour details

- Dates in `NoOrgDates` are stored as `YYYY-MM-DD` (sheet-friendly sort).
- The multi-date picker lets you click the same date twice to deselect.
- If a member changes their name in the sheet after logging NoOrg days, the
  timeline mapping may miss them — out of scope; existing logistics already
  has this coupling.
- Empty / whitespace-only `NoOrgDates` is treated as no duty days.

## Out of scope (explicit)

- Half-day (AM/PM) NoOrg granularity
- Automatic conflict prevention on the existing `/admin/shifts` sign-up
  (shifts use arbitrary start/end times; day-level NoOrg data isn't a clean
  block. Revisit later if real conflicts happen)
- Admin bulk-edit / CSV import
- Notifications when someone's NoOrg days change

## Success criteria

- Any approved member can log NoOrg duty days from `/admin/logistics` and see
  them saved on reload.
- An admin can click the pencil on another member's row and edit their
  logistics (including NoOrg days), then return to their own view.
- The setup timeline visually blocks Morning/Evening cells on a person's
  NoOrg days and distinguishes them from "not arrived yet" cells.
- The All Members table shows a NoOrg count per member.
- Non-admin members cannot edit other members' logistics (API enforces).
