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
- **Admin: Build Guide** — build/setup reference
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
  build.html                    # Build guide
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

---

## Deployment

Vercel auto-deploys on every push to `main`. No manual steps needed. URL rewrites (e.g. `/admin` → `/admin.html`) are defined in `vercel.json`.

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
