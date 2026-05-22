# Applications page redesign

**Date:** 2026-05-22
**Status:** Spec — pending implementation
**Scope:** Frontend-only. No backend or schema changes.

## Problem

The Applications page has accumulated UI debt:

- **8 stat-card pills** in the header (Pending, Review, Vibe Check, Team Discussion, On-boarding, Approved, Observer, Rejected). Visually noisy; most days the four mid-funnel pills carry small counts and clutter the scan.
- **8-option status filter dropdown** mirrors the same shape.
- **Row of ~13 column-toggle checkboxes** below the filter — overwhelming on first load, even though the actual default columns are reasonable.
- The grid is good for filter / sort / bulk work, but **bad for funnel-stage management** ("who's stuck in Vibe Check?"). Today the only way to do that is filter the grid and scan rows.

## Goals

1. **Slim the default header** — fewer stat cards, fewer filter options, no inline toggle row — while keeping all 8 sub-statuses intact for actual workflow.
2. **Make column control feel like a power-user affordance** rather than a wall of checkboxes.
3. **Add a Kanban view** as an alternative shape for the same data, optimized for pipeline-stage management.

## Non-goals

- Backend schema changes. `ALL_STATUSES` server-side stays as-is; bucket grouping is a frontend concept only.
- Touching the detail modal layout or the per-row Status dropdown.
- Mobile Kanban (deferred — Grid stays the only mobile view).
- "Stuck card" warnings based on dwell time (deferred — easy follow-up once real-world data shows whether the signal is useful).
- Persisting Kanban state to the server. All view/column/expanded-spine state is per-browser via localStorage.

## Design

### 1. Status taxonomy collapse

Introduce a frontend-only **`STATUS_BUCKETS`** constant mapping each of the 8 sub-statuses to one of 5 buckets:

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
```

**Visible bucket counts.** Stat cards become 5 cells (Pending / In Progress / Approved / Observer / Rejected). `refreshStats` aggregates sub-status counts into bucket counts. Each card keeps its existing color treatment (In Progress takes a single accent color — `#29b6f6`).

**Filter dropdown.** 5 options instead of 8. Selecting "In Progress" applies an `in`-style AG Grid filter matching any of the 4 sub-statuses. AG Grid supports this via a custom `filterValueGetter` or a `set` filter — implementation detail in the plan.

**Per-row Status dropdown stays at 8 options.** Admins still need precise control to push someone from Review → Vibe Check. The dropdown UI in `StatusCellRenderer` is unchanged. Same for the modal.

**Click-through.** Clicking a stat card sets the status filter to that bucket (current behavior, just re-pointed at buckets).

### 2. Column controls

Replace the inline checkbox row with a single **`Columns ▾`** button in the filter row. Click opens a popover (custom HTML, no library; see notes) with one checkbox per togglable column.

**Default visible columns** change from today's 6 to 4 (plus the two buttons):

```
View | Invite | Name | Playa Name | Responsible HR | Status
```

Removed from default-visible: Location, Phone.

**Default hidden** (i.e., user opts in via the popover): Location, Phone, Email, Admin, Nationality, Gender, Age, First Burn, Has Ticket, Volunteer.

**Persistence.** The set of visible columns is saved to `localStorage` under `jh.applications.columns` whenever the user toggles one. On page load, if the key exists, it overrides the column defs' `hide` flags. Mobile keeps its own minimal column override (see existing `JH.mobileColumns` path) untouched.

**Visual.** Filter row becomes: `[All Applications ▾]  [Columns ▾]  <count>`.

### 3. Kanban view

A new view on `/admin/applications`. Toggle at the top of the panel:

```
[ Grid | Kanban ]    (other filter row controls to the right)
```

Current view persists to `jh.applications.view`.

#### 3a. Column layout

Five columns in `BUCKET_ORDER`. Each rendered as a vertical lane with a header showing the bucket name + count.

**Width strategy.** Pending and In Progress default to full equal-width lanes. Approved / Observer / Rejected default to a **collapsed spine** (~80px wide, header rotated vertically, no cards visible — only the count badge). Clicking the spine expands it inline (cards become visible, lane takes equal-width space).

