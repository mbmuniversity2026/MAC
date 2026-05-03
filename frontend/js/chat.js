function chatEmptyHtml() {
  return `<div class="chat-empty">
    <div class="chat-empty-hero">
      <div class="mac-glitch-logo"><span class="glitch" data-text="MAC">MAC</span></div>
      <div class="ctl-typewriter" id="ctl-typewriter"></div>
      <canvas class="ctl-dust-canvas" id="ctl-dust-canvas" aria-hidden="true"></canvas>
    </div>
  </div>`;
}

function startTypewriter() {
  const el = document.getElementById('ctl-typewriter');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('ctl-done');
  const text = 'Cross the Limits';
  let i = 0;
  el.classList.add('typing');
  function type() {
    if (i < text.length) {
      el.textContent += text[i];
      i++;
      setTimeout(type, 60 + Math.random() * 40);
    } else {
      el.classList.remove('typing');
      el.classList.add('ctl-done');
      // Attach dust disintegration handler once typing is done
      bindCursorDust(el);
    }
  }
  setTimeout(type, 400);
}

function bindCursorDust(el) {
  if (el._dustBound) return;
  el._dustBound = true;
  function triggerDust(e) {
    if (!el.classList.contains('ctl-done')) return;
    e.stopPropagation();
    const canvas = document.getElementById('ctl-dust-canvas');
    if (!canvas) return;
    const rect = el.getBoundingClientRect();
    canvas.width = rect.width + 80;
    canvas.height = rect.height + 80;
    canvas.style.left = (rect.left - 40) + 'px';
    canvas.style.top = (rect.top - 40) + 'px';
    const ctx = canvas.getContext('2d');
    // Sample pixels from el via offscreen canvas
    const off = document.createElement('canvas');
    off.width = Math.ceil(rect.width);
    off.height = Math.ceil(rect.height);
    const octx = off.getContext('2d');
    const cs = getComputedStyle(el);
    octx.font = cs.font;
    octx.fillStyle = cs.color || '#555';
    octx.textBaseline = 'top';
    octx.fillText(el.textContent, 0, 0);
    const imgData = octx.getImageData(0, 0, off.width, off.height);
    const px = imgData.data;
    // Collect non-transparent pixels as dust particles
    const dust = [];
    const step = 3;
    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        const idx = (y * off.width + x) * 4;
        if (px[idx + 3] > 60) {
          dust.push({
            x: x + 40, y: y + 40,
            ox: x + 40, oy: y + 40,
            vx: (Math.random() - 0.4) * 4 + 1,
            vy: (Math.random() - 0.7) * 5 - 1,
            r: `${px[idx]},${px[idx+1]},${px[idx+2]}`,
            alpha: 1,
            size: Math.random() * 2 + 1,
            life: 0.9 + Math.random() * 0.4,
          });
        }
      }
    }
    if (!dust.length) return;
    // Hide the text element
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.05s';
    canvas.style.display = 'block';
    let raf;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      for (const p of dust) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;       // gravity
        p.vx *= 0.97;       // drag
        p.alpha -= 0.022;
        if (p.alpha > 0) {
          alive++;
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = `rgb(${p.r})`;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
      ctx.globalAlpha = 1;
      if (alive > 0) {
        raf = requestAnimationFrame(animate);
      } else {
        canvas.style.display = 'none';
        // Re-type after dust settles
        setTimeout(() => {
          el.style.opacity = '';
          el.style.transition = '';
          el._dustBound = false;
          startTypewriter();
        }, 400);
      }
    }
    cancelAnimationFrame(raf);
    animate();
  }
  el.addEventListener('click', triggerDust);
  el.addEventListener('touchstart', triggerDust, { passive: false });
}
function bindChatChips() {
  startTypewriter();
}

