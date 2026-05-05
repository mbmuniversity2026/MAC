const { invoke } = window.__TAURI__.core;

let currentStep = 0;
const TOTAL_STEPS = 6;
let selectedRole = 'host';
let hwInfo = null;

/* ── Watermark words (same as auth.js) ── */
const WM_WORDS = [
  {text:'MAC',x:7,y:8,size:42,rot:-8},{text:'MBM',x:82,y:12,size:20,rot:5},
  {text:'AI',x:55,y:5,size:32,rot:3},{text:'CLOUD',x:15,y:50,size:18,rot:-4},
  {text:'MODELS',x:72,y:42,size:16,rot:7},{text:'CHAT',x:42,y:85,size:24,rot:-6},
  {text:'LEARN',x:65,y:72,size:14,rot:9},{text:'JODHPUR',x:5,y:75,size:12,rot:-3},
  {text:'INFERENCE',x:30,y:20,size:12,rot:5},{text:'NOTEBOOK',x:80,y:28,size:13,rot:-9},
  {text:'GPU',x:58,y:30,size:22,rot:6},{text:'NEURAL',x:3,y:28,size:13,rot:-7},
  {text:'PYTHON',x:75,y:88,size:11,rot:10},{text:'VECTOR',x:40,y:2,size:11,rot:-5},
  {text:'RAG',x:8,y:92,size:16,rot:3},{text:'CLUSTER',x:25,y:60,size:14,rot:4},
  {text:'DOCKER',x:88,y:55,size:12,rot:-6},{text:'vLLM',x:50,y:45,size:15,rot:2},
];

/* ── Physics watermark init ── */
let _wmObjs = [], _wmMouse = {x:-9999,y:-9999}, _wmRaf = null;
function initWatermark() {
  const layer = document.getElementById('wm-layer');
  if (!layer) return;
  layer.innerHTML = WM_WORDS.map((w,i) =>
    `<span class="wm-word" style="left:${w.x}%;top:${w.y}%;font-size:${w.size}px;transform:rotate(${w.rot}deg)">${w.text}</span>`
  ).join('');
  requestAnimationFrame(() => {
    _wmObjs = [...layer.querySelectorAll('.wm-word')].map((el,i) => {
      const r = el.getBoundingClientRect();
      return {el, rot:WM_WORDS[i].rot, origX:r.left+r.width/2, origY:r.top+r.height/2, currX:r.left+r.width/2, currY:r.top+r.height/2, vx:0, vy:0, opacity:.06};
    });
    wmLoop();
  });
  window.addEventListener('mousemove', e => { _wmMouse.x=e.clientX; _wmMouse.y=e.clientY; });
  window.addEventListener('mouseleave', () => { _wmMouse.x=-9999; _wmMouse.y=-9999; });
}
function wmLoop() {
  if (!document.getElementById('wm-layer')) return;
  for (const w of _wmObjs) {
    const dx=w.currX-_wmMouse.x, dy=w.currY-_wmMouse.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
    const near = dist < 260;
    w.opacity += ((near ? .06+(1-dist/260)*.49 : .06) - w.opacity) * .1;
    w.el.style.opacity = w.opacity.toFixed(3);
    if (dist < 320) { const f=((320-dist)/320)*260; w.vx+=(dx/dist)*f*.12; w.vy+=(dy/dist)*f*.12; }
    w.vx += (w.origX-w.currX)*.055; w.vy += (w.origY-w.currY)*.055;
    w.vx *= .8; w.vy *= .8; w.currX += w.vx; w.currY += w.vy;
    w.el.style.transform = `rotate(${w.rot}deg) translate(${(w.currX-w.origX).toFixed(1)}px,${(w.currY-w.origY).toFixed(1)}px)`;
  }
  _wmRaf = requestAnimationFrame(wmLoop);
}

