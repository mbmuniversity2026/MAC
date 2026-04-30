async function renderCopyCheck() {
  const el = document.getElementById('page-content');
  el.className = 'page';
  const u = state.user || {};
  if (u.role === 'student') {
    el.innerHTML = `<div class="empty-state" style="padding:60px 20px;text-align:center">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted-text)" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <p style="margin-top:12px;color:var(--muted-text)">Copy Check is for faculty and administrators only.</p>
    </div>`;
    return;
  }
  if (ccView === 'detail' && ccSessionId) {
    await renderCopyCheckDetail(el);
  } else {
    await renderCopyCheckList(el);
  }
}

async function renderCopyCheckList(el) {
  el.innerHTML = `<div class="admin-header">
    <div><h2>Copy Check</h2><p class="muted" style="margin:0">AI vision answer-sheet marking + plagiarism detection</p></div>
    <button class="btn btn-primary" id="cc-new-session-btn" style="width:auto;padding:8px 18px">+ New Session</button>
  </div>
  <div id="cc-sessions-list"><div class="loading-state"><div class="spinner"></div><span>Loading sessions"¦</span></div></div>`;

  document.getElementById('cc-new-session-btn').onclick = showNewCCSessionModal;
  await loadCCSessions();
}

async function loadCCSessions() {
  const listEl = document.getElementById('cc-sessions-list');
  if (!listEl) return;
  try {
    const data = await apiJson('/copy-check/sessions?per_page=50');
    const sessions = data.sessions || [];
    if (sessions.length === 0) {
      listEl.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted-text)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p style="color:var(--muted-text);margin-top:12px">No sessions yet. Create one to start marking.</p>
      </div>`;
      return;
    }
    listEl.innerHTML = sessions.map(s => {
      const statusColor = {active:'var(--accent)',evaluating:'var(--warning,#e6a817)',done:'#22c55e',archived:'var(--muted-text)'}[s.status] || '#888';
      const progress = s.sheet_count > 0 ? Math.round((s.evaluated_count / s.sheet_count) * 100) : 0;
      return `<div class="cc-session-card" data-id="${s.id}">
        <div class="cc-session-info">
          <div class="cc-session-subject">${esc(s.subject)}</div>
          <div class="cc-session-meta">
            <span>${esc(s.class_name || '')}</span>
            <span class="dot">&middot;</span>
            <span>${esc(s.department)}</span>
            <span class="dot">&middot;</span>
            <span>Total: ${s.total_marks} marks</span>
            <span class="dot">&middot;</span>
            <span>${timeAgo(s.created_at)}</span>
          </div>
          ${s.sheet_count > 0 ? `<div class="cc-progress-bar" title="${s.evaluated_count}/${s.sheet_count} evaluated">
            <div class="cc-progress-fill" style="width:${progress}%;background:${statusColor}"></div>
            <span class="cc-progress-label">${s.evaluated_count}/${s.sheet_count} evaluated</span>
          </div>` : ''}
        </div>
        <div class="cc-session-right">
          <span class="badge" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40">${s.status}</span>
          ${s.plagiarism_run ? '<span class="badge badge-purple" style="margin-left:4px">plagiarism checked</span>' : ''}
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.cc-session-card').forEach(card => {
      card.onclick = () => { ccSessionId = card.dataset.id; ccView = 'detail'; renderCopyCheck(); };
    });
  } catch(ex) {
    listEl.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`;
  }
}

function showNewCCSessionModal() {
  showModal({
    title: 'New Copy Check Session',
    body: `
      <div class="form-group"><label>Subject / Exam Name</label>
        <input id="cc-sub" class="form-input" placeholder="e.g. DSA Mid-Term Nov 2025" required></div>
      <div class="form-group"><label>Class / Batch</label>
        <input id="cc-class" class="form-input" placeholder="e.g. 3A, 2023 Batch"></div>
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>Department</label>
          <select id="cc-dept" class="form-input">
            <option>CSE</option><option>ECE</option><option>ME</option><option>CE</option>
            <option>EEE</option><option>IT</option><option>ALL</option>
          </select></div>
        <div class="form-group" style="flex:1"><label>Total Marks</label>
          <input id="cc-marks" class="form-input" type="number" value="100" min="1" max="1000"></div>
      </div>
      <div class="form-group"><label>Syllabus / Exam Paper Context <span class="muted">(optional "" helps AI grade accurately)</span></label>
        <textarea id="cc-syllabus" class="form-input" rows="4" placeholder="Paste questions, topics, or model answers here"¦" style="resize:vertical"></textarea></div>
      <div id="cc-modal-err" class="error-banner" style="display:none"></div>`,
    confirmText: 'Create Session',
    onConfirm: async () => {
      const subject = document.getElementById('cc-sub').value.trim();
      if (!subject) { document.getElementById('cc-modal-err').textContent = 'Subject is required.'; document.getElementById('cc-modal-err').style.display='block'; return false; }
      const fd = new FormData();
      fd.append('subject', subject);
      fd.append('class_name', document.getElementById('cc-class').value.trim());
      fd.append('department', document.getElementById('cc-dept').value);
      fd.append('total_marks', document.getElementById('cc-marks').value);
      fd.append('syllabus_text', document.getElementById('cc-syllabus').value.trim());
      const res = await api('/copy-check/sessions', { method: 'POST', body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const errMsg = Array.isArray(d.detail)
          ? d.detail.map(e => e.msg || JSON.stringify(e)).join('; ')
          : (typeof d.detail === 'string' ? d.detail : (d.detail?.message || JSON.stringify(d.detail || 'Failed')));
        document.getElementById('cc-modal-err').textContent = errMsg || 'Failed to create session.';
        document.getElementById('cc-modal-err').style.display = 'block';
        return false;
      }
      const sess = await res.json();
      ccSessionId = sess.id;
      ccView = 'detail';
      closeModal();
      renderCopyCheck();
    },
  });
}

async function renderCopyCheckDetail(el) {
  el.innerHTML = `<div class="cc-detail-nav">
    <button class="btn btn-sm btn-outline" id="cc-back-btn">† All Sessions</button>
    <div id="cc-detail-title" style="font-weight:600;font-size:1.1rem;padding-left:8px">Loading"¦</div>
  </div>
  <div id="cc-detail-body"><div class="loading-state"><div class="spinner"></div><span>Loading session"¦</span></div></div>`;

  document.getElementById('cc-back-btn').onclick = () => {
    ccView = 'list'; ccSessionId = null;
    if (ccEvalTimer) { clearInterval(ccEvalTimer); ccEvalTimer = null; }
    renderCopyCheck();
  };
  await loadCCDetail();
}

