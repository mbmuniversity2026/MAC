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
  const cur = state.page;
  if (cur && GATE_MAP[cur] && !flagOn(GATE_MAP[cur])) navigate('dashboard');
  // Enforce dark_mode flag: hide dark theme option and revert if active
  const darkDot = document.querySelector('.theme-dot[data-theme="dark"]');
  if (darkDot) darkDot.style.display = flagOn('dark_mode') ? '' : 'none';
  if (!flagOn('dark_mode') && document.documentElement.getAttribute('data-theme') === 'dark') {
    applyTheme('warm');
  }
}

// —— PWA install prompt capture ————————————————————————————
window.addEventListener('beforeinstallprompt', e => {
  deferredInstallPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = '';
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'none';
});

// —— Cert install banner for LAN devices on HTTP ——————————
(function _certBannerCheck() {
  const isHTTPS = location.protocol === 'https:';
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isHTTPS && !isLocalhost && !sessionStorage.getItem('mac_cert_dismissed')) {
    window.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.id = 'cert-banner';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#D4834A;color:#fff;padding:10px 16px;font-size:13px;display:flex;align-items:center;justify-content:space-between;font-family:Inter,sans-serif;';
      bar.innerHTML = '<span>Install the MAC certificate to enable app install &amp; HTTPS. <a href="/install-cert" style="color:#fff;font-weight:700;text-decoration:underline">Install Certificate</a></span><button onclick="this.parentElement.remove();sessionStorage.setItem(\'mac_cert_dismissed\',\'1\')" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 4px">&times;</button>';
      document.body.prepend(bar);
    });
  }
})();

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
  if (theme === 'dark' && !flagOn('dark_mode')) theme = 'warm';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mac_theme', theme);
  if (window.monaco) {
    const isDark = theme === 'dark';
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
  }
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
  // Dispose Monaco editors when leaving notebooks page
  if (state.page === 'notebooks' && page !== 'notebooks') {
    _nbDisposeEditors();
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', {scope: '/'})
      .then(reg => console.log('[MAC] SW registered, scope:', reg.scope))
      .catch(err => console.warn('[MAC] SW registration failed:', err));
  }
  // Show intro splash every fresh session regardless of login state
  runIntroIfNeeded();
  // Worker join page — no auth required
  if (location.hash === '#join' || location.pathname === '/join') {
    state.page = 'join';
    render();
    return;
  }
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
let _renderRaf = null;
function scheduleRender() {
  if (_renderRaf) return;
  _renderRaf = requestAnimationFrame(() => { _renderRaf = null; render(); });
}
function render() {
  // Clear dashboard auto-refresh when navigating away
  if (_dashRefreshIv) { clearInterval(_dashRefreshIv); _dashRefreshIv = null; }
  if (window._clusterRefreshIv) { clearInterval(window._clusterRefreshIv); window._clusterRefreshIv = null; }
  const app = document.getElementById('app');
  // Worker join page — no auth required
  if (state.page === 'join') { app.innerHTML = workerJoinPage(); bindWorkerJoin(); return; }
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
  if (typeof _nbState !== 'undefined') { _nbState.notebooks = []; _nbState.current = null; _nbState.cells = []; _nbState.outputs = {}; }
  navigate('login');
}

function showAbout() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
  el.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:24px;padding:0;max-width:460px;width:92%;position:relative;box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden;">
      <button onclick="this.closest('[style*=fixed]').remove()" style="position:absolute;top:14px;right:14px;background:rgba(0,0,0,.08);border:none;font-size:1.1rem;cursor:pointer;color:var(--fg);line-height:1;padding:5px 9px;border-radius:50%;transition:background .15s;z-index:2" onmouseover="this.style.background='rgba(0,0,0,.18)'" onmouseout="this.style.background='rgba(0,0,0,.08)'">&times;</button>

      <!-- Hero: macintosh-style greeting -->
      <div style="background:linear-gradient(135deg,var(--accent-light) 0%,var(--bg-secondary) 100%);padding:36px 32px 24px;text-align:center;border-bottom:1px solid var(--border);">
        <div style="font-family:'Brush Script MT','Segoe Script','Comic Sans MS',cursive;font-size:clamp(3rem,10vw,5rem);color:var(--accent);line-height:1;margin-bottom:8px;text-shadow:0 2px 16px rgba(0,0,0,.10);">hello.</div>
        <div style="font-family:'Brush Script MT','Segoe Script','Comic Sans MS',cursive;font-size:clamp(1rem,4vw,1.4rem);color:var(--fg-secondary);margin-bottom:16px;font-style:italic;">from MAC &mdash; MBM AI Cloud</div>
        <div style="display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;padding:6px 18px;border-radius:999px;font-size:.78rem;font-weight:700;letter-spacing:.06em;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          MAC v0.0 &nbsp;&middot;&nbsp; MBM University
        </div>
      </div>

      <!-- Body -->
      <div style="padding:24px 28px 28px;text-align:center;">
        <p style="font-size:.88rem;color:var(--fg-secondary);line-height:1.9;margin-bottom:18px;">
          A self-hosted AI inference platform built<br>
          <strong style="color:var(--fg)">for MBM University, Jodhpur</strong> &mdash; by MBM, for MBM.<br>
          Runs <em>fully offline</em> on the college LAN.<br>
          Powered by open-source models via vLLM &amp; Ollama.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:18px;">
          <span style="background:var(--accent-light);color:var(--accent);padding:4px 12px;border-radius:999px;font-size:.72rem;font-weight:600;">FastAPI + Vanilla JS</span>
          <span style="background:var(--accent-light);color:var(--accent);padding:4px 12px;border-radius:999px;font-size:.72rem;font-weight:600;">PostgreSQL + Redis</span>
          <span style="background:var(--accent-light);color:var(--accent);padding:4px 12px;border-radius:999px;font-size:.72rem;font-weight:600;">vLLM Inference</span>
          <span style="background:var(--accent-light);color:var(--accent);padding:4px 12px;border-radius:999px;font-size:.72rem;font-weight:600;">Offline PWA</span>
        </div>
        <div style="font-size:.72rem;color:var(--muted);line-height:1.8;border-top:1px solid var(--border);padding-top:14px;">
          &copy; 2026 MBM University, Jodhpur &mdash; MBM AI Cloud<br>
          Licensed under the <strong style="color:var(--accent)">MBM Open License</strong> &mdash; free within MBM campus network.<br>
          <span style="opacity:.65">This is <em>not</em> an Apple Inc. product.</span>
        </div>
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
   INTRO ANIMATION "" MBM &rarr; MAC morph — runs every fresh session
    */
function runIntroIfNeeded() {
  // Use sessionStorage so animation shows every time app starts fresh (new session)
  if (sessionStorage.getItem('mac_intro_shown')) return;
  sessionStorage.setItem('mac_intro_shown', '1');

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

