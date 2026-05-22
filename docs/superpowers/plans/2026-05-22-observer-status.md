# Observer Member Status — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-05-22-observer-status-design.md`](../specs/2026-05-22-observer-status-design.md)

**Goal:** Add a new `Observer` member Status that grants read-only portal access with own-profile editing, excluded from approved-member rosters, with a refund prompt when demoting a paid member to Observer.

**Architecture:** Single new value in `ALLOWED_STATUSES`. Auth gate widens to admit Observer; new `auth.observer` flag drives 403s on member-self write endpoints (shifts signup, fee submission, logistics upsert). Frontend hides controls observers can't use. All existing `Status === 'approved'` filters keep working unchanged. Refund flow adds one new `refund-and-demote` action that batch-resets fee state in the same write as the status change.

**Tech Stack:** Vercel serverless (Node.js, ESM), Google Sheets API, Supabase Auth (JWT verified server-side), vanilla JS + AG Grid + Flatpickr frontend, no test framework. Verification is manual via `npm run dev` + browser, with two Supabase test accounts (one admin, one promoted to Observer).

**Branch:** `feature/observer-status` (already created from `main`).

---

## File map

**Modified — backend:**
- `api/_lib/auth.js` — widen status gate, add `observer` to auth context
- `api/members.js` — add `Observer` to `ALLOWED_STATUSES`, add `refund-and-demote` action, branch Telegram copy, include `observer` flag in default-fetch response, add observer 403s to non-admin writes
- `api/shifts.js` — observer 403 inside non-admin branches of `add-assignee`/`remove-assignee`
- `api/logistics.js` — observer 403 inside non-admin branch of `upsert`

**Modified — frontend:**
- `admin/applications.html` — add Observer to filter dropdown + stat card
- `assets/js/admin-applications.js` — add Observer to status arrays, refund modal, demotion warning, invite-on-Observer
- `assets/js/admin-auth.js` — populate `JH.currentUser.observer`, hide `/admin/fee-paid` from observer sidebar, show 👀 Observer badge, skip `checkLogisticsPrompt` for observers
- `assets/js/admin-shifts.js` — hide signup/leave buttons for observers
- `assets/js/admin-fee-paid.js` — read-only message for observers
- `assets/js/admin-logistics.js` — own-form disabled for observers

**No changes:** `api/timeline.js`, `api/meals.js`, `api/drinks.js`, `api/events.js`, `api/budget.js`, `api/inventory.js`, `api/roles.js` — already admin-gated for writes. All `Status === 'approved'` filters across the codebase keep working as-is.

---

## Chunk 1: Backend — status, auth gate, 403s, refund action

### Task 1: Add Observer to `ALLOWED_STATUSES`

**Files:**
- Modify: `api/members.js:56`

- [ ] **Step 1: Edit the constant**

```js
const ALLOWED_STATUSES = ['Pending', 'Review', 'Vibe Check', 'Team Discussion', 'On-boarding', 'Approved', 'Observer', 'Rejected'];
```

(Inserts `'Observer'` between `'Approved'` and `'Rejected'`.)

- [ ] **Step 2: Verify with grep**

```bash
grep -n "ALLOWED_STATUSES" api/members.js
```

Expected: line 56 shows the new array with `'Observer'`.

---

### Task 2: Widen auth gate to admit Observer; add `observer` flag

**Files:**
- Modify: `api/_lib/auth.js` (lines 46–96)

- [ ] **Step 1: Update `getMemberByEmail` status check**

Replace the predicate on line 58:

```js
if (!anyStatus && (member.Status || '').toLowerCase() !== 'approved') return null;
```

with:

```js
if (!anyStatus) {
  const s = (member.Status || '').toLowerCase();
  if (s !== 'approved' && s !== 'observer') return null;
}
```

- [ ] **Step 2: Add `observer` flag to `authenticateRequest` return value**

In the return block at the bottom of `authenticateRequest` (around line 86), add an `observer` field:

```js
return {
  email: user.email,
  sub: user.sub,
  member: result.member,
  row: result.row,
  headers: result.headers,
  admin: isAdmin(result.member),
  observer: (result.member.Status || '').toLowerCase() === 'observer',
  sheets,
  spreadsheetId,
};
```

- [ ] **Step 3: Update the rejection error message**

The line:

```js
const err = new Error('Member not found or not approved');
```

becomes:

```js
const err = new Error('Member not found or no portal access');
```

- [ ] **Step 4: Verify**

