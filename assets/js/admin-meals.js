import { num, perPerson, scaledTotal, mealKcalPerPerson, targetFor, energyStatus, DAILY_TARGET, effectiveHeadcount } from '/assets/js/meals-logic.js';

(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var canEdit = false; // set from /api/meals fetch (admin or Kitchen lead)

  var state = { meals: [], ingredients: [], logistics: [], headcount: 30 };
  var activeFilter = 'all';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getHeadcount(dateStr) {
    return JH.getHeadcount(state.logistics, dateStr);
  }

  function headcount() { return state.headcount; }

  function approvedCount() {
    return members.filter(function (m) { return (JH.val(m, 'Status') || '').toLowerCase() === 'approved'; }).length;
  }

  function uniqueSortedDates() {
    var seen = {};
    state.meals.forEach(function (m) { if (m.Date) seen[m.Date] = true; });
    return Object.keys(seen).sort();
  }

  function mealTypeBadgeClass(type) {
    var t = (type || '').toLowerCase();
    if (t === 'breakfast') return 'badge-breakfast';
    if (t === 'lunch') return 'badge-lunch';
    if (t === 'dinner') return 'badge-dinner';
    return 'badge-snack';
  }

  function formatDate(dateStr) {
    return JH.formatDateLong(dateStr);
  }

  function genId() {
    return Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function fmtNum(n) { return n === Math.floor(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''); }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await JH.apiFetch('/api/meals', {});
    if (!res.ok) { console.error('meals fetch failed'); return; }
    var data = await res.json();
    state.meals = data.meals || [];
    state.ingredients = data.ingredients || [];
    state.logistics = data.logistics || [];
    canEdit = !!data.canEdit;
  }

  // ── saveMeal / saveIngredient helpers ─────────────────────────────────────

  async function saveMeal(m) {
    return JH.apiFetch('/api/meals', {
      action: 'upsert-meal',
      mealId: m.MealID,
      name: m.Name,
      date: m.Date || '',
      mealType: m.MealType || '',
      servings: m.Servings || '',
      description: m.Description || '',
      instructions: m.Instructions || '',
      preCook: m.PreCook || '',
      photoURL: m.PhotoURL || '',
    });
  }

  async function saveIngredient(i) {
    return JH.apiFetch('/api/meals', {
      action: 'upsert-ingredient',
      ingredientId: i.IngredientID,
      mealId: i.MealID,
      name: i.Name,
      quantity: i.Quantity || '',
      unit: i.Unit || '',
      prep: i.Prep || '',
      kcalPerUnit: i.KcalPerUnit || '',
    });
  }

  // ── Headcount chart ──────────────────────────────────────────────────────

  var headcountChart = null;

  function getAllDates() {
    var dateSet = {};
    JH.getAllDates(state.logistics).forEach(function (d) { dateSet[d] = true; });
    state.meals.forEach(function (m) { if (m.Date) dateSet[m.Date] = true; });
    return Object.keys(dateSet).sort();
  }

  function getMealCountByType(dateStr, type) {
    return state.meals.filter(function (m) {
      return m.Date === dateStr && (m.MealType || '').toLowerCase() === type;
    }).length;
  }

  function renderHeadcountChart() {
    var dates = getAllDates();
    if (!dates.length) return;

    var labels = dates.map(function (d) { return JH.formatDateLong(d); });
    var counts = dates.map(function (d) { return getHeadcount(d); });

    var ctx = document.getElementById('headcount-chart');
    if (headcountChart) headcountChart.destroy();

    headcountChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'People',
          data: counts,
          backgroundColor: '#e8a84c88',
          borderColor: '#e8a84c',
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterBody: function (items) {
                var idx = items[0].dataIndex;
                var dateStr = dates[idx];
                var lines = [];
                var breakfast = getMealCountByType(dateStr, 'breakfast');
                var lunch = getMealCountByType(dateStr, 'lunch');
                var dinner = getMealCountByType(dateStr, 'dinner');
                var snack = getMealCountByType(dateStr, 'snack');
                if (breakfast) lines.push('Breakfast: ' + breakfast + ' meal(s)');
                if (lunch) lines.push('Lunch: ' + lunch + ' meal(s)');
                if (dinner) lines.push('Dinner: ' + dinner + ' meal(s)');
                if (snack) lines.push('Snack: ' + snack + ' meal(s)');
                if (!lines.length) lines.push('No meals planned');
                return lines;
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#8a8580', maxRotation: 45, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: '#8a8580', stepSize: 1 }, grid: { color: '#2a2a2a22' }, beginAtZero: true, title: { display: true, text: 'People', color: '#8a8580', font: { size: 11 } } }
        }
      }
    });
  }

  // ── Render date filter buttons ─────────────────────────────────────────────

  function renderDateFilter() {
    var dates = uniqueSortedDates();
    var wrap = document.getElementById('date-filter');
    var html = '<button class="date-btn' + (activeFilter === 'all' ? ' active' : '') + '" data-date="all">All</button>';
    // Unscheduled pill — only when some meal has no Date
    if (state.meals.some(function (m) { return !m.Date; })) {
      html += '<button class="date-btn' + (activeFilter === 'unscheduled' ? ' active' : '') + '" data-date="unscheduled">Unscheduled</button>';
    }
    dates.forEach(function (d) {
      html += '<button class="date-btn' + (activeFilter === d ? ' active' : '') + '" data-date="' + JH.esc(d) + '">' + JH.esc(formatDate(d)) + '</button>';
    });
    wrap.innerHTML = html;
  }

  // Event delegation for date filter buttons
  document.getElementById('date-filter').addEventListener('click', function (e) {
    var btn = e.target.closest('.date-btn');
    if (!btn) return;
    activeFilter = btn.dataset.date;
    renderDateFilter();
    renderMeals();
  });

  // ── Energy line helper ────────────────────────────────────────────────────

  function mealKcalLine(meal, ings) {
    var kc = Math.round(mealKcalPerPerson(ings, meal.Servings));
    var target = targetFor(meal.MealType);
    var soft = (meal.MealType || '').toLowerCase() === 'dessert';
    var status = energyStatus(kc, target);
    var pct = target ? Math.min(100, Math.round(kc / target * 100)) : 100;
    var tag = (!target || soft) ? '' :
      '<span class="energy-tag ' + status + '">' + (status === 'ok' ? '✓ enough' : '⚠ a bit light') + '</span>';
    return '<div class="energy-strip"><span class="kc">~' + kc + ' kcal/person</span>' +
      '<div class="energy-bar"><i class="' + status + '" style="width:' + pct + '%"></i></div>' +
      '<span class="vs">' + (target ? 'target ~' + target + ' (' + JH.esc(meal.MealType || '') + ')' : 'no target') + '</span>' + tag + '</div>';
  }

  // ── Render meal cards ─────────────────────────────────────────────────────

  function mealCardHtml(meal) {
    var ings = state.ingredients.filter(function (i) { return i.MealID === meal.MealID; });
    var planned = headcount();
    var hc = effectiveHeadcount(planned, state.logistics, meal.Date);
    var noorgOff = planned - hc; // > 0 only on setup/strike days with NoOrg-fed people
    var photo = meal.PhotoURL
      ? '<div class="meal-photo" style="background-image:url(\'' + JH.esc(meal.PhotoURL) + '\')">' + (canEdit ? '<button class="change-photo" data-meal-id="' + JH.esc(meal.MealID) + '">📷 Change</button>' : '') + '</div>'
      : '';
    var typeSel = canEdit
      ? '<select class="meal-type-inline" data-meal-id="' + JH.esc(meal.MealID) + '">' +
        ['breakfast', 'lunch', 'dinner', 'dessert'].map(function (t) {
          return '<option value="' + t + '"' + ((meal.MealType || '').toLowerCase() === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select>'
      : '<span class="meal-type-badge">' + JH.esc(meal.MealType || 'other') + '</span>';
    var dateCtl = canEdit
      ? '<input class="meal-date-inline datebox" data-meal-id="' + JH.esc(meal.MealID) + '" placeholder="📅 assign date" value="' + JH.esc(meal.Date || '') + '">'
      : '';

    var rows = ings.map(function (ing) {
      var pre = (ing.Prep || '').toLowerCase() === 'pre-cook';
      var pp = perPerson(ing.Quantity, meal.Servings);
      var tot = scaledTotal(ing.Quantity, meal.Servings, hc);
      var kcp = Math.round(perPerson(ing.Quantity, meal.Servings) * num(ing.KcalPerUnit));
      var prepCtl = canEdit
        ? '<span class="prep-toggle ' + (pre ? 'pre' : 'site') + '" data-ingredient-id="' + JH.esc(ing.IngredientID) + '">' + (pre ? '❄ pre-cook' : 'on-site') + '</span>'
        : (pre ? '<span class="prep-toggle pre">❄ pre-cook</span>' : '<span class="prep-toggle site">on-site</span>');
      return '<tr' + (pre ? ' class="precook"' : '') + '>' +
        '<td>' + (pre ? '❄ ' : '') + JH.esc(ing.Name) + '</td>' +
        '<td>' + fmtNum(pp) + '</td><td><strong>' + fmtNum(tot) + '</strong></td><td>' + JH.esc(ing.Unit || '') + '</td>' +
        '<td style="color:var(--text-muted)">' + (kcp || '—') + '</td><td>' + prepCtl + '</td>' +
        (canEdit ? '<td><button class="btn-icon edit-ingredient-btn" data-ingredient-id="' + JH.esc(ing.IngredientID) + '" data-meal-id="' + JH.esc(ing.MealID) + '">&#9998;</button><button class="btn-icon danger delete-ingredient-btn" data-ingredient-id="' + JH.esc(ing.IngredientID) + '">&#10005;</button></td>' : '') +
        '</tr>';
    }).join('');

    var html = '<div class="meal-card" data-meal-id="' + JH.esc(meal.MealID) + '">' + photo + '<div style="padding:12px 14px">';
    html += '<div class="meal-card-header"><div class="meal-card-title"><h3>' + JH.esc(meal.Name) + '</h3>' + typeSel +
      '<span class="headcount-note">serves ~' + (parseInt(meal.Servings, 10) || 30) +
        (noorgOff > 0 ? ' · <span style="color:var(--accent)">' + hc + ' to feed (' + planned + ' − ' + noorgOff + ' on NoOrg)</span>' : '') +
        '</span>' + dateCtl + '</div>';
    if (canEdit) html += '<div class="meal-card-actions"><button class="btn-secondary btn-sm edit-meal-btn" data-meal-id="' + JH.esc(meal.MealID) + '">Edit</button><button class="btn-danger btn-sm delete-meal-btn" data-meal-id="' + JH.esc(meal.MealID) + '">Delete</button></div>';
    html += '</div>';
    if (meal.Description) html += '<p class="meal-desc">' + JH.esc(meal.Description) + '</p>';
    html += mealKcalLine(meal, ings);
    if (meal.PreCook) html += '<div class="precook-callout"><b>❄ Pre-cook ahead:</b> ' + JH.esc(meal.PreCook) + '</div>';
    if (meal.Instructions) {
      html += '<button class="instructions-toggle" data-meal-id="' + JH.esc(meal.MealID) + '">Show instructions</button>';
      html += '<div class="instructions-text" id="instructions-' + JH.esc(meal.MealID) + '" style="display:none">' + JH.esc(meal.Instructions) + '</div>';
    }
    html += '<div class="ingredients-section"><div class="ingredients-header"><span>Ingredients</span>' +
      (canEdit ? '<button class="btn-secondary btn-sm add-ingredient-btn" data-meal-id="' + JH.esc(meal.MealID) + '">+ Add Ingredient</button>' : '') + '</div>';
    html += ings.length
      ? '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table class="ingredients-table"><thead><tr><th>Name</th><th>Per-person</th><th>Total (' + hc + ')</th><th>Unit</th><th>kcal/p</th><th>Prep</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div style="font-size:0.82rem;color:var(--text-muted);padding:6px 0">No ingredients yet.</div>';
    html += '</div></div></div>';
    return html;
  }

  function renderMeals() {
    var wrap = document.getElementById('meals-wrap');
    var withDate = state.meals.filter(function (m) { return m.Date; });
    var unscheduled = state.meals.filter(function (m) { return !m.Date; });
    if (!state.meals.length) {
      wrap.innerHTML = '<div class="empty-state">No meals yet.' + (canEdit ? ' Use "+ Add Meal".' : '') + '</div>';
      return;
    }
    var dates = {};
    withDate.forEach(function (m) { dates[m.Date] = true; });
    var sortedDates = Object.keys(dates).sort();
    var order = ['breakfast', 'lunch', 'dinner', 'dessert'];
    function sortMeals(a, b) {
      var ai = order.indexOf((a.MealType || '').toLowerCase()), bi = order.indexOf((b.MealType || '').toLowerCase());
      return (ai === -1 ? 9 : ai) - (bi === -1 ? 9 : bi);
    }
    var html = '';
    if ((activeFilter === 'all' || activeFilter === 'unscheduled') && unscheduled.length) {
      html += '<div class="meals-date-group"><div class="meals-date-heading">Unscheduled</div><div class="meal-cards">' +
        unscheduled.slice().sort(sortMeals).map(mealCardHtml).join('') + '</div></div>';
    }
    sortedDates.filter(function (d) { return activeFilter === 'all' || activeFilter === d; }).forEach(function (d) {
      var dayMeals = withDate.filter(function (m) { return m.Date === d; }).sort(sortMeals);
      var dayKcal = dayMeals.reduce(function (s, m) {
        return s + mealKcalPerPerson(state.ingredients.filter(function (i) { return i.MealID === m.MealID; }), m.Servings);
      }, 0);
      var dcls = dayKcal >= DAILY_TARGET ? '' : ' style="color:var(--accent)"';
      html += '<div class="meals-date-group"><div class="meals-date-heading">' + JH.esc(formatDate(d)) +
        '<span class="headcount-note"' + dcls + '>⚡ ~' + Math.round(dayKcal) + ' / ' + DAILY_TARGET + ' kcal/person</span></div>' +
        '<div class="meal-cards">' + dayMeals.map(mealCardHtml).join('') + '</div></div>';
    });
    wrap.innerHTML = html;
    // Initialise Flatpickr on every inline date input so picking a date stores
    // it in Y-m-d format (the altInput display is dd/mm/yyyy). Flatpickr fires
    // a `change` event on the original hidden input when a date is selected,
    // which the delegated `change` listener below catches to save + reload.
    if (canEdit) {
      document.querySelectorAll('.meal-date-inline').forEach(function (el) { JH.initDate(el); });
    }
  }

  // Event delegation — single listener on container, never accumulates
  document.getElementById('meals-wrap').addEventListener('click', async function (e) {
    var btn = e.target.closest('.instructions-toggle');
    if (btn) {
      var mealId = btn.dataset.mealId;
      var textEl = document.getElementById('instructions-' + mealId);
      if (!textEl) return;
      var visible = textEl.style.display !== 'none';
      textEl.style.display = visible ? 'none' : '';
      btn.textContent = visible ? 'Show instructions' : 'Hide instructions';
      return;
    }

    var pt = e.target.closest('.prep-toggle');
    if (pt && canEdit) {
      var ing = state.ingredients.find(function (i) { return i.IngredientID === pt.dataset.ingredientId; });
      if (ing) {
        var r = await saveIngredient(Object.assign({}, ing, { Prep: (ing.Prep || '').toLowerCase() === 'pre-cook' ? 'on-site' : 'pre-cook' }));
        if (!r.ok) { alert('Action failed. Please try again.'); return; }
        await reload();
      }
      return;
    }

    var cp = e.target.closest('.change-photo');
    if (cp && canEdit) {
      var m = state.meals.find(function (x) { return x.MealID === cp.dataset.mealId; });
      var url = prompt('Photo URL for "' + (m ? m.Name : '') + '":', m ? (m.PhotoURL || '') : '');
      if (url !== null && m) {
        var r = await saveMeal(Object.assign({}, m, { PhotoURL: url }));
        if (!r.ok) { alert('Action failed. Please try again.'); return; }
        await reload();
      }
      return;
    }

    if (!canEdit) return;

    btn = e.target.closest('.edit-meal-btn');
    if (btn) {
      var meal = state.meals.find(function (m) { return m.MealID === btn.dataset.mealId; });
      if (meal) openMealModal(meal);
      return;
    }

    btn = e.target.closest('.delete-meal-btn');
    if (btn) {
      if (!confirm('Delete meal "' + btn.dataset.mealId + '" and all its ingredients?')) return;
      var r = await JH.apiFetch('/api/meals', { action: 'delete-meal', mealId: btn.dataset.mealId });
      if (!r.ok) { alert('Action failed. Please try again.'); return; }
      await reload();
      return;
    }

    btn = e.target.closest('.add-ingredient-btn');
    if (btn) {
      openIngredientModal(null, btn.dataset.mealId);
      return;
    }

    btn = e.target.closest('.edit-ingredient-btn');
    if (btn) {
      var ing = state.ingredients.find(function (i) { return i.IngredientID === btn.dataset.ingredientId; });
      if (ing) openIngredientModal(ing, ing.MealID);
      return;
    }

    btn = e.target.closest('.delete-ingredient-btn');
    if (btn) {
      if (!confirm('Delete this ingredient?')) return;
      var r = await JH.apiFetch('/api/meals', { action: 'delete-ingredient', ingredientId: btn.dataset.ingredientId });
      if (!r.ok) { alert('Action failed. Please try again.'); return; }
      await reload();
    }
  });

  // Inline type/date change delegation
  document.getElementById('meals-wrap').addEventListener('change', async function (e) {
    if (!canEdit) return;
    var sel = e.target.closest('.meal-type-inline');
    var dt = e.target.closest('.meal-date-inline');
    var el = sel || dt; if (!el) return;
    var meal = state.meals.find(function (m) { return m.MealID === el.dataset.mealId; });
    if (!meal) return;
    await saveMeal(Object.assign({}, meal, sel ? { MealType: sel.value } : { Date: dt.value }));
    await reload();
  });

  // ── Meal modal ────────────────────────────────────────────────────────────

  var editingMealId = null;

  function openMealModal(meal) {
    editingMealId = meal ? meal.MealID : null;
    document.getElementById('meal-modal-title').childNodes[0].textContent = meal ? 'Edit Meal ' : 'Add Meal ';
    document.getElementById('meal-name').value = meal ? meal.Name : '';
    document.getElementById('meal-date').value = meal ? (meal.Date || '') : '';
    document.getElementById('meal-type').value = meal ? (meal.MealType || 'dinner') : 'dinner';
    document.getElementById('meal-desc').value = meal ? (meal.Description || '') : '';
    document.getElementById('meal-instructions').value = meal ? (meal.Instructions || '') : '';
    document.getElementById('meal-servings').value = meal ? (meal.Servings || '') : '';
    document.getElementById('meal-precook').value = meal ? (meal.PreCook || '') : '';
    document.getElementById('meal-photo').value = meal ? (meal.PhotoURL || '') : '';
    document.getElementById('meal-modal').classList.add('active');
  }

  document.getElementById('btn-add-meal').addEventListener('click', function () {
    openMealModal(null);
  });

  document.getElementById('meal-save-btn').addEventListener('click', async function () {
    var name = document.getElementById('meal-name').value.trim();
    if (!name) { alert('Meal name is required.'); return; }
    var date = document.getElementById('meal-date').value.trim();
    var mealType = document.getElementById('meal-type').value;
    var mealId = editingMealId || (Date.now() + '-' + (mealType || 'dinner'));
    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    var r = await JH.apiFetch('/api/meals', {
      action: 'upsert-meal',
      mealId: mealId,
      name: name,
      date: date,
      mealType: mealType,
      servings: document.getElementById('meal-servings').value.trim(),
      description: document.getElementById('meal-desc').value,
      instructions: document.getElementById('meal-instructions').value,
      preCook: document.getElementById('meal-precook').value,
      photoURL: document.getElementById('meal-photo').value.trim(),
    });
    btn.textContent = 'Save Meal';
    btn.disabled = false;
    if (!r.ok) { alert('Action failed. Please try again.'); return; }
    document.getElementById('meal-modal').classList.remove('active');
    await reload();
  });

  // ── Ingredient modal ──────────────────────────────────────────────────────

  // Servings basis for the open ingredient modal — used to convert the
  // (display-only) per-person input to/from the stored Total quantity.
  var ingredientModalServings = 30;

  function openIngredientModal(ing, mealId) {
    var meal = state.meals.find(function (m) { return m.MealID === mealId; });
    ingredientModalServings = (meal && parseInt(meal.Servings, 10)) || 30;
    document.getElementById('ingredient-servings-note').textContent = ingredientModalServings;
    document.getElementById('ingredient-modal-title').childNodes[0].textContent = ing ? 'Edit Ingredient ' : 'Add Ingredient ';
    document.getElementById('ingredient-id').value = ing ? ing.IngredientID : '';
    document.getElementById('ingredient-meal-id').value = mealId || '';
    document.getElementById('ingredient-name').value = ing ? ing.Name : '';
    var q = ing ? (ing.Quantity || '') : '';
    document.getElementById('ingredient-quantity').value = q;
    document.getElementById('ingredient-perperson').value = q === '' ? '' : fmtNum(num(q) / ingredientModalServings);
    document.getElementById('ingredient-unit').value = ing ? (ing.Unit || '') : '';
    document.getElementById('ingredient-prep').value = ing ? (ing.Prep || 'on-site') : 'on-site';
    document.getElementById('ingredient-kcal').value = ing ? (ing.KcalPerUnit || '') : '';
    document.getElementById('ingredient-modal').classList.add('active');
  }

  // Two-way link: editing the total updates per-person and vice-versa. The
  // stored value is always the Total (ingredient-quantity); per-person is a
  // helper that back-computes it via the meal's Servings.
  (function () {
    var qtyEl = document.getElementById('ingredient-quantity');
    var ppEl = document.getElementById('ingredient-perperson');
    if (!qtyEl || !ppEl) return;
    qtyEl.addEventListener('input', function () {
      var v = qtyEl.value.trim();
      ppEl.value = v === '' ? '' : fmtNum(num(v) / (ingredientModalServings || 30));
    });
    ppEl.addEventListener('input', function () {
      var v = ppEl.value.trim();
      qtyEl.value = v === '' ? '' : fmtNum(num(v) * (ingredientModalServings || 30));
    });
  })();

  document.getElementById('ingredient-save-btn').addEventListener('click', async function () {
    var mealId = document.getElementById('ingredient-meal-id').value.trim();
    var name = document.getElementById('ingredient-name').value.trim();
    var ingredientId = document.getElementById('ingredient-id').value.trim() || (mealId + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    var quantity = document.getElementById('ingredient-quantity').value.trim();
    var unit = document.getElementById('ingredient-unit').value.trim();
    var prep = document.getElementById('ingredient-prep').value;
    var kcalPerUnit = document.getElementById('ingredient-kcal').value.trim();
    if (!name) { alert('Ingredient name is required.'); return; }
    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    var r = await JH.apiFetch('/api/meals', {
      action: 'upsert-ingredient',
      ingredientId: ingredientId,
      mealId: mealId,
      name: name,
      quantity: quantity,
      unit: unit,
      prep: prep,
      kcalPerUnit: kcalPerUnit,
    });
    btn.textContent = 'Save Ingredient';
    btn.disabled = false;
    if (!r.ok) { alert('Action failed. Please try again.'); return; }
    document.getElementById('ingredient-modal').classList.remove('active');
    await reload();
  });

  // ── Shopping list ────────────────────────────────────────────────────────

  function renderShoppingList() {
    var wrap = document.getElementById('shopping-list-content');
    if (!state.meals.length || !state.ingredients.length) {
      wrap.innerHTML = '<div class="empty-state">No ingredients to show yet.</div>';
      return;
    }

    // Aggregate: for each ingredient name, sum scaledTotal across all meals
    var agg = {}; // key: ingredient name → { name, unit, total, meals: [] }
    state.meals.forEach(function (meal) {
      var mealIngredients = state.ingredients.filter(function (i) { return i.MealID === meal.MealID; });
      mealIngredients.forEach(function (ing) {
        var key = (ing.Name || '').toLowerCase().trim();
        if (!key) return;
        if (!agg[key]) {
          agg[key] = { name: ing.Name, unit: ing.Unit || '', total: 0, meals: [] };
        }
        agg[key].total += scaledTotal(ing.Quantity, meal.Servings, effectiveHeadcount(headcount(), state.logistics, meal.Date));
        agg[key].meals.push(meal.Name);
      });
    });

    var items = Object.keys(agg).map(function (k) { return agg[k]; });
    items.sort(function (a, b) {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });

    if (!items.length) {
      wrap.innerHTML = '<div class="empty-state">No ingredients to show yet.</div>';
      return;
    }

    var html = '<div style="overflow-x:auto"><table class="shopping-table"><thead><tr>';
    html += '<th>Ingredient</th><th>Total needed</th><th>Used in</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function (item) {
      var totalStr = fmtNum(item.total);
      var totalDisplay = totalStr + (item.unit ? ' ' + item.unit : '');
      html += '<tr>';
      html += '<td>' + JH.esc(item.name) + '</td>';
      html += '<td class="total-col">' + JH.esc(totalDisplay) + '</td>';
      html += '<td style="font-size:0.78rem;color:var(--text-muted)">' + JH.esc(item.meals.join(', ')) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  // Copy shopping list to clipboard
  document.getElementById('copy-shopping-list').addEventListener('click', function () {
    var items = [];
    document.querySelectorAll('.shopping-table tbody tr').forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        var name = cells[0].textContent.trim();
        var total = cells[1].textContent.trim();
        items.push(total + '  ' + name);
      }
    });
    if (!items.length) return;
    var text = 'Shopping List\n' + '='.repeat(30) + '\n' + items.join('\n');
    navigator.clipboard.writeText(text).then(function () {
      var btn = document.getElementById('copy-shopping-list');
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = 'Copy to clipboard'; }, 2000);
    });
  });

  // ── Prep-ahead list ───────────────────────────────────────────────────────

  function renderPrepAhead() {
    var wrap = document.getElementById('prep-ahead-content');
    // Collect all pre-cook ingredients and meals with PreCook notes
    var preIngredients = []; // { name, unit, total, mealName }
    var preMeals = []; // { name, preCook }

    state.meals.forEach(function (meal) {
      if (meal.PreCook) {
        preMeals.push({ name: meal.Name, preCook: meal.PreCook });
      }
      state.ingredients.filter(function (i) { return i.MealID === meal.MealID && (i.Prep || '').toLowerCase() === 'pre-cook'; }).forEach(function (ing) {
        preIngredients.push({
          name: ing.Name,
          unit: ing.Unit || '',
          total: scaledTotal(ing.Quantity, meal.Servings, effectiveHeadcount(headcount(), state.logistics, meal.Date)),
          mealName: meal.Name,
        });
      });
    });

    if (!preIngredients.length && !preMeals.length) {
      wrap.innerHTML = '';
      return;
    }

    var html = '<div style="margin-top:20px"><h3 style="font-family:var(--heading);color:#5bc0de;font-size:0.95rem;margin:0 0 10px">❄ Prep-ahead list</h3>';

    if (preIngredients.length) {
      html += '<div style="overflow-x:auto"><table class="shopping-table"><thead><tr><th>Ingredient</th><th>Total needed</th><th>For meal</th></tr></thead><tbody>';
      preIngredients.forEach(function (item) {
        var totalStr = fmtNum(item.total);
        var totalDisplay = totalStr + (item.unit ? ' ' + item.unit : '');
        html += '<tr>' +
          '<td>❄ ' + JH.esc(item.name) + '</td>' +
          '<td class="total-col">' + JH.esc(totalDisplay) + '</td>' +
          '<td style="font-size:0.78rem;color:var(--text-muted)">' + JH.esc(item.mealName) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    if (preMeals.length) {
      html += '<div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">';
      preMeals.forEach(function (pm) {
        html += '<div class="precook-callout"><b>❄ ' + JH.esc(pm.name) + ':</b> ' + JH.esc(pm.preCook) + '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    wrap.innerHTML = html;
  }

  // ── Modal close buttons ───────────────────────────────────────────────────

  document.querySelectorAll('.modal-close[data-close], .modal-actions [data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.getElementById(btn.dataset.close).classList.remove('active');
    });
  });

  // ── PDF Export ──────────────────────────────────────────────────────────

  document.getElementById('btn-export-pdf').addEventListener('click', function () {
    var container = document.getElementById('print-container');
    var mealOrder = ['breakfast', 'lunch', 'dinner', 'dessert'];

    // Sort all meals by date then type
    var allMeals = state.meals.slice().sort(function (a, b) {
      if (a.Date !== b.Date) return (a.Date || '') < (b.Date || '') ? -1 : 1;
      var ai = mealOrder.indexOf((a.MealType || '').toLowerCase());
      var bi = mealOrder.indexOf((b.MealType || '').toLowerCase());
      if (ai === -1) ai = 99;
      if (bi === -1) bi = 99;
      return ai - bi;
    });

    if (!allMeals.length) {
      alert('No meals to export.');
      return;
    }

    var html = '';
    allMeals.forEach(function (meal) {
      var mealIngredients = state.ingredients.filter(function (i) { return i.MealID === meal.MealID; });
      var hc = effectiveHeadcount(headcount(), state.logistics, meal.Date);
      var dateLabel = meal.Date ? formatDate(meal.Date) : 'Unscheduled';
      var typeLabel = (meal.MealType || 'Meal').charAt(0).toUpperCase() + (meal.MealType || 'meal').slice(1);

      html += '<div class="print-meal-page">';
      html += '<div class="print-header"><h1>JamHouse 2026</h1></div>';
      html += '<h2 class="print-meal-title">' + JH.esc(meal.Name) + '</h2>';
      html += '<div class="print-meal-meta">' + JH.esc(dateLabel) + ' &middot; ' + JH.esc(typeLabel) + '</div>';
      html += '<div class="print-headcount">' + hc + ' people (scaled)</div>';

      if (meal.Description) {
        html += '<p class="print-meal-desc">' + JH.esc(meal.Description) + '</p>';
      }

      if (mealIngredients.length) {
        html += '<div class="print-section-title">Ingredients</div>';
        html += '<table class="print-ing-table"><thead><tr>';
        html += '<th>Ingredient</th><th>Per person</th><th>Total (' + hc + 'p)</th><th>Unit</th>';
        html += '</tr></thead><tbody>';

        mealIngredients.forEach(function (ing) {
          var pp = perPerson(ing.Quantity, meal.Servings);
          var tot = scaledTotal(ing.Quantity, meal.Servings, hc);
          var ppStr = fmtNum(pp);
          var totStr = fmtNum(tot);

          html += '<tr>';
          html += '<td>' + JH.esc(ing.Name) + '</td>';
          html += '<td class="num">' + JH.esc(ppStr) + '</td>';
          html += '<td class="num" style="font-size:14px">' + JH.esc(totStr) + '</td>';
          html += '<td>' + JH.esc(ing.Unit || '') + '</td>';
          html += '</tr>';
        });

        html += '</tbody></table>';
      }

      if (meal.Instructions) {
        html += '<div class="print-section-title">Instructions</div>';
        html += '<div class="print-instructions">' + JH.esc(meal.Instructions) + '</div>';
      }

      html += '</div>';
    });

    container.innerHTML = html;
    window.print();
  });

  // ── Dietary overview ──────────────────────────────────────────────────────

  var FOOD_TYPES = ['Carnivore', 'Pescatarian', 'Vegetarian', 'Vegan'];
  var FOOD_EMOJI = { Carnivore: '🥩', Pescatarian: '🐟', Vegetarian: '🥗', Vegan: '🌱', 'Not set': '❓' };

  function approvedMembers() {
    return members.filter(function (m) {
      return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
    });
  }

  function memberDisplayName(m) {
    var playa = JH.val(m, 'Playa Name');
    if (playa) return playa;
    var name = JH.val(m, 'Name');
    return name.split(/\s+/)[0] || 'Member';
  }

  // Detect serious allergens / dietary constraints worth surfacing as badges.
  // Keep this conservative — only flag conditions the cook needs to know up front.
  function allergenTags(notes) {
    var lower = (notes || '').toLowerCase();
    var tags = [];
    if (/coeliac|celiac/.test(lower)) tags.push('Celiac');
    else if (/gluten[\s-]?(free|intoleran)|\bno gluten/.test(lower)) tags.push('Gluten-free');
    if (/peanut/.test(lower)) tags.push('Peanut');
    if (/tree[\s-]?nut|\balmond|cashew|hazelnut|walnut|pistachio/.test(lower)) tags.push('Tree nut');
    if (/lactos|\bdairy/.test(lower)) tags.push('Dairy');
    if (/shellfish|crustace|prawn|shrimp/.test(lower)) tags.push('Shellfish');
    if (/anaphyl|epipen/.test(lower)) tags.push('Anaphylaxis');
    if (/\begg/.test(lower)) tags.push('Egg');
    if (/\bsoy|soya/.test(lower)) tags.push('Soy');
    if (/sesame/.test(lower)) tags.push('Sesame');
    return tags;
  }

  var dietaryByType = {};

  function renderDietaryPanel() {
    var approved = approvedMembers();
    var byType = { Carnivore: [], Pescatarian: [], Vegetarian: [], Vegan: [], 'Not set': [] };
    approved.forEach(function (m) {
      var ft = JH.val(m, 'FoodType');
      var bucket = byType[ft] ? ft : 'Not set';
      byType[bucket].push(m);
    });
    dietaryByType = byType;

    var order = FOOD_TYPES.slice();
    if (byType['Not set'].length) order.push('Not set');

    var tilesHtml = order.map(function (t) {
      return '<div class="dietary-tile" data-type="' + JH.esc(t) + '">' +
        '<div class="dietary-tile-label"><span class="dietary-tile-emoji">' + FOOD_EMOJI[t] + '</span>' + JH.esc(t) + '</div>' +
        '<div class="dietary-tile-count">' + byType[t].length + '</div>' +
        '</div>';
    }).join('');
    document.getElementById('dietary-summary').innerHTML = '<div class="dietary-tiles">' + tilesHtml + '</div>';

    // Allergens & special preferences
    var withNotes = approved.filter(function (m) { return JH.val(m, 'DietaryNotes'); });
    var html = '<div class="dietary-section-title">Allergies &amp; special preferences (' + withNotes.length + ')</div>';
    if (withNotes.length) {
      html += '<div class="allergens-list">';
      withNotes
        .slice()
        .sort(function (a, b) {
          var sa = allergenTags(JH.val(a, 'DietaryNotes')).length > 0 ? 0 : 1;
          var sb = allergenTags(JH.val(b, 'DietaryNotes')).length > 0 ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return memberDisplayName(a).localeCompare(memberDisplayName(b));
        })
        .forEach(function (m) {
          var notes = JH.val(m, 'DietaryNotes');
          var tags = allergenTags(notes);
          var severe = tags.length > 0;
          var tagHtml = tags.map(function (t) { return '<span class="allergen-tag">' + JH.esc(t) + '</span>'; }).join('');
          html += '<div class="allergen-card' + (severe ? ' severe' : '') + '">' +
            '<span class="allergen-name">' + JH.esc(memberDisplayName(m)) + '</span>' +
            (tagHtml ? '<span>' + tagHtml + '</span>' : '') +
            '<span class="allergen-note">' + JH.esc(notes) + '</span>' +
            '</div>';
        });
      html += '</div>';
    } else {
      html += '<div class="dietary-empty">Nobody has noted any allergies or special preferences yet.</div>';
    }
    document.getElementById('dietary-allergens').innerHTML = html;

    // Yet to specify — visible list of approved members with no FoodType set
    var pending = byType['Not set'].slice().sort(function (a, b) {
      return memberDisplayName(a).localeCompare(memberDisplayName(b));
    });
    var pendingHtml = '<div class="dietary-section-title">Yet to specify (' + pending.length + ')</div>';
    if (pending.length) {
      pendingHtml += '<div class="dietary-details-card">';
      pendingHtml += pending.map(function (m) {
        var name = JH.esc(memberDisplayName(m));
        var tg = JH.val(m, 'Telegram');
        if (tg) {
          var handle = tg.replace(/^@/, '');
          return name + ' <a href="https://t.me/' + JH.esc(handle) + '" target="_blank" rel="noopener" style="color:var(--text-muted);font-size:0.78rem">@' + JH.esc(handle) + '</a>';
        }
        return name;
      }).join(' &middot; ');
      pendingHtml += '</div>';
    } else {
      pendingHtml += '<div class="dietary-empty">Everyone has filled in their dietary preferences. 🎉</div>';
    }
    document.getElementById('dietary-unspecified').innerHTML = pendingHtml;
  }

  document.getElementById('dietary-summary').addEventListener('click', function (e) {
    var tile = e.target.closest('.dietary-tile');
    if (!tile) return;
    var type = tile.dataset.type;
    var wasActive = tile.classList.contains('active');
    document.querySelectorAll('.dietary-tile').forEach(function (t) { t.classList.remove('active'); });
    var details = document.getElementById('dietary-details');
    if (wasActive) {
      details.style.display = 'none';
      details.innerHTML = '';
      return;
    }
    tile.classList.add('active');
    var list = (dietaryByType[type] || []).slice().sort(function (a, b) {
      return memberDisplayName(a).localeCompare(memberDisplayName(b));
    });
    var inner = '<div class="dietary-section-title">' + JH.esc(type) + ' &middot; ' + list.length + '</div>';
    if (list.length) {
      inner += list.map(function (m) {
        var notes = JH.val(m, 'DietaryNotes');
        var name = JH.esc(memberDisplayName(m));
        return notes ? name + ' <span style="color:var(--text-muted);font-size:0.82rem">(' + JH.esc(notes) + ')</span>' : name;
      }).join(' &middot; ');
    } else {
      inner += '<div class="dietary-empty">Nobody in this category.</div>';
    }
    details.innerHTML = '<div class="dietary-details-card">' + inner + '</div>';
    details.style.display = '';
  });

  // ── Reload and render ─────────────────────────────────────────────────────

  async function reload() {
    await fetchData();
    // Show admin controls only after fetch confirms edit rights
    document.getElementById('admin-controls').style.display = canEdit ? '' : 'none';
    // Sync headcount counter label with current approved count (members may update)
    document.getElementById('approved-count').textContent = approvedCount();
    renderDateFilter();
    renderHeadcountChart();
    renderMeals();
    renderShoppingList();
    renderPrepAhead();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  // Set up headcount counter
  state.headcount = approvedCount() || 30;
  var hcInput = document.getElementById('headcount-input');
  document.getElementById('approved-count').textContent = approvedCount();
  hcInput.value = state.headcount;
  hcInput.addEventListener('input', function () {
    var n = parseInt(hcInput.value, 10);
    state.headcount = (!isNaN(n) && n > 0) ? n : approvedCount();
    renderMeals(); renderShoppingList(); renderPrepAhead();
  });
  document.getElementById('headcount-reset').addEventListener('click', function () {
    state.headcount = approvedCount() || 30; hcInput.value = state.headcount;
    renderMeals(); renderShoppingList(); renderPrepAhead();
  });

  renderDietaryPanel();
  await reload();

})();
