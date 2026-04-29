/* ═══════════════════════════════════════════════════════════
   MAC — Auth module
   Physics watermark · Floating labels · Card shake
   Loaded BEFORE app.js. Functions reference globals from
   app.js (state, navigate, API, etc.) which are resolved at
   call time (after all scripts load).
   ═══════════════════════════════════════════════════════════ */

/* ── Physics watermark word config ──────────────────────── */
var WM_WORDS = [
  { text: 'MAC',       x:  7, y:  8, size: 42, rot: -8  },
  { text: 'MBM',       x: 82, y: 12, size: 20, rot:  5  },
  { text: 'AI',        x: 55, y:  5, size: 32, rot:  3  },
  { text: 'CLOUD',     x: 15, y: 50, size: 18, rot: -4  },
  { text: 'MODELS',    x: 72, y: 42, size: 16, rot:  7  },
  { text: 'CHAT',      x: 42, y: 85, size: 24, rot: -6  },
  { text: 'LEARN',     x: 65, y: 72, size: 14, rot:  9  },
  { text: 'JODHPUR',   x:  5, y: 75, size: 12, rot: -3  },
  { text: 'INFERENCE', x: 30, y: 20, size: 12, rot:  5  },
  { text: 'NOTEBOOK',  x: 80, y: 28, size: 13, rot: -9  },
  { text: 'RESEARCH',  x: 20, y: 40, size: 11, rot:  4  },
  { text: 'CODE',      x: 88, y: 62, size: 20, rot: -5  },
  { text: 'DATA',      x: 48, y: 60, size: 18, rot:  8  },
  { text: 'NEURAL',    x:  3, y: 28, size: 13, rot: -7  },
  { text: 'GPU',       x: 58, y: 30, size: 22, rot:  6  },
  { text: 'MBM',       x: 25, y: 90, size: 14, rot: -2  },
  { text: 'PYTHON',    x: 75, y: 88, size: 11, rot: 10  },
  { text: 'VECTOR',    x: 40, y:  2, size: 11, rot: -5  },
  { text: 'RAG',       x:  8, y: 92, size: 16, rot:  3  },
  { text: 'QUERY',     x: 92, y: 78, size: 12, rot: -8  },
];

/* Physics constants */
var WM_REPEL_R  = 320;
var WM_MAX_PUSH = 260;
var WM_PROX_R   = 260;
var WM_SPRING   = 0.055;
var WM_DAMP     = 0.80;

var _wmObjs  = [];
var _wmMouse = { x: -9999, y: -9999 };
var _wmRaf   = null;

/* ── Init physics watermark ─────────────────────────────── */
function _wmBaseOpacity() {
  /* Detect if current theme is dark */
  var t = document.documentElement.getAttribute('data-theme') || 'warm';
  return (t === 'dark' || t === 'nordic') ? 0.18 : 0.08;
}

