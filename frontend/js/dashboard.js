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

  // Mobile-friendly click tooltip for heatmap cells
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
  }, { once: false, capture: false });
}

/* 
   SETTINGS
    */
