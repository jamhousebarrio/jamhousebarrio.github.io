# JamHouse

Admin dashboard and public site for JamHouse, a live music barrio at the Elsewhere burn event (July 7-12, 2026).

## Tech Stack
- **Frontend**: Jekyll static site, vanilla JS (no frameworks), Chart.js for charts, Flatpickr for date/time pickers, AG Grid for data tables
- **Auth**: Supabase Auth (user accounts, sessions, magic links) — no Supabase DB
- **Backend**: Vercel serverless functions (Node.js). **Hard cap: 12 functions.** Vercel Hobby plan rejects the deploy with _"No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan."_ We are currently at 12/12 (`api/*.js`), so **new backend logic must reuse an existing function** (add an `action` to the closest-fit endpoint) rather than adding a new `api/*.js` file. Adding a 13th breaks the deploy.
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
  early-entry.html              # Early-entry assignment (who arrives before the gate)
  meals.html                    # Meal planning, ingredients, shopping list, PDF export
  drinks.html                   # Drinks & snacks tracker by headcount
  events.html                   # Event calendar (July 7-12)
  roles.html                    # Roles & leads assignment
  timeline.html                 # Setup timeline grid with task drag-drop
  profile.html                  # User profile: password change, personal info
api/
  _lib/sheets.js                # Shared Google Sheets helpers (all APIs import from here)
  _lib/auth.js                  # JWT verification, member lookup, admin check
  _lib/error-log.js             # logError() — writes 500 errors to ErrorLog tab
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
  js/supabase-client.js          # Supabase client initializer (CDN)
  js/admin-auth.js              # Auth, session, shared helpers (JH namespace)
  js/admin-charts.js            # Chart.js defaults
  js/admin-applications.js      # Applications page logic
  js/admin-budget.js            # Budget page logic
  js/admin-demographics.js      # Demographics page logic
  js/admin-drinks.js            # Drinks page logic
  js/admin-events.js            # Events page logic
  js/admin-inventory.js         # Inventory page logic
  js/admin-logistics.js         # Logistics page logic
  js/admin-early-entry.js       # Early Entry page logic
  js/early-entry-logic.js       # Pure date/cap logic (unit-tested)
  js/admin-meals.js             # Meals page logic
  js/admin-roles.js             # Roles page logic
  js/admin-shifts.js            # Shifts page logic
  js/admin-timeline.js          # Timeline page logic
  js/admin-profile.js           # Profile page logic
scripts/
  upload-photos.mjs             # One-shot uploader for photos to Supabase Storage
  build-home-photos-manifest.mjs # Vercel pre-build step for homepage photo manifest
