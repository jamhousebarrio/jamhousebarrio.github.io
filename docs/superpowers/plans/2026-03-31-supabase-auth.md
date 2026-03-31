# Supabase Auth Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared-password auth with per-user Supabase Auth (email + password login, magic links, admin roles).

**Architecture:** Supabase handles identity only (no DB tables). Frontend uses Supabase JS client for login/session. API endpoints verify JWTs via `jsonwebtoken` and check an `Admin` column in Google Sheets for write access. One new API endpoint (`/api/auth.js`) handles invites and metadata updates via Supabase Admin API.

**Tech Stack:** Supabase Auth, jsonwebtoken (server), @supabase/supabase-js (server for admin ops + CDN for frontend), existing Google Sheets + Vercel stack.

**Spec:** `docs/superpowers/specs/2026-03-31-supabase-auth-design.md`

---

## Chunk 1: Server-Side Auth Infrastructure

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jsonwebtoken and @supabase/supabase-js**

```bash
npm install jsonwebtoken @supabase/supabase-js
```

- [ ] **Step 2: Verify package.json updated**

```bash
cat package.json | grep -E "jsonwebtoken|supabase"
```

Expected: Both packages appear in `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add jsonwebtoken and @supabase/supabase-js dependencies"
```

---

### Task 2: Create auth helper (`/api/_lib/auth.js`)

**Files:**
- Create: `api/_lib/auth.js`

- [ ] **Step 1: Create the auth helper module**

```javascript
import jwt from 'jsonwebtoken';
import { getSheets, safeGet } from './sheets.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

/**
 * Verify Supabase JWT from Authorization header.
 * Returns { email, sub } or throws.
 */
export function verifyToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    const err = new Error('Missing authorization token');
    err.status = 401;
    throw err;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!payload.email) {
      const err = new Error('Token missing email claim');
      err.status = 401;
      throw err;
    }
    return { email: payload.email, sub: payload.sub };
  } catch (e) {
    const err = new Error('Invalid or expired token');
    err.status = 401;
    throw err;
  }
}

/**
 * Look up a member by email in Sheet1. Returns { member, row, headers } or null.
 * Rejects non-Approved members.
 */
export async function getMemberByEmail(sheets, spreadsheetId, email) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
  const rows = res.data.values;
  if (!rows || rows.length < 2) return null;
  const headers = rows[0];
  const emailCol = headers.indexOf('Email');
  const statusCol = headers.indexOf('Status');
  if (emailCol === -1) return null;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][emailCol] || '').toLowerCase().trim() === email.toLowerCase().trim()) {
      const member = {};
      headers.forEach((h, j) => { member[h] = rows[i][j] || ''; });
      const status = (member.Status || '').toLowerCase();
      if (status !== 'approved') return null;
      return { member, row: i + 1, headers };
    }
  }
  return null;
}

/**
 * Check if a member has admin privileges.
 */
export function isAdmin(member) {
  return (member.Admin || '').toLowerCase() === 'yes';
}

/**
 * Authenticate a request: verify JWT, look up member, return auth context.
 * Throws with .status on failure.
 */
export async function authenticateRequest(req) {
  const user = verifyToken(req);
  const sheets = getSheets(true);
  const spreadsheetId = process.env.SHEET_ID;
  const result = await getMemberByEmail(sheets, spreadsheetId, user.email);
  if (!result) {
    const err = new Error('Member not found or not approved');
    err.status = 403;
    throw err;
  }
  return {
    email: user.email,
    sub: user.sub,
    member: result.member,
    row: result.row,
    headers: result.headers,
    admin: isAdmin(result.member),
    sheets,
    spreadsheetId,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add api/_lib/auth.js
git commit -m "Add auth helper for JWT verification and member lookup"
```

---

### Task 3: Create `/api/auth.js` endpoint

**Files:**
- Create: `api/auth.js`

- [ ] **Step 1: Create the auth API endpoint**

```javascript
import { createClient } from '@supabase/supabase-js';
import { verifyToken, getMemberByEmail, isAdmin } from './_lib/auth.js';
import { getSheets } from './_lib/sheets.js';

function getSupabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action, ...payload } = req.body || {};

  try {
    // ── Invite: create Supabase user for newly approved member ──────────
    if (action === 'invite') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const { email } = payload;
      if (!email) return res.status(400).json({ error: 'email required' });

      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: { must_change_password: true },
        redirectTo: `${req.headers.origin || 'https://jamhouse.space'}/admin`,
      });
      if (error) {
        // User may already exist
        if (error.message && error.message.includes('already been registered')) {
          return res.status(409).json({ error: 'User already has an account' });
        }
        console.error('Invite error:', error);
        return res.status(500).json({ error: error.message || 'Failed to invite user' });
      }
      return res.status(200).json({ success: true });
    }

    // ── Clear must_change_password flag ─────────────────────────────────
    if (action === 'clear-password-flag') {
      const user = verifyToken(req);
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.auth.admin.updateUserById(user.sub, {
        user_metadata: { must_change_password: false },
      });
      if (error) {
        console.error('Clear flag error:', error);
        return res.status(500).json({ error: 'Failed to update user metadata' });
      }
      return res.status(200).json({ success: true });
    }

    // ── Disable user (when un-approved) ─────────────────────────────────
    if (action === 'disable') {
      const user = verifyToken(req);
      const sheets = getSheets(true);
      const result = await getMemberByEmail(sheets, process.env.SHEET_ID, user.email);
      if (!result || !isAdmin(result.member)) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const { email: targetEmail } = payload;
      if (!targetEmail) return res.status(400).json({ error: 'email required' });

      const supabase = getSupabaseAdmin();
      // Find user by email
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) {
        console.error('List users error:', listError);
        return res.status(500).json({ error: 'Failed to find user' });
      }
      const target = users.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());
      if (!target) return res.status(404).json({ error: 'Supabase user not found' });

      const { error } = await supabase.auth.admin.updateUserById(target.id, {
        ban_duration: '876000h',
      });
      if (error) {
        console.error('Disable error:', error);
        return res.status(500).json({ error: 'Failed to disable user' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Auth API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/auth.js
git commit -m "Add /api/auth endpoint for invite, password flag, and disable"
```

---

### Task 4: Migrate all API endpoints to JWT auth

Each endpoint follows the same pattern. Replace the password extraction and validation with JWT-based auth.

**Files:**
- Modify: `api/members.js`
- Modify: `api/budget.js`
- Modify: `api/meals.js`
- Modify: `api/logistics.js`
- Modify: `api/events.js`
- Modify: `api/drinks.js`
- Modify: `api/inventory.js`
- Modify: `api/roles.js`
- Modify: `api/shifts.js`
- Modify: `api/timeline.js`

