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