function _wmInit() {
  var layer = document.getElementById('wm-layer');
  if (!layer) return;

  var baseOp = _wmBaseOpacity();

  // Render word spans (positioned via % CSS, physics adds translate)
  layer.innerHTML = WM_WORDS.map(function(w, i) {
    return '<span class="wm-word" data-wi="' + i + '" style="' +
      'left:' + w.x + '%;' +
      'top:' + w.y + '%;' +
      'font-size:' + w.size + 'px;' +
      'transform:rotate(' + w.rot + 'deg);' +
      'opacity:' + baseOp + '">' + w.text + '</span>';
  }).join('');

  // Wait one frame so the browser lays out positions
  requestAnimationFrame(function() {
    _wmObjs = [];
    var spans = layer.querySelectorAll('.wm-word');
    for (var i = 0; i < spans.length; i++) {
      var el = spans[i];
      var r  = el.getBoundingClientRect();
      var cx = r.left + r.width  / 2;
      var cy = r.top  + r.height / 2;
      _wmObjs.push({
        el:    el,
        rot:   WM_WORDS[i].rot,
        origX: cx, origY: cy,
        currX: cx, currY: cy,
        vx: 0, vy: 0,
        opacity: baseOp,
      });
    }
    _wmLoop();
  });

  function _onMouseMove(e)  { _wmMouse.x = e.clientX;         _wmMouse.y = e.clientY; }
  function _onMouseLeave()  { _wmMouse.x = -9999;              _wmMouse.y = -9999; }
  function _onTouchStart(e) { if (e.touches.length) { _wmMouse.x = e.touches[0].clientX; _wmMouse.y = e.touches[0].clientY; } }
  function _onTouchMove(e)  { if (e.touches.length) { _wmMouse.x = e.touches[0].clientX; _wmMouse.y = e.touches[0].clientY; } }
  function _onTouchEnd()    { _wmMouse.x = -9999;              _wmMouse.y = -9999; }

  window.addEventListener('mousemove',  _onMouseMove);
  window.addEventListener('mouseleave', _onMouseLeave);
  window.addEventListener('touchstart', _onTouchStart, { passive: true });
  window.addEventListener('touchmove',  _onTouchMove,  { passive: true });
  window.addEventListener('touchend',   _onTouchEnd);

  /* Store cleanup so navigate() can stop the loop */
  window._wmCleanupFn = function() {
    if (_wmRaf) { cancelAnimationFrame(_wmRaf); _wmRaf = null; }
    window.removeEventListener('mousemove',  _onMouseMove);
    window.removeEventListener('mouseleave', _onMouseLeave);
    window.removeEventListener('touchstart', _onTouchStart);
    window.removeEventListener('touchmove',  _onTouchMove);
    window.removeEventListener('touchend',   _onTouchEnd);
    window._wmCleanupFn = null;
  };
}

function _wmLoop() {
  /* Auto-stop when login page is unmounted */
  var layer = document.getElementById('wm-layer');
  if (!layer) { _wmRaf = null; return; }

  var baseOp = _wmBaseOpacity();
  var maxOp  = baseOp < 0.12 ? 0.55 : 0.75; /* dark mode gets brighter peaks */

  for (var i = 0; i < _wmObjs.length; i++) {
    var w  = _wmObjs[i];
    var dx = w.currX - _wmMouse.x;
    var dy = w.currY - _wmMouse.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;

    /* Opacity: brighten near cursor/finger */
    var isNear = dist < WM_PROX_R;
    var tOpacity = isNear
      ? baseOp + (1 - dist / WM_PROX_R) * (maxOp - baseOp)
      : baseOp;
    w.opacity += (tOpacity - w.opacity) * 0.10;
    if (w.el) {
      w.el.style.opacity = w.opacity.toFixed(3);
      /* data-near for CSS glow in dark mode */
      if (isNear && dist < WM_PROX_R * 0.6) {
        w.el.setAttribute('data-near', '1');
      } else {
        w.el.removeAttribute('data-near');
      }
    }

    /* Repulsion */
    if (dist < WM_REPEL_R) {
      var force = ((WM_REPEL_R - dist) / WM_REPEL_R) * WM_MAX_PUSH;
      w.vx += (dx / dist) * force * 0.12;
      w.vy += (dy / dist) * force * 0.12;
    }

    /* Spring back to origin */
    w.vx += (w.origX - w.currX) * WM_SPRING;
    w.vy += (w.origY - w.currY) * WM_SPRING;

    /* Damping */
    w.vx *= WM_DAMP;
    w.vy *= WM_DAMP;

    w.currX += w.vx;
    w.currY += w.vy;

    /* Apply as translate offset from CSS origin */
    var tx = w.currX - w.origX;
    var ty = w.currY - w.origY;
    if (w.el) w.el.style.transform = 'rotate(' + w.rot + 'deg) translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px)';
  }
  _wmRaf = requestAnimationFrame(_wmLoop);
}

