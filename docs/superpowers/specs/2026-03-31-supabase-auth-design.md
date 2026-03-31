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

## User Account Lifecycle

### New Applicant Flow

1. Person submits application via `/apply` (public, no auth — unchanged)
2. Application lands in Sheet1 with `Status: Pending`
3. Admin reviews in `/admin/applications`, changes status to `Approved`
4. System shows confirmation popup: "Send invite email to [name] at [email]?"
5. Admin confirms → frontend calls `/api/auth` with `action: invite`
6. Server-side: Supabase Admin API creates user with email + default password `jamhouse2026`, sends invite email
7. Invite email contains a magic link that logs them in and prompts password change

### Existing Approved Members (Migration)

- One-time migration script creates Supabase accounts for all currently approved members
- Password: `jamhouse2026`
- User metadata: `{ must_change_password: true }`
- `Admin` column set to "Yes" for all existing approved members
- Admin flags can be removed manually later by an admin

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

- Change password (requires current password under normal circumstances)
- After magic link login: password change form requires only new password (no current password field)
- Edit personal info (name, playa name, phone, location, etc.) — calls existing `/api/members` update endpoint

## API Changes

### New Endpoint: `/api/auth.js`

| Action | Auth Required | Admin Required | Description |
|--------|--------------|----------------|-------------|
| `invite` | Yes (JWT) | Yes | Creates Supabase user with default password, sends invite email. Called when admin approves an applicant. |
| `clear-password-flag` | Yes (JWT) | No | Clears `must_change_password` metadata for the calling user. |

### New Shared Helper: `/api/_lib/auth.js`

| Function | Purpose |
|----------|---------|
| `verifyToken(req)` | Extracts JWT from `Authorization` header, verifies with `SUPABASE_JWT_SECRET`, returns `{ email, sub }` or throws 401 |
| `getMemberByEmail(sheets, email)` | Looks up member in Sheet1 by email, returns member object + row number |
| `isAdmin(member)` | Checks `Admin` column value |

### Changes to All 10 Existing API Endpoints

Affected: `members.js`, `budget.js`, `meals.js`, `logistics.js`, `events.js`, `drinks.js`, `inventory.js`, `roles.js`, `shifts.js`, `timeline.js`

- Replace password check with: `const user = verifyToken(req)`
- Replace `isAdmin` / `isWrite` logic with: look up member by `user.email`, check `Admin` column
- Remove `password` from request body — auth comes from `Authorization: Bearer <jwt>` header
- Read actions: any authenticated user
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

Loaded via CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`), same pattern as ag-Grid and Chart.js. Initialized in `supabase-client.js` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` (injected at build time or hardcoded — they're public keys).

### Changes to `admin-auth.js`

- `JH.authenticate()` rewritten: checks Supabase session instead of `sessionStorage.jh_pass`
- If no session → redirect to `/admin`
- If session exists but `must_change_password` is `true` → redirect to `/admin/profile` (locked until changed)
- `JH.isAdmin()` reads from member data fetched during auth (based on `Admin` column)
- All API calls attach `Authorization: Bearer <token>` header instead of sending password in body
- Remove `jh_pass` and `jh_admin` from sessionStorage

### Changes to `admin.html` (Login Page)

- Email + password form (replaces password-only)
- "Forgot password?" link → shows email input → calls Supabase `signInWithOtp()` for magic link
- On successful login: check `must_change_password` → redirect to profile or dashboard

### Changes to `admin-applications.js`

- When admin changes status to "Approved": show confirmation popup "Send invite email to [name] at [email]?"
- On confirm: call `/api/auth` with `action: invite`
- `Admin` column visible and editable only by admins — non-admins don't see it

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
- For each: creates Supabase user via Admin API with email + password `jamhouse2026` + metadata `{ must_change_password: true }`
- Adds `Admin` column to Sheet1 if missing, sets "Yes" for all approved members
- Logs results: created, skipped (email already exists), errors

### Rollout Order

1. Set up Supabase project (manual — dashboard)
2. Add Supabase env vars to Vercel
3. Run migration script
4. Deploy new code (removes old password auth)
5. Remove old `ADMIN_PASSWORD` / `ADMIN_WRITE_PASSWORD` env vars from Vercel

## New Dependencies

### Server-Side (package.json)

- `jsonwebtoken` — JWT verification in API endpoints (lightweight, no Supabase SDK needed server-side except for the `/api/auth.js` invite flow)
- `@supabase/supabase-js` — Used only in `/api/auth.js` for admin operations (invite user, update metadata). Not imported by other endpoints.

### Frontend (CDN)

- `@supabase/supabase-js@2` — via jsDelivr CDN

### Migration Script

- `@supabase/supabase-js` — already in dependencies
- Existing `@googleapis/sheets` + `google-auth-library`

## Security Constraints

- Only admins can modify the `Admin` column on any member
- Only admins can invoke the `invite` action on `/api/auth`
- Magic links expire after 1 hour, single-use
- JWTs verified on every API request — no fallback to shared passwords
- `SUPABASE_SERVICE_ROLE_KEY` never exposed to frontend
- `SUPABASE_ANON_KEY` is safe for frontend (Supabase RLS would restrict access, but we don't use Supabase DB)
