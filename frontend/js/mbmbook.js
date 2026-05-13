/* ============================================================
   MBM Book IDE — VS Code / LeetCode style, per-user Docker container
   Renders into #page-content (MAC shell pattern, no shell() re-render)
   ============================================================ */

// ── State ─────────────────────────────────────────────────────
const _mb = {
  session:     null,
  polling:     null,
  files:       [],
  tabs:        [],          // [{path, label, dirty, model}]
  activeTab:   null,
  editor:      null,
  editorReady: false,
  ws:          null,        // terminal WebSocket
  termOpen:    true,
  termHistory: [],
  termHistIdx: -1,
  termInput:   '',
  termRows:    24, termCols: 100,
  panelW:      220,         // file explorer px
  termH:       210,         // terminal height px
  dragging:    null,        // 'panel'|'term'
  uploadInput: null,
};

// Language map: ext → Monaco language
const _LANGS = {
  py:'python', js:'javascript', ts:'typescript', java:'java',
  c:'c', cpp:'cpp', cs:'csharp', go:'go', rs:'rust',
  rb:'ruby', php:'php', sh:'shell', bash:'shell',
  html:'html', css:'css', json:'json', md:'markdown',
  sql:'sql', yaml:'yaml', toml:'toml', txt:'plaintext',
};
const _RUNMAP = {
  python:'python3', javascript:'node', typescript:'ts-node',
  java:'java', cpp:'g++ -o /tmp/out $$F && /tmp/out', c:'gcc -o /tmp/out $$F && /tmp/out',
  go:'go run', rust:'rustc $$F -o /tmp/out && /tmp/out', shell:'bash',
};

// ── IST timestamp helper ──────────────────────────────────────
function _mbISTNow() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

// ── Log admin event (fire-and-forget) ────────────────────────
function _mbLogAdmin(event, detail) {
  try {
    apiJson('/mbmbook/activity', {
      method: 'POST',
      body: JSON.stringify({ event, detail, ist: _mbISTNow() }),
    }).catch(() => {});
  } catch {}
}

// ── Theme helpers ─────────────────────────────────────────────
function _mbIsDark() {
  const t = document.documentElement.getAttribute('data-theme') || 'warm';
  return t === 'dark';
}

function _mbApplyTheme() {
  const dark = _mbIsDark();
  const s = document.getElementById('mb-style');
  if (!s) return;
  if (dark) {
    document.documentElement.style.setProperty('--mb-bg',      '#0d1117');
    document.documentElement.style.setProperty('--mb-surface', '#161b22');
    document.documentElement.style.setProperty('--mb-border',  '#30363d');
    document.documentElement.style.setProperty('--mb-hover',   '#21262d');
    document.documentElement.style.setProperty('--mb-fg',      '#e6edf3');
    document.documentElement.style.setProperty('--mb-muted',   '#8b949e');
    document.documentElement.style.setProperty('--mb-tab-bg',  '#1c2128');
    document.documentElement.style.setProperty('--mb-toolbar', '#13161d');
  } else {
    document.documentElement.style.setProperty('--mb-bg',      '#f6f8fa');
    document.documentElement.style.setProperty('--mb-surface', '#ffffff');
    document.documentElement.style.setProperty('--mb-border',  '#d0d7de');
    document.documentElement.style.setProperty('--mb-hover',   '#eaeef2');
    document.documentElement.style.setProperty('--mb-fg',      '#1f2328');
    document.documentElement.style.setProperty('--mb-muted',   '#656d76');
    document.documentElement.style.setProperty('--mb-tab-bg',  '#f6f8fa');
    document.documentElement.style.setProperty('--mb-toolbar', '#f6f8fa');
  }
  // Update Monaco theme
  if (_mb.editorReady && _mb.editor && window.monaco) {
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
  }
}

let _mbThemeObserver = null;

// ── Entry point (called by core.js render) ────────────────────
function renderMBMBook() {
  const el = document.getElementById('page-content');
  if (!el) return;
  el.className = 'page page-mbmbook';
  _mbInjectCSS();
  el.innerHTML = _mbLayout();
  _mbBind();
  _mbInitEditor();
  _mbCheckSession();
  _mbApplyTheme();

  // Watch for theme changes
  _mbThemeObserver = new MutationObserver(() => _mbApplyTheme());
  _mbThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Go fullscreen — requires user gesture; try immediately (works when triggered by nav click)
  _mbEnterFullscreen();

  // Log admin entry
  _mbLogAdmin('mbmbook_enter', `${(state.user && state.user.name) || 'User'} opened MBM Book IDE`);
}

function _mbEnterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
  if (req) {
    req.call(el).catch(() => {
      // Browser blocked auto-fullscreen — show the fullscreen button prominently
      const btn = document.getElementById('mb-fs-btn');
      if (btn) { btn.style.display = ''; btn.style.animation = 'pulse 1s 3'; }
    });
  }
  document.addEventListener('fullscreenchange', _mbFsChange, { once: false });
}

function _mbFsChange() {
  if (!document.fullscreenElement) {
    // User pressed Esc — log admin exit
    _mbLogAdmin('mbmbook_exit', `${(state.user && state.user.name) || 'User'} exited MBM Book fullscreen`);
  }
}