The pattern for each endpoint is:

**Before (every endpoint):**
```javascript
const { password, action, ...payload } = req.body || {};
const isAdmin = password === process.env.ADMIN_WRITE_PASSWORD;
if (password !== process.env.ADMIN_PASSWORD && !isAdmin) {
  return res.status(401).json({ error: 'Wrong password' });
}
```

**After (every endpoint):**
```javascript
import { authenticateRequest } from './_lib/auth.js';
// ... inside handler:
const auth = await authenticateRequest(req);
const { action, ...payload } = req.body || {};
const isAdminUser = auth.admin;
```

Write actions change from `if (!isAdmin)` to `if (!isAdminUser)`.

- [ ] **Step 1: Migrate `api/members.js`**

This endpoint is special — it creates its own Sheets client and returns `{ members, admin }`. After migration:
- Import `authenticateRequest` from `./_lib/auth.js`
- Remove password logic and direct Sheets client creation
- Use `auth.sheets` and `auth.spreadsheetId` from `authenticateRequest()`
- The fetch action returns `{ members, admin: auth.admin }` using auth context
- For write actions, check `auth.admin`
- For the `update` action that modifies fields: block changes to the `Admin` column unless the requesting user is an admin

```javascript
import { colToLetter } from './_lib/sheets.js';
import { authenticateRequest } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await authenticateRequest(req);
    const { action, ...payload } = req.body || {};
    const sheets = auth.sheets;
    const spreadsheetId = auth.spreadsheetId;

    // ── Fetch members (default) ───────────────────────────────────────────
    if (!action) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1',
      });
      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(200).json({ members: [], admin: auth.admin });
      }
      const headers = rows[0];
      const members = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
      return res.status(200).json({ members, admin: auth.admin });
    }

    // ── Write actions require admin ──────────────────────────────────────
    if (!auth.admin) {
      return res.status(401).json({ error: 'Admin required' });
    }

    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];

    // ── Update member fields ──────────────────────────────────────────────
    if (action === 'update') {
      const { row, updates } = payload;
      if (!row || !updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Row and updates are required' });
      }
      // Block Admin column changes from non-admins (already checked above, but explicit)
      if ('Admin' in updates && !auth.admin) {
        return res.status(403).json({ error: 'Only admins can change admin status' });
      }
      var data = [];
      for (var key in updates) {
        var col = headers.indexOf(key);
        if (col === -1) continue;
        data.push({ range: 'Sheet1!' + colToLetter(col) + row, values: [[updates[key]]] });
      }
      if (data.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: data },
      });
      return res.status(200).json({ success: true });
    }

    // ── Update status ─────────────────────────────────────────────────────
    if (action === 'update-status') {
      const { row, status } = payload;
      if (!row || !status) {
        return res.status(400).json({ error: 'Row and status are required' });
      }
      const col = headers.indexOf('Status');
      if (col === -1) {
        return res.status(500).json({ error: 'Status column not found' });
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!' + colToLetter(col) + row,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] },
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Members API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
```

- [ ] **Step 2: Migrate `api/budget.js`**

