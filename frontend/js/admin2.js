async function renderAdminCluster() {
  const el = document.getElementById('admin-content');
  try {
    const [nodesData, clusterData, tokensData] = await Promise.all([
      apiJson('/cluster/nodes').catch(() => []),
      apiJson('/nodes/cluster-status').catch(() => ({})),
      apiJson('/cluster/enroll-tokens').catch(() => []),
    ]);
    const nodes = Array.isArray(nodesData) ? nodesData : (nodesData.nodes || []);
    const tokens = Array.isArray(tokensData) ? tokensData : [];
    const pending = nodes.filter(n => n.status === 'pending');
    const active = nodes.filter(n => n.status === 'active');
    const other = nodes.filter(n => n.status !== 'pending' && n.status !== 'active');
    const joinUrl = `${location.origin}/join`;

    el.innerHTML = `
      <div class="admin-header" style="flex-wrap:wrap;gap:12px">
        <h2>GPU Cluster <span class="badge" style="font-size:.75rem;vertical-align:middle">${nodes.length} nodes</span></h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" id="gen-enroll-token" style="width:auto;padding:8px 16px">+ Generate Token</button>
          <button class="btn btn-sm btn-outline" id="refresh-cluster" style="width:auto;padding:8px 16px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- Worker Join Info -->
      <div class="card" style="margin-bottom:20px;padding:16px 20px;background:linear-gradient(135deg,rgba(99,102,241,.08),rgba(168,85,247,.08));border:1px solid rgba(99,102,241,.2);border-radius:14px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          <div>
            <div style="font-weight:700;font-size:.9rem">Worker Join URL</div>
            <div style="font-size:.8rem;color:var(--muted)">Share this URL with worker PCs to contribute GPU resources</div>
          </div>
          <code class="mono" style="flex:1;min-width:200px;padding:8px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:.85rem;word-break:break-all">${esc(joinUrl)}</code>
          <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText('${esc(joinUrl)}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)" style="width:auto;padding:6px 14px">Copy</button>
        </div>
      </div>

      ${pending.length > 0 ? `
      <!-- Pending Approvals -->
      <div style="margin-bottom:24px">
        <h3 style="margin-bottom:12px;color:var(--warning,#f59e0b)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Pending Approval (${pending.length})
        </h3>
        <div class="nodes-grid">
          ${pending.map(n => `
            <div class="node-card" style="border-left:3px solid var(--warning,#f59e0b)">
              <div class="node-card-header">
                <span class="node-name">${esc(n.name || n.hostname || 'Worker')}</span>
                <span class="node-status" style="color:var(--warning,#f59e0b)">Pending</span>
              </div>
              <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">
                ${esc(n.ip || n.ip_address || '')} &middot; ${esc(n.gpu_name || 'GPU Unknown')}
                ${n.gpu_vram_total_mb || n.gpu_vram_mb ? ' &middot; ' + Math.round((n.gpu_vram_total_mb || n.gpu_vram_mb)/1024) + 'GB VRAM' : ''}
                ${n.cpu_cores ? ' &middot; ' + n.cpu_cores + ' cores' : ''}
                ${n.ram_total_mb ? ' &middot; ' + Math.round(n.ram_total_mb/1024) + 'GB RAM' : ''}
              </div>
              <div style="display:flex;gap:8px;margin-top:10px">
                <button class="btn btn-sm btn-primary approve-node" data-id="${n.id}" style="width:auto;padding:6px 18px">Approve</button>
                <button class="btn btn-sm btn-danger-outline reject-node" data-id="${n.id}" style="width:auto;padding:6px 14px">Reject</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Active Nodes -->
      <div style="margin-bottom:24px">
        <h3 style="margin-bottom:12px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success,#22c55e)" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Active Nodes (${active.length})
        </h3>
        <div class="nodes-grid">
          ${active.length === 0 ? '<div class="empty-state" style="padding:20px"><p>No active nodes. Generate an enrollment token and set up worker PCs to add GPU resources.</p></div>' : active.map(n => `
            <div class="node-card" style="border-left:3px solid var(--success,#22c55e)">
              <div class="node-card-header">
                <span class="node-name">${esc(n.name || n.hostname || 'Worker')}</span>
                <span class="node-status" style="color:${n.healthy ? 'var(--success,#22c55e)' : 'var(--danger,#ef4444)'}">${n.healthy ? 'Healthy' : 'Stale'}</span>
              </div>
              <div style="font-size:.78rem;color:var(--muted);margin-bottom:10px">
                ${esc(n.ip || n.ip_address || '')} &middot; ${esc(n.gpu_name || 'GPU Unknown')}
                ${n.gpu_vram_total_mb ? ' &middot; ' + Math.round(n.gpu_vram_total_mb/1024) + 'GB' : ''}
                ${n.heartbeat_age_s != null ? ' &middot; Last heartbeat: ' + Math.round(n.heartbeat_age_s) + 's ago' : ''}
              </div>
              <div class="node-metrics">
                <div class="node-metric"><span class="metric-val">${n.gpu_util_pct != null ? Math.round(n.gpu_util_pct) + '%' : '--'}</span><span class="metric-lbl">GPU</span></div>
                <div class="node-metric"><span class="metric-val">${n.cpu_util_pct != null ? Math.round(n.cpu_util_pct) + '%' : '--'}</span><span class="metric-lbl">CPU</span></div>
                <div class="node-metric"><span class="metric-val">${n.ram_used_mb && n.ram_total_mb ? Math.round(n.ram_used_mb/n.ram_total_mb*100) + '%' : '--'}</span><span class="metric-lbl">RAM</span></div>
                <div class="node-metric"><span class="metric-val">${n.gpu_vram_used_mb && n.gpu_vram_total_mb ? Math.round(n.gpu_vram_used_mb/n.gpu_vram_total_mb*100) + '%' : '--'}</span><span class="metric-lbl">VRAM</span></div>
              </div>
              ${(n.models || []).length > 0 ? `
                <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
                  ${n.models.map(m => `<span class="badge" style="font-size:.7rem;padding:2px 8px;background:rgba(99,102,241,.12);color:var(--primary)">${esc(m.model_id)} (${m.status})</span>`).join('')}
                </div>
              ` : ''}
              <div style="margin-top:12px;display:flex;gap:6px">
                <button class="btn btn-sm btn-outline drain-node" data-id="${n.id}" style="width:auto;padding:5px 12px;font-size:.75rem">Drain</button>
                <button class="btn btn-sm btn-danger-outline remove-node" data-id="${n.id}" style="width:auto;padding:5px 12px;font-size:.75rem">Remove</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${other.length > 0 ? `
      <!-- Draining / Other Nodes -->
      <div style="margin-bottom:24px">
        <h3 style="margin-bottom:12px;color:var(--muted)">Other Nodes (${other.length})</h3>
        <div class="nodes-grid">
          ${other.map(n => `
            <div class="node-card" style="opacity:.7;border-left:3px solid var(--muted)">
              <div class="node-card-header">
                <span class="node-name">${esc(n.name || n.hostname || 'Worker')}</span>
                <span class="node-status" style="color:var(--muted)">${esc(n.status)}</span>
              </div>
              <div style="font-size:.78rem;color:var(--muted)">${esc(n.ip || n.ip_address || '')}</div>
              <div style="margin-top:10px;display:flex;gap:6px">
                <button class="btn btn-sm btn-outline activate-node" data-id="${n.id}" style="width:auto;padding:5px 12px;font-size:.75rem">Reactivate</button>
                <button class="btn btn-sm btn-danger-outline remove-node" data-id="${n.id}" style="width:auto;padding:5px 12px;font-size:.75rem">Remove</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Enrollment Tokens -->
      ${tokens.length > 0 ? `
      <div style="margin-top:16px">
        <h3 style="margin-bottom:12px">Recent Enrollment Tokens</h3>
        <div class="table-responsive">
        <table class="data-table">
          <thead><tr><th>Label</th><th>Used</th><th>Expires</th><th>Created</th></tr></thead>
          <tbody>
            ${tokens.slice(0, 10).map(t => `
              <tr>
                <td>${esc(t.label)}</td>
                <td>${t.used ? '<span class="dot-success"></span> Yes' : '<span class="dot-error"></span> No'}</td>
                <td class="muted">${new Date(t.expires_at).toLocaleString()}</td>
                <td class="muted">${t.created_at ? new Date(t.created_at).toLocaleString() : '--'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      </div>
      ` : ''}
    `;

    // Bind: Generate enrollment token
    document.getElementById('gen-enroll-token').onclick = async () => {
      const label = prompt('Label for this token (e.g. "Lab-PC3-GPU"):');
      if (!label) return;
      try {
        const r = await apiJson('/cluster/enroll-token', { method: 'POST', body: JSON.stringify({ label, expires_hours: 24 }) });
        const tokenStr = r.token;
        // Show token in a nice modal
        const ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.innerHTML = `
          <div class="modal" style="max-width:500px">
            <h3 style="margin-bottom:12px">Enrollment Token Generated</h3>
            <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">Share this token with the worker PC. It expires in 24 hours and can only be used once.</p>
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
              <div style="font-size:.75rem;color:var(--muted);margin-bottom:4px">Token (copy this)</div>
              <code class="mono" style="font-size:.85rem;word-break:break-all;display:block">${esc(tokenStr)}</code>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-primary" onclick="navigator.clipboard.writeText('${esc(tokenStr)}');this.textContent='Copied!'" style="width:auto;padding:8px 20px">Copy Token</button>
              <button class="btn btn-sm btn-outline" onclick="this.closest('.modal-overlay').remove()" style="width:auto;padding:8px 20px">Close</button>
            </div>
          </div>`;
        ov.onclick = e => { if (e.target === ov) ov.remove(); };
        document.body.appendChild(ov);
      } catch (ex) { alert('Failed: ' + ex.message); }
    };

    // Bind: Refresh
    document.getElementById('refresh-cluster').onclick = () => renderAdminCluster();

    // Bind: Approve pending
    el.querySelectorAll('.approve-node').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api('/cluster/nodes/' + btn.dataset.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'approve' }) });
          renderAdminCluster();
        } catch { alert('Failed to approve'); }
      };
    });
    // Bind: Reject pending
    el.querySelectorAll('.reject-node').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Reject and remove this node?')) return;
        try {
          await api('/cluster/nodes/' + btn.dataset.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'remove' }) });
          renderAdminCluster();
        } catch { alert('Failed'); }
      };
    });
    // Bind: Drain
    el.querySelectorAll('.drain-node').forEach(btn => {
      btn.onclick = async () => {
        try { await api('/cluster/nodes/' + btn.dataset.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'drain' }) }); renderAdminCluster(); } catch { alert('Failed'); }
      };
    });
    // Bind: Activate
    el.querySelectorAll('.activate-node').forEach(btn => {
      btn.onclick = async () => {
        try { await api('/cluster/nodes/' + btn.dataset.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'reactivate' }) }); renderAdminCluster(); } catch { alert('Failed'); }
      };
    });
    // Bind: Remove
    el.querySelectorAll('.remove-node').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Remove this node permanently?')) return;
        try { await api('/cluster/nodes/' + btn.dataset.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'remove' }) }); renderAdminCluster(); } catch { alert('Failed'); }
      };
    });

    // Auto-refresh every 15 seconds when cluster tab is active
    if (window._clusterRefreshIv) clearInterval(window._clusterRefreshIv);
    window._clusterRefreshIv = setInterval(() => {
      if (adminTab === 'cluster' && state.page === 'admin') renderAdminCluster();
    }, 15000);

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
  <div id="gr-rules-list"><div class="loading-state"><div class="spinner"></div><span>Loading rules...</span></div></div>`;

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
    el.innerHTML = cats.length ? cats.map(cat => `
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
      </div>`).join('') : '<div class="empty-state"><p>No guardrail rules configured yet</p></div>';

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
  <div id="features-list"><div class="loading-state"><div class="spinner"></div><span>Loading flags...</span></div></div>`;

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
   ADMIN — Live Activity Stream (IST real-time SSE)
