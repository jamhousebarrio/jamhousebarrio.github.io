# Supabase Auth Integration — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Approach:** Supabase Auth on frontend + JWT verification on backend (Approach A)

## Overview

Replace the shared-password authentication system with per-user Supabase Auth. Each approved member gets an individual account (email + password). Supabase handles login, sessions, magic links, and email sending. All app data remains in Google Sheets. API endpoints verify Supabase JWTs instead of checking shared passwords.

## Goals

- Individual user accounts with email + password login
- Accounts created only upon admin approval of an application
- Default password (`jamhouse2026`) with forced change for existing/migrated users
- Magic link flow for forgotten passwords (1-hour expiry, single-use)
- Personal profile page for password change and info editing
- Admin role column — only admins can assign other admins or perform write operations

## Architecture

### Boundary

- **Supabase:** Auth only (user accounts, sessions, magic links, email). No Supabase database tables.
- **Google Sheets:** All app data (members, budget, inventory, etc.) — unchanged.
- **Vercel API:** Validates JWTs, checks admin role in Sheets, serves data.

### Environment Variables

**Added:**
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Public key (used in frontend)
- `SUPABASE_SERVICE_ROLE_KEY` — Secret key (server-side only, for creating users)
- `SUPABASE_JWT_SECRET` — For verifying JWTs in API endpoints

**Removed:**
- `ADMIN_PASSWORD`
- `ADMIN_WRITE_PASSWORD`

### Members Sheet Changes

Add one column to Sheet1:
- `Admin` — "Yes" or empty. Determines write access in API endpoints. Only editable by existing admins.

### Serverless Function Budget

The project has a hard limit of 12 Vercel serverless functions. Currently 11 are in use. Adding `/api/auth.js` brings the total to exactly 12 — the ceiling. No additional endpoints can be added without consolidating existing ones.

## User Account Lifecycle

### New Applicant Flow

1. Person submits application via `/apply` (public, no auth — unchanged)
2. Application lands in Sheet1 with `Status: Pending`
3. Admin reviews in `/admin/applications`, changes status to `Approved`
4. System shows confirmation popup: "Send invite email to [name] at [email]?"
5. Admin confirms → frontend calls `/api/auth` with `action: invite`
6. Server-side: Supabase Admin API calls `inviteUserByEmail(email)` with user metadata `{ must_change_password: true }`
7. Supabase sends an invite email with a magic link — no default password is set on the account
8. User clicks the magic link → lands on the site logged in → frontend detects `must_change_password` → prompts to set their first password

### Existing Approved Members (Migration)

- One-time migration script creates Supabase accounts for all currently approved members using `createUser()` with email + password `jamhouse2026`
- User metadata: `{ must_change_password: true }`
- `Admin` column set to "Yes" for all existing approved members
- Admin flags can be removed manually later by an admin
- These are the only accounts that ever have the default password — all future accounts use the invite magic link flow (no default password)

### Password Change Enforcement

- After login, frontend checks `user.user_metadata.must_change_password`
- If `true`, redirects to `/admin/profile` — cannot navigate away until password is changed
- After successful change, clears the flag via `/api/auth` endpoint with `action: clear-password-flag`

### Forgot Password / Magic Link

- Login page has "Forgot password?" link
- User enters email → Supabase sends magic link (1-hour expiry, single-use)
- Magic link logs user in → frontend prompts to set new password (no old password required)
- After setting new password, proceeds to dashboard

### Profile Page (`/admin/profile`)

- **Change password:** Supabase's `updateUser({ password })` only requires an active session. To prevent unauthorized password changes from an unattended session, the normal flow re-authenticates first: call `signInWithPassword(email, currentPassword)` then `updateUser({ password: newPassword })`. If re-auth fails, reject the change.
- **After magic link login:** Skip re-authentication — only new password required (the user doesn't have a working password, that's why they used the magic link).
- **Edit personal info:** Name, playa name, phone, location, etc. — calls existing `/api/members` update endpoint.

### Member Removal

When a member's status is changed away from "Approved" (e.g., to "Rejected"), their Supabase account should be disabled via the Admin API (`updateUserById` with `{ ban_duration: '876000h' }` — approximately 100 years, effectively permanent). This prevents login even though the JWT might still be valid until expiry. The `getMemberByEmail` lookup must also verify the member's status is "Approved" — reject requests from non-approved members.