/* ── Floating label binding ─────────────────────────────── */
function _bindFl(wrapId, inputId) {
  var wrap = document.getElementById(wrapId);
  var inp  = document.getElementById(inputId);
  if (!wrap || !inp) return;
  function sync() {
    wrap.classList.toggle('filled', inp.value.length > 0);
  }
  inp.addEventListener('focus', function() { wrap.classList.add('focused'); sync(); });
  inp.addEventListener('blur',  function() { wrap.classList.remove('focused'); sync(); });
  inp.addEventListener('input', sync);
  /* Catch browser autofill after a frame */
  requestAnimationFrame(sync);
  setTimeout(sync, 300);
}

/* ── Card shake on error ────────────────────────────────── */
function _shakeCard() {
  var card = document.getElementById('auth-card');
  if (!card) return;
  card.classList.remove('shake');
  void card.offsetWidth; /* force reflow */
  card.classList.add('shake');
}

/* ── Password strength ──────────────────────────────────── */
function _pwScore(pw) {
  var s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s; /* 0–5 */
}

function _pwStrengthUpdate(inputId, barId, labelId) {
  var inp   = document.getElementById(inputId);
  var bar   = document.getElementById(barId);
  var label = document.getElementById(labelId);
  if (!inp || !bar || !label) return;
  var score = _pwScore(inp.value);
  var pct   = Math.round((score / 5) * 100);
  var colors = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#16a34a'];
  var labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  var col = colors[Math.max(0, score - 1)] || '#dc2626';
  bar.style.width      = pct + '%';
  bar.style.background = col;
  label.textContent    = inp.value.length ? (labels[score - 1] || '') : '';
  label.style.color    = col;
}

/* ── SVG icons ──────────────────────────────────────────── */
var _SVG_USER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
var _SVG_LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
var _SVG_CAL  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
var _SVG_DOOR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
var _SVG_CHECK= '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var _MAC_MASCOT_SM = '<svg class="mac-mascot" width="28" height="28" viewBox="0 0 32 32" fill="none">' +
  '<g class="mascot-body">' +
  '<ellipse cx="16" cy="16" rx="10" ry="11" fill="var(--accent)"/>' +
  '<ellipse cx="16" cy="17" rx="8" ry="7" fill="var(--accent)" opacity=".9"/>' +
  '<circle cx="12.5" cy="14" r="3" fill="#fff" class="mascot-eye mascot-eye-l"/>' +
  '<circle cx="19.5" cy="14" r="3" fill="#fff" class="mascot-eye mascot-eye-r"/>' +
  '<circle cx="12.5" cy="14.3" r="1.5" fill="#1a1a1a" class="mascot-pupil"/>' +
  '<circle cx="19.5" cy="14.3" r="1.5" fill="#1a1a1a" class="mascot-pupil mascot-pupil-wink"/>' +
  '<ellipse cx="16" cy="19" rx="2.5" ry="1.3" fill="#fff" opacity=".9"/>' +
  '<ellipse cx="10" cy="17" rx="1.5" ry="1" fill="#ff9a76" opacity=".4"/>' +
  '<ellipse cx="22" cy="17" rx="1.5" ry="1" fill="#ff9a76" opacity=".4"/>' +
  '<circle cx="7" cy="10" r="1.5" fill="var(--accent)" opacity=".6"/>' +
  '<circle cx="25" cy="10" r="1.5" fill="var(--accent)" opacity=".6"/>' +
  '<rect x="13" y="25" width="2" height="3" rx="1" fill="var(--accent)"/>' +
  '<rect x="17" y="25" width="2" height="3" rx="1" fill="var(--accent)"/>' +
  '</g></svg>';
var _MAC_MASCOT = _MAC_MASCOT_SM;
var _SVG_GLOBE= '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
var _SVG_CHEV = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
var _SVG_BACK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

