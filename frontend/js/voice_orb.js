/* VoiceOrb — organic animated blob for MAC voice chat.
   Exposes window.VoiceOrb.
   API: new VoiceOrb(canvas) → orb
        orb.setState('idle' | 'listening' | 'speaking')
        orb.setLevel(0..1)
        orb.destroy()
*/
(function () {
  'use strict';

  function makeNoise(seed) {
    let s = seed >>> 0;
    function rand(i, j) {
      let n = (i * 374761393 + j * 668265263 + s * 1442695040888963407) | 0;
      n = (n ^ (n >> 13)) * 1274126177;
      n = n ^ (n >> 16);
      return ((n >>> 0) % 100000) / 100000;
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    return function noise2(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      return lerp(
        lerp(rand(xi, yi), rand(xi + 1, yi), smooth(xf)),
        lerp(rand(xi, yi + 1), rand(xi + 1, yi + 1), smooth(xf)),
        smooth(yf)
      ) * 2 - 1;
    };
  }

  const PALETTE = {
    coreHi: '#fff1e3',
    core:   '#ffd2a8',
    mid:    '#f0a576',
    edge:   '#d97757',
    deep:   '#b85a3c',
  };

  class VoiceOrb {
    constructor(canvas, opts = {}) {
      if (!canvas) throw new Error('VoiceOrb: canvas required');
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({
        baseRadiusFactor: 0.34,
        layers: [
          { count: 9, amp: 0.05, speed: 0.00022, fill: PALETTE.deep, alpha: 0.55, scale: 1.04, phase: 0.0 },
          { count: 7, amp: 0.07, speed: 0.00035, fill: PALETTE.edge, alpha: 0.95, scale: 1.00, phase: 1.7 },
          { count: 5, amp: 0.09, speed: 0.00050, fill: PALETTE.mid,  alpha: 0.85, scale: 0.92, phase: 3.3 },
        ],
      }, opts);

      this.state = 'idle';
      this.level = 0;
      this._levelSmoothed = 0;
      this._t0 = performance.now();
      this._lastT = this._t0;
      this._raf = 0;
      this._destroyed = false;
      this._noise = [makeNoise(0xa11ce), makeNoise(0x3eedb), makeNoise(0xc1a0de)];

      this._resize = this._resize.bind(this);
      this._frame = this._frame.bind(this);
      window.addEventListener('resize', this._resize);
      this._resize();
      this._raf = requestAnimationFrame(this._frame);
    }

    setState(s) {
      if (s === 'idle' || s === 'listening' || s === 'speaking') this.state = s;
    }

    setLevel(v) {
      if (v > 1.5) v = v / 100;
      if (!isFinite(v)) v = 0;
      this.level = Math.max(0, Math.min(1, v));
    }

    destroy() {
      this._destroyed = true;
      cancelAnimationFrame(this._raf);
      window.removeEventListener('resize', this._resize);
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width)  | 0;
      const h = Math.max(1, rect.height) | 0;
      this.canvas.width  = (w * dpr) | 0;
      this.canvas.height = (h * dpr) | 0;
      this._dpr = dpr;
      this._w = w;
      this._h = h;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    _frame(now) {
      if (this._destroyed) return;
      const dt = Math.min(64, now - this._lastT);
      this._lastT = now;
      const t = now - this._t0;
      const k = 1 - Math.exp(-dt / 90);
      this._levelSmoothed += (this.level - this._levelSmoothed) * k;
      this._draw(t, this._levelSmoothed);
      this._raf = requestAnimationFrame(this._frame);
    }

    _stateParams(level) {
      switch (this.state) {
        case 'speaking':
          return { breath: 0.08 + level * 0.22, edgeAmp: 1.0 + level * 1.6, speed: 1.4 + level * 1.2, glow: 0.85 + level * 0.4 };
        case 'listening':
          return { breath: 0.04 + level * 0.18, edgeAmp: 0.85 + level * 1.2, speed: 1.0 + level * 0.6, glow: 0.6 + level * 0.5 };
        default:
          return { breath: 0.025, edgeAmp: 0.7, speed: 0.7, glow: 0.45 };
      }
    }

    _draw(t, level) {
      const { ctx, _w: w, _h: h } = this;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const baseR = Math.min(w, h) * this.opts.baseRadiusFactor;
      const sp = this._stateParams(level);
      const breath = 1 + Math.sin(t * 0.0014) * sp.breath * 0.45
                       + Math.sin(t * 0.0007 + 1.3) * sp.breath * 0.55;
      const R = baseR * breath;

      const glowR = R * (1.9 + 0.25 * level);
      const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, glowR);
      glow.addColorStop(0,   `rgba(217,119,87,${0.35 * sp.glow})`);
      glow.addColorStop(0.5, `rgba(240,165,118,${0.12 * sp.glow})`);
      glow.addColorStop(1,   'rgba(255,180,130,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      this.opts.layers.forEach((layer, i) => {
        const noise = this._noise[i % this._noise.length];
        const r0 = R * layer.scale;
        const tt = t * layer.speed * sp.speed;
        const amp = layer.amp * sp.edgeAmp;
        ctx.save();
        ctx.globalAlpha = layer.alpha;
        ctx.fillStyle = layer.fill;
        ctx.beginPath();
        this._traceBlob(cx, cy, r0, layer.count, amp, tt + layer.phase, noise);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      const hlx = cx - R * 0.28, hly = cy - R * 0.32;
      const hl = ctx.createRadialGradient(hlx, hly, R * 0.05, cx, cy, R * 1.05);
      hl.addColorStop(0.00, 'rgba(255,241,227,0.95)');
      hl.addColorStop(0.18, 'rgba(255,210,168,0.55)');
      hl.addColorStop(0.55, 'rgba(240,165,118,0.05)');
      hl.addColorStop(1.00, 'rgba(184,90,60,0.0)');

      ctx.save();
      ctx.beginPath();
      const front = this.opts.layers[1];
      this._traceBlob(cx, cy, R * front.scale, front.count,
                      front.amp * sp.edgeAmp,
                      t * front.speed * sp.speed + front.phase,
                      this._noise[1]);
      ctx.closePath();
      ctx.clip();

      ctx.fillStyle = hl;
      ctx.fillRect(cx - R * 1.4, cy - R * 1.4, R * 2.8, R * 2.8);

      const swx = cx + Math.cos(t * 0.0006) * R * 0.18;
      const swy = cy + Math.sin(t * 0.0008 + 1.1) * R * 0.18;
      const sw = ctx.createRadialGradient(swx, swy, R * 0.02, swx, swy, R * 0.85);
      sw.addColorStop(0, 'rgba(255,230,200,0.55)');
      sw.addColorStop(0.6, 'rgba(255,210,168,0.0)');
      ctx.fillStyle = sw;
      ctx.fillRect(cx - R * 1.4, cy - R * 1.4, R * 2.8, R * 2.8);

      const sw2x = cx + Math.cos(t * 0.0004 + 2.4) * R * 0.22;
      const sw2y = cy + Math.sin(t * 0.0005 + 0.7) * R * 0.22;
      const sw2 = ctx.createRadialGradient(sw2x, sw2y, R * 0.02, sw2x, sw2y, R * 0.7);
      sw2.addColorStop(0, 'rgba(184,90,60,0.28)');
      sw2.addColorStop(1, 'rgba(184,90,60,0.0)');
      ctx.fillStyle = sw2;
      ctx.fillRect(cx - R * 1.4, cy - R * 1.4, R * 2.8, R * 2.8);

      const rim = ctx.createRadialGradient(cx + R * 0.55, cy + R * 0.55, R * 0.2, cx, cy, R * 1.05);
      rim.addColorStop(0.55, 'rgba(120,40,15,0.0)');
      rim.addColorStop(1.00, 'rgba(120,40,15,0.45)');
      ctx.fillStyle = rim;
      ctx.fillRect(cx - R * 1.4, cy - R * 1.4, R * 2.8, R * 2.8);
      ctx.restore();

      ctx.save();
      const sparkR = R * 0.13;
      const spark = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.40, 0, cx - R * 0.34, cy - R * 0.40, sparkR);
      spark.addColorStop(0, 'rgba(255,255,250,0.85)');
      spark.addColorStop(1, 'rgba(255,255,250,0)');
      ctx.fillStyle = spark;
      ctx.beginPath();
      ctx.arc(cx - R * 0.34, cy - R * 0.40, sparkR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _traceBlob(cx, cy, r, count, amp, t, noise) {
      const ctx = this.ctx;
      const N = Math.max(48, count * 10);
      const pts = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const nx = Math.cos(a) * count, ny = Math.sin(a) * count;
        const n1 = noise(nx + t, ny - t * 0.5);
        const n2 = noise(nx * 2.0 + t * 1.7, ny * 2.0 - t * 0.9) * 0.5;
        const rr = r + (n1 + n2) * amp * r;
        pts[i] = [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
      }
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let m0 = mid(pts[N - 1], pts[0]);
      ctx.moveTo(m0[0], m0[1]);
      for (let i = 0; i < N; i++) {
        const p = pts[i], next = pts[(i + 1) % N];
        const m = mid(p, next);
        ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
      }
    }
  }

  window.VoiceOrb = VoiceOrb;
})();