*/
async function renderAdminActivityStream() {
  const el = document.getElementById('admin-content');
  el.innerHTML = `
    <div class="admin-header">
      <div><h2>Live Activity</h2><p class="muted" style="margin:0">Real-time platform events — all times in IST</p></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span id="act-dot" style="width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block;flex-shrink:0"></span>
        <span id="act-label" class="muted" style="font-size:.8rem">Connecting...</span>
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('activity-feed').innerHTML=''">Clear</button>
      </div>
    </div>
    <div id="activity-feed" style="display:flex;flex-direction:column;gap:4px;max-height:70vh;overflow-y:auto;padding:4px 0"></div>`;

  if (window._adminActivityEs) { window._adminActivityEs.close(); window._adminActivityEs = null; }

  const feed = document.getElementById('activity-feed');

  function _appendEntry(e) {
    const catColors = { chat:'#22c55e', auth:'#f59e0b', upload:'#3b82f6', download:'#8b5cf6',
      attendance:'#10b981', quota:'#ef4444', cluster:'#6366f1', copy_check:'#f97316',
      doubt:'#06b6d4', video:'#ec4899', voice:'#a855f7', system:'#6b7280', default:'#9ca3af' };
    const color = catColors[e.category] || catColors.default;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:7px 12px;border-radius:8px;background:var(--surface);border:1px solid var(--border);font-size:.82rem;line-height:1.4';
    div.innerHTML = `
      <span style="font-size:.95rem;flex-shrink:0;margin-top:1px">${e.icon||'•'}</span>
      <span style="color:var(--muted);font-size:.72rem;white-space:nowrap;flex-shrink:0;margin-top:2px;min-width:80px">${esc(e.time||'')}</span>
      <span style="color:var(--text);flex:1">${esc(e.message||'')}</span>
      <span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;margin-top:5px"></span>`;
    feed.insertBefore(div, feed.firstChild);
    while (feed.children.length > 300) feed.removeChild(feed.lastChild);
  }

  const token = encodeURIComponent(state.token || '');
  window._adminActivityEs = new EventSource(`/api/v1/admin/activity/stream?token=${token}`);

  window._adminActivityEs.onopen = () => {
    const dot = document.getElementById('act-dot');
    const lbl = document.getElementById('act-label');
    if (dot) dot.style.background = '#22c55e';
    if (lbl) lbl.textContent = 'Live';
  };
  window._adminActivityEs.onmessage = e => {
    try { _appendEntry(JSON.parse(e.data)); } catch {}
  };
  window._adminActivityEs.onerror = () => {
    const dot = document.getElementById('act-dot');
    const lbl = document.getElementById('act-label');
    if (dot) dot.style.background = '#ef4444';
    if (lbl) lbl.textContent = 'Reconnecting...';
  };

  // Auto-close SSE when tab changes
  const obs = new MutationObserver(() => {
    if (!document.getElementById('activity-feed')) {
      if (window._adminActivityEs) { window._adminActivityEs.close(); window._adminActivityEs = null; }
      obs.disconnect();
    }
  });
  const ac = document.getElementById('admin-content');
  if (ac) obs.observe(ac, { childList: true });
}

