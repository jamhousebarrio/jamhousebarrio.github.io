(async function() {
  const LABELS = ['kitchen', 'stage', 'shower', 'tools', 'private space', 'tent space', 'people', 'other'];
  const BUCKET = 'build-photos';
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

  await JH.authenticate();

  let allPhotos = [];
  let activeFilter = null;
  const selectedLabels = new Set();
  let selectedFiles = [];

  const filterBar = document.getElementById('filter-bar');
  const grid = document.getElementById('photo-grid');
  const uploadChips = document.getElementById('upload-chips');
  const fileInput = document.getElementById('file-input');
  const fileList = document.getElementById('file-list');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadStatus = document.getElementById('upload-status');

  function mkChip(text, active, onclick) {
    const c = document.createElement('span');
    c.className = 'chip' + (active ? ' chip-active' : '');
    c.textContent = text;
    if (onclick) c.onclick = onclick;
    return c;
  }

  function renderFilterBar() {
    filterBar.innerHTML = '';
    const counts = {};
    allPhotos.forEach(p => p.labels.forEach(l => { counts[l] = (counts[l] || 0) + 1; }));
    filterBar.appendChild(mkChip(`All (${allPhotos.length})`, activeFilter === null, () => {
      activeFilter = null; renderFilterBar(); renderGallery();
    }));
    LABELS.forEach(l => {
      const n = counts[l] || 0;
      if (!n && activeFilter !== l) return;
      filterBar.appendChild(mkChip(`${l} (${n})`, activeFilter === l, () => {
        activeFilter = l; renderFilterBar(); renderGallery();
      }));
    });
  }

  function renderUploadChips() {
    uploadChips.innerHTML = '';
    LABELS.forEach(l => {
      uploadChips.appendChild(mkChip(l, selectedLabels.has(l), () => {
        if (selectedLabels.has(l)) selectedLabels.delete(l);
        else selectedLabels.add(l);
        renderUploadChips();
      }));
    });
  }

  function renderGallery() {
    grid.innerHTML = '';
    const list = activeFilter
      ? allPhotos.filter(p => p.labels.includes(activeFilter))
      : allPhotos.slice();
    if (!list.length) {
      grid.innerHTML = '<p class="photo-empty">No photos yet.</p>';
      return;
    }
    const myEmail = ((JH.currentUser && JH.currentUser.email) || '').toLowerCase();
    list.forEach((photo, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'photo-wrap';

      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = 'Build photo';
      img.loading = 'lazy';
      img.onclick = () => openLightbox(list, idx);
      wrap.appendChild(img);

      if (photo.labels.length) {
        const badges = document.createElement('div');
        badges.className = 'photo-labels';
        photo.labels.forEach(l => {
          const b = document.createElement('span');
          b.className = 'label-badge';
          b.textContent = l;
          badges.appendChild(b);
        });
        wrap.appendChild(badges);
      }

      const uploader = (photo.uploadedBy || '').toLowerCase();
      const canEdit = JH.isAdmin() || uploader === myEmail || uploader === 'legacy';
      if (canEdit) {
        const actions = document.createElement('div');
        actions.className = 'photo-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'photo-btn photo-btn-edit';
        editBtn.type = 'button';
        editBtn.innerHTML = '&#9998;';
        editBtn.title = 'Edit labels';
        editBtn.onclick = (e) => { e.stopPropagation(); openEditModal(photo); };
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'photo-btn photo-btn-del';
        delBtn.type = 'button';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Delete';
        delBtn.onclick = (e) => { e.stopPropagation(); deletePhoto(photo.id); };
        actions.appendChild(delBtn);

        wrap.appendChild(actions);
      }

      grid.appendChild(wrap);
    });
  }

  async function loadPhotos() {
    const res = await JH.apiFetch('/api/inventory', { action: 'photo-list' });
    if (!res.ok) { console.error('Failed to load photos'); return; }
    const data = await res.json();
    allPhotos = (data.photos || []).reverse();
    renderFilterBar();
    renderGallery();
  }

  fileInput.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files).filter(f => f.size <= MAX_BYTES);
    const skipped = fileInput.files.length - selectedFiles.length;
    fileList.innerHTML = selectedFiles.map(f => `<span class="file-pill">${JH.esc(f.name)}</span>`).join('');
    if (skipped > 0) fileList.innerHTML += `<span class="file-skip">${skipped} file(s) skipped (> 10 MB)</span>`;
  });

  uploadBtn.addEventListener('click', async () => {
    if (!selectedFiles.length) { uploadStatus.textContent = 'Pick a file first.'; return; }
    uploadBtn.disabled = true;
    let ok = 0, fail = 0;
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      uploadStatus.textContent = `Uploading ${i + 1} / ${selectedFiles.length}…`;
      try {
        const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
        const ext = (extMatch ? extMatch[1] : 'jpg').toLowerCase();
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const up = await JH.supabase.storage.from(BUCKET).upload(key, file, {
          contentType: file.type || 'image/jpeg',
        });
        if (up.error) throw up.error;
        const pub = JH.supabase.storage.from(BUCKET).getPublicUrl(key);
        const publicUrl = pub.data && pub.data.publicUrl;
        if (!publicUrl) throw new Error('No public URL');
        const res = await JH.apiFetch('/api/inventory', {
          action: 'photo-add',
          url: publicUrl,
          labels: Array.from(selectedLabels),
        });
        if (!res.ok) throw new Error('API add failed');
        ok++;
      } catch (e) {
        console.error('Upload failed', e);
        fail++;
      }
    }
    uploadStatus.textContent = `${ok} uploaded` + (fail ? `, ${fail} failed` : '');
    uploadBtn.disabled = false;
    fileInput.value = '';
    selectedFiles = [];
    fileList.innerHTML = '';
    await loadPhotos();
  });

  async function deletePhoto(id) {
    if (!confirm('Delete this photo?')) return;
    const res = await JH.apiFetch('/api/inventory', { action: 'photo-delete', id });
    if (res.ok) await loadPhotos();
    else alert('Delete failed');
  }

  let editingPhoto = null;
  const editLabels = new Set();
  const editChipsEl = document.getElementById('edit-chips');
  const editModal = document.getElementById('edit-modal');
  const editImg = document.getElementById('edit-modal-img');
  const editSaveBtn = document.getElementById('edit-save-btn');

  function renderEditChips() {
    editChipsEl.innerHTML = '';
    LABELS.forEach(l => {
      editChipsEl.appendChild(mkChip(l, editLabels.has(l), () => {
        if (editLabels.has(l)) editLabels.delete(l);
        else editLabels.add(l);
        renderEditChips();
      }));
    });
  }

  function openEditModal(photo) {
    editingPhoto = photo;
    editLabels.clear();
    photo.labels.forEach(l => editLabels.add(l));
    editImg.src = photo.url;
    renderEditChips();
    editModal.classList.add('active');
  }

  window.closeEditModal = function() {
    editModal.classList.remove('active');
    editingPhoto = null;
  };

  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) window.closeEditModal();
  });

  editSaveBtn.addEventListener('click', async () => {
    if (!editingPhoto) return;
    editSaveBtn.disabled = true;
    const res = await JH.apiFetch('/api/inventory', {
      action: 'photo-update-labels',
      id: editingPhoto.id,
      labels: Array.from(editLabels),
    });
    editSaveBtn.disabled = false;
    if (res.ok) {
      window.closeEditModal();
      await loadPhotos();
    } else {
      alert('Save failed');
    }
  });

  let lbList = [];
  let lbIdx = 0;
  function openLightbox(list, idx) {
    lbList = list; lbIdx = idx;
    document.getElementById('lightbox-img').src = list[idx].url;
    document.getElementById('lightbox').classList.add('active');
  }
  window.closeLightbox = function() {
    document.getElementById('lightbox').classList.remove('active');
  };
  window.navPhoto = function(dir) {
    if (!lbList.length) return;
    lbIdx = ((lbIdx + dir) % lbList.length + lbList.length) % lbList.length;
    document.getElementById('lightbox-img').src = lbList[lbIdx].url;
  };
  document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('lightbox');
    if (!lb.classList.contains('active')) return;
    if (e.key === 'Escape') window.closeLightbox();
    if (e.key === 'ArrowLeft') window.navPhoto(-1);
    if (e.key === 'ArrowRight') window.navPhoto(1);
  });

  renderUploadChips();
  await loadPhotos();
})();
