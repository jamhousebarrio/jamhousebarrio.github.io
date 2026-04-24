#!/usr/bin/env node
// One-shot: upload local /images and /assets/images content to Supabase Storage.
// Run: node scripts/upload-photos.mjs
//
// Requires in .env (or .env.supabase):
//   SUPABASE_URL
//   SUPABASE_SECRET_KEY

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

config({ path: path.join(repoRoot, '.env') });
config({ path: path.join(repoRoot, '.env.supabase') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// bucket → [{ localPath, objectPath }]
const jobs = {
  'site-assets': [
    { localPath: 'images/hero.jpg', objectPath: 'hero.jpg' },
    { localPath: 'images/recruitment-process.jpg', objectPath: 'recruitment-process.jpg' },
  ],
  'build-photos': Array.from({ length: 26 }, (_, i) => ({
    localPath: `assets/images/build-2025/build-${i + 1}.jpg`,
    objectPath: `build-${i + 1}.jpg`,
  })),
  'home-photos': [
    ...['who_we_are_1.jpg', 'who_we_are_2.jpg'].map(f => ({
      localPath: `assets/images/home/who/${f}`, objectPath: `who/${f}`,
    })),
    ...['what_happens_here_1.jpg', 'what_happens_here_2.jpg'].map(f => ({
      localPath: `assets/images/home/what/${f}`, objectPath: `what/${f}`,
    })),
    ...['join_us_1.jpg', 'join_us_2.jpg', 'join_us_3.jpg', 'join_us_4.jpg'].map(f => ({
      localPath: `assets/images/home/join/${f}`, objectPath: `join/${f}`,
    })),
  ],
};

async function ensureBucket(name) {
  const { data: existing } = await supabase.storage.getBucket(name);
  if (existing) return;
  const { error } = await supabase.storage.createBucket(name, { public: true });
  if (error) throw new Error(`Create bucket ${name}: ${error.message}`);
  console.log(`  [+] bucket ${name} created (public)`);
}

async function uploadOne(bucket, job) {
  const abs = path.join(repoRoot, job.localPath);
  const body = await fs.readFile(abs);
  const { error } = await supabase.storage.from(bucket).upload(job.objectPath, body, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(`${bucket}/${job.objectPath}: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(job.objectPath);
  return data.publicUrl;
}

(async () => {
  console.log(`Uploading to ${SUPABASE_URL}\n`);
  for (const [bucket, items] of Object.entries(jobs)) {
    console.log(`▸ ${bucket} (${items.length} files)`);
    await ensureBucket(bucket);
    for (const job of items) {
      try {
        const url = await uploadOne(bucket, job);
        console.log(`  ✓ ${job.localPath}  →  ${url}`);
      } catch (e) {
        console.error(`  ✗ ${job.localPath}: ${e.message}`);
        process.exitCode = 1;
      }
    }
    console.log('');
  }
  console.log('Done.');
})();