async function loadCCDetail() {
  const bodyEl = document.getElementById('cc-detail-body');
  if (!bodyEl) return;
  try {
    const [sess, studentsData] = await Promise.all([
      apiJson(`/copy-check/sessions/${ccSessionId}`),
      apiJson(`/copy-check/sessions/${ccSessionId}/students`),
    ]);
    const titleEl = document.getElementById('cc-detail-title');
    if (titleEl) titleEl.textContent = `${sess.subject} "" ${sess.class_name || ''} ${sess.department}`;

    const sheets = sess.sheets || [];
    const sheetMap = {};
    sheets.forEach(s => { sheetMap[s.student_roll] = s; });
    const students = studentsData.students || [];
    const plagiarism = sess.plagiarism || [];

    const progress = sheets.length > 0 ? Math.round((sess.evaluated_count / sess.sheet_count) * 100) : 0;
    const canEvaluate = sheets.some(s => s.status === 'uploaded' || s.status === 'error');
    const canPlagiarism = sheets.filter(s => s.status === 'done').length >= 2;

    bodyEl.innerHTML = `
      <!-- Session Stats Bar -->
      <div class="cc-stats-bar">
        <div class="cc-stat"><span class="cc-stat-num">${sess.total_marks}</span><span class="cc-stat-label">Total Marks</span></div>
        <div class="cc-stat"><span class="cc-stat-num">${sess.sheet_count}</span><span class="cc-stat-label">Uploaded</span></div>
        <div class="cc-stat"><span class="cc-stat-num">${sess.evaluated_count}</span><span class="cc-stat-label">Evaluated</span></div>
        <div class="cc-stat"><span class="cc-stat-num" style="color:${sess.status==='done'?'#22c55e':'var(--accent)'}">${sess.status}</span><span class="cc-stat-label">Status</span></div>
      </div>

      <!-- Action Buttons -->
      <div class="cc-action-bar">
        ${canEvaluate ? `<button class="btn btn-primary" id="cc-eval-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Evaluate All Sheets
        </button>` : ''}
        ${canPlagiarism ? `<button class="btn btn-outline" id="cc-plg-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Check Plagiarism
        </button>` : ''}
        ${sess.evaluated_count > 0 ? `<a class="btn btn-outline" href="${window.location.origin}/api/v1/copy-check/sessions/${ccSessionId}/report/pdf" target="_blank">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          Download Report PDF
        </a>` : ''}
      </div>

      ${sess.status === 'evaluating' ? `<div class="cc-eval-progress" id="cc-eval-progress-bar">
        <div class="cc-eval-bar-fill" style="width:${progress}%"></div>
        <span class="cc-eval-bar-label">Evaluating"¦ ${sess.evaluated_count}/${sess.sheet_count}</span>
      </div>` : ''}

      <!-- Students Table -->
      <div class="cc-section">
        <h3 class="cc-section-title">Students</h3>
        <div class="cc-students-grid">
          ${students.length === 0 ? `<p class="muted" style="padding:20px">No registered students found for ${esc(sess.department)}. Upload sheets manually below.</p>` : ''}
          ${students.map(st => {
            const sheet = sheetMap[st.roll_number];
            const statusLabel = sheet ? sheet.status : 'not uploaded';
            const statusColor = {done:'#22c55e',evaluating:'var(--warning,#e6a817)',uploaded:'var(--accent)',error:'#ef4444','not uploaded':'#aaa'}[statusLabel] || '#aaa';
            return `<div class="cc-student-row">
              <div class="cc-student-info">
                <span class="cc-student-name">${esc(st.name)}</span>
                <span class="cc-student-roll muted">${esc(st.roll_number)}</span>
              </div>
              ${sheet && sheet.ai_marks !== null ? `<span class="cc-marks-badge">${sheet.ai_marks}/${sess.total_marks}</span>` : ''}
              <span class="cc-status-dot" style="background:${statusColor}" title="${statusLabel}"></span>
              <label class="btn btn-sm btn-outline cc-upload-label" title="Upload sheet for ${esc(st.name)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                ${sheet ? 'Re-upload' : 'Upload'}
                <input type="file" class="cc-sheet-input" data-roll="${esc(st.roll_number)}" accept="image/*,.pdf" style="display:none">
              </label>
            </div>`;
          }).join('')}
        </div>
        <!-- Unregistered sheet upload -->
        <details class="cc-manual-upload">
          <summary class="btn btn-sm btn-ghost" style="cursor:pointer;margin-top:12px">+ Upload for unlisted student</summary>
          <div class="cc-manual-form" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <input id="cc-manual-roll" class="form-input" placeholder="Roll number" style="width:150px">
            <input id="cc-manual-file-btn" type="file" accept="image/*,.pdf" style="display:none" id="cc-manual-file-input">
            <label class="btn btn-sm btn-outline" for="cc-manual-file-input">Choose file</label>
            <span id="cc-manual-file-name" class="muted" style="align-self:center;font-size:.8rem">No file chosen</span>
            <button class="btn btn-sm btn-primary" id="cc-manual-upload-btn">Upload</button>
          </div>
        </details>
      </div>

      <!-- Marks Results Table -->
      ${sheets.filter(s => s.ai_marks !== null).length > 0 ? `
      <div class="cc-section">
        <h3 class="cc-section-title">Marks</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Roll No.</th><th>Name</th><th>Marks</th><th>Out of</th><th>%</th><th>Feedback</th></tr></thead>
            <tbody>
              ${sheets.filter(s => s.ai_marks !== null).sort((a,b) => (b.ai_marks||0) - (a.ai_marks||0)).map(s => `
                <tr>
                  <td class="mono">${esc(s.student_roll)}</td>
                  <td>${esc(s.student_name)}</td>
                  <td><strong>${s.ai_marks}</strong></td>
                  <td class="muted">${sess.total_marks}</td>
                  <td>${Math.round((s.ai_marks / sess.total_marks) * 100)}%</td>
                  <td style="max-width:300px;font-size:.8rem;color:var(--muted-text)">${esc((s.ai_feedback || '').slice(0, 120))}${s.ai_feedback && s.ai_feedback.length > 120 ? '"¦' : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      <!-- Plagiarism Results -->
      ${plagiarism.length > 0 ? `
      <div class="cc-section">
        <h3 class="cc-section-title">Plagiarism Report
          <span class="badge badge-danger" style="margin-left:8px">${plagiarism.filter(p=>p.verdict==='confirmed').length} confirmed</span>
          <span class="badge badge-warn" style="margin-left:4px">${plagiarism.filter(p=>p.verdict==='suspected').length} suspected</span>
        </h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Student A</th><th>Student B</th><th>Similarity</th><th>Verdict</th></tr></thead>
            <tbody>
              ${plagiarism.filter(p => p.verdict !== 'unlikely').sort((a,b) => b.similarity_score - a.similarity_score).map(p => {
                const vc = {confirmed:'#ef4444',suspected:'#f97316',unlikely:'#22c55e'}[p.verdict]||'#888';
                return `<tr>
                  <td class="mono">${esc(p.roll_a)}</td>
                  <td class="mono">${esc(p.roll_b)}</td>
                  <td><strong>${p.similarity_pct}%</strong></td>
                  <td><span class="badge" style="background:${vc}20;color:${vc};border:1px solid ${vc}40">${p.verdict}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    `;

    // Bind evaluate button
    const evalBtn = document.getElementById('cc-eval-btn');
    if (evalBtn) {
      evalBtn.onclick = async () => {
        evalBtn.disabled = true;
        evalBtn.textContent = 'Starting"¦';
        try {
          const r = await api(`/copy-check/sessions/${ccSessionId}/evaluate`, { method: 'POST' });
          if (!r.ok) { const d = await r.json(); showToast(d.detail || 'Failed', 'error'); evalBtn.disabled = false; return; }
          showToast('Evaluation started!', 'success');
          // Poll every 4 seconds until done
          if (ccEvalTimer) clearInterval(ccEvalTimer);
          ccEvalTimer = setInterval(async () => {
            const fresh = await apiJson(`/copy-check/sessions/${ccSessionId}`).catch(() => null);
            if (!fresh) return;
            const pb = document.getElementById('cc-eval-progress-bar');
            if (pb) {
              const pct = fresh.sheet_count > 0 ? Math.round((fresh.evaluated_count / fresh.sheet_count) * 100) : 0;
              const fill = pb.querySelector('.cc-eval-bar-fill');
              const label = pb.querySelector('.cc-eval-bar-label');
              if (fill) fill.style.width = pct + '%';
              if (label) label.textContent = `Evaluating"¦ ${fresh.evaluated_count}/${fresh.sheet_count}`;
            }
            if (fresh.status === 'done' || (fresh.evaluated_count >= fresh.sheet_count && fresh.sheet_count > 0)) {
              clearInterval(ccEvalTimer); ccEvalTimer = null;
              showToast('Evaluation complete!', 'success');
              await loadCCDetail();
            }
          }, 4000);
        } catch(ex) { showToast(ex.message, 'error'); evalBtn.disabled = false; }
      };
    }

    // Bind plagiarism button
    const plgBtn = document.getElementById('cc-plg-btn');
    if (plgBtn) {
      plgBtn.onclick = async () => {
        plgBtn.disabled = true;
        plgBtn.textContent = 'Checking"¦';
        try {
          const r = await api(`/copy-check/sessions/${ccSessionId}/plagiarism`, { method: 'POST' });
          if (!r.ok) { const d = await r.json(); showToast(d.detail || 'Failed', 'error'); plgBtn.disabled = false; return; }
          const d = await r.json();
          showToast(`Plagiarism check done. ${d.confirmed} confirmed, ${d.suspected} suspected.`, 'success');
          await loadCCDetail();
        } catch(ex) { showToast(ex.message, 'error'); plgBtn.disabled = false; }
      };
    }

    // Bind individual sheet upload inputs
    bodyEl.querySelectorAll('.cc-sheet-input').forEach(input => {
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const roll = input.dataset.roll;
        const label = input.closest('label');
        label.textContent = 'Uploading"¦';
        label.style.opacity = '0.6';
        const fd = new FormData();
        fd.append('student_roll', roll);
        fd.append('file', file);
        try {
          const r = await api(`/copy-check/sessions/${ccSessionId}/sheets`, { method: 'POST', body: fd });
          if (!r.ok) { const d = await r.json(); showToast(d.detail || 'Upload failed', 'error'); label.textContent = 'Upload'; label.style.opacity = '1'; return; }
          showToast(`Sheet uploaded for ${roll}`, 'success');
          await loadCCDetail();
        } catch(ex) { showToast(ex.message, 'error'); label.textContent = 'Upload'; label.style.opacity = '1'; }
        input.value = '';
      };
    });

    // Bind manual upload
    const manualFileInput = document.getElementById('cc-manual-file-input');
    const manualFileName = document.getElementById('cc-manual-file-name');
    if (manualFileInput) {
      manualFileInput.onchange = () => {
        manualFileName.textContent = manualFileInput.files[0]?.name || 'No file chosen';
      };
    }
    const manualBtn = document.getElementById('cc-manual-upload-btn');
    if (manualBtn) {
      manualBtn.onclick = async () => {
        const roll = document.getElementById('cc-manual-roll').value.trim();
        const file = manualFileInput?.files[0];
        if (!roll) { showToast('Enter roll number', 'error'); return; }
        if (!file) { showToast('Choose a file', 'error'); return; }
        manualBtn.disabled = true;
        const fd = new FormData();
        fd.append('student_roll', roll);
        fd.append('file', file);
        try {
          const r = await api(`/copy-check/sessions/${ccSessionId}/sheets`, { method: 'POST', body: fd });
          if (!r.ok) { const d = await r.json(); showToast(d.detail || 'Upload failed', 'error'); manualBtn.disabled = false; return; }
          showToast('Sheet uploaded!', 'success');
          await loadCCDetail();
        } catch(ex) { showToast(ex.message, 'error'); manualBtn.disabled = false; }
        if (manualFileInput) manualFileInput.value = '';
        if (manualFileName) manualFileName.textContent = 'No file chosen';
        document.getElementById('cc-manual-roll').value = '';
        manualBtn.disabled = false;
      };
    }

    // Auto-start polling if session is currently evaluating
    if (sess.status === 'evaluating' && !ccEvalTimer) {
      ccEvalTimer = setInterval(async () => {
        const fresh = await apiJson(`/copy-check/sessions/${ccSessionId}`).catch(() => null);
        if (!fresh) return;
        const pb = document.getElementById('cc-eval-progress-bar');
        if (pb) {
          const pct = fresh.sheet_count > 0 ? Math.round((fresh.evaluated_count / fresh.sheet_count) * 100) : 0;
          const fill = pb.querySelector('.cc-eval-bar-fill');
          const label = pb.querySelector('.cc-eval-bar-label');
          if (fill) fill.style.width = pct + '%';
          if (label) label.textContent = `Evaluating"¦ ${fresh.evaluated_count}/${fresh.sheet_count}`;
        }
        if (fresh.status === 'done' || (fresh.evaluated_count >= fresh.sheet_count && fresh.sheet_count > 0)) {
          clearInterval(ccEvalTimer); ccEvalTimer = null;
          await loadCCDetail();
        }
      }, 4000);
    }
  } catch(ex) {
    bodyEl.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`;
  }
}

/* 
   SHARED FILES "" Admin uploads, all roles download
    */