/*
   ADMIN — Terminal (xterm.js PTY)
*/
let _termWs = null;
let _termInst = null;

async function renderAdminTerminal() {
  const el = document.getElementById('admin-content');
  el.innerHTML = `
    <div class="admin-header" style="flex-wrap:wrap;gap:10px">
      <div>
        <h2>⚡ Terminal</h2>
        <p class="muted" style="margin:0">Full bash access to MAC containers</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="term-shell" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:.82rem">
          <option value="">MAC Backend (bash)</option>
          <option value="docker:mac-api">Container: mac-api</option>
          <option value="docker:mac-postgres">Container: mac-postgres</option>
          <option value="docker:mac-nginx">Container: mac-nginx</option>
          <option value="docker:mac-redis">Container: mac-redis</option>
          <option value="docker:mac-whisper">Container: mac-whisper</option>
          <option value="docker:mac-searxng">Container: mac-searxng</option>
          <option value="docker:mac-qdrant">Container: mac-qdrant</option>
        </select>
        <button class="btn btn-sm btn-primary" id="term-connect" style="width:auto;padding:6px 16px">Connect</button>
        <button class="btn btn-sm btn-danger-outline" id="term-disconnect" style="display:none;width:auto;padding:6px 14px">Disconnect</button>
        <span id="term-status" class="muted" style="font-size:.75rem">Disconnected</span>
      </div>
    </div>
    <div id="term-wrap" style="background:#1e1e1e;border-radius:10px;border:1px solid var(--border);overflow:hidden;height:calc(100vh - 195px);min-height:380px;position:relative">
      <div id="term-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#555;font-size:.85rem">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        <span>Click Connect to open a terminal session</span>
      </div>
      <div id="term-xterm" style="height:100%;width:100%;display:none"></div>
    </div>`;

  document.getElementById('term-connect').onclick = _termConnect;
  document.getElementById('term-disconnect').onclick = _termDisconnect;

  // Cleanup on tab navigation
  const obs = new MutationObserver(() => {
    if (!document.getElementById('term-wrap')) { _termDisconnect(); obs.disconnect(); }
  });
  const ac = document.getElementById('admin-content');
  if (ac) obs.observe(ac, { childList: true });
}