/* ── Auth theme helpers ─────────────────────────────────── */
function authThemeIcon() {
  var th = document.documentElement.getAttribute('data-theme') || 'warm';
  if (th === 'dark') {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  }
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
function toggleAuthTheme() {
  var th = document.documentElement.getAttribute('data-theme') || 'warm';
  var darkAllowed = (typeof flagOn === 'function') ? flagOn('dark_mode') : true;
  if (th === 'dark') {
    applyTheme('warm');
  } else if (darkAllowed) {
    applyTheme('dark');
  }
  var btn = document.getElementById('auth-theme-btn');
  if (btn) btn.innerHTML = authThemeIcon();
}

/* ── Language dropdown (dynamic — all 19 locales) ──────── */
function showLangDropdown() {
  var existing = document.getElementById('lang-dropdown');
  if (existing) { existing.remove(); return; }
  var btn  = document.getElementById('lang-picker-btn');
  if (!btn) return;
  var rect = btn.getBoundingClientRect();
  var drop = document.createElement('div');
  drop.id = 'lang-dropdown';
  drop.className = 'locale-dd';
  drop.style.cssText = 'position:fixed;bottom:' + (window.innerHeight - rect.top + 6) + 'px;right:' + Math.max(8, window.innerWidth - rect.right) + 'px;z-index:9999;';
  var locales = window.MAC_I18N.LOCALES;
  var cur     = window.MAC_I18N.getLang();
  drop.innerHTML = locales.map(function(l) {
    var active = (l.code === cur) ? ' active' : '';
    return '<button class="locale-dd-item' + active + '" onclick="window.MAC_I18N.setLang(\'' + l.code + '\');document.getElementById(\'lang-dropdown\')?.remove();render();">' +
      '<span>' + l.native + '</span>' +
      '<span style="font-size:.7rem;color:var(--muted);margin-left:6px">' + l.name + '</span>' +
    '</button>';
  }).join('');
  document.body.appendChild(drop);
  setTimeout(function() {
    document.addEventListener('click', function once(e) {
      if (!drop.contains(e.target) && e.target.id !== 'lang-picker-btn') {
        drop.remove();
        document.removeEventListener('click', once);
      }
    });
  }, 10);
}

/* ── authMode state ─────────────────────────────────────── */
var authMode = 'login';

/* ── Auth page HTML ─────────────────────────────────────── */
function authPage() {
  /* Clean up watermark loop if lingering from previous mount */
  if (typeof window._wmCleanupFn === 'function') window._wmCleanupFn();

  var i18n    = window.MAC_I18N;
  var curLang = i18n.getLang();
  var native  = i18n.getNative(curLang);

  var themeBtn = '<button class="auth-theme-toggle" id="auth-theme-btn" onclick="toggleAuthTheme()" title="Toggle theme">' + authThemeIcon() + '</button>';
  var wmLayer  = '<div class="wm-layer" id="wm-layer" aria-hidden="true"></div>';
  var orbs     = '<div class="auth-orb auth-orb-1"></div><div class="auth-orb auth-orb-2"></div>';
  var footer   = '<div class="card-footer">' +
    '<span class="auth-version">MAC v2.0</span>' +
    '<div class="locale-wrap">' +
      '<button class="locale-btn" id="lang-picker-btn" onclick="showLangDropdown()">' +
        _SVG_GLOBE + '<span>' + native + '</span>' + _SVG_CHEV +
      '</button>' +
    '</div>' +
  '</div>';

  /* ── Verify view ── */
  if (authMode === 'verify') {
    return themeBtn + wmLayer + orbs +
    '<div class="auth-page"><div class="auth-card" id="auth-card">' +
      '<div class="card-header">' +
        '<h1 class="glitch mac-title" data-text="MAC">MAC</h1>' +
        '<p class="card-sub">' + esc(i18n.t('appTagline')) + '</p>' +
      '</div>' +
      '<button class="back-btn" id="auth-back-btn">' + _SVG_BACK + ' Back</button>' +
      '<p class="view-hint">' + esc(i18n.t('verifyDesc')) + '</p>' +
      '<div class="auth-err" id="auth-error" style="display:none">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        '<span id="auth-error-msg"></span>' +
      '</div>' +
      '<form id="auth-form" novalidate class="fl-form">' +
        '<div class="fl-wrap" id="fl-roll"><label class="fl-label" for="auth-roll">' + esc(i18n.t('registrationNo')) + '</label>' +
          '<div class="fl-inner"><span class="fl-icon">' + _SVG_USER + '</span>' +
            '<input id="auth-roll" type="text" class="fl-input" placeholder=" " autocomplete="username">' +
          '</div>' +
        '</div>' +
        '<div class="fl-wrap" id="fl-dob"><label class="fl-label" for="auth-dob">' + esc(i18n.t('dob')) + '</label>' +
          '<div class="fl-inner"><span class="fl-icon">' + _SVG_CAL + '</span>' +
            '<input id="auth-dob" type="text" class="fl-input" placeholder=" " maxlength="8" inputmode="numeric" autocomplete="bday">' +
          '</div>' +
        '</div>' +
        '<button type="submit" class="sign-btn" id="auth-submit">' + _SVG_CHECK + '<span>' + esc(i18n.t('verify')) + '</span></button>' +
      '</form>' +
      footer +
    '</div></div>';
  }

  /* ── Login view ── */
  return themeBtn + wmLayer + orbs +
  '<div class="auth-page"><div class="auth-card" id="auth-card">' +
    '<div class="card-header">' +
      '<h1 class="glitch mac-title" data-text="MAC">MAC</h1>' +
      '<p class="card-sub">' + esc(i18n.t('appTagline')) + '</p>' +
    '</div>' +
    '<div class="auth-err" id="auth-error" style="display:none">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<span id="auth-error-msg"></span>' +
    '</div>' +
    '<form id="auth-form" novalidate class="fl-form">' +
      '<div class="fl-wrap" id="fl-roll"><label class="fl-label" for="auth-roll">' + esc(i18n.t('rollLabel')) + '</label>' +
        '<div class="fl-inner"><span class="fl-icon">' + _SVG_USER + '</span>' +
          '<input id="auth-roll" type="text" class="fl-input" placeholder=" " autocomplete="username">' +
        '</div>' +
      '</div>' +
      '<div class="fl-wrap pw-wrap" id="fl-pw"><label class="fl-label" for="auth-pw">' + esc(i18n.t('password')) + '</label>' +
        '<div class="fl-inner"><span class="fl-icon">' + _SVG_LOCK + '</span>' +
          '<input id="auth-pw" type="password" class="fl-input" placeholder=" " autocomplete="current-password">' +
          '<button type="button" class="fl-eye pw-toggle" data-target="auth-pw" title="Show/hide password">' + EYE_CLOSED + '</button>' +
        '</div>' +
      '</div>' +
      '<button type="submit" class="sign-btn" id="auth-submit">' + _SVG_DOOR + '<span>' + esc(i18n.t('signIn')) + '</span></button>' +
    '</form>' +
    '<div class="auth-divider"><span>' + esc(i18n.t('or')) + '</span></div>' +
    '<button class="alt-btn" id="switch-to-verify">' + _MAC_MASCOT + '<span>' + esc(i18n.t('firstTime')) + '</span></button>' +
    footer +
  '</div></div>';
}

/* ── Bind auth page events ──────────────────────────────── */
function bindAuth() {
  var form = document.getElementById('auth-form');
  if (!form) return;

  /* Start physics watermark */
  _wmInit();

  /* Floating labels */
  _bindFl('fl-roll', 'auth-roll');
  if (authMode === 'login') _bindFl('fl-pw', 'auth-pw');
  if (authMode === 'verify') _bindFl('fl-dob', 'auth-dob');

  /* Eye toggle */
  bindEyeToggles(); /* defined in app.js */

  /* Back button (verify view) */
  var backBtn = document.getElementById('auth-back-btn');
  if (backBtn) backBtn.onclick = function(e) { e.preventDefault(); authMode = 'login'; render(); };

  /* Switch to verify */
  var switchToVerify = document.getElementById('switch-to-verify');
  if (switchToVerify) switchToVerify.onclick = function(e) { e.preventDefault(); authMode = 'verify'; render(); };

  /* ── Form submit ── */
  form.onsubmit = async function(e) {
    e.preventDefault();
    var errBox = document.getElementById('auth-error');
    var errMsg = document.getElementById('auth-error-msg');
    if (errBox) errBox.style.display = 'none';

    var roll      = (document.getElementById('auth-roll') || {}).value?.trim() || '';
    var submitBtn = form.querySelector('[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '.65'; }

    function showErr(msg) {
      if (errMsg) errMsg.textContent = msg;
      if (errBox) errBox.style.display = 'flex';
      _shakeCard();
      if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = ''; }
    }

    var i18n = window.MAC_I18N;

    /* ── Verify flow ── */
    if (authMode === 'verify') {
      var dob = (document.getElementById('auth-dob') || {}).value?.trim() || '';
      if (!roll || !dob) { showErr(i18n.t('bothRequired')); return; }
      if (!/^\d{8}$/.test(dob)) { showErr('DOB must be 8 digits (DDMMYYYY)'); return; }
      try {
        var r = await fetch(API + '/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roll_number: roll, dob: dob }),
        });
        if (!r.ok) { var d = await r.json(); showErr(d.detail?.message || i18n.t('invalidCreds')); return; }
        var data = await r.json();
        state.token = data.access_token; state.user = data.user;
        localStorage.setItem('mac_token', data.access_token);
        _nbLoadFromStorage(); requestNotificationPermission(); startNotifPolling(); subscribeToPush(); connectFeatureFlags();
        apiJson('/system/update-status').then(function(u) { if (u?.update_available) state.updateAvail = { version: u.latest_version, url: u.release_url || '#' }; }).catch(function(){});
        if (data.must_change_password || (data.user && data.user.must_change_password)) navigate('set-password'); else navigate('dashboard');
      } catch (ex) { showErr(i18n.t('connError')); }
      return;
    }

    /* ── Login flow ── */
    var pw = (document.getElementById('auth-pw') || {}).value || '';
    if (!roll || !pw) { showErr(i18n.t('bothRequired')); return; }
    try {
      var r = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roll_number: roll, password: pw }),
      });
      if (!r.ok) { var d = await r.json(); showErr(d.detail?.message || i18n.t('invalidCreds')); return; }
      var data = await r.json();
      state.token = data.access_token; state.user = data.user;
      localStorage.setItem('mac_token', data.access_token);
      _nbLoadFromStorage(); requestNotificationPermission(); startNotifPolling(); subscribeToPush(); connectFeatureFlags();
      apiJson('/system/update-status').then(function(u) { if (u?.update_available) state.updateAvail = { version: u.latest_version, url: u.release_url || '#' }; }).catch(function(){});
      if (data.must_change_password || (data.user && data.user.must_change_password)) navigate('set-password'); else navigate('dashboard');
    } catch (ex) { showErr(i18n.t('connError')); }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = ''; }
  };
}