function renderChat() {
  const el = document.getElementById('page-content');
  el.className = 'page page-chat';
  const sessions = getSessions();
  el.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sessions" id="chat-sidebar">
        <div class="chat-sessions-header">
          <h3>Sessions</h3>
          <button class="btn btn-sm btn-outline" id="new-chat-btn">+ New</button>
        </div>
        <div class="session-list" id="session-list">
          ${sessions.map(s => sessionItem(s)).join('')}
        </div>
      </div>
      <div class="chat-resize-handle" id="chat-resize-handle"></div>
      <div class="chat-main">
        <div class="chat-messages" id="chat-messages">
          ${chatEmptyHtml()}
        </div>
        <div class="chat-input-wrap">
          <div class="chat-input-box">
            <textarea id="chat-input" placeholder="Message MAC..." rows="1"></textarea>
            <div class="chat-input-actions">
              <div class="chat-input-left">
                <select id="model-select" class="model-pill"><option value="auto" selected>Auto</option></select>
                <button class="chat-btn-icon" id="attach-btn" title="Attach document (PDF, TXT, DOCX) for RAG context">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <input type="file" id="attach-file" accept=".pdf,.txt,.md,.docx,.doc,.csv,.json" style="display:none">
                <span id="attach-name" style="font-size:.72rem;color:var(--accent);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none"></span>
                <button class="chat-btn-icon" id="stt-btn" title="Upload audio to transcribe (Whisper STT)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                </button>
                <input type="file" id="stt-file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.webm" style="display:none">
                <button class="chat-btn-icon voice-btn" id="voice-chat-btn" title="Voice Chat — speak with MAC" style="color:var(--accent);position:relative">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                  <span style="position:absolute;top:-3px;right:-3px;width:7px;height:7px;background:var(--accent);border-radius:50%;display:none" id="voice-live-dot"></span>
                </button>
              </div>
              <div class="chat-input-right">
                <span id="chat-status" class="chat-status-text"></span>
                <span id="active-model-badge" class="active-model-badge"></span>
                <button class="send-btn" id="send-btn" title="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  bindChat();
  bindChatChips();
  // Always restore the last active session (fixes blank-state / session-merge bug)
  const _restoreId = currentSession?.id || userGet('last_chat_session', null) || sessions[0]?.id;
  if (_restoreId) loadSession(_restoreId);
}

function sessionItem(s) {
  const active = currentSession && currentSession.id === s.id;
  return `<div class="session-item ${active ? 'active' : ''}" data-id="${s.id}">
    <span>${esc(s.title || 'New Chat')}</span>
    <span class="del" data-del="${s.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
  </div>`;
}

