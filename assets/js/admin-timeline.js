(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');
  var state = { entries: [] };

  var approvedMembers = members.filter(function (m) {
    return (m['Status'] || '').toLowerCase() === 'approved';
  }).map(function (m) {
    return m['Playa Name'] || m['Name'] || '';
  }).filter(Boolean).sort();

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await fetch('/api/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) { console.error('timeline fetch failed'); return; }
    var data = await res.json();
    state.entries = data.entries || [];
  }

  // ── Build grid data ───────────────────────────────────────────────────────

  function getUniqueDates() {
    var set = {};
    state.entries.forEach(function (e) { if (e.Date) set[e.Date] = true; });
    return Object.keys(set).sort();
  }

  function getUniquePeople() {
    var set = {};
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
    var dates = getUniqueDates();
    var people = getUniquePeople();

    if (!dates.length && !people.length && !isAdmin) {
      wrap.innerHTML = '<div class="empty-state">No timeline data yet.</div>';
      return;
    }

    // If admin and no data, show empty grid with approved members
    if (!dates.length) dates = ['2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'];
    if (!people.length) people = approvedMembers.length ? approvedMembers : ['(add people below)'];

    renderGrid(wrap, dates, people);
  }

  function renderGrid(wrap, dates, people) {
    var periods = ['Morning', 'Evening'];

    var html = '<div class="timeline-grid"><table class="timeline-table">';

    // Date header row
    html += '<thead><tr><th class="date-header" rowspan="2" style="position:sticky;left:0;z-index:3;">Person</th>';
    dates.forEach(function (d) {
      html += '<th class="date-header" colspan="2">' + JH.formatDateLong(d) + '</th>';
    });
    html += '</tr>';

    // Period header row
    html += '<tr>';
    dates.forEach(function () {
      periods.forEach(function (p) {
        html += '<th class="period-header">' + esc(p) + '</th>';
      });
    });
    html += '</tr></thead>';

    // People rows
    html += '<tbody>';
    people.forEach(function (person) {
      html += '<tr>';
      html += '<td class="name-cell">' + esc(person) + '</td>';
      dates.forEach(function (date) {
        periods.forEach(function (period) {
          var task = getTask(person, date, period);
          if (isAdmin) {
            html += '<td class="task-cell" data-person="' + esc(person) + '" data-date="' + esc(date) + '" data-period="' + esc(period) + '">' + esc(task) + '</td>';
          } else {
            html += '<td>' + esc(task) + '</td>';
          }
        });
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    if (isAdmin) {
      html += '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
      html += '<input type="text" id="add-date-input" placeholder="dd/mm/yyyy" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.85rem;padding:7px 10px;width:140px;">';
      html += '<button id="add-date-btn" class="btn-primary" style="padding:0.4rem 1rem;font-size:0.82rem;">+ Add Day</button>';
      html += '<input type="text" id="add-person-input" placeholder="Person name" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.85rem;padding:7px 10px;width:140px;margin-left:16px;">';
      html += '<button id="add-person-btn" class="btn-primary" style="padding:0.4rem 1rem;font-size:0.82rem;">+ Add Person</button>';
      html += '</div>';
    }

    wrap.innerHTML = html;

    if (isAdmin) {
      JH.initDate(document.getElementById('add-date-input'));
      bindCellEditing();
      bindAddButtons(dates, people);
    }
  }

  // ── Inline cell editing ───────────────────────────────────────────────────

  function bindCellEditing() {
    document.querySelectorAll('.task-cell').forEach(function (td) {
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
            fetch('/api/timeline', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                password: pass,
                action: 'upsert',
                person: td.dataset.person,
                date: td.dataset.date,
                period: td.dataset.period,
                task: newVal,
              }),
            }).then(function (r) {
              if (!r.ok) {
                td.textContent = currentVal;
                alert('Save failed.');
              } else {
                var entry = state.entries.find(function (e) {
                  return e.Person === td.dataset.person && e.Date === td.dataset.date && e.Period === td.dataset.period;
                });
                if (newVal) {
                  if (entry) { entry.Task = newVal; }
                  else { state.entries.push({ Person: td.dataset.person, Date: td.dataset.date, Period: td.dataset.period, Task: newVal }); }
                } else if (entry) {
                  state.entries = state.entries.filter(function (e) { return e !== entry; });
                }
              }
            }).catch(function () {
              td.textContent = currentVal;
            });
          }
        }

        textarea.addEventListener('blur', save);
        textarea.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            td.classList.remove('editing');
            td.textContent = currentVal;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        });
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

  // ── Reload ────────────────────────────────────────────────────────────────

  async function reload() {
    await fetchData();
    renderTimeline();
  }

  await reload();
})();
