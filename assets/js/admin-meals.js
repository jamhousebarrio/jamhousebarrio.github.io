(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();

  var state = { meals: [], ingredients: [], logistics: [] };
  var activeFilter = 'all';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getHeadcount(dateStr) {
    return JH.getHeadcount(state.logistics, dateStr);
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

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await JH.apiFetch('/api/meals', {});
    if (!res.ok) { console.error('meals fetch failed'); return; }
    var data = await res.json();
    state.meals = data.meals || [];
    state.ingredients = data.ingredients || [];
    state.logistics = data.logistics || [];
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

  // ── Render meal cards ─────────────────────────────────────────────────────

  function renderMeals() {
    var wrap = document.getElementById('meals-wrap');
    var dates = uniqueSortedDates();

    if (!dates.length) {
      wrap.innerHTML = '<div class="empty-state">No meals planned yet.' +
        (isAdmin ? ' Use "+ Add Meal" to get started.' : ' Check back later.') + '</div>';
      return;
    }

    var filteredDates = activeFilter === 'all' ? dates : dates.filter(function (d) { return d === activeFilter; });

    if (!filteredDates.length) {
      wrap.innerHTML = '<div class="empty-state">No meals for the selected date.</div>';
      return;
    }

    var html = '';
    filteredDates.forEach(function (dateStr) {
      var headcount = getHeadcount(dateStr);
      var dayMeals = state.meals.filter(function (m) { return m.Date === dateStr; });
      var mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'];
      dayMeals = dayMeals.slice().sort(function (a, b) {
        var ai = mealOrder.indexOf((a.MealType || '').toLowerCase());
        var bi = mealOrder.indexOf((b.MealType || '').toLowerCase());
        if (ai === -1) ai = 99;
        if (bi === -1) bi = 99;
        return ai - bi;
      });

      // Check which meal slots are covered
      var slots = ['breakfast', 'lunch', 'dinner'];
      var slotLabels = { breakfast: 'B', lunch: 'L', dinner: 'D' };
      var covered = {};
      slots.forEach(function (s) {
        covered[s] = dayMeals.some(function (m) { return (m.MealType || '').toLowerCase() === s; });
      });

      html += '<div class="meals-date-group">';
      html += '<div class="meals-date-heading">' + JH.esc(formatDate(dateStr)) +
        '<span class="headcount-note">' + headcount + ' people</span>';
      html += '<span class="meal-slots">';
      slots.forEach(function (s) {
        var cls = covered[s] ? 'slot-ok' : 'slot-missing';
        html += '<span class="meal-slot ' + cls + '" title="' + s.charAt(0).toUpperCase() + s.slice(1) + (covered[s] ? ' - planned' : ' - not planned') + '">' + slotLabels[s] + '</span>';
      });
      html += '</span>';
      html += '</div>';
      html += '<div class="meal-cards">';

      dayMeals.forEach(function (meal) {
        var mealIngredients = state.ingredients.filter(function (i) { return i.MealID === meal.MealID; });
        var badgeClass = mealTypeBadgeClass(meal.MealType);

        html += '<div class="meal-card" data-meal-id="' + JH.esc(meal.MealID) + '">';
        html += '<div class="meal-card-header">';
        html += '<div class="meal-card-title">';
        html += '<h3>' + JH.esc(meal.Name) + '</h3>';
        html += '<span class="meal-type-badge ' + badgeClass + '">' + JH.esc(meal.MealType || 'other') + '</span>';
        html += '</div>';
        if (isAdmin) {
          html += '<div class="meal-card-actions">';
          html += '<button class="btn-secondary btn-sm edit-meal-btn" data-meal-id="' + JH.esc(meal.MealID) + '">Edit</button>';
          html += '<button class="btn-danger btn-sm delete-meal-btn" data-meal-id="' + JH.esc(meal.MealID) + '">Delete</button>';
          html += '</div>';
        }
        html += '</div>';

        if (meal.Description) {
          html += '<p class="meal-desc">' + JH.esc(meal.Description) + '</p>';
        }

        if (meal.Instructions) {
          html += '<button class="instructions-toggle" data-meal-id="' + JH.esc(meal.MealID) + '">Show instructions</button>';
          html += '<div class="instructions-text" id="instructions-' + JH.esc(meal.MealID) + '" style="display:none">' + JH.esc(meal.Instructions) + '</div>';
        }

        html += '<div class="ingredients-section">';
        html += '<div class="ingredients-header"><span>Ingredients</span>';
        if (isAdmin) {
          html += '<button class="btn-secondary btn-sm add-ingredient-btn" data-meal-id="' + JH.esc(meal.MealID) + '">+ Add Ingredient</button>';
        }
        html += '</div>';

        if (mealIngredients.length) {
          html += '<table class="ingredients-table"><thead><tr>';
          html += '<th>Name</th><th>Qty/person</th><th>Total (' + headcount + ' people)</th><th>Unit</th>';
          if (isAdmin) html += '<th></th>';
          html += '</tr></thead><tbody>';

          mealIngredients.forEach(function (ing) {
            var qty = parseFloat(ing.Quantity) || 0;
            var total = qty * headcount;
            // Round to reasonable precision
            var totalStr = total === Math.floor(total) ? String(total) : total.toFixed(2).replace(/\.?0+$/, '');
            html += '<tr>';
            html += '<td>' + JH.esc(ing.Name) + '</td>';
            html += '<td>' + JH.esc(ing.Quantity) + '</td>';
            html += '<td><strong>' + JH.esc(totalStr) + '</strong></td>';
            html += '<td>' + JH.esc(ing.Unit) + '</td>';
            if (isAdmin) {
              html += '<td><div class="ing-actions">' +
                '<button class="btn-icon edit-ingredient-btn" data-ingredient-id="' + JH.esc(ing.IngredientID) + '" data-meal-id="' + JH.esc(ing.MealID) + '" title="Edit">&#9998;</button>' +
                '<button class="btn-icon danger delete-ingredient-btn" data-ingredient-id="' + JH.esc(ing.IngredientID) + '" title="Delete">&#10005;</button>' +
                '</div></td>';
            }
            html += '</tr>';
          });

          html += '</tbody></table>';
        } else {
          html += '<div style="font-size:0.82rem;color:var(--text-muted);padding:6px 0">No ingredients added yet.</div>';
        }

        html += '</div>'; // ingredients-section
        html += '</div>'; // meal-card
      });

      html += '</div>'; // meal-cards
      html += '</div>'; // meals-date-group
    });

    wrap.innerHTML = html;
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

    if (!isAdmin) return;

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

  // ── Meal modal ────────────────────────────────────────────────────────────

  var editingMealId = null;

  function openMealModal(meal) {
    editingMealId = meal ? meal.MealID : null;
    document.getElementById('meal-modal-title').childNodes[0].textContent = meal ? 'Edit Meal ' : 'Add Meal ';
    document.getElementById('meal-name').value = meal ? meal.Name : '';
    document.getElementById('meal-date').value = meal ? meal.Date : '';
    document.getElementById('meal-type').value = meal ? (meal.MealType || 'dinner') : 'dinner';
    document.getElementById('meal-desc').value = meal ? meal.Description : '';
    document.getElementById('meal-instructions').value = meal ? meal.Instructions : '';
    document.getElementById('meal-modal').classList.add('active');
  }

  document.getElementById('btn-add-meal').addEventListener('click', function () {
    openMealModal(null);
  });

  document.getElementById('meal-save-btn').addEventListener('click', async function () {
    var name = document.getElementById('meal-name').value.trim();
    var date = document.getElementById('meal-date').value.trim();
    if (!name || !date) { alert('Name and date are required.'); return; }
    var mealId = editingMealId || (date + '-' + (document.getElementById('meal-type').value || 'dinner'));
    var btn = this;
    btn.textContent = 'Saving...';
    btn.disabled = true;
    var r = await JH.apiFetch('/api/meals', {
      action: 'upsert-meal',
      mealId: mealId,
      name: name,
      date: date,
      mealType: document.getElementById('meal-type').value,
      description: document.getElementById('meal-desc').value,
      instructions: document.getElementById('meal-instructions').value,
    });
    btn.textContent = 'Save Meal';
    btn.disabled = false;
    if (!r.ok) { alert('Action failed. Please try again.'); return; }
    document.getElementById('meal-modal').classList.remove('active');
    await reload();
  });

  // ── Ingredient modal ──────────────────────────────────────────────────────

  function openIngredientModal(ing, mealId) {
    document.getElementById('ingredient-modal-title').childNodes[0].textContent = ing ? 'Edit Ingredient ' : 'Add Ingredient ';
    document.getElementById('ingredient-id').value = ing ? ing.IngredientID : '';
    document.getElementById('ingredient-meal-id').value = mealId || '';
    document.getElementById('ingredient-name').value = ing ? ing.Name : '';
    document.getElementById('ingredient-quantity').value = ing ? ing.Quantity : '';
    document.getElementById('ingredient-unit').value = ing ? ing.Unit : '';
    document.getElementById('ingredient-modal').classList.add('active');
  }

  document.getElementById('ingredient-save-btn').addEventListener('click', async function () {
    var mealId = document.getElementById('ingredient-meal-id').value.trim();
    var name = document.getElementById('ingredient-name').value.trim();
    var ingredientId = document.getElementById('ingredient-id').value.trim() || (mealId + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    var quantity = document.getElementById('ingredient-quantity').value.trim();
    var unit = document.getElementById('ingredient-unit').value.trim();
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

    // Aggregate: for each ingredient, sum qty*headcount across all meals it appears in
    var agg = {}; // key: ingredient name → { name, unit, total, meals: [] }
    state.meals.forEach(function (meal) {
      var headcount = getHeadcount(meal.Date);
      var mealIngredients = state.ingredients.filter(function (i) { return i.MealID === meal.MealID; });
      mealIngredients.forEach(function (ing) {
        var key = (ing.Name || '').toLowerCase().trim();
        if (!key) return;
        if (!agg[key]) {
          agg[key] = { name: ing.Name, unit: ing.Unit || '', total: 0, meals: [] };
        }
        var qty = parseFloat(ing.Quantity) || 0;
        var amount = qty * headcount;
        agg[key].total += amount;
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
      var totalStr = item.total === Math.floor(item.total) ? String(item.total) : item.total.toFixed(2).replace(/\.?0+$/, '');
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

  // ── Modal close buttons ───────────────────────────────────────────────────

  document.querySelectorAll('.modal-close[data-close], .modal-actions [data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.getElementById(btn.dataset.close).classList.remove('active');
    });
  });

  // ── PDF Export ──────────────────────────────────────────────────────────

  document.getElementById('btn-export-pdf').addEventListener('click', function () {
    var container = document.getElementById('print-container');
    var dates = uniqueSortedDates();
    var mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'];

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
      var headcount = getHeadcount(meal.Date);
      var mealIngredients = state.ingredients.filter(function (i) { return i.MealID === meal.MealID; });
      var dateLabel = formatDate(meal.Date);
      var typeLabel = (meal.MealType || 'Meal').charAt(0).toUpperCase() + (meal.MealType || 'meal').slice(1);

      html += '<div class="print-meal-page">';
      html += '<div class="print-header"><h1>JamHouse 2026</h1></div>';
      html += '<h2 class="print-meal-title">' + JH.esc(meal.Name) + '</h2>';
      html += '<div class="print-meal-meta">' + JH.esc(dateLabel) + ' &middot; ' + JH.esc(typeLabel) + '</div>';
      html += '<div class="print-headcount">' + headcount + ' people</div>';

      if (meal.Description) {
        html += '<p class="print-meal-desc">' + JH.esc(meal.Description) + '</p>';
      }

      if (mealIngredients.length) {
        html += '<div class="print-section-title">Ingredients</div>';
        html += '<table class="print-ing-table"><thead><tr>';
        html += '<th>Ingredient</th><th>Per person</th><th>Total (' + headcount + 'p)</th><th>Unit</th>';
        html += '</tr></thead><tbody>';

        mealIngredients.forEach(function (ing) {
          var qty = parseFloat(ing.Quantity) || 0;
          var total = qty * headcount;
          var totalStr = total === Math.floor(total) ? String(total) : total.toFixed(2).replace(/\.?0+$/, '');
          var qtyStr = qty === Math.floor(qty) ? String(qty) : qty.toFixed(3).replace(/\.?0+$/, '');

          html += '<tr>';
          html += '<td>' + JH.esc(ing.Name) + '</td>';
          html += '<td class="num">' + JH.esc(qtyStr) + '</td>';
          html += '<td class="num" style="font-size:14px">' + JH.esc(totalStr) + '</td>';
          html += '<td>' + JH.esc(ing.Unit) + '</td>';
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
    renderDateFilter();
    renderHeadcountChart();
    renderMeals();
    renderShoppingList();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (isAdmin) document.getElementById('admin-controls').style.display = '';

  renderDietaryPanel();
  await reload();

})();
