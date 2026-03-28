window.JH = window.JH || {};

// Load Flatpickr for date/time inputs (dd/mm/yyyy, 24h)
(function() {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
  document.head.appendChild(link);
  // Dark theme
  var dark = document.createElement('link');
  dark.rel = 'stylesheet';
  dark.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css';
  document.head.appendChild(dark);
  var style = document.createElement('style');
  style.textContent = '.flatpickr-input { cursor: pointer; } .flatpickr-calendar { font-family: Inter, sans-serif; }';
  document.head.appendChild(style);
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/flatpickr';
  document.head.appendChild(script);
})();

JH.initDate = function(el, opts) {
  if (typeof flatpickr === 'undefined') {
    setTimeout(function() { JH.initDate(el, opts); }, 100);
    return;
  }
  return flatpickr(el, Object.assign({
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    allowInput: true
  }, opts || {}));
};

JH.initTime = function(el, opts) {
  if (typeof flatpickr === 'undefined') {
    setTimeout(function() { JH.initTime(el, opts); }, 100);
    return;
  }
  return flatpickr(el, Object.assign({
    enableTime: true,
    noCalendar: true,
    dateFormat: 'H:i',
    time_24hr: true,
    allowInput: true
  }, opts || {}));
};

JH.val = function(m, key) { return (m[key] || '').toString().trim(); };

JH.isAdmin = function() { return sessionStorage.getItem('jh_admin') === '1'; };

JH.authenticate = async function() {
  var pass = sessionStorage.getItem('jh_pass');
  if (!pass) { window.location.href = '/admin'; return null; }
  try {
    var res = await fetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    if (!res.ok) { sessionStorage.removeItem('jh_pass'); sessionStorage.removeItem('jh_admin'); window.location.href = '/admin'; return null; }
    var data = await res.json();
    if (data.admin) sessionStorage.setItem('jh_admin', '1');
    else sessionStorage.removeItem('jh_admin');
    // Check page access
    var accessMeta = document.querySelector('meta[name="access"]');
    var pageAccess = accessMeta ? accessMeta.getAttribute('content') : 'general';
    if (pageAccess === 'admin' && !data.admin) {
      window.location.href = '/admin/demographics';
      return null;
    }
    JH.filterNav(data.admin);
    return data.members;
  } catch (e) { sessionStorage.removeItem('jh_pass'); sessionStorage.removeItem('jh_admin'); window.location.href = '/admin'; return null; }
};

JH.filterNav = function(isAdmin) {
  document.querySelectorAll('.sidebar .nav-item').forEach(function(item) {
    var access = item.getAttribute('data-access');
    if (access === 'admin' && !isAdmin) {
      item.style.display = 'none';
    }
  });
};

JH.fetchBudget = async function() {
  var pass = sessionStorage.getItem('jh_pass');
  try {
    var res = await fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass, action: 'fetch' }) });
    if (res.ok) return await res.json();
    console.error('Budget fetch failed:', res.status);
  } catch (e) { console.error('Budget fetch error:', e); }
  return [];
};

// Shared icons and phone renderer
JH.waIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path fill="#25D366" d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.613.613l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.352 0-4.55-.678-6.414-1.846l-.447-.283-3.167 1.062 1.062-3.167-.283-.447A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>';
JH.tgIcon = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;"><path fill="#0088cc" d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

JH.phoneDigits = function(v) { return v.replace(/[^+\d]/g, '').replace(/\+/g, ''); };

JH.contactLinks = function(v) {
  var digits = JH.phoneDigits(v);
  if (!digits) return '';
  return ' &nbsp;<a href="https://wa.me/' + digits + '" target="_blank" title="WhatsApp" style="text-decoration:none;">' + JH.waIcon + '</a>' +
    ' <a href="https://t.me/+' + digits + '" target="_blank" title="Telegram" style="text-decoration:none;">' + JH.tgIcon + '</a>';
};

JH.PhoneCellRenderer = function() {};
JH.PhoneCellRenderer.prototype.init = function(params) {
  var v = (params.value || '').trim();
  this.eGui = document.createElement('span');
  if (!v) return;
  this.eGui.innerHTML = v.replace(/</g, '&lt;') + JH.contactLinks(v);
};
JH.PhoneCellRenderer.prototype.getGui = function() { return this.eGui; };

// Mobile utilities
JH.isMobile = window.innerWidth < 480;

JH.IconsOnlyRenderer = function() {};
JH.IconsOnlyRenderer.prototype.init = function(params) {
  this.eGui = document.createElement('span');
  var v = (params.value || '').trim();
  if (v) this.eGui.innerHTML = JH.contactLinks(v);
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

JH.esc = function(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

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

JH.checkLogisticsPrompt = async function() {
  // Don't show on the logistics page itself
  if (window.location.pathname.indexOf('/admin/logistics') !== -1) return;
  var myName = sessionStorage.getItem('jh_member_name');
  if (!myName) return;
  var pass = sessionStorage.getItem('jh_pass');
  try {
    var res = await fetch('/api/logistics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    if (!res.ok) return;
    var data = await res.json();
    var row = (data.logistics || []).find(function(r) { return r['MemberName'] === myName; });
    if (row && (row['ArrivalDate'] || row['DepartureDate'])) return;
    var banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(232,168,76,0.1);border:1px solid var(--accent);border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:0.84rem;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:12px;';
    banner.innerHTML = '<span>We don\'t have your arrival info yet! Please <a href="/admin/logistics" style="color:var(--accent);font-weight:600">fill in your logistics</a> so we can plan meals and pickups.</span>' +
      '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;flex-shrink:0">&times;</button>';
    var main = document.querySelector('.main');
    if (main) main.insertBefore(banner, main.firstChild.nextSibling);
  } catch (e) {}
};

// Auto-check after page loads
setTimeout(function() { JH.checkLogisticsPrompt(); }, 500);
