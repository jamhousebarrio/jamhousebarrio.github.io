import { buildWeightIndex, typePoints, rolePoints, memberPoints, durationHours } from '/assets/js/shift-points-logic.js';

(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var isAdmin = JH.isAdmin();
  var isObserver = !!(JH.currentUser && JH.currentUser.observer);

  var approvedMembers = members.filter(function (m) {
    return (JH.val(m, 'Status') || '').toLowerCase() === 'approved';
  });

  var shifts = [];
  var logistics = [];
  var weights = [];
  var roles = [];
  var weightIndex = buildWeightIndex([]);
  var EVENT_DATES = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];
  var MAIN_START = parseDate('2026-07-07');
  var MAIN_END = parseDate('2026-07-12');
  var lastFairShare = 0;

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

  async function fetchWeights() {
    var r = await JH.apiFetch('/api/shifts', { action: 'get-weights' });
    if (!r.ok) { weights = []; weightIndex = buildWeightIndex([]); return; }
    var data = await r.json();
    weights = data.weights || [];
    weightIndex = buildWeightIndex(weights);
  }

  async function fetchRoles() {
    var r = await JH.apiFetch('/api/roles', {});
    if (!r.ok) { roles = []; return; }
    var data = await r.json();
    roles = data.roles || [];
  }

  // After a type's shifts are all deleted, drop its weight row so it doesn't
  // linger. Best-effort: re-save the surviving types (set-weights deletes all
  // type rows then rewrites), keeping the current build/strike values. An orphan
  // row is harmless (the type no longer exists), so failures are ignored.
  // Call fetchShifts() first so getShiftTypes() reflects the deletion.
  async function cleanupWeightsAfterDelete() {
    var surviving = getShiftTypes().map(function (t) {
      var key = t.name.toLowerCase().trim();
      var pts = Object.prototype.hasOwnProperty.call(weightIndex.types, key) ? weightIndex.types[key] : 1;
      return { name: t.name, points: pts };
    });
    try {
      await JH.apiFetch('/api/shifts', { action: 'set-weights', types: surviving, buildPts: weightIndex.buildPts, strikePts: weightIndex.strikePts });
    } catch (e) { /* harmless if it fails */ }
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
    var totalSlots = 0, filledPeople = 0, eventPointPool = 0;
    types.forEach(function (t) {
      t.slots.forEach(function (slot) {
        EVENT_DATES.forEach(function (d) {
          var s = slot.shiftsByDate[d];
          if (s) {
            totalSlots++;
            var people = (s.AssignedTo || '').split(',').filter(function (p) { return p.trim(); });
            filledPeople += people.length;
            // A cell's full point demand is points-per-position × number of positions.
            // Blank/0/NaN MaxPerSlot defaults to 1 (one person slot). Mirrors how the
            // leaderboard awards: each assigned name on a cell earns typePoints once.
            var cap = parseInt(s.MaxPerSlot, 10);
            if (!cap || cap < 1) cap = 1;
            eventPointPool += typePoints(weightIndex, s.Name) * cap;
          }
        });
      });
    });
    // Roles pool: every role assignment awards rolePoints (default 10) — mirrors
    // the leaderboard's rolePoints(index, roleName) per AssignedTo entry.
    var rolePool = 0;
    (roles || []).forEach(function (role) {
      var assigned = (role.AssignedTo || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      rolePool += assigned.length * rolePoints(weightIndex, role.Name);
    });
    // Build/strike pool: each approved member's earnable build & strike days at
    // their current arrival/departure, minus NoOrg days. Identical to what
    // memberPoints() computes per member, summed across the barrio. Members
    // without filled logistics contribute 0.
    var buildPool = 0, strikePool = 0;
    (approvedMembers || []).forEach(function (m) {
      var name = (JH.val(m, 'Playa Name') || JH.val(m, 'Name') || '').toLowerCase().trim();
      var log = (logistics || []).find(function (l) {
        return (l.MemberName || '').toLowerCase().trim() === name;
      });
      if (!log) return;
      var pts = memberPoints({
        arrivalDate: log.ArrivalDate || '',
        departureDate: log.DepartureDate || '',
        noOrgDates: log.NoOrgDates || '',
        eventShifts: [],
        roleNames: [],
        index: weightIndex,
      });
      buildPool += pts.buildPoints;
      strikePool += pts.strikePoints;
    });
    var totalPool = eventPointPool + rolePool + buildPool + strikePool;
    document.getElementById('stat-types').textContent = types.length;
    document.getElementById('stat-filled').textContent = filledPeople;
    document.getElementById('stat-open').textContent = totalSlots - shifts.filter(function (s) { return s.AssignedTo; }).length;
    var poolEl = document.getElementById('stat-event-pool');
    var shareEl = document.getElementById('stat-fair-share');
    var memberCount = approvedMembers.length || 1;
    if (poolEl) {
      poolEl.textContent = totalPool;
      poolEl.title = 'Event shifts: ' + eventPointPool +
        ' · Build: ' + buildPool +
        ' · Strike: ' + strikePool +
        ' · Roles: ' + rolePool;
    }
    lastFairShare = totalPool / memberCount;
    if (shareEl) {
      shareEl.textContent = lastFairShare.toFixed(1);
      shareEl.parentElement.querySelector('.stat-label').textContent = 'Fair Share / ' + memberCount;
    }
  }

  // Renders the assignee chips + signup/remove/override controls for one shift
  // cell. Shared by the desktop grid and the mobile accordion so both reuse the
  // same data-attribute buttons handled by the delegated #shifts-wrap listener.
  // Fill-state CSS class for the cell wrapper. Mirrors the leaderboard zone
  // colours: green=full, yellow=partial, red=empty. Returns '' for no-shift
  // cells (rendered as em-dash) so neutral grid background stays.
  function cellFillClass(s) {
    if (!s) return '';
    var people = (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    var max = parseInt(s.MaxPerSlot || '', 10);
    var hasCap = !isNaN(max) && max > 0;
    if (!people.length) return ' fill-empty';
    if (hasCap && people.length >= max) return ' fill-full';
    return ' fill-partial';
  }

  function renderShiftCellInner(s, typeName, date) {
    var html = '';
    if (!s) {
      html += '<span class="no-shift">&mdash;</span>';
      return html;
    }
    var people = (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    var maxNum = parseInt(s.MaxPerSlot || '', 10);
    var isFull = !isNaN(maxNum) && maxNum > 0 && people.length >= maxNum;
    people.forEach(function (person) {
      html += '<span class="shift-chip filled">' + JH.nameLink(person);
      if (isAdmin) {
        html += ' <button class="remove-btn remove-person-btn" data-id="' + JH.esc(s.ShiftID) + '" data-person="' + JH.esc(person) + '" title="Remove ' + JH.esc(person) + '">&times;</button>';
      }
      html += '</span>';
    });
    if (isFull) {
      html += '<span class="shift-full-tag">Full' + (maxNum ? ' (' + maxNum + ')' : '') + '</span>';
      if (isAdmin && !isObserver) {
        html += '<button class="signup-btn assign-btn override-btn" data-id="' + JH.esc(s.ShiftID) + '" data-name="' + JH.esc(typeName) + '" data-date="' + JH.esc(date) + '" title="Override cap (admin only)">+ Override</button>';
      }
    } else if (!isObserver) {
      var capNote = (!isNaN(maxNum) && maxNum > 0) ? ' (' + people.length + '/' + maxNum + ')' : '';
      html += '<button class="signup-btn assign-btn" data-id="' + JH.esc(s.ShiftID) + '" data-name="' + JH.esc(typeName) + '" data-date="' + JH.esc(date) + '">+ Sign Up' + capNote + '</button>';
    }
    return html;
  }

  // Stacked accordion (one per event day) for ≤480px viewports. Reuses
  // renderShiftCellInner, so signup/remove/override flow through the same
  // delegated handler as the desktop grid — no duplicated API logic.
  function renderMobileCards(types) {
    var html = '<div class="mobile-cards" id="shifts-mobile">';
    EVENT_DATES.forEach(function (date, di) {
      // Count open/filled slots for the day to show a quick summary in the head.
      var filled = 0, slotsOnDay = 0;
      types.forEach(function (type) {
        type.slots.forEach(function (slot) {
          var s = slot.shiftsByDate[date];
          if (!s) return;
          slotsOnDay++;
          var ppl = (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
          if (ppl.length) filled++;
        });
      });
      var openClass = di === 0 ? ' open' : '';
      html += '<div class="m-acc' + openClass + '">';
      html += '<div class="m-acc-head"><span>' + JH.esc(JH.formatDateLong(date)) + '</span>';
      html += '<span class="m-acc-meta">' + filled + '/' + slotsOnDay + ' filled <span class="chev">&#9662;</span></span></div>';
      html += '<div class="m-acc-body">';
      if (!slotsOnDay) {
        html += '<div class="m-empty">No shifts this day.</div>';
      } else {
        types.forEach(function (type) {
          var nameEsc = JH.esc(type.name);
          type.slots.forEach(function (slot) {
            var s = slot.shiftsByDate[date];
            if (!s) return;
            html += '<div class="m-shift">';
            html += '<div class="m-shift-head"><button class="role-name-btn role-desc-btn" data-name="' + nameEsc + '" title="Description">' + nameEsc + '</button>';
            if (slot.label) html += '<span class="m-shift-time">' + JH.esc(slot.label) + '</span>';
            html += '</div>';
            html += '<div class="m-shift-cell' + cellFillClass(s) + '">' + renderShiftCellInner(s, type.name, date) + '</div>';
            html += '</div>';
          });
        });
      }
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function renderGrid() {
    var wrap = document.getElementById('shifts-wrap');
    var types = getShiftTypes();

    if (!types.length) {
      wrap.innerHTML = '<div class="empty-state">No shifts yet.' + (isAdmin ? ' Click "+ Add Shift Type" below.' : '') + '</div>';
      return;
    }

    var html = '<div class="shift-grid hide-on-mobile"><table><thead><tr>';
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
          html += '<div class="shift-cell' + cellFillClass(s) + '">';
          html += renderShiftCellInner(s, type.name, date);
          html += '</div></div>';
        });
        html += '</td>';
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += renderMobileCards(types);
    wrap.innerHTML = html;
  }

  document.getElementById('shifts-wrap').addEventListener('click', async function (e) {
    // Mobile accordion toggle (one per event day). Ignore clicks that landed on
    // an interactive control inside the head (none today, but future-proof).
    var accHead = e.target.closest('.m-acc-head');
    if (accHead && !e.target.closest('button')) {
      accHead.parentElement.classList.toggle('open');
      return;
    }

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
      var r = await JH.apiFetch('/api/shifts', { action: 'remove-assignee', shiftId: shiftId, memberName: person });
      if (!r.ok) {
        var msg = 'Failed.';
        try { var j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
        alert(msg);
        return;
      }
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
      await fetchShifts();        // so getShiftTypes() reflects the deletion
      await cleanupWeightsAfterDelete();
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

  // ── Point weights modal (admin only) ────────────────────────────────────

  if (isAdmin) document.getElementById('points-btn').style.display = '';

  var pointsModal = document.getElementById('points-modal');

  function openPointsModal() {
    document.getElementById('pts-build').value = weightIndex.buildPts;
    document.getElementById('pts-strike').value = weightIndex.strikePts;
    document.getElementById('pts-zone-low').value = weightIndex.zoneLowPct;
    document.getElementById('pts-zone-high').value = weightIndex.zoneHighPct;
    var list = document.getElementById('pts-types-list');
    var types = getShiftTypes();
    if (!types.length) {
      list.innerHTML = '<div style="color:var(--text-muted);font-style:italic;padding:8px 0">No shift types yet.</div>';
    } else {
      list.innerHTML = types.map(function (t) {
        var key = t.name.toLowerCase().trim();
        var hasWeight = Object.prototype.hasOwnProperty.call(weightIndex.types, key);
        var val = hasWeight ? weightIndex.types[key] : 1;
        return '<div class="pts-type-row">' +
          '<label>' + JH.esc(t.name) + (hasWeight ? '' : ' <span style="opacity:0.6;font-style:italic">(default)</span>') + '</label>' +
          '<input type="number" min="0" step="1" class="pts-type-input" data-name="' + JH.esc(t.name) + '" value="' + val + '"></div>';
      }).join('');
    }
    var rolesList = document.getElementById('pts-roles-list');
    var roleNames = roles.map(function (r) { return r.Name; }).filter(Boolean);
    if (!roleNames.length) {
      rolesList.innerHTML = '<div style="color:var(--text-muted);font-style:italic;padding:8px 0">No roles defined yet.</div>';
    } else {
      rolesList.innerHTML = roleNames.map(function (name) {
        var key = name.toLowerCase().trim();
        var hasWeight = Object.prototype.hasOwnProperty.call(weightIndex.roles, key);
        var val = hasWeight ? weightIndex.roles[key] : 10;
        return '<div class="pts-type-row">' +
          '<label>' + JH.esc(name) + (hasWeight ? '' : ' <span style="opacity:0.6;font-style:italic">(default)</span>') + '</label>' +
          '<input type="number" min="0" step="1" class="pts-role-input" data-name="' + JH.esc(name) + '" value="' + val + '"></div>';
      }).join('');
    }

    document.getElementById('points-msg').textContent = '';
    pointsModal.classList.add('active');
  }

  document.getElementById('points-btn').addEventListener('click', openPointsModal);
  document.getElementById('points-modal-close').addEventListener('click', function () { pointsModal.classList.remove('active'); });
  pointsModal.addEventListener('click', function (e) { if (e.target === pointsModal) pointsModal.classList.remove('active'); });

  document.getElementById('points-save').addEventListener('click', async function () {
    var msg = document.getElementById('points-msg');
    msg.textContent = 'Saving...'; msg.style.color = '#888';
    var types = [];
    document.querySelectorAll('.pts-type-input').forEach(function (inp) {
      types.push({ name: inp.dataset.name, points: parseInt(inp.value, 10) || 0 });
    });
    var rolesPayload = [];
    document.querySelectorAll('.pts-role-input').forEach(function (inp) {
      rolesPayload.push({ name: inp.dataset.name, points: parseInt(inp.value, 10) || 0 });
    });
    var buildPts = parseInt(document.getElementById('pts-build').value, 10) || 0;
    var strikePts = parseInt(document.getElementById('pts-strike').value, 10) || 0;
    var zoneLowPct = parseInt(document.getElementById('pts-zone-low').value, 10);
    var zoneHighPct = parseInt(document.getElementById('pts-zone-high').value, 10);
    if (isNaN(zoneLowPct) || zoneLowPct < 1) zoneLowPct = 80;
    if (isNaN(zoneHighPct) || zoneHighPct < 1) zoneHighPct = 120;
    if (zoneHighPct <= zoneLowPct) {
      msg.textContent = 'High band must be greater than low band'; msg.style.color = '#f44336'; return;
    }
    var r = await JH.apiFetch('/api/shifts', { action: 'set-weights', types: types, roles: rolesPayload, buildPts: buildPts, strikePts: strikePts, zoneLowPct: zoneLowPct, zoneHighPct: zoneHighPct });
    if (!r.ok) {
      var err = 'Failed.';
      try { var j = await r.json(); if (j && j.error) err = j.error; } catch (e) {}
      msg.textContent = err; msg.style.color = '#f44336'; return;
    }
    pointsModal.classList.remove('active');
    await reload(); // refetches weights + re-ranks the leaderboard
  });

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
    await fetchShifts();        // so getShiftTypes() reflects the deletion
    await cleanupWeightsAfterDelete();
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

    var body = { action: 'add-assignee', shiftId: assignShiftId, memberName: name };
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

  // Role names assigned to this member — matches the member's playa OR legal name
  // against each role's comma-separated AssignedTo. Mirrors the server-side rule in
  // api/_lib/roles.js isAssignedToRole.
  function rolesForMember(member) {
    var playa = norm(JH.val(member, 'Playa Name'));
    var legal = norm(JH.val(member, 'Name'));
    return roles.filter(function (role) {
      var assigned = (role.AssignedTo || '').split(',').map(norm).filter(Boolean);
      return (playa && assigned.indexOf(playa) !== -1) || (legal && assigned.indexOf(legal) !== -1);
    }).map(function (role) { return role.Name; });
  }

  function computeContributions() {
    // Scoring delegates to the pure shift-points-logic module: points (admin-set
    // per type, plus per-day build/strike values) are the ranking currency;
    // hours are kept as a supporting detail. Per-member shift resolution reuses
    // shiftsForMember (handles playa/legal names + comma-shared slots).
    return approvedMembers.map(function (m) {
      var name = displayName(m);
      if (!name) return null;
      var log = logisticsFor(name) || logisticsFor(JH.val(m, 'Name'));

      var eventShifts = shiftsForMember(m).filter(function (s) {
        var dt = parseDate(s.Date);
        return dt && dt >= MAIN_START && dt <= MAIN_END;
      });

      var memberRoles = rolesForMember(m);
      var r = memberPoints({
        arrivalDate: log ? log.ArrivalDate : '',
        departureDate: log ? log.DepartureDate : '',
        noOrgDates: log ? log.NoOrgDates : '',
        eventShifts: eventShifts,
        roleNames: memberRoles,
        index: weightIndex,
      });

      return {
        name: name,
        roles: memberRoles,
        setupDays: r.buildDays,
        strikeDays: r.strikeDays,
        eventHours: r.eventHours,
        eventPoints: r.eventPoints,
        buildPoints: r.buildPoints,
        strikePoints: r.strikePoints,
        rolePoints: r.rolePoints,
        score: r.points,
      };
    }).filter(Boolean);
  }

  function fmtHours(h) {
    if (!h) return '0h';
    return (h % 1 === 0 ? h : h.toFixed(1)) + 'h';
  }

  function zoneFor(score) {
    if (!lastFairShare || lastFairShare <= 0) return '';
    var lowR = (weightIndex.zoneLowPct || 80) / 100;
    var highR = (weightIndex.zoneHighPct || 120) / 100;
    var ratio = score / lastFairShare;
    if (ratio >= highR) return ' zone-high';
    if (ratio >= lowR) return ' zone-mid';
    return ' zone-low';
  }
  var MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
  function renderRow(entry, rank, isTop) {
    var rankClass = isTop && rank <= 3 ? ' top-' + rank : '';
    var zoneClass = zoneFor(entry.score);
    var rankHtml = (isTop && MEDALS[rank]) ? '<span class="lb-medal">' + MEDALS[rank] + '</span>' : rank;
    var stats = [];
    if (entry.setupDays) stats.push('<strong>' + entry.setupDays + 'd</strong> build');
    if (entry.strikeDays) stats.push('<strong>' + entry.strikeDays + 'd</strong> strike');
    if (entry.eventPoints) stats.push('<strong>' + entry.eventPoints + '</strong> event pts');
    if (entry.rolePoints) stats.push('<strong>' + entry.rolePoints + '</strong> role pts');
    if (entry.eventHours) stats.push('<span style="opacity:0.7">' + fmtHours(entry.eventHours) + '</span>');
    if (!stats.length) stats.push('<em style="opacity:0.6">no contribution logged</em>');
    var deltaLabel = '';
    if (lastFairShare > 0) {
      var diff = entry.score - lastFairShare;
      var pct = Math.round((entry.score / lastFairShare) * 100);
      deltaLabel = '<div class="lb-vs-share" title="vs fair share ' + lastFairShare.toFixed(1) + '">' +
        (diff >= 0 ? '+' : '') + diff.toFixed(1) + ' · ' + pct + '%</div>';
    }
    return '<div class="lb-row vol-open-btn' + rankClass + zoneClass + '" data-name="' + JH.esc(entry.name) + '" title="Click for breakdown">' +
      '<div class="lb-rank">' + rankHtml + '</div>' +
      '<div class="lb-score"><strong>' + entry.score + '</strong> pts' + deltaLabel + '</div>' +
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

    var html = '';
    if (lastFairShare > 0) {
      var lowMult = (weightIndex.zoneLowPct || 80) / 100;
      var highMult = (weightIndex.zoneHighPct || 120) / 100;
      html += '<div class="lb-share-banner">' +
        'Fair share target: <strong>' + lastFairShare.toFixed(1) + ' pts</strong> per member · ' +
        '<span class="zone-high" style="padding:1px 6px;border-radius:8px;">high</span> ≥ ' + (lastFairShare * highMult).toFixed(0) + ' · ' +
        '<span class="zone-mid" style="padding:1px 6px;border-radius:8px;">on track</span> ' + (lastFairShare * lowMult).toFixed(0) + '–' + (lastFairShare * highMult).toFixed(0) + ' · ' +
        '<span class="zone-low" style="padding:1px 6px;border-radius:8px;">low</span> &lt; ' + (lastFairShare * lowMult).toFixed(0) +
        '</div>';
    }
    html += '<div class="lb-grid">';
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

    // Arrival day earns no points (travel/arrival, not setup work); strike's
    // departure day likewise. Show every logged day, but tag the boundary day so
    // the count here matches the points the leaderboard awards. See memberPoints.
    function dayList(days, noPtsIndex, noPtsLabel) {
      return days.map(function (d, i) {
        var tag = i === noPtsIndex ? ' <span class="muted">· ' + noPtsLabel + ' (no points)</span>' : '';
        return JH.esc(fmtDay(d)) + tag;
      }).join('<br>');
    }

    // Authoritative point figures come from the same memberPoints() the leaderboard
    // uses, so the popup math always agrees with the score (incl. NoOrg subtraction).
    var eventShifts = memberShifts.filter(function (s) {
      var dt = parseDate(s.Date);
      return dt && dt >= MAIN_START && dt <= MAIN_END;
    });
    var eventHours = eventShifts.reduce(function (sum, s) { return sum + durationHours(s.StartTime, s.EndTime); }, 0);
    var memberRoleNames = rolesForMember(member);
    var pts = memberPoints({
      arrivalDate: log ? log.ArrivalDate : '',
      departureDate: log ? log.DepartureDate : '',
      noOrgDates: log ? log.NoOrgDates : '',
      eventShifts: eventShifts,
      roleNames: memberRoleNames,
      index: weightIndex,
    });

    var body = '';
    body += section(
      'Build / setup days',
      setupDays.length ? dayList(setupDays, 0, 'arrival') : '<span class="muted">No setup days logged.</span>',
      setupDays.length ? pts.buildDays + 'd × ' + weightIndex.buildPts + ' = ' + pts.buildPoints + ' pts' : ''
    );

    body += section(
      'NoOrg days',
      noorg.length ? noorg.map(function (d) { return JH.esc(fmtNoOrgDay(d)); }).join('<br>') : '<span class="muted">None.</span>',
      noorg.length ? noorg.length + 'd' : ''
    );

    var rolesBody = memberRoleNames.length
      ? memberRoleNames.map(function (rn) {
          return '<div class="vol-shift-row"><span>' + JH.esc(rn) + '</span>' +
            '<span class="vol-shift-pts">' + rolePoints(weightIndex, rn) + ' pts</span></div>';
        }).join('')
      : '<span class="muted">No roles assigned.</span>';
    body += section('Lead roles', rolesBody, memberRoleNames.length ? pts.rolePoints + ' pts' : '');

    var eventBody = eventShifts.length
      ? eventShifts.map(function (s) {
          var t = slotLabel(s.StartTime, s.EndTime) || '—';
          var pts = typePoints(weightIndex, s.Name);
          return '<div class="vol-shift-row"><span>' + JH.esc(s.Name || '') + '</span>' +
            '<span class="vol-shift-time">' + JH.esc(t) + '</span>' +
            '<span class="vol-shift-date">' + JH.esc(JH.formatDateLong(s.Date)) + '</span>' +
            '<span class="vol-shift-pts">' + pts + ' pts</span></div>';
        }).join('')
      : '<span class="muted">No event shifts signed up for.</span>';
    body += section(
      'Event shifts',
      eventBody,
      pts.eventPoints + ' pts' + (eventHours ? ' · ' + fmtHours(eventHours) : '')
    );

    body += section(
      'Strike days',
      strikeDays.length ? dayList(strikeDays, strikeDays.length - 1, 'departure') : '<span class="muted">No strike days logged.</span>',
      strikeDays.length ? pts.strikeDays + 'd × ' + weightIndex.strikePts + ' = ' + pts.strikePoints + ' pts' : ''
    );

    body += '<div class="vol-section vol-total"><h4>Total <span style="color:var(--accent)">' + pts.points + ' pts</span></h4></div>';

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
    function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    // Map whatever name is stored in AssignedTo (playa or legal) back to playa name.
    var playaLookup = {};
    approvedMembers.forEach(function (m) {
      var playa = JH.val(m, 'Playa Name');
      var legal = JH.val(m, 'Name');
      var best = playa || legal;
      if (!best) return;
      if (playa) playaLookup[playa.toLowerCase().trim()] = best;
      if (legal) playaLookup[legal.toLowerCase().trim()] = best;
    });
    function toPlaya(p) { return playaLookup[(p || '').toLowerCase().trim()] || p; }

    // Build one row per (role, slot) keyed by start time so the grid mirrors the on-screen layout.
    var types = getShiftTypes();
    var rows = [];
    types.forEach(function (t) {
      t.slots.forEach(function (slot) {
        rows.push({ name: t.name, slot: slot });
      });
    });
    rows.sort(function (a, b) {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return (a.slot.startTime || '').localeCompare(b.slot.startTime || '');
    });

    var dayCols = EVENT_DATES.map(function (d) {
      var dt = new Date(d + 'T00:00:00Z');
      return { iso: d, label: dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) };
    });

    var css = '\
      @page { size: A4 landscape; margin: 10mm; }\
      * { box-sizing: border-box; }\
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; line-height: 1.4; }\
      h1 { font-size: 16pt; margin: 0 0 2mm; letter-spacing: -0.01em; }\
      .sub { color: #555; font-size: 9pt; margin-bottom: 4mm; }\
      table { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }\
      th, td { padding: 4px 6px; border: 1px solid #bbb; vertical-align: top; }\
      th, td.day, td.time { border-right: 2px solid #111; }\
      td.role { border-right: 2px solid #111; }\
      th:last-child, td.day:last-child { border-right: 1px solid #bbb; }\
      tr.role-start td { border-top: 2px solid #111; }\
      th { background: #111; color: #fff; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; }\
      th.time-head, th.role-head { background: #444; }\
      td.role { font-weight: 600; width: 32mm; }\
      td.time { white-space: nowrap; font-variant-numeric: tabular-nums; width: 22mm; color: #333; font-size: 8.5pt; }\
      td.day { min-height: 18mm; height: 18mm; font-size: 9pt; }\
      td.day.filled { background: #f6f6f6; }\
      td.day .name { display: block; }\
      .footer { margin-top: 4mm; font-size: 7.5pt; color: #888; display: flex; justify-content: space-between; }\
    ';

    var body = '<h1>JamHouse — Volunteer Schedule</h1>';
    body += '<div class="sub">Elsewhere 2026 · event days July 7 – 12</div>';

    if (!rows.length) {
      body += '<p style="color:#999;font-style:italic">No shifts scheduled yet.</p>';
    } else {
      body += '<table><thead><tr>';
      body += '<th class="role-head">Role</th>';
      body += '<th class="time-head">Time</th>';
      dayCols.forEach(function (c) { body += '<th>' + esc(c.label) + '</th>'; });
      body += '</tr></thead><tbody>';

      var prevName = null;
      rows.forEach(function (r) {
        var timeLabel = r.slot.startTime ? (JH.to24h(r.slot.startTime) + (r.slot.endTime ? ' – ' + JH.to24h(r.slot.endTime) : '')) : '';
        var isNewRole = r.name !== prevName;
        prevName = r.name;
        body += '<tr' + (isNewRole ? ' class="role-start"' : '') + '>';
        body += '<td class="role">' + (isNewRole ? esc(r.name) : '') + '</td>';
        body += '<td class="time">' + esc(timeLabel) + '</td>';
        dayCols.forEach(function (c) {
          var s = r.slot.shiftsByDate[c.iso];
          var people = s ? (s.AssignedTo || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean) : [];
          var cls = people.length ? 'day filled' : 'day';
          body += '<td class="' + cls + '">';
          if (people.length) {
            body += people.map(function (p) { return '<span class="name">' + esc(toPlaya(p)) + '</span>'; }).join('');
          }
          body += '</td>';
        });
        body += '</tr>';
      });

      body += '</tbody></table>';
    }

    body += '<div class="footer"><span>Printed ' + new Date().toLocaleDateString('en-GB') + '</span><span>jamhouse.space</span></div>';

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
    await Promise.all([fetchShifts(), fetchLogistics(), fetchWeights(), fetchRoles()]);
    renderStats();
    renderGrid();
    renderLeaderboard();
  }

  await reload();
})();