Budget is special — it uses `BUDGET_SHEET_ID` and has its own Sheets client initialization with scope selection. After migration:
- Import `verifyToken`, `getMemberByEmail`, `isAdmin` from `./_lib/auth.js` (NOT `authenticateRequest`, because budget uses a different spreadsheet ID)
- Verify JWT and check member status/admin at the top
- Use `getSheets(true)` for all operations (per spec — can't know if write until after admin check)
- Replace `isWrite` with the admin check result
- The `shopping-request` action is accessible to all authenticated users (not just admins)

```javascript
import { getSheets, colToLetter } from './_lib/sheets.js';
import { verifyToken, getMemberByEmail, isAdmin as checkAdmin } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = verifyToken(req);
    const memberSheets = getSheets(true);
    const memberResult = await getMemberByEmail(memberSheets, process.env.SHEET_ID, user.email);
    if (!memberResult) {
      return res.status(403).json({ error: 'Member not found or not approved' });
    }
    const isWrite = checkAdmin(memberResult.member);

    const { action, ...payload } = req.body || {};
    const sheets = getSheets(true);
    const spreadsheetId = process.env.BUDGET_SHEET_ID;

    // ── Fetch budget totals (default) ─────────────────────────────────────
    if (!action || action === 'fetch') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Total',
      });
      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(200).json([]);
      }
      const headers = rows[0];
      const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
      return res.status(200).json(data);
    }

    // ── Fetch budget items, fees, shopping requests ───────────────────────
    if (action === 'fetch-items') {
      const budgetRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Budget',
      });
      const budgetRows = budgetRes.data.values || [];
      const headers = budgetRows[0] || [];
      const items = budgetRows.slice(1).map((row, i) => {
        const obj = { _row: i + 2 };
        headers.forEach((h, j) => { obj[h] = row[j] || ''; });
        return obj;
      }).filter(item => item.Item || item.Category);

      const feeRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Barrio Fee'",
      });
      const feeRows = feeRes.data.values || [];
      const feeHeaders = feeRows[0] || [];
      let totalExpected = 0, totalPaid = 0;
      const feeMembers = [];
      feeRows.slice(1).forEach((r, i) => {
        const expected = parseFloat(r[2]) || 0;
        const paid = parseFloat(r[3]) || 0;
        totalExpected += expected;
        totalPaid += paid;
        const obj = { _row: i + 2 };
        feeHeaders.forEach((h, j) => { obj[h] = r[j] || ''; });
        obj._expected = expected;
        obj._paid = paid;
        feeMembers.push(obj);
      });

      let shoppingRequests = [];
      try {
        const srRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'ShoppingRequests',
        });
        const srRows = srRes.data.values || [];
        if (srRows.length > 1) {
          const srHeaders = srRows[0];
          shoppingRequests = srRows.slice(1).map(row => {
            const obj = {};
            srHeaders.forEach((h, j) => { obj[h] = row[j] || ''; });
            return obj;
          });
        }
      } catch (e) {
        // Tab missing or unreadable
      }

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      return res.status(200).json({
        items,
        headers,
        fees: { expected: totalExpected, paid: totalPaid, members: feeMembers, feeHeaders: feeHeaders },
        sheetUrl,
        shoppingRequests,
      });
    }

    // ── Shopping request (any authenticated user) ─────────────────────────
    if (action === 'shopping-request') {
      const { requestId, item, description, link, price, submittedBy } = payload;
      if (!requestId || !item || !submittedBy) {
        return res.status(400).json({ error: 'requestId, item, submittedBy required' });
      }
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'ShoppingRequests',
        valueInputOption: 'RAW',
        requestBody: { values: [[requestId, item, description || '', link || '', price || '', submittedBy, 'pending']] },
      });
      return res.status(200).json({ success: true });
    }

    // ── Write actions below require admin ─────────────────────────────────
    if (!isWrite) {
      return res.status(401).json({ error: 'Admin required' });
    }

    // Read headers for add/update/delete
    const headersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Budget!1:1',
    });
    const headers = (headersRes.data.values || [[]])[0] || [];
    if (headers.length === 0) {
      return res.status(500).json({ error: "Budget sheet has no headers" });
    }

    if (action === 'add') {
      const { data } = payload;
      if (!data || !data.Category || !data.Item) {
        return res.status(400).json({ error: 'Category and Item are required' });
      }
      const newRow = headers.map(h => {
        if (h === 'Total Actual') return '';
        return data[h] || '';
      });
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Budget!A:A',
        valueInputOption: 'RAW',
        requestBody: { values: [newRow] },
      });
      const updatedRange = appendRes.data.updates.updatedRange;
      const addedRow = parseInt(updatedRange.match(/\d+$/)[0]);
      const totalCol = headers.indexOf('Total Actual');
      if (totalCol !== -1) {
        const qtyCol = colToLetter(headers.indexOf('Qty'));
        const priceCol = colToLetter(headers.indexOf('Price'));
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Budget!' + colToLetter(totalCol) + addedRow,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['=' + qtyCol + addedRow + '*' + priceCol + addedRow]] },
        });
      }
      const paidCol = headers.indexOf('Paid');
      if (paidCol !== -1) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Budget!' + colToLetter(paidCol) + addedRow,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[false]] },
        });
      }
      return res.status(200).json({ success: true, row: addedRow });
    }

    if (action === 'update') {
      const { row, data } = payload;
      if (!row || !data) {
        return res.status(400).json({ error: 'Row and data are required' });
      }
      var updates = [];
      for (var key in data) {
        var col = headers.indexOf(key);
        if (col === -1) continue;
        if (key === 'Total Actual') continue;
        var cl = colToLetter(col);
        var val = data[key];
        if (key === 'Paid') {
          val = val === true || val === 'true' || val === 'TRUE';
        }
        updates.push({ range: 'Budget!' + cl + row, values: [[val]] });
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      const { row } = payload;
      if (!row) {
        return res.status(400).json({ error: 'Row is required' });
      }
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const budgetSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'Budget');
      const sheetId = budgetSheet.properties.sheetId;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row }
            }
          }]
        }
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'approve-request' || action === 'reject-request') {
      const { requestId } = payload;
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      const reqRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ShoppingRequests' });
      const reqRows = reqRes.data.values || [];
      if (!reqRows.length) return res.status(404).json({ error: 'Not found' });
      const reqHeaders = reqRows[0];
      const idCol = reqHeaders.indexOf('RequestID');
      const statusCol = reqHeaders.indexOf('Status');
      const rowIdx = reqRows.findIndex((r, i) => i > 0 && r[idCol] === requestId);
      if (rowIdx === -1) return res.status(404).json({ error: 'Request not found' });
      const cl = String.fromCharCode(65 + statusCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `ShoppingRequests!${cl}${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[action === 'approve-request' ? 'approved' : 'rejected']] },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'update-fee') {
      const { row, amount, paidInFull, name, expectedFee } = payload;

      if (row) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "'Barrio Fee'!D" + row + ":E" + row,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[amount != null ? amount : '', paidInFull ? 'TRUE' : 'FALSE']] },
        });
        return res.status(200).json({ success: true, row: row });
      }

      if (!name) return res.status(400).json({ error: 'name required for new fee entry' });
      const feeRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Barrio Fee'" });
      const feeRows = feeRes.data.values || [];
      const nextNum = feeRows.length;

      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "'Barrio Fee'",
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[nextNum, name, expectedFee || 250, amount != null ? amount : '', paidInFull ? 'TRUE' : 'FALSE']] },
      });
      const updatedRange = appendRes.data.updates.updatedRange;
      const newRow = parseInt(updatedRange.match(/\d+$/)[0]);
      return res.status(200).json({ success: true, row: newRow });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Budget API error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
}
```

- [ ] **Step 3: Migrate the 8 simpler endpoints**

These all follow the identical pattern. For each file, make these changes:

1. Add import: `import { authenticateRequest } from './_lib/auth.js';`
2. Remove: `const { password, action, ...payload } = req.body || {};` and the password check lines
3. Add at start of try block: `const auth = await authenticateRequest(req);`
4. Add: `const { action, ...payload } = req.body || {};`
5. Replace `isAdmin` checks with `auth.admin`
6. For endpoints that create their own Sheets client: use `auth.sheets` and `auth.spreadsheetId` where they use `process.env.SHEET_ID`
7. Add catch for `e.status` errors: `if (e.status) return res.status(e.status).json({ error: e.message });`

**Endpoints and their specific notes:**

| File | Notes |
|------|-------|
| `api/meals.js` | Uses `getSheets(false)` for fetch, `getSheets(true)` for writes. After: use `auth.sheets` (always write scope). |
| `api/logistics.js` | Same pattern. Replace `password` extraction. |
| `api/events.js` | Same pattern. |
| `api/drinks.js` | Same pattern. Has `isAdmin` check for write actions. |
| `api/inventory.js` | Same pattern. No explicit admin check on write (upsert/delete) — add `if (!auth.admin)` guard. |
| `api/roles.js` | Same pattern. Has `isAdmin` check. |
| `api/shifts.js` | Uses its own `getRows` function. Has `isRead`/`isAdmin` pattern. `assign` action is available to all authenticated users (not just admins). `create`, `unassign`, `delete` require admin. |
| `api/timeline.js` | Same pattern. Has `isAdmin` check. |

- [ ] **Step 4: Commit all endpoint migrations**

```bash
git add api/members.js api/budget.js api/meals.js api/logistics.js api/events.js api/drinks.js api/inventory.js api/roles.js api/shifts.js api/timeline.js
git commit -m "Migrate all API endpoints from shared passwords to JWT auth"
```

---

### Task 5: Update dev server and vercel.json

**Files:**
- Modify: `dev-server.mjs`
- Modify: `vercel.json`

- [ ] **Step 1: Add auth route and profile rewrite to dev server**

In `dev-server.mjs`:
- Add `'auth'` to the `apiFiles` array (line 18)
- Add `['/admin/profile', '/admin/profile.html']` and `['/admin/build', '/admin/build.html']` to the rewrites array

- [ ] **Step 2: Add rewrites to vercel.json**

Add to the rewrites array:
```json
{ "source": "/admin/profile", "destination": "/admin/profile.html" },
{ "source": "/admin/build", "destination": "/admin/build.html" }
```

Note: The `/admin/build` rewrite may already exist — check and add only if missing.

- [ ] **Step 3: Commit**

```bash
git add dev-server.mjs vercel.json
git commit -m "Add auth API route and profile page rewrite"
```

---

## Chunk 2: Frontend Auth Integration

### Task 6: Create Supabase client module

**Files:**
- Create: `assets/js/supabase-client.js`

- [ ] **Step 1: Create the Supabase client initializer**

```javascript
// Supabase client — initialized after CDN script loads
// SUPABASE_URL and SUPABASE_ANON_KEY are public by design
(function() {
  window.JH = window.JH || {};

  // These will be set per-environment. For production, hardcode after Supabase project setup.
  // For local dev, the dev server could inject these, but since they're public keys,
  // hardcoding is the standard Supabase pattern.
  var SUPABASE_URL = window.__SUPABASE_URL || '';
  var SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY || '';

  if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
    JH.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
})();
```

Note: After creating the Supabase project, replace the empty strings with the actual project URL and anon key. These are public keys — hardcoding them is the standard Supabase pattern (same as Firebase API keys).

- [ ] **Step 2: Commit**

```bash
git add assets/js/supabase-client.js
git commit -m "Add Supabase client initializer"
```

---

### Task 7: Rewrite `admin-auth.js` for Supabase auth

**Files:**
- Modify: `assets/js/admin-auth.js`

- [ ] **Step 1: Rewrite the auth module**

Key changes:
- `JH.authenticate()` — use `supabase.auth.getSession()` instead of sessionStorage password
- `JH.isAdmin()` — reads from `JH.currentUser.admin` (set during authenticate)
- `JH.currentUser` — stores authenticated member's data (name, email, admin, row)
- `JH.apiFetch(url, body)` — new helper that gets fresh JWT from Supabase session and sends it as `Authorization: Bearer` header. All pages will use this instead of inline fetch with password.
- `JH.checkLogisticsPrompt()` — update to use `JH.apiFetch` and `JH.currentUser` instead of `jh_member_name` / `jh_pass`
- Remove all `sessionStorage` usage for `jh_pass`, `jh_admin`, `jh_member_name`

The full rewrite of `admin-auth.js`:

```javascript
window.JH = window.JH || {};

