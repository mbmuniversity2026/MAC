async function loadNotifCount() {
  try {
    const data = await apiJson('/notifications?per_page=1');
    const count = data.unread_count || 0;
    const badge = document.getElementById('notif-count');
    if (badge) badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
  } catch {}
}

async function loadNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-state" style="padding:20px"><div class="spinner"></div></div>';
  try {
    const data = await apiJson('/notifications?per_page=30');
    const notifs = data.notifications || [];
    if (notifs.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" ${n.link ? 'data-link="' + esc(n.link) + '"' : ''}>
        <div class="notif-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div class="notif-body">
          <span class="notif-title">${esc(n.title)}</span>
          <span class="notif-text">${esc(n.body || '')}</span>
          <span class="notif-time">${timeAgo(n.created_at)}</span>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.notif-item').forEach(item => {
      item.onclick = async () => {
        if (item.classList.contains('unread')) {
          try { await api('/notifications/' + item.dataset.id + '/read', { method: 'POST' }); item.classList.remove('unread'); loadNotifCount(); } catch {}
        }
        const link = item.dataset.link;
        if (link) { document.getElementById('notif-panel').classList.remove('open'); if (link.startsWith('#')) navigate(link.slice(1)); }
      };
    });
    loadNotifCount();
  } catch { list.innerHTML = '<div class="notif-empty">Failed to load</div>'; }
}

/* Push notification subscription */
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const vapidResp = await apiJson('/notifications/vapid-key').catch(() => null);
      if (!vapidResp || !vapidResp.public_key) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidResp.public_key),
      });
    }
    const key = sub.getKey('p256dh');
    const auth = sub.getKey('auth');
    await api('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh_key: key ? btoa(String.fromCharCode(...new Uint8Array(key))) : '',
        auth_key: auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
      }),
    });
  } catch {}
}

/* Request browser notification permission on every login */
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  try { await Notification.requestPermission(); } catch {}
}

/* Real-time notification polling "" updates badge every 15s */
function startNotifPolling() {
  if (_notifPollIv) clearInterval(_notifPollIv);
  loadNotifCount();
  _notifPollIv = setInterval(() => loadNotifCount(), 15000);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/* 
   CHART HELPERS
    */
