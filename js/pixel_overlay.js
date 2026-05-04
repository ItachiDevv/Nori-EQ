/* pixel_overlay.js — real pixel art pipeline:
   contrast → posterize → downscale (nearest) → Floyd-Steinberg dither → upscale.
   16-color palette locked per bar (LSDJ-style), swapped on barTick.
   Reads window.audioReact: envelopes.mid, onsets.mid, barTick, bar (all defensive). */

const pixelCanvas = document.getElementById('pixelCanvas');
const togPixel    = document.getElementById('togPixel');
const pixelCtx    = pixelCanvas.getContext('2d', { willReadFrequently: true });

let pixelOn = true;

/* ---------- low-res offscreen buffer (128 × 72, 16:9) ---------- */
const LOW_W = 256;
const LOW_H = 144;
const lowCanvas = document.createElement('canvas');
lowCanvas.width  = LOW_W;
lowCanvas.height = LOW_H;
const lowCtx = lowCanvas.getContext('2d', { willReadFrequently: true });
lowCtx.imageSmoothingEnabled = false;

/* reusable ImageData (refreshed via getImageData each dither pass) */
let lowImageData = lowCtx.createImageData(LOW_W, LOW_H);

/* ---------- palettes (16 colors each, hyperpop / PICO-8 inspired) ---------- */
const PALETTES = {
  vapor:    ['#1a0a30','#3a0e57','#7a3399','#ff66ff','#33ccff','#ffe6ff','#ff3366','#0a0215','#9966ff','#66ccff','#ff99cc','#cc66cc','#000000','#ffffff','#aa66dd','#330033'],
  acid:     ['#0a1a0a','#005533','#33ff99','#99ff33','#ccff66','#66ff66','#00aa33','#001100','#ffaa00','#ff66aa','#cc0033','#aa00aa','#000000','#ffffff','#33ffcc','#003311'],
  sunset:   ['#1a0510','#5a0e2c','#cc3366','#ff6699','#ffaa66','#ffdd99','#ffe6ff','#0a0215','#aa3366','#ff7733','#ffcc44','#993366','#330011','#ffffff','#cc6699','#220011'],
  chrome:   ['#0a0a0a','#1a1a1a','#444444','#888888','#cccccc','#ffffff','#ff3366','#33ccff','#000000','#666666','#aaaaaa','#ddccff','#ffe6e6','#ccffff','#ffff66','#aa00ff'],
  kawaii:   ['#1a0510','#330022','#993366','#ff66bb','#ffaaee','#ffe6ff','#33ccff','#0a0210','#ff99dd','#cc66bb','#aa3399','#ffaaff','#222244','#ffffff','#cc99ff','#660044'],
  terminal: ['#000000','#00ff00','#33ff33','#66ff66','#99ff99','#ccffcc','#ffffff','#003300','#33aa33','#00cc00','#66aa66','#99cc99','#001100','#005500','#aaffaa','#003311'],
};
const PALETTE_KEYS = Object.keys(PALETTES);

/* parse hex once into [[r,g,b], …] arrays per palette */
function hexToRgb(h) {
  const v = h.replace('#','');
  return [parseInt(v.slice(0,2),16), parseInt(v.slice(2,4),16), parseInt(v.slice(4,6),16)];
}
const PALETTE_RGB = {};
for (const k of PALETTE_KEYS) PALETTE_RGB[k] = PALETTES[k].map(hexToRgb);

let currentPaletteIndex = 0;
let lastBar = -1;

/* ---------- canvas resize (mirrors stageWrap) ---------- */
function resizePixel() {
  const wrap = document.getElementById('stageWrap');
  if (!wrap) return;
  pixelCanvas.width  = wrap.clientWidth;
  pixelCanvas.height = wrap.clientHeight;
  pixelCtx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resizePixel);

/* ---------- nearest-color lookup (linear search, 16 entries — fast at 128×72) ---------- */
function nearestPaletteColor(r, g, b, palette) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = dr*dr + dg*dg + db*db;
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return palette[bestIdx];
}

/* ---------- Floyd-Steinberg dithering, in place on `data` ----------
   Uses a parallel Float32 buffer for accurate error propagation. */
