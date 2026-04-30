let doubtView = 'list';
let doubtDetailId = null;
let doubtFilter = 'all';

async function renderDoubts() {
  const el = document.getElementById('page-content');
  if (doubtView === 'detail' && doubtDetailId) {
    await renderDoubtDetail(el, doubtDetailId);
    return;
  }
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading doubts...</span></div>';
  try {
    const u = state.user || {};
    const isFacultyOrAdmin = u.role === 'faculty' || u.role === 'admin';
    let endpoint = isFacultyOrAdmin ? '/doubts/all' : '/doubts/my';
    if (doubtFilter !== 'all') endpoint += '?status=' + doubtFilter;
    const data = await apiJson(endpoint);
    const doubts = data.doubts || [];

    el.innerHTML = `
      <div class="admin-header">
        <h2>Doubts & Questions</h2>
        <button class="btn btn-sm btn-primary" id="new-doubt-btn" style="width:auto;padding:8px 16px">+ Ask Question</button>
      </div>
      <div class="doubt-filters">
        <select id="doubt-filter-status">
          <option value="all" ${doubtFilter==='all'?'selected':''}>All Status</option>
          <option value="open" ${doubtFilter==='open'?'selected':''}>Open</option>
          <option value="answered" ${doubtFilter==='answered'?'selected':''}>Answered</option>
          <option value="closed" ${doubtFilter==='closed'?'selected':''}>Closed</option>
        </select>
      </div>
      ${doubts.length === 0 ? '<div class="empty-state"><p>No doubts found. Ask a question to get started!</p></div>' :
        doubts.map(d => `
          <div class="doubt-card" data-doubt-id="${d.id}">
            <div class="doubt-card-header">
              <span class="doubt-title">${esc(d.title)}</span>
              <span class="doubt-status ${d.status}">${esc(d.status)}</span>
            </div>
            <div class="doubt-meta">
              <span>${esc(d.department || '')}${d.subject ? ' &middot; ' + esc(d.subject) : ''}</span>
              <span>${d.is_anonymous ? 'Anonymous' : esc(d.student_name || '')}</span>
              <span>${timeAgo(d.created_at)}</span>
              ${d.reply_count ? '<span>' + d.reply_count + ' replies</span>' : ''}
            </div>
            <div class="doubt-body-preview">${esc((d.body || '').slice(0, 200))}</div>
          </div>
        `).join('')}`;

    document.getElementById('doubt-filter-status').onchange = (e) => { doubtFilter = e.target.value; renderDoubts(); };
    el.querySelectorAll('.doubt-card').forEach(card => {
      card.onclick = () => { doubtDetailId = card.dataset.doubtId; doubtView = 'detail'; renderDoubts(); };
    });
    document.getElementById('new-doubt-btn').onclick = showNewDoubtModal;
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

async function renderDoubtDetail(el, id) {
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>';
  try {
    const data = await apiJson('/doubts/' + id);
    const d = data.doubt || data;
    const replies = data.replies || [];
    const u = state.user || {};
    const canReply = u.role === 'faculty' || u.role === 'admin' || u.id === d.student_id;
    el.innerHTML = `
      <div class="doubt-detail-panel">
        <button class="btn btn-sm btn-outline" id="doubt-back" style="margin-bottom:16px">† Back to list</button>
        <div class="doubt-card-header">
          <span class="doubt-title" style="font-size:1.1rem">${esc(d.title)}</span>
          <span class="doubt-status ${d.status}">${esc(d.status)}</span>
        </div>
        <div class="doubt-meta" style="margin:8px 0 16px">
          <span>${esc(d.department || '')}${d.subject ? ' &middot; ' + esc(d.subject) : ''}</span>
          <span>${d.is_anonymous ? 'Anonymous' : esc(d.student_name || '')}</span>
          <span>${timeAgo(d.created_at)}</span>
        </div>
        <div style="font-size:.9rem;line-height:1.7;padding:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius)">${formatMd(d.body || '')}</div>
        <div class="doubt-replies">
          <h3 style="font-size:.9rem;font-weight:700;margin-bottom:12px">Replies (${replies.length})</h3>
          ${replies.length === 0 ? '<div class="empty-state"><p>No replies yet</p></div>' :
            replies.map(r => `
              <div class="doubt-reply">
                <div class="reply-author">${esc(r.author_name || 'Unknown')} <span class="badge badge-${r.author_role || 'student'}">${esc(r.author_role || '')}</span></div>
                <div class="reply-body">${formatMd(r.body || '')}</div>
                <div class="reply-time">${timeAgo(r.created_at)}</div>
              </div>
            `).join('')}
          ${canReply ? `
          <div class="doubt-compose">
            <textarea id="doubt-reply-text" placeholder="Write your reply..." rows="3"></textarea>
            <button class="btn btn-sm btn-primary" id="doubt-reply-btn" style="width:auto;padding:8px 20px;margin-top:8px">Send Reply</button>
          </div>` : ''}
        </div>
      </div>`;

    document.getElementById('doubt-back').onclick = () => { doubtView = 'list'; doubtDetailId = null; renderDoubts(); };
    const replyBtn = document.getElementById('doubt-reply-btn');
    if (replyBtn) {
      replyBtn.onclick = async () => {
        const text = document.getElementById('doubt-reply-text').value.trim();
        if (!text) return;
        try {
          await api('/doubts/' + id + '/reply', { method: 'POST', body: JSON.stringify({ body: text }) });
          renderDoubtDetail(el, id);
        } catch (ex) { alert('Failed: ' + ex.message); }
      };
    }
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

function showNewDoubtModal() {
  const u = state.user || {};
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Ask a Question</h3>
      <div class="field"><label>Title</label><input type="text" id="dbt-title" placeholder="Brief title for your question"></div>
      <div class="field"><label>Department</label>
        <select id="dbt-dept"><option>CSE</option><option>ECE</option><option>ME</option><option>CE</option><option>EE</option><option>Other</option></select>
      </div>
      <div class="field"><label>Subject (optional)</label><input type="text" id="dbt-subject" placeholder="e.g. Data Structures"></div>
      <div class="field"><label>Your Question</label><textarea id="dbt-body" rows="5" placeholder="Describe your doubt in detail..."></textarea></div>
      <div class="field"><label><input type="checkbox" id="dbt-anon" style="width:auto;margin-right:6px">Post anonymously</label></div>
      <div id="dbt-error" style="color:var(--danger);font-size:.85rem;min-height:20px"></div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-outline" id="dbt-cancel">Cancel</button>
        <button class="btn btn-sm btn-primary" id="dbt-submit" style="width:auto;padding:8px 20px">Submit</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#dbt-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#dbt-submit').onclick = async () => {
    const err = overlay.querySelector('#dbt-error');
    err.textContent = '';
    const body = {
      title: overlay.querySelector('#dbt-title').value.trim(),
      body: overlay.querySelector('#dbt-body').value.trim(),
      department: overlay.querySelector('#dbt-dept').value,
      subject: overlay.querySelector('#dbt-subject').value.trim() || null,
      is_anonymous: overlay.querySelector('#dbt-anon').checked,
    };
    if (!body.title || !body.body) { err.textContent = 'Title and question are required'; return; }
    try {
      const r = await api('/doubts', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json(); err.textContent = d.detail?.message || 'Failed'; return; }
      overlay.remove();
      renderDoubts();
    } catch (ex) { err.textContent = ex.message; }
  };
}

/* 
   ATTENDANCE PAGE "" Student Mark / Faculty+Admin Manage
    */
