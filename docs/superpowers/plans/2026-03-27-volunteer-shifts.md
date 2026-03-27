# Volunteer Shifts Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-aware volunteer shift scheduling page at `/admin/shifts` backed by four new Google Sheets tabs, with member self-service sign-up and admin management controls.

**Architecture:** Three Vercel serverless API endpoints handle read, member-mutation, and admin-mutation. A single `admin/shifts.html` page renders a schedule grid (rows=shifts, columns=slots, cells=name chips), a KB slide-out panel, and a member summary sidebar — all behaviour toggled by auth level via `JH.isAdmin()`.

**Tech Stack:** Vercel serverless (Node.js ESM), Google Sheets API v4 (`googleapis`), Jekyll static HTML, vanilla JS (no frameworks), existing `admin.css` CSS variables.

**Spec:** `docs/superpowers/specs/2026-03-27-volunteer-shifts-design.md`

---

## Pre-flight: Google Sheets setup (manual, one-time)

Before any code runs, an admin must create these four tabs in the Members Google Sheet (`SHEET_ID`):

| Tab name | Row 1 headers (exact, comma-separated) |
|---|---|
| `ShiftDefs` | `ShiftID,Name,Description,TimeExpectation,KBText,KBLinks` |
| `ShiftConfig` | `SlotID,Label,Date,StartTime,EndTime` |
| `ShiftAssignments` | `AssignmentID,SlotID,ShiftID,MemberName,Status` |
| `MemberMeta` | `MemberName,OtherResponsibilities` |

Note: `MemberMeta` is populated manually (one row per approved member). Write endpoints will 500 if a tab is missing — this is expected pre-setup behavior.

---

## Chunk 1: API Layer

### Task 1: vercel.json rewrite + sidebar nav items

**Files:**
- Modify: `vercel.json`
- Modify: `admin/applications.html`
- Modify: `admin/demographics.html`
- Modify: `admin/budget.html`

- [ ] **Step 1: Add URL rewrite to vercel.json**

In `vercel.json`, add after the `/admin/budget` rewrite:
```json
{ "source": "/admin/shifts", "destination": "/admin/shifts.html" }
```

Full rewrites array becomes:
```json
"rewrites": [
  { "source": "/admin", "destination": "/admin.html" },
  { "source": "/admin/applications", "destination": "/admin/applications.html" },
  { "source": "/admin/demographics", "destination": "/admin/demographics.html" },
  { "source": "/admin/budget", "destination": "/admin/budget.html" },
  { "source": "/admin/shifts", "destination": "/admin/shifts.html" },
  { "source": "/apply", "destination": "/apply.html" }
]
```

- [ ] **Step 2: Add shifts nav item to all three existing admin pages**

In `admin/applications.html`, `admin/demographics.html`, and `admin/budget.html`, add this nav item after the Budget nav item in each sidebar:
```html
<a class="nav-item" href="/admin/shifts" data-access="general">
  <span class="icon">&#9835;</span>
  <span class="nav-item-text">Shifts</span>
</a>
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json admin/applications.html admin/demographics.html admin/budget.html
git commit -m "Add shifts route and sidebar nav"
```

---

### Task 2: `api/shifts.js` — read endpoint

**Files:**
- Create: `api/shifts.js`

- [ ] **Step 1: Create the file**

```js
import { google } from 'googleapis';

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function safeGet(sheets, spreadsheetId, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (e) {
    return [];
  }
}

function toObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password } = req.body || {};
  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  try {
    const sheets = getSheets();
    const id = process.env.SHEET_ID;
    const [shiftDefsRows, slotConfigRows, assignmentsRows, memberMetaRows] = await Promise.all([
      safeGet(sheets, id, 'ShiftDefs'),
      safeGet(sheets, id, 'ShiftConfig'),
      safeGet(sheets, id, 'ShiftAssignments'),
      safeGet(sheets, id, 'MemberMeta'),
    ]);
    return res.status(200).json({
      shifts: toObjects(shiftDefsRows),
      slots: toObjects(slotConfigRows),
      assignments: toObjects(assignmentsRows),
      memberMeta: toObjects(memberMetaRows),
    });
  } catch (e) {
    console.error('shifts.js error:', e);
    return res.status(500).json({ error: 'Failed to fetch shift data' });
  }
}
```

- [ ] **Step 2: Smoke-test with vercel dev**

```bash
vercel dev &
curl -s -X POST http://localhost:3000/api/shifts \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_READ_PASSWORD"}' | jq .
```

Expected: `{ "shifts": [], "slots": [], "assignments": [], "memberMeta": [] }` (empty arrays if tabs not yet created, no 500).

- [ ] **Step 3: Commit**

```bash
git add api/shifts.js
git commit -m "Add api/shifts.js read endpoint"
```

---

### Task 3: `api/shifts-request.js` — member self-service

**Files:**
- Create: `api/shifts-request.js`

- [ ] **Step 1: Create the file**

