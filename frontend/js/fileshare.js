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
              <td style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-sm" style="background:var(--surface);border:1px solid var(--border)" onclick="_fsPreview('${esc(f.id)}','${esc(f.display_name || f.filename)}','${esc(f.mime_type||'')}')">
                  👁 Preview
                </button>
                <button class="btn btn-sm btn-outline" onclick="_fsDownload('${esc(f.id)}','${esc(f.display_name || f.filename)}')">
                  ⬇ Download
                </button>
                ${isAdmin ? `<button class="btn btn-sm btn-danger-outline" onclick="_fsDelete('${esc(f.id)}')">Delete</button>` : ''}
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

window._fsPreview = (fileId, fileName, mimeType) => {
  const previewUrl = `${API}/files/${fileId}/preview`;
  const authUrl = previewUrl + '?token=' + encodeURIComponent(state.token || '');

  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:flex-start;overflow:auto;padding:20px`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');
  const isPdf   = mimeType === 'application/pdf';
  const isText  = mimeType.startsWith('text/') || mimeType === 'application/json';

  let content;
  const hdr = `<div style="width:100%;max-width:900px;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <span style="font-weight:600;color:#fff;font-size:.92rem">${esc(fileName)}</span>
    <div style="display:flex;gap:8px">
      <button onclick="_fsDownload('${esc(fileId)}','${esc(fileName)}')" style="padding:6px 14px;border-radius:6px;border:1px solid #555;background:#333;color:#fff;cursor:pointer;font-size:.8rem">⬇ Download</button>
      <button onclick="this.closest('[style]').remove()" style="padding:6px 14px;border-radius:6px;border:none;background:#555;color:#fff;cursor:pointer;font-size:.8rem">✕ Close</button>
    </div>
  </div>`;

  if (isPdf) {
    content = `<iframe src="${previewUrl}" style="width:100%;max-width:900px;height:80vh;border:none;border-radius:8px" title="${esc(fileName)}"></iframe>`;
  } else if (isImage) {
    content = `<img src="${previewUrl}" style="max-width:900px;max-height:80vh;border-radius:8px;object-fit:contain" alt="${esc(fileName)}">`;
  } else if (isVideo) {
    content = `<video controls style="width:100%;max-width:900px;max-height:80vh;border-radius:8px" src="${previewUrl}"></video>`;
  } else if (isAudio) {
    content = `<div style="padding:32px;background:#1a1a1a;border-radius:12px;max-width:500px;width:100%"><p style="color:#ccc;margin:0 0 16px;text-align:center">${esc(fileName)}</p><audio controls style="width:100%" src="${previewUrl}"></audio></div>`;
  } else if (isText) {
    // Fetch and show as code block
    content = `<div id="fs-text-preview" style="width:100%;max-width:900px;max-height:70vh;overflow:auto;background:#0d1117;border-radius:8px;padding:16px"><pre style="color:#e6edf3;font-size:.8rem;margin:0;white-space:pre-wrap">Loading...</pre></div>`;
    setTimeout(async () => {
      try {
        const r = await fetch(previewUrl, { headers: { Authorization: 'Bearer ' + (state.token||'') } });
        const txt = await r.text();
        const pre = modal.querySelector('#fs-text-preview pre');
        if (pre) pre.textContent = txt.slice(0, 100000); // cap at 100k chars
      } catch (e) {
        const pre = modal.querySelector('#fs-text-preview pre');
        if (pre) pre.textContent = 'Preview failed: ' + e.message;
      }
    }, 100);
  } else {
    content = `<div style="padding:40px;background:#1a1a1a;border-radius:12px;text-align:center;color:#ccc;max-width:400px">
      <p style="font-size:2rem;margin:0 0 12px">📄</p>
      <p style="margin:0 0 16px">${esc(fileName)}</p>
      <p style="font-size:.8rem;color:#888">Preview not available for this file type.</p>
    </div>`;
  }

  modal.innerHTML = hdr + content;
  document.body.appendChild(modal);
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