```bash
grep -n "observer\|approved" api/_lib/auth.js
```

Expected: see the new branch in `getMemberByEmail` and `observer:` in the auth context return.

---

### Task 3: Add observer 403 to shifts non-admin branches

**Files:**
- Modify: `api/shifts.js` (lines 210–272)

- [ ] **Step 1: Block observers in `add-assignee`**

Inside the `if (action === 'add-assignee')` block, immediately after the existing `if (!clean)` check at line 214 and before the `if (!auth.admin && !isSelfName(...))` check at line 215, insert:

```js
if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
```

- [ ] **Step 2: Block observers in `remove-assignee`**

Inside the `if (action === 'remove-assignee')` block, immediately before the `if (!auth.admin && !isSelfName(...))` check at line 253, insert the same line:

```js
if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
```

- [ ] **Step 3: Verify**

```bash
grep -n "Observer accounts are read-only" api/shifts.js
```

Expected: two matches, one before each non-admin self-check.

---

### Task 4: Add observer 403 to members fee/low-income actions

**Files:**
- Modify: `api/members.js` (lines 231, 255, 270)

- [ ] **Step 1: Block observers in `save-fee-sent`**

Immediately after `if (action === 'save-fee-sent') {` on line 231, add:

```js
if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
```

- [ ] **Step 2: Block observers in `submit-low-income`**

Immediately after `if (action === 'submit-low-income') {` on line 255, add the same line.

- [ ] **Step 3: Block observers in `withdraw-low-income`**

Immediately after `if (action === 'withdraw-low-income') {` on line 270, add the same line.

- [ ] **Step 4: Verify**

```bash
grep -n "Observer accounts are read-only" api/members.js
```

Expected: three matches.

---

### Task 5: Add observer 403 to logistics upsert (non-admin branch)

**Files:**
- Modify: `api/logistics.js` (lines 22–30)

- [ ] **Step 1: Block observers from upserting their own logistics**

Inside `if (action === 'upsert')`, immediately after the `if (!memberName)` check on line 23 and before the self-vs-admin check on line 28, insert:

```js
if (auth.observer) return res.status(403).json({ error: 'Observer accounts are read-only' });
```

Note: admin-as-observer is structurally impossible (admins are always Approved in practice), and observers shouldn't have a logistics row regardless of whose name they pass.

- [ ] **Step 2: Verify**

```bash
grep -n "Observer accounts are read-only" api/logistics.js
```

Expected: one match.

---

### Task 6: Include `observer` flag in members default-fetch response

**Files:**
- Modify: `api/members.js:183`

- [ ] **Step 1: Add observer flag to the response**

The default-fetch response on line 183:

```js
return res.status(200).json({ members, admin: auth.admin });
```

becomes:

```js
return res.status(200).json({ members, admin: auth.admin, observer: auth.observer });
```

- [ ] **Step 2: Verify**

```bash
grep -n "observer: auth.observer" api/members.js
```

Expected: one match on line 183.

---

### Task 7: Branch Telegram copy for Observer status changes

**Files:**
- Modify: `api/members.js:433`

- [ ] **Step 1: Replace the two-branch text with a three-branch text**

The current line 433:

```js
text: status.toLowerCase() === 'approved'
  ? '🎉 Welcome to the barrio! ' + memberName + ' has been approved — say hi!'
  : '📋 Application update: ' + memberName + ' moved from ' + oldStatus + ' → ' + status,
```

becomes:

```js
text: (function() {
  var s = status.toLowerCase();
  if (s === 'approved') return '🎉 Welcome to the barrio! ' + memberName + ' has been approved — say hi!';
  if (s === 'observer') return '👀 ' + memberName + ' has joined as an Observer — here for transparency, not as a full barrio member.';
  return '📋 Application update: ' + memberName + ' moved from ' + oldStatus + ' → ' + status;
})(),
```

- [ ] **Step 2: Verify**

```bash
grep -n "joined as an Observer" api/members.js
```

Expected: one match.

---

### Task 8: Add `refund-and-demote` action

**Files:**
- Modify: `api/members.js` (insert just before the `update-status` action at line 397)

- [ ] **Step 1: Insert the new action handler**

Add this block above the `// ── Update status ───` comment (line ~396):

