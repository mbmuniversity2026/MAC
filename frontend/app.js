/* 
   MAC "" MBM AI Cloud  &middot;  PWA Frontend  v3
   Premium Dashboard Edition
    */

// —— API helper ————————————————————————————————————————————
const API = '/api/v1';
const state = {
  token: localStorage.getItem('mac_token'),
  user: null,
  page: 'login',
  flags: {},      // live feature flags from SSE
  updateAvail: null, // { version, url } if an update is available
};
let deferredInstallPrompt = null;
let _notifPollIv = null;
let _flagsEs = null;    // SSE connection for feature flags

// —— i18n "" 19-language support via js/i18n.js (fully offline) ——
// Translations live in frontend/js/i18n.js (loaded before this file).
// Add/change languages there without touching app.js.
function t(k)      { return window.MAC_I18N.t(k); }
function setLang(l){ window.MAC_I18N.setLang(l); render(); }

// —— User-scoped localStorage ——————————————————————————————
function _userKey(key) {
  const uid = state.user?.id || '_anon';
  return `mac_${uid}_${key}`;
}
function userGet(key, fallback) {
  try { const v = localStorage.getItem(_userKey(key)); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function userSet(key, val) { localStorage.setItem(_userKey(key), JSON.stringify(val)); }

// —— Feature flags helpers —————————————————————————————————
function flagOn(key) { return state.flags[key] !== false; }

function connectFeatureFlags() {
  if (_flagsEs) { try { _flagsEs.close(); } catch {} }
  const es = new EventSource(`${API}/features/stream`);
  _flagsEs = es;
  const handle = (e) => {
    try {
      const data = JSON.parse(e.data);
      // snapshot = { key: { enabled, allowed_roles, ... }, ... }
      // update   = { key: { enabled, ... }, ... }
      Object.keys(data).forEach(k => {
        state.flags[k] = data[k]?.enabled ?? data[k];
      });
      _applyFeatureGate();
    } catch {}
  };
  es.addEventListener('snapshot', handle);
  es.addEventListener('update', handle);
  es.onerror = () => {
    es.close();
    _flagsEs = null;
    setTimeout(connectFeatureFlags, 10000);
  };
}

function _applyFeatureGate() {
  const GATE_MAP = {
    chat:       'ai_chat',
    notebooks:  'mbm_book',
    doubts:     'doubts_forum',
    attendance: 'attendance',
    copycheck:  'copy_check',
    fileshare:  'file_sharing',
  };
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach(a => {
    const flag = GATE_MAP[a.dataset.page];
    if (flag) a.style.display = flagOn(flag) ? '' : 'none';
  });
  // If current page is now disabled, redirect to dashboard
  const cur = state.page;
  if (cur && GATE_MAP[cur] && !flagOn(GATE_MAP[cur])) navigate('dashboard');
}

// —— PWA install prompt capture ————————————————————————————
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = '';
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'none';
});

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  return res;
}
async function apiJson(path, opts) { const r = await api(path, opts); return r.json(); }

// —— Session storage (user-scoped) —————————————————————————
function getSessions() { return userGet('sessions', []); }
function saveSessions(s) { userSet('sessions', s); }
function getSession(id) { return getSessions().find(s => s.id === id); }

// —— Eye toggle SVGs ———————————————————————————————————————
const EYE_OPEN = '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// —— MAC Thinking Animation ————————————————————————————————
function macThinkingHTML() {
  return `<div class="mac-thinking">
    <div class="mac-think-orb">
      <div class="mac-think-ring"></div>
      <div class="mac-think-ring r2"></div>
      <div class="mac-think-ring r3"></div>
      <div class="mac-think-letters">
        <span class="mac-tl" style="--i:0">M</span>
        <span class="mac-tl" style="--i:1">A</span>
        <span class="mac-tl" style="--i:2">C</span>
      </div>
    </div>
    <span class="mac-think-label">Thinking</span>
  </div>`;
}
function startMacThinking(el) {
  const letters = el.querySelectorAll('.mac-tl');
  let active = 0;
  const iv = setInterval(() => {
    letters.forEach((l, i) => l.classList.toggle('lit', i === active));
    active = (active + 1) % letters.length;
  }, 400);
  el._macThinkIv = iv;
}
function stopMacThinking(el) {
  if (el._macThinkIv) { clearInterval(el._macThinkIv); el._macThinkIv = null; }
}

function pwField(id, label, placeholder) {
  return `<div class="field">
    <label>${label}</label>
    <div class="pw-wrap">
      <input type="password" id="${id}" placeholder="${esc(placeholder || '"¢"¢"¢"¢"¢"¢"¢"¢')}" autocomplete="new-password">
      <button type="button" class="pw-toggle" data-target="${id}" title="Toggle visibility">${EYE_CLOSED}</button>
    </div>
  </div>`;
}

function bindEyeToggles(root) {
  (root || document).querySelectorAll('.pw-toggle').forEach(btn => {
    btn.onclick = () => {
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OPEN : EYE_CLOSED;
    };
  });
}

// —— Theme —————————————————————————————————————————————————
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mac_theme', theme);
}

// Apply saved theme immediately (default: warm)
(function() {
  const saved = localStorage.getItem('mac_theme') || 'warm';
  document.documentElement.setAttribute('data-theme', saved);
})();

// —— Router  (auth helpers moved to js/auth.js) ————————————————————————————————————————————————
function navigate(page) {
  if (state.user && state.user.must_change_password && page !== 'set-password' && page !== 'login') {
    page = 'set-password';
  }
  state.page = page;
  window.history.pushState({}, '', page === 'login' ? '/' : `#${page}`);
  if (page !== 'login' && page !== 'set-password') localStorage.setItem('mac_last_page', page);
  render();
}

window.addEventListener('popstate', () => {
  if (state.user && state.user.must_change_password) {
    window.history.pushState({}, '', '#set-password');
    state.page = 'set-password';
    render();
    return;
  }
  const hash = location.hash.slice(1);
  state.page = hash || (state.token ? 'dashboard' : 'login');
  render();
});

// —— Bootstrap —————————————————————————————————————————————
async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/static/sw.js', {scope: '/'});
  if (state.token) {
    try {
      const u = await apiJson('/auth/me');
      state.user = u;
      if (u.must_change_password) {
        state.token = null; state.user = null;
        localStorage.removeItem('mac_token');
        state.page = 'login';
      } else {
        state.page = location.hash.slice(1) || localStorage.getItem('mac_last_page') || 'dashboard';
        // Load user-scoped data
        _nbLoadFromStorage();
        // Subscribe to push notifications
        subscribeToPush();
        // Request browser notification permission
        requestNotificationPermission();
        // Start real-time notification polling
        startNotifPolling();
        // Connect feature flags SSE
        connectFeatureFlags();
        // Check for available update (non-blocking)
        apiJson('/system/update-status').then(upd => {
          if (upd?.update_available) state.updateAvail = { version: upd.latest_version, url: upd.release_url || '#' };
        }).catch(() => {});
      }
    } catch { state.token = null; localStorage.removeItem('mac_token'); state.page = 'login'; }
  }
  render();
}

let _dashRefreshIv = null;
function render() {
  // Clear dashboard auto-refresh when navigating away
  if (_dashRefreshIv) { clearInterval(_dashRefreshIv); _dashRefreshIv = null; }
  const app = document.getElementById('app');
  if (!state.token || state.page === 'login') { app.innerHTML = authPage(); bindAuth(); runIntroIfNeeded(); return; }
  if (state.user && state.user.must_change_password) {
    state.page = 'set-password';
    window.history.replaceState({}, '', '#set-password');
    app.innerHTML = setPasswordPage(); bindSetPassword(); bindEyeToggles();
    return;
  }
  if (state.page === 'set-password') { app.innerHTML = setPasswordPage(); bindSetPassword(); bindEyeToggles(); return; }
  app.innerHTML = shell();
  bindShell();
  if (state.page === 'dashboard') {
    renderDashboard();
    _dashRefreshIv = setInterval(() => { if (state.page === 'dashboard') renderDashboard(); }, 30000);
  }
  else if (state.page === 'chat') {
    if (!flagOn('ai_chat')) { navigate('dashboard'); return; }
    renderChat();
  }
  else if (state.page === 'notebooks') {
    if (!flagOn('mbm_book')) { navigate('dashboard'); return; }
    renderNotebooks();
  }
  else if (state.page === 'admin') renderAdmin();
  else if (state.page === 'settings') renderSettings();
  else if (state.page === 'doubts') renderDoubts();
  else if (state.page === 'attendance') renderAttendance();
  else if (state.page === 'copycheck') renderCopyCheck();
  else if (state.page === 'fileshare') {
    if (!flagOn('file_sharing')) { navigate('dashboard'); return; }
    renderFileShare();
  }
  else { state.page = 'dashboard'; renderDashboard(); _dashRefreshIv = setInterval(() => { if (state.page === 'dashboard') renderDashboard(); }, 30000); }
}

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('mac_token');
  if (_notifPollIv) { clearInterval(_notifPollIv); _notifPollIv = null; }
  if (_flagsEs) { try { _flagsEs.close(); } catch {} _flagsEs = null; }
  _nbState.notebooks = []; _nbState.current = null; _nbState.cells = []; _nbState.outputs = {};
  navigate('login');
}