// Event date constants
JH.EVENT_START = '2026-07-01';
JH.EVENT_END = '2026-07-12';
JH.EVENT_WEEK_START = '2026-07-07';
JH.EVENT_WEEK_END = '2026-07-12';

// Current authenticated user (set by JH.authenticate)
JH.currentUser = null;

// Load Flatpickr for date/time inputs (dd/mm/yyyy, 24h)
var fpReady = false;
var fpQueue = [];
(function() {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
  document.head.appendChild(link);
  var dark = document.createElement('link');
  dark.rel = 'stylesheet';
  dark.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css';
  document.head.appendChild(dark);
  var style = document.createElement('style');
  style.textContent = '.flatpickr-input { cursor: pointer; } .flatpickr-calendar { font-family: Inter, sans-serif; z-index: 999999 !important; } .flatpickr-wrapper { width: 100%; max-width: 100%; box-sizing: border-box; } .flatpickr-wrapper input { width: 100%; box-sizing: border-box; }';
  document.head.appendChild(style);
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/flatpickr';
  script.onload = function() { fpReady = true; fpQueue.forEach(function(fn) { fn(); }); fpQueue = []; };
  document.head.appendChild(script);
})();

JH.initDate = function(el, opts) {
  if (!fpReady) { fpQueue.push(function() { JH.initDate(el, opts); }); return; }
  if (el._flatpickr) el._flatpickr.destroy();
  var modal = el.closest('.modal');
  var defaults = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    allowInput: true,
    static: !!modal,
    appendTo: modal || undefined,
    defaultDate: el.value || undefined,
    onReady: function(selectedDates, dateStr, instance) {
      if (!dateStr) instance.jumpToDate('2026-07-01');
    }
  };
  return flatpickr(el, Object.assign(defaults, opts || {}));
};

JH.initTime = function(el, opts) {
  if (!fpReady) { fpQueue.push(function() { JH.initTime(el, opts); }); return; }
  if (el._flatpickr) el._flatpickr.destroy();
  var modal = el.closest('.modal');
  return flatpickr(el, Object.assign({
    enableTime: true,
    noCalendar: true,
    dateFormat: 'H:i',
    time_24hr: true,
    allowInput: true,
    static: !!modal,
    appendTo: modal || undefined
  }, opts || {}));
};

JH.val = function(m, key) { return (m[key] || '').toString().trim(); };

JH.isAdmin = function() { return !!(JH.currentUser && JH.currentUser.admin); };

/**
 * Make an authenticated API call. Gets fresh JWT from Supabase session.
 */
JH.apiFetch = async function(url, body) {
  if (!JH.supabase) throw new Error('Supabase not initialized');
  var sessionResult = await JH.supabase.auth.getSession();
  var session = sessionResult.data.session;
  if (!session) {
    window.location.href = '/admin';
    throw new Error('No session');
  }
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
    },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/admin';
    throw new Error('Unauthorized');
  }
  return res;
};

JH.authenticate = async function() {
  if (!JH.supabase) { window.location.href = '/admin'; return null; }
  var sessionResult = await JH.supabase.auth.getSession();
  var session = sessionResult.data.session;
  if (!session) { window.location.href = '/admin'; return null; }

  // Check must_change_password flag
  var user = session.user;
  if (user.user_metadata && user.user_metadata.must_change_password) {
    // Allow profile page to load (so they can change password)
    if (window.location.pathname.indexOf('/admin/profile') === -1) {
      window.location.href = '/admin/profile';
      return null;
    }
  }

  try {
    var res = await JH.apiFetch('/api/members', {});
    if (!res.ok) { await JH.supabase.auth.signOut(); window.location.href = '/admin'; return null; }
    var data = await res.json();

    // Find current user in members list
    var email = user.email.toLowerCase();
    var me = (data.members || []).find(function(m) {
      return (m.Email || '').toLowerCase().trim() === email;
    });

    JH.currentUser = {
      email: user.email,
      name: me ? JH.val(me, 'Name') : '',
      playaName: me ? JH.val(me, 'Playa Name') : '',
      admin: data.admin,
      row: me ? me._row : null,
      member: me,
    };

    // Check page access
    var accessMeta = document.querySelector('meta[name="access"]');
    var pageAccess = accessMeta ? accessMeta.getAttribute('content') : 'general';
    if (pageAccess === 'admin' && !data.admin) {
      window.location.href = '/admin/demographics';
      return null;
    }
    JH.filterNav(data.admin);
    return data.members;
  } catch (e) {
    await JH.supabase.auth.signOut();
    window.location.href = '/admin';
    return null;
  }
};

