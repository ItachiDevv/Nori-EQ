/* export_widget.js — Floating "EXPORT" pill that renders the mix offline through
 * the same Web Audio chain used live (eq buses + master EQ + drive + reverb +
 * filter + width), faster than real-time, then encodes to WAV or MP3. The
 * MediaRecorder approach has been replaced because it (a) ran in real-time and
 * (b) produced lossy webm/opus output. OfflineAudioContext gives perfect
 * fidelity at ~10x speed.
 *
 * Self-contained: injects styles, mounts to <body>, idempotent.
 *
 * SOURCE STRATEGY:
 *   Uploaded files: upload.js calls `URL.createObjectURL(file)` so the original
 *   blob is not exposed. We hook `window.handleAudioFile` (the upload entry
 *   point — declared at script top level so it lands on window) once it
 *   appears so we can stash the File as `window._exportSourceBlob`. We also
 *   keep `window._exportSourceUrl` for the default track case. If neither is
 *   present at export time, we re-fetch `/nous.mp3` (the always-available
 *   default).
 */
(function () {
  'use strict';

  if (document.getElementById('exportPill')) return; // idempotent

  // ===========================================================================
  // SOURCE TRACKING — capture the underlying audio blob/url so we can decode it
  // through OfflineAudioContext at export time.
  // ===========================================================================
  // Default track is always /nous.mp3 unless overridden.
  if (!window._exportSourceUrl && !window._exportSourceBlob) {
    window._exportSourceUrl = '/nous.mp3';
  }

  // Hook handleAudioFile so any upload sets _exportSourceBlob. Polls until the
  // global is defined (upload.js declares it later in the script load order).
  (function hookUpload() {
    let installed = false;
    function tryInstall() {
      if (installed) return;
      if (typeof window.handleAudioFile !== 'function') {
        setTimeout(tryInstall, 250);
        return;
      }
      installed = true;
      const orig = window.handleAudioFile;
      window.handleAudioFile = function (file) {
        try {
          if (file instanceof Blob) {
            window._exportSourceBlob = file;
            window._exportSourceUrl = null; // blob takes priority
          }
        } catch (_) {}
        return orig.apply(this, arguments);
      };
    }
    tryInstall();
  })();

  // ===========================================================================
  // STYLES
  // ===========================================================================
  const CSS = `
    .exp-pill {
      position: fixed; top: 12px; right: 280px; z-index: 250;
      background: rgba(15,5,32,0.88); border: 1px solid #ffe600;
      box-shadow: 0 0 12px rgba(255,230,0,0.55), inset 0 0 6px rgba(255,230,0,0.18);
      color: #ffe600; font: bold 12px 'Courier New', monospace;
      letter-spacing: 0.08em; padding: 8px 18px; border-radius: 999px;
      cursor: pointer; user-select: none; min-width: 120px; text-align: center;
      transition: border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }
    .exp-pill:hover { border-color: #00f0ff; color: #00f0ff;
      box-shadow: 0 0 14px rgba(0,240,255,0.65), inset 0 0 6px rgba(0,240,255,0.22);
      transform: translateY(-1px); }
    .exp-pill.is-busy {
      border-color: #ff2bd6; color: #ff7be0;
      box-shadow: 0 0 14px rgba(255,43,214,0.7), inset 0 0 6px rgba(255,43,214,0.25);
      cursor: wait; animation: exp-pulse 1.1s ease-in-out infinite alternate;
    }
    .exp-pill.is-saved {
      border-color: #4cffa0; color: #4cffa0;
      box-shadow: 0 0 14px rgba(76,255,160,0.65), inset 0 0 6px rgba(76,255,160,0.22);
    }
    .exp-pill.is-error {
      border-color: #ff2b4a; color: #ff5566;
      box-shadow: 0 0 14px rgba(255,43,74,0.7), inset 0 0 6px rgba(255,43,74,0.25);
    }
    .exp-pill.is-disabled { opacity: 0.55; cursor: not-allowed; filter: grayscale(0.4); }
    .exp-pill.is-disabled:hover { border-color: #ffe600; color: #ffe600;
      box-shadow: 0 0 12px rgba(255,230,0,0.55), inset 0 0 6px rgba(255,230,0,0.18);
      transform: none; }
    @keyframes exp-pulse {
      from { box-shadow: 0 0 10px rgba(255,43,214,0.55), inset 0 0 6px rgba(255,43,214,0.20); }
      to   { box-shadow: 0 0 22px rgba(255,123,224,0.95), inset 0 0 12px rgba(255,123,224,0.45); }
    }
    .exp-menu {
      position: fixed; top: 50px; right: 280px; z-index: 251;
      background: rgba(15,5,32,0.96);
      border: 1px solid #ff2bd6;
      box-shadow: 0 0 12px rgba(255,43,214,0.55);
      border-radius: 8px; padding: 6px;
      display: none; flex-direction: column; gap: 4px;
      font: bold 11px 'Courier New', monospace; letter-spacing: 0.06em;
      min-width: 180px;
    }
    .exp-menu.is-open { display: flex; }
    .exp-menu .opt {
      background: rgba(0,0,0,0.4); border: 1px solid rgba(255,230,0,0.45);
      color: #ffe600; padding: 8px 10px; border-radius: 4px;
      cursor: pointer; text-align: left; font: inherit;
      transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
    }
    .exp-menu .opt:hover {
      border-color: #00f0ff; color: #00f0ff; background: rgba(0,240,255,0.08);
    }
    .exp-menu .opt.is-disabled {
      opacity: 0.45; cursor: not-allowed; filter: grayscale(0.5);
    }
    .exp-menu .opt.is-disabled:hover {
      border-color: rgba(255,230,0,0.45); color: #ffe600; background: rgba(0,0,0,0.4);
    }
    .exp-menu .note {
      font-size: 10px; color: #aa99cc; padding: 2px 4px; letter-spacing: 0.04em;
    }
  `;

  function injectStyles() {
    if (document.getElementById('exportWidgetStyles')) return;
    const s = document.createElement('style');
    s.id = 'exportWidgetStyles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ===========================================================================
  // STATE
  // ===========================================================================
  const state = {
    busy: false,
    menuOpen: false,
    mp3Available: true, // optimistic; flips false if lamejs CDN load fails
    offlineSupported: typeof (window.OfflineAudioContext || window.webkitOfflineAudioContext) === 'function',
  };

  let pillEl = null;
  let menuEl = null;
  let optWavEl = null;
  let optMp3El = null;
  let noteEl = null;

  // ===========================================================================
  // UI HELPERS
  // ===========================================================================
  function setLabel(text) { if (pillEl) pillEl.textContent = text; }

  function setPillState(cls /* 'idle'|'busy'|'saved'|'error' */) {
    if (!pillEl) return;
    pillEl.classList.remove('is-busy', 'is-saved', 'is-error');
    if (cls === 'busy')  pillEl.classList.add('is-busy');
    if (cls === 'saved') pillEl.classList.add('is-saved');
    if (cls === 'error') pillEl.classList.add('is-error');
  }

  function openMenu() {
    if (!menuEl || state.busy) return;
    menuEl.classList.add('is-open');
    state.menuOpen = true;
  }
  function closeMenu() {
    if (!menuEl) return;
    menuEl.classList.remove('is-open');
    state.menuOpen = false;
  }

  function flashStatus(text, cls, ms) {
    setPillState(cls);
    setLabel(text);
    setTimeout(() => {
      if (!pillEl) return;
      setPillState('idle');
      setLabel('⬇ EXPORT');
    }, ms || 2000);
  }

  // ===========================================================================
  // dB <-> linear
  // ===========================================================================
  const dB2lin = (db) => Math.pow(10, db / 20);

  // ===========================================================================
  // SOURCE BUFFER ACQUISITION
  // ===========================================================================
  async function getSourceArrayBuffer() {
    // 1) Prefer captured upload blob (set via handleAudioFile hook)
    if (window._exportSourceBlob instanceof Blob) {
      return await window._exportSourceBlob.arrayBuffer();
    }
    // 2) Fall back to fetching the configured URL (default /nous.mp3)
    const url = window._exportSourceUrl || '/nous.mp3';
    const resp = await fetch(url, { cache: 'force-cache' });
    if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
    return await resp.arrayBuffer();
  }

  // ===========================================================================
  // OFFLINE CHAIN — REPLICATES eq_panel.js EXACTLY USING window.eqState
  // ===========================================================================
  function buildIR(ctx) {
    // Stereo synthetic IR: white noise * (1-t)^2.5 over 2s — same as eq_panel.js
    const dur = 2.0;
    const decay = 2.5;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * dur));
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return ir;
  }

  function makeDriveCurveLocal(amount) {
    // Fallback if window.makeDriveCurve isn't available yet.
    const n = 4096;
    const curve = new Float32Array(n);
    const k = Math.max(0, Math.min(100, amount)) / 100;
    const drive = 1 + k * 20;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive || 1);
    }
    return curve;
  }

  // Build the full chain rooted at `srcNode`, terminating at `ctx.destination`.
  // `eq` is a snapshot of window.eqState taken at render start.
  function buildOfflineChain(ctx, srcNode, eq) {
    // ----- Per-bus split (sub/low/mid/high) -----
    const BUSES = ['sub', 'low', 'mid', 'high'];
    const FILTER_SPEC = {
      sub:  [{ type: 'lowpass',  freq: 80 }],
      low:  [{ type: 'highpass', freq: 80 }, { type: 'lowpass', freq: 300 }],
      mid:  [{ type: 'highpass', freq: 300 }, { type: 'lowpass', freq: 3000 }],
      high: [{ type: 'highpass', freq: 3000 }],
    };
    const busTails = []; // last node of each bus path

    BUSES.forEach((b) => {
      let prev = null;
      FILTER_SPEC[b].forEach((spec, i) => {
        const f = ctx.createBiquadFilter();
        f.type = spec.type;
        f.frequency.value = spec.freq;
        if (i === 0) srcNode.connect(f); else prev.connect(f);
        prev = f;
      });
      const g = ctx.createGain();
      const busDb = (typeof eq[b] === 'number') ? eq[b] : 0;
      g.gain.value = dB2lin(busDb);
      const p = ctx.createStereoPanner();
      p.pan.value = 0;
      prev.connect(g); g.connect(p);
      busTails.push(p);
    });

    // ----- Master EQ shelves (transparent — gain 0dB by design) -----
    const eqL = ctx.createBiquadFilter();
    eqL.type = 'lowshelf'; eqL.frequency.value = 200; eqL.gain.value = 0;
    const eqM = ctx.createBiquadFilter();
    eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.Q.value = 1; eqM.gain.value = 0;
    const eqH = ctx.createBiquadFilter();
    eqH.type = 'highshelf'; eqH.frequency.value = 6000; eqH.gain.value = 0;
    busTails.forEach((tail) => tail.connect(eqL));
    eqL.connect(eqM); eqM.connect(eqH);

    // ----- Master gain -----
    const mGain = ctx.createGain();
    const masterDb = (typeof eq.master === 'number') ? eq.master : 0;
    mGain.gain.value = dB2lin(masterDb);
    eqH.connect(mGain);

    // ----- Drive (WaveShaper, tanh curve) -----
    const driveNode = ctx.createWaveShaper();
    const curveFn = (typeof window.makeDriveCurve === 'function') ? window.makeDriveCurve : makeDriveCurveLocal;
    const driveAmt = (typeof eq.drive === 'number') ? eq.drive : 0;
    driveNode.curve = curveFn(driveAmt);
    driveNode.oversample = '4x';
    mGain.connect(driveNode);

    // ----- Reverb (parallel dry + wet ConvolverNode) -----
    const reverbInput = ctx.createGain();
    const reverbDry = ctx.createGain(); reverbDry.gain.value = 1;
    const reverbWet = ctx.createGain();
    const reverbVal = (typeof eq.reverb === 'number') ? eq.reverb : 0.25;
    reverbWet.gain.value = reverbVal;
    const reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = buildIR(ctx);
    const reverbOut = ctx.createGain(); reverbOut.gain.value = 1;
    driveNode.connect(reverbInput);
    reverbInput.connect(reverbDry); reverbDry.connect(reverbOut);
    reverbInput.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet); reverbWet.connect(reverbOut);

    // ----- Filter (lowpass) -----
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.Q.value = 0.707;
    const filterHz = (typeof eq.filter === 'number') ? eq.filter : 8000;
    filterNode.frequency.value = filterHz;
    reverbOut.connect(filterNode);

    // ----- Width (M/S processor) -----
    const widthInput = ctx.createGain();
    const widthSplitter = ctx.createChannelSplitter(2);
    const widthMerger = ctx.createChannelMerger(2);
    const widthMidL = ctx.createGain(); widthMidL.gain.value = 0.5;
    const widthMidR = ctx.createGain(); widthMidR.gain.value = 0.5;
    const widthMidGain = ctx.createGain(); widthMidGain.gain.value = 1;
    const widthSideL = ctx.createGain(); widthSideL.gain.value = 0.5;
    const widthSideR = ctx.createGain(); widthSideR.gain.value = -0.5;
    const widthSideGain = ctx.createGain();
    const widthVal = (typeof eq.width === 'number') ? eq.width : 1;
    widthSideGain.gain.value = widthVal;
    const widthSideInvert = ctx.createGain(); widthSideInvert.gain.value = -1;
    const widthOutput = ctx.createGain(); widthOutput.gain.value = 1;

    filterNode.connect(widthInput);
    widthInput.connect(widthSplitter);
    widthSplitter.connect(widthMidL, 0); widthMidL.connect(widthMidGain);
    widthSplitter.connect(widthMidR, 1); widthMidR.connect(widthMidGain);
    widthSplitter.connect(widthSideL, 0); widthSideL.connect(widthSideGain);
    widthSplitter.connect(widthSideR, 1); widthSideR.connect(widthSideGain);
    widthMidGain.connect(widthMerger, 0, 0);
    widthSideGain.connect(widthMerger, 0, 0);
    widthMidGain.connect(widthMerger, 0, 1);
    widthSideGain.connect(widthSideInvert);
    widthSideInvert.connect(widthMerger, 0, 1);
    widthMerger.connect(widthOutput);

    widthOutput.connect(ctx.destination);
  }

  // ===========================================================================
  // RENDER — decode source, build offline ctx + chain, render.
  // ===========================================================================
  async function renderOffline() {
    const arr = await getSourceArrayBuffer();

    // Decode using a regular AudioContext (works regardless of source rate)
    const decodeCtx = (typeof getAudioContext === 'function') ? getAudioContext() : null;
    const tmpCtx = decodeCtx || new (window.AudioContext || window.webkitAudioContext)();
    // decodeAudioData detaches the ArrayBuffer in some browsers — pass a copy.
    const decoded = await new Promise((res, rej) => {
      try {
        const p = tmpCtx.decodeAudioData(arr.slice(0), res, rej);
        if (p && typeof p.then === 'function') p.then(res, rej);
      } catch (e) { rej(e); }
    });

    const numCh = Math.max(1, Math.min(2, decoded.numberOfChannels));
    const sr = decoded.sampleRate;
    const len = decoded.length;

    const OACtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offline = new OACtor(numCh, len, sr);
    const src = offline.createBufferSource();
    src.buffer = decoded;

    // Snapshot eqState so render is deterministic even if user twiddles knobs
    const eqSnap = Object.assign({
      sub: 0, low: 0, mid: 0, high: 0,
      master: 0, drive: 0, reverb: 0.25, width: 1, filter: 22000,
    }, window.eqState || {});

    buildOfflineChain(offline, src, eqSnap);
    src.start(0);

    return await offline.startRendering();
  }

  // ===========================================================================
  // WAV ENCODER
  // ===========================================================================
  function encodeWav(audioBuffer) {
    const numCh = audioBuffer.numberOfChannels;
    const totalLen = audioBuffer.length * numCh * 2 + 44;
    const buf = new ArrayBuffer(totalLen);
    const view = new DataView(buf);
    let off = 0;
    function writeStr(s) { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); }
    function writeU32(v) { view.setUint32(off, v, true); off += 4; }
    function writeU16(v) { view.setUint16(off, v, true); off += 2; }
    writeStr('RIFF');
    writeU32(totalLen - 8);
    writeStr('WAVE');
    writeStr('fmt ');
    writeU32(16);                                // fmt chunk size
    writeU16(1);                                 // PCM
    writeU16(numCh);
    writeU32(audioBuffer.sampleRate);
    writeU32(audioBuffer.sampleRate * numCh * 2);
    writeU16(numCh * 2);
    writeU16(16);
    writeStr('data');
    writeU32(audioBuffer.length * numCh * 2);
    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ===========================================================================
  // MP3 ENCODER (lamejs, on-demand)
  // ===========================================================================
  async function ensureLamejs() {
    if (window.lamejs && window.lamejs.Mp3Encoder) return window.lamejs;
    return new Promise((res, rej) => {
      const existing = document.getElementById('lamejsScript');
      if (existing) {
        existing.addEventListener('load', () => {
          if (window.lamejs && window.lamejs.Mp3Encoder) res(window.lamejs);
          else rej(new Error('lamejs missing after load'));
        });
        existing.addEventListener('error', () => rej(new Error('lamejs CDN load failed')));
        return;
      }
      const s = document.createElement('script');
      s.id = 'lamejsScript';
      // Local bundle (vendor/lamejs.iife.js) — replaces a previously-broken
      // jsdelivr URL that 404'd in production. Self-hosted so MP3 export
      // works regardless of CDN reachability.
      s.src = '/vendor/lamejs.iife.js';
      s.onload = () => {
        if (window.lamejs && window.lamejs.Mp3Encoder) res(window.lamejs);
        else rej(new Error('lamejs loaded but Mp3Encoder missing'));
      };
      s.onerror = () => rej(new Error('lamejs script load failed'));
      document.head.appendChild(s);
    });
  }

  function float32ToInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  async function encodeMp3(audioBuffer, kbps) {
    const lame = await ensureLamejs();
    const bitrate = kbps || 192;
    const numCh = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;
    const left = float32ToInt16(audioBuffer.getChannelData(0));
    const right = numCh > 1 ? float32ToInt16(audioBuffer.getChannelData(1)) : null;
    const encoder = new lame.Mp3Encoder(numCh, sampleRate, bitrate);
    const blockSize = 1152;
    const chunks = [];
    for (let i = 0; i < left.length; i += blockSize) {
      const lChunk = left.subarray(i, i + blockSize);
      const rChunk = right ? right.subarray(i, i + blockSize) : null;
      const buf = numCh === 2 ? encoder.encodeBuffer(lChunk, rChunk) : encoder.encodeBuffer(lChunk);
      if (buf && buf.length > 0) chunks.push(buf);
    }
    const flush = encoder.flush();
    if (flush && flush.length > 0) chunks.push(flush);
    return new Blob(chunks, { type: 'audio/mp3' });
  }

  // ===========================================================================
  // DOWNLOAD
  // ===========================================================================
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      URL.revokeObjectURL(url);
    }, 500);
  }

  // ===========================================================================
  // RENDER + ENCODE CORE — shared by doExport() and window.renderEditedMix.
  // Returns { blob, mimeType, filename, durationSec }. Throws on failure.
  // The optional `onPhase` callback fires with 'render' | 'encode' so callers
  // (i.e. the EXPORT pill) can update their UI between stages without forking
  // the pipeline.
  // ===========================================================================
  async function renderAndEncode(format /* 'wav' | 'mp3' */, onPhase) {
    const fmt = (format === 'mp3') ? 'mp3' : 'wav';
    if (typeof onPhase === 'function') { try { onPhase('render'); } catch (_) {} }
    const renderedBuffer = await renderOffline();
    if (typeof onPhase === 'function') { try { onPhase('encode'); } catch (_) {} }
    let blob, mimeType, ext;
    if (fmt === 'mp3') {
      blob = await encodeMp3(renderedBuffer, 192);
      mimeType = 'audio/mpeg';
      ext = 'mp3';
    } else {
      blob = encodeWav(renderedBuffer);
      mimeType = 'audio/wav';
      ext = 'wav';
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    const filename = 'nori-eq-mix-' + ts + '.' + ext;
    return {
      blob,
      mimeType,
      filename,
      durationSec: renderedBuffer.duration,
    };
  }

  // ===========================================================================
  // MAIN EXPORT FLOW
  // ===========================================================================
  async function doExport(format /* 'wav' | 'mp3' */) {
    if (state.busy) return;
    state.busy = true;
    closeMenu();

    if (!state.offlineSupported) {
      state.busy = false;
      flashStatus('✗ UNSUPPORTED', 'error', 2200);
      return;
    }
    if (!window.fxNodes || !window.eqState) {
      state.busy = false;
      flashStatus('✗ NOT READY', 'error', 2200);
      return;
    }

    setPillState('busy');
    setLabel('⏳ RENDERING...');

    // Track which phase is active so we can surface the right error label.
    let phase = 'render';
    let result;
    try {
      result = await renderAndEncode(format, (p) => {
        phase = p;
        if (p === 'encode') setLabel('⏳ ENCODING...');
      });
    } catch (e) {
      state.busy = false;
      if (phase === 'render') {
        console.error('[export] render failed', e);
        const msg = (e && /fetch|404|NetworkError/i.test(String(e.message || e))) ? '✗ NO SOURCE' : '✗ RENDER FAIL';
        flashStatus(msg, 'error', 2400);
      } else {
        console.error('[export] encode failed', e);
        if (format === 'mp3') {
          // Encoder load/run failed: disable MP3 going forward, prompt user
          state.mp3Available = false;
          applyMenuAvailability();
          flashStatus('✗ MP3 FAIL', 'error', 2400);
        } else {
          flashStatus('✗ ENCODE FAIL', 'error', 2400);
        }
      }
      return;
    }

    try {
      triggerDownload(result.blob, result.filename);
    } catch (e) {
      console.error('[export] download failed', e);
      state.busy = false;
      flashStatus('✗ DOWNLOAD FAIL', 'error', 2400);
      return;
    }

    state.busy = false;
    flashStatus('✓ DOWNLOADED', 'saved', 2000);
  }

  // ===========================================================================
  // PUBLIC PROGRAMMATIC API — used by Nori chat widget. Same render + encode
  // pipeline as the EXPORT pill, but returns the blob instead of downloading,
  // and never touches the pill's busy lock or status UI.
  // ===========================================================================
  window.renderEditedMix = async function (opts) {
    const o = opts || {};
    const format = (o.format === 'mp3') ? 'mp3' : 'wav';

    if (typeof (window.OfflineAudioContext || window.webkitOfflineAudioContext) !== 'function') {
      throw new Error('renderEditedMix: OfflineAudioContext not supported in this browser');
    }
    if (!window.fxNodes || !window.eqState) {
      throw new Error('renderEditedMix: audio chain not ready (fxNodes/eqState missing)');
    }

    try {
      return await renderAndEncode(format);
    } catch (e) {
      const detail = (e && (e.message || e.name)) ? (e.message || e.name) : String(e);
      throw new Error('renderEditedMix: ' + (format === 'mp3' ? 'mp3' : 'wav') + ' render failed: ' + detail);
    }
  };

  // ===========================================================================
  // MENU AVAILABILITY
  // ===========================================================================
  function applyMenuAvailability() {
    if (optWavEl) {
      optWavEl.classList.toggle('is-disabled', !state.offlineSupported);
    }
    if (optMp3El) {
      const mp3Disabled = !state.offlineSupported || !state.mp3Available;
      optMp3El.classList.toggle('is-disabled', mp3Disabled);
    }
    if (noteEl) {
      if (!state.offlineSupported) {
        noteEl.textContent = 'OfflineAudioContext unsupported.';
        noteEl.style.display = '';
      } else if (!state.mp3Available) {
        noteEl.textContent = 'MP3 unavailable (CDN). WAV still works.';
        noteEl.style.display = '';
      } else {
        noteEl.style.display = 'none';
      }
    }
  }

  // ===========================================================================
  // MOUNT
  // ===========================================================================
  function waitForReady(timeoutMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        if (window.fxNodes && window.eqState) return resolve(true);
        if (performance.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  function mount() {
    injectStyles();

    pillEl = document.createElement('button');
    pillEl.id = 'exportPill';
    pillEl.className = 'exp-pill';
    pillEl.type = 'button';
    pillEl.textContent = '⬇ EXPORT';
    document.body.appendChild(pillEl);

    menuEl = document.createElement('div');
    menuEl.id = 'exportMenu';
    menuEl.className = 'exp-menu';
    document.body.appendChild(menuEl);

    optWavEl = document.createElement('button');
    optWavEl.type = 'button';
    optWavEl.className = 'opt';
    optWavEl.textContent = '[ WAV  · 10MB/min ]';
    menuEl.appendChild(optWavEl);

    optMp3El = document.createElement('button');
    optMp3El.type = 'button';
    optMp3El.className = 'opt';
    optMp3El.textContent = '[ MP3  · 3MB/min  ]';
    menuEl.appendChild(optMp3El);

    noteEl = document.createElement('div');
    noteEl.className = 'note';
    noteEl.style.display = 'none';
    menuEl.appendChild(noteEl);

    // Pill click toggles the menu
    pillEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (pillEl.classList.contains('is-disabled')) return;
      if (state.busy) return;
      if (state.menuOpen) closeMenu(); else openMenu();
    });

    // Outside click closes the menu
    document.addEventListener('click', (ev) => {
      if (!state.menuOpen) return;
      if (menuEl.contains(ev.target) || pillEl.contains(ev.target)) return;
      closeMenu();
    });

    optWavEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (optWavEl.classList.contains('is-disabled')) return;
      doExport('wav');
    });

    optMp3El.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (optMp3El.classList.contains('is-disabled')) return;
      doExport('mp3');
    });

    // Capability gates
    if (!state.offlineSupported) {
      pillEl.classList.add('is-disabled');
      pillEl.disabled = true;
      setLabel('✗ NOT SUPPORTED');
      applyMenuAvailability();
      return;
    }

    // Pill stays enabled from the start. The FX chain only initializes after
    // the user's first click (when loadSound's callback sets window._nousSound,
    // which then unblocks initAudio() in eq_panel.js). If the user hits EXPORT
    // before then, doExport()'s own readiness check flashes a transient
    // "✗ NOT READY" toast — no permanent disabled state, no 15s deadline.
    applyMenuAvailability();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