function showAbout() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.52);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
  el.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:20px;padding:40px 36px 32px;max-width:440px;width:90%;text-align:center;position:relative;box-shadow:0 12px 48px rgba(0,0,0,.22);">
      <button onclick="this.closest('[style*=fixed]').remove()" style="position:absolute;top:14px;right:14px;background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--muted);line-height:1;padding:4px 8px;border-radius:6px;transition:background .15s;" onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background='none'">&times;</button>
      <div style="font-size:3.2rem;margin-bottom:6px;"><span class="glitch" data-text="MAC">MAC</span></div>
      <div style="font-weight:800;font-size:1.15rem;margin-bottom:3px;letter-spacing:.01em;">MBM AI Cloud</div>
      <div style="color:var(--muted);font-size:.8rem;margin-bottom:18px;letter-spacing:.04em;text-transform:uppercase;">Self-Hosted AI Inference Platform</div>
      <div style="font-size:.85rem;color:var(--fg-secondary);line-height:1.75;margin-bottom:20px;padding:14px 16px;background:var(--bg-secondary,var(--bg));border-radius:10px;border:1px solid var(--border);">
        Built for <strong>MBM University, Jodhpur</strong> &mdash; by MBM, for MBM.<br>
        Runs fully offline on the college LAN.<br>
        Powered by open-source models via vLLM &amp; Ollama.<br>
        <span style="color:var(--muted);font-size:.78rem;">This is <em>not</em> an Apple Inc. product.</span>
      </div>
      <div style="font-size:.75rem;color:var(--muted);line-height:1.8;margin-bottom:16px;">
        &copy; 2026 MBM University, Jodhpur &mdash; MBM AI Cloud<br>
        <span style="font-size:.7rem;">Licensed under the <strong style="color:var(--accent)">MBM Open License</strong> &mdash; free to use within MBM campus network.</span>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;font-size:.7rem;color:var(--muted);flex-wrap:wrap;">
        <span style="background:var(--hover);padding:3px 10px;border-radius:20px;">v1.0.0</span>
        <span style="background:var(--hover);padding:3px 10px;border-radius:20px;">FastAPI + Vanilla JS</span>
        <span style="background:var(--hover);padding:3px 10px;border-radius:20px;">MBM License</span>
      </div>
    </div>`;
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  document.body.appendChild(el);
}

async function installPWA() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice;
  if (result.outcome === 'accepted') deferredInstallPrompt = null;
}

/* 
   INTRO ANIMATION "" MBM &rarr; MAC first-visit morph
    */
function runIntroIfNeeded() {
  if (localStorage.getItem('mac_intro_seen')) return;
  localStorage.setItem('mac_intro_seen', '1');

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;pointer-events:none;';
  overlay.innerHTML = `
    <div id="intro-text" style="font-size:clamp(3rem,12vw,7rem);font-family:'Courier New',monospace;font-weight:900;letter-spacing:.15em;color:var(--fg);transition:all .4s ease"></div>
    <div id="intro-sub" style="font-size:1rem;color:var(--muted);letter-spacing:.2em;text-transform:uppercase;opacity:0;transition:opacity .4s">MBM AI Cloud</div>
  `;
  document.body.appendChild(overlay);

  const text = overlay.querySelector('#intro-text');
  const sub = overlay.querySelector('#intro-sub');

  const steps = ['M', 'MB', 'MBM', 'MBM', 'M_M', 'M_C', 'MAC'];
  let i = 0;
  function step() {
    if (i < steps.length) {
      text.textContent = steps[i];
      i++;
      setTimeout(step, i < 4 ? 200 : 120);
    } else {
      sub.style.opacity = '1';
      setTimeout(() => {
        overlay.style.transition = 'opacity .5s';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 520);
      }, 900);
    }
  }
  setTimeout(step, 200);
}

/* Auth page, bindAuth, setPasswordPage, bindSetPassword
   &rarr; moved to js/auth.js */

function shell() {
  const u = state.user || {};
  const isAdmin = u.role === 'admin';
  const isFacultyOrAdmin = u.role === 'faculty' || u.role === 'admin';
  const isStudent = u.role === 'student';
  const pages = { dashboard: 'Dashboard', chat: 'Chat', notebooks: 'MBM Book', doubts: 'Doubts', attendance: 'Attendance', copycheck: 'Copy Check', fileshare: 'Shared Files', settings: 'Settings', admin: 'Admin' };
  const dockSide = localStorage.getItem('mac_dock_side') || 'left';
  return `
  <div class="shell dock-${dockSide}" id="shell">
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-resize" id="sidebar-resize"></div>
      <div class="sidebar-grip" id="sidebar-grip" title="Drag to dock sidebar to any edge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>
      </div>
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <div class="brand"><span class="glitch" data-text="MAC">MAC</span></div>
        </div>
        <div class="sidebar-nav">
          <a href="#dashboard" data-page="dashboard" class="${state.page==='dashboard'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span>${t('dashboard')}</span>
          </a>
          <a href="#chat" data-page="chat" class="${state.page==='chat'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>${t('chat')}</span>
          </a>
          <a href="#notebooks" data-page="notebooks" class="${state.page==='notebooks'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span>${t('notebooks')}</span>
          </a>
          <a href="#doubts" data-page="doubts" class="${state.page==='doubts'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>${t('doubts')}</span>
          </a>
          <a href="#attendance" data-page="attendance" class="${state.page==='attendance'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg>
            <span>${t('attendance')}</span>
          </a>
          ${isFacultyOrAdmin ? `<a href="#copycheck" data-page="copycheck" class="${state.page==='copycheck'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
            <span>${t('copycheck')}</span>
          </a>` : ''}
          <a href="#fileshare" data-page="fileshare" class="${state.page==='fileshare'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            <span>${t('fileshare')}</span>
          </a>
          <a href="#settings" data-page="settings" class="${state.page==='settings'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>${t('settings')}</span>
          </a>
          ${isAdmin ? `<a href="#admin" data-page="admin" class="${state.page==='admin'?'active':''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>${t('admin')}</span>
          </a>` : ''}
        </div>
        <div class="sidebar-user">
          <div class="user-avatar">${(u.name || '?')[0].toUpperCase()}</div>
          <div>
            <div class="name">${esc(u.name || '')}</div>
            <div style="font-size:.75rem">${esc(u.roll_number || '')} &middot; <span class="badge badge-${u.role}">${esc(u.role || '')}</span></div>
          </div>
        </div>
        <button class="btn btn-sm btn-outline sidebar-logout" onclick="showAbout()" style="margin-bottom:4px;color:var(--muted);font-size:.75rem;border-color:var(--border)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>About MAC</span>
        </button>
        <button class="btn btn-sm btn-outline sidebar-logout" onclick="logout()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>${t('logout')}</span>
        </button>
      </div>
    </nav>
    <div class="main-content">
      ${state.updateAvail ? `<div class="update-banner" id="update-banner">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>
        MAC ${esc(state.updateAvail.version)} is available.
        <a href="${esc(state.updateAvail.url)}" target="_blank" rel="noopener" style="font-weight:700;text-decoration:underline;margin-left:4px">View release</a>
        <button onclick="document.getElementById('update-banner').remove()" style="margin-left:8px;opacity:.7;font-size:1rem;line-height:1">&times;</button>
      </div>` : ''}
      <div class="topbar">
        <button class="btn btn-sm menu-btn" id="menu-toggle">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <h1>${pages[state.page] || 'Dashboard'}</h1>
        <div class="topbar-right">
          <button class="btn btn-sm pwa-install-btn" id="pwa-install-btn" style="display:${deferredInstallPrompt?'':'none'}" onclick="installPWA()" title="Install MAC App">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Install</span>
          </button>
          <div class="notif-bell" id="notif-bell" title="Notifications">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span class="notif-badge" id="notif-count"></span>
          </div>
          <span class="status-dot"></span>
          <span style="font-size:.75rem;color:var(--muted)">Online</span>
        </div>
      </div>
      <div class="page" id="page-content"></div>
    </div>
  </div>
  <div class="notif-panel" id="notif-panel">
    <div class="notif-panel-header">
      <h3>Notifications</h3>
      <button class="btn btn-sm btn-outline" id="notif-mark-all" style="padding:4px 10px;font-size:.72rem">Mark all read</button>
    </div>
    <div class="notif-list" id="notif-list">
      <div class="notif-empty">No notifications</div>
    </div>
  </div>`;
}

function bindShell() {
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); closeSidebar(); navigate(a.dataset.page); };
  });
  const toggle = document.getElementById('menu-toggle');
  const overlay = document.getElementById('sidebar-overlay');
  if (toggle) toggle.onclick = () => {
    document.getElementById('shell').classList.toggle('sidebar-open');
  };
  if (overlay) overlay.onclick = closeSidebar;

  // —— Resizable sidebar (drag edge) ——————————————————————
  const shellEl = document.getElementById('shell');
  const sidebar = document.getElementById('sidebar');
  const resizeHandle = document.getElementById('sidebar-resize');

  if (resizeHandle && sidebar) {
    let startPos, startSize;
    resizeHandle.onmousedown = (e) => {
      e.preventDefault();
      const side = getCurrentDockSide();
      const rect = sidebar.getBoundingClientRect();
      startPos = (side === 'left' || side === 'right') ? e.clientX : e.clientY;
      startSize = (side === 'left' || side === 'right') ? rect.width : rect.height;
      document.body.style.cursor = (side === 'left' || side === 'right') ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        const curSide = getCurrentDockSide();
        let delta;
        if (curSide === 'left') delta = ev.clientX - startPos;
        else if (curSide === 'right') delta = startPos - ev.clientX;
        else if (curSide === 'top') delta = ev.clientY - startPos;
        else delta = startPos - ev.clientY;
        let size = startSize + delta;
        const isHoriz = curSide === 'left' || curSide === 'right';
        const minSize = isHoriz ? 52 : 42;
        const maxSize = isHoriz ? 400 : 300;
        size = Math.max(minSize, Math.min(maxSize, size));
        if (isHoriz) {
          sidebar.style.width = size + 'px';
          sidebar.style.height = '';
          sidebar.classList.toggle('compact', size <= 70);
        } else {
          sidebar.style.height = size + 'px';
          sidebar.style.width = '';
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    // Double-click to toggle compact/expanded
    resizeHandle.ondblclick = () => {
      const side = getCurrentDockSide();
      if (side === 'left' || side === 'right') {
        const w = sidebar.getBoundingClientRect().width;
        if (w > 70) {
          sidebar.style.width = '52px';
          sidebar.classList.add('compact');
        } else {
          sidebar.style.width = '230px';
          sidebar.classList.remove('compact');
        }
      } else {
        const h = sidebar.getBoundingClientRect().height;
        sidebar.style.height = (h > 60 ? '42px' : '120px');
      }
    };
  }

  // —— Drag sidebar grip to dock to any edge ——————————————
  const grip = document.getElementById('sidebar-grip');
  if (grip && sidebar) {
    let dragOverlay;
    grip.onmousedown = (e) => {
      e.preventDefault();
      // Create full-screen overlay with edge zones
      dragOverlay = document.createElement('div');
      dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:grabbing;';
      const indicator = document.createElement('div');
      indicator.style.cssText = 'position:fixed;background:rgba(0,0,0,.06);border:2px dashed rgba(0,0,0,.2);transition:all .15s;border-radius:4px;pointer-events:none;z-index:10000;';
      dragOverlay.appendChild(indicator);
      document.body.appendChild(dragOverlay);

      function getZone(cx, cy) {
        const w = window.innerWidth, h = window.innerHeight;
        const edgeSize = 80;
        if (cx < edgeSize) return 'left';
        if (cx > w - edgeSize) return 'right';
        if (cy < edgeSize) return 'top';
        if (cy > h - edgeSize) return 'bottom';
        return null;
      }
      function showIndicator(zone) {
        if (!zone) { indicator.style.display = 'none'; return; }
        indicator.style.display = 'block';
        if (zone === 'left') { indicator.style.cssText += 'top:0;left:0;width:230px;height:100%;'; }
        else if (zone === 'right') { indicator.style.cssText += 'top:0;right:0;left:auto;width:230px;height:100%;'; }
        else if (zone === 'top') { indicator.style.cssText += 'top:0;left:0;width:100%;height:60px;'; }
        else if (zone === 'bottom') { indicator.style.cssText += 'bottom:0;left:0;top:auto;width:100%;height:60px;'; }
      }
      function onMove(ev) {
        const zone = getZone(ev.clientX, ev.clientY);
        showIndicator(zone);
      }
      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        dragOverlay.remove();
        const zone = getZone(ev.clientX, ev.clientY);
        if (zone) setDockSide(zone);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }

  function getCurrentDockSide() {
    if (shellEl.classList.contains('dock-right')) return 'right';
    if (shellEl.classList.contains('dock-top')) return 'top';
    if (shellEl.classList.contains('dock-bottom')) return 'bottom';
    return 'left';
  }

  function setDockSide(side) {
    shellEl.classList.remove('dock-left', 'dock-right', 'dock-top', 'dock-bottom');
    shellEl.classList.add('dock-' + side);
    sidebar.style.width = '';
    sidebar.style.height = '';
    sidebar.classList.remove('compact');
    localStorage.setItem('mac_dock_side', side);
    // Reset sizes based on side
    if (side === 'left' || side === 'right') {
      sidebar.style.width = '230px';
    } else {
      sidebar.style.height = '52px';
    }
  }

  // Notification bell
  const bell = document.getElementById('notif-bell');
  const panel = document.getElementById('notif-panel');
  if (bell && panel) {
    bell.onclick = (e) => { e.stopPropagation(); panel.classList.toggle('open'); if (panel.classList.contains('open')) loadNotifications(); };
    document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== bell) panel.classList.remove('open'); }, { once: false });
  }
  const markAllBtn = document.getElementById('notif-mark-all');
  if (markAllBtn) markAllBtn.onclick = async () => {
    try { await api('/notifications/read-all', { method: 'POST' }); loadNotifications(); loadNotifCount(); } catch {}
  };
  // Load notification count
  loadNotifCount();
}

function closeSidebar() {
  const shell = document.getElementById('shell');
  if (shell) shell.classList.remove('sidebar-open');
}

/* 
   USER DASHBOARD "" Premium Analytics
    */
async function renderDashboard() {
  const el = document.getElementById('page-content');
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading dashboard...</span></div>';
  try {
    const [me, quota, history, keyStats] = await Promise.all([
      apiJson('/auth/me'),
      apiJson('/usage/me/quota'),
      apiJson('/usage/me/history?per_page=50'),
      apiJson('/keys/my-key/stats').catch(() => null),
    ]);
    state.user = me;
    const q = quota;
    const tokensUsed = q.current?.tokens_used_today || 0;
    const tokensLimit = q.limits?.daily_tokens || 50000;
    const reqsUsed = q.current?.requests_this_hour || 0;
    const reqsLimit = q.limits?.requests_per_hour || 100;
    const tokenPct = Math.min(100, Math.round((tokensUsed / tokensLimit) * 100));
    const reqPct = Math.min(100, Math.round((reqsUsed / reqsLimit) * 100));
    const reqs = history.requests || [];

    // Build activity heatmap data from history
    const heatmapData = buildHeatmapData(reqs);
    // Build model distribution
    const modelDist = {};
    reqs.forEach(r => { modelDist[r.model] = (modelDist[r.model] || 0) + 1; });
    // Build hourly distribution
    const hourlyDist = new Array(24).fill(0);
    reqs.forEach(r => { const h = new Date(r.created_at).getHours(); hourlyDist[h]++; });

    el.innerHTML = `
      <div class="dash-greeting">
        <div>
          <h2>Welcome back, ${esc(me.name.split(' ')[0])}</h2>
          <p>${esc(me.department)} &middot; ${esc(me.role)} &middot; Joined ${new Date(me.created_at).toLocaleDateString('en-IN', {month:'short',year:'numeric'})}</p>
        </div>
        <div class="dash-greeting-api">
          <span class="label">API Key</span>
          <code class="api-key-mini">${esc(me.api_key ? me.api_key.slice(0,8) + '...' + me.api_key.slice(-4) : 'N/A')}</code>
        </div>
      </div>

      <div class="stats-grid stats-4">
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div class="stat-body">
            <div class="label">Tokens Today</div>
            <div class="value">${fmtNum(tokensUsed)}</div>
            <div class="stat-bar"><div class="stat-bar-fill ${tokenPct > 80 ? 'warn' : ''}" style="width:${tokenPct}%"></div></div>
            <div class="sub">${tokenPct}% of ${fmtNum(tokensLimit)}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <div class="stat-body">
            <div class="label">Requests / Hour</div>
            <div class="value">${reqsUsed}</div>
            <div class="stat-bar"><div class="stat-bar-fill ${reqPct > 80 ? 'warn' : ''}" style="width:${reqPct}%"></div></div>
            <div class="sub">${reqPct}% of ${reqsLimit}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
          <div class="stat-body">
            <div class="label">This Week</div>
            <div class="value">${fmtNum(keyStats?.tokens_this_week || 0)}</div>
            <div class="sub">tokens consumed</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
          <div class="stat-body">
            <div class="label">Chat Sessions</div>
            <div class="value">${getSessions().length}</div>
            <div class="sub">saved locally</div>
          </div>
        </div>
      </div>

      <div class="charts-row">
        <div class="chart-card flex-2">
          <div class="chart-header">
            <h3>Activity Heatmap</h3>
            <span class="chart-sub">Your usage pattern over recent days</span>
          </div>
          <div class="heatmap-container" id="heatmap-container"></div>
        </div>
        <div class="chart-card flex-1">
          <div class="chart-header">
            <h3>Model Usage</h3>
            <span class="chart-sub">Distribution by model</span>
          </div>
          <div class="chart-wrap-sm" style="position:relative">
            <canvas id="chart-models"></canvas>
            ${Object.keys(modelDist).length === 0 ? '<div class="chart-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/><line x1="12" y1="12" x2="12" y2="8"/><line x1="12" y1="12" x2="16" y2="12"/></svg><p>No model usage yet</p><span>Start a chat to see distribution</span></div>' : ''}
          </div>
          <div id="model-legend" class="chart-legend"></div>
        </div>
      </div>

      <div class="charts-row">
        <div class="chart-card flex-1">
          <div class="chart-header">
            <h3>Hourly Activity</h3>
            <span class="chart-sub">When you use MAC most</span>
          </div>
          <div style="height:200px;position:relative">
            <canvas id="chart-hourly"></canvas>
            ${hourlyDist.every(v => v === 0) ? '<div class="chart-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg><p>No activity recorded yet</p><span>Use the chat "" your hourly pattern will appear here</span></div>' : ''}
          </div>
        </div>
        <div class="chart-card flex-1">
          <div class="chart-header">
            <h3>Quota Overview</h3>
          </div>
          <div class="quota-rings">
            <div class="ring-wrap">
              <canvas id="chart-tokens" width="160" height="160"></canvas>
              <div class="ring-label"><span class="pct">${tokenPct}%</span><span class="lbl">Tokens</span><span class="ring-used">${fmtNum(tokensUsed)}</span></div>
            </div>
            <div class="ring-wrap">
              <canvas id="chart-reqs" width="160" height="160"></canvas>
              <div class="ring-label"><span class="pct">${reqPct}%</span><span class="lbl">Requests</span><span class="ring-used">${reqsUsed}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-header">
          <h3>Recent Activity</h3>
          <span class="chart-sub">${reqs.length} recent requests</span>
        </div>
        ${reqs.length > 0 ? `
          <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Model</th><th>Endpoint</th><th>Tokens</th><th>Latency</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>
              ${reqs.slice(0,15).map(r => `
                <tr>
                  <td><span class="model-tag">${esc(shortModel(r.model))}</span></td>
                  <td class="mono">${esc(r.endpoint)}</td>
                  <td>${fmtNum(r.tokens_in + r.tokens_out)}</td>
                  <td>${r.latency_ms}ms</td>
                  <td>${r.status_code < 400 ? '<span class="dot-success"></span> OK' : '<span class="dot-error"></span> ' + r.status_code}</td>
                  <td class="muted">${timeAgo(r.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<div class="empty-state"><p>No activity yet. Start a chat or make an API call!</p></div>'}
      </div>

      <div class="chart-card">
        <div class="chart-header">
          <h3>Available Models</h3>
        </div>
        <div id="models-grid" class="models-grid"><div class="muted">Loading...</div></div>
      </div>
    `;

    // Render heatmap
    renderHeatmap('heatmap-container', heatmapData);

    // Donut charts
    makeDonut('chart-tokens', tokensUsed, tokensLimit);
    makeDonut('chart-reqs', reqsUsed, reqsLimit);

    // Model distribution chart
    const modelLabels = Object.keys(modelDist);
    const modelValues = Object.values(modelDist);
    const cs0 = getComputedStyle(document.documentElement);
    const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
    const accentCol = cs0.getPropertyValue('--accent').trim() || '#7c6ff7';
    const fgCol = cs0.getPropertyValue('--fg').trim() || '#111';
    const mutedCol = cs0.getPropertyValue('--muted').trim() || '#888';
    const modelColors = isDarkTheme
      ? [accentCol, '#9b8fff', '#c4baff', '#6b5ce6', '#d4d0ff']
      : ['#111', '#555', '#999', '#bbb', '#ddd'];
    if (modelLabels.length > 0) {
      new Chart(document.getElementById('chart-models'), {
        type: 'doughnut',
        data: { labels: modelLabels.map(shortModel), datasets: [{ data: modelValues, backgroundColor: modelColors.slice(0, modelLabels.length), borderWidth: 2, borderColor: cs0.getPropertyValue('--card').trim() || '#fff', cutout: '68%', hoverOffset: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000', titleColor: '#fff', bodyColor: '#fff', cornerRadius: 8, padding: 10 } } },
      });
      document.getElementById('model-legend').innerHTML = modelLabels.map((m, i) =>
        `<div class="legend-item"><span class="legend-dot" style="background:${modelColors[i % modelColors.length]}"></span>${esc(shortModel(m))}<span class="muted" style="margin-left:auto">${modelValues[i]}</span></div>`
      ).join('');
    }

    // Hourly area chart with gradient
    const hourlyCtx = document.getElementById('chart-hourly').getContext('2d');
    const hourlyGrad = hourlyCtx.createLinearGradient(0, 0, 0, 180);
    hourlyGrad.addColorStop(0, isDarkTheme ? 'rgba(124,111,247,0.35)' : 'rgba(0,0,0,0.18)');
    hourlyGrad.addColorStop(1, isDarkTheme ? 'rgba(124,111,247,0.03)' : 'rgba(0,0,0,0.01)');
    new Chart(hourlyCtx.canvas, {
      type: 'line',
      data: {
        labels: Array.from({length:24}, (_, i) => i + 'h'),
        datasets: [{
          data: hourlyDist,
          fill: true,
          backgroundColor: hourlyGrad,
          borderColor: accentCol,
          borderWidth: 2,
          pointBackgroundColor: accentCol,
          pointBorderColor: cs0.getPropertyValue('--card').trim() || '#fff',
          pointBorderWidth: 2,
          pointRadius: hourlyDist.map(v => v > 0 ? 4 : 0),
          pointHoverRadius: 6,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#000', titleColor: '#fff', bodyColor: '#fff',
            cornerRadius: 8, padding: 10,
            callbacks: { label: (ctx) => ctx.raw + ' request' + (ctx.raw !== 1 ? 's' : '') }
          }
        },
        scales: {
          y: { display: true, beginAtZero: true, grid: { color: isDarkTheme ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }, ticks: { color: mutedCol, font: { size: 10 }, stepSize: 1, precision: 0 } },
          x: { grid: { display: false }, ticks: { color: mutedCol, font: { size: 9 }, maxRotation: 0 } }
        },
        interaction: { intersect: false, mode: 'index' },
      },
    });

    // Models grid
    try {
      const m = await apiJson('/models');
      const list = m.models || [];
      const typeLabel = { chat: 'LLM &middot; Chat', stt: 'Speech &rarr; Text', tts: 'Text &rarr; Speech', embedding: 'Embeddings', vision: 'Vision' };
      document.getElementById('models-grid').innerHTML = list.map(md => `
        <div class="model-card">
          <div class="model-name">${esc(md.id || md.name)}</div>
          <div class="model-type-tag">${esc(typeLabel[md.model_type] || md.model_type || 'Model')}</div>
          <div class="model-status ${md.status === 'loaded' ? 'online' : 'offline'}">${md.status === 'loaded' ? '<span class="status-dot on"></span> Online' : '<span class="status-dot off"></span> Offline'}</div>
        </div>
      `).join('') || '<p class="muted">No models configured</p>';
    } catch { document.getElementById('models-grid').innerHTML = '<p class="muted">Could not load models</p>'; }

  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p><button class="btn btn-sm btn-outline" onclick="renderDashboard()">Retry</button></div>`; }
}

/* 
   HEATMAP "" GitHub-style contribution graph
    */
function buildHeatmapData(requests) {
  const map = {};
  requests.forEach(r => {
    const d = new Date(r.created_at).toISOString().slice(0, 10);
    map[d] = (map[d] || 0) + 1;
  });
  return map;
}

function renderHeatmap(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const hasData = Object.values(data).some(v => v > 0);
  const today = new Date();
  const weeks = 26;
  const totalCols = weeks + 1;
  const days = weeks * 7;
  const maxVal = Math.max(1, ...Object.values(data));

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // align to Sunday

  // --- Month labels: collect which columns each month spans, show year at boundary ---
  const monthSpans = [];
  let curMonth = -1, curYear = -1, spanStart = 0;
  for (let w = 0; w < totalCols; w++) {
    const d = new Date(startDate); d.setDate(d.getDate() + w * 7);
    const m = d.getMonth(), y = d.getFullYear();
    if (m !== curMonth) {
      if (curMonth !== -1) {
        const sd = new Date(startDate.getTime() + spanStart * 7 * 86400000);
        const label = sd.toLocaleString('en', { month: 'short' }) + (sd.getFullYear() !== curYear || spanStart === 0 ? " '" + String(sd.getFullYear()).slice(2) : '');
        monthSpans.push({ name: label, start: spanStart, span: w - spanStart });
        curYear = sd.getFullYear();
      }
      curMonth = m; spanStart = w;
    }
  }
  const lastD = new Date(startDate.getTime() + spanStart * 7 * 86400000);
  const lastLabel = lastD.toLocaleString('en', { month: 'short' }) + (lastD.getFullYear() !== curYear || monthSpans.length === 0 ? " '" + String(lastD.getFullYear()).slice(2) : '');
  monthSpans.push({ name: lastLabel, start: spanStart, span: totalCols - spanStart });
  const monthRow = monthSpans.map(m => `<span class="hm-month" style="grid-column:span ${m.span}">${m.name}</span>`).join('');

  // --- Day labels (all 7) ---
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // --- Grid cells ---
  let cells = '';
  for (let w = 0; w < totalCols; w++) {
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(cellDate.getDate() + w * 7 + d);
      const dateStr = cellDate.toISOString().slice(0, 10);
      const count = data[dateStr] || 0;
      const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxVal) * 4));
      const isFuture = cellDate > today;
      const tip = cellDate.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) + ': ' + (isFuture ? 'No data yet' : count + ' request' + (count !== 1 ? 's' : ''));
      cells += `<div class="hm-cell hm-${isFuture ? 'empty' : level}" title="${tip}"></div>`;
    }
  }

  container.innerHTML = `
    <div class="heatmap-months" style="grid-template-columns:repeat(${totalCols},1fr)">${monthRow}</div>
    <div class="heatmap-body">
      <div class="heatmap-labels">${dayNames.map(n => `<span>${n}</span>`).join('')}</div>
      <div class="heatmap-grid" style="grid-template-columns:repeat(${totalCols},1fr)">${cells}</div>
    </div>
    ${!hasData ? '<div class="heatmap-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="4" x2="8" y2="10"/><line x1="16" y1="4" x2="16" y2="10"/></svg><p>No activity yet</p><span>Your usage will light up here as you chat</span></div>' : ''}
    <div class="heatmap-legend">
      <span style="font-size:.7rem;color:var(--muted)">Less</span>
      <div class="hm-cell hm-0"></div><div class="hm-cell hm-1"></div><div class="hm-cell hm-2"></div><div class="hm-cell hm-3"></div><div class="hm-cell hm-4"></div>
      <span style="font-size:.7rem;color:var(--muted)">More</span>
    </div>
  `;
}

/* 
   SETTINGS
    */
