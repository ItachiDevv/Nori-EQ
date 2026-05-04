(function eqPanelBootstrap(){
'use strict';

// =============================================================================
// SHARED STATE — populated by Phase A (UI) immediately; Phase B (audio) fills
// in audio node references when _nousSound becomes available.
// =============================================================================
const dB2lin = db => Math.pow(10, db/20);
const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v));

const BUSES = ['sub','low','mid','high'];
const FILTER_SPEC = {
  sub:  [{type:'lowpass',  freq:80}],
  low:  [{type:'highpass', freq:80}, {type:'lowpass', freq:300}],
  mid:  [{type:'highpass', freq:300},{type:'lowpass', freq:3000}],
  high: [{type:'highpass', freq:3000}]
};

// Audio-node maps. Phase A reads from these defensively (may be empty);
// Phase B populates them once the AudioContext + source are available.
const nodes = {}, analysers = {}, state = {};
BUSES.forEach(b => { state[b] = {mute:0, solo:0, gain:0, pan:0}; });

// Audio-graph node refs (assigned in Phase B; null until then)
let ac = null;
let SRC = null;
let eqL = null, eqM = null, eqH = null, mGain = null;
let driveNode = null, reverbWetGain = null, filterNode = null, widthSideGain = null;
let makeDriveCurve = null;

// Initialise eqState early so UI handlers always have a target object.
window.eqState = window.eqState || { sub:0, low:0, mid:0, high:0, master:0, drive:15, reverb:0.25, width:1, speed:1, filter:8000 };

function updateMutes(){
  const anyS = BUSES.some(b => state[b].solo);
  BUSES.forEach(b => {
    const s = state[b];
    const active = !s.mute && (!anyS || s.solo);
    const n = nodes[b];
    if (n && n.gain && n.gain.gain) n.gain.gain.value = active ? dB2lin(clamp(s.gain,-60,12)) : 0;
    if (n && n.pan && n.pan.pan)   n.pan.pan.value = clamp(s.pan,-50,50)/50;
  });
}