function bindChat() {
  document.getElementById('new-chat-btn').onclick = newChat;
  document.getElementById('send-btn').onclick = sendMessage;
  const input = document.getElementById('chat-input');
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };

  // Attach file: PDF/TXT/DOCX for RAG context injection
  let _attachedFile = null;
  const attachBtn = document.getElementById('attach-btn');
  const attachInput = document.getElementById('attach-file');
  const attachName = document.getElementById('attach-name');
  if (attachBtn && attachInput) {
    attachBtn.onclick = () => attachInput.click();
    attachInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      attachInput.value = '';
      if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10 MB)', 'error'); return; }
      _attachedFile = file;
      attachName.textContent = file.name;
      attachName.style.display = '';
      // Upload to RAG for context
      const status = document.getElementById('chat-status');
      if (status) status.textContent = 'Uploading...';
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        fd.append('collection', 'chat-context');
        const res = await fetch(`${API}/rag/ingest`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` },
          body: fd,
        });
        if (!res.ok) throw new Error('Upload failed');
        if (status) status.textContent = 'File ready';
        setTimeout(() => { const s = document.getElementById('chat-status'); if (s) s.textContent = ''; }, 2000);
      } catch {
        if (status) status.textContent = 'Upload failed';
        setTimeout(() => { const s = document.getElementById('chat-status'); if (s) s.textContent = ''; }, 3000);
      }
    };
    // Allow dismissing attachment
    attachName.onclick = () => { _attachedFile = null; attachName.style.display = 'none'; attachName.textContent = ''; };
  }

  // STT: upload audio file &rarr; transcribe via Whisper
  const sttBtn = document.getElementById('stt-btn');
  const sttFile = document.getElementById('stt-file');
  if (sttBtn && sttFile) {
    sttBtn.onclick = () => sttFile.click();
    sttFile.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      sttFile.value = '';
      const fd = new FormData();
      fd.append('audio', file);
      const status = document.getElementById('chat-status');
      status.textContent = 'Transcribing...';
      sttBtn.disabled = true;
      try {
        const res = await fetch('/api/v1/query/speech-to-text', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` },
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail?.message || data.detail || 'Transcription failed');
        const inp = document.getElementById('chat-input');
        inp.value = (inp.value ? inp.value + ' ' : '') + data.text;
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
        inp.focus();
        status.textContent = '';
      } catch (err) {
        status.textContent = 'STT: ' + err.message;
        setTimeout(() => { const s = document.getElementById('chat-status'); if (s) s.textContent = ''; }, 4000);
      }
      sttBtn.disabled = false;
    };
  }

  // TTS: speaker button on assistant messages (event delegation)
  document.getElementById('chat-messages').addEventListener('click', async (e) => {
    const btn = e.target.closest('.tts-btn');
    if (!btn) return;
    const msgEl = btn.closest('[data-msg-index]');
    if (!msgEl || !currentSession) return;
    const idx = parseInt(msgEl.dataset.msgIndex);
    const text = currentSession.messages[idx]?.content;
    if (text) await playTTS(text, btn);
  });
  document.getElementById('session-list').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { deleteSession(del.dataset.del); return; }
    const item = e.target.closest('.session-item');
    if (item) loadSession(item.dataset.id);
  };
  // Resizable session sidebar (VS Code style drag handle)
  const handle = document.getElementById('chat-resize-handle');
  const sidebar = document.getElementById('chat-sidebar');
  if (handle && sidebar) {
    let startX, startW;
    handle.onmousedown = (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        let w = startW + (ev.clientX - startX);
        if (w < 60) w = 0; // snap to collapsed
        else if (w < 140) w = 140; // minimum usable
        else if (w > 500) w = 500; // max
        sidebar.style.width = w + 'px';
        sidebar.classList.toggle('collapsed', w === 0);
        handle.classList.toggle('collapsed', w === 0);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    // Double-click to toggle collapse/expand
    handle.ondblclick = () => {
      const w = sidebar.getBoundingClientRect().width;
      if (w < 10) {
        sidebar.style.width = '240px';
        sidebar.classList.remove('collapsed');
        handle.classList.remove('collapsed');
      } else {
        sidebar.style.width = '0px';
        sidebar.classList.add('collapsed');
        handle.classList.add('collapsed');
      }
    };
  }
  loadModelOptions();
  loadActiveModelBadge();

  // Voice chat button
  const voiceBtn = document.getElementById('voice-chat-btn');
  if (voiceBtn) voiceBtn.onclick = openVoiceChat;
}

async function loadModelOptions() {
  const sel = document.getElementById('model-select');
  try {
    const resp = await fetch(API + '/explore/models?model_type=chat&per_page=50');
    if (!resp.ok) return;
    const data = await resp.json();
    (data.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name + (m.parameters ? ' (' + m.parameters + ')' : '');
      sel.appendChild(opt);
    });
  } catch (e) { /* API offline "" auto option is enough */ }
  if (currentSession && currentSession.model) sel.value = currentSession.model;
}

async function loadActiveModelBadge() {
  const badge = document.getElementById('active-model-badge');
  if (!badge) return;
  try {
    const res = await fetch('/api/v1/explore/health');
    if (!res.ok) { badge.innerHTML = '<span class="model-dot model-dot-off"></span> Offline'; return; }
    const data = await res.json();
    const models = (data.nodes || []).flatMap(n => n.models_loaded || []);
    if (models.length > 0) {
      badge.innerHTML = '<span class="model-dot model-dot-on"></span> ' + esc(shortModel(models[0]));
      badge.title = 'Running: ' + models.join(', ');
    } else {
      badge.innerHTML = '<span class="model-dot model-dot-off"></span> No model';
    }
  } catch { badge.innerHTML = '<span class="model-dot model-dot-off"></span> Offline'; }
}

function newChat() {
  const id = 'chat-' + Date.now();
  const session = { id, title: 'New Chat', messages: [], model: 'auto', created: new Date().toISOString() };
  const sessions = getSessions();
  sessions.unshift(session);
  saveSessions(sessions);
  currentSession = session;
  renderChat(); // loadSession called inside renderChat with restored currentSession
}