function floydSteinberg(data, w, h, palette) {
  const buf = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    buf[j]   = data[i];
    buf[j+1] = data[i+1];
    buf[j+2] = data[i+2];
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      const oldR = buf[idx], oldG = buf[idx+1], oldB = buf[idx+2];
      const nearest = nearestPaletteColor(oldR, oldG, oldB, palette);
      const nR = nearest[0], nG = nearest[1], nB = nearest[2];
      buf[idx]   = nR;
      buf[idx+1] = nG;
      buf[idx+2] = nB;
      const eR = oldR - nR, eG = oldG - nG, eB = oldB - nB;
      // right (7/16)
      if (x + 1 < w) {
        const j = (y * w + (x + 1)) * 3;
        buf[j]   += eR * 7/16;
        buf[j+1] += eG * 7/16;
        buf[j+2] += eB * 7/16;
      }
      if (y + 1 < h) {
        // bottom-left (3/16)
        if (x - 1 >= 0) {
          const j = ((y+1) * w + (x-1)) * 3;
          buf[j]   += eR * 3/16;
          buf[j+1] += eG * 3/16;
          buf[j+2] += eB * 3/16;
        }
        // bottom (5/16)
        const jb = ((y+1) * w + x) * 3;
        buf[jb]   += eR * 5/16;
        buf[jb+1] += eG * 5/16;
        buf[jb+2] += eB * 5/16;
        // bottom-right (1/16)
        if (x + 1 < w) {
          const j = ((y+1) * w + (x+1)) * 3;
          buf[j]   += eR * 1/16;
          buf[j+1] += eG * 1/16;
          buf[j+2] += eB * 1/16;
        }
      }
    }
  }

  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    data[i]   = buf[j];
    data[i+1] = buf[j+1];
    data[i+2] = buf[j+2];
    data[i+3] = 255;
  }
}

/* ---------- find the p5 source canvas inside stageWrap ---------- */
function findStageCanvas() {
  const wrap = document.getElementById('stageWrap');
  if (!wrap) return null;
  const canvases = wrap.querySelectorAll('canvas');
  for (const c of canvases) {
    if (c.id !== 'pixelCanvas' && c.id !== 'asciiCanvas') return c;
  }
  return null;
}

/* ---------- update palette index on bar boundary (LSDJ trick) ----------
   Palette index now routes through window._vfxPaletteBar (written by the
   visual_mixer_bridge as bar % NUM_PALETTES). When the bridge isn't loaded
   we fall back to the same audioReact.bar % n calculation that ran before,
   so palette swaps still happen on bar boundaries either way. */
// Palette now swaps every BEAT (was every bar) so the look shifts much more often.
let _paletteBeatCounter = 0;
let _lastPaletteBeat = -1;
function updatePalette() {
  const ar = window.audioReact;
  if (!ar) return;
  if (ar.beatTick && ar.beat !== _lastPaletteBeat) {
    _lastPaletteBeat = ar.beat;
    _paletteBeatCounter++;
    const n = PALETTE_KEYS.length;
    currentPaletteIndex = ((_paletteBeatCounter % n) + n) % n;
    lastBar = ar.bar; // keep var live so other code reading it doesn't break
  }
}

/* ---------- gamma contrast + posterize via LUT (mild lift, dynamic levels/channel) ----------
   Posterize level count is driven by window._vfxPosterize (1..16), written by the
   visual_mixer_bridge from the DRIVE knob. Defaults to 4 (matches prior behavior) when
   the bridge hasn't loaded yet. The LUT is rebuilt only when the level count changes. */
const GAMMA = 0.85;
const GAMMA_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  GAMMA_LUT[i] = Math.min(255, Math.max(0, (Math.pow(i / 255, GAMMA) * 255) | 0));
}

const SHAPE_LUT = new Uint8Array(256);
let lastPosterizeLevels = -1;
function rebuildShapeLut(levels) {
  const step = 256 / levels;
  const half = step / 2;
  for (let i = 0; i < 256; i++) {
    const lifted = GAMMA_LUT[i];
    const post = Math.floor(lifted / step) * step + half;
    SHAPE_LUT[i] = Math.min(255, Math.max(0, post | 0));
  }
  lastPosterizeLevels = levels;
}
rebuildShapeLut(4); // initial default — equivalent to prior hardcoded 4-level behavior

function shapePixels(data) {
  // defensive read: bridge may not have loaded yet; fall back to 4
  const raw = (window._vfxPosterize != null) ? window._vfxPosterize : 4;
  let levels = Math.round(raw);
  if (!isFinite(levels) || levels < 1) levels = 4;
  if (levels > 16) levels = 16;
  if (levels !== lastPosterizeLevels) rebuildShapeLut(levels);

  for (let i = 0; i < data.length; i += 4) {
    data[i]   = SHAPE_LUT[data[i]];
    data[i+1] = SHAPE_LUT[data[i+1]];
    data[i+2] = SHAPE_LUT[data[i+2]];
  }
}

/* ---------- main draw: run heavy pipeline at ~30fps (every other frame) ---------- */
let pixelFrameCount = 0;
let lastAberrationApplied = -1; // tracks last applied value to avoid redundant style writes

