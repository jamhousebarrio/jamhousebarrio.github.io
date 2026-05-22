# Observer Member Status

## Problem

Some people want to follow what's happening in JamHouse without officially
joining: external collaborators, friends of the barrio, prospective members
exploring whether to commit, etc. Today the system has only two terminal
states — `Approved` (full member) or `Rejected` (no portal access). There's
no middle ground for "can see, doesn't pay, not counted".

## Goals

- A new `Observer` status that grants portal **read access only** plus
  own-profile editing.
- Observers are excluded from every "approved member" count and roster
  (headcount, fee chase, demographics, meal/drink quantities).
- Observers are not prompted to fill logistics, meals, fees, or low-income
  requests.
- Demoting a paid Approved member to Observer surfaces a refund prompt so
  fee state stays consistent with the bank.
- No new sheet schema beyond what's already there.

## Non-goals

- No public self-signup as Observer. Promotion happens via admin action,
  same as Approved.
- No separate Observer-only pages. They see the existing admin pages,
  read-only.
- No bulk import / "invite as Observer" shortcut. Existing application
  flow + status change is enough for the volumes we expect (≤ a dozen).

## Data model

No new columns or tabs. `Status` (in `Sheet1`) gains one allowed value:

- `Observer` — inserted into `ALLOWED_STATUSES` in `api/members.js`
  immediately after `Approved`:

  ```js
  ['Pending', 'Review', 'Vibe Check', 'Team Discussion',
   'On-boarding', 'Approved', 'Observer', 'Rejected']
  ```

## Auth & permission model

`api/_lib/auth.js`:

- `getMemberByEmail()` currently rejects anything that isn't `'approved'`.
  Widen the allowed set to `{'approved', 'observer'}`.
- `authenticateRequest()` returns a new boolean `observer` on the auth
  context. `observer === true` iff `member.Status.toLowerCase() === 'observer'`.
