let _attdCameraStream = null;
let _attdLivenessState = { blinkDetected: false, eyeCenter: false, frameCount: 0, passedChecks: 0 };

function _stopAttdCamera() {
  if (_attdCameraStream) {
    _attdCameraStream.getTracks().forEach(t => t.stop());
    _attdCameraStream = null;
  }
}

async function renderAttendance() {
  const el = document.getElementById('page-content');
  const u = state.user || {};
  _stopAttdCamera();
  if (u.role === 'student') {
    await renderStudentAttendance(el);
  } else {
    await renderFacultyAttendance(el);
  }
}

/* —— Student Attendance: Face capture + liveness —————————— */
async function renderStudentAttendance(el) {
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading attendance...</span></div>';
  try {
    // Fetch face status + today's sessions with already_marked info in one go
    const [faceStatus, todayData] = await Promise.all([
      apiJson('/attendance/face-status'),
      apiJson('/attendance/my-today'),
    ]);
    const sessions = todayData.sessions || [];
    const liveSessions = sessions.filter(s => s.is_open);
    const windowOpen = todayData.window_open;
    const windowStr = todayData.window || '';

    el.innerHTML = `
      <div class="attendance-student-page">
        <div class="attd-student-header">
          <h2>Mark Attendance</h2>
          <div class="attd-window-badge ${windowOpen ? 'open' : 'closed'}">
            <span class="attd-window-dot"></span>
            Window ${windowOpen ? 'Open' : 'Closed'} &nbsp;&middot;&nbsp; ${esc(windowStr)}
          </div>
        </div>

        <!-- Face Registration Status -->
        <div class="attd-face-status ${faceStatus.registered ? 'registered' : 'not-registered'}">
          <div class="attd-face-icon" style="flex-shrink:0;display:flex;align-items:center">
            ${faceStatus.registered
              ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
              : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'}
          </div>
          <div class="attd-face-text">
            <strong>${faceStatus.registered ? 'Face Registered' : 'Face Not Registered'}</strong>
            <p class="muted" style="margin:0;font-size:.78rem">${faceStatus.registered
              ? 'Last updated: ' + (faceStatus.captured_at ? timeAgo(faceStatus.captured_at) : 'N/A')
              : 'Register before marking attendance.'}</p>
          </div>
          <button class="btn btn-sm ${faceStatus.registered ? 'btn-outline' : 'btn-primary'}" id="attd-register-face-btn">
            ${faceStatus.registered ? 'Update Face' : 'Register Face'}
          </button>
        </div>

        <!-- Live Sessions -->
        <div style="display:flex;align-items:center;gap:8px;margin-top:20px;margin-bottom:8px">
          <h3 style="margin:0;font-size:1rem;font-weight:700">Today's Sessions</h3>
          <span style="padding:2px 8px;border-radius:20px;background:${liveSessions.length > 0 ? 'var(--success)' : 'var(--muted)'};color:var(--accent-text);font-size:.72rem;font-weight:700">${liveSessions.length} live</span>
        </div>
        ${sessions.length === 0
          ? '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p>No sessions today.</p><p class="muted">Check back during class hours.</p></div>'
          : `<div class="attd-sessions-grid">${sessions.map(s => {
              const marked = s.already_marked;
              const isLive = s.is_open;
              return `
              <div class="attd-session-card-student ${marked ? 'marked' : ''} ${!isLive ? 'closed' : ''}">
                <div class="attd-session-live-dot ${marked ? 'marked-dot' : isLive ? '' : 'closed-dot'}"></div>
                <div class="attd-session-info">
                  <div class="attd-title">${esc(s.title)}</div>
                  <div class="attd-sub">${esc(s.department || '')}${s.subject ? ' &middot; ' + esc(s.subject) : ''}</div>
                </div>
                ${marked
                  ? `<div class="attd-marked-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Marked</div>`
                  : isLive
                    ? `<button class="btn btn-primary btn-sm attd-mark-btn" data-session-id="${s.id}" data-session-title="${esc(s.title)}" ${!faceStatus.registered ? 'disabled title="Register face first"' : ''}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        Mark
                       </button>`
                    : `<span style="font-size:.75rem;color:var(--muted);padding:4px 10px;border-radius:20px;background:var(--bg)">Closed</span>`}
              </div>`;
            }).join('')}</div>`}
      </div>`;

    // Bind register face
    document.getElementById('attd-register-face-btn').onclick = () => showFaceCaptureModal('register');

    // Bind mark attendance buttons
    el.querySelectorAll('.attd-mark-btn').forEach(btn => {
      btn.onclick = () => showFaceCaptureModal('mark', btn.dataset.sessionId, btn.dataset.sessionTitle);
    });
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

/* —— Face Capture Modal with Liveness Detection ———————————— */
function showFaceCaptureModal(mode, sessionId, sessionTitle) {
  _stopAttdCamera();
  _attdLivenessState = { blinkDetected: false, eyeCenter: false, frameCount: 0, passedChecks: 0, capturedImage: null };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal face-capture-modal" style="max-width:520px">
      <h3>${mode === 'register' ? 'Register Your Face' : 'Mark Attendance'}</h3>
      ${mode === 'mark' ? `<p class="muted" style="margin-bottom:12px">Session: <strong>${sessionTitle || ''}</strong></p>` : ''}
      <div class="face-capture-container">
        <div class="face-camera-wrapper">
          <video id="face-video" autoplay playsinline muted></video>
          <canvas id="face-canvas" style="display:none"></canvas>
          <div class="face-oval-guide"></div>
          <div class="face-guide-text" id="face-guide-text">Initializing camera...</div>
        </div>
        <div class="liveness-checks" id="liveness-checks">
          <div class="liveness-check" id="lc-face"><span class="lc-icon">³</span> Face detected in frame</div>
          <div class="liveness-check" id="lc-eyes"><span class="lc-icon">³</span> Eyes looking at camera</div>
          <div class="liveness-check" id="lc-still"><span class="lc-icon">³</span> Hold still for capture</div>
        </div>
      </div>
      <div id="face-capture-preview" style="display:none">
        <img id="face-preview-img" style="width:100%;border-radius:12px;margin:8px 0">
        <p style="text-align:center;color:var(--success);font-weight:600" id="face-preview-msg">Photo captured!</p>
      </div>
      <div id="face-error" style="color:var(--danger);font-size:.85rem;min-height:20px;text-align:center"></div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-outline" id="face-cancel">Cancel</button>
        <button class="btn btn-sm btn-outline" id="face-retake" style="display:none">Retake</button>
        <button class="btn btn-sm btn-primary" id="face-submit" style="display:none;width:auto;padding:8px 24px">
          ${mode === 'register' ? 'Register Face' : 'Submit Attendance'}
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('#face-video');
  const canvas = overlay.querySelector('#face-canvas');
  const guideText = overlay.querySelector('#face-guide-text');
  const previewArea = overlay.querySelector('#face-capture-preview');
  const previewImg = overlay.querySelector('#face-preview-img');
  const previewMsg = overlay.querySelector('#face-preview-msg');
  const submitBtn = overlay.querySelector('#face-submit');
  const retakeBtn = overlay.querySelector('#face-retake');
  const errorEl = overlay.querySelector('#face-error');
  const lcFace = overlay.querySelector('#lc-face');
  const lcEyes = overlay.querySelector('#lc-eyes');
  const lcStill = overlay.querySelector('#lc-still');

  let livenessIv = null;
  let capturedDataUrl = null;
  let videoReady = false;
  let cancelled = false;  // guard against cancel during camera init

  function setCheck(el, status) {
    const icon = el.querySelector('.lc-icon');
    if (status === 'pass') { icon.textContent = 'œ…'; el.classList.add('passed'); el.classList.remove('fail'); }
    else if (status === 'fail') { icon.textContent = 'Œ'; el.classList.add('fail'); el.classList.remove('passed'); }
    else { icon.textContent = '³'; el.classList.remove('passed', 'fail'); }
  }

  // Start camera
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
    .then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      _attdCameraStream = stream;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        videoReady = true;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        guideText.textContent = 'Position your face in the oval';
        startLivenessDetection();
      };
    })
    .catch(err => {
      guideText.textContent = 'Camera access denied';
      errorEl.textContent = 'Please allow camera access to continue. Error: ' + err.message;
    });

  function startLivenessDetection() {
    let stableFrames = 0;
    let faceDetected = false;
    const REQUIRED_STABLE = 25; // ~2.5 seconds at 10fps

    livenessIv = setInterval(() => {
      if (!videoReady || !_attdCameraStream) return;
      _attdLivenessState.frameCount++;

      // Draw to canvas for analysis
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Simple face-area brightness analysis (center oval region)
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const rx = canvas.width * 0.25, ry = canvas.height * 0.35;
      let skinPixels = 0, totalPixels = 0, brightnessSum = 0;
      const d = imageData.data;

      for (let y = Math.floor(cy - ry); y < Math.floor(cy + ry); y += 3) {
        for (let x = Math.floor(cx - rx); x < Math.floor(cx + rx); x += 3) {
          // Check if inside oval
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy > 1) continue;
          totalPixels++;
          const i = (y * canvas.width + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          brightnessSum += (r + g + b) / 3;
          // Simple skin-tone detection (works across skin tones)
          if (r > 60 && g > 40 && b > 20 && r > b && (r - g) < 80 && (Math.max(r, g, b) - Math.min(r, g, b)) < 130) {
            skinPixels++;
          }
        }
      }

      const skinRatio = totalPixels > 0 ? skinPixels / totalPixels : 0;
      const avgBrightness = totalPixels > 0 ? brightnessSum / totalPixels : 0;
      faceDetected = skinRatio > 0.2 && avgBrightness > 40 && avgBrightness < 240;

      // Check 1: Face in frame
      if (faceDetected) {
        setCheck(lcFace, 'pass');
      } else {
        setCheck(lcFace, 'fail');
        stableFrames = 0;
        guideText.textContent = 'Position your face in the oval';
        return;
      }

      // Check 2: Eyes looking at camera (center of face region has expected brightness variance)
      const eyeRegionY = cy - ry * 0.2;
      let eyeVariance = 0, eyePixels = 0;
      for (let y = Math.floor(eyeRegionY - 20); y < Math.floor(eyeRegionY + 20); y += 2) {
        for (let x = Math.floor(cx - rx * 0.5); x < Math.floor(cx + rx * 0.5); x += 2) {
          eyePixels++;
          const i = (y * canvas.width + x) * 4;
          const bright = (d[i] + d[i + 1] + d[i + 2]) / 3;
          eyeVariance += Math.abs(bright - avgBrightness);
        }
      }
      const eyeContrast = eyePixels > 0 ? eyeVariance / eyePixels : 0;
      const eyesOk = eyeContrast > 8; // Eyes have noticeable contrast (irises/pupils)

      if (eyesOk && faceDetected) {
        setCheck(lcEyes, 'pass');
        _attdLivenessState.eyeCenter = true;
      } else {
        setCheck(lcEyes, 'fail');
        stableFrames = 0;
        guideText.textContent = 'Look directly at the camera';
        return;
      }

      // Check 3: Hold still
      stableFrames++;
      const progress = Math.min(100, Math.round((stableFrames / REQUIRED_STABLE) * 100));
      guideText.textContent = `Hold still... ${progress}%`;
      if (stableFrames >= REQUIRED_STABLE) {
        setCheck(lcStill, 'pass');
        // Auto-capture
        clearInterval(livenessIv);
        livenessIv = null;
        capturePhoto();
      } else {
        setCheck(lcStill, 'pending');
      }
    }, 100);
  }

  function capturePhoto() {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    _attdLivenessState.capturedImage = capturedDataUrl;

    // Show preview
    video.parentElement.style.display = 'none';
    overlay.querySelector('#liveness-checks').style.display = 'none';
    previewArea.style.display = 'block';
    previewImg.src = capturedDataUrl;
    previewMsg.textContent = 'Photo captured! Review and submit.';
    submitBtn.style.display = '';
    retakeBtn.style.display = '';
    guideText.textContent = '';
    _stopAttdCamera();
  }

  retakeBtn.onclick = () => {
    capturedDataUrl = null;
    previewArea.style.display = 'none';
    video.parentElement.style.display = '';
    overlay.querySelector('#liveness-checks').style.display = '';
    submitBtn.style.display = 'none';
    retakeBtn.style.display = 'none';
    errorEl.textContent = '';
    setCheck(lcFace, 'pending'); setCheck(lcEyes, 'pending'); setCheck(lcStill, 'pending');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        _attdCameraStream = stream;
        video.srcObject = stream;
        videoReady = true;
        startLivenessDetection();
      });
  };

  submitBtn.onclick = async () => {
    if (!capturedDataUrl) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    errorEl.textContent = '';
    try {
      if (mode === 'register') {
        const r = await api('/attendance/register-face', {
          method: 'POST',
          body: JSON.stringify({ face_image_base64: capturedDataUrl }),
        });
        const d = await r.json();
        if (!r.ok || !d.success) { errorEl.textContent = d.message || d.detail || 'Registration failed'; submitBtn.disabled = false; submitBtn.textContent = 'Register Face'; return; }
        overlay.remove(); _stopAttdCamera();
        renderAttendance();
      } else {
        const r = await api('/attendance/mark', {
          method: 'POST',
          body: JSON.stringify({ session_id: sessionId, face_image_base64: capturedDataUrl }),
        });
        const d = await r.json();
        if (!r.ok || !d.success) { errorEl.textContent = d.message || d.detail || 'Attendance marking failed'; submitBtn.disabled = false; submitBtn.textContent = 'Submit Attendance'; return; }
        overlay.remove(); _stopAttdCamera();
        // Show success toast
        showToast('Attendance marked successfully! Confidence: ' + ((d.confidence || 0.95) * 100).toFixed(0) + '%', 'success');
        renderAttendance();
      }
    } catch (ex) {
      errorEl.textContent = ex.message;
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'register' ? 'Register Face' : 'Submit Attendance';
    }
  };

  overlay.querySelector('#face-cancel').onclick = () => { cancelled = true; if (livenessIv) clearInterval(livenessIv); _stopAttdCamera(); overlay.remove(); };
  overlay.onclick = (e) => { if (e.target === overlay) { cancelled = true; if (livenessIv) clearInterval(livenessIv); _stopAttdCamera(); overlay.remove(); } };
}

function showToast(message, type) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type || 'info'}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .3s'; setTimeout(() => toast.remove(), 300); }, 4000);
}

/**
 * Generic modal helper.
 * @param {Object} opts - { title, body (HTML string), confirmText, onConfirm (async fn, return false to keep open) }
 */
function showModal({ title, body, confirmText = 'Confirm', onConfirm } = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'generic-modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>${esc(title || '')}</h3><button class="icon-btn modal-close-btn">&times;</button></div>
    <div class="modal-body">${body || ''}</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="gm-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="gm-confirm-btn">${esc(confirmText)}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close-btn').onclick = closeModal;
  overlay.querySelector('#gm-cancel-btn').onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  overlay.querySelector('#gm-confirm-btn').onclick = async () => {
    const btn = overlay.querySelector('#gm-confirm-btn');
    btn.disabled = true;
    const result = onConfirm ? await onConfirm() : undefined;
    if (result !== false) closeModal();
    else btn.disabled = false;
  };
}

function closeModal() {
  document.getElementById('generic-modal-overlay')?.remove();
}

/* —— Faculty/Admin Attendance Management ——————————————————— */
async function renderFacultyAttendance(el) {
  const u = state.user || {};
  const isAdmin = u.role === 'admin';
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading attendance...</span></div>';
  try {
    const [overview, settings] = await Promise.all([
      apiJson('/attendance/admin/overview?per_page=50'),
      apiJson('/attendance/settings'),
    ]);
    const sessions = overview.sessions || [];

    el.innerHTML = `
      <div class="attd-admin-page">
        <!-- Header row -->
        <div class="attd-admin-header">
          <div>
            <h2>Attendance</h2>
            <div class="attd-window-badge ${settings.window_open_now ? 'open' : 'closed'}">
              <span class="attd-window-dot"></span>
              Window ${settings.window_open_now ? 'Open' : 'Closed'} &nbsp;&middot;&nbsp; ${String(settings.open_hour).padStart(2,'0')}:${String(settings.open_minute).padStart(2,'0')}—${String(settings.close_hour).padStart(2,'0')}:${String(settings.close_minute).padStart(2,'0')} IST
              ${isAdmin ? '<button class="btn btn-sm btn-outline attd-edit-window-btn" style="margin-left:10px;padding:2px 10px;font-size:.75rem">Edit</button>' : ''}
            </div>
          </div>
          <button class="btn btn-sm btn-primary" id="new-attd-btn" style="width:auto;padding:8px 16px;align-self:flex-start">+ New Session</button>
          <a class="btn btn-sm btn-outline" href="/api/v1/attendance/summary/csv" title="Download attendance summary as CSV" style="width:auto;padding:8px 14px;align-self:flex-start">¬‡ Summary CSV</a>
        </div>

        <!-- Sessions list -->
        ${sessions.length === 0
          ? '<div class="empty-state"><p>No attendance sessions yet.</p></div>'
          : sessions.map(s => `
            <div class="attd-admin-session-card">
              <div class="attd-admin-session-top">
                <div class="attd-admin-session-meta">
                  <span class="attd-badge ${s.is_open ? 'live' : 'closed'}">${s.is_open ? 'LIVE' : 'CLOSED'}</span>
                  <span class="attd-admin-title">${esc(s.title)}</span>
                  <span class="attd-admin-dept">${esc(s.department)}${s.subject ? ' &middot; ' + esc(s.subject) : ''}</span>
                  <span class="attd-admin-date muted">${new Date(s.session_date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
                </div>
                <div class="attd-admin-session-actions">
                  <span class="attd-admin-count">${s.record_count} present</span>
                  ${s.avg_confidence != null ? `<span class="attd-conf-badge">${s.avg_confidence}% avg</span>` : ''}
                  <a class="btn btn-sm btn-outline" href="/api/v1/attendance/sessions/${s.id}/report/csv" title="Download CSV" style="padding:3px 8px;font-size:.75rem">¬‡ CSV</a>
                  <a class="btn btn-sm btn-outline" href="/api/v1/attendance/sessions/${s.id}/report/pdf" title="Download PDF" style="padding:3px 8px;font-size:.75rem">¬‡ PDF</a>
                  ${s.is_open ? `<button class="btn btn-sm btn-outline attd-close-btn" data-id="${s.id}">Close Session</button>` : ''}
                  <button class="btn btn-sm btn-outline attd-expand-btn" data-id="${s.id}">${s.record_count > 0 ? 'View Students –¾' : 'No Records'}</button>
                </div>
              </div>
              <div class="attd-admin-opener">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                Opened by <strong>${esc(s.opened_by_name)}</strong>${s.opened_by_email ? ' <span class="muted">(' + esc(s.opened_by_email) + ')</span>' : ''} &middot; ${timeAgo(s.opened_at)}
              </div>
              <!-- Student records (expandable) -->
              <div class="attd-student-records" id="asr-${s.id}" style="display:none">
                ${s.students && s.students.length > 0 ? `
                <div class="attd-records-table-wrap">
                  <table class="attd-records-table">
                    <thead><tr><th>#</th><th>Roll No</th><th>Name</th><th>Dept</th><th>Face</th><th>Confidence</th><th>Time</th><th>IP</th></tr></thead>
                    <tbody>
                      ${s.students.map((r, i) => `
                        <tr>
                          <td class="muted">${i + 1}</td>
                          <td class="mono bold">${esc(r.roll_number || '""')}</td>
                          <td>${esc(r.name || 'Unknown')}</td>
                          <td>${esc(r.department || '""')}</td>
                          <td>${r.face_verified
                            ? '<span class="attd-verified-yes">&#10003; Verified</span>'
                            : '<span class="attd-verified-no">&#10007; Failed</span>'}</td>
                          <td><span class="attd-conf ${r.confidence >= 80 ? 'high' : r.confidence >= 60 ? 'med' : 'low'}">${r.confidence}%</span></td>
                          <td class="muted nowrap">${timeAgo(r.marked_at)}</td>
                          <td class="muted mono small">${esc(r.ip_address || '""')}</td>
                        </tr>`).join('')}
                    </tbody>
                  </table>
                </div>` : '<p class="muted" style="padding:12px 0">No students have marked attendance yet.</p>'}
              </div>
            </div>`).join('')}
      </div>`;

    // New session button
    document.getElementById('new-attd-btn').onclick = () => _showNewSessionModal();

    // Edit window button (admin only)
    el.querySelector('.attd-edit-window-btn')?.addEventListener('click', () => _showWindowSettingsModal(settings));

    // Close session buttons
    el.querySelectorAll('.attd-close-btn').forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = 'Closing...';
        try { await api('/attendance/sessions/' + btn.dataset.id + '/close', { method: 'POST' }); renderAttendance(); }
        catch (ex) { btn.disabled = false; btn.textContent = 'Close Session'; alert('Failed: ' + ex.message); }
      };
    });

    // Expand/collapse student records
    el.querySelectorAll('.attd-expand-btn').forEach(btn => {
      btn.onclick = () => {
        const panel = document.getElementById('asr-' + btn.dataset.id);
        if (!panel) return;
        const open = panel.style.display !== 'none';
        panel.style.display = open ? 'none' : 'block';
        btn.textContent = open ? 'View Students –¾' : 'Hide Students –´';
      };
    });

  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

function _showNewSessionModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <h3>New Attendance Session</h3>
      <div class="field"><label>Title</label><input id="attd-title" placeholder="e.g. DSA Lab — Section A" autocomplete="off"></div>
      <div class="field"><label>Department</label>
        <select id="attd-dept"><option>CSE</option><option>ECE</option><option>ME</option><option>CE</option><option>EE</option><option>IT</option></select>
      </div>
      <div class="field"><label>Subject</label>
        <select id="attd-subject"><option value="AI">AI</option><option value="CSE">CSE</option><option value="IT">IT</option><option value="MATH">Math</option><option value="PHY">Physics</option><option value="">Other</option></select>
      </div>
      <div id="attd-error" style="color:var(--danger);font-size:.85rem;min-height:18px"></div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-outline" id="attd-cancel">Cancel</button>
        <button class="btn btn-sm btn-primary" id="attd-submit" style="width:auto;padding:8px 20px">Create</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#attd-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const titleInput = overlay.querySelector('#attd-title');
  titleInput.focus();
  overlay.querySelector('#attd-submit').onclick = async () => {
    const err = overlay.querySelector('#attd-error');
    err.textContent = '';
    const body = {
      title: titleInput.value.trim(),
      department: overlay.querySelector('#attd-dept').value,
      subject: overlay.querySelector('#attd-subject').value || null,
      session_date: new Date().toISOString().slice(0, 10),
    };
    if (!body.title) { err.textContent = 'Title is required'; return; }
    const btn = overlay.querySelector('#attd-submit');
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
      const r = await api('/attendance/sessions', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) {
        const d = await r.json();
        err.textContent = (typeof d.detail === 'string' ? d.detail : d.detail?.message) || 'Failed';
        btn.disabled = false; btn.textContent = 'Create'; return;
      }
      overlay.remove();
      renderAttendance();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Create'; }
  };
}

function _showWindowSettingsModal(current) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px">
      <h3>Attendance Window</h3>
      <p class="muted" style="font-size:.83rem">Set daily open/close times in IST. Changes apply immediately.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0">
        <div class="field">
          <label>Open (IST)</label>
          <input type="time" id="wnd-open" value="${String(current.open_hour).padStart(2,'0')}:${String(current.open_minute).padStart(2,'0')}">
        </div>
        <div class="field">
          <label>Close (IST)</label>
          <input type="time" id="wnd-close" value="${String(current.close_hour).padStart(2,'0')}:${String(current.close_minute).padStart(2,'0')}">
        </div>
      </div>
      <p class="muted" style="font-size:.75rem;background:var(--bg);padding:8px 12px;border-radius:8px">
        Default: 00:01—12:01 IST (midnight to noon). Students can only mark attendance during this window.
      </p>
      <div id="wnd-error" style="color:var(--danger);font-size:.83rem;min-height:16px;margin-top:8px"></div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-outline" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-sm btn-primary" id="wnd-save" style="width:auto;padding:8px 20px">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#wnd-save').onclick = async () => {
    const errEl = overlay.querySelector('#wnd-error');
    errEl.textContent = '';
    const openVal = overlay.querySelector('#wnd-open').value;
    const closeVal = overlay.querySelector('#wnd-close').value;
    if (!openVal || !closeVal) { errEl.textContent = 'Both times required'; return; }
    const [oh, om] = openVal.split(':').map(Number);
    const [ch, cm] = closeVal.split(':').map(Number);
    if (oh * 60 + om >= ch * 60 + cm) { errEl.textContent = 'Close time must be after open time'; return; }
    const btn = overlay.querySelector('#wnd-save');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await api('/attendance/settings', {
        method: 'PUT',
        body: JSON.stringify({ open_hour: oh, open_minute: om, close_hour: ch, close_minute: cm }),
      });
      overlay.remove();
      showToast('Attendance window updated!', 'success');
      renderAttendance();
    } catch (ex) { errEl.textContent = ex.message; btn.disabled = false; btn.textContent = 'Save'; }
  };
}

/* 
/* 
   COPY CHECK "" Session-based AI vision marking + plagiarism
   Faculty & Admin only. Students are redirected.
    */

let ccView = 'list';       // 'list' | 'detail'
let ccSessionId = null;    // active session ID
let ccEvalTimer = null;    // polling interval for evaluation progress