// =============================================================================
// PHASE B — Audio graph init. Polls until AudioContext + _nousSound exist,
// then routes the source through the per-bus filter network and master FX.
// =============================================================================
function initAudio(){
  const ctx = (typeof getAudioContext === 'function') ? getAudioContext() : null;
  const src = window._nousSound;
  if (!ctx || !src) { setTimeout(initAudio, 300); return; }
  if (src.__eqRouted) return;
  src.__eqRouted = true;
  ac = ctx;
  SRC = src;
  try { SRC.disconnect(); } catch(_) {}

  // Expose a reroute helper so upload.js can swap the source after a
  // new track is loaded. Reuses the existing bus filters + master FX
  // chain; only the input node changes.
  window.rerouteToNewSource = function(newSrc) {
    if (!ac || !newSrc || newSrc === SRC) return;
    if (SRC) { try { SRC.disconnect(); } catch(_) {} }
    try { newSrc.disconnect(); } catch(_) {}
    SRC = newSrc;
    newSrc.__eqRouted = true;
    BUSES.forEach(b => {
      const first = nodes[b] && nodes[b].filters && nodes[b].filters[0];
      if (first) { try { newSrc.connect(first); } catch(e) { console.warn('reroute', b, e); } }
    });
  };

  BUSES.forEach(b => {
    let prev = null;
    nodes[b] = {filters:[]};
    FILTER_SPEC[b].forEach((spec, i) => {
      const f = ac.createBiquadFilter();
      f.type = spec.type; f.frequency.value = spec.freq;
      if (i === 0) SRC.connect(f); else prev.connect(f);
      prev = f;
      nodes[b].filters.push(f);
    });
    const g = ac.createGain(); g.gain.value = dB2lin(0);
    const p = ac.createStereoPanner(); p.pan.value = 0;
    const a = ac.createAnalyser(); a.fftSize = 256;
    prev.connect(g); g.connect(p); p.connect(a);
    nodes[b].gain = g; nodes[b].pan = p;
    analysers[b] = a;
  });

  eqL = ac.createBiquadFilter(); eqL.type='lowshelf';  eqL.frequency.value=200;
  eqM = ac.createBiquadFilter(); eqM.type='peaking';   eqM.frequency.value=1000; eqM.Q.value=1;
  eqH = ac.createBiquadFilter(); eqH.type='highshelf'; eqH.frequency.value=6000;
  mGain = ac.createGain(); mGain.gain.value = dB2lin(0);
  const outDest = (typeof p5 !== 'undefined' && p5.soundOut && p5.soundOut.input) ? p5.soundOut.input : ac.destination;
  Object.values(analysers).forEach(a => a.connect(eqL));
  eqL.connect(eqM); eqM.connect(eqH); eqH.connect(mGain);
  window.eqMaster = { L: eqL, M: eqM, H: eqH };

  // === FX CHAIN: mGain -> driveNode -> reverbMix -> filterNode -> widthOutput -> outDest ===

  // 1) Drive (WaveShaperNode, soft-saturation tanh curve)
  makeDriveCurve = function(amount){
    const n = 4096;
    const curve = new Float32Array(n);
    const k = Math.max(0, Math.min(100, amount)) / 100; // 0..1
    const drive = 1 + k * 20;
    for (let i = 0; i < n; i++){
      const x = (i * 2) / n - 1; // -1..1
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive || 1);
    }
    return curve;
  };
  driveNode = ac.createWaveShaper();
  driveNode.curve = makeDriveCurve(0);
  driveNode.oversample = '4x';

  // 2) Reverb mix (parallel dry + wet ConvolverNode)
  const reverbInput = ac.createGain();
  const reverbDryGain = ac.createGain(); reverbDryGain.gain.value = 1;
  reverbWetGain = ac.createGain(); reverbWetGain.gain.value = 0;
  const reverbConvolver = ac.createConvolver();
  const reverbOut = ac.createGain(); reverbOut.gain.value = 1;
  // Synthesize stereo impulse response: white noise * decay envelope
  (function buildIR(){
    const dur = 2.0;
    const decay = 2.5;
    const sr = ac.sampleRate;
    const len = Math.max(1, Math.floor(sr * dur));
    const ir = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++){
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++){
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    reverbConvolver.buffer = ir;
  })();
  reverbInput.connect(reverbDryGain); reverbDryGain.connect(reverbOut);
  reverbInput.connect(reverbConvolver); reverbConvolver.connect(reverbWetGain); reverbWetGain.connect(reverbOut);

  // 3) Filter (BiquadFilter lowpass, default 22000 = transparent)
  filterNode = ac.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = 22000;
  filterNode.Q.value = 0.707;

  // 4) Width (M/S stereo width)
  const widthInput = ac.createGain();
  const widthSplitter = ac.createChannelSplitter(2);
  const widthMerger = ac.createChannelMerger(2);
  const widthMidL = ac.createGain(); widthMidL.gain.value = 0.5;
  const widthMidR = ac.createGain(); widthMidR.gain.value = 0.5;
  const widthMidGain = ac.createGain(); widthMidGain.gain.value = 1;
  const widthSideL = ac.createGain(); widthSideL.gain.value = 0.5;
  const widthSideR = ac.createGain(); widthSideR.gain.value = -0.5;
  widthSideGain = ac.createGain(); widthSideGain.gain.value = 1;
  const widthSideInvert = ac.createGain(); widthSideInvert.gain.value = -1;
  const widthOutput = ac.createGain(); widthOutput.gain.value = 1;

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

  // Wire master FX chain
  mGain.connect(driveNode);
  driveNode.connect(reverbInput);
  reverbOut.connect(filterNode);
  filterNode.connect(widthInput);
  widthOutput.connect(outDest);

  // Expose state + FX node refs for other modules
  window.fxNodes = { drive: driveNode, reverbWetGain: reverbWetGain, filter: filterNode, widthSideGain: widthSideGain };
  window.makeDriveCurve = makeDriveCurve;

  // Push the current UI fader/knob values into the freshly-created audio nodes
  // so the visible mixer state matches what's being heard from frame 1.
  try {
    BUSES.forEach(b => {
      state[b].gain = (typeof window.eqState[b] === 'number') ? window.eqState[b] : 0;
    });
    updateMutes();
    if (typeof window.eqState.master === 'number' && mGain) {
      mGain.gain.value = dB2lin(window.eqState.master);
    }
    if (window.fxNodes.reverbWetGain && typeof window.eqState.reverb === 'number') {
      window.fxNodes.reverbWetGain.gain.value = window.eqState.reverb;
    }
    if (window.fxNodes.filter && typeof window.eqState.filter === 'number') {
      window.fxNodes.filter.frequency.value = window.eqState.filter;
    }
    if (window.fxNodes.widthSideGain && typeof window.eqState.width === 'number') {
      window.fxNodes.widthSideGain.gain.value = window.eqState.width;
    }
    if (typeof window.eqState.drive === 'number' && window.eqState.drive > 0) {
      const initCurve = makeDriveCurve(window.eqState.drive);
      window.fxNodes.drive.curve = initCurve;
      window.fxNodes.drive.oversample = '4x';
    }
  } catch(_) {}
}

