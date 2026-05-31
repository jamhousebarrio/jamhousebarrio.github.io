#!/usr/bin/env node
// One-shot: replace dead source.unsplash.com PhotoURLs in the Meals tab with
// verified stable Wikimedia Commons Special:FilePath URLs. Keyed by MealID.
// Run once (2026-05-31). Safe to re-run: it overwrites the listed rows only.
//   node scripts/fix-meal-photos.mjs
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });

// MealID -> verified-working image URL (all confirmed HTTP 200 + image/jpeg).
const PHOTOS = {
  'smoky-shakshuka': 'https://commons.wikimedia.org/wiki/Special:FilePath/Shakshuka_eggs_for_breakfast.jpg',
  'dal-mango': 'https://commons.wikimedia.org/wiki/Special:FilePath/Dal_curry_with_naan_and_rice_%284505655232%29.jpg',
  'pita-night': 'https://commons.wikimedia.org/wiki/Special:FilePath/20240815_Falafel_Plate_Restaurant_The_Hummusapiens_Berlin_anagoria.jpg',
  'couscous': 'https://commons.wikimedia.org/wiki/Special:FilePath/Restaurant_Bahia%2C_tagine%2C_couscous.jpg',
  'big-pot-pasta': 'https://commons.wikimedia.org/wiki/Special:FilePath/Farfalle_Pasta.JPG',
  'pizza-night': 'https://commons.wikimedia.org/wiki/Special:FilePath/Margherita_pizza_on_plate.jpg',
  'chef-gautier-s-burger': 'https://commons.wikimedia.org/wiki/Special:FilePath/Cheeseburger.jpg',
  'quinoa-salad': 'https://commons.wikimedia.org/wiki/Special:FilePath/Healthy_quinoa_salad_with_dried_fruit.jpg',
  'dessert': 'https://commons.wikimedia.org/wiki/Special:FilePath/Fruit_Platter-_Seasonal_Fruits.jpg',
  'breakfast': 'https://commons.wikimedia.org/wiki/Special:FilePath/Full_English_breakfast_on_a_plate.jpg',
};

const colToLetter = (i) => {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = sheetsApi({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Meals' });
const rows = res.data.values || [];
if (!rows.length) throw new Error('Meals tab is empty');

const header = rows[0];
const idCol = header.indexOf('MealID');
const photoCol = header.indexOf('PhotoURL');
if (idCol === -1) throw new Error('No MealID column');
if (photoCol === -1) throw new Error('No PhotoURL column');
const photoLetter = colToLetter(photoCol);

let updated = 0;
for (let i = 1; i < rows.length; i++) {
  const id = rows[i][idCol];
  if (!Object.prototype.hasOwnProperty.call(PHOTOS, id)) continue;
  const rowNum = i + 1; // 1-based sheet row
  const range = `Meals!${photoLetter}${rowNum}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[PHOTOS[id]]] },
  });
  console.log(`updated ${id} (${range}) -> ${PHOTOS[id]}`);
  updated++;
}
console.log(`\nDone. Updated ${updated}/${Object.keys(PHOTOS).length} meal rows.`);
const missing = Object.keys(PHOTOS).filter((id) => !rows.some((r) => r[idCol] === id));
if (missing.length) console.warn(`WARNING: these mealIds were not found in the sheet: ${missing.join(', ')}`);
