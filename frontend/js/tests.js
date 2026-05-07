/*
  MAC Tests & Exams — frontend module
  Faculty/Admin: create/edit exams, AI question generation, submission review, grading
  Student: available exams, locked test-taking, countdown, auto-submit, results
*/

// ── State ──────────────────────────────────────────────────────────────────
let _testsState = {
  view: 'list',           // list | build | take | result | review
  exam: null,
  submission: null,
  answers: {},            // question_id → { selected_option_ids, written_text }
  timerIv: null,
  tabWarned: false,
  timeLimitMs: 0,
  startedAt: null,
};

// ── Entry Point ────────────────────────────────────────────────────────────
async function renderTests() {
  const el = document.getElementById('page-content');
  if (!el) return;
  const u = state.user || {};
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading Tests...</span></div>';
  if (u.role === 'student') {
    await _testsRenderStudentList(el);
  } else {
    await _testsRenderFacultyList(el);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  FACULTY / ADMIN VIEWS
// ══════════════════════════════════════════════════════════════════════════════

async function _testsRenderFacultyList(el) {
  let exams = [];
  try {
    exams = await apiJson('/tests');
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p>Failed to load exams: ${esc(e.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="tests-page">
      <div class="tests-header">
        <div>
          <h2 style="margin:0 0 4px">Tests &amp; Exams</h2>
          <p class="muted" style="margin:0;font-size:.85rem">Create and manage exams for your students</p>
        </div>
        <button class="btn btn-primary btn-sm" id="tests-create-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Test
        </button>
      </div>

      ${exams.length === 0 ? `
        <div class="empty-state" style="margin-top:48px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <h3>No tests yet</h3>
          <p>Create your first test to get started.</p>
        </div>
      ` : `
        <div class="tests-grid" id="tests-grid">
          ${exams.map(e => _testsExamCard(e)).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('tests-create-btn')?.addEventListener('click', _testsOpenCreateModal);
  document.querySelectorAll('.tests-exam-card').forEach(card => {
    card.querySelector('.tests-build-btn')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _testsRenderBuilder(el, card.dataset.examId);
    });
    card.querySelector('.tests-subs-btn')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _testsRenderSubmissions(el, card.dataset.examId);
    });
  });
}

function _testsExamCard(exam) {
  const statusBadge = {
    draft: 'badge-neutral',
    scheduled: 'badge-info',
    active: 'badge-warn',
    ended: 'badge-purple',
    graded: 'badge-success',
  }[exam.status] || 'badge-neutral';

  const scheduleStr = exam.scheduled_at
    ? `<span style="font-size:.75rem;color:var(--muted)">${new Date(exam.scheduled_at).toLocaleString()}</span>`
    : '<span style="font-size:.75rem;color:var(--muted)">No schedule set</span>';

  return `
    <div class="card tests-exam-card" data-exam-id="${esc(exam.id)}" style="cursor:pointer;position:relative">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px">
        <div>
          <div style="font-weight:700;font-size:.95rem;margin-bottom:2px">${esc(exam.title)}</div>
          <div style="font-size:.78rem;color:var(--muted)">${esc(exam.subject)}</div>
        </div>
        <span class="badge ${statusBadge}" style="white-space:nowrap;flex-shrink:0">${esc(exam.status)}</span>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:12px;font-size:.78rem;color:var(--fg-secondary)">
        <span>⏱ ${exam.duration_minutes} min</span>
        <span>📝 ${exam.question_count} Q</span>
        <span>🎯 ${exam.total_marks} marks</span>
      </div>
      ${scheduleStr}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-sm btn-primary tests-build-btn">Edit / Build</button>
        ${exam.status !== 'draft' ? `<button class="btn btn-sm btn-outline tests-subs-btn">Submissions</button>` : ''}
      </div>
    </div>
  `;
}

// ── Create Exam Modal ──────────────────────────────────────────────────────
function _testsOpenCreateModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'tests-create-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <h3>Create New Test</h3>
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('tests-create-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Title *</label>
          <input type="text" id="tc-title" class="input" placeholder="e.g. Mid-Term Exam 2026" style="width:100%">
        </div>
        <div class="form-row" style="display:flex;gap:12px">
          <div class="form-group" style="flex:1">
            <label>Subject *</label>
            <input type="text" id="tc-subject" class="input" placeholder="e.g. Data Structures" style="width:100%">
          </div>
          <div class="form-group" style="flex:0 0 130px">
            <label>Duration (min) *</label>
            <input type="number" id="tc-duration" class="input" value="60" min="5" max="480" style="width:100%">
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="tc-desc" class="input" rows="2" placeholder="Brief description..." style="width:100%;resize:vertical"></textarea>
        </div>
        <div class="form-group">
          <label>Instructions for Students</label>
          <textarea id="tc-instructions" class="input" rows="3" placeholder="Read all questions carefully..." style="width:100%;resize:vertical"></textarea>
        </div>
        <div class="form-group">
          <label>Scheduled At (optional)</label>
          <input type="datetime-local" id="tc-scheduled" class="input" style="width:100%">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('tests-create-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="tc-submit-btn">Create Test</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('tc-submit-btn').addEventListener('click', async () => {
    const title = document.getElementById('tc-title').value.trim();
    const subject = document.getElementById('tc-subject').value.trim();
    const duration = parseInt(document.getElementById('tc-duration').value) || 60;
    const desc = document.getElementById('tc-desc').value.trim();
    const instructions = document.getElementById('tc-instructions').value.trim();
    const scheduledVal = document.getElementById('tc-scheduled').value;

    if (!title || !subject) { _testsToast('Title and subject are required', 'error'); return; }

    const btn = document.getElementById('tc-submit-btn');
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
      const body = { title, subject, duration_minutes: duration };
      if (desc) body.description = desc;
      if (instructions) body.instructions = instructions;
      if (scheduledVal) body.scheduled_at = new Date(scheduledVal).toISOString();

      const exam = await apiJson('/tests', { method: 'POST', body: JSON.stringify(body) });
      overlay.remove();
      _testsToast('Test created!', 'success');
      // Navigate to builder
      const el = document.getElementById('page-content');
      if (el) _testsRenderBuilder(el, exam.id);
    } catch (e) {
      _testsToast('Failed: ' + e.message, 'error');
      btn.disabled = false; btn.textContent = 'Create Test';
    }
  });
}

// ── Test Builder ──────────────────────────────────────────────────────────
async function _testsRenderBuilder(el, examId) {
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading exam builder...</span></div>';
  let exam;
  try {
    exam = await apiJson(`/tests/${examId}`);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p>Failed to load exam: ${esc(e.message)}</p></div>`;
    return;
  }

  const canEdit = exam.status === 'draft' || exam.status === 'scheduled';
  const statusBadge = {
    draft: 'badge-neutral', scheduled: 'badge-info',
    active: 'badge-warn', ended: 'badge-purple', graded: 'badge-success',
  }[exam.status] || 'badge-neutral';

  el.innerHTML = `
    <div class="tests-builder">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" id="tests-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <h2 style="margin:0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(exam.title)}</h2>
        <span class="badge ${statusBadge}">${esc(exam.status)}</span>
      </div>

      <!-- Exam Info Card -->
      <div class="card" style="margin-bottom:20px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">
          <div><div class="muted" style="font-size:.75rem;font-weight:600;margin-bottom:2px">SUBJECT</div><div>${esc(exam.subject)}</div></div>
          <div><div class="muted" style="font-size:.75rem;font-weight:600;margin-bottom:2px">DURATION</div><div>${exam.duration_minutes} minutes</div></div>
          <div><div class="muted" style="font-size:.75rem;font-weight:600;margin-bottom:2px">QUESTIONS</div><div>${exam.questions.length}</div></div>
          <div><div class="muted" style="font-size:.75rem;font-weight:600;margin-bottom:2px">TOTAL MARKS</div><div>${exam.questions.reduce((s,q)=>s+q.marks,0)}</div></div>
          ${exam.scheduled_at ? `<div><div class="muted" style="font-size:.75rem;font-weight:600;margin-bottom:2px">SCHEDULED</div><div>${new Date(exam.scheduled_at).toLocaleString()}</div></div>` : ''}
        </div>
        ${canEdit ? `
          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            ${exam.status === 'draft' ? `
              <button class="btn btn-sm btn-primary" id="tests-publish-now-btn">Start Now</button>
              <button class="btn btn-sm btn-outline" id="tests-publish-sched-btn">Schedule</button>
            ` : ''}
            ${exam.status === 'active' ? `<button class="btn btn-sm btn-danger-outline" id="tests-end-btn">End Exam</button>` : ''}
          </div>
        ` : ''}
      </div>

      <!-- Questions Section -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">Questions</h3>
        ${canEdit ? `
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-outline" id="tests-gen-ai-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              Generate with AI
            </button>
            <button class="btn btn-sm btn-primary" id="tests-add-q-btn">+ Add Question</button>
          </div>
        ` : ''}
      </div>

      <div id="tests-questions-list">
        ${exam.questions.length === 0
          ? `<div class="empty-state" style="padding:32px;border:1px dashed var(--border);border-radius:12px">
              <p class="muted">No questions yet. Add questions manually or generate with AI.</p>
             </div>`
          : exam.questions.map((q, i) => _testsQuestionRow(q, i, canEdit, examId)).join('')}
      </div>
    </div>
  `;

  document.getElementById('tests-back-btn')?.addEventListener('click', () => _testsRenderFacultyList(el));
  document.getElementById('tests-add-q-btn')?.addEventListener('click', () => _testsOpenAddQuestionModal(el, examId, null));
  document.getElementById('tests-gen-ai-btn')?.addEventListener('click', () => _testsOpenGenerateModal(el, examId, exam));
  document.getElementById('tests-publish-now-btn')?.addEventListener('click', () => _testsPublish(el, examId, 'active'));
  document.getElementById('tests-publish-sched-btn')?.addEventListener('click', () => _testsOpenScheduleModal(el, examId));
  document.getElementById('tests-end-btn')?.addEventListener('click', () => _testsEndExam(el, examId));

  // Edit/Delete question buttons
  document.querySelectorAll('.tests-edit-q-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.dataset.qid;
      const q = exam.questions.find(q => q.id === qId);
      if (q) _testsOpenAddQuestionModal(el, examId, q);
    });
  });
  document.querySelectorAll('.tests-del-q-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this question?')) return;
      try {
        await api(`/tests/${examId}/questions/${btn.dataset.qid}`, { method: 'DELETE' });
        _testsRenderBuilder(el, examId);
        _testsToast('Question deleted', 'success');
      } catch (e) { _testsToast('Failed: ' + e.message, 'error'); }
    });
  });
}

