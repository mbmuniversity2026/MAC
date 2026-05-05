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

  const modelSel = document.getElementById('model-select');
  if (modelSel) modelSel.addEventListener('change', () => _updateModelBadge(true));

  // Voice chat button
  const voiceBtn = document.getElementById('voice-chat-btn');
  if (voiceBtn) voiceBtn.onclick = openVoiceChat;
}

let _modelDisplayMap = {}; // model-id → served_name for badge display

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
      _modelDisplayMap[m.id] = m.served_name || m.name;
      sel.appendChild(opt);
    });
  } catch (e) { /* API offline — auto option is enough */ }
  if (currentSession && currentSession.model) sel.value = currentSession.model;
  _updateModelBadge();
}

function _updateModelBadge(online) {
  const badge = document.getElementById('active-model-badge');
  if (!badge) return;
  const sel = document.getElementById('model-select');
  const modelId = sel ? sel.value : 'auto';
  const served = _modelDisplayMap[modelId] || modelId;
  const dot = online === false ? 'model-dot-off' : 'model-dot-on';
  badge.innerHTML = `<span class="model-dot ${dot}"></span> ${esc(shortModel(served))}`;
  badge.title = served;
}

async function loadActiveModelBadge() {
  _updateModelBadge(true);
  try {
    const res = await fetch('/api/v1/explore/health');
    _updateModelBadge(res.ok);
  } catch { _updateModelBadge(false); }
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
let _voiceOrbRaf = null;
let _voiceTurnActive = false;
let _voiceLastSpeechAt = 0;
let _voiceLastStopSentAt = 0;

function _voiceInjectStyles() {
  if (document.getElementById('mac-voice-styles')) return;
  const s = document.createElement('style');
  s.id = 'mac-voice-styles';
  s.textContent = `
    #mac-voice-overlay{position:fixed;inset:0;z-index:9000;background:rgba(7,5,3,.97);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;font-family:var(--font);color:#f0ebe6}
    #mac-voice-panel{width:100%;max-width:420px;padding:36px 24px;display:flex;flex-direction:column;align-items:center}
    #mac-voice-orb-wrap{position:relative;width:200px;height:200px;margin-bottom:32px;display:flex;align-items:center;justify-content:center}
    #mac-voice-orb-glow{position:absolute;inset:-24px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(212,131,74,.18) 0%,transparent 68%);animation:mac-orb-glow 3s ease-in-out infinite;pointer-events:none}
    #mac-voice-orb{width:168px;height:168px;border-radius:50%;position:relative;background:radial-gradient(ellipse at 32% 28%,#f8d09a,#d4834a 38%,#9a3e0a 72%,#3a1204 100%);box-shadow:0 0 45px 18px rgba(212,131,74,.38),0 0 90px 35px rgba(180,70,15,.18),inset 0 8px 22px rgba(255,215,155,.28);transition:box-shadow .2s;cursor:default}
    #mac-voice-orb .orb-gloss{position:absolute;width:52%;height:40%;top:11%;left:13%;background:radial-gradient(ellipse at center,rgba(255,255,255,.38) 0%,transparent 72%);border-radius:50%;pointer-events:none}
    #mac-voice-orb.connecting{animation:mac-orb-pulse 2s ease-in-out infinite;background:radial-gradient(ellipse at 32% 28%,#dbc88a,#a07828 42%,#5a3a10 76%,#1e0e04 100%);box-shadow:0 0 28px 10px rgba(170,120,50,.3),0 0 55px 20px rgba(120,80,20,.12),inset 0 5px 16px rgba(210,180,100,.18)}
    #mac-voice-orb.listening{animation:mac-orb-listen 1.7s ease-in-out infinite}
    #mac-voice-orb.processing{animation:mac-orb-think 1.1s linear infinite}
    #mac-voice-orb.speaking{animation:mac-orb-speak 0.55s ease-in-out infinite;background:radial-gradient(ellipse at 32% 28%,#ffe4b8,#f09050 34%,#c03808 66%,#4a1000 100%);box-shadow:0 0 65px 28px rgba(240,130,60,.55),0 0 130px 55px rgba(200,70,10,.25),inset 0 8px 24px rgba(255,225,165,.38)}
    @keyframes mac-orb-glow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.95;transform:scale(1.18)}}
    @keyframes mac-orb-pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.07);opacity:1}}
    @keyframes mac-orb-listen{0%,100%{border-radius:50%;transform:scale(1);filter:brightness(1.05)}20%{border-radius:56% 44% 52% 48%/48% 56% 44% 52%;transform:scale(1.07);filter:brightness(1.18)}40%{border-radius:44% 56% 48% 52%/52% 44% 56% 48%;transform:scale(.97);filter:brightness(1.08)}60%{border-radius:52% 48% 58% 42%/42% 54% 46% 58%;transform:scale(1.08);filter:brightness(1.2)}80%{border-radius:48% 52% 44% 56%/56% 46% 54% 44%;transform:scale(.96);filter:brightness(1.1)}}
    @keyframes mac-orb-think{0%{filter:brightness(1.1) hue-rotate(0deg);border-radius:50%}33%{filter:brightness(1.28) hue-rotate(18deg);border-radius:55% 45% 50% 50%/50% 50% 55% 45%}66%{filter:brightness(1.15) hue-rotate(-18deg);border-radius:45% 55% 50% 50%/50% 50% 45% 55%}100%{filter:brightness(1.1) hue-rotate(0deg);border-radius:50%}}
    @keyframes mac-orb-speak{0%,100%{transform:scale(1.03);border-radius:50%;filter:brightness(1.22)}25%{border-radius:57% 43% 50% 50%/50% 50% 60% 40%;transform:scale(1.12);filter:brightness(1.38)}75%{border-radius:43% 57% 50% 50%/50% 50% 40% 60%;transform:scale(1.07);filter:brightness(1.3)}}
    #mac-voice-title{font-size:.95rem;font-weight:700;color:var(--accent,#d4834a);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}
    #mac-voice-status{font-size:.82rem;color:rgba(240,235,230,.52);margin-bottom:22px;min-height:1.2em;text-align:center;transition:color .3s}
    #mac-voice-status.active{color:rgba(212,131,74,.85)}
    #mac-voice-transcript{width:100%;max-height:190px;overflow-y:auto;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:10px 14px;font-size:.79rem;line-height:1.65;margin-bottom:26px;min-height:52px;scrollbar-width:thin;scrollbar-color:rgba(212,131,74,.28) transparent}
    #mac-voice-transcript::-webkit-scrollbar{width:4px}
    #mac-voice-transcript::-webkit-scrollbar-thumb{background:rgba(212,131,74,.28);border-radius:2px}
    #mac-voice-controls{display:flex;gap:12px;justify-content:center}
    #mac-voice-mute{padding:10px 22px;border-radius:10px;border:1.5px solid rgba(212,131,74,.45);background:rgba(212,131,74,.1);color:var(--accent,#d4834a);cursor:pointer;font-size:.84rem;font-weight:600;display:flex;align-items:center;gap:7px;transition:background .2s,border-color .2s,transform .1s}
    #mac-voice-mute:hover{background:rgba(212,131,74,.22);border-color:rgba(212,131,74,.75);transform:translateY(-1px)}
    #mac-voice-mute.muted{background:rgba(212,131,74,.22);border-color:var(--accent,#d4834a)}
    #mac-voice-send{padding:10px 18px;border-radius:10px;border:1.5px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:rgba(240,235,230,.82);cursor:pointer;font-size:.84rem;font-weight:600;transition:background .2s,border-color .2s,transform .1s}
    #mac-voice-send:hover{background:rgba(255,255,255,.11);border-color:rgba(212,131,74,.45);transform:translateY(-1px)}
    #mac-voice-end{padding:10px 22px;border-radius:10px;border:none;background:linear-gradient(135deg,#b82020,#e03030);color:#fff;cursor:pointer;font-size:.84rem;font-weight:600;transition:opacity .2s,transform .1s;box-shadow:0 2px 14px rgba(200,30,30,.32)}
    #mac-voice-end:hover{opacity:.84;transform:translateY(-1px)}
    #mac-voice-httpsbar{margin-top:18px;padding:10px 16px;background:rgba(212,131,74,.1);border:1px solid rgba(212,131,74,.28);border-radius:10px;font-size:.75rem;color:rgba(240,235,230,.65);text-align:center;line-height:1.55;display:none}
    #mac-voice-httpsbar a{color:var(--accent,#d4834a);text-decoration:none}
    #mac-voice-httpsbar a:hover{text-decoration:underline}
  `;
  document.head.appendChild(s);
}

function _voiceSetState(state, msg) {
  const orb = document.getElementById('mac-voice-orb');
  if (orb) {
    orb.className = state;
    if (state !== 'listening') orb.style.transform = '';
  }
  const labels = {
    connecting: 'Connecting...',
    listening: 'Listening — speak now',
    processing: 'Thinking...',
    speaking: 'MAC is speaking...',
    error: 'Connection error',
    disconnected: 'Disconnected',
  };
  const el = document.getElementById('mac-voice-status');
  if (el) {
    el.textContent = msg || labels[state] || state;
    el.className = (state === 'listening' || state === 'speaking') ? 'active' : '';
  }
}

function _voiceStartOrbMic(stream) {
  try {
    const actx = _voiceAudioCtx || (_voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)());
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    const analyser = actx.createAnalyser();
    analyser.fftSize = 32;
    actx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const orb = document.getElementById('mac-voice-orb');
    function tick() {
      _voiceOrbRaf = requestAnimationFrame(tick);
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      if (orb && orb.className === 'listening') {
        const s = 1 + (avg / 255) * 0.32;
        orb.style.transform = `scale(${s.toFixed(3)})`;
      }
      const now = Date.now();
      const isSpeech = avg > 12;
      if (isSpeech) {
        _voiceTurnActive = true;
        _voiceLastSpeechAt = now;
      } else if (_voiceTurnActive && now - _voiceLastSpeechAt > 950) {
        _voiceTurnActive = false;
        if (_voiceWs && _voiceWs.readyState === WebSocket.OPEN && now - _voiceLastStopSentAt > 1100) {
          _voiceLastStopSentAt = now;
          _voiceWs.send(JSON.stringify({ type: 'stop' }));
          _voiceSetState('processing', 'Listening complete. Thinking...');
        }
      }
    }
    tick();
  } catch (_) {}
}

