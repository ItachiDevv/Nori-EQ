/* demo_offline_render.js -- Headless OfflineAudioContext renderer for the
 * Nori EQ hackathon demo. Replicates the live Web Audio chain from
 * eq_panel.js (BiquadFilter buses + master shelves + WaveShaper drive +
 * ConvolverNode reverb + M/S width matrix + master gain), schedules every
 * AudioParam from /demo/timeline.json's `automation` array via
 * setValueAtTime / linearRampToValueAtTime / exponentialRampToValueAtTime,
 * then encodes the rendered AudioBuffer to MP3 (lamejs, 192 kbps, 44.1 kHz).
 *
 * Output is the soundtrack for the Remotion screen-recording build --
 * sample-accurate sync with whatever the page-side runDemoTimeline()
 * (in demo_timeline.js) animates on the visible faders.
 *
 * Public API:
 *   window.renderDemoOffline({ trackUrl, timeline, format, sampleRate, onProgress })
 *
 * Note: export_widget.js has a `buildOfflineChain(ctx, srcNode, eq)` helper
 * but it is closure-scoped (not exposed on window) and only returns void
 * after wiring to ctx.destination -- it does not return the AudioParam
 * handles needed for automation. We therefore replicate the same chain
 * topology here and return a `params` map (param name -> AudioParam ref).
 */