```js
import { google } from 'googleapis';

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getSheetId(sheets, spreadsheetId, name) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const sheet = meta.data.sheets.find(s => s.properties.title === name);
  return sheet ? sheet.properties.sheetId : null;
}

async function getAllAssignmentRows(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShiftAssignments' });
    return res.data.values || [];
  } catch (e) { return []; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, shiftId, slotId, memberName, assignmentId } = req.body || {};

  const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
  if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (!action || !memberName) return res.status(400).json({ error: 'action and memberName required' });

  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID;

  try {
    if (action === 'request') {
      if (!shiftId || !slotId) return res.status(400).json({ error: 'shiftId and slotId required' });

      // Check if this member already has a non-bailed assignment on this shift+slot
      // (multiple members CAN share the same shift+slot — only block duplicates by the same person)
      const rows = await getAllAssignmentRows(sheets, spreadsheetId);
      if (rows.length > 1) {
        const headers = rows[0];
        const shiftIdCol = headers.indexOf('ShiftID');
        const slotIdCol = headers.indexOf('SlotID');
        const statusCol = headers.indexOf('Status');
        const memberCol = headers.indexOf('MemberName');
        const alreadySignedUp = rows.slice(1).some(r =>
          r[shiftIdCol] === shiftId && r[slotIdCol] === slotId &&
          r[memberCol] === memberName && r[statusCol] !== 'bailed'
        );
        if (alreadySignedUp) return res.status(409).json({ error: 'You are already signed up for this slot' });
      }

      const newId = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'ShiftAssignments',
        valueInputOption: 'RAW',
        requestBody: { values: [[newId, slotId, shiftId, memberName, 'requested']] },
      });
      return res.status(200).json({ success: true, assignmentId: newId });
    }

    if (action === 'cancel' || action === 'bail') {
      if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

      const rows = await getAllAssignmentRows(sheets, spreadsheetId);
      if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });

      const headers = rows[0];
      const idCol = headers.indexOf('AssignmentID');
      const statusCol = headers.indexOf('Status');
      const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === assignmentId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Assignment not found' });

      if (action === 'cancel') {
        const sheetId = await getSheetId(sheets, spreadsheetId, 'ShiftAssignments');
        if (sheetId === null) return res.status(500).json({ error: 'ShiftAssignments tab not found' });
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
          }
        });
      } else {
        // bail — update Status to 'bailed'
        const colLetter = String.fromCharCode(65 + statusCol);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `ShiftAssignments!${colLetter}${rowIdx + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [['bailed']] },
        });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('shifts-request error:', e);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
```

- [ ] **Step 2: Smoke-test request action**

With ShiftAssignments tab created and a ShiftDefs/ShiftConfig row in place:
```bash
curl -s -X POST http://localhost:3000/api/shifts-request \
  -H "Content-Type: application/json" \
  -d '{"password":"READ_PASS","action":"request","shiftId":"dinner","slotId":"tue-1","memberName":"TestMember"}' | jq .
```
Expected: `{ "success": true, "assignmentId": "..." }`

- [ ] **Step 3: Commit**

```bash
git add api/shifts-request.js
git commit -m "Add api/shifts-request.js member self-service endpoint"
```

---

### Task 4: `api/shifts-update.js` — admin management

**Files:**
- Create: `api/shifts-update.js`

- [ ] **Step 1: Create the file**

```js
import { google } from 'googleapis';

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getSheetId(sheets, spreadsheetId, name) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const sheet = meta.data.sheets.find(s => s.properties.title === name);
  return sheet ? sheet.properties.sheetId : null;
}

async function getRows(sheets, spreadsheetId, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tab });
    return res.data.values || [];
  } catch (e) { return []; }
}

async function deleteRowById(sheets, spreadsheetId, tab, idColName, idValue) {
  const rows = await getRows(sheets, spreadsheetId, tab);
  if (!rows.length) return false;
  const headers = rows[0];
  const idCol = headers.indexOf(idColName);
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === idValue);
  if (rowIdx === -1) return false;
  const sheetId = await getSheetId(sheets, spreadsheetId, tab);
  if (sheetId === null) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
    }
  });
  return true;
}

