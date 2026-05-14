// ── Dashboard — stale-while-revalidate, no blocking spinners ─────────────────
// Shows cached data instantly on revisit, refreshes silently in background.
// Role sections load async and patch their container in-place.

let _dashCache   = null;   // last successful fetch result
let _dashPage    = false;  // true while dashboard is the active page
let _dashTimer   = null;   // background refresh interval

async function renderDashboard() {
  const el = document.getElementById('page-content');
  if (!el) return;
  _dashPage = true;

  if (_dashCache) {
    // Instant render from cache — no spinner
    _buildDashDOM(el, _dashCache);
    _loadRoleDashboard(_dashCache.me.role, _dashCache.me);
    // Silently fetch fresh data
    _refreshDash(el).catch(() => {});
  } else {
    // First load — skeleton instead of full spinner
    el.innerHTML = _dashSkeleton();
    try {
      _dashCache = await _fetchDash();
      if (!_dashPage) return;
      _buildDashDOM(el, _dashCache);
      _loadRoleDashboard(_dashCache.me.role, _dashCache.me);
    } catch (ex) {
      el.innerHTML = `<div class="error-state"><p>Could not load dashboard</p><button class="btn btn-sm btn-outline" onclick="renderDashboard()">Retry</button></div>`;
      return;
    }
  }

  // Auto-refresh stat numbers every 60s while page is open
  if (_dashTimer) clearInterval(_dashTimer);
  _dashTimer = setInterval(() => {
    if (!_dashPage || !document.getElementById('page-content')) {
      clearInterval(_dashTimer); _dashTimer = null; return;
    }
    _patchStatNumbers().catch(() => {});
  }, 60000);
}

// Called when navigating away
function _dashCleanup() {
  _dashPage = false;
  if (_dashTimer) { clearInterval(_dashTimer); _dashTimer = null; }
}
// Hook into navigate if it exists (called from core.js)
if (typeof window !== 'undefined') window._dashCleanup = _dashCleanup;

// ── Data fetching ─────────────────────────────────────────────────────────────
async function _fetchDash() {
  const [me, quota, history, keyStats] = await Promise.all([
    apiJson('/auth/me'),
    apiJson('/usage/me/quota'),
    apiJson('/usage/me/history?per_page=50'),
    apiJson('/keys/my-key/stats', { silent: true }).catch(() => null),
  ]);
  return { me, quota, history, keyStats, ts: Date.now() };
}

async function _refreshDash(el) {
  const data = await _fetchDash();
  _dashCache = data;
  if (_dashPage && document.getElementById('page-content') === el) {
    _buildDashDOM(el, data);
    _loadRoleDashboard(data.me.role, data.me);
  }
}

// Patch only the live stat numbers — fastest possible update
async function _patchStatNumbers() {
  try {
    const [quota, keyStats] = await Promise.all([
      apiJson('/usage/me/quota'),
      apiJson('/keys/my-key/stats', { silent: true }).catch(() => null),
    ]);
    const tokensUsed  = quota.current?.tokens_used_today || 0;
    const tokensLimit = quota.limits?.daily_tokens || 50000;
    const reqsUsed    = quota.current?.requests_this_hour || 0;
    const reqsLimit   = quota.limits?.requests_per_hour || 100;
    const tokenPct    = Math.min(100, Math.round((tokensUsed / tokensLimit) * 100));
    const reqPct      = Math.min(100, Math.round((reqsUsed / reqsLimit) * 100));

    _patch('_ds-tok-val',  fmtNum(tokensUsed));
    _patch('_ds-tok-sub',  tokenPct + '% of ' + fmtNum(tokensLimit));
    _patch('_ds-req-val',  reqsUsed);
    _patch('_ds-req-sub',  reqPct + '% of ' + reqsLimit);
    _patch('_ds-wk-val',   fmtNum(keyStats?.tokens_this_week || 0));
    _patchBar('_ds-tok-bar', tokenPct, tokenPct > 80);
    _patchBar('_ds-req-bar', reqPct,   reqPct   > 80);
    if (_dashCache) {
      _dashCache.quota = quota;
      _dashCache.keyStats = keyStats;
    }
  } catch (_) {}
}