/* ── Set password page ──────────────────────────────────── */
function setPasswordPage() {
  var u    = state.user || {};
  var i18n = window.MAC_I18N;
  var themeBtn = '<button class="auth-theme-toggle" id="auth-theme-btn" onclick="toggleAuthTheme()" title="Toggle theme">' + authThemeIcon() + '</button>';
  var wmLayer  = '<div class="wm-layer" id="wm-layer" aria-hidden="true"></div>';
  var orbs     = '<div class="auth-orb auth-orb-1"></div><div class="auth-orb auth-orb-2"></div>';
  return themeBtn + wmLayer + orbs +
  '<div class="auth-page"><div class="auth-card" id="auth-card">' +
    '<div class="card-header">' +
      '<h1 class="glitch mac-title" data-text="MAC">MAC</h1>' +
    '</div>' +
    '<p class="view-hint">' + i18n.t('welcomeBack') + ', <strong>' + esc(u.name || u.roll_number || '') + '</strong>!<br>' + i18n.t('setPasswordDesc') + '</p>' +
    '<div class="auth-err" id="sp-error" style="display:none">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<span id="sp-error-msg"></span>' +
    '</div>' +
    '<form id="sp-form" novalidate class="fl-form">' +
      '<div class="fl-wrap pw-wrap" id="fl-spnew"><label class="fl-label" for="sp-new">' + i18n.t('newPassword') + '</label>' +
        '<div class="fl-inner"><span class="fl-icon">' + _SVG_LOCK + '</span>' +
          '<input id="sp-new" type="password" class="fl-input" placeholder=" " autocomplete="new-password">' +
          '<button type="button" class="fl-eye pw-toggle" data-target="sp-new">' + EYE_CLOSED + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="pw-strength"><div class="pw-bar"><div class="pw-fill" id="sp-pw-fill" style="width:0%"></div></div><span class="pw-label" id="sp-pw-label"></span></div>' +
      '<div class="fl-wrap pw-wrap" id="fl-spconf"><label class="fl-label" for="sp-confirm">' + i18n.t('confirmPw') + '</label>' +
        '<div class="fl-inner"><span class="fl-icon">' + _SVG_LOCK + '</span>' +
          '<input id="sp-confirm" type="password" class="fl-input" placeholder=" " autocomplete="new-password">' +
          '<button type="button" class="fl-eye pw-toggle" data-target="sp-confirm">' + EYE_CLOSED + '</button>' +
        '</div>' +
      '</div>' +
      '<button type="submit" class="sign-btn">' + _SVG_CHECK + '<span>' + i18n.t('setPwBtn') + '</span></button>' +
    '</form>' +
  '</div></div>';
}

