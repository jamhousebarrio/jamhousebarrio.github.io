# JamHouse

**The coordination portal for JamHouse barrio at [Elsewhere](https://nobodies.team)** — Spain's burning man, held every July in the desert of Aragon. We're a music camp: open stage, jam sessions, instruments, singalongs, and harmonious chaos. Now in our 3rd year on the playa.

Live site: **[jamhouse.space](https://jamhouse.space)**

---

## What this is

This repo is the full coordination tool for JamHouse organizers and members. It handles the whole journey — from someone hearing about the camp and applying, to arriving on the playa knowing exactly what to do and when.

It's not a corporate product. It's a website built by friends, for friends, to avoid losing track of who's coming and how much we've spent on drum kits.

---

## Features

- **Public homepage** — what JamHouse is, who it's for, and a link to apply
- **Application form** — collects everything we need to know (including how many kg you can lift hungover under the desert sun)
- **Admin: Applications** — review all applications, approve/reject, edit details inline, invite users via Supabase
- **Admin: Approved Members** — roster with demographics charts (nationality, gender, burn experience, etc.)
- **Admin: Budget** — budget breakdown with charts, barrio fee tracking, and shopping requests
- **Admin: Shifts** — volunteer shift grid across event days
- **Admin: Inventory** — equipment & materials tracker with photos
- **Admin: Logistics** — member arrival/departure, transport, and camping info
- **Admin: Meals** — meal planning, ingredients, shopping list, and PDF export
- **Admin: Drinks & Snacks** — drinks tracker by headcount
- **Admin: Events** — event calendar for July 7-12
- **Admin: Roles & Leads** — role assignments and lead management
- **Admin: Timeline** — setup timeline grid with task drag-drop
- **Admin: Build Guide** — build/setup reference, plus a shared photo gallery backed by Supabase Storage
- **Admin: Useful Info** — communications panels, reference links, and shared docs for members
- **Admin: Profile** — password change and personal info

---

## Tech stack

| Layer | What |
|---|---|
| Frontend | Jekyll static site, vanilla JS (no frameworks) |
| Auth | Supabase Auth (user accounts, sessions, magic links) |
| Charts | Chart.js |
| Tables | AG Grid |
| Date/Time pickers | Flatpickr |
| Backend | Vercel serverless functions (Node.js) |
| Data | Google Sheets via `@googleapis/sheets` + `google-auth-library` |
| Media | Supabase Storage (homepage + site assets + build gallery photos) |
| Hosting | Vercel (auto-deploys on push to `main`) |

---

## Project structure

```
index.md                        # Public homepage
apply.html                      # Application form
admin.html                      # Login page
admin/
  applications.html             # Application review & status management
  demographics.html             # Approved member charts & roster
  budget.html                   # Budget breakdown, charts & barrio fee tracking
  shifts.html                   # Volunteer shift grid (shift types x event days)
  inventory.html                # Equipment & materials tracker with photos
  logistics.html                # Member arrival/departure, transport, camping
  meals.html                    # Meal planning, ingredients, shopping list, PDF export
  drinks.html                   # Drinks & snacks tracker by headcount
  events.html                   # Event calendar (July 7-12)
  roles.html                    # Roles & leads assignment
  timeline.html                 # Setup timeline grid with task drag-drop
  profile.html                  # User profile: password change, personal info
  build.html                    # Build guide + shared photo gallery
  info.html                     # Useful info / communications / references
_data/
  home_photos.json              # Homepage photo URLs (regenerated from Supabase)
api/
  _lib/sheets.js                # Shared Google Sheets helpers
  _lib/auth.js                  # JWT verification, member lookup, admin check
  auth.js                       # Supabase user management (invite, disable, password flag)
  budget.js                     # Budget items, barrio fees, shopping requests
  drinks.js                     # Drinks & snacks CRUD
  events.js                     # Event planning CRUD
  inventory.js                  # Inventory CRUD
  logistics.js                  # Member logistics (arrival, transport, camping)
  meals.js                      # Meals, ingredients CRUD
  members.js                    # Members fetch, update fields, update status
  register.js                   # Public application submission (no auth)
  roles.js                      # Roles & leads CRUD
  shifts.js                     # Shift types & assignments
  timeline.js                   # Setup timeline entries
assets/
  css/admin.css                 # All admin styles (sidebar, panels, dark theme)
  js/supabase-client.js         # Supabase client initializer
  js/admin-auth.js              # Auth, session, shared helpers (JH namespace)
  js/admin-charts.js            # Chart.js defaults
  js/admin-applications.js      # Applications page logic
  js/admin-budget.js            # Budget page logic
  js/admin-demographics.js      # Demographics page logic
  js/admin-drinks.js            # Drinks page logic
  js/admin-events.js            # Events page logic
  js/admin-inventory.js         # Inventory page logic
  js/admin-logistics.js         # Logistics page logic
  js/admin-meals.js             # Meals page logic
  js/admin-roles.js             # Roles page logic
  js/admin-shifts.js            # Shifts page logic
  js/admin-timeline.js          # Timeline page logic
  js/admin-profile.js           # Profile page logic
  js/admin-info.js              # Useful Info page logic
scripts/
  upload-photos.mjs             # One-shot uploader for site/build/home photos to Supabase
  build-home-photos-manifest.mjs # Vercel pre-build step: writes _data/home_photos.json
  migrate-auth.js               # One-time Supabase account migration (historical)
  fix-phone-column.js           # One-time phone-column migration (historical)
```

---

## Local development

```bash
# Install dependencies
npm install

# Create .env file with your credentials
cp .env.example .env

# Start local dev server
npm run dev
```

The dev server runs at `http://localhost:3000` and serves static files and API routes with URL rewrites matching `vercel.json`.

### Environment variables

Set these in Vercel (or a local `.env`):

| Variable | What it's for |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public key (used in frontend) |
| `SUPABASE_SECRET_KEY` | Supabase `sb_secret_…` key (server-side only, for user management) |
| `SUPABASE_JWT_PUBLIC_KEY` | EC public key (JWK JSON) for verifying JWTs |
| `SHEET_ID` | Google Sheet ID for members and all operational tabs |
| `BUDGET_SHEET_ID` | Google Sheet ID for budget data |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google service account JSON, stringified |

### Google Sheets

The app uses two Google Sheets:

**Members sheet** (`SHEET_ID`) — tabs: Sheet1 (applications/members), Inventory, MemberLogistics, Meals, MealIngredients, ShiftData, DrinksSnacks, Events, Roles, Timeline

**Budget sheet** (`BUDGET_SHEET_ID`) — tabs: Total, Budget, Barrio Fee, ShoppingRequests

### Photos (Supabase Storage)

Photos are **not** tracked in git. Three public buckets:

- `site-assets` — `hero.jpg`, `recruitment-process.jpg`
- `build-photos` — gallery photos on `admin/build`, also shown on `admin/inventory`
- `home-photos` — `who/`, `what/`, `join/` subfolders feeding the homepage clusters

To add/change photos:

```bash
# Upload local files (idempotent, upserts) — requires SUPABASE_SECRET_KEY in .env
node scripts/upload-photos.mjs

# Regenerate the homepage manifest from the live bucket
node scripts/build-home-photos-manifest.mjs
git add _data/home_photos.json && git commit -m "Home: refresh photo manifest"
```

---

## Deployment

Vercel auto-deploys on every push to `main`. The build command (set in `vercel.json`) runs `scripts/build-home-photos-manifest.mjs` before `bundle exec jekyll build`, so homepage photo clusters stay in sync with the `home-photos` bucket on every deploy (if `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are available in Vercel's build env; otherwise the committed `_data/home_photos.json` is used as-is).

URL rewrites (e.g. `/admin` → `/admin.html`) are defined in `vercel.json`.

---

## Adding an admin page

1. Create `admin/{page}.html` with sidebar nav (copy from an existing page)
2. Create `assets/js/admin-{page}.js` that calls `JH.authenticate()`
3. Create `api/{page}.js` importing helpers from `./_lib/sheets.js`
4. Add URL rewrite in `vercel.json`
5. Add nav link to **all** existing admin pages' sidebar

---

## Auth

Authentication uses Supabase Auth with JWT-based sessions:

- Users are invited via email when their application is approved
- Sessions are managed by Supabase (access tokens, refresh tokens)
- Every API call includes a `Authorization: Bearer <jwt>` header
- JWTs are verified server-side using the EC public key
- Admin vs. member access is determined by a flag in the members sheet
- New users must change their password on first login

---

## Permissions

Two roles: **admin** (has the `Admin` flag set in the members sheet) and **member** (approved, logged in, no flag). Non-authenticated visitors only see the public marketing site + the application form.

### Pages

| Page | Admins | Members |
|---|---|---|
| `/admin/applications` | ✓ | hidden from sidebar |
| `/admin/demographics` (Approved Members) | ✓ | ✓ |
| `/admin/budget` | ✓ | ✓ (see below) |
| `/admin/shifts` | ✓ | ✓ |
| `/admin/inventory` | ✓ | ✓ |
| `/admin/logistics` | ✓ | ✓ |
| `/admin/meals` | ✓ | ✓ |
| `/admin/drinks` | ✓ | ✓ |
| `/admin/events` | ✓ | ✓ |
| `/admin/roles` | ✓ | ✓ |
| `/admin/timeline` | ✓ | ✓ |
| `/admin/build` | ✓ | ✓ |
| `/admin/info` (Useful Info) | ✓ | ✓ |
| `/admin/profile` | ✓ | ✓ |

### Data and actions within shared pages

- **Budget**: members see category totals, budget items, and shopping requests. Per-member fee contributions (who paid how much) and the total collected are **admin-only**. Members can submit shopping requests; only admins can approve/reject them.
- **Inventory**: item CRUD (add / edit / delete) is **admin-only**. The build photo gallery is open to all — any member can upload; edit labels and delete are restricted to the uploader or an admin.
- **Shifts**: members can sign up and cancel their own shifts. Creating/editing shift types, assigning others, overriding a full slot, and all leaderboard admin actions are **admin-only**.
- **Members**: everyone can read the roster. Updating a member record requires admin, *except* the `Profile` page, where each member can update their own personal info and password. The `Admin` flag itself can only be set by an admin.
- **Meals / Drinks / Events / Roles / Timeline / Logistics**: reads are open to all members; writes are **admin-only** (except member-self logistics entries).
- **Applications / Invites / Account management** (`/api/auth`, `/api/register`): the application form is public. All admin actions (invite, disable, password-reset, list users) are **admin-only**.

Enforcement happens in two places:
1. **Server-side** — every `/api/*.js` endpoint verifies the caller's JWT and checks `auth.admin` before any write action. Client-side hiding is cosmetic only; the server is the source of truth.
2. **Sidebar** — `admin-auth.js` hides nav items marked `access: 'admin'` for non-admins. Admin-gated UI controls inside shared pages check `JH.isAdmin()` before rendering.
