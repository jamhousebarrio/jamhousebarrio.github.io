# NoOrg Duty Tracking Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let members mark full-day NoOrg festival duty in logistics; block those days on the setup timeline; let admins edit anyone's logistics row.

**Architecture:** Extend the existing `MemberLogistics` sheet tab with a new `NoOrgDates` column (comma-separated YYYY-MM-DD). Add a multi-date Flatpickr field to the logistics form, a pencil-icon admin-edit mode that reuses the same form with `state.editingMember`, and a "NoOrg" cell style on the timeline driven by a logistics fetch.

**Tech Stack:** Jekyll static site, vanilla JS, Flatpickr, Google Sheets via Vercel serverless (Node). Existing file split: `api/logistics.js`, `admin/logistics.html`, `assets/js/admin-logistics.js`, `assets/js/admin-timeline.js`.

**Spec:** `docs/superpowers/specs/2026-04-21-noorg-duty-tracking-design.md`

**Verification approach:** This project has no automated test framework. Each task ends with a manual browser verification step against `http://localhost:3000` using the dev server (`npm run dev`). Data writes hit the real Google Sheet — use your own row for testing and clean up after.

---

## File Structure

### Modified

- `api/logistics.js` — add `NoOrgDates` column to `allHeaders` / `fieldMap`; accept `noOrgDates` in body; reject non-admin writes to other members' rows
- `assets/js/admin-logistics.js` — new NoOrg field in form, new table column, admin pencil-edit mode, `state.editingMember`
- `admin/logistics.html` — small CSS additions (pencil icon, "editing other" banner styling)
- `assets/js/admin-timeline.js` — fetch logistics, build NoOrg map, render cells with `.noorg` class
- `admin/timeline.html` — new `.task-cell.noorg` CSS rule and a short legend

### Not touched

- `api/_lib/auth.js` (already exposes `auth.admin` and `auth.member`)
- Any other page

---

## Chunk 1: API + basic NoOrg field on member's own form

### Task 1: Extend the logistics API for `NoOrgDates` + admin check

**Files:**
- Modify: `api/logistics.js`

- [ ] **Step 1.1: Add `NoOrgDates` to headers and field map, accept `noOrgDates` in body**

In `api/logistics.js`, change the destructure on line 9 to also pull `noOrgDates`:

```js
const { action, memberName, arrivalDate, arrivalTime, transport, needsPickup, departureDate, campingType, tentSize, notes, noOrgDates } = req.body || {};
```

Update `allHeaders` (line 25) to include `NoOrgDates` at the end:

```js
const allHeaders = ['MemberName', 'ArrivalDate', 'ArrivalTime', 'Transport', 'NeedsPickup', 'DepartureDate', 'CampingType', 'TentSize', 'Notes', 'NoOrgDates'];
```

Add to `fieldMap`:

```js
NoOrgDates: noOrgDates || '',
```

- [ ] **Step 1.2: Reject non-admin writes to other members' rows**

Immediately after the `if (!memberName) return res.status(400)…` check (line 22), add:

```js
const myName = (auth.member && (auth.member.Name || '')).trim();
if (memberName.trim() !== myName && !auth.admin) {
  return res.status(403).json({ error: 'Only admins can edit other members' });
}
```

Note: we compare against `auth.member.Name` (Real Name), matching how `state.myName` is already derived client-side (`JH.currentUser.name` = `Name` column). Do NOT invent Playa Name fallback — existing code keys logistics rows on Real Name.

- [ ] **Step 1.3: Restart dev server + manually verify via an upsert call**

```bash
# from repo root, if not running:
npm run dev &
# or if already running: kill and restart so env is fresh
```

In browser DevTools console on `/admin/logistics`:

```js
await (await JH.apiFetch('/api/logistics', {
  action: 'upsert',
  memberName: JH.currentUser.name,
  arrivalDate: '', arrivalTime: '', transport: '', needsPickup: '',
  departureDate: '', campingType: '', tentSize: '', notes: '',
  noOrgDates: '2026-07-05,2026-07-08'
})).json()
// Expected: { ok: true }
```

Then fetch and confirm:

```js
(await (await JH.apiFetch('/api/logistics', {})).json()).logistics
  .find(r => r.MemberName === JH.currentUser.name)
// Expected: object with NoOrgDates: "2026-07-05,2026-07-08"
```

Also try as a non-admin (if possible) writing to someone else's memberName — expected 403.