function loadSession(id) {
  const s = getSession(id);
  if (!s) return;
  currentSession = s;
  userSet('last_chat_session', id); // persist for reload
  document.querySelectorAll('.session-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  const msgs = document.getElementById('chat-messages');
  if (s.messages.length === 0) {
    msgs.innerHTML = chatEmptyHtml();
    startTypewriter();
  } else {
    msgs.innerHTML = s.messages.map((m, i) => {
      if (m.role === 'assistant') {
        return `<div class="msg msg-assistant" data-msg-index="${i}">${formatMd(m.content)}<div class="msg-meta"><button class="tts-btn" title="Listen to this response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button></div></div>`;
      }
      return `<div class="msg msg-user">${esc(m.content)}</div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
  }
  if (s.model) document.getElementById('model-select').value = s.model;
}

function deleteSession(id) {
  saveSessions(getSessions().filter(s => s.id !== id));
  if (currentSession && currentSession.id === id) currentSession = null;
  renderChat();
}

async function sendMessage() {
  if (isStreaming) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!currentSession) newChat();
  const model = document.getElementById('model-select').value;
  currentSession.model = model;

  currentSession.messages.push({ role: 'user', content: text });
  if (currentSession.title === 'New Chat') currentSession.title = text.slice(0, 40);
  persistSession();

  const msgs = document.getElementById('chat-messages');
  const emptyEl = msgs.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();
  msgs.innerHTML += `<div class="msg msg-user">${esc(text)}</div>`;
  input.value = ''; input.style.height = 'auto';

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'msg msg-assistant';
  assistantDiv.innerHTML = macThinkingHTML();
  msgs.appendChild(assistantDiv);
  msgs.scrollTop = msgs.scrollHeight;
  startMacThinking(assistantDiv);

  const status = document.getElementById('chat-status');
  status.textContent = 'Generating...';
  isStreaming = true;

  try {
    const apiMessages = currentSession.messages.map(m => ({ role: m.role, content: m.content }));
    const res = await api('/query/chat', { method: 'POST', body: JSON.stringify({ messages: apiMessages, model, stream: true }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.detail?.message || 'Request failed'); }

    let fullContent = '';
    stopMacThinking(assistantDiv);
    assistantDiv.textContent = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamError = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            if (chunk.error) throw new Error(chunk.error.message);
            const delta = chunk.choices?.[0]?.delta?.content || '';
            if (delta) { fullContent += delta; assistantDiv.innerHTML = formatMd(fullContent); msgs.scrollTop = msgs.scrollHeight; }
          } catch (parseErr) { if (parseErr.message.includes('Backend') || parseErr.message.includes('model')) throw parseErr; }
        }
      }
    } catch (streamErr) {
      streamError = streamErr;
    }
    if (fullContent) {
      currentSession.messages.push({ role: 'assistant', content: fullContent });
      persistSession();
      const usedModel = model === 'auto' ? 'Qwen2.5-7B-AWQ' : shortModel(model);
      const msgIdx = currentSession.messages.length - 1;
      assistantDiv.dataset.msgIndex = msgIdx;
      assistantDiv.innerHTML = formatMd(fullContent) + `<div class="msg-meta"><div class="msg-model-tag">answered by ${esc(usedModel)}</div><button class="tts-btn" title="Listen to this response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button></div>`;
    } else if (streamError) {
      throw streamError;
    } else {
      fullContent = '(No response)';
      currentSession.messages.push({ role: 'assistant', content: fullContent });
      persistSession();
      assistantDiv.innerHTML = formatMd(fullContent);
    }
  } catch (err) {
    stopMacThinking(assistantDiv);
    assistantDiv.innerHTML = `<span style="color:var(--danger)">Error: ${esc(err.message)}</span>`;
    currentSession.messages.push({ role: 'assistant', content: `Error: ${err.message}` });
    persistSession();
  }
  isStreaming = false;
  status.textContent = '';
  msgs.scrollTop = msgs.scrollHeight;
  const titleEl = document.querySelector(`.session-item[data-id="${currentSession.id}"] span:first-child`);
  if (titleEl) titleEl.textContent = currentSession.title;
}

function persistSession() {
  let sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === currentSession.id);
  if (idx >= 0) sessions[idx] = currentSession; else sessions.unshift(currentSession);
  saveSessions(sessions);
}

/* Text-to-Speech: play an assistant message via piper TTS */
async function playTTS(text, btn) {
  if (!btn || btn._ttsPlaying) return;
  btn._ttsPlaying = true;
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="10 15 15 12 10 9 10 15"/></svg>';
  btn.title = 'Generating audio...';
  try {
    const res = await api('/query/text-to-speech', {
      method: 'POST',
      body: JSON.stringify({ text: text.slice(0, 4000), voice: 'default', speed: 1.0, response_format: 'mp3' }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail?.message || 'TTS unavailable');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    btn.title = 'Playing... (click to stop)';
    btn.onclick = (e) => { e.stopPropagation(); audio.pause(); };
    audio.onended = () => { btn.innerHTML = origHTML; btn.title = 'Listen to this response'; btn._ttsPlaying = false; URL.revokeObjectURL(url); btn.onclick = null; };
    audio.onerror = () => { btn.innerHTML = origHTML; btn.title = 'Listen to this response'; btn._ttsPlaying = false; URL.revokeObjectURL(url); btn.onclick = null; };
    await audio.play();
  } catch (err) {
    btn.innerHTML = origHTML;
    btn.title = err.message || 'TTS failed';
    btn._ttsPlaying = false;
    setTimeout(() => { if (btn) btn.title = 'Listen to this response'; }, 3000);
  }
}

/* 
   AGENT MODE "" Plan-and-Execute with Streaming Steps
    */
async function sendAgentMessage(query) {
  const input = document.getElementById('chat-input');
  if (!currentSession) newChat();
  currentSession.messages.push({ role: 'user', content: query });
  if (currentSession.title === 'New Chat') currentSession.title = '[Agent] ' + query.slice(0, 35);
  persistSession();

  const msgs = document.getElementById('chat-messages');
  const emptyEl = msgs.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();
  msgs.innerHTML += `<div class="msg msg-user">${esc(query)}</div>`;
  input.value = ''; input.style.height = 'auto';

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'msg msg-assistant';
  assistantDiv.innerHTML = macThinkingHTML();
  msgs.appendChild(assistantDiv);
  msgs.scrollTop = msgs.scrollHeight;
  startMacThinking(assistantDiv);

  const status = document.getElementById('chat-status');
  status.textContent = 'Agent working...';
  isStreaming = true;

  try {
    const res = await api('/agent/run', { method: 'POST', body: JSON.stringify({ query }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.detail?.message || 'Agent failed'); }

    let stepsHtml = '';
    let finalAnswer = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          const evtType = evt.event || evt.type;
          if (evtType === 'plan') {
            stopMacThinking(assistantDiv);
            const steps = evt.plan || evt.steps || [];
            stepsHtml = '<div style="margin-bottom:12px;font-weight:700;font-size:.82rem">Plan:</div>';
            steps.forEach((s, i) => {
              const title = typeof s === 'string' ? s : (s.title || s.description || `Step ${i+1}`);
              stepsHtml += `<div class="agent-step" id="agent-step-${i}"><div class="agent-step-title">Step ${i + 1}: ${esc(title)}</div></div>`;
            });
            assistantDiv.innerHTML = stepsHtml;
          } else if (evtType === 'step_start') {
            const si = (evt.step_index !== undefined ? evt.step_index : (evt.step ? evt.step - 1 : 0));
            const stepEl = document.getElementById('agent-step-' + si);
            if (stepEl) stepEl.classList.add('running');
            status.textContent = 'Step ' + (si + 1) + '...';
          } else if (evtType === 'step_complete' || evtType === 'step_result' || evtType === 'tool_result') {
            const si = (evt.step_index !== undefined ? evt.step_index : (evt.step ? evt.step - 1 : 0));
            const stepEl = document.getElementById('agent-step-' + si);
            if (stepEl) {
              stepEl.classList.remove('running');
              stepEl.classList.add('done');
              const output = evt.output || (evt.result && JSON.stringify(evt.result).slice(0, 500));
              if (output) stepEl.innerHTML += `<div class="agent-step-output">${esc(String(output).slice(0, 500))}</div>`;
            }
          } else if (evtType === 'complete') {
            finalAnswer = evt.response || evt.content || '';
          } else if (evtType === 'answer') {
            finalAnswer = evt.content || evt.response || '';
          } else if (evtType === 'error') {
            stopMacThinking(assistantDiv);
            assistantDiv.innerHTML += `<div style="color:var(--danger);margin-top:8px;font-size:.85rem">Error: ${esc(evt.message || 'Unknown error')}</div>`;
          }
        } catch {}
      }
      msgs.scrollTop = msgs.scrollHeight;
    }

    if (finalAnswer) {
      assistantDiv.innerHTML += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">${formatMd(finalAnswer)}</div>`;
      currentSession.messages.push({ role: 'assistant', content: finalAnswer });
      persistSession();
    }
  } catch (ex) {
    stopMacThinking(assistantDiv);
    assistantDiv.innerHTML = `<div style="color:var(--danger)">Agent error: ${esc(ex.message)}</div>`;
  }

  status.textContent = '';
  isStreaming = false;
  msgs.scrollTop = msgs.scrollHeight;
}

// ─────────────────────────────────────────────────────────
//  VOICE CHAT — WebSocket voice-to-voice pipeline
// ─────────────────────────────────────────────────────────
let _voiceWs = null;
let _voiceMediaRecorder = null;
let _voiceAudioCtx = null;
let _voiceAudioQueue = [];
let _voicePlaying = false;
let _voiceTranscript = [];

function _voiceWaveAnim(canvasId, stream) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const analyser = (_voiceAudioCtx || (window.AudioContext || window.webkitAudioContext) && new AudioContext()).createAnalyser();
  analyser.fftSize = 64;
  const src = analyser.context.createMediaStreamSource(stream);
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf;
  function draw() {
    raf = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width / data.length;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4834a';
    data.forEach((v, i) => {
      const h = (v / 255) * canvas.height;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(i * w, canvas.height - h, w - 2, h);
    });
    ctx.globalAlpha = 1;
  }
  draw();
  return { stop: () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, canvas.width, canvas.height); } };
}

