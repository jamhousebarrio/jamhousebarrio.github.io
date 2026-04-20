import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const express = require('express');
const { config } = require('dotenv');
const path = require('path');
const { fileURLToPath } = await import('url');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env and .env.supabase (Supabase vars live in the latter)
config({ path: path.join(__dirname, '.env') });
config({ path: path.join(__dirname, '.env.supabase') });

const app = express();
app.use(express.json());

// ── API routes ────────────────────────────────────────────────────────────────
const apiFiles = ['auth', 'budget', 'drinks', 'events', 'inventory', 'logistics', 'meals', 'members', 'register', 'roles', 'shifts', 'timeline'];

for (const name of apiFiles) {
  const mod = await import(`./api/${name}.js`);
  app.post(`/api/${name}`, async (req, res) => {
    try {
      await mod.default(req, res);
    } catch (e) {
      console.error(`API error [${name}]:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// ── Vercel-style rewrites ─────────────────────────────────────────────────────
const rewrites = [
  ['/admin', '/admin.html'],
  ['/admin/applications', '/admin/applications.html'],
  ['/admin/demographics', '/admin/demographics.html'],
  ['/admin/budget', '/admin/budget.html'],
  ['/admin/shifts', '/admin/shifts.html'],
  ['/admin/inventory', '/admin/inventory.html'],
  ['/admin/logistics', '/admin/logistics.html'],
  ['/admin/meals', '/admin/meals.html'],
  ['/admin/drinks', '/admin/drinks.html'],
  ['/admin/events', '/admin/events.html'],
  ['/admin/roles', '/admin/roles.html'],
  ['/admin/timeline', '/admin/timeline.html'],
  ['/admin/profile', '/admin/profile.html'],
  ['/admin/build', '/admin/build.html'],
  ['/apply', '/apply.html'],
];

for (const [source, dest] of rewrites) {
  app.get(source, (req, res) => {
    res.sendFile(path.join(__dirname, dest));
  });
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(__dirname, {
  extensions: ['html'],
}));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Local dev server running at http://localhost:${PORT}\n`);
  console.log('  Routes:');
  console.log('    /admin            → admin login');
  console.log('    /admin/budget     → budget page');
  console.log('    /admin/shifts     → shifts page');
  console.log('    /admin/inventory  → inventory page');
  console.log('    /admin/meals      → meals page');
  console.log('    /admin/logistics  → logistics page');
  console.log('    /apply            → application form');
  console.log('    /api/*            → serverless functions\n');
});
