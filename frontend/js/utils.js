function makeDonut(id, used, total, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  // Fit canvas to its CSS container size to prevent overflow/overlap on mobile
  const wrap = canvas.parentElement;
  if (wrap) {
    const size = Math.min(wrap.offsetWidth || 160, wrap.offsetHeight || 160);
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
  }
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
  return m.replace(/^(Qwen\/|deepseek-ai\/|openai\/|sarvamai\/|maya-research\/|mistralai\/|meta-llama\/)/, '')
          .replace(/-(Instruct|AWQ|GPTQ|Chat|v\d+\.\d+)$/i, '').slice(0, 26);
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

/* ═══════════════════════════════════════════════════════════
   WORKER JOIN PAGE — Standalone page for contributing GPU resources
   Accessible at /#join or /join — no auth required
   ═══════════════════════════════════════════════════════════ */

function workerJoinPage() {
  /* Uses the exact same design system as the login page:
     auth-page + auth-card + glitch title + floating labels + sign-btn + physics watermark */
  var themeBtn = '<button class="auth-theme-toggle" id="auth-theme-btn" onclick="toggleAuthTheme()" title="Toggle theme">' + authThemeIcon() + '</button>';
  var wmLayer  = '<div class="wm-layer" id="wm-layer" aria-hidden="true"></div>';
  var orbs     = '<div class="auth-orb auth-orb-1"></div><div class="auth-orb auth-orb-2"></div>';

  var _SVG_SERVER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>';
  var _SVG_KEY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';
  var _SVG_TAG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
  var _SVG_LINK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';

  return themeBtn + wmLayer + orbs +
  '<div class="auth-page"><div class="auth-card" id="auth-card" style="max-width:440px">' +
    '<div class="card-header">' +
      '<h1 class="glitch mac-title" data-text="MAC">MAC</h1>' +
      '<p class="card-sub">Join GPU Cluster · MBM AI Cloud</p>' +
    '</div>' +
    '<p class="view-hint">Contribute your GPU, CPU \u0026 RAM to the distributed compute cluster.</p>' +
    '<div class="auth-err" id="join-error-box" style="display:none">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<span id="join-error-msg"></span>' +
    '</div>' +
    '<div id="join-form" class="fl-form">' +
      '<div class="fl-wrap" id="fl-join-ip"><label class="fl-label" for="join-ip">Admin Server IP</label>' +
        '<div class="fl-inner"><span class="fl-icon">' + _SVG_SERVER + '</span>' +
          '<input id="join-ip" type="text" class="fl-input" placeholder=" " autocomplete="off">' +
        '</div>' +
      '</div>' +
      '<div class="fl-wrap" id="fl-join-token"><label class="fl-label" for="join-token">Enrollment Token</label>' +
        '<div class="fl-inner"><span class="fl-icon">' + _SVG_KEY + '</span>' +
          '<input id="join-token" type="text" class="fl-input" placeholder=" " autocomplete="off" style="font-family:\'Courier New\',monospace">' +
        '</div>' +
      '</div>' +
      '<div class="fl-wrap" id="fl-join-name"><label class="fl-label" for="join-name">Worker Name (optional)</label>' +
        '<div class="fl-inner"><span class="fl-icon">' + _SVG_TAG + '</span>' +
          '<input id="join-name" type="text" class="fl-input" placeholder=" " autocomplete="off">' +
        '</div>' +
      '</div>' +
      '<button type="button" class="sign-btn" id="join-submit">' + _SVG_LINK + '<span>Join Cluster</span></button>' +
    '</div>' +
    '<div id="join-status" style="display:none;text-align:center;padding:24px 0">' +
      '<div id="join-status-icon" style="margin-bottom:16px"></div>' +
      '<div id="join-status-text" style="font-size:1rem;font-weight:600"></div>' +
      '<div id="join-status-sub" style="font-size:.82rem;color:var(--muted);margin-top:8px"></div>' +
      '<button id="join-retry" class="alt-btn" style="display:none;margin-top:16px">Try Again</button>' +
    '</div>' +
    '<div class="auth-divider"><span>or</span></div>' +
    '<a href="/#login" class="alt-btn" onclick="navigate(\'login\');return false">' + _SVG_BACK + '<span>Back to Login</span></a>' +
    '<div class="card-footer">' +
      '<span class="auth-version">MAC v0.0</span>' +
      '<span style="font-size:11px;color:var(--muted)">GPU Cluster</span>' +
    '</div>' +
  '</div></div>';
}

function bindWorkerJoin() {
  const btn = document.getElementById('join-submit');
  if (!btn) return;

  /* Init physics watermark + floating labels — same as login page */
  _wmInit();
  _bindFl('fl-join-ip', 'join-ip');
  _bindFl('fl-join-token', 'join-token');
  _bindFl('fl-join-name', 'join-name');

  /* Retry button */
  var retryBtnEl = document.getElementById('join-retry');
  if (retryBtnEl) retryBtnEl.onclick = function() {
    document.getElementById('join-form').style.display = '';
    document.getElementById('join-status').style.display = 'none';
    var errBox = document.getElementById('join-error-box');
    if (errBox) errBox.style.display = 'none';
  };

  btn.onclick = async () => {
    const ip = document.getElementById('join-ip').value.trim();
    const token = document.getElementById('join-token').value.trim();
    const name = document.getElementById('join-name').value.trim() || location.hostname || 'Worker';
    const errBox = document.getElementById('join-error-box');
    const errMsg = document.getElementById('join-error-msg');

    function showJoinErr(msg) {
      if (errMsg) errMsg.textContent = msg;
      if (errBox) errBox.style.display = 'flex';
      _shakeCard();
    }

    if (!ip) { showJoinErr('Please enter the admin server IP'); return; }
    if (!token) { showJoinErr('Please enter the enrollment token'); return; }
    if (errBox) errBox.style.display = 'none';

    // Show status
    document.getElementById('join-form').style.display = 'none';
    const statusEl = document.getElementById('join-status');
    statusEl.style.display = '';

    const iconEl = document.getElementById('join-status-icon');
    const textEl = document.getElementById('join-status-text');
    const subEl = document.getElementById('join-status-sub');
    const retryBtn = document.getElementById('join-retry');

    // Spinner animation (uses theme vars)
    iconEl.innerHTML = '<div class="spinner" style="width:48px;height:48px;border-width:3px;margin:0 auto"></div>';
    textEl.textContent = 'Connecting to admin server...';
    subEl.textContent = `Reaching http://${ip}`;

    const baseUrl = ip.includes('://') ? ip : `http://${ip}`;
    const apiBase = `${baseUrl}/api/v1`;

    try {
      // Step 1: Register with the cluster
      textEl.textContent = 'Registering with cluster...';
      subEl.textContent = 'Sending hardware info and enrollment token';

      const payload = {
        enrollment_token: token,
        name: name,
        hostname: location.hostname || 'browser-worker',
        ip_address: location.hostname || '0.0.0.0',
        port: 8001,
        gpu_name: 'Browser-detected (manual setup needed)',
        tags: 'llm',
      };

      const resp = await fetch(`${apiBase}/cluster/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: { message: resp.statusText } }));
        throw new Error(err.detail?.message || err.message || `Server returned ${resp.status}`);
      }

      const data = await resp.json();

      if (data.status === 'pending') {
        iconEl.innerHTML = '<div style="font-size:3rem">⏳</div>';
        textEl.textContent = 'Registration received!';
        subEl.textContent = 'Waiting for admin approval... (this page will update automatically)';

        // Poll for approval
        let attempts = 0;
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            // Try to heartbeat — if approved, this will work
            const hbResp = await fetch(`${apiBase}/cluster/heartbeat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                node_id: data.node_id,
                node_token: await _sha256(token),
                gpu_util_pct: 0,
                cpu_util_pct: 0,
                active_models: [],
              }),
            });

            if (hbResp.ok) {
              clearInterval(pollInterval);
              iconEl.innerHTML = '<div style="font-size:3rem">✅</div>';
              textEl.textContent = 'Connected to cluster!';
              textEl.style.color = '#4ade80';
              subEl.textContent = `Node ID: ${data.node_id}. Now set up the worker agent on this PC to start contributing GPU resources.`;
              retryBtn.style.display = '';
              retryBtn.textContent = 'Done';
              retryBtn.onclick = () => location.href = '/';
            } else if (hbResp.status === 403) {
              subEl.textContent = `Still waiting for admin approval... (${attempts * 5}s)`;
            }
          } catch {
            subEl.textContent = `Polling... (${attempts * 5}s)`;
          }
          if (attempts > 120) { // 10 min timeout
            clearInterval(pollInterval);
            subEl.textContent = 'Timeout. Ask admin to approve your node in the Cluster panel.';
            retryBtn.style.display = '';
          }
        }, 5000);

      } else {
        iconEl.innerHTML = '<div style="font-size:3rem">✅</div>';
        textEl.textContent = 'Connected!';
        textEl.style.color = '#4ade80';
        subEl.textContent = `Node ID: ${data.node_id}. Status: ${data.status}`;
      }

    } catch (err) {
      iconEl.innerHTML = '<div style="font-size:3rem">❌</div>';
      textEl.textContent = 'Connection Failed';
      textEl.style.color = '#f87171';
      subEl.textContent = err.message || 'Could not reach the admin server. Check the IP address.';
      retryBtn.style.display = '';
    }
  };
}

// Helper: SHA-256 hash in browser
async function _sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Add spin animation for join page
if (!document.getElementById('join-spin-style')) {
  const s = document.createElement('style');
  s.id = 'join-spin-style';
  s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
}

init();