function _testsQuestionRow(q, idx, canEdit, examId) {
  const typeColor = { mcq: '#3b82f6', msq: '#8b5cf6', written: '#10b981' }[q.question_type] || '#888';
  const correct = q.options?.filter(o => o.is_correct) || [];
  return `
    <div class="card" style="margin-bottom:10px;padding:14px 16px">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:26px;height:26px;border-radius:50%;background:var(--accent-light);color:var(--accent);font-size:.75rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">${idx+1}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px;background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44">${q.question_type.toUpperCase()}</span>
            <span style="font-size:.75rem;color:var(--muted)">${q.marks} mark${q.marks !== 1 ? 's' : ''}</span>
          </div>
          <div style="font-size:.88rem;margin-bottom:6px;font-weight:500">${esc(q.question_text)}</div>
          ${q.question_type !== 'written' && q.options?.length ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${q.options.map(o => `
                <span style="font-size:.75rem;padding:2px 10px;border-radius:999px;background:${o.is_correct?'rgba(16,185,129,.12)':'var(--hover)'};color:${o.is_correct?'#10b981':'var(--fg-secondary)'};border:1px solid ${o.is_correct?'rgba(16,185,129,.3)':'var(--border)'}">${esc(o.option_text)}</span>
              `).join('')}
            </div>
          ` : ''}
          ${q.explanation ? `<div style="font-size:.75rem;color:var(--muted);margin-top:6px;font-style:italic">Explanation: ${esc(q.explanation)}</div>` : ''}
        </div>
        ${canEdit ? `
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-sm btn-outline tests-edit-q-btn" data-qid="${esc(q.id)}" title="Edit">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-sm btn-danger-outline tests-del-q-btn" data-qid="${esc(q.id)}" title="Delete">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Add / Edit Question Modal ──────────────────────────────────────────────
function _testsOpenAddQuestionModal(el, examId, existingQ) {
  const isEdit = !!existingQ;
  const q = existingQ || { question_type: 'mcq', marks: 1, options: [] };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'tests-addq-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:600px">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Question' : 'Add Question'}</h3>
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('tests-addq-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row" style="display:flex;gap:12px;margin-bottom:14px">
          <div class="form-group" style="flex:1">
            <label>Question Type</label>
            <select id="addq-type" class="input" style="width:100%">
              <option value="mcq" ${q.question_type==='mcq'?'selected':''}>MCQ (Single correct)</option>
              <option value="msq" ${q.question_type==='msq'?'selected':''}>MSQ (Multiple correct)</option>
              <option value="written" ${q.question_type==='written'?'selected':''}>Written (Text answer)</option>
            </select>
          </div>
          <div class="form-group" style="flex:0 0 100px">
            <label>Marks</label>
            <input type="number" id="addq-marks" class="input" value="${q.marks}" min="0.5" step="0.5" style="width:100%">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Question Text *</label>
          <textarea id="addq-text" class="input" rows="3" placeholder="Enter your question..." style="width:100%;resize:vertical">${esc(q.question_text || '')}</textarea>
        </div>
        <div id="addq-options-section">
          <!-- options populated by JS -->
        </div>
        <div class="form-group" style="margin-bottom:14px" id="addq-model-answer-section">
          <label>Model Answer (for AI grading)</label>
          <textarea id="addq-model-answer" class="input" rows="2" placeholder="Full expected answer..." style="width:100%;resize:vertical">${esc(q.model_answer || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Explanation (shown after test ends)</label>
          <textarea id="addq-explanation" class="input" rows="2" placeholder="Why is this the correct answer?" style="width:100%;resize:vertical">${esc(q.explanation || '')}</textarea>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('tests-addq-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="addq-submit-btn">${isEdit ? 'Save Changes' : 'Add Question'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Build options section
  let options = q.options ? q.options.map(o => ({ text: o.option_text, is_correct: o.is_correct })) : [];
  if (options.length === 0 && q.question_type !== 'written') {
    options = [{ text: '', is_correct: true }, { text: '', is_correct: false }, { text: '', is_correct: false }, { text: '', is_correct: false }];
  }

  function renderOptions() {
    const type = document.getElementById('addq-type').value;
    const section = document.getElementById('addq-options-section');
    const modelSection = document.getElementById('addq-model-answer-section');
    if (type === 'written') {
      section.innerHTML = '';
      if (modelSection) modelSection.style.display = '';
      return;
    }
    if (modelSection) modelSection.style.display = 'none';
    const isMulti = type === 'msq';
    section.innerHTML = `
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label style="font-size:.78rem;font-weight:600;color:var(--muted)">OPTIONS ${isMulti ? '(check all correct)' : '(check the correct one)'}</label>
          <button type="button" class="btn btn-sm btn-outline" id="addq-add-opt-btn" style="font-size:.75rem;padding:4px 10px">+ Add Option</button>
        </div>
        <div id="addq-opts-list">
          ${options.map((o, i) => _testsOptionRow(o, i, isMulti)).join('')}
        </div>
      </div>
    `;
    document.getElementById('addq-add-opt-btn')?.addEventListener('click', () => {
      options.push({ text: '', is_correct: false });
      renderOptions();
    });
    document.querySelectorAll('.addq-opt-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.idx);
        options.splice(i, 1);
        renderOptions();
      });
    });
    // Sync values
    document.querySelectorAll('.addq-opt-text').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = parseInt(inp.dataset.idx);
        if (options[i]) options[i].text = inp.value;
      });
    });
    document.querySelectorAll('.addq-opt-correct').forEach(inp => {
      inp.addEventListener('change', () => {
        const i = parseInt(inp.dataset.idx);
        if (type === 'mcq') {
          options.forEach((o, j) => o.is_correct = j === i);
          renderOptions();
        } else {
          if (options[i]) options[i].is_correct = inp.checked;
        }
      });
    });
  }

  document.getElementById('addq-type').addEventListener('change', renderOptions);
  renderOptions();

  document.getElementById('addq-submit-btn').addEventListener('click', async () => {
    const type = document.getElementById('addq-type').value;
    const marks = parseFloat(document.getElementById('addq-marks').value) || 1;
    const text = document.getElementById('addq-text').value.trim();
    const modelAnswer = document.getElementById('addq-model-answer')?.value.trim() || '';
    const explanation = document.getElementById('addq-explanation').value.trim();

    if (!text) { _testsToast('Question text is required', 'error'); return; }

    // Read current option values
    const currentOpts = [];
    document.querySelectorAll('.addq-opt-text').forEach((inp, i) => {
      const correctEl = document.querySelector(`.addq-opt-correct[data-idx="${i}"]`);
      currentOpts.push({ option_text: inp.value.trim(), is_correct: correctEl?.checked || false, order_index: i });
    });

    const body = {
      question_type: type,
      question_text: text,
      marks,
      explanation: explanation || null,
      model_answer: modelAnswer || null,
      options: type !== 'written' ? currentOpts : [],
    };

    const btn = document.getElementById('addq-submit-btn');
    btn.disabled = true; btn.textContent = 'Saving...';

    try {
      if (isEdit) {
        await api(`/tests/${examId}/questions/${existingQ.id}`, { method: 'PUT', body: JSON.stringify(body) });
        _testsToast('Question updated', 'success');
      } else {
        await api(`/tests/${examId}/questions`, { method: 'POST', body: JSON.stringify(body) });
        _testsToast('Question added', 'success');
      }
      overlay.remove();
      _testsRenderBuilder(el, examId);
    } catch (e) {
      _testsToast('Failed: ' + e.message, 'error');
      btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Add Question';
    }
  });
}

function _testsOptionRow(opt, i, isMulti) {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <input type="${isMulti ? 'checkbox' : 'radio'}" class="addq-opt-correct" name="addq-correct" data-idx="${i}" ${opt.is_correct ? 'checked' : ''} style="flex-shrink:0">
      <input type="text" class="addq-opt-text input" data-idx="${i}" value="${esc(opt.text || '')}" placeholder="Option ${i+1}" style="flex:1;padding:6px 10px">
      <button type="button" class="btn btn-sm btn-danger-outline addq-opt-del" data-idx="${i}" title="Remove" style="padding:4px 8px">&times;</button>
    </div>
  `;
}

