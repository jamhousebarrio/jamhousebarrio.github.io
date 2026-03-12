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
    return data.members;
  } catch (e) { sessionStorage.removeItem('jh_pass'); sessionStorage.removeItem('jh_admin'); window.location.href = '/admin'; return null; }
};

JH.fetchBudget = async function() {
  var pass = sessionStorage.getItem('jh_pass');
  try {
    var res = await fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    if (res.ok) return await res.json();
  } catch (e) {}
  return [];
};
