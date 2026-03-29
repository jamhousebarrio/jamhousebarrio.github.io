# Build Instructions Page — Design Spec

## Overview

A public, static page with placeholder build instructions for four camp structures: Stage, Kitchen, Shade, and Shower. Read-only reference content — no auth, no API, no database.

## Page Details

- **URL**: `/build` (or `/build.html`)
- **File**: `build.html` at the project root (alongside `apply.html`, `index.md`)
- **Auth**: None — publicly accessible
- **Layout**: Uses `layout: default` with a `body_class` front-matter value (e.g. `page-build`). This renders the page inside the site's hero-compact header and footer, not as a standalone `layout: none` document.
- **Styling**: Reuses site CSS variables (`--bg`, `--surface`, `--border`, `--text`, `--accent`, `--heading`, `--body`). Page-specific styles in an inline `<style>` block. The `default` layout constrains content to `max-width: 600px` via `.container` — override this for `page-build` (e.g. `.page-build .container { max-width: 900px }`) so the build guide has room to breathe.

## Page Structure

### Sticky Jump Links
A sticky nav bar with four anchor links: Stage, Kitchen, Shade, Shower. Sits below the layout's hero-compact header and sticks to the top of the viewport when scrolled past it (`position: sticky`).

### Four Sections (scrolling, all visible)
Each section contains:
1. **Icon + Title** — emoji and structure name as heading
2. **Materials List** — bulleted list of required materials (placeholder)
3. **Steps** — numbered step-by-step instructions (placeholder)
4. **Tips / Notes** — any additional guidance (placeholder)

Sections are visually separated with borders or spacing, styled with the site's dark theme.

### Placeholder Content
Each of the four structures gets realistic-looking placeholder text:
- 4-6 placeholder material items
- 4-6 placeholder steps
- 1-2 placeholder tips

## Navigation Links

### Homepage (`index.md`)
Add a "Build Instructions" link after the existing "Apply for Membership" link in the "Join Us" section:

```markdown
**[Apply for Membership](apply)**

**[Build Instructions](build)** — how to build our camp structures
```

### Admin Sidebar (all 11 admin pages)
Add a nav item linking to `/build` in the sidebar nav on all admin pages. Since it's an external (public) page, it opens normally. Place it logically near the bottom of the nav list.

```html
<a class="nav-item" href="/build" data-access="general">
  <span class="icon">&#128296;</span>
  <span class="nav-item-text">Build Guide</span>
</a>
```

## What This Does NOT Include

- No API endpoint
- No Google Sheet tab
- No JavaScript file
- No admin authentication
- No CRUD functionality — content is hardcoded HTML

## Files Changed

| File | Change |
|------|--------|
| `build.html` (new) | Public build instructions page |
| `vercel.json` | Add rewrite `{ "source": "/build", "destination": "/build.html" }` after the `/apply` entry |
| `index.md` | Add link to build instructions |
| `admin/applications.html` | Add sidebar nav item |
| `admin/budget.html` | Add sidebar nav item |
| `admin/demographics.html` | Add sidebar nav item |
| `admin/drinks.html` | Add sidebar nav item |
| `admin/events.html` | Add sidebar nav item |
| `admin/inventory.html` | Add sidebar nav item |
| `admin/logistics.html` | Add sidebar nav item |
| `admin/meals.html` | Add sidebar nav item |
| `admin/roles.html` | Add sidebar nav item |
| `admin/shifts.html` | Add sidebar nav item |
| `admin/timeline.html` | Add sidebar nav item |