// ── Layout HTML ───────────────────────────────────────────────
function _mbLayout() {
  return `
<div class="mb-wrap" id="mb-wrap">

  <!-- ── Toolbar ── -->
  <div class="mb-toolbar" id="mb-toolbar">
    <div class="mb-toolbar-left">
      <button class="mb-btn mb-btn-icon" onclick="_mbTogglePanel()" title="Toggle file explorer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
      </button>
      <div class="mb-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M13 7h5"/><path d="M13 11h5"/><path d="M13 15h5"/></svg>
        <span>MBM Book IDE</span>
      </div>
      <select class="mb-lang-select" id="mb-lang-select" onchange="_mbSetLang(this.value)">
        <option value="python">Python 3</option>
        <option value="javascript">JavaScript</option>
        <option value="typescript">TypeScript</option>
        <option value="java">Java</option>
        <option value="cpp">C++</option>
        <option value="c">C</option>
        <option value="go">Go</option>
        <option value="rust">Rust</option>
        <option value="shell">Shell</option>
        <option value="csharp">C#</option>
      </select>
    </div>
    <div class="mb-toolbar-right">
      <button class="mb-btn mb-btn-run" id="mb-run-btn" onclick="_mbRunFile()" title="Run current file (F5)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Run
      </button>
      <button class="mb-btn" onclick="_mbSaveActive()" title="Save (Ctrl+S)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13"/><polyline points="7 3 7 8 15 8"/></svg>
      </button>
      <button class="mb-btn" onclick="_mbNewFile()" title="New file">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      </button>
      <label class="mb-btn" title="Upload file">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
        <input type="file" style="display:none" id="mb-upload-input" onchange="_mbUpload(this)">
      </label>
      <div class="mb-session-status" id="mb-session-status">
        <span class="mb-dot mb-dot-off" id="mb-dot"></span>
        <span id="mb-status-text">No session</span>
      </div>
      <button class="mb-btn mb-btn-start" id="mb-start-btn" onclick="_mbStartSession()">▶ Start</button>
      <button class="mb-btn mb-btn-stop" id="mb-stop-btn" onclick="_mbStopSession()" style="display:none">■ Stop</button>
      <button class="mb-btn mb-btn-icon" id="mb-fs-btn" onclick="_mbEnterFullscreen()" title="Enter fullscreen (F11)" style="display:none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
    </div>
  </div>

  <!-- ── Body ── -->
  <div class="mb-body" id="mb-body">

    <!-- File Explorer -->
    <div class="mb-explorer" id="mb-explorer" style="width:${_mb.panelW}px">
      <div class="mb-explorer-header">
        <span>EXPLORER</span>
        <div style="display:flex;gap:4px">
          <button class="mb-icon-btn" onclick="_mbNewFile()" title="New file">+</button>
          <button class="mb-icon-btn" onclick="_mbNewFolder()" title="New folder">📁</button>
          <button class="mb-icon-btn" onclick="_mbRefreshFiles()" title="Refresh">⟳</button>
        </div>
      </div>
      <div class="mb-file-tree" id="mb-file-tree">
        <div class="mb-tree-empty" id="mb-tree-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--mb-muted)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M13 7h5"/></svg>
          <p>Start a session to<br>browse workspace files</p>
        </div>
      </div>
    </div>

    <!-- Panel resize handle -->
    <div class="mb-resize-panel" id="mb-resize-panel"></div>

    <!-- Editor area -->
    <div class="mb-editor-area" id="mb-editor-area">

      <!-- Tabs -->
      <div class="mb-tabs" id="mb-tabs">
        <div class="mb-tabs-list" id="mb-tabs-list">
          <div class="mb-tab-empty" id="mb-tab-empty">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mb-muted)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            <span>Open a file to start editing</span>
          </div>
        </div>
        <button class="mb-tab-new" onclick="_mbNewFile()" title="New file">+</button>
      </div>

      <!-- Monaco container -->
      <div class="mb-monaco-wrap" id="mb-monaco-wrap">
        <div class="mb-welcome" id="mb-welcome">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="1.2" opacity="0.4"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M13 7h5"/><path d="M13 11h5"/><path d="M13 15h5"/></svg>
          <h2>MBM Book IDE</h2>
          <p>Start a session, then open or create a file</p>
          <div class="mb-shortcuts">
            <div><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</div>
            <div><kbd>F5</kbd> Run</div>
            <div><kbd>Ctrl</kbd>+<kbd>\`</kbd> Terminal</div>
          </div>
        </div>
        <div id="mb-monaco-container" style="width:100%;height:100%;display:none"></div>
      </div>

      <!-- Terminal resize handle -->
      <div class="mb-resize-term" id="mb-resize-term"></div>

      <!-- Terminal -->
      <div class="mb-term" id="mb-term" style="height:${_mb.termH}px">
        <div class="mb-term-header">
          <div style="display:flex;align-items:center;gap:8px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <span>TERMINAL</span>
            <span class="mb-term-status" id="mb-term-status">disconnected</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="mb-icon-btn" onclick="_mbReconnectTerminal()" title="Reconnect">⟳</button>
            <button class="mb-icon-btn" onclick="_mbClearTerminal()" title="Clear">✕</button>
            <button class="mb-icon-btn" onclick="_mbToggleTerm()" title="Toggle terminal" id="mb-term-toggle">▼</button>
          </div>
        </div>
        <div class="mb-term-output" id="mb-term-output"></div>
        <div class="mb-term-input-row" id="mb-term-input-row">
          <span class="mb-term-prompt" id="mb-term-prompt">$</span>
          <input class="mb-term-input" id="mb-term-input" spellcheck="false"
            onkeydown="_mbTermKey(event)"
            oninput="_mb.termInput=this.value" placeholder="type command...">
        </div>
      </div>

    </div><!-- /editor-area -->
  </div><!-- /body -->

  <!-- Status bar -->
  <div class="mb-statusbar" id="mb-statusbar">
    <span id="mb-sb-session">No container</span>
    <span class="mb-sb-sep">·</span>
    <span id="mb-sb-node">local</span>
    <span class="mb-sb-sep">·</span>
    <span id="mb-sb-file">No file open</span>
    <span style="flex:1"></span>
    <span id="mb-sb-lang">Python</span>
    <span class="mb-sb-sep">·</span>
    <span>UTF-8</span>
  </div>

</div><!-- /wrap -->
`;
}

