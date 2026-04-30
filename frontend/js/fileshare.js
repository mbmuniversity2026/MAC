async function renderFileShare() {
  const el = document.getElementById('page-content');
  el.className = 'page';
  const isAdmin = state.user?.role === 'admin';

  el.innerHTML = `
    <div class="admin-header">
      <div>
        <h2>Shared Files</h2>
        <p class="muted" style="margin:0">Files shared by administrators for download.</p>
      </div>
      ${isAdmin ? `<div>
        <input type="file" id="fs-upload-input" style="display:none" multiple>
        <button class="btn btn-primary" id="fs-upload-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload File
        </button>
      </div>` : ''}
    </div>
    <div id="fs-list"><div class="loading-state"><div class="spinner"></div><span>Loading"¦</span></div></div>`;

  if (isAdmin) {
    const uploadBtn = document.getElementById('fs-upload-btn');
    const uploadInput = document.getElementById('fs-upload-input');
    uploadBtn.onclick = () => uploadInput.click();
    uploadInput.onchange = async (e) => {
      const files = Array.from(e.target.files);
      uploadInput.value = '';
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const displayParam = encodeURIComponent(file.name);
        try {
          await api(`/files/upload?display_name=${displayParam}`, { method: 'POST', body: fd });
          showToast(`Uploaded: ${file.name}`, 'success');
        } catch { showToast(`Failed: ${file.name}`, 'error'); }
      }
      await _loadFileList();
    };
  }

  await _loadFileList();

  // Auto-refresh file list every 15 seconds for real-time updates
  if (window._fsRefreshIv) clearInterval(window._fsRefreshIv);
  window._fsRefreshIv = setInterval(() => {
    if (state.page === 'fileshare') _loadFileList();
    else { clearInterval(window._fsRefreshIv); window._fsRefreshIv = null; }
  }, 15000);

  async function _loadFileList() {
    const listEl = document.getElementById('fs-list');
    if (!listEl) return;
    try {
      const data = await apiJson('/files');
      const files = Array.isArray(data) ? data : (data.files || []);
      if (!files.length) {
        listEl.innerHTML = '<div class="empty-state">No shared files yet.</div>';
        return;
      }
      listEl.innerHTML = `<table class="data-table">
        <thead><tr><th>File</th><th>Size</th><th>Shared</th><th>Downloads</th><th></th></tr></thead>
        <tbody>
          ${files.map(f => `
            <tr>
              <td>
                <div style="font-weight:600;font-size:.88rem">${esc(f.display_name || f.filename)}</div>
                <div style="font-size:.72rem;color:var(--muted)">${esc(f.mime_type || '')}</div>
              </td>
              <td style="font-size:.82rem">${fmtBytes(f.size_bytes || 0)}</td>
              <td style="font-size:.78rem;color:var(--muted)">${timeAgo(f.created_at)}</td>
              <td style="font-size:.82rem">${f.download_count || 0}</td>
              <td>
                <button class="btn btn-sm btn-outline" onclick="_fsDownload('${esc(f.id)}','${esc(f.display_name || f.filename)}')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download
                </button>
                ${isAdmin ? `<button class="btn btn-sm btn-danger-outline" style="margin-left:4px" onclick="_fsDelete('${esc(f.id)}')">Delete</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    } catch (e) {
      listEl.innerHTML = `<div class="error-state">Failed to load files: ${esc(String(e))}</div>`;
    }
  }
}

window._fsDownload = async (fileId, fileName) => {
  try {
    const r = await api(`/files/${fileId}/download`);
    if (!r.ok) { showToast('Download failed', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  } catch { showToast('Download failed', 'error'); }
};

window._fsDelete = async (fileId) => {
  if (!confirm('Delete this shared file?')) return;
  try {
    await api(`/files/${fileId}`, { method: 'DELETE' });
    showToast('File deleted', 'success');
    renderFileShare();
  } catch { showToast('Delete failed', 'error'); }
};

function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* 
   NOTEBOOKS "" Full IDE (Colab-style)
    */