- [ ] **Step 1.4: Commit**

```bash
git add api/logistics.js
git commit -m "Logistics API: accept NoOrgDates + admin check for editing others"
```

---

### Task 2: Add NoOrg duty multi-date field to the member's own form

**Files:**
- Modify: `assets/js/admin-logistics.js`

- [ ] **Step 2.1: Add the NoOrg date field markup inside `renderMyInfo` HTML**

In `renderMyInfo` (around line 120, right before the Notes textarea), insert:

```js
html += '<div class="form-row"><label>NoOrg duty days</label>';
html += '<input type="text" id="f-noorg" placeholder="Pick one or more days" value="' + JH.esc(row['NoOrgDates'] || '') + '">';
html += '<div class="form-hint">Days you\'re on festival crew \u2014 barrio setup tasks won\'t be assigned to you on these days.</div></div>';
```

- [ ] **Step 2.2: Initialise Flatpickr in multi-date mode on that input**

Just after the existing `JH.initTime(document.getElementById('f-arrival-time'));` call (~line 133), add:

```js
var noorgEl = document.getElementById('f-noorg');
if (noorgEl) {
  JH.initDate(noorgEl, { mode: 'multiple', conjunction: ',' });
}
```

`JH.initDate` already uses `dateFormat: 'Y-m-d'` and `altFormat: 'd/m/Y'`, so the hidden stored value will be comma-separated `YYYY-MM-DD` (sheet-friendly) and the visible field will show `dd/mm/yyyy, dd/mm/yyyy, …`.

- [ ] **Step 2.3: Send `noOrgDates` in the upsert payload**

In the form submit handler (`document.getElementById('logistics-form').addEventListener('submit', …)`, ~line 154), add `noOrgDates` to the body:

```js
noOrgDates: document.getElementById('f-noorg') ? document.getElementById('f-noorg').value : '',
```

