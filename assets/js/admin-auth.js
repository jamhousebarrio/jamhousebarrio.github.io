window.JH = window.JH || {};

// Event date constants
JH.EVENT_START = '2026-07-01';
JH.EVENT_END = '2026-07-12';
JH.EVENT_WEEK_START = '2026-07-07';
JH.EVENT_WEEK_END = '2026-07-12';

// Current authenticated user (set by JH.authenticate)
JH.currentUser = null;

// Load Flatpickr for date/time inputs (dd/mm/yyyy, 24h)
var fpReady = false;
var fpQueue = [];
(function() {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
  document.head.appendChild(link);
  var dark = document.createElement('link');
  dark.rel = 'stylesheet';
  dark.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css';
  document.head.appendChild(dark);
  var style = document.createElement('style');
  style.textContent = '.flatpickr-input { cursor: pointer; } .flatpickr-calendar { font-family: Inter, sans-serif; z-index: 999999 !important; } .flatpickr-wrapper { width: 100%; max-width: 100%; box-sizing: border-box; } .flatpickr-wrapper input { width: 100%; box-sizing: border-box; }';
  document.head.appendChild(style);
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/flatpickr';
  script.onload = function() { fpReady = true; fpQueue.forEach(function(fn) { fn(); }); fpQueue = []; };
  document.head.appendChild(script);
})();

JH.initDate = function(el, opts) {
  if (!fpReady) { fpQueue.push(function() { JH.initDate(el, opts); }); return; }
  if (el._flatpickr) el._flatpickr.destroy();
  var modal = el.closest('.modal');
  var defaults = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    allowInput: true,
    static: !!modal,
    appendTo: modal || undefined,
    defaultDate: el.value || undefined,
    onReady: function(selectedDates, dateStr, instance) {
      if (!dateStr) instance.jumpToDate('2026-07-01');
    }
  };
  return flatpickr(el, Object.assign(defaults, opts || {}));
};

JH.initTime = function(el, opts) {
  if (!fpReady) { fpQueue.push(function() { JH.initTime(el, opts); }); return; }
  if (el._flatpickr) el._flatpickr.destroy();
  var modal = el.closest('.modal');
  return flatpickr(el, Object.assign({
    enableTime: true,
    noCalendar: true,
    dateFormat: 'H:i',
    time_24hr: true,
    allowInput: true,
    static: !!modal,
    appendTo: modal || undefined
  }, opts || {}));
};

JH.val = function(m, key) { return (m[key] || '').toString().trim(); };

JH.isAdmin = function() { return !!(JH.currentUser && JH.currentUser.admin); };

/**
 * Make an authenticated API call. Gets fresh JWT from Supabase session.
 */
JH.apiFetch = async function(url, body) {
  if (!JH.supabase) throw new Error('Supabase not initialized');
  var sessionResult = await JH.supabase.auth.getSession();
  var session = sessionResult.data.session;
  if (!session) {
    window.location.href = '/admin';
    throw new Error('No session');
  }
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
    },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/admin';
    throw new Error('Unauthorized');
  }
  return res;
};

