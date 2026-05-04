// audio_reactivity.js
// Foundation audio-reactive feature extractor. Exposes window.audioReact, refreshed
// every animation frame. Other visual modules read from this global.
//
// Reads from p5 globals:
//   `fft`             - p5.FFT(0.8, 64) created in concert.js:35
//   `window._nousSound` - p5.SoundFile, set in default_track.js:85
// We do NOT call fft.analyze() ourselves — concert.js drives that during draw().
// We just consume whatever spectrum p5 has cached for the current frame.
//
// Design:
//   * Per-band attack/release envelopes (NOT lag smoothing — feels alive)
//   * Spectral-flux onset detection with adaptive (mean + k*stdev) threshold
//   * Median-IOI BPM estimation off sub-band onsets (kicks)
//   * Independent performance.now() bar/beat grid driven by current BPM estimate
//
// Band bin ranges (literal per spec; p5.FFT returns 64 bins):
//   sub  = bins  0..3
//   low  = bins  4..10
//   mid  = bins 11..32
//   high = bins 33..63

(function () {
  'use strict';

  // ---- Tunables ------------------------------------------------------------
  // Envelope coefficients (assumed ~60fps).
  // attack=0.6  -> rises ~84% of step in ~2 frames (~33ms; spec target 8ms, but
  //               per-frame quantization at 60fps caps granularity at ~16ms).
  // release=0.06 -> e-fold time ~16 frames (~270ms; spec target 250ms).
  var ATTACK_COEF  = 0.6;
  var RELEASE_COEF = 0.06;

  // Onset detection (spectral flux)
  var FLUX_EMA_ALPHA    = 0.05;  // running mean/var EMA rate
  var ONSET_K           = 1.6;   // threshold = mean + K * stdev
  var ONSET_DEBOUNCE_MS = 100;

  // BPM estimation
  var BPM_RECOMPUTE_MS = 4000;
  var BPM_MIN = 60, BPM_MAX = 180, BPM_DEFAULT = 120;
  var IOI_MIN_MS = 250;          // reject doubles faster than 240 BPM
  var IOI_MAX_MS = 1500;         // reject pauses slower than 40 BPM
  var IOI_BUFFER_LEN = 32;

  // Band bin ranges (inclusive start, exclusive end).
  var BANDS = {
    sub:  [0, 4],
    low:  [4, 11],
    mid:  [11, 33],
    high: [33, 64]
  };
  var BAND_NAMES = ['sub', 'low', 'mid', 'high'];

  // ---- State ---------------------------------------------------------------
  var envelopes = { sub: 0, low: 0, mid: 0, high: 0 };
  var rms = 0;
  var prevSpectrum = null;       // previous-frame spectrum snapshot for flux
  var fluxMean = { sub: 0, low: 0, mid: 0, high: 0 };
  var fluxVar  = { sub: 1, low: 1, mid: 1, high: 1 };  // variance, init non-zero
  var lastOnsetMs = { sub: 0, low: 0, mid: 0, high: 0 };

  // BPM
  var subOnsetTimes = [];
  var lastBpmCalcMs = 0;
  var bpm = BPM_DEFAULT;

  // Bar/beat grid (re-anchored when BPM changes meaningfully)
  var nowInit = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  var gridAnchorMs = nowInit;
  var lastBeatIndex = -1;
  var lastBarIndex = -1;
  var barCounter = 0;

  // Initialize global with safe defaults so consumers can read it before first tick.
  window.audioReact = {
    rms: 0,
    envelopes: { sub: 0, low: 0, mid: 0, high: 0 },
    onsets:    { sub: false, low: false, mid: false, high: false },
    beat: 0,
    bar: 0,
    barProgress: 0,
    bpm: BPM_DEFAULT,
    trackProgress: 0,
    barTick: false,
    beatTick: false
  };

  // ---- Helpers -------------------------------------------------------------
  function bandMean(spec, lo, hi) {
    var s = 0, n = 0;
    for (var i = lo; i < hi && i < spec.length; i++) { s += spec[i]; n++; }
    return n > 0 ? (s / n) / 255 : 0;
  }

  function bandFluxPositive(spec, prev, lo, hi) {
    // Sum of positive (only-rising) frame-to-frame magnitude diffs.
    var s = 0;
    var end = Math.min(hi, spec.length, prev.length);
    for (var i = lo; i < end; i++) {
      var d = spec[i] - prev[i];
      if (d > 0) s += d;
    }
    return s;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var m = sorted.length >> 1;
    return (sorted.length & 1) ? sorted[m] : 0.5 * (sorted[m - 1] + sorted[m]);
  }

  function recomputeBpm(nowMs) {
    if (subOnsetTimes.length < 4) return;
    var iois = [];
    for (var i = 1; i < subOnsetTimes.length; i++) {
      var d = subOnsetTimes[i] - subOnsetTimes[i - 1];
      if (d >= IOI_MIN_MS && d <= IOI_MAX_MS) iois.push(d);
    }
    if (iois.length < 3) return;
    var ioi = median(iois);
    if (ioi <= 0) return;
    var candidate = 60000 / ioi;
    // Octave-fold into [60, 180]
    while (candidate < BPM_MIN) candidate *= 2;
    while (candidate > BPM_MAX) candidate *= 0.5;
    if (candidate < BPM_MIN || candidate > BPM_MAX) return;
    // Big jump => re-anchor grid; small => smooth.
    if (Math.abs(candidate - bpm) > 4) {
      bpm = candidate;
      gridAnchorMs = nowMs;
      lastBeatIndex = -1;
      lastBarIndex = -1;
    } else {
      bpm = bpm + (candidate - bpm) * 0.4;
    }
  }

  // ---- Main tick -----------------------------------------------------------
  function tick() {
    var out = window.audioReact;
    // Reset edge ticks each frame; they fire for exactly one frame on transition.
    out.barTick = false;
    out.beatTick = false;
    for (var i = 0; i < BAND_NAMES.length; i++) out.onsets[BAND_NAMES[i]] = false;

    try {
      var spec = (typeof fft !== 'undefined' && fft && fft.analyze) ? fft.analyze() : null;
      var nowMs = performance.now();

      if (spec && spec.length >= 4) {
        // ---- Envelopes + RMS
        var rmsTarget = 0, rmsCount = 0;
        for (var b = 0; b < BAND_NAMES.length; b++) {
          var name = BAND_NAMES[b];
          var range = BANDS[name];
          var t = bandMean(spec, range[0], range[1]);
          var prevEnv = envelopes[name];
          var coef = (t > prevEnv) ? ATTACK_COEF : RELEASE_COEF;
          envelopes[name] = prevEnv + (t - prevEnv) * coef;
          out.envelopes[name] = envelopes[name];
          rmsTarget += t; rmsCount++;
        }
        rmsTarget = rmsCount ? rmsTarget / rmsCount : 0;
        var rmsCoef = (rmsTarget > rms) ? ATTACK_COEF : RELEASE_COEF;
        rms = rms + (rmsTarget - rms) * rmsCoef;
        out.rms = rms;

        // ---- Onset detection (spectral flux per band)
        if (prevSpectrum) {
          for (var bb = 0; bb < BAND_NAMES.length; bb++) {
            var bn = BAND_NAMES[bb];
            var rg = BANDS[bn];
            var flux = bandFluxPositive(spec, prevSpectrum, rg[0], rg[1]);
            var mean = fluxMean[bn];
            var varc = fluxVar[bn];
            var thresh = mean + ONSET_K * Math.sqrt(Math.max(varc, 1e-6));
            if (flux > thresh && (nowMs - lastOnsetMs[bn]) > ONSET_DEBOUNCE_MS) {
              out.onsets[bn] = true;
              lastOnsetMs[bn] = nowMs;
              if (bn === 'sub') {
                subOnsetTimes.push(nowMs);
                if (subOnsetTimes.length > IOI_BUFFER_LEN) subOnsetTimes.shift();
              }
            }
            // EMA-update mean/var AFTER threshold check so the firing frame
            // doesn't poison its own threshold.
            var diff = flux - mean;
            fluxMean[bn] = mean + FLUX_EMA_ALPHA * diff;
            fluxVar[bn]  = (1 - FLUX_EMA_ALPHA) * (varc + FLUX_EMA_ALPHA * diff * diff);
          }
        }
        // Snapshot spectrum for next-frame diff (don't keep live ref; p5 reuses buffer).
        if (!prevSpectrum || prevSpectrum.length !== spec.length) {
          prevSpectrum = new Float32Array(spec.length);
        }
        for (var k = 0; k < spec.length; k++) prevSpectrum[k] = spec[k];
      }

      // ---- BPM recompute
      if (nowMs - lastBpmCalcMs > BPM_RECOMPUTE_MS) {
        lastBpmCalcMs = nowMs;
        recomputeBpm(nowMs);
      }
      out.bpm = bpm;

      // ---- Bar/beat grid (independent of onsets)
      var beatMs = 60000 / bpm;
      var barMs = 4 * beatMs;
      var sinceAnchor = nowMs - gridAnchorMs;
      var beatIndexAbs = Math.floor(sinceAnchor / beatMs);
      var barIndexAbs  = Math.floor(sinceAnchor / barMs);
      var beatInBar    = ((beatIndexAbs % 4) + 4) % 4;
      var barProgress  = (sinceAnchor - barIndexAbs * barMs) / barMs;

      if (beatIndexAbs !== lastBeatIndex) {
        out.beatTick = (lastBeatIndex !== -1);  // suppress tick on first observation
        lastBeatIndex = beatIndexAbs;
      }
      if (barIndexAbs !== lastBarIndex) {
        if (lastBarIndex !== -1) { out.barTick = true; barCounter++; }
        lastBarIndex = barIndexAbs;
      }

      out.beat = beatInBar;
      out.bar = barCounter;
      out.barProgress = Math.max(0, Math.min(1, barProgress));

      // ---- Track progress
      var snd = window._nousSound;
      if (snd && typeof snd.currentTime === 'function' && typeof snd.duration === 'function') {
        var dur = snd.duration() || 0;
        out.trackProgress = dur > 0.1 ? Math.max(0, Math.min(1, snd.currentTime() / dur)) : 0;
      }
    } catch (e) {
      // Silent fail — never break the visual stack. Throttled log (1/min).
      if (!tick._lastErrLog || performance.now() - tick._lastErrLog > 60000) {
        tick._lastErrLog = performance.now();
        if (typeof console !== 'undefined') console.warn('[audio_reactivity] tick error:', e);
      }
    }

    requestAnimationFrame(tick);
  }

  // Kick off the loop.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(tick);
  }
})();
