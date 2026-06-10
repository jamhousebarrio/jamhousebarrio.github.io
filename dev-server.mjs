import { createRequire } from 'module';
import { readFileSync } from 'fs';
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
  app.all(`/api/${name}`, async (req, res) => {
    try {
      await mod.default(req, res);
    } catch (e) {
      console.error(`API error [${name}]:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// ── Vercel-style rewrites (read from vercel.json — single source of truth) ────
const vercelCfg = JSON.parse(readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
for (const { source, destination } of vercelCfg.rewrites || []) {
  app.get(source, (req, res) => res.sendFile(path.join(__dirname, destination)));
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(__dirname));

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