// ── CSS ───────────────────────────────────────────────────────
function _mbInjectCSS() {
  if (document.getElementById('mb-style')) return;
  const s = document.createElement('style');
  s.id = 'mb-style';
  s.textContent = `
  /* Reset page-content for IDE */
  .page-mbmbook { padding:0!important; overflow:hidden!important; display:flex!important; flex-direction:column!important; height:100%!important; }

  :root {
    --mb-bg:      #0d1117;
    --mb-surface: #161b22;
    --mb-border:  #30363d;
    --mb-hover:   #21262d;
    --mb-accent:  #818cf8;
    --mb-green:   #3fb950;
    --mb-red:     #f85149;
    --mb-orange:  #d29922;
    --mb-fg:      #e6edf3;
    --mb-muted:   #8b949e;
    --mb-tab-bg:  #1c2128;
    --mb-toolbar: #13161d;
  }

  .mb-wrap { display:flex;flex-direction:column;height:100%;background:var(--mb-bg);font-family:system-ui,sans-serif;color:var(--mb-fg);overflow:hidden; }

  /* Toolbar */
  .mb-toolbar { display:flex;align-items:center;justify-content:space-between;padding:0 10px;height:40px;background:var(--mb-toolbar);border-bottom:1px solid var(--mb-border);flex-shrink:0; }
  .mb-toolbar-left,.mb-toolbar-right { display:flex;align-items:center;gap:6px; }
  .mb-brand { display:flex;align-items:center;gap:6px;font-size:.78rem;font-weight:700;color:var(--mb-fg);padding:0 6px;opacity:.85; }
  .mb-btn { display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:5px;font-size:.75rem;font-weight:500;cursor:pointer;border:1px solid var(--mb-border);background:var(--mb-surface);color:var(--mb-fg);transition:all .12s; }
  .mb-btn:hover { background:var(--mb-hover);border-color:var(--mb-accent); }
  .mb-btn-icon { padding:4px 7px; }
  .mb-btn-run { background:#1a3a1a;border-color:#3fb950;color:#3fb950; }
  .mb-btn-run:hover { background:#22502a; }
  .mb-btn-stop { background:#3a1a1a;border-color:#f85149;color:#f85149; }
  .mb-btn-start { background:#1a2a3a;border-color:#818cf8;color:#818cf8; }
  .mb-lang-select { padding:3px 8px;border-radius:5px;border:1px solid var(--mb-border);background:var(--mb-surface);color:var(--mb-fg);font-size:.75rem;cursor:pointer; }
  .mb-session-status { display:flex;align-items:center;gap:5px;font-size:.72rem;color:var(--mb-muted);padding:0 4px; }
  .mb-dot { width:7px;height:7px;border-radius:50%;background:var(--mb-muted); }
  .mb-dot-on  { background:var(--mb-green)!important;box-shadow:0 0 5px var(--mb-green); }
  .mb-dot-start { background:var(--mb-orange)!important; }
  .mb-dot-off { background:var(--mb-muted)!important; }

  /* Body */
  .mb-body { display:flex;flex:1;overflow:hidden; }

  /* Explorer */
  .mb-explorer { display:flex;flex-direction:column;background:var(--mb-surface);border-right:1px solid var(--mb-border);flex-shrink:0;overflow:hidden;min-width:140px;max-width:420px; }
  .mb-explorer-header { display:flex;align-items:center;justify-content:space-between;padding:8px 12px 6px;font-size:.67rem;font-weight:700;color:var(--mb-muted);letter-spacing:.08em;border-bottom:1px solid var(--mb-border);flex-shrink:0; }
  .mb-icon-btn { background:none;border:none;color:var(--mb-muted);cursor:pointer;padding:2px 4px;border-radius:3px;font-size:.8rem;line-height:1;transition:color .12s; }
  .mb-icon-btn:hover { color:var(--mb-fg);background:var(--mb-hover); }
  .mb-file-tree { flex:1;overflow-y:auto;padding:4px 0; }
  .mb-tree-empty { display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 16px;color:var(--mb-muted);font-size:.75rem;text-align:center; }
  .mb-tree-item { display:flex;align-items:center;gap:5px;padding:4px 12px;font-size:.78rem;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .mb-tree-item:hover { background:var(--mb-hover); }
  .mb-tree-item.active { background:var(--mb-accent);background:rgba(129,140,248,.15);color:var(--mb-accent); }
  .mb-tree-file::before { content:'📄';margin-right:2px;font-size:.7rem; }
  .mb-tree-dir::before  { content:'📁';margin-right:2px;font-size:.7rem; }

  /* Panel resize */
  .mb-resize-panel { width:4px;background:transparent;cursor:col-resize;flex-shrink:0;transition:background .1s; }
  .mb-resize-panel:hover,.mb-resize-panel.dragging { background:var(--mb-accent); }

  /* Editor area */
  .mb-editor-area { flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0; }

  /* Tabs */
  .mb-tabs { display:flex;align-items:center;background:var(--mb-tab-bg);border-bottom:1px solid var(--mb-border);height:34px;flex-shrink:0;overflow:hidden; }
  .mb-tabs-list { display:flex;align-items:stretch;flex:1;overflow-x:auto;scrollbar-width:none; }
  .mb-tabs-list::-webkit-scrollbar { display:none; }
  .mb-tab-empty { display:flex;align-items:center;gap:8px;padding:0 16px;font-size:.75rem;color:var(--mb-muted); }
  .mb-tab { display:flex;align-items:center;gap:6px;padding:0 14px 0 12px;height:34px;font-size:.75rem;cursor:pointer;border-right:1px solid var(--mb-border);white-space:nowrap;color:var(--mb-muted);transition:background .1s;flex-shrink:0; }
  .mb-tab:hover { background:var(--mb-hover); }
  .mb-tab.active { background:var(--mb-bg);color:var(--mb-fg);border-top:1px solid var(--mb-accent); }
  .mb-tab-close { background:none;border:none;color:inherit;cursor:pointer;padding:0 2px;font-size:.75rem;line-height:1;opacity:.5;margin-left:2px; }
  .mb-tab-close:hover { opacity:1;color:var(--mb-red); }
  .mb-tab-dirty::after { content:'●';margin-left:4px;font-size:.5rem;color:var(--mb-accent); }
  .mb-tab-new { padding:0 10px;height:34px;background:none;border:none;color:var(--mb-muted);cursor:pointer;font-size:1.1rem;flex-shrink:0; }
  .mb-tab-new:hover { color:var(--mb-fg);background:var(--mb-hover); }

  /* Monaco */
  .mb-monaco-wrap { flex:1;position:relative;overflow:hidden;background:var(--mb-bg); }
  .mb-welcome { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--mb-muted);text-align:center; }
  .mb-welcome h2 { font-size:1rem;font-weight:600;color:var(--mb-fg);margin:0; }
  .mb-welcome p  { font-size:.8rem;margin:0; }
  .mb-shortcuts { display:flex;gap:20px;font-size:.72rem;margin-top:8px; }
  .mb-shortcuts kbd { background:var(--mb-surface);border:1px solid var(--mb-border);border-radius:3px;padding:1px 5px;font-size:.7rem; }

  /* Term resize */
  .mb-resize-term { height:4px;background:transparent;cursor:row-resize;flex-shrink:0;transition:background .1s; }
  .mb-resize-term:hover,.mb-resize-term.dragging { background:var(--mb-accent); }

  /* Terminal */
  .mb-term { display:flex;flex-direction:column;background:#0a0e13;border-top:1px solid var(--mb-border);flex-shrink:0;overflow:hidden; }
  .mb-term-header { display:flex;align-items:center;justify-content:space-between;padding:5px 12px;background:#0d1117;border-bottom:1px solid var(--mb-border);flex-shrink:0;font-size:.68rem;letter-spacing:.05em;color:var(--mb-muted); }
  .mb-term-status { padding:1px 6px;border-radius:3px;font-size:.65rem;background:#161b22; }
  .mb-term-status.connected { color:var(--mb-green); }
  .mb-term-status.connecting { color:var(--mb-orange); }
  .mb-term-output { flex:1;overflow-y:auto;padding:8px 12px;font-family:'JetBrains Mono','Cascadia Code','Fira Code',Consolas,monospace;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all;color:#cdd9e5; }
  .mb-term-input-row { display:flex;align-items:center;gap:6px;padding:4px 12px 6px;border-top:1px solid #161b22;flex-shrink:0; }
  .mb-term-prompt { color:var(--mb-green);font-family:monospace;font-size:12.5px;flex-shrink:0; }
  .mb-term-input { flex:1;background:none;border:none;outline:none;color:#cdd9e5;font-family:'JetBrains Mono','Fira Code',Consolas,monospace;font-size:12.5px;caret-color:var(--mb-green); }
  .mb-term-input::placeholder { color:#4d5966; }
  /* ANSI colors */
  .a30{color:#4d5966}.a31{color:#f85149}.a32{color:#3fb950}.a33{color:#d29922}
  .a34{color:#818cf8}.a35{color:#c0a0f8}.a36{color:#39d4e6}.a37{color:#cdd9e5}
  .a90{color:#8b949e}.a91{color:#ff7b72}.a92{color:#56d364}.a93{color:#e3b341}
  .a94{color:#a0b4fc}.a95{color:#d2a8ff}.a96{color:#76e3f4}.a97{color:#f0f6fc}
  .ab{font-weight:700}.ai{font-style:italic}.au{text-decoration:underline}

  /* Status bar */
  .mb-statusbar { display:flex;align-items:center;gap:8px;padding:0 12px;height:24px;background:var(--mb-accent);background:linear-gradient(90deg,#1e2a4a,#141820);border-top:1px solid var(--mb-border);flex-shrink:0;font-size:.67rem;color:var(--mb-muted); }
  .mb-sb-sep { opacity:.4; }
  #mb-sb-session { color:var(--mb-green); }

  /* Scrollbar */
  .mb-term-output::-webkit-scrollbar,.mb-file-tree::-webkit-scrollbar { width:5px; }
  .mb-term-output::-webkit-scrollbar-track,.mb-file-tree::-webkit-scrollbar-track { background:transparent; }
  .mb-term-output::-webkit-scrollbar-thumb,.mb-file-tree::-webkit-scrollbar-thumb { background:#30363d;border-radius:2px; }
  `;
  document.head.appendChild(s);
}