JH.filterNav = function(isAdmin) {
  document.querySelectorAll('.sidebar .nav-item').forEach(function(item) {
    var access = item.getAttribute('data-access');
    if (access === 'admin' && !isAdmin) {
      item.style.display = 'none';
    }
  });
};

JH.fetchBudget = async function() {
  try {
    var res = await JH.apiFetch('/api/budget', { action: 'fetch' });
    if (res.ok) return await res.json();
    console.error('Budget fetch failed:', res.status);
  } catch (e) { console.error('Budget fetch error:', e); }
  return [];
};

// Shared icons and phone renderer
JH.waIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path fill="#25D366" d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.613.613l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.352 0-4.55-.678-6.414-1.846l-.447-.283-3.167 1.062 1.062-3.167-.283-.447A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>';
JH.tgIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#0088cc" d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

JH.phoneDigits = function(v) { return v.replace(/[^+\d]/g, '').replace(/\+/g, ''); };

JH.contactLinks = function(v) {
  var digits = JH.phoneDigits(v);
  if (!digits) return '';
  return ' &nbsp;<a href="https://wa.me/' + digits + '" target="_blank" title="WhatsApp" style="text-decoration:none;">' + JH.waIcon + '</a>' +
    ' <a href="https://t.me/+' + digits + '" target="_blank" title="Telegram" style="text-decoration:none;">' + JH.tgIcon + '</a>';
};

JH.PhoneCellRenderer = function() {};
JH.PhoneCellRenderer.prototype.init = function(params) {
  var v = (params.value || '').trim();
  this.eGui = document.createElement('span');
  if (!v) return;
  this.eGui.innerHTML = v.replace(/</g, '&lt;') + JH.contactLinks(v);
};
JH.PhoneCellRenderer.prototype.getGui = function() { return this.eGui; };

JH.isMobile = window.innerWidth < 480;

JH.IconsOnlyRenderer = function() {};
JH.IconsOnlyRenderer.prototype.init = function(params) {
  this.eGui = document.createElement('span');
  var v = (params.value || '').trim();
  if (v) this.eGui.innerHTML = JH.contactLinks(v);
};
JH.IconsOnlyRenderer.prototype.getGui = function() { return this.eGui; };

JH.NameLinkRenderer = function() {};
JH.NameLinkRenderer.prototype.init = function(params) {
  this.eGui = document.createElement('a');
  this.eGui.href = '#';
  this.eGui.textContent = params.value || '';
  this.eGui.style.cssText = 'color:var(--accent);cursor:pointer;font-weight:600;text-decoration:none;';
  this.eGui.addEventListener('click', function(e) { e.preventDefault(); });
};
JH.NameLinkRenderer.prototype.getGui = function() { return this.eGui; };

JH.mobileColumns = function(columnDefs, keepFields) {
  if (!JH.isMobile) return;
  columnDefs.forEach(function(col) {
    var match = (col.field && keepFields.indexOf(col.field) !== -1) ||
                (col.headerName && keepFields.indexOf(col.headerName) !== -1);
    if (!match) col.hide = true;
  });
};

JH.mobilePhoneColumn = function(col) {
  col.headerName = '';
  col.width = 80;
  col.maxWidth = 90;
  col.suppressSizeToFit = true;
  col.cellRenderer = JH.IconsOnlyRenderer;
};