(Place it next to the other fields — order in JSON body doesn't matter.)

- [ ] **Step 2.4: Manual verification**

1. Reload `/admin/logistics`, click into the NoOrg field, pick 2 non-adjacent dates (e.g. July 5 and July 8). Confirm field displays `05/07/2026, 08/07/2026`.
2. Click Save. See "Saved!" appear.
3. Hard-reload the page. Confirm the two dates are still shown in the field.
4. In console: `(await (await JH.apiFetch('/api/logistics', {})).json()).logistics.find(r => r.MemberName === JH.currentUser.name).NoOrgDates` → `"2026-07-05,2026-07-08"`.

- [ ] **Step 2.5: Commit**

```bash
git add assets/js/admin-logistics.js
git commit -m "Logistics form: add NoOrg duty days multi-date picker"
```

---

## Chunk 2: NoOrg column in the All Members table + admin pencil edit

### Task 3: Show NoOrg day count in the All Members table

**Files:**
- Modify: `assets/js/admin-logistics.js`

- [ ] **Step 3.1: Add the `NoOrg` header between `Size` and `Notes`**

In `renderAllMembers` (~line 222), change the header row:

```js
html += '<th>Name</th><th>Arrives</th><th>Time</th><th>Transport</th><th>Pickup</th><th>Departs</th><th>Camping</th><th>Size</th><th>NoOrg</th><th>Notes</th>';
```

- [ ] **Step 3.2: Render the NoOrg cell per row**

Where the existing cells are emitted (~line 241, right after `TentSize` td, before `Notes` td), add:

```js
var noorgList = (row['NoOrgDates'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
if (noorgList.length) {
  var tip = noorgList.map(function (d) { return JH.formatDate(d); }).join(', ');
  html += '<td title="' + JH.esc(tip) + '">' + noorgList.length + ' day' + (noorgList.length === 1 ? '' : 's') + '</td>';
} else {
  html += '<td><span class="not-filled">\u2014</span></td>';
}
```

- [ ] **Step 3.3: Update the empty-row colspan**

The else-branch of the `if (row)` check (~line 244) currently says `colspan="8"`. Change to `9`:

```js
html += '<td colspan="9"><span class="not-filled">Not filled in yet</span></td>';
```

- [ ] **Step 3.4: Manual verification**

Reload `/admin/logistics`. In the All Members table:
- Your row should show "2 days" in the new NoOrg column (if you saved two dates in Task 2).
- Hovering the cell should tooltip with the formatted dates.
- Rows with no logistics row at all should still show the "Not filled in yet" full-width message.

- [ ] **Step 3.5: Commit**

```bash
git add assets/js/admin-logistics.js
git commit -m "Logistics table: add NoOrg day count column"
```

---

### Task 4: Admin pencil to edit another member's logistics row

**Files:**
- Modify: `assets/js/admin-logistics.js`
- Modify: `admin/logistics.html` (CSS)

- [ ] **Step 4.1: Add minimal CSS for the pencil button and "editing other" banner**

In `admin/logistics.html` inside the `<style>` block (append at the end, before `</style>`):

```css
.edit-pencil { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.95rem; padding: 0 6px; opacity: 0.5; }
.edit-pencil:hover { color: var(--accent); opacity: 1; }
.editing-banner { background: rgba(232,168,76,0.1); border: 1px solid var(--accent); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center; }
.editing-banner a { color: var(--accent); cursor: pointer; }
```

- [ ] **Step 4.2: Add `state.editingMember` and a helper to resolve the "active" name**

Near the top of `admin-logistics.js` (right after `var state = { logistics: [], myName: null };`), extend:

```js
state.editingMember = null; // Real Name of member being edited by admin, or null
```

Then add a helper just below the state declaration:

```js
function activeName() { return state.editingMember || state.myName; }
```

- [ ] **Step 4.3: Make the form read and write `activeName()`**

Replace every use of `state.myName` **inside `renderMyInfo`** and inside the form submit handler's `memberName:` field with `activeName()`.

Specific places to change in `admin-logistics.js`:
- `renderMyInfo` guard at ~line 79: `if (!state.myName)` → `if (!activeName())`
- `renderMyInfo` row lookup at ~line 84: `state.logistics.find(… r['MemberName'] === state.myName)` → `… === activeName()`
- Hello-banner name at ~line 90: `JH.esc(state.myName)` → `JH.esc(activeName())`
- Submit body at ~line 162: `memberName: state.myName,` → `memberName: activeName(),`

Do NOT change `state.myName` uses inside `renderAllMembers` (the "you" highlight still means the logged-in user) or inside `renderNameDisplay` (that's the header of your own name).

- [ ] **Step 4.4: Render the "editing other" banner inside the panel when editing**

At the top of `renderMyInfo`, just after `if (!activeName()) { … return; }`, add:

```js
var editingHtml = '';
if (state.editingMember) {
  editingHtml = '<div class="editing-banner"><span>Editing <strong>' + JH.esc(state.editingMember) + '</strong></span><a id="back-to-me">\u2190 Back to my info</a></div>';
}
```

Then prepend `editingHtml` to the `html` string built in that function (i.e. `var html = editingHtml;` replacing the initial `var html = '';`).

After `wrap.innerHTML = html;` (~line 128), wire the link:

```js
var backLink = document.getElementById('back-to-me');
if (backLink) {
  backLink.addEventListener('click', function (e) {
    e.preventDefault();
    state.editingMember = null;
    renderMyInfo();
  });
}
```

- [ ] **Step 4.5: Render the pencil icon per row for admins**

Change the Name `<td>` in `renderAllMembers` (~line 233) from:

```js
html += '<td><strong>' + JH.esc(name) + (isMe ? ' <span …>(you)</span>' : '') + '</strong></td>';
```

to:

```js
var editBtn = '';
if (JH.isAdmin()) {
  editBtn = '<button class="edit-pencil" data-realname="' + JH.esc(m['Name'] || '') + '" title="Edit logistics">\u270e</button>';
}
html += '<td>' + editBtn + '<strong>' + JH.esc(name) + (isMe ? ' <span style="color:var(--accent);font-size:0.75rem">(you)</span>' : '') + '</strong></td>';
```

Note: the pencil's `data-realname` uses `m['Name']` (Real Name), matching how logistics rows are keyed.

- [ ] **Step 4.6: Wire clicks on the pencils**

After `wrap.innerHTML = html;` at the end of `renderAllMembers` (~line 251), add:

```js
if (JH.isAdmin()) {
  wrap.querySelectorAll('.edit-pencil').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var real = btn.getAttribute('data-realname');
      if (!real) { alert('Member has no real name set — cannot edit'); return; }
      state.editingMember = real;
      renderMyInfo();
      document.getElementById('my-info-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
```

- [ ] **Step 4.7: After save, clear editing state if we were editing someone else**

Inside the form-submit success path (after `setTimeout(function () { feedback.classList.remove('visible'); }, 2000);` ~line 184), add:

```js
if (state.editingMember) { state.editingMember = null; }
```

This returns the admin to their own view after saving another member's changes. Leave `await fetchData(); renderAllMembers();` as-is — then explicitly call `renderMyInfo();` at the end of that handler so the panel refreshes to "my info":

```js
renderMyInfo();
```

(Add it after `renderAllMembers();`.)

- [ ] **Step 4.8: Manual verification**

Log in as an admin.
1. On `/admin/logistics`, a pencil icon appears next to every name in the All Members table.
2. Click a pencil on someone other than yourself. The My Info panel redraws with a banner "Editing **\<name\>**" and the form shows that member's current values.
3. Change their NoOrg duty days (pick 2026-07-06). Save. You're returned to your own logistics view.
4. Click the pencil on that same person again — the saved value is there.
5. Log in as a non-admin (or disable your admin bit temporarily in the sheet). Confirm no pencils render, and a direct API call to upsert someone else's name returns 403.

- [ ] **Step 4.9: Commit**

```bash
git add assets/js/admin-logistics.js admin/logistics.html
git commit -m "Logistics: admin pencil-edit mode for other members' rows"
```

---

## Chunk 3: Setup timeline blocked cells

### Task 5: Fetch logistics on timeline + build NoOrg date map

**Files:**
- Modify: `assets/js/admin-timeline.js`

- [ ] **Step 5.1: Capture `noOrgMap` in state**

After `var state = { entries: [], logistics: [], tasks: [] };` (line 6), extend to:

```js
var state = { entries: [], logistics: [], tasks: [], noOrgMap: {} };
```

- [ ] **Step 5.2: Build the map from logistics fetched data**

`fetchData` already loads `state.logistics` from the timeline API. Check whether the timeline API returns logistics with the `NoOrgDates` column. Read `api/timeline.js` to confirm; if it fetches MemberLogistics via `safeGet + toObjects`, the new column flows through automatically (no API change required). If it selects specific columns, extend it.

After `state.logistics = data.logistics || [];` in `fetchData`, add:

```js
state.noOrgMap = {};
state.logistics.forEach(function (l) {
  var person = l.MemberName;
  if (!person) return;
  var dates = (l.NoOrgDates || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!dates.length) return;
  state.noOrgMap[person] = {};
  dates.forEach(function (d) { state.noOrgMap[person][d] = true; });
});
```

Important: the timeline's `people` list uses display names (`Playa Name || Name`), while logistics keys on Real Name. To keep this consistent with existing coupling, key `noOrgMap` on `MemberName` directly — whoever's in logistics as `MemberName` can be matched. When rendering cells (Task 6), match `state.noOrgMap[person]` where `person` is the timeline's display name. If the two diverge (Playa Name set), the block won't apply — that's a pre-existing mismatch bug, out of scope.

- [ ] **Step 5.3: If `/api/timeline` does not return `NoOrgDates`, extend it**

Open `api/timeline.js` and read the `fetch` action. If it uses `safeGet + toObjects` on `MemberLogistics`, no change needed. If it explicitly selects columns, add `NoOrgDates` to the column list.

(Expected: no change needed — `toObjects` in `_lib/sheets.js` returns all columns.)

- [ ] **Step 5.4: Manual verification via console**

On `/admin/timeline`, in DevTools:

```js
// After the script runs — paste into console:
fetch('/api/timeline', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (await JH.supabase.auth.getSession()).data.session.access_token }, body: '{}' })
  .then(r => r.json())
  .then(d => d.logistics.filter(l => l.NoOrgDates))
```

Expected: at least your own row appears with `NoOrgDates` populated.

- [ ] **Step 5.5: Commit**

```bash
git add assets/js/admin-timeline.js
git commit -m "Timeline: load NoOrg dates into state map"
```

---

### Task 6: Render NoOrg-blocked cells on the timeline

**Files:**
- Modify: `assets/js/admin-timeline.js`
- Modify: `admin/timeline.html`

- [ ] **Step 6.1: Add `.task-cell.noorg` CSS and a small legend**

In `admin/timeline.html` `<style>` block, after the existing `.task-cell.unavailable` rules (~line 32), add:

```css
.timeline-table td.task-cell.noorg { background: rgba(244,67,54,0.08); cursor: not-allowed; color: #f44336; font-style: italic; }
.timeline-table td.task-cell.noorg:hover { background: rgba(244,67,54,0.08); }
```

And add the legend right above `<div id="timeline-wrap">` inside `.main`:

```html
<div class="timeline-legend">Grey = not arrived yet. Red = on NoOrg duty.</div>
```

(`.timeline-legend` style is already defined in the existing stylesheet.)

- [ ] **Step 6.2: Add a helper `isNoOrg(person, date)` and use it in cell render**

In `admin-timeline.js`, next to `isAvailable` (~line 54), add:

```js
function isNoOrg(person, date) {
  return !!(state.noOrgMap[person] && state.noOrgMap[person][date]);
}
```

Then in `renderTimeline` inside the `periods.forEach` block (~line 128), change the cell-render chain to check NoOrg FIRST:

```js
periods.forEach(function (period) {
  var task = getTask(person, date, period);
  var available = isAvailable(person, date);
  var noorg = isNoOrg(person, date);

  if (noorg) {
    html += '<td class="task-cell noorg" title="On NoOrg duty">NoOrg</td>';
  } else if (isAdmin && available) {
    html += '<td class="task-cell" data-person="' + JH.esc(person) + '" data-date="' + JH.esc(date) + '" data-period="' + JH.esc(period) + '">' + JH.esc(task) + '</td>';
  } else if (!available) {
    html += '<td class="task-cell unavailable" title="Not arrived yet">' + JH.esc(task) + '</td>';
  } else {
    html += '<td>' + JH.esc(task) + '</td>';
  }
});
```

NoOrg takes precedence over "available" and over any existing task — blocking is what we want even if an entry exists for that cell (avoid showing stale tasks on a blocked day).

- [ ] **Step 6.3: Ensure drag-drop + edit skip `.noorg` cells**

The existing wire-up already uses `.task-cell:not(.unavailable)` selectors (admin-timeline.js lines ~187, ~246). Update those selectors to also exclude `.noorg`:

```js
document.querySelectorAll('.task-cell:not(.unavailable):not(.noorg)').forEach(function (td) {
```

(Both occurrences.)

- [ ] **Step 6.4: Manual verification**

1. On `/admin/logistics`, ensure your own row has `NoOrgDates` including 2026-07-08.
2. Navigate to `/admin/timeline`. Find your row.
3. The Morning and Evening cells for July 8 should have a red tint, italic "NoOrg" text, and a "On NoOrg duty" tooltip. They should NOT be clickable.
4. Cells for July 7 and July 9 should behave normally (editable, no red).
5. If a task was previously saved to your July 8 Morning, it's hidden under the NoOrg block (that's intended — remove it manually via the sheet if you want the cell empty again).
6. Check the legend text appears above the table.

- [ ] **Step 6.5: Commit**

```bash
git add assets/js/admin-timeline.js admin/timeline.html
git commit -m "Timeline: render NoOrg days as blocked red cells"
```

---

## Final verification

- [ ] **Run through the success criteria from the spec**

With dev server running:

1. Log a NoOrg date on your own logistics row — appears in the form + table.
2. As admin, click pencil on another member → edit their NoOrg dates → save → they persist.
3. Open `/admin/timeline` → those NoOrg dates appear as red cells distinct from grey "not arrived" cells.
4. Non-admin user cannot edit another member's row (no pencil, direct API returns 403).

- [ ] **Push to production**

```bash
git push
```

Vercel auto-deploys; smoke-test the three points above on the live site.

---

## Notes for the implementer

- No tests exist in this repo — don't add a test framework. Verify in the browser using the dev server (`npm run dev`, http://localhost:3000). `.env` + `.env.supabase` are already loaded by `dev-server.mjs`.
- **Data writes hit production.** Use your own row for testing; if you edit someone else's, revert it.
- All client JS in this repo is plain ES5-ish `var`-style to keep parity with existing files. Don't introduce `const`/`let` or arrow functions unless the file already uses them.
- `JH.apiFetch` handles auth headers + 401/403 redirects — don't bypass it.
- Pre-existing mismatch: logistics rows key on Real Name (`Name` column), but the All-Members table and timeline display `Playa Name || Name`. This plan does NOT fix that — it consistently uses Real Name for storage (matching current behaviour). If a member has a Playa Name different from Name, the timeline blocker won't match them. Document as a follow-up if it bites.