// Kick off audio init in the background — UI builds synchronously below.
setTimeout(initAudio, 0);

// =============================================================================
// PHASE A — UI. Runs synchronously so the mixer panel is visible from page
// load, before the user has interacted with the page (and before audio nodes
// exist). All handlers guard audio-node access.
// =============================================================================

// Inject panel-level styles
(function injectStyle(){
  if (document.getElementById('eqPanelStyle')) return;
  const css = `
    #eqPanel {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 200;
      height: 150px; padding: 6px 10px;
      display: flex; flex-direction: column; align-items: stretch; gap: 4px;
      background: rgba(15, 5, 32, 0.78);
      backdrop-filter: blur(10px) saturate(150%);
      -webkit-backdrop-filter: blur(10px) saturate(150%);
      border-top: 2px solid #ff3366;
      box-shadow: 0 -8px 24px rgba(255, 51, 102, 0.35), inset 0 1px 0 rgba(255, 51, 102, 0.6);
      font-family: 'Courier New', monospace;
      color: #f0e6ff;
      pointer-events: auto;
    }
    #eqPanel .controls-row {
      display: flex; flex-direction: row; align-items: stretch; gap: 8px;
      flex: 1; min-height: 0; overflow: hidden;
    }
    /* Two-line readouts ABOVE the mixer — no pill bubbles, just colored text */
    #eqPillBar {
      position: fixed; left: 10px; right: 10px; bottom: 156px; z-index: 201;
      display: flex; flex-direction: row; align-items: stretch; gap: 8px;
      height: 42px;
      pointer-events: none;
      font-family: 'Courier New', monospace;
    }
    #eqPillBar .pill-section {
      display: flex; flex-direction: row; align-items: stretch; gap: 6px;
      min-width: 0;
    }
    #eqPillBar .vfx {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px;
      pointer-events: auto;
      cursor: default;
    }
    #eqPillBar .vfx .num {
      font-size: 17px; font-weight: 700;
      letter-spacing: 0.5px;
      text-shadow: 0 0 6px currentColor;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 100%;
    }
    #eqPillBar .vfx .name {
      font-size: 12px; font-weight: 700;
      letter-spacing: 1.5px; text-transform: uppercase;
      color: currentColor; opacity: 0.85;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 100%;
    }
    #eqPillBar .pill-divider {
      width: 1px; align-self: center; height: 26px;
      background: rgba(255, 51, 102, 0.4);
    }
    #eqPanel .pill-section-label-spacer {
      writing-mode: vertical-rl; visibility: hidden;
      font-size: 0.6rem; letter-spacing: 3px; font-weight: 700;
      padding: 0 4px;
    }
    #eqPanel .section {
      display: flex; flex-direction: row; gap: 4px;
      padding: 2px 6px;
      align-items: stretch;
      min-width: 0;
    }
    #eqPanel .section-label {
      writing-mode: vertical-rl; transform: rotate(180deg);
      font-size: 0.6rem; letter-spacing: 3px; font-weight: 700;
      color: #ff3366; text-shadow: 0 0 6px rgba(255,51,102,0.7);
      align-self: center; padding: 0 4px;
    }
    #eqPanel .strip {
      display: flex; flex-direction: column; align-items: center;
      gap: 2px; padding: 2px 4px;
      flex: 1; min-width: 0;
      background: rgba(10, 2, 21, 0.6);
      border: 1px solid rgba(51, 204, 255, 0.35);
      border-radius: 4px;
    }
    #eqPanel .strip-label {
      font-size: 0.55rem; letter-spacing: 1.5px; font-weight: 700;
      color: #33ccff; text-shadow: 0 0 4px rgba(51,204,255,0.6);
    }
    #eqPanel .strip-row {
      display: flex; flex-direction: row; align-items: center; gap: 2px;
    }
    #eqPanel .vu {
      width: 12px; height: 80px;
      background: #0a0215; border: 1px solid rgba(51,204,255,0.3);
      border-radius: 2px;
    }
    #eqPanel .readout {
      font-size: 0.55rem; color: #ffe600;
      text-shadow: 0 0 4px rgba(255,230,0,0.5);
      min-height: 0.7rem;
    }
    #eqPanel .divider {
      width: 1px;
      background: linear-gradient(to bottom, transparent, #ff3366, transparent);
      opacity: 0.6;
      margin: 4px 2px;
    }
    #eqPanel .switch-row {
      display: flex; flex-direction: row; gap: 3px;
    }
    #eqPanel .fx-strip {
      display: flex; flex-direction: column; align-items: center;
      gap: 3px; padding: 4px 4px;
      flex: 1; min-width: 0;
      background: rgba(10, 2, 21, 0.6);
      border: 1px solid rgba(255, 51, 102, 0.35);
      border-radius: 4px;
    }
    #eqPanel .fx-label {
      font-size: 0.6rem; letter-spacing: 1.5px; font-weight: 700;
      color: #ff3366; text-shadow: 0 0 4px rgba(255,51,102,0.7);
    }
    #eqResetBtn {
      align-self: center; margin: 0 6px;
      background: rgba(15,5,32,0.85);
      border: 1px solid #ff3366;
      color: #ff3366;
      font: bold 0.62rem 'Courier New', monospace;
      letter-spacing: 1.5px;
      padding: 10px 12px;
      border-radius: 6px;
      cursor: pointer;
      text-shadow: 0 0 4px rgba(255,51,102,0.6);
      transition: border-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
      writing-mode: vertical-rl; transform: rotate(180deg);
    }
    #eqResetBtn:hover {
      border-color: #ffe600; color: #ffe600;
      text-shadow: 0 0 6px rgba(255,230,0,0.7);
      box-shadow: 0 0 10px rgba(255,230,0,0.35);
    }
    #eqResetBtn:active { transform: rotate(180deg) scale(0.97); }
  `;
  const s = document.createElement('style');
  s.id = 'eqPanelStyle';
  s.textContent = css;
  document.head.appendChild(s);
})();

