/* ascii_overlay.js — Two-layer ASCII composite (sepia luminance + sigil ignitions)
 * Reads window.audioReact (Agent 1 contract): rms, envelopes.sub, onsets.{sub,low,mid,high}, barTick.
 * Layer 1: dense sepia luminance fill via 10-level ramp, RMS-driven gamma + ramp index offset.
 * Layer 2: sparse white-with-cyan-glow sigils that ignite on transient onsets, fade over 6 frames.
 * Density drops with sub-band envelope — bass hits punch holes (breathe-then-bloom).
 */

const asciiCanvas = document.getElementById('asciiCanvas');
const togAscii = document.getElementById('togAscii');
const asciiCtx = asciiCanvas.getContext('2d', { willReadFrequently: true });

// 10-level luminance ramp (Llama-BPE-friendly; braille was noise past 6 rows).
// Cycle through 4 character ramps on bar boundary for visual variety
const RAMPS = [
  ' .:-=+*#%@',          // block density (classic)
  " .,:;!|*?#@",         // text-like density
  ' ░▒▓█',               // shaded blocks (chunky)
  '·∙•◦○●◉◈◆',           // geometric dots (sigil-leaning)
];
let _rampIdx = 0;
let _rampBeatCounter = 0;
let _lastBeatSeen = -1;
function getRamp() {
  const ar = window.audioReact;
  // Swap on every beatTick (4× faster than barTick) so the ramp shifts ~120bpm/sec
  if (ar) {
    if (ar.beatTick && ar.beat !== _lastBeatSeen) {
      _lastBeatSeen = ar.beat;
      _rampBeatCounter++;
      _rampIdx = ((_rampBeatCounter % RAMPS.length) + RAMPS.length) % RAMPS.length;
    }
  }
  return RAMPS[_rampIdx];
}
let RAMP = RAMPS[0]; // mutable; refreshed each frame
const SIGIL_CHARS = ['#', '%', '@', '&', '*', '+'];

// Fixed cell geometry — yields ~140 cols x 60 rows on 1280x720 viewport.
// Bridge override: window._vfxAsciiCell may set CELL_H per frame; we preserve 8:12 aspect.
const DEFAULT_CELL_W = 8;
const DEFAULT_CELL_H = 12;
let CELL_W = DEFAULT_CELL_W;
let CELL_H = DEFAULT_CELL_H;
let _vfxLastCell = -1;

let asciiOn = true;
const offC = document.createElement('canvas');
const offCtx = offC.getContext('2d', { willReadFrequently: true });

// Sigil pool entries: { x, y, char, born, life, hue }
let sigils = [];
let frameCounter = 0;

function resizeAscii() {
  const wrap = document.getElementById('stageWrap');
  if (!wrap) return;
  asciiCanvas.width = wrap.clientWidth;
  asciiCanvas.height = wrap.clientHeight;
}
window.addEventListener('resize', resizeAscii);
resizeAscii();

function getStageCanvas() {
  return document.querySelector('#stageWrap canvas.p5Canvas');
}

function readAudio() {
  const a = (window.audioReact) || {};
  const env = a.envelopes || {};
  const ons = a.onsets || {};
  return {
    rms: typeof a.rms === 'number' ? a.rms : 0,
    sub: typeof env.sub === 'number' ? env.sub : 0,
    onSub: !!ons.sub,
    onLow: !!ons.low,
    onMid: !!ons.mid,
    onHigh: !!ons.high,
    barTick: !!a.barTick,
  };
}

function spawnSigils(audio, lumGrid, cols, rows) {
  // Aggregate onset intensity. Sub hits matter most; high hits sparkle softer.
  const intensity =
    (audio.onSub ? 1.0 : 0) +
    (audio.onLow ? 0.8 : 0) +
    (audio.onMid ? 0.7 : 0) +
    (audio.onHigh ? 0.6 : 0);
  if (intensity <= 0) return;

  // Bridge override: window._vfxSigilCount replaces internal N when present.
  const _vfxN = (window._vfxSigilCount != null) ? window._vfxSigilCount : null;
  const N = (_vfxN != null) ? Math.max(0, Math.round(_vfxN)) : Math.floor(6 + intensity * 14);
  if (N <= 0) return;

  // Collect bright cells (lum > 180). Sparse sample for cheapness.
  const bright = [];
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < cols; x += 2) {
      if (lumGrid[y * cols + x] > 180) bright.push((y << 16) | x);
    }
  }
  if (!bright.length) return;

  for (let k = 0; k < N; k++) {
    const packed = bright[(Math.random() * bright.length) | 0];
    const sx = packed & 0xffff;
    const sy = packed >>> 16;
    const ch = SIGIL_CHARS[(Math.random() * SIGIL_CHARS.length) | 0];
    sigils.push({
      x: sx,
      y: sy,
      char: ch,
      born: frameCounter,
      life: 6,
      hue: audio.barTick ? 50 : 190, // bar tick warms; otherwise cyan
    });
  }

  // Cap pool so a sustained barrage cannot blow it up.
  if (sigils.length > 400) sigils = sigils.slice(-400);
}