JH.authenticate = async function() {
  if (!JH.supabase) { window.location.href = '/admin'; return null; }
  var sessionResult = await JH.supabase.auth.getSession();
  var session = sessionResult.data.session;
  if (!session) { window.location.href = '/admin'; return null; }

  // Check must_change_password flag
  var user = session.user;
  if (user.user_metadata && user.user_metadata.must_change_password) {
    // Allow profile page to load (so they can change password)
    if (window.location.pathname.indexOf('/admin/profile') === -1) {
      window.location.href = '/admin/profile';
      return null;
    }
  }

  try {
    var res = await JH.apiFetch('/api/members', {});
    if (!res.ok) { await JH.supabase.auth.signOut(); window.location.href = '/admin'; return null; }
    var data = await res.json();
    // Cached roster for name→member resolution (JH.findMemberByName / JH.nameLink).
    // NOTE: this is the UNFILTERED member list — every Sheet1 row regardless of
    // Status (incl. rejected/withdrawn). Consumers only render names of actual
    // barrio members, so it's fine today; if you wire nameLink into a context that
    // could contain arbitrary names, gate on Status before trusting a match.
    JH.roster = data.members || [];

    // Find current user in members list
    var email = user.email.toLowerCase();
    var me = (data.members || []).find(function(m) {
      return (m.Email || '').toLowerCase().trim() === email;
    });

    JH.currentUser = {
      email: user.email,
      name: me ? JH.val(me, 'Name') : '',
      playaName: me ? JH.val(me, 'Playa Name') : '',
      admin: data.admin,
      observer: !!data.observer,
      row: me ? me._row : null,
      member: me,
    };

    // Check page access
    var accessMeta = document.querySelector('meta[name="access"]');
    var pageAccess = accessMeta ? accessMeta.getAttribute('content') : 'general';
    if (pageAccess === 'admin' && !data.admin) {
      window.location.href = '/admin/demographics';
      return null;
    }

    JH.filterNav(data.admin, !!data.observer);
    if (data.observer) {
      var badge = document.getElementById('sidebar-role-badge');
      if (badge) {
        badge.innerHTML = '<div style="display:inline-block;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">👀 Observer</div>';
      }
    }
    JH.addLogoutBtn();
    return data.members;
  } catch (e) {
    await JH.supabase.auth.signOut();
    window.location.href = '/admin';
    return null;
  }
};

JH.sidebarNav = [
  { href: '/admin/applications', icon: '&#9993;', text: 'Applications', access: 'admin' },
  { href: '/admin/demographics', icon: '&#9776;', text: 'Current Members', access: 'general' },
  { href: '/admin/budget', icon: '&#9733;', text: 'Budget', access: 'general', observerHide: true },
  { href: '/admin/fee-paid', icon: '&#128176;', text: 'Fee Paid', access: 'general', observerHide: true },
  { href: '/admin/shifts', icon: '&#9835;', text: 'Shifts', access: 'general' },
  { href: '/admin/inventory', icon: '&#128722;', text: 'Inventory', access: 'general' },
  { href: '/admin/logistics', icon: '&#9992;', text: 'Logistics', access: 'general' },
  { href: '/admin/early-entry', icon: '&#127903;', text: 'Early Entry', access: 'admin' },
  { href: '/admin/emergency', icon: '&#127973;', text: 'Emergency Info', access: 'admin' },
  { href: '/admin/meals', icon: '&#127859;', text: 'Meals', access: 'general' },
  { href: '/admin/menu', icon: '&#127869;', text: 'Dinner Menu', access: 'general' },
  { href: '/admin/drinks', icon: '&#127866;', text: 'Drinks & Snacks', access: 'general' },
  { href: '/admin/events', icon: '&#127926;', text: 'Events', access: 'general' },
  { href: '/admin/roles', icon: '&#128101;', text: 'Roles & Leads', access: 'general' },
  { href: '/admin/timeline', icon: '&#128197;', text: 'Timeline', access: 'admin' },
  { href: '/admin/todo', icon: '&#9989;', text: 'To-Do', access: 'admin' },
  { href: '/admin/profile', icon: '&#128100;', text: 'Profile', access: 'general' },
  { href: '/admin/info', icon: '&#128218;', text: 'Useful Info', access: 'general' },
  { href: '/admin/build', icon: '&#128296;', text: 'Build Guide', access: 'general' }
];

JH.renderSidebar = function() {
  var sidebar = document.querySelector('.sidebar');
  if (!sidebar || sidebar.dataset.rendered) return;
  sidebar.dataset.rendered = '1';
  var path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '');
  var html = '<div class="sidebar-brand">JamHouse <span>Admin 2026</span></div><div class="sidebar-nav">';
  JH.sidebarNav.forEach(function(item) {
    var active = path === item.href ? ' active' : '';
    var observerAttr = item.observerHide ? ' data-observer-hide="1"' : '';
    var hiddenStyle = item.access === 'admin' ? ' style="display:none"' : '';
    html += '<a class="nav-item' + active + '" href="' + item.href + '" data-access="' + item.access + '"' + observerAttr + hiddenStyle + '>' +
      '<span class="icon">' + item.icon + '</span><span class="nav-item-text">' + item.text + '</span></a>';
  });
  html += '</div><div class="sidebar-footer"><div id="sidebar-role-badge"></div><a href="/">&#8592; Back to Site</a></div>';
  sidebar.innerHTML = html;
  var activeItem = sidebar.querySelector('.nav-item.active');
  if (activeItem && activeItem.scrollIntoView) { try { activeItem.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {} }
};