/* ── Model definitions ── */
const MODELS = [
  // === AI Chat & Specialist Models ===
  {node:1, name:'Qwen2.5-7B-Instruct-AWQ', role:'Primary Chat', vram:5.0, hf:'Qwen/Qwen2.5-7B-Instruct-AWQ', checked:true, required:true, cat:'ai'},
  {node:2, name:'DeepSeek-R1-Distill-Qwen-7B', role:'Reasoning / Math', vram:5.0, hf:'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', checked:true, cat:'ai'},
  {node:3, name:'Qwen2.5-Coder-7B-AWQ', role:'Code / MBM Book', vram:5.0, hf:'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ', checked:true, cat:'ai'},
  {node:4, name:'Qwen2-VL-7B-Instruct-AWQ', role:'Vision / Copy Check', vram:6.5, hf:'Qwen/Qwen2-VL-7B-Instruct', checked:true, cat:'ai'},
  {node:5, name:'Mistral-7B-v0.3-AWQ', role:'Creative / Writing', vram:4.5, hf:'mistralai/Mistral-7B-Instruct-v0.3', checked:false, cat:'ai'},
  {node:6, name:'Qwen2.5-7B-AWQ (Hindi)', role:'Hindi Specialist', vram:5.0, hf:'Qwen/Qwen2.5-7B-Instruct-AWQ', checked:false, cat:'ai'},
  {node:7, name:'Qwen2.5-14B-Instruct-AWQ', role:'Long Context / Deep', vram:8.5, hf:'Qwen/Qwen2.5-14B-Instruct-AWQ', checked:false, cat:'ai'},
  {node:8, name:'Qwen2.5-3B-Instruct-AWQ', role:'Speed / Instant', vram:2.5, hf:'Qwen/Qwen2.5-3B-Instruct-AWQ', checked:true, cat:'ai'},
  {node:9, name:'nomic-embed-text-v1.5', role:'Embeddings / RAG', vram:0.5, hf:'nomic-ai/nomic-embed-text-v1.5', checked:true, cat:'ai'},
  {node:10, name:'Qwen2.5-7B-AWQ (Backup)', role:'Overflow / Fallback', vram:5.0, hf:'Qwen/Qwen2.5-7B-Instruct-AWQ', checked:false, cat:'ai'},
  // === Voice Models (TTS + STT) ===
  {node:11, name:'Veena TTS (Hindi/English)', role:'Neural Voice — Indian Accent', vram:2.0, hf:'maya-research/Veena', checked:true, cat:'voice'},
  {node:12, name:'Whisper Small (STT)', role:'Speech-to-Text — CPU', vram:0, hf:'Systran/faster-whisper-small', checked:true, cat:'voice'},
  {node:13, name:'Piper TTS (Offline Hindi)', role:'Fast Offline Hindi Voice', vram:0, hf:'rhasspy/piper-voices', checked:false, cat:'voice'},
  {node:14, name:'Whisper Medium (STT)', role:'Higher Accuracy STT', vram:0, hf:'Systran/faster-whisper-medium', checked:false, cat:'voice'},
];

/* ── Docker images to pull ── */
const DOCKER_IMAGES = [
  {name:'postgres:16-alpine', role:'PostgreSQL Database', size:'~80 MB', checked:true, required:true, hostOnly:true},
  {name:'redis:7-alpine', role:'Redis Cache + Pub/Sub', size:'~12 MB', checked:true, required:true, hostOnly:true},
  {name:'nginx:alpine', role:'Reverse Proxy + SSL + Static', size:'~25 MB', checked:true, required:true, hostOnly:true},
  {name:'vllm/vllm-openai:latest', role:'vLLM GPU Inference Engine', size:'~8 GB', checked:true, required:true},
  {name:'qdrant/qdrant:latest', role:'Vector DB for RAG', size:'~100 MB', checked:true, hostOnly:true},
  {name:'fedirz/faster-whisper-server:latest-cpu', role:'Whisper STT Server', size:'~1.5 GB', checked:true, hostOnly:true},
  {name:'searxng/searxng:latest', role:'Privacy Search Engine', size:'~200 MB', checked:false, hostOnly:true},
  {name:'dpage/pgadmin4:8', role:'Database Admin UI', size:'~400 MB', checked:false, hostOnly:true},
  {name:'jupyter/scipy-notebook:latest', role:'Jupyter Notebook Kernel', size:'~3 GB', checked:false},
];