- `admin` flag is unchanged. Observers can never be admin (the `Admin`
  column is independent, but admin operations are tied to Approved members
  in practice; we won't try to support admin observers).

Three permission tiers result:

| Action class | Approved | Observer | Admin |
|---|---|---|---|
| Read any admin page / API fetch | ✅ | ✅ | ✅ |
| Edit own profile (dietary, password, name) | ✅ | ✅ | ✅ |
| Self-actions (shift signup, fee-sent, low-income, own logistics, own timeline) | ✅ | ❌ | ✅ |
| Admin-only writes (status changes, budget, inventory, etc.) | ❌ | ❌ | ✅ |

### Endpoints that gain an observer rejection

Each endpoint below already accepts non-admin authenticated requests for
the listed action. Add an `if (auth.observer) return 403 'Observer accounts are read-only'`
check at the top of these specific branches:

- `api/shifts.js`: `signup`, `unassign-self`
- `api/members.js`: `save-fee-sent`, `submit-low-income`, `withdraw-low-income`
- `api/logistics.js`: `upsert` (when the caller is editing their own row)
- `api/timeline.js`: any member-self action
- `api/meals.js`, `api/drinks.js`, `api/events.js`, `api/budget.js`,
  `api/inventory.js`, `api/roles.js` — already admin-gated, no change.

### Endpoints unchanged for observers

- `api/members.js`: `save-dietary` — own-profile, OK for observers.
- `api/auth.js`: password change — own-profile, OK for observers.
- Any `action === undefined` fetch path that returns rosters — OK, observers
  can read.

## Roster & count exclusions

Every existing `Status.toLowerCase() === 'approved'` filter stays exactly
that — observers are deliberately excluded. Audited locations:

- `api/members.js:140` — weekly fee chase
- `api/members.js:214` — fee roster
- `api/auth.js:241` — recovery flow eligibility
- `assets/js/admin-fee-paid.js` — `liApproved` and roster filter
- `assets/js/admin-demographics.js` — approved-member roster + charts
- `JH.getHeadcount()` in `assets/js/admin-auth.js` — meals/drinks/events
  use this; must NOT include observers.

**No code change is required for any of the above** — the existing
predicate already does the right thing once Observer is just another
non-Approved status.

## UI changes

### `admin/applications.html`

- Add `<option value="Observer">Observer</option>` to the status filter
  and the per-row status `<select>`, between Approved and Rejected.
- Add an `Observer` stat card next to the existing six.

### `assets/js/admin-applications.js`

- Add `'Observer'` to `ALL_STATUSES` and `STATUS_IDS` (id: `stat-observer`).
- `normalizeStatus()` — no change (passes unknown values through).
- The existing demotion confirm fires on `Approved → not-Approved`. Add a
  parallel confirm for `Observer → Pending/Rejected/Review/etc.`:
  > "Changing X from Observer to '<new>' will revoke their portal access."
- New flow: **Approved → Observer with paid fee.** When the chosen new
  status is `Observer` AND `fee_received === TRUE` OR
  `fee_total_sent > 0` (read from the row's data), show an additional
  modal *after* the standard demotion confirm:

  ```
  X has paid €Y in barrio fees.

  ( ) Refund issued — reset fee state
  ( ) Keep fee (donation / not refunded)

  [Cancel]  [Confirm]
  ```

  - "Refund issued": call new action `members.refund-and-demote` which
    zeros `fee_total_sent`, sets `fee_received='FALSE'`, clears
    `low_income_request` and `low_income_status`, then writes
    `Status='Observer'`. Sends Telegram: `💸 X refunded €Y and demoted to Observer`.
  - "Keep fee": call existing `update-status` with `status='Observer'`.
    Fee fields untouched.

- Approved → Observer with no paid fee: skip the refund modal; just
  change status with the existing flow.

### `api/members.js`

- Add action `refund-and-demote`:
  - Admin-only.
  - Payload: `{ row }`.
  - Reads current row, captures `fee_total_sent` and `Playa Name`/`Name`
    for the Telegram message.
  - Writes (single batch update): `fee_total_sent=0`,
    `fee_received='FALSE'`, `low_income_request=''`,
    `low_income_status=''`, `Status='Observer'`.
  - Sends Telegram with the refunded amount.
  - Returns `{ success: true, refunded: <amount> }`.

### Sidebar (`assets/js/admin-auth.js`)

- The sidebar's nav array is rendered with per-item `access` keys
  (`general` / `admin`). Add a third hint, or filter post-render based on
  `JH.currentUser.observer`:
  - Hide `/admin/fee-paid` for observers (they have no fee to pay).
  - Show all other links.
- Add a small visible "👀 Observer" badge near the user's name in the
  sidebar so the role is obvious. Same place the "Admin" indicator (if
  any) sits.

### `JH.checkLogisticsPrompt`

- Early-return when `JH.currentUser.observer === true`. Observers are not
  nagged to fill arrival/departure info.

### Frontend write-action UX

For approved-member-only write actions visible to observers (the shift
signup buttons most prominently), prefer **hiding** the control over
showing it and 403-ing on click. Specifically:

- `assets/js/admin-shifts.js`: hide "Sign up" buttons when
  `JH.currentUser.observer`.
- `assets/js/admin-fee-paid.js`: not reachable (sidebar link hidden), but
  if the URL is hit directly, render a read-only "Observers don't pay
  barrio fees" message instead of the input form.
- Low-income request form: same — hide for observers.
- Logistics own-row form: render as read-only for observers (the data
  isn't relevant but no harm showing the empty form disabled).

Server-side 403s remain as a defensive backstop.

## Invite & notification flow

`api/members.js` `update-status` already handles the invite-on-Approved
path implicitly (the email pipeline lives in `api/auth.js`; applications
page shows an "Invite" button on Approved rows). Behaviour we want:

- Setting Status → Observer **does** send an invite email if the member
  has no Supabase account yet. Reuse the existing Approved invite flow.
  - In `admin-applications.js:271`, the post-status-change branch that
    refreshes the row to expose the "Invite" button: extend the condition
    `newStatus === 'Approved'` to also fire for `newStatus === 'Observer'`.
- Telegram message: instead of the "🎉 Welcome to the barrio!" copy used
  for Approved, send `👀 X has joined as an Observer — they're here for
  transparency, not as a full barrio member.` Branch on the new status in
  `api/members.js:433`.
- Observer → Approved promotion later: existing status change path. No
  new email (account exists). Telegram message: standard "moved from
  Observer → Approved" line.

## Failure modes & edge cases

- **Observer hits a 403 on a write**: backstop only — controls should be
  hidden. If it happens, frontend shows a generic "Observers are
  read-only" toast.
- **Observer email lookup**: `getMemberByEmail` returning observers means
  the email pipeline (invitations, recovery) treats them as valid
  account-holders. That's intended.
- **Approved → Observer with active low-income request**: the refund
  modal clears `low_income_*` whether the request was pending or
  approved. Acceptable — observers don't need a ticket fee policy.
- **Refund modal cancelled mid-flow**: status remains Approved. No state
  changes.
- **Two admins demoting at once**: last write wins (standard Sheets
  behaviour). Refund Telegram could fire twice but that's harmless.

## What's deliberately NOT changing

- No new sheet columns (no `fee_refunded` audit column — Telegram is the
  trail).
- No new tabs.
- No changes to `apply.html`, `register.js`, or the public homepage.
- No observer-specific UI pages.
- Tier-1 doctrine bar: load-bearing. The next engineer should be able to
  re-derive Observer behaviour from this spec + `ALLOWED_STATUSES` +
  `_lib/auth.js`.

## Testing

Prototype-grade: no automated tests. Manual smoke checklist:

1. Set a Pending member → Observer in applications. Receives invite
   email. Telegram fires the 👀 message.
2. Log in as the observer. Sidebar shows everything except `/admin/fee-paid`.
   "👀 Observer" badge visible.
3. Observer hits `/admin/shifts` — sees the grid but no "Sign up" buttons.
4. Observer hits `/admin/profile` — can change dietary, password, name.
5. Observer tries `curl POST /api/shifts {action:'signup',...}` → 403.
6. Observer count is **not** in headcount (verify on meals page).
7. Demote a paid Approved member → Observer. Refund modal appears with
   correct €. Choose "Refund issued" → fee fields reset, Telegram fires.
8. Demote an Approved member with `fee_total_sent=0` → no refund modal,
   normal demotion warning only.
9. Promote Observer → Approved. Status changes, badge disappears,
   `/admin/fee-paid` reappears, sidebar full.
10. Demote Observer → Rejected. Portal access revoked (next API call
    401s; login throws "Member not found or not approved").

## Change Enforcement Rules

If you add a new admin page → add it to the sidebar with the correct
visibility (always visible to observers unless it exclusively concerns
the member's own contribution to the barrio, e.g. fees).

If you add a new endpoint that allows non-admin authenticated writes →
add an `if (auth.observer)` 403 check for that action.
