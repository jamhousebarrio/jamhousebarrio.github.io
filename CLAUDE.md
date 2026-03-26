# Jamhouse

Admin dashboard and public site for JamHouse, a live music barrio at the Elsewhere burn event.

## Tech Stack
- **Frontend**: Jekyll static site, vanilla JS (no frameworks), Chart.js for charts
- **Backend**: Vercel serverless functions (Node.js)
- **Data**: Google Sheets via googleapis
- **Deployment**: Vercel (auto-deploys, Jekyll build)

## Project Structure
```
index.md                    # Public homepage
apply.html                  # Application form
admin.html                  # Login page
admin/
  applications.html         # Application review & status management
  demographics.html         # Approved member charts & roster
  budget.html               # Budget breakdown & charts
api/
  members.js                # POST - fetch members (read or write auth)
  budget.js                 # POST - fetch budget data (read auth)
  register.js               # POST - save new application (no auth)
  update-status.js          # POST - update status (write auth only)
assets/
  css/admin.css             # All admin styles
  js/admin-auth.js          # Auth, session, API helpers (JH namespace)
  js/admin-charts.js        # Chart.js config & helpers
  js/admin-demographics.js  # Demographics page logic
  js/admin-applications.js  # Applications page logic
  js/admin-budget.js        # Budget page logic
```

## Environment Variables (Vercel)
- `ADMIN_PASSWORD` — read-only admin access
- `ADMIN_WRITE_PASSWORD` — write access for status updates, also grants read access
- `SHEET_ID` — Members Google Sheet ID
- `BUDGET_SHEET_ID` — Budget Google Sheet ID
- `GOOGLE_SERVICE_ACCOUNT_KEY` — Google service account JSON (stringified)

## Key Patterns
- **JH namespace**: `window.JH` holds shared auth/chart/utility functions
- **Auth flow**: Password stored in `sessionStorage` (`jh_pass`, `jh_admin`), validated on each page load
- **All API endpoints are POST** with JSON body
- **Admin pages**: No Jekyll layout, fixed 220px sidebar, include `admin-auth.js` + `admin.css`
- **URL rewrites**: Defined in `vercel.json` (e.g. `/admin` → `/admin.html`)

## Adding an Admin Page
1. Create `admin/{page}.html` with sidebar nav
2. Create `assets/js/admin-{page}.js` that calls `JH.authenticate()`
3. Add URL rewrite in `vercel.json`

## Google Sheets
- **Members sheet** (SHEET_ID, tab "Sheet1"): All application data + Status column (column AI, index 35)
- **Budget sheet** (BUDGET_SHEET_ID, tab "Total"): Category + Budget Allowed columns

## Local Development
```bash
bundle install && bundle exec jekyll serve   # Jekyll dev server
npm install                                   # Install googleapis
```

## CSS Variables
```css
--bg: #0a0a0a        --surface: #141414
--accent: #e8a84c    --heading: Space Grotesk
--body: Inter
```
