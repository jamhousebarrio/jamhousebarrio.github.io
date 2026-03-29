(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var pass = sessionStorage.getItem('jh_pass');

  var approvedMembers = members.filter(function (m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  var shifts = [];

  // Event days: July 7-12
  var EVENT_DATES = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];

  async function fetchShifts() {
    var r = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!r.ok) return;
    var data = await r.json();
    shifts = data.shifts || [];
  }

  // Group shifts by name (shift type)
  function getShiftTypes() {
    var types = {};
    shifts.forEach(function (s) {
      var key = s.Name || 'Unknown';
      if (!types[key]) {
        types[key] = { name: key, time: '', shifts: {} };
      }
      // Use the time from first shift found
      if (!types[key].time && s.StartTime) {
        types[key].time = JH.to24h(s.StartTime) + (s.EndTime ? ' - ' + JH.to24h(s.EndTime) : '');
      }
      types[key].shifts[s.Date] = s;
    });
    return Object.keys(types).sort().map(function (k) { return types[k]; });
  }

  function renderStats() {
    var types = getShiftTypes();
    var totalSlots = 0, filledPeople = 0;
    types.forEach(function (t) {
      EVENT_DATES.forEach(function (d) {
        var s = t.shifts[d];
        if (s) {
          totalSlots++;
          var people = (s.AssignedTo || '').split(',').filter(function (p) { return p.trim(); });
          filledPeople += people.length;
        }
      });
    });
    document.getElementById('stat-types').textContent = types.length;
    document.getElementById('stat-filled').textContent = filledPeople;
    document.getElementById('stat-open').textContent = totalSlots - (shifts.filter(function (s) { return s.AssignedTo; }).length);
  }

  function renderGrid() {
    var wrap = document.getElementById('shifts-wrap');
    var types = getShiftTypes();

    if (!types.length) {
      wrap.innerHTML = '<div class="empty-state">No shifts yet.' + (isAdmin ? ' Click "+ Add Shift Type" below.' : '') + '</div>';
      return;
    }

    var html = '<div class="shift-grid"><table><thead><tr>';
    html += '<th>Role Name</th><th>Time</th>';
    EVENT_DATES.forEach(function (d) {
      html += '<th>' + JH.formatDateLong(d) + '</th>';
    });
    html += '</tr></thead><tbody>';

    types.forEach(function (type) {
      html += '<tr>';
      html += '<td>' + JH.esc(type.name);
      if (isAdmin) html += ' <button class="remove-btn delete-type-btn" data-name="' + JH.esc(type.name) + '" title="Delete all shifts of this type">&times;</button>';
      html += '</td>';
      html += '<td>' + JH.esc(type.time) + '</td>';

      EVENT_DATES.forEach(function (date) {
        var s = type.shifts[date];
        html += '<td><div class="shift-cell">';

        if (!s) {
          html += '<span class="no-shift">&mdash;</span>';
        } else {
          var people = (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
          people.forEach(function (person) {
            html += '<span class="shift-chip filled">' + JH.esc(person);
            if (isAdmin) {
              html += ' <button class="remove-btn remove-person-btn" data-id="' + JH.esc(s.ShiftID) + '" data-person="' + JH.esc(person) + '" title="Remove ' + JH.esc(person) + '">&times;</button>';
            }
            html += '</span>';
          });
          // Always show sign up button (can add more people)
          html += '<button class="signup-btn assign-btn" data-id="' + JH.esc(s.ShiftID) + '" data-name="' + JH.esc(type.name) + '" data-date="' + JH.esc(date) + '">+ Sign Up</button>';
        }

        html += '</div></td>';
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
    bindGridEvents();
  }

  function bindGridEvents() {
    document.querySelectorAll('.assign-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openAssignModal(btn.dataset.id, btn.dataset.name, btn.dataset.date);
      });
    });

    document.querySelectorAll('.remove-person-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var person = btn.dataset.person;
        var shiftId = btn.dataset.id;
        if (!confirm('Remove ' + person + ' from this shift?')) return;
        // Find the shift and remove just this person
        var s = shifts.find(function (sh) { return sh.ShiftID === shiftId; });
        if (!s) return;
        var people = (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
        var updated = people.filter(function (p) { return p !== person; }).join(', ');
        // Use assign action to set the new list (or unassign if empty)
        var action = updated ? 'assign' : 'unassign';
        var body = { password: pass, action: action, shiftId: shiftId };
        if (updated) body.memberName = updated;
        var r = await fetch('/api/shifts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { alert('Failed.'); return; }
        await reload();
      });
    });

    document.querySelectorAll('.delete-type-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var name = btn.dataset.name;
        if (!confirm('Delete ALL "' + name + '" shifts across all days?')) return;
        var typeShifts = shifts.filter(function (s) { return s.Name === name; });
        for (var i = 0; i < typeShifts.length; i++) {
          await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass, action: 'delete', shiftId: typeShifts[i].ShiftID }),
          });
        }
        await reload();
      });
    });
  }

  // ── Add shift type modal ──────────────────────────────────────────────────

  if (isAdmin) document.getElementById('add-shift-btn').style.display = '';

  var addModal = document.getElementById('add-modal');
  document.getElementById('add-shift-btn').addEventListener('click', function () {
    addModal.classList.add('active');
    JH.initTime(document.getElementById('shift-start'));
    JH.initTime(document.getElementById('shift-end'));
  });
  document.getElementById('add-modal-close').addEventListener('click', function () {
    addModal.classList.remove('active');
  });
  addModal.addEventListener('click', function (e) {
    if (e.target === addModal) addModal.classList.remove('active');
  });

  document.getElementById('add-shift-save').addEventListener('click', async function () {
    var name = document.getElementById('shift-name').value.trim();
    var start = document.getElementById('shift-start').value;
    var end = document.getElementById('shift-end').value;
    var msg = document.getElementById('add-msg');

    if (!name) { msg.textContent = 'Name required'; msg.style.color = '#f44336'; return; }
    msg.textContent = 'Creating...'; msg.style.color = '#888';

    // Create a shift for each event day
    for (var i = 0; i < EVENT_DATES.length; i++) {
      var date = EVENT_DATES[i];
      var shiftId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date;
      await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass, action: 'create', shiftId: shiftId, name: name, date: date, startTime: start || '', endTime: end || '' }),
      });
    }

    addModal.classList.remove('active');
    document.getElementById('shift-name').value = '';
    document.getElementById('shift-desc').value = '';
    document.getElementById('shift-start').value = '';
    document.getElementById('shift-end').value = '';
    msg.textContent = '';
    await reload();
  });

  // ── Assign modal ──────────────────────────────────────────────────────────

  var assignModal = document.getElementById('assign-modal');
  var assignShiftId = null;

  function openAssignModal(shiftId, shiftName, date) {
    assignShiftId = shiftId;
    document.getElementById('assign-info').textContent = shiftName + ' — ' + JH.formatDateLong(date);
    var sel = document.getElementById('assign-select');
    sel.innerHTML = '<option value="">Select volunteer...</option>';
    var myName = sessionStorage.getItem('jh_member_name');

    if (isAdmin) {
      approvedMembers.forEach(function (m) {
        var name = JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
        if (!name) return;
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
      });
    } else if (myName) {
      var opt = document.createElement('option');
      opt.value = myName; opt.textContent = myName; opt.selected = true;
      sel.appendChild(opt);
    } else {
      approvedMembers.forEach(function (m) {
        var name = JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
        if (!name) return;
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
      });
    }
    assignModal.classList.add('active');
  }

  document.getElementById('assign-modal-close').addEventListener('click', function () { assignModal.classList.remove('active'); });
  assignModal.addEventListener('click', function (e) { if (e.target === assignModal) assignModal.classList.remove('active'); });

  document.getElementById('assign-save').addEventListener('click', async function () {
    var name = document.getElementById('assign-select').value;
    var msg = document.getElementById('assign-msg');
    if (!name) { msg.textContent = 'Pick a name'; msg.style.color = '#f44336'; return; }
    msg.textContent = 'Saving...'; msg.style.color = '#888';

    // Append to existing assignees
    var s = shifts.find(function (sh) { return sh.ShiftID === assignShiftId; });
    var existing = s ? (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean) : [];
    if (existing.indexOf(name) !== -1) { msg.textContent = 'Already assigned'; msg.style.color = '#ff9800'; return; }
    existing.push(name);
    var combined = existing.join(', ');

    var r = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, action: 'assign', shiftId: assignShiftId, memberName: combined }),
    });
    if (!r.ok) { msg.textContent = 'Failed.'; msg.style.color = '#f44336'; return; }

    sessionStorage.setItem('jh_member_name', name);
    assignModal.classList.remove('active');
    msg.textContent = '';
    await reload();
  });

  // ── Reload ────────────────────────────────────────────────────────────────

  async function reload() {
    await fetchShifts();
    renderStats();
    renderGrid();
  }

  await reload();
})();
