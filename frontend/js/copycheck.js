async function renderCopyCheck() {
  const el = document.getElementById('page-content');
  el.className = 'page';
  const u = state.user || {};
  if (u.role === 'student') {
    await renderStudentResults(el);
    return;
  }
  if (ccView === 'detail' && ccSessionId) {
    await renderCopyCheckDetail(el);
  } else {
    await renderCopyCheckList(el);
  }
}

async function renderStudentResults(el) {
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading your results…</span></div>';
  try {
    const data = await apiJson('/copy-check/my-results');
    const results = data.results || [];
    if (results.length === 0) {
      el.innerHTML = `<div class="empty-state" style="padding:60px 20px;text-align:center">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
        <p style="margin-top:14px;color:var(--muted);font-size:.95rem">No evaluated results yet.</p>
        <p style="color:var(--muted);font-size:.82rem;margin-top:6px">You will receive a notification when your answer sheets are checked.</p>
      </div>`;
      return;
    }
    el.innerHTML = `
      <div class="admin-header"><div><h2>My Results</h2><p class="muted" style="margin:0">Your evaluated answer sheets</p></div></div>
      <div class="cc-sessions-list">
        ${results.map(r => {
          const pctColor = r.pct >= 75 ? '#22c55e' : r.pct >= 50 ? 'var(--accent)' : '#ef4444';
          const grade = r.pct >= 90 ? 'A+' : r.pct >= 75 ? 'A' : r.pct >= 60 ? 'B' : r.pct >= 50 ? 'C' : r.pct >= 40 ? 'D' : 'F';
          return `<div class="cc-session-card" style="cursor:default">
            <div class="cc-session-info">
              <div class="cc-session-subject">${esc(r.subject)}</div>
              <div class="cc-session-meta">
                <span>${esc(r.class_name || '')}</span>
                <span class="dot">&middot;</span>
                <span>${esc(r.department)}</span>
                <span class="dot">&middot;</span>
                <span>${r.evaluated_at ? timeAgo(r.evaluated_at) : ''}</span>
              </div>
              ${r.ai_feedback ? `<div style="margin-top:10px;font-size:.82rem;color:var(--fg-secondary);line-height:1.7;background:var(--bg-secondary);padding:10px 14px;border-radius:8px;border:1px solid var(--border)">${esc(r.ai_feedback)}</div>` : ''}
            </div>
            <div class="cc-session-right" style="flex-direction:column;align-items:flex-end;gap:4px">
              <div style="font-size:1.6rem;font-weight:900;color:${pctColor};font-family:'Courier New',monospace">${r.ai_marks}/${r.total_marks}</div>
              <div style="font-size:.85rem;color:${pctColor};font-weight:700">${r.pct}% &nbsp; Grade ${grade}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  } catch(ex) {
    el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`;
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
              <button class="btn btn-sm btn-outline" onclick="openCCScan('${ccSessionId}','${esc(st.roll_number)}')" title="Scan pages with camera">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
                Scan
              </button>
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
   SCAN MODE "" Adobe Scan-like continuous capture → PDF → upload
    */

let _ccScanRoll = null;
let _ccScanPages = []; // array of base64 JPEG strings
let _ccScanStream = null;

function showCCScanModal(sessionId, rollNumber) {
  _ccScanRoll = rollNumber;
  _ccScanPages = [];

  const modal = document.createElement('div');
  modal.id = 'cc-scan-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;';
  modal.innerHTML = `
    <div style="position:absolute;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:linear-gradient(to bottom,rgba(0,0,0,.75) 0%,transparent 100%);">
      <button id="cc-scan-close" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;font-size:.85rem;cursor:pointer;">✕ Cancel</button>
      <div style="color:#fff;font-weight:600;font-size:.9rem;">Scan Answer Sheet</div>
      <div id="cc-scan-count" style="background:var(--accent);color:#fff;padding:5px 12px;border-radius:999px;font-size:.8rem;font-weight:700;">0 pages</div>
    </div>
    <video id="cc-scan-video" autoplay playsinline muted style="flex:1;object-fit:cover;width:100%;height:100%;"></video>
    <!-- Scan guide overlay -->
    <div style="position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;">
      <div id="cc-scan-guide" style="width:min(85vw,380px);aspect-ratio:210/297;border:2px solid rgba(255,255,255,.5);border-radius:6px;box-shadow:0 0 0 9999px rgba(0,0,0,.35);"></div>
    </div>
    <!-- Bottom controls -->
    <div style="position:absolute;bottom:0;left:0;right:0;padding:20px 24px 36px;background:linear-gradient(to top,rgba(0,0,0,.8) 0%,transparent 100%);display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div id="cc-scan-thumbs" style="display:flex;gap:6px;overflow-x:auto;flex:1;"></div>
      <button id="cc-scan-capture" style="width:68px;height:68px;border-radius:50%;background:#fff;border:4px solid var(--accent);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2703A" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="#C2703A"/></svg>
      </button>
      <button id="cc-scan-done" style="background:var(--accent);color:#fff;border:none;padding:12px 22px;border-radius:12px;font-size:.9rem;font-weight:700;cursor:pointer;flex-shrink:0;opacity:.5;pointer-events:none;">Done</button>
    </div>
    <canvas id="cc-scan-canvas" style="display:none"></canvas>
  `;
  document.body.appendChild(modal);

  const video = document.getElementById('cc-scan-video');
  const captureBtn = document.getElementById('cc-scan-capture');
  const doneBtn = document.getElementById('cc-scan-done');
  const countEl = document.getElementById('cc-scan-count');
  const thumbsEl = document.getElementById('cc-scan-thumbs');
  const canvas = document.getElementById('cc-scan-canvas');
  const closeBtn = document.getElementById('cc-scan-close');

  // Start camera
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    .then(stream => {
      _ccScanStream = stream;
      video.srcObject = stream;
    })
    .catch(() => {
      showToast('Camera not available. Use file upload instead.', 'error');
      _closeCCScan();
    });

  function _addThumb(dataUrl) {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'width:40px;height:56px;object-fit:cover;border-radius:4px;border:2px solid var(--accent);flex-shrink:0;';
    thumbsEl.appendChild(img);
    thumbsEl.scrollLeft = thumbsEl.scrollWidth;
  }

  captureBtn.onclick = () => {
    // Flash effect
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:.7;pointer-events:none;z-index:20;transition:opacity .3s';
    modal.appendChild(flash);
    setTimeout(() => { flash.style.opacity = '0'; setTimeout(() => flash.remove(), 320); }, 50);

    // Capture frame from video
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    _ccScanPages.push(dataUrl);
    _addThumb(dataUrl);
    countEl.textContent = _ccScanPages.length + ' page' + (_ccScanPages.length !== 1 ? 's' : '');
    doneBtn.style.opacity = '1';
    doneBtn.style.pointerEvents = 'auto';
  };

  doneBtn.onclick = async () => {
    if (_ccScanPages.length === 0) return;
    doneBtn.disabled = true;
    doneBtn.textContent = 'Processing…';
    try {
      const pdf = await _buildScanPdf(_ccScanPages);
      _closeCCScan();
      // Upload PDF to session
      const fd = new FormData();
      fd.append('student_roll', _ccScanRoll || 'scan-' + Date.now());
      fd.append('file', pdf, (_ccScanRoll || 'scan') + '_answersheet.pdf');
      const r = await api(`/copy-check/sessions/${sessionId}/sheets`, { method: 'POST', body: fd });
      if (!r.ok) { const d = await r.json(); showToast(d.detail || 'Upload failed', 'error'); return; }
      showToast('Scanned sheet uploaded!', 'success');
      await loadCCDetail();
    } catch(ex) { showToast(ex.message || 'Scan failed', 'error'); doneBtn.disabled = false; doneBtn.textContent = 'Done'; }
  };

  closeBtn.onclick = _closeCCScan;
}

function _closeCCScan() {
  if (_ccScanStream) { _ccScanStream.getTracks().forEach(t => t.stop()); _ccScanStream = null; }
  const m = document.getElementById('cc-scan-modal');
  if (m) m.remove();
}

async function _buildScanPdf(pages) {
  // Build a minimal PDF with all scanned images arranged as pages
  // Uses raw PDF syntax — no external library needed
  const pageW = 595, pageH = 842; // A4 in points

  const imgObjs = await Promise.all(pages.map(async (dataUrl, idx) => {
    // Convert base64 JPEG to binary
    const b64 = dataUrl.split(',')[1];
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Get image dimensions from JPEG header
    let w = 1280, h = 960;
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      let pos = 2;
      while (pos < bytes.length - 8) {
        if (bytes[pos] === 0xFF && bytes[pos+1] >= 0xC0 && bytes[pos+1] <= 0xCF && bytes[pos+1] !== 0xC4) {
          h = (bytes[pos+5] << 8) | bytes[pos+6];
          w = (bytes[pos+7] << 8) | bytes[pos+8];
          break;
        }
        pos += 2 + ((bytes[pos+2] << 8) | bytes[pos+3]);
      }
    }

    // Scale to fit A4
    const scale = Math.min(pageW / w, pageH / h);
    const fw = Math.floor(w * scale), fh = Math.floor(h * scale);
    const x = Math.floor((pageW - fw) / 2), y = Math.floor((pageH - fh) / 2);

    return { bytes, fw, fh, x, y, idx: idx + 1, b64 };
  }));

  // Build PDF structure
  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];

  function write(str) {
    const b = enc.encode(str);
    chunks.push(b);
    offset += b.length;
  }
  function writeRaw(bytes) {
    chunks.push(bytes);
    offset += bytes.length;
  }
  function obj(n) { offsets[n] = offset; write(`${n} 0 obj\n`); }
  function endobj() { write('endobj\n'); }

  write('%PDF-1.4\n');
  // Catalog
  obj(1); write('<< /Type /Catalog /Pages 2 0 R >>\n'); endobj();
  // Pages
  obj(2);
  write(`<< /Type /Pages /Kids [`);
  for (let i = 0; i < imgObjs.length; i++) write(` ${3 + i * 2} 0 R`);
  write(` ] /Count ${imgObjs.length} >>\n`); endobj();

  // Page + XObject pairs
  for (let i = 0; i < imgObjs.length; i++) {
    const { fw, fh, x, y, bytes: imgBytes, idx } = imgObjs[i];
    const pageObjN = 3 + i * 2;
    const xobjN = 4 + i * 2;
    // Page
    obj(pageObjN);
    write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}]\n`);
    write(`   /Resources << /XObject << /Im${idx} ${xobjN} 0 R >> >>\n`);
    const stream = `q ${fw} 0 0 ${fh} ${x} ${y} cm /Im${idx} Do Q\n`;
    write(`   /Contents << /Length ${stream.length} >> >>\n`);
    endobj();
    write(`stream\n${stream}endstream\n`);
    // Image XObject
    obj(xobjN);
    write(`<< /Type /XObject /Subtype /Image /Width ${imgObjs[i].fw} /Height ${imgObjs[i].fh}`);
    write(` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\n`);
    endobj();
    write('stream\n'); writeRaw(imgBytes); write('\nendstream\n');
  }

  // Cross-reference
  const xrefOffset = offset;
  const n = 1 + imgObjs.length * 2;
  write(`xref\n0 ${n + 2}\n0000000000 65535 f \n`);
  for (let i = 1; i <= n; i++) {
    write((offsets[i] || 0).toString().padStart(10, '0') + ' 00000 n \n');
  }
  write(`trailer\n<< /Size ${n + 2} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  // Combine all chunks into a single Blob
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) { buf.set(c, pos); pos += c.length; }
  return new File([buf], 'answersheet.pdf', { type: 'application/pdf' });
}

// Expose function for inline onclick from session detail
window.openCCScan = function(sessionId, roll) {
  showCCScanModal(sessionId, roll);
};

/*
   SHARED FILES "" Admin uploads, all roles download
    */
