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

  function slotKey(start, end) { return (start || '') + '|' + (end || ''); }
  function slotLabel(start, end) {
    if (!start && !end) return 'Any time';
    var s = start ? JH.to24h(start) : '';
    var e = end ? JH.to24h(end) : '';
    return s + (e ? ' - ' + e : '');
  }
  function slugify(s) { return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function getShiftTypes() {
    var types = {};
    shifts.forEach(function (s) {
      var name = s.Name || 'Unknown';
      if (!types[name]) types[name] = { name: name, description: '', slots: [], slotIdx: {} };
      var t = types[name];
      if (!t.description && s.Description) t.description = s.Description;
      var k = slotKey(s.StartTime, s.EndTime);
      var slot = t.slotIdx[k];
      if (!slot) {
        slot = { key: k, startTime: s.StartTime || '', endTime: s.EndTime || '', label: slotLabel(s.StartTime, s.EndTime), shiftsByDate: {} };
        t.slots.push(slot);
        t.slotIdx[k] = slot;
      }
      slot.shiftsByDate[s.Date] = s;
    });
    Object.keys(types).forEach(function (k) {
      types[k].slots.sort(function (a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
    });
    return Object.keys(types).sort().map(function (k) { return types[k]; });
  }

  function renderStats() {
    var types = getShiftTypes();
    var totalSlots = 0, filledPeople = 0;
    types.forEach(function (t) {
      t.slots.forEach(function (slot) {
        EVENT_DATES.forEach(function (d) {
          var s = slot.shiftsByDate[d];
          if (s) {
            totalSlots++;
            var people = (s.AssignedTo || '').split(',').filter(function (p) { return p.trim(); });
            filledPeople += people.length;
          }
        });
      });
    });
    document.getElementById('stat-types').textContent = types.length;
    document.getElementById('stat-filled').textContent = filledPeople;
    document.getElementById('stat-open').textContent = totalSlots - shifts.filter(function (s) { return s.AssignedTo; }).length;
  }

  function renderGrid() {
    var wrap = document.getElementById('shifts-wrap');
    var types = getShiftTypes();

    if (!types.length) {
      wrap.innerHTML = '<div class="empty-state">No shifts yet.' + (isAdmin ? ' Click "+ Add Shift Type" below.' : '') + '</div>';
      return;
    }

    var html = '<div class="shift-grid"><table><thead><tr>';
    html += '<th>Role Name</th>';
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

      EVENT_DATES.forEach(function (date) {
        html += '<td>';
        type.slots.forEach(function (slot) {
          var s = slot.shiftsByDate[date];
          html += '<div class="slot-group">';
          if (slot.label) html += '<div class="slot-time">' + JH.esc(slot.label) + '</div>';
          html += '<div class="shift-cell">';
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
          html += '</div></div>';
        });
        html += '</td>';
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  document.getElementById('shifts-wrap').addEventListener('click', async function (e) {
    var btn = e.target.closest('.role-desc-btn');
    if (btn) { openDescModal(btn.dataset.name); return; }

    btn = e.target.closest('.edit-type-btn');
    if (btn) { openEditModal(btn.dataset.name); return; }

    btn = e.target.closest('.assign-btn');
    if (btn) { openAssignModal(btn.dataset.id, btn.dataset.name, btn.dataset.date); return; }

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
    var meta = type ? type.slots.map(function (sl) { return sl.label; }).filter(Boolean).join(' · ') : '';
    document.getElementById('desc-modal-meta').textContent = meta;
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
  var slotsList = document.getElementById('slots-list');
  var editingName = null;
  var editingOriginalSlots = [];

  function addSlotRow(startVal, endVal) {
    var row = document.createElement('div');
    row.className = 'slot-row';
    row.innerHTML = '<input type="text" class="slot-start" placeholder="Start HH:MM">' +
                    '<input type="text" class="slot-end" placeholder="End HH:MM">' +
                    '<button type="button" class="slot-row-remove" title="Remove slot">&times;</button>';
    slotsList.appendChild(row);
    var startEl = row.querySelector('.slot-start');
    var endEl = row.querySelector('.slot-end');
    if (startVal) startEl.value = startVal;
    if (endVal) endEl.value = endVal;
    JH.initTime(startEl);
    JH.initTime(endEl);
    row.querySelector('.slot-row-remove').addEventListener('click', function () {
      if (slotsList.children.length <= 1) {
        startEl.value = ''; endEl.value = '';
        return;
      }
      row.remove();
    });
  }

  function readSlotRows() {
    var rows = slotsList.querySelectorAll('.slot-row');
    var out = [];
    rows.forEach(function (r) {
      var s = r.querySelector('.slot-start').value.trim();
      var e = r.querySelector('.slot-end').value.trim();
      if (!s && !e) return;
      out.push({ startTime: s, endTime: e, key: slotKey(s, e) });
    });
    return out;
  }

  function resetAddModalFields() {
    document.getElementById('shift-name').value = '';
    document.getElementById('shift-desc').value = '';
    document.getElementById('add-msg').textContent = '';
    slotsList.innerHTML = '';
  }

  function openAddModal() {
    editingName = null;
    editingOriginalSlots = [];
    resetAddModalFields();
    document.getElementById('add-modal-title').childNodes[0].nodeValue = 'Add Shift Type ';
    document.getElementById('add-shift-save').textContent = 'Create for all days';
    addSlotRow('', '');
    addModal.classList.add('active');
  }

  function openEditModal(name) {
    var type = getShiftTypes().find(function (t) { return t.name === name; });
    if (!type) return;
    editingName = name;
    editingOriginalSlots = type.slots.map(function (s) {
      return { startTime: s.startTime, endTime: s.endTime, key: slotKey(s.startTime, s.endTime) };
    });
    resetAddModalFields();
    document.getElementById('add-modal-title').childNodes[0].nodeValue = 'Edit Shift Type ';
    document.getElementById('add-shift-save').textContent = 'Save changes';
    document.getElementById('shift-name').value = type.name;
    document.getElementById('shift-desc').value = type.description || '';
    if (type.slots.length) {
      type.slots.forEach(function (s) { addSlotRow(s.startTime, s.endTime); });
    } else {
      addSlotRow('', '');
    }
    addModal.classList.add('active');
  }

  document.getElementById('add-shift-btn').addEventListener('click', openAddModal);
  document.getElementById('add-modal-close').addEventListener('click', function () { addModal.classList.remove('active'); });
  addModal.addEventListener('click', function (e) { if (e.target === addModal) addModal.classList.remove('active'); });
  document.getElementById('add-slot-row-btn').addEventListener('click', function () { addSlotRow('', ''); });

  function shiftIdFor(name, date, startTime, endTime) {
    var base = slugify(name) + '-' + date;
    var suffix = slugify((startTime || '') + '-' + (endTime || ''));
    return suffix ? base + '-' + suffix : base;
  }

  document.getElementById('add-shift-save').addEventListener('click', async function () {
    var name = document.getElementById('shift-name').value.trim();
    var desc = document.getElementById('shift-desc').value.trim();
    var newSlots = readSlotRows();
    var msg = document.getElementById('add-msg');

    if (!name) { msg.textContent = 'Name required'; msg.style.color = '#f44336'; return; }
    if (!newSlots.length) { msg.textContent = 'Add at least one time slot'; msg.style.color = '#f44336'; return; }
    msg.textContent = 'Saving...'; msg.style.color = '#888';

    try {
      if (editingName) {
        await JH.apiFetch('/api/shifts', {
          action: 'rename-type',
          oldName: editingName,
          newName: name,
          description: desc,
        });
        var oldKeys = editingOriginalSlots.map(function (s) { return s.key; });
        var newKeys = newSlots.map(function (s) { return s.key; });
        var removed = editingOriginalSlots.filter(function (s) { return newKeys.indexOf(s.key) === -1; });
        var added = newSlots.filter(function (s) { return oldKeys.indexOf(s.key) === -1; });
        for (var i = 0; i < removed.length; i++) {
          await JH.apiFetch('/api/shifts', {
            action: 'delete-slot', name: name, startTime: removed[i].startTime, endTime: removed[i].endTime,
          });
        }
        for (var j = 0; j < added.length; j++) {
          var slot = added[j];
          for (var d = 0; d < EVENT_DATES.length; d++) {
            var date = EVENT_DATES[d];
            await JH.apiFetch('/api/shifts', {
              action: 'create',
              shiftId: shiftIdFor(name, date, slot.startTime, slot.endTime),
              name: name, description: desc,
              date: date, startTime: slot.startTime, endTime: slot.endTime,
            });
          }
        }
      } else {
        for (var s = 0; s < newSlots.length; s++) {
          var slot2 = newSlots[s];
          for (var d2 = 0; d2 < EVENT_DATES.length; d2++) {
            var date2 = EVENT_DATES[d2];
            await JH.apiFetch('/api/shifts', {
              action: 'create',
              shiftId: shiftIdFor(name, date2, slot2.startTime, slot2.endTime),
              name: name, description: desc,
              date: date2, startTime: slot2.startTime, endTime: slot2.endTime,
            });
          }
        }
      }
    } catch (e) {
      msg.textContent = 'Failed'; msg.style.color = '#f44336'; return;
    }

    addModal.classList.remove('active');
    editingName = null;
    editingOriginalSlots = [];
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
        var nm = JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
        if (!nm) return;
        var opt = document.createElement('option');
        opt.value = nm; opt.textContent = nm;
        sel.appendChild(opt);
      });
    } else if (myName) {
      var opt = document.createElement('option');
      opt.value = myName; opt.textContent = myName; opt.selected = true;
      sel.appendChild(opt);
    } else {
      approvedMembers.forEach(function (m) {
        var nm2 = JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
        if (!nm2) return;
        var opt2 = document.createElement('option');
        opt2.value = nm2; opt2.textContent = nm2;
        sel.appendChild(opt2);
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