function bindSetPassword() {
  _wmInit();
  _bindFl('fl-spnew',  'sp-new');
  _bindFl('fl-spconf', 'sp-confirm');
  bindEyeToggles();

  var newPw = document.getElementById('sp-new');
  if (newPw) {
    newPw.addEventListener('input', function() {
      _pwStrengthUpdate('sp-new', 'sp-pw-fill', 'sp-pw-label');
    });
  }

  var form = document.getElementById('sp-form');
  if (!form) return;
  form.onsubmit = async function(e) {
    e.preventDefault();
    var errBox = document.getElementById('sp-error');
    var errMsg = document.getElementById('sp-error-msg');
    if (errBox) errBox.style.display = 'none';
    var pw   = (document.getElementById('sp-new')     || {}).value || '';
    var conf = (document.getElementById('sp-confirm') || {}).value || '';
    function showErr(msg) {
      if (errMsg) errMsg.textContent = msg;
      if (errBox) errBox.style.display = 'flex';
      _shakeCard();
    }
    if (pw.length < 8) { showErr('Password must be at least 8 characters'); return; }
    if (pw !== conf)   { showErr('Passwords do not match'); return; }
    var btn = form.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; btn.style.opacity = '.65'; }
    try {
      var r = await api('/auth/set-password', { method: 'POST', body: JSON.stringify({ password: pw }) });
      if (!r.ok) { var d = await r.json(); showErr(d.detail?.message || 'Failed to set password'); if (btn) { btn.disabled = false; btn.style.opacity = ''; } return; }
      if (state.user) state.user.must_change_password = false;
      navigate('dashboard');
    } catch (ex) { showErr('Connection error'); if (btn) { btn.disabled = false; btn.style.opacity = ''; } }
  };
}
