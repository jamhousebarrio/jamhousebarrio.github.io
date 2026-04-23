(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();

  var approvedMembers = members.filter(function (m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  var shifts = [];
  var EVENT_DATES = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];

  async function fetchShifts() {
    var r = await JH.apiFetch('/api/shifts', {});
    if (!r.ok) return;
    var data = await r.json();
    shifts = data.shifts || [];
  }

  function getShiftTypes() {
    var types = {};
    shifts.forEach(function (s) {
      var key = s.Name || 'Unknown';
      if (!types[key]) {
        types[key] = { name: key, time: '', startTime: '', endTime: '', description: '', shifts: {} };
      }
      if (!types[key].time && s.StartTime) {
        types[key].time = JH.to24h(s.StartTime) + (s.EndTime ? ' - ' + JH.to24h(s.EndTime) : '');
        types[key].startTime = s.StartTime;
        types[key].endTime = s.EndTime || '';
      }
      if (!types[key].description && s.Description) {
        types[key].description = s.Description;
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
      var nameEsc = JH.esc(type.name);
      html += '<tr>';
      html += '<td>';
      html += '<button class="role-name-btn role-desc-btn" data-name="' + nameEsc + '" title="Click for description">' + nameEsc + '</button>';
      if (isAdmin) {
        html += ' <button class="edit-type-btn" data-name="' + nameEsc + '" title="Edit shift type">&#9998;</button>';
        html += ' <button class="remove-btn delete-type-btn" data-name="' + nameEsc + '" title="Delete all shifts of this type">&times;</button>';
      }
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
          html += '<button class="signup-btn assign-btn" data-id="' + JH.esc(s.ShiftID) + '" data-name="' + JH.esc(type.name) + '" data-date="' + JH.esc(date) + '">+ Sign Up</button>';
        }
        html += '</div></td>';
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  document.getElementById('shifts-wrap').addEventListener('click', async function (e) {
    var btn = e.target.closest('.role-desc-btn');
    if (btn) {
      openDescModal(btn.dataset.name);
      return;
    }

    btn = e.target.closest('.edit-type-btn');
    if (btn) {
      openEditModal(btn.dataset.name);
      return;
    }

    btn = e.target.closest('.assign-btn');
    if (btn) {
      openAssignModal(btn.dataset.id, btn.dataset.name, btn.dataset.date);
      return;
    }

    btn = e.target.closest('.remove-person-btn');
    if (btn) {
      e.stopPropagation();
      var person = btn.dataset.person;
      var shiftId = btn.dataset.id;
      if (!confirm('Remove ' + person + ' from this shift?')) return;
      var s = shifts.find(function (sh) { return sh.ShiftID === shiftId; });
      if (!s) return;
      var people = (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      var updated = people.filter(function (p) { return p !== person; }).join(', ');
      var action = updated ? 'assign' : 'unassign';
      var body = { action: action, shiftId: shiftId };
      if (updated) body.memberName = updated;
      var r = await JH.apiFetch('/api/shifts', body);
      if (!r.ok) { alert('Failed.'); return; }
      await reload();
      return;
    }

    btn = e.target.closest('.delete-type-btn');
    if (btn) {
      var name = btn.dataset.name;
      if (!confirm('Delete ALL "' + name + '" shifts across all days?')) return;
      var typeShifts = shifts.filter(function (s) { return s.Name === name; });
      for (var i = 0; i < typeShifts.length; i++) {
        await JH.apiFetch('/api/shifts', { action: 'delete', shiftId: typeShifts[i].ShiftID });
      }
      await reload();
    }
  });

  // ── Description popover ─────────────────────────────────────────────────

  var descModal = document.getElementById('desc-modal');
  function openDescModal(name) {
    var type = getShiftTypes().find(function (t) { return t.name === name; });
    document.getElementById('desc-modal-title').childNodes[0].nodeValue = name + ' ';
    document.getElementById('desc-modal-meta').textContent = type && type.time ? type.time : '';
    var body = document.getElementById('desc-modal-body');
    if (type && type.description) {
      body.className = 'desc-body';
      body.textContent = type.description;
    } else {
      body.className = 'desc-body desc-empty';
      body.textContent = 'No description yet.' + (isAdmin ? ' Click the pencil next to the name to add one.' : '');
    }
    descModal.classList.add('active');
  }
  document.getElementById('desc-modal-close').addEventListener('click', function () { descModal.classList.remove('active'); });
  descModal.addEventListener('click', function (e) { if (e.target === descModal) descModal.classList.remove('active'); });

  // ── Add / edit shift type modal ─────────────────────────────────────────

  if (isAdmin) document.getElementById('add-shift-btn').style.display = '';

  var addModal = document.getElementById('add-modal');
  var editingName = null;

  function resetAddModalFields() {
    document.getElementById('shift-name').value = '';
    document.getElementById('shift-desc').value = '';
    document.getElementById('shift-start').value = '';
    document.getElementById('shift-end').value = '';
    document.getElementById('add-msg').textContent = '';
  }

  function openAddModal() {
    editingName = null;
    resetAddModalFields();
    document.getElementById('add-modal-title').childNodes[0].nodeValue = 'Add Shift Type ';
    document.getElementById('add-shift-save').textContent = 'Create for all days';
    addModal.classList.add('active');
    JH.initTime(document.getElementById('shift-start'));
    JH.initTime(document.getElementById('shift-end'));
  }

  function openEditModal(name) {
    var type = getShiftTypes().find(function (t) { return t.name === name; });
    if (!type) return;
    editingName = name;
    resetAddModalFields();
    document.getElementById('add-modal-title').childNodes[0].nodeValue = 'Edit Shift Type ';
    document.getElementById('add-shift-save').textContent = 'Save changes';
    document.getElementById('shift-name').value = type.name;
    document.getElementById('shift-desc').value = type.description || '';
    document.getElementById('shift-start').value = type.startTime || '';
    document.getElementById('shift-end').value = type.endTime || '';
    addModal.classList.add('active');
    JH.initTime(document.getElementById('shift-start'));
    JH.initTime(document.getElementById('shift-end'));
  }

  document.getElementById('add-shift-btn').addEventListener('click', openAddModal);
  document.getElementById('add-modal-close').addEventListener('click', function () { addModal.classList.remove('active'); });
  addModal.addEventListener('click', function (e) { if (e.target === addModal) addModal.classList.remove('active'); });

  document.getElementById('add-shift-save').addEventListener('click', async function () {
    var name = document.getElementById('shift-name').value.trim();
    var desc = document.getElementById('shift-desc').value.trim();
    var start = document.getElementById('shift-start').value;
    var end = document.getElementById('shift-end').value;
    var msg = document.getElementById('add-msg');

    if (!name) { msg.textContent = 'Name required'; msg.style.color = '#f44336'; return; }
    msg.textContent = 'Saving...'; msg.style.color = '#888';

    if (editingName) {
      var r = await JH.apiFetch('/api/shifts', {
        action: 'rename-type',
        oldName: editingName,
        newName: name,
        description: desc,
        startTime: start || '',
        endTime: end || '',
      });
      if (!r.ok) { msg.textContent = 'Failed'; msg.style.color = '#f44336'; return; }
    } else {
      for (var i = 0; i < EVENT_DATES.length; i++) {
        var date = EVENT_DATES[i];
        var shiftId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date;
        await JH.apiFetch('/api/shifts', {
          action: 'create',
          shiftId: shiftId,
          name: name,
          description: desc,
          date: date,
          startTime: start || '',
          endTime: end || '',
        });
      }
    }

    addModal.classList.remove('active');
    editingName = null;
    resetAddModalFields();
    await reload();
  });

  // ── Assign modal ────────────────────────────────────────────────────────

  var assignModal = document.getElementById('assign-modal');
  var assignShiftId = null;

  function openAssignModal(shiftId, shiftName, date) {
    assignShiftId = shiftId;
    document.getElementById('assign-info').textContent = shiftName + ' — ' + JH.formatDateLong(date);
    var sel = document.getElementById('assign-select');
    sel.innerHTML = '<option value="">Select volunteer...</option>';
    var myName = JH.currentUser.name;

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

    var s = shifts.find(function (sh) { return sh.ShiftID === assignShiftId; });
    var existing = s ? (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean) : [];
    if (existing.indexOf(name) !== -1) { msg.textContent = 'Already assigned'; msg.style.color = '#ff9800'; return; }
    existing.push(name);
    var combined = existing.join(', ');

    var r = await JH.apiFetch('/api/shifts', { action: 'assign', shiftId: assignShiftId, memberName: combined });
    if (!r.ok) { msg.textContent = 'Failed.'; msg.style.color = '#f44336'; return; }

    assignModal.classList.remove('active');
    msg.textContent = '';
    await reload();
  });

  async function reload() {
    await fetchShifts();
    renderStats();
    renderGrid();
  }

  await reload();
})();