Expanded state per column persists to `jh.applications.kanban.expanded` (array of bucket names). Defaults to `['Pending', 'In Progress']`.

**Drop targets.** All 5 columns accept drops, including collapsed spines. Dragging a card onto a collapsed spine drops it into that bucket (without expanding the spine — the cards count just ticks up).

#### 3b. Cards

Per member, rendered as:

```
┌─────────────────────────────┐
│ Anna Kovács                 │   ← Name (700, 0.85rem)
│ Sparkle                     │   ← Playa Name (muted, 0.72rem)
│ Applied 3 days ago · Buda…  │   ← timeMeta · Location, muted
│ [First Burn] [Has Ticket]   │   ← tag pills
└─────────────────────────────┘
```

**Card fields.**
- Name (Member sheet `Name`)
- Playa Name (sheet `Playa Name`)
- "Applied X days ago" derived from `Timestamp` (today minus that date). Use existing helpers in `JH` if any; otherwise inline.
- Location — first comma-separated segment if multiple parts.
- Tag pills — *First Burn* if `First Burn` cell is truthy, *Has Ticket* if `Has Ticket` cell is truthy. Other tags deferred.

**Click → modal.** Click on a card (anywhere except the drag handle / status menu) opens the existing detail modal (`openModal(member)`). Same modal as Grid row click.

**In-card status menu.** Right-side of the card has a tiny `⋯` button — opens a small menu listing all 8 sub-statuses (same as the grid `StatusCellRenderer` select). Lets admins set a sub-status without opening the modal. Re-uses `updateStatus(data, newStatus)`.

#### 3c. Drag and drop

Native HTML5 drag-and-drop (no library). On drop:

1. Determine target bucket from the drop target's `data-bucket`.
2. If `STATUS_BUCKETS[member.Status]` already equals the target bucket → no-op.
3. Otherwise: call `updateStatus(memberRowData, <newStatus>)`.

**Picking the sub-status on drop.** Buckets with one sub-status (Pending, Approved, Observer, Rejected) are unambiguous. Drops into **In Progress** need to choose between Review / Vibe Check / Team Discussion / On-boarding.

Behavior:
- If the card's current bucket is already In Progress → the drop is a no-op (lateral). Admins use the `⋯` menu to sub-shuffle.
- If the card is dropped into In Progress from outside → land on **Review** (the first sub-status). Admins can then refine via the `⋯` menu.

The popup / silent-demotion logic from `updateStatus()` is unchanged and applies automatically:
- Drop to Approved (from any non-Approved) → existing "Send invite email?" popup.
- Drop to Observer from non-portal-access → same popup, Observer template.
- Approved → Observer drop → silent demotion.
- Drop into a non-portal-access bucket → silent status change.

#### 3d. Filtering interaction