// Render sidebar immediately (before auth, so page isn't empty)
JH.renderSidebar();

JH.filterNav = function(isAdmin, isObserver) {
  document.querySelectorAll('.sidebar .nav-item').forEach(function(item) {
    var access = item.getAttribute('data-access');
    item.style.display = ((access === 'admin' && !isAdmin) || (isObserver && item.getAttribute('data-observer-hide') === '1')) ? 'none' : '';
  });
};

// Shared icons and phone renderer
JH.waIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path fill="#25D366" d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.613.613l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.352 0-4.55-.678-6.414-1.846l-.447-.283-3.167 1.062 1.062-3.167-.283-.447A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>';
JH.tgIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#0088cc" d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

JH.phoneDigits = function(v) { return v.replace(/[^+\d]/g, '').replace(/\+/g, ''); };

JH.contactLinks = function(v, telegram) {
  var digits = JH.phoneDigits(v);
  var html = '';
  if (digits) html += ' &nbsp;<a href="https://wa.me/' + digits + '" target="_blank" title="WhatsApp" style="text-decoration:none;">' + JH.waIcon + '</a>';
  var tgHandle = (telegram || '').trim().replace(/^@/, '');
  tgHandle = tgHandle.replace(/[^A-Za-z0-9_]/g, '');
  if (tgHandle) {
    html += ' <a href="https://t.me/' + tgHandle + '" target="_blank" title="Telegram: @' + tgHandle + '" style="text-decoration:none;">' + JH.tgIcon + '</a>';
  } else if (digits) {
    html += ' <a href="https://t.me/+' + digits + '" target="_blank" title="Telegram" style="text-decoration:none;">' + JH.tgIcon + '</a>';
  }
  return html;
};

JH.PhoneCellRenderer = function() {};
JH.PhoneCellRenderer.prototype.init = function(params) {
  var v = (params.value || '').trim();
  this.eGui = document.createElement('span');
  if (!v) return;
  var tg = params.data ? params.data.Telegram : '';
  this.eGui.innerHTML = v.replace(/</g, '&lt;') + JH.contactLinks(v, tg);
};
JH.PhoneCellRenderer.prototype.getGui = function() { return this.eGui; };

// Dynamic getter so every read reflects the CURRENT width — callers that did
// `if (JH.isMobile)` keep working but no longer cache a stale value across a
// rotation/resize. Pages that must re-render on a breakpoint flip can listen
// for the debounced 'jh:breakpoint' event below.
Object.defineProperty(JH, 'isMobile', {
  configurable: true,
  get: function () { return window.innerWidth < 480; },
});
(function () {
  var last = window.innerWidth < 480;
  var t;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(function () {
      var now = window.innerWidth < 480;
      if (now !== last) {
        last = now;
        window.dispatchEvent(new CustomEvent('jh:breakpoint', { detail: { isMobile: now } }));
      }
    }, 150);
  });
})();

JH.IconsOnlyRenderer = function() {};
JH.IconsOnlyRenderer.prototype.init = function(params) {
  this.eGui = document.createElement('span');
  var v = (params.value || '').trim();
  var tg = params.data ? params.data.Telegram : '';
  if (v) this.eGui.innerHTML = JH.contactLinks(v, tg);
};
JH.IconsOnlyRenderer.prototype.getGui = function() { return this.eGui; };

JH.NameLinkRenderer = function() {};
JH.NameLinkRenderer.prototype.init = function(params) {
  this.eGui = document.createElement('a');
  this.eGui.href = '#';
  this.eGui.textContent = params.value || '';
  this.eGui.style.cssText = 'color:var(--accent);cursor:pointer;font-weight:600;text-decoration:none;';
  this.eGui.addEventListener('click', function(e) { e.preventDefault(); });
};
JH.NameLinkRenderer.prototype.getGui = function() { return this.eGui; };

