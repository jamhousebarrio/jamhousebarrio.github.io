#!/usr/bin/env node
// One-shot seed: writes camp menu into Meals and MealIngredients Google Sheet tabs.
//
// Usage:
//   node scripts/seed-meals.mjs          → DRY-RUN: prints what would be written, touches nothing
//   node scripts/seed-meals.mjs --apply  → clears both tabs and writes all data
//
// Load-bearing: camp menu is the source of truth for meal planning, kcal, shopping list.
// Reviewable: edit MENU below before --apply if anything needs adjusting.

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a display name into a URL-safe slug. */
function slug(str) {
  return str
    .toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[éèê]/g, 'e').replace(/[îï]/g, 'i')
    .replace(/[ôö]/g, 'o').replace(/[ùúû]/g, 'u').replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// MENU — full camp menu. Edit quantities / kcal / descriptions before --apply.
//
// Prep rules applied throughout:
//   pre-cook  → proteins (merguez, chicken, tofu, meatballs, falafel, seitan,
//                sausages, minced beef, bacon, ham, patties) + spice mixes
//   on-site   → veg, pasta, rice, bread, dairy, sauces, assembly items
// ---------------------------------------------------------------------------
const MENU = [
  // =========================================================================
  // SMOKY SHAKSHUKA  (dinner)
  // =========================================================================
  {
    name: 'Smoky Shakshuka',
    mealType: 'dinner',
    servings: 30,
    description: 'Smoky tomato-pepper stew with eggs, merguez, and brown lentils. Served with flatbread.',
    preCook: '',
    photoURL: 'https://source.unsplash.com/640x360/?shakshuka,eggs,tomato',
    ingredients: [
      { name: 'Tomatoes',                   quantity: 4,    unit: 'kg',     prep: 'on-site',  kcal: 180  },
      { name: 'Bell peppers',               quantity: 2.5,  unit: 'kg',     prep: 'on-site',  kcal: 260  },
      { name: 'Onions',                     quantity: 2,    unit: 'kg',     prep: 'on-site',  kcal: 400  },
      { name: 'Garlic',                     quantity: 200,  unit: 'g',      prep: 'on-site',  kcal: 1490 },
      { name: 'Crushed tomatoes',           quantity: 5,    unit: 'kg',     prep: 'on-site',  kcal: 160  },
      { name: 'Eggs',                       quantity: 30,   unit: 'pieces', prep: 'on-site',  kcal: 78   },
      { name: 'Paprika',                    quantity: 80,   unit: 'g',      prep: 'on-site',  kcal: 2820 },
      { name: 'Cilantro',                   quantity: 200,  unit: 'g',      prep: 'on-site',  kcal: 230  },
      { name: 'Parsley',                    quantity: 200,  unit: 'g',      prep: 'on-site',  kcal: 360  },
      { name: 'Flatbread (dürüm-style)',    quantity: 60,   unit: 'pieces', prep: 'on-site',  kcal: 275  },
      { name: 'Merguez sausages',           quantity: 4.5,  unit: 'kg',     prep: 'pre-cook', kcal: 3000 },
      { name: 'Liquid smoke',               quantity: 100,  unit: 'ml',     prep: 'on-site',  kcal: 20   },
      { name: 'Olive oil',                  quantity: 500,  unit: 'ml',     prep: 'on-site',  kcal: 8800 },
      { name: 'Brown lentils',              quantity: 2,    unit: 'kg',     prep: 'on-site',  kcal: 3530 },
    ],
  },

  // =========================================================================
  // DAL & MANGO  (dinner)
  // =========================================================================
  {
    name: 'Dal & Mango',
    mealType: 'dinner',
    servings: 30,
    description: 'Yellow lentil dal with basmati rice, mango chutney, marinated chicken and smoked tofu.',
    preCook: `Marinated chicken (for 20 peoples). Be careful, plot twist at the end...

Okay lads this is for the dhal (a traditional vegetarian indian dish. Yes I say vegetarian but you muscle guys needs some protein for your tiny penis so, we need meet)

now, easy (even for you).

· 5kg chicken breast
· olive oil
· lemon juice
· a fkn lot of fkijnf fuck of fresh turmenic, garlic and gingember. It has to cover your entire desires.
· Salt (don't put the actual movie featuring Angelina Jolie, pls, don't be that naive).

Cut the chicken in tiny pieces (aiguillettes size, is this a word in english ? Finger size ? Ah, les anglais et leur propension à faciliter l'utilisation de notre belle langue…)
Marinate overnight in an overfridge. All the pieces has to be covered
Then, it looks □ and squishy and but it's nice. Trust the boss.

NOW PUT THIS IN AN HORNY OVEN FOR… LET'S SAY IDK 7 MIN 180° AND DON'T TRY CAUSE IT'S NOT COOKED YOU MORON !
NOW REFLESH BELOW -18°C MOTHERFUCKER ! (I should be an insulting freezer)`,
    photoURL: 'https://source.unsplash.com/640x360/?dal,lentils,mango',
    ingredients: [
      { name: 'Yellow lentils',        quantity: 3.5,  unit: 'kg',  prep: 'on-site',  kcal: 3500 },
      { name: 'Basmati rice',          quantity: 4,    unit: 'kg',  prep: 'on-site',  kcal: 3600 },
      { name: 'Cilantro',              quantity: 200,  unit: 'g',   prep: 'on-site',  kcal: 230  },
      { name: 'Red curry paste',       quantity: 500,  unit: 'g',   prep: 'on-site',  kcal: 1600 },
      { name: 'Mango chutney',         quantity: 1,    unit: 'kg',  prep: 'on-site',  kcal: 2500 },
      { name: 'Liquid smoke',          quantity: 80,   unit: 'ml',  prep: 'on-site',  kcal: 20   },
      { name: 'Sliced chicken breast', quantity: 4.5,  unit: 'kg',  prep: 'pre-cook', kcal: 1650 },
      { name: 'Smoked tofu',           quantity: 3,    unit: 'kg',  prep: 'pre-cook', kcal: 1440 },
      { name: 'Olive oil',             quantity: 400,  unit: 'ml',  prep: 'on-site',  kcal: 8800 },
    ],
  },

  // =========================================================================
  // PITA NIGHT  (dinner)
  // =========================================================================
  {
    name: 'Pita Night',
    mealType: 'dinner',
    servings: 30,
    description: 'Pita wraps with falafel, spiced meatballs, tzatziki, tahini, fresh veg and toppings.',
    preCook: `I calculated the proportions with the actual results of who eating what. 1/3 is vegetarian. So, let's say 10 out of 30.

Precooking :

Falafels (for 10 peoples) :
· Chickpeas 1kg (12h to 24h in the water before pls)
· mint / coriander / parsley : 1 bunch each
· spices (2 tea spoon each) : paprika, cumin, coriander ground, curcuma, pepper (or whatever you've got in your kitchen idk). Important : 2 tsp of baking powder
· 2 onions chopped small
· a lot of chopped garlic (as much as you can handle)

NOW LET'S MIX ALL THIS SHIT TOGETHER

Then, you have this sort of weird mix in your bowl. Take your hands and roll some some balls shapes. You need around 50 falafels (5 per person if you can). If you're struggling making perfect testicles shaped falafels, add some flour and a tiny bit of water. It will glue.

NOW LET'S FRY ALL THIS SHIT IN DIRTY VEGETABLE OIL

5 min is enough. Have a bite and enjoy, not much.

NOW FREEZE ! (not you, the vegetarian testicles).

Meatballs (for 20 peoples)

· 3kg mince beef
· 4 chopped onions
· a lot of chopped garlic (as much as you can handle)
· 4 eggs
· a lot of chili flakes. Let's make diahrrea great again.
· Parsley chopped
· salt

Now you should be able to make nice little brains (same shape as the falafels)

NOW PUT THIS IN AN HORNY OVEN FOR… LET'S SAY IDK 12 MIN 200° AND TRY.

IF IT'S GOOD, LET IT REFRESH AND FREEZE MOTHERFUCKER ! (I should be a cop)

If it's not good, you can pay me a direct flight from Bolivia, I come, I slap all your asses, I show you how to do it, then I eat, then you do it again.`,
    photoURL: 'https://source.unsplash.com/640x360/?pita,falafel,wrap',
    ingredients: [
      { name: 'Pita bread',              quantity: 30,   unit: 'pieces', prep: 'on-site',  kcal: 275  },
      { name: 'Tahini sauce',            quantity: 1.5,  unit: 'kg',     prep: 'on-site',  kcal: 5950 },
      { name: 'Plain yogurt',            quantity: 2,    unit: 'kg',     prep: 'on-site',  kcal: 610  },
      { name: 'Dill',                    quantity: 150,  unit: 'g',      prep: 'on-site',  kcal: 430  },
      { name: 'Red onions',              quantity: 1.5,  unit: 'kg',     prep: 'on-site',  kcal: 400  },
      { name: 'Tomatoes',               quantity: 2.5,  unit: 'kg',     prep: 'on-site',  kcal: 180  },
      { name: 'Cucumbers',              quantity: 2,    unit: 'kg',     prep: 'on-site',  kcal: 150  },
      { name: 'Falafel (≈150 pcs)',     quantity: 4.5,  unit: 'kg',     prep: 'pre-cook', kcal: 3300 },
      { name: 'Spiced meatballs',       quantity: 4,    unit: 'kg',     prep: 'pre-cook', kcal: 2500 },
      { name: 'Paprika',                quantity: 50,   unit: 'g',      prep: 'on-site',  kcal: 2820 },
      { name: 'Cumin',                  quantity: 50,   unit: 'g',      prep: 'on-site',  kcal: 3750 },
      { name: 'Bell peppers',           quantity: 2,    unit: 'kg',     prep: 'on-site',  kcal: 260  },
    ],
  },

  // =========================================================================
  // COUSCOUS  (dinner)
  // =========================================================================
  {
    name: 'Couscous',
    mealType: 'dinner',
    servings: 30,
    description: 'North-African couscous with marinated chicken, chickpeas, dried apricots, harissa and preserved lemons.',
    preCook: `plot twist at the end !!!!!!

I need the same recipe for the couscous but let's make it differently. So it's not the same recipe.

· 5kg chicken breast
· olive oil
· lemon juice
· a fkn lot of fkijnf fuck of cinnamon (actually, less than the other spices), raz el hanout, anis star, cardamome, cloves, everything that can be an arabic cliché spice plizzz.
· Salt. Wait, you did put the actual movie featuring Angelina Jolie for the other recipe ? You really don't know how to follow a recipe ??? Ok I punch you in wifi.
· Punch in your face
· Salt from your tears

AND PUT THIS DVD DOWN ! (I should be a cop for illegal downloading).

NOW CONTINUE THE SAME WAY YOU DID FOR THE OTHER MARINATED CHICKED AND PUT IT IN THE CORPSE BOX.`,
    photoURL: 'https://source.unsplash.com/640x360/?couscous,moroccan,chicken',
    ingredients: [
      { name: 'Couscous',               quantity: 4,    unit: 'kg',  prep: 'on-site',  kcal: 3760 },
      { name: 'Dried apricots',         quantity: 1.5,  unit: 'kg',  prep: 'on-site',  kcal: 2410 },
      { name: 'Chickpeas cooked',       quantity: 3,    unit: 'kg',  prep: 'on-site',  kcal: 1640 },
      { name: 'Cinnamon',               quantity: 50,   unit: 'g',   prep: 'on-site',  kcal: 2470 },
      { name: 'Marinated chicken',      quantity: 5,    unit: 'kg',  prep: 'pre-cook', kcal: 1650 },
      { name: 'Harissa sauce',          quantity: 700,  unit: 'g',   prep: 'on-site',  kcal: 900  },
      { name: 'Toasted sliced almonds', quantity: 1,    unit: 'kg',  prep: 'on-site',  kcal: 5760 },
      { name: 'Preserved lemons',       quantity: 1,    unit: 'kg',  prep: 'on-site',  kcal: 300  },
      { name: 'Green olives',           quantity: 1.5,  unit: 'kg',  prep: 'on-site',  kcal: 1450 },
      { name: 'Garlic',                 quantity: 150,  unit: 'g',   prep: 'on-site',  kcal: 1490 },
      { name: 'Turmeric',               quantity: 50,   unit: 'g',   prep: 'on-site',  kcal: 3540 },
      { name: 'Olive oil',              quantity: 500,  unit: 'ml',  prep: 'on-site',  kcal: 8800 },
    ],
  },

  // =========================================================================
  // BIG POT PASTA  (dinner)
  // =========================================================================
  {
    name: 'Big Pot Pasta',
    mealType: 'dinner',
    servings: 30,
    description: 'Farfalle pasta with avocado, Comté, herb sausages and seitan.',
    preCook: '',
    photoURL: 'https://source.unsplash.com/640x360/?pasta,farfalle,avocado',
    ingredients: [
      { name: 'Farfalle pasta',              quantity: 5,   unit: 'kg',  prep: 'on-site',  kcal: 3560 },
      { name: 'Avocados',                    quantity: 3,   unit: 'kg',  prep: 'on-site',  kcal: 1600 },
      { name: 'Comté cheese',                quantity: 2,   unit: 'kg',  prep: 'on-site',  kcal: 4120 },
      { name: 'Olive oil',                   quantity: 500, unit: 'ml',  prep: 'on-site',  kcal: 8800 },
      { name: 'Sausages (herbs/normal/spicy)', quantity: 4, unit: 'kg',  prep: 'pre-cook', kcal: 2900 },
      { name: 'Seitan',                      quantity: 3,   unit: 'kg',  prep: 'pre-cook', kcal: 1700 },
    ],
  },

  // =========================================================================
  // PIZZA NIGHT  (dinner)
  // =========================================================================
  {
    name: 'Pizza Night',
    mealType: 'dinner',
    servings: 30,
    description: 'Three pizza variants: vegan, meatlovers, and 4-formaggi. 60 large (or 120 small) dough balls.',
    preCook: `Vegan Pizza

· 800 g mushrooms
Cook them until the get the size of a bacteria. We need to dry them. But it needs to get some gusto so put some SALT and provencal herbs and olive oil.

· 3 red onions

Chop me this and frying pan them and olive oil it

· 3 eggplants
Cut in small dices, put in an olive oil bath (yes, it's the superstar here) and in the HORNY HORNO OH YEAH BABY OVEN LIKE 220°C FOR 20-25min. AND PLEASE, IF IF IT'S NOT WORKING, YOU CAN MAKE A COMPLAIN AT CHATGPT.COM

NOW PUT ALL THOSE NICE SUPERPOWER VEGGIES TOGETHER IN ONE PLASTIC BAG OF 236.947x17478392,59.999wm and FREEEEEEEEEZE !!!!!!!!!

Meatlovers Pizza

· 1,5kg minced beef
Put the mince in a frying pan with some spices whatever you want I've been writing this whole succesful and funny piece since two hours
· Any tears left with this horrible cooking night ? Use them to put some salt.

Now cook the meat until it has the texture of a shoe AND FRIZE IT NICELY SENORITA.`,
    photoURL: 'https://source.unsplash.com/640x360/?pizza,homemade',
    ingredients: [
      // Base
      { name: 'Pizza dough (60 large / 120 small)', quantity: 60,   unit: 'pieces', prep: 'on-site',  kcal: 200  },
      { name: 'Chili oil',                          quantity: 1,    unit: 'L',      prep: 'on-site',  kcal: 8800 },
      // Vegan toppings
      { name: 'Vegan – vegan cheese',               quantity: 1.2,  unit: 'kg',     prep: 'on-site',  kcal: 2500 },
      { name: 'Vegan – mushrooms',                  quantity: 800,  unit: 'g',      prep: 'pre-cook', kcal: 220  },
      { name: 'Vegan – red onions',                 quantity: 3,    unit: 'pieces', prep: 'pre-cook', kcal: 40   },
      { name: 'Vegan – green olives',               quantity: 400,  unit: 'g',      prep: 'on-site',  kcal: 1450 },
      { name: 'Vegan – eggplants',                  quantity: 3,    unit: 'pieces', prep: 'pre-cook', kcal: 350  },
      { name: 'Vegan – tomato sauce',               quantity: 1.2,  unit: 'L',      prep: 'on-site',  kcal: 350  },
      // Meatlovers toppings
      { name: 'Meatlovers – chorizo',               quantity: 1.2,  unit: 'kg',     prep: 'pre-cook', kcal: 4550 },
      { name: 'Meatlovers – marinated pepper cans', quantity: 4,    unit: 'pieces', prep: 'on-site',  kcal: 120  },
      { name: 'Meatlovers – minced beef',           quantity: 1.5,  unit: 'kg',     prep: 'pre-cook', kcal: 2500 },
      { name: 'Meatlovers – tomato sauce',          quantity: 1.2,  unit: 'L',      prep: 'on-site',  kcal: 350  },
      { name: 'Meatlovers – oregano',               quantity: 3,    unit: 'tbsp',   prep: 'on-site',  kcal: 265  },
      // 4 formaggi
      { name: '4 formaggi – sour cream',            quantity: 600,  unit: 'g',      prep: 'on-site',  kcal: 2000 },
      { name: '4 formaggi – mozzarella',            quantity: 1.2,  unit: 'kg',     prep: 'on-site',  kcal: 2800 },
      { name: '4 formaggi – Roquefort',             quantity: 400,  unit: 'g',      prep: 'on-site',  kcal: 3530 },
      { name: '4 formaggi – Parmigiano',            quantity: 500,  unit: 'g',      prep: 'on-site',  kcal: 4310 },
      { name: '4 formaggi – Emmental',              quantity: 700,  unit: 'g',      prep: 'on-site',  kcal: 3800 },
    ],
  },

  // =========================================================================
  // CHEF GAUTIER'S BURGER  (dinner)
  // =========================================================================
  {
    name: "Chef Gautier's Burger",
    mealType: 'dinner',
    servings: 30,
    description: 'Beef or veggie burgers with cinnamon tomato chutney, sauerkraut-style cabbage and 4 sauces.',
    preCook: '',
    photoURL: 'https://source.unsplash.com/640x360/?burger,gourmet',
    ingredients: [
      { name: 'Burger buns',                quantity: 30,  unit: 'pieces', prep: 'on-site',  kcal: 260  },
      { name: 'Cinnamon tomato chutney',    quantity: 1,   unit: 'kg',     prep: 'on-site',  kcal: 1200 },
      { name: 'Sauerkraut-style cabbage',   quantity: 2.5, unit: 'kg',     prep: 'on-site',  kcal: 200  },
      { name: 'Processed cheese slices',    quantity: 60,  unit: 'pieces', prep: 'on-site',  kcal: 80   },
      { name: 'Beef or veggie patties',     quantity: 30,  unit: 'pieces', prep: 'pre-cook', kcal: 250  },
      { name: 'Curry powder',               quantity: 40,  unit: 'g',      prep: 'on-site',  kcal: 3250 },
      { name: 'Crème fraîche',              quantity: 1.5, unit: 'kg',     prep: 'on-site',  kcal: 2900 },
      { name: 'Lettuce',                    quantity: 2,   unit: 'heads',  prep: 'on-site',  kcal: 140  },
      { name: 'Tomatoes',                   quantity: 2,   unit: 'kg',     prep: 'on-site',  kcal: 180  },
    ],
  },

  // =========================================================================
  // QUINOA SALAD  (lunch)
  // =========================================================================
  {
    name: 'Quinoa Salad',
    mealType: 'lunch',
    servings: 30,
    description: 'Fresh quinoa salad with avocado, cucumber, red onions and olive oil dressing.',
    preCook: '',
    photoURL: 'https://source.unsplash.com/640x360/?quinoa,salad,avocado',
    ingredients: [
      { name: 'Quinoa',      quantity: 2.5,  unit: 'kg',  prep: 'on-site', kcal: 3680 },
      { name: 'Cucumbers',   quantity: 2,    unit: 'kg',  prep: 'on-site', kcal: 150  },
      { name: 'Red onions',  quantity: 1,    unit: 'kg',  prep: 'on-site', kcal: 400  },
      { name: 'Avocados',    quantity: 2.5,  unit: 'kg',  prep: 'on-site', kcal: 1600 },
      { name: 'Olive oil',   quantity: 300,  unit: 'ml',  prep: 'on-site', kcal: 8800 },
    ],
  },

  // =========================================================================
  // DESSERT  (dessert)
  // Mixed fruits — quantities left blank (TBD); list each fruit separately
  // as instructed (quantity '' = TBD on-site per availability).
  // =========================================================================
  {
    name: 'Dessert',
    mealType: 'dessert',
    servings: 30,
    description: 'Mixed fresh fruit platter. Quantities TBD on market day.',
    preCook: '',
    photoURL: 'https://source.unsplash.com/640x360/?fruit,platter,tropical',
    ingredients: [
      { name: 'Banana',      quantity: '', unit: 'pieces', prep: 'on-site', kcal: 89  },
      { name: 'Orange',      quantity: '', unit: 'pieces', prep: 'on-site', kcal: 47  },
      { name: 'Apple',       quantity: '', unit: 'pieces', prep: 'on-site', kcal: 52  },
      { name: 'Watermelon',  quantity: '', unit: 'pieces', prep: 'on-site', kcal: 300 },
      { name: 'Melon',       quantity: '', unit: 'pieces', prep: 'on-site', kcal: 250 },
      { name: 'Peach',       quantity: '', unit: 'pieces', prep: 'on-site', kcal: 39  },
      { name: 'Nectarine',   quantity: '', unit: 'pieces', prep: 'on-site', kcal: 44  },
    ],
  },

  // =========================================================================
  // BREAKFAST  (breakfast)
  // =========================================================================
  {
    name: 'Breakfast',
    mealType: 'breakfast',
    servings: 30,
    description: 'Full camp breakfast: eggs, bacon, ham, cheese, bread, coffee, tea and condiments.',
    preCook: '',
    photoURL: 'https://source.unsplash.com/640x360/?breakfast,eggs,bacon',
    ingredients: [
      { name: 'Eggs',           quantity: 300,  unit: 'pieces', prep: 'on-site',  kcal: 78   },
      { name: 'Bacon',          quantity: 15,   unit: 'kg',     prep: 'pre-cook', kcal: 4170 },
      { name: 'Coffee',         quantity: 2,    unit: 'kg',     prep: 'on-site',  kcal: 0    },
      { name: 'Tea',            quantity: 200,  unit: 'sachets',prep: 'on-site',  kcal: 1    },
      { name: 'Hot sauce',      quantity: 1,    unit: 'L',      prep: 'on-site',  kcal: 300  },
      { name: 'Sugar',          quantity: 2,    unit: 'kg',     prep: 'on-site',  kcal: 3870 },
      { name: 'Tortilla bread', quantity: 150,  unit: 'pieces', prep: 'on-site',  kcal: 218  },
      { name: 'Sandwich bread', quantity: 10,   unit: 'loaves', prep: 'on-site',  kcal: 2650 },
      { name: 'Ham',            quantity: 5,    unit: 'kg',     prep: 'pre-cook', kcal: 1450 },
      { name: 'Cheese',         quantity: 5,    unit: 'kg',     prep: 'on-site',  kcal: 4000 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Build flat rows for Sheets
// ---------------------------------------------------------------------------

const MEALS_HEADERS = ['MealID','Name','Date','MealType','Servings','Description','Instructions','PreCook','PhotoURL'];
const INGR_HEADERS  = ['IngredientID','MealID','Name','Quantity','Unit','Prep','KcalPerUnit'];

const mealsRows = [];
const ingrRows  = [];

for (const m of MENU) {
  const mealId = slug(m.name);
  mealsRows.push([
    mealId,
    m.name,
    '',                // Date — dateless meals
    m.mealType,
    m.servings,
    m.description ?? '',
    '',                // Instructions — left for in-app editing
    m.preCook ?? '',
    m.photoURL ?? '',
  ]);
  for (const ing of m.ingredients) {
    const ingredientId = `${mealId}-${slug(ing.name)}`;
    ingrRows.push([
      ingredientId,
      mealId,
      ing.name,
      ing.quantity,
      ing.unit,
      ing.prep,
      ing.kcal,
    ]);
  }
}

// ---------------------------------------------------------------------------
// Dry-run output
// ---------------------------------------------------------------------------

function dryRun() {
  console.log('=== DRY-RUN: seed-meals.mjs ===');
  console.log('');
  console.log('Would CLEAR + REWRITE two tabs on the Google Sheet:');
  console.log('  • Meals          — 1 header row + ' + mealsRows.length + ' meal rows');
  console.log('  • MealIngredients — 1 header row + ' + ingrRows.length + ' ingredient rows');
  console.log('');
  console.log('No changes will be made until you run: node scripts/seed-meals.mjs --apply');
  console.log('');
  console.log('─'.repeat(80));

  for (const m of MENU) {
    const mealId = slug(m.name);
    const mIngr  = ingrRows.filter(r => r[1] === mealId);
    console.log('');
    console.log(`MEAL: ${m.name}  [${m.mealType}]  id=${mealId}  servings=${m.servings}`);
    console.log(`  Description : ${m.description}`);
    if (m.preCook) {
      console.log('  PreCook     : (verbatim — first 120 chars) ' + m.preCook.slice(0, 120).replace(/\n/g, ' '));
      console.log('                (full text stored in sheet)');
    } else {
      console.log('  PreCook     : (none)');
    }
    console.log(`  Photo URL   : ${m.photoURL}`);
    console.log(`  Ingredients (${mIngr.length}):`);
    const hdr = ['  IngredientID'.padEnd(52), 'Name'.padEnd(40), 'Qty'.padEnd(8), 'Unit'.padEnd(10), 'Prep'.padEnd(10), 'Kcal/unit'];
    console.log(hdr.join(''));
    console.log('  ' + '─'.repeat(140));
    for (const r of mIngr) {
      const [ingId, , name, qty, unit, prep, kcal] = r;
      console.log([
        `  ${ingId}`.padEnd(52),
        name.padEnd(40),
        String(qty).padEnd(8),
        unit.padEnd(10),
        prep.padEnd(10),
        String(kcal),
      ].join(''));
    }
  }

  console.log('');
  console.log('─'.repeat(80));
  console.log('');
  console.log('Meals header row  :', MEALS_HEADERS.join(' | '));
  console.log('Ingreds header row:', INGR_HEADERS.join(' | '));
  console.log('');
  console.log('=== END DRY-RUN — nothing written ===');
}

// ---------------------------------------------------------------------------
// Apply: clear tabs and write
// ---------------------------------------------------------------------------

async function apply() {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = sheetsApi({ version: 'v4', auth });
  const SHEET_ID = process.env.SHEET_ID;

  if (!SHEET_ID) throw new Error('SHEET_ID env var not set');

  for (const [tab, headers, rows] of [
    ['Meals',           MEALS_HEADERS, mealsRows],
    ['MealIngredients', INGR_HEADERS,  ingrRows ],
  ]) {
    console.log(`Clearing ${tab}…`);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: tab,
    });

    const data = [headers, ...rows];
    console.log(`Writing ${tab}: ${rows.length} data rows…`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: data },
    });
    console.log(`  ✓ ${tab} written (${rows.length} rows + header)`);
  }

  console.log('');
  console.log('Done. Both tabs cleared and rewritten.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const apply_flag = process.argv.includes('--apply');

if (apply_flag) {
  console.log('=== APPLY MODE — writing to Google Sheets ===');
  await apply();
} else {
  dryRun();
}