const HOST_STEPS = [
  'Checking Docker installation',
  'Creating C:\\MAC directory',
  'Copying MAC platform source code',
  'Configuring PostgreSQL database',
  'Configuring Redis cache',
  'Setting up Nginx reverse proxy',
  'Opening firewall ports (80, 443, 8000)',
  'Generating SSL certificates',
  'Writing environment configuration',
  'Starting Docker containers',
  'Creating desktop shortcuts',
];
const WORKER_STEPS = [
  'Checking Docker installation',
  'Creating C:\\MAC directory',
  'Copying worker agent files',
  'Opening firewall port (8001)',
  'Writing worker configuration',
  'Registering with Host server',
  'Starting vLLM inference container',
  'Creating desktop shortcut',
];

function selectRole(role) {
  selectedRole = role;
  document.getElementById('role-host').classList.toggle('selected', role==='host');
  document.getElementById('role-worker').classList.toggle('selected', role==='worker');
  document.getElementById('host-ip-row').style.display = role==='worker' ? '' : 'none';
}

function updateUI() {
  document.querySelectorAll('.step').forEach((el,i) => {
    el.classList.remove('active','done');
    if (i < currentStep) el.classList.add('done');
    if (i === currentStep) el.classList.add('active');
  });
  document.querySelectorAll('.page').forEach((el,i) => el.classList.toggle('active', i===currentStep));
  document.querySelectorAll('.dot').forEach((el,i) => el.classList.toggle('active', i===currentStep));
  const back = document.getElementById('btn-back');
  const next = document.getElementById('btn-next');
  back.style.visibility = currentStep===0 ? 'hidden' : 'visible';
  if (currentStep === TOTAL_STEPS-1) {
    next.style.display = 'none';
  } else {
    next.style.display = '';
    next.innerHTML = currentStep===0
      ? 'Get Started <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
      : 'Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
  }
}

async function nextStep() {
  if (currentStep >= TOTAL_STEPS-1) return;
  currentStep++;
  updateUI();
  if (currentStep === 2) await runHardwareScan();
  if (currentStep === 3) renderModelTable();
  if (currentStep === 4) renderConfigReview();
  if (currentStep === 5) await runInstall();
}
function prevStep() { if (currentStep > 0) { currentStep--; updateUI(); } }

async function runHardwareScan() {
  document.getElementById('hw-scanning').style.display = '';
  document.getElementById('hw-results').style.display = 'none';
  try { hwInfo = await invoke('scan_hardware'); }
  catch(e) { hwInfo = {cpu_name:'Detection failed',cpu_cores:'?',gpu_name:'Not detected',gpu_vram:'?',nvidia_driver:'?',ram_total:'?',ip_address:'?',os_name:'?',docker_installed:false,docker_version:'Not found'}; }
  document.getElementById('hw-cpu').textContent = hwInfo.cpu_name;
  document.getElementById('hw-cores').textContent = hwInfo.cpu_cores + ' threads';
  document.getElementById('hw-gpu').textContent = hwInfo.gpu_name;
  document.getElementById('hw-vram').textContent = hwInfo.gpu_vram;
  document.getElementById('hw-driver').textContent = hwInfo.nvidia_driver;
  document.getElementById('hw-ram').textContent = hwInfo.ram_total;
  document.getElementById('hw-ip').textContent = hwInfo.ip_address || 'Not detected';
  document.getElementById('hw-os').textContent = hwInfo.os_name;
  document.getElementById('hw-docker').textContent = hwInfo.docker_version;
  const dc = document.getElementById('docker-card');
  if (hwInfo.docker_installed) { dc.classList.add('accent'); dc.style.borderColor = '#10b981'; }
  else { dc.style.borderColor = '#ef4444'; document.getElementById('docker-actions').style.display = ''; }
  document.getElementById('hw-scanning').style.display = 'none';
  document.getElementById('hw-results').style.display = '';
}

async function installDocker() {
  const btn = document.getElementById('install-docker-btn');
  btn.disabled = true; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Installing...';
  try { await invoke('install_docker'); btn.innerHTML = '✓ Installed — restart required'; btn.style.background='var(--green)'; hwInfo.docker_installed=true; }
  catch(e) { btn.innerHTML = 'Failed — install manually from docker.com'; btn.style.background='var(--red)'; }
}