// helper: create webaudio-knob with standard params
function mkKnob(opts){
  const k = document.createElement('webaudio-knob');
  k.setAttribute('diameter', String(opts.diameter || 30));
  k.setAttribute('min', String(opts.min));
  k.setAttribute('max', String(opts.max));
  k.setAttribute('step', String(opts.step != null ? opts.step : 0.01));
  k.setAttribute('value', String(opts.value));
  k.setAttribute('sensitivity', '1');
  if (opts.tooltip) k.setAttribute('tooltip', opts.tooltip);
  return k;
}

function mkSlider(opts){
  const s = document.createElement('webaudio-slider');
  s.setAttribute('direction', 'vert');
  s.setAttribute('min', String(opts.min));
  s.setAttribute('max', String(opts.max));
  s.setAttribute('step', String(opts.step != null ? opts.step : 0.1));
  s.setAttribute('value', String(opts.value));
  s.setAttribute('width', String(opts.width || 18));
  s.setAttribute('height', String(opts.height || 80));
  s.setAttribute('ditchcolor', '#0a0215');
  s.setAttribute('valcolor', '#33ccff');
  s.setAttribute('knobcolor', '#ff3366');
  if (opts.tooltip) s.setAttribute('tooltip', opts.tooltip);
  return s;
}

function mkSwitch(opts){
  const sw = document.createElement('webaudio-switch');
  sw.setAttribute('type', 'toggle');
  sw.setAttribute('width', '20');
  sw.setAttribute('height', '14');
  sw.setAttribute('value', String(opts.value || 0));
  if (opts.tooltip) sw.setAttribute('tooltip', opts.tooltip);
  return sw;
}

// Build root
const root = document.createElement('div');
root.id = 'eqPanel';
document.body.appendChild(root);

// ---- Pill bar (top: 4 derived audio-reactive visual readouts) ----
const pillBar = document.createElement('div');
pillBar.id = 'eqPillBar';
document.body.appendChild(pillBar);

const pillSecMixer = document.createElement('div');
pillSecMixer.className = 'pill-section';
pillSecMixer.style.flex = '4';
pillBar.appendChild(pillSecMixer);

const pillSecMaster = document.createElement('div');
pillSecMaster.className = 'pill-section';
pillSecMaster.style.flex = '1';
pillBar.appendChild(pillSecMaster);

const pillSecFx = document.createElement('div');
pillSecFx.className = 'pill-section';
pillSecFx.style.flex = '5';
pillBar.appendChild(pillSecFx);

