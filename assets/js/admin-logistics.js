(async function () {
  var members = await JH.authenticate();
  if (!members) return;

  var pass = sessionStorage.getItem('jh_pass');
  var approvedMembers = members.filter(function (m) {
    return (m['Status'] || '').toLowerCase() === 'approved';
  });

  var state = { logistics: [], myName: null };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function campBadge(type) {
    if (!type) return '<span class="not-filled">—</span>';
    var cls = 'camp-badge camp-' + type.toLowerCase().replace(/\s+/g, '-');
    return '<span class="' + cls + '">' + esc(type) + '</span>';
  }

  // ── Name selector ─────────────────────────────────────────────────────────

  state.myName = sessionStorage.getItem('jh_member_name');

  var nameModal = document.getElementById('name-modal');
  var nameSelect = document.getElementById('name-select');
  var nameConfirmBtn = document.getElementById('name-confirm-btn');

  function renderNameDisplay() {
    var wrap = document.getElementById('name-display-wrap');
    wrap.innerHTML = '<div id="name-display" style="margin-bottom:16px"><span style="font-size:0.8rem;color:var(--text-muted)">Signed in as <strong style="color:var(--accent)">' + esc(state.myName) + '</strong> \u2014 <a href="#" id="change-name-link" style="color:var(--text-muted);font-size:0.78rem">change</a></span></div>';
    document.getElementById('change-name-link').addEventListener('click', function (e) {
      e.preventDefault();
      nameModal.classList.add('active');
    });
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
    sessionStorage.setItem('jh_member_name', val);
    nameModal.classList.remove('active');
    renderNameDisplay();
    render();
  });

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchData() {
    var res = await fetch('/api/logistics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) { console.error('logistics fetch failed'); return; }
    var data = await res.json();
    state.logistics = data.logistics || [];
  }

  // ── My Info panel ─────────────────────────────────────────────────────────

  function renderMyInfo() {
    var wrap = document.getElementById('my-info-content');
    if (!state.myName) {
      wrap.innerHTML = '<div class="empty-state">Select your name to fill in your info.</div>';
      return;
    }

    var row = state.logistics.find(function (r) { return r['MemberName'] === state.myName; }) || {};
    var hasData = row['ArrivalDate'] || row['DepartureDate'];

    var html = '';
    if (!hasData) {
      html += '<div style="background:rgba(232,168,76,0.1);border:1px solid var(--accent);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:var(--text)">';
      html += '<strong style="color:var(--accent)">Hey ' + esc(state.myName) + '!</strong> We don\'t have your arrival info yet. Please fill in the form below so we can plan meals and pickups.';
      html += '</div>';
    }
    html += '<form id="logistics-form">';
    html += '<div class="form-row"><label>Arrival Date</label><input type="date" id="f-arrival" value="' + esc(row['ArrivalDate'] || '') + '"></div>';
    html += '<div class="form-row"><label>Arriving at (time)</label><input type="time" id="f-arrival-time" value="' + esc(row['ArrivalTime'] || '') + '"><div class="form-hint">So we know how many mouths to feed!</div></div>';
    html += '<div class="form-row"><label>How are you getting there?</label><select id="f-transport">';
    ['', 'vehicle', 'bus', 'train', 'ride-share', 'other'].forEach(function (opt) {
      var selected = (row['Transport'] || '') === opt ? ' selected' : '';
      var label = opt ? opt.charAt(0).toUpperCase() + opt.slice(1) : 'Select...';
      html += '<option value="' + esc(opt) + '"' + selected + '>' + label + '</option>';
    });
    html += '</select></div>';
    var showPickup = row['Transport'] === 'train';
    html += '<div class="form-row pickup-row' + (showPickup ? ' visible' : '') + '" id="pickup-row"><label>Would you like to be picked up?</label><select id="f-pickup">';
    ['', 'yes', 'no'].forEach(function (opt) {
      var selected = (row['NeedsPickup'] || '') === opt ? ' selected' : '';
      var label = opt === 'yes' ? 'Yes please!' : opt === 'no' ? 'No, I\'ll manage' : 'Select...';
      html += '<option value="' + esc(opt) + '"' + selected + '>' + label + '</option>';
    });
    html += '</select></div>';
    html += '<div class="form-row"><label>Departure Date</label><input type="date" id="f-departure" value="' + esc(row['DepartureDate'] || '') + '"></div>';
    html += '<div class="form-row"><label>Camping Type</label><select id="f-camping">';
    ['', 'tent', 'caravan', 'out-of-camp'].forEach(function (opt) {
      var selected = (row['CampingType'] || '') === opt ? ' selected' : '';
      var label = opt === 'caravan' ? 'Caravan' : (opt ? opt.charAt(0).toUpperCase() + opt.slice(1) : 'Select...');
      html += '<option value="' + esc(opt) + '"' + selected + '>' + label + '</option>';
    });
    html += '</select></div>';
    var showSize = row['CampingType'] === 'tent' || row['CampingType'] === 'caravan';
    html += '<div class="form-row tent-size-row' + (showSize ? ' visible' : '') + '" id="tent-size-row"><label>Size</label><input type="text" id="f-tent-size" placeholder="e.g. 2-person, 4x4m" value="' + esc(row['TentSize'] || '') + '"></div>';
    html += '<div class="form-row"><label>Notes</label><textarea id="f-notes" placeholder="Anything else the team should know...">' + esc(row['Notes'] || '') + '</textarea></div>';
    html += '<div style="display:flex;align-items:center">';
    html += '<button type="submit" class="btn-primary" id="save-btn">Save</button>';
    html += '<span class="save-feedback" id="save-feedback">Saved!</span>';
    html += '</div>';
    html += '</form>';

    wrap.innerHTML = html;

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

      var body = {
        password: pass,
        action: 'upsert',
        memberName: state.myName,
        arrivalDate: document.getElementById('f-arrival').value,
        arrivalTime: document.getElementById('f-arrival-time').value,
        transport: document.getElementById('f-transport').value,
        needsPickup: document.getElementById('f-pickup') ? document.getElementById('f-pickup').value : '',
        departureDate: document.getElementById('f-departure').value,
        campingType: document.getElementById('f-camping').value,
        tentSize: document.getElementById('f-tent-size') ? document.getElementById('f-tent-size').value : '',
        notes: document.getElementById('f-notes').value,
      };

      var res = await fetch('/api/logistics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      renderAllMembers();
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

    // Sort approved members by arrival date (members with a date first, then alphabetically)
    var sorted = approvedMembers.slice().sort(function (a, b) {
      var nameA = a['Playa Name'] || a['Name'] || '';
      var nameB = b['Playa Name'] || b['Name'] || '';
      var rowA = logMap[nameA];
      var rowB = logMap[nameB];
      var dateA = rowA ? (rowA['ArrivalDate'] || '') : '';
      var dateB = rowB ? (rowB['ArrivalDate'] || '') : '';
      if (dateA && dateB) return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
      if (dateA) return -1;
      if (dateB) return 1;
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });

    var html = '<div style="overflow-x:auto"><table class="logistics-table"><thead><tr>';
    html += '<th>Name</th><th>Arrives</th><th>Time</th><th>Transport</th><th>Pickup</th><th>Departs</th><th>Camping</th><th>Notes</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function (m) {
      var name = m['Playa Name'] || m['Name'] || '';
      if (!name) return;
      var row = logMap[name];
      var isMe = state.myName && name === state.myName;
      var rowClass = isMe ? ' class="my-row"' : '';

      html += '<tr' + rowClass + '>';
      html += '<td><strong>' + esc(name) + (isMe ? ' <span style="color:var(--accent);font-size:0.75rem">(you)</span>' : '') + '</strong></td>';

      if (row) {
        html += '<td>' + (row['ArrivalDate'] ? JH.formatDate(row['ArrivalDate']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['ArrivalTime'] ? esc(row['ArrivalTime']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['Transport'] ? esc(row['Transport']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['NeedsPickup'] ? esc(row['NeedsPickup']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + (row['DepartureDate'] ? JH.formatDate(row['DepartureDate']) : '<span class="not-filled">—</span>') + '</td>';
        html += '<td>' + campBadge(row['CampingType']) + '</td>';
        html += '<td>' + (row['Notes'] ? esc(row['Notes']) : '<span class="not-filled">—</span>') + '</td>';
      } else {
        html += '<td colspan="7"><span class="not-filled">Not filled in yet</span></td>';
      }

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  // ── Render coordinator ────────────────────────────────────────────────────

  async function render() {
    await fetchData();
    renderMyInfo();
    renderAllMembers();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (state.myName) render();

})();