JH.esc = function(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

JH.to24h = function(t) {
  if (!t) return '';
  var m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return t;
  var h = parseInt(m[1], 10);
  var ampm = m[3].toUpperCase();
  if (ampm === 'AM' && h === 12) h = 0;
  else if (ampm === 'PM' && h !== 12) h += 12;
  return (h < 10 ? '0' : '') + h + ':' + m[2];
};

JH.formatDate = function(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var day = String(d.getDate()).padStart(2, '0');
  var mon = String(d.getMonth() + 1).padStart(2, '0');
  return day + '/' + mon + '/' + d.getFullYear();
};

JH.formatDateLong = function(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var day = String(d.getDate()).padStart(2, '0');
  var mon = String(d.getMonth() + 1).padStart(2, '0');
  return days[d.getDay()] + ' ' + day + '/' + mon;
};

JH.getHeadcount = function(logistics, dateStr) {
  return logistics.filter(function (l) {
    if (!l.ArrivalDate || !l.DepartureDate) return false;
    return l.ArrivalDate <= dateStr && l.DepartureDate >= dateStr;
  }).length;
};

JH.getAllDates = function(logistics) {
  var dateSet = {};
  logistics.forEach(function (l) {
    if (!l.ArrivalDate || !l.DepartureDate) return;
    var d = new Date(l.ArrivalDate + 'T00:00:00');
    var end = new Date(l.DepartureDate + 'T00:00:00');
    while (d <= end) {
      dateSet[d.toISOString().slice(0, 10)] = true;
      d.setDate(d.getDate() + 1);
    }
  });
  return Object.keys(dateSet).sort();
};

JH.checkLogisticsPrompt = async function() {
  if (window.location.pathname.indexOf('/admin/logistics') !== -1) return;
  if (!JH.currentUser || !JH.currentUser.name) return;
  // Cache: skip API call if checked less than 10 minutes ago
  var lastChecked = sessionStorage.getItem('jh_logistics_checked');
  if (lastChecked && (Date.now() - parseInt(lastChecked, 10)) < 600000) return;
  try {
    var res = await JH.apiFetch('/api/logistics', {});
    if (!res.ok) return;
    var data = await res.json();
    sessionStorage.setItem('jh_logistics_checked', Date.now());
    var myName = JH.currentUser.name;
    var row = (data.logistics || []).find(function(r) { return r['MemberName'] === myName; });
    if (row && (row['ArrivalDate'] || row['DepartureDate'])) return;
    var banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(232,168,76,0.1);border:1px solid var(--accent);border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:0.84rem;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:12px;';
    banner.innerHTML = '<span>We don\'t have your arrival info yet! Please <a href="/admin/logistics" style="color:var(--accent);font-weight:600">fill in your logistics</a> so we can plan meals and pickups.</span>' +
      '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;flex-shrink:0">&times;</button>';
    var main = document.querySelector('.main');
    if (main) main.insertBefore(banner, main.firstChild.nextSibling);
  } catch (e) {}
};

// Auto-check after page loads
setTimeout(function() { JH.checkLogisticsPrompt(); }, 500);
```

- [ ] **Step 2: Commit**

```bash
git add assets/js/admin-auth.js
git commit -m "Rewrite admin-auth.js for Supabase session-based auth"
```

---

### Task 8: Rewrite login page (`admin.html`)

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Rewrite login page with email + password form and magic link**

Replace the entire `admin.html` with:

```html
---
layout: none
title: Admin - JamHouse 2026
permalink: /admin
---
<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JamHouse Admin</title>
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/admin.css">
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="/assets/js/supabase-client.js"></script>
</head>
<body>
<div id="login-view">
  <div class="login-box">
    <h1>JamHouse</h1>
    <div class="sub">Live Music Barrio</div>
    <p class="desc">Member Login</p>

    <!-- Login form -->
    <form id="login-form">
      <input type="email" id="email" placeholder="Email" required>
      <input type="password" id="password" placeholder="Password" required>
      <button type="submit">Log In</button>
    </form>
    <p class="login-error" id="login-error"></p>
    <p style="text-align:center;margin-top:12px;">
      <a href="#" id="forgot-link" style="color:var(--accent);font-size:0.85rem;text-decoration:none;">Forgot password?</a>
    </p>

    <!-- Magic link form (hidden by default) -->
    <form id="magic-form" style="display:none;">
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">Enter your email and we'll send you a login link.</p>
      <input type="email" id="magic-email" placeholder="Email" required>
      <button type="submit">Send Magic Link</button>
    </form>
    <p class="login-error" id="magic-error"></p>
    <p id="magic-back" style="display:none;text-align:center;margin-top:12px;">
      <a href="#" id="back-link" style="color:var(--accent);font-size:0.85rem;text-decoration:none;">&larr; Back to login</a>
    </p>
  </div>
</div>
<script>
  var sb = JH.supabase;

  // Toggle between login and magic link forms
  document.getElementById('forgot-link').addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('forgot-link').parentNode.style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('magic-form').style.display = '';
    document.getElementById('magic-back').style.display = '';
  });
  document.getElementById('back-link').addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('login-form').style.display = '';
    document.getElementById('forgot-link').parentNode.style.display = '';
    document.getElementById('magic-form').style.display = 'none';
    document.getElementById('magic-back').style.display = 'none';
    document.getElementById('magic-error').style.display = 'none';
  });

  // Email + password login
  document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var err = document.getElementById('login-error');
    err.style.display = 'none';
    var email = document.getElementById('email').value;
    var password = document.getElementById('password').value;
    try {
      var result = await sb.auth.signInWithPassword({ email: email, password: password });
      if (result.error) {
        err.textContent = result.error.message || 'Login failed';
        err.style.display = 'block';
        return;
      }
      // Redirect based on admin status
      redirectAfterLogin(result.data.session);
    } catch (ex) {
      err.textContent = 'Something went wrong';
      err.style.display = 'block';
    }
  });

  // Magic link
  document.getElementById('magic-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var err = document.getElementById('magic-error');
    err.style.display = 'none';
    var email = document.getElementById('magic-email').value;
    try {
      var result = await sb.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + '/admin' },
      });
      if (result.error) {
        err.textContent = result.error.message || 'Failed to send link';
        err.style.display = 'block';
        return;
      }
      err.textContent = 'Check your email for the login link!';
      err.style.color = '#4caf50';
      err.style.display = 'block';
    } catch (ex) {
      err.textContent = 'Something went wrong';
      err.style.display = 'block';
    }
  });

  async function redirectAfterLogin(session) {
    try {
      var res = await fetch('/api/members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        var data = await res.json();
        if (data.admin) window.location.href = '/admin/applications';
        else window.location.href = '/admin/demographics';
      } else {
        document.getElementById('login-error').textContent = 'Account not authorized';
        document.getElementById('login-error').style.display = 'block';
      }
    } catch (ex) {
      window.location.href = '/admin/demographics';
    }
  }

  // Auto-redirect if already logged in (or handle magic link callback)
  (async function() {
    if (!sb) return;
    // Handle hash fragment from magic link / invite
    var hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get('access_token')) {
      // Supabase will handle this via onAuthStateChange
    }
    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data.session;
    if (session) {
      redirectAfterLogin(session);
    }
  })();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add admin.html
git commit -m "Rewrite login page with email/password and magic link support"
```

---

### Task 9: Update all admin page HTML to include Supabase scripts

**Files:**
- Modify: All 13 admin pages in `admin/` directory

Every admin page needs these two `<script>` tags added in the `<head>`, **before** the closing `</head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/assets/js/supabase-client.js"></script>
```

Pages to update:
- `admin/applications.html`
- `admin/demographics.html`
- `admin/budget.html`
- `admin/shifts.html`
- `admin/inventory.html`
- `admin/logistics.html`
- `admin/meals.html`
- `admin/drinks.html`
- `admin/events.html`
- `admin/roles.html`
- `admin/timeline.html`
- `admin/build.html`

Also update each page's sidebar to add a Profile link and change the Logout button:

**Add before the Build Guide nav item:**
```html
<a class="nav-item" href="/admin/profile" data-access="general">
  <span class="icon">&#128100;</span>
  <span class="nav-item-text">Profile</span>
</a>
```

**Replace the sidebar footer logout link:**
```html
<!-- Before -->
<a href="#" onclick="sessionStorage.clear();window.location.href='/admin';return false;">Logout</a>