const pills = {};
const VFX_COLORS = {
  sub:     '#33ccff',
  low:     '#ff3366',
  mid:     '#ffe600',
  high:    '#aa66ff',
  master:  '#ffffff',
  reverb:  '#ff99cc',
  width:   '#66e6ff',
  speed:   '#ffaa33',
  drive:   '#66ff99',
  filter:  '#ff7733',
};
const VFX_LABELS = {
  sub:     'SIGIL',
  low:     'PIXEL',
  mid:     'ASCII',
  high:    'KALEIDO',
  master:  'STROBE',
  reverb:  'BLOOM',
  width:   'STEREO',
  speed:   'TIME',
  drive:   'POSTERIZE',
  filter:  'HUE',
};
function mkPill(key, parent){
  const el = document.createElement('div');
  el.className = 'vfx';
  el.style.color = VFX_COLORS[key] || '#fff';
  const num = document.createElement('div');
  num.className = 'num';
  num.innerText = '--';
  const name = document.createElement('div');
  name.className = 'name';
  name.innerText = VFX_LABELS[key] || key.toUpperCase();
  el.appendChild(num);
  el.appendChild(name);
  parent.appendChild(el);
  pills[key] = num;
  return el;
}
mkPill('sub',    pillSecMixer);
mkPill('low',    pillSecMixer);
mkPill('mid',    pillSecMixer);
mkPill('high',   pillSecMixer);
mkPill('master', pillSecMaster);
mkPill('reverb', pillSecFx);
mkPill('width',  pillSecFx);
mkPill('speed',  pillSecFx);
mkPill('drive',  pillSecFx);
mkPill('filter', pillSecFx);

// ---- Controls row (existing mixer/master/fx sections live here) ----
const controlsRow = document.createElement('div');
controlsRow.className = 'controls-row';
root.appendChild(controlsRow);

// ---- MIXER section ----
const mixerSec = document.createElement('div');
mixerSec.className = 'section';
mixerSec.style.flex = '4';
const mixerLbl = document.createElement('div');
mixerLbl.className = 'section-label';
mixerLbl.innerText = 'MIXER';
mixerSec.appendChild(mixerLbl);
controlsRow.appendChild(mixerSec);

const vuCans = {};
const faders = {};

function buildChannelStrip(name){
  const strip = document.createElement('div');
  strip.className = 'strip';

  const lbl = document.createElement('div');
  lbl.className = 'strip-label';
  lbl.innerText = name.toUpperCase();
  strip.appendChild(lbl);

  // Fader + VU row
  const row = document.createElement('div');
  row.className = 'strip-row';
  const fader = mkSlider({min:-60, max:12, step:0.1, value:0, height:80, width:18});
  fader.addEventListener('input', () => {
    const v = parseFloat(fader.value);
    state[name].gain = v;
    window.eqState[name] = v;
    updateMutes(); // updateMutes guards against missing audio nodes
  });
  faders[name] = fader;
  row.appendChild(fader);

  const cv = document.createElement('canvas');
  cv.className = 'vu'; cv.width = 12; cv.height = 80;
  row.appendChild(cv);
  vuCans[name] = cv;
  strip.appendChild(row);

  // Mute / Solo switches
  const switches = document.createElement('div');
  switches.className = 'switch-row';

  const mute = mkSwitch({value:0, tooltip:'Mute'});
  mute.addEventListener('change', () => {
    state[name].mute = parseInt(mute.value, 10) ? 1 : 0;
    updateMutes();
  });
  mute.addEventListener('input', () => {
    state[name].mute = parseInt(mute.value, 10) ? 1 : 0;
    updateMutes();
  });
  const muteLbl = document.createElement('span');
  muteLbl.style.cssText = 'font-size:0.5rem;color:#ff3366;';
  muteLbl.innerText = 'M';
  const muteWrap = document.createElement('div');
  muteWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  muteWrap.appendChild(mute); muteWrap.appendChild(muteLbl);
  switches.appendChild(muteWrap);

  const solo = mkSwitch({value:0, tooltip:'Solo'});
  solo.addEventListener('change', () => {
    state[name].solo = parseInt(solo.value, 10) ? 1 : 0;
    updateMutes();
  });
  solo.addEventListener('input', () => {
    state[name].solo = parseInt(solo.value, 10) ? 1 : 0;
    updateMutes();
  });
  const soloLbl = document.createElement('span');
  soloLbl.style.cssText = 'font-size:0.5rem;color:#33ccff;';
  soloLbl.innerText = 'S';
  const soloWrap = document.createElement('div');
  soloWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  soloWrap.appendChild(solo); soloWrap.appendChild(soloLbl);
  switches.appendChild(soloWrap);

  strip.appendChild(switches);
  mixerSec.appendChild(strip);
}

BUSES.forEach(b => buildChannelStrip(b));

// divider
const div1 = document.createElement('div'); div1.className = 'divider'; controlsRow.appendChild(div1);

// ---- MASTER section ----
const masterSec = document.createElement('div');
masterSec.className = 'section';
masterSec.style.flex = '1';
const masterLbl = document.createElement('div');
masterLbl.className = 'section-label';
masterLbl.innerText = 'MASTER';
masterSec.appendChild(masterLbl);
controlsRow.appendChild(masterSec);