(function () {
  'use strict';

  // Constants -- must match eq_panel.js exactly.
  const BUSES = ['sub', 'low', 'mid', 'high'];
  const FILTER_SPEC = {
    sub:  [{ type: 'lowpass',  freq: 80 }],
    low:  [{ type: 'highpass', freq: 80 },  { type: 'lowpass', freq: 300 }],
    mid:  [{ type: 'highpass', freq: 300 }, { type: 'lowpass', freq: 3000 }],
    high: [{ type: 'highpass', freq: 3000 }],
  };
  const dB2lin = (db) => Math.pow(10, db / 20);

  // Drive curve at MAX (100). We freeze the saturation shape and crossfade
  // dry/wet via a gain -- the only AudioParam-friendly way to "automate" a
  // WaveShaper. The live chain rebuilds the curve per change, which we cannot
  // do via setValueAtTime; this is the documented compromise.
  function makeMaxDriveCurve() {
    if (typeof window.makeDriveCurve === 'function') {
      return window.makeDriveCurve(100);
    }
    const n = 4096;
    const curve = new Float32Array(n);
    const drive = 1 + 1 * 20;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive || 1);
    }
    return curve;
  }

  // Reverb impulse response -- same recipe as eq_panel.js (white noise *
  // (1-t)^2.5 over 2s, stereo).
  function buildIR(ctx) {
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

  // buildOfflineChain -- wires the chain, returns { params, source }.
  // params keys (match timeline.json automation `param` field):
  //   sub, low, mid, high   = per-bus GainNode .gain   (linear; convert dB)
  //   master                = master GainNode .gain    (linear; convert dB)
  //   drive                 = drive WET GainNode .gain (linear, 0..1)
  //   reverb                = reverbWet GainNode .gain (linear, 0..1)
  //   width                 = widthSideGain.gain       (linear, 0..2)
  //   filter                = filterNode.frequency     (Hz, 100..22000)
  //   speed                 = sourceNode.playbackRate  (0.5..2)
  function buildOfflineChain(ctx, sourceNode) {
    const params = {};

    // Per-bus split (sub/low/mid/high)
    const busTails = [];
    const busGains = {};
    BUSES.forEach((b) => {
      let prev = null;
      FILTER_SPEC[b].forEach((spec, i) => {
        const f = ctx.createBiquadFilter();
        f.type = spec.type;
        f.frequency.value = spec.freq;
        if (i === 0) sourceNode.connect(f); else prev.connect(f);
        prev = f;
      });
      const g = ctx.createGain();
      g.gain.value = dB2lin(0);
      const p = ctx.createStereoPanner();
      p.pan.value = 0;
      prev.connect(g); g.connect(p);
      busTails.push(p);
      busGains[b] = g;
    });
    params.sub  = busGains.sub.gain;
    params.low  = busGains.low.gain;
    params.mid  = busGains.mid.gain;
    params.high = busGains.high.gain;

    // Master EQ shelves (transparent, gain=0dB by design)
    const eqL = ctx.createBiquadFilter();
    eqL.type = 'lowshelf'; eqL.frequency.value = 200; eqL.gain.value = 0;
    const eqM = ctx.createBiquadFilter();
    eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.Q.value = 1; eqM.gain.value = 0;
    const eqH = ctx.createBiquadFilter();
    eqH.type = 'highshelf'; eqH.frequency.value = 6000; eqH.gain.value = 0;
    busTails.forEach((tail) => tail.connect(eqL));
    eqL.connect(eqM); eqM.connect(eqH);

    // Master gain
    const mGain = ctx.createGain();
    mGain.gain.value = dB2lin(0);
    eqH.connect(mGain);
    params.master = mGain.gain;

    // Drive (WaveShaper at fixed max curve, wet/dry crossfade).
    // Live chain rebuilds the curve per change; offline we lock the curve at
    // amount=100 and crossfade dry vs shaped via gains. driveWetGain is the
    // automation target (drive/100).
    const driveInput = ctx.createGain();
    const driveDry = ctx.createGain(); driveDry.gain.value = 1;
    const driveWet = ctx.createGain(); driveWet.gain.value = 0;
    const driveShaper = ctx.createWaveShaper();
    driveShaper.curve = makeMaxDriveCurve();
    driveShaper.oversample = '4x';
    const driveOut = ctx.createGain(); driveOut.gain.value = 1;

    mGain.connect(driveInput);
    driveInput.connect(driveDry); driveDry.connect(driveOut);
    driveInput.connect(driveShaper);
    driveShaper.connect(driveWet); driveWet.connect(driveOut);
    params.drive = driveWet.gain;

    // Reverb (parallel dry + wet ConvolverNode)
    const reverbInput = ctx.createGain();
    const reverbDry = ctx.createGain(); reverbDry.gain.value = 1;
    const reverbWet = ctx.createGain(); reverbWet.gain.value = 0;
    const reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = buildIR(ctx);
    const reverbOut = ctx.createGain(); reverbOut.gain.value = 1;

    driveOut.connect(reverbInput);
    reverbInput.connect(reverbDry); reverbDry.connect(reverbOut);
    reverbInput.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet); reverbWet.connect(reverbOut);
    params.reverb = reverbWet.gain;

    // Filter (lowpass, default transparent at 22kHz)
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.Q.value = 0.707;
    filterNode.frequency.value = 22000;
    reverbOut.connect(filterNode);
    params.filter = filterNode.frequency;

    // Width (M/S processor -- same topology as eq_panel.js)
    const widthInput = ctx.createGain();
    const widthSplitter = ctx.createChannelSplitter(2);
    const widthMerger = ctx.createChannelMerger(2);
    const widthMidL = ctx.createGain(); widthMidL.gain.value = 0.5;
    const widthMidR = ctx.createGain(); widthMidR.gain.value = 0.5;
    const widthMidGain = ctx.createGain(); widthMidGain.gain.value = 1;
    const widthSideL = ctx.createGain(); widthSideL.gain.value = 0.5;
    const widthSideR = ctx.createGain(); widthSideR.gain.value = -0.5;
    const widthSideGain = ctx.createGain(); widthSideGain.gain.value = 1;
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
    params.width = widthSideGain.gain;

    widthOutput.connect(ctx.destination);

    // Source playbackRate (speed automation)
    params.speed = sourceNode.playbackRate;

    return { params, source: sourceNode };
  }

  // Convert a timeline param value to the linear value the AudioParam expects.
  function paramValue(name, raw) {
    switch (name) {
      case 'sub':
      case 'low':
      case 'mid':
      case 'high':
      case 'master':
        return dB2lin(raw); // dB to linear gain
      case 'drive':
        return Math.max(0, Math.min(100, raw)) / 100;
      case 'reverb':
        return Math.max(0, Math.min(1, raw));
      case 'width':
        return Math.max(0, Math.min(2, raw));
      case 'speed':
        return Math.max(0.5, Math.min(2, raw));
      case 'filter':
        return Math.max(20, Math.min(22000, raw));
      default:
        return raw;
    }
  }

  // Schedule one automation event onto its AudioParam. Always anchors with
  // setValueAtTime so subsequent ramps start from the correct value.
  // Exponential ramps fall back to linear if either endpoint is <= 0.
  function scheduleEvent(param, evt, lastValueByParam, paramName) {
    if (!param) return;
    const t = Math.max(0, +evt.t || 0);
    const ramp = evt.ramp || 'step';
    const rampSec = Math.max(0, +evt.rampSec || 0);
    const target = paramValue(paramName, +evt.to);
    const safeTarget = isFinite(target) ? target : 0;

    if (ramp === 'step' || rampSec <= 0) {
      param.setValueAtTime(safeTarget, t);
      lastValueByParam[paramName] = safeTarget;
      return;
    }

    const anchor = (lastValueByParam[paramName] != null) ? lastValueByParam[paramName] : safeTarget;
    try { param.setValueAtTime(anchor, t); } catch (_) { /* defensive */ }

    if (ramp === 'exponential') {
      if (safeTarget <= 0 || anchor <= 0) {
        param.linearRampToValueAtTime(safeTarget, t + rampSec);
      } else {
        param.exponentialRampToValueAtTime(Math.max(safeTarget, 1e-4), t + rampSec);
      }
    } else {
      param.linearRampToValueAtTime(safeTarget, t + rampSec);
    }
    lastValueByParam[paramName] = safeTarget;
  }

  // Lazy-load lamejs (CDN). Per spec, target lame.all.js.
  function ensureLamejs() {
    if (window.lamejs && window.lamejs.Mp3Encoder) return Promise.resolve(window.lamejs);
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
      s.src = 'https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/lame.all.js';
      s.onload = () => {
        if (window.lamejs && window.lamejs.Mp3Encoder) res(window.lamejs);
        else rej(new Error('lamejs loaded but Mp3Encoder missing'));
      };
      s.onerror = () => rej(new Error('lamejs CDN load failed'));
      document.head.appendChild(s);
    });
  }

  // AudioBuffer (Float32) to Int16 channel arrays to MP3 Blob.
  function float32ToInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  async function encodeMp3(audioBuffer, kbps, onChunkProgress) {
    const lame = await ensureLamejs();
    const bitrate = kbps || 192;
    const numCh = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;
    const left = float32ToInt16(audioBuffer.getChannelData(0));
    const right = numCh > 1 ? float32ToInt16(audioBuffer.getChannelData(1)) : null;
    const encoder = new lame.Mp3Encoder(numCh, sampleRate, bitrate);
    const blockSize = 1152;
    const chunks = [];
    const total = left.length;
    let lastReport = 0;
    for (let i = 0; i < total; i += blockSize) {
      const lChunk = left.subarray(i, i + blockSize);
      const rChunk = right ? right.subarray(i, i + blockSize) : null;
      const buf = numCh === 2 ? encoder.encodeBuffer(lChunk, rChunk) : encoder.encodeBuffer(lChunk);
      if (buf && buf.length > 0) chunks.push(buf);
      if (onChunkProgress && (i - lastReport) > total / 50) {
        lastReport = i;
        try { onChunkProgress(i / total); } catch (_) {}
      }
    }
    const flush = encoder.flush();
    if (flush && flush.length > 0) chunks.push(flush);
    if (onChunkProgress) try { onChunkProgress(1); } catch (_) {}
    return new Blob(chunks, { type: 'audio/mp3' });
  }

  // Trigger a download anchor.
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

  // Public entry point.
  window.renderDemoOffline = async function renderDemoOffline(opts) {
    const o = opts || {};
    const trackUrl = o.trackUrl || '/nous.mp3';
    const format = (o.format === 'wav') ? 'wav' : 'mp3';
    const sampleRate = o.sampleRate || 44100;
    const onProgress = (typeof o.onProgress === 'function') ? o.onProgress : function () {};

    const OACtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (typeof OACtor !== 'function') {
      throw new Error('renderDemoOffline: OfflineAudioContext not supported');
    }

    // Load timeline
    let timeline = o.timeline;
    if (!timeline) {
      const resp = await fetch('/demo/timeline.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error('timeline fetch failed: ' + resp.status);
      timeline = await resp.json();
    }
    const totalSec = (timeline.meta && +timeline.meta.totalSec) || 150.0;
    const automation = Array.isArray(timeline.automation) ? timeline.automation.slice() : [];
    automation.sort((a, b) => (+a.t || 0) - (+b.t || 0));

    // Fetch + decode source
    onProgress({ phase: 'decode', percent: 0 });
    const srcResp = await fetch(trackUrl, { cache: 'force-cache' });
    if (!srcResp.ok) throw new Error('track fetch failed: ' + srcResp.status);
    const arr = await srcResp.arrayBuffer();

    const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await new Promise((res, rej) => {
      try {
        const p = tmpCtx.decodeAudioData(arr.slice(0), res, rej);
        if (p && typeof p.then === 'function') p.then(res, rej);
      } catch (e) { rej(e); }
    });
    try { await tmpCtx.close(); } catch (_) {}
    onProgress({ phase: 'decode', percent: 10 });

    // Build offline ctx + chain
    const totalFrames = Math.max(1, Math.floor(totalSec * sampleRate));
    const offline = new OACtor(2, totalFrames, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.loop = decoded.duration < totalSec;
    source.playbackRate.value = 1.0;

    const built = buildOfflineChain(offline, source);
    const params = built.params;

    // Schedule automation
    const lastValueByParam = {};
    Object.keys(params).forEach((k) => {
      try { lastValueByParam[k] = params[k].value; } catch (_) { lastValueByParam[k] = null; }
    });
    automation.forEach((evt) => {
      const p = params[evt.param];
      if (!p) return;
      scheduleEvent(p, evt, lastValueByParam, evt.param);
    });

    // Start + render
    source.start(0);
    onProgress({ phase: 'render-start', percent: 20 });
    onProgress({ phase: 'rendering', percent: 50 });
    const rendered = await offline.startRendering();

    // Encode
    onProgress({ phase: 'encoding-start', percent: 70 });
    let blob, filename, mimeType;
    if (format === 'mp3') {
      blob = await encodeMp3(rendered, 192, (frac) => {
        const pct = 70 + Math.round(frac * 25);
        onProgress({ phase: 'encoding', percent: pct });
      });
      filename = 'nori-demo-soundtrack.mp3';
      mimeType = 'audio/mp3';
    } else {
      // WAV path -- minimal, mirrors export_widget.js encodeWav.
      const numCh = rendered.numberOfChannels;
      const totalLen = rendered.length * numCh * 2 + 44;
      const buf = new ArrayBuffer(totalLen);
      const view = new DataView(buf);
      let off = 0;
      const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
      const writeU32 = (v) => { view.setUint32(off, v, true); off += 4; };
      const writeU16 = (v) => { view.setUint16(off, v, true); off += 2; };
      writeStr('RIFF'); writeU32(totalLen - 8); writeStr('WAVE'); writeStr('fmt ');
      writeU32(16); writeU16(1); writeU16(numCh);
      writeU32(rendered.sampleRate); writeU32(rendered.sampleRate * numCh * 2);
      writeU16(numCh * 2); writeU16(16);
      writeStr('data'); writeU32(rendered.length * numCh * 2);
      const channels = [];
      for (let c = 0; c < numCh; c++) channels.push(rendered.getChannelData(c));
      for (let i = 0; i < rendered.length; i++) {
        for (let c = 0; c < numCh; c++) {
          let s = Math.max(-1, Math.min(1, channels[c][i]));
          view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          off += 2;
        }
      }
      blob = new Blob([buf], { type: 'audio/wav' });
      filename = 'nori-demo-soundtrack.wav';
      mimeType = 'audio/wav';
      onProgress({ phase: 'encoding', percent: 95 });
    }

    // Expose + download
    window._lastDemoRender = blob;
    try { triggerDownload(blob, filename); } catch (_) {}

    onProgress({ phase: 'done', percent: 100 });
    return { blob, filename, mimeType, durationSec: rendered.duration };
  };

  // Expose the chain builder so tests / Remotion harnesses can reuse it.
  window.buildDemoOfflineChain = buildOfflineChain;
})();
