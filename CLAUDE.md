# JamHouse

Admin dashboard and public site for JamHouse, a live music barrio at the Elsewhere burn event (July 7-12, 2026).

## Tech Stack
- **Frontend**: Jekyll static site, vanilla JS (no frameworks), Chart.js for charts, Flatpickr for date/time pickers, AG Grid for data tables
- **Backend**: Vercel serverless functions (Node.js, 11 of 12 max)
- **Data**: Google Sheets via `@googleapis/sheets` + `google-auth-library`
- **Deployment**: Vercel (auto-deploys from GitHub, Jekyll build)

## Project Structure
```
index.md                        # Public homepage
apply.html                      # Application form
admin.html                      # Login page
admin/
  applications.html             # Application review & status management
  demographics.html             # Approved member charts & roster
  budget.html                   # Budget breakdown, charts & barrio fee tracking
  shifts.html                   # Volunteer shift grid (shift types × event days)
  inventory.html                # Equipment & materials tracker with photos
  logistics.html                # Member arrival/departure, transport, camping
  meals.html                    # Meal planning, ingredients, shopping list, PDF export
  drinks.html                   # Drinks & snacks tracker by headcount
  events.html                   # Event calendar (July 7-12)
  roles.html                    # Roles & leads assignment
  timeline.html                 # Setup timeline grid with task drag-drop
api/
  _lib/sheets.js                # Shared Google Sheets helpers (all APIs import from here)
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
dev-server.mjs                  # Local development server
vercel.json                     # URL rewrites & framework config
```

## Environment Variables (Vercel)
- `ADMIN_PASSWORD` — read-only admin access
- `ADMIN_WRITE_PASSWORD` — write access (also grants read)
- `SHEET_ID` — Members Google Sheet ID (also used for: Inventory, MemberLogistics, Meals, MealIngredients, ShiftData, DrinksSnacks, Events, Roles, Timeline tabs)
- `BUDGET_SHEET_ID` — Budget Google Sheet ID (Budget, Total, Barrio Fee, ShoppingRequests tabs)
- `GOOGLE_SERVICE_ACCOUNT_KEY` — Google service account JSON (stringified)

## Key Patterns
- **JH namespace**: `window.JH` holds shared auth/utility functions (`esc`, `formatDate`, `formatDateLong`, `to24h`, `getHeadcount`, `getAllDates`, `initDate`, `initTime`, `isMobile`, `checkLogisticsPrompt`)
- **Event date constants**: `JH.EVENT_START`, `JH.EVENT_END`, `JH.EVENT_WEEK_START`, `JH.EVENT_WEEK_END`
- **Auth flow**: Password stored in `sessionStorage` (`jh_pass`, `jh_admin`), validated on each page load via `JH.authenticate()`
- **All API endpoints are POST** with JSON body containing `{ password, action?, ...payload }`
- **Action-based dispatch**: Each API handles multiple actions (e.g. `budget.js` handles `fetch`, `fetch-items`, `add`, `update`, `delete`, `shopping-request`, `approve-request`, `update-fee`)
- **Shared API helpers**: `/api/_lib/sheets.js` exports `getSheets`, `safeGet`, `toObjects`, `getRows`, `getSheetId`, `deleteRowById`, `ensureTab`, `upsertRow`, `colToLetter`
- **Auto-create tabs**: All APIs auto-create their Google Sheet tab on first insert
- **Admin pages**: No Jekyll layout, fixed 220px sidebar, include `admin-auth.js` + `admin.css`
- **URL rewrites**: Defined in `vercel.json`
- **Date format**: dd/mm/yyyy via Flatpickr (loaded dynamically in admin-auth.js)
- **Time format**: 24h (HH:MM) via Flatpickr
- **Formula injection protection**: `register.js` strips leading `=`, `+`, `-`, `@` from user input

## Adding an Admin Page
1. Create `admin/{page}.html` with sidebar nav (copy from an existing page)
2. Create `assets/js/admin-{page}.js` that calls `JH.authenticate()`
3. Create `api/{page}.js` importing helpers from `./_lib/sheets.js`
4. Add URL rewrite in `vercel.json`
5. Add nav link to **all** existing admin pages' sidebar

## Google Sheet Tabs

### Members Sheet (SHEET_ID)
| Tab | Used by | Purpose |
|-----|---------|---------|
| Sheet1 | members.js, register.js | Application data + Status column |
| Inventory | inventory.js | Equipment & materials |
| MemberLogistics | logistics.js, meals.js, drinks.js, timeline.js | Arrival/departure, transport, camping |
| Meals | meals.js | Meal definitions |
| MealIngredients | meals.js | Ingredients per meal |
| ShiftData | shifts.js | Shift assignments |
| DrinksSnacks | drinks.js | Drink/snack items |
| Events | events.js | Event planning |
| Roles | roles.js | Role assignments |
| Timeline | timeline.js | Setup schedule entries |

### Budget Sheet (BUDGET_SHEET_ID)
| Tab | Used by | Purpose |
|-----|---------|---------|
| Total | budget.js (fetch) | Budget totals by category |
| Budget | budget.js (fetch-items, add, update, delete) | Individual budget line items |
| Barrio Fee | budget.js (fetch-items, update-fee) | Member fee payments |
| ShoppingRequests | budget.js (shopping-request, approve/reject) | Purchase requests |

## Local Development

### Prerequisites
- Node.js 18+
- npm

### Setup
```bash
# Install dependencies
npm install

# Create .env file with your credentials
cat > .env << 'EOF'
ADMIN_PASSWORD=your_read_password
ADMIN_WRITE_PASSWORD=your_write_password
SHEET_ID=your_members_sheet_id
BUDGET_SHEET_ID=your_budget_sheet_id
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
EOF

# Start local dev server
npm run dev
```

The dev server runs at `http://localhost:3000` and serves:
- Static HTML/CSS/JS files directly (no Jekyll build needed)
- API routes at `/api/*` using the serverless functions
- URL rewrites matching `vercel.json`

### Deploying to Vercel
The site auto-deploys when pushing to `main`. Vercel builds Jekyll, bundles the serverless functions, and serves everything.

To link for CLI operations:
```bash
vercel link --yes
vercel env pull .env  # Pull production env vars (if not sensitive)
```

## CSS Variables
```css
--bg: #0a0a0a        --surface: #141414     --surface2: #1a1a1a
--border: #2a2a2a    --text: #e8e4df        --text-muted: #8a8580
--accent: #e8a84c    --heading: 'Space Grotesk'  --body: 'Inter'
--sidebar-w: 220px
```