```js
// ── Refund + demote-to-Observer (single atomic admin op) ─────────────
if (action === 'refund-and-demote') {
  const { row } = payload;
  if (!row) return res.status(400).json({ error: 'Row required' });

  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
  let hdrs = (r.data.values || [[]])[0] || [];
  hdrs = await ensureFeeColumns(sheets, spreadsheetId, hdrs);

  // Capture current row for the Telegram message and the refunded amount
  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId, range: 'Sheet1!' + row + ':' + row,
  });
  const rowData = (rowRes.data.values || [[]])[0] || [];
  const sentCol = hdrs.indexOf('fee_total_sent');
  const statusCol = hdrs.indexOf('Status');
  const refundedAmount = parseFloat(rowData[sentCol]) || 0;
  const oldStatus = (statusCol !== -1 && rowData[statusCol]) || 'Unknown';
  const m = {};
  hdrs.forEach((h, j) => { m[h] = rowData[j] || ''; });
  const memberName = displayName(m);

  // Batch the five writes
  const liReqCol = hdrs.indexOf('low_income_request');
  const liStatusCol = hdrs.indexOf('low_income_status');
  const recvCol = hdrs.indexOf('fee_received');
  const data = [
    { range: 'Sheet1!' + colToLetter(sentCol) + row, values: [[0]] },
    { range: 'Sheet1!' + colToLetter(recvCol) + row, values: [['FALSE']] },
    { range: 'Sheet1!' + colToLetter(liReqCol) + row, values: [['']] },
    { range: 'Sheet1!' + colToLetter(liStatusCol) + row, values: [['']] },
    { range: 'Sheet1!' + colToLetter(statusCol) + row, values: [['Observer']] },
  ].filter(d => d.range.match(/[A-Z]+[0-9]+$/)); // drop any if column index is -1

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });

  await tgSend('💸 *' + memberName + '* refunded €' + refundedAmount + ' and demoted from ' + oldStatus + ' → Observer.');

  return res.status(200).json({ success: true, refunded: refundedAmount });
}
```

- [ ] **Step 2: Verify the handler is reachable (admin-only gate)**

`refund-and-demote` is admin-only because the admin gate on line 298 fires before any action that's not `save-dietary`/`save-fee-sent`/`submit-low-income`/`withdraw-low-income` (the only non-admin actions). Confirm the gate is still upstream:

```bash
grep -n "Write actions require admin\|action === 'refund-and-demote'" api/members.js
```

Expected: the admin gate line appears before the new action.

---

### Task 9: Commit Chunk 1

- [ ] **Step 1: Stage and commit**

```bash
git add api/_lib/auth.js api/members.js api/shifts.js api/logistics.js
git commit -m "Observer status: backend (auth gate, 403s, refund action)

- Widen auth gate to allow Status=Observer (still rejects Pending/Rejected/etc.)
- auth context gains observer:bool flag
- shifts.add-assignee / remove-assignee 403 for observers
- members.save-fee-sent / submit-low-income / withdraw-low-income 403 for observers
- logistics.upsert 403 for observers
- members default fetch returns observer flag
- members.update-status sends Observer-specific Telegram copy
- New members.refund-and-demote action: zeros fee fields + sets Status=Observer atomically"
```

---

## Chunk 2: Applications page — dropdown, stat card, refund modal

### Task 10: Add Observer to applications.html dropdown and stat card

**Files:**
- Modify: `admin/applications.html` (lines 154–162 stat cards, lines 165–174 filter)

- [ ] **Step 1: Insert Observer stat card between Approved and Rejected**

After the Approved stat card block (lines 154–157), before the Rejected block, insert:

```html
    <div class="stat-card">
      <div class="stat-label">Observer</div>
      <div class="stat-number" id="stat-observer" style="color:#9e9e9e;">-</div>
    </div>
```

- [ ] **Step 2: Insert Observer option in the status filter**

Between the Approved and Rejected `<option>`s (after line 172, before line 173), insert:

```html
        <option value="Observer">Observer</option>
```

- [ ] **Step 3: Verify**

```bash
grep -n "stat-observer\|value=\"Observer\"" admin/applications.html
```

Expected: stat card id + filter option both present.

---

### Task 11: Add Observer to JS status arrays

**Files:**
- Modify: `assets/js/admin-applications.js:8` and `:10`

- [ ] **Step 1: Add to ALL_STATUSES**

Line 8:

```js
var ALL_STATUSES = ['Pending', 'Review', 'Vibe Check', 'Team Discussion', 'On-boarding', 'Approved', 'Observer', 'Rejected'];
```

- [ ] **Step 2: Add to STATUS_IDS**

Line 10:

```js
var STATUS_IDS = { 'Pending': 'stat-pending', 'Review': 'stat-review', 'Vibe Check': 'stat-vibe-check', 'Team Discussion': 'stat-team-discussion', 'On-boarding': 'stat-on-boarding', 'Approved': 'stat-approved', 'Observer': 'stat-observer', 'Rejected': 'stat-rejected' };
```

---

### Task 12: Include fee fields in grid row data

**Files:**
- Modify: `assets/js/admin-applications.js:29-50` (`getRowData`)

- [ ] **Step 1: Add `fee_total_sent` and `fee_received` to the row object**

Inside `getRowData()`, append two more fields to the object returned per member:

```js
fee_total_sent: parseFloat(val(m, 'fee_total_sent')) || 0,
fee_received: ((val(m, 'fee_received') || '').toString().toUpperCase() === 'TRUE'),
```

These don't need to be visible columns — they're consumed by `updateStatus` for the refund-modal trigger.

- [ ] **Step 2: Verify**

```bash
grep -n "fee_total_sent\|fee_received" assets/js/admin-applications.js
```

Expected: at least two matches inside `getRowData`.

---

### Task 13: Refund modal + Observer-aware status change

**Files:**
- Modify: `assets/js/admin-applications.js:243-279` (`updateStatus` function)

- [ ] **Step 1: Replace `updateStatus` with the Observer-aware version**

Replace the entire `async function updateStatus(data, newStatus) { ... }` block with:

```js
async function updateStatus(data, newStatus) {
  var member = allMembers.find(function(m) { return m._row === data._row; });
  if (!member) return;
  var oldStatus = val(member, 'Status') || '';
  var memberName = val(member, 'Name') || 'this member';
  var oldNorm = normalizeStatus(oldStatus);
  var newNorm = normalizeStatus(newStatus);

  // Statuses that grant portal access (auth gate accepts these).
  function hasPortalAccess(s) { return s === 'Approved' || s === 'Observer'; }

  // Confirm any transition that revokes portal access.
  if (hasPortalAccess(oldNorm) && !hasPortalAccess(newNorm)) {
    var ok = confirm(
      'Changing ' + memberName + ' from ' + oldNorm + ' to "' + newStatus + '" will revoke their access to the portal.\n\n' +
      'Their Supabase account will remain (so re-promoting later restores access without a new invite), but they will be locked out until then.\n\n' +
      'Continue?'
    );
    if (!ok) {
      gridApi.setGridOption('rowData', getRowData());
      return;
    }
  }

  // Approved → Observer with money on the line: ask about refund.
  if (oldNorm === 'Approved' && newNorm === 'Observer' && (data.fee_received || data.fee_total_sent > 0)) {
    var amount = data.fee_total_sent || 0;
    var choice = window.prompt(
      memberName + ' has paid €' + amount + ' in barrio fees.\n\n' +
      'Type one of:\n' +
      '  refund   — refund issued, reset fee state\n' +
      '  keep     — keep the fee (donation / not refunded)\n' +
      '  cancel   — cancel the demotion\n',
      'refund'
    );
    if (!choice) { gridApi.setGridOption('rowData', getRowData()); return; }
    choice = choice.trim().toLowerCase();
    if (choice === 'cancel') { gridApi.setGridOption('rowData', getRowData()); return; }
    if (choice !== 'refund' && choice !== 'keep') {
      alert('Unrecognised choice — cancelled.');
      gridApi.setGridOption('rowData', getRowData());
      return;
    }
    if (choice === 'refund') {
      try {
        var refRes = await JH.apiFetch('/api/members', { action: 'refund-and-demote', row: data._row });
        if (!refRes.ok) {
          var refErr = await refRes.json().catch(function() { return {}; });
          throw new Error(refErr.error || 'Refund failed');
        }
        // Update local model and refresh
        member['Status'] = 'Observer';
        member['fee_total_sent'] = '0';
        member['fee_received'] = 'FALSE';
        member['low_income_request'] = '';
        member['low_income_status'] = '';
        refreshStats();
        gridApi.setGridOption('rowData', getRowData());
        return;
      } catch (err) {
        alert('Refund failed: ' + err.message);
        gridApi.setGridOption('rowData', getRowData());
        return;
      }
    }
    // choice === 'keep' falls through to normal update-status below
  }

  try {
    var res = await JH.apiFetch('/api/members', { action: 'update-status', row: data._row, status: newStatus });
    if (!res.ok) throw new Error('Failed');
    member['Status'] = newStatus;
    refreshStats();
    gridApi.setGridOption('rowData', getRowData());

    if (newNorm === 'Approved' || newNorm === 'Observer') {
      await sendInvite(member);
    }
  } catch (err) {
    gridApi.setGridOption('rowData', getRowData());
  }
}
```