async function renderSettings() {
  const el = document.getElementById('page-content');
  const u = state.user || {};
  el.innerHTML = `
    <div class="settings-cards">
      <div class="settings-card">
        <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Profile Information</h3>
        <div class="field"><label>Roll Number</label><input value="${esc(u.roll_number)}" disabled></div>
        <div class="field"><label>Name</label><input id="pf-name" value="${esc(u.name)}"></div>
        <div class="field"><label>Email</label><input id="pf-email" type="email" value="${esc(u.email || '')}" placeholder="Optional"></div>
        <div class="field"><label>Department</label><input id="pf-dept" value="${esc(u.department)}" ${u.role === 'admin' ? '' : 'disabled'}></div>
        <div class="field"><label>Role</label><input value="${esc(u.role)}" disabled></div>
        <div id="pf-msg" style="font-size:.85rem;min-height:20px;margin-bottom:8px"></div>
        <button class="btn btn-primary" id="save-profile-btn" style="width:auto;padding:8px 24px">Save Profile</button>
      </div>
      <div class="settings-card">
        <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Change Password</h3>
        ${pwField('cp-old', 'Current Password', 'Current password')}
        ${pwField('cp-new', 'New Password', 'Min 8 characters')}
        ${pwField('cp-confirm', 'Confirm New Password', 'Repeat password')}
        <div id="cp-msg" style="font-size:.85rem;min-height:20px;margin-bottom:8px"></div>
        <button class="btn btn-primary" id="change-pw-btn" style="width:auto;padding:8px 24px">Update Password</button>
      </div>
      <div class="settings-card">
        <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>${t('langLabel')}</h3>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:14px">Choose your preferred language for the interface.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px" id="lang-card-btns">
          ${window.MAC_I18N.LOCALES.map(l => `
          <button onclick="setLang('${l.code}')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:2px solid ${window.MAC_I18N.getLang()===l.code?'var(--accent)':'var(--border)'};border-radius:10px;background:${window.MAC_I18N.getLang()===l.code?'var(--accent-light)':'var(--card)'};color:${window.MAC_I18N.getLang()===l.code?'var(--accent)':'var(--fg)'};cursor:pointer;font-family:inherit;font-size:.9rem;transition:all .15s">
            <span style="font-weight:600">${l.native}</span>
            <span style="font-size:.75rem;color:${window.MAC_I18N.getLang()===l.code?'var(--accent)':'var(--muted)'}">${l.name}${window.MAC_I18N.getLang()===l.code?' \u2713':''}</span>
          </button>`).join('')}
        </div>
      </div>
      <div class="settings-card">
        <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>Theme</h3>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">Choose a color theme for the entire interface.</p>
        <div class="theme-picker" id="theme-picker">
          <div class="theme-dot" data-theme="warm" title="Warm (Default)"></div>
          <div class="theme-dot" data-theme="moonstone" title="Moonstone"></div>
          <div class="theme-dot" data-theme="matcha" title="Matcha"></div>
          <div class="theme-dot" data-theme="nordic" title="Nordic"></div>
          <div class="theme-dot" data-theme="dark" title="Dark"></div>
          <div class="theme-dot" data-theme="pink" title="Pink"></div>
          <div class="theme-dot" data-theme="aqua" title="Aqua"></div>
          <div class="theme-dot" data-theme="blue" title="Blue"></div>
          <div class="theme-dot" data-theme="peach" title="Peach"></div>
          <div class="theme-dot" data-theme="purple" title="Purple"></div>
          <div class="theme-dot" data-theme="green" title="Green"></div>
          <div class="theme-dot" data-theme="yellow" title="Yellow"></div>
          <div class="theme-dot" data-theme="light" title="Light (Classic)"></div>
        </div>
      </div>
      <div class="settings-card">
        <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>API Key</h3>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">Use this key in your projects to call MAC APIs from anywhere.</p>
        <div class="api-key-box">
          <code id="api-key-display">${esc(u.api_key || 'N/A')}</code>
          <button class="btn btn-sm btn-outline copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('api-key-display').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm btn-danger-outline" id="regen-my-key">Regenerate Key</button>
          <button class="btn btn-sm btn-outline" id="test-key-btn">Test Key</button>
          <span id="key-test-msg" style="font-size:.85rem"></span>
        </div>
      </div>
    </div>`;

  bindEyeToggles(el);

  // Theme picker
  const currentTheme = localStorage.getItem('mac_theme') || 'warm';
  document.querySelectorAll('#theme-picker .theme-dot').forEach(dot => {
    if (dot.dataset.theme === currentTheme) dot.classList.add('active');
    dot.onclick = () => {
      const theme = dot.dataset.theme;
      applyTheme(theme);
      document.querySelectorAll('#theme-picker .theme-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
    };
  });

  document.getElementById('save-profile-btn').onclick = async () => {
    const msg = document.getElementById('pf-msg');
    try {
      const r = await api('/auth/me/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: document.getElementById('pf-name').value, email: document.getElementById('pf-email').value, department: document.getElementById('pf-dept')?.value }),
      });
      if (!r.ok) { const d = await r.json(); msg.innerHTML = `<span style="color:var(--danger)">${esc(d.detail?.message || 'Failed')}</span>`; return; }
      state.user = await apiJson('/auth/me');
      msg.innerHTML = '<span style="color:var(--success)">Profile updated <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg></span>';
    } catch (ex) { msg.innerHTML = `<span style="color:var(--danger)">${esc(ex.message)}</span>`; }
  };

  document.getElementById('change-pw-btn').onclick = async () => {
    const msg = document.getElementById('cp-msg');
    msg.textContent = '';
    const oldPw = document.getElementById('cp-old').value;
    const newPw = document.getElementById('cp-new').value;
    const confPw = document.getElementById('cp-confirm').value;
    if (!oldPw || !newPw) { msg.innerHTML = '<span style="color:var(--danger)">All fields required</span>'; return; }
    if (newPw.length < 8) { msg.innerHTML = '<span style="color:var(--danger)">Min 8 characters</span>'; return; }
    if (newPw !== confPw) { msg.innerHTML = '<span style="color:var(--danger)">Passwords do not match</span>'; return; }
    try {
      const r = await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      });
      if (!r.ok) { const d = await r.json(); msg.innerHTML = `<span style="color:var(--danger)">${esc(d.detail?.message || 'Failed')}</span>`; return; }
      msg.innerHTML = '<span style="color:var(--success)">Password changed! <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg></span>';
      document.getElementById('cp-old').value = '';
      document.getElementById('cp-new').value = '';
      document.getElementById('cp-confirm').value = '';
    } catch (ex) { msg.innerHTML = `<span style="color:var(--danger)">${esc(ex.message)}</span>`; }
  };

  const regenBtn = document.getElementById('regen-my-key');
  if (regenBtn) regenBtn.onclick = async () => {
    if (!confirm('Regenerate your API key? The old key will stop working immediately.')) return;
    try {
      const r = await apiJson('/keys/generate', { method: 'POST' });
      document.getElementById('api-key-display').textContent = r.api_key || r.key || 'Generated';
      state.user = await apiJson('/auth/me');
    } catch (ex) { alert('Failed: ' + ex.message); }
  };

  const testKeyBtn = document.getElementById('test-key-btn');
  if (testKeyBtn) testKeyBtn.onclick = async () => {
    const key = document.getElementById('api-key-display').textContent.trim();
    const msg = document.getElementById('key-test-msg');
    if (!key || key === 'N/A') { msg.innerHTML = '<span style="color:var(--danger)">No key found</span>'; return; }
    msg.textContent = 'Testing...';
    try {
      const r = await fetch('/api/v1/auth/me', { headers: { 'Authorization': `Bearer ${key}` } });
      const d = await r.json();
      if (r.ok) {
        msg.innerHTML = `<span style="color:var(--success)">&#10003; Works "" authenticated as ${esc(d.name)} (${esc(d.role)})</span>`;
      } else {
        msg.innerHTML = `<span style="color:var(--danger)">&#10007; ${esc(d.detail?.message || d.detail || 'Key rejected')}</span>`;
      }
    } catch (ex) {
      msg.innerHTML = `<span style="color:var(--danger)">&#10007; Network error: ${esc(ex.message)}</span>`;
    }
  };
}

/* 
   CHAT
    */
let currentSession = null;
let isStreaming = false;

function chatEmptyHtml() {
  return `<div class="chat-empty">
    <div class="chat-empty-hero">
      <div class="mac-glitch-logo"><span class="glitch" data-text="MAC">MAC</span></div>
      <div class="ctl-typewriter" id="ctl-typewriter"></div>
      <canvas class="ctl-dust-canvas" id="ctl-dust-canvas" aria-hidden="true"></canvas>
    </div>
  </div>`;
}

function startTypewriter() {
  const el = document.getElementById('ctl-typewriter');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('ctl-done');
  const text = 'Cross the Limits';
  let i = 0;
  el.classList.add('typing');
  function type() {
    if (i < text.length) {
      el.textContent += text[i];
      i++;
      setTimeout(type, 60 + Math.random() * 40);
    } else {
      el.classList.remove('typing');
      el.classList.add('ctl-done');
      // Attach dust disintegration handler once typing is done
      bindCursorDust(el);
    }
  }
  setTimeout(type, 400);
}

function bindCursorDust(el) {
  if (el._dustBound) return;
  el._dustBound = true;
  function triggerDust(e) {
    if (!el.classList.contains('ctl-done')) return;
    e.stopPropagation();
    const canvas = document.getElementById('ctl-dust-canvas');
    if (!canvas) return;
    const rect = el.getBoundingClientRect();
    canvas.width = rect.width + 80;
    canvas.height = rect.height + 80;
    canvas.style.left = (rect.left - 40) + 'px';
    canvas.style.top = (rect.top - 40) + 'px';
    const ctx = canvas.getContext('2d');
    // Sample pixels from el via offscreen canvas
    const off = document.createElement('canvas');
    off.width = Math.ceil(rect.width);
    off.height = Math.ceil(rect.height);
    const octx = off.getContext('2d');
    const cs = getComputedStyle(el);
    octx.font = cs.font;
    octx.fillStyle = cs.color || '#555';
    octx.textBaseline = 'top';
    octx.fillText(el.textContent, 0, 0);
    const imgData = octx.getImageData(0, 0, off.width, off.height);
    const px = imgData.data;
    // Collect non-transparent pixels as dust particles
    const dust = [];
    const step = 3;
    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        const idx = (y * off.width + x) * 4;
        if (px[idx + 3] > 60) {
          dust.push({
            x: x + 40, y: y + 40,
            ox: x + 40, oy: y + 40,
            vx: (Math.random() - 0.4) * 4 + 1,
            vy: (Math.random() - 0.7) * 5 - 1,
            r: `${px[idx]},${px[idx+1]},${px[idx+2]}`,
            alpha: 1,
            size: Math.random() * 2 + 1,
            life: 0.9 + Math.random() * 0.4,
          });
        }
      }
    }
    if (!dust.length) return;
    // Hide the text element
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.05s';
    canvas.style.display = 'block';
    let raf;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      for (const p of dust) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;       // gravity
        p.vx *= 0.97;       // drag
        p.alpha -= 0.022;
        if (p.alpha > 0) {
          alive++;
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = `rgb(${p.r})`;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
      ctx.globalAlpha = 1;
      if (alive > 0) {
        raf = requestAnimationFrame(animate);
      } else {
        canvas.style.display = 'none';
        // Re-type after dust settles
        setTimeout(() => {
          el.style.opacity = '';
          el.style.transition = '';
          el._dustBound = false;
          startTypewriter();
        }, 400);
      }
    }
    cancelAnimationFrame(raf);
    animate();
  }
  el.addEventListener('click', triggerDust);
  el.addEventListener('touchstart', triggerDust, { passive: false });
}
function bindChatChips() {
  startTypewriter();
}

function renderChat() {
  const el = document.getElementById('page-content');
  el.className = 'page page-chat';
  const sessions = getSessions();
  el.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sessions" id="chat-sidebar">
        <div class="chat-sessions-header">
          <h3>Sessions</h3>
          <button class="btn btn-sm btn-outline" id="new-chat-btn">+ New</button>
        </div>
        <div class="session-list" id="session-list">
          ${sessions.map(s => sessionItem(s)).join('')}
        </div>
      </div>
      <div class="chat-resize-handle" id="chat-resize-handle"></div>
      <div class="chat-main">
        <div class="chat-messages" id="chat-messages">
          ${chatEmptyHtml()}
        </div>
        <div class="chat-input-wrap">
          <div class="chat-input-box">
            <textarea id="chat-input" placeholder="Message MAC..." rows="1"></textarea>
            <div class="chat-input-actions">
              <div class="chat-input-left">
                <select id="model-select" class="model-pill"><option value="auto" selected>Auto</option></select>
                <button class="chat-btn-icon" id="attach-btn" title="Attach document (PDF, TXT, DOCX) for RAG context">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <input type="file" id="attach-file" accept=".pdf,.txt,.md,.docx,.doc,.csv,.json" style="display:none">
                <span id="attach-name" style="font-size:.72rem;color:var(--accent);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none"></span>
                <button class="chat-btn-icon" id="stt-btn" title="Upload audio to transcribe (Whisper STT)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                </button>
                <input type="file" id="stt-file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.webm" style="display:none">
              </div>
              <div class="chat-input-right">
                <span id="chat-status" class="chat-status-text"></span>
                <span id="active-model-badge" class="active-model-badge"></span>
                <button class="send-btn" id="send-btn" title="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  bindChat();
  bindChatChips();
  // Always restore the last active session (fixes blank-state / session-merge bug)
  const _restoreId = currentSession?.id || userGet('last_chat_session', null) || sessions[0]?.id;
  if (_restoreId) loadSession(_restoreId);
}

function sessionItem(s) {
  const active = currentSession && currentSession.id === s.id;
  return `<div class="session-item ${active ? 'active' : ''}" data-id="${s.id}">
    <span>${esc(s.title || 'New Chat')}</span>
    <span class="del" data-del="${s.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
  </div>`;
}

function bindChat() {
  document.getElementById('new-chat-btn').onclick = newChat;
  document.getElementById('send-btn').onclick = sendMessage;
  const input = document.getElementById('chat-input');
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };

  // Attach file: PDF/TXT/DOCX for RAG context injection
  let _attachedFile = null;
  const attachBtn = document.getElementById('attach-btn');
  const attachInput = document.getElementById('attach-file');
  const attachName = document.getElementById('attach-name');
  if (attachBtn && attachInput) {
    attachBtn.onclick = () => attachInput.click();
    attachInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      attachInput.value = '';
      if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10 MB)', 'error'); return; }
      _attachedFile = file;
      attachName.textContent = file.name;
      attachName.style.display = '';
      // Upload to RAG for context
      const status = document.getElementById('chat-status');
      if (status) status.textContent = 'Uploading...';
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        fd.append('collection', 'chat-context');
        const res = await fetch(`${API}/rag/ingest`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` },
          body: fd,
        });
        if (!res.ok) throw new Error('Upload failed');
        if (status) status.textContent = 'File ready';
        setTimeout(() => { const s = document.getElementById('chat-status'); if (s) s.textContent = ''; }, 2000);
      } catch {
        if (status) status.textContent = 'Upload failed';
        setTimeout(() => { const s = document.getElementById('chat-status'); if (s) s.textContent = ''; }, 3000);
      }
    };
    // Allow dismissing attachment
    attachName.onclick = () => { _attachedFile = null; attachName.style.display = 'none'; attachName.textContent = ''; };
  }

  // STT: upload audio file &rarr; transcribe via Whisper
  const sttBtn = document.getElementById('stt-btn');
  const sttFile = document.getElementById('stt-file');
  if (sttBtn && sttFile) {
    sttBtn.onclick = () => sttFile.click();
    sttFile.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      sttFile.value = '';
      const fd = new FormData();
      fd.append('audio', file);
      const status = document.getElementById('chat-status');
      status.textContent = 'Transcribing...';
      sttBtn.disabled = true;
      try {
        const res = await fetch('/api/v1/query/speech-to-text', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` },
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail?.message || data.detail || 'Transcription failed');
        const inp = document.getElementById('chat-input');
        inp.value = (inp.value ? inp.value + ' ' : '') + data.text;
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
        inp.focus();
        status.textContent = '';
      } catch (err) {
        status.textContent = 'STT: ' + err.message;
        setTimeout(() => { const s = document.getElementById('chat-status'); if (s) s.textContent = ''; }, 4000);
      }
      sttBtn.disabled = false;
    };
  }

  // TTS: speaker button on assistant messages (event delegation)
  document.getElementById('chat-messages').addEventListener('click', async (e) => {
    const btn = e.target.closest('.tts-btn');
    if (!btn) return;
    const msgEl = btn.closest('[data-msg-index]');
    if (!msgEl || !currentSession) return;
    const idx = parseInt(msgEl.dataset.msgIndex);
    const text = currentSession.messages[idx]?.content;
    if (text) await playTTS(text, btn);
  });
  document.getElementById('session-list').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { deleteSession(del.dataset.del); return; }
    const item = e.target.closest('.session-item');
    if (item) loadSession(item.dataset.id);
  };
  // Resizable session sidebar (VS Code style drag handle)
  const handle = document.getElementById('chat-resize-handle');
  const sidebar = document.getElementById('chat-sidebar');
  if (handle && sidebar) {
    let startX, startW;
    handle.onmousedown = (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        let w = startW + (ev.clientX - startX);
        if (w < 60) w = 0; // snap to collapsed
        else if (w < 140) w = 140; // minimum usable
        else if (w > 500) w = 500; // max
        sidebar.style.width = w + 'px';
        sidebar.classList.toggle('collapsed', w === 0);
        handle.classList.toggle('collapsed', w === 0);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    // Double-click to toggle collapse/expand
    handle.ondblclick = () => {
      const w = sidebar.getBoundingClientRect().width;
      if (w < 10) {
        sidebar.style.width = '240px';
        sidebar.classList.remove('collapsed');
        handle.classList.remove('collapsed');
      } else {
        sidebar.style.width = '0px';
        sidebar.classList.add('collapsed');
        handle.classList.add('collapsed');
      }
    };
  }
  loadModelOptions();
  loadActiveModelBadge();
}

async function loadModelOptions() {
  const sel = document.getElementById('model-select');
  try {
    const resp = await fetch(API + '/explore/models?model_type=chat&per_page=50');
    if (!resp.ok) return;
    const data = await resp.json();
    (data.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name + (m.parameters ? ' (' + m.parameters + ')' : '');
      sel.appendChild(opt);
    });
  } catch (e) { /* API offline "" auto option is enough */ }
  if (currentSession && currentSession.model) sel.value = currentSession.model;
}

