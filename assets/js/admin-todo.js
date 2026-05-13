(async function () {
  var members = await JH.authenticate();
  if (members === null) return;

  var approvedMembers = [
    'Alex', 'Alessia', 'Benergy', 'Blossom', 'Camille', 'Claudiu',
    'Dima', 'Edward', 'Emil', 'Engineer Dave', 'Esben', 'Flipper',
    'Frank', 'Goutiere', 'James', 'Jo', 'KitKat', 'Olivia',
    'Raphael', 'Sara', 'Yona',
  ];

  var WEEKS = [
    'Week 1 — Apr 27–May 3',
    'Week 2 — May 4–10',
    'Week 3 — May 11–17',
    'Week 4 — May 18–24',
    'Week 5 — May 25–31',
    'Week 6 — Jun 1–7',
    'Week 7 — Jun 8–14',
    'Week 8 — Jun 15–20',
    'On-site',
  ];

  var SEED_TASKS = [
    { week: 'Week 1 — Apr 27–May 3', task: 'Kick off speaker research — specs, mixer compatibility, prices' },
    { week: 'Week 1 — Apr 27–May 3', task: 'Price van rental Barcelona–Zaragoza' },
    { week: 'Week 1 — Apr 27–May 3', task: 'Get pillow inventory and add it to the portal' },
    { week: 'Week 1 — Apr 27–May 3', task: 'Launch social media advertising campaign' },
    { week: 'Week 1 — Apr 27–May 3', task: 'Publish low income application form with payment account number' },
    { week: 'Week 1 — Apr 27–May 3', task: 'Start kitchen lead outreach' },
    { week: 'Week 1 — Apr 27–May 3', task: 'Start carpet sourcing on Wallapop (ongoing 3 weeks)' },
    { week: 'Week 2 — May 4–10', task: 'Finalize speaker choice and place order (long lead buffer starts)' },
    { week: 'Week 2 — May 4–10', task: 'Design staff specifications' },
    { week: 'Week 2 — May 4–10', task: 'Order wood and bins' },
    { week: 'Week 2 — May 4–10', task: 'Assess freezer capacity; price new freezer plus fridge' },
    { week: 'Week 2 — May 4–10', task: 'Continue carpet sourcing' },
    { week: 'Week 2 — May 4–10', task: 'Research PVC instrument builds (percussion + wind) — designs, pipe dimensions, tools needed' },
    { week: 'Week 3 — May 11–17', task: 'Map barrio design with special area (once dimensions are in)' },
    { week: 'Week 3 — May 11–17', task: 'Rethink electrical scope with Alex (load, distribution, cable runs) — depends on barrio map' },
    { week: 'Week 3 — May 11–17', task: 'Plan stage build extension — materials list, dimensions, builders, resource sourcing' },
    { week: 'Week 3 — May 11–17', task: 'Finish carpet sourcing' },
    { week: 'Week 3 — May 11–17', task: 'Order PVC piping and fittings' },
    { week: 'Week 4 — May 18–24', task: 'Begin welded trailer project (weld vs buy, source materials, find welder)' },
    { week: 'Week 4 — May 18–24', task: 'Instrument repairs: bass guitar, bongos and other percussion, guitar string changes' },
    { week: 'Week 4 — May 18–24', task: 'PVC instrument build session — percussion and wind (camp social build)' },
    { week: 'Week 4 — May 18–24', task: 'Order perishables (nuts, bolts, kitchen consumables)' },
    { week: 'Week 4 — May 18–24', task: 'Finalize electrical materials order with Alex' },
    { week: 'Week 5 — May 25–31', task: 'Dedicated pillow day — production and stuffing' },
    { week: 'Week 5 — May 25–31', task: 'Finalize paint plan — surfaces, materials, colors (procurement only; painting happens on-site)' },
    { week: 'Week 5 — May 25–31', task: 'Order final stage extension materials' },
    { week: 'Week 5 — May 25–31', task: 'Buffer for any unfinished PVC instrument work' },
    { week: 'Week 6 — Jun 1–7', task: 'Trailer welding work' },
    { week: 'Week 6 — Jun 1–7', task: 'First batch cooking session — jam and food' },
    { week: 'Week 6 — Jun 1–7', task: 'Speaker delivery expected this week; test with mixer' },
    { week: 'Week 7 — Jun 8–14', task: 'Second batch cooking session' },
    { week: 'Week 7 — Jun 8–14', task: 'Full audio setup test end-to-end' },
    { week: 'Week 7 — Jun 8–14', task: 'Finalize pre-departure buildout' },
    { week: 'Week 7 — Jun 8–14', task: 'Confirm van booking' },
    { week: 'Week 8 — Jun 15–20', task: 'Final batch cook if needed' },
    { week: 'Week 8 — Jun 15–20', task: 'Pack everything (paint supplies, stage extension materials, electrical kit, PVC instruments, pillows, carpets, instruments, kitchen gear)' },
    { week: 'Week 8 — Jun 15–20', task: 'Load van' },
    { week: 'Week 8 — Jun 15–20', task: 'Final checks on trailer, audio, instruments, pillows, kitchen supplies' },
    { week: 'On-site', task: 'Help Noorg with festival setup (arrive earlier)' },
    { week: 'On-site', task: 'Container painting' },
    { week: 'On-site', task: 'Stage build extension' },
    { week: 'On-site', task: 'Full barrio build' },
    { week: 'On-site', task: 'Electrical install with Alex' },
  ];

  var CATEGORIES = ['General', 'Construction', 'Kitchen', 'Deco', 'Events'];
  var state = { tasks: [], view: 'list', categoryFilter: '' };
  var chart = null;
  var dragTaskId = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function makeId() {
    return 'todo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  }

  function isDone(t) { return t.Done === 'true'; }

  function weekIndex(w) {
    var i = WEEKS.indexOf(w);
    return i === -1 ? 999 : i;
  }

  function formatWeek(w) {
    return (w || '').replace(' \u2014 ', ' | ');
  }

  function tasksByPerson() {
    var map = { Unassigned: { open: 0, done: 0 } };
    approvedMembers.forEach(function (m) { map[m] = { open: 0, done: 0 }; });
    state.tasks.forEach(function (t) {
      var key = t.Responsible && approvedMembers.indexOf(t.Responsible) !== -1 ? t.Responsible : 'Unassigned';
      if (isDone(t)) map[key].done++; else map[key].open++;
    });
    return map;
  }

  function memberSelect(currentVal, includeUnassigned) {
    var opts = includeUnassigned !== false ? '<option value="">Unassigned</option>' : '';
    approvedMembers.forEach(function (m) {
      opts += '<option value="' + JH.esc(m) + '"' + (m === currentVal ? ' selected' : '') + '>' + JH.esc(m) + '</option>';
    });
    return opts;
  }

  function categorySelect(currentVal) {
    return CATEGORIES.map(function (c) {
      return '<option value="' + c + '"' + (c === (currentVal || 'General') ? ' selected' : '') + '>' + c + '</option>';
    }).join('');
  }

  function taskCategory(t) { return t.Category || 'General'; }

  function weekSelect(currentVal) {
    return WEEKS.map(function (w) {
      return '<option value="' + JH.esc(w) + '"' + (w === currentVal ? ' selected' : '') + '>' + JH.esc(formatWeek(w)) + '</option>';
    }).join('');
  }

  // ── API calls ──────────────────────────────────────────────────────────────

  async function apiFetch(body) {
    var res = await JH.apiFetch('/api/todo', body);
    if (!res.ok) {
      var err = {};
      try { err = await res.json(); } catch (e) {}
      console.error('[ToDo] API error', res.status, err);
      return err;
    }
    return res.json();
  }

  async function loadTasks() {
    var data = await apiFetch({});
    state.tasks = data.tasks || [];

    if (state.tasks.length === 0) {
      // Populate state immediately from seed data so UI shows tasks right away
      state.tasks = SEED_TASKS.map(function (t) {
        return { Id: makeId(), Task: t.task, Week: t.week, Responsible: '', Done: 'false' };
      });

      // Persist to sheet in background sequentially to avoid Sheets API rate limits
      (async function () {
        var toSave = state.tasks.slice();
        for (var i = 0; i < toSave.length; i++) {
          var t = toSave[i];
          try {
            await JH.apiFetch('/api/todo', { action: 'add', id: t.Id, task: t.Task, week: t.Week, responsible: '', done: 'false' });
          } catch (e) { console.error('[ToDo] seed add failed', e); }
        }
        console.log('[ToDo] Seed complete.');
      })();
    }
  }

  async function saveTask(taskObj) {
    await apiFetch({ action: taskObj._isNew ? 'add' : 'update', id: taskObj.Id, task: taskObj.Task, week: taskObj.Week, responsible: taskObj.Responsible, done: taskObj.Done, category: taskObj.Category || 'General' });
  }

  async function deleteTask(id) {
    await apiFetch({ action: 'delete', id: id });
    state.tasks = state.tasks.filter(function (t) { return t.Id !== id; });
  }

  // ── Chart ──────────────────────────────────────────────────────────────────

  function renderChart() {
    var filteredTasks = state.categoryFilter
      ? state.tasks.filter(function (t) { return taskCategory(t) === state.categoryFilter; })
      : state.tasks;

    var map = { Unassigned: { open: 0, done: 0 } };
    approvedMembers.forEach(function (m) { map[m] = { open: 0, done: 0 }; });
    filteredTasks.forEach(function (t) {
      var key = t.Responsible && approvedMembers.indexOf(t.Responsible) !== -1 ? t.Responsible : 'Unassigned';
      if (isDone(t)) map[key].done++; else map[key].open++;
    });

    var allLabels = ['Unassigned'].concat(approvedMembers);
    var labels = state.categoryFilter
      ? allLabels.filter(function (l) { return map[l].open + map[l].done > 0; })
      : allLabels;

    var openData = labels.map(function (l) { return map[l] ? map[l].open : 0; });
    var doneData = labels.map(function (l) { return map[l] ? map[l].done : 0; });

    var ctx = document.getElementById('todo-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Open', data: openData, backgroundColor: 'rgba(232,168,76,0.75)', borderColor: 'rgba(232,168,76,1)', borderWidth: 1, borderRadius: 3 },
          { label: 'Done', data: doneData, backgroundColor: 'rgba(76,175,80,0.65)', borderColor: 'rgba(76,175,80,1)', borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e8e4df', font: { family: 'Outfit' } } } },
        scales: {
          x: { stacked: true, ticks: { color: '#8a8580', font: { family: 'Outfit', size: 11 }, maxRotation: 45, minRotation: 45, autoSkip: false }, grid: { color: '#2a2a2a' } },
          y: { stacked: true, ticks: { color: '#8a8580', font: { family: 'Outfit' }, stepSize: 1 }, grid: { color: '#2a2a2a' }, beginAtZero: true },
        },
      },
    });
  }

  // ── List view ──────────────────────────────────────────────────────────────

  function renderListView() {
    var sorted = state.tasks.slice().sort(function (a, b) { return weekIndex(a.Week) - weekIndex(b.Week); });
    var grouped = {};
    var weekOrder = [];
    sorted.forEach(function (t) {
      if (!grouped[t.Week]) { grouped[t.Week] = []; weekOrder.push(t.Week); }
      grouped[t.Week].push(t);
    });

    var html = '<div class="todo-toolbar"><button id="btn-add-task" class="btn-primary">+ Add Task</button></div>';
    html += '<div class="todo-table-wrap"><table class="todo-table"><thead><tr><th>Task</th><th>Week</th><th>Responsible</th><th>Category</th><th class="col-done">Done</th><th></th></tr></thead><tbody>';

    weekOrder.forEach(function (week) {
      html += '<tr class="week-row"><td colspan="6">' + JH.esc(formatWeek(week)) + '</td></tr>';
      grouped[week].forEach(function (t) {
        html += '<tr class="task-row' + (isDone(t) ? ' task-done' : '') + '" data-id="' + JH.esc(t.Id) + '">'
          + '<td class="col-task">' + JH.esc(t.Task) + '</td>'
          + '<td class="col-week"><select class="week-select" data-id="' + JH.esc(t.Id) + '">' + weekSelect(t.Week) + '</select></td>'
          + '<td class="col-resp"><select class="resp-select" data-id="' + JH.esc(t.Id) + '">' + memberSelect(t.Responsible) + '</select></td>'
          + '<td class="col-cat"><select class="cat-select" data-id="' + JH.esc(t.Id) + '">' + categorySelect(t.Category) + '</select></td>'
          + '<td class="col-done"><input type="checkbox" class="done-cb" data-id="' + JH.esc(t.Id) + '"' + (isDone(t) ? ' checked' : '') + '></td>'
          + '<td class="col-del"><button class="btn-del-task" data-id="' + JH.esc(t.Id) + '" title="Delete">&#10005;</button></td>'
          + '</tr>';
      });
    });

    html += '</tbody></table></div>';
    document.getElementById('todo-view').innerHTML = html;

    document.getElementById('btn-add-task').addEventListener('click', openModal);

    document.querySelectorAll('.week-select').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        var id = this.dataset.id;
        var t = state.tasks.find(function (x) { return x.Id === id; });
        if (!t) return;
        t.Week = this.value;
        await saveTask(t);
        render();
      });
    });

    document.querySelectorAll('.resp-select').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        var id = this.dataset.id;
        var t = state.tasks.find(function (x) { return x.Id === id; });
        if (!t) return;
        t.Responsible = this.value;
        await saveTask(t);
        renderChart();
      });
    });

    document.querySelectorAll('.cat-select').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        var id = this.dataset.id;
        var t = state.tasks.find(function (x) { return x.Id === id; });
        if (!t) return;
        t.Category = this.value;
        await saveTask(t);
      });
    });

    document.querySelectorAll('.done-cb').forEach(function (cb) {
      cb.addEventListener('change', async function () {
        var id = this.dataset.id;
        var t = state.tasks.find(function (x) { return x.Id === id; });
        if (!t) return;
        t.Done = this.checked ? 'true' : 'false';
        await saveTask(t);
        this.closest('tr').classList.toggle('task-done', this.checked);
        renderChart();
      });
    });

    document.querySelectorAll('.btn-del-task').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete this task?')) return;
        await deleteTask(this.dataset.id);
        render();
      });
    });
  }

  // ── Kanban view ────────────────────────────────────────────────────────────

  function renderKanbanView() {
    var visibleTasks = state.categoryFilter
      ? state.tasks.filter(function (t) { return taskCategory(t) === state.categoryFilter; })
      : state.tasks;

    // If filter active, only show columns that have tasks
    var allColumns = ['Unassigned'].concat(approvedMembers);
    var columns = state.categoryFilter
      ? allColumns.filter(function (col) {
          return visibleTasks.some(function (t) {
            if (col === 'Unassigned') return !t.Responsible || approvedMembers.indexOf(t.Responsible) === -1;
            return t.Responsible === col;
          });
        })
      : allColumns;
    if (columns.length === 0) columns = ['Unassigned'];

    var html = '<div class="kanban-toolbar"><button id="btn-add-task-kb" class="btn-primary">+ Add Task</button></div>';
    html += '<div class="kanban-board">';

    columns.forEach(function (col) {
      var colTasks = visibleTasks.filter(function (t) {
        if (col === 'Unassigned') return !t.Responsible || approvedMembers.indexOf(t.Responsible) === -1;
        return t.Responsible === col;
      });
      var openCount = colTasks.filter(function (t) { return !isDone(t); }).length;
      var doneCount = colTasks.filter(function (t) { return isDone(t); }).length;

      html += '<div class="kanban-col" data-col="' + JH.esc(col) + '">'
        + '<div class="kanban-col-header"><span class="kanban-col-name">' + JH.esc(col) + '</span>'
        + '<span class="kanban-col-count">' + openCount + ' open' + (doneCount ? ' · ' + doneCount + ' done' : '') + '</span></div>'
        + '<div class="kanban-cards" data-col="' + JH.esc(col) + '">';

      colTasks.sort(function (a, b) { return weekIndex(a.Week) - weekIndex(b.Week); }).forEach(function (t) {
        html += '<div class="kanban-card' + (isDone(t) ? ' task-done' : '') + '" draggable="true" data-id="' + JH.esc(t.Id) + '">'
          + '<select class="week-select-kb" data-id="' + JH.esc(t.Id) + '">' + weekSelect(t.Week) + '</select>'
          + '<div class="kanban-card-task">' + JH.esc(t.Task) + '</div>'
          + '<div class="kanban-card-footer">'
          + '<select class="resp-select-kb" data-id="' + JH.esc(t.Id) + '">' + memberSelect(t.Responsible) + '</select>'
          + '<label class="done-label" title="Mark done"><input type="checkbox" class="done-cb-kb" data-id="' + JH.esc(t.Id) + '"' + (isDone(t) ? ' checked' : '') + '> Done</label>'
          + '<button class="btn-del-task" data-id="' + JH.esc(t.Id) + '" title="Delete">&#10005;</button>'
          + '</div></div>';
      });

      html += '</div></div>';
    });

    html += '</div>';
    document.getElementById('todo-view').innerHTML = html;

    document.getElementById('btn-add-task-kb').addEventListener('click', openModal);

    // Drag and drop
    document.querySelectorAll('.kanban-card').forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        dragTaskId = this.dataset.id;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', function () {
        this.classList.remove('dragging');
        document.querySelectorAll('.kanban-cards').forEach(function (c) { c.classList.remove('drag-over'); });
      });
    });

    document.querySelectorAll('.kanban-cards').forEach(function (zone) {
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', function () { this.classList.remove('drag-over'); });
      zone.addEventListener('drop', async function (e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        if (!dragTaskId) return;
        var col = this.dataset.col;
        var t = state.tasks.find(function (x) { return x.Id === dragTaskId; });
        if (!t) return;
        t.Responsible = col === 'Unassigned' ? '' : col;
        await saveTask(t);
        dragTaskId = null;
        render();
      });
    });

    // Week dropdowns
    document.querySelectorAll('.week-select-kb').forEach(function (sel) {
      sel.addEventListener('change', async function (e) {
        e.stopPropagation();
        var id = this.dataset.id;
        var t = state.tasks.find(function (x) { return x.Id === id; });
        if (!t) return;
        t.Week = this.value;
        await saveTask(t);
        render();
      });
    });

    // Inline responsible dropdowns
    document.querySelectorAll('.resp-select-kb').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        var id = this.dataset.id;
        var t = state.tasks.find(function (x) { return x.Id === id; });
        if (!t) return;
        t.Responsible = this.value;
        await saveTask(t);
        render();
      });
    });

    // Done checkboxes
    document.querySelectorAll('.done-cb-kb').forEach(function (cb) {
      cb.addEventListener('change', async function () {
        var id = this.dataset.id;
        var t = state.tasks.find(function (x) { return x.Id === id; });
        if (!t) return;
        t.Done = this.checked ? 'true' : 'false';
        await saveTask(t);
        renderChart();
        render();
      });
    });

    // Delete buttons
    document.querySelectorAll('.btn-del-task').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete this task?')) return;
        await deleteTask(this.dataset.id);
        render();
      });
    });
  }

  // ── Modal ──────────────────────────────────────────────────────────────────

  function openModal(prefillResponsible) {
    document.getElementById('modal-task-name').value = '';
    document.getElementById('modal-week').innerHTML = weekSelect('');
    document.getElementById('modal-responsible').innerHTML = memberSelect(typeof prefillResponsible === 'string' ? prefillResponsible : '');
    document.getElementById('todo-modal').classList.add('active');
    document.getElementById('modal-task-name').focus();
  }

  document.querySelectorAll('.cat-filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.cat-filter-btn').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      state.categoryFilter = this.dataset.cat;
      if (state.view === 'kanban') render();
    });
  });

  document.getElementById('modal-save').addEventListener('click', async function () {
    var name = document.getElementById('modal-task-name').value.trim();
    if (!name) { alert('Please enter a task name.'); return; }
    var week = document.getElementById('modal-week').value;
    var responsible = document.getElementById('modal-responsible').value;
    var category = document.getElementById('modal-category').value;
    var newTask = { Id: makeId(), Task: name, Week: week, Responsible: responsible, Done: 'false', Category: category, _isNew: true };
    state.tasks.push(newTask);
    await saveTask(newTask);
    document.getElementById('todo-modal').classList.remove('active');
    render();
  });

  document.getElementById('modal-cancel').addEventListener('click', function () {
    document.getElementById('todo-modal').classList.remove('active');
  });

  document.getElementById('todo-modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('active');
  });

  // ── View toggle ────────────────────────────────────────────────────────────

  document.getElementById('btn-view-list').addEventListener('click', function () {
    state.view = 'list';
    this.classList.add('active');
    document.getElementById('btn-view-kanban').classList.remove('active');
    render();
  });

  document.getElementById('btn-view-kanban').addEventListener('click', function () {
    state.view = 'kanban';
    this.classList.add('active');
    document.getElementById('btn-view-list').classList.remove('active');
    render();
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  function render() {
    renderChart();
    if (state.view === 'list') renderListView();
    else renderKanbanView();
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  document.getElementById('todo-loading').style.display = 'block';
  document.getElementById('todo-main').style.display = 'none';

  await loadTasks();

  document.getElementById('todo-loading').style.display = 'none';
  document.getElementById('todo-main').style.display = 'block';

  render();
})();