const masterStrip = document.createElement('div');
masterStrip.className = 'strip';

const mTopLbl = document.createElement('div');
mTopLbl.className = 'strip-label';
mTopLbl.innerText = 'MASTER';
masterStrip.appendChild(mTopLbl);

// Master EQ knobs removed per user request — eqL/eqM/eqH audio nodes still in chain at 0dB (transparent).

// Master fader + VU row
const mRow = document.createElement('div');
mRow.className = 'strip-row';
const masterFader = mkSlider({min:-60, max:12, step:0.1, value:0, height:60, width:18});
const masterDb = document.createElement('div');
masterDb.className = 'readout';
masterDb.innerText = '0.0 dB';
masterFader.addEventListener('input', () => {
  const v = parseFloat(masterFader.value);
  if (mGain && mGain.gain) mGain.gain.value = dB2lin(v);
  window.eqState.master = v;
  masterDb.innerText = v.toFixed(1) + ' dB';
});
faders.master = masterFader;
mRow.appendChild(masterFader);

const mvu = document.createElement('canvas');
mvu.className = 'vu'; mvu.width = 12; mvu.height = 60;
mRow.appendChild(mvu);
vuCans.master = mvu;
masterStrip.appendChild(mRow);
masterStrip.appendChild(masterDb);

masterSec.appendChild(masterStrip);

// divider
const div2 = document.createElement('div'); div2.className = 'divider'; controlsRow.appendChild(div2);

// ---- FX section ----
const fxSec = document.createElement('div');
fxSec.className = 'section';
fxSec.style.flex = '5';
const fxLbl = document.createElement('div');
fxLbl.className = 'section-label';
fxLbl.innerText = 'FX';
fxSec.appendChild(fxLbl);
controlsRow.appendChild(fxSec);

const fxKnobs = {};

function buildFxStrip(name, opts){
  const strip = document.createElement('div');
  strip.className = 'fx-strip';

  const lbl = document.createElement('div');
  lbl.className = 'fx-label';
  lbl.innerText = name;
  strip.appendChild(lbl);

  const k = mkKnob({diameter:40, min:opts.min, max:opts.max, step:opts.step, value:opts.value, tooltip:name});
  strip.appendChild(k);

  const readout = document.createElement('div');
  readout.className = 'readout';
  readout.innerText = opts.fmt(opts.value);
  strip.appendChild(readout);

  k.addEventListener('input', () => {
    const v = parseFloat(k.value);
    readout.innerText = opts.fmt(v);
    try { opts.onChange(v); } catch(err) { console.warn('[fx]', name, err); }
  });

  fxSec.appendChild(strip);
  fxKnobs[name.toLowerCase()] = k;
  return k;
}

buildFxStrip('REVERB', {
  min:0, max:1, step:0.01,
  value: window.eqState.reverb != null ? window.eqState.reverb : 0,
  fmt: v => v.toFixed(2),
  onChange: v => {
    if (window.fxNodes && window.fxNodes.reverbWetGain && window.fxNodes.reverbWetGain.gain) {
      window.fxNodes.reverbWetGain.gain.value = v;
    }
    window.eqState.reverb = v;
  }
});

buildFxStrip('WIDTH', {
  min:0, max:2, step:0.05,
  value: window.eqState.width != null ? window.eqState.width : 1,
  fmt: v => v.toFixed(2),
  onChange: v => {
    if (window.fxNodes && window.fxNodes.widthSideGain && window.fxNodes.widthSideGain.gain) {
      window.fxNodes.widthSideGain.gain.value = v;
    }
    window.eqState.width = v;
  }
});

buildFxStrip('SPEED', {
  min:0.5, max:2, step:0.05,
  value: window.eqState.speed != null ? window.eqState.speed : 1,
  fmt: v => v.toFixed(2) + 'x',
  onChange: v => {
    if (window._nousSound && typeof window._nousSound.rate === 'function') {
      window._nousSound.rate(v);
    }
    window.eqState.speed = v;
  }
});

buildFxStrip('DRIVE', {
  min:0, max:100, step:1,
  value: window.eqState.drive != null ? window.eqState.drive : 0,
  fmt: v => v.toFixed(0),
  onChange: v => {
    if (window.fxNodes && window.fxNodes.drive) {
      const curveFn = (typeof window.makeDriveCurve === 'function')
        ? window.makeDriveCurve
        : makeDriveCurve;
      if (typeof curveFn === 'function') {
        window.fxNodes.drive.curve = curveFn(v);
        window.fxNodes.drive.oversample = '4x';
      }
    }
    window.eqState.drive = v;
  }
});