// Resolve a displayed name to a full member record from the cached roster.
// Matches Playa Name OR Real Name, case-insensitive and trimmed. Returns the
// first match (duplicate display names are rare in a ~50-person barrio) or null.
JH.findMemberByName = function(name) {
  var key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  var roster = JH.roster || [];
  for (var i = 0; i < roster.length; i++) {
    var m = roster[i];
    var playa = String(JH.val(m, 'Playa Name') || '').trim().toLowerCase();
    var real = String(JH.val(m, 'Name') || '').trim().toLowerCase();
    if (playa === key || real === key) return m;
  }
  return null;
};

// Render a name as a clickable basic-info link IF it resolves to a member,
// else as plain escaped text. Returns an HTML string for use in innerHTML.
JH.nameLink = function(name) {
  var safe = JH.esc(name || '');
  if (!name || !JH.findMemberByName(name)) return safe;
  return '<a href="#" class="name-link" data-member-name="' + safe + '">' + safe + '</a>';
};

// Lazily-injected, shared member basic-info slide-in panel. `extras` is optional:
// { roles, lastLogin } — rendered only when provided (demographics passes them;
// other pages omit them). All other fields read off the member record via JH.val.
JH.ensureMemberPanel = function() {
  if (document.getElementById('member-overlay')) return;
  var ov = document.createElement('div');
  ov.className = 'member-overlay';
  ov.id = 'member-overlay';
  var panel = document.createElement('div');
  panel.className = 'member-panel';
  panel.id = 'member-panel';
  panel.innerHTML =
    '<div class="member-panel-header">' +
      '<h3 id="member-panel-title"></h3>' +
      '<button class="panel-close" id="member-panel-close">&times;</button>' +
    '</div>' +
    '<div id="member-panel-body"></div>';
  document.body.appendChild(ov);
  document.body.appendChild(panel);
  function close() { ov.classList.remove('active'); panel.classList.remove('active'); }
  document.getElementById('member-panel-close').addEventListener('click', close);
  ov.addEventListener('click', close);
};

// Fields admins see in the member panel, ordered for readability. New columns
// added to Sheet1 also show up — they fall through to the "anything else" pass
// below the ordered list so the panel grows automatically.
JH._ADMIN_FIELD_ORDER = [
  'Name', 'Status', 'Email', 'Phone', 'Telegram',
  'Age', 'Gender', 'Nationality', 'Location',
  'Medical Conditions', 'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relation',
  'FoodType', 'DietaryNotes',
  'First Burn', 'First Elsewhere/Nowhere', 'Has Ticket', 'Volunteer',
  'fee_total_sent', 'fee_received', 'low_income_request', 'low_income_status',
  'Admin', 'Responsible HR', 'Comments', 'Timestamp'
];
JH._ADMIN_PANEL_HIDE = { _row: 1, _date: 1, '': 1, LastDietaryPromptedAt: 1, 'Playa Name': 1 };
// Pretty labels for snake_case / cramped columns; falls back to the key itself.
JH._ADMIN_FIELD_LABEL = {
  Name: 'Real Name',
  fee_total_sent: 'Fee Sent',
  fee_received: 'Fee Received',
  low_income_request: 'Low-Income Request',
  low_income_status: 'Low-Income Status',
  'First Elsewhere/Nowhere': 'First Elsewhere',
  FoodType: 'Food Type',
  DietaryNotes: 'Dietary Notes'
};