// ── Bind events ───────────────────────────────────────────────
function _mbBind() {
  // Panel resize
  const rp = document.getElementById('mb-resize-panel');
  if (rp) {
    rp.addEventListener('mousedown', e => {
      _mb.dragging = 'panel';
      rp.classList.add('dragging');
      e.preventDefault();
    });
  }

  // Term resize
  const rt = document.getElementById('mb-resize-term');
  if (rt) {
    rt.addEventListener('mousedown', e => {
      _mb.dragging = 'term';
      rt.classList.add('dragging');
      e.preventDefault();
    });
  }

  document.addEventListener('mousemove', _mbDragMove);
  document.addEventListener('mouseup',   _mbDragEnd);

  // Keyboard shortcuts
  document.addEventListener('keydown', _mbShortcuts);

  // Keep terminal input row visible
  const inp = document.getElementById('mb-term-input');
  if (inp) inp.focus();
}

function _mbDragMove(e) {
  if (!_mb.dragging) return;
  if (_mb.dragging === 'panel') {
    const body = document.getElementById('mb-body');
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const w = Math.max(140, Math.min(480, e.clientX - rect.left));
    _mb.panelW = w;
    const ex = document.getElementById('mb-explorer');
    if (ex) ex.style.width = w + 'px';
  } else if (_mb.dragging === 'term') {
    const area = document.getElementById('mb-editor-area');
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const h = Math.max(80, Math.min(480, rect.bottom - e.clientY));
    _mb.termH = h;
    const term = document.getElementById('mb-term');
    if (term) term.style.height = h + 'px';
    if (_mb.editor) _mb.editor.layout();
  }
}