// ── AI Generation Modal ──────────────────────────────────────────────────
function _testsOpenGenerateModal(el, examId, exam) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'tests-gen-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-header">
        <h3>Generate Questions with AI</h3>
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('tests-gen-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:14px">
          <label>Subject</label>
          <input type="text" id="gen-subject" class="input" value="${esc(exam.subject)}" style="width:100%">
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Topic / Chapter *</label>
          <input type="text" id="gen-topic" class="input" placeholder="e.g. Binary Trees, Sorting Algorithms" style="width:100%">
        </div>
        <div class="form-row" style="display:flex;gap:12px;margin-bottom:14px">
          <div class="form-group" style="flex:1">
            <label>Number of Questions</label>
            <input type="number" id="gen-num" class="input" value="10" min="1" max="50" style="width:100%">
          </div>
          <div class="form-group" style="flex:1">
            <label>Difficulty</label>
            <select id="gen-diff" class="input" style="width:100%">
              <option value="easy">Easy</option>
              <option value="medium" selected>Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div class="form-group" style="flex:1">
            <label>Marks per Q</label>
            <input type="number" id="gen-marks" class="input" value="1" min="0.5" step="0.5" style="width:100%">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Question Types</label>
          <div style="display:flex;gap:12px;margin-top:6px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="gen-mcq" checked> MCQ</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="gen-msq"> MSQ</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="gen-written"> Written</label>
          </div>
        </div>
      </div>
      <div id="gen-progress" style="display:none;padding:16px;text-align:center">
        <div class="spinner" style="margin:0 auto 8px"></div>
        <p class="muted" style="margin:0;font-size:.85rem">AI is generating questions...</p>
      </div>
      <div id="gen-preview" style="display:none;max-height:360px;overflow-y:auto;padding:0 4px"></div>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('tests-gen-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="gen-submit-btn">Generate</button>
        <button class="btn btn-primary btn-sm" id="gen-insert-btn" style="display:none">Insert Approved Questions</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let generatedQuestions = [];
  let approvedSet = new Set();

  document.getElementById('gen-submit-btn').addEventListener('click', async () => {
    const subject = document.getElementById('gen-subject').value.trim();
    const topic = document.getElementById('gen-topic').value.trim();
    const num = parseInt(document.getElementById('gen-num').value) || 10;
    const diff = document.getElementById('gen-diff').value;
    const marks = parseFloat(document.getElementById('gen-marks').value) || 1;
    if (!topic) { _testsToast('Topic is required', 'error'); return; }

    const types = [];
    if (document.getElementById('gen-mcq').checked) types.push('mcq');
    if (document.getElementById('gen-msq').checked) types.push('msq');
    if (document.getElementById('gen-written').checked) types.push('written');
    if (types.length === 0) { _testsToast('Select at least one question type', 'error'); return; }

    document.getElementById('gen-progress').style.display = '';
    document.getElementById('gen-preview').style.display = 'none';
    document.getElementById('gen-submit-btn').disabled = true;
    document.getElementById('gen-insert-btn').style.display = 'none';
    generatedQuestions = [];
    approvedSet.clear();

    try {
      const body = { subject, topic, num_questions: num, difficulty: diff, marks_per_question: marks, question_types: types };
      generatedQuestions = await apiJson(`/tests/${examId}/generate`, { method: 'POST', body: JSON.stringify(body) });
      approvedSet = new Set(generatedQuestions.map(q => q.id));

      document.getElementById('gen-progress').style.display = 'none';
      document.getElementById('gen-submit-btn').disabled = false;
      document.getElementById('gen-insert-btn').style.display = '';

      const preview = document.getElementById('gen-preview');
      preview.style.display = '';
      preview.innerHTML = `
        <div style="font-size:.82rem;color:var(--muted);margin-bottom:12px;padding:0 4px">${generatedQuestions.length} questions generated. Uncheck any you don't want.</div>
        ${generatedQuestions.map((q, i) => `
          <div class="card" style="margin-bottom:8px;padding:12px 14px" id="gen-q-${esc(q.id)}">
            <div style="display:flex;gap:10px;align-items:flex-start">
              <input type="checkbox" class="gen-q-check" data-qid="${esc(q.id)}" checked style="margin-top:3px;flex-shrink:0">
              <div style="flex:1;min-width:0">
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap">
                  <span style="font-size:.7rem;font-weight:700;background:var(--accent-light);color:var(--accent);padding:1px 8px;border-radius:999px">${q.question_type.toUpperCase()}</span>
                  <span class="muted" style="font-size:.75rem">${q.marks} mark${q.marks!==1?'s':''}</span>
                </div>
                <div style="font-size:.85rem;margin-bottom:6px">${esc(q.question_text)}</div>
                ${q.options?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${q.options.map(o=>`<span style="font-size:.73rem;padding:1px 8px;border-radius:999px;background:${o.is_correct?'rgba(16,185,129,.12)':'var(--hover)'};color:${o.is_correct?'#10b981':'var(--fg-secondary)'};border:1px solid ${o.is_correct?'rgba(16,185,129,.3)':'var(--border)'}">${esc(o.option_text)}</span>`).join('')}</div>` : ''}
                ${q.explanation ? `<div style="font-size:.73rem;color:var(--muted);margin-top:4px;font-style:italic">${esc(q.explanation)}</div>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      `;

      document.querySelectorAll('.gen-q-check').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) approvedSet.add(cb.dataset.qid);
          else approvedSet.delete(cb.dataset.qid);
        });
      });

    } catch (e) {
      document.getElementById('gen-progress').style.display = 'none';
      document.getElementById('gen-submit-btn').disabled = false;
      _testsToast('AI generation failed: ' + e.message, 'error');
    }
  });

  document.getElementById('gen-insert-btn').addEventListener('click', async () => {
    // Questions already in DB (generated by backend). Remove unapproved ones.
    const toDelete = generatedQuestions.filter(q => !approvedSet.has(q.id));
    const btn = document.getElementById('gen-insert-btn');
    btn.disabled = true; btn.textContent = 'Processing...';
    try {
      for (const q of toDelete) {
        await api(`/tests/${examId}/questions/${q.id}`, { method: 'DELETE' });
      }
      overlay.remove();
      _testsToast(`${approvedSet.size} questions added!`, 'success');
      _testsRenderBuilder(el, examId);
    } catch (e) {
      _testsToast('Failed to remove unapproved questions: ' + e.message, 'error');
      btn.disabled = false; btn.textContent = 'Insert Approved Questions';
    }
  });
}

// ── Schedule Modal ─────────────────────────────────────────────────────────
function _testsOpenScheduleModal(el, examId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'tests-sched-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header">
        <h3>Schedule Exam</h3>
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('tests-sched-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Start Date &amp; Time *</label>
          <input type="datetime-local" id="sched-dt" class="input" style="width:100%">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('tests-sched-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="sched-submit-btn">Schedule</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('sched-submit-btn').addEventListener('click', async () => {
    const dt = document.getElementById('sched-dt').value;
    if (!dt) { _testsToast('Please select a date/time', 'error'); return; }
    // Update exam scheduled_at first
    try {
      await api(`/tests/${examId}`, { method: 'PUT', body: JSON.stringify({ scheduled_at: new Date(dt).toISOString() }) });
      await _testsPublish(el, examId, 'scheduled', true);
      overlay.remove();
    } catch (e) { _testsToast('Failed: ' + e.message, 'error'); }
  });
}

async function _testsPublish(el, examId, mode, silent = false) {
  try {
    const r = await apiJson(`/tests/${examId}/publish`, { method: 'POST', body: JSON.stringify({ mode }) });
    _testsToast(mode === 'active' ? 'Exam is now LIVE!' : 'Exam scheduled!', 'success');
    _testsRenderBuilder(el, examId);
  } catch (e) {
    if (!silent) _testsToast('Failed: ' + e.message, 'error');
    else throw e;
  }
}

async function _testsEndExam(el, examId) {
  if (!confirm('End this exam? Students will no longer be able to submit.')) return;
  try {
    await api(`/tests/${examId}/end`, { method: 'POST' });
    _testsToast('Exam ended', 'success');
    _testsRenderBuilder(el, examId);
  } catch (e) { _testsToast('Failed: ' + e.message, 'error'); }
}

// ── Submissions List ──────────────────────────────────────────────────────
async function _testsRenderSubmissions(el, examId) {
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading submissions...</span></div>';
  let subs = [], examTitle = '';
  try {
    const [exam, subsData] = await Promise.all([
      apiJson(`/tests/${examId}`),
      apiJson(`/tests/${examId}/submissions`),
    ]);
    subs = subsData;
    examTitle = exam.title;
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p>Failed: ${esc(e.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="tests-subs-page">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <button class="btn btn-sm btn-outline" id="tests-subs-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div>
          <h2 style="margin:0 0 2px">${esc(examTitle)}</h2>
          <p class="muted" style="margin:0;font-size:.8rem">Submissions (${subs.length})</p>
        </div>
      </div>

      ${subs.length === 0 ? `<div class="empty-state"><p>No submissions yet.</p></div>` : `
        <div class="card" style="overflow:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.85rem">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="padding:10px 12px;text-align:left;font-weight:600">Student</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600">Roll</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600">Submitted</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600">Status</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600">Score</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600">Action</th>
              </tr>
            </thead>
            <tbody>
              ${subs.map(s => `
                <tr style="border-bottom:1px solid var(--border)" id="sub-row-${esc(s.id)}">
                  <td style="padding:10px 12px">${esc(s.student_name || '—')}</td>
                  <td style="padding:10px 12px">${esc(s.student_roll || '—')}</td>
                  <td style="padding:10px 12px">${s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'}</td>
                  <td style="padding:10px 12px"><span class="badge ${s.status==='graded'?'badge-success':s.status==='submitted'?'badge-info':'badge-neutral'}">${esc(s.status)}</span></td>
                  <td style="padding:10px 12px">${s.total_score != null ? s.total_score : '—'}</td>
                  <td style="padding:10px 12px">
                    <button class="btn btn-sm btn-outline tests-review-btn" data-subid="${esc(s.id)}">Review</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  document.getElementById('tests-subs-back-btn')?.addEventListener('click', () => _testsRenderBuilder(el, examId));
  document.querySelectorAll('.tests-review-btn').forEach(btn => {
    btn.addEventListener('click', () => _testsRenderSubmissionReview(el, examId, btn.dataset.subid));
  });
}

// ── Submission Review ─────────────────────────────────────────────────────
async function _testsRenderSubmissionReview(el, examId, subId) {
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading review...</span></div>';
  let sub;
  try {
    sub = await apiJson(`/tests/${examId}/submissions/${subId}`);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p>Failed: ${esc(e.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="tests-review-page">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" id="tests-review-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div>
          <h2 style="margin:0 0 2px">Review: ${esc(sub.student_name || sub.student_id)}</h2>
          <p class="muted" style="margin:0;font-size:.8rem">Score: ${sub.total_score ?? '—'} &middot; Status: ${sub.status}</p>
        </div>
        <button class="btn btn-sm btn-primary" id="tests-save-grades-btn" style="margin-left:auto">Save Grades</button>
      </div>

      <div id="tests-review-answers">
        ${sub.answers.map((a, i) => _testsReviewAnswerCard(a, i)).join('')}
      </div>
    </div>
  `;

  document.getElementById('tests-review-back-btn')?.addEventListener('click', () => _testsRenderSubmissions(el, examId));
  document.getElementById('tests-save-grades-btn')?.addEventListener('click', async () => {
    const overrides = [];
    document.querySelectorAll('.tests-manual-score').forEach(inp => {
      const qid = inp.dataset.qid;
      const val = parseFloat(inp.value);
      if (!isNaN(val)) overrides.push({ question_id: qid, manual_score: val });
    });
    try {
      await api(`/tests/${examId}/submissions/${subId}/grade`, {
        method: 'PUT',
        body: JSON.stringify({ overrides, mark_graded: true }),
      });
      _testsToast('Grades saved!', 'success');
      _testsRenderSubmissionReview(el, examId, subId);
    } catch (e) { _testsToast('Failed: ' + e.message, 'error'); }
  });
}

function _testsReviewAnswerCard(a, idx) {
  const isCorrect = a.is_correct === true;
  const isPending = a.question_type === 'written' && a.ai_score === null && a.manual_score === null;
  const borderColor = a.question_type !== 'written' ? (isCorrect ? '#10b981' : '#ef4444') : 'var(--border)';

  return `
    <div class="card" style="margin-bottom:12px;padding:16px;border-left:3px solid ${borderColor}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap">
        <div style="flex:1">
          <div style="font-size:.78rem;color:var(--muted);margin-bottom:4px">Q${idx+1} &middot; ${a.question_type.toUpperCase()} &middot; ${a.marks} marks</div>
          <div style="font-weight:500;margin-bottom:8px">${esc(a.question_text)}</div>
        </div>
        ${a.question_type !== 'written' ? `
          <span style="font-size:.75rem;padding:2px 10px;border-radius:999px;background:${isCorrect?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)'};color:${isCorrect?'#10b981':'#ef4444'};border:1px solid ${isCorrect?'rgba(16,185,129,.3)':'rgba(239,68,68,.3)'}">
            ${isCorrect ? '✓ Correct' : '✗ Incorrect'} · ${isCorrect?a.marks:0}/${a.marks}
          </span>
        ` : `
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:.78rem;font-weight:600;color:var(--muted)">Score:</label>
            <input type="number" class="input tests-manual-score" data-qid="${esc(a.question_id)}" value="${a.manual_score ?? a.ai_score ?? ''}" min="0" max="${a.marks}" step="0.5" style="width:70px;padding:4px 8px;font-size:.8rem">
            <span style="font-size:.78rem;color:var(--muted)">/ ${a.marks}</span>
          </div>
        `}
      </div>

      ${a.question_type === 'written' ? `
        <div style="background:var(--hover);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:.85rem">${esc(a.written_text || '(no answer)')}</div>
        ${a.model_answer ? `<div style="font-size:.78rem;color:var(--muted);margin-bottom:6px"><strong>Model Answer:</strong> ${esc(a.model_answer)}</div>` : ''}
        ${a.ai_feedback ? `<div style="font-size:.78rem;color:var(--muted)"><strong>AI Feedback:</strong> ${esc(a.ai_feedback)}</div>` : ''}
        ${isPending ? `<div style="font-size:.75rem;color:var(--accent);margin-top:6px">⏳ AI grading pending...</div>` : ''}
      ` : `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          ${(a.all_options || []).map(o => {
            const isSelected = (a.selected_option_ids || []).includes(o.id);
            const bg = o.is_correct ? 'rgba(16,185,129,.12)' : isSelected ? 'rgba(239,68,68,.12)' : 'var(--hover)';
            const border = o.is_correct ? 'rgba(16,185,129,.4)' : isSelected ? 'rgba(239,68,68,.4)' : 'var(--border)';
            const color = o.is_correct ? '#10b981' : isSelected ? '#ef4444' : 'var(--fg-secondary)';
            const prefix = isSelected ? (o.is_correct ? '✓ ' : '✗ ') : '';
            return `<span style="font-size:.78rem;padding:3px 10px;border-radius:999px;background:${bg};color:${color};border:1px solid ${border}">${prefix}${esc(o.option_text)}</span>`;
          }).join('')}
        </div>
        ${a.explanation ? `<div style="font-size:.75rem;color:var(--muted);font-style:italic">Explanation: ${esc(a.explanation)}</div>` : ''}
      `}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
//  STUDENT VIEWS
// ══════════════════════════════════════════════════════════════════════════════

async function _testsRenderStudentList(el) {
  let exams = [];
  try {
    exams = await apiJson('/tests/available');
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p>Failed to load tests: ${esc(e.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="tests-page">
      <div style="margin-bottom:24px">
        <h2 style="margin:0 0 4px">Tests &amp; Exams</h2>
        <p class="muted" style="margin:0;font-size:.85rem">Your upcoming and active exams</p>
      </div>
      ${exams.length === 0 ? `
        <div class="empty-state" style="margin-top:48px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <h3>No exams scheduled</h3>
          <p>Check back later for upcoming tests.</p>
        </div>
      ` : `
        <div class="tests-grid" id="student-tests-grid">
          ${exams.map(e => _testsStudentExamCard(e)).join('')}
        </div>
      `}
    </div>
  `;

  // Start countdown timers
  _testsStartCountdowns();

  document.querySelectorAll('.tests-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const examId = btn.dataset.examId;
      const examName = btn.dataset.examName;
      if (!confirm(`Start test: "${examName}"?\n\nOnce started, the timer will begin. Make sure you're ready.`)) return;
      _testsRenderTakePage(examId);
    });
  });

  document.querySelectorAll('.tests-result-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _testsRenderResultPage(btn.dataset.examId);
    });
  });
}

function _testsStudentExamCard(exam) {
  const isActive = exam.status === 'active';
  const scheduledDate = exam.scheduled_at ? new Date(exam.scheduled_at) : null;
  const now = new Date();
  const isUpcoming = scheduledDate && scheduledDate > now;

  const statusLabel = isActive ? 'Live Now' : (isUpcoming ? 'Upcoming' : 'Open');
  const statusColor = isActive ? '#ef4444' : (isUpcoming ? '#3b82f6' : '#10b981');

  return `
    <div class="card tests-student-card" data-exam-id="${esc(exam.id)}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:.95rem;margin-bottom:2px">${esc(exam.title)}</div>
          <div style="font-size:.78rem;color:var(--muted)">${esc(exam.subject)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="font-size:.7rem;font-weight:700;padding:2px 10px;border-radius:999px;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44">${statusLabel}</span>
          ${isActive ? '<span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:50%;animation:pulse 1.5s infinite"></span>' : ''}
        </div>
      </div>

      <div style="display:flex;gap:16px;font-size:.78rem;color:var(--fg-secondary);margin-bottom:12px">
        <span>⏱ ${exam.duration_minutes} min</span>
        <span>📝 ${exam.question_count} questions</span>
        <span>🎯 ${exam.total_marks} marks</span>
      </div>

      ${scheduledDate ? `
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">
          ${isUpcoming ? `Starts in: <span class="tests-countdown" data-ts="${scheduledDate.getTime()}" style="font-weight:700;color:var(--accent)">—</span>` : `Started: ${scheduledDate.toLocaleString()}`}
        </div>
      ` : ''}

      <button class="btn btn-primary btn-sm tests-start-btn" data-exam-id="${esc(exam.id)}" data-exam-name="${esc(exam.title)}" ${isUpcoming ? 'disabled' : ''}>
        ${isUpcoming ? 'Not Started Yet' : 'Start Test'}
      </button>
    </div>
  `;
}

function _testsStartCountdowns() {
  clearInterval(window._testsCountdownIv);
  window._testsCountdownIv = setInterval(() => {
    document.querySelectorAll('.tests-countdown').forEach(el => {
      const ts = parseInt(el.dataset.ts);
      if (!ts) return;
      const diff = ts - Date.now();
      if (diff <= 0) {
        el.textContent = 'Starting...';
        // Enable start button
        const card = el.closest('.tests-student-card');
        if (card) {
          const btn = card.querySelector('.tests-start-btn');
          if (btn) btn.disabled = false;
        }
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
    });
  }, 1000);
}

// ── Locked Test-Taking Page ──────────────────────────────────────────────
async function _testsRenderTakePage(examId) {
  // Replace entire app with locked test page
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading-state" style="height:100vh;display:flex;align-items:center;justify-content:center"><div class="spinner"></div><span>Starting exam...</span></div>';

  let sub;
  try {
    sub = await apiJson(`/tests/${examId}/start`, { method: 'POST' });
  } catch (e) {
    app.innerHTML = `<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
      <p style="color:var(--danger)">${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="render()">Back</button>
    </div>`;
    return;
  }

  _testsState.submission = sub;
  _testsState.exam = sub.exam;
  _testsState.timeLimitMs = sub.exam.duration_minutes * 60 * 1000;
  _testsState.startedAt = new Date(sub.started_at).getTime();
  _testsState.tabWarned = false;

  // Load saved answers
  const savedKey = `mac_test_answers_${examId}_${sub.submission_id}`;
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey) || '{}');
    _testsState.answers = saved;
  } catch { _testsState.answers = {}; }

  app.innerHTML = _testsTakePageHtml(sub.exam, sub.submission_id);
  _testsBindTakePage(examId, sub.submission_id, savedKey);
  _testsStartTimer(examId, sub.submission_id);
  _testsBindTabGuard(examId, sub.submission_id);
}

