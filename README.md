# JamHouse

**The coordination portal for JamHouse barrio at [Elsewhere](https://nobodies.team)** — Spain's burning man, held every July in the desert of Aragon. We're a music camp: open stage, jam sessions, instruments, singalongs, and harmonious chaos. Now in our 3rd year on the playa.

Live site: **[jamhouse.space](https://jamhouse.space)**

---

## What this is

This repo is the full coordination tool for JamHouse organizers and members. It handles the whole journey — from someone hearing about the camp and applying, to arriving on the playa knowing exactly what to do and when.

It's not a corporate product. It's a website built by friends, for friends, to avoid losing track of who's coming and how much we've spent on drum kits.

---

## Features

### Live now

- **Public homepage** — what JamHouse is, who it's for, and a link to apply
- **Application form** — collects everything we need to know (including how many kg you can lift hungover under the desert sun)
- **Admin: Applications** — review all applications, view full profiles, approve or reject members, edit details inline
- **Admin: Approved Members** — roster of confirmed members with demographics charts (nationality, gender, burn experience, etc.)
- **Admin: Budget** — transparent budget breakdown with charts, so everyone can see where the money goes

### Coming soon

- **Volunteering shifts** — plan and assign volunteer duties across the event
- **Member info portal** — approved members get access to arrival info, logistics, packing lists, and everything they need to survive the playa
- **Expense submission** — members can log expenses they've covered
- **Extra budget requests** — request additional funds for a project or need, visible to the core team

---

## Tech stack

| Layer | What |
|---|---|
| Frontend | Jekyll static site, vanilla JS (no frameworks) |
| Charts | Chart.js |
| Tables | AG Grid |
| Backend | Vercel serverless functions (Node.js) |
| Data | Google Sheets via `googleapis` |
| Hosting | Vercel (auto-deploys on push to `main`) |

---

## Project structure

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
  update-status.js          # POST - update application status (write auth)
  update-member.js          # POST - update member fields (write auth)
assets/
  css/admin.css             # All admin styles
  js/admin-auth.js          # Auth, session, API helpers (JH namespace)
  js/admin-charts.js        # Chart.js config & helpers
  js/admin-demographics.js  # Demographics page logic
  js/admin-applications.js  # Applications page logic
  js/admin-budget.js        # Budget page logic
```

---

## Local development

```bash
# Install Ruby dependencies and start Jekyll
bundle install
bundle exec jekyll serve

# Install Node dependencies (for API functions)
npm install
```

Jekyll serves the static site at `http://localhost:4000`. The API functions run on Vercel — for local API testing you'll need the [Vercel CLI](https://vercel.com/docs/cli) (`vercel dev`).

### Environment variables

Set these in Vercel (or a local `.env` for `vercel dev`):

| Variable | What it's for |
|---|---|
| `ADMIN_PASSWORD` | Read-only admin access |
| `ADMIN_WRITE_PASSWORD` | Write access (status updates, member edits) — also grants read |
| `SHEET_ID` | Google Sheet ID for members/applications |
| `BUDGET_SHEET_ID` | Google Sheet ID for budget data |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google service account JSON, stringified |

### Google Sheets

The app reads from two sheets:
- **Members sheet** (tab `Sheet1`): all application data + a `Status` column (column AI, index 35)
- **Budget sheet** (tab `Total`): `Category` and `Budget Allowed` columns

---

## Deployment

Vercel auto-deploys on every push to `main`. No manual steps needed. URL rewrites (e.g. `/admin` → `/admin.html`) are defined in `vercel.json`.

---

## Adding an admin page

1. Create `admin/{page}.html` with the sidebar nav (copy from an existing page)
2. Create `assets/js/admin-{page}.js` — call `JH.authenticate()` at the top
3. Add a URL rewrite in `vercel.json`
4. Add the nav link to the sidebar in all other admin pages

---

## Auth

Two password tiers, both stored in `sessionStorage`:

- **Read** (`jh_pass`): can view applications, members, budget
- **Write** (`jh_admin`): can update statuses, edit member fields — also grants read

Passwords are validated on every page load and every API call.