function renderModelTable() {
  const isWorker = selectedRole==='worker';
  const aiModels = MODELS.filter(m => m.cat==='ai');
  const voiceModels = MODELS.filter(m => m.cat==='voice');
  const dockerImgs = DOCKER_IMAGES.filter(d => isWorker ? !d.hostOnly : true);
  
  document.getElementById('model-sub').textContent = isWorker
    ? 'Select models and containers for this Worker node'
    : 'Select AI models, voice engines, and Docker containers to install';
  const table = document.getElementById('model-table');
  
  function renderSection(title, icon, items, type) {
    const rows = items.map(m => {
      const id = type==='docker' ? `d-${m.name.replace(/[^a-z0-9]/gi,'')}` : `m-${m.node}`;
      const vramCol = type==='docker'
        ? `<span class="model-vram">${m.size}</span>`
        : `<span class="model-vram">${m.vram} GB<div class="model-vram-bar"><div class="model-vram-fill" style="width:${(m.vram/12)*100}%"></div></div></span>`;
      const hfCol = type==='docker'
        ? `<span class="model-hf">${m.name}</span>`
        : `<span class="model-hf">${m.hf}</span>`;
      return `<div class="model-row">
        <div class="model-check"><input type="checkbox" id="${id}" ${m.checked?'checked':''} ${m.required?'disabled':''} onchange="updateModelSummary()"></div>
        <span class="model-node">${type==='docker'?'⬡':'#'+(m.node||'')}</span>
        <div class="model-name-col"><span class="model-name">${type==='docker'?m.name:m.name}</span><span class="model-role">${m.role}</span></div>
        ${hfCol}
        ${vramCol}
      </div>`;
    }).join('');
    return `<div class="model-section-title">${icon} ${title}</div>
      <div class="model-row header"><span></span><span></span><span>Model / Role</span><span>${type==='docker'?'Image':'HuggingFace'}</span><span>${type==='docker'?'Size':'VRAM'}</span></div>
      ${rows}`;
  }
  
  table.innerHTML = 
    renderSection('AI Chat & Specialist Models','🧠', isWorker ? aiModels.slice(0,1) : aiModels, 'ai') +
    renderSection('Voice Models (TTS + STT)','🎙️', voiceModels, 'voice') +
    renderSection('Docker Infrastructure','🐳', dockerImgs, 'docker');
  updateModelSummary();
}

function updateModelSummary() {
  const selModels = MODELS.filter(m => {
    const el = document.getElementById(`m-${m.node}`);
    return el ? el.checked : m.checked;
  });
  const selDocker = DOCKER_IMAGES.filter(d => {
    const el = document.getElementById(`d-${d.name.replace(/[^a-z0-9]/gi,'')}`);
    return el ? el.checked : d.checked;
  });
  const totalVRAM = selModels.reduce((s,m) => s+m.vram, 0).toFixed(1);
  document.getElementById('model-summary').innerHTML = `
    <p><strong>${selModels.length}</strong> AI/voice models (~<strong>${totalVRAM} GB</strong> VRAM) + <strong>${selDocker.length}</strong> Docker containers · Downloads begin on first launch</p>
  `;
}

function renderConfigReview() {
  const selected = MODELS.filter(m => {
    const el = document.getElementById(`m-${m.node}`);
    return el ? el.checked : m.checked;
  });
  const hostIp = document.getElementById('host-ip-input')?.value || '';
  const r = document.getElementById('config-review');
  r.innerHTML = `
    <div class="config-section">
      <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1"/><circle cx="6" cy="18" r="1"/></svg> Installation Mode</h3>
      <div class="config-row"><span class="label">Role</span><span class="value">${selectedRole.toUpperCase()}</span></div>
      <div class="config-row"><span class="label">Install Path</span><span class="value">C:\\MAC</span></div>
      ${selectedRole==='worker' ? `<div class="config-row"><span class="label">Host IP</span><span class="value">${hostIp||'Not set'}</span></div>` : ''}
    </div>
    <div class="config-section">
      <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15" x2="12" y2="15"/></svg> Hardware</h3>
      <div class="config-row"><span class="label">GPU</span><span class="value">${hwInfo?.gpu_name||'—'}</span></div>
      <div class="config-row"><span class="label">VRAM</span><span class="value">${hwInfo?.gpu_vram||'—'}</span></div>
      <div class="config-row"><span class="label">RAM</span><span class="value">${hwInfo?.ram_total||'—'}</span></div>
      <div class="config-row"><span class="label">Network IP</span><span class="value">${hwInfo?.ip_address||'—'}</span></div>
      <div class="config-row"><span class="label">Docker</span><span class="value">${hwInfo?.docker_installed?'✓ Installed':'✗ Missing'}</span></div>
    </div>
    ${selectedRole==='host' ? `
    <div class="config-section">
      <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> Services (Host)</h3>
      <div class="config-row"><span class="label">PostgreSQL</span><span class="value">✓ Database</span></div>
      <div class="config-row"><span class="label">Redis</span><span class="value">✓ Cache + Pub/Sub</span></div>
      <div class="config-row"><span class="label">Nginx</span><span class="value">✓ Reverse proxy + SSL</span></div>
      <div class="config-row"><span class="label">FastAPI</span><span class="value">✓ MAC API server</span></div>
      <div class="config-row"><span class="label">vLLM</span><span class="value">✓ GPU inference</span></div>
      <div class="config-row"><span class="label">Qdrant</span><span class="value">✓ Vector search</span></div>
    </div>
    <div class="config-section">
      <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> AI Models (${selected.length} selected)</h3>
      ${selected.map(m => `<div class="config-row"><span class="label">${m.role}</span><span class="value">${m.name}</span></div>`).join('')}
    </div>` : ''}
  `;
}