async function _termLoadLibs() {
  if (window.Terminal) return true;
  try {
    await Promise.all([
      _dynStyle('/static/libs/xterm.css'),
      _dynScript('/static/libs/xterm.min.js'),
    ]);
    await _dynScript('/static/libs/xterm-addon-fit.min.js');
    return !!window.Terminal;
  } catch { return false; }
}
function _dynScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function _dynStyle(href) {
  if (!document.querySelector(`link[href="${href}"]`)) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }
  return Promise.resolve();
}

async function _termConnect() {
  const statusEl = document.getElementById('term-status');
  const shellSel = document.getElementById('term-shell');
  if (statusEl) statusEl.textContent = 'Loading xterm.js...';

  const ok = await _termLoadLibs();
  if (!ok) {
    if (statusEl) statusEl.textContent = 'Terminal library load failed';
    showToast('Terminal library unavailable. Refresh the page once.', 'error');
    return;
  }

  _termDisconnect();

  const shell = shellSel ? shellSel.value : '';
  const xtermEl = document.getElementById('term-xterm');
  const placeholder = document.getElementById('term-placeholder');

  _termInst = new Terminal({
    cursorBlink: true, fontSize: 13,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4',
      black: '#1e1e1e', red: '#f44747', green: '#6a9955', yellow: '#dcdcaa',
      blue: '#569cd6', magenta: '#c586c0', cyan: '#4ec9b0', white: '#d4d4d4',
      brightBlack: '#808080', brightRed: '#f44747', brightGreen: '#89d185',
      brightYellow: '#dcdcaa', brightBlue: '#569cd6', brightMagenta: '#c586c0',
      brightCyan: '#4ec9b0', brightWhite: '#ffffff',
    },
    scrollback: 5000,
  });

  const fitAddon = new FitAddon.FitAddon();
  _termInst.loadAddon(fitAddon);

  if (placeholder) placeholder.style.display = 'none';
  if (xtermEl) xtermEl.style.display = 'block';
  _termInst.open(xtermEl);

  try { fitAddon.fit(); } catch {}

  const ro = new ResizeObserver(() => { try { fitAddon.fit(); } catch {} });
  if (xtermEl) ro.observe(xtermEl);

  // WebSocket
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const tokenParam = encodeURIComponent(state.token || '');
  const shellParam = shell ? `&shell=${encodeURIComponent(shell)}` : '';
  const wsUrl = `${proto}//${location.host}/api/v1/admin/terminal/ws?token=${tokenParam}${shellParam}`;

  _termWs = new WebSocket(wsUrl);
  _termWs.binaryType = 'arraybuffer';

  _termWs.onopen = () => {
    if (statusEl) statusEl.textContent = 'Connected';
    document.getElementById('term-connect').style.display = 'none';
    document.getElementById('term-disconnect').style.display = '';
    const { cols, rows } = _termInst;
    _termWs.send(JSON.stringify({ type: 'resize', cols, rows }));
  };
  _termWs.onmessage = e => {
    if (e.data instanceof ArrayBuffer) {
      _termInst.write(new Uint8Array(e.data));
    } else {
      _termInst.write(e.data);
    }
  };
  _termWs.onclose = () => {
    if (statusEl) statusEl.textContent = 'Disconnected';
    document.getElementById('term-connect').style.display = '';
    document.getElementById('term-disconnect').style.display = 'none';
    _termWs = null;
  };
  _termWs.onerror = () => {
    if (statusEl) statusEl.textContent = 'Error';
    showToast('Terminal connection error', 'error');
  };

  _termInst.onData(data => {
    if (_termWs && _termWs.readyState === WebSocket.OPEN) _termWs.send(data);
  });
  _termInst.onResize(({ cols, rows }) => {
    if (_termWs && _termWs.readyState === WebSocket.OPEN)
      _termWs.send(JSON.stringify({ type: 'resize', cols, rows }));
  });
}

function _termDisconnect() {
  if (_termWs) { try { _termWs.close(); } catch {} _termWs = null; }
  if (_termInst) { try { _termInst.dispose(); } catch {} _termInst = null; }
  const placeholder = document.getElementById('term-placeholder');
  const xtermEl = document.getElementById('term-xterm');
  const statusEl = document.getElementById('term-status');
  if (placeholder) { placeholder.style.display = ''; placeholder.innerHTML = `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
    <span>Click Connect to open a terminal session</span>`; }
  if (xtermEl) xtermEl.style.display = 'none';
  if (statusEl) statusEl.textContent = 'Disconnected';
  const cb = document.getElementById('term-connect');
  const db = document.getElementById('term-disconnect');
  if (cb) cb.style.display = '';
  if (db) db.style.display = 'none';
}
