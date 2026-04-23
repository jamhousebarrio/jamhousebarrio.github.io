(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();

  var approvedMembers = members.filter(function (m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  var shifts = [];
  var logistics = [];
  var EVENT_DATES = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];
  var MAIN_START = parseDate('2026-07-07');
  var MAIN_END = parseDate('2026-07-12');

  async function fetchShifts() {
    var r = await JH.apiFetch('/api/shifts', {});
    if (!r.ok) return;
    var data = await r.json();
    shifts = data.shifts || [];
  }

  async function fetchLogistics() {
    var r = await JH.apiFetch('/api/logistics', {});
    if (!r.ok) { logistics = []; return; }
    var data = await r.json();
    logistics = data.logistics || [];
  }

  function parseDate(s) {
    if (!s) return null;
    s = s.toString().trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return isNaN(dt.getTime()) ? null : dt;
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      var dt2 = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      return isNaN(dt2.getTime()) ? null : dt2;
    }
    return null;
  }

  function daysInclusive(from, to) {
    if (!from || !to || to < from) return 0;
    return Math.floor((to - from) / 86400000) + 1;
  }

  function durationHours(start, end) {
    if (!start || !end) return 0;
    var sp = start.split(':'); var ep = end.split(':');
    if (sp.length < 2 || ep.length < 2) return 0;
    var mins = (+ep[0] * 60 + +ep[1]) - (+sp[0] * 60 + +sp[1]);
    if (mins <= 0) mins += 24 * 60;
    return mins / 60;
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
        slot = { key: k, startTime: s.StartTime || '', endTime: s.EndTime || '', maxPerSlot: s.MaxPerSlot || '', label: slotLabel(s.StartTime, s.EndTime), shiftsByDate: {} };
        t.slots.push(slot);
        t.slotIdx[k] = slot;
      }
      if (!slot.maxPerSlot && s.MaxPerSlot) slot.maxPerSlot = s.MaxPerSlot;
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
        html += ' <button class="delete-type-btn" data-name="' + nameEsc + '" title="Delete all shifts of this type">&times;</button>';
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
            var maxNum = parseInt(s.MaxPerSlot || '', 10);
            var isFull = !isNaN(maxNum) && maxNum > 0 && people.length >= maxNum;
            people.forEach(function (person) {
              html += '<span class="shift-chip filled">' + JH.esc(person);
              if (isAdmin) {
                html += ' <button class="remove-btn remove-person-btn" data-id="' + JH.esc(s.ShiftID) + '" data-person="' + JH.esc(person) + '" title="Remove ' + JH.esc(person) + '">&times;</button>';
              }
              html += '</span>';
            });
            if (isFull) {
              html += '<span class="shift-full-tag">Full' + (maxNum ? ' (' + maxNum + ')' : '') + '</span>';
              if (isAdmin) {
                html += '<button class="signup-btn assign-btn override-btn" data-id="' + JH.esc(s.ShiftID) + '" data-name="' + JH.esc(type.name) + '" data-date="' + JH.esc(date) + '" title="Override cap (admin only)">+ Override</button>';
              }
            } else {
              var capNote = (!isNaN(maxNum) && maxNum > 0) ? ' (' + people.length + '/' + maxNum + ')' : '';
              html += '<button class="signup-btn assign-btn" data-id="' + JH.esc(s.ShiftID) + '" data-name="' + JH.esc(type.name) + '" data-date="' + JH.esc(date) + '">+ Sign Up' + capNote + '</button>';
            }
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
    if (btn) {
      var isOverride = btn.classList.contains('override-btn');
      if (isOverride) {
        if (!isAdmin) return;
        if (!confirm('This shift is already at capacity. Override and add another volunteer anyway?')) return;
      }
      openAssignModal(btn.dataset.id, btn.dataset.name, btn.dataset.date, isOverride);
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

  function addSlotRow(startVal, endVal, maxVal) {
    var row = document.createElement('div');
    row.className = 'slot-row';
    row.innerHTML = '<input type="text" class="slot-start" placeholder="Start HH:MM">' +
                    '<input type="text" class="slot-end" placeholder="End HH:MM">' +
                    '<input type="number" min="1" step="1" class="slot-max" placeholder="Max">' +
                    '<button type="button" class="slot-row-remove" title="Remove slot">&times;</button>';
    slotsList.appendChild(row);
    var startEl = row.querySelector('.slot-start');
    var endEl = row.querySelector('.slot-end');
    var maxEl = row.querySelector('.slot-max');
    if (startVal) startEl.value = startVal;
    if (endVal) endEl.value = endVal;
    if (maxVal) maxEl.value = maxVal;
    JH.initTime(startEl);
    JH.initTime(endEl);
    row.querySelector('.slot-row-remove').addEventListener('click', function () {
      if (slotsList.children.length <= 1) {
        startEl.value = ''; endEl.value = ''; maxEl.value = '';
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
      var mRaw = r.querySelector('.slot-max').value.trim();
      var mVal = mRaw === '' ? '' : String(Math.max(1, parseInt(mRaw, 10) || 0));
      if (!s && !e) return;
      out.push({ startTime: s, endTime: e, maxPerSlot: mVal, key: slotKey(s, e) });
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
    document.getElementById('delete-type-btn').style.display = 'none';
    addSlotRow('', '', '');
    addModal.classList.add('active');
  }

  function openEditModal(name) {
    var type = getShiftTypes().find(function (t) { return t.name === name; });
    if (!type) return;
    editingName = name;
    editingOriginalSlots = type.slots.map(function (s) {
      return { startTime: s.startTime, endTime: s.endTime, maxPerSlot: s.maxPerSlot || '', key: slotKey(s.startTime, s.endTime) };
    });
    resetAddModalFields();
    document.getElementById('add-modal-title').childNodes[0].nodeValue = 'Edit Shift Type ';
    document.getElementById('add-shift-save').textContent = 'Save changes';
    document.getElementById('delete-type-btn').style.display = '';
    document.getElementById('shift-name').value = type.name;
    document.getElementById('shift-desc').value = type.description || '';
    if (type.slots.length) {
      type.slots.forEach(function (s) { addSlotRow(s.startTime, s.endTime, s.maxPerSlot || ''); });
    } else {
      addSlotRow('', '', '');
    }
    addModal.classList.add('active');
  }

  document.getElementById('add-shift-btn').addEventListener('click', openAddModal);
  document.getElementById('add-modal-close').addEventListener('click', function () { addModal.classList.remove('active'); });
  addModal.addEventListener('click', function (e) { if (e.target === addModal) addModal.classList.remove('active'); });
  document.getElementById('add-slot-row-btn').addEventListener('click', function () { addSlotRow('', '', ''); });

  document.getElementById('delete-type-btn').addEventListener('click', async function () {
    if (!editingName) return;
    if (!confirm('Delete ALL "' + editingName + '" shifts across all days? This cannot be undone.')) return;
    var msg = document.getElementById('add-msg');
    msg.textContent = 'Deleting...'; msg.style.color = '#888';
    var typeShifts = shifts.filter(function (s) { return s.Name === editingName; });
    for (var i = 0; i < typeShifts.length; i++) {
      await JH.apiFetch('/api/shifts', { action: 'delete', shiftId: typeShifts[i].ShiftID });
    }
    addModal.classList.remove('active');
    editingName = null;
    editingOriginalSlots = [];
    resetAddModalFields();
    await reload();
  });

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
        var oldByKey = {};
        editingOriginalSlots.forEach(function (s) { oldByKey[s.key] = s; });
        var newByKey = {};
        newSlots.forEach(function (s) { newByKey[s.key] = s; });
        var removed = editingOriginalSlots.filter(function (s) { return !newByKey[s.key]; });
        var added = newSlots.filter(function (s) { return !oldByKey[s.key]; });
        var kept = newSlots.filter(function (s) { return oldByKey[s.key]; });
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
              name: name, description: desc, maxPerSlot: slot.maxPerSlot,
              date: date, startTime: slot.startTime, endTime: slot.endTime,
            });
          }
        }
        for (var k = 0; k < kept.length; k++) {
          var newSlot = kept[k];
          var oldSlot = oldByKey[newSlot.key];
          if ((oldSlot.maxPerSlot || '') !== (newSlot.maxPerSlot || '')) {
            await JH.apiFetch('/api/shifts', {
              action: 'update-slot-max',
              name: name, startTime: newSlot.startTime, endTime: newSlot.endTime,
              maxPerSlot: newSlot.maxPerSlot,
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
              name: name, description: desc, maxPerSlot: slot2.maxPerSlot,
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
  var assignOverride = false;

  function openAssignModal(shiftId, shiftName, date, override) {
    assignShiftId = shiftId;
    assignOverride = !!override;
    document.getElementById('assign-info').textContent = shiftName + ' — ' + JH.formatDateLong(date) + (override ? '  (override — cap exceeded)' : '');
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

    var body = { action: 'assign', shiftId: assignShiftId, memberName: combined };
    if (assignOverride && isAdmin) body.override = true;
    var r = await JH.apiFetch('/api/shifts', body);
    if (!r.ok) {
      var errText = 'Failed.';
      try { var j = await r.json(); if (j && j.error) errText = j.error; } catch (e) {}
      msg.textContent = errText; msg.style.color = '#f44336'; return;
    }
    assignOverride = false;

    assignModal.classList.remove('active');
    msg.textContent = '';
    await reload();
  });

  // ── Contribution leaderboard ────────────────────────────────────────────

  function displayName(m) {
    return JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '';
  }

  function logisticsFor(name) {
    var lower = (name || '').toLowerCase().trim();
    if (!lower) return null;
    return logistics.find(function (l) {
      return (l.MemberName || '').toLowerCase().trim() === lower;
    }) || null;
  }

  function norm(s) { return (s || '').toString().toLowerCase().trim(); }

  function computeContributions() {
    // Accumulate hours under the lowercased/trimmed AssignedTo name so lookup
    // is resilient to casing and whitespace differences.
    var hoursByKey = {};
    shifts.forEach(function (s) {
      if (!s.AssignedTo || !s.Date) return;
      var dt = parseDate(s.Date);
      if (!dt || dt < MAIN_START || dt > MAIN_END) return;
      var hours = durationHours(s.StartTime, s.EndTime);
      if (hours <= 0) return;
      (s.AssignedTo || '').split(',').map(function (p) { return norm(p); }).filter(Boolean).forEach(function (key) {
        hoursByKey[key] = (hoursByKey[key] || 0) + hours;
      });
    });

    return approvedMembers.map(function (m) {
      var name = displayName(m);
      if (!name) return null;
      var playaKey = norm(JH.val(m, 'Playa Name'));
      var legalKey = norm(JH.val(m, 'Name'));
      var log = logisticsFor(name) || logisticsFor(JH.val(m, 'Name'));
      var arr = log ? parseDate(log.ArrivalDate) : null;
      var dep = log ? parseDate(log.DepartureDate) : null;
      var setupDays = 0, strikeDays = 0;
      if (arr && arr < MAIN_START) {
        var lastSetup = new Date(MAIN_START.getTime() - 86400000);
        setupDays = daysInclusive(arr, lastSetup);
      }
      if (dep && dep > MAIN_END) {
        var firstStrike = new Date(MAIN_END.getTime() + 86400000);
        strikeDays = daysInclusive(firstStrike, dep);
      }
      var eventHours = 0;
      if (playaKey && hoursByKey[playaKey]) eventHours += hoursByKey[playaKey];
      if (legalKey && legalKey !== playaKey && hoursByKey[legalKey]) eventHours += hoursByKey[legalKey];
      var score = (setupDays + strikeDays) * 8 + eventHours;
      return { name: name, setupDays: setupDays, strikeDays: strikeDays, eventHours: eventHours, score: score };
    }).filter(Boolean);
  }

  function fmtHours(h) {
    if (!h) return '0h';
    return (h % 1 === 0 ? h : h.toFixed(1)) + 'h';
  }

  function renderRow(entry, rank, isTop) {
    var rankClass = isTop && rank <= 3 ? ' top-' + rank : '';
    var stats = [];
    if (entry.setupDays) stats.push('<strong>' + entry.setupDays + 'd</strong> setup');
    if (entry.strikeDays) stats.push('<strong>' + entry.strikeDays + 'd</strong> strike');
    if (entry.eventHours) stats.push('<strong>' + fmtHours(entry.eventHours) + '</strong> event');
    if (!stats.length) stats.push('<em style="opacity:0.6">no contribution logged</em>');
    return '<div class="lb-row vol-open-btn' + rankClass + '" data-name="' + JH.esc(entry.name) + '" title="Click for breakdown">' +
      '<div class="lb-rank">' + rank + '</div>' +
      '<div class="lb-name">' + JH.esc(entry.name) + '</div>' +
      '<div class="lb-stats">' + stats.join(' · ') + '</div>' +
      '</div>';
  }

  function renderLeaderboard() {
    var wrap = document.getElementById('leaderboard-content');
    if (!wrap) return;
    var entries = computeContributions();
    if (!entries.length) {
      wrap.innerHTML = '<div class="empty-state">No approved members yet.</div>';
      return;
    }
    var sorted = entries.slice().sort(function (a, b) { return b.score - a.score; });
    var top = sorted.filter(function (e) { return e.score > 0; });
    var bottom = sorted.filter(function (e) { return e.score === 0; });

    var html = '<div class="lb-grid">';
    html += '<div class="lb-col top"><h3>Top volunteers</h3><div class="lb-list">';
    top.forEach(function (e, i) { html += renderRow(e, i + 1, true); });
    html += '</div></div>';
    html += '<div class="lb-col bottom"><h3>Needs encouragement</h3><div class="lb-list">';
    bottom.forEach(function (e, i) { html += renderRow(e, i + 1, false); });
    html += '</div></div>';
    html += '</div>';
    wrap.innerHTML = html;
  }

  // ── Volunteer detail popover ────────────────────────────────────────────

  var volModal = document.getElementById('vol-modal');

  function enumerateDays(from, to) {
    var out = [];
    if (!from || !to || to < from) return out;
    var cur = new Date(from.getTime());
    while (cur <= to) {
      out.push(new Date(cur.getTime()));
      cur = new Date(cur.getTime() + 86400000);
    }
    return out;
  }

  function fmtDay(dt) {
    var iso = dt.toISOString().slice(0, 10);
    return JH.formatDateLong ? JH.formatDateLong(iso) : iso;
  }

  function fmtNoOrgDay(s) {
    var dt = parseDate(s);
    return dt ? fmtDay(dt) : s;
  }

  function shiftsForMember(member) {
    var playaKey = norm(JH.val(member, 'Playa Name'));
    var legalKey = norm(JH.val(member, 'Name'));
    return shifts.filter(function (s) {
      if (!s.AssignedTo) return false;
      var names = (s.AssignedTo || '').split(',').map(norm).filter(Boolean);
      return names.indexOf(playaKey) !== -1 || (legalKey && legalKey !== playaKey && names.indexOf(legalKey) !== -1);
    }).sort(function (a, b) {
      if (a.Date !== b.Date) return (a.Date || '').localeCompare(b.Date || '');
      return (a.StartTime || '').localeCompare(b.StartTime || '');
    });
  }

  function openVolModal(name) {
    var member = approvedMembers.find(function (m) { return displayName(m) === name; });
    if (!member) return;
    document.getElementById('vol-modal-title').childNodes[0].nodeValue = name + ' ';

    var log = logisticsFor(name) || logisticsFor(JH.val(member, 'Name'));
    var arr = log ? parseDate(log.ArrivalDate) : null;
    var dep = log ? parseDate(log.DepartureDate) : null;

    var lastSetup = new Date(MAIN_START.getTime() - 86400000);
    var firstStrike = new Date(MAIN_END.getTime() + 86400000);
    var setupDays = (arr && arr < MAIN_START) ? enumerateDays(arr, lastSetup) : [];
    var strikeDays = (dep && dep > MAIN_END) ? enumerateDays(firstStrike, dep) : [];

    var noorg = log ? (log.NoOrgDates || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [];
    var memberShifts = shiftsForMember(member);

    function section(title, bodyHtml, metaHtml) {
      var html = '<div class="vol-section"><h4>' + JH.esc(title) + (metaHtml ? ' <span style="color:var(--accent)">' + metaHtml + '</span>' : '') + '</h4>';
      html += '<div class="vol-list">' + bodyHtml + '</div></div>';
      return html;
    }

    var body = '';
    body += section(
      'Build / setup days',
      setupDays.length ? setupDays.map(function (d) { return JH.esc(fmtDay(d)); }).join('<br>') : '<span class="muted">No setup days logged.</span>',
      setupDays.length ? setupDays.length + 'd' : ''
    );

    body += section(
      'NoOrg days',
      noorg.length ? noorg.map(function (d) { return JH.esc(fmtNoOrgDay(d)); }).join('<br>') : '<span class="muted">None.</span>',
      noorg.length ? noorg.length + 'd' : ''
    );

    var eventShifts = memberShifts.filter(function (s) {
      var dt = parseDate(s.Date);
      return dt && dt >= MAIN_START && dt <= MAIN_END;
    });
    var eventHours = eventShifts.reduce(function (sum, s) { return sum + durationHours(s.StartTime, s.EndTime); }, 0);
    var eventBody = eventShifts.length
      ? eventShifts.map(function (s) {
          var t = slotLabel(s.StartTime, s.EndTime) || '—';
          return '<div class="vol-shift-row"><span>' + JH.esc(s.Name || '') + '</span><span class="vol-shift-time">' + JH.esc(t) + '</span><span class="vol-shift-date">' + JH.esc(JH.formatDateLong(s.Date)) + '</span></div>';
        }).join('')
      : '<span class="muted">No event shifts signed up for.</span>';
    body += section(
      'Event shifts',
      eventBody,
      eventHours ? fmtHours(eventHours) : ''
    );

    body += section(
      'Strike days',
      strikeDays.length ? strikeDays.map(function (d) { return JH.esc(fmtDay(d)); }).join('<br>') : '<span class="muted">No strike days logged.</span>',
      strikeDays.length ? strikeDays.length + 'd' : ''
    );

    document.getElementById('vol-modal-body').innerHTML = body;
    volModal.classList.add('active');
  }

  document.getElementById('vol-modal-close').addEventListener('click', function () { volModal.classList.remove('active'); });
  volModal.addEventListener('click', function (e) { if (e.target === volModal) volModal.classList.remove('active'); });

  document.getElementById('leaderboard-content').addEventListener('click', function (e) {
    var row = e.target.closest('.vol-open-btn');
    if (row) openVolModal(row.dataset.name);
  });

  // ── Print / PDF export ──────────────────────────────────────────────────

  function buildPrintHtml() {
    var byDate = {};
    EVENT_DATES.forEach(function (d) { byDate[d] = []; });
    shifts.forEach(function (s) {
      if (!s.Date || !byDate[s.Date]) return;
      byDate[s.Date].push(s);
    });
    EVENT_DATES.forEach(function (d) {
      byDate[d].sort(function (a, b) {
        var ta = (a.StartTime || '').localeCompare(b.StartTime || '');
        if (ta !== 0) return ta;
        return (a.Name || '').localeCompare(b.Name || '');
      });
    });

    var css = '\
      @page { size: A4 portrait; margin: 14mm; }\
      * { box-sizing: border-box; }\
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; line-height: 1.35; }\
      h1 { font-size: 22pt; margin: 0 0 4mm; letter-spacing: -0.01em; }\
      h2 { font-size: 14pt; margin: 8mm 0 3mm; padding-bottom: 2mm; border-bottom: 2px solid #111; }\
      .sub { color: #555; font-size: 10pt; margin-bottom: 6mm; }\
      .day { page-break-before: always; }\
      .day:first-of-type { page-break-before: auto; }\
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }\
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ccc; vertical-align: top; }\
      th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #555; border-bottom: 2px solid #111; background: #f5f5f5; }\
      td.time { white-space: nowrap; font-variant-numeric: tabular-nums; width: 22mm; }\
      td.role { font-weight: 600; width: 34mm; }\
      td.cap { text-align: right; color: #555; width: 14mm; white-space: nowrap; }\
      td.vols { color: #111; }\
      .empty { color: #999; font-style: italic; }\
      .footer { margin-top: 8mm; font-size: 8pt; color: #888; text-align: right; }\
    ';

    function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    var body = '<h1>JamHouse — Volunteer Schedule</h1>';
    body += '<div class="sub">Elsewhere 2026 · event days July 7 – 12</div>';

    EVENT_DATES.forEach(function (d) {
      var list = byDate[d];
      body += '<div class="day">';
      body += '<h2>' + esc(JH.formatDateLong(d)) + '</h2>';
      if (!list.length) {
        body += '<p class="empty">No shifts scheduled.</p>';
      } else {
        body += '<table><thead><tr><th>Time</th><th>Role</th><th>Volunteers</th><th>Cap</th></tr></thead><tbody>';
        list.forEach(function (s) {
          var timeLabel = s.StartTime ? (JH.to24h(s.StartTime) + (s.EndTime ? ' – ' + JH.to24h(s.EndTime) : '')) : '';
          var people = (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
          var max = parseInt(s.MaxPerSlot || '', 10);
          var capCell = !isNaN(max) && max > 0 ? (people.length + '/' + max) : (people.length ? String(people.length) : '');
          var volsHtml = people.length ? esc(people.join(', ')) : '<span class="empty">— unfilled —</span>';
          body += '<tr>';
          body += '<td class="time">' + esc(timeLabel) + '</td>';
          body += '<td class="role">' + esc(s.Name || '') + '</td>';
          body += '<td class="vols">' + volsHtml + '</td>';
          body += '<td class="cap">' + esc(capCell) + '</td>';
          body += '</tr>';
        });
        body += '</tbody></table>';
      }
      body += '</div>';
    });

    body += '<div class="footer">Printed ' + new Date().toLocaleDateString('en-GB') + ' · jamhouse.space</div>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>JamHouse Shifts</title><style>' + css + '</style></head><body>' + body + '</body></html>';
  }

  document.getElementById('print-shifts-btn').addEventListener('click', function () {
    var html = buildPrintHtml();
    var w = window.open('', '_blank');
    if (!w) { alert('Popup blocked — allow popups for this site to print.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    // Give the browser a tick to lay out before the print dialog.
    setTimeout(function () { try { w.print(); } catch (e) {} }, 300);
  });

  async function reload() {
    await Promise.all([fetchShifts(), fetchLogistics()]);
    renderStats();
    renderGrid();
    renderLeaderboard();
  }

  await reload();
})();