function _mbDragEnd() {
  if (!_mb.dragging) return;
  const rp = document.getElementById('mb-resize-panel');
  const rt = document.getElementById('mb-resize-term');
  if (rp) rp.classList.remove('dragging');
  if (rt) rt.classList.remove('dragging');
  _mb.dragging = null;
  if (_mb.editor) _mb.editor.layout();
}

function _mbShortcuts(e) {
  if (document.getElementById('mb-wrap') === null) {
    document.removeEventListener('keydown', _mbShortcuts);
    return;
  }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); _mbSaveActive(); }
  if (e.key === 'F5') { e.preventDefault(); _mbRunFile(); }
  if (e.ctrlKey && e.key === '`') { e.preventDefault(); _mbToggleTerm(); }
}

// ── Monaco init ───────────────────────────────────────────────
function _mbInitEditor() {
  if (typeof require === 'undefined' || !window.require) return;
  require.config({ paths: { vs: '/static/libs/monaco-editor/min/vs' } });
  require(['vs/editor/editor.main'], () => {
    const container = document.getElementById('mb-monaco-container');
    if (!container) return;
    _mb.editor = monaco.editor.create(container, {
      value: '',
      language: 'python',
      theme: 'vs-dark',
      fontSize: 13.5,
      fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',Consolas,monospace",
      fontLigatures: true,
      lineHeight: 22,
      minimap: { enabled: true, scale: 0.8 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      automaticLayout: true,
      padding: { top: 12 },
      bracketPairColorization: { enabled: true },
      wordWrap: 'off',
      tabSize: 4,
      insertSpaces: true,
    });
    _mb.editorReady = true;

    // Ctrl+S in editor
    _mb.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, _mbSaveActive);

    // Track changes → mark dirty
    _mb.editor.onDidChangeModelContent(() => {
      const t = _mb.tabs.find(t => t.path === _mb.activeTab);
      if (t && !t.dirty) {
        t.dirty = true;
        _mbRenderTabs();
      }
    });
  });
}

// ── Session management ────────────────────────────────────────
async function _mbCheckSession() {
  try {
    const d = await apiJson('/mbmbook/session');
    if (d.session) {
      _mb.session = d.session;
      _mbUpdateStatus();
      if (d.session.status === 'running') {
        _mbAfterRunning();
      } else if (d.session.status === 'starting') {
        _mbPollStatus();
      }
    }
  } catch {}
}

