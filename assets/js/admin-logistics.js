import { parseISO, ganttRange, enumerateDays, barCells, isEventDay, eeColorKey } from '/assets/js/logistics-gantt-logic.js';

(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var approvedMembers = members.filter(function (m) {
    return (m['Status'] || '').toLowerCase() === 'approved';
  });

  var state = { logistics: [], myName: null, editingMember: null };

  function activeName() { return state.editingMember || state.myName; }

  // Find a member's logistics row. `name` can be either Playa Name or Real
  // Name; we look up the row under that key, then fall back to the member's
  // other name (Playa<->Real) for legacy data. Returns the key that matched
  // so saves don't orphan the old row.
  function findLogisticsRow(name) {
    var row = state.logistics.find(function (r) { return r.MemberName === name; });
    if (row) return { row: row, key: name };
    var memberObj = approvedMembers.find(function (m) {
      return (m['Playa Name'] || '') === name || (m['Name'] || '') === name;
    });
    if (memberObj) {
      var alt = memberObj['Playa Name'] === name ? memberObj['Name'] : memberObj['Playa Name'];
      if (alt) {
        row = state.logistics.find(function (r) { return r.MemberName === alt; });
        if (row) return { row: row, key: alt };
      }
    }
    return { row: null, key: name };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function campBadge(type) {
    if (!type) return '<span class="not-filled">—</span>';
    var cls = 'camp-badge camp-' + type.toLowerCase().replace(/\s+/g, '-');
    return '<span class="' + cls + '">' + JH.esc(type) + '</span>';
  }

  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DAYS_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function ordinal(n) {
    var s = ['th','st','nd','rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function formatNoOrgDate(dateStr) {
    var parts = (dateStr || '').split('-');
    if (parts.length !== 3) return dateStr;
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    if (isNaN(d.getTime())) return dateStr;
    return ordinal(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ', ' + DAYS_ABBR[d.getDay()];
  }

  // ── Name selector ─────────────────────────────────────────────────────────

  state.myName = JH.currentUser.playaName || JH.currentUser.name;

  var nameModal = document.getElementById('name-modal');
  var nameSelect = document.getElementById('name-select');
  var nameConfirmBtn = document.getElementById('name-confirm-btn');

  function renderNameDisplay() {
    var wrap = document.getElementById('name-display-wrap');
    wrap.innerHTML = '<div id="name-display" style="margin-bottom:16px"><span style="font-size:0.8rem;color:var(--text-muted)">Signed in as <strong style="color:var(--accent)">' + JH.esc(state.myName) + '</strong></span></div>';
  }

  function populateNameSelect() {
    nameSelect.innerHTML = '<option value="">Select your name...</option>';
    approvedMembers.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      nameSelect.appendChild(opt);
    });
  }

  if (state.myName) {
    nameModal.classList.remove('active');
    renderNameDisplay();
  } else {
    populateNameSelect();
    nameModal.classList.add('active');
  }

  nameConfirmBtn.addEventListener('click', function () {
    var val = nameSelect.value;
    if (!val) return;
    state.myName = val;
    nameModal.classList.remove('active');
    renderNameDisplay();
    render();
  });

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await JH.apiFetch('/api/logistics', {});
    if (!res.ok) { console.error('logistics fetch failed'); return; }
    var data = await res.json();
    state.logistics = data.logistics || [];
    state.earlyEntrySources = data.earlyEntrySources || [];
  }

  // ── My Info panel ─────────────────────────────────────────────────────────

  function renderMyInfo() {
    var wrap = document.getElementById('my-info-content');
    var who = activeName();
    if (!who) {
      wrap.innerHTML = '<div class="empty-state">Select your name to fill in your info.</div>';
      return;
    }

    var found = findLogisticsRow(who);
    var row = found.row || {};
    var hasData = row['ArrivalDate'] || row['DepartureDate'];

    var html = '';
    if (state.editingMember) {
      html += '<div class="editing-banner"><span>Editing <strong>' + JH.esc(state.editingMember) + '</strong></span><a id="back-to-me">\u2190 Back to my info</a></div>';
    }
    if (!hasData) {
      html += '<div style="background:rgba(232,168,76,0.1);border:1px solid var(--accent);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:var(--text)">';
      html += '<strong style="color:var(--accent)">Hey ' + JH.esc(who) + '!</strong> We don\'t have arrival info yet. Please fill in the form below so we can plan meals and pickups.';
      html += '</div>';
    }
    html += '<form id="logistics-form">';
    html += '<div class="form-row"><label>Arrival Date</label><input type="text" id="f-arrival" placeholder="dd/mm/yyyy" value="' + JH.esc(row['ArrivalDate'] || '') + '"></div>';
    html += '<div class="form-row"><label>Arriving at (time)</label><input type="text" id="f-arrival-time" placeholder="HH:MM" value="' + JH.esc(row['ArrivalTime'] || '') + '"><div class="form-hint">So we know how many mouths to feed!</div></div>';
    html += '<div class="form-row"><label>How are you getting there?</label><select id="f-transport">';
    ['', 'vehicle', 'bus', 'train', 'ride-share', 'other'].forEach(function (opt) {
      var selected = (row['Transport'] || '') === opt ? ' selected' : '';
      var label = opt ? opt.charAt(0).toUpperCase() + opt.slice(1) : 'Select...';
      html += '<option value="' + JH.esc(opt) + '"' + selected + '>' + label + '</option>';
    });
    html += '</select></div>';
    var showPickup = row['Transport'] === 'train';
    html += '<div class="form-row pickup-row' + (showPickup ? ' visible' : '') + '" id="pickup-row"><label>Would you like to be picked up?</label><select id="f-pickup">';
    ['', 'yes', 'no'].forEach(function (opt) {
      var selected = (row['NeedsPickup'] || '') === opt ? ' selected' : '';
      var label = opt === 'yes' ? 'Yes please!' : opt === 'no' ? 'No, I\'ll manage' : 'Select...';
      html += '<option value="' + JH.esc(opt) + '"' + selected + '>' + label + '</option>';
    });
    html += '</select></div>';
    html += '<div class="form-row"><label>Departure Date</label><input type="text" id="f-departure" placeholder="dd/mm/yyyy" value="' + JH.esc(row['DepartureDate'] || '') + '"></div>';
    html += '<div class="form-row"><label>Camping Type</label><select id="f-camping">';
    ['', 'tent', 'caravan', 'out-of-camp'].forEach(function (opt) {
      var selected = (row['CampingType'] || '') === opt ? ' selected' : '';
      var label = opt === 'caravan' ? 'Caravan' : (opt ? opt.charAt(0).toUpperCase() + opt.slice(1) : 'Select...');
      html += '<option value="' + JH.esc(opt) + '"' + selected + '>' + label + '</option>';
    });
    html += '</select></div>';
    var showSize = row['CampingType'] === 'tent' || row['CampingType'] === 'caravan';
    html += '<div class="form-row tent-size-row' + (showSize ? ' visible' : '') + '" id="tent-size-row"><label>Size</label><input type="text" id="f-tent-size" placeholder="e.g. 2-person, 4x4m" value="' + JH.esc(row['TentSize'] || '') + '"></div>';
    html += '<div class="form-row"><label>NoOrg duty days</label>';
    html += '<input type="text" id="f-noorg" placeholder="Pick one or more days" value="' + JH.esc(row['NoOrgDates'] || '') + '">';
    html += '<div class="form-hint">Days you\'re on festival crew \u2014 barrio setup tasks won\'t be assigned to you on these days.</div></div>';
    html += '<div class="form-row"><label>Notes</label><textarea id="f-notes" placeholder="Anything else the team should know...">' + JH.esc(row['Notes'] || '') + '</textarea></div>';
    html += '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">';
    html += '<button type="submit" class="btn-primary" id="save-btn">Save</button>';
    html += '<span class="save-feedback" id="save-feedback">Saved!</span>';
    html += '</div>';
    html += '</form>';

    wrap.innerHTML = html;

    if (JH.currentUser && JH.currentUser.observer) {
      var form = document.getElementById('logistics-form');
      if (form) {
        form.querySelectorAll('input, select, textarea, button').forEach(function(el) {
          el.disabled = true;
        });
        var observerNotice = document.createElement('div');
        observerNotice.style.cssText = 'margin-bottom:10px;padding:10px 14px;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);font-size:0.85rem;';
        observerNotice.textContent = '👀 You\'re an Observer — logistics is read-only for you.';
        form.parentNode.insertBefore(observerNotice, form);
      }
    }

    var backLink = document.getElementById('back-to-me');
    if (backLink) {
      backLink.addEventListener('click', function (e) {
        e.preventDefault();
        state.editingMember = null;
        renderMyInfo();
      });
    }

    // Init Flatpickr for date/time inputs
    JH.initDate(document.getElementById('f-arrival'));
    JH.initDate(document.getElementById('f-departure'));
    JH.initTime(document.getElementById('f-arrival-time'));
    var noorgEl = document.getElementById('f-noorg');
    if (noorgEl) {
      JH.initDate(noorgEl, { mode: 'multiple', conjunction: ',' });
    }

    // Toggle tent size field
    document.getElementById('f-camping').addEventListener('change', function () {
      var sizeRow = document.getElementById('tent-size-row');
      if (this.value === 'tent' || this.value === 'caravan') {
        sizeRow.classList.add('visible');
      } else {
        sizeRow.classList.remove('visible');
      }
    });

    document.getElementById('f-transport').addEventListener('change', function () {
      var pickupRow = document.getElementById('pickup-row');
      if (this.value === 'train') {
        pickupRow.classList.add('visible');
      } else {
        pickupRow.classList.remove('visible');
      }
    });

    document.getElementById('logistics-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = document.getElementById('save-btn');
      btn.textContent = 'Saving...';
      btn.disabled = true;

      var res = await JH.apiFetch('/api/logistics', {
        action: 'upsert',
        memberName: findLogisticsRow(activeName()).key,
        arrivalDate: document.getElementById('f-arrival').value,
        arrivalTime: document.getElementById('f-arrival-time').value,
        transport: document.getElementById('f-transport').value,
        needsPickup: document.getElementById('f-pickup') ? document.getElementById('f-pickup').value : '',
        departureDate: document.getElementById('f-departure').value,
        campingType: document.getElementById('f-camping').value,
        tentSize: document.getElementById('f-tent-size') ? document.getElementById('f-tent-size').value : '',
        notes: document.getElementById('f-notes').value,
        noOrgDates: document.getElementById('f-noorg') ? document.getElementById('f-noorg').value : '',
      });

      if (!res.ok) {
        btn.textContent = 'Save';
        btn.disabled = false;
        alert('Save failed. Please try again.');
        return;
      }

      var feedback = document.getElementById('save-feedback');
      feedback.classList.add('visible');
      btn.textContent = 'Save';
      btn.disabled = false;
      setTimeout(function () { feedback.classList.remove('visible'); }, 2000);

      await fetchData();
      if (state.editingMember) state.editingMember = null;
      renderAllMembers();
      renderMyInfo();
      renderGantt();
    });
  }

  // ── All Members table ─────────────────────────────────────────────────────

  function renderAllMembers() {
    var wrap = document.getElementById('all-members-content');

    if (!approvedMembers.length) {
      wrap.innerHTML = '<div class="empty-state">No approved members found.</div>';
      return;
    }

    // Build a map of logistics rows by member name
    var logMap = {};
    state.logistics.forEach(function (r) {
      logMap[r['MemberName']] = r;
    });

    // Early-entry source per member (fetched alongside logistics).
    var eeMap = {};
    (state.earlyEntrySources || []).forEach(function (e) {
      if (e && e.MemberName) eeMap[e.MemberName.toLowerCase().trim()] = e.Source;
    });
    var EE_COLORS = { barrio: 'var(--accent)', noorg: '#5bc0de', artist: '#c8a8e8' };
    function eeBadge(m) {
      var key = eeColorKey(eeMap[(m['Playa Name'] || '').toLowerCase().trim()] || eeMap[(m['Name'] || '').toLowerCase().trim()] || '');
      if (!key) return '<span class="not-filled">—</span>';
      return '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;text-transform:capitalize;color:#0a0a0a;background:' + EE_COLORS[key] + '">' + key + '</span>';
    }

    // Sort approved members by arrival date (members with a date first, then alphabetically)
    var sorted = approvedMembers.slice().sort(function (a, b) {
      var nameA = a['Playa Name'] || a['Name'] || '';
      var nameB = b['Playa Name'] || b['Name'] || '';
      var rowA = logMap[nameA] || logMap[a['Name']];
      var rowB = logMap[nameB] || logMap[b['Name']];
      var dateA = rowA ? (rowA['ArrivalDate'] || '') : '';
      var dateB = rowB ? (rowB['ArrivalDate'] || '') : '';
      if (dateA && dateB) return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
      if (dateA) return -1;
      if (dateB) return 1;
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });

    // NoOrg duty days formatted as a list (shared by table + cards).
    function noorgFormatted(row, sep) {
      var list = (row['NoOrgDates'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!list.length) return '';
      return list.map(function (d) { return JH.esc(formatNoOrgDate(d)); }).join(sep);
    }

    // ── Desktop table (hidden ≤480px) ──
    var html = '<div class="hide-on-mobile" style="overflow-x:auto"><table class="logistics-table"><thead><tr>';
    html += '<th>Name</th><th>EE</th><th>Arrives</th><th>Time</th><th>Transport</th><th>Pickup</th><th>Departs</th><th>Camping</th><th>Size</th><th>NoOrg</th><th>Notes</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var row = logMap[name] || logMap[m['Name']];
      var isMe = state.myName && name === state.myName;
      var rowClass = isMe ? ' class="my-row"' : '';

      html += '<tr' + rowClass + '>';
      var editBtn = '';
      if (JH.isAdmin()) {
        editBtn = '<button class="edit-pencil" data-name="' + JH.esc(m['Playa Name'] || m['Name'] || '') + '" title="Edit logistics">\u270e</button>';
      }
      html += '<td>' + editBtn + '<strong>' + JH.nameLink(name) + (isMe ? ' <span style="color:var(--accent);font-size:0.75rem">(you)</span>' : '') + '</strong></td>';
      html += '<td>' + eeBadge(m) + '</td>';

      if (row) {
        html += '<td>' + (row['ArrivalDate'] ? JH.formatDate(row['ArrivalDate']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['ArrivalTime'] ? JH.esc(row['ArrivalTime']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['Transport'] ? JH.esc(row['Transport']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['NeedsPickup'] ? JH.esc(row['NeedsPickup']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['DepartureDate'] ? JH.formatDate(row['DepartureDate']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + campBadge(row['CampingType']) + '</td>';
        html += '<td>' + (row['TentSize'] ? JH.esc(row['TentSize']) : '<span class="not-filled">—</span>') + '</td>';
        var noorgCell = noorgFormatted(row, '<br>');
        html += '<td>' + (noorgCell || '<span class="not-filled">\u2014</span>') + '</td>';
        html += '<td>' + (row['Notes'] ? JH.esc(row['Notes']) : '<span class="not-filled">—</span>') + '</td>';
      } else {
        html += '<td colspan="9"><span class="not-filled">Not filled in yet</span></td>';
      }

      html += '</tr>';
    });

    html += '</tbody></table></div>';

    // ── Mobile cards (shown ≤480px) — one card per member, blanks skipped ──
    var cards = '<div class="mobile-cards">';
    sorted.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var row = logMap[name] || logMap[m['Name']];
      var isMe = state.myName && name === state.myName;
      var editName = m['Playa Name'] || m['Name'] || '';

      var titleRight = '';
      if (JH.isAdmin()) {
        titleRight = '<button class="edit-pencil" data-name="' + JH.esc(editName) + '" title="Edit logistics">✎</button>';
      }

      cards += '<div class="m-card">';
      cards += '<div class="m-card-title"><span>' + JH.nameLink(name) + (isMe ? ' <span style="color:var(--accent);font-size:0.75rem">(you)</span>' : '') + '</span>' + titleRight + '</div>';

      var ee = eeBadge(m);
      if (ee.indexOf('not-filled') === -1) {
        cards += '<div class="m-card-row"><span class="m-card-label">Early entry</span><span class="m-card-val">' + ee + '</span></div>';
      }

      if (row) {
        var fields = [];
        if (row['ArrivalDate']) fields.push(['Arrives', JH.formatDate(row['ArrivalDate'])]);
        if (row['ArrivalTime']) fields.push(['Time', JH.esc(row['ArrivalTime'])]);
        if (row['Transport']) fields.push(['Transport', JH.esc(row['Transport'])]);
        if (row['NeedsPickup']) fields.push(['Pickup', JH.esc(row['NeedsPickup'])]);
        if (row['DepartureDate']) fields.push(['Departs', JH.formatDate(row['DepartureDate'])]);
        if (row['CampingType']) fields.push(['Camping', campBadge(row['CampingType'])]);
        if (row['TentSize']) fields.push(['Tent size', JH.esc(row['TentSize'])]);
        var noorgCard = noorgFormatted(row, ', ');
        if (noorgCard) fields.push(['NoOrg', noorgCard]);
        if (row['Notes']) fields.push(['Notes', JH.esc(row['Notes'])]);

        if (fields.length) {
          fields.forEach(function (f) {
            cards += '<div class="m-card-row"><span class="m-card-label">' + f[0] + '</span><span class="m-card-val">' + f[1] + '</span></div>';
          });
        } else {
          cards += '<div class="m-card-row"><span class="m-card-val not-filled">Not filled in yet</span></div>';
        }
      } else {
        cards += '<div class="m-card-row"><span class="m-card-val not-filled">Not filled in yet</span></div>';
      }

      cards += '</div>';
    });
    cards += '</div>';

    wrap.innerHTML = html + cards;

    // Wire edit pencils across BOTH the table and the cards.
    if (JH.isAdmin()) {
      wrap.querySelectorAll('.edit-pencil').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var who = btn.getAttribute('data-name');
          if (!who) { alert('Member has no name set — cannot edit'); return; }
          state.editingMember = who;
          renderMyInfo();
          document.getElementById('my-info-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }
  }

  // ── Gantt chart ───────────────────────────────────────────────────────────

  function renderGantt() {
    var wrap = document.getElementById('gantt-content');
    if (!wrap) return;
    var eeMap = {};
    (state.earlyEntrySources || []).forEach(function (e) {
      if (e && e.MemberName) eeMap[e.MemberName.toLowerCase().trim()] = e.Source;
    });
    function eeFor(m) {
      var playa = (m['Playa Name'] || '').toLowerCase().trim();
      var legal = (m['Name'] || '').toLowerCase().trim();
      return eeColorKey(eeMap[playa] || eeMap[legal] || '');
    }
    var entries = approvedMembers.map(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      var found = findLogisticsRow(name);
      var row = (found && found.row) || {};
      return { name: name, arrival: row['ArrivalDate'] || '', departure: row['DepartureDate'] || '', ee: eeFor(m) };
    }).filter(function (e) { return e.name; });

    var dated = entries.filter(function (e) { return parseISO(e.arrival); });
    var undated = entries.length - dated.length;
    if (!dated.length) { wrap.innerHTML = '<div class="empty-state">No arrival dates filled in yet.</div>'; return; }

    var range = ganttRange(dated.map(function (e) { return { ArrivalDate: e.arrival, DepartureDate: e.departure }; }));
    var days = enumerateDays(range.startISO, range.endISO);
    dated.sort(function (a, b) { return parseISO(a.arrival) < parseISO(b.arrival) ? -1 : 1; });

    var legend = '<div class="gantt-legend">' +
      '<span><i class="swatch" style="background:var(--accent)"></i>barrio</span>' +
      '<span><i class="swatch" style="background:#5bc0de"></i>noorg</span>' +
      '<span><i class="swatch" style="background:#c8a8e8"></i>artist</span>' +
      '<span><i class="swatch" style="background:#5a5a5a"></i>no EE</span>' +
      '<span style="margin-left:auto"><i class="swatch" style="background:rgba(232,168,76,0.10);border:1px solid var(--border)"></i>event week</span></div>';

    var DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    var head = '<tr><th class="g-name"></th>';
    days.forEach(function (d) {
      var dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
      head += '<th class="g-day' + (isEventDay(d) ? ' event' : '') + '"><span class="dow">' + DOW[dt.getUTCDay()] + '</span><br>' + dt.getUTCDate() + '</th>';
    });
    head += '</tr>';

    var body = dated.map(function (e) {
      var bc = barCells(e.arrival, e.departure, range.startISO, range.endISO);
      var tds = '<td class="g-name" title="' + JH.esc(e.name) + '">' + JH.esc(e.name) + '</td>';
      days.forEach(function (d, i) {
        var cls = 'g-cell' + (isEventDay(d) ? ' event' : '');
        if (bc && i >= bc.startIdx && i <= bc.endIdx) {
          cls += ' fill' + (e.ee ? ' ee-' + e.ee : '');
          if (i === bc.startIdx) cls += ' bar-start';
          if (i === bc.endIdx) cls += ' bar-end';
        }
        var ttl = (bc && i === bc.startIdx) ? ' title="' + JH.esc(e.name + ': ' + JH.formatDate(e.arrival) + (e.departure ? ' → ' + JH.formatDate(e.departure) : '')) + '"' : '';
        tds += '<td class="' + cls + '"' + ttl + '></td>';
      });
      return '<tr>' + tds + '</tr>';
    }).join('');

    var unknown = undated ? '<div class="gantt-unknown">▸ ' + undated + ' member' + (undated === 1 ? '' : 's') + ' haven’t filled their arrival dates yet</div>' : '';
    wrap.innerHTML = legend + '<div class="gantt-scroll"><table class="gantt-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' + unknown;
  }

  // ── Render coordinator ────────────────────────────────────────────────────

  async function render() {
    await fetchData();
    renderMyInfo();
    renderAllMembers();
    renderGantt();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (state.myName) render();

})();