buildFxStrip('FILTER', {
  min:100, max:22000, step:1,
  value: window.eqState.filter != null ? window.eqState.filter : 8000,
  fmt: v => v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0),
  onChange: v => {
    if (window.fxNodes && window.fxNodes.filter && window.fxNodes.filter.frequency) {
      window.fxNodes.filter.frequency.value = v;
    }
    window.eqState.filter = v;
  }
});

// ---- Reset to defaults ----
const EQ_DEFAULTS = { sub:0, low:0, mid:0, high:0, master:0, drive:15, reverb:0.25, width:1, speed:1, filter:8000 };
const resetBtn = document.createElement('button');
resetBtn.id = 'eqResetBtn';
resetBtn.type = 'button';
resetBtn.textContent = 'RESET';
resetBtn.title = 'Reset all EQ + FX to defaults';
resetBtn.addEventListener('click', () => {
  Object.assign(window.eqState, EQ_DEFAULTS);
  ['sub','low','mid','high','master'].forEach(b => {
    const f = faders[b];
    if (f) {
      f.value = EQ_DEFAULTS[b];
      f.dispatchEvent(new Event('input'));
    }
  });
  Object.entries({reverb:'reverb', width:'width', speed:'speed', drive:'drive', filter:'filter'}).forEach(([k]) => {
    const knob = fxKnobs[k];
    if (knob) {
      knob.value = EQ_DEFAULTS[k];
      knob.dispatchEvent(new Event('input'));
    }
  });
});
controlsRow.appendChild(resetBtn);

// =========================================================================
// Sync visible UI controls to externally-applied snapshots (e.g. A/B toggle
// in split_toggle.js). split_toggle.js writes audio nodes directly via
// window.fxNodes; this listener mirrors the same snapshot back onto the
// visible <webaudio-slider> / <webaudio-knob> elements so the user sees the
// faders and knobs physically move. Firing 'input' also re-runs the existing
// per-control handlers — that re-writes the audio nodes with the same value
// (idempotent, harmless).
// =========================================================================
window.addEventListener('eq-state-applied', function (e) {
  const snap = (e && e.detail) ? e.detail : window.eqState;
  if (!snap) return;

  function syncEl(el, val) {
    if (!el || val == null) return;
    try {
      el.value = val;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) { /* defensive */ }
  }

  // Bus faders
  ['sub','low','mid','high'].forEach(function (b) {
    if (faders && faders[b]) syncEl(faders[b], snap[b]);
  });

  // Master fader
  if (faders && faders.master) syncEl(faders.master, snap.master);

  // FX knobs
  if (fxKnobs) {
    syncEl(fxKnobs.reverb, snap.reverb);
    syncEl(fxKnobs.width,  snap.width);
    syncEl(fxKnobs.speed,  snap.speed);
    syncEl(fxKnobs.drive,  snap.drive);
    syncEl(fxKnobs.filter, snap.filter);
  }
});

// =========================================================================
// VU meter draw loop — runs every frame from script load. Reads from
// `analysers` defensively (empty until Phase B routes audio).
// =========================================================================
const buf = new Uint8Array(256);
const busLevels = window.busLevels = {sub:0, low:0, mid:0, high:0};

function updatePills(){
  const ar = (window.audioReact && typeof window.audioReact === 'object') ? window.audioReact : null;
  const setText = (k, t) => { const el = pills[k]; if (el && el.innerText !== t) el.innerText = t; };
  const sigilCount = (typeof window._vfxSigilCount === 'number' && isFinite(window._vfxSigilCount)) ? window._vfxSigilCount : 0;
  const pixelAb    = (typeof window._vfxPixelAberration === 'number' && isFinite(window._vfxPixelAberration)) ? window._vfxPixelAberration : 0;
  const asciiCell  = (typeof window._vfxAsciiCell === 'number' && isFinite(window._vfxAsciiCell)) ? window._vfxAsciiCell : 16;
  const kalSpeed   = (typeof window._vfxKaleidoSpeed === 'number' && isFinite(window._vfxKaleidoSpeed)) ? window._vfxKaleidoSpeed : 0.015;
  const bloomPx    = (typeof window._vfxBloomPx === 'number' && isFinite(window._vfxBloomPx)) ? window._vfxBloomPx : 0;
  const stageW     = (typeof window._vfxStageWidth === 'number' && isFinite(window._vfxStageWidth)) ? window._vfxStageWidth : 1;
  const animMul    = (typeof window._vfxAnimSpeedMul === 'number' && isFinite(window._vfxAnimSpeedMul)) ? window._vfxAnimSpeedMul : 1;
  const posterize  = (typeof window._vfxPosterize === 'number' && isFinite(window._vfxPosterize)) ? window._vfxPosterize : 16;
  const stageHue   = (typeof window._vfxStageHue === 'number' && isFinite(window._vfxStageHue)) ? window._vfxStageHue : 0;
  const subOnset   = !!(ar && ar.onsets && ar.onsets.sub);

  setText('sub',    sigilCount.toFixed(0) + '/hit');
  setText('low',    pixelAb.toFixed(1) + 'px');
  setText('mid',    asciiCell.toFixed(0) + 'px');
  setText('high',   kalSpeed.toFixed(3));
  setText('master', subOnset ? 'ON' : 'idle');
  setText('reverb', bloomPx.toFixed(1) + 'px');
  setText('width',  stageW.toFixed(2) + 'x');
  setText('speed',  animMul.toFixed(2) + 'x');
  setText('drive',  posterize.toFixed(0));
  setText('filter', stageHue.toFixed(0) + '°');
}