async function loadActiveModelBadge() {
  const badge = document.getElementById('active-model-badge');
  if (!badge) return;
  try {
    const res = await fetch('/api/v1/explore/health');
    if (!res.ok) { badge.innerHTML = '<span class="model-dot model-dot-off"></span> Offline'; return; }
    const data = await res.json();
    const models = (data.nodes || []).flatMap(n => n.models_loaded || []);
    if (models.length > 0) {
      badge.innerHTML = '<span class="model-dot model-dot-on"></span> ' + esc(shortModel(models[0]));
      badge.title = 'Running: ' + models.join(', ');
    } else {
      badge.innerHTML = '<span class="model-dot model-dot-off"></span> No model';
    }
  } catch { badge.innerHTML = '<span class="model-dot model-dot-off"></span> Offline'; }
}

function newChat() {
  const id = 'chat-' + Date.now();
  const session = { id, title: 'New Chat', messages: [], model: 'auto', created: new Date().toISOString() };
  const sessions = getSessions();
  sessions.unshift(session);
  saveSessions(sessions);
  currentSession = session;
  renderChat(); // loadSession called inside renderChat with restored currentSession
}

function loadSession(id) {
  const s = getSession(id);
  if (!s) return;
  currentSession = s;
  userSet('last_chat_session', id); // persist for reload
  document.querySelectorAll('.session-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  const msgs = document.getElementById('chat-messages');
  if (s.messages.length === 0) {
    msgs.innerHTML = chatEmptyHtml();
    startTypewriter();
  } else {
    msgs.innerHTML = s.messages.map((m, i) => {
      if (m.role === 'assistant') {
        return `<div class="msg msg-assistant" data-msg-index="${i}">${formatMd(m.content)}<div class="msg-meta"><button class="tts-btn" title="Listen to this response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button></div></div>`;
      }
      return `<div class="msg msg-user">${esc(m.content)}</div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
  }
  if (s.model) document.getElementById('model-select').value = s.model;
}

function deleteSession(id) {
  saveSessions(getSessions().filter(s => s.id !== id));
  if (currentSession && currentSession.id === id) currentSession = null;
  renderChat();
}

async function sendMessage() {
  if (isStreaming) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!currentSession) newChat();
  const model = document.getElementById('model-select').value;
  currentSession.model = model;

  currentSession.messages.push({ role: 'user', content: text });
  if (currentSession.title === 'New Chat') currentSession.title = text.slice(0, 40);
  persistSession();

  const msgs = document.getElementById('chat-messages');
  const emptyEl = msgs.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();
  msgs.innerHTML += `<div class="msg msg-user">${esc(text)}</div>`;
  input.value = ''; input.style.height = 'auto';

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'msg msg-assistant';
  assistantDiv.innerHTML = macThinkingHTML();
  msgs.appendChild(assistantDiv);
  msgs.scrollTop = msgs.scrollHeight;
  startMacThinking(assistantDiv);

  const status = document.getElementById('chat-status');
  status.textContent = 'Generating...';
  isStreaming = true;

  try {
    const apiMessages = currentSession.messages.map(m => ({ role: m.role, content: m.content }));
    const res = await api('/query/chat', { method: 'POST', body: JSON.stringify({ messages: apiMessages, model, stream: true }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.detail?.message || 'Request failed'); }

    let fullContent = '';
    stopMacThinking(assistantDiv);
    assistantDiv.textContent = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamError = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            if (chunk.error) throw new Error(chunk.error.message);
            const delta = chunk.choices?.[0]?.delta?.content || '';
            if (delta) { fullContent += delta; assistantDiv.innerHTML = formatMd(fullContent); msgs.scrollTop = msgs.scrollHeight; }
          } catch (parseErr) { if (parseErr.message.includes('Backend') || parseErr.message.includes('model')) throw parseErr; }
        }
      }
    } catch (streamErr) {
      streamError = streamErr;
    }
    if (fullContent) {
      currentSession.messages.push({ role: 'assistant', content: fullContent });
      persistSession();
      const usedModel = model === 'auto' ? 'Qwen2.5-7B-AWQ' : shortModel(model);
      const msgIdx = currentSession.messages.length - 1;
      assistantDiv.dataset.msgIndex = msgIdx;
      assistantDiv.innerHTML = formatMd(fullContent) + `<div class="msg-meta"><div class="msg-model-tag">answered by ${esc(usedModel)}</div><button class="tts-btn" title="Listen to this response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button></div>`;
    } else if (streamError) {
      throw streamError;
    } else {
      fullContent = '(No response)';
      currentSession.messages.push({ role: 'assistant', content: fullContent });
      persistSession();
      assistantDiv.innerHTML = formatMd(fullContent);
    }
  } catch (err) {
    stopMacThinking(assistantDiv);
    assistantDiv.innerHTML = `<span style="color:var(--danger)">Error: ${esc(err.message)}</span>`;
    currentSession.messages.push({ role: 'assistant', content: `Error: ${err.message}` });
    persistSession();
  }
  isStreaming = false;
  status.textContent = '';
  msgs.scrollTop = msgs.scrollHeight;
  const titleEl = document.querySelector(`.session-item[data-id="${currentSession.id}"] span:first-child`);
  if (titleEl) titleEl.textContent = currentSession.title;
}

function persistSession() {
  let sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === currentSession.id);
  if (idx >= 0) sessions[idx] = currentSession; else sessions.unshift(currentSession);
  saveSessions(sessions);
}

/* Text-to-Speech: play an assistant message via piper TTS */
async function playTTS(text, btn) {
  if (!btn || btn._ttsPlaying) return;
  btn._ttsPlaying = true;
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="10 15 15 12 10 9 10 15"/></svg>';
  btn.title = 'Generating audio...';
  try {
    const res = await api('/query/text-to-speech', {
      method: 'POST',
      body: JSON.stringify({ text: text.slice(0, 4000), voice: 'default', speed: 1.0, response_format: 'mp3' }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail?.message || 'TTS unavailable');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    btn.title = 'Playing... (click to stop)';
    btn.onclick = (e) => { e.stopPropagation(); audio.pause(); };
    audio.onended = () => { btn.innerHTML = origHTML; btn.title = 'Listen to this response'; btn._ttsPlaying = false; URL.revokeObjectURL(url); btn.onclick = null; };
    audio.onerror = () => { btn.innerHTML = origHTML; btn.title = 'Listen to this response'; btn._ttsPlaying = false; URL.revokeObjectURL(url); btn.onclick = null; };
    await audio.play();
  } catch (err) {
    btn.innerHTML = origHTML;
    btn.title = err.message || 'TTS failed';
    btn._ttsPlaying = false;
    setTimeout(() => { if (btn) btn.title = 'Listen to this response'; }, 3000);
  }
}

/* 
   AGENT MODE "" Plan-and-Execute with Streaming Steps
    */
async function sendAgentMessage(query) {
  const input = document.getElementById('chat-input');
  if (!currentSession) newChat();
  currentSession.messages.push({ role: 'user', content: query });
  if (currentSession.title === 'New Chat') currentSession.title = '[Agent] ' + query.slice(0, 35);
  persistSession();

  const msgs = document.getElementById('chat-messages');
  const emptyEl = msgs.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();
  msgs.innerHTML += `<div class="msg msg-user">${esc(query)}</div>`;
  input.value = ''; input.style.height = 'auto';

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'msg msg-assistant';
  assistantDiv.innerHTML = macThinkingHTML();
  msgs.appendChild(assistantDiv);
  msgs.scrollTop = msgs.scrollHeight;
  startMacThinking(assistantDiv);

  const status = document.getElementById('chat-status');
  status.textContent = 'Agent working...';
  isStreaming = true;

  try {
    const res = await api('/agent/run', { method: 'POST', body: JSON.stringify({ query }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.detail?.message || 'Agent failed'); }

    let stepsHtml = '';
    let finalAnswer = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          const evtType = evt.event || evt.type;
          if (evtType === 'plan') {
            stopMacThinking(assistantDiv);
            const steps = evt.plan || evt.steps || [];
            stepsHtml = '<div style="margin-bottom:12px;font-weight:700;font-size:.82rem">Plan:</div>';
            steps.forEach((s, i) => {
              const title = typeof s === 'string' ? s : (s.title || s.description || `Step ${i+1}`);
              stepsHtml += `<div class="agent-step" id="agent-step-${i}"><div class="agent-step-title">Step ${i + 1}: ${esc(title)}</div></div>`;
            });
            assistantDiv.innerHTML = stepsHtml;
          } else if (evtType === 'step_start') {
            const si = (evt.step_index !== undefined ? evt.step_index : (evt.step ? evt.step - 1 : 0));
            const stepEl = document.getElementById('agent-step-' + si);
            if (stepEl) stepEl.classList.add('running');
            status.textContent = 'Step ' + (si + 1) + '...';
          } else if (evtType === 'step_complete' || evtType === 'step_result' || evtType === 'tool_result') {
            const si = (evt.step_index !== undefined ? evt.step_index : (evt.step ? evt.step - 1 : 0));
            const stepEl = document.getElementById('agent-step-' + si);
            if (stepEl) {
              stepEl.classList.remove('running');
              stepEl.classList.add('done');
              const output = evt.output || (evt.result && JSON.stringify(evt.result).slice(0, 500));
              if (output) stepEl.innerHTML += `<div class="agent-step-output">${esc(String(output).slice(0, 500))}</div>`;
            }
          } else if (evtType === 'complete') {
            finalAnswer = evt.response || evt.content || '';
          } else if (evtType === 'answer') {
            finalAnswer = evt.content || evt.response || '';
          } else if (evtType === 'error') {
            stopMacThinking(assistantDiv);
            assistantDiv.innerHTML += `<div style="color:var(--danger);margin-top:8px;font-size:.85rem">Error: ${esc(evt.message || 'Unknown error')}</div>`;
          }
        } catch {}
      }
      msgs.scrollTop = msgs.scrollHeight;
    }

    if (finalAnswer) {
      assistantDiv.innerHTML += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">${formatMd(finalAnswer)}</div>`;
      currentSession.messages.push({ role: 'assistant', content: finalAnswer });
      persistSession();
    }
  } catch (ex) {
    stopMacThinking(assistantDiv);
    assistantDiv.innerHTML = `<div style="color:var(--danger)">Agent error: ${esc(ex.message)}</div>`;
  }

  status.textContent = '';
  isStreaming = false;
  msgs.scrollTop = msgs.scrollHeight;
}

/* 
   ADMIN PANEL "" Full Control Dashboard
    */
let adminTab = 'overview';

async function renderAdmin() {
  const el = document.getElementById('page-content');
  if (!state.user || state.user.role !== 'admin') {
    el.innerHTML = '<div class="error-state"><p>Admin access required.</p></div>';
    return;
  }
  el.innerHTML = `
    <div class="admin-tabs" id="admin-tabs">
      <div class="admin-tab ${adminTab==='overview'?'active':''}" data-tab="overview">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
        <span>Overview</span>
      </div>
      <div class="admin-tab ${adminTab==='users'?'active':''}" data-tab="users">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <span>Users</span>
      </div>
      <div class="admin-tab ${adminTab==='keys'?'active':''}" data-tab="keys">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        <span>API Keys</span>
      </div>
      <div class="admin-tab ${adminTab==='models'?'active':''}" data-tab="models">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span>Models</span>
      </div>
      <div class="admin-tab ${adminTab==='registry'?'active':''}" data-tab="registry">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span>Registry</span>
      </div>
      <div class="admin-tab ${adminTab==='cluster'?'active':''}" data-tab="cluster">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
        <span>Cluster</span>
      </div>
      <div class="admin-tab ${adminTab==='scoped_keys'?'active':''}" data-tab="scoped_keys">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
        <span>Scoped Keys</span>
      </div>
      <div class="admin-tab ${adminTab==='audit'?'active':''}" data-tab="audit">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
        <span>Audit Log</span>
      </div>
      <div class="admin-tab ${adminTab==='guardrails'?'active':''}" data-tab="guardrails">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/></svg>
        <span>Guardrails</span>
      </div>
      <div class="admin-tab ${adminTab==='features'?'active':''}" data-tab="features">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        <span>Features</span>
      </div>
      <div class="admin-tab ${adminTab==='activity'?'active':''}" data-tab="activity">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>Live Activity</span>
      </div>
    </div>
    <div id="admin-content"><div class="loading-state"><div class="spinner"></div><span>Loading...</span></div></div>
  `;
  document.querySelectorAll('#admin-tabs .admin-tab').forEach(t => {
    t.onclick = () => { adminTab = t.dataset.tab; renderAdmin(); };
  });
  if (adminTab === 'overview') await renderAdminOverview();
  else if (adminTab === 'users') await renderAdminUsers();
  else if (adminTab === 'keys') await renderAdminKeys();
  else if (adminTab === 'models') await renderAdminModels();
  else if (adminTab === 'registry') await renderAdminRegistry();
  else if (adminTab === 'cluster') await renderAdminCluster();
  else if (adminTab === 'scoped_keys') await renderAdminScopedKeys();
  else if (adminTab === 'audit') await renderAdminAuditLog();
  else if (adminTab === 'guardrails') await renderAdminGuardrails();
  else if (adminTab === 'features') await renderAdminFeatures();
  else if (adminTab === 'activity') await renderAdminActivityStream();
}

async function renderAdminOverview() {
  const el = document.getElementById('admin-content');
  try {
    const [stats, modelStats, exceeded, allUsage] = await Promise.all([
      apiJson('/auth/admin/stats'),
      apiJson('/usage/admin/models').catch(() => ({ models: [] })),
      apiJson('/quota/admin/exceeded').catch(() => ({ users: [] })),
      apiJson('/usage/admin/all?per_page=100').catch(() => ({ users: [] })),
    ]);

    const allUsers = allUsage.users || [];
    // Department breakdown
    const deptMap = {};
    allUsers.forEach(u => { deptMap[u.department] = (deptMap[u.department] || 0) + 1; });
    // Top users by tokens
    const topUsers = [...allUsers].sort((a, b) => (b.tokens_today || 0) - (a.tokens_today || 0)).slice(0, 5);
    const models = modelStats.models || [];
    const exceededUsers = exceeded.users || [];

    el.innerHTML = `
      <div class="stats-grid stats-3">
        <div class="stat-card accent">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
          <div class="stat-body">
            <div class="label">Total Users</div>
            <div class="value">${stats.total_users}</div>
            <div class="sub">${stats.active_users} active &middot; ${stats.admin_count} admins</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
          <div class="stat-body">
            <div class="label">Requests Today</div>
            <div class="value">${fmtNum(stats.requests_today)}</div>
            <div class="sub">across all users</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg></div>
          <div class="stat-body">
            <div class="label">Tokens Today</div>
            <div class="value">${fmtNum(stats.tokens_today)}</div>
            <div class="sub">total consumed</div>
          </div>
        </div>
      </div>

      <div class="charts-row">
        <div class="chart-card flex-1">
          <div class="chart-header">
            <h3>Model Performance</h3>
            <span class="chart-sub">Today's stats per model</span>
          </div>
          ${models.length > 0 ? `
          <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Avg Latency</th><th>Users</th></tr></thead>
            <tbody>
              ${models.map(m => `
                <tr>
                  <td><span class="model-tag">${esc(shortModel(m.model))}</span></td>
                  <td>${fmtNum(m.requests_today)}</td>
                  <td>${fmtNum(m.tokens_today)}</td>
                  <td>${m.avg_latency_ms || 0}ms</td>
                  <td>${m.unique_users_today || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
          ` : '<div class="empty-state"><p>No model usage data yet</p></div>'}
        </div>
        <div class="chart-card flex-1">
          <div class="chart-header">
            <h3>Department Distribution</h3>
          </div>
          <div style="height:220px"><canvas id="admin-dept-chart"></canvas></div>
        </div>
      </div>

      <div class="charts-row">
        <div class="chart-card flex-1">
          <div class="chart-header">
            <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Top Users Today</h3>
            <span class="chart-sub">By token consumption</span>
          </div>
          ${topUsers.length > 0 ? `
          <div class="top-users-list">
            ${topUsers.map((u, i) => `
              <div class="top-user-row">
                <span class="rank">#${i + 1}</span>
                <div class="top-user-info">
                  <span class="name">${esc(u.name)}</span>
                  <span class="muted">${esc(u.roll_number)} &middot; ${esc(u.department)}</span>
                </div>
                <div class="top-user-bar-wrap">
                  <div class="top-user-bar" style="width:${Math.max(5, ((u.tokens_today || 0) / (topUsers[0].tokens_today || 1)) * 100)}%"></div>
                </div>
                <span class="top-user-val">${fmtNum(u.tokens_today || 0)}</span>
              </div>
            `).join('')}
          </div>
          ` : '<div class="empty-state"><p>No usage yet today</p></div>'}
        </div>
        <div class="chart-card flex-1">
          <div class="chart-header">
            <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Quota Exceeded</h3>
            <span class="chart-sub">Users who hit their daily limit</span>
          </div>
          ${exceededUsers.length > 0 ? `
          <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>User</th><th>Dept</th><th>Used</th><th>Limit</th><th>Over by</th></tr></thead>
            <tbody>
              ${exceededUsers.map(u => `
                <tr>
                  <td><strong>${esc(u.name || u.roll_number)}</strong></td>
                  <td>${esc(u.department)}</td>
                  <td>${fmtNum(u.tokens_used)}</td>
                  <td>${fmtNum(u.daily_limit)}</td>
                  <td class="danger">${fmtNum(u.exceeded_by || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
          ` : '<div class="empty-state" style="padding:24px"><p><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg> No one has exceeded their quota</p></div>'}
        </div>
      </div>
    `;

    // Department chart
    const deptLabels = Object.keys(deptMap);
    const deptValues = Object.values(deptMap);
    if (deptLabels.length > 0) {
      const deptColors = ['#000', '#333', '#666', '#999', '#bbb', '#ddd'];
      new Chart(document.getElementById('admin-dept-chart'), {
        type: 'bar',
        data: {
          labels: deptLabels,
          datasets: [{ data: deptValues, backgroundColor: deptColors.slice(0, deptLabels.length), borderRadius: 6, barPercentage: 0.6 }],
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { display: false } } } },
      });
    }

  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

async function renderAdminUsers() {
  const el = document.getElementById('admin-content');
  try {
    const data = await apiJson('/auth/admin/users');
    const users = data.users || [];
    el.innerHTML = `
      <div class="admin-header">
        <h2>User Management <span class="badge" class="badge-neutral" style="font-size:.75rem;vertical-align:middle">${users.length}</span></h2>
        <button class="btn btn-sm btn-primary" id="add-user-btn" style="width:auto;padding:8px 16px">+ Add User</button>
      </div>
      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Roll No</th><th>Name</th><th>Dept</th><th>Role</th><th>Status</th><th>Pwd</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td class="mono bold">${esc(u.roll_number)}</td>
              <td>${esc(u.name)}</td>
              <td>${esc(u.department)}</td>
              <td><span class="badge badge-${u.role}">${u.role}</span></td>
              <td>${u.is_active ? '<span class="dot-success"></span> Active' : '<span class="dot-error"></span> Inactive'}</td>
              <td>${u.must_change_password ? '<span style="color:var(--danger)">Pending</span>' : '<span class="muted">Set</span>'}</td>
              <td class="muted">${new Date(u.created_at).toLocaleDateString()}</td>
              <td>
                <div class="action-btns">
                  <button class="icon-btn edit-user" data-uid="${u.id}" data-name="${esc(u.name)}" data-email="${esc(u.email||'')}" data-dept="${esc(u.department)}" data-role="${u.role}" title="Edit user"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <select class="role-select" data-uid="${u.id}" title="Change role">
                    <option value="student" ${u.role==='student'?'selected':''}>Student</option>
                    <option value="faculty" ${u.role==='faculty'?'selected':''}>Faculty</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
                  </select>
                  <button class="icon-btn toggle-status" data-uid="${u.id}" data-active="${u.is_active}" title="${u.is_active ? 'Deactivate' : 'Activate'}">
                    ${u.is_active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'}
                  </button>
                  <button class="icon-btn reset-pw" data-uid="${u.id}" title="Reset password"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></button>
                  <button class="icon-btn regen-key" data-uid="${u.id}" title="Regenerate API key"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`;

    el.querySelectorAll('.role-select').forEach(sel => {
      sel.onchange = async () => { try { await api(`/auth/admin/users/${sel.dataset.uid}/role`, { method: 'PUT', body: JSON.stringify({ role: sel.value }) }); renderAdmin(); } catch { alert('Failed'); } };
    });
    el.querySelectorAll('.edit-user').forEach(btn => {
      btn.onclick = () => showEditUserModal(btn.dataset.uid, btn.dataset.name, btn.dataset.email, btn.dataset.dept, btn.dataset.role);
    });
    el.querySelectorAll('.toggle-status').forEach(btn => {
      btn.onclick = async () => { try { await api(`/auth/admin/users/${btn.dataset.uid}/status`, { method: 'PUT', body: JSON.stringify({ is_active: btn.dataset.active !== 'true' }) }); renderAdmin(); } catch { alert('Failed'); } };
    });
    el.querySelectorAll('.reset-pw').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Reset this user\'s password?')) return;
        try { const r = await apiJson(`/auth/admin/users/${btn.dataset.uid}/reset-password`, { method: 'POST' }); alert(`Temp password: ${r.temp_password}\nUser must change on next login.`); renderAdmin(); } catch { alert('Failed'); }
      };
    });
    el.querySelectorAll('.regen-key').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Regenerate API key? Old key will stop working.')) return;
        try { const r = await apiJson(`/auth/admin/users/${btn.dataset.uid}/regenerate-key`, { method: 'POST' }); alert(`New key: ${r.api_key}`); renderAdmin(); } catch { alert('Failed'); }
      };
    });
    document.getElementById('add-user-btn').onclick = showAddUserModal;
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