JH.openMemberPanel = function(m, extras) {
  if (!m) return;
  JH.ensureMemberPanel();
  extras = extras || {};
  document.getElementById('member-panel-title').textContent =
    JH.val(m, 'Playa Name') || JH.val(m, 'Name') || 'Member';
  var fields;
  if (JH.isAdmin && JH.isAdmin()) {
    // Admins see every non-empty member field plus extras. Ordered list first,
    // then any keys not yet listed (so new sheet columns surface automatically).
    fields = [];
    if (extras.roles) fields.push(['Roles', extras.roles]);
    if (extras.lastLogin) fields.push(['Last Login', extras.lastLogin]);
    JH._ADMIN_FIELD_ORDER.forEach(function(k) {
      var v = JH.val(m, k);
      if (v) fields.push([JH._ADMIN_FIELD_LABEL[k] || k, v]);
    });
    var seen = {};
    JH._ADMIN_FIELD_ORDER.forEach(function(k) { seen[k] = 1; });
    Object.keys(m).forEach(function(k) {
      if (seen[k] || JH._ADMIN_PANEL_HIDE[k]) return;
      var v = JH.val(m, k);
      if (v) fields.push([JH._ADMIN_FIELD_LABEL[k] || k, v]);
    });
  } else {
    // Non-admins keep the limited safe view (no contact info beyond phone/email,
    // no medical/emergency, no fee/admin internals).
    fields = [
      ['Real Name', JH.val(m, 'Name')],
      ['Age', JH.val(m, 'Age')],
      ['Gender', JH.val(m, 'Gender')],
      ['Nationality', JH.val(m, 'Nationality')],
      ['Location', JH.val(m, 'Location')],
      ['Roles', extras.roles || ''],
      ['Phone', JH.val(m, 'Phone')],
      ['Email', JH.val(m, 'Email')],
      ['Last Login', extras.lastLogin || ''],
      ['First Burn', JH.val(m, 'First Burn')],
      ['First Elsewhere', JH.val(m, 'First Elsewhere/Nowhere')],
      ['Has Ticket', JH.val(m, 'Has Ticket')],
      ['Volunteer', JH.val(m, 'Volunteer')]
    ];
  }
  document.getElementById('member-panel-body').innerHTML = fields.filter(function(f) {
    return f[1];
  }).map(function(f) {
    var val = String(f[1]);
    // Long text (notes, comments, etc.) wraps to multi-line for legibility.
    var multi = val.length > 60 || val.indexOf('\n') !== -1;
    var cls = 'member-field' + (multi ? ' member-field-multi' : '');
    return '<div class="' + cls + '"><span class="member-field-label">' + JH.esc(f[0]) +
      '</span><span class="member-field-value">' + JH.esc(val) + '</span></div>';
  }).join('');
  document.getElementById('member-overlay').classList.add('active');
  document.getElementById('member-panel').classList.add('active');
};

// One delegated handler for every clickable name link across all admin pages.
// Resolves the clicked name to a member and opens the shared panel. Names that
// don't resolve are never rendered as links (see JH.nameLink), so this is a no-op
// for plain text. The remove-buttons on Shifts use a different selector, no clash.
document.addEventListener('click', function(e) {
  var a = e.target.closest && e.target.closest('a.name-link[data-member-name]');
  if (!a) return;
  e.preventDefault();
  var m = JH.findMemberByName(a.getAttribute('data-member-name'));
  if (m) JH.openMemberPanel(m);
});

JH.mobileColumns = function(columnDefs, keepFields) {
  if (!JH.isMobile) return;
  columnDefs.forEach(function(col) {
    var match = (col.field && keepFields.indexOf(col.field) !== -1) ||
                (col.headerName && keepFields.indexOf(col.headerName) !== -1);
    if (!match) col.hide = true;
  });
};

JH.mobilePhoneColumn = function(col) {
  col.headerName = '';
  col.width = 80;
  col.maxWidth = 90;
  col.suppressSizeToFit = true;
  col.cellRenderer = JH.IconsOnlyRenderer;
};

JH.esc = function(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };

JH.to24h = function(t) {
  if (!t) return '';
  var m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return t;
  var h = parseInt(m[1], 10);
  var ampm = m[3].toUpperCase();
  if (ampm === 'AM' && h === 12) h = 0;
  else if (ampm === 'PM' && h !== 12) h += 12;
  return (h < 10 ? '0' : '') + h + ':' + m[2];
};

JH.formatDate = function(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var day = String(d.getDate()).padStart(2, '0');
  var mon = String(d.getMonth() + 1).padStart(2, '0');
  return day + '/' + mon + '/' + d.getFullYear();
};

JH.formatDateLong = function(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var day = String(d.getDate()).padStart(2, '0');
  var mon = String(d.getMonth() + 1).padStart(2, '0');
  return days[d.getDay()] + ' ' + day + '/' + mon;
};

JH.getHeadcount = function(logistics, dateStr) {
  return logistics.filter(function (l) {
    if (!l.ArrivalDate || !l.DepartureDate) return false;
    return l.ArrivalDate <= dateStr && l.DepartureDate >= dateStr;
  }).length;
};

