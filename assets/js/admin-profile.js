(async function() {
  var members = await JH.authenticate();
  if (!members) return;

  var user = JH.currentUser;
  var sb = JH.supabase;
  var session = (await sb.auth.getSession()).data.session;
  var mustChange = session && session.user.user_metadata && session.user.user_metadata.must_change_password;

  // Password change section
  var pwSection = document.getElementById('password-section');
  var currentPwField = document.getElementById('current-password');
  var currentPwRow = document.getElementById('current-password-row');

  if (mustChange) {
    document.getElementById('pw-banner').style.display = '';
    if (currentPwRow) currentPwRow.style.display = 'none';
  }

  document.getElementById('pw-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var msg = document.getElementById('pw-msg');
    msg.textContent = '';

    var newPw = document.getElementById('new-password').value;
    var confirmPw = document.getElementById('confirm-password').value;

    if (newPw !== confirmPw) {
      msg.textContent = 'Passwords do not match';
      msg.style.color = '#f44336';
      return;
    }
    if (newPw.length < 8) {
      msg.textContent = 'Password must be at least 8 characters';
      msg.style.color = '#f44336';
      return;
    }

    try {
      // If not a must-change flow, re-authenticate with current password first
      if (!mustChange) {
        var currentPw = currentPwField.value;
        if (!currentPw) {
          msg.textContent = 'Enter your current password';
          msg.style.color = '#f44336';
          return;
        }
        var reauth = await sb.auth.signInWithPassword({
          email: user.email,
          password: currentPw,
        });
        if (reauth.error) {
          msg.textContent = 'Current password is incorrect';
          msg.style.color = '#f44336';
          return;
        }
      }

      // Update password
      var result = await sb.auth.updateUser({ password: newPw });
      if (result.error) {
        msg.textContent = result.error.message || 'Failed to update password';
        msg.style.color = '#f44336';
        return;
      }

      // Clear must_change_password flag if set
      if (mustChange) {
        await JH.apiFetch('/api/auth', { action: 'clear-password-flag' });
        // Refresh session so local metadata reflects the cleared flag
        await sb.auth.refreshSession();
      }

      msg.textContent = 'Password updated!';
      msg.style.color = '#4caf50';

      // If was forced, redirect to dashboard after short delay
      if (mustChange) {
        setTimeout(function() {
          window.location.href = JH.isAdmin() ? '/admin/applications' : '/admin/demographics';
        }, 1500);
      }
    } catch (ex) {
      msg.textContent = 'Something went wrong';
      msg.style.color = '#f44336';
    }
  });

  // Admin badge
  var badge = document.getElementById('admin-badge');
  if (badge) {
    badge.style.display = '';
    if (user.admin) {
      badge.textContent = 'Admin';
      badge.style.background = 'rgba(232,168,76,0.12)';
      badge.style.color = '#e8a84c';
      badge.style.border = '1px solid rgba(232,168,76,0.3)';
    } else {
      badge.textContent = 'Member';
      badge.style.background = 'rgba(255,255,255,0.04)';
      badge.style.color = 'var(--text-muted)';
      badge.style.border = '1px solid var(--border)';
    }
  }

  // Personal info section
  var editableFields = ['Name', 'Playa Name', 'Email', 'Phone', 'Location', 'Nationality', 'Gender', 'Age'];
  var infoForm = document.getElementById('info-form');

  editableFields.forEach(function(field) {
    var input = document.getElementById('info-' + field.toLowerCase().replace(/ /g, '-'));
    if (input && user.member) {
      input.value = JH.val(user.member, field);
    }
  });

  infoForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    var msg = document.getElementById('info-msg');
    msg.textContent = 'Saving...';
    msg.style.color = 'var(--text-muted)';

    var updates = {};
    editableFields.forEach(function(field) {
      var input = document.getElementById('info-' + field.toLowerCase().replace(/ /g, '-'));
      if (input) {
        var newVal = input.value.trim();
        var oldVal = user.member ? JH.val(user.member, field) : '';
        if (newVal !== oldVal) updates[field] = newVal;
      }
    });

    if (Object.keys(updates).length === 0) {
      msg.textContent = 'No changes';
      return;
    }

    try {
      var res = await JH.apiFetch('/api/members', {
        action: 'update',
        row: user.row,
        updates: updates,
      });
      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        throw new Error(err.error || 'Failed');
      }
      msg.textContent = 'Saved!';
      msg.style.color = '#4caf50';
      // Update local state
      for (var k in updates) {
        if (user.member) user.member[k] = updates[k];
      }
    } catch (ex) {
      msg.textContent = ex.message;
      msg.style.color = '#f44336';
    }
  });

  // If must change password, disable navigation away
  if (mustChange) {
    document.querySelectorAll('.sidebar a').forEach(function(link) {
      if (link.getAttribute('href') !== '/admin/profile') {
        link.addEventListener('click', function(e) {
          e.preventDefault();
          document.getElementById('pw-msg').textContent = 'Please change your password first';
          document.getElementById('pw-msg').style.color = '#f44336';
        });
        link.style.opacity = '0.4';
        link.style.pointerEvents = 'auto';
        link.style.cursor = 'not-allowed';
      }
    });
  }
})();