<!-- After -->
<a href="#" onclick="JH.supabase.auth.signOut().then(function(){window.location.href='/admin';});return false;">Logout</a>
```

- [ ] **Step 1: Update all admin pages with Supabase scripts, Profile nav link, and logout**

- [ ] **Step 2: Commit**

```bash
git add admin/
git commit -m "Add Supabase scripts, profile nav, and auth-based logout to all admin pages"
```

---

### Task 10: Update all page-specific JS to use `JH.apiFetch`

**Files:**
- Modify: `assets/js/admin-applications.js`
- Modify: `assets/js/admin-demographics.js`
- Modify: `assets/js/admin-budget.js`
- Modify: `assets/js/admin-shifts.js`
- Modify: `assets/js/admin-inventory.js`
- Modify: `assets/js/admin-logistics.js`
- Modify: `assets/js/admin-meals.js`
- Modify: `assets/js/admin-drinks.js`
- Modify: `assets/js/admin-events.js`
- Modify: `assets/js/admin-roles.js`
- Modify: `assets/js/admin-timeline.js`

Every page-specific JS file makes fetch calls with `password` in the body. These all need to change to use `JH.apiFetch()` instead.

**Search pattern to find all occurrences:**
```
sessionStorage.getItem('jh_pass')
```
and
```
password: pass
```

**Replace pattern:**

Before:
```javascript
var pass = sessionStorage.getItem('jh_pass');
var res = await fetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: pass, action: 'something', ...data })
});
```

After:
```javascript
var res = await JH.apiFetch('/api/endpoint', { action: 'something', ...data });
```

**Special case — `admin-applications.js`:**

In addition to the fetch migration, the `updateStatus` function (line 160-177) needs to trigger the invite popup when status changes to "Approved":

After the successful status update (line 171), add:
```javascript
if (newStatus === 'Approved') {
  var memberEmail = val(member, 'Email');
  var memberName = val(member, 'Name');
  if (memberEmail && confirm('Send invite email to ' + memberName + ' at ' + memberEmail + '?')) {
    try {
      var inviteRes = await JH.apiFetch('/api/auth', { action: 'invite', email: memberEmail });
      if (!inviteRes.ok) {
        var inviteErr = await inviteRes.json().catch(function() { return {}; });
        alert('Invite failed: ' + (inviteErr.error || 'Unknown error'));
      }
    } catch (inviteEx) {
      alert('Failed to send invite: ' + inviteEx.message);
    }
  }
}
```

And when status changes FROM "Approved" to something else, disable the account:
```javascript
var oldStatus = val(member, 'Status');
// (after successful update...)
if (oldStatus.toLowerCase() === 'approved' && newStatus.toLowerCase() !== 'approved') {
  var memberEmail = val(member, 'Email');
  if (memberEmail) {
    try {
      await JH.apiFetch('/api/auth', { action: 'disable', email: memberEmail });
    } catch (e) { /* best effort */ }
  }
}
```

- [ ] **Step 1: Update `admin-applications.js` with apiFetch and invite/disable flows**

- [ ] **Step 2: Update all other page JS files to use `JH.apiFetch`**

Use search-and-replace across all files. The pattern is consistent.

- [ ] **Step 3: Commit**

```bash
git add assets/js/
git commit -m "Migrate all admin page JS from password-based fetch to JH.apiFetch"
```

---

## Chunk 3: Profile Page, Migration Script & Cleanup

### Task 11: Create profile page

**Files:**
- Create: `admin/profile.html`
- Create: `assets/js/admin-profile.js`

- [ ] **Step 1: Create `admin/profile.html`**

Follow the admin page pattern (copy sidebar from an existing page like `admin/build.html`). Set the Profile nav item as `active`.

Content area should include:
- Page header: "Profile" with subtitle "Manage your account and personal info"
- **Password change section**: Current password + new password + confirm new password + submit button. If `must_change_password` is true, show a banner saying "Please set a new password to continue" and hide the current password field.
- **Personal info section**: Editable fields for Name, Playa Name, Email, Phone, Location, Nationality, Gender, Age. Pre-populated from `JH.currentUser.member`. Save button calls `/api/members` update action.

- [ ] **Step 2: Create `assets/js/admin-profile.js`**

```javascript
(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var user = JH.currentUser;
  var sb = JH.supabase;
  var session = (await sb.auth.getSession()).data.session;
  var mustChange = session && session.user.user_metadata && session.user.user_metadata.must_change_password;

  // Password change section
  var pwSection = document.getElementById('password-section');
  var currentPwField = document.getElementById('current-password');
  var currentPwRow = document.getElementById('current-password-row');

  if (mustChange) {
    document.getElementById('pw-banner').style.display = '';
    if (currentPwRow) currentPwRow.style.display = 'none';
  }

  document.getElementById('pw-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var msg = document.getElementById('pw-msg');
    msg.textContent = '';

    var newPw = document.getElementById('new-password').value;
    var confirmPw = document.getElementById('confirm-password').value;

    if (newPw !== confirmPw) {
      msg.textContent = 'Passwords do not match';
      msg.style.color = '#f44336';
      return;
    }
    if (newPw.length < 8) {
      msg.textContent = 'Password must be at least 8 characters';
      msg.style.color = '#f44336';
      return;
    }

    try {
      // If not a must-change flow, re-authenticate with current password first
      if (!mustChange) {
        var currentPw = currentPwField.value;
        if (!currentPw) {
          msg.textContent = 'Enter your current password';
          msg.style.color = '#f44336';
          return;
        }
        var reauth = await sb.auth.signInWithPassword({
          email: user.email,
          password: currentPw,
        });
        if (reauth.error) {
          msg.textContent = 'Current password is incorrect';
          msg.style.color = '#f44336';
          return;
        }
      }

      // Update password
      var result = await sb.auth.updateUser({ password: newPw });
      if (result.error) {
        msg.textContent = result.error.message || 'Failed to update password';
        msg.style.color = '#f44336';
        return;
      }

      // Clear must_change_password flag if set
      if (mustChange) {
        await JH.apiFetch('/api/auth', { action: 'clear-password-flag' });
      }

      msg.textContent = 'Password updated!';
      msg.style.color = '#4caf50';

      // If was forced, redirect to dashboard after short delay
      if (mustChange) {
        setTimeout(function() {
          window.location.href = JH.isAdmin() ? '/admin/applications' : '/admin/demographics';
        }, 1500);
      }
    } catch (ex) {
      msg.textContent = 'Something went wrong';
      msg.style.color = '#f44336';
    }
  });

  // Personal info section
  var editableFields = ['Name', 'Playa Name', 'Email', 'Phone', 'Location', 'Nationality', 'Gender', 'Age'];
  var infoForm = document.getElementById('info-form');

  editableFields.forEach(function(field) {
    var input = document.getElementById('info-' + field.toLowerCase().replace(/ /g, '-'));
    if (input && user.member) {
      input.value = JH.val(user.member, field);
    }
  });

  infoForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    var msg = document.getElementById('info-msg');
    msg.textContent = 'Saving...';
    msg.style.color = 'var(--text-muted)';

    var updates = {};
    editableFields.forEach(function(field) {
      var input = document.getElementById('info-' + field.toLowerCase().replace(/ /g, '-'));
      if (input) {
        var newVal = input.value.trim();
        var oldVal = user.member ? JH.val(user.member, field) : '';
        if (newVal !== oldVal) updates[field] = newVal;
      }
    });

    if (Object.keys(updates).length === 0) {
      msg.textContent = 'No changes';
      return;
    }

    try {
      var res = await JH.apiFetch('/api/members', {
        action: 'update',
        row: user.row,
        updates: updates,
      });
      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        throw new Error(err.error || 'Failed');
      }
      msg.textContent = 'Saved!';
      msg.style.color = '#4caf50';
      // Update local state
      for (var k in updates) {
        if (user.member) user.member[k] = updates[k];
      }
    } catch (ex) {
      msg.textContent = ex.message;
      msg.style.color = '#f44336';
    }
  });

  // If must change password, disable navigation away
  if (mustChange) {
    document.querySelectorAll('.sidebar a').forEach(function(link) {
      if (link.getAttribute('href') !== '/admin/profile') {
        link.addEventListener('click', function(e) {
          e.preventDefault();
          document.getElementById('pw-msg').textContent = 'Please change your password first';
          document.getElementById('pw-msg').style.color = '#f44336';
        });
        link.style.opacity = '0.4';
        link.style.pointerEvents = 'auto';
        link.style.cursor = 'not-allowed';
      }
    });
  }
})();
```

- [ ] **Step 3: Commit**

```bash
git add admin/profile.html assets/js/admin-profile.js
git commit -m "Add profile page for password change and personal info editing"
```

---

### Task 12: Create migration script

**Files:**
- Create: `scripts/migrate-auth.js`

- [ ] **Step 1: Create the migration script**

```javascript
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Read all members from Sheet1
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = sheetsApi({ version: 'v4', auth });
  const spreadsheetId = process.env.SHEET_ID;

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' });
  const rows = res.data.values;
  if (!rows || rows.length < 2) {
    console.log('No members found in Sheet1');
    return;
  }

  const headers = rows[0];
  const emailCol = headers.indexOf('Email');
  const statusCol = headers.indexOf('Status');
  if (emailCol === -1 || statusCol === -1) {
    console.error('Email or Status column not found');
    return;
  }

  // 2. Check for duplicate emails
  const approved = [];
  const emailMap = {};
  for (let i = 1; i < rows.length; i++) {
    const email = (rows[i][emailCol] || '').toLowerCase().trim();
    const status = (rows[i][statusCol] || '').toLowerCase();
    if (status !== 'approved' || !email) continue;
    if (emailMap[email]) {
      console.warn(`DUPLICATE EMAIL: "${email}" at rows ${emailMap[email]} and ${i + 1} — SKIPPING BOTH`);
      emailMap[email] = -1; // mark as duplicate
      continue;
    }
    emailMap[email] = i + 1;
    approved.push({ email, row: i + 1, name: rows[i][headers.indexOf('Name')] || '' });
  }

  // Filter out duplicates
  const toMigrate = approved.filter(m => emailMap[m.email] !== -1);
  console.log(`Found ${toMigrate.length} approved members to migrate`);

  // 3. Ensure Admin column exists
  let adminCol = headers.indexOf('Admin');
  if (adminCol === -1) {
    // Add Admin header
    adminCol = headers.length;
    const colLetter = String.fromCharCode(65 + adminCol);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!${colLetter}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Admin']] },
    });
    console.log(`Added "Admin" column at column ${colLetter}`);
  }

  // 4. Create Supabase accounts and set Admin=Yes
  let created = 0, skipped = 0, errors = 0;

  for (const member of toMigrate) {
    // Create Supabase user
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email: member.email,
        password: 'jamhouse2026',
        email_confirm: true,
        user_metadata: { must_change_password: true },
      });
      if (error) {
        if (error.message && error.message.includes('already been registered')) {
          console.log(`SKIP: ${member.email} (already exists in Supabase)`);
          skipped++;
        } else {
          console.error(`ERROR: ${member.email} — ${error.message}`);
          errors++;
        }
      } else {
        console.log(`CREATED: ${member.email} (${member.name})`);
        created++;
      }
    } catch (e) {
      console.error(`ERROR: ${member.email} — ${e.message}`);
      errors++;
    }

    // Set Admin=Yes in sheet
    const colLetter = String.fromCharCode(65 + adminCol);
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!${colLetter}${member.row}`,
        valueInputOption: 'RAW',
        requestBody: { values: [['Yes']] },
      });
    } catch (e) {
      console.error(`Failed to set Admin for ${member.email}: ${e.message}`);
    }
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add scripts/migrate-auth.js
git commit -m "Add one-time migration script for Supabase auth setup"
```