async function _mbStartSession() {
  const btn = document.getElementById('mb-start-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const d = await apiJson('/mbmbook/session/start', { method: 'POST' });
    _mb.session = d;
    _mbUpdateStatus();
    if (d.status === 'running') {
      _mbAfterRunning();
    } else {
      _mbPollStatus();
    }
  } catch (e) {
    _mbSetStatus('error', 'Failed to start: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.textContent = '▶ Start'; }
}

async function _mbStopSession() {
  try {
    await apiJson('/mbmbook/session/stop', { method: 'DELETE' });
    _mb.session = null;
    _mbDisconnectTerminal();
    _mbUpdateStatus();
    document.getElementById('mb-stop-btn').style.display = 'none';
    document.getElementById('mb-start-btn').style.display = '';
  } catch (e) {
    alert('Stop failed: ' + e.message);
  }
}

function _mbAfterRunning() {
  document.getElementById('mb-start-btn').style.display = 'none';
  document.getElementById('mb-stop-btn').style.display = '';
  _mbRefreshFiles();
  _mbConnectTerminal();
}

function _mbPollStatus() {
  if (_mb.polling) clearInterval(_mb.polling);
  _mb.polling = setInterval(async () => {
    try {
      const d = await apiJson('/mbmbook/session');
      if (!d.session) { clearInterval(_mb.polling); _mb.polling = null; return; }
      _mb.session = d.session;
      _mbUpdateStatus();
      if (d.session.status === 'running') {
        clearInterval(_mb.polling); _mb.polling = null;
        _mbAfterRunning();
      } else if (d.session.status === 'error') {
        clearInterval(_mb.polling); _mb.polling = null;
        _mbSetStatus('error', d.session.error_message || 'Container error');
      }
    } catch {}
  }, 2000);
}

function _mbUpdateStatus() {
  const s = _mb.session;
  const dot = document.getElementById('mb-dot');
  const txt = document.getElementById('mb-status-text');
  const sb  = document.getElementById('mb-sb-session');
  const sbn = document.getElementById('mb-sb-node');

  if (!s) {
    if (dot) { dot.className = 'mb-dot mb-dot-off'; }
    if (txt) txt.textContent = 'No session';
    if (sb)  sb.textContent = 'No container';
    if (sbn) sbn.textContent = 'local';
    return;
  }
  const cls = s.status === 'running' ? 'mb-dot-on' : s.status === 'starting' ? 'mb-dot-start' : 'mb-dot-off';
  if (dot) dot.className = `mb-dot ${cls}`;
  if (txt) txt.textContent = s.status === 'running' ? s.node_ip || 'local' : s.status;
  if (sb)  sb.textContent  = s.container_name || '';
  if (sbn) sbn.textContent = s.node_ip || 'local';
}

function _mbSetStatus(type, msg) {
  const txt = document.getElementById('mb-status-text');
  if (txt) txt.textContent = msg;
}

// ── File tree ─────────────────────────────────────────────────
async function _mbRefreshFiles() {
  try {
    const d = await apiJson('/mbmbook/files?path=/workspace');
    _mb.files = d.files || [];
    _mbRenderFileTree();
  } catch {}
}

function _mbRenderFileTree() {
  const tree = document.getElementById('mb-file-tree');
  const empty = document.getElementById('mb-tree-empty');
  if (!tree) return;

  if (!_mb.files.length) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Build tree
  const dirs = {};
  const roots = [];
  _mb.files.forEach(f => {
    if (!f.path) return;
    const parts = f.path.split('/');
    if (parts.length === 1) {
      roots.push(f);
    } else {
      const dir = parts.slice(0, -1).join('/');
      if (!dirs[dir]) dirs[dir] = [];
      dirs[dir].push(f);
    }
  });

  tree.innerHTML = roots.map(f => _mbFileItem(f)).join('');
}

function _mbFileItem(f) {
  const name = f.path.split('/').pop() || f.path;
  const fullPath = '/workspace/' + f.path;
  const isDir = f.type === 'dir';
  const cls = isDir ? 'mb-tree-dir' : 'mb-tree-file';
  const active = _mb.activeTab === fullPath ? ' active' : '';
  if (isDir) {
    return `<div class="mb-tree-item ${cls}${active}" style="font-weight:600">${name}/</div>`;
  }
  return `<div class="mb-tree-item ${cls}${active}" onclick="_mbOpenFile('${fullPath}')" title="${fullPath}">${name}</div>`;
}

// ── Tab management ────────────────────────────────────────────
async function _mbOpenFile(path) {
  const existing = _mb.tabs.find(t => t.path === path);
  if (existing) { _mbActivateTab(path); return; }

  try {
    const d = await apiJson('/mbmbook/files/read?path=' + encodeURIComponent(path));
    const content = d.content || '';
    const ext = path.split('.').pop();
    const lang = _LANGS[ext] || 'plaintext';

    let model = null;
    if (_mb.editorReady && monaco) {
      model = monaco.editor.createModel(content, lang, monaco.Uri.parse('file://' + path));
    }
    const label = path.split('/').pop();
    _mb.tabs.push({ path, label, dirty: false, model, lang });
    _mbActivateTab(path);
  } catch (e) {
    _mbTermWrite(`\r\n\x1b[31mCannot open ${path}: ${e.message}\x1b[0m\r\n`);
  }
}

function _mbActivateTab(path) {
  _mb.activeTab = path;
  const t = _mb.tabs.find(t => t.path === path);
  if (!t) return;

  // Show editor, hide welcome
  const welcome = document.getElementById('mb-welcome');
  const container = document.getElementById('mb-monaco-container');
  if (welcome) welcome.style.display = 'none';
  if (container) container.style.display = 'block';

  // Switch Monaco model
  if (_mb.editorReady && _mb.editor && t.model) {
    _mb.editor.setModel(t.model);
    const sel = document.getElementById('mb-lang-select');
    if (sel) sel.value = t.lang || 'python';
  }

  // Update status bar
  const sbf = document.getElementById('mb-sb-file');
  if (sbf) sbf.textContent = t.label;
  const sbl = document.getElementById('mb-sb-lang');
  if (sbl) sbl.textContent = t.lang || 'plaintext';

  _mbRenderTabs();
  _mbRenderFileTree();
}

function _mbCloseTab(path, e) {
  if (e) e.stopPropagation();
  const idx = _mb.tabs.findIndex(t => t.path === path);
  if (idx < 0) return;
  const t = _mb.tabs[idx];
  if (t.dirty && !confirm('Unsaved changes. Close anyway?')) return;
  if (t.model) { try { t.model.dispose(); } catch {} }
  _mb.tabs.splice(idx, 1);

  if (_mb.activeTab === path) {
    const next = _mb.tabs[idx] || _mb.tabs[idx - 1];
    if (next) { _mbActivateTab(next.path); }
    else {
      _mb.activeTab = null;
      const welcome = document.getElementById('mb-welcome');
      const container = document.getElementById('mb-monaco-container');
      if (welcome) welcome.style.display = 'flex';
      if (container) container.style.display = 'none';
      const sbf = document.getElementById('mb-sb-file');
      if (sbf) sbf.textContent = 'No file open';
    }
  }
  _mbRenderTabs();
}

function _mbRenderTabs() {
  const list = document.getElementById('mb-tabs-list');
  const empty = document.getElementById('mb-tab-empty');
  if (!list) return;

  if (!_mb.tabs.length) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = _mb.tabs.map(t => {
    const act = t.path === _mb.activeTab ? ' active' : '';
    const dirty = t.dirty ? ' mb-tab-dirty' : '';
    return `<div class="mb-tab${act}${dirty}" onclick="_mbActivateTab('${t.path}')">
      <span>${esc(t.label)}</span>
      <button class="mb-tab-close" onclick="_mbCloseTab('${t.path}',event)">×</button>
    </div>`;
  }).join('');
}

async function _mbSaveActive() {
  if (!_mb.activeTab || !_mb.editorReady || !_mb.editor) return;
  const t = _mb.tabs.find(t => t.path === _mb.activeTab);
  if (!t) return;
  const content = _mb.editor.getValue();
  try {
    await apiJson('/mbmbook/files/write', {
      method: 'POST',
      body: JSON.stringify({ path: _mb.activeTab, content }),
    });
    t.dirty = false;
    _mbRenderTabs();
    _mbTermWrite(`\x1b[32mSaved ${t.label}\x1b[0m\r\n`);
  } catch (e) {
    _mbTermWrite(`\x1b[31mSave failed: ${e.message}\x1b[0m\r\n`);
  }
}

function _mbSetLang(lang) {
  if (!_mb.editorReady || !_mb.editor) return;
  monaco.editor.setModelLanguage(_mb.editor.getModel(), lang);
  const t = _mb.tabs.find(t => t.path === _mb.activeTab);
  if (t) t.lang = lang;
  const sbl = document.getElementById('mb-sb-lang');
  if (sbl) sbl.textContent = lang;
}

async function _mbRunFile() {
  if (!_mb.activeTab) { _mbTermWrite('\x1b[33mNo file open\x1b[0m\r\n'); return; }
  if (_mb.tabs.find(t => t.path === _mb.activeTab)?.dirty) {
    await _mbSaveActive();
  }
  const t = _mb.tabs.find(t => t.path === _mb.activeTab);
  const lang = t?.lang || 'python';
  const runner = _RUNMAP[lang] || lang;
  const filePath = _mb.activeTab;
  let cmd;
  if (runner.includes('$$F')) {
    cmd = runner.replace('$$F', filePath);
  } else {
    cmd = `${runner} "${filePath}"`;
  }
  _mbSendTerminal(cmd + '\n');
  // Focus terminal
  const inp = document.getElementById('mb-term-input');
  if (inp) inp.focus();
}

// ── New file / folder ─────────────────────────────────────────
async function _mbNewFile() {
  if (!_mb.session || _mb.session.status !== 'running') {
    _mbTermWrite('\x1b[33mStart a session first (click ▶ Start).\x1b[0m\r\n');
    const btn = document.getElementById('mb-start-btn');
    if (btn) { btn.style.outline = '2px solid #818cf8'; setTimeout(() => btn.style.outline = '', 2000); }
    return;
  }
  const name = prompt('New file name:', 'main.py');
  if (!name) return;
  const path = '/workspace/' + name.replace(/^\/workspace\//, '');
  try {
    await apiJson('/mbmbook/files/write', {
      method: 'POST',
      body: JSON.stringify({ path, content: '' }),
    });
    await _mbRefreshFiles();
    await _mbOpenFile(path);
  } catch (e) {
    _mbTermWrite(`\x1b[31mError creating file: ${e.message}\x1b[0m\r\n`);
  }
}

async function _mbNewFolder() {
  const name = prompt('New folder name:', 'src');
  if (!name) return;
  const path = '/workspace/' + name;
  try {
    await apiJson('/mbmbook/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    await _mbRefreshFiles();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function _mbUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const r = await fetch(`${API}/mbmbook/files/upload?path=/workspace`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token },
      body: form,
    });
    if (!r.ok) throw new Error(await r.text());
    await _mbRefreshFiles();
    _mbTermWrite(`\x1b[32mUploaded ${file.name}\x1b[0m\r\n`);
  } catch (e) {
    _mbTermWrite(`\x1b[31mUpload failed: ${e.message}\x1b[0m\r\n`);
  }
  input.value = '';
}

// ── WebSocket terminal ────────────────────────────────────────
function _mbConnectTerminal() {
  _mbDisconnectTerminal();
  if (!_mb.session || _mb.session.status !== 'running') return;
  _mbTermSetStatus('connecting');

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/mbmbook/terminal?token=${state.token}`);
  ws.binaryType = 'arraybuffer';
  _mb.ws = ws;

  ws.onopen = () => {
    _mbTermSetStatus('connected');
    _mbSendResize();
    _mbTermWrite('\x1b[2J\x1b[H');  // clear screen
  };

  ws.onmessage = e => {
    const bytes = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : new TextEncoder().encode(e.data);
    _mbTermWrite(_mbAnsiToHtml(new TextDecoder().decode(bytes)));
  };

  ws.onclose = () => {
    _mb.ws = null;
    _mbTermSetStatus('disconnected');
  };
  ws.onerror = () => {
    _mbTermSetStatus('disconnected');
  };
}

function _mbDisconnectTerminal() {
  if (_mb.ws) { try { _mb.ws.close(); } catch {} _mb.ws = null; }
  _mbTermSetStatus('disconnected');
}

function _mbReconnectTerminal() {
  _mbDisconnectTerminal();
  setTimeout(_mbConnectTerminal, 300);
}

function _mbSendTerminal(data) {
  if (!_mb.ws || _mb.ws.readyState !== 1) {
    _mbTermWrite('\x1b[33mTerminal not connected. Start a session first.\x1b[0m\r\n');
    return;
  }
  _mb.ws.send(new TextEncoder().encode(data));
}

function _mbSendResize() {
  if (!_mb.ws || _mb.ws.readyState !== 1) return;
  const term = document.getElementById('mb-term-output');
  if (term) {
    _mb.termCols = Math.max(40, Math.floor(term.clientWidth / 7.5));
    _mb.termRows = Math.max(10, Math.floor((term.clientHeight || 120) / 18));
  }
  _mb.ws.send(JSON.stringify({ type: 'resize', rows: _mb.termRows, cols: _mb.termCols }));
}

function _mbTermSetStatus(s) {
  const el = document.getElementById('mb-term-status');
  if (!el) return;
  el.textContent = s;
  el.className = 'mb-term-status ' + s;
}

function _mbToggleTerm() {
  const t = document.getElementById('mb-term');
  const btn = document.getElementById('mb-term-toggle');
  _mb.termOpen = !_mb.termOpen;
  if (t) t.style.height = _mb.termOpen ? _mb.termH + 'px' : '34px';
  if (btn) btn.textContent = _mb.termOpen ? '▼' : '▲';
  if (_mb.editor) _mb.editor.layout();
}

function _mbTogglePanel() {
  const ex = document.getElementById('mb-explorer');
  const rp = document.getElementById('mb-resize-panel');
  if (!ex) return;
  const hidden = ex.style.display === 'none';
  ex.style.display = hidden ? 'flex' : 'none';
  if (rp) rp.style.display = hidden ? '' : 'none';
  if (_mb.editor) _mb.editor.layout();
}

function _mbClearTerminal() {
  const out = document.getElementById('mb-term-output');
  if (out) out.innerHTML = '';
}

function _mbTermWrite(html) {
  const out = document.getElementById('mb-term-output');
  if (!out) return;
  // Prevent unbounded growth
  if (out.children.length > 3000) out.innerHTML = '';
  const span = document.createElement('span');
  span.innerHTML = html;
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

function _mbTermKey(e) {
  const inp = e.target;
  if (e.key === 'Enter') {
    const cmd = inp.value;
    inp.value = '';
    _mb.termInput = '';
    if (cmd.trim()) {
      _mb.termHistory.unshift(cmd);
      if (_mb.termHistory.length > 100) _mb.termHistory.pop();
    }
    _mb.termHistIdx = -1;
    if (cmd.trim() === 'clear') { _mbClearTerminal(); return; }
    _mbSendTerminal(cmd + '\n');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (_mb.termHistIdx < _mb.termHistory.length - 1) {
      _mb.termHistIdx++;
      inp.value = _mb.termHistory[_mb.termHistIdx] || '';
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (_mb.termHistIdx > 0) {
      _mb.termHistIdx--;
      inp.value = _mb.termHistory[_mb.termHistIdx] || '';
    } else {
      _mb.termHistIdx = -1;
      inp.value = '';
    }
  } else if (e.ctrlKey && e.key === 'c') {
    _mbSendTerminal('\x03');
    inp.value = '';
  } else if (e.ctrlKey && e.key === 'd') {
    _mbSendTerminal('\x04');
  } else if (e.ctrlKey && e.key === 'l') {
    e.preventDefault();
    _mbClearTerminal();
  }
}

// ── ANSI → HTML ───────────────────────────────────────────────
function _mbAnsiToHtml(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .replace(/\x1b\[([0-9;]*)m/g, (_,p) => {
      if (!p || p==='0' || p==='00') return '</span><span>';
      const classes = p.split(';').map(n => {
        if (n==='1') return 'ab'; if (n==='3') return 'ai'; if (n==='4') return 'au';
        if ((+n>=30&&+n<=37)||+n===90||(+n>=91&&+n<=97)) return 'a'+n;
        return '';
      }).filter(Boolean).join(' ');
      return classes ? `<span class="${classes}">` : '<span>';
    })
    .replace(/\x1b\[[0-9;]*[A-HJKSf]/g,'')  // cursor movements
    .replace(/\x1b\[[?][0-9]+[hl]/g,'')      // mode changes
    .replace(/\x1b\[[0-9;]*J/g,'')           // clear screen
    .replace(/\x07/g,'');                     // bell
}

// ── Cleanup (called by core.js logout) ────────────────────────
function _mbCleanup() {
  if (_mb.polling) { clearInterval(_mb.polling); _mb.polling = null; }
  _mbDisconnectTerminal();
  document.removeEventListener('mousemove', _mbDragMove);
  document.removeEventListener('mouseup',   _mbDragEnd);
  document.removeEventListener('keydown',   _mbShortcuts);
  document.removeEventListener('fullscreenchange', _mbFsChange);
  if (_mbThemeObserver) { _mbThemeObserver.disconnect(); _mbThemeObserver = null; }

  // Stop container on logout so resources are freed and per-user cleanup happens
  if (_mb.session && _mb.session.status === 'running') {
    _mbLogAdmin('mbmbook_logout', `Container stopped on logout for ${(state && state.user && state.user.name) || 'user'} at ${_mbISTNow()}`);
    // Fire-and-forget — don't block logout
    try { fetch(`${API}/mbmbook/session/stop`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + (state && state.token) } }).catch(() => {}); } catch {}
  }

  // Exit fullscreen if active
  if (document.fullscreenElement) {
    try { document.exitFullscreen(); } catch {}
  }

  if (_mb.editor) { try { _mb.editor.dispose(); } catch {} _mb.editor = null; _mb.editorReady = false; }
  _mb.tabs.forEach(t => { if (t.model) { try { t.model.dispose(); } catch {} } });
  _mb.tabs = []; _mb.activeTab = null; _mb.session = null;
}
