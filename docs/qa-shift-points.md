# QA checklist — shift point system (v0.7.0)

Manual admin e2e for the point-weight fairness leaderboard. This is the one part
of the rollout that couldn't be automated (needs a logged-in admin session).

- **URL:** https://jamhouse.space/admin/shifts.html
- **Merged:** PR #10 (`bddff16`), deployed & asset-verified 2026-06-08.
- **Already green (automated):** 45/45 unit tests; module/API/markup all confirmed live on prod.

## As an admin

- [ ] **⚖ Points button** appears in the toolbar (next to Add Shift Type / Print).
- [ ] Click it → modal lists **every shift type**; unset ones flagged *(default)*; Build/Strike inputs prefilled at **10**.
- [ ] Set Cooking = **5**, a short type (e.g. Shit Ninja) = **2**, Build = **12**, Strike = **8** → **Save**. Modal closes.
- [ ] Leaderboard **re-ranks by points**: a 15-min Shit Ninja shift (2 pts) now outranks a longer but cheaper shift.
- [ ] Each leaderboard row shows **`N pts`** with hours **dimmed** as a detail.
- [ ] Reopen ⚖ Points → saved values persist (Shit Ninja no longer *(default)*).

## Build / strike with NoOrg

- [ ] Pick a member with an **early arrival** + at least one **NoOrg day** in their build window (Logistics).
- [ ] Open their **volunteer modal** → build days = **(days present − NoOrg days) × 12**; build points reflect that.
- [ ] Open-ended **strike** days after the event count × 8 (the strike value just set).

## Volunteer modal detail

- [ ] Event-shifts section shows each shift's **`N pts`** annotation next to its time/date.
- [ ] Section header shows **total pts** (with hours as a trailing detail).

## Rename / delete a type (Change Enforcement)

- [ ] **Rename** a weighted type → its weight **survives** under the new name (reopen ⚖ Points to confirm).
- [ ] **Delete** a weighted type → its weight row is **gone**; other types' weights + Build/Strike unchanged.

## Non-admin

- [ ] Log in as a non-admin (or observer) → **⚖ Points button hidden**.
- [ ] Leaderboard still renders and shows points (read-only).

## Regression (unchanged behaviour)

- [ ] Add / edit / delete shift type.
- [ ] Slot signup / remove; cap reached → **Override** (admin).
- [ ] **Print schedule (PDF)** export still works.
- [ ] Mobile view (≤480px): leaderboard + grid still render via the card/accordion path.

---
_Delete this file once the run is signed off._