Key behaviours encoded:
- Both Approved→X and Observer→X demotions get the portal-access warning when X loses access.
- The refund modal only triggers on `Approved → Observer` with non-zero/received fee.
- "keep" falls through to the normal `update-status` flow (status changes, fees untouched).
- "refund" calls the new `refund-and-demote` endpoint and skips `update-status`.
- The post-status invite flow also fires for new Observers (they need a portal account too).

- [ ] **Step 2: Verify**

```bash
grep -n "refund-and-demote\|hasPortalAccess" assets/js/admin-applications.js
```

Expected: at least one match for each.

---

### Task 14: Show the Invite button for Observer rows too

**Files:**
- Modify: `assets/js/admin-applications.js:92`

- [ ] **Step 1: Allow Invite button on Observer rows**

Line 92:

```js
if (normalizeStatus(params.data.Status) !== 'Approved') return;
```

becomes:

```js
var s = normalizeStatus(params.data.Status);
if (s !== 'Approved' && s !== 'Observer') return;
```

- [ ] **Step 2: Verify**

```bash
grep -n "s !== 'Approved' && s !== 'Observer'" assets/js/admin-applications.js
```

Expected: one match in InviteBtnRenderer.

---

### Task 15: Commit Chunk 2

- [ ] **Step 1: Stage and commit**

```bash
git add admin/applications.html assets/js/admin-applications.js
git commit -m "Observer status: applications page (dropdown, stat card, refund modal)

- ALL_STATUSES / STATUS_IDS / dropdown / stat card all include Observer
- Status change to Observer triggers invite email like Approved does
- Demotion warning fires for Approved→non-portal and Observer→non-portal
- Approved→Observer with a paid fee prompts: refund / keep / cancel
- 'refund' calls members.refund-and-demote (atomic fee-reset + status change)
- 'keep' falls through to normal update-status, fees untouched
- Invite button shows on Observer rows too"
```

---

## Chunk 3: Sidebar, badge, logistics-prompt skip

### Task 16: Populate `JH.currentUser.observer`

**Files:**
- Modify: `assets/js/admin-auth.js` (the `JH.authenticate` function, lines ~120–148)

- [ ] **Step 1: Inspect existing authenticate to find where currentUser is set**

```bash
grep -n "JH.currentUser\|JH.authenticate" assets/js/admin-auth.js
```

- [ ] **Step 2: Populate `observer` on `JH.currentUser`**

Find the block where `JH.currentUser` is built from the `/api/members` response. Add `observer: !!data.observer` to that object, e.g.:

```js
JH.currentUser = {
  email: <existing>,
  admin: !!data.admin,
  observer: !!data.observer,
  member: <existing self-row lookup>,
  row: <existing>,
};
```

If `JH.currentUser` isn't currently being built explicitly, add it after the existing `JH.filterNav(data.admin)` call:

```js
JH.currentUser = JH.currentUser || {};
JH.currentUser.admin = !!data.admin;
JH.currentUser.observer = !!data.observer;
```

- [ ] **Step 3: Verify**

```bash
grep -n "JH.currentUser.observer" assets/js/admin-auth.js
```

Expected: one match.

---

### Task 17: Filter sidebar — hide `/admin/fee-paid` for observers

**Files:**
- Modify: `assets/js/admin-auth.js:188-195` (`JH.filterNav`)

- [ ] **Step 1: Change filterNav to accept the observer flag**

Replace `JH.filterNav` with a version that also hides observer-blocked items:

```js
JH.filterNav = function(isAdmin, isObserver) {
  document.querySelectorAll('.sidebar .nav-item').forEach(function(item) {
    var access = item.getAttribute('data-access');
    if (access === 'admin' && !isAdmin) item.style.display = 'none';
    if (isObserver && item.getAttribute('data-observer-hide') === '1') item.style.display = 'none';
  });
};
```

- [ ] **Step 2: Mark `/admin/fee-paid` as observer-hidden in the sidebarNav array**

Find the `/admin/fee-paid` entry in `JH.sidebarNav` (line 154) and add the new flag:

```js
{ href: '/admin/fee-paid', icon: '&#128176;', text: 'Fee Paid', access: 'general', observerHide: true },
```

Then in `JH.renderSidebar` (around line 178), add the data attribute when rendering each nav item:

```js
var observerAttr = item.observerHide ? ' data-observer-hide="1"' : '';
html += '<a class="nav-item' + active + '" href="' + item.href + '" data-access="' + item.access + '"' + observerAttr + '>' +
  '<span class="icon">' + item.icon + '</span><span class="nav-item-text">' + item.text + '</span></a>';
```

- [ ] **Step 3: Update the `filterNav` call site to pass observer**

In `JH.authenticate`, the existing call `JH.filterNav(data.admin)` becomes:

```js
JH.filterNav(data.admin, !!data.observer);
```

- [ ] **Step 4: Verify**

```bash
grep -n "observerHide\|data-observer-hide\|filterNav" assets/js/admin-auth.js
```

Expected: the new flag, attribute, and call signature are all consistent.

---

### Task 18: Render 👀 Observer badge in sidebar

**Files:**
- Modify: `assets/js/admin-auth.js:170-183` (`JH.renderSidebar`) and the post-auth block

- [ ] **Step 1: Add a hook in the rendered sidebar HTML**

In `JH.renderSidebar`, append a badge slot inside the sidebar-footer:

```js
html += '</div><div class="sidebar-footer"><div id="sidebar-role-badge"></div><a href="/">&#8592; Back to Site</a></div>';
```

- [ ] **Step 2: Populate the badge when observer**

After the `JH.filterNav(data.admin, !!data.observer)` call in `JH.authenticate`, add:

```js
if (data.observer) {
  var badge = document.getElementById('sidebar-role-badge');
  if (badge) {
    badge.innerHTML = '<div style="display:inline-block;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">👀 Observer</div>';
  }
}
```

- [ ] **Step 3: Verify**

```bash
grep -n "sidebar-role-badge\|👀 Observer" assets/js/admin-auth.js
```

Expected: two matches (the slot, the population).

---

### Task 19: Skip `checkLogisticsPrompt` for observers

**Files:**
- Modify: `assets/js/admin-auth.js` (`JH.checkLogisticsPrompt`)

- [ ] **Step 1: Find the function**

```bash
grep -n "checkLogisticsPrompt" assets/js/admin-auth.js
```

- [ ] **Step 2: Early-return for observers at the top of the function**

Add at the top of the `JH.checkLogisticsPrompt = function(...) {` body:

```js
if (JH.currentUser && JH.currentUser.observer) return;
```

- [ ] **Step 3: Verify**

```bash
grep -n "checkLogisticsPrompt\|currentUser.observer" assets/js/admin-auth.js
```

Expected: the early-return appears at the top of the function body.

---

### Task 20: Commit Chunk 3

- [ ] **Step 1: Stage and commit**

```bash
git add assets/js/admin-auth.js
git commit -m "Observer status: sidebar, badge, logistics-prompt skip

- JH.currentUser.observer populated from /api/members fetch
- Sidebar hides /admin/fee-paid for observers via observerHide flag
- 👀 Observer badge rendered in sidebar footer
- JH.checkLogisticsPrompt early-returns for observers"
```

---

## Chunk 4: Per-page UI — hide unusable controls

### Task 21: Hide shift signup buttons for observers

**Files:**
- Modify: `assets/js/admin-shifts.js`

- [ ] **Step 1: Locate signup button render**

```bash
grep -n "add-assignee\|remove-assignee\|signup\|Sign up" assets/js/admin-shifts.js
```

- [ ] **Step 2: Wrap the rendering of signup/leave buttons with an observer check**

For each location where a signup or leave button is appended to the DOM, wrap with:

```js
if (!(JH.currentUser && JH.currentUser.observer)) {
  // existing button-append code here
}
```

The observer can still see the shift grid (read), just not click sign-up/leave (write).

- [ ] **Step 3: Verify**

```bash
grep -n "currentUser.observer" assets/js/admin-shifts.js
```

Expected: at least one match wrapping the signup/leave button render.

---

### Task 22: Read-only message for observers on fee-paid

**Files:**
- Modify: `assets/js/admin-fee-paid.js`

- [ ] **Step 1: Early-return for observers**

Near the top of the IIFE in `admin-fee-paid.js`, right after `JH.authenticate()` returns, add:

```js
if (JH.currentUser && JH.currentUser.observer) {
  var container = document.querySelector('.main') || document.body;
  var notice = document.createElement('div');
  notice.style.cssText = 'margin:24px;padding:20px;border:1px solid var(--border);border-radius:8px;color:var(--text-muted);';
  notice.textContent = 'Observers don\'t pay barrio fees. This page is hidden from your sidebar by default — you reached it via a direct link.';
  container.innerHTML = '';
  container.appendChild(notice);
  return;
}
```