### Email Changes

If a member's email is updated in the Sheets data, the Supabase account email must also be updated (via Admin API `updateUserById`). This is handled in the `/api/members` update action — when the email field changes, also update the Supabase user. Failure to sync both will lock the member out.

## API Changes

### New Endpoint: `/api/auth.js`

| Action | Auth Required | Admin Required | Description |
|--------|--------------|----------------|-------------|
| `invite` | Yes (JWT) | Yes | Calls `inviteUserByEmail`, sends invite email. Called when admin approves an applicant. |
| `clear-password-flag` | Yes (JWT) | No | Clears `must_change_password` metadata for the calling user. |

The `/api/auth.js` endpoint uses `@supabase/supabase-js` initialized with `SUPABASE_SERVICE_ROLE_KEY` (admin client) for all operations.

### New Shared Helper: `/api/_lib/auth.js`

| Function | Purpose |
|----------|---------|
| `verifyToken(req)` | Extracts JWT from `Authorization` header, verifies with `SUPABASE_JWT_SECRET` using HS256 algorithm, validates `aud` claim and expiry. Returns `{ email, sub }` or throws 401. |
| `getMemberByEmail(sheets, email)` | Looks up member in Sheet1 by email. Returns member object + row number. Also verifies `Status` is "Approved" — rejects non-approved members. |
| `isAdmin(member)` | Checks `Admin` column value |

### Optimizing the Admin Check

Every API request needs to: (1) verify the JWT, (2) confirm the user is an approved member, (3) check admin status. Steps 2-3 require a Sheets round-trip, which doubles latency if done as a separate call.

**Solution:** Endpoints that already fetch member data (e.g., `members.js` fetches all members) can check admin status from the data they already have. Endpoints that don't need member data (e.g., `budget.js`) will do one additional Sheets lookup. This is acceptable — the admin check fetches a single row by email, not the full sheet.

**Scope initialization:** All API endpoints use `getSheets(true)` (write scope) for the auth lookup. This is necessary because we can't know whether a write operation will follow until after we've checked admin status. The Google service account already has full read-write access, so this doesn't change permissions — it's just the OAuth scope requested.

### Changes to All 10 Existing API Endpoints

Affected: `members.js`, `budget.js`, `meals.js`, `logistics.js`, `events.js`, `drinks.js`, `inventory.js`, `roles.js`, `shifts.js`, `timeline.js`

- Replace password check with: `const user = verifyToken(req)`
- Replace `isAdmin` / `isWrite` logic with: look up member by `user.email`, check `Admin` column
- Remove `password` from request body — auth comes from `Authorization: Bearer <jwt>` header
- Read actions: any authenticated user with `Status: Approved`
- Write actions: only users with `Admin: Yes`
- Admin column updates: only admins can modify the `Admin` column on any member

### Unchanged

- `/api/register.js` — stays public, no auth

### Request Format Change

```
// Before
POST /api/members  { password: "xxx", action: "fetch" }

// After
POST /api/members  { action: "fetch" }
Authorization: Bearer <jwt>
```

## Frontend Changes

### New Files

| File | Purpose |
|------|---------|
| `assets/js/supabase-client.js` | Initializes Supabase JS client (loaded via CDN), exports client instance |
| `assets/js/admin-profile.js` | Profile page logic: password change, edit personal info |
| `admin/profile.html` | Profile page with admin sidebar |

### Supabase JS Client

Loaded via CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`), same pattern as ag-Grid and Chart.js. The Supabase CDN script must be loaded **before** `admin-auth.js` in all admin pages, since `JH.authenticate()` depends on it. Add as a `<script>` tag in the `<head>` of every admin page.

Initialized in `supabase-client.js` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` (hardcoded — these are public keys by design).

### Token Refresh

Supabase JWTs expire after 1 hour by default. The Supabase JS client handles refresh automatically using a refresh token stored in `localStorage`. The frontend must call `supabase.auth.getSession()` to get the current (possibly refreshed) token before each API call, rather than caching a token at login time. The `JH.apiFetch()` helper will be updated to always get a fresh token.