async function runInstall() {
  const steps = selectedRole==='host' ? HOST_STEPS : WORKER_STEPS;
  const container = document.getElementById('install-steps');
  const fill = document.getElementById('progress-fill');
  const pct = document.getElementById('progress-pct');
  container.innerHTML = steps.map((s,i) => `
    <div class="install-step" id="is-${i}"><div class="is-icon">${i+1}</div><span>${s}</span></div>
  `).join('');
  for (let i=0; i<steps.length; i++) {
    const el = document.getElementById(`is-${i}`);
    el.classList.add('active');
    const progress = Math.round(((i+1)/steps.length)*100);
    fill.style.width = progress+'%'; pct.textContent = progress+'%';
    try {
      await executeStep(i, selectedRole);
      el.classList.remove('active'); el.classList.add('done');
      el.querySelector('.is-icon').textContent = '✓';
    } catch(e) {
      el.classList.remove('active'); el.classList.add('error');
      el.querySelector('.is-icon').textContent = '✗';
      const err = document.createElement('span'); err.className='err-detail';
      err.textContent = typeof e==='string'?e:'Skipped'; el.appendChild(err);
    }
  }
  document.getElementById('install-done').style.display = '';
}

async function executeStep(idx, role) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  if (role === 'host') {
    switch(idx) {
      case 0: await delay(500); if(!hwInfo?.docker_installed) throw 'Docker missing'; break;
      case 1: await delay(300); break;
      case 2: try{await invoke('copy_files',{source:'.',dest:'C:\\MAC'})}catch{await delay(800)} break;
      case 3: await delay(600); break; // Postgres config
      case 4: await delay(400); break; // Redis config
      case 5: await delay(500); break; // Nginx setup
      case 6: try{await invoke('open_firewall',{ports:[80,443,8000]})}catch{await delay(500)} break;
      case 7: await delay(600); break; // SSL gen
      case 8: await delay(300); break; // .env write
      case 9: try{await invoke('start_services',{installDir:'C:\\MAC',role:'host'})}catch{await delay(1000)} break;
      case 10: await delay(400); break;
    }
  } else {
    const hostIp = document.getElementById('host-ip-input')?.value || '192.168.1.100';
    switch(idx) {
      case 0: await delay(500); if(!hwInfo?.docker_installed) throw 'Docker missing'; break;
      case 1: await delay(300); break;
      case 2: try{await invoke('copy_files',{source:'.',dest:'C:\\MAC'})}catch{await delay(800)} break;
      case 3: try{await invoke('open_firewall',{ports:[8001]})}catch{await delay(500)} break;
      case 4: await delay(400); break; // Write .env.worker
      case 5: await delay(600); break; // Register with host
      case 6: try{await invoke('start_services',{installDir:'C:\\MAC',role:'worker'})}catch{await delay(1000)} break;
      case 7: await delay(300); break;
    }
  }
}

function launchMAC() {
  try { invoke('start_services',{installDir:'C:\\MAC',role:selectedRole}); } catch{}
  if (selectedRole==='host') window.open('http://localhost','_blank');
}

document.addEventListener('DOMContentLoaded', () => { updateUI(); initWatermark(); });
