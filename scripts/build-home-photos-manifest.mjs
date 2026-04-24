#!/usr/bin/env node
// Runs during Vercel build (before Jekyll). Lists the home-photos bucket on
// Supabase and writes _data/home_photos.json so Jekyll can render the clusters.
//
// Safe to run locally too; without Supabase env vars it writes an empty stub.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outPath = path.join(repoRoot, '_data', 'home_photos.json');

// Load .env files for local runs. On Vercel, env vars are already injected
// and these files don't exist, so the import is wrapped in try/catch.
try {
  const { config } = await import('dotenv');
  config({ path: path.join(repoRoot, '.env') });
  config({ path: path.join(repoRoot, '.env.supabase') });
} catch { /* dotenv not available in prod install; that's fine */ }

const BUCKET = 'home-photos';
const BEATS = ['who', 'what', 'join'];

async function writeManifest(data) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(data, null, 2) + '\n');
}

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    console.warn('[home-photos] No Supabase env — leaving existing manifest in place.');
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const manifest = {};
  for (const beat of BEATS) {
    const { data, error } = await supabase.storage.from(BUCKET).list(beat, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      console.error(`[home-photos] list ${beat}: ${error.message}`);
      manifest[beat] = [];
      continue;
    }
    manifest[beat] = (data || [])
      .filter(f => f.name && !f.name.startsWith('.'))
      .map(f => supabase.storage.from(BUCKET).getPublicUrl(`${beat}/${f.name}`).data.publicUrl);
    console.log(`[home-photos] ${beat}: ${manifest[beat].length} photos`);
  }

  await writeManifest(manifest);
  console.log(`[home-photos] wrote ${outPath}`);
})().catch(e => {
  console.error('[home-photos] fatal:', e);
  process.exit(1);
});