The same status filter dropdown still applies in Kanban:
- "All Applications" → all 5 columns visible (with collapse defaults respected).
- A specific bucket → only that bucket's column is shown (others hidden, not collapsed).
- A specific sub-status (only reachable if we keep sub-status filter affordances — we don't, see "open questions") → equivalent to its bucket.

Text-based filters (e.g., quick search on name) hide non-matching cards within each column. Column counts in the header reflect post-filter counts.

When a text-filter match falls inside a column that's currently collapsed to a spine, the spine **stays collapsed** but its count updates — admin clicks the spine to see matches. Auto-expanding on match was rejected as too jumpy.

#### 3e. Permissions (Observer)

- Cards are not `draggable` for Observers.
- The `⋯` status menu is hidden for Observers.
- Click-card-to-open-modal still works (read-only modal).

#### 3f. Mobile

Kanban hidden on mobile (the toggle itself is hidden). Existing mobile grid behavior is unchanged.

### 4. Where state lives

| Key | Value | When written |
| --- | --- | --- |
| `jh.applications.view` | `"grid"` or `"kanban"` | On view-toggle click |
| `jh.applications.columns` | JSON array of visible column field names | On Columns popover checkbox change |
| `jh.applications.kanban.expanded` | JSON array of bucket names | On Kanban spine click |

All read on page load, written on user action. No migration: missing keys fall back to documented defaults.

## File map

Touched:
- `admin/applications.html` — stat-card markup (5 cells), filter row markup (replace toggle row with `Columns ▾` button + view toggle), Kanban container div, Columns popover scaffold, in-card menu template.
- `assets/js/admin-applications.js` — add `STATUS_BUCKETS`, refactor `refreshStats`, update filter handler, replace toggle wiring with popover wiring, add Kanban renderer + drag logic + view-toggle wiring + localStorage helpers.
- `assets/css/admin.css` — Kanban styles (lanes, cards, spine, drag-over state, tag pills), Columns popover styles, view-toggle pill styles.

Not touched:
- `api/members.js` and any other backend file.
- `assets/js/admin-auth.js`.
- The detail modal (HTML + open/close logic in admin-applications.js).
- `StatusCellRenderer` (the per-row Status dropdown stays at 8 options).

## Architecture notes

- **Single source of truth for buckets.** Every place that thinks about buckets (stat cards, filter, Kanban columns) reads from `STATUS_BUCKETS` and `BUCKET_ORDER`. Adding a new sub-status later is one constant change.
- **Render functions stay pure.** `getRowData()` and `getKanbanCards()` build their own view-model from `allMembers`; switching views or filtering doesn't require backend round-trips.
- **No new dependencies.** Native HTML5 drag/drop; popover is a couple of divs + an outside-click handler. AG Grid already in the bundle for the Grid view.

## Implementation chunks (for the plan)

1. **Status taxonomy.** Add `STATUS_BUCKETS` / `BUCKET_ORDER`. Update `refreshStats` to bucket counts. Update stat-card HTML to 5 cells. Update filter dropdown to 5 options. Wire bucket-aware filter to AG Grid.
2. **Column controls.** Build `Columns ▾` popover. Wire to AG Grid `setColumnsVisible`. Persist to localStorage. Update default-visible column list (remove Location, Phone from default).
3. **Kanban — scaffold.** View-toggle component. Kanban container div. Card renderer (no DnD yet). Column rendering with spine/expanded states. Click-card-to-modal. Card `⋯` menu.
4. **Kanban — drag and drop.** Add `draggable` + drag/drop event handlers. Wire to `updateStatus`. Handle the In Progress sub-status landing rule. Verify popup flows.
5. **Polish.** Mobile gate (hide toggle + force grid). Observer no-drag / no-menu. localStorage hydration on load. Manual smoke test on a deployed preview.

## Open questions

1. **Removing sub-status filter UI entirely.** The new dropdown shows only 5 bucket options. If admins ever want to filter to "just Vibe Check" today, they'd lose that affordance. Acceptable because (a) per-row dropdown still lets them set sub-status, and (b) the In Progress column in Kanban can be further filtered by clicking cards if needed. **Decision: yes, only 5 options. Re-evaluate if requested.**
2. **Drag from Pending directly to Approved.** With the new auto-invite logic this fires "Send invite email?" — same as the dropdown. Confirmed correct.
3. **Drag into collapsed spine.** Spec says spine still accepts drops; visual feedback (hover state on the spine) is a polish item, left to plan-level detail.

## Testing

No automated tests (project doctrine: prototype-grade). Manual smoke list:

- **Status buckets**: counts in stat cards add up to total approved members + applicants; filter "In Progress" shows rows in any of 4 sub-statuses.
- **Columns**: default load shows only Name / Playa / Responsible HR / Status; popover toggle on Phone makes Phone visible; refresh — Phone stays visible (localStorage); toggle off — Phone hidden.
- **Kanban → Grid → Kanban**: view switch persists across refresh.
- **Kanban DnD**: drag Pending → In Progress, card lands as Review; drag In Progress (Review) → Approved, popup fires; drag Approved → Observer, silent demotion; drag Pending → Rejected, silent.
- **Kanban spine**: Approved column starts collapsed; click expands; refresh — still expanded; click spine again — collapsed.
- **Observer login**: Observer can see Kanban, can't drag, can't open `⋯` menu, can click card to open read-only modal. Observer **can** still open the Columns popover and adjust their own visible columns — read-only on data, not on personal view prefs.
- **Mobile**: view toggle hidden; only Grid available.

## Rollout

Single PR; merge to main; Vercel auto-deploys. No feature flag — change is contained to one admin page and revertable in seconds via `git revert`.
