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
    t.onclick = () => { adminTab = t.dataset.tab; localStorage.setItem('mac_admin_tab', adminTab); renderAdmin(); };
  });
  requestAnimationFrame(() => {
    const activeTab = document.querySelector('#admin-tabs .admin-tab.active');
    if (activeTab) activeTab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
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
    const students = entries.filter(e => (e.role || 'student') === 'student');
    const faculty = entries.filter(e => e.role === 'faculty');
    const admins = entries.filter(e => e.role === 'admin');

    const regTab = localStorage.getItem('mac_reg_tab') || 'student';

    function tableRows(list) {
      if (!list.length) return `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">No entries</td></tr>`;
      return list.map(e => `
        <tr>
          <td class="mono bold">${esc(e.roll_number)}</td>
          <td class="mono" style="font-size:.85rem">${esc(e.registration_number || '-')}</td>
          <td>${esc(e.name)}</td>
          <td>${esc(e.department)}</td>
          <td>${esc(e.dob)}</td>
          <td>${e.batch_year || '-'}</td>
        </tr>`).join('');
    }

    el.innerHTML = `
      <div class="admin-header">
        <h2>Registry <span class="badge badge-neutral" style="font-size:.75rem;vertical-align:middle">${entries.length} total</span></h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" id="add-reg-btn">+ Add Entry</button>
          <button class="btn btn-sm btn-primary" id="bulk-reg-btn">Bulk Import (JSON)</button>
          <button class="btn btn-sm btn-primary" id="upload-reg-btn" style="background:var(--accent)">Upload CSV / JSON</button>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">College database — students, faculty and admins verify against this list when creating accounts.</p>
      <div class="admin-tabs" id="reg-tabs" style="margin-bottom:12px">
        <div class="admin-tab ${regTab==='student'?'active':''}" data-rtab="student">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <span>Students</span> <span class="badge badge-neutral" style="font-size:.7rem">${students.length}</span>
        </div>
        <div class="admin-tab ${regTab==='faculty'?'active':''}" data-rtab="faculty">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M12 11v4"/><path d="M10 13h4"/></svg>
          <span>Faculty</span> <span class="badge badge-neutral" style="font-size:.7rem">${faculty.length}</span>
        </div>
        <div class="admin-tab ${regTab==='admin'?'active':''}" data-rtab="admin">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Admins</span> <span class="badge badge-neutral" style="font-size:.7rem">${admins.length}</span>
        </div>
      </div>
      <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Roll / Email</th><th>Reg. No.</th><th>Name</th><th>Dept</th><th>DOB</th><th>Batch</th></tr></thead>
        <tbody id="reg-table-body">
          ${tableRows(regTab === 'student' ? students : regTab === 'faculty' ? faculty : admins)}
        </tbody>
      </table>
      </div>`;

    // Tab switching (no full reload)
    el.querySelectorAll('[data-rtab]').forEach(t => {
      t.onclick = () => {
        el.querySelectorAll('[data-rtab]').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        localStorage.setItem('mac_reg_tab', t.dataset.rtab);
        const list = t.dataset.rtab === 'student' ? students : t.dataset.rtab === 'faculty' ? faculty : admins;
        document.getElementById('reg-table-body').innerHTML = tableRows(list);
      };
    });

    // Add Entry modal (with role selector)
    document.getElementById('add-reg-btn').onclick = () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h3>Add Registry Entry</h3>
          <div class="field"><label>Role</label>
            <select id="rg-role">
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="field"><label>Roll No / Employee ID / Email</label><input id="rg-roll" placeholder="e.g. 23CS050 or prof@mbm.ac.in"></div>
          <div class="field"><label>Registration Number</label><input id="rg-reg" placeholder="e.g. J2234345A (optional)"></div>
          <div class="field"><label>Full Name</label><input id="rg-name" placeholder="Full name"></div>
          <div class="field"><label>Department</label>
            <select id="rg-dept"><option>CSE</option><option>ECE</option><option>ME</option><option>CE</option><option>EE</option><option>Other</option></select>
          </div>
          <div class="field"><label>Date of Birth (DD-MM-YYYY)</label><input id="rg-dob" placeholder="15-08-1990" maxlength="10"></div>
          <div class="field"><label>Batch / Join Year</label><input id="rg-batch" type="number" placeholder="2021"></div>
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
          registration_number: overlay.querySelector('#rg-reg').value.trim() || null,
          name: overlay.querySelector('#rg-name').value.trim(),
          department: overlay.querySelector('#rg-dept').value,
          dob: overlay.querySelector('#rg-dob').value.trim(),
          batch_year: parseInt(overlay.querySelector('#rg-batch').value) || null,
          role: overlay.querySelector('#rg-role').value,
        };
        if (!body.roll_number || !body.name || !body.dob) { err.textContent = 'Roll No, Name, and DOB are required'; return; }
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
          <h3>Bulk Import</h3>
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">Paste JSON array. Each: <code>{ roll_number, name, department, dob, batch_year, role }</code><br>role is optional — defaults to <code>"student"</code></p>
          <textarea id="bulk-json" rows="8" style="width:100%;font-family:monospace;font-size:.8rem" placeholder='[{"roll_number":"23CS001","name":"Aaryan Rajput","department":"CSE","dob":"10-05-2005","batch_year":2023,"role":"student"},{"roll_number":"prof.raj@mbm.ac.in","name":"Dr. Raj Kumar","department":"CSE","dob":"15-06-1985","batch_year":2010,"role":"faculty"}]'></textarea>
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
        if (!Array.isArray(students)) { err.textContent = 'Must be a JSON array'; return; }
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
          <h3>Upload Registry File (CSV or JSON)</h3>
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:8px">CSV columns: <code>roll_number, name, department, dob, batch_year, role</code></p>
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">JSON: array of objects or <code>{"students": [...]}</code></p>
          <div style="padding:32px;text-align:center;border:2px dashed var(--border);border-radius:8px;cursor:pointer;margin-bottom:12px" id="reg-file-drop">
            <p style="margin:0;font-size:.95rem">Drag &amp; drop or click to select</p>
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
      dropArea.ondragover = (e) => { e.preventDefault(); dropArea.style.borderColor = 'var(--accent)'; };
      dropArea.ondragleave = () => { dropArea.style.borderColor = 'var(--border)'; };
      dropArea.ondrop = (e) => { e.preventDefault(); dropArea.style.borderColor = 'var(--border)'; if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); };
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
          const d = await r.json();
          if (!r.ok) { err.textContent = d.detail || 'Upload failed'; res.textContent = ''; submitBtn.disabled = false; return; }
          res.innerHTML = '<span style="color:var(--success)">' + esc(d.message) + '</span>' +
            (d.errors?.length ? '<br><span style="color:var(--danger)">Errors: ' + d.errors.join(', ') + '</span>' : '');
          setTimeout(() => { overlay.remove(); renderAdmin(); }, 2000);
        } catch (ex) { err.textContent = ex.message; res.textContent = ''; submitBtn.disabled = false; }
      };
    };
  } catch (ex) { el.innerHTML = `<div class="error-state"><p>Error: ${esc(ex.message)}</p></div>`; }
}



/* 
   ADMIN "" Cluster / Nodes Management
    */
