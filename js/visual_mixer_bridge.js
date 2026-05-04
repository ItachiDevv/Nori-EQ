// visual_mixer_bridge.js
// Hybrid model: audio_reactivity.js drives the automatic baseline; mixer faders
// and FX knobs act as MULTIPLIERS that scale each visual effect's intensity.
//
// Mental model:
//   fader at 0dB = neutral (just audio-reactive baseline)
//   push up      = dramatic
//   pull down    = subtle
//
// Reads each frame:
//   window.audioReact = { rms, envelopes:{sub,low,mid,high},
//                         onsets:{sub,low,mid,high}, barTick, bar, trackProgress }
//   window.eqState    = { sub, low, mid, high, master,    // dB in [-60..+12]
//                         drive, reverb, width, speed, filter }
//
// Writes globals consumed by ascii_overlay / pixel_overlay / concert / etc:
//   _vfxAsciiCell, _vfxAsciiBright, _vfxAsciiDensity,
//   _vfxSigilCount, _vfxPixelAberration, _vfxPosterize,
//   _vfxLaserMul, _vfxKaleidoSpeed, _vfxAnimSpeedMul,
//   _vfxStageWidth, _vfxBloomPx, _vfxStageHue,
//   _vfxPaletteBar, _vfxStrobeBoost
//   (plus legacy: _vfxEnergy, _vfxSigilStrength, _vfxZoomScale)
//
// Side effects:
//   #strobeOverlay opacity flash on sub onset (peak * masterMul, 80ms decay)
//   #stageWrap CSS hue-rotate from filter knob
//   p5 #defaultCanvas0 drop-shadow bloom from reverb knob
//   #pixelCanvas chromatic-aberration drop-shadows from low envelope * lowMul