- [ ] **Step 2: Verify**

```bash
grep -n "currentUser.observer\|Observers don't pay" assets/js/admin-fee-paid.js
```

Expected: the early-return is in place.

---

### Task 23: Read-only own-form for observers on logistics

**Files:**
- Modify: `assets/js/admin-logistics.js`

- [ ] **Step 1: Find the own-form submit handler**

```bash
grep -n "upsert\|My Info\|memberName" assets/js/admin-logistics.js | head
```

- [ ] **Step 2: Disable the own-form for observers (scoped to `#logistics-form`)**

The own-form is rendered into `#my-info-content` as a `<form id="logistics-form">` (admin-logistics.js:129). The form is re-rendered every time the user picks their name, so the disable must be applied **after** each render, not just once at page load. The cleanest hook is inside the function that renders `my-info-content` (around line 109+). Find that function (it builds the HTML and assigns to `wrap.innerHTML`) and add at its end, after innerHTML is set:

```js
if (JH.currentUser && JH.currentUser.observer) {
  var form = document.getElementById('logistics-form');
  if (form) {
    form.querySelectorAll('input, select, textarea, button').forEach(function(el) {
      el.disabled = true;
    });
    var notice = document.createElement('div');
    notice.style.cssText = 'margin-top:10px;padding:10px 14px;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);font-size:0.85rem;';
    notice.textContent = '👀 You\'re an Observer — logistics is read-only for you.';
    form.parentNode.insertBefore(notice, form);
  }
}
```

Note: scoped to `#logistics-form` so the filter/search inputs in the all-members table are unaffected. The observer can still see everyone else's logistics.

- [ ] **Step 3: Verify**

```bash
grep -n "currentUser.observer" assets/js/admin-logistics.js
```

Expected: the disabling block is in place.

---

### Task 24: Commit Chunk 4

- [ ] **Step 1: Stage and commit**

```bash
git add assets/js/admin-shifts.js assets/js/admin-fee-paid.js assets/js/admin-logistics.js
git commit -m "Observer status: per-page read-only UI

- admin-shifts: hide sign-up/leave buttons for observers (grid still visible)
- admin-fee-paid: replace page with 'Observers don't pay' notice (sidebar already hides this link)
- admin-logistics: disable own-form inputs/buttons, show observer notice"
```

---

## Chunk 5: Manual smoke test

### Task 25: Set up two test accounts

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000`, both `.env` and `.env.supabase` load without errors.

- [ ] **Step 2: Identify or create two test accounts in the Members sheet**

Pick (or add) two rows:
- **Account A** — admin (Admin column = `yes`, Status = `Approved`).
- **Account B** — currently `Pending` or `Approved` member, will be promoted to Observer.

- [ ] **Step 3: Log into the dashboard as Account A**

Navigate to `http://localhost:3000/admin`, log in.

---

### Task 26: Smoke test — promotion to Observer

- [ ] **Step 1: From Applications page, change Account B's status to Observer**

Expected:
- Account B's status row updates without error.
- Stat card "Observer: 1" reflects the new count.
- Telegram (if configured) receives `👀 X has joined as an Observer …`.
- An invite email goes to Account B (or "already has an account" if they did).

- [ ] **Step 2: Log out, log in as Account B**

Expected: login succeeds (auth gate accepts Observer).

- [ ] **Step 3: Inspect Account B's sidebar**

Expected:
- All links visible EXCEPT `/admin/applications` (admin-only) and `/admin/fee-paid` (observer-hidden).
- "👀 Observer" badge visible in sidebar footer.

---

### Task 27: Smoke test — read-only enforcement

- [ ] **Step 1: As Account B, visit `/admin/shifts`**

Expected: shift grid renders. Sign-up / leave buttons are absent.

- [ ] **Step 2: As Account B, visit `/admin/logistics`**

Expected: existing logistics table renders. Own-form inputs are disabled. "Observer — logistics is read-only" notice shown.

- [ ] **Step 3: As Account B, visit `/admin/fee-paid` directly**

Expected: replaced with "Observers don't pay barrio fees" notice.

- [ ] **Step 4: As Account B, visit `/admin/profile`**

Expected: page works. Dietary form can be saved successfully. (Personal-info form will 401 — same behaviour as a non-admin Approved member, per spec.)

- [ ] **Step 5: As Account B, try a write via curl**