// Restrict raw MemberLogistics rows to ones that belong to an *approved* member,
// so presence-based headcounts (drinks/meals charts, meals NoOrg subtraction)
// count the barrio roster — not observers, pending applicants, stale rows, or
// non-member guests who happen to have a logistics row. A row matches if its
// MemberName equals an approved member's legal or playa name (case/space
// insensitive).
//
// Deduped by *member identity*, NOT by the row's name string: members commonly
// have two logistics rows — one entered under their legal name, one under their
// playa name — and both names map to the same person, so a name-keyed dedup
// would keep both and over-count (e.g. "David Burgess" + "Engineer Dave" = 2).
// We map both of a member's names to one stable key (legal, else playa) and keep
// the first row seen per key. Pass the `members` array JH.authenticate() returned.
JH.approvedLogistics = function(logistics, members) {
  var nameToKey = {};
  (members || []).forEach(function (m) {
    if ((JH.val(m, 'Status') || '').toLowerCase().trim() !== 'approved') return;
    var legal = (JH.val(m, 'Name') || '').toLowerCase().trim();
    var playa = (JH.val(m, 'Playa Name') || '').toLowerCase().trim();
    var key = legal || playa;
    if (!key) return;
    if (legal) nameToKey[legal] = key;
    if (playa) nameToKey[playa] = key;
  });
  var seen = {};
  return (logistics || []).filter(function (row) {
    var key = nameToKey[(row.MemberName || '').toLowerCase().trim()];
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
};

JH.getAllDates = function(logistics) {
  var dateSet = {};
  function nextDay(s) {
    var p = s.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  logistics.forEach(function (l) {
    if (!l.ArrivalDate || !l.DepartureDate) return;
    var d = l.ArrivalDate;
    var guard = 0;
    while (d <= l.DepartureDate && guard++ < 366) {
      dateSet[d] = true;
      d = nextDay(d);
    }
  });
  return Object.keys(dateSet).sort();
};

JH.addLogoutBtn = function() {
  var header = document.querySelector('.page-header');
  if (!header || header.querySelector('.logout-btn')) return;
  // Wrap existing content
  var wrapper = document.createElement('div');
  wrapper.className = 'page-header-left';
  while (header.firstChild) wrapper.appendChild(header.firstChild);
  header.appendChild(wrapper);
  var btn = document.createElement('button');
  btn.className = 'logout-btn';
  btn.textContent = 'Logout';
  btn.onclick = function() { JH.supabase.auth.signOut().then(function() { window.location.href = '/admin'; }); };
  header.appendChild(btn);
};

JH.checkLogisticsPrompt = async function() {
  if (JH.currentUser && JH.currentUser.observer) return;
  if (window.location.pathname.indexOf('/admin/logistics') !== -1) return;
  if (!JH.currentUser || !JH.currentUser.name) return;
  // Cache: skip API call if checked less than 10 minutes ago
  var lastChecked = sessionStorage.getItem('jh_logistics_checked');
  if (lastChecked && (Date.now() - parseInt(lastChecked, 10)) < 600000) return;
  try {
    var res = await JH.apiFetch('/api/logistics', {});
    if (!res.ok) return;
    var data = await res.json();
    sessionStorage.setItem('jh_logistics_checked', Date.now());
    var names = [JH.currentUser.name, JH.currentUser.playaName]
      .filter(Boolean).map(function(n) { return n.toLowerCase().trim(); });
    var row = (data.logistics || []).find(function(r) {
      return names.indexOf((r['MemberName'] || '').toLowerCase().trim()) !== -1;
    });
    if (row && (row['ArrivalDate'] || row['DepartureDate'])) return;
    var banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(232,168,76,0.1);border:1px solid var(--accent);border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:0.84rem;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:12px;';
    banner.innerHTML = '<span>We don\'t have your arrival info yet! Please <a href="/admin/logistics" style="color:var(--accent);font-weight:600">fill in your logistics</a> so we can plan meals and pickups. Don\'t worry if it\'s approximate for now &mdash; any information is useful, and you can update it as plans change.</span>' +
      '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;flex-shrink:0;padding:6px;min-width:32px;min-height:32px;">&times;</button>';
    var main = document.querySelector('.main');
    if (main) main.insertBefore(banner, main.firstChild.nextSibling);
  } catch (e) {}
};

JH.checkShiftsPrompt = async function() {
  if (JH.currentUser && JH.currentUser.observer) return;
  if (window.location.pathname.indexOf('/admin/shifts') !== -1) return;
  if (!JH.currentUser || !JH.currentUser.member) return;
  if (sessionStorage.getItem('jh_shifts_dismissed')) return;

  // We aim for at least 2 shifts per person — banner fires below that.
  // Cache the "has enough" answer for 10 minutes to avoid an extra API
  // call on every admin page load.
  var SHIFT_MIN = 2;
  var lastChecked = sessionStorage.getItem('jh_shifts_checked');
  var hasEnough;
  if (lastChecked && (Date.now() - parseInt(lastChecked, 10)) < 600000) {
    hasEnough = sessionStorage.getItem('jh_shifts_enough') === '1';
  } else {
    try {
      var res = await JH.apiFetch('/api/shifts', {});
      if (!res.ok) return;
      var data = await res.json();
      var playa = (JH.currentUser.member['Playa Name'] || '').trim().toLowerCase();
      var legal = (JH.currentUser.member['Name'] || '').trim().toLowerCase();
      var myShifts = (data.shifts || []).filter(function(s) {
        var names = (s.AssignedTo || '').split(',').map(function(x) { return x.trim().toLowerCase(); });
        return (playa && names.indexOf(playa) !== -1) || (legal && names.indexOf(legal) !== -1);
      }).length;
      hasEnough = myShifts >= SHIFT_MIN;
      sessionStorage.setItem('jh_shifts_enough', hasEnough ? '1' : '0');
      sessionStorage.setItem('jh_shifts_checked', Date.now());
    } catch (e) { return; }
  }
  if (hasEnough) return;

  var banner = document.createElement('div');
  banner.id = 'jh-shifts-banner';
  banner.style.cssText = 'background:rgba(232,168,76,0.1);border:1px solid var(--accent);border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:0.84rem;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:12px;';
  banner.innerHTML = '<span>Shifts still need covering &mdash; <a href="/admin/shifts" style="color:var(--accent);font-weight:600">explore what\'s not yet filled</a> and grab a few to help out. We aim for two per person, and you can always swap or drop later.</span>' +
    '<button id="jh-shifts-dismiss" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;flex-shrink:0;padding:6px;min-width:32px;min-height:32px;">&times;</button>';
  var main = document.querySelector('.main');
  if (main) main.insertBefore(banner, main.firstChild.nextSibling);
  var dismissBtn = document.getElementById('jh-shifts-dismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', function() {
    sessionStorage.setItem('jh_shifts_dismissed', '1');
    banner.remove();
  });
};

JH.checkDietaryPrompt = function() {
  if (JH.currentUser && JH.currentUser.observer) return;
  if (window.location.pathname.indexOf('/admin/profile') !== -1) return;
  if (!JH.currentUser || !JH.currentUser.member) return;
  if (sessionStorage.getItem('jh_dietary_dismissed')) return;
  var ft = (JH.currentUser.member['FoodType'] || '').toString().trim();
  if (ft) return;
  var banner = document.createElement('div');
  banner.id = 'jh-dietary-banner';
  banner.style.cssText = 'background:rgba(232,168,76,0.1);border:1px solid var(--accent);border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:0.84rem;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:12px;';
  banner.innerHTML = '<span>We don\'t have your dietary info yet — please <a href="/admin/profile?prompt=dietary" style="color:var(--accent);font-weight:600">fill it in on your profile</a> so the kitchen can plan around you.</span>' +
    '<button id="jh-dietary-dismiss" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;flex-shrink:0;padding:6px;min-width:32px;min-height:32px;">&times;</button>';
  var main = document.querySelector('.main');
  if (main) main.insertBefore(banner, main.firstChild.nextSibling);
  var dismissBtn = document.getElementById('jh-dietary-dismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', function() {
    sessionStorage.setItem('jh_dietary_dismissed', '1');
    banner.remove();
  });
};

// Auto-check after page loads
setTimeout(function() { JH.checkLogisticsPrompt(); JH.checkDietaryPrompt(); JH.checkShiftsPrompt(); }, 500);