function _testsTakePageHtml(exam, subId) {
  return `
    <div class="tests-take-page" id="tests-take-page">
      <!-- Locked Header -->
      <div class="tests-take-header">
        <div style="font-weight:700;font-size:.95rem;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(exam.title)}</div>
        <div style="display:flex;align-items:center;gap:16px">
          <div class="tests-timer" id="tests-timer">--:--</div>
          <button class="btn btn-primary btn-sm" id="tests-submit-now-btn">Submit</button>
        </div>
      </div>

      <!-- Instructions if any -->
      ${exam.instructions ? `<div class="tests-take-instructions">${esc(exam.instructions)}</div>` : ''}

      <!-- Questions -->
      <div class="tests-take-body">
        <div class="tests-take-questions">
          ${exam.questions.map((q, i) => _testsTakeQuestionHtml(q, i)).join('')}
        </div>
        <div style="padding:20px;text-align:center">
          <button class="btn btn-primary" id="tests-submit-bottom-btn">Submit Exam</button>
        </div>
      </div>
    </div>
  `;
}

function _testsTakeQuestionHtml(q, idx) {
  const saved = _testsState.answers[q.id] || {};
  const savedOpts = new Set(saved.selected_option_ids || []);
  const savedText = saved.written_text || '';

  return `
    <div class="tests-take-question" id="take-q-${esc(q.id)}" data-qid="${esc(q.id)}">
      <div class="tests-take-q-header">
        <span class="tests-take-q-num">${idx+1}</span>
        <span style="font-size:.72rem;font-weight:600;color:var(--muted)">${q.question_type.toUpperCase()} &middot; ${q.marks} mark${q.marks!==1?'s':''}</span>
      </div>
      <div class="tests-take-q-text">${esc(q.question_text)}</div>
      <div class="tests-take-q-options">
        ${q.question_type === 'written' ? `
          <textarea
            class="input tests-written-answer"
            data-qid="${esc(q.id)}"
            rows="5"
            placeholder="Type your answer here..."
            style="width:100%;resize:vertical;font-size:.88rem"
          >${esc(savedText)}</textarea>
        ` : q.options.map(o => `
          <label class="tests-take-option ${savedOpts.has(o.id) ? 'selected' : ''}" data-qid="${esc(q.id)}" data-oid="${esc(o.id)}">
            <input
              type="${q.question_type === 'mcq' ? 'radio' : 'checkbox'}"
              name="q-${esc(q.id)}"
              value="${esc(o.id)}"
              ${savedOpts.has(o.id) ? 'checked' : ''}
              class="tests-option-input"
              data-qid="${esc(q.id)}"
              data-oid="${esc(o.id)}"
            >
            <span>${esc(o.option_text)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;
}

function _testsBindTakePage(examId, subId, savedKey) {
  // Disable right-click
  document.addEventListener('contextmenu', _testsBlockContextMenu);

  // Disable copy-paste
  document.addEventListener('copy', _testsBlockCopy);
  document.addEventListener('cut', _testsBlockCopy);
  document.addEventListener('paste', _testsBlockPaste);

  // MCQ/MSQ option selection
  document.querySelectorAll('.tests-option-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const qid = inp.dataset.qid;
      const q = _testsState.exam.questions.find(q => q.id === qid);
      if (!q) return;

      if (!_testsState.answers[qid]) _testsState.answers[qid] = {};

      if (q.question_type === 'mcq') {
        _testsState.answers[qid].selected_option_ids = [inp.value];
        // Update visual
        document.querySelectorAll(`label[data-qid="${qid}"]`).forEach(l => l.classList.remove('selected'));
        inp.closest('label')?.classList.add('selected');
      } else {
        // MSQ
        const current = new Set(_testsState.answers[qid].selected_option_ids || []);
        if (inp.checked) current.add(inp.value);
        else current.delete(inp.value);
        _testsState.answers[qid].selected_option_ids = Array.from(current);
        inp.closest('label')?.classList.toggle('selected', inp.checked);
      }
      _testsSaveAnswers(savedKey);
    });
  });

  // Written answers
  document.querySelectorAll('.tests-written-answer').forEach(ta => {
    ta.addEventListener('input', () => {
      const qid = ta.dataset.qid;
      if (!_testsState.answers[qid]) _testsState.answers[qid] = {};
      _testsState.answers[qid].written_text = ta.value;
      _testsSaveAnswers(savedKey);
      // Auto-grow
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
  });

  // Submit buttons
  const submitFn = () => _testsSubmitExam(examId, subId);
  document.getElementById('tests-submit-now-btn')?.addEventListener('click', () => {
    if (!confirm('Submit the exam now? You cannot change your answers after submitting.')) return;
    submitFn();
  });
  document.getElementById('tests-submit-bottom-btn')?.addEventListener('click', () => {
    if (!confirm('Submit the exam now? You cannot change your answers after submitting.')) return;
    submitFn();
  });
}

function _testsSaveAnswers(key) {
  try {
    localStorage.setItem(key, JSON.stringify(_testsState.answers));
  } catch {}
}

function _testsBlockContextMenu(e) { e.preventDefault(); return false; }
function _testsBlockCopy(e) { e.preventDefault(); return false; }
function _testsBlockPaste(e) { e.preventDefault(); return false; }

function _testsBindTabGuard(examId, subId) {
  document.addEventListener('visibilitychange', _testsTabHandler);
  window._testsTabExamId = examId;
  window._testsTabSubId = subId;
}

function _testsTabHandler() {
  if (document.visibilityState === 'hidden') {
    if (!_testsState.tabWarned) {
      _testsState.tabWarned = true;
      // Will show warning when coming back
    } else {
      // Second tab switch — auto-submit
      _testsSubmitExam(window._testsTabExamId, window._testsTabSubId, true);
    }
  } else if (document.visibilityState === 'visible' && _testsState.tabWarned) {
    _testsToast('Warning: Tab switch detected. Next time will auto-submit!', 'error', 6000);
  }
}

function _testsStartTimer(examId, subId) {
  clearInterval(_testsState.timerIv);
  const timerEl = document.getElementById('tests-timer');
  if (!timerEl) return;

  function tick() {
    const elapsed = Date.now() - _testsState.startedAt;
    const remaining = Math.max(0, _testsState.timeLimitMs - elapsed);
    const totalSec = Math.floor(remaining / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const display = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

    const el = document.getElementById('tests-timer');
    if (!el) { clearInterval(_testsState.timerIv); return; }
    el.textContent = display;

    if (remaining <= 5 * 60 * 1000) el.classList.add('danger');
    else el.classList.remove('danger');

    if (remaining <= 0) {
      clearInterval(_testsState.timerIv);
      el.textContent = '00:00';
      _testsToast('Time up! Auto-submitting...', 'error');
      setTimeout(() => _testsSubmitExam(examId, subId, true), 1500);
    }
  }

  tick();
  _testsState.timerIv = setInterval(tick, 1000);
}

async function _testsSubmitExam(examId, subId, autoSubmit = false) {
  clearInterval(_testsState.timerIv);
  document.removeEventListener('contextmenu', _testsBlockContextMenu);
  document.removeEventListener('copy', _testsBlockCopy);
  document.removeEventListener('cut', _testsBlockCopy);
  document.removeEventListener('paste', _testsBlockPaste);
  document.removeEventListener('visibilitychange', _testsTabHandler);

  // Collect answers
  const answers = [];
  const exam = _testsState.exam;
  for (const q of exam.questions) {
    const saved = _testsState.answers[q.id] || {};
    answers.push({
      question_id: q.id,
      selected_option_ids: saved.selected_option_ids || null,
      written_text: saved.written_text || null,
    });
  }

  // Show submitting overlay
  const app = document.getElementById('app');
  app.innerHTML = `<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
    <div class="spinner" style="width:40px;height:40px"></div>
    <p style="font-size:1rem;font-weight:600">${autoSubmit ? 'Auto-submitting exam...' : 'Submitting exam...'}</p>
  </div>`;

  try {
    const result = await apiJson(`/tests/${examId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    });
    // Clean up saved answers
    const savedKey = `mac_test_answers_${examId}_${subId}`;
    localStorage.removeItem(savedKey);
    // Show results
    _testsRenderResultFromData(result);
  } catch (e) {
    app.innerHTML = `<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
      <p style="color:var(--danger)">Submit failed: ${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="render()">Go Back</button>
    </div>`;
  }
}

// ── Result Page ──────────────────────────────────────────────────────────
async function _testsRenderResultPage(examId) {
  const app = document.getElementById('app');
  const el = document.getElementById('page-content');
  const target = el || app;
  if (target) target.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading results...</span></div>';

  try {
    const result = await apiJson(`/tests/${examId}/result`);
    _testsRenderResultFromData(result, !!el);
  } catch (e) {
    if (target) target.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
  }
}

function _testsRenderResultFromData(result, inShell = false) {
  const app = document.getElementById('app');
  const pct = result.percentage;
  const pctColor = pct >= 60 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const pctLabel = pct >= 60 ? 'Passed' : pct >= 40 ? 'Average' : 'Needs Improvement';
  const isPending = result.answers.some(a => a.question_type === 'written' && a.ai_score === null && a.manual_score === null);

  const html = `
    <div class="tests-result-page${inShell ? '' : ' standalone'}">
      ${!inShell ? `<div class="tests-result-topbar">
        <span style="font-weight:700;color:var(--accent)">MAC Tests</span>
        <button class="btn btn-sm btn-outline" onclick="render()">Back to Dashboard</button>
      </div>` : `<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <button class="btn btn-sm btn-outline" onclick="navigate('tests')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <h2 style="margin:0">Exam Results</h2>
      </div>`}

      <!-- Score Summary -->
      <div class="card tests-result-summary">
        <div style="text-align:center;padding:8px 0 16px">
          <div style="font-size:2.5rem;font-weight:900;color:${pctColor};line-height:1">${pct != null ? pct + '%' : '—'}</div>
          <div style="font-size:.85rem;font-weight:700;color:${pctColor};margin:4px 0 12px">${pct != null ? pctLabel : 'Pending'}</div>
          <div style="font-size:.88rem;color:var(--fg-secondary)">${result.total_score ?? '—'} / ${result.max_score} marks</div>
          <div style="font-size:.78rem;color:var(--muted);margin-top:4px">${esc(result.exam_title)} &middot; ${esc(result.exam_subject)}</div>
        </div>
        ${isPending ? `<div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:8px;padding:10px 14px;text-align:center;font-size:.82rem;color:var(--color-log)">
          Written answers are being reviewed by AI. Check back for updated scores.
        </div>` : ''}
      </div>

      <!-- Per-question Breakdown -->
      <h3 style="margin:20px 0 12px">Answer Review</h3>
      <div class="tests-result-answers">
        ${result.answers.map((a, i) => _testsResultAnswerCard(a, i)).join('')}
      </div>
    </div>
  `;

  if (inShell) {
    const el = document.getElementById('page-content');
    if (el) el.innerHTML = html;
  } else {
    app.innerHTML = `<div style="max-width:800px;margin:0 auto;padding:20px">${html}</div>`;
  }
}

function _testsResultAnswerCard(a, idx) {
  const isPending = a.question_type === 'written' && a.ai_score === null && a.manual_score === null;
  const isCorrect = a.is_correct === true;
  const earned = a.earned_marks;
  const borderColor = a.question_type !== 'written'
    ? (isCorrect ? '#10b981' : '#ef4444')
    : (isPending ? 'var(--border)' : '#3b82f6');

  return `
    <div class="card" style="margin-bottom:12px;padding:16px;border-left:3px solid ${borderColor}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap">
        <div>
          <div style="font-size:.75rem;color:var(--muted);margin-bottom:4px">Q${idx+1} &middot; ${a.question_type.toUpperCase()} &middot; ${a.marks} marks</div>
          <div style="font-weight:500">${esc(a.question_text)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${a.question_type !== 'written' ? `
            <div style="font-size:.85rem;font-weight:700;color:${isCorrect?'#10b981':'#ef4444'}">${isCorrect ? '✓ Correct' : '✗ Incorrect'}</div>
            <div style="font-size:.78rem;color:var(--muted)">${earned ?? 0} / ${a.marks}</div>
          ` : `
            <div style="font-size:.85rem;font-weight:700;color:${isPending?'var(--muted)':'#3b82f6'}">${isPending ? '⏳ Pending' : `${earned ?? '—'} / ${a.marks}`}</div>
          `}
        </div>
      </div>

      ${a.question_type === 'written' ? `
        <div style="background:var(--hover);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:.85rem">${esc(a.written_text || '(no answer)')}</div>
        ${a.ai_feedback ? `<div style="font-size:.78rem;color:var(--muted);font-style:italic">AI Feedback: ${esc(a.ai_feedback)}</div>` : ''}
      ` : `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          ${(a.all_options || []).map(o => {
            const isSelected = (a.selected_option_ids || []).includes(o.id);
            const isCorr = (a.correct_option_ids || []).includes(o.id);
            const bg = isCorr ? 'rgba(16,185,129,.12)' : isSelected ? 'rgba(239,68,68,.12)' : 'var(--hover)';
            const border = isCorr ? 'rgba(16,185,129,.4)' : isSelected ? 'rgba(239,68,68,.4)' : 'var(--border)';
            const color = isCorr ? '#10b981' : isSelected ? '#ef4444' : 'var(--fg-secondary)';
            const prefix = isSelected ? (isCorr ? '✓ ' : '✗ ') : (isCorr ? '○ ' : '');
            return `<span style="font-size:.78rem;padding:3px 10px;border-radius:999px;background:${bg};color:${color};border:1px solid ${border}">${prefix}${esc(o.option_text)}</span>`;
          }).join('')}
        </div>
      `}
      ${a.explanation ? `<div style="font-size:.75rem;color:var(--muted);font-style:italic;margin-top:4px;padding-top:8px;border-top:1px solid var(--border)">Explanation: ${esc(a.explanation)}</div>` : ''}
      ${a.model_answer && a.question_type === 'written' ? `<div style="font-size:.75rem;color:var(--muted);margin-top:4px;padding-top:8px;border-top:1px solid var(--border)"><strong>Model Answer:</strong> ${esc(a.model_answer)}</div>` : ''}
    </div>
  `;
}

// ── Toast Helper ──────────────────────────────────────────────────────────
function _testsToast(msg, type = 'info', duration = 3500) {
  const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6' };
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${colors[type]||colors.info};color:#fff;padding:10px 18px;border-radius:10px;font-size:.85rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.2);max-width:340px;animation:fadeInUp .25s ease`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 350); }, duration);
}

// ── CSS injection for tests page ──────────────────────────────────────────
(function _testsInjectCSS() {
  if (document.getElementById('tests-css')) return;
  const style = document.createElement('style');
  style.id = 'tests-css';
  style.textContent = `
    .tests-page { padding: 0; }
    .tests-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; gap: 12px; flex-wrap: wrap; }
    .tests-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .tests-exam-card { transition: transform .15s, box-shadow .15s; }
    .tests-exam-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.1); }
    .tests-student-card { transition: transform .15s, box-shadow .15s; }
    .tests-student-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.1); }

    /* Builder */
    .tests-builder { padding: 0; }

    /* Locked Test Page */
    .tests-take-page { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--bg); }
    .tests-take-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: var(--card); border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 12px; }
    .tests-take-instructions { padding: 12px 20px; background: rgba(59,130,246,.06); border-bottom: 1px solid var(--border); font-size: .84rem; color: var(--fg-secondary); flex-shrink: 0; }
    .tests-take-body { flex: 1; overflow-y: auto; padding: 20px; }
    .tests-take-questions { max-width: 720px; margin: 0 auto; }
    .tests-take-question { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
    .tests-take-q-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .tests-take-q-num { width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: var(--accent-text); font-size: .78rem; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .tests-take-q-text { font-size: .92rem; font-weight: 500; margin-bottom: 14px; line-height: 1.6; }
    .tests-take-q-options { display: flex; flex-direction: column; gap: 8px; }
    .tests-take-option { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1.5px solid var(--border); border-radius: 8px; cursor: pointer; font-size: .88rem; transition: all .15s; user-select: none; }
    .tests-take-option:hover { border-color: var(--accent); background: var(--accent-light); }
    .tests-take-option.selected { border-color: var(--accent); background: var(--accent-light); font-weight: 600; }
    .tests-take-option input { flex-shrink: 0; }
    .tests-timer { font-size: 1.1rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: .04em; color: var(--fg); padding: 4px 12px; border-radius: 8px; background: var(--hover); }
    .tests-timer.danger { color: #ef4444; background: rgba(239,68,68,.1); animation: pulse 1s infinite; }

    /* Result Page */
    .tests-result-page { padding: 0; }
    .tests-result-page.standalone { padding: 16px 0; }
    .tests-result-topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .tests-result-summary { margin-bottom: 8px; }
    .tests-result-answers { }

    /* Review Page */
    .tests-review-page, .tests-subs-page { }

    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
    @keyframes fadeInUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }

    @media (max-width: 600px) {
      .tests-grid { grid-template-columns: 1fr; }
      .tests-take-header { padding: 10px 14px; }
      .tests-take-body { padding: 14px; }
    }
  `;
  document.head.appendChild(style);
})();
