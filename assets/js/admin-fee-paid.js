(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var EXPECTED = 280;
  var sentInput = document.getElementById('sent-amount');
  var sentStatus = document.getElementById('sent-status');
  var liInput = document.getElementById('li-justification');
  var liStatus = document.getElementById('li-status');
  var liSubmit = document.getElementById('li-submit');
  var liWithdraw = document.getElementById('li-withdraw');

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(el, cls, text) {
    el.className = 'status-line ' + cls;
    el.textContent = text;
    el.style.display = '';
  }

  function renderMyStatus(me) {
    var sent = me.fee_total_sent || 0;
    var received = me.fee_received;
    if (!sent) {
      setStatus(sentStatus, 'status-grey', 'Not sent yet');
      return;
    }
    if (!received) {
      setStatus(sentStatus, 'status-yellow', '€' + sent + ' sent — awaiting confirmation');
      return;
    }
    if (sent === EXPECTED) {
      setStatus(sentStatus, 'status-green', '✓ €' + sent + ' received — fully paid');
    } else if (sent < EXPECTED) {
      setStatus(sentStatus, 'status-yellow', '✓ €' + sent + ' received — €' + (EXPECTED - sent) + ' still outstanding');
    } else {
      setStatus(sentStatus, 'status-green', '✓ €' + sent + ' received — paid with €' + (sent - EXPECTED) + ' extra. Thank you!');
    }
  }

  function renderMyLowIncome(me) {
    var status = (me.low_income_status || '').toLowerCase();
    liInput.value = me.low_income_request || '';
    if (!me.low_income_request) {
      liStatus.style.display = 'none';
      liSubmit.textContent = 'Submit request';
      liWithdraw.style.display = 'none';
      liInput.disabled = false;
      return;
    }
    liWithdraw.style.display = '';
    liInput.disabled = true;
    liSubmit.style.display = 'none';
    if (status === 'pending') setStatus(liStatus, 'status-yellow', 'Request submitted — awaiting review');
    else if (status === 'approved') setStatus(liStatus, 'status-green', '✓ Approved — adjusted fee will be communicated by an admin');
    else if (status === 'declined') setStatus(liStatus, 'status-red', '✗ Declined — please contact an admin');
  }

  function rosterRowClass(r) {
    if (r.fee_received) return 'row-green';
    if ((r.low_income_status || '').toLowerCase() === 'approved') return '';
    if (!r.fee_total_sent) return 'row-grey';
    if (r.fee_total_sent < EXPECTED) return 'row-red';
    return 'row-green';
  }

  function rosterStatusText(r) {
    var sent = r.fee_total_sent || 0;
    var liApproved = (r.low_income_status || '').toLowerCase() === 'approved';
    if (!sent && liApproved) return '🎟 Low income approved';
    if (!sent) return '—';
    var extra = '';
    if (sent > EXPECTED) extra = ' <span class="badge badge-extra">+€' + (sent - EXPECTED) + '</span>';
    else if (sent < EXPECTED) extra = ' <span class="badge" style="background:rgba(244,67,54,0.18);color:#f06b60;">-€' + (EXPECTED - sent) + '</span>';
    var liBadge = liApproved ? ' <span class="badge badge-li">🎟</span>' : '';
    if (r.fee_received) return '✓ Received' + extra + liBadge;
    return 'Sent, awaiting' + extra + liBadge;
  }

  function renderRoster(roster) {
    var tbody = document.querySelector('#roster-table tbody');
    var totalSent = 0, totalReceived = 0;
    var html = '';
    roster.forEach(function(r) {
      totalSent += r.fee_total_sent || 0;
      if (r.fee_received) totalReceived += r.fee_total_sent || 0;
      html += '<tr class="' + rosterRowClass(r) + '" data-row="' + r._row + '">' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.playa_name) + '</td>' +
        '<td>€' + (r.fee_total_sent || 0) + '</td>' +
        '<td>' + rosterStatusText(r) + '</td>' +
        '<td><input type="checkbox" class="recv-cb" ' + (r.fee_received ? 'checked' : '') + '></td>' +
        '</tr>';
    });
    tbody.innerHTML = html || '<tr><td colspan="5" style="color:var(--text-muted);">No approved members.</td></tr>';
    document.getElementById('t-sent').textContent = '€' + totalSent;
    document.getElementById('t-received').textContent = '€' + totalReceived;
    document.getElementById('t-status').textContent = 'Outstanding: €' + Math.max(0, EXPECTED * roster.length - totalReceived);

    tbody.querySelectorAll('.recv-cb').forEach(function(cb) {
      cb.addEventListener('change', async function() {
        var row = parseInt(cb.closest('tr').getAttribute('data-row'));
        cb.disabled = true;
        try {
          var res = await JH.apiFetch('/api/members', { action: 'mark-fee-received', row: row, received: cb.checked });
          if (!res.ok) throw new Error('Failed');
          await load();
        } catch (e) {
          cb.checked = !cb.checked;
          alert('Failed to update');
        } finally {
          cb.disabled = false;
        }
      });
    });
  }

  function renderLiList(roster) {
    var requests = roster.filter(function(r) { return r.low_income_request; });
    var container = document.getElementById('li-list');
    if (!requests.length) {
      container.innerHTML = '<em style="color:var(--text-muted);">No requests yet.</em>';
      return;
    }
    var html = '';
    requests.forEach(function(r) {
      var status = (r.low_income_status || 'pending').toLowerCase();
      var statusBadge = '';
      if (status === 'approved') statusBadge = '<span class="badge" style="background:rgba(76,175,80,0.18);color:#6dcf72;">Approved</span>';
      else if (status === 'declined') statusBadge = '<span class="badge" style="background:rgba(244,67,54,0.18);color:#f06b60;">Declined</span>';
      else statusBadge = '<span class="badge badge-li">Pending</span>';
      var actions = '';
      if (status === 'pending') {
        actions = '<div class="li-actions">' +
          '<button class="btn btn-sm" data-row="' + r._row + '" data-decision="approved">Approve</button>' +
          '<button class="btn btn-sm btn-decline" data-row="' + r._row + '" data-decision="declined">Decline</button>' +
          '</div>';
      }
      html += '<div class="li-card">' +
        '<div class="who">' + esc(r.name) + (r.playa_name ? ' (' + esc(r.playa_name) + ')' : '') + ' ' + statusBadge + '</div>' +
        '<div class="just">' + esc(r.low_income_request) + '</div>' +
        actions +
        '</div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('button[data-decision]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        btn.disabled = true;
        try {
          var res = await JH.apiFetch('/api/members', {
            action: 'review-low-income',
            row: parseInt(btn.getAttribute('data-row')),
            decision: btn.getAttribute('data-decision'),
          });
          if (!res.ok) throw new Error('Failed');
          await load();
        } catch (e) {
          alert('Failed');
          btn.disabled = false;
        }
      });
    });
  }

  async function load() {
    var res = await JH.apiFetch('/api/members', { action: 'fee-fetch' });
    if (!res.ok) { sentStatus.textContent = 'Failed to load'; return; }
    var data = await res.json();
    EXPECTED = data.expected || 280;
    if (data.me) {
      sentInput.value = data.me.fee_total_sent || '';
      renderMyStatus(data.me);
      renderMyLowIncome(data.me);
    }
    if (data.admin && data.roster) {
      document.querySelectorAll('.admin-only').forEach(function(el) { el.style.display = ''; });
      renderRoster(data.roster);
      renderLiList(data.roster);
    }
  }

  document.getElementById('sent-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var amount = parseFloat(sentInput.value);
    if (!isFinite(amount) || amount < 0) { setStatus(sentStatus, 'status-red', 'Enter a valid amount'); return; }
    setStatus(sentStatus, 'status-grey', 'Saving…');
    try {
      var res = await JH.apiFetch('/api/members', { action: 'save-fee-sent', amount: amount });
      if (!res.ok) throw new Error('Failed');
      await load();
    } catch (ex) {
      setStatus(sentStatus, 'status-red', 'Failed to save');
    }
  });

  document.getElementById('li-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var text = liInput.value.trim();
    if (!text) { setStatus(liStatus, 'status-red', 'Please enter a justification'); return; }
    liSubmit.disabled = true;
    try {
      var res = await JH.apiFetch('/api/members', { action: 'submit-low-income', justification: text });
      if (!res.ok) throw new Error('Failed');
      await load();
    } catch (ex) {
      setStatus(liStatus, 'status-red', 'Failed to submit');
    } finally {
      liSubmit.disabled = false;
    }
  });

  liWithdraw.addEventListener('click', async function() {
    if (!confirm('Withdraw your low income request?')) return;
    liWithdraw.disabled = true;
    try {
      var res = await JH.apiFetch('/api/members', { action: 'withdraw-low-income' });
      if (!res.ok) throw new Error('Failed');
      liSubmit.style.display = '';
      await load();
    } catch (ex) {
      setStatus(liStatus, 'status-red', 'Failed to withdraw');
    } finally {
      liWithdraw.disabled = false;
    }
  });

  await load();
})();
