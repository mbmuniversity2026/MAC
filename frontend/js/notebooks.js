// ── Monaco Editor integration ─────────────────────────────────────────────────
let _nbEditors = {};        // cellId → monaco editor instance
let _monacoPromise = null;  // singleton load promise

function _getMonacoLang(lang) {
  const map = {
    python: 'python', javascript: 'javascript', typescript: 'typescript',
    c: 'c', cpp: 'cpp', java: 'java', go: 'go', rust: 'rust',
    csharp: 'csharp', ruby: 'ruby', php: 'php', lua: 'lua',
    bash: 'shell', sql: 'sql', html: 'html', css: 'css',
    kotlin: 'kotlin', scala: 'scala', swift: 'swift',
    r: 'r', julia: 'julia', markdown: 'markdown',
  };
  return map[lang] || 'plaintext';
}

function _loadMonaco() {
  if (_monacoPromise) return _monacoPromise;
  _monacoPromise = new Promise((resolve) => {
    if (window.monaco) { resolve(); return; }
    if (!window.require) {
      // AMD loader not available — fallback
      console.warn('[MAC] Monaco AMD loader not found. Using textarea fallback.');
      resolve();
      return;
    }
    require.config({ paths: { 'vs': '/static/libs/monaco-editor/min/vs' } });
    require(['vs/editor/editor.main'], () => resolve());
  });
  return _monacoPromise;
}

function _nbDisposeEditors() {
  for (const [id, ed] of Object.entries(_nbEditors)) {
    try { ed.dispose(); } catch (_) {}
  }
  _nbEditors = {};
}

function _nbDisposeEditor(cellId) {
  if (_nbEditors[cellId]) {
    try { _nbEditors[cellId].dispose(); } catch (_) {}
    delete _nbEditors[cellId];
  }
}

async function _nbInitMonacoEditors() {
  await _loadMonaco();
  if (!window.monaco) return; // fallback: textareas stay as-is

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const monacoTheme = isDark ? 'vs-dark' : 'vs';

  document.querySelectorAll('.nb-code-editor[data-cell]').forEach(textarea => {
    const cellId = textarea.dataset.cell;
    if (_nbEditors[cellId]) return; // already mounted

    const cell = _nbState.cells.find(c => c.id === cellId);
    if (!cell) return;

    const lineCount = Math.max(4, (cell.source || '').split('\n').length);

    // Build a container to replace the textarea
    const container = document.createElement('div');
    container.className = 'nb-monaco-container';
    container.dataset.cell = cellId;
    container.style.height = Math.max(96, lineCount * 20 + 24) + 'px';
    textarea.parentNode.replaceChild(container, textarea);

    const editor = monaco.editor.create(container, {
      value: cell.source || '',
      language: _getMonacoLang(cell.language || 'python'),
      theme: monacoTheme,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontLigatures: true,
      lineNumbers: 'on',
      glyphMargin: false,
      folding: true,
      lineDecorationsWidth: 4,
      lineNumbersMinChars: 3,
      roundedSelection: true,
      wordWrap: 'off',
      suggest: { showKeywords: true, showSnippets: true },
      quickSuggestions: { other: true, comments: false, strings: false },
      acceptSuggestionOnEnter: 'on',
      tabSize: 4,
      insertSpaces: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: { vertical: 'auto', horizontal: 'auto', alwaysConsumeMouseWheel: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      contextmenu: true,
    });

    // Sync content → state
    editor.onDidChangeModelContent(() => {
      const c = _nbState.cells.find(c => c.id === cellId);
      if (c) { c.source = editor.getValue(); _nbSave(); }
      // Auto-resize height
      const lines = editor.getModel().getLineCount();
      const newH = Math.max(96, lines * 20 + 24);
      container.style.height = newH + 'px';
      editor.layout();
    });

    // Shift+Enter → run cell
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      _nbExecCell(cellId);
    });

    // Ctrl+/ → toggle comment (built-in, but ensure it works)
    // Escape → blur editor
    editor.addCommand(monaco.KeyCode.Escape, () => {
      editor.blur();
    });

    _nbEditors[cellId] = editor;
  });
}