function drawAsciiOverlay() {
  RAMP = getRamp();
  if (!asciiOn) return;

  const src = getStageCanvas();
  if (!src) return;

  const w = asciiCanvas.width;
  const h = asciiCanvas.height;
  if (w <= 0 || h <= 0) return;

  // Bridge override: window._vfxAsciiCell sets CELL_H per frame (preserve 8:12 aspect).
  // Throttle: only re-derive when the value actually changes — avoids font-string thrash.
  const _vfxCellRaw = (typeof window._vfxAsciiCell === 'number' && isFinite(window._vfxAsciiCell))
    ? window._vfxAsciiCell : null;
  const _targetCellH = (_vfxCellRaw != null) ? Math.max(4, Math.round(_vfxCellRaw)) : DEFAULT_CELL_H;
  if (_targetCellH !== _vfxLastCell) {
    CELL_H = _targetCellH;
    CELL_W = Math.max(2, Math.round(_targetCellH * (DEFAULT_CELL_W / DEFAULT_CELL_H)));
    _vfxLastCell = _targetCellH;
  }

  const cols = Math.max(20, Math.floor(w / CELL_W));
  const rows = Math.max(14, Math.floor(h / CELL_H));

  // Solid black-ish background — let stage punch through ~8%.
  asciiCtx.fillStyle = 'rgba(0, 0, 0, 0.92)';
  asciiCtx.fillRect(0, 0, w, h);

  // Downsample stage canvas into low-res grid.
  offC.width = cols;
  offC.height = rows;
  offCtx.drawImage(src, 0, 0, cols, rows);
  const imgData = offCtx.getImageData(0, 0, cols, rows);
  const d = imgData.data;

  const audio = readAudio();

  // Tonemap: gamma drops on hits => brighter highlights (do NOT multiply canvas by gain).
  const gamma = 1.0 - audio.rms * 0.4;
  // Ramp offset: bridge (window._vfxAsciiBright, 0..3) overrides; else audio-reactive fallback.
  const rampOffset = (window._vfxAsciiBright != null)
    ? Math.round(window._vfxAsciiBright)
    : Math.floor(audio.rms * 3);
  // Density: bridge (window._vfxAsciiDensity, 0..1) overrides; else sub-envelope drop.
  const density = (window._vfxAsciiDensity != null)
    ? window._vfxAsciiDensity
    : (1.0 - audio.sub * 0.5);

  asciiCtx.textBaseline = 'top';
  asciiCtx.font = `${CELL_H}px "Courier New", Courier, monospace`;
  asciiCtx.shadowBlur = 0;
  asciiCtx.shadowColor = 'transparent';

  // Luminance grid (Uint8) — sigil spawn samples it for bright cells.
  const lumGrid = new Uint8Array(cols * rows);

  // ---- Layer 1: sepia luminance fill ----
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const a = d[i + 3];
      const lumRaw = (a < 16) ? 0 : (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      lumGrid[y * cols + x] = lumRaw | 0;

      if (a < 16) continue;
      // Density drop on bass — skip cells stochastically.
      if (density < 1.0 && Math.random() > density) continue;

      // Tonemap.
      const lt = Math.pow(lumRaw / 255, gamma) * 255;
      let idx = Math.floor((lt / 255) * (RAMP.length - 1)) + rampOffset;
      if (idx < 0) idx = 0;
      else if (idx > RAMP.length - 1) idx = RAMP.length - 1;
      const ch = RAMP[idx];
      if (ch === ' ') continue;

      // Sepia/cream — slightly warmer/brighter on hits.
      const lit = 58 + (lt / 255) * 15; // 58..73
      asciiCtx.fillStyle = `hsla(38, 25%, ${lit.toFixed(1)}%, 0.85)`;
      asciiCtx.fillText(ch, x * CELL_W, y * CELL_H);
    }
  }

  // ---- Layer 2: sparse sigils ----
  spawnSigils(audio, lumGrid, cols, rows);

  if (sigils.length) {
    const next = [];
    for (let s = 0; s < sigils.length; s++) {
      const sig = sigils[s];
      const age = frameCounter - sig.born;
      if (age >= sig.life) continue;
      const fade = 1.0 - age / sig.life;
      asciiCtx.shadowColor = `hsla(${sig.hue}, 100%, 60%, ${(0.9 * fade).toFixed(3)})`;
      asciiCtx.shadowBlur = 8 + 6 * fade;
      asciiCtx.fillStyle = `rgba(255,255,255,${(0.85 * fade).toFixed(3)})`;
      asciiCtx.fillText(sig.char, sig.x * CELL_W, sig.y * CELL_H);
      next.push(sig);
    }
    asciiCtx.shadowBlur = 0;
    asciiCtx.shadowColor = 'transparent';
    sigils = next;
  }

  frameCounter++;
}

if (togAscii) {
  togAscii.addEventListener('click', () => {
    asciiOn = !asciiOn;
    togAscii.classList.toggle('on', asciiOn);
    togAscii.textContent = asciiOn ? 'ASCII: ON' : 'ASCII: OFF';
    asciiCanvas.style.opacity = asciiOn ? '0.30' : '0';
    if (!asciiOn) asciiCtx.clearRect(0, 0, asciiCanvas.width, asciiCanvas.height);
  });
}

// Banners removed — sigil layer replaces them. No fetch needed.

asciiCanvas.style.opacity = '0.30';
(function loop() {
  drawAsciiOverlay();
  requestAnimationFrame(loop);
})();
