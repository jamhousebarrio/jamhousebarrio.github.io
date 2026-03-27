# Volunteer Shifts — Design Spec

**Date:** 2026-03-27
**Project:** JamHouse barrio coordination portal
**Feature:** Volunteer shift scheduling, sign-up, and knowledge base

---

## Overview

A role-aware volunteer shift management system accessible at `/admin/shifts`. Approved members can view the schedule, request open slots, and bail on shifts they've committed to. Admins can confirm assignments, manage shift definitions, configure schedule slots, and maintain a per-shift knowledge base.

---

## Data Model

Three new tabs in the existing Members Google Sheet (`SHEET_ID`).

### Tab: `ShiftDefs`

One row per shift type. Shift types can be added, edited, or removed by admins at any time.

| Column | Type | Description |
|---|---|---|
| `ShiftID` | string | Unique slug, e.g. `dinner`, `lnt-afternoon` |
| `Name` | string | Display name, e.g. "Dinner Shift" |
| `Description` | string | What the shift involves |
| `TimeExpectation` | string | e.g. "~2 hours after dinner" |
| `KBText` | string | Free-form knowledge base text (markdown) |
| `KBLinks` | string | Pipe-separated `Label\|URL` pairs, e.g. `Meal Plan\|https://...` |

### Tab: `ShiftConfig`

One row per **slot** (a column in the schedule grid). Slots can be full days or specific time windows — mixed freely.

| Column | Type | Description |
|---|---|---|
| `SlotID` | string | Unique slug, e.g. `tue-1`, `wed-am` |
| `Label` | string | Display label, e.g. "Tuesday 1 July" or "Wed 2 July 10:00–12:00" |
| `Date` | string | ISO date, e.g. `2026-07-01` |
| `StartTime` | string | Optional, e.g. `10:00` |
| `EndTime` | string | Optional, e.g. `12:00` |

### Tab: `ShiftAssignments`

One row per assignment (a member assigned to a shift on a specific slot).

| Column | Type | Description |
|---|---|---|
| `AssignmentID` | string | Unique ID (timestamp + random suffix) |
| `SlotID` | string | References `ShiftConfig.SlotID` |
| `ShiftID` | string | References `ShiftDefs.ShiftID` |
| `MemberName` | string | Playa name or real name |
| `Status` | string | `requested`, `confirmed`, or `bailed` |

---

## Status Flow

```
(empty slot)
     ↓
 requested      ← member signs up for an open slot
     ↓
 confirmed      ← admin confirms the assignment
     ↓
   bailed       ← member backs out of a confirmed shift
```

- **`requested`** — member signed up, pending admin review
- **`confirmed`** — admin has confirmed the assignment
- **`bailed`** — member backed out after confirmation; slot flagged as needing coverage; row is kept (not deleted) so admins can see it
- Cancelled requests (member withdraws before confirmation) are deleted silently — no record needed

---

## API Endpoints

All endpoints are POST with JSON body, consistent with the existing API pattern.

### `api/shifts.js` — Read auth required

Fetches everything needed to render the page:
- All rows from `ShiftDefs`
- All rows from `ShiftConfig`
- All rows from `ShiftAssignments`

**Request body:** `{ password }`
**Response:** `{ shifts, slots, assignments }`

### `api/shifts-request.js` — Read auth required

Member requests, cancels, or bails on a shift slot. Read auth is sufficient — members use the same password they use for budget/demographics.

**Request body:** `{ password, action, shiftId, slotId, memberName }`

- `action: "request"` — creates a new `requested` assignment
- `action: "cancel"` — deletes a `requested` assignment (member's own only)
- `action: "bail"` — updates a `confirmed` assignment to `bailed`

### `api/shifts-update.js` — Write auth required

Admin operations: structural changes and assignment management.

**Request body:** `{ password, action, ...payload }`

Supported actions:
- `confirm-assignment` — set status to `confirmed`
- `remove-assignment` — delete any assignment row
- `upsert-shift` — create or update a `ShiftDefs` row
- `delete-shift` — remove a `ShiftDefs` row
- `upsert-slot` — create or update a `ShiftConfig` row
- `delete-slot` — remove a `ShiftConfig` row

---

## Page Structure

**Route:** `/admin/shifts`
**Files:** `admin/shifts.html`, `assets/js/admin-shifts.js`

### Auth levels

| Feature | Read auth (members) | Write auth (admins) |
|---|---|---|
| View schedule grid | yes | yes |
| View knowledge base | yes | yes |
| View summary panel | yes | yes |
| Request an open slot | yes | yes |
| Cancel own pending request | yes | yes |
| Bail on own confirmed shift | yes | yes |
| Confirm/remove any assignment | no | yes |
| Edit shift definitions | no | yes |
| Edit knowledge base | no | yes |
| Configure slots (dates/times) | no | yes |
| Edit member "other responsibilities" | no | yes |

### Layout — three panels

**1. Schedule grid (main panel)**

- Rows = shift types (from `ShiftDefs`)
- Columns = slots (from `ShiftConfig`, sorted by date + time)
- Each cell shows assigned members as name chips, colour-coded by status:
  - `confirmed` → solid chip
  - `requested` → muted/outlined chip
  - `bailed` → strikethrough chip with warning colour
- Members can click an empty cell to request that slot
- Members can click their own chip to cancel (if `requested`) or bail (if `confirmed`)
- Admins can click any chip for a context menu: confirm, remove
- Admins see an "+ Add" control in each cell

**2. Knowledge base slide-out panel**

Triggered by clicking a shift name in the grid.

- Displays: shift name, description, time expectation, KB text (rendered markdown), KB links as a clickable list
- Members: read-only
- Admins: inline editing with save button

**3. Summary panel (right sidebar)**

Matches the layout of the existing spreadsheet's right panel.

- Lists all members with: shift count (confirmed only) and "other responsibilities" field
- Members highlighted if they have 0 confirmed shifts or have a `bailed` assignment
- Members: read-only
- Admins: can edit "other responsibilities" inline

### Admin-only controls (shown only with write auth)

- **"Manage Shifts"** button → modal to add/edit/delete shift types
- **"Configure Slots"** button → modal to add/edit/delete schedule slots (date, optional start/end time, label)

---

## File Checklist

```
admin/shifts.html               # Page shell, sidebar nav, grid/panel markup
assets/js/admin-shifts.js       # Page logic: fetch, render grid, handle interactions
api/shifts.js                   # Read endpoint: fetch all shift data
api/shifts-request.js           # Read endpoint: member request/cancel/bail
api/shifts-update.js            # Write endpoint: admin management actions
```

Add URL rewrite in `vercel.json`:
```json
{ "source": "/admin/shifts", "destination": "/admin/shifts.html" }
```

Add nav item to sidebar in all existing admin pages.

---

## Error handling & edge cases

- Member tries to request a slot already taken → API returns 409, UI shows "slot already taken"
- Member bails → `bailed` row persists, slot shown as open again for reassignment
- Shift deleted while assignments exist → assignments are soft-orphaned (kept in sheet, hidden in UI since ShiftID no longer resolves); admin should manually clean up or reassign
- Slot deleted while assignments exist → same as above
- Concurrent requests for the same slot → last write wins (acceptable for this scale)