async function upsertRow(sheets, spreadsheetId, tab, idColName, idValue, rowValues) {
  const rows = await getRows(sheets, spreadsheetId, tab);
  if (!rows.length) return; // tab must be pre-created with headers
  const headers = rows[0];
  const idCol = headers.indexOf(idColName);
  const existingIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === idValue);
  if (existingIdx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: tab, valueInputOption: 'RAW',
      requestBody: { values: [rowValues] }
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${tab}!A${existingIdx + 1}`, valueInputOption: 'RAW',
      requestBody: { values: [rowValues] }
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, ...payload } = req.body || {};

  if (!password || password !== process.env.ADMIN_WRITE_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!action) return res.status(400).json({ error: 'action required' });

  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID;

  try {
    switch (action) {
      case 'confirm-assignment': {
        const { assignmentId } = payload;
        if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
        const rows = await getRows(sheets, spreadsheetId, 'ShiftAssignments');
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        const headers = rows[0];
        const idCol = headers.indexOf('AssignmentID');
        const statusCol = headers.indexOf('Status');
        const rowIdx = rows.findIndex((r, i) => i > 0 && r[idCol] === assignmentId);
        if (rowIdx === -1) return res.status(404).json({ error: 'Assignment not found' });
        const colLetter = String.fromCharCode(65 + statusCol);
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: `ShiftAssignments!${colLetter}${rowIdx + 1}`,
          valueInputOption: 'RAW', requestBody: { values: [['confirmed']] }
        });
        break;
      }
      case 'remove-assignment': {
        const { assignmentId } = payload;
        if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
        const deleted = await deleteRowById(sheets, spreadsheetId, 'ShiftAssignments', 'AssignmentID', assignmentId);
        if (!deleted) return res.status(404).json({ error: 'Assignment not found' });
        break;
      }
      case 'upsert-shift': {
        const { shiftId, name, description, timeExpectation, kbText, kbLinks } = payload;
        if (!shiftId || !name) return res.status(400).json({ error: 'shiftId and name required' });
        await upsertRow(sheets, spreadsheetId, 'ShiftDefs', 'ShiftID', shiftId,
          [shiftId, name, description || '', timeExpectation || '', kbText || '', kbLinks || '']);
        break;
      }
      case 'delete-shift': {
        const { shiftId } = payload;
        if (!shiftId) return res.status(400).json({ error: 'shiftId required' });
        await deleteRowById(sheets, spreadsheetId, 'ShiftDefs', 'ShiftID', shiftId);
        break;
      }
      case 'upsert-slot': {
        const { slotId, label, date, startTime, endTime } = payload;
        if (!slotId || !label || !date) return res.status(400).json({ error: 'slotId, label, date required' });
        await upsertRow(sheets, spreadsheetId, 'ShiftConfig', 'SlotID', slotId,
          [slotId, label, date, startTime || '', endTime || '']);
        break;
      }
      case 'delete-slot': {
        const { slotId } = payload;
        if (!slotId) return res.status(400).json({ error: 'slotId required' });
        await deleteRowById(sheets, spreadsheetId, 'ShiftConfig', 'SlotID', slotId);
        break;
      }
      case 'update-member-meta': {
        const { memberName, otherResponsibilities } = payload;
        if (!memberName) return res.status(400).json({ error: 'memberName required' });
        await upsertRow(sheets, spreadsheetId, 'MemberMeta', 'MemberName', memberName,
          [memberName, otherResponsibilities || '']);
        break;
      }
      case 'admin-add-assignment': {
        const { assignmentId, slotId, shiftId, memberName } = payload;
        if (!assignmentId || !slotId || !shiftId || !memberName) {
          return res.status(400).json({ error: 'assignmentId, slotId, shiftId, memberName required' });
        }
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'ShiftAssignments',
          valueInputOption: 'RAW',
          requestBody: { values: [[assignmentId, slotId, shiftId, memberName, 'confirmed']] },
        });
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('shifts-update error:', e);
    return res.status(500).json({ error: 'Failed to update' });
  }
}
```

- [ ] **Step 2: Smoke-test upsert-shift**

```bash
curl -s -X POST http://localhost:3000/api/shifts-update \
  -H "Content-Type: application/json" \
  -d '{"password":"WRITE_PASS","action":"upsert-shift","shiftId":"dinner","name":"Dinner Shift","description":"Cook dinner","timeExpectation":"~2h after sunset"}' | jq .
```
Expected: `{ "success": true }`

- [ ] **Step 3: Commit**

```bash
git add api/shifts-update.js
git commit -m "Add api/shifts-update.js admin management endpoint"
```

---

## Chunk 2: Page Shell + Core Rendering

### Task 5: `admin/shifts.html` — page shell

**Files:**
- Create: `admin/shifts.html`

- [ ] **Step 1: Create the file**

```html
---
layout: none
title: Shifts - JamHouse Admin
access: general
---
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shifts - JamHouse Admin</title>
  <meta name="access" content="general">
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/admin.css">
  <style>
    .shifts-layout { display: grid; grid-template-columns: 1fr 280px; gap: 20px; align-items: start; }
    @media (max-width: 1100px) { .shifts-layout { grid-template-columns: 1fr; } }
    .shifts-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .shifts-table th { font-family: var(--heading); text-align: left; padding: 8px 10px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); border-bottom: 1px solid var(--border); font-weight: 600; white-space: nowrap; }
    .shifts-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .shifts-table tr:hover td { background: var(--surface2); }
    .shift-name-col { min-width: 160px; max-width: 200px; }
    .shift-name-link { color: var(--accent); cursor: pointer; font-weight: 600; font-size: 0.85rem; text-decoration: none; }
    .shift-name-link:hover { text-decoration: underline; }
    .shift-desc { color: var(--text-muted); font-size: 0.75rem; margin-top: 2px; line-height: 1.4; }
    .slot-cell { min-width: 100px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 0.78rem; margin: 2px; cursor: pointer; white-space: nowrap; transition: opacity 0.15s; }
    .chip:hover { opacity: 0.8; }
    .chip-confirmed { background: rgba(76,175,80,0.15); color: #4caf50; border: 1px solid #4caf50; }
    .chip-requested { background: rgba(232,168,76,0.12); color: var(--accent); border: 1px solid var(--accent); opacity: 0.75; }
    .chip-bailed { background: rgba(244,67,54,0.1); color: #f44336; border: 1px solid #f44336; text-decoration: line-through; }
    .my-chip { box-shadow: 0 0 0 2px var(--accent); }
    .request-btn { background: none; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-muted); font-size: 0.75rem; padding: 2px 8px; cursor: pointer; margin: 2px; }
    .request-btn:hover { border-color: var(--accent); color: var(--accent); }
    .add-btn { background: none; border: none; color: var(--text-muted); font-size: 1rem; cursor: pointer; padding: 2px 4px; }
    .add-btn:hover { color: var(--accent); }
    .admin-controls-bar { display: flex; gap: 10px; margin-bottom: 16px; }
    .btn-secondary { padding: 0.45rem 1rem; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--heading); font-size: 0.85rem; cursor: pointer; }
    .btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
    .btn-primary { padding: 0.45rem 1rem; background: var(--accent); border: none; border-radius: 6px; color: var(--bg); font-family: var(--heading); font-size: 0.85rem; font-weight: 600; cursor: pointer; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-danger { padding: 0.45rem 0.75rem; background: rgba(244,67,54,0.15); border: 1px solid #f44336; border-radius: 6px; color: #f44336; font-family: var(--heading); font-size: 0.8rem; cursor: pointer; }
    .btn-danger:hover { background: rgba(244,67,54,0.25); }
    .summary-warn td { background: rgba(232,168,76,0.05); }
    .resp-text { cursor: text; padding: 2px 4px; border-radius: 4px; }
    .resp-text:hover { background: var(--surface2); }
    .resp-input { background: var(--bg); border: 1px solid var(--accent); border-radius: 4px; color: var(--text); font-family: var(--body); font-size: 0.85rem; padding: 2px 6px; width: 100%; }
    .empty-state { color: var(--text-muted); font-size: 0.9rem; padding: 24px; text-align: center; }
    /* KB panel */
    .kb-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; }
    .kb-overlay.active { display: block; }
    .kb-panel { position: fixed; top: 0; right: -420px; width: 420px; max-width: 100vw; height: 100vh; background: var(--surface); border-left: 1px solid var(--border); z-index: 51; overflow-y: auto; padding: 24px; transition: right 0.25s; display: flex; flex-direction: column; gap: 16px; }
    .kb-panel.active { right: 0; }
    .kb-panel-header { display: flex; justify-content: space-between; align-items: center; }
    .kb-panel-header h3 { font-family: var(--heading); color: var(--accent); font-size: 1.1rem; margin: 0; }
    .kb-close { background: none; border: none; color: var(--text-muted); font-size: 1.4rem; cursor: pointer; }
    .kb-close:hover { color: var(--text); }
    .kb-meta { font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 10px; }
    .kb-text { font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; color: var(--text); }
    .kb-links a { display: block; color: var(--accent); font-size: 0.85rem; margin-bottom: 6px; text-decoration: none; }
    .kb-links a:hover { text-decoration: underline; }
    .kb-edit-area { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .kb-edit-area label { font-size: 0.78rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .kb-edit-area textarea { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--body); font-size: 0.85rem; padding: 8px; resize: vertical; min-height: 80px; }
    .kb-edit-area textarea:focus { border-color: var(--accent); outline: none; }
    /* Modals */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; justify-content: center; align-items: center; }
    .modal-overlay.active { display: flex; }
    .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; max-width: 500px; width: 90%; max-height: 85vh; overflow-y: auto; padding: 24px; }
    .modal-wide { max-width: 660px; }
    .modal h2 { font-family: var(--heading); color: var(--accent); margin: 0 0 16px; display: flex; justify-content: space-between; align-items: center; font-size: 1.1rem; }
    .modal-close { background: none; border: none; color: var(--text-muted); font-size: 1.4rem; cursor: pointer; }
    .modal-close:hover { color: var(--text); }
    .modal-body { display: flex; flex-direction: column; gap: 10px; }
    .modal-body label { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 2px; }
    .modal-body input, .modal-body select, .modal-body textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--body); font-size: 0.85rem; padding: 7px 10px; box-sizing: border-box; }
    .modal-body input:focus, .modal-body select:focus, .modal-body textarea:focus { border-color: var(--accent); outline: none; }
    .modal-body textarea { min-height: 70px; resize: vertical; }
    .modal-actions { display: flex; gap: 8px; margin-top: 8px; }
    /* Context menu */
    .context-menu { position: fixed; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 4px; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
    .context-menu button { display: block; width: 100%; padding: 7px 14px; background: none; border: none; color: var(--text); font-family: var(--body); font-size: 0.85rem; cursor: pointer; text-align: left; border-radius: 4px; }
    .context-menu button:hover { background: var(--surface); color: var(--accent); }
    .context-menu .danger:hover { color: #f44336; }
    /* Shift list in manage modal */
    .shift-list-item, .slot-list-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
    .shift-list-item:last-child, .slot-list-item:last-child { border-bottom: none; }
    .shift-list-actions { display: flex; gap: 6px; }
  </style>
</head>
<body>
<nav class="sidebar">
  <div class="sidebar-brand">JamHouse <span>Admin 2026</span></div>
  <div class="sidebar-nav">
    <a class="nav-item" href="/admin/applications" data-access="admin">
      <span class="icon">&#9993;</span>
      <span class="nav-item-text">Applications</span>
    </a>
    <a class="nav-item" href="/admin/demographics" data-access="general">
      <span class="icon">&#9776;</span>
      <span class="nav-item-text">Approved Members</span>
    </a>
    <a class="nav-item" href="/admin/budget" data-access="general">
      <span class="icon">&#9733;</span>
      <span class="nav-item-text">Budget</span>
    </a>
    <a class="nav-item active" href="/admin/shifts" data-access="general">
      <span class="icon">&#9835;</span>
      <span class="nav-item-text">Shifts</span>
    </a>
  </div>
  <div class="sidebar-footer">
    <a href="/">&#8592; Back to Site</a>
    <a href="#" onclick="sessionStorage.clear();window.location.href='/admin';return false;">Logout</a>
  </div>
</nav>

<div class="main">
  <div class="page-header">
    <h1><span class="icon" style="color:var(--accent)">&#9835;</span> Volunteer Shifts</h1>
    <div class="subtitle">Shift schedule, sign-ups, and knowledge base</div>
  </div>

  <div id="admin-controls" class="admin-controls-bar" style="display:none">
    <button id="btn-manage-shifts" class="btn-secondary">Manage Shifts</button>
    <button id="btn-manage-slots" class="btn-secondary">Configure Slots</button>
  </div>

  <div class="shifts-layout">
    <div class="panel">
      <div id="shifts-grid-wrap"><div class="empty-state">Loading shifts...</div></div>
    </div>
    <div class="panel">
      <h2>Shift Summary</h2>
      <div id="summary-wrap"><div class="empty-state">Loading...</div></div>
    </div>
  </div>
</div>

<!-- KB slide-out panel -->
<div class="kb-overlay" id="kb-overlay"></div>
<div class="kb-panel" id="kb-panel">
  <div class="kb-panel-header">
    <h3 id="kb-title"></h3>
    <button class="kb-close" id="kb-close">&times;</button>
  </div>
  <div class="kb-meta" id="kb-meta"></div>
  <div class="kb-text" id="kb-text"></div>
  <div class="kb-links" id="kb-links"></div>
  <div id="kb-edit-area" class="kb-edit-area" style="display:none">
    <label>Knowledge Base Text</label>
    <textarea id="kb-edit-text" placeholder="Free-form notes, instructions, tips..."></textarea>
    <label>Links (one per line: Label|URL)</label>
    <textarea id="kb-edit-links" rows="4" placeholder="Meal Plan|https://...&#10;Shopping List|https://..."></textarea>
    <div class="modal-actions">
      <button id="kb-save-btn" class="btn-primary">Save</button>
    </div>
  </div>
</div>

<!-- Name selector modal -->
<div class="modal-overlay active" id="name-modal">
  <div class="modal">
    <h2>Who are you?</h2>
    <div class="modal-body">
      <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:8px">Select your name to sign up for and manage your shifts. You can change this later.</p>
      <label>Your name</label>
      <select id="name-select"><option value="">Select your name...</option></select>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button id="name-confirm-btn" class="btn-primary">Confirm</button>
    </div>
  </div>
</div>

<!-- Chip context menu (admin) -->
<div id="chip-menu" class="context-menu" style="display:none">
  <button id="chip-confirm-btn">Confirm assignment</button>
  <button id="chip-remove-btn" class="danger">Remove assignment</button>
</div>

<!-- Add assignment modal (admin) -->
<div class="modal-overlay" id="add-modal">
  <div class="modal">
    <h2>Add Assignment <button class="modal-close" data-close="add-modal">&times;</button></h2>
    <div class="modal-body">
      <label>Member</label>
      <select id="add-member-select"><option value="">Select member...</option></select>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button id="add-confirm-btn" class="btn-primary">Add (confirmed)</button>
      <button id="add-cancel-btn" class="btn-secondary">Cancel</button>
    </div>
  </div>
</div>

<!-- Manage Shifts modal (admin) -->
<div class="modal-overlay" id="manage-shifts-modal">
  <div class="modal modal-wide">
    <h2>Manage Shifts <button class="modal-close" data-close="manage-shifts-modal">&times;</button></h2>
    <div id="shifts-list-wrap" style="margin-bottom:16px"></div>
    <button id="add-shift-btn" class="btn-secondary">+ Add Shift</button>
    <div id="shift-form" class="modal-body" style="display:none;margin-top:16px">
      <input id="sf-id" placeholder="ID (slug, no spaces, e.g. dinner)">
      <input id="sf-name" placeholder="Display name">
      <input id="sf-time" placeholder="Time expectation (e.g. ~2h after dinner)">
      <textarea id="sf-desc" placeholder="Description"></textarea>
      <textarea id="sf-kb-text" placeholder="Knowledge base text"></textarea>
      <textarea id="sf-kb-links" placeholder="Label|URL (one per line)"></textarea>
      <div class="modal-actions">
        <button id="sf-save-btn" class="btn-primary">Save Shift</button>
        <button id="sf-cancel-btn" class="btn-secondary">Cancel</button>
      </div>
    </div>
  </div>
</div>

<!-- Configure Slots modal (admin) -->
<div class="modal-overlay" id="manage-slots-modal">
  <div class="modal modal-wide">
    <h2>Configure Slots <button class="modal-close" data-close="manage-slots-modal">&times;</button></h2>
    <div id="slots-list-wrap" style="margin-bottom:16px"></div>
    <button id="add-slot-btn" class="btn-secondary">+ Add Slot</button>
    <div id="slot-form" class="modal-body" style="display:none;margin-top:16px">
      <input id="sl-id" placeholder="ID (slug, e.g. tue-1)">
      <input id="sl-label" placeholder="Label (e.g. Tuesday 1 July)">
      <input id="sl-date" type="date">
      <input id="sl-start" placeholder="Start time (optional, e.g. 10:00)">
      <input id="sl-end" placeholder="End time (optional, e.g. 12:00)">
      <div class="modal-actions">
        <button id="sl-save-btn" class="btn-primary">Save Slot</button>
        <button id="sl-cancel-btn" class="btn-secondary">Cancel</button>
      </div>
    </div>
  </div>
</div>

<script src="/assets/js/admin-auth.js"></script>
<script src="/assets/js/admin-shifts.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify it loads at `/admin/shifts` without JS errors**

```bash
# With vercel dev running, open http://localhost:3000/admin/shifts
# Should show sidebar, page header, and loading state
# Name modal should appear (no JS yet — will add next)
```

- [ ] **Step 3: Commit**

```bash
git add admin/shifts.html
git commit -m "Add admin/shifts.html page shell"
```

---

### Task 6: `assets/js/admin-shifts.js` — data loading + grid rendering

**Files:**
- Create: `assets/js/admin-shifts.js`

- [ ] **Step 1: Create the file with data loading, name selector, and grid rendering**

```js
(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var approvedMembers = members.filter(function (m) {
    return (m['Status'] || '').toLowerCase() === 'approved';
  });

  var state = { shifts: [], slots: [], assignments: [], memberMeta: [], myName: null };

  // ── Name selector ─────────────────────────────────────────────────────────

  state.myName = sessionStorage.getItem('jh_member_name');

  var nameModal = document.getElementById('name-modal');
  var nameSelect = document.getElementById('name-select');
  var nameConfirmBtn = document.getElementById('name-confirm-btn');

  if (state.myName) {
    nameModal.classList.remove('active');
  } else {
    approvedMembers.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      nameSelect.appendChild(opt);
    });
    nameModal.classList.add('active');
  }

  nameConfirmBtn.addEventListener('click', function () {
    var val = nameSelect.value;
    if (!val) return;
    state.myName = val;
    sessionStorage.setItem('jh_member_name', val);
    nameModal.classList.remove('active');
    render();
  });

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) { console.error('shifts fetch failed'); return; }
    var data = await res.json();
    state.shifts = data.shifts || [];
    state.slots = data.slots || [];
    state.assignments = data.assignments || [];
    state.memberMeta = data.memberMeta || [];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sortedSlots() {
    return state.slots.slice().sort(function (a, b) {
      var da = (a.Date || '') + (a.StartTime || 'z');
      var db = (b.Date || '') + (b.StartTime || 'z');
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }

  // ── Grid rendering ────────────────────────────────────────────────────────

  function renderGrid() {
    var slots = sortedSlots();
    var wrap = document.getElementById('shifts-grid-wrap');

    if (!state.shifts.length || !slots.length) {
      wrap.innerHTML = '<div class="empty-state">No shifts configured yet.' +
        (isAdmin ? ' Use "Manage Shifts" and "Configure Slots" to get started.' : ' Check back later.') + '</div>';
      return;
    }

    var html = '<div style="overflow-x:auto"><table class="shifts-table"><thead><tr>';
    html += '<th class="shift-name-col">Shift</th>';
    slots.forEach(function (slot) { html += '<th>' + esc(slot.Label) + '</th>'; });
    html += '</tr></thead><tbody>';

    state.shifts.forEach(function (shift) {
      html += '<tr><td class="shift-name-col"><a class="shift-name-link" data-shift-id="' + esc(shift.ShiftID) + '">' + esc(shift.Name) + '</a>';
      if (shift.Description) html += '<div class="shift-desc">' + esc(shift.Description) + '</div>';
      html += '</td>';

      slots.forEach(function (slot) {
        html += '<td class="slot-cell" data-shift-id="' + esc(shift.ShiftID) + '" data-slot-id="' + esc(slot.SlotID) + '">';

        // Only show assignments whose shift and slot still exist (filter orphans)
        var cellAssignments = state.assignments.filter(function (a) {
          return a.ShiftID === shift.ShiftID && a.SlotID === slot.SlotID;
        });

        cellAssignments.forEach(function (a) {
          var cls = 'chip chip-' + (a.Status || 'requested');
          var isMine = state.myName && a.MemberName === state.myName;
          if (isMine) cls += ' my-chip';
          html += '<span class="' + cls + '" data-assignment-id="' + esc(a.AssignmentID) + '" data-status="' + esc(a.Status) + '" data-member="' + esc(a.MemberName) + '">' + esc(a.MemberName) + '</span>';
        });

        // Request button: show unless current member already has a non-bailed assignment in this cell
        // Multiple members CAN share the same shift+slot
        if (state.myName) {
          var alreadyMine = cellAssignments.some(function (a) { return a.MemberName === state.myName && a.Status !== 'bailed'; });
          if (!alreadyMine) {
            html += '<button class="request-btn" data-shift-id="' + esc(shift.ShiftID) + '" data-slot-id="' + esc(slot.SlotID) + '">+</button>';
          }
        }

        // Admin add button
        if (isAdmin) {
          html += '<button class="add-btn" data-shift-id="' + esc(shift.ShiftID) + '" data-slot-id="' + esc(slot.SlotID) + '" title="Add assignment">&#10010;</button>';
        }

        html += '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
    bindGridEvents();
  }

  // ── Summary panel rendering ───────────────────────────────────────────────

  function renderSummary() {
    var wrap = document.getElementById('summary-wrap');
    var confirmedCounts = {};
    state.assignments.forEach(function (a) {
      if (a.Status === 'confirmed') confirmedCounts[a.MemberName] = (confirmedCounts[a.MemberName] || 0) + 1;
    });
    var bailedSet = {};
    state.assignments.forEach(function (a) { if (a.Status === 'bailed') bailedSet[a.MemberName] = true; });

    if (!state.memberMeta.length) {
      wrap.innerHTML = '<div class="empty-state">No member data yet.</div>';
      return;
    }

    var html = '<table class="data-table" style="font-size:0.82rem">';
    html += '<thead><tr><th>Member</th><th>Shifts</th><th>Other</th></tr></thead><tbody>';

    state.memberMeta.forEach(function (m) {
      var count = confirmedCounts[m.MemberName] || 0;
      var warn = count === 0 || bailedSet[m.MemberName];
      html += '<tr' + (warn ? ' class="summary-warn"' : '') + '>';
      html += '<td class="name">' + esc(m.MemberName) + '</td>';
      html += '<td>' + count + '</td>';
      html += '<td>';
      if (isAdmin) {
        html += '<span class="resp-text" data-member="' + esc(m.MemberName) + '">' + esc(m.OtherResponsibilities) + '</span>';
      } else {
        html += esc(m.OtherResponsibilities);
      }
      html += '</td></tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
    if (isAdmin) bindSummaryEditEvents();
  }

  // ── KB panel ──────────────────────────────────────────────────────────────

  var currentKBShift = null;

  function openKB(shift) {
    currentKBShift = shift;
    document.getElementById('kb-title').textContent = shift.Name;
    document.getElementById('kb-meta').textContent = shift.TimeExpectation ? 'Time: ' + shift.TimeExpectation : '';
    document.getElementById('kb-text').textContent = shift.KBText || '';

    var linksEl = document.getElementById('kb-links');
    linksEl.innerHTML = '';
    if (shift.KBLinks) {
      shift.KBLinks.split('\n').forEach(function (line) {
        line = line.trim();
        if (!line) return;
        var parts = line.split('|');
        if (parts.length >= 2) {
          var a = document.createElement('a');
          a.href = parts.slice(1).join('|');
          a.textContent = parts[0];
          a.target = '_blank';
          linksEl.appendChild(a);
        }
      });
    }

    if (isAdmin) {
      document.getElementById('kb-edit-text').value = shift.KBText || '';
      document.getElementById('kb-edit-links').value = shift.KBLinks || '';
      document.getElementById('kb-edit-area').style.display = '';
    }

    document.getElementById('kb-panel').classList.add('active');
    document.getElementById('kb-overlay').classList.add('active');
  }

  function closeKB() {
    document.getElementById('kb-panel').classList.remove('active');
    document.getElementById('kb-overlay').classList.remove('active');
  }

  document.getElementById('kb-close').addEventListener('click', closeKB);
  document.getElementById('kb-overlay').addEventListener('click', closeKB);

  // ── Render coordinator ────────────────────────────────────────────────────

  async function render() {
    await fetchData();
    renderGrid();
    renderSummary();
    if (isAdmin) document.getElementById('admin-controls').style.display = '';
  }

  // ── Grid event bindings ───────────────────────────────────────────────────

  function bindGridEvents() {
    document.querySelectorAll('.shift-name-link').forEach(function (el) {
      el.addEventListener('click', function () {
        var shift = state.shifts.find(function (s) { return s.ShiftID === el.dataset.shiftId; });
        if (shift) openKB(shift);
      });
    });

    document.querySelectorAll('.request-btn').forEach(function (el) {
      el.addEventListener('click', function () {
        doMemberAction('request', el.dataset.shiftId, el.dataset.slotId, null);
      });
    });

    document.querySelectorAll('.chip.my-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        var status = el.dataset.status;
        var aId = el.dataset.assignmentId;
        var action = status === 'requested' ? 'cancel' : status === 'confirmed' ? 'bail' : null;
        if (!action) return;
        var msg = action === 'cancel' ? 'Cancel your request for this shift?' : 'Bail on this shift? The slot will reopen for others.';
        if (!confirm(msg)) return;
        doMemberAction(action, null, null, aId);
      });
    });

    if (isAdmin) {
      document.querySelectorAll('.chip').forEach(function (el) {
        el.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          showChipMenu(e.clientX, e.clientY, el.dataset.assignmentId, el.dataset.status);
        });
      });

      document.querySelectorAll('.add-btn').forEach(function (el) {
        el.addEventListener('click', function () {
          showAddModal(el.dataset.shiftId, el.dataset.slotId);
        });
      });
    }
  }

  // ── Member actions ────────────────────────────────────────────────────────

  async function doMemberAction(action, shiftId, slotId, assignmentId) {
    var body = { password: pass, action: action, memberName: state.myName };
    if (shiftId) body.shiftId = shiftId;
    if (slotId) body.slotId = slotId;
    if (assignmentId) body.assignmentId = assignmentId;

    var res = await fetch('/api/shifts-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) { alert('That slot was just taken by someone else. Refreshing...'); }
    else if (!res.ok) { var d = await res.json().catch(function () { return {}; }); alert(d.error || 'Something went wrong.'); }
    render();
  }

  // ── Summary edit (admin) ──────────────────────────────────────────────────

  function bindSummaryEditEvents() {
    document.querySelectorAll('.resp-text').forEach(function (el) {
      el.addEventListener('click', function () {
        var memberName = el.dataset.member;
        var input = document.createElement('input');
        input.className = 'resp-input';
        input.value = el.textContent;
        el.replaceWith(input);
        input.focus();
        input.select();

        async function save() {
          var val = input.value;
          var span = document.createElement('span');
          span.className = 'resp-text';
          span.dataset.member = memberName;
          span.textContent = val;
          input.replaceWith(span);
          bindSummaryEditEvents();
          await fetch('/api/shifts-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass, action: 'update-member-meta', memberName: memberName, otherResponsibilities: val }),
          });
          // Update local state
          var meta = state.memberMeta.find(function (m) { return m.MemberName === memberName; });
          if (meta) meta.OtherResponsibilities = val;
        }

        input.addEventListener('blur', save);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      });
    });
  }

  // ── KB save (admin) ───────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('kb-save-btn').addEventListener('click', async function () {
    if (!currentKBShift) return;
    var kbText = document.getElementById('kb-edit-text').value;
    var kbLinks = document.getElementById('kb-edit-links').value;
    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'upsert-shift',
        shiftId: currentKBShift.ShiftID,
        name: currentKBShift.Name,
        description: currentKBShift.Description,
        timeExpectation: currentKBShift.TimeExpectation,
        kbText: kbText,
        kbLinks: kbLinks,
      }),
    });
    currentKBShift.KBText = kbText;
    currentKBShift.KBLinks = kbLinks;
    document.getElementById('kb-text').textContent = kbText;
    btn.textContent = 'Saved';
    setTimeout(function () { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
  });

  // ── Admin: chip context menu ──────────────────────────────────────────────

  var chipMenu = document.getElementById('chip-menu');
  var activeChipId = null;

  function showChipMenu(x, y, assignmentId, status) {
    activeChipId = assignmentId;
    chipMenu.style.left = x + 'px';
    chipMenu.style.top = y + 'px';
    chipMenu.style.display = '';
    document.getElementById('chip-confirm-btn').style.display = status === 'confirmed' ? 'none' : '';
  }

  document.addEventListener('click', function (e) {
    if (!chipMenu.contains(e.target)) chipMenu.style.display = 'none';
  });

  document.getElementById('chip-confirm-btn').addEventListener('click', async function () {
    chipMenu.style.display = 'none';
    if (!activeChipId) return;
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'confirm-assignment', assignmentId: activeChipId }),
    });
    render();
  });

  document.getElementById('chip-remove-btn').addEventListener('click', async function () {
    chipMenu.style.display = 'none';
    if (!activeChipId) return;
    if (!confirm('Remove this assignment?')) return;
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'remove-assignment', assignmentId: activeChipId }),
    });
    render();
  });

  // ── Admin: add assignment modal ───────────────────────────────────────────

  var addModal = document.getElementById('add-modal');
  var addModalShiftId = null;
  var addModalSlotId = null;

  function showAddModal(shiftId, slotId) {
    addModalShiftId = shiftId;
    addModalSlotId = slotId;
    var sel = document.getElementById('add-member-select');
    sel.innerHTML = '<option value="">Select member...</option>';
    approvedMembers.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    addModal.classList.add('active');
  }

  document.getElementById('add-confirm-btn').addEventListener('click', async function () {
    var name = document.getElementById('add-member-select').value;
    if (!name) return;
    addModal.classList.remove('active');
    // Admin adds directly as confirmed
    var newId = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    // Use shifts-update to append a confirmed row directly
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass,
        action: 'admin-add-assignment',
        assignmentId: newId,
        slotId: addModalSlotId,
        shiftId: addModalShiftId,
        memberName: name,
      }),
    });
    render();
  });

  document.getElementById('add-cancel-btn').addEventListener('click', function () {
    addModal.classList.remove('active');
  });

  // ── Admin: Manage Shifts modal ────────────────────────────────────────────

  document.getElementById('btn-manage-shifts').addEventListener('click', function () {
    renderShiftsList();
    document.getElementById('manage-shifts-modal').classList.add('active');
  });

  function renderShiftsList() {
    var wrap = document.getElementById('shifts-list-wrap');
    if (!state.shifts.length) { wrap.innerHTML = '<div class="empty-state">No shifts yet.</div>'; return; }
    wrap.innerHTML = state.shifts.map(function (s) {
      return '<div class="shift-list-item"><span>' + esc(s.Name) + ' <small style="color:var(--text-muted)">(' + esc(s.ShiftID) + ')</small></span>' +
        '<div class="shift-list-actions">' +
        '<button class="btn-secondary edit-shift-btn" data-shift-id="' + esc(s.ShiftID) + '">Edit</button>' +
        '<button class="btn-danger delete-shift-btn" data-shift-id="' + esc(s.ShiftID) + '">Delete</button>' +
        '</div></div>';
    }).join('');

    wrap.querySelectorAll('.edit-shift-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var shift = state.shifts.find(function (s) { return s.ShiftID === btn.dataset.shiftId; });
        if (!shift) return;
        document.getElementById('sf-id').value = shift.ShiftID;
        document.getElementById('sf-id').disabled = true;
        document.getElementById('sf-name').value = shift.Name;
        document.getElementById('sf-time').value = shift.TimeExpectation;
        document.getElementById('sf-desc').value = shift.Description;
        document.getElementById('sf-kb-text').value = shift.KBText;
        document.getElementById('sf-kb-links').value = shift.KBLinks;
        document.getElementById('shift-form').style.display = '';
      });
    });

    wrap.querySelectorAll('.delete-shift-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete shift "' + btn.dataset.shiftId + '"? Existing assignments will be orphaned.')) return;
        await fetch('/api/shifts-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete-shift', shiftId: btn.dataset.shiftId }),
        });
        await render();
        renderShiftsList();
      });
    });
  }

  document.getElementById('add-shift-btn').addEventListener('click', function () {
    document.getElementById('sf-id').disabled = false;
    document.getElementById('sf-id').value = '';
    document.getElementById('sf-name').value = '';
    document.getElementById('sf-time').value = '';
    document.getElementById('sf-desc').value = '';
    document.getElementById('sf-kb-text').value = '';
    document.getElementById('sf-kb-links').value = '';
    document.getElementById('shift-form').style.display = '';
  });

  document.getElementById('sf-save-btn').addEventListener('click', async function () {
    var shiftId = document.getElementById('sf-id').value.trim();
    var name = document.getElementById('sf-name').value.trim();
    if (!shiftId || !name) { alert('ID and name are required.'); return; }
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass, action: 'upsert-shift', shiftId: shiftId, name: name,
        description: document.getElementById('sf-desc').value,
        timeExpectation: document.getElementById('sf-time').value,
        kbText: document.getElementById('sf-kb-text').value,
        kbLinks: document.getElementById('sf-kb-links').value,
      }),
    });
    document.getElementById('shift-form').style.display = 'none';
    await render();
    renderShiftsList();
  });

  document.getElementById('sf-cancel-btn').addEventListener('click', function () {
    document.getElementById('shift-form').style.display = 'none';
  });

  // ── Admin: Configure Slots modal ──────────────────────────────────────────

  document.getElementById('btn-manage-slots').addEventListener('click', function () {
    renderSlotsList();
    document.getElementById('manage-slots-modal').classList.add('active');
  });

  function renderSlotsList() {
    var wrap = document.getElementById('slots-list-wrap');
    var slots = sortedSlots();
    if (!slots.length) { wrap.innerHTML = '<div class="empty-state">No slots yet.</div>'; return; }
    wrap.innerHTML = slots.map(function (s) {
      var timeStr = s.StartTime ? ' ' + s.StartTime + (s.EndTime ? '–' + s.EndTime : '') : '';
      return '<div class="slot-list-item"><span>' + esc(s.Label) + timeStr + ' <small style="color:var(--text-muted)">(' + esc(s.SlotID) + ')</small></span>' +
        '<div class="shift-list-actions">' +
        '<button class="btn-secondary edit-slot-btn" data-slot-id="' + esc(s.SlotID) + '">Edit</button>' +
        '<button class="btn-danger delete-slot-btn" data-slot-id="' + esc(s.SlotID) + '">Delete</button>' +
        '</div></div>';
    }).join('');

    wrap.querySelectorAll('.edit-slot-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var slot = state.slots.find(function (s) { return s.SlotID === btn.dataset.slotId; });
        if (!slot) return;
        document.getElementById('sl-id').value = slot.SlotID;
        document.getElementById('sl-id').disabled = true;
        document.getElementById('sl-label').value = slot.Label;
        document.getElementById('sl-date').value = slot.Date;
        document.getElementById('sl-start').value = slot.StartTime;
        document.getElementById('sl-end').value = slot.EndTime;
        document.getElementById('slot-form').style.display = '';
      });
    });

    wrap.querySelectorAll('.delete-slot-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete slot "' + btn.dataset.slotId + '"? Existing assignments will be orphaned.')) return;
        await fetch('/api/shifts-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, action: 'delete-slot', slotId: btn.dataset.slotId }),
        });
        await render();
        renderSlotsList();
      });
    });
  }

  document.getElementById('add-slot-btn').addEventListener('click', function () {
    document.getElementById('sl-id').disabled = false;
    document.getElementById('sl-id').value = '';
    document.getElementById('sl-label').value = '';
    document.getElementById('sl-date').value = '';
    document.getElementById('sl-start').value = '';
    document.getElementById('sl-end').value = '';
    document.getElementById('slot-form').style.display = '';
  });

  document.getElementById('sl-save-btn').addEventListener('click', async function () {
    var slotId = document.getElementById('sl-id').value.trim();
    var label = document.getElementById('sl-label').value.trim();
    var date = document.getElementById('sl-date').value.trim();
    if (!slotId || !label || !date) { alert('ID, label, and date are required.'); return; }
    await fetch('/api/shifts-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pass, action: 'upsert-slot', slotId: slotId, label: label, date: date,
        startTime: document.getElementById('sl-start').value,
        endTime: document.getElementById('sl-end').value,
      }),
    });
    document.getElementById('slot-form').style.display = 'none';
    await render();
    renderSlotsList();
  });

  document.getElementById('sl-cancel-btn').addEventListener('click', function () {
    document.getElementById('slot-form').style.display = 'none';
  });

  // ── Modal close buttons ───────────────────────────────────────────────────

  document.querySelectorAll('.modal-close[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.getElementById(btn.dataset.close).classList.remove('active');
    });
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  if (state.myName) render();

})();
```

- [ ] **Step 2: Smoke-test the full page**

1. Open `http://localhost:3000/admin/shifts` logged in with read password
2. Name modal appears — select a name and confirm
3. Grid renders (empty or with data if sheet tabs have rows)
4. Click a shift name — KB panel slides in
5. Click "+" request button on an open slot — assignment appears as requested chip
6. Log in with write password — admin controls bar appears, chips have right-click menu

- [ ] **Step 3: Commit**

```bash
git add assets/js/admin-shifts.js
git commit -m "Add admin-shifts.js"
```

---

## Post-implementation checklist

- [ ] Create the four Google Sheets tabs manually with correct headers (see Pre-flight section above)
- [ ] Add a few rows to `ShiftDefs` and `ShiftConfig` via the admin UI and verify the grid renders
- [ ] Test member flow end-to-end: request → admin confirms → member bails → slot reopens
- [ ] Test admin flow: add via modal → remove via right-click → edit via Manage Shifts
- [ ] Verify summary panel updates after each action
- [ ] Verify KB panel opens, links parse correctly, and admin edits save
- [ ] Update `README.md` to move "Shifts" from "Coming soon" to "Live now"