// ── Fullscreen cell overlay ────────────────────────────────────────────────────
function _nbOpenFullscreen(cellId) {
  const cell = _nbState.cells.find(c => c.id === cellId);
  if (!cell) return;

  const overlay = document.createElement('div');
  overlay.id = 'nb-fullscreen-overlay';
  overlay.className = 'nb-fs-overlay';

  const isCode = cell.type !== 'markdown';
  const lang = NB_LANGUAGES ? NB_LANGUAGES.find(l => l.id === (cell.language || 'python')) : null;
  const langName = lang ? lang.name : (cell.language || 'Python');

  overlay.innerHTML = `
    <div class="nb-fs-header">
      <div class="nb-fs-header-left">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <span class="nb-fs-title">${isCode ? langName + ' Cell' : 'Markdown Cell'}</span>
        ${isCode ? `<select class="nb-lang-select nb-fs-lang-select" id="nb-fs-lang">
          ${NB_LANGUAGES.map(l => `<option value="${l.id}" ${l.id === (cell.language || 'python') ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>` : ''}
      </div>
      <div class="nb-fs-header-right">
        ${isCode ? `<button class="btn btn-sm btn-primary nb-fs-run" id="nb-fs-run-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Run (Shift+Enter)
        </button>` : ''}
        <button class="icon-btn nb-fs-close" id="nb-fs-close-btn" title="Exit fullscreen (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="21" y2="3"/><line x1="3" y1="21" x2="14" y2="10"/></svg>
        </button>
      </div>
    </div>
    <div class="nb-fs-body" id="nb-fs-body">
      ${isCode
        ? `<div class="nb-fs-editor-wrap" id="nb-fs-editor-wrap"></div>
           <div class="nb-fs-output-panel" id="nb-fs-output-panel">
             <div class="nb-output-label">Output</div>
             <div id="nb-fs-output-content" class="nb-fs-output-content"></div>
           </div>`
        : `<div class="nb-fs-md-split">
             <div class="nb-fs-md-editor-pane">
               <div class="nb-fs-pane-label">Markdown</div>
               <textarea class="nb-fs-md-textarea" id="nb-fs-md-input" spellcheck="false">${esc(cell.source || '')}</textarea>
             </div>
             <div class="nb-fs-md-preview-pane">
               <div class="nb-fs-pane-label">Preview</div>
               <div class="nb-fs-md-preview-content" id="nb-fs-md-preview">${cell.source ? formatMd(cell.source) : '<em style="color:var(--muted)">Start typing to preview...</em>'}</div>
             </div>
           </div>`}
    </div>`;

  document.body.appendChild(overlay);
  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  const closeFs = () => {
    if (fsTempEditor) { try { fsTempEditor.dispose(); } catch(_){} fsTempEditor = null; }
    overlay.remove();
    document.body.style.overflow = '';
    // Re-layout all main editors after closing
    setTimeout(() => Object.values(_nbEditors).forEach(ed => { try { ed.layout(); } catch(_){} }), 100);
  };

  overlay.querySelector('#nb-fs-close-btn').onclick = closeFs;
  const escHandler = (e) => { if (e.key === 'Escape') { closeFs(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  let fsTempEditor = null;

  if (isCode) {
    // Mount Monaco in fullscreen
    _loadMonaco().then(() => {
      if (!window.monaco) return;
      const isDark = document.body.classList.contains('theme-dark') || !document.body.classList.contains('theme-light');
      const editorWrap = overlay.querySelector('#nb-fs-editor-wrap');
      fsTempEditor = monaco.editor.create(editorWrap, {
        value: cell.source || '',
        language: _getMonacoLang(cell.language || 'python'),
        theme: isDark ? 'vs-dark' : 'vs',
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontLigatures: true,
        lineNumbers: 'on',
        wordWrap: 'off',
        folding: true,
        suggest: { showKeywords: true, showSnippets: true },
        quickSuggestions: { other: true, comments: false, strings: false },
        acceptSuggestionOnEnter: 'on',
        tabSize: 4,
        insertSpaces: true,
        padding: { top: 12, bottom: 12 },
        scrollbar: { vertical: 'auto', horizontal: 'auto' },
      });

      // Sync → cell state + main editor
      fsTempEditor.onDidChangeModelContent(() => {
        cell.source = fsTempEditor.getValue();
        _nbSave();
        // Also update the main cell editor if it exists
        const mainEd = _nbEditors[cellId];
        if (mainEd) {
          const pos = mainEd.getPosition();
          mainEd.setValue(cell.source);
          if (pos) mainEd.setPosition(pos);
        }
      });

      // Shift+Enter to run
      fsTempEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => runFromFs());
      fsTempEditor.focus();

      // Language selector in fullscreen
      const fsLangSel = overlay.querySelector('#nb-fs-lang');
      if (fsLangSel) {
        fsLangSel.onchange = () => {
          cell.language = fsLangSel.value;
          _nbSave();
          monaco.editor.setModelLanguage(fsTempEditor.getModel(), _getMonacoLang(cell.language));
          const mainEd = _nbEditors[cellId];
          if (mainEd && window.monaco) {
            monaco.editor.setModelLanguage(mainEd.getModel(), _getMonacoLang(cell.language));
          }
          // Update the main cell's lang select too
          const mainSel = document.querySelector(`.nb-lang-select[data-cell="${cellId}"]`);
          if (mainSel) mainSel.value = cell.language;
        };
      }

      // Wire up run button
      const runFromFs = () => {
        _nbExecCell(cellId);
        // Watch for output updates and mirror them in the panel
        const outputEl = overlay.querySelector('#nb-fs-output-content');
        _nbWatchOutputFor(cellId, outputEl);
      };
      overlay.querySelector('#nb-fs-run-btn')?.addEventListener('click', runFromFs);

      // Show existing output if any
      const existingOutputs = _nbState.outputs[cellId];
      if (existingOutputs && existingOutputs.length > 0) {
        const outputEl = overlay.querySelector('#nb-fs-output-content');
        outputEl.innerHTML = _nbRenderOutputItems(existingOutputs);
      }
    });

  } else {
    // Markdown fullscreen — live preview
    const mdInput = overlay.querySelector('#nb-fs-md-input');
    const mdPreview = overlay.querySelector('#nb-fs-md-preview');
    mdInput.oninput = () => {
      cell.source = mdInput.value;
      _nbSave();
      mdPreview.innerHTML = cell.source ? formatMd(cell.source) : '<em style="color:var(--muted)">Start typing to preview...</em>';
      // Update main cell preview
      const mainPreview = document.querySelector(`.nb-md-preview[data-cell="${cellId}"]`);
      if (mainPreview) mainPreview.innerHTML = cell.source ? formatMd(cell.source) : '<em class="muted">Click to edit markdown…</em>';
    };
    mdInput.focus();
  }
}

// Watch for output updates and mirror into a given DOM element
function _nbWatchOutputFor(cellId, targetEl) {
  let lastLen = 0;
  const poll = setInterval(() => {
    const outputs = _nbState.outputs[cellId] || [];
    if (outputs.length !== lastLen) {
      lastLen = outputs.length;
      targetEl.innerHTML = _nbRenderOutputItems(outputs);
      targetEl.scrollTop = targetEl.scrollHeight;
    }
    // Stop polling when cell finishes executing
    if (!_nbState.executingCells.has(cellId)) {
      clearInterval(poll);
    }
  }, 100);
}

// Render output items to HTML string (mirrors _nbRenderCellOutput logic)
function _nbRenderOutputItems(outputs) {
  return outputs.map(o => {
    if (o.type === 'stream') return `<pre class="nb-out-stdout">${esc(o.text || '')}</pre>`;
    if (o.type === 'error') return `<pre class="nb-out-stderr">${esc(o.text || '')}</pre>`;
    if (o.type === 'image') return `<img src="${o.data}" style="max-width:100%;border-radius:4px;margin:8px 0">`;
    if (o.type === 'html') return `<div style="padding:8px">${o.data}</div>`;
    if (o.type === 'text') return `<pre class="nb-out-stdout">${esc(o.text || '')}</pre>`;
    return '';
  }).join('');
}

// Notebook state
let _nbState = {
  notebooks: [],
  current: null,
  cells: [],
  ws: null,
  executingCells: new Set(),
  outputs: {},
  kernelId: null,
  sidebarOpen: true,
};

function _nbLoadFromStorage() {
  _nbState.notebooks = userGet('notebooks', []);
}

function _nbSave() {
  // Save notebook list
  if (_nbState.current) {
    const nb = _nbState.notebooks.find(n => n.id === _nbState.current);
    if (nb) {
      nb.cells = _nbState.cells;
      nb.outputs = _nbState.outputs;
      nb.updated_at = new Date().toISOString();
    }
  }
  userSet('notebooks', _nbState.notebooks);
}

function _nbNewId() { return crypto.randomUUID ? crypto.randomUUID() : 'nb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
function _cellNewId() { return 'cell-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

function _nbCreate(title) {
  const nb = {
    id: _nbNewId(),
    title: title || 'Untitled Book',
    language: 'python',
    cells: [{ id: _cellNewId(), type: 'code', source: '', language: 'python' }],
    outputs: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  _nbState.notebooks.unshift(nb);
  _nbState.current = nb.id;
  _nbState.cells = nb.cells;
  _nbState.outputs = nb.outputs || {};
  _nbSave();
  return nb;
}

function _nbLoad(nbId) {
  const nb = _nbState.notebooks.find(n => n.id === nbId);
  if (!nb) return false;
  _nbState.current = nb.id;
  _nbState.cells = nb.cells || [];
  _nbState.outputs = nb.outputs || {};
  return true;
}

function _nbDelete(nbId) {
  _nbState.notebooks = _nbState.notebooks.filter(n => n.id !== nbId);
  if (_nbState.current === nbId) {
    _nbState.current = null;
    _nbState.cells = [];
    _nbState.outputs = {};
  }
  _nbSave();
}

function _nbConnectWs() {
  if (_nbState.ws && _nbState.ws.readyState <= 1) return;
  if (!_nbState.current) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/notebook/${_nbState.current}?token=${encodeURIComponent(state.token)}`;
  const ws = new WebSocket(url);
  ws.onopen = () => { _nbState.ws = ws; };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      _nbHandleWsMsg(msg);
    } catch {}
  };
  ws.onclose = () => {
    _nbState.ws = null;
    // Auto-reconnect if still on notebooks page
    if (state.page === 'notebooks' && _nbState.current) {
      setTimeout(_nbConnectWs, 3000);
    }
  };
  ws.onerror = () => {};
  _nbState.ws = ws;
}