/* Apply CSS chromatic aberration via drop-shadow filters from window._vfxPixelAberration
   (0..16). Wired to the LOW fader in the bridge. Defensive: missing global -> no filter. */
function applyAberration() {
  const ab = (window._vfxPixelAberration != null) ? window._vfxPixelAberration : 0;
  const v = (typeof ab === 'number' && isFinite(ab)) ? Math.max(0, Math.min(16, ab)) : 0;
  // only re-write the style when the visible value changes by >= 0.1px (cheap throttle)
  if (Math.abs(v - lastAberrationApplied) < 0.1) return;
  lastAberrationApplied = v;
  pixelCanvas.style.filter = v > 0.5
    ? `drop-shadow(${v.toFixed(1)}px 0 #ff00ff) drop-shadow(-${v.toFixed(1)}px 0 #00ffff)`
    : '';
}

function drawPixelOverlay() {
  if (!pixelOn) return;

  const doDither = (pixelFrameCount & 1) === 0;
  pixelFrameCount++;

  const w = pixelCanvas.width;
  const h = pixelCanvas.height;
  if (w < 2 || h < 2) return;

  applyAberration();
  updatePalette();

  if (doDither) {
    const src = findStageCanvas();
    if (!src || src.width < 2 || src.height < 2) {
      pixelCtx.clearRect(0, 0, w, h);
      return;
    }

    // step 1+4: nearest-neighbor downscale by drawing source into 128×72
    lowCtx.imageSmoothingEnabled = false;
    lowCtx.clearRect(0, 0, LOW_W, LOW_H);
    try {
      lowCtx.drawImage(src, 0, 0, LOW_W, LOW_H);
    } catch (e) {
      // p5 webgl canvas can throw before first commit — skip this frame
      return;
    }

    lowImageData = lowCtx.getImageData(0, 0, LOW_W, LOW_H);
    const data = lowImageData.data;

    // step 2+3: contrast lift + posterize (single LUT pass)
    shapePixels(data);

    // step 5: Floyd-Steinberg dither against the active palette
    const paletteKey = PALETTE_KEYS[currentPaletteIndex];
    const palette = PALETTE_RGB[paletteKey];
    floydSteinberg(data, LOW_W, LOW_H, palette);

    lowCtx.putImageData(lowImageData, 0, 0);
  }

  // step 6: upscale to full canvas, chunky nearest-neighbor
  pixelCtx.clearRect(0, 0, w, h);
  pixelCtx.imageSmoothingEnabled = false;
  pixelCtx.drawImage(lowCanvas, 0, 0, LOW_W, LOW_H, 0, 0, w, h);

  // sprite silhouette layer (mid-onset flash band)
  drawMidSilhouette(w, h);
}

/* ---------- sprite silhouette layer keyed to mid-band onsets ---------- */
let silhouetteEnergy = 0;
function drawMidSilhouette(w, h) {
  const ar = window.audioReact || {};
  const env = (ar.envelopes && typeof ar.envelopes.mid === 'number') ? ar.envelopes.mid : 0;
  const onset = !!(ar.onsets && ar.onsets.mid);
  if (onset) silhouetteEnergy = 1.0;
  silhouetteEnergy *= 0.88; // exponential decay per frame
  const intensity = Math.min(1, silhouetteEnergy * 0.6 + env * 0.4);
  if (intensity < 0.05) return;

  // pick a high-contrast accent from the active palette (entry 13 is white-ish slot)
  const paletteKey = PALETTE_KEYS[currentPaletteIndex];
  const pal = PALETTES[paletteKey];
  const tint = pal[13] || '#ffffff';

  pixelCtx.save();
  pixelCtx.globalCompositeOperation = 'overlay';
  pixelCtx.globalAlpha = intensity * 0.35;
  pixelCtx.fillStyle = tint;
  // chunky horizontal silhouette band that pulses with mid energy
  const bandH = Math.floor(h * (0.25 + 0.25 * intensity));
  const bandY = Math.floor(h * 0.5 - bandH / 2);
  pixelCtx.fillRect(0, bandY, w, bandH);
  pixelCtx.restore();
}

/* ---------- toggle button ---------- */
if (togPixel) {
  togPixel.addEventListener('click', () => {
    pixelOn = !pixelOn;
    togPixel.classList.toggle('on', pixelOn);
    togPixel.textContent = pixelOn ? 'Pixel: ON' : 'Pixel: OFF';
    pixelCanvas.style.opacity = pixelOn ? '0.2' : '0';
    if (!pixelOn) pixelCtx.clearRect(0, 0, pixelCanvas.width, pixelCanvas.height);
  });
}

pixelCanvas.style.opacity = '0.2';
resizePixel();
(function loop() {
  drawPixelOverlay();
  requestAnimationFrame(loop);
})();
