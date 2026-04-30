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