function _nbHandleWsMsg(msg) {
  const cellId = msg.cell_id;
  if (!cellId) return;

  if (msg.type === 'status') {
    if (msg.execution_state === 'busy') {
      _nbState.executingCells.add(cellId);
    } else if (msg.execution_state === 'idle') {
      _nbState.executingCells.delete(cellId);
    }
    _nbRenderCellStatus(cellId);
    return;
  }

  // Initialize output array
  if (!_nbState.outputs[cellId]) _nbState.outputs[cellId] = [];

  if (msg.type === 'stream') {
    _nbState.outputs[cellId].push({ type: 'stream', name: msg.name, text: msg.text });
  } else if (msg.type === 'error') {
    _nbState.outputs[cellId].push({ type: 'error', ename: msg.ename, evalue: msg.evalue, traceback: msg.traceback || [] });
    _nbState.executingCells.delete(cellId);
    _nbRenderCellStatus(cellId);
  } else if (msg.type === 'execute_result' || msg.type === 'display_data') {
    _nbState.outputs[cellId].push({ type: msg.type, data: msg.data });
  }

  _nbRenderCellOutput(cellId);
  _nbSave();
}

function _nbExecCell(cellId) {
  const cell = _nbState.cells.find(c => c.id === cellId);
  if (!cell || cell.type !== 'code') return;
  _nbState.outputs[cellId] = []; // Clear previous output
  _nbRenderCellOutput(cellId);

  if (_nbState.ws && _nbState.ws.readyState === 1) {
    _nbState.ws.send(JSON.stringify({
      type: 'execute',
      cell_id: cellId,
      code: cell.source,
      language: cell.language || 'python',
      kernel_id: _nbState.kernelId,
    }));
  } else {
    // Fallback: REST API execution
    _nbExecCellRest(cellId, cell);
  }
}

