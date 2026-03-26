window.JH = window.JH || {};

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
    // Check page access
    var accessMeta = document.querySelector('meta[name="access"]');
    var pageAccess = accessMeta ? accessMeta.getAttribute('content') : 'general';
    if (pageAccess === 'admin' && !data.admin) {
      window.location.href = '/admin/demographics';
      return null;
    }
    // Filter sidebar nav
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
    var res = await fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    if (res.ok) return await res.json();
  } catch (e) {}
  return [];
};