function draw(){
  BUSES.forEach(b => {
    const a = analysers && analysers[b];
    const cv = vuCans[b]; if (!cv) return;
    const c = cv.getContext('2d');
    const w=cv.width, h=cv.height;
    c.fillStyle='#0a0215'; c.fillRect(0,0,w,h);
    if (!a) return; // analyser not yet wired — leave bar empty
    a.getByteTimeDomainData(buf);
    let sum=0;
    for (let i=0;i<buf.length;i++){ const x=(buf[i]-128)/128; sum+=x*x; }
    const rms = Math.min(1, Math.sqrt(sum/buf.length));
    busLevels[b] = busLevels[b]*0.85 + rms*0.15;
    const visLevel = Math.min(1, busLevels[b] * 4);
    const g = c.createLinearGradient(0,h,0,0);
    g.addColorStop(0,'#33ccff'); g.addColorStop(0.6,'#ffcc00'); g.addColorStop(1,'#ff3366');
    c.fillStyle=g;
    c.fillRect(1, h - visLevel*h, w-2, visLevel*h);
  });
  if (vuCans.master){
    const mc = vuCans.master.getContext('2d');
    const mw = vuCans.master.width, mh = vuCans.master.height;
    mc.fillStyle='#0a0215'; mc.fillRect(0,0,mw,mh);
    const avg = (busLevels.sub+busLevels.low+busLevels.mid+busLevels.high)/4;
    const visAvg = Math.min(1, avg * 4);
    const mg = mc.createLinearGradient(0,mh,0,0);
    mg.addColorStop(0,'#33ccff'); mg.addColorStop(0.6,'#ffcc00'); mg.addColorStop(1,'#ff3366');
    mc.fillStyle=mg;
    mc.fillRect(1, mh-visAvg*mh, mw-2, visAvg*mh);
  }
  try { updatePills(); } catch(_) {}
  requestAnimationFrame(draw);
}
draw();

// =========================================================================
// Apply mixer defaults from window.lastAnalysis once it's available.
// =========================================================================
let _defaultsApplied = false;
function applyMixerDefaultsFromAnalysis(a){
  if (_defaultsApplied || !a) return;
  if (typeof a.lowRatio !== 'number' || typeof a.midRatio !== 'number' || typeof a.highRatio !== 'number') return;
  _defaultsApplied = true;
  const lufs = (typeof a.lufs === 'number') ? a.lufs : -14;
  const subVal    = clamp((a.lowRatio - 0.33) * 30, -12, 12);
  const lowVal    = clamp((a.lowRatio*0.5 + a.midRatio*0.3 - 0.25) * 24, -12, 12);
  const midVal    = clamp((a.midRatio - 0.33) * 24, -12, 12);
  const highVal   = clamp((a.highRatio - 0.33) * 24, -12, 12);
  const masterVal = clamp((lufs + 14) * -0.6, -12, 12);
  const setF = (name, v) => {
    const f = faders[name];
    if (!f) return;
    f.value = v;
    f.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setF('sub', subVal);
  setF('low', lowVal);
  setF('mid', midVal);
  setF('high', highVal);
  setF('master', masterVal);
}
if (window.lastAnalysis) {
  applyMixerDefaultsFromAnalysis(window.lastAnalysis);
} else {
  const _poll = setInterval(() => {
    if (window.lastAnalysis) {
      applyMixerDefaultsFromAnalysis(window.lastAnalysis);
      if (_defaultsApplied) clearInterval(_poll);
    }
  }, 500);
}
})();