### Changes to `admin-auth.js`

- `JH.authenticate()` rewritten: calls `supabase.auth.getSession()` to check for active session
- If no session → redirect to `/admin`
- If session exists but `must_change_password` is `true` → redirect to `/admin/profile` (locked until changed)
- `JH.isAdmin()` reads from member data fetched during auth (based on `Admin` column)
- New `JH.apiFetch(url, body)` helper: calls `supabase.auth.getSession()` for fresh token, sends `Authorization: Bearer <token>` header with every request. Replaces all inline `fetch()` calls that currently include `password` in the body.
- Remove `jh_pass` and `jh_admin` from sessionStorage
- `JH.currentUser` — stores the authenticated member's data (name, email, admin status). Replaces `jh_member_name` in sessionStorage. Pages like shifts, logistics, and the `checkLogisticsPrompt` function use this instead of a name picker.

### Changes to `admin.html` (Login Page)

- Email + password form (replaces password-only)
- "Forgot password?" link → shows email input → calls Supabase `signInWithOtp()` for magic link
- On successful login: check `must_change_password` → redirect to profile or dashboard

### Changes to `admin-applications.js`

- When admin changes status to "Approved": show confirmation popup "Send invite email to [name] at [email]?"
- On confirm: call `/api/auth` with `action: invite`
- `Admin` column visible and editable only by admins — non-admins don't see it
- When admin changes status away from "Approved": call `/api/auth` with `action: disable` to ban the Supabase account

### Sidebar Nav (All Admin Pages)

- Add "Profile" link
- "Logout" calls `supabase.auth.signOut()` instead of clearing sessionStorage

### No Changes To

- Public pages (`index.md`, `apply.html`)
- `/api/register.js`
- `assets/css/admin.css` (profile page uses existing admin styles)

## Migration Strategy

### One-Time Migration Script (`scripts/migrate-auth.js`)

- Runs locally with env vars (Supabase service role key + Google Sheets credentials)
- Reads Sheet1, finds all members with `Status: Approved`
- Checks for duplicate emails before proceeding — logs duplicates and skips them (must be resolved manually in the sheet)
- For each unique approved member: creates Supabase user via `createUser()` with email + password `jamhouse2026` + metadata `{ must_change_password: true }`
- Adds `Admin` column to Sheet1 if missing, sets "Yes" for all approved members
- Logs results: created, skipped (duplicate email or already exists), errors

### Rollout Order

1. Set up Supabase project (manual — dashboard)
2. Configure Supabase: set magic link expiry to 1 hour, restrict redirect URLs to production domain
3. Add Supabase env vars to Vercel
4. Run migration script
5. Deploy new code (removes old password auth)
6. Remove old `ADMIN_PASSWORD` / `ADMIN_WRITE_PASSWORD` env vars from Vercel

## New Dependencies

### Server-Side (package.json)

- `jsonwebtoken` — JWT verification in API endpoints (lightweight, no Supabase SDK needed server-side except for `/api/auth.js`)
- `@supabase/supabase-js` — Used only in `/api/auth.js` for admin operations (invite user, update metadata, disable user). Not imported by other endpoints.

### Frontend (CDN)

- `@supabase/supabase-js@2` — via jsDelivr CDN

### Migration Script

- `@supabase/supabase-js` — already in dependencies
- Existing `@googleapis/sheets` + `google-auth-library`

## Security Constraints

- Only admins can modify the `Admin` column on any member
- Only admins can invoke the `invite` action on `/api/auth`
- API endpoints verify member status is "Approved" — changing status revokes access
- Magic links expire after 1 hour, single-use
- JWTs verified on every API request with HS256 algorithm, `aud` claim validation, and expiry check — no fallback to shared passwords
- `SUPABASE_SERVICE_ROLE_KEY` never exposed to frontend
- `SUPABASE_ANON_KEY` is safe for frontend (Supabase RLS would restrict access, but we don't use Supabase DB)
- Supabase redirect URLs restricted to production domain to prevent magic link interception
- Password change requires re-authentication (current password) unless accessed via magic link
- Future accounts use invite magic link only — no default password. Default password exists only for the one-time migration of existing members.