async function renderAdminKeys() {
  const el = document.getElementById('admin-content');
  try {
    const data = await apiJson('/keys/admin/all');
    const keys = data.keys || [];
    el.innerHTML = `
      <div class="admin-header">
        <h2>API Key Management <span class="badge" class="badge-neutral" style="font-size:.75rem;vertical-align:middle">${keys.length}</span></h2>
      </div>
      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Roll No</th><th>Name</th><th>Key Prefix</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${keys.map(k => `
            <tr>
              <td class="mono bold">${esc(k.roll_number)}</td>
              <td>${esc(k.name)}</td>
              <td class="mono">${esc(k.prefix || k.api_key_prefix || '---')}</td>
              <td>${k.active !== false ? '<span class="dot-success"></span> Active' : '<span class="dot-error"></span> Revoked'}</td>
              <td>
                <button class="btn btn-sm btn-danger-outline revoke-key" data-roll="${esc(k.roll_number)}">Revoke</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`;

    el.querySelectorAll('.revoke-key').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`Revoke API key for ${btn.dataset.roll}?`)) return;
        try { await api('/keys/admin/revoke', { method: 'POST', body: JSON.stringify({ roll_number: btn.dataset.roll }) }); renderAdmin(); } catch { alert('Failed'); }
      };
    });
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

async function renderAdminModels() {
  const el = document.getElementById('admin-content');
  try {
    const [modelsData, modelStats] = await Promise.all([
      apiJson('/models'),
      apiJson('/usage/admin/models').catch(() => ({ models: [] })),
    ]);
    const models = modelsData.models || [];
    const stats = modelStats.models || [];

    el.innerHTML = `
      <div class="admin-header"><h2>Model Status & Analytics</h2></div>
      <div class="models-grid-admin">
        ${models.map(m => {
          const s = stats.find(st => st.model === m.id) || {};
          return `
          <div class="model-card-admin">
            <div class="model-card-header">
              <span class="model-name">${esc(m.id || m.name)}</span>
              <span class="model-status ${m.status === 'loaded' ? 'online' : 'offline'}">${m.status === 'loaded' ? '<span class="status-dot on"></span> Online' : '<span class="status-dot off"></span> Offline'}</span>
            </div>
            <div class="model-stats-row">
              <div><span class="label">Requests</span><span class="val">${fmtNum(s.requests_today || 0)}</span></div>
              <div><span class="label">Tokens</span><span class="val">${fmtNum(s.tokens_today || 0)}</span></div>
              <div><span class="label">Latency</span><span class="val">${s.avg_latency_ms || 0}ms</span></div>
              <div><span class="label">Users</span><span class="val">${s.unique_users_today || 0}</span></div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

function showEditUserModal(uid, name, email, dept, role) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Edit User</h3>
      <div class="field"><label>Name</label><input type="text" id="eu-name" value="${esc(name)}"></div>
      <div class="field"><label>Email</label><input type="email" id="eu-email" value="${esc(email)}"></div>
      <div class="field"><label>Department</label>
        <select id="eu-dept"><option${dept==='CSE'?' selected':''}>CSE</option><option${dept==='ECE'?' selected':''}>ECE</option><option${dept==='ME'?' selected':''}>ME</option><option${dept==='CE'?' selected':''}>CE</option><option${dept==='EE'?' selected':''}>EE</option><option${dept==='IT'?' selected':''}>IT</option><option${dept==='Other'?' selected':''}>Other</option></select>
      </div>
      <div class="field"><label>Role</label>
        <select id="eu-role"><option value="student"${role==='student'?' selected':''}>Student</option><option value="faculty"${role==='faculty'?' selected':''}>Faculty</option><option value="admin"${role==='admin'?' selected':''}>Admin</option></select>
      </div>
      <div id="eu-error" style="color:var(--danger);font-size:.85rem;min-height:20px"></div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-outline" id="eu-cancel">Cancel</button>
        <button class="btn btn-sm btn-primary" id="eu-submit" style="width:auto;padding:8px 20px">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#eu-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#eu-submit').onclick = async () => {
    const err = overlay.querySelector('#eu-error');
    err.textContent = '';
    const body = {
      name: overlay.querySelector('#eu-name').value.trim(),
      email: overlay.querySelector('#eu-email').value.trim() || null,
      department: overlay.querySelector('#eu-dept').value,
      role: overlay.querySelector('#eu-role').value,
    };
    if (!body.name) { err.textContent = 'Name is required'; return; }
    try {
      const r = await api(`/auth/admin/users/${uid}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json(); err.textContent = d.detail?.message || 'Failed'; return; }
      overlay.remove(); renderAdmin();
    } catch (ex) { err.textContent = ex.message; }
  };
}

function showAddUserModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Add New User</h3>
      <div class="field"><label>Roll Number / Username</label><input type="text" id="nu-roll" placeholder="e.g. 22ME010"></div>
      <div class="field"><label>Name</label><input type="text" id="nu-name" placeholder="Full name"></div>
      <div class="field"><label>Email</label><input type="email" id="nu-email" placeholder="Optional"></div>
      ${pwField('nu-pass', 'Initial Password', 'Min 8 characters')}
      <div class="field"><label>Department</label>
        <select id="nu-dept"><option>CSE</option><option>ECE</option><option>ME</option><option>CE</option><option>EE</option><option>Other</option></select>
      </div>
      <div class="field"><label>Role</label>
        <select id="nu-role"><option value="student" selected>Student</option><option value="faculty">Faculty</option><option value="admin">Admin</option></select>
      </div>
      <div class="field">
        <label><input type="checkbox" id="nu-forcecp" checked style="width:auto;margin-right:6px">Force password change on first login</label>
      </div>
      <div id="nu-error" style="color:var(--danger);font-size:.85rem;min-height:20px"></div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-outline" id="nu-cancel">Cancel</button>
        <button class="btn btn-sm btn-primary" id="nu-submit" style="width:auto;padding:8px 20px">Create User</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  bindEyeToggles(overlay);
  overlay.querySelector('#nu-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#nu-submit').onclick = async () => {
    const err = overlay.querySelector('#nu-error');
    err.textContent = '';
    const body = {
      roll_number: overlay.querySelector('#nu-roll').value.trim(),
      name: overlay.querySelector('#nu-name').value.trim(),
      password: overlay.querySelector('#nu-pass').value,
      email: overlay.querySelector('#nu-email').value.trim() || null,
      department: overlay.querySelector('#nu-dept').value,
      role: overlay.querySelector('#nu-role').value,
      must_change_password: overlay.querySelector('#nu-forcecp').checked,
    };
    if (!body.roll_number || !body.name || !body.password) { err.textContent = 'Roll number, name, password required'; return; }
    if (body.password.length < 8) { err.textContent = 'Password min 8 characters'; return; }
    try {
      const r = await api('/auth/admin/users', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json(); err.textContent = d.detail?.message || 'Failed'; return; }
      overlay.remove(); renderAdmin();
    } catch (ex) { err.textContent = ex.message; }
  };
}