async function _nbExecCellRest(cellId, cell) {
  _nbState.executingCells.add(cellId);
  _nbState.outputs[cellId] = [];
  _nbRenderCellStatus(cellId);
  _nbRenderCellOutput(cellId);

  try {
    // First save cell to backend, then execute
    const res = await api('/notebooks/cells/' + cellId + '/run', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      const exec = data.execution;
      if (exec.stdout) _nbState.outputs[cellId].push({ type: 'stream', name: 'stdout', text: exec.stdout });
      if (exec.stderr) _nbState.outputs[cellId].push({ type: 'stream', name: 'stderr', text: exec.stderr });
      if (exec.status === 'failed' || exec.status === 'timeout') {
        _nbState.outputs[cellId].push({ type: 'error', ename: exec.status, evalue: exec.stderr || 'Execution failed', traceback: [] });
      }
    } else {
      // WebSocket-only execution
      _nbState.outputs[cellId].push({ type: 'stream', name: 'stderr', text: 'Connecting to execution engine...\n' });
      _nbConnectWs();
      await new Promise(r => setTimeout(r, 1000));
      if (_nbState.ws && _nbState.ws.readyState === 1) {
        _nbState.ws.send(JSON.stringify({
          type: 'execute', cell_id: cellId,
          code: cell.source, language: cell.language || 'python',
        }));
        return; // WS handler will manage from here
      }
      _nbState.outputs[cellId].push({ type: 'error', ename: 'ConnectionError', evalue: 'Could not connect to execution engine', traceback: [] });
    }
  } catch (e) {
    _nbState.outputs[cellId].push({ type: 'error', ename: 'Error', evalue: e.message, traceback: [] });
  }

  _nbState.executingCells.delete(cellId);
  _nbRenderCellStatus(cellId);
  _nbRenderCellOutput(cellId);
  _nbSave();
}

const NB_LANGUAGES = [
  { id: 'python', name: 'Python', color: '#3776AB' },
  { id: 'javascript', name: 'JavaScript', color: '#F7DF1E' },
  { id: 'typescript', name: 'TypeScript', color: '#3178C6' },
  { id: 'c', name: 'C', color: '#A8B9CC' },
  { id: 'cpp', name: 'C++', color: '#00599C' },
  { id: 'java', name: 'Java', color: '#ED8B00' },
  { id: 'go', name: 'Go', color: '#00ADD8' },
  { id: 'rust', name: 'Rust', color: '#DEA584' },
  { id: 'r', name: 'R', color: '#276DC3' },
  { id: 'julia', name: 'Julia', color: '#9558B2' },
  { id: 'bash', name: 'Bash', color: '#4EAA25' },
  { id: 'sql', name: 'SQL', color: '#003B57' },
  { id: 'csharp', name: 'C#', color: '#239120' },
  { id: 'ruby', name: 'Ruby', color: '#CC342D' },
  { id: 'php', name: 'PHP', color: '#777BB4' },
  { id: 'kotlin', name: 'Kotlin', color: '#7F52FF' },
  { id: 'swift', name: 'Swift', color: '#F05138' },
  { id: 'lua', name: 'Lua', color: '#000080' },
  { id: 'haskell', name: 'Haskell', color: '#5D4F85' },
  { id: 'html', name: 'HTML', color: '#E34F26' },
];

