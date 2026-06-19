(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var state = { entries: [], logistics: [], tasks: [], teams: [], noOrgMap: {} };
  var taskPanelOpen = true;

  // Fallback palette when a team is auto-discovered from existing entries that
  // don't have a saved colour in localStorage.
  var TEAM_PALETTE = ['#e8a84c', '#4caf50', '#2196f3', '#e91e63', '#9c27b0', '#00bcd4', '#ff9800', '#8bc34a', '#795548', '#607d8b', '#f44336', '#673ab7'];
  function autoColor(i) { return TEAM_PALETTE[i % TEAM_PALETTE.length]; }
  function teamColor(name) {
    var t = state.teams.find(function (x) { return x.name === name; });
    return t ? t.color : '#888';
  }

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

  // Observers (non-approved) must not appear in the setup-timeline grid even if
  // they have logistics/timeline rows. Build a name lookup so getGridPeople can
  // skip them when merging Timeline entries.
  var observerNames = {};
  members.forEach(function (m) {
    if ((m['Status'] || '').toLowerCase() === 'observer') {
      var p = m['Playa Name'] || '';
      var l = m['Name'] || '';
      if (p) observerNames[p] = true;
      if (l) observerNames[l] = true;
    }
  });

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
    loadTeams();
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

  // Teams persisted in localStorage; auto-discover any team names already
  // present in Timeline entries so collaborating admins don't lose the team
  // tagging set by someone else.
  function loadTeams() {
    var saved = [];
    try {
      var raw = JSON.parse(localStorage.getItem('jh_timeline_teams'));
      if (Array.isArray(raw)) saved = raw.filter(function (t) { return t && t.name; });
    } catch (e) {}
    state.teams = saved;
    var seen = {};
    state.teams.forEach(function (t) { seen[t.name.toLowerCase()] = true; });
    state.entries.forEach(function (e) {
      if (!e.Team) return;
      var key = e.Team.toLowerCase();
      if (seen[key]) return;
      state.teams.push({ name: e.Team, color: autoColor(state.teams.length) });
      seen[key] = true;
    });
    saveTeams();
  }

  function saveTeams() {
    localStorage.setItem('jh_timeline_teams', JSON.stringify(state.teams));
  }

  function getTeam(person, date, period) {
    var entry = state.entries.find(function (e) {
      return e.Person === person && e.Date === date && e.Period === period;
    });
    return entry ? (entry.Team || '') : '';
  }

  // ── Logistics helpers ─────────────────────────────────────────────────────

  function getArrivalDate(person) {
    var row = state.logistics.find(function (l) { return l.MemberName === person; });
    return row ? row.ArrivalDate : '';
  }

  function getArrivalTime(person) {
    var row = state.logistics.find(function (l) { return l.MemberName === person; });
    return row && row.ArrivalTime ? JH.to24h(row.ArrivalTime) : '';
  }

  // Cell is "available" (editable, not greyed-out) from the arrival day onward.
  // Visual green/yellow tint is decided separately by arrivalHighlight().
  function isAvailable(person, date) {
    var arrival = getArrivalDate(person);
    if (!arrival) return true;
    return date >= arrival;
  }

  function parseTimeToMin(t) {
    if (!t) return -1;
    var m = (t + '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  // Returns 'green' | 'yellow' | 'grey' | '':
  //   green  – on-site and working that half-day
  //   yellow – arriving mid half-day (limited time)
  //   grey   – arrived too late for that half-day (e.g. lands 20:00 → grey eve)
  //   ''     – not arrived at all (date < arrival), handled separately
  // Morning thresholds: ≤08:00 green, <12:00 yellow, ≥12:00 grey.
  // Evening thresholds: <12:00 green, <20:00 yellow, ≥20:00 grey.
  // Missing arrival date OR missing time → green (assume present).
  function arrivalHighlight(person, date, period) {
    var arrival = getArrivalDate(person);
    if (!arrival) return 'green';
    if (date < arrival) return '';
    if (date > arrival) return 'green';
    var min = parseTimeToMin(getArrivalTime(person));
    if (min < 0) return 'green';
    if (period === 'Morning') {
      if (min <= 8 * 60) return 'green';
      if (min < 12 * 60) return 'yellow';
      return 'grey';
    }
    // Evening: arrived by 13:00 still counts as fully on for the afternoon.
    if (min <= 13 * 60) return 'green';
    if (min < 20 * 60) return 'yellow';
    return 'grey';
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
    approvedMembers.forEach(function (m) { set[m] = true; });
    state.entries.forEach(function (e) {
      if (e.Person && !observerNames[e.Person]) set[e.Person] = true;
    });
    // Sort by arrival date ascending; people without a logged arrival sink to
    // the bottom, alphabetical inside each tier.
    return Object.keys(set).sort(function (a, b) {
      var aa = getArrivalDate(a), bb = getArrivalDate(b);
      if (aa && bb) return aa < bb ? -1 : aa > bb ? 1 : a.localeCompare(b);
      if (aa) return -1;
      if (bb) return 1;
      return a.localeCompare(b);
    });
  }

  function getTask(person, date, period) {
    var entry = state.entries.find(function (e) {
      return e.Person === person && e.Date === date && e.Period === period;
    });
    return entry ? entry.Task : '';
  }

  // ── Teams panel ───────────────────────────────────────────────────────────

  function renderTeamsPanel() {
    var wrap = document.getElementById('teams-panel-wrap');
    if (!wrap) return;
    if (!isAdmin) { wrap.innerHTML = ''; return; }
    var html = '<div class="teams-panel">';
    html += '<div class="teams-panel-head"><h2>Teams &nbsp;<span style="color:var(--text-muted);font-weight:400;font-size:0.78rem">drag onto a cell to assign</span></h2></div>';
    html += '<div class="teams-list" id="teams-list">';
    if (!state.teams.length) {
      html += '<span class="team-empty">No teams yet. Add one below.</span>';
    } else {
      state.teams.forEach(function (t) {
        var bg = t.color || '#888';
        html += '<span class="team-chip" draggable="true" data-team="' + JH.esc(t.name) + '" style="background:' + JH.esc(bg) + '">' +
          JH.esc(t.name) +
          ' <button class="team-edit-btn" title="Rename / change colour" data-team="' + JH.esc(t.name) + '">&#9998;</button>' +
          ' <button class="team-del-btn" title="Delete team" data-team="' + JH.esc(t.name) + '">&times;</button>' +
          '</span>';
      });
    }
    html += '</div>';
    html += '<div class="team-add-row">' +
      '<input type="text" id="new-team-name" placeholder="New team name (e.g. Electricity)">' +
      '<input type="color" id="new-team-color" value="' + autoColor(state.teams.length) + '">' +
      '<button id="add-team-btn">+ Add Team</button>' +
      '</div>';
    html += '</div>';
    wrap.innerHTML = html;
    bindTeamsPanel();
  }

  function bindTeamsPanel() {
    var addBtn = document.getElementById('add-team-btn');
    if (addBtn) addBtn.addEventListener('click', function () {
      var name = document.getElementById('new-team-name').value.trim();
      var color = document.getElementById('new-team-color').value || autoColor(state.teams.length);
      if (!name) return;
      if (state.teams.find(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })) {
        alert('Team already exists.');
        return;
      }
      state.teams.push({ name: name, color: color });
      saveTeams();
      renderTeamsPanel();
    });

    document.querySelectorAll('.team-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var name = btn.dataset.team;
        var inUse = state.entries.filter(function (en) { return en.Team === name; }).length;
        var msg = inUse
          ? 'Delete team "' + name + '"? ' + inUse + ' cell assignment(s) will be cleared.'
          : 'Delete team "' + name + '"?';
        if (!confirm(msg)) return;
        state.teams = state.teams.filter(function (t) { return t.name !== name; });
        saveTeams();
        // Clear team from all entries that had it (locally + server)
        var toClear = state.entries.filter(function (en) { return en.Team === name; });
        toClear.forEach(function (en) {
          en.Team = '';
          JH.apiFetch('/api/timeline', { action: 'upsert', person: en.Person, date: en.Date, period: en.Period, team: '' });
        });
        rerenderPreservingView();
      });
    });

    document.querySelectorAll('.team-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var oldName = btn.dataset.team;
        var team = state.teams.find(function (t) { return t.name === oldName; });
        if (!team) return;
        var newName = prompt('Rename team:', team.name);
        if (newName === null) return;
        newName = newName.trim();
        if (!newName) return;
        var newColor = prompt('Hex colour (e.g. #4caf50):', team.color || '#888');
        if (newColor === null) return;
        newColor = newColor.trim() || team.color;
        // Update team list
        team.name = newName;
        team.color = newColor;
        saveTeams();
        // Propagate rename to entries (locally + server)
        if (newName !== oldName) {
          var toRename = state.entries.filter(function (en) { return en.Team === oldName; });
          toRename.forEach(function (en) {
            en.Team = newName;
            JH.apiFetch('/api/timeline', { action: 'upsert', person: en.Person, date: en.Date, period: en.Period, team: newName });
          });
        }
        rerenderPreservingView();
      });
    });

    // Drag start for team chips
    document.querySelectorAll('.team-chip').forEach(function (chip) {
      chip.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('application/jh-team', chip.dataset.team);
        e.dataTransfer.setData('text/plain', '__team__:' + chip.dataset.team);
        chip.classList.add('dragging');
      });
      chip.addEventListener('dragend', function () { chip.classList.remove('dragging'); });
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderTimeline() {
    renderTeamsPanel();
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
      var arrTime = getArrivalTime(person);
      var noTime = !!(arrival && !arrTime);
      html += '<tr>';
      html += '<td class="name-cell' + (noTime ? ' no-time' : '') + '" title="' + (noTime ? 'Arrival time unknown' : '') + '">' + JH.esc(person);
      if (arrival) {
        var badgeCls = 'arrival-badge' + (noTime ? ' no-time' : '');
        html += '<span class="' + badgeCls + '">arr: ' + JH.formatDate(arrival) + (arrTime ? ' ' + JH.esc(arrTime) : ' (time?)') + '</span>';
      }
      html += '</td>';

      dates.forEach(function (date) {
        periods.forEach(function (period) {
          var task = getTask(person, date, period);
          var team = getTeam(person, date, period);
          var available = isAvailable(person, date);
          var noorg = isNoOrg(person, date);

          var teamPill = team ? (
            '<span class="cell-team-row"><span class="cell-team" style="background:' + JH.esc(teamColor(team)) + '">' +
            JH.esc(team) +
            (isAdmin ? ' <button class="cell-team-x" data-person="' + JH.esc(person) + '" data-date="' + JH.esc(date) + '" data-period="' + JH.esc(period) + '" title="Remove team">&times;</button>' : '') +
            '</span></span>'
          ) : '';

          var hl = arrivalHighlight(person, date, period);
          var arrivedCls = hl === 'green' ? ' arrived' : hl === 'yellow' ? ' arrived-late' : hl === 'grey' ? ' too-late' : '';
          if (noorg) {
            html += '<td class="task-cell noorg" title="On NoOrg duty">NoOrg</td>';
          } else if (isAdmin && available) {
            var ttl = hl === 'yellow' ? ' title="Arrives mid half-day"' : hl === 'grey' ? ' title="Arrives too late for this half-day"' : '';
            html += '<td class="task-cell' + arrivedCls + '"' + ttl + ' data-person="' + JH.esc(person) + '" data-date="' + JH.esc(date) + '" data-period="' + JH.esc(period) + '">' + teamPill + JH.esc(task) + '</td>';
          } else if (!available) {
            html += '<td class="task-cell unavailable" title="Not arrived yet">' + teamPill + JH.esc(task) + '</td>';
          } else {
            var ttl2 = hl === 'yellow' ? ' title="Arrives mid half-day"' : hl === 'grey' ? ' title="Arrives too late for this half-day"' : '';
            html += '<td class="task-cell' + arrivedCls + '"' + ttl2 + '>' + teamPill + JH.esc(task) + '</td>';
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
      html += '<div class="m-acc' + openClass + '" data-date="' + JH.esc(date) + '">';
      html += '<div class="m-acc-head">' + JH.esc(JH.formatDateLong(date)) + '<span class="chev">&#9662;</span></div>';
      html += '<div class="m-acc-body">';

      var anyPerson = false;
      people.forEach(function (person) {
        // Gather this person's rows for the day across periods, skipping fully-empty days.
        var rows = [];
        var hasContent = false;
        periods.forEach(function (period) {
          var task = getTask(person, date, period);
          var team = getTeam(person, date, period);
          var available = isAvailable(person, date);
          var noorg = isNoOrg(person, date);
          var hl = arrivalHighlight(person, date, period);
          if (task || team || noorg) hasContent = true;
          rows.push({ period: period, task: task, team: team, available: available, noorg: noorg, hl: hl });
        });
        if (!hasContent) return;
        anyPerson = true;

        html += '<div class="m-card">';
        var arrival = getArrivalDate(person);
        var arrTime = getArrivalTime(person);
        var noTime = !!(arrival && !arrTime);
        html += '<div class="m-day-person' + (noTime ? ' no-time' : '') + '">' + JH.esc(person);
        if (arrival) {
          var badgeClsM = 'arrival-badge' + (noTime ? ' no-time' : '');
          html += ' <span class="' + badgeClsM + '">arr: ' + JH.esc(JH.formatDate(arrival)) + (arrTime ? ' ' + JH.esc(arrTime) : ' (time?)') + '</span>';
        }
        html += '</div>';

        rows.forEach(function (r) {
          var rowHlCls = r.hl === 'green' ? ' arrived' : r.hl === 'yellow' ? ' arrived-late' : r.hl === 'grey' ? ' too-late' : '';
          html += '<div class="m-task-row' + rowHlCls + '">';
          html += '<span class="m-task-period">' + JH.esc(r.period) + '</span>';
          var teamPillM = r.team ? '<span class="cell-team" style="background:' + JH.esc(teamColor(r.team)) + '">' + JH.esc(r.team) + '</span>' : '';
          if (r.noorg) {
            html += '<span class="m-task-val noorg">NoOrg</span>';
          } else if (!r.available) {
            html += '<span class="m-task-val unavailable">' + teamPillM + (r.task ? JH.esc(r.task) : 'not arrived') + '</span>';
          } else {
            var editable = isAdmin;
            var cls = 'm-task-val' + (editable ? ' editable' : '') + ((r.task || r.team) ? '' : ' empty');
            var attrs = editable
              ? ' data-person="' + JH.esc(person) + '" data-date="' + JH.esc(date) + '" data-period="' + JH.esc(r.period) + '"'
              : '';
            var inner = teamPillM + (r.task ? JH.esc(r.task) : (r.team ? '' : '—'));
            html += '<span class="' + cls + '"' + attrs + '>' + inner + '</span>';
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
      var person = span.dataset.person, date = span.dataset.date, period = span.dataset.period;
      var currentTask = getTask(person, date, period);
      var currentTeam = getTeam(person, date, period);

      var wrapEl = document.createElement('span');
      wrapEl.className = 'm-task-edit';
      wrapEl.style.display = 'block';

      var teamSel = document.createElement('select');
      teamSel.style.cssText = 'display:block;width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:0.85rem;margin-bottom:6px;';
      var optEmpty = document.createElement('option');
      optEmpty.value = ''; optEmpty.textContent = '— no team —';
      teamSel.appendChild(optEmpty);
      state.teams.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t.name; opt.textContent = t.name;
        if (t.name === currentTeam) opt.selected = true;
        teamSel.appendChild(opt);
      });

      var textarea = document.createElement('textarea');
      textarea.value = currentTask;
      textarea.placeholder = 'Free-text task (optional)';

      wrapEl.appendChild(teamSel);
      wrapEl.appendChild(textarea);
      span.replaceWith(wrapEl);
      textarea.focus();

      var settled = false;
      function commit() {
        if (settled) return;
        settled = true;
        var newTask = textarea.value.trim();
        var newTeam = teamSel.value;
        var didChange = false;
        if (newTeam !== currentTeam) { saveCellTeam(person, date, period, newTeam); didChange = true; }
        if (newTask !== currentTask) { saveCell(person, date, period, newTask, currentTask); didChange = true; }
        if (!didChange) rerenderPreservingView();
      }

      // Blur on either field commits — but the change between teamSel and
      // textarea blurs the textarea, so we wait a tick to check active element.
      function onBlur() {
        setTimeout(function () {
          var ae = document.activeElement;
          if (ae === teamSel || ae === textarea) return;
          commit();
        }, 50);
      }
      textarea.addEventListener('blur', onBlur);
      teamSel.addEventListener('blur', onBlur);
      teamSel.addEventListener('change', function () { /* keep editing — wait for blur to commit */ });
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { settled = true; rerenderPreservingView(); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      });
    });
  }

  // ── Inline cell editing ───────────────────────────────────────────────────

  function bindCellEditing() {
    document.querySelectorAll('.task-cell:not(.unavailable):not(.noorg)').forEach(function (td) {
      td.addEventListener('click', function (e) {
        if (td.classList.contains('editing')) return;
        // Ignore clicks on inner controls (e.g. team-remove ×).
        if (e.target.closest('.cell-team-x')) return;

        var currentVal = getTask(td.dataset.person, td.dataset.date, td.dataset.period);
        td.classList.add('editing');
        var textarea = document.createElement('textarea');
        textarea.value = currentVal;
        td.innerHTML = '';
        td.appendChild(textarea);
        textarea.focus();

        function save() {
          var newVal = textarea.value.trim();
          td.classList.remove('editing');
          // Don't rebuild manually — rerenderPreservingView() below will repaint
          // the team pill + new text together.
          if (newVal !== currentVal) {
            saveCell(td.dataset.person, td.dataset.date, td.dataset.period, newVal, currentVal);
          } else {
            rerenderPreservingView();
          }
        }

        textarea.addEventListener('blur', save);
        textarea.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { td.classList.remove('editing'); rerenderPreservingView(); }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
        });
      });
    });

    // Team-remove × button on cells.
    document.querySelectorAll('.cell-team-x').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        saveCellTeam(btn.dataset.person, btn.dataset.date, btn.dataset.period, '');
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
        else state.entries.push({ Person: person, Date: date, Period: period, Task: newVal, Team: '' });
      } else if (entry) {
        if (entry.Team) { entry.Task = ''; }
        else state.entries = state.entries.filter(function (e) { return e !== entry; });
      }
      rerenderPreservingView();
    }).catch(function () { rerenderPreservingView(); });
  }

  function saveCellTeam(person, date, period, newTeam) {
    JH.apiFetch('/api/timeline', { action: 'upsert', person: person, date: date, period: period, team: newTeam }).then(function (r) {
      if (!r.ok) { alert('Save failed.'); rerenderPreservingView(); return; }
      var entry = state.entries.find(function (e) {
        return e.Person === person && e.Date === date && e.Period === period;
      });
      if (newTeam) {
        if (entry) entry.Team = newTeam;
        else state.entries.push({ Person: person, Date: date, Period: period, Task: '', Team: newTeam });
      } else if (entry) {
        if (entry.Task) { entry.Team = ''; }
        else state.entries = state.entries.filter(function (e) { return e !== entry; });
      }
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
        // Detect a team chip drag via the custom MIME we set on dragstart.
        var types = Array.prototype.slice.call(e.dataTransfer.types || []);
        if (types.indexOf('application/jh-team') !== -1) {
          td.classList.add('team-drag-over');
        } else {
          td.classList.add('drag-over');
        }
      });
      td.addEventListener('dragleave', function () {
        td.classList.remove('drag-over');
        td.classList.remove('team-drag-over');
      });
      td.addEventListener('drop', function (e) {
        e.preventDefault();
        td.classList.remove('drag-over');
        td.classList.remove('team-drag-over');
        var teamName = e.dataTransfer.getData('application/jh-team');
        if (teamName) {
          saveCellTeam(td.dataset.person, td.dataset.date, td.dataset.period, teamName);
          return;
        }
        var raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        // text/plain duplicates of team chips are prefixed so they don't poison
        // the task-text path on browsers that strip custom MIMEs.
        if (raw.indexOf('__team__:') === 0) {
          saveCellTeam(td.dataset.person, td.dataset.date, td.dataset.period, raw.slice('__team__:'.length));
          return;
        }
        var existing = getTask(td.dataset.person, td.dataset.date, td.dataset.period);
        var newVal = existing ? existing + '\n' + raw : raw;
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