```bash
TOKEN=<copy-from-browser-devtools>
curl -s -X POST http://localhost:3000/api/shifts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"add-assignee","shiftId":"some-shift","memberName":"Account B"}'
```

Expected: HTTP 403 with `{"error":"Observer accounts are read-only"}`.

---

### Task 28: Smoke test — exclusion from approved counts

- [ ] **Step 1: As Account A, visit `/admin/demographics`**

Expected: Account B does NOT appear in the approved-member roster.

- [ ] **Step 2: As Account A, visit `/admin/meals`**

Expected: headcount on each day reflects approved-with-logistics members; Account B not included.

- [ ] **Step 3: Trigger the weekly fee chase manually**

```bash
curl -s "http://localhost:3000/api/members?cron=chase" -H "Authorization: Bearer $CRON_SECRET"
```

Expected: response `{"outstanding": <n>}` where `<n>` does NOT include Account B.

---

### Task 29: Smoke test — refund flow

- [ ] **Step 1: Reset Account B to `Approved` with a paid fee**

In the sheet directly, set Account B's `Status=Approved`, `fee_total_sent=280`, `fee_received=TRUE`.

- [ ] **Step 2: Reload Applications as Account A, change Account B's status to Observer**

Expected:
- Portal-access warning fires first ("Approved → Observer will revoke access" — actually wait, Observer KEEPS access; the warning logic only fires on `hasPortalAccess(old) && !hasPortalAccess(new)` — so this should NOT fire).
- Refund modal fires immediately: "X has paid €280. Type one of: refund / keep / cancel".

- [ ] **Step 3: Type `refund` and confirm**

Expected:
- Sheet shows Account B with `Status=Observer`, `fee_total_sent=0`, `fee_received=FALSE`, low_income fields empty.
- Telegram receives `💸 X refunded €280 and demoted from Approved → Observer`.
- Applications grid refreshes with Account B as Observer.

- [ ] **Step 4: Repeat the test with `keep`**

Reset Account B to Approved with paid fee. Demote to Observer, choose `keep`. Expected: status changes, fee fields untouched.

- [ ] **Step 5: Repeat the test with `cancel`**

Reset Account B to Approved with paid fee. Demote to Observer, choose `cancel`. Expected: status reverts in UI, no API call fired, sheet unchanged.

---

### Task 30: Smoke test — promotion back to Approved

- [ ] **Step 1: As Account A, change Account B's status from Observer to Approved**

Expected:
- No additional modals.
- Telegram: standard "moved from Observer → Approved" line (the welcome message only fires for Approved when previous wasn't Approved — actually it fires on any → Approved; that's fine).
- Account B reloads → sidebar shows fee-paid again, Observer badge gone.

---

### Task 31: Smoke test — Observer → Pending revokes access

- [ ] **Step 1: As Account A, change a different Observer's status to Pending**

Expected:
- Portal-access warning fires (Observer → Pending loses access).
- After confirm, next API call from that user returns 401/403.

---

### Task 32: Final commit + push

- [ ] **Step 1: Verify clean working tree**

```bash
git status
```

Expected: clean.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/observer-status
```

**Note:** Push requires explicit confirmation per the user's standing instructions. Do not push without asking first.

---

## Notes for the implementing engineer

- **Test framework:** none. Verification is entirely manual through the dev server. Don't try to add a test framework as part of this work — that's a separate decision (CLAUDE.md prototype-grade doctrine).
- **Telegram:** if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` aren't set locally, `tgSend` is a no-op. That's expected for local dev; production deployment will have them set.
- **Sheet schema:** no new columns. The refund is an irreversible state change in `fee_total_sent` / `fee_received` / `low_income_*`. If you're worried about losing the prior values during smoke testing, snapshot the sheet first.
- **Existing demotion warning logic:** the spec was careful that the warning fires on **portal-access loss**, not specifically "Approved → other". The new logic uses `hasPortalAccess()` so it correctly catches both Approved→{Pending, Rejected, …} AND Observer→{Pending, Rejected, …}, and correctly does NOT warn on Approved↔Observer transitions (both keep access).
- **If `JH.currentUser` isn't already populated before sidebar render:** the badge population in Task 18 runs after `JH.authenticate`. That's fine because `renderSidebar` runs at module load but `filterNav` and the badge population both run post-auth. The slot exists before the user data does, then gets filled in.
- **If you find a Status filter the spec missed:** add it to the spec's "Audited locations" list as part of the same PR — the next engineer needs that list to be complete.