async function _voicePlayChunk(base64Audio) {
  _voiceAudioQueue.push(base64Audio);
  if (_voicePlaying) return;
  _voicePlaying = true;
  while (_voiceAudioQueue.length) {
    const chunk = _voiceAudioQueue.shift();
    try {
      const bytes = Uint8Array.from(atob(chunk), c => c.charCodeAt(0));
      const actx = _voiceAudioCtx || (_voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)());
      const buf = await actx.decodeAudioData(bytes.buffer.slice());
      await new Promise(resolve => {
        const src = actx.createBufferSource();
        src.buffer = buf;
        src.connect(actx.destination);
        src.onended = resolve;
        src.start();
      });
    } catch (e) { console.warn('[Voice] audio decode:', e); }
  }
  _voicePlaying = false;
}

function openVoiceChat() {
  if (document.getElementById('mac-voice-overlay')) return;
  _voiceInjectStyles();

  const overlay = document.createElement('div');
  overlay.id = 'mac-voice-overlay';
  overlay.innerHTML = `
    <div id="mac-voice-panel">
      <div id="mac-voice-orb-wrap">
        <div id="mac-voice-orb-glow"></div>
        <div id="mac-voice-orb" class="connecting">
          <div class="orb-gloss"></div>
        </div>
      </div>
      <div id="mac-voice-title">MAC Voice</div>
      <div id="mac-voice-status">Connecting...</div>
      <div id="mac-voice-transcript">
        <span style="color:rgba(240,235,230,.38);font-style:italic;font-size:.78rem">Your conversation will appear here...</span>
      </div>
      <div id="mac-voice-controls">
        <button id="mac-voice-mute">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          Mute
        </button>
        <button id="mac-voice-send">Send Now</button>
        <button id="mac-voice-end">End Voice Chat</button>
      </div>
      <div id="mac-voice-httpsbar">
        <strong style="color:var(--accent,#d4834a)">Mic is blocked by this browser context.</strong><br>
        Open MAC with <code>launch-mac-chrome.bat</code> on this PC, or use HTTPS from a trusted browser session.
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let muted = false;
  let accLlm = '';

  overlay.querySelector('#mac-voice-end').onclick = closeVoiceChat;
  overlay.querySelector('#mac-voice-send').onclick = () => {
    if (_voiceWs && _voiceWs.readyState === WebSocket.OPEN) {
      _voiceLastStopSentAt = Date.now();
      _voiceWs.send(JSON.stringify({ type: 'stop' }));
      _voiceSetState('processing', 'Thinking...');
    }
  };

  const muteBtn = overlay.querySelector('#mac-voice-mute');
  muteBtn.onclick = () => {
    muted = !muted;
    if (_voiceMediaRecorder && _voiceMediaRecorder.stream) {
      _voiceMediaRecorder.stream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    }
    muteBtn.classList.toggle('muted', muted);
    muteBtn.innerHTML = muted
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Unmute`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mute`;
  };

  function appendTranscript(role, text) {
    if (!text.trim()) return;
    const ta = document.getElementById('mac-voice-transcript');
    if (!ta) return;
    const div = document.createElement('div');
    div.style.cssText = `margin:7px 0;padding:7px 11px;border-radius:9px;` +
      (role === 'user'
        ? 'background:rgba(212,131,74,.13);border-left:2.5px solid rgba(212,131,74,.55)'
        : 'background:rgba(255,255,255,.05);border-left:2.5px solid rgba(255,255,255,.14)');
    div.innerHTML = `<div style="font-size:.68rem;font-weight:700;color:${role==='user'?'rgba(212,131,74,.85)':'rgba(240,235,230,.45)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${role==='user'?'You':'MAC'}</div>${esc(text)}`;
    const ph = ta.querySelector('span');
    if (ph) ta.innerHTML = '';
    ta.appendChild(div);
    ta.scrollTop = ta.scrollHeight;
    _voiceTranscript.push({ role, content: text });
  }

  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProto}://${location.host}/api/v1/voice/stream?token=${state.token || ''}`;
  const ws = new WebSocket(wsUrl);
  _voiceWs = ws;
  _voiceTurnActive = false;
  _voiceLastSpeechAt = 0;
  _voiceLastStopSentAt = 0;

  ws.onopen = async () => {
    ws.send(JSON.stringify({ type: 'start' }));

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.getElementById('mac-voice-httpsbar').style.display = 'block';
      _voiceSetState('error', 'Mic unavailable in this browser session');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (_voiceAudioCtx && _voiceAudioCtx.state === 'suspended') await _voiceAudioCtx.resume().catch(() => {});
      _voiceSetState('listening');
      _voiceStartOrbMic(stream);
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      _voiceMediaRecorder = mr;
      mr.ondataavailable = e => {
        if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN && (_voiceTurnActive || Date.now() - _voiceLastSpeechAt < 650)) {
          e.data.arrayBuffer().then(buf => ws.send(buf));
        }
      };
      mr.start(200);
    } catch (_) {
      document.getElementById('mac-voice-httpsbar').style.display = 'block';
      _voiceSetState('error', 'Mic access denied by browser');
    }
  };

  ws.onmessage = async e => {
    try {
      const frame = JSON.parse(e.data);
      if (frame.type === 'transcript') {
        _voiceSetState('processing');
        appendTranscript('user', frame.text);
        accLlm = '';
      } else if (frame.type === 'llm_chunk') {
        accLlm += frame.text;
      } else if (frame.type === 'audio_chunk') {
        _voiceSetState('speaking');
        await _voicePlayChunk(frame.data);
      } else if (frame.type === 'done') {
        if (accLlm) appendTranscript('assistant', accLlm);
        accLlm = '';
        _voiceSetState('listening');
      } else if (frame.type === 'info') {
        _voiceSetState(frame.state || 'listening', frame.message);
      } else if (frame.type === 'error') {
        _voiceSetState('error', 'Error: ' + frame.message);
      }
    } catch (_) {}
  };

  ws.onerror = () => _voiceSetState('error');
  ws.onclose = () => {
    if (_voiceOrbRaf) { cancelAnimationFrame(_voiceOrbRaf); _voiceOrbRaf = null; }
    if (_voiceMediaRecorder) { try { _voiceMediaRecorder.stop(); } catch (_) {} }
    const el = document.getElementById('mac-voice-status');
    if (el && !el.textContent.includes('HTTPS') && !el.textContent.includes('denied'))
      _voiceSetState('disconnected');
  };

  const liveDot = document.getElementById('voice-live-dot');
  if (liveDot) liveDot.style.display = '';
}

function closeVoiceChat() {
  const overlay = document.getElementById('mac-voice-overlay');
  if (overlay) overlay.remove();
  if (_voiceWs) { try { _voiceWs.close(); } catch (_) {} _voiceWs = null; }
  if (_voiceMediaRecorder) {
    try { _voiceMediaRecorder.stop(); _voiceMediaRecorder.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    _voiceMediaRecorder = null;
  }
  if (_voiceOrbRaf) { cancelAnimationFrame(_voiceOrbRaf); _voiceOrbRaf = null; }
  _voiceAudioQueue = [];
  _voicePlaying = false;
  _voiceTurnActive = false;
  _voiceLastSpeechAt = 0;
  _voiceLastStopSentAt = 0;
  const liveDot = document.getElementById('voice-live-dot');
  if (liveDot) liveDot.style.display = 'none';
  if (_voiceTranscript.length) {
    _voiceTranscript.forEach(m => { if (currentSession) currentSession.messages.push(m); });
    _voiceTranscript = [];
    persistSession();
    if (currentSession) loadSession(currentSession.id);
  }
}

/*
   ADMIN PANEL "" Full Control Dashboard
    */
let adminTab = localStorage.getItem('mac_admin_tab') || 'overview';