async function _voicePlayChunk(base64Audio) {
  _voiceAudioQueue.push(base64Audio);
  if (_voicePlaying) return;
  _voicePlaying = true;
  while (_voiceAudioQueue.length) {
    const chunk = _voiceAudioQueue.shift();
    try {
      const bytes = Uint8Array.from(atob(chunk), c => c.charCodeAt(0));
      const audioCtx = _voiceAudioCtx || (_voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)());
      const buf = await audioCtx.decodeAudioData(bytes.buffer.slice());
      await new Promise(resolve => {
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        src.onended = resolve;
        src.start();
      });
    } catch (e) {
      console.warn('[Voice] Audio decode error:', e);
    }
  }
  _voicePlaying = false;
}

function _voiceSetStatus(text, overlay) {
  const el = (overlay || document).getElementById('voice-status-text');
  if (el) el.textContent = text;
}

function openVoiceChat() {
  if (document.getElementById('voice-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'voice-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9000;background:rgba(10,8,6,.96);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:var(--font);color:var(--text);
  `;
  overlay.innerHTML = `
    <div style="text-align:center;max-width:480px;width:100%;padding:24px">
      <div style="font-size:1.1rem;font-weight:700;color:var(--accent);margin-bottom:4px">Voice Chat</div>
      <div id="voice-status-text" style="font-size:.85rem;color:var(--muted);margin-bottom:20px;min-height:1.2em">Connecting...</div>
      <canvas id="voice-wave-canvas" width="320" height="60" style="width:100%;max-width:320px;border-radius:8px;background:rgba(255,255,255,.04);margin-bottom:20px"></canvas>
      <div id="voice-transcript-area" style="width:100%;max-height:240px;overflow-y:auto;text-align:left;padding:8px 12px;background:rgba(255,255,255,.04);border-radius:10px;font-size:.82rem;line-height:1.6;margin-bottom:20px;min-height:48px">
        <span style="color:var(--muted);font-style:italic">Your conversation will appear here...</span>
      </div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button id="voice-mute-btn" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:.85rem">🎙 Mute</button>
        <button id="voice-end-btn" style="padding:10px 20px;border-radius:8px;border:none;background:var(--danger,#dc2626);color:#fff;cursor:pointer;font-size:.85rem;font-weight:600">End Voice Chat</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let waveController = null;
  let muted = false;
  let accLlm = '';

  // End button
  overlay.querySelector('#voice-end-btn').onclick = closeVoiceChat;
  // Mute button
  overlay.querySelector('#voice-mute-btn').onclick = () => {
    muted = !muted;
    if (_voiceMediaRecorder && _voiceMediaRecorder.stream) {
      _voiceMediaRecorder.stream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    }
    overlay.querySelector('#voice-mute-btn').textContent = muted ? '🔇 Unmute' : '🎙 Mute';
  };

  const transcriptArea = overlay.querySelector('#voice-transcript-area');
  function appendTranscript(role, text) {
    if (!text.trim()) return;
    const div = document.createElement('div');
    div.style.cssText = `margin:4px 0;padding:4px 8px;border-radius:6px;background:${role==='user'?'rgba(212,131,74,.15)':'rgba(255,255,255,.06)'}`;
    div.innerHTML = `<b style="color:${role==='user'?'var(--accent)':'var(--text)'}">${role==='user'?'You':'MAC'}:</b> ${esc(text)}`;
    if (transcriptArea.querySelector('span')) transcriptArea.innerHTML = '';
    transcriptArea.appendChild(div);
    transcriptArea.scrollTop = transcriptArea.scrollHeight;
    // Also add to text chat transcript
    _voiceTranscript.push({ role, content: text });
  }

  // Connect WebSocket
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProto}://${location.host}/api/v1/voice/stream?token=${state.token || ''}`;
  const ws = new WebSocket(wsUrl);
  _voiceWs = ws;

  ws.onopen = async () => {
    _voiceSetStatus('Listening — speak now', overlay);
    ws.send(JSON.stringify({ type: 'start' }));

    // Start mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      waveController = _voiceWaveAnim('voice-wave-canvas', stream);

      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      _voiceMediaRecorder = mr;
      mr.ondataavailable = e => {
        if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          e.data.arrayBuffer().then(buf => ws.send(buf));
        }
      };
      mr.start(200); // send chunks every 200ms for low-latency VAD
    } catch (err) {
      _voiceSetStatus('Mic access denied', overlay);
    }
  };

  ws.onmessage = async e => {
    try {
      const frame = JSON.parse(e.data);
      if (frame.type === 'transcript') {
        _voiceSetStatus('Processing...', overlay);
        appendTranscript('user', frame.text);
        accLlm = '';
      } else if (frame.type === 'llm_chunk') {
        accLlm += frame.text;
        _voiceSetStatus('MAC is responding...', overlay);
      } else if (frame.type === 'audio_chunk') {
        _voiceSetStatus('Speaking...', overlay);
        await _voicePlayChunk(frame.data);
      } else if (frame.type === 'done') {
        if (accLlm) appendTranscript('assistant', accLlm);
        accLlm = '';
        _voiceSetStatus('Listening — speak now', overlay);
      } else if (frame.type === 'error') {
        _voiceSetStatus('Error: ' + frame.message, overlay);
      }
    } catch {}
  };

  ws.onerror = () => _voiceSetStatus('Connection error', overlay);
  ws.onclose = () => {
    _voiceSetStatus('Disconnected', overlay);
    if (waveController) waveController.stop();
    if (_voiceMediaRecorder) { try { _voiceMediaRecorder.stop(); } catch {} }
  };

  // Live dot on button
  const liveDot = document.getElementById('voice-live-dot');
  if (liveDot) liveDot.style.display = '';
}

function closeVoiceChat() {
  const overlay = document.getElementById('voice-overlay');
  if (overlay) overlay.remove();
  if (_voiceWs) { try { _voiceWs.close(); } catch {} _voiceWs = null; }
  if (_voiceMediaRecorder) { try { _voiceMediaRecorder.stop(); _voiceMediaRecorder.stream.getTracks().forEach(t => t.stop()); } catch {} _voiceMediaRecorder = null; }
  _voiceAudioQueue = [];
  _voicePlaying = false;
  const liveDot = document.getElementById('voice-live-dot');
  if (liveDot) liveDot.style.display = 'none';

  // If there's transcript, add it to the text chat as a summary
  if (_voiceTranscript.length) {
    _voiceTranscript.forEach(m => {
      if (currentSession) currentSession.messages.push(m);
    });
    _voiceTranscript = [];
    persistSession();
    renderMessages();
  }
}

/*
   ADMIN PANEL "" Full Control Dashboard
    */
let adminTab = localStorage.getItem('mac_admin_tab') || 'overview';