dev-server.mjs                  # Local development server
vercel.json                     # URL rewrites & framework config
```

## Environment Variables (Vercel)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Public key (used in frontend, hardcoded in `supabase-client.js`)
- `SUPABASE_SECRET_KEY` — Supabase `sb_secret_…` key (server-side only, for `/api/auth.js`)
- `SUPABASE_JWT_PUBLIC_KEY` — EC public key (JWK JSON) for verifying JWTs (ES256)
- `SHEET_ID` — Members Google Sheet ID (also used for: Inventory, MemberLogistics, Meals, MealIngredients, ShiftData, DrinksSnacks, Events, Roles, Timeline tabs)
- `BUDGET_SHEET_ID` — Budget Google Sheet ID (Budget, Total, Barrio Fee, ShoppingRequests tabs)
- `GOOGLE_SERVICE_ACCOUNT_KEY` — Google service account JSON (stringified)

## Key Patterns
- **JH namespace**: `window.JH` holds shared auth/utility functions (`esc`, `formatDate`, `formatDateLong`, `to24h`, `getHeadcount`, `getAllDates`, `initDate`, `initTime`, `isMobile`, `checkLogisticsPrompt`, `apiFetch`, `currentUser`)
- **Event date constants**: `JH.EVENT_START`, `JH.EVENT_END`, `JH.EVENT_WEEK_START`, `JH.EVENT_WEEK_END`
- **Auth flow**: Supabase session-based. `JH.authenticate()` checks Supabase session, fetches member data, sets `JH.currentUser`. `JH.apiFetch(url, body)` sends JWT in `Authorization: Bearer` header.
- **All API endpoints are POST** with `Authorization: Bearer <jwt>` header and JSON body containing `{ action?, ...payload }`
- **Action-based dispatch**: Each API handles multiple actions (e.g. `budget.js` handles `fetch`, `fetch-items`, `add`, `update`, `delete`, `shopping-request`, `approve-request`, `update-fee`)
- **Shared API helpers**: `/api/_lib/sheets.js` exports `getSheets`, `safeGet`, `toObjects`, `getRows`, `getSheetId`, `deleteRowById`, `ensureTab`, `upsertRow`, `colToLetter`
- **Auto-create tabs**: All APIs auto-create their Google Sheet tab on first insert
- **Shared auth helpers**: `/api/_lib/auth.js` exports `verifyToken`, `getMemberByEmail`, `isAdmin`, `authenticateRequest`
- **Invite/welcome email**: sent **server-side** on any status transition INTO Approved/Observer — handled in `api/members.js` (`update-status` and `update` actions), so it fires no matter which UI path set the status (inline dropdown, kanban, modal "Save All", bulk edit). Best-effort: a failed Resend/Supabase call is logged but never rolls back the status write. The shared logic lives in `/api/_lib/invite.js` (`shouldInvite`, `diffMissingInvites`, `getSupabaseAdmin`, `listUserEmails`, `sendMemberInvite`; pure parts unit-tested via `npm test`); `api/auth.js`'s manual **Invite** button and the `sync-invites` action both call the same `sendMemberInvite`. The one path it can't hook is a hand-edit to the Sheet's Status column — the admin **Sync invites** button on the Applications page (`members.js` `sync-invites`) reconciles by cross-referencing the Approved/Observer roster against Supabase users and inviting any with no account (Telegram pings suppressed for backfills). Read-only audit helper: `scripts/audit-welcome-emails.mjs`.
- **Error logging**: `/api/_lib/error-log.js` exports `logError(req, error, extra)` — called in every API's outer catch before the 500 response, writes to ErrorLog tab in Members sheet. Inner catches (tab-exists, telegram-send) are not logged.
- **Admin pages**: No Jekyll layout, fixed 220px sidebar, include Supabase CDN + `supabase-client.js` + `admin-auth.js` + `admin.css`
- **URL rewrites**: Defined in `vercel.json`
- **Date format**: dd/mm/yyyy via Flatpickr (loaded dynamically in admin-auth.js)
- **Time format**: 24h (HH:MM) via Flatpickr
- **Formula injection protection**: `register.js` strips leading `=`, `+`, `-`, `@` from user input
- **Responsive/mobile**: breakpoints in `admin.css` — ≤900px charts stack; ≤768px sidebar collapses to a 60px icon rail + overflow/table guards + inputs forced to 16px (avoids iOS zoom-on-focus); ≤480px sidebar becomes a bottom nav bar and `.main` goes full-width. Shared mobile primitives: `@media (pointer: coarse)` gives interactive controls a ≥44px hit area; `*:focus-visible` keeps a keyboard focus ring; modals become a bottom sheet at ≤480px with a CSS-only `body:has(.modal-overlay.active)` scroll-lock; `JH.isMobile` is a **dynamic getter** (re-reads width on every access) and fires a debounced `jh:breakpoint` event on flip.
- **Mobile dual-render pattern (dense table/grid pages)**: instead of horizontal scroll, pages render BOTH the desktop table (wrapped in `.hide-on-mobile`) AND a `.mobile-cards` list built from the shared `.m-card`/`.m-card-row`/`.m-card-label`/`.m-card-val` (row-as-card) and `.m-acc`/`.m-acc-head`(+`.chev`)/`.m-acc-body` (accordion, toggle `.open`) classes in `admin.css`. CSS shows exactly one per breakpoint — no JS resize re-render needed. Build both trees from the same data load and reuse the **same** action buttons/`data-` attributes so existing delegated handlers fire from either tree (see `admin-shifts.js`, `admin-logistics.js`, `admin-fee-paid.js`, `admin-timeline.js`). Page-specific mobile tweaks live in each page's own `<style>` block, not `admin.css`.

## Adding an Admin Page
1. Create `admin/{page}.html` with sidebar nav (copy from an existing page)
2. Create `assets/js/admin-{page}.js` that calls `JH.authenticate()`
3. **Do NOT add a new `api/{page}.js`** — we are at the 12/12 Vercel function cap. Add the page's backend actions to the closest-fit existing `api/*.js` (e.g. Early Entry reuses `logistics.js`).
4. Add URL rewrite in `vercel.json`
5. Add nav link to **all** existing admin pages' sidebar

## Change Enforcement Rules
- **If you add/change a Status that grants portal access** → update `PORTAL_STATUSES` and `shouldInvite` in `api/_lib/invite.js` (and `ALLOWED_STATUSES` in `api/members.js`), or the welcome-email + reconciliation logic will silently skip the new status.

## Google Sheet Tabs

### Members Sheet (SHEET_ID)
| Tab | Used by | Purpose |
|-----|---------|---------|
| Sheet1 | members.js, register.js | Application data + Status column |
| Inventory | inventory.js | Equipment & materials. Cols: ItemID, Name, Labels, Description, PhotoURL, Quantity, Location |
| MemberLogistics | logistics.js, meals.js, drinks.js, timeline.js | Arrival/departure, transport, camping |
| Meals | meals.js | Meal definitions. Cols: MealID, Name, Date (optional — blank = Unscheduled), MealType (breakfast/lunch/dinner/dessert), Servings (baseline headcount, default 30), Description, Instructions, PreCook (prep-ahead notes), PhotoURL |
| MealIngredients | meals.js | Ingredients per meal. Cols: IngredientID, MealID, Name, Quantity (TOTAL at the meal's Servings baseline — not per-person), Unit, Prep (pre-cook/on-site), KcalPerUnit (kcal per one Unit) |
| ShiftData | shifts.js | Shift assignments |
| DrinksSnacks | drinks.js | Drink/snack items |
| Events | events.js | Event planning |
| Roles | roles.js | Role assignments |
| Timeline | timeline.js | Setup schedule entries |
| EarlyEntry | logistics.js | Early-entry passes. Cols: MemberName, Source (barrio/noorg/artist), Notes, UpdatedAt, UpdatedBy |
| ErrorLog | error-log.js | 500-error log: timestamp, endpoint, action, method, status, message, stack, context |

> Inventory `Labels` is a comma-separated multi-value column (mirrors `BuildPhotos.Labels`); label values cannot contain commas. The former single `Category` column was renamed to `Labels` and the `Notes` column was folded into `Description` and dropped by the one-shot `scripts/migrate-inventory-labels.mjs` (run 2026-05-25). Pure label parse/serialize/filter logic lives in `assets/js/inventory-labels.js` (unit-tested via `npm test`). Write tiers: `upsert` (add/edit) is open to approved members; **observers are read-only**; `delete` is **admin-only** — all enforced server-side in `api/inventory.js`.

> Meals/MealIngredients write tier: editing meals & ingredients is open to **admins + members assigned to the "Kitchen lead" role** (in the Roles tab), **observers read-only** — enforced server-side in `api/meals.js` via `api/_lib/roles.js` `isAssignedToRole` (the fetch returns a `canEdit` flag the page uses to show/hide edit controls). Meal quantities are **totals at a per-meal `Servings` baseline (30)**; the page scales them by an adjustable headcount counter (defaults to approved-member count) and computes per-person portions + calories. Pure quantity/calorie math is in `assets/js/meals-logic.js` (unit-tested via `npm test`); kcal targets per meal type (B 550 / L 750 / D 1000 / dessert 250; 2300/day) live there too. The menu was loaded by the one-shot `scripts/seed-meals.mjs` (run 2026-05-31; recipe notes kept verbatim). Drinks & Snacks were intentionally left out of this pass.

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
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_secret_key
SUPABASE_JWT_PUBLIC_KEY={"kty":"EC",...}
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