function _patch(id, val) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(val)) el.textContent = val;
}
function _patchBar(id, pct, warn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = pct + '%';
  el.classList.toggle('warn', !!warn);
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function _dashSkeleton() {
  const sk = (w, h) => `<div class="skel" style="width:${w};height:${h}px;border-radius:6px;background:var(--border);animation:skelPulse 1.4s ease infinite;margin-bottom:8px"></div>`;
  if (!document.getElementById('_skel-style')) {
    const s = document.createElement('style');
    s.id = '_skel-style';
    s.textContent = '@keyframes skelPulse{0%,100%{opacity:.5}50%{opacity:1}}';
    document.head.appendChild(s);
  }
  return `<div style="padding:16px 0">
    ${sk('60%',28)}${sk('40%',16)}
    <div class="stats-grid stats-4" style="margin:20px 0">
      ${[1,2,3,4].map(() => `<div class="stat-card">${sk('50%',14)}${sk('40%',32)}${sk('80%',10)}${sk('60%',10)}</div>`).join('')}
    </div>
    ${sk('100%',180)}
  </div>`;
}

// ── Main DOM builder ──────────────────────────────────────────────────────────
function _buildDashDOM(el, { me, quota, history, keyStats }) {
  state.user = me;
  const q           = quota;
  const tokensUsed  = q.current?.tokens_used_today || 0;
  const tokensLimit = q.limits?.daily_tokens || 50000;
  const reqsUsed    = q.current?.requests_this_hour || 0;
  const reqsLimit   = q.limits?.requests_per_hour || 100;
  const tokenPct    = Math.min(100, Math.round((tokensUsed / tokensLimit) * 100));
  const reqPct      = Math.min(100, Math.round((reqsUsed / reqsLimit) * 100));
  const reqs        = history.requests || [];

  const heatmapData = buildHeatmapData(reqs);
  const modelDist   = {};
  reqs.forEach(r => { modelDist[r.model] = (modelDist[r.model] || 0) + 1; });
  const hourlyDist  = new Array(24).fill(0);
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
          <div class="value" id="_ds-tok-val">${fmtNum(tokensUsed)}</div>
          <div class="stat-bar"><div class="stat-bar-fill${tokenPct > 80 ? ' warn' : ''}" id="_ds-tok-bar" style="width:${tokenPct}%"></div></div>
          <div class="sub" id="_ds-tok-sub">${tokenPct}% of ${fmtNum(tokensLimit)}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
        <div class="stat-body">
          <div class="label">Requests / Hour</div>
          <div class="value" id="_ds-req-val">${reqsUsed}</div>
          <div class="stat-bar"><div class="stat-bar-fill${reqPct > 80 ? ' warn' : ''}" id="_ds-req-bar" style="width:${reqPct}%"></div></div>
          <div class="sub" id="_ds-req-sub">${reqPct}% of ${reqsLimit}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
        <div class="stat-body">
          <div class="label">This Week</div>
          <div class="value" id="_ds-wk-val">${fmtNum(keyStats?.tokens_this_week || 0)}</div>
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
        <div class="chart-header"><h3>Activity Heatmap</h3><span class="chart-sub">Your usage pattern over recent days</span></div>
        <div class="heatmap-container" id="heatmap-container"></div>
      </div>
      <div class="chart-card flex-1">
        <div class="chart-header"><h3>Model Usage</h3><span class="chart-sub">Distribution by model</span></div>
        <div class="chart-wrap-sm" style="position:relative">
          <canvas id="chart-models"></canvas>
          ${Object.keys(modelDist).length === 0 ? '<div class="chart-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg><p>No model usage yet</p><span>Start a chat to see distribution</span></div>' : ''}
        </div>
        <div id="model-legend" class="chart-legend"></div>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card flex-1">
        <div class="chart-header"><h3>Hourly Activity</h3><span class="chart-sub">When you use MAC most</span></div>
        <div style="height:200px;position:relative">
          <canvas id="chart-hourly"></canvas>
          ${hourlyDist.every(v => v === 0) ? '<div class="chart-empty"><p>No activity recorded yet</p></div>' : ''}
        </div>
      </div>
      <div class="chart-card flex-1">
        <div class="chart-header"><h3>Quota Overview</h3></div>
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
      <div class="chart-header"><h3>Recent Activity</h3><span class="chart-sub">${reqs.length} recent requests</span></div>
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
              </tr>`).join('')}
          </tbody>
        </table>
        </div>
      ` : '<div class="empty-state"><p>No activity yet. Start a chat or make an API call!</p></div>'}
    </div>

    <div class="chart-card">
      <div class="chart-header"><h3>Available Models</h3></div>
      <div id="models-grid" class="models-grid"><div class="muted" style="font-size:.8rem">Loading models…</div></div>
    </div>

    <div id="role-sections"></div>
  `;

  renderHeatmap('heatmap-container', heatmapData);
  makeDonut('chart-tokens', tokensUsed, tokensLimit);
  makeDonut('chart-reqs',   reqsUsed,   reqsLimit);
  _renderModelChart(modelDist, hourlyDist);

  // Load models grid without blocking (fast separate request)
  apiJson('/models').then(m => {
    const el2 = document.getElementById('models-grid');
    if (!el2) return;
    const list = m.models || [];
    const typeLabel = { chat: 'LLM · Chat', stt: 'Speech → Text', tts: 'Text → Speech', embedding: 'Embeddings', vision: 'Vision' };
    el2.innerHTML = list.map(md => `
      <div class="model-card">
        <div class="model-name">${esc(md.id || md.name)}</div>
        <div class="model-type-tag">${esc(typeLabel[md.model_type] || md.model_type || 'Model')}</div>
        <div class="model-status ${md.status === 'loaded' ? 'online' : 'offline'}">${md.status === 'loaded' ? '<span class="status-dot on"></span> Online' : '<span class="status-dot off"></span> Offline'}</div>
      </div>
    `).join('') || '<p class="muted">No models configured</p>';
  }).catch(() => {
    const el2 = document.getElementById('models-grid');
    if (el2) el2.innerHTML = '<p class="muted">Could not load models</p>';
  });
}

function _renderModelChart(modelDist, hourlyDist) {
  const cs0 = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const accentCol = cs0.getPropertyValue('--accent').trim() || '#7c6ff7';
  const mutedCol  = cs0.getPropertyValue('--muted').trim()  || '#888';
  const modelLabels = Object.keys(modelDist);
  const modelValues = Object.values(modelDist);
  const modelColors = isDark
    ? [accentCol, '#9b8fff', '#c4baff', '#6b5ce6', '#d4d0ff']
    : ['#111', '#555', '#999', '#bbb', '#ddd'];

  if (modelLabels.length > 0) {
    new Chart(document.getElementById('chart-models'), {
      type: 'doughnut',
      data: { labels: modelLabels.map(shortModel), datasets: [{ data: modelValues, backgroundColor: modelColors.slice(0, modelLabels.length), borderWidth: 2, borderColor: cs0.getPropertyValue('--card').trim() || '#fff', cutout: '68%', hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000', titleColor: '#fff', bodyColor: '#fff', cornerRadius: 8, padding: 10 } } },
    });
    const leg = document.getElementById('model-legend');
    if (leg) leg.innerHTML = modelLabels.map((m, i) =>
      `<div class="legend-item"><span class="legend-dot" style="background:${modelColors[i % modelColors.length]}"></span>${esc(shortModel(m))}<span class="muted" style="margin-left:auto">${modelValues[i]}</span></div>`
    ).join('');
  }

  const hourlyCtx = document.getElementById('chart-hourly');
  if (!hourlyCtx) return;
  const ctx2 = hourlyCtx.getContext('2d');
  const grad  = ctx2.createLinearGradient(0, 0, 0, 180);
  grad.addColorStop(0, isDark ? 'rgba(124,111,247,0.32)' : 'rgba(0,0,0,0.15)');
  grad.addColorStop(1, isDark ? 'rgba(124,111,247,0.02)' : 'rgba(0,0,0,0.01)');
  new Chart(hourlyCtx, {
    type: 'line',
    data: {
      labels: Array.from({length:24}, (_,i) => i + 'h'),
      datasets: [{ data: hourlyDist, fill: true, backgroundColor: grad, borderColor: accentCol, borderWidth: 2, pointBackgroundColor: accentCol, pointBorderColor: cs0.getPropertyValue('--card').trim() || '#fff', pointBorderWidth: 2, pointRadius: hourlyDist.map(v => v > 0 ? 4 : 0), pointHoverRadius: 6, tension: 0.4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000', titleColor: '#fff', bodyColor: '#fff', cornerRadius: 8, padding: 10, callbacks: { label: ctx => ctx.raw + ' request' + (ctx.raw !== 1 ? 's' : '') } } },
      scales: {
        y: { display: true, beginAtZero: true, grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }, ticks: { color: mutedCol, font: { size: 10 }, stepSize: 1, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: mutedCol, font: { size: 9 }, maxRotation: 0 } },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

// ── Role-specific sections ───────────────────────────────────────────────────
async function _loadRoleDashboard(role, me) {
  const sec = document.getElementById('role-sections');
  if (!sec) return;

  if (role === 'student') {
    const [attData, ccData, doubtsData, notebooksCount] = await Promise.allSettled([
      apiJson('/attendance/my-records?per_page=30', { silent: true }),
      apiJson('/copy-check/my-results?per_page=10', { silent: true }),
      apiJson('/doubts?per_page=5', { silent: true }),
      apiJson('/notebooks/list', { silent: true }).catch(() => ({ notebooks: [] })),
    ]);
    const att = attData.status  === 'fulfilled' ? attData.value  : null;
    const cc  = ccData.status   === 'fulfilled' ? ccData.value   : null;
    const dbt = doubtsData.status === 'fulfilled' ? doubtsData.value : null;
    const nb  = notebooksCount.status === 'fulfilled' ? notebooksCount.value : null;

    const sessions = att?.records || att?.sessions || [];
    const present  = sessions.filter(s => s.status === 'present').length;
    const attPct   = sessions.length > 0 ? Math.round((present / sessions.length) * 100) : null;
    const ccResults = cc?.results || cc?.checks || [];
    const ccAvg = ccResults.length > 0
      ? Math.round(ccResults.reduce((s, r) => s + (r.similarity_score || r.score || 0), 0) / ccResults.length * 100)
      : null;
    const doubtsList = dbt?.doubts || [];
    const nbList = nb?.notebooks || [];

    if (!document.getElementById('role-sections')) return;
    sec.innerHTML = `
      <div class="stats-grid stats-4" style="margin-top:16px">
        <div class="stat-card ${attPct !== null && attPct < 75 ? 'border-danger' : ''}">
          <div class="stat-icon" style="color:${attPct !== null && attPct < 75 ? 'var(--danger)' : 'var(--success,#22c55e)'}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg></div>
          <div class="stat-body"><div class="label">Attendance</div><div class="value">${attPct !== null ? attPct + '%' : '--'}</div><div class="sub">${present} / ${sessions.length} sessions${attPct !== null && attPct < 75 ? ' ⚠ Low' : ''}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          <div class="stat-body"><div class="label">Copy Check Avg</div><div class="value">${ccAvg !== null ? ccAvg + '%' : '--'}</div><div class="sub">${ccResults.length} submissions checked</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
          <div class="stat-body"><div class="label">My Doubts</div><div class="value">${dbt ? (dbt.total || doubtsList.length) : '--'}</div><div class="sub">${doubtsList.filter(d => d.status === 'open').length} open</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
          <div class="stat-body"><div class="label">Notebooks</div><div class="value">${nbList.length || '--'}</div><div class="sub">in MBM Book</div></div>
        </div>
      </div>
      ${doubtsList.length > 0 ? `
      <div class="chart-card" style="margin-top:16px">
        <div class="chart-header"><h3>Recent Doubts</h3></div>
        <div class="table-responsive"><table class="data-table">
          <thead><tr><th>Question</th><th>Status</th><th>Replies</th><th>Asked</th></tr></thead>
          <tbody>${doubtsList.slice(0,5).map(d => `
            <tr>
              <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(d.title||d.question||'')}">${esc((d.title||d.question||'').slice(0,60))}</td>
              <td><span class="badge badge-${d.status==='resolved'?'success':d.status==='open'?'warn':'neutral'}">${esc(d.status||'open')}</span></td>
              <td>${d.replies_count||d.answer_count||0}</td>
              <td class="muted">${timeAgo(d.created_at)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}`;

  } else if (role === 'faculty') {
    const [sessData, ccSessData, pendingDts] = await Promise.allSettled([
      apiJson('/attendance/sessions?per_page=8'),
      apiJson('/copy-check/sessions?per_page=8'),
      apiJson('/doubts?status=open&per_page=8'),
    ]);
    const sessions   = sessData.status   === 'fulfilled' ? (sessData.value.sessions   || sessData.value   || []) : [];
    const ccSessions = ccSessData.status === 'fulfilled' ? (ccSessData.value.sessions || ccSessData.value || []) : [];
    const pending    = pendingDts.status === 'fulfilled' ? (pendingDts.value.doubts   || []) : [];

    if (!document.getElementById('role-sections')) return;
    sec.innerHTML = `
      <div class="stats-grid stats-3" style="margin-top:16px">
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div class="stat-body"><div class="label">Attendance Sessions</div><div class="value">${sessions.length}</div><div class="sub">${sessions.filter(s=>s.is_open).length} open now</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <div class="stat-body"><div class="label">Copy Check Sessions</div><div class="value">${ccSessions.length}</div><div class="sub">${ccSessions.filter(s=>s.is_active).length} active</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
          <div class="stat-body"><div class="label">Pending Doubts</div><div class="value">${pending.length}</div><div class="sub">awaiting answer</div></div>
        </div>
      </div>
      ${pending.length > 0 ? `
      <div class="chart-card" style="margin-top:16px">
        <div class="chart-header"><h3>Open Doubts — Needs Your Answer</h3></div>
        <div class="table-responsive"><table class="data-table">
          <thead><tr><th>Question</th><th>Student</th><th>Asked</th></tr></thead>
          <tbody>${pending.slice(0,6).map(d => `
            <tr>
              <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((d.title||d.question||'').slice(0,70))}</td>
              <td class="muted">${esc(d.author_name||d.roll_number||'--')}</td>
              <td class="muted">${timeAgo(d.created_at)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}`;

  } else if (role === 'admin') {
    const [clusterData, topUsersData] = await Promise.allSettled([
      apiJson('/cluster/nodes', { silent: true }).catch(() => []),
      apiJson('/usage/admin/top?n=5', { silent: true }),
    ]);
    const nodes    = clusterData.status   === 'fulfilled' ? (Array.isArray(clusterData.value) ? clusterData.value : (clusterData.value.nodes||[])) : [];
    const topUsers = topUsersData.status  === 'fulfilled' ? (topUsersData.value.users||[]) : [];

    if (!document.getElementById('role-sections')) return;
    sec.innerHTML = `
      <div class="stats-grid stats-3" style="margin-top:16px">
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg></div>
          <div class="stat-body"><div class="label">Cluster Nodes</div><div class="value">${nodes.length}</div><div class="sub">${nodes.filter(n=>n.status==='active'&&n.healthy).length} healthy · ${nodes.filter(n=>n.status==='pending').length} pending</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div class="stat-body"><div class="label">Live Activity</div><div class="value" style="font-size:1rem"><span class="dot-success"></span> Streaming</div><div class="sub"><a href="#" onclick="navigate('admin');return false" style="color:var(--accent)">Open Admin Panel →</a></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
          <div class="stat-body"><div class="label">Top User Today</div><div class="value" style="font-size:1rem">${topUsers[0] ? esc(topUsers[0].name?.split(' ')[0] || 'N/A') : '--'}</div><div class="sub">${topUsers[0] ? fmtNum(topUsers[0].tokens_today||0) + ' tokens' : 'No usage yet'}</div></div>
        </div>
      </div>
      ${topUsers.length > 1 ? `
      <div class="chart-card" style="margin-top:16px">
        <div class="chart-header"><h3>Top Users Today</h3><span class="chart-sub">Sorted by tokens — updates every 60s</span></div>
        <div class="table-responsive"><table class="data-table">
          <thead><tr><th>#</th><th>Name</th><th>Dept</th><th>Tokens</th><th>Requests</th></tr></thead>
          <tbody>${topUsers.map((u, i) => `
            <tr>
              <td class="muted">${i+1}</td>
              <td>${esc(u.name || u.roll_number)}</td>
              <td class="muted">${esc(u.department || '--')}</td>
              <td><strong>${fmtNum(u.tokens_today)}</strong></td>
              <td>${u.requests_today}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}`;
  }
}

/*
   HEATMAP — GitHub-style contribution graph
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
  startDate.setDate(startDate.getDate() - startDate.getDay());

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

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
    ${!hasData ? '<div class="heatmap-empty"><p>No activity yet</p><span>Your usage will light up here as you chat</span></div>' : ''}
    <div class="heatmap-legend">
      <span style="font-size:.7rem;color:var(--muted)">Less</span>
      <div class="hm-cell hm-0"></div><div class="hm-cell hm-1"></div><div class="hm-cell hm-2"></div><div class="hm-cell hm-3"></div><div class="hm-cell hm-4"></div>
      <span style="font-size:.7rem;color:var(--muted)">More</span>
    </div>
  `;

  let _hmTooltip = null;
  container.querySelectorAll('.hm-cell[title]').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (_hmTooltip) { _hmTooltip.remove(); _hmTooltip = null; }
      const tip = document.createElement('div');
      tip.className = 'hm-tooltip';
      tip.textContent = cell.title;
      tip.style.cssText = 'position:fixed;background:rgba(0,0,0,.85);color:#fff;padding:6px 12px;border-radius:8px;font-size:.75rem;pointer-events:none;z-index:9990;white-space:nowrap;';
      document.body.appendChild(tip);
      _hmTooltip = tip;
      const rect = cell.getBoundingClientRect();
      const tipW = tip.offsetWidth;
      let left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      tip.style.left = left + 'px';
      tip.style.top = (rect.top - tip.offsetHeight - 8 + window.scrollY) + 'px';
      setTimeout(() => { if (_hmTooltip === tip) { tip.remove(); _hmTooltip = null; } }, 2500);
    });
  });
  document.addEventListener('click', (e) => {
    if (_hmTooltip && !e.target.closest('.hm-cell')) { _hmTooltip.remove(); _hmTooltip = null; }
  });
}

/*
   SETTINGS
*/