function _nbRenderCellStatus(cellId) {
  const el = document.getElementById('nb-cell-' + cellId);
  if (!el) return;
  const isExec = _nbState.executingCells.has(cellId);
  el.classList.toggle('executing', isExec);
  const btn = el.querySelector('.nb-run-btn');
  if (btn) {
    btn.innerHTML = isExec
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  }
}

function _nbRenderCellOutput(cellId) {
  const container = document.getElementById('nb-output-' + cellId);
  if (!container) return;
  const outputs = _nbState.outputs[cellId] || [];
  if (outputs.length === 0) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'block';

  let html = '<div class="nb-output-label"><span>Output</span><button class="icon-btn nb-clear-this-output" data-cell="' + cellId + '" title="Clear output" style="margin-left:auto;font-size:.75rem;opacity:.6">&#10005;</button></div>';
  for (const out of outputs) {
    if (out.type === 'stream') {
      const cls = out.name === 'stderr' ? 'nb-out-stderr' : 'nb-out-stdout';
      html += `<pre class="${cls}">${esc(out.text)}</pre>`;
    } else if (out.type === 'error') {
      html += `<div class="nb-out-error"><strong>${esc(out.ename || 'Error')}: ${esc(out.evalue || '')}</strong>`;
      if (out.traceback && out.traceback.length) {
        html += `<pre class="nb-out-traceback">${esc(out.traceback.join('\n'))}</pre>`;
      }
      html += `</div>`;
    } else if (out.type === 'execute_result' || out.type === 'display_data') {
      const data = out.data || {};
      if (data['text/html']) html += `<div class="nb-out-html">${data['text/html']}</div>`;
      else if (data['image/png']) html += `<img class="nb-out-img" src="data:image/png;base64,${data['image/png']}">`;
      else if (data['text/plain']) html += `<pre class="nb-out-stdout">${esc(data['text/plain'])}</pre>`;
    }
  }
  container.innerHTML = html;
}