async function renderAdminRegistry() {
  const el = document.getElementById('admin-content');
  try {
    const data = await apiJson('/auth/admin/registry');
    const entries = data.entries || [];
    el.innerHTML = `
      <div class="admin-header">
        <h2>Student Registry <span class="badge" class="badge-neutral" style="font-size:.75rem;vertical-align:middle">${entries.length}</span></h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" id="add-reg-btn">+ Add Student</button>
          <button class="btn btn-sm btn-primary" id="bulk-reg-btn">Bulk Import (JSON)</button>
          <button class="btn btn-sm btn-primary" id="upload-reg-btn" style="background:var(--accent)">Upload CSV / JSON File</button>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">College database. Students verify against this to create accounts.</p>
      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Roll No</th><th>Name</th><th>Dept</th><th>DOB</th><th>Batch</th></tr></thead>
        <tbody>
          ${entries.map(e => `
            <tr>
              <td class="mono bold">${esc(e.roll_number)}</td>
              <td>${esc(e.name)}</td>
              <td>${esc(e.department)}</td>
              <td>${esc(e.dob)}</td>
              <td>${e.batch_year || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`;

    document.getElementById('add-reg-btn').onclick = () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h3>Add Student to Registry</h3>
          <div class="field"><label>Roll Number</label><input id="rg-roll" placeholder="e.g. 23CS050"></div>
          <div class="field"><label>Name</label><input id="rg-name" placeholder="Full name"></div>
          <div class="field"><label>Department</label>
            <select id="rg-dept"><option>CSE</option><option>ECE</option><option>ME</option><option>CE</option><option>EE</option><option>Other</option></select>
          </div>
          <div class="field"><label>Date of Birth (DD-MM-YYYY)</label><input id="rg-dob" placeholder="15-08-2004" maxlength="10"></div>
          <div class="field"><label>Batch Year</label><input id="rg-batch" type="number" placeholder="2023"></div>
          <div id="rg-error" style="color:var(--danger);font-size:.85rem;min-height:20px"></div>
          <div class="modal-actions">
            <button class="btn btn-sm btn-outline" id="rg-cancel">Cancel</button>
            <button class="btn btn-sm btn-primary" id="rg-submit" style="width:auto;padding:8px 20px">Add</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#rg-cancel').onclick = () => overlay.remove();
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.querySelector('#rg-submit').onclick = async () => {
        const err = overlay.querySelector('#rg-error');
        err.textContent = '';
        const body = {
          roll_number: overlay.querySelector('#rg-roll').value.trim(),
          name: overlay.querySelector('#rg-name').value.trim(),
          department: overlay.querySelector('#rg-dept').value,
          dob: overlay.querySelector('#rg-dob').value.trim(),
          batch_year: parseInt(overlay.querySelector('#rg-batch').value) || null,
        };
        if (!body.roll_number || !body.name || !body.dob) { err.textContent = 'All fields except batch required'; return; }
        try {
          const r = await api('/auth/admin/registry', { method: 'POST', body: JSON.stringify(body) });
          if (!r.ok) { const d = await r.json(); err.textContent = d.detail?.message || 'Failed'; return; }
          overlay.remove(); renderAdmin();
        } catch (ex) { err.textContent = ex.message; }
      };
    };

    document.getElementById('bulk-reg-btn').onclick = () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h3>Bulk Import Students</h3>
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">Paste JSON array. Each: <code>{ roll_number, name, department, dob, batch_year }</code></p>
          <textarea id="bulk-json" rows="8" style="width:100%;font-family:monospace;font-size:.8rem" placeholder='[{"roll_number":"23CS001","name":"Name","department":"CSE","dob":"10-05-2005","batch_year":2023}]'></textarea>
          <div id="bulk-error" style="color:var(--danger);font-size:.85rem;min-height:20px;margin-top:8px"></div>
          <div id="bulk-result" style="font-size:.85rem;min-height:20px;margin-top:4px"></div>
          <div class="modal-actions">
            <button class="btn btn-sm btn-outline" id="bulk-cancel">Cancel</button>
            <button class="btn btn-sm btn-primary" id="bulk-submit" style="width:auto;padding:8px 20px">Import</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#bulk-cancel').onclick = () => overlay.remove();
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.querySelector('#bulk-submit').onclick = async () => {
        const err = overlay.querySelector('#bulk-error');
        const res = overlay.querySelector('#bulk-result');
        err.textContent = ''; res.textContent = '';
        let students;
        try { students = JSON.parse(overlay.querySelector('#bulk-json').value); } catch { err.textContent = 'Invalid JSON'; return; }
        if (!Array.isArray(students)) { err.textContent = 'Must be array'; return; }
        try {
          const r = await apiJson('/auth/admin/registry/bulk', { method: 'POST', body: JSON.stringify({ students }) });
          res.innerHTML = `<span style="color:var(--success)">${esc(r.message)}</span>` +
            (r.errors?.length ? `<br><span style="color:var(--danger)">Errors: ${r.errors.join(', ')}</span>` : '');
        } catch (ex) { err.textContent = ex.message; }
      };
    };

    document.getElementById('upload-reg-btn').onclick = () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h3>Upload Student List (CSV or JSON)</h3>
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:8px">CSV columns: <code>roll_number, name, department, dob, batch_year</code></p>
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">JSON: array of objects or <code>{"students": [...]}</code></p>
          <div class="copycheck-upload-area" id="reg-file-drop" style="padding:32px;text-align:center;border:2px dashed var(--border);border-radius:8px;cursor:pointer;margin-bottom:12px">
            <p style="margin:0;font-size:.95rem">Drag & drop or click to select file</p>
            <p style="margin:4px 0 0;font-size:.8rem;color:var(--muted)">.csv or .json (max 5MB)</p>
            <input type="file" id="reg-file-input" accept=".csv,.json" style="display:none">
          </div>
          <div id="reg-file-name" style="font-size:.85rem;margin-bottom:8px"></div>
          <div id="reg-upload-error" style="color:var(--danger);font-size:.85rem;min-height:20px"></div>
          <div id="reg-upload-result" style="font-size:.85rem;min-height:20px"></div>
          <div class="modal-actions">
            <button class="btn btn-sm btn-outline" id="reg-upload-cancel">Cancel</button>
            <button class="btn btn-sm btn-primary" id="reg-upload-submit" style="width:auto;padding:8px 20px" disabled>Upload</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const fileInput = overlay.querySelector('#reg-file-input');
      const dropArea = overlay.querySelector('#reg-file-drop');
      let selectedFile = null;

      dropArea.onclick = () => fileInput.click();
      dropArea.ondragover = (e) => { e.preventDefault(); dropArea.classList.add('dragover'); };
      dropArea.ondragleave = () => dropArea.classList.remove('dragover');
      dropArea.ondrop = (e) => { e.preventDefault(); dropArea.classList.remove('dragover'); if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); };
      fileInput.onchange = () => { if (fileInput.files[0]) pickFile(fileInput.files[0]); };

      function pickFile(f) {
        if (!f.name.match(/\.(csv|json)$/i)) { overlay.querySelector('#reg-upload-error').textContent = 'Only .csv or .json files'; return; }
        if (f.size > 5*1024*1024) { overlay.querySelector('#reg-upload-error').textContent = 'File too large (max 5MB)'; return; }
        selectedFile = f;
        overlay.querySelector('#reg-file-name').textContent = f.name + ' (' + (f.size/1024).toFixed(1) + ' KB)';
        overlay.querySelector('#reg-upload-error').textContent = '';
        overlay.querySelector('#reg-upload-submit').disabled = false;
      }

      overlay.querySelector('#reg-upload-cancel').onclick = () => overlay.remove();
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.querySelector('#reg-upload-submit').onclick = async () => {
        if (!selectedFile) return;
        const err = overlay.querySelector('#reg-upload-error');
        const res = overlay.querySelector('#reg-upload-result');
        err.textContent = ''; res.textContent = 'Uploading...';
        const submitBtn = overlay.querySelector('#reg-upload-submit');
        submitBtn.disabled = true;
        try {
          const form = new FormData();
          form.append('file', selectedFile);
          const tok = localStorage.getItem('mac_token');
          const r = await fetch(API + '/auth/admin/registry/upload', {
            method: 'POST',
            headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
            body: form,
          });
          const data = await r.json();
          if (!r.ok) { err.textContent = data.detail || 'Upload failed'; res.textContent = ''; submitBtn.disabled = false; return; }
          res.innerHTML = '<span style="color:var(--success)">' + esc(data.message) + '</span>' +
            (data.errors?.length ? '<br><span style="color:var(--danger)">Errors: ' + data.errors.join(', ') + '</span>' : '');
          setTimeout(() => { overlay.remove(); renderAdmin(); }, 2000);
        } catch (ex) { err.textContent = ex.message; res.textContent = ''; submitBtn.disabled = false; }
      };
    };
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

/* 
   ADMIN "" Cluster / Nodes Management
    */
async function renderAdminCluster() {
  const el = document.getElementById('admin-content');
  try {
    const data = await apiJson('/nodes');
    const nodes = data.nodes || [];
    el.innerHTML = `
      <div class="admin-header">
        <h2>GPU Cluster <span class="badge" class="badge-neutral" style="font-size:.75rem;vertical-align:middle">${nodes.length} nodes</span></h2>
        <button class="btn btn-sm btn-primary" id="gen-enroll-token" style="width:auto;padding:8px 16px">+ Enrollment Token</button>
      </div>
      <div class="nodes-grid">
        ${nodes.length === 0 ? '<div class="empty-state"><p>No worker nodes enrolled yet. Generate an enrollment token to add GPU workers.</p></div>' : nodes.map(n => `
          <div class="node-card">
            <div class="node-card-header">
              <span class="node-name">${esc(n.name)}</span>
              <span class="node-status ${n.status === 'online' ? 'online' : n.status === 'draining' ? 'draining' : 'offline'}">${esc(n.status)}</span>
            </div>
            <div style="font-size:.75rem;color:var(--muted);margin-bottom:8px">${esc(n.ip_address || '')}:${n.port || ''} &middot; ${esc(n.gpu_name || 'Unknown GPU')} &middot; ${n.gpu_vram_mb ? Math.round(n.gpu_vram_mb/1024) + 'GB VRAM' : ''}</div>
            <div class="node-metrics">
              <div class="node-metric"><span class="metric-val">${n.gpu_util_pct != null ? n.gpu_util_pct + '%' : '--'}</span><span class="metric-lbl">GPU</span></div>
              <div class="node-metric"><span class="metric-val">${n.cpu_util_pct != null ? n.cpu_util_pct + '%' : '--'}</span><span class="metric-lbl">CPU</span></div>
              <div class="node-metric"><span class="metric-val">${n.ram_used_mb && n.ram_total_mb ? Math.round(n.ram_used_mb/n.ram_total_mb*100) + '%' : '--'}</span><span class="metric-lbl">RAM</span></div>
              <div class="node-metric"><span class="metric-val">${n.gpu_vram_used_mb && n.gpu_vram_mb ? Math.round(n.gpu_vram_used_mb/n.gpu_vram_mb*100) + '%' : '--'}</span><span class="metric-lbl">VRAM</span></div>
            </div>
            <div style="margin-top:12px;display:flex;gap:6px">
              ${n.status === 'online' ? `<button class="btn btn-sm btn-outline drain-node" data-id="${n.id}">Drain</button>` : ''}
              ${n.status === 'draining' || n.status === 'offline' ? `<button class="btn btn-sm btn-outline activate-node" data-id="${n.id}">Activate</button>` : ''}
              <button class="btn btn-sm btn-danger-outline remove-node" data-id="${n.id}">Remove</button>
            </div>
          </div>
        `).join('')}
      </div>`;

    document.getElementById('gen-enroll-token').onclick = async () => {
      const label = prompt('Label for this token (e.g. "PC3-GPU"):');
      if (!label) return;
      try {
        const r = await apiJson('/nodes/enrollment-token', { method: 'POST', body: JSON.stringify({ label, expires_in_hours: 24 }) });
        alert('Enrollment Token (use within 24h):\\n\\n' + r.token + '\\n\\nLabel: ' + r.label);
      } catch (ex) { alert('Failed: ' + ex.message); }
    };
    el.querySelectorAll('.drain-node').forEach(btn => {
      btn.onclick = async () => { try { await api('/nodes/' + btn.dataset.id + '/drain', { method: 'POST' }); renderAdmin(); } catch { alert('Failed'); } };
    });
    el.querySelectorAll('.activate-node').forEach(btn => {
      btn.onclick = async () => { try { await api('/nodes/' + btn.dataset.id + '/activate', { method: 'POST' }); renderAdmin(); } catch { alert('Failed'); } };
    });
    el.querySelectorAll('.remove-node').forEach(btn => {
      btn.onclick = async () => { if (!confirm('Remove this node?')) return; try { await api('/nodes/' + btn.dataset.id, { method: 'DELETE' }); renderAdmin(); } catch { alert('Failed'); } };
    });
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

/* 
   ADMIN "" Scoped API Keys
    */
async function renderAdminScopedKeys() {
  const el = document.getElementById('admin-content');
  try {
    const data = await apiJson('/scoped-keys/admin/all');
    const keys = data.keys || [];
    el.innerHTML = `
      <div class="admin-header">
        <h2>Scoped API Keys <span class="badge" class="badge-neutral" style="font-size:.75rem;vertical-align:middle">${keys.length}</span></h2>
      </div>
      ${keys.length === 0 ? '<div class="empty-state"><p>No scoped API keys created yet</p></div>' : `
      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Owner</th><th>Name</th><th>Models</th><th>Req/hr</th><th>Tok/day</th><th>Usage</th><th>Expires</th><th>Actions</th></tr></thead>
        <tbody>
          ${keys.map(k => `
            <tr>
              <td class="mono bold">${esc(k.user_roll || k.user_id)}</td>
              <td>${esc(k.name)}</td>
              <td>${(k.allowed_models || []).map(m => '<span class="model-tag">' + esc(m) + '</span>').join(' ') || '<span class="muted">All</span>'}</td>
              <td>${k.requests_per_hour || 'ˆž'}</td>
              <td>${fmtNum(k.tokens_per_day || 0)}</td>
              <td>${fmtNum(k.total_requests || 0)} req / ${fmtNum(k.total_tokens || 0)} tok</td>
              <td class="muted">${k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Never'}</td>
              <td><button class="btn btn-sm btn-danger-outline revoke-scoped" data-id="${k.id}">Revoke</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`}`;

    el.querySelectorAll('.revoke-scoped').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Revoke this scoped key?')) return;
        try { await api('/scoped-keys/admin/' + btn.dataset.id, { method: 'DELETE' }); renderAdmin(); } catch { alert('Failed'); }
      };
    });
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

/* 
   ADMIN "" Audit Log
    */
async function renderAdminAuditLog() {
  const el = document.getElementById('admin-content');
  try {
    const data = await apiJson('/notifications/audit-logs?per_page=100');
    const logs = data.logs || [];
    el.innerHTML = `
      <div class="admin-header">
        <h2>Audit Log <span class="badge" class="badge-neutral" style="font-size:.75rem;vertical-align:middle">${logs.length}</span></h2>
      </div>
      ${logs.length === 0 ? '<div class="empty-state"><p>No audit events recorded yet</p></div>' : `
      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td class="muted" style="white-space:nowrap">${timeAgo(l.created_at)}</td>
              <td class="mono">${esc(l.actor_roll || l.actor_id || 'system')}</td>
              <td><span class="audit-action">${esc(l.action)}</span></td>
              <td><span class="muted">${esc(l.resource_type || '')}${l.resource_id ? '#' + l.resource_id : ''}</span></td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.details || '')}">${esc((l.details || '').slice(0, 80))}</td>
              <td class="mono muted">${esc(l.ip_address || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`}`;
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

/* 
   ADMIN "" Guardrails Control Panel
    */
async function renderAdminGuardrails() {
  const el = document.getElementById('admin-content');
  el.innerHTML = `<div class="admin-header">
    <div><h2>Guardrails</h2><p class="muted" style="margin:0">Control AI safety filters in real time. Changes take effect immediately.</p></div>
    <button class="btn btn-primary" id="gr-add-btn" style="width:auto;padding:8px 16px">+ Add Rule</button>
  </div>
  <div id="gr-rules-list"><div class="loading-state"><div class="spinner"></div><span>Loading rules"¦</span></div></div>`;

  document.getElementById('gr-add-btn').onclick = () => showAddGuardrailModal();
  await loadGuardrailRules();
}

async function loadGuardrailRules() {
  const el = document.getElementById('gr-rules-list');
  if (!el) return;
  try {
    const data = await apiJson('/guardrails/rules');
    const rules = data.rules || [];
    const cats = [...new Set(rules.map(r => r.category))].sort();
    const actionClass = {block:'badge-danger',flag:'badge-warn',redact:'badge-purple',log:'badge-info'};
    el.innerHTML = cats.map(cat => `
      <div class="gr-category">
        <div class="gr-cat-header">${esc(cat)}</div>
        ${rules.filter(r => r.category === cat).map(rule => `
          <div class="gr-rule-row ${rule.enabled ? '' : 'disabled'}" data-rule-id="${rule.id}">
            <div class="gr-rule-left">
              <label class="gr-toggle">
                <input type="checkbox" class="gr-toggle-input" data-rule-id="${rule.id}" ${rule.enabled ? 'checked' : ''}>
                <span class="gr-toggle-slider"></span>
              </label>
              <div class="gr-rule-info">
                <span class="gr-rule-desc">${esc(rule.description || rule.pattern)}</span>
                <code class="gr-rule-pattern muted">${esc(rule.pattern)}</code>
              </div>
            </div>
            <div class="gr-rule-right">
              <span class="badge ${actionClass[rule.action]||'badge-neutral'}">${esc(rule.action)}</span>
              <span class="gr-rule-priority muted" title="Priority">${rule.priority}</span>
              <button class="icon-btn gr-delete-btn" data-rule-id="${rule.id}" title="Delete rule">&times;</button>
            </div>
          </div>`).join('')}
      </div>`).join('');

    // Bind toggles
    el.querySelectorAll('.gr-toggle-input').forEach(cb => {
      cb.onchange = async () => {
        const ruleId = cb.dataset.ruleId;
        cb.disabled = true;
        try {
          await api(`/guardrails/rules/${ruleId}/toggle`, { method: 'PATCH' });
          const row = el.querySelector(`.gr-rule-row[data-rule-id="${ruleId}"]`);
          if (row) row.classList.toggle('disabled', !cb.checked);
          showToast(cb.checked ? 'Rule enabled' : 'Rule disabled', 'success');
        } catch(ex) { cb.checked = !cb.checked; showToast('Failed: ' + ex.message, 'error'); }
        cb.disabled = false;
      };
    });

    // Bind delete buttons
    el.querySelectorAll('.gr-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this guardrail rule?')) return;
        const ruleId = btn.dataset.ruleId;
        try {
          await api(`/guardrails/rules/${ruleId}`, { method: 'DELETE' });
          showToast('Rule deleted', 'success');
          await loadGuardrailRules();
        } catch(ex) { showToast('Failed: ' + ex.message, 'error'); }
      };
    });
  } catch(ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}

function showAddGuardrailModal() {
  showModal({
    title: 'Add Guardrail Rule',
    body: `
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>Category</label>
          <input id="gr-new-cat" class="form-input" placeholder="e.g. prompt_injection, harmful, custom"></div>
        <div class="form-group" style="flex:1"><label>Action</label>
          <select id="gr-new-action" class="form-input">
            <option value="block">block</option>
            <option value="flag">flag</option>
            <option value="redact">redact</option>
            <option value="log">log</option>
          </select></div>
      </div>
      <div class="form-group"><label>Pattern (regex)</label>
        <input id="gr-new-pattern" class="form-input" placeholder="e.g. ignore.*previous|jailbreak"></div>
      <div class="form-group"><label>Description</label>
        <input id="gr-new-desc" class="form-input" placeholder="Human-readable description"></div>
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>Priority</label>
          <input id="gr-new-priority" class="form-input" type="number" value="100" min="1" max="999"></div>
        <div class="form-group" style="flex:1;align-self:flex-end"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input id="gr-new-enabled" type="checkbox" checked> Enabled</label></div>
      </div>`,
    confirmText: 'Add Rule',
    onConfirm: async () => {
      const pattern = document.getElementById('gr-new-pattern').value.trim();
      if (!pattern) { showToast('Pattern is required', 'error'); return false; }
      const body = {
        category: document.getElementById('gr-new-cat').value.trim() || 'custom',
        action: document.getElementById('gr-new-action').value,
        pattern,
        description: document.getElementById('gr-new-desc').value.trim(),
        priority: parseInt(document.getElementById('gr-new-priority').value) || 100,
        enabled: document.getElementById('gr-new-enabled').checked,
      };
      const r = await api('/guardrails/rules', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json(); showToast(d.detail || 'Failed', 'error'); return false; }
      showToast('Rule added', 'success');
      closeModal();
      await loadGuardrailRules();
    },
  });
}

/* 
   ADMIN "" Feature Flags Management
    */
async function renderAdminFeatures() {
  const el = document.getElementById('admin-content');
  el.innerHTML = `<div class="admin-header">
    <div><h2>Feature Flags</h2><p class="muted" style="margin:0">Toggle features per-role. Changes propagate to all clients within 2 seconds via SSE.</p></div>
  </div>
  <div id="features-list"><div class="loading-state"><div class="spinner"></div><span>Loading flags"¦</span></div></div>`;

  try {
    const data = await apiJson('/features/status');
    const flags = data.flags || {};
    const roles = data.roles || {};
    const el2 = document.getElementById('features-list');
    if (!el2) return;

    const FLAG_LABELS = {
      ai_chat: 'AI Chat', web_search: 'Web Search in Chat', image_gen: 'Image Generation',
      voice_input: 'Voice Input (STT)', tts_output: 'Text-to-Speech', mbm_book: 'MBM Book (Notebooks)',
      rag_upload: 'Document Upload', copy_check: 'Copy Check', attendance: 'Attendance',
      doubts_forum: 'Doubts Forum', file_sharing: 'File Sharing',
      community_models: 'Community Models', dark_mode: 'Dark Mode',
      guest_access: 'Guest Access', video_studio: 'Video Studio',
    };

    el2.innerHTML = `<table class="data-table">
      <thead><tr><th>Flag Key</th><th>Label</th><th>Roles</th><th style="text-align:center">Enabled</th></tr></thead>
      <tbody>
        ${Object.keys(flags).map(key => `
          <tr>
            <td><code style="font-size:.8rem">${esc(key)}</code></td>
            <td style="font-size:.85rem">${esc(FLAG_LABELS[key] || key)}</td>
            <td style="font-size:.75rem;color:var(--muted)">${(roles[key] || []).join(', ') || '""'}</td>
            <td style="text-align:center">
              <label class="toggle-switch">
                <input type="checkbox" data-flag="${esc(key)}" ${flags[key] ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

    el2.querySelectorAll('input[data-flag]').forEach(cb => {
      cb.onchange = async () => {
        const key = cb.dataset.flag;
        try {
          await api(`/admin/features/${key}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: cb.checked }),
          });
          showToast(`${key} ${cb.checked ? 'enabled' : 'disabled'}`, 'success');
        } catch {
          cb.checked = !cb.checked;
          showToast('Failed to update flag', 'error');
        }
      };
    });
  } catch (e) {
    document.getElementById('features-list').innerHTML = `<div class="error-state">Failed to load feature flags: ${esc(String(e))}</div>`;
  }
}

/* 
   ADMIN "" Live Activity Stream (SSE)
    */
let _activityEs = null;
let _activityLog = [];

async function renderAdminActivityStream() {
  const el = document.getElementById('admin-content');
  el.innerHTML = `<div class="admin-header">
    <div><h2>Live Activity</h2><p class="muted" style="margin:0">Real-time audit events streamed from the server.</p></div>
    <div style="display:flex;align-items:center;gap:10px">
      <span id="activity-status-dot" class="status-dot offline" title="Disconnected"></span>
      <span id="activity-status-label" class="muted" style="font-size:.8rem">Connecting"¦</span>
      <button class="btn btn-sm btn-outline" id="activity-clear-btn">Clear</button>
    </div>
  </div>
  <div class="activity-feed" id="activity-feed">
    <div class="loading-state"><div class="spinner"></div><span>Connecting to live stream"¦</span></div>
  </div>`;

  document.getElementById('activity-clear-btn').onclick = () => {
    _activityLog = [];
    renderActivityFeed();
  };

  // Disconnect any previous SSE connection
  if (_activityEs) { _activityEs.close(); _activityEs = null; }

  const token = state.token || '';
  const url = `/api/v1/notifications/activity-stream?token=${encodeURIComponent(token)}`;
  _activityEs = new EventSource(url);

  _activityEs.onopen = () => {
    document.getElementById('activity-status-dot')?.classList.replace('offline', 'online');
    document.getElementById('activity-status-label').textContent = 'Live';
  };

  _activityEs.addEventListener('connected', (e) => {
    const feed = document.getElementById('activity-feed');
    if (feed) feed.innerHTML = '<p class="muted" style="padding:12px;font-size:.8rem">Waiting for activity"¦</p>';
  });

  _activityEs.addEventListener('activity', (e) => {
    try {
      const entry = JSON.parse(e.data);
      _activityLog.unshift(entry);
      if (_activityLog.length > 200) _activityLog.pop();
      renderActivityFeed();
    } catch {}
  });

  _activityEs.addEventListener('error', (e) => {
    try {
      const entry = JSON.parse(e.data);
      const feed = document.getElementById('activity-feed');
      if (feed) feed.innerHTML = `<div class="error-state"><p>${esc(entry.detail || 'Stream error')}</p></div>`;
    } catch {}
  });

  _activityEs.onerror = () => {
    document.getElementById('activity-status-dot')?.classList.replace('online', 'offline');
    const labelEl = document.getElementById('activity-status-label');
    if (labelEl) labelEl.textContent = 'Reconnecting"¦';
  };

  // Cleanup when admin tab changes
  const tabObserver = new MutationObserver(() => {
    if (!document.getElementById('activity-feed')) {
      if (_activityEs) { _activityEs.close(); _activityEs = null; }
      tabObserver.disconnect();
    }
  });
  const adminContent = document.getElementById('admin-content');
  if (adminContent) tabObserver.observe(adminContent, { childList: true });
}

function renderActivityFeed() {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  if (_activityLog.length === 0) {
    feed.innerHTML = '<p class="muted" style="padding:12px;font-size:.8rem">No activity yet.</p>';
    return;
  }
  const actionCssVar = {
    'copy_check': 'var(--color-copy-check)', 'auth': 'var(--color-auth)',
    'admin': 'var(--color-admin)', 'query': 'var(--color-query)', 'system': 'var(--muted)',
  };
  feed.innerHTML = _activityLog.map(entry => {
    const catKey = (entry.action || '').split('.')[0];
    const color = actionCssVar[catKey] || 'var(--muted)';
    return `<div class="activity-entry">
      <span class="activity-dot" style="background:${color}"></span>
      <div class="activity-body">
        <span class="activity-action">${esc(entry.action || '')}</span>
        <span class="activity-meta muted">${esc(entry.actor_role || '')} &middot; ${esc(entry.resource_type || '')}</span>
        ${entry.details ? `<span class="activity-details muted">${esc((entry.details || '').slice(0, 120))}</span>` : ''}
      </div>
      <span class="activity-time muted">${entry.created_at ? timeAgo(entry.created_at) : ''}</span>
    </div>`;
  }).join('');
}
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
                <a href="${API}/files/${esc(f.id)}/download" class="btn btn-sm btn-outline" download="${esc(f.display_name || f.filename)}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download
                </a>
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

// Notebook state
let _nbState = {
  notebooks: [],
  current: null,
  cells: [],
  ws: null,
  executingCells: new Set(),
  outputs: {},
  kernelId: null,
  sidebarOpen: true,
};

function _nbLoadFromStorage() {
  _nbState.notebooks = userGet('notebooks', []);
}

function _nbSave() {
  // Save notebook list
  if (_nbState.current) {
    const nb = _nbState.notebooks.find(n => n.id === _nbState.current);
    if (nb) {
      nb.cells = _nbState.cells;
      nb.outputs = _nbState.outputs;
      nb.updated_at = new Date().toISOString();
    }
  }
  userSet('notebooks', _nbState.notebooks);
}

function _nbNewId() { return crypto.randomUUID ? crypto.randomUUID() : 'nb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
function _cellNewId() { return 'cell-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

function _nbCreate(title) {
  const nb = {
    id: _nbNewId(),
    title: title || 'Untitled Book',
    language: 'python',
    cells: [{ id: _cellNewId(), type: 'code', source: '', language: 'python' }],
    outputs: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  _nbState.notebooks.unshift(nb);
  _nbState.current = nb.id;
  _nbState.cells = nb.cells;
  _nbState.outputs = nb.outputs || {};
  _nbSave();
  return nb;
}

function _nbLoad(nbId) {
  const nb = _nbState.notebooks.find(n => n.id === nbId);
  if (!nb) return false;
  _nbState.current = nb.id;
  _nbState.cells = nb.cells || [];
  _nbState.outputs = nb.outputs || {};
  return true;
}

function _nbDelete(nbId) {
  _nbState.notebooks = _nbState.notebooks.filter(n => n.id !== nbId);
  if (_nbState.current === nbId) {
    _nbState.current = null;
    _nbState.cells = [];
    _nbState.outputs = {};
  }
  _nbSave();
}

function _nbConnectWs() {
  if (_nbState.ws && _nbState.ws.readyState <= 1) return;
  if (!_nbState.current) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/notebook/${_nbState.current}`;
  const ws = new WebSocket(url);
  ws.onopen = () => { _nbState.ws = ws; };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      _nbHandleWsMsg(msg);
    } catch {}
  };
  ws.onclose = () => {
    _nbState.ws = null;
    // Auto-reconnect if still on notebooks page
    if (state.page === 'notebooks' && _nbState.current) {
      setTimeout(_nbConnectWs, 3000);
    }
  };
  ws.onerror = () => {};
  _nbState.ws = ws;
}

function _nbHandleWsMsg(msg) {
  const cellId = msg.cell_id;
  if (!cellId) return;

  if (msg.type === 'status') {
    if (msg.execution_state === 'busy') {
      _nbState.executingCells.add(cellId);
    } else if (msg.execution_state === 'idle') {
      _nbState.executingCells.delete(cellId);
    }
    _nbRenderCellStatus(cellId);
    return;
  }

  // Initialize output array
  if (!_nbState.outputs[cellId]) _nbState.outputs[cellId] = [];

  if (msg.type === 'stream') {
    _nbState.outputs[cellId].push({ type: 'stream', name: msg.name, text: msg.text });
  } else if (msg.type === 'error') {
    _nbState.outputs[cellId].push({ type: 'error', ename: msg.ename, evalue: msg.evalue, traceback: msg.traceback || [] });
    _nbState.executingCells.delete(cellId);
    _nbRenderCellStatus(cellId);
  } else if (msg.type === 'execute_result' || msg.type === 'display_data') {
    _nbState.outputs[cellId].push({ type: msg.type, data: msg.data });
  }

  _nbRenderCellOutput(cellId);
  _nbSave();
}

function _nbExecCell(cellId) {
  const cell = _nbState.cells.find(c => c.id === cellId);
  if (!cell || cell.type !== 'code') return;
  _nbState.outputs[cellId] = []; // Clear previous output
  _nbRenderCellOutput(cellId);

  if (_nbState.ws && _nbState.ws.readyState === 1) {
    _nbState.ws.send(JSON.stringify({
      type: 'execute',
      cell_id: cellId,
      code: cell.source,
      language: cell.language || 'python',
      kernel_id: _nbState.kernelId,
    }));
  } else {
    // Fallback: REST API execution
    _nbExecCellRest(cellId, cell);
  }
}

async function _nbExecCellRest(cellId, cell) {
  _nbState.executingCells.add(cellId);
  _nbState.outputs[cellId] = [];
  _nbRenderCellStatus(cellId);
  _nbRenderCellOutput(cellId);

  try {
    // First save cell to backend, then execute
    const res = await api('/notebooks/cells/' + cellId + '/run', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      const exec = data.execution;
      if (exec.stdout) _nbState.outputs[cellId].push({ type: 'stream', name: 'stdout', text: exec.stdout });
      if (exec.stderr) _nbState.outputs[cellId].push({ type: 'stream', name: 'stderr', text: exec.stderr });
      if (exec.status === 'failed' || exec.status === 'timeout') {
        _nbState.outputs[cellId].push({ type: 'error', ename: exec.status, evalue: exec.stderr || 'Execution failed', traceback: [] });
      }
    } else {
      // WebSocket-only execution
      _nbState.outputs[cellId].push({ type: 'stream', name: 'stderr', text: 'Connecting to execution engine...\n' });
      _nbConnectWs();
      await new Promise(r => setTimeout(r, 1000));
      if (_nbState.ws && _nbState.ws.readyState === 1) {
        _nbState.ws.send(JSON.stringify({
          type: 'execute', cell_id: cellId,
          code: cell.source, language: cell.language || 'python',
        }));
        return; // WS handler will manage from here
      }
      _nbState.outputs[cellId].push({ type: 'error', ename: 'ConnectionError', evalue: 'Could not connect to execution engine', traceback: [] });
    }
  } catch (e) {
    _nbState.outputs[cellId].push({ type: 'error', ename: 'Error', evalue: e.message, traceback: [] });
  }

  _nbState.executingCells.delete(cellId);
  _nbRenderCellStatus(cellId);
  _nbRenderCellOutput(cellId);
  _nbSave();
}

const NB_LANGUAGES = [
  { id: 'python', name: 'Python', color: '#3776AB' },
  { id: 'javascript', name: 'JavaScript', color: '#F7DF1E' },
  { id: 'typescript', name: 'TypeScript', color: '#3178C6' },
  { id: 'c', name: 'C', color: '#A8B9CC' },
  { id: 'cpp', name: 'C++', color: '#00599C' },
  { id: 'java', name: 'Java', color: '#ED8B00' },
  { id: 'go', name: 'Go', color: '#00ADD8' },
  { id: 'rust', name: 'Rust', color: '#DEA584' },
  { id: 'r', name: 'R', color: '#276DC3' },
  { id: 'julia', name: 'Julia', color: '#9558B2' },
  { id: 'bash', name: 'Bash', color: '#4EAA25' },
  { id: 'sql', name: 'SQL', color: '#003B57' },
  { id: 'csharp', name: 'C#', color: '#239120' },
  { id: 'ruby', name: 'Ruby', color: '#CC342D' },
  { id: 'php', name: 'PHP', color: '#777BB4' },
  { id: 'kotlin', name: 'Kotlin', color: '#7F52FF' },
  { id: 'swift', name: 'Swift', color: '#F05138' },
  { id: 'lua', name: 'Lua', color: '#000080' },
  { id: 'haskell', name: 'Haskell', color: '#5D4F85' },
  { id: 'html', name: 'HTML', color: '#E34F26' },
];

function _nbRenderCellStatus(cellId) {
  const el = document.getElementById('nb-cell-' + cellId);
  if (!el) return;
  const isExec = _nbState.executingCells.has(cellId);
  el.classList.toggle('executing', isExec);
  const btn = el.querySelector('.nb-run-btn');
  if (btn) {
    btn.innerHTML = isExec
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  }
}

function _nbRenderCellOutput(cellId) {
  const container = document.getElementById('nb-output-' + cellId);
  if (!container) return;
  const outputs = _nbState.outputs[cellId] || [];
  if (outputs.length === 0) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'block';

  let html = '<div class="nb-output-label"><span>Output</span><button class="icon-btn nb-clear-this-output" data-cell="' + cellId + '" title="Clear output" style="margin-left:auto;font-size:.75rem;opacity:.6">&#10005;</button></div>';
  for (const out of outputs) {
    if (out.type === 'stream') {
      const cls = out.name === 'stderr' ? 'nb-out-stderr' : 'nb-out-stdout';
      html += `<pre class="${cls}">${esc(out.text)}</pre>`;
    } else if (out.type === 'error') {
      html += `<div class="nb-out-error"><strong>${esc(out.ename || 'Error')}: ${esc(out.evalue || '')}</strong>`;
      if (out.traceback && out.traceback.length) {
        html += `<pre class="nb-out-traceback">${esc(out.traceback.join('\n'))}</pre>`;
      }
      html += `</div>`;
    } else if (out.type === 'execute_result' || out.type === 'display_data') {
      const data = out.data || {};
      if (data['text/html']) html += `<div class="nb-out-html">${data['text/html']}</div>`;
      else if (data['image/png']) html += `<img class="nb-out-img" src="data:image/png;base64,${data['image/png']}">`;
      else if (data['text/plain']) html += `<pre class="nb-out-stdout">${esc(data['text/plain'])}</pre>`;
    }
  }
  container.innerHTML = html;
}

function renderNotebooks() {
  const el = document.getElementById('page-content');
  el.className = 'page nb-page-container';
  el.style.padding = '0';
  el.style.overflow = 'hidden';
  el.style.display = 'flex';

  const nb = _nbState.current ? _nbState.notebooks.find(n => n.id === _nbState.current) : null;

  el.innerHTML = `
    <div class="nb-sidebar ${_nbState.sidebarOpen ? '' : 'collapsed'}">
      <div class="nb-sidebar-header">
        <span class="nb-sidebar-title">Explorer</span>
        <button class="icon-btn nb-sidebar-toggle" title="Toggle sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
      </div>
      <button class="btn btn-sm btn-primary nb-new-btn" style="margin:8px 12px;width:calc(100% - 24px)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Book
      </button>
      <div class="nb-sidebar-list">
        ${_nbState.notebooks.map(n => `
          <div class="nb-sidebar-item ${n.id === _nbState.current ? 'active' : ''}" data-id="${n.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span class="nb-item-title">${esc(n.title)}</span>
            ${n.id !== _nbState.current ? `<button class="icon-btn nb-item-del" data-del="${n.id}" title="Delete">&times;</button>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="nb-main">
      <div class="nb-toolbar">
        <button class="icon-btn nb-sidebar-toggle-main" title="Toggle Explorer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
        ${nb ? `
        <input class="nb-title-input" id="nb-title" value="${esc(nb.title)}" placeholder="Book title">
        <div class="nb-toolbar-actions">
          <button class="btn btn-sm btn-outline nb-add-code" title="Add Code Cell">+ Code</button>
          <button class="btn btn-sm btn-outline nb-add-md" title="Add Markdown Cell">+ Markdown</button>
          <button class="btn btn-sm btn-outline nb-clear-outputs" title="Clear All Outputs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v10l4-4"/><path d="M23 20V10l-4 4"/></svg>
            Clear
          </button>
          <button class="btn btn-sm btn-outline nb-download" title="Download as .ipynb">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            .ipynb
          </button>
          <button class="btn btn-sm btn-primary nb-run-all" title="Run All Cells">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run All
          </button>
        </div>
        <span class="nb-kernel-status" id="nb-kernel-status">
          <span class="nb-kernel-dot" id="nb-kernel-dot"></span>
          <span id="nb-kernel-label">Python 3</span>
        </span>
        ` : '<span style="color:var(--muted);padding:0 12px">Select or create a notebook</span>'}
      </div>
      <div class="nb-cells" id="nb-cells">
        ${nb ? _nbRenderAllCells() : `
          <div class="nb-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <h3>MBM Book</h3>
            <p class="muted">Create a new book to start coding "" 25+ languages, offline, Kaggle-style.</p>
            <button class="btn btn-primary nb-empty-create">New Book</button>
          </div>
        `}
      </div>
    </div>`;

  _nbBindAll();
  if (_nbState.current) _nbConnectWs();
}

function _nbRenderAllCells() {
  return _nbState.cells.map((cell, idx) =>
    _nbRenderCell(cell, idx) + `
    <div class="nb-between-add">
      <div class="nb-between-line"></div>
      <div class="nb-between-btns">
        <button class="nb-between-btn" data-after="${cell.id}" data-type="code">+ Code</button>
        <button class="nb-between-btn" data-after="${cell.id}" data-type="markdown">+ Markdown</button>
      </div>
    </div>`
  ).join('');
}

function _nbRenderCell(cell, idx) {
  const lang = NB_LANGUAGES.find(l => l.id === cell.language) || { id: cell.language || 'python', name: cell.language || 'Python', color: '#666' };
  const isExec = _nbState.executingCells.has(cell.id);
  const outputs = _nbState.outputs[cell.id] || [];
  const hasOutput = outputs.length > 0;

  if (cell.type === 'markdown') {
    return `
    <div class="nb-cell nb-cell-md ${isExec ? 'executing' : ''}" id="nb-cell-${cell.id}" data-cell="${cell.id}">
      <div class="nb-cell-gutter">
        <span class="nb-cell-num">${idx + 1}</span>
      </div>
      <div class="nb-cell-content">
        <div class="nb-cell-toolbar">
          <span class="nb-cell-type-badge" style="background:${lang.color}20;color:${lang.color}">Markdown</span>
          <div class="nb-cell-actions">
            <button class="icon-btn nb-move-up" data-cell="${cell.id}" title="Move up"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>
            <button class="icon-btn nb-move-down" data-cell="${cell.id}" title="Move down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
            <button class="icon-btn nb-del-cell" data-cell="${cell.id}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
        <div class="nb-md-preview" data-cell="${cell.id}">${cell.source ? formatMd(cell.source) : '<em class="muted">Click to edit markdown"¦</em>'}</div>
        <textarea class="nb-md-editor" data-cell="${cell.id}" style="display:none" rows="4">${esc(cell.source)}</textarea>
      </div>
    </div>`;
  }

  // Code cell
  return `
  <div class="nb-cell nb-cell-code ${isExec ? 'executing' : ''}" id="nb-cell-${cell.id}" data-cell="${cell.id}">
    <div class="nb-cell-gutter">
      <button class="icon-btn nb-run-btn" data-cell="${cell.id}" title="Run (Shift+Enter)">
        ${isExec
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'}
      </button>
      <span class="nb-cell-num">[${idx + 1}]</span>
    </div>
    <div class="nb-cell-content">
      <div class="nb-cell-toolbar">
        <select class="nb-lang-select" data-cell="${cell.id}">
          ${NB_LANGUAGES.map(l => `<option value="${l.id}" ${l.id === (cell.language || 'python') ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
        <span class="nb-lang-dot" style="background:${lang.color}"></span>
        <div class="nb-cell-actions">
          <button class="icon-btn nb-ai-debug" data-cell="${cell.id}" title="AI Debug "" explain error or suggest fix">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><circle cx="12" cy="16" r=".5" fill="currentColor"/></svg>
          </button>
          <button class="icon-btn nb-move-up" data-cell="${cell.id}" title="Move up"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>
          <button class="icon-btn nb-move-down" data-cell="${cell.id}" title="Move down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
          <button class="icon-btn nb-del-cell" data-cell="${cell.id}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>
      <textarea class="nb-code-editor" data-cell="${cell.id}" spellcheck="false" rows="${Math.max(3, (cell.source || '').split('\n').length)}" placeholder="Start coding"¦ (Shift+Enter to run)">${esc(cell.source)}</textarea>
      <div class="nb-cell-output ${hasOutput ? '' : 'empty'}" id="nb-output-${cell.id}" style="${hasOutput ? '' : 'display:none'}">${hasOutput ? '' : ''}</div>
    </div>
  </div>`;
}

function _nbRefreshCells() {
  const container = document.getElementById('nb-cells');
  if (!container) return;
  container.innerHTML = _nbRenderAllCells();
  _nbBindCells();
  // Re-render outputs
  for (const cellId of Object.keys(_nbState.outputs)) {
    _nbRenderCellOutput(cellId);
  }
}

function _nbBindAll() {
  // New notebook buttons
  document.querySelectorAll('.nb-new-btn, .nb-empty-create').forEach(btn => {
    btn.onclick = () => { _nbCreate('Untitled Book'); renderNotebooks(); };
  });

  // Sidebar items
  document.querySelectorAll('.nb-sidebar-item').forEach(item => {
    item.onclick = (e) => {
      if (e.target.closest('.nb-item-del')) return;
      _nbSave(); // Save current before switching
      _nbLoad(item.dataset.id);
      renderNotebooks();
    };
  });
  document.querySelectorAll('.nb-item-del').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); if (confirm('Delete this notebook?')) { _nbDelete(btn.dataset.del); renderNotebooks(); } };
  });

  // Sidebar toggle
  document.querySelectorAll('.nb-sidebar-toggle, .nb-sidebar-toggle-main').forEach(btn => {
    btn.onclick = () => { _nbState.sidebarOpen = !_nbState.sidebarOpen; renderNotebooks(); };
  });

  // Title input
  const titleInput = document.getElementById('nb-title');
  if (titleInput) {
    titleInput.onchange = () => {
      const nb = _nbState.notebooks.find(n => n.id === _nbState.current);
      if (nb) { nb.title = titleInput.value; _nbSave(); }
    };
  }

  // Toolbar actions
  const addCode = document.querySelector('.nb-add-code');
  if (addCode) addCode.onclick = () => { _nbAddCell('code'); };
  const addMd = document.querySelector('.nb-add-md');
  if (addMd) addMd.onclick = () => { _nbAddCell('markdown'); };

  document.querySelector('.nb-clear-outputs')?.addEventListener('click', () => {
    _nbState.outputs = {};
    _nbSave();
    _nbRefreshCells();
  });

  document.querySelector('.nb-download')?.addEventListener('click', _nbDownloadIpynb);
  document.querySelector('.nb-run-all')?.addEventListener('click', _nbRunAll);

  _nbBindCells();
}

function _nbBindCells() {
  // Code editors - auto-resize and save
  document.querySelectorAll('.nb-code-editor').forEach(ta => {
    const cellId = ta.dataset.cell;
    ta.oninput = () => {
      const cell = _nbState.cells.find(c => c.id === cellId);
      if (cell) { cell.source = ta.value; _nbSave(); }
      ta.rows = Math.max(3, ta.value.split('\n').length);
    };
    ta.onkeydown = (e) => {
      // Shift+Enter to run
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        _nbExecCell(cellId);
      }
      // Tab for indentation
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 4;
        ta.oninput();
      }
    };
  });

  // Run buttons
  document.querySelectorAll('.nb-run-btn').forEach(btn => {
    btn.onclick = () => _nbExecCell(btn.dataset.cell);
  });

  // Language selectors
  document.querySelectorAll('.nb-lang-select').forEach(sel => {
    sel.onchange = () => {
      const cell = _nbState.cells.find(c => c.id === sel.dataset.cell);
      if (cell) { cell.language = sel.value; _nbSave(); }
    };
  });

  // Move up/down
  document.querySelectorAll('.nb-move-up').forEach(btn => {
    btn.onclick = () => {
      const idx = _nbState.cells.findIndex(c => c.id === btn.dataset.cell);
      if (idx > 0) { [_nbState.cells[idx - 1], _nbState.cells[idx]] = [_nbState.cells[idx], _nbState.cells[idx - 1]]; _nbSave(); _nbRefreshCells(); }
    };
  });
  document.querySelectorAll('.nb-move-down').forEach(btn => {
    btn.onclick = () => {
      const idx = _nbState.cells.findIndex(c => c.id === btn.dataset.cell);
      if (idx < _nbState.cells.length - 1) { [_nbState.cells[idx], _nbState.cells[idx + 1]] = [_nbState.cells[idx + 1], _nbState.cells[idx]]; _nbSave(); _nbRefreshCells(); }
    };
  });

  // AI Debug: explain error or suggest fix using MAC chat
  document.querySelectorAll('.nb-ai-debug').forEach(btn => {
    btn.onclick = async () => {
      const cellId = btn.dataset.cell;
      const cell = _nbState.cells.find(c => c.id === cellId);
      if (!cell) return;
      const outputs = _nbState.outputs[cellId] || [];
      const errorOut = outputs.find(o => o.type === 'error');
      const stdout = outputs.filter(o => o.type === 'stream').map(o => o.text).join('');

      let prompt = `I have a ${cell.language || 'Python'} code cell:\n\`\`\`${cell.language || 'python'}\n${cell.source}\n\`\`\`\n`;
      if (errorOut) {
        prompt += `\nIt produced this error:\n${errorOut.ename}: ${errorOut.evalue}\n${(errorOut.traceback || []).join('\n')}\n\nPlease explain the error and suggest a fix.`;
      } else if (stdout) {
        prompt += `\nOutput:\n${stdout}\n\nPlease explain what this code does and if there are any improvements.`;
      } else {
        prompt += `\nPlease review this code and suggest improvements or explain what it does.`;
      }

      // Show AI response in an output panel below the cell
      const outputEl = document.getElementById(`nb-output-${cellId}`);
      if (outputEl) {
        outputEl.style.display = '';
        outputEl.innerHTML = `<div class="nb-ai-panel"><div class="nb-ai-header"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/></svg> MAC AI Debug</div><div class="nb-ai-response"><div class="spinner" style="width:16px;height:16px;margin:8px auto"></div></div></div>`;
        const respEl = outputEl.querySelector('.nb-ai-response');

        try {
          const res = await fetch(`${API}/query/chat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: prompt }], stream: false }),
          });
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || 'No response';
          respEl.innerHTML = formatMd(content);
        } catch (e) {
          respEl.textContent = 'AI Debug failed: ' + e.message;
        }
      }
    };
  });

  // Delete cell
  document.querySelectorAll('.nb-del-cell').forEach(btn => {
    btn.onclick = () => {
      _nbState.cells = _nbState.cells.filter(c => c.id !== btn.dataset.cell);
      delete _nbState.outputs[btn.dataset.cell];
      _nbSave();
      _nbRefreshCells();
    };
  });

  // Markdown preview/edit toggle
  document.querySelectorAll('.nb-md-preview').forEach(preview => {
    preview.onclick = () => {
      const editor = preview.parentElement.querySelector('.nb-md-editor');
      preview.style.display = 'none';
      editor.style.display = 'block';
      editor.focus();
    };
  });
  document.querySelectorAll('.nb-md-editor').forEach(editor => {
    editor.oninput = () => {
      const cell = _nbState.cells.find(c => c.id === editor.dataset.cell);
      if (cell) { cell.source = editor.value; _nbSave(); }
    };
    editor.onblur = () => {
      const preview = editor.parentElement.querySelector('.nb-md-preview');
      const cell = _nbState.cells.find(c => c.id === editor.dataset.cell);
      preview.innerHTML = cell && cell.source ? formatMd(cell.source) : '<em class="muted">Click to edit markdown"¦</em>';
      preview.style.display = 'block';
      editor.style.display = 'none';
    };
  });

  // Bottom add-cell buttons
  document.querySelectorAll('.nb-add-code-bottom').forEach(btn => { btn.onclick = () => _nbAddCell('code'); });
  document.querySelectorAll('.nb-add-md-bottom').forEach(btn => { btn.onclick = () => _nbAddCell('markdown'); });

  // Between-cell add buttons
  document.querySelectorAll('.nb-between-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = _nbState.cells.findIndex(c => c.id === btn.dataset.after);
      _nbAddCell(btn.dataset.type, idx);
    };
  });

  // Clear individual cell output
  document.querySelectorAll('.nb-clear-this-output').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      _nbState.outputs[btn.dataset.cell] = [];
      _nbRenderCellOutput(btn.dataset.cell);
      _nbSave();
    };
  });
}

function _nbAddCell(type, afterIdx) {
  const cell = { id: _cellNewId(), type, source: '', language: type === 'code' ? 'python' : undefined };
  if (afterIdx !== undefined) {
    _nbState.cells.splice(afterIdx + 1, 0, cell);
  } else {
    _nbState.cells.push(cell);
  }
  _nbSave();
  _nbRefreshCells();
  // Scroll to new cell
  setTimeout(() => {
    const el = document.getElementById('nb-cell-' + cell.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

async function _nbRunAll() {
  for (const cell of _nbState.cells) {
    if (cell.type === 'code') {
      _nbExecCell(cell.id);
      // Wait a bit between cells for sequential execution
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function _nbDownloadIpynb() {
  const nb = _nbState.notebooks.find(n => n.id === _nbState.current);
  if (!nb) return;

  const ipynb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: nb.language || 'python', version: '3.11' },
    },
    cells: _nbState.cells.map(cell => {
      const outputs = (_nbState.outputs[cell.id] || []).map(out => {
        if (out.type === 'stream') return { output_type: 'stream', name: out.name, text: [out.text] };
        if (out.type === 'error') return { output_type: 'error', ename: out.ename, evalue: out.evalue, traceback: out.traceback };
        return { output_type: 'display_data', data: out.data || {}, metadata: {} };
      });
      return {
        cell_type: cell.type === 'code' ? 'code' : 'markdown',
        source: (cell.source || '').split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l),
        metadata: { language: cell.language },
        ...(cell.type === 'code' ? { execution_count: null, outputs } : {}),
      };
    }),
  };

  const blob = new Blob([JSON.stringify(ipynb, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (nb.title || 'notebook').replace(/[^a-zA-Z0-9_-]/g, '_') + '.ipynb';
  a.click();
  URL.revokeObjectURL(a.href);
}


/* 
   NOTIFICATIONS "" Bell, Panel, Push Subscription
    */
async function loadNotifCount() {
  try {
    const data = await apiJson('/notifications?per_page=1');
    const count = data.unread_count || 0;
    const badge = document.getElementById('notif-count');
    if (badge) badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
  } catch {}
}

async function loadNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-state" style="padding:20px"><div class="spinner"></div></div>';
  try {
    const data = await apiJson('/notifications?per_page=30');
    const notifs = data.notifications || [];
    if (notifs.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" ${n.link ? 'data-link="' + esc(n.link) + '"' : ''}>
        <div class="notif-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div class="notif-body">
          <span class="notif-title">${esc(n.title)}</span>
          <span class="notif-text">${esc(n.body || '')}</span>
          <span class="notif-time">${timeAgo(n.created_at)}</span>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.notif-item').forEach(item => {
      item.onclick = async () => {
        if (item.classList.contains('unread')) {
          try { await api('/notifications/' + item.dataset.id + '/read', { method: 'POST' }); item.classList.remove('unread'); loadNotifCount(); } catch {}
        }
        const link = item.dataset.link;
        if (link) { document.getElementById('notif-panel').classList.remove('open'); if (link.startsWith('#')) navigate(link.slice(1)); }
      };
    });
    loadNotifCount();
  } catch { list.innerHTML = '<div class="notif-empty">Failed to load</div>'; }
}

/* Push notification subscription */
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const vapidResp = await apiJson('/notifications/vapid-key').catch(() => null);
      if (!vapidResp || !vapidResp.public_key) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidResp.public_key),
      });
    }
    const key = sub.getKey('p256dh');
    const auth = sub.getKey('auth');
    await api('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh_key: key ? btoa(String.fromCharCode(...new Uint8Array(key))) : '',
        auth_key: auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
      }),
    });
  } catch {}
}

/* Request browser notification permission on every login */
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  try { await Notification.requestPermission(); } catch {}
}

/* Real-time notification polling "" updates badge every 15s */
function startNotifPolling() {
  if (_notifPollIv) clearInterval(_notifPollIv);
  loadNotifCount();
  _notifPollIv = setInterval(() => loadNotifCount(), 15000);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/* 
   CHART HELPERS
    */
function makeDonut(id, used, total, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const remaining = Math.max(0, total - used);
  const cs = getComputedStyle(document.documentElement);
  const accentColor = color || cs.getPropertyValue('--accent').trim() || '#7c6ff7';
  const trackColor = cs.getPropertyValue('--border').trim() || '#e5e5e5';
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Used', 'Remaining'],
      datasets: [{ data: [used, remaining], backgroundColor: [accentColor, trackColor], borderWidth: 0, cutout: '75%' }],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0,0,0,0.82)',
          titleColor: '#fff',
          bodyColor: '#ddd',
          borderColor: 'rgba(255,255,255,0.15)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
          boxPadding: 4,
          position: 'nearest',
          callbacks: {
            label: (ctx) => ' ' + ctx.label + ': ' + fmtNum(ctx.raw),
          }
        }
      },
      animation: { animateRotate: true, duration: 800 }
    },
  });
}

/* 
   UTILITIES
    */
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmtNum(n) { return Math.round(n || 0).toLocaleString('en-IN'); }
function timeAgo(iso) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return d.toLocaleDateString();
}

function shortModel(m) {
  if (!m) return '?';
  return m.replace(/^(Qwen\/|deepseek-ai\/|openai\/)/, '').replace(/-Instruct$/, '').slice(0, 24);
}

function formatMd(text) {
  // Split on fenced code blocks first to protect their content
  const parts = text.split(/(```[\s\S]*?```)/g);
  let html = '';
  parts.forEach(part => {
    if (part.startsWith('```')) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const lang = (match && match[1]) ? match[1].toLowerCase() : '';
      const code = match ? match[2] : part.slice(3, -3);
      if (lang === 'mermaid') {
        const id = 'mmd-' + Math.random().toString(36).slice(2);
        html += `<div class="mermaid-block" id="${id}"><div class="mmd-loading">Rendering diagram...</div></div>`;
        setTimeout(() => {
          const el = document.getElementById(id);
          if (!el || !window.mermaid) return;
          try { mermaid.render('svg-' + id, code).then(({svg}) => { el.innerHTML = svg; }).catch(() => { el.innerHTML = '<pre>' + esc(code) + '</pre>'; }); }
          catch(e) { el.innerHTML = '<pre>' + esc(code) + '</pre>'; }
        }, 50);
      } else {
        const langLabel = lang || 'code';
        const copyId = 'copy-' + Math.random().toString(36).slice(2);
        let highlighted = '';
        if (lang && window.hljs && hljs.getLanguage(lang)) {
          try { highlighted = hljs.highlight(code, { language: lang }).value; } catch { highlighted = esc(code); }
        } else if (window.hljs) {
          try { highlighted = hljs.highlightAuto(code).value; } catch { highlighted = esc(code); }
        } else {
          highlighted = esc(code);
        }
        html += `<div class="code-block-wrap"><div class="code-block-header"><span class="code-lang">${esc(langLabel)}</span><button class="copy-btn" id="${copyId}" onclick="(function(btn,c){navigator.clipboard&&navigator.clipboard.writeText(c).then(()=>{btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy',1500)});})(document.getElementById('${copyId}'),${JSON.stringify(code)})">Copy</button></div><pre class="code-block hljs"><code>${highlighted}</code></pre></div>`;
      }
    } else {
      // Process regular markdown in this non-code segment
      let s = part;
      // Tables
      s = s.replace(/(?:(?:^|\n)\|.+\|.*(?:\n|$))+/g, tableStr => {
        const rows = tableStr.trim().split('\n').filter(r => r.trim());
        if (rows.length < 2) return tableStr;
        const headerCells = rows[0].split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => `<th>${inlineMd(c.trim())}</th>`).join('');
        let bodyHtml = '';
        for (let i = 2; i < rows.length; i++) {
          const cells = rows[i].split('|').filter((_, j, a) => j > 0 && j < a.length - 1).map(c => `<td>${inlineMd(c.trim())}</td>`).join('');
          bodyHtml += `<tr>${cells}</tr>`;
        }
        return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headerCells}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
      });
      // Headings
      s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      // Blockquotes
      s = s.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
      // Horizontal rule
      s = s.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr>');
      // Unordered lists
      s = s.replace(/((?:^[-*+] .+(?:\n|$))+)/gm, listStr => {
        const items = listStr.trim().split('\n').map(l => `<li>${inlineMd(l.replace(/^[-*+] /, '').trim())}</li>`).join('');
        return `<ul>${items}</ul>`;
      });
      // Ordered lists
      s = s.replace(/((?:^\d+\. .+(?:\n|$))+)/gm, listStr => {
        const items = listStr.trim().split('\n').map(l => `<li>${inlineMd(l.replace(/^\d+\. /, '').trim())}</li>`).join('');
        return `<ol>${items}</ol>`;
      });
      // Paragraphs (blank-line separated non-block content)
      s = s.replace(/^(?!<[huo]|<block|<hr|<div|<pre)(.+)$/gm, line => {
        if (!line.trim()) return '';
        return `<p>${inlineMd(line)}</p>`;
      });
      // Collapse multiple blank lines
      s = s.replace(/\n{2,}/g, '\n');
      html += s;
    }
  });
  return html;
}

function inlineMd(text) {
  let s = esc(text);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/`([^`]+)`/g, '<span class="inline-code">$1</span>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

window.logout = logout;

/* 
   INTERACTIVE BACKGROUND "" Physics-based MAC/MBM particles
   Text particles scatter on hover/touch, spring back to origin
    */
const BG = {
  canvas: null, ctx: null, particles: [], mouse: { x: -9999, y: -9999, active: false },
  raf: null, dpr: 1, W: 0, H: 0,
  REPEL_RADIUS: 120,
  REPEL_FORCE: 8,
  SPRING: 0.04,
  DAMPING: 0.88,
  WORDS: ['MAC', 'MBM', 'MAC', 'MBM', 'AI', 'MAC', 'MBM'],
  FONT_SIZES: [11, 13, 15],
  OPACITY_RANGE: [0.03, 0.07],
};

function initBgCanvas() {
  // Create persistent canvas (lives outside #app so it survives re-renders)
  let canvas = document.getElementById('bg-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'bg-canvas';
    document.body.insertBefore(canvas, document.body.firstChild);
  }
  BG.canvas = canvas;
  BG.ctx = canvas.getContext('2d');
  BG.dpr = Math.min(window.devicePixelRatio || 1, 2);
  resizeBg();
  spawnParticles();
  bindBgEvents();
  if (!BG.raf) animateBg();
}

function resizeBg() {
  BG.W = window.innerWidth;
  BG.H = window.innerHeight;
  BG.canvas.width = BG.W * BG.dpr;
  BG.canvas.height = BG.H * BG.dpr;
  BG.canvas.style.width = BG.W + 'px';
  BG.canvas.style.height = BG.H + 'px';
  BG.ctx.setTransform(BG.dpr, 0, 0, BG.dpr, 0, 0);
}

function spawnParticles() {
  BG.particles = [];
  const spacing = 80;
  const cols = Math.ceil(BG.W / spacing) + 1;
  const rows = Math.ceil(BG.H / spacing) + 1;
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = c * spacing + (r % 2 === 0 ? 0 : spacing * 0.5) + (Math.random() - 0.5) * 20;
      const oy = r * spacing + (Math.random() - 0.5) * 16;
      const word = BG.WORDS[idx % BG.WORDS.length];
      const fontSize = BG.FONT_SIZES[idx % BG.FONT_SIZES.length];
      const opMin = BG.OPACITY_RANGE[0], opMax = BG.OPACITY_RANGE[1];
      const baseOpacity = opMin + Math.random() * (opMax - opMin);
      BG.particles.push({
        ox, oy,           // origin
        x: ox, y: oy,     // current
        vx: 0, vy: 0,     // velocity
        word,
        fontSize,
        baseOpacity,
        opacity: baseOpacity,
        rotation: (Math.random() - 0.5) * 0.3,
        rotOrigin: 0,
        rot: 0,
      });
      BG.particles[BG.particles.length - 1].rotOrigin = BG.particles[BG.particles.length - 1].rotation;
      idx++;
    }
  }
}

function bindBgEvents() {
  const onMove = (x, y) => { BG.mouse.x = x; BG.mouse.y = y; BG.mouse.active = true; };

  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', e => {
    if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('touchstart', e => {
    if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('mouseleave', () => { BG.mouse.active = false; BG.mouse.x = -9999; BG.mouse.y = -9999; });
  window.addEventListener('touchend', () => { BG.mouse.active = false; BG.mouse.x = -9999; BG.mouse.y = -9999; }, { passive: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeBg(); spawnParticles(); }, 200);
  });
}

function animateBg() {
  const { ctx, particles, mouse, W, H } = BG;
  ctx.clearRect(0, 0, W, H);

  const rr = BG.REPEL_RADIUS;
  const rr2 = rr * rr;
  const force = BG.REPEL_FORCE;
  const spring = BG.SPRING;
  const damp = BG.DAMPING;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // Repulsion from mouse
    const dx = p.x - mouse.x;
    const dy = p.y - mouse.y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 < rr2 && dist2 > 0.1) {
      const dist = Math.sqrt(dist2);
      const f = (1 - dist / rr) * force;
      p.vx += (dx / dist) * f;
      p.vy += (dy / dist) * f;
      // Spin on repel
      p.rot += (dx > 0 ? 0.1 : -0.1) * f * 0.05;
      // Boost opacity when disturbed
      p.opacity = Math.min(0.18, p.baseOpacity + (1 - dist / rr) * 0.12);
    } else {
      // Fade back to base
      p.opacity += (p.baseOpacity - p.opacity) * 0.05;
    }

    // Spring back to origin
    p.vx += (p.ox - p.x) * spring;
    p.vy += (p.oy - p.y) * spring;

    // Damping
    p.vx *= damp;
    p.vy *= damp;

    // Rotation spring
    p.rot += (p.rotOrigin - p.rot) * 0.03;

    // Integrate
    p.x += p.vx;
    p.y += p.vy;

    // Draw
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.font = `900 ${p.fontSize}px 'Courier New', monospace`;
    ctx.fillStyle = `rgba(0,0,0,${p.opacity.toFixed(3)})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.word, 0, 0);
    ctx.restore();
  }

  BG.raf = requestAnimationFrame(animateBg);
}

// Initialize background on load
document.addEventListener('DOMContentLoaded', initBgCanvas);
// Also re-init if canvas gets removed (SPA navigation nukes #app, not body)
const _origRender = render;
window._bgCheck = () => {
  if (!document.getElementById('bg-canvas')) initBgCanvas();
};

init();
