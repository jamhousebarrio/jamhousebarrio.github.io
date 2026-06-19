(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var state = { entries: [], logistics: [], tasks: [], noOrgMap: {} };
  var taskPanelOpen = true;

  // Default tasks that need allocating
  var DEFAULT_TASKS = [
    'Noorg Volunteer', 'Water cube', 'Private shade', 'Tent shade', 'Public space',
    'Kitchen build', 'Sewage trench', 'Shower (structure)', 'Shower (water)',
    'Build branch su-chef', 'Private space decor', 'Public space decor',
    'Unloading container', 'Setting tent', 'Electricity', 'City Shopping'
  ];

  var approvedMembers = members.filter(function (m) {
    return (m['Status'] || '').toLowerCase() === 'approved';
  }).map(function (m) {
    return m['Playa Name'] || m['Name'] || '';
  }).filter(Boolean).sort();

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await JH.apiFetch('/api/timeline', {});
    if (!res.ok) { console.error('timeline fetch failed'); return; }
    var data = await res.json();
    state.entries = data.entries || [];
    state.logistics = data.logistics || [];
    state.noOrgMap = {};
    state.logistics.forEach(function (l) {
      var person = l.MemberName;
      if (!person) return;
      var dates = (l.NoOrgDates || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!dates.length) return;
      state.noOrgMap[person] = state.noOrgMap[person] || {};
      dates.forEach(function (d) { state.noOrgMap[person][d] = true; });
    });
    loadTasks();
  }

  function isNoOrg(person, date) {
    return !!(state.noOrgMap[person] && state.noOrgMap[person][date]);
  }

  function loadTasks() {
    try {
      var saved = JSON.parse(localStorage.getItem('jh_timeline_tasks'));
      if (saved && saved.length) { state.tasks = saved; return; }
    } catch (e) {}
    state.tasks = DEFAULT_TASKS.slice();
    saveTasks();
  }

  function saveTasks() {
    localStorage.setItem('jh_timeline_tasks', JSON.stringify(state.tasks));
  }

  // ── Logistics helpers ─────────────────────────────────────────────────────

  function getArrivalDate(person) {
    var row = state.logistics.find(function (l) { return l.MemberName === person; });
    return row ? row.ArrivalDate : '';
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function hasArrived(person) {
    var arrival = getArrivalDate(person);
    return !!(arrival && arrival <= todayISO());
  }

  // 'before' | 'arrival' | 'onsite' | '' (no arrival logged)
  function arrivalKind(person, date) {
    var arrival = getArrivalDate(person);
    if (!arrival) return '';
    if (date < arrival) return 'before';
    if (date === arrival) return 'arrival';
    return 'onsite';
  }

  function isAvailable(person, date) {
    var arrival = getArrivalDate(person);
    if (!arrival) return true; // no logistics info = assume available
    // Available the day AFTER arrival
    var arrDate = new Date(arrival + 'T00:00:00');
    arrDate.setDate(arrDate.getDate() + 1);
    var cellDate = new Date(date + 'T00:00:00');
    return cellDate >= arrDate;
  }

  // ── Grid dates ────────────────────────────────────────────────────────────

  function getGridDates() {
    // Always start from July 1, include any dates from entries
    var set = {};
    // Default: July 1–12
    for (var i = 1; i <= 12; i++) {
      set['2026-07-' + String(i).padStart(2, '0')] = true;
    }
    state.entries.forEach(function (e) { if (e.Date) set[e.Date] = true; });
    return Object.keys(set).sort();
  }

  function getGridPeople() {
    var set = {};
    // All approved members
    approvedMembers.forEach(function (m) { set[m] = true; });
    // Plus anyone in entries
    state.entries.forEach(function (e) { if (e.Person) set[e.Person] = true; });
    var result = [];
    approvedMembers.forEach(function (m) { if (set[m]) { result.push(m); delete set[m]; } });
    Object.keys(set).sort().forEach(function (p) { result.push(p); });
    return result;
  }

  function getTask(person, date, period) {
    var entry = state.entries.find(function (e) {
      return e.Person === person && e.Date === date && e.Period === period;
    });
    return entry ? entry.Task : '';
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderTimeline() {
    var wrap = document.getElementById('timeline-wrap');
    var dates = getGridDates();
    var people = getGridPeople();
    var periods = ['Morning', 'Evening'];

    var html = '<div class="hide-on-mobile">';
    html += '<div class="timeline-grid"><table class="timeline-table">';

    // Date header row
    html += '<thead><tr><th class="date-header" rowspan="2" style="position:sticky;left:0;z-index:3;">Person</th>';
    dates.forEach(function (d) {
      html += '<th class="date-header" colspan="2">' + JH.formatDateLong(d) + '</th>';
    });
    html += '</tr><tr>';
    dates.forEach(function () {
      periods.forEach(function (p) {
        html += '<th class="period-header">' + JH.esc(p) + '</th>';
      });
    });
    html += '</tr></thead><tbody>';

    // People rows
    people.forEach(function (person) {
      var arrival = getArrivalDate(person);
      var arrived = hasArrived(person);
      html += '<tr>';
      html += '<td class="name-cell' + (arrived ? ' arrived' : '') + '">' + JH.esc(person);
      if (arrival) {
        html += arrived
          ? '<span class="arrival-badge arrived-pill" title="On-site since ' + JH.esc(JH.formatDate(arrival)) + '">✓ On site</span>'
          : '<span class="arrival-badge future-pill">arrives ' + JH.formatDate(arrival) + '</span>';
      }
      html += '</td>';

      dates.forEach(function (date) {
        periods.forEach(function (period) {
          var task = getTask(person, date, period);
          var available = isAvailable(person, date);
          var noorg = isNoOrg(person, date);
          var kind = arrivalKind(person, date);
          var arrivalCls = kind === 'onsite' ? ' on-site' : kind === 'arrival' ? ' arrival-day' : '';
          // Show "↓ arrives" marker on the morning cell of the arrival day so it
          // doesn't duplicate across morning+evening.
          var arrivalMark = (kind === 'arrival' && period === 'Morning')
            ? '<span class="arrival-day-mark">↓ arrives</span> '
            : '';

          if (noorg) {
            html += '<td class="task-cell noorg' + arrivalCls + '" title="On NoOrg duty">NoOrg</td>';
          } else if (isAdmin && available) {
            html += '<td class="task-cell' + arrivalCls + '" data-person="' + JH.esc(person) + '" data-date="' + JH.esc(date) + '" data-period="' + JH.esc(period) + '">' + arrivalMark + JH.esc(task) + '</td>';
          } else if (!available) {
            var ttl = kind === 'arrival' ? 'Arrival day' : 'Not arrived yet';
            html += '<td class="task-cell unavailable' + arrivalCls + '" title="' + ttl + '">' + arrivalMark + JH.esc(task) + '</td>';
          } else {
            html += '<td class="' + arrivalCls.trim() + '">' + arrivalMark + JH.esc(task) + '</td>';
          }
        });
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Admin: add day/person controls
    if (isAdmin) {
      html += '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
      html += '<input type="text" id="add-date-input" placeholder="dd/mm/yyyy" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.85rem;padding:7px 10px;width:140px;">';
      html += '<button id="add-date-btn" class="btn-primary" style="padding:0.4rem 1rem;font-size:0.82rem;">+ Add Day</button>';
      html += '<input type="text" id="add-person-input" placeholder="Person name" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.85rem;padding:7px 10px;width:140px;margin-left:16px;">';
      html += '<button id="add-person-btn" class="btn-primary" style="padding:0.4rem 1rem;font-size:0.82rem;">+ Add Person</button>';
      html += '</div>';

      // Task panel
      html += '<div class="task-panel">';
      html += '<div class="task-panel-header" id="task-panel-toggle">';
      html += '<h2>Tasks to Allocate</h2>';
      html += '<button class="task-panel-toggle">' + (taskPanelOpen ? '&#9650;' : '&#9660;') + '</button>';
      html += '</div>';
      html += '<div class="task-panel-body' + (taskPanelOpen ? '' : ' collapsed') + '" id="task-panel-body">';
      state.tasks.forEach(function (task, idx) {
        html += '<span class="task-chip" draggable="true" data-task="' + JH.esc(task) + '" data-idx="' + idx + '">' + JH.esc(task) + '</span>';
      });
      html += '</div>';
      html += '<div class="task-panel-add" id="task-add-row"' + (taskPanelOpen ? '' : ' style="display:none"') + '>';
      html += '<input type="text" id="new-task-input" placeholder="New task name...">';
      html += '<button id="add-task-btn">+ Add Task</button>';
      html += '</div>';
      html += '</div>';
    }

    html += '</div>'; // .hide-on-mobile

    // Mobile day-accordion (same data, separate tree)
    html += renderMobile(dates, people, periods);

    wrap.innerHTML = html;

    if (isAdmin) {
      JH.initDate(document.getElementById('add-date-input'));
      bindCellEditing();
      bindDragDrop();
      bindAddButtons(dates, people);
      bindTaskPanel();
    }
    bindMobileAccordion();
    if (isAdmin) bindMobileEditing();
  }

  // ── Mobile day-accordion ────────────────────────────────────────────────────

  function renderMobile(dates, people, periods) {
    var html = '<div class="mobile-cards">';
    if (!dates.length) {
      html += '<div class="empty-state">No timeline yet.</div></div>';
      return html;
    }

    dates.forEach(function (date, di) {
      var openClass = di === 0 ? ' open' : '';
      var arrivingToday = people.filter(function (p) { return getArrivalDate(p) === date; });
      var arrivingTag = arrivingToday.length ? ' <span class="m-arrival-flag">' + arrivingToday.length + ' arriving</span>' : '';
      html += '<div class="m-acc' + openClass + '" data-date="' + JH.esc(date) + '">';
      html += '<div class="m-acc-head">' + JH.esc(JH.formatDateLong(date)) + arrivingTag + '<span class="chev">&#9662;</span></div>';
      html += '<div class="m-acc-body">';

      if (arrivingToday.length) {
        html += '<div class="m-day-arrivals"><strong>↓ Arrivals:</strong> ' +
          arrivingToday.map(function (p) { return JH.esc(p); }).join(', ') + '</div>';
      }

      var anyPerson = false;
      people.forEach(function (person) {
        // Gather this person's rows for the day across periods, skipping fully-empty days.
        var rows = [];
        var hasContent = false;
        periods.forEach(function (period) {
          var task = getTask(person, date, period);
          var available = isAvailable(person, date);
          var noorg = isNoOrg(person, date);
          if (task || noorg) hasContent = true;
          rows.push({ period: period, task: task, available: available, noorg: noorg });
        });
        if (!hasContent) return;
        anyPerson = true;

        var arrival = getArrivalDate(person);
        var arrived = hasArrived(person);
        var dayKind = arrivalKind(person, date);
        var cardCls = dayKind === 'arrival' ? ' m-arrival-day' : dayKind === 'onsite' ? ' m-arrived' : '';
        html += '<div class="m-card' + cardCls + '">';
        html += '<div class="m-day-person' + (arrived ? ' arrived' : '') + '">' + JH.esc(person);
        if (dayKind === 'arrival') {
          html += ' <span class="m-arrival-flag">↓ Arrives</span>';
        } else if (arrival) {
          html += arrived
            ? ' <span class="arrival-badge arrived-pill">✓ On site</span>'
            : ' <span class="arrival-badge future-pill">arrives ' + JH.esc(JH.formatDate(arrival)) + '</span>';
        }
        html += '</div>';

        rows.forEach(function (r) {
          html += '<div class="m-task-row">';
          html += '<span class="m-task-period">' + JH.esc(r.period) + '</span>';
          if (r.noorg) {
            html += '<span class="m-task-val noorg">NoOrg</span>';
          } else if (!r.available) {
            html += '<span class="m-task-val unavailable">' + (r.task ? JH.esc(r.task) : 'not arrived') + '</span>';
          } else {
            var editable = isAdmin;
            var cls = 'm-task-val' + (editable ? ' editable' : '') + (r.task ? '' : ' empty');
            var attrs = editable
              ? ' data-person="' + JH.esc(person) + '" data-date="' + JH.esc(date) + '" data-period="' + JH.esc(r.period) + '"'
              : '';
            html += '<span class="' + cls + '"' + attrs + '>' + (r.task ? JH.esc(r.task) : '—') + '</span>';
          }
          html += '</div>';
        });

        html += '</div>'; // .m-card
      });

      if (!anyPerson) html += '<div class="m-day-empty">No tasks assigned this day.</div>';

      html += '</div></div>'; // .m-acc-body, .m-acc
    });

    html += '</div>'; // .mobile-cards
    return html;
  }

  function bindMobileAccordion() {
    document.querySelectorAll('.mobile-cards .m-acc-head').forEach(function (head) {
      head.addEventListener('click', function () {
        head.parentNode.classList.toggle('open');
      });
    });
  }

  function bindMobileEditing() {
    document.querySelectorAll('.mobile-cards .m-task-val.editable').forEach(attachMobileEdit);
  }

  function attachMobileEdit(span) {
    span.addEventListener('click', function () {
      var currentVal = span.textContent === '—' ? '' : span.textContent;
      var person = span.dataset.person, date = span.dataset.date, period = span.dataset.period;

      var wrapEl = document.createElement('span');
      wrapEl.className = 'm-task-edit';
      var textarea = document.createElement('textarea');
      textarea.value = currentVal;
      wrapEl.appendChild(textarea);
      span.replaceWith(wrapEl);
      textarea.focus();

      function finish(newVal) {
        var fresh = document.createElement('span');
        fresh.className = 'm-task-val editable' + (newVal ? '' : ' empty');
        fresh.dataset.person = person;
        fresh.dataset.date = date;
        fresh.dataset.period = period;
        fresh.textContent = newVal || '—';
        wrapEl.replaceWith(fresh);
        attachMobileEdit(fresh);
      }

      function save() {
        var newVal = textarea.value.trim();
        finish(newVal);
        if (newVal !== currentVal) {
          saveCell(person, date, period, newVal, currentVal);
        }
      }

      textarea.addEventListener('blur', save);
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { finish(currentVal); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      });
    });
  }

  // ── Inline cell editing ───────────────────────────────────────────────────

  function bindCellEditing() {
    document.querySelectorAll('.task-cell:not(.unavailable):not(.noorg)').forEach(function (td) {
      td.addEventListener('click', function () {
        if (td.classList.contains('editing')) return;

        var currentVal = td.textContent;
        td.classList.add('editing');
        var textarea = document.createElement('textarea');
        textarea.value = currentVal;
        td.textContent = '';
        td.appendChild(textarea);
        textarea.focus();

        function save() {
          var newVal = textarea.value.trim();
          td.classList.remove('editing');
          td.textContent = newVal;

          if (newVal !== currentVal) {
            saveCell(td.dataset.person, td.dataset.date, td.dataset.period, newVal, currentVal);
          }
        }

        textarea.addEventListener('blur', save);
        textarea.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { td.classList.remove('editing'); td.textContent = currentVal; }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
        });
      });
    });
  }

  // Re-render both the desktop table and the mobile accordion from state,
  // preserving the grid's scroll position and which accordion days are open.
  function rerenderPreservingView() {
    var grid = document.querySelector('.timeline-grid');
    var scrollLeft = grid ? grid.scrollLeft : 0;
    var scrollTop = grid ? grid.scrollTop : 0;
    var openDates = null;
    var accs = document.querySelectorAll('.mobile-cards .m-acc');
    if (accs.length) {
      openDates = {};
      accs.forEach(function (acc) {
        if (acc.classList.contains('open')) openDates[acc.dataset.date] = true;
      });
    }

    renderTimeline();

    var newGrid = document.querySelector('.timeline-grid');
    if (newGrid) { newGrid.scrollLeft = scrollLeft; newGrid.scrollTop = scrollTop; }
    if (openDates) {
      document.querySelectorAll('.mobile-cards .m-acc').forEach(function (acc) {
        acc.classList.toggle('open', !!openDates[acc.dataset.date]);
      });
    }
  }

  function saveCell(person, date, period, newVal, oldVal) {
    JH.apiFetch('/api/timeline', { action: 'upsert', person: person, date: date, period: period, task: newVal }).then(function (r) {
      if (!r.ok) { alert('Save failed.'); rerenderPreservingView(); return; }
      var entry = state.entries.find(function (e) {
        return e.Person === person && e.Date === date && e.Period === period;
      });
      if (newVal) {
        if (entry) entry.Task = newVal;
        else state.entries.push({ Person: person, Date: date, Period: period, Task: newVal });
      } else if (entry) {
        state.entries = state.entries.filter(function (e) { return e !== entry; });
      }
      // Keep BOTH trees (desktop table + mobile accordion) in sync.
      rerenderPreservingView();
    }).catch(function () { rerenderPreservingView(); });
  }

  // ── Drag and drop tasks ───────────────────────────────────────────────────

  function bindDragDrop() {
    document.querySelectorAll('.task-chip').forEach(function (chip) {
      chip.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', chip.dataset.task);
        chip.classList.add('dragging');
      });
      chip.addEventListener('dragend', function () {
        chip.classList.remove('dragging');
      });
    });

    document.querySelectorAll('.task-cell:not(.unavailable):not(.noorg)').forEach(function (td) {
      td.addEventListener('dragover', function (e) {
        e.preventDefault();
        td.classList.add('drag-over');
      });
      td.addEventListener('dragleave', function () {
        td.classList.remove('drag-over');
      });
      td.addEventListener('drop', function (e) {
        e.preventDefault();
        td.classList.remove('drag-over');
        var taskName = e.dataTransfer.getData('text/plain');
        if (!taskName) return;

        var existing = td.textContent.trim();
        var newVal = existing ? existing + '\n' + taskName : taskName;
        td.textContent = newVal;
        saveCell(td.dataset.person, td.dataset.date, td.dataset.period, newVal, existing);
      });
    });
  }

  // ── Add date/person ───────────────────────────────────────────────────────

  function bindAddButtons(dates, people) {
    document.getElementById('add-date-btn').addEventListener('click', function () {
      var val = document.getElementById('add-date-input').value;
      if (!val) return;
      if (dates.indexOf(val) !== -1) { alert('Date already in timeline.'); return; }
      state.entries.push({ Person: people[0] || '', Date: val, Period: 'Morning', Task: '' });
      renderTimeline();
    });

    document.getElementById('add-person-btn').addEventListener('click', function () {
      var val = document.getElementById('add-person-input').value.trim();
      if (!val) return;
      if (people.indexOf(val) !== -1) { alert('Person already in timeline.'); return; }
      state.entries.push({ Person: val, Date: dates[0] || '', Period: 'Morning', Task: '' });
      renderTimeline();
    });
  }

  // ── Task panel ────────────────────────────────────────────────────────────

  function bindTaskPanel() {
    document.getElementById('task-panel-toggle').addEventListener('click', function () {
      taskPanelOpen = !taskPanelOpen;
      var body = document.getElementById('task-panel-body');
      var addRow = document.getElementById('task-add-row');
      body.classList.toggle('collapsed');
      if (addRow) addRow.style.display = taskPanelOpen ? '' : 'none';
      this.querySelector('.task-panel-toggle').innerHTML = taskPanelOpen ? '&#9650;' : '&#9660;';
    });

    document.getElementById('add-task-btn').addEventListener('click', function () {
      var input = document.getElementById('new-task-input');
      var val = input.value.trim();
      if (!val) return;
      if (state.tasks.indexOf(val) !== -1) { alert('Task already exists.'); return; }
      state.tasks.push(val);
      saveTasks();
      input.value = '';
      renderTimeline();
    });
  }

  // ── Reload ────────────────────────────────────────────────────────────────

  async function reload() {
    await fetchData();
    renderTimeline();
  }

  await reload();
})();