function renderNotebooks() {
  const el = document.getElementById('page-content');
  el.className = 'page nb-page-container';
  el.style.padding = '0';
  el.style.overflow = 'hidden';
  el.style.display = 'flex';

  const nb = _nbState.current ? _nbState.notebooks.find(n => n.id === _nbState.current) : null;

  el.innerHTML = `
    <div class="nb-sidebar ${_nbState.sidebarOpen ? '' : 'collapsed'}">
      <div class="nb-sidebar-header">
        <span class="nb-sidebar-title">Explorer</span>
      </div>
      <button class="btn btn-sm btn-primary nb-new-btn" style="margin:8px 12px;width:calc(100% - 24px)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Book
      </button>
      <div class="nb-sidebar-list">
        ${_nbState.notebooks.map(n => `
          <div class="nb-sidebar-item ${n.id === _nbState.current ? 'active' : ''}" data-id="${n.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span class="nb-item-title">${esc(n.title)}</span>
            ${n.id !== _nbState.current ? `<button class="icon-btn nb-item-del" data-del="${n.id}" title="Delete">&times;</button>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="nb-main">
      <div class="nb-toolbar">
        <button class="icon-btn nb-sidebar-toggle-main" title="Toggle Explorer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
        ${nb ? `
        <input class="nb-title-input" id="nb-title" value="${esc(nb.title)}" placeholder="Book title">
        <div class="nb-toolbar-actions">
          <button class="btn btn-sm btn-outline nb-add-code" title="Add Code Cell">+ Code</button>
          <button class="btn btn-sm btn-outline nb-add-md" title="Add Markdown Cell">+ Markdown</button>
          <button class="btn btn-sm btn-outline nb-clear-outputs" title="Clear All Outputs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v10l4-4"/><path d="M23 20V10l-4 4"/></svg>
            Clear
          </button>
          <button class="btn btn-sm btn-outline nb-download" title="Download as .ipynb">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            .ipynb
          </button>
          <button class="btn btn-sm btn-primary nb-run-all" title="Run All Cells">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run All
          </button>
        </div>
        <span class="nb-kernel-status" id="nb-kernel-status">
          <span class="nb-kernel-dot" id="nb-kernel-dot"></span>
          <span id="nb-kernel-label">Python 3</span>
        </span>
        ` : '<span style="color:var(--muted);padding:0 12px">Select or create a notebook</span>'}
      </div>
      <div class="nb-cells" id="nb-cells">
        ${nb ? _nbRenderAllCells() : `
          <div class="nb-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <h3>MBM Book</h3>
            <p class="muted">Create a new book to start coding "" 25+ languages, offline, Kaggle-style.</p>
            <button class="btn btn-primary nb-empty-create">New Book</button>
          </div>
        `}
      </div>
    </div>`;

  _nbBindAll();
  if (_nbState.current) _nbConnectWs();
  // Initialize Monaco editors after DOM is ready
  _nbInitMonacoEditors();
}

function _nbRenderAllCells() {
  return _nbState.cells.map((cell, idx) =>
    _nbRenderCell(cell, idx) + `
    <div class="nb-between-add">
      <div class="nb-between-line"></div>
      <div class="nb-between-btns">
        <button class="nb-between-btn" data-after="${cell.id}" data-type="code">+ Code</button>
        <button class="nb-between-btn" data-after="${cell.id}" data-type="markdown">+ Markdown</button>
      </div>
    </div>`
  ).join('');
}

function _nbRenderCell(cell, idx) {
  const lang = NB_LANGUAGES.find(l => l.id === cell.language) || { id: cell.language || 'python', name: cell.language || 'Python', color: '#666' };
  const isExec = _nbState.executingCells.has(cell.id);
  const outputs = _nbState.outputs[cell.id] || [];
  const hasOutput = outputs.length > 0;

  if (cell.type === 'markdown') {
    return `
    <div class="nb-cell nb-cell-md ${isExec ? 'executing' : ''}" id="nb-cell-${cell.id}" data-cell="${cell.id}">
      <div class="nb-cell-gutter">
        <span class="nb-cell-num">${idx + 1}</span>
      </div>
      <div class="nb-cell-content">
        <div class="nb-cell-toolbar">
          <span class="nb-cell-type-badge" style="background:${lang.color}20;color:${lang.color}">Markdown</span>
          <div class="nb-cell-actions">
            <button class="icon-btn nb-move-up" data-cell="${cell.id}" title="Move up"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>
            <button class="icon-btn nb-move-down" data-cell="${cell.id}" title="Move down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
            <button class="icon-btn nb-fs-btn" data-cell="${cell.id}" title="Fullscreen (edit markdown)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
            <button class="icon-btn nb-del-cell" data-cell="${cell.id}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
        <div class="nb-md-preview" data-cell="${cell.id}">${cell.source ? formatMd(cell.source) : '<em class="muted">Click to edit markdown"¦</em>'}</div>
        <textarea class="nb-md-editor" data-cell="${cell.id}" style="display:none" rows="4">${esc(cell.source)}</textarea>
      </div>
    </div>`;
  }

  // Code cell
  return `
  <div class="nb-cell nb-cell-code ${isExec ? 'executing' : ''}" id="nb-cell-${cell.id}" data-cell="${cell.id}">
    <div class="nb-cell-gutter">
      <button class="icon-btn nb-run-btn" data-cell="${cell.id}" title="Run (Shift+Enter)">
        ${isExec
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'}
      </button>
      <span class="nb-cell-num">[${idx + 1}]</span>
    </div>
    <div class="nb-cell-content">
      <div class="nb-cell-toolbar">
        <select class="nb-lang-select" data-cell="${cell.id}">
          ${NB_LANGUAGES.map(l => `<option value="${l.id}" ${l.id === (cell.language || 'python') ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
        <span class="nb-lang-dot" style="background:${lang.color}"></span>
        <div class="nb-cell-actions">
          <button class="icon-btn nb-ai-debug" data-cell="${cell.id}" title="AI Debug "" explain error or suggest fix">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><circle cx="12" cy="16" r=".5" fill="currentColor"/></svg>
          </button>
          <button class="icon-btn nb-move-up" data-cell="${cell.id}" title="Move up"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>
          <button class="icon-btn nb-move-down" data-cell="${cell.id}" title="Move down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
          <button class="icon-btn nb-fs-btn" data-cell="${cell.id}" title="Fullscreen editor"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
          <button class="icon-btn nb-del-cell" data-cell="${cell.id}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>
      <textarea class="nb-code-editor" data-cell="${cell.id}" spellcheck="false" rows="${Math.max(3, (cell.source || '').split('\n').length)}" placeholder="Start coding"¦ (Shift+Enter to run)">${esc(cell.source)}</textarea>
      <div class="nb-cell-output ${hasOutput ? '' : 'empty'}" id="nb-output-${cell.id}" style="${hasOutput ? '' : 'display:none'}">${hasOutput ? '' : ''}</div>
    </div>
  </div>`;
}

function _nbRefreshCells() {
  const container = document.getElementById('nb-cells');
  if (!container) return;
  // Dispose Monaco editors before rebuilding DOM
  _nbDisposeEditors();
  container.innerHTML = _nbRenderAllCells();
  _nbBindCells();
  // Re-render outputs
  for (const cellId of Object.keys(_nbState.outputs)) {
    _nbRenderCellOutput(cellId);
  }
  // Re-init Monaco
  _nbInitMonacoEditors();
}

function _nbBindAll() {
  // New notebook buttons
  document.querySelectorAll('.nb-new-btn, .nb-empty-create').forEach(btn => {
    btn.onclick = () => { _nbCreate('Untitled Book'); renderNotebooks(); };
  });

  // Sidebar items
  document.querySelectorAll('.nb-sidebar-item').forEach(item => {
    item.onclick = (e) => {
      if (e.target.closest('.nb-item-del')) return;
      _nbSave(); // Save current before switching
      _nbLoad(item.dataset.id);
      renderNotebooks();
    };
  });
  document.querySelectorAll('.nb-item-del').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); if (confirm('Delete this notebook?')) { _nbDelete(btn.dataset.del); renderNotebooks(); } };
  });

  // Sidebar toggle — toggle CSS class only, never re-render (preserves Monaco editors)
  document.querySelectorAll('.nb-sidebar-toggle-main').forEach(btn => {
    btn.onclick = () => {
      _nbState.sidebarOpen = !_nbState.sidebarOpen;
      const sidebar = document.querySelector('.nb-sidebar');
      if (sidebar) sidebar.classList.toggle('collapsed', !_nbState.sidebarOpen);
      // Tell Monaco to re-measure its container after sidebar resize
      setTimeout(() => Object.values(_nbEditors).forEach(ed => { try { ed.layout(); } catch(_){} }), 300);
    };
  });

  // Title input
  const titleInput = document.getElementById('nb-title');
  if (titleInput) {
    titleInput.onchange = () => {
      const nb = _nbState.notebooks.find(n => n.id === _nbState.current);
      if (nb) { nb.title = titleInput.value; _nbSave(); }
    };
  }

  // Toolbar actions
  const addCode = document.querySelector('.nb-add-code');
  if (addCode) addCode.onclick = () => { _nbAddCell('code'); };
  const addMd = document.querySelector('.nb-add-md');
  if (addMd) addMd.onclick = () => { _nbAddCell('markdown'); };

  document.querySelector('.nb-clear-outputs')?.addEventListener('click', () => {
    _nbState.outputs = {};
    _nbSave();
    _nbRefreshCells();
  });

  document.querySelector('.nb-download')?.addEventListener('click', _nbDownloadIpynb);
  document.querySelector('.nb-run-all')?.addEventListener('click', _nbRunAll);

  _nbBindCells();
}

function _nbBindCells() {
  // Code editors - auto-resize and save (textarea fallback when Monaco not loaded)
  document.querySelectorAll('.nb-code-editor').forEach(ta => {
    const cellId = ta.dataset.cell;
    // Skip if Monaco editor is already mounted for this cell
    if (_nbEditors[cellId]) return;
    ta.oninput = () => {
      const cell = _nbState.cells.find(c => c.id === cellId);
      if (cell) { cell.source = ta.value; _nbSave(); }
      ta.rows = Math.max(3, ta.value.split('\n').length);
    };
    ta.onkeydown = (e) => {
      // Shift+Enter to run
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        _nbExecCell(cellId);
      }
      // Tab for indentation
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 4;
        ta.oninput();
      }
    };
  });

  // Run buttons
  document.querySelectorAll('.nb-run-btn').forEach(btn => {
    btn.onclick = () => _nbExecCell(btn.dataset.cell);
  });

  // Fullscreen buttons
  document.querySelectorAll('.nb-fs-btn').forEach(btn => {
    btn.onclick = () => _nbOpenFullscreen(btn.dataset.cell);
  });
  document.querySelectorAll('.nb-lang-select').forEach(sel => {
    sel.onchange = () => {
      const cell = _nbState.cells.find(c => c.id === sel.dataset.cell);
      if (cell) {
        cell.language = sel.value;
        _nbSave();
        // Update Monaco language if editor exists
        const ed = _nbEditors[cell.id];
        if (ed && window.monaco) {
          monaco.editor.setModelLanguage(ed.getModel(), _getMonacoLang(cell.language));
        }
      }
    };
  });

  // Move up/down
  document.querySelectorAll('.nb-move-up').forEach(btn => {
    btn.onclick = () => {
      const idx = _nbState.cells.findIndex(c => c.id === btn.dataset.cell);
      if (idx > 0) { [_nbState.cells[idx - 1], _nbState.cells[idx]] = [_nbState.cells[idx], _nbState.cells[idx - 1]]; _nbSave(); _nbRefreshCells(); }
    };
  });
  document.querySelectorAll('.nb-move-down').forEach(btn => {
    btn.onclick = () => {
      const idx = _nbState.cells.findIndex(c => c.id === btn.dataset.cell);
      if (idx < _nbState.cells.length - 1) { [_nbState.cells[idx], _nbState.cells[idx + 1]] = [_nbState.cells[idx + 1], _nbState.cells[idx]]; _nbSave(); _nbRefreshCells(); }
    };
  });

  // AI Debug: explain error or suggest fix using MAC chat
  document.querySelectorAll('.nb-ai-debug').forEach(btn => {
    btn.onclick = async () => {
      const cellId = btn.dataset.cell;
      const cell = _nbState.cells.find(c => c.id === cellId);
      if (!cell) return;
      const outputs = _nbState.outputs[cellId] || [];
      const errorOut = outputs.find(o => o.type === 'error');
      const stdout = outputs.filter(o => o.type === 'stream').map(o => o.text).join('');

      let prompt = `I have a ${cell.language || 'Python'} code cell:\n\`\`\`${cell.language || 'python'}\n${cell.source}\n\`\`\`\n`;
      if (errorOut) {
        prompt += `\nIt produced this error:\n${errorOut.ename}: ${errorOut.evalue}\n${(errorOut.traceback || []).join('\n')}\n\nPlease explain the error and suggest a fix.`;
      } else if (stdout) {
        prompt += `\nOutput:\n${stdout}\n\nPlease explain what this code does and if there are any improvements.`;
      } else {
        prompt += `\nPlease review this code and suggest improvements or explain what it does.`;
      }

      // Show AI response in an output panel below the cell
      const outputEl = document.getElementById(`nb-output-${cellId}`);
      if (outputEl) {
        outputEl.style.display = '';
        outputEl.innerHTML = `<div class="nb-ai-panel"><div class="nb-ai-header"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/></svg> MAC AI Debug</div><div class="nb-ai-response"><div class="spinner" style="width:16px;height:16px;margin:8px auto"></div></div></div>`;
        const respEl = outputEl.querySelector('.nb-ai-response');

        try {
          const res = await fetch(`${API}/query/chat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: prompt }], stream: false }),
          });
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || 'No response';
          respEl.innerHTML = formatMd(content);
        } catch (e) {
          respEl.textContent = 'AI Debug failed: ' + e.message;
        }
      }
    };
  });

  // Delete cell
  document.querySelectorAll('.nb-del-cell').forEach(btn => {
    btn.onclick = () => {
      const cellId = btn.dataset.cell;
      // Dispose Monaco editor before removing cell
      _nbDisposeEditor(cellId);
      _nbState.cells = _nbState.cells.filter(c => c.id !== cellId);
      delete _nbState.outputs[cellId];
      _nbSave();
      _nbRefreshCells();
    };
  });

  // Markdown preview/edit toggle
  document.querySelectorAll('.nb-md-preview').forEach(preview => {
    preview.onclick = () => {
      const editor = preview.parentElement.querySelector('.nb-md-editor');
      preview.style.display = 'none';
      editor.style.display = 'block';
      editor.focus();
    };
  });
  document.querySelectorAll('.nb-md-editor').forEach(editor => {
    editor.oninput = () => {
      const cell = _nbState.cells.find(c => c.id === editor.dataset.cell);
      if (cell) { cell.source = editor.value; _nbSave(); }
    };
    editor.onblur = () => {
      const preview = editor.parentElement.querySelector('.nb-md-preview');
      const cell = _nbState.cells.find(c => c.id === editor.dataset.cell);
      preview.innerHTML = cell && cell.source ? formatMd(cell.source) : '<em class="muted">Click to edit markdown"¦</em>';
      preview.style.display = 'block';
      editor.style.display = 'none';
    };
  });

  // Bottom add-cell buttons
  document.querySelectorAll('.nb-add-code-bottom').forEach(btn => { btn.onclick = () => _nbAddCell('code'); });
  document.querySelectorAll('.nb-add-md-bottom').forEach(btn => { btn.onclick = () => _nbAddCell('markdown'); });

  // Between-cell add buttons
  document.querySelectorAll('.nb-between-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = _nbState.cells.findIndex(c => c.id === btn.dataset.after);
      _nbAddCell(btn.dataset.type, idx);
    };
  });

  // Clear individual cell output
  document.querySelectorAll('.nb-clear-this-output').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      _nbState.outputs[btn.dataset.cell] = [];
      _nbRenderCellOutput(btn.dataset.cell);
      _nbSave();
    };
  });
}

function _nbAddCell(type, afterIdx) {
  const cell = { id: _cellNewId(), type, source: '', language: type === 'code' ? 'python' : undefined };
  if (afterIdx !== undefined) {
    _nbState.cells.splice(afterIdx + 1, 0, cell);
  } else {
    _nbState.cells.push(cell);
  }
  _nbSave();
  _nbRefreshCells();
  // Scroll to new cell
  setTimeout(() => {
    const el = document.getElementById('nb-cell-' + cell.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

async function _nbRunAll() {
  for (const cell of _nbState.cells) {
    if (cell.type === 'code') {
      _nbExecCell(cell.id);
      // Wait a bit between cells for sequential execution
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function _nbDownloadIpynb() {
  const nb = _nbState.notebooks.find(n => n.id === _nbState.current);
  if (!nb) return;

  const ipynb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: nb.language || 'python', version: '3.11' },
    },
    cells: _nbState.cells.map(cell => {
      const outputs = (_nbState.outputs[cell.id] || []).map(out => {
        if (out.type === 'stream') return { output_type: 'stream', name: out.name, text: [out.text] };
        if (out.type === 'error') return { output_type: 'error', ename: out.ename, evalue: out.evalue, traceback: out.traceback };
        return { output_type: 'display_data', data: out.data || {}, metadata: {} };
      });
      return {
        cell_type: cell.type === 'code' ? 'code' : 'markdown',
        source: (cell.source || '').split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l),
        metadata: { language: cell.language },
        ...(cell.type === 'code' ? { execution_count: null, outputs } : {}),
      };
    }),
  };

  const blob = new Blob([JSON.stringify(ipynb, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (nb.title || 'notebook').replace(/[^a-zA-Z0-9_-]/g, '_') + '.ipynb';
  a.click();
  URL.revokeObjectURL(a.href);
}


/* 
   NOTIFICATIONS "" Bell, Panel, Push Subscription
    */
