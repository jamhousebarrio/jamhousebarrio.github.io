(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var writePass = sessionStorage.getItem('jh_pass');

  var state = { meals: [], ingredients: [], logistics: [] };
  var activeFilter = 'all';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getHeadcount(dateStr) {
    return state.logistics.filter(function (l) {
      if (!l.ArrivalDate || !l.DepartureDate) return false;
      return l.ArrivalDate <= dateStr && l.DepartureDate >= dateStr;
    }).length;
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
    var res = await fetch('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
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
    state.logistics.forEach(function (l) {
      if (!l.ArrivalDate || !l.DepartureDate) return;
      var d = new Date(l.ArrivalDate + 'T00:00:00');
      var end = new Date(l.DepartureDate + 'T00:00:00');
      while (d <= end) {
        var ds = d.toISOString().slice(0, 10);
        dateSet[ds] = true;
        d.setDate(d.getDate() + 1);
      }
    });
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
      html += '<button class="date-btn' + (activeFilter === d ? ' active' : '') + '" data-date="' + esc(d) + '">' + esc(formatDate(d)) + '</button>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.date-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeFilter = btn.dataset.date;
        renderDateFilter();
        renderMeals();
      });
    });
  }

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
      html += '<div class="meals-date-heading">' + esc(formatDate(dateStr)) +
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

        html += '<div class="meal-card" data-meal-id="' + esc(meal.MealID) + '">';
        html += '<div class="meal-card-header">';
        html += '<div class="meal-card-title">';
        html += '<h3>' + esc(meal.Name) + '</h3>';
        html += '<span class="meal-type-badge ' + badgeClass + '">' + esc(meal.MealType || 'other') + '</span>';
        html += '</div>';
        if (isAdmin) {
          html += '<div class="meal-card-actions">';
          html += '<button class="btn-secondary btn-sm edit-meal-btn" data-meal-id="' + esc(meal.MealID) + '">Edit</button>';
          html += '<button class="btn-danger btn-sm delete-meal-btn" data-meal-id="' + esc(meal.MealID) + '">Delete</button>';
          html += '</div>';
        }
        html += '</div>';

        if (meal.Description) {
          html += '<p class="meal-desc">' + esc(meal.Description) + '</p>';
        }

        if (meal.Instructions) {
          html += '<button class="instructions-toggle" data-meal-id="' + esc(meal.MealID) + '">Show instructions</button>';
          html += '<div class="instructions-text" id="instructions-' + esc(meal.MealID) + '" style="display:none">' + esc(meal.Instructions) + '</div>';
        }

        html += '<div class="ingredients-section">';
        html += '<div class="ingredients-header"><span>Ingredients</span>';
        if (isAdmin) {
          html += '<button class="btn-secondary btn-sm add-ingredient-btn" data-meal-id="' + esc(meal.MealID) + '">+ Add Ingredient</button>';
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
            html += '<td>' + esc(ing.Name) + '</td>';
            html += '<td>' + esc(ing.Quantity) + '</td>';
            html += '<td><strong>' + esc(totalStr) + '</strong></td>';
            html += '<td>' + esc(ing.Unit) + '</td>';
            if (isAdmin) {
              html += '<td><div class="ing-actions">' +
                '<button class="btn-icon edit-ingredient-btn" data-ingredient-id="' + esc(ing.IngredientID) + '" data-meal-id="' + esc(ing.MealID) + '" title="Edit">&#9998;</button>' +
                '<button class="btn-icon danger delete-ingredient-btn" data-ingredient-id="' + esc(ing.IngredientID) + '" title="Delete">&#10005;</button>' +
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
    bindMealCardEvents();
  }

  // ── Bind meal card events ─────────────────────────────────────────────────

  function bindMealCardEvents() {
    // Instructions toggle
    document.querySelectorAll('.instructions-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mealId = btn.dataset.mealId;
        var textEl = document.getElementById('instructions-' + mealId);
        if (!textEl) return;
        var visible = textEl.style.display !== 'none';
        textEl.style.display = visible ? 'none' : '';
        btn.textContent = visible ? 'Show instructions' : 'Hide instructions';
      });
    });

    if (!isAdmin) return;

    // Edit meal
    document.querySelectorAll('.edit-meal-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var meal = state.meals.find(function (m) { return m.MealID === btn.dataset.mealId; });
        if (!meal) return;
        openMealModal(meal);
      });
    });

    // Delete meal
    document.querySelectorAll('.delete-meal-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete meal "' + btn.dataset.mealId + '" and all its ingredients?')) return;
        var r = await fetch('/api/meals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: writePass, action: 'delete-meal', mealId: btn.dataset.mealId }),
        });
        if (!r.ok) { alert('Action failed. Please try again.'); return; }
        await reload();
      });
    });

    // Add ingredient
    document.querySelectorAll('.add-ingredient-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openIngredientModal(null, btn.dataset.mealId);
      });
    });

    // Edit ingredient
    document.querySelectorAll('.edit-ingredient-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ing = state.ingredients.find(function (i) { return i.IngredientID === btn.dataset.ingredientId; });
        if (!ing) return;
        openIngredientModal(ing, ing.MealID);
      });
    });

    // Delete ingredient
    document.querySelectorAll('.delete-ingredient-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete this ingredient?')) return;
        var r = await fetch('/api/meals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: writePass, action: 'delete-ingredient', ingredientId: btn.dataset.ingredientId }),
        });
        if (!r.ok) { alert('Action failed. Please try again.'); return; }
        await reload();
      });
    });
  }

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
    var r = await fetch('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: writePass,
        action: 'upsert-meal',
        mealId: mealId,
        name: name,
        date: date,
        mealType: document.getElementById('meal-type').value,
        description: document.getElementById('meal-desc').value,
        instructions: document.getElementById('meal-instructions').value,
      }),
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
    var r = await fetch('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: writePass,
        action: 'upsert-ingredient',
        ingredientId: ingredientId,
        mealId: mealId,
        name: name,
        quantity: quantity,
        unit: unit,
      }),
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
      html += '<td>' + esc(item.name) + '</td>';
      html += '<td class="total-col">' + esc(totalDisplay) + '</td>';
      html += '<td style="font-size:0.78rem;color:var(--text-muted)">' + esc(item.meals.join(', ')) + '</td>';
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
      html += '<h2 class="print-meal-title">' + esc(meal.Name) + '</h2>';
      html += '<div class="print-meal-meta">' + esc(dateLabel) + ' &middot; ' + esc(typeLabel) + '</div>';
      html += '<div class="print-headcount">' + headcount + ' people</div>';

      if (meal.Description) {
        html += '<p class="print-meal-desc">' + esc(meal.Description) + '</p>';
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
          html += '<td>' + esc(ing.Name) + '</td>';
          html += '<td class="num">' + esc(qtyStr) + '</td>';
          html += '<td class="num" style="font-size:14px">' + esc(totalStr) + '</td>';
          html += '<td>' + esc(ing.Unit) + '</td>';
          html += '</tr>';
        });

        html += '</tbody></table>';
      }

      if (meal.Instructions) {
        html += '<div class="print-section-title">Instructions</div>';
        html += '<div class="print-instructions">' + esc(meal.Instructions) + '</div>';
      }

      html += '</div>';
    });

    container.innerHTML = html;
    window.print();
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

  await reload();

})();