---

### Task 13: Update CLAUDE.md and environment documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Update the following sections:
- **Environment Variables**: Replace `ADMIN_PASSWORD` and `ADMIN_WRITE_PASSWORD` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- **Key Patterns**: Update auth flow description (Supabase session instead of password in sessionStorage, JWT in Authorization header)
- **API endpoint format**: Update to show Authorization header instead of password in body
- **Project Structure**: Add `api/auth.js`, `api/_lib/auth.js`, `assets/js/supabase-client.js`, `assets/js/admin-profile.js`, `admin/profile.html`, `scripts/migrate-auth.js`

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md for Supabase auth architecture"
```

---

### Task 14: Final integration verification

- [ ] **Step 1: Verify all files exist and are consistent**

```bash
# All new files exist
ls api/auth.js api/_lib/auth.js assets/js/supabase-client.js assets/js/admin-profile.js admin/profile.html scripts/migrate-auth.js

# No remaining references to old password pattern in API files
grep -r "ADMIN_PASSWORD\|ADMIN_WRITE_PASSWORD" api/ --include="*.js"
# Expected: NO output (register.js should not reference these either)

# No remaining password-in-body pattern in frontend JS
grep -r "jh_pass\|password: pass" assets/js/ --include="*.js"
# Expected: NO output

# Supabase scripts present in all admin pages
grep -l "supabase-client.js" admin/*.html
# Expected: all 13 admin pages listed
```

- [ ] **Step 2: Verify dev server starts**

```bash
npm run dev
```

Expected: Server starts without import errors. API routes load including `/api/auth`.

Note: Actual auth flows can't be tested until the Supabase project is set up and env vars are configured. The dev server startup confirms no syntax/import errors.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "Fix integration issues from auth migration"
```
