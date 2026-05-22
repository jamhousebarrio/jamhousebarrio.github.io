(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var val = JH.val;
  var isAdmin = JH.isAdmin();
  var allMembers = members.map(function(m, i) { m._row = i + 2; return m; });
  var ALL_STATUSES = ['Pending', 'Review', 'Vibe Check', 'Team Discussion', 'On-boarding', 'Approved', 'Observer', 'Rejected'];
  var FOOD_TYPES = ['', 'Carnivore', 'Pescatarian', 'Vegetarian', 'Vegan'];
  var STATUS_BUCKETS = {
    'Pending':         'Pending',
    'Review':          'In Progress',
    'Vibe Check':      'In Progress',
    'Team Discussion': 'In Progress',
    'On-boarding':     'In Progress',
    'Approved':        'Approved',
    'Observer':        'Observer',
    'Rejected':        'Rejected',
  };
  var BUCKET_ORDER = ['Pending', 'In Progress', 'Approved', 'Observer', 'Rejected'];
  var BUCKET_STAT_IDS = {
    'Pending': 'stat-pending',
    'In Progress': 'stat-in-progress',
    'Approved': 'stat-approved',
    'Observer': 'stat-observer',
    'Rejected': 'stat-rejected',
  };
  function normalizeStatus(s) {
    s = (s || '').toLowerCase();
    for (var i = 0; i < ALL_STATUSES.length; i++) {
      if (ALL_STATUSES[i].toLowerCase() === s) return ALL_STATUSES[i];
    }
    return 'Pending';
  }

  function bucketOf(status) {
    var norm = normalizeStatus(status);
    return STATUS_BUCKETS[norm] || 'Pending';
  }

  function refreshStats() {
    var counts = { 'Pending': 0, 'In Progress': 0, 'Approved': 0, 'Observer': 0, 'Rejected': 0 };
    allMembers.forEach(function(m) {
      var b = bucketOf(val(m, 'Status'));
      if (counts.hasOwnProperty(b)) counts[b] += 1;
    });
    BUCKET_ORDER.forEach(function(bucket) {
      var el = document.getElementById(BUCKET_STAT_IDS[bucket]);
      if (el) el.textContent = counts[bucket];
    });
  }
  refreshStats();

  // Stat-card clicks set the bucket filter dropdown and trigger filtering
  BUCKET_ORDER.forEach(function(bucket) {
    var el = document.getElementById(BUCKET_STAT_IDS[bucket]);
    if (!el) return;
    var card = el.closest('.stat-card');
    if (!card) return;
    card.style.cursor = 'pointer';
    card.addEventListener('click', function() {
      var filter = document.getElementById('statusFilter');
      filter.value = bucket;
      filter.dispatchEvent(new Event('change'));
    });
  });

  function getRowData() {
    return allMembers.map(function(m) {
      return {
        _row: m._row,
        Name: val(m, 'Name'),
        'Playa Name': val(m, 'Playa Name'),
        Location: val(m, 'Location'),
        Email: val(m, 'Email'),
        Phone: val(m, 'Phone'),
        Telegram: val(m, 'Telegram'),
        Admin: val(m, 'Admin'),
        Nationality: val(m, 'Nationality'),
        Gender: val(m, 'Gender'),
        Age: val(m, 'Age'),
        'First Burn': val(m, 'First Burn'),
        'Has Ticket': val(m, 'Has Ticket'),
        Volunteer: val(m, 'Volunteer'),
        'Responsible HR': val(m, 'Responsible HR'),
        Status: normalizeStatus(val(m, 'Status'))
      };
    });
  }

  function StatusCellRenderer() {}
  StatusCellRenderer.prototype.init = function(params) {
    var v = normalizeStatus(params.value);
    if (isAdmin) {
      this.eGui = document.createElement('select');
      this.eGui.style.cssText = 'background:#0a0a0a;color:#e0e0e0;border:1px solid #2a2a2a;border-radius:4px;padding:2px 4px;font-size:0.8rem;cursor:pointer;width:100%;';
      var self = this;
      ALL_STATUSES.forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (opt === v) o.selected = true;
        self.eGui.appendChild(o);
      });
      this.eGui.addEventListener('change', function() {
        updateStatus(params.data, self.eGui.value);
      });
    } else {
      this.eGui = document.createElement('span');
      this.eGui.className = 'status-' + v.toLowerCase().replace(/\s+/g, '-');
      this.eGui.textContent = v;
    }
  };
  StatusCellRenderer.prototype.getGui = function() { return this.eGui; };

  function ViewBtnRenderer() {}
  ViewBtnRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('button');
    this.eGui.textContent = 'View';
    this.eGui.style.cssText = 'background:#e8a84c;color:#0a0a0a;border:none;border-radius:4px;padding:2px 10px;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;';
    this.eGui.addEventListener('click', function(e) {
      e.stopPropagation();
      var member = allMembers.find(function(m) { return m._row === params.data._row; });
      if (member) openModal(member);
    });
  };
  ViewBtnRenderer.prototype.getGui = function() { return this.eGui; };

  function InviteBtnRenderer() {}
  InviteBtnRenderer.prototype.init = function(params) {
    this.eGui = document.createElement('span');
    var s = normalizeStatus(params.data.Status);
    if (s !== 'Approved' && s !== 'Observer') return;
    var btn = document.createElement('button');
    btn.textContent = 'Invite';
    btn.style.cssText = 'background:transparent;color:#e8a84c;border:1px solid #e8a84c;border-radius:4px;padding:2px 10px;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var member = allMembers.find(function(m) { return m._row === params.data._row; });
      if (member) sendInvite(member);
    });
    this.eGui.appendChild(btn);
  };
  InviteBtnRenderer.prototype.getGui = function() { return this.eGui; };

  // Custom AG Grid filter that matches a full bucket ('In Progress' → any of its sub-statuses)
  // or an exact status string. Used by the #statusFilter dropdown.
  function BucketFilter() {}
  BucketFilter.prototype.init = function(params) {
    this.filterActive = false;
    this.targetBucket = null;
    this.targetStatus = null;
  };
  BucketFilter.prototype.doesFilterPass = function(params) {
    // params.data.Status arrives pre-normalized via getRowData()
    var v = params.data && params.data.Status;
    if (this.targetBucket === 'In Progress') return bucketOf(v) === 'In Progress';
    if (this.targetStatus) return v === this.targetStatus;
    return true;
  };
  BucketFilter.prototype.isFilterActive = function() { return this.filterActive; };
  BucketFilter.prototype.getModel = function() {
    if (!this.filterActive) return null;
    return { bucket: this.targetBucket, status: this.targetStatus };
  };
  BucketFilter.prototype.setModel = function(model) {
    if (!model) { this.filterActive = false; this.targetBucket = null; this.targetStatus = null; return; }
    this.filterActive = true;
    this.targetBucket = model.bucket || null;
    this.targetStatus = model.status || null;
  };
  BucketFilter.prototype.getGui = function() { return document.createElement('div'); };

  // Shared invite flow — used by status change to Approved AND the Invite button.
  async function sendInvite(member) {
    var memberEmail = val(member, 'Email');
    var memberName = val(member, 'Name') || 'this member';
    if (!memberEmail) { alert('No email on file for ' + memberName); return; }
    if (!confirm('Send invite email to ' + memberName + ' at ' + memberEmail + '?')) return;
    try {
      var inviteRes = await JH.apiFetch('/api/auth', { action: 'invite', email: memberEmail });
      if (inviteRes.status === 409) {
        if (confirm(memberName + ' already has an account. Send them a password reset email instead?')) {
          var resetRes = await JH.apiFetch('/api/auth', { action: 'resend-invite', email: memberEmail });
          if (!resetRes.ok) {
            var resetErr = await resetRes.json().catch(function() { return {}; });
            if (confirm('Resend failed: ' + (resetErr.error || 'Unknown error') + '\n\nGenerate a one-time recovery link instead?')) {
              await offerManualLink(memberEmail, memberName, 'recovery');
            }
          }
        }
      } else if (!inviteRes.ok) {
        var inviteErr = await inviteRes.json().catch(function() { return {}; });
        if (confirm('Invite email failed: ' + (inviteErr.error || 'Unknown error') + '\n\nGenerate a one-time invite link you can send manually?')) {
          await offerManualLink(memberEmail, memberName, 'invite');
        }
      } else {
        alert('Invite email sent to ' + memberEmail);
      }
    } catch (inviteEx) {
      alert('Failed to send invite: ' + inviteEx.message);
    }
  }

  async function offerManualLink(email, name, type) {
    var linkRes = await JH.apiFetch('/api/auth', { action: 'generate-link', email: email, type: type });
    var linkData = await linkRes.json().catch(function() { return {}; });
    if (linkRes.ok && linkData.link) {
      try { await navigator.clipboard.writeText(linkData.link); } catch (e) {}
      prompt('Link (copied to clipboard) — send to ' + name + ':', linkData.link);
    } else {
      alert('Could not generate link: ' + (linkData.error || 'Unknown error'));
    }
  }

  var columnDefs = [
    { headerName: '', field: '_view', cellRenderer: ViewBtnRenderer, valueGetter: function() { return ''; }, width: 70, maxWidth: 70, sortable: false, filter: false, resizable: false, suppressSizeToFit: true },
    { headerName: '', field: '_invite', cellRenderer: InviteBtnRenderer, valueGetter: function() { return ''; }, width: 80, maxWidth: 80, sortable: false, filter: false, resizable: false, suppressSizeToFit: true, hide: !isAdmin },
    { field: 'Name', sortable: true, filter: true },
    { field: 'Playa Name', sortable: true, filter: true },
    { field: 'Location', sortable: true, filter: true },
    { field: 'Email', sortable: true, filter: true, hide: true },
    { field: 'Phone', sortable: true, filter: true, cellRenderer: JH.PhoneCellRenderer },
    { field: 'Admin', sortable: true, filter: true, hide: true },
    { field: 'Nationality', sortable: true, filter: true, hide: true },
    { field: 'Gender', sortable: true, filter: true, hide: true },
    { field: 'Age', sortable: true, filter: true, hide: true },
    { field: 'First Burn', sortable: true, filter: true, hide: true },
    { field: 'Has Ticket', sortable: true, filter: true, hide: true },
    { field: 'Volunteer', sortable: true, filter: true, hide: true },
    { field: 'Responsible HR', sortable: true, filter: true, editable: isAdmin },
    { field: 'Status', sortable: true, filter: BucketFilter, cellRenderer: StatusCellRenderer }
  ];

  var gridOptions = {
    columnDefs: columnDefs,
    rowData: getRowData(),
    defaultColDef: { resizable: !JH.isMobile, flex: 1, minWidth: 100, suppressMovable: JH.isMobile },
    pagination: true,
    paginationPageSize: JH.isMobile ? 15 : 25,
    suppressCellFocus: true,
    onModelUpdated: function() {
      var count = gridApi ? gridApi.getDisplayedRowCount() : 0;
      document.getElementById('filter-count').textContent = count + ' applications';
    },
    onCellValueChanged: function(event) {
      if (event.colDef.field === 'Responsible HR') {
        var member = allMembers.find(function(m) { return m._row === event.data._row; });
        if (!member) return;
        var updates = {};
        updates['Responsible HR'] = event.newValue || '';
        JH.apiFetch('/api/members', { action: 'update', row: event.data._row, updates: updates }).then(function(res) {
          if (res.ok) member['Responsible HR'] = event.newValue || '';
        });
      }
    }
  };

  // ── Columns popover ─────────────────────────────────────────────────────
  // LS keys: jh.applications.columns, .view, .kanban.expanded
  var LS_COLS_KEY = 'jh.applications.columns';
  var DEFAULT_VISIBLE = ['Name', 'Playa Name', 'Responsible HR', 'Status'];

  function readVisibleCols() {
    try {
      var raw = localStorage.getItem(LS_COLS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { /* fall through */ }
    return DEFAULT_VISIBLE.slice();
  }
  function writeVisibleCols(arr) {
    try { localStorage.setItem(LS_COLS_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  // visibleSet must be readable in the popover-build block below — declare
  // outside the mobile gate. On mobile, JH.mobileColumns is the only
  // authority on column visibility; we read visibleSet only to check the
  // popover boxes (the popover itself is hidden on mobile via CSS), but
  // we DO NOT mutate columnDefs[i].hide on mobile.
  var visibleSet = readVisibleCols();
  if (!JH.isMobile) {
    columnDefs.forEach(function(col) {
      if (!col.field || col.field.indexOf('_') === 0) return; // skip View/Invite buttons
      col.hide = visibleSet.indexOf(col.field) === -1;
    });
  }

  // Build popover (idempotent — runs on both desktop and mobile, but the
  // popover button is hidden on mobile via CSS @media query)
  var popoverEl = document.getElementById('columns-popover');
  var btnEl = document.getElementById('columns-btn');
  columnDefs.filter(function(col) { return col.field && col.field.indexOf('_') !== 0; }).forEach(function(col) {
    var label = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = visibleSet.indexOf(col.field) !== -1;
    cb.addEventListener('change', function() {
      var current = readVisibleCols();
      if (cb.checked && current.indexOf(col.field) === -1) current.push(col.field);
      if (!cb.checked) current = current.filter(function(c) { return c !== col.field; });
      writeVisibleCols(current);
      gridApi.setColumnsVisible([col.field], cb.checked);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + (col.headerName || col.field)));
    popoverEl.appendChild(label);
  });

  btnEl.addEventListener('click', function(e) {
    e.stopPropagation();
    popoverEl.hidden = !popoverEl.hidden;
  });
  document.addEventListener('click', function(e) {
    if (popoverEl.hidden) return;
    if (popoverEl.contains(e.target) || btnEl.contains(e.target)) return;
    popoverEl.hidden = true;
  });

  // ── Kanban view ─────────────────────────────────────────────────────────
  var LS_VIEW_KEY = 'jh.applications.view';
  var LS_KB_EXPANDED_KEY = 'jh.applications.kanban.expanded';
  var DEFAULT_EXPANDED_BUCKETS = ['Pending', 'In Progress'];

  function readView() {
    try { return localStorage.getItem(LS_VIEW_KEY) || 'grid'; } catch (e) { return 'grid'; }
  }
  function writeView(v) {
    try { localStorage.setItem(LS_VIEW_KEY, v); } catch (e) {}
  }
  function readExpandedBuckets() {
    try {
      var raw = localStorage.getItem(LS_KB_EXPANDED_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_EXPANDED_BUCKETS.slice();
  }
  function writeExpandedBuckets(arr) {
    try { localStorage.setItem(LS_KB_EXPANDED_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  var gridWrap = document.getElementById('view-grid-wrap');
  var kanbanWrap = document.getElementById('view-kanban-wrap');
  var gridBtn = document.getElementById('view-grid');
  var kanbanBtn = document.getElementById('view-kanban');

  function applyView(v) {
    if (v === 'kanban') {
      gridWrap.hidden = true;
      kanbanWrap.hidden = false;
      gridBtn.classList.remove('active');
      kanbanBtn.classList.add('active');
      renderKanban();
    } else {
      gridWrap.hidden = false;
      kanbanWrap.hidden = true;
      kanbanBtn.classList.remove('active');
      gridBtn.classList.add('active');
    }
    writeView(v);
  }

  gridBtn.addEventListener('click', function() { applyView('grid'); });
  kanbanBtn.addEventListener('click', function() { applyView('kanban'); });

  applyView(JH.isMobile ? 'grid' : readView());

  function relativeDays(timestamp) {
    if (!timestamp) return '';
    var t = Date.parse(timestamp);
    if (isNaN(t)) return '';
    var diff = Date.now() - t;
    var days = Math.floor(diff / (24 * 60 * 60 * 1000));
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 7) return days + ' days ago';
    var weeks = Math.floor(days / 7);
    if (weeks === 1) return '1 week ago';
    if (weeks < 5) return weeks + ' weeks ago';
    var months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    return months + ' months ago';
  }

  function bucketCssClass(bucket) {
    return 'bucket-' + bucket.toLowerCase().replace(/\s+/g, '-');
  }

  function renderKanbanCardHtml(m) {
    var name = val(m, 'Name') || '(no name)';
    var playa = val(m, 'Playa Name');
    var location = (val(m, 'Location') || '').split(',')[0].trim();
    var applied = relativeDays(m['Timestamp']);
    var metaBits = [];
    if (applied) metaBits.push('Applied ' + applied);
    if (location) metaBits.push(location);
    var firstBurn = (val(m, 'First Burn') || '').toLowerCase();
    var hasTicket = (val(m, 'Has Ticket') || '').toLowerCase();
    var tags = '';
    if (firstBurn === 'yes' || firstBurn === 'true' || firstBurn === '1') tags += '<span class="kb-tag first-burn">First Burn</span>';
    if (hasTicket === 'yes' || hasTicket === 'true' || hasTicket === '1') tags += '<span class="kb-tag">Has Ticket</span>';
    return '<div class="kb-card" data-row="' + m._row + '"' + (isAdmin ? ' draggable="true"' : '') + '>' +
      (isAdmin ? '<button type="button" class="kb-menu-btn" data-row="' + m._row + '">&#8942;</button>' : '') +
      '<div class="kb-name">' + JH.esc(name) + '</div>' +
      (playa ? '<div class="kb-playa">' + JH.esc(playa) + '</div>' : '') +
      (metaBits.length ? '<div class="kb-meta">' + JH.esc(metaBits.join(' · ')) + '</div>' : '') +
      (tags ? '<div class="kb-tags">' + tags + '</div>' : '') +
      '</div>';
  }

  function renderKanban() {
    var board = document.getElementById('kanban-board');
    if (!board) return;
    var expanded = readExpandedBuckets();
    var byBucket = { 'Pending': [], 'In Progress': [], 'Approved': [], 'Observer': [], 'Rejected': [] };
    allMembers.forEach(function(m) {
      var b = bucketOf(val(m, 'Status'));
      if (byBucket[b]) byBucket[b].push(m);
    });
    var html = '';
    BUCKET_ORDER.forEach(function(bucket) {
      var isExpanded = expanded.indexOf(bucket) !== -1;
      var cls = 'kb-col ' + bucketCssClass(bucket) + (isExpanded ? '' : ' collapsed');
      var cards = byBucket[bucket].map(renderKanbanCardHtml).join('');
      html += '<div class="' + cls + '" data-bucket="' + bucket + '">' +
        '<div class="kb-col-header"><span>' + bucket + '</span><span class="count">' + byBucket[bucket].length + '</span></div>' +
        '<div class="kb-cards">' + cards + '</div>' +
        '</div>';
    });
    board.innerHTML = html;
    wireKanbanEvents(board);
  }

  function wireKanbanEvents(board) {
    board.querySelectorAll('.kb-col').forEach(function(col) {
      var header = col.querySelector('.kb-col-header');
      header.addEventListener('click', function() {
        var bucket = col.getAttribute('data-bucket');
        var expanded = readExpandedBuckets();
        var i = expanded.indexOf(bucket);
        if (i === -1) expanded.push(bucket); else expanded.splice(i, 1);
        writeExpandedBuckets(expanded);
        renderKanban();
      });
    });
    board.querySelectorAll('.kb-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        if (e.target.closest('.kb-menu-btn')) return;
        var row = parseInt(card.getAttribute('data-row'));
        var member = allMembers.find(function(m) { return m._row === row; });
        if (member) openModal(member);
      });
    });
    board.querySelectorAll('.kb-menu-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        openStatusMenu(btn);
      });
    });

    if (isAdmin) {
      var draggedRow = null;

      board.querySelectorAll('.kb-card').forEach(function(card) {
        card.addEventListener('dragstart', function(e) {
          draggedRow = parseInt(card.getAttribute('data-row'));
          e.dataTransfer.effectAllowed = 'move';
          card.style.opacity = '0.4';
        });
        card.addEventListener('dragend', function() {
          draggedRow = null;
          card.style.opacity = '';
        });
      });

      // Drop targets include collapsed spines (same .kb-col class, same
      // data-bucket attribute). On drop into a collapsed spine, updateStatus
      // → renderKanban re-reads jh.applications.kanban.expanded and re-renders
      // with the spine still collapsed; only the count badge ticks up.
      board.querySelectorAll('.kb-col').forEach(function(col) {
        col.addEventListener('dragover', function(e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          col.classList.add('drag-over');
        });
        col.addEventListener('dragleave', function() {
          col.classList.remove('drag-over');
        });
        col.addEventListener('drop', function(e) {
          e.preventDefault();
          col.classList.remove('drag-over');
          if (draggedRow == null) return;
          var bucket = col.getAttribute('data-bucket');
          var member = allMembers.find(function(m) { return m._row === draggedRow; });
          if (!member) return;
          var currentBucket = bucketOf(val(member, 'Status'));
          if (currentBucket === bucket) return; // No-op (same bucket — use ⋯ menu to sub-shuffle)
          // Pick the sub-status to set:
          //   Pending / Approved / Observer / Rejected → unambiguous
          //   In Progress → land on 'Review' (first sub-status)
          var newStatus = bucket === 'In Progress' ? 'Review' : bucket;
          updateStatus(member, newStatus);
        });
      });
    }
  }

  function openStatusMenu(btn) {
    var row = parseInt(btn.getAttribute('data-row'));
    var member = allMembers.find(function(m) { return m._row === row; });
    if (!member) return;
    var prev = document.querySelector('.kb-status-menu');
    if (prev) prev.remove();
    var menu = document.createElement('div');
    menu.className = 'kb-status-menu';
    ALL_STATUSES.forEach(function(s) {
      var item = document.createElement('button');
      item.type = 'button';
      item.textContent = s;
      if (s === val(member, 'Status')) item.classList.add('current');
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        menu.remove();
        updateStatus(member, s);
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect();
    menu.style.left = (r.right - menu.offsetWidth) + 'px';
    menu.style.top = (r.bottom + 4 + window.scrollY) + 'px';
    setTimeout(function() {
      document.addEventListener('click', function dismiss() {
        menu.remove();
        document.removeEventListener('click', dismiss);
      });
    }, 0);
  }

  // Mobile: fewer columns, Name as link, Phone as icons only
  JH.mobileColumns(columnDefs, ['Name', 'Phone', 'Status']);
  if (JH.isMobile) {
    var nameCol = columnDefs.find(function(c) { return c.field === 'Name'; });
    if (nameCol) nameCol.cellRenderer = JH.NameLinkRenderer;
    var phoneCol = columnDefs.find(function(c) { return c.field === 'Phone'; });
    if (phoneCol) JH.mobilePhoneColumn(phoneCol);
  }

  var gridDiv = document.getElementById('app-grid');
  var gridApi = agGrid.createGrid(gridDiv, gridOptions);

  // Mobile: tap row to open detail modal
  if (JH.isMobile) {
    gridApi.addEventListener('rowClicked', function(event) {
      var member = allMembers.find(function(m) { return m._row === event.data._row; });
      if (member) openModal(member);
    });
  }

  // Status filter — uses BucketFilter; 'In Progress' matches all 4 sub-statuses
  document.getElementById('statusFilter').addEventListener('change', function() {
    var filterVal = this.value;
    if (!filterVal) {
      gridApi.setGridOption('quickFilterText', null);
      gridApi.setColumnFilterModel('Status', null).then(function() {
        gridApi.onFilterChanged();
      });
      return;
    }
    var model = filterVal === 'In Progress'
      ? { bucket: 'In Progress' }
      : { status: filterVal };
    gridApi.setColumnFilterModel('Status', model).then(function() {
      gridApi.onFilterChanged();
    });
  });

  // Statuses that grant portal access (auth gate accepts these).
  function hasPortalAccess(s) { return s === 'Approved' || s === 'Observer'; }

  // Inline status update. Demotions are silent (no warning popup); the
  // invite popup only fires on promotion INTO an access state — i.e.
  // any → Approved, or non-portal → Observer. Approved → Observer is a
  // demotion and stays silent.
  async function updateStatus(data, newStatus) {
    var member = allMembers.find(function(m) { return m._row === data._row; });
    if (!member) return;
    var oldNorm = normalizeStatus(val(member, 'Status') || '');
    var newNorm = normalizeStatus(newStatus);

    try {
      var res = await JH.apiFetch('/api/members', { action: 'update-status', row: data._row, status: newStatus });
      if (!res.ok) throw new Error('Failed');
      member['Status'] = newStatus;
      refreshStats();
      gridApi.setGridOption('rowData', getRowData());
      renderKanban();

      var shouldInvite =
        (newNorm === 'Approved' && oldNorm !== 'Approved') ||
        (newNorm === 'Observer' && !hasPortalAccess(oldNorm));
      if (shouldInvite) {
        await sendInvite(member);
      }
    } catch (err) {
      // revert on failure
      gridApi.setGridOption('rowData', getRowData());
      renderKanban();
    }
  }

  // Modal — keys that should not be editable
  var readonlyKeys = ['_row', 'Timestamp', '', 'Admin', 'LastDietaryPromptedAt'];

  function openModal(m) {
    document.getElementById('modal-title').textContent = val(m, 'Name') || 'Application';
    var skipKeys = ['_row', '_date'];
    var html = Object.keys(m).filter(function(k) {
      return skipKeys.indexOf(k) === -1;
    }).map(function(k) {
      var v = val(m, k);
      var escaped = v ? v.replace(/</g, '&lt;') : '';
      var links = (k === 'Phone') ? JH.contactLinks(v, val(m, 'Telegram')) : '';
      // Timestamp: human-friendly
      if (k === 'Timestamp' || k === '') {
        var display = '<span style="color:#555;">—</span>';
        if (v) {
          var d = new Date(v);
          display = isNaN(d.getTime()) ? escaped : d.toLocaleString('en-GB', { hour12: false });
        }
        return '<div class="detail-row"><div class="detail-label">Submitted</div><div class="detail-value">' + display + '</div></div>';
      }
      // Status: dropdown
      if (k === 'Status' && isAdmin) {
        var s = normalizeStatus(v);
        var sel = '<select class="field-input" data-key="Status">';
        ALL_STATUSES.forEach(function(opt) {
          sel += '<option value="' + opt + '"' + (opt === s ? ' selected' : '') + '>' + opt + '</option>';
        });
        sel += '</select>';
        return '<div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">' + sel + '</div></div>';
      }
      // FoodType: dropdown (constrained to allowed values, matches save-dietary)
      if (k === 'FoodType' && isAdmin) {
        var sel = '<select class="field-input" data-key="FoodType">';
        FOOD_TYPES.forEach(function(opt) {
          var label = opt || '— not set —';
          sel += '<option value="' + opt + '"' + (opt === v ? ' selected' : '') + '>' + label + '</option>';
        });
        sel += '</select>';
        return '<div class="detail-row"><div class="detail-label">FoodType</div><div class="detail-value">' + sel + '</div></div>';
      }
      // Read-only fields
      if (!isAdmin || readonlyKeys.indexOf(k) !== -1) {
        var display = escaped || '<span style="color:#555;">—</span>';
        return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' + display + links + '</div></div>';
      }
      // Long text: textarea
      if (v.length > 60) {
        return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' +
          '<textarea class="field-input" data-key="' + k + '">' + escaped + '</textarea>' + links + '</div></div>';
      }
      return '<div class="detail-row"><div class="detail-label">' + k + '</div><div class="detail-value">' +
        '<input class="field-input" data-key="' + k + '" value="' + escaped.replace(/"/g, '&quot;') + '">' + links + '</div></div>';
    }).join('');
    document.getElementById('modal-details').innerHTML = html;

    var statusActions = document.getElementById('status-actions');
    if (isAdmin) {
      statusActions.style.display = 'flex';
      document.getElementById('modal-save').textContent = 'Save All';
      document.getElementById('modal-msg').textContent = '';

      document.getElementById('modal-save').onclick = async function() {
        var updates = {};
        document.querySelectorAll('.field-input').forEach(function(el) {
          var key = el.dataset.key;
          var newVal = el.value.trim();
          if (newVal !== val(m, key)) updates[key] = newVal;
        });
        if (Object.keys(updates).length === 0) {
          document.getElementById('modal-msg').textContent = 'No changes';
          document.getElementById('modal-msg').style.color = '#888';
          return;
        }
        document.getElementById('modal-msg').textContent = 'Saving...';
        document.getElementById('modal-msg').style.color = '#888';
        try {
          var res = await JH.apiFetch('/api/members', { action: 'update', row: m._row, updates: updates });
          if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            throw new Error(err.error || 'Failed');
          }
          for (var key in updates) m[key] = updates[key];
          document.getElementById('modal-msg').textContent = 'Saved!';
          document.getElementById('modal-msg').style.color = '#4caf50';
          refreshStats();
          gridApi.setGridOption('rowData', getRowData());
          renderKanban();
        } catch (e) {
          document.getElementById('modal-msg').textContent = e.message;
          document.getElementById('modal-msg').style.color = '#f44336';
        }
      };
    } else {
      statusActions.style.display = 'none';
    }

    document.getElementById('modalOverlay').classList.add('active');
  }

  document.getElementById('modalClose').addEventListener('click', function() {
    document.getElementById('modalOverlay').classList.remove('active');
  });
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('active');
  });
})();