(function () {
  'use strict';

  var NUM_PALETTES = 6;

  // ---------- safe defaults ----------
  if (!window.audioReact || typeof window.audioReact !== 'object') {
    window.audioReact = {
      rms: 0,
      envelopes: { sub: 0, low: 0, mid: 0, high: 0 },
      onsets: { sub: false, low: false, mid: false, high: false },
      barTick: false, bar: 0, trackProgress: 0
    };
  }
  if (!window.eqState || typeof window.eqState !== 'object') {
    window.eqState = {
      sub: 0, low: 0, mid: 0, high: 0, master: 0,
      drive: 0, reverb: 0, width: 1, speed: 1, filter: 22000
    };
  }

  // legacy globals (kept so older readers still work)
  if (typeof window._vfxEnergy !== 'number') window._vfxEnergy = 0;
  if (typeof window._vfxPaletteBar !== 'number') window._vfxPaletteBar = 0;
  if (typeof window._vfxSigilStrength !== 'number') window._vfxSigilStrength = 0;
  if (typeof window._vfxZoomScale !== 'number') window._vfxZoomScale = 1.0;

  function num(v, fb) { return (typeof v === 'number' && isFinite(v)) ? v : fb; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // dB fader -> linear multiplier in [0..2]
  // -12dB -> 0.0,  0dB -> 1.0,  +12dB -> 2.0
  function dbMul(db) { return clamp((num(db, 0) + 12) / 12, 0, 2); }

  // ---------- DOM lookups (cached, re-resolve if detached) ----------
  var _strobeOverlay = null, _stageWrap = null, _p5Canvas = null, _pixelCanvas = null;
  function el(cache, id) {
    if (!cache || !document.body || !document.body.contains(cache)) {
      return document.getElementById(id);
    }
    return cache;
  }

  // ---------- strobe state ----------
  var _strobeFlashMs = 80;
  var _strobeActiveUntil = 0;
  var _strobePeakOpacity = 0;

  function tick() {
    try {
      var ar  = window.audioReact || {};
      var env = ar.envelopes || {};
      var ons = ar.onsets || {};
      var eq  = window.eqState || {};

      var rms      = num(ar.rms, 0);
      var subEnv   = num(env.sub, 0);
      var lowEnv   = num(env.low, 0);
      var midEnv   = num(env.mid, 0);
      var highEnv  = num(env.high, 0);
      var subOnset = !!ons.sub;
      var bar      = num(ar.bar, 0) | 0;
      var tp       = clamp(num(ar.trackProgress, 0), 0, 1);

      // ---------- multipliers from dB faders ----------
      var subMul    = dbMul(eq.sub);
      var lowMul    = dbMul(eq.low);
      var midMul    = dbMul(eq.mid);
      var highMul   = dbMul(eq.high);
      var masterMul = dbMul(eq.master);

      // ---------- FX knob raw reads ----------
      var reverb = clamp(num(eq.reverb, 0), 0, 1);          // 0..1
      var width  = clamp(num(eq.width,  1), 0, 2);          // 0..2
      var speed  = clamp(num(eq.speed,  1), 0.5, 2);        // 0.5..2
      var drive  = clamp(num(eq.drive,  0), 0, 100);        // 0..100
      var filter = clamp(num(eq.filter, 22000), 100, 22000); // Hz

      // ---------- ASCII overlay ----------
      // base 32->8 over rms 0->1, divided by midMul so louder mid = finer cells
      var asciiCellBase = 14 - rms * 8;                     // 14..6 (cut in half)
      var asciiCell     = midMul > 0.05 ? asciiCellBase / midMul : asciiCellBase * 4;
      window._vfxAsciiCell = clamp(asciiCell, 4, 48);

      // brightness ramp index offset 0..3 from rms*masterMul
      window._vfxAsciiBright = clamp(rms * masterMul * 3, 0, 3);

      // density 0..1 - drops on sub kicks, scaled by lowMul
      var densityBase = 1 - subEnv * 0.5;                   // 0.5..1
      window._vfxAsciiDensity = clamp(densityBase * lowMul, 0, 1);

      // ---------- sigils (sub-onset pulses) ----------
      var baseSigils = subOnset ? 14 : 0;
      window._vfxSigilCount = Math.round(baseSigils * subMul);

      // ---------- pixel overlay ----------
      // chromatic aberration 0..16 from low envelope * lowMul
      var ab = clamp(lowEnv * 8 * lowMul, 0, 16);
      window._vfxPixelAberration = ab;

      // posterize: 16 levels at drive=0, 2 levels at drive=100
      window._vfxPosterize = Math.max(2, Math.round(16 - (drive / 100) * 14));

      // ---------- lasers / kaleido ----------
      window._vfxLaserMul     = clamp((0.3 + midEnv * 1.4) * midMul, 0, 4);
      window._vfxKaleidoSpeed = clamp((0.005 + highEnv * 0.075) * highMul, 0.001, 0.2);

      // ---------- FX-knob direct mappings ----------
      window._vfxAnimSpeedMul = speed;
      window._vfxStageWidth   = width;
      var bloomPx = reverb * 30;
      window._vfxBloomPx = bloomPx;
      var stageHue = (22000 - filter) / 22000 * 180;
      window._vfxStageHue = stageHue;

      // ---------- palette / strobe boost ----------
      window._vfxPaletteBar   = ((bar % NUM_PALETTES) + NUM_PALETTES) % NUM_PALETTES;
      window._vfxStrobeBoost  = masterMul;

      // ---------- legacy globals ----------
      window._vfxEnergy        = rms * masterMul;
      var sigil                = subEnv * 1.5 + (subOnset ? 0.7 : 0);
      window._vfxSigilStrength = sigil;
      window._vfxZoomScale     = 1.0 + tp * 0.20;

      // ---------- side effects: CSS filters ----------
      _stageWrap   = el(_stageWrap, 'stageWrap');
      _p5Canvas    = el(_p5Canvas, 'defaultCanvas0');
      _pixelCanvas = el(_pixelCanvas, 'pixelCanvas');

      if (_stageWrap && _stageWrap.style) {
        _stageWrap.style.filter = stageHue > 1 ? ('hue-rotate(' + stageHue.toFixed(1) + 'deg)') : '';
      }
      if (_p5Canvas && _p5Canvas.style) {
        _p5Canvas.style.filter = bloomPx > 1
          ? ('drop-shadow(0 0 ' + bloomPx.toFixed(1) + 'px #ff00ff)')
          : '';
      }
      if (_pixelCanvas && _pixelCanvas.style) {
        if (ab > 0.5) {
          _pixelCanvas.style.filter =
            'drop-shadow(' + ab.toFixed(1) + 'px 0 #ff00ff) ' +
            'drop-shadow(-' + ab.toFixed(1) + 'px 0 #00ffff)';
        } else {
          _pixelCanvas.style.filter = '';
        }
      }

      // ---------- strobe flash on sub onset ----------
      _strobeOverlay = el(_strobeOverlay, 'strobeOverlay');
      var nowMs = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      if (_strobeOverlay && _strobeOverlay.style) {
        if (subOnset) {
          var peak = clamp(sigil * 0.18 * masterMul, 0, 0.35);
          _strobePeakOpacity = peak;
          _strobeOverlay.style.opacity = String(peak);
          _strobeActiveUntil = nowMs + _strobeFlashMs;
        } else if (nowMs < _strobeActiveUntil) {
          var t = clamp((_strobeActiveUntil - nowMs) / _strobeFlashMs, 0, 1);
          _strobeOverlay.style.opacity = String(_strobePeakOpacity * t);
        } else {
          _strobeOverlay.style.opacity = '0';
        }
      }
    } catch (err) {
      if (window && window.console && console.warn) {
        console.warn('[visual_mixer_bridge] tick error:', err);
      }
    }

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
    else setTimeout(tick, 16);
  }

  function start() {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
    else setTimeout(tick, 16);
  }

  if (typeof document !== 'undefined' && document.readyState !== 'loading') {
    start();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
