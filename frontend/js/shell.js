function shell() {
  const u = state.user || {};
  const isAdmin = u.role === 'admin';
  const isFacultyOrAdmin = u.role === 'faculty' || u.role === 'admin';
  const isStudent = u.role === 'student';
  const pages = { dashboard: 'Dashboard', chat: 'Chat', notebooks: 'MBM Book', doubts: 'Doubts', attendance: 'Attendance', copycheck: 'Copy Check', fileshare: 'Shared Files', settings: 'Settings', admin: 'Admin' };
  const dockSide = localStorage.getItem('mac_dock_side') || 'left';
  const savedW = localStorage.getItem('mac_sidebar_width');
  const savedH = localStorage.getItem('mac_sidebar_height');
  const savedCompact = localStorage.getItem('mac_sidebar_compact') === '1';
  const isHorizDock = dockSide === 'top' || dockSide === 'bottom';
  const sidebarStyle = isHorizDock
    ? (savedH ? `style="height:${savedH}px"` : '')
    : (savedW ? `style="width:${savedW}px"` : '');
  const sidebarCompactClass = (!isHorizDock && (savedCompact || (savedW && parseInt(savedW) <= 70))) ? ' compact' : '';
  return `
  <div class="shell dock-${dockSide}" id="shell">
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <nav class="sidebar${sidebarCompactClass}" id="sidebar" ${sidebarStyle}>
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
        const curSide = getCurrentDockSide();
        if (curSide === 'left' || curSide === 'right') {
          const w = Math.round(sidebar.getBoundingClientRect().width);
          localStorage.setItem('mac_sidebar_width', w);
          localStorage.setItem('mac_sidebar_compact', sidebar.classList.contains('compact') ? '1' : '0');
        } else {
          const h = Math.round(sidebar.getBoundingClientRect().height);
          localStorage.setItem('mac_sidebar_height', h);
        }
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
          localStorage.setItem('mac_sidebar_width', '52');
          localStorage.setItem('mac_sidebar_compact', '1');
        } else {
          sidebar.style.width = '230px';
          sidebar.classList.remove('compact');
          localStorage.setItem('mac_sidebar_width', '230');
          localStorage.setItem('mac_sidebar_compact', '0');
        }
      } else {
        const h = sidebar.getBoundingClientRect().height;
        const newH = h > 60 ? '42' : '120';
        sidebar.style.height = newH + 'px';
        localStorage.setItem('mac_sidebar_height', newH);
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
    localStorage.removeItem('mac_sidebar_width');
    localStorage.removeItem('mac_sidebar_height');
    localStorage.removeItem('mac_sidebar_compact');
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
