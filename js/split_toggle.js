// split_toggle.js — Stage "Split" mode
// Integrates the Battle feature INTO the Stage as a toggle. When active,
// the stage shows two atmosphere personalities side-by-side with their
// own preset selectors. Click the toggle again to merge back to solo.
//
// Self-contained: mounts on body load, no external setup required.
// Reuses globals: window.Atmosphere, window.audioReact.envelopes, #stageWrap.
(function () {
  'use strict';

  // ---------- State ----------
  var state = {
    on: false,
    btn: null,
    leftCanvas: null,
    rightCanvas: null,
    leftSel: null,
    rightSel: null,
    leftSelWrap: null,
    rightSelWrap: null,
    leftAtm: null,
    rightAtm: null,
    raf: 0,
    hidden: [],   // [{el, prev}]
    mountTries: 0,
    // --- Mixer A/B feature ---
    presetA: null,
    presetB: null,
    presetOriginal: null,
    activeSlot: 'A',
    toolbar: null,
    btnSaveA: null,
    btnSaveB: null,
    btnTogA: null,
    btnTogB: null,
    btnKeep: null,
    btnCancel: null
  };

  // Safe defaults at script load.
  state.presetA = {};
  state.presetB = {};
  state.presetOriginal = {};

  // Underlying solo-stage layers we hide while split is on.
  var SOLO_LAYER_IDS = [
    'atmosphereCanvas',
    'asciiCanvas',
    'pixelCanvas',
    'spectrumCanvas',
    'pretextLayer',
    'strobeOverlay',
    'eqPillBar'  // hide pill-bar readouts in split mode — they don't apply to dual atmospheres
  ];

  // ---------- Helpers ----------
  function getStageWrap() { return document.getElementById('stageWrap'); }

  function getAtmosphereClass() {
    if (typeof window.Atmosphere === 'function') return window.Atmosphere;
    if (typeof Atmosphere !== 'undefined') return Atmosphere;
    return null;
  }
  function hasAtmosphere() { return typeof getAtmosphereClass() === 'function'; }

  function presetKeys() {
    var A = getAtmosphereClass();
    return (A && A.presets) ? Object.keys(A.presets) : [];
  }

  // Map audioReact envelopes {sub,low,mid,high} -> Atmosphere setFFT shape.
  function readEnvelopes() {
    var ar = window.audioReact;
    if (!ar || !ar.envelopes) return { bass: 0, mid: 0, treble: 0, energy: 0 };
    var e = ar.envelopes;
    var bass = Math.max(e.sub || 0, e.low || 0);
    var mid = e.mid || 0;
    var treble = e.high || 0;
    var energy = (bass + mid + treble) / 3;
    return { bass: bass, mid: mid, treble: treble, energy: energy };
  }

  // Apply a preset by key onto an Atmosphere instance.
  function applyPreset(atm, key) {
    var A = getAtmosphereClass();
    if (!atm || !A || !A.presets || !A.presets[key]) return;
    if (typeof atm.setConfig === 'function') {
      atm.setConfig(key);
    } else {
      atm.cfg = Object.assign({}, A.presets[key]);
    }
  }

  // Pick two distinct preset keys; falls back gracefully if fewer than 2 available.
  function pickTwoDifferent() {
    var A = getAtmosphereClass();
    var keys = (A && A.presets) ? Object.keys(A.presets) : [];
    if (keys.length === 0) return ['vapor', 'acid'];
    if (keys.length < 2) return [keys[0], keys[0]];
    var i = Math.floor(Math.random() * keys.length);
    var j;
    do { j = Math.floor(Math.random() * keys.length); } while (j === i);
    return [keys[i], keys[j]];
  }

  // ---------- Toggle button ----------
  function buildToggleButton() {
    var btn = document.createElement('button');
    btn.id = 'togSplit';
    btn.className = 'pill';
    btn.type = 'button';
    btn.textContent = '⊞ SPLIT VIEW';
    btn.style.position = 'fixed';
    btn.style.top = '14px';
    btn.style.left = '180px';
    btn.style.zIndex = '260';
    btn.addEventListener('click', function () {
      if (state.on) deactivate();
      else activate();
    });
    document.body.appendChild(btn);
    return btn;
  }

  // ---------- Preset dropdown ----------
  function buildPresetSelect(initial, onChange) {
    var sel = document.createElement('select');
    sel.style.position = 'absolute';
    sel.style.top = '8px';
    sel.style.left = '50%';
    sel.style.transform = 'translateX(-50%)';
    sel.style.zIndex = '101';
    sel.style.background = 'rgba(0,0,0,0.7)';
    sel.style.border = '1px solid var(--magenta, #ff3366)';
    sel.style.color = 'var(--gold, #ffcc33)';
    sel.style.padding = '4px 10px';
    sel.style.borderRadius = '999px';
    sel.style.fontSize = '11px';
    sel.style.fontFamily = 'inherit';
    sel.style.cursor = 'pointer';
    sel.style.backdropFilter = 'blur(4px)';
    sel.style.outline = 'none';

    var keys = presetKeys();
    keys.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      if (k === initial) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  // ---------- Split canvas ----------
  function buildSplitCanvas(side) {
    var c = document.createElement('canvas');
    c.id = side === 'left' ? 'splitLeft' : 'splitRight';
    c.style.position = 'absolute';
    c.style.top = '0';
    c.style.bottom = '0';
    c.style.width = '50%';
    c.style.height = '100%';
    if (side === 'left') {
      c.style.left = '0';
    } else {
      c.style.left = '50%';
      c.style.right = '0';
    }
    c.style.zIndex = '99';
    c.style.background = '#0f0520';
    c.style.opacity = '0';
    c.style.transition = 'opacity 200ms ease';
    c.style.display = 'block';
    return c;
  }

  function buildSelectorWrap(side) {
    var w = document.createElement('div');
    w.style.position = 'absolute';
    w.style.top = '70px'; // below header chrome (logo + SPLIT btn + Now Playing + Nori pill)
    w.style.left = side === 'left' ? '0' : '50%';
    w.style.width = '50%';
    w.style.height = '36px';
    w.style.zIndex = '101';
    w.style.pointerEvents = 'none'; // wrap is transparent; child select gets pointer-events
    return w;
  }

  // ---------- A/B Mixer Toolbar ----------
  function styleToolbarBtn(btn) {
    btn.type = 'button';
    btn.className = 'pill';
    btn.style.fontSize = '10px';
    btn.style.padding = '4px 9px';
    btn.style.borderRadius = '999px';
    btn.style.background = 'rgba(0,0,0,0.55)';
    btn.style.border = '1px solid var(--magenta, #ff3366)';
    btn.style.color = 'var(--gold, #ffcc33)';
    btn.style.cursor = 'pointer';
    btn.style.fontFamily = 'inherit';
    btn.style.letterSpacing = '0.5px';
    btn.style.pointerEvents = 'auto';
    btn.style.transition = 'border-color 180ms ease, background 180ms ease, box-shadow 180ms ease';
  }

  function flashGold(btn) {
    if (!btn) return;
    var prevShadow = btn.style.boxShadow;
    var prevBorder = btn.style.borderColor;
    btn.style.boxShadow = '0 0 12px var(--gold, #ffcc33)';
    btn.style.borderColor = 'var(--gold, #ffcc33)';
    setTimeout(function () {
      btn.style.boxShadow = prevShadow || '';
      btn.style.borderColor = prevBorder || 'var(--magenta, #ff3366)';
      updateActiveSlotUI();
    }, 220);
  }

  function updateActiveSlotUI() {
    if (!state.btnTogA || !state.btnTogB) return;
    var activeStyle = function (b) {
      b.style.background = 'rgba(255,204,51,0.18)';
      b.style.borderColor = 'var(--gold, #ffcc33)';
      b.style.boxShadow = '0 0 8px rgba(255,204,51,0.5)';
    };
    var inactiveStyle = function (b) {
      b.style.background = 'rgba(0,0,0,0.55)';
      b.style.borderColor = 'var(--magenta, #ff3366)';
      b.style.boxShadow = 'none';
    };
    if (state.activeSlot === 'A') {
      activeStyle(state.btnTogA);
      inactiveStyle(state.btnTogB);
    } else {
      activeStyle(state.btnTogB);
      inactiveStyle(state.btnTogA);
    }
  }

  function buildToolbar() {
    var bar = document.createElement('div');
    bar.id = 'splitMixerToolbar';
    bar.style.position = 'absolute';
    bar.style.top = '110px';
    bar.style.left = '50%';
    bar.style.transform = 'translateX(-50%)';
    bar.style.zIndex = '102';
    bar.style.display = 'flex';
    bar.style.gap = '6px';
    bar.style.padding = '6px 10px';
    bar.style.borderRadius = '8px';
    bar.style.background = 'rgba(15,5,32,0.75)';
    bar.style.backdropFilter = 'blur(6px)';
    bar.style.webkitBackdropFilter = 'blur(6px)';
    bar.style.pointerEvents = 'auto';
    bar.style.opacity = '0';
    bar.style.transition = 'opacity 200ms ease';

    state.btnSaveA = document.createElement('button');
    state.btnSaveA.textContent = '⊕ SAVE A';
    styleToolbarBtn(state.btnSaveA);
    state.btnSaveA.addEventListener('click', function () {
      snapshotEqInto('A');
      flashGold(state.btnSaveA);
    });

    state.btnSaveB = document.createElement('button');
    state.btnSaveB.textContent = '⊕ SAVE B';
    styleToolbarBtn(state.btnSaveB);
    state.btnSaveB.addEventListener('click', function () {
      snapshotEqInto('B');
      flashGold(state.btnSaveB);
    });

    state.btnTogA = document.createElement('button');
    state.btnTogA.textContent = '◐ A';
    styleToolbarBtn(state.btnTogA);
    state.btnTogA.addEventListener('click', function () {
      state.activeSlot = 'A';
      applySnapshot(state.presetA);
      updateActiveSlotUI();
    });

    state.btnTogB = document.createElement('button');
    state.btnTogB.textContent = '◑ B';
    styleToolbarBtn(state.btnTogB);
    state.btnTogB.addEventListener('click', function () {
      state.activeSlot = 'B';
      applySnapshot(state.presetB);
      updateActiveSlotUI();
    });

    state.btnKeep = document.createElement('button');
    state.btnKeep.textContent = '★ KEEP';
    styleToolbarBtn(state.btnKeep);
    state.btnKeep.addEventListener('click', function () {
      // Active slot already applied to window.eqState; commit and exit.
      showToast('✓ KEPT ' + state.activeSlot);
      setTimeout(deactivate, 120);
    });

    state.btnCancel = document.createElement('button');
    state.btnCancel.textContent = '× CANCEL';
    styleToolbarBtn(state.btnCancel);
    state.btnCancel.addEventListener('click', function () {
      applySnapshot(state.presetOriginal);
      deactivate();
    });

    bar.appendChild(state.btnSaveA);
    bar.appendChild(state.btnSaveB);
    bar.appendChild(state.btnTogA);
    bar.appendChild(state.btnTogB);
    bar.appendChild(state.btnKeep);
    bar.appendChild(state.btnCancel);
    return bar;
  }

  // ---------- Snapshot / apply mixer state ----------
  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return {}; }
  }

  function snapshotEqInto(slot) {
    if (!window.eqState) return;
    var snap = deepClone(window.eqState);
    if (slot === 'A') state.presetA = snap;
    else if (slot === 'B') state.presetB = snap;
  }

  // Push snapshot into window.eqState AND into live audio nodes.
  // Visible WebAudio Controls fader positions are NOT updated here — see report.
  function applySnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    if (!window.eqState) return;
    Object.keys(snap).forEach(function (key) {
      window.eqState[key] = snap[key];
    });

    try {
      if (window.fxNodes) {
        if (window.fxNodes.reverbWetGain && typeof snap.reverb === 'number') {
          window.fxNodes.reverbWetGain.gain.value = snap.reverb;
        }
        if (window.fxNodes.filter && typeof snap.filter === 'number') {
          window.fxNodes.filter.frequency.value = snap.filter;
        }
        if (window.fxNodes.widthSideGain && typeof snap.width === 'number') {
          window.fxNodes.widthSideGain.gain.value = snap.width;
        }
        if (window.fxNodes.drive && typeof window.makeDriveCurve === 'function' && typeof snap.drive === 'number') {
          window.fxNodes.drive.curve = window.makeDriveCurve(snap.drive);
          window.fxNodes.drive.oversample = '4x';
        }
      }
      if (window._nousSound && typeof window._nousSound.rate === 'function' && typeof snap.speed === 'number') {
        try { window._nousSound.rate(snap.speed); } catch (_) {}
      }
    } catch (e) {
      console.warn('[split_toggle] applySnapshot audio sync failed', e);
    }

    try {
      window.dispatchEvent(new CustomEvent('eq-state-applied', { detail: snap }));
    } catch (_) {}
  }

  // ---------- Toast ----------
  function showToast(text) {
    var wrap = getStageWrap();
    if (!wrap) return;
    var t = document.createElement('div');
    t.textContent = text;
    t.style.position = 'absolute';
    t.style.top = '160px';
    t.style.left = '50%';
    t.style.transform = 'translateX(-50%)';
    t.style.zIndex = '103';
    t.style.padding = '8px 16px';
    t.style.borderRadius = '999px';
    t.style.background = 'rgba(15,5,32,0.85)';
    t.style.border = '1px solid var(--gold, #ffcc33)';
    t.style.color = 'var(--gold, #ffcc33)';
    t.style.fontSize = '12px';
    t.style.fontFamily = 'inherit';
    t.style.letterSpacing = '1px';
    t.style.boxShadow = '0 0 18px rgba(255,204,51,0.4)';
    t.style.opacity = '0';
    t.style.transition = 'opacity 160ms ease';
    wrap.appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = '1'; });
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }, 900);
  }

  // ---------- Hide / restore solo layers ----------
  function hideSoloLayers() {
    state.hidden = [];
    SOLO_LAYER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      state.hidden.push({ el: el, prev: el.style.display });
      el.style.display = 'none';
    });
    // Hide stray p5 canvases mounted into stageWrap.
    var wrap = getStageWrap();
    if (wrap) {
      var p5canvases = wrap.querySelectorAll('canvas.p5Canvas, canvas[id^="defaultCanvas"]');
      Array.prototype.forEach.call(p5canvases, function (el) {
        state.hidden.push({ el: el, prev: el.style.display });
        el.style.display = 'none';
      });
    }
  }
  function restoreSoloLayers() {
    state.hidden.forEach(function (h) { h.el.style.display = h.prev || ''; });
    state.hidden = [];
  }

  // ---------- Animation loop (FFT pump) ----------
  function loop() {
    var fft = readEnvelopes();
    if (state.leftAtm && typeof state.leftAtm.setFFT === 'function') state.leftAtm.setFFT(fft);
    if (state.rightAtm && typeof state.rightAtm.setFFT === 'function') state.rightAtm.setFFT(fft);
    state.raf = requestAnimationFrame(loop);
  }

  // ---------- Activate / Deactivate ----------
  function activate() {
    if (state.on) return;
    if (!hasAtmosphere()) {
      // Defensive retry — Atmosphere class might not be loaded yet.
      if (state.mountTries++ < 10) {
        setTimeout(activate, 200);
      } else {
        console.warn('[split_toggle] Atmosphere class unavailable after retries');
      }
      return;
    }
    var wrap = getStageWrap();
    if (!wrap) {
      console.warn('[split_toggle] #stageWrap not found');
      return;
    }
    state.mountTries = 0;
    state.on = true;
    state.btn.classList.add('on');
    state.btn.textContent = '⊟ EXIT SPLIT';

    // --- Snapshot mixer state for A/B feature ---
    if (window.eqState) {
      state.presetOriginal = deepClone(window.eqState);
      state.presetA = deepClone(window.eqState);
      state.presetB = deepClone(window.eqState);
    } else {
      state.presetOriginal = {};
      state.presetA = {};
      state.presetB = {};
    }
    state.activeSlot = 'A';

    hideSoloLayers();

    // Random distinct preset pick — re-randomized every activate().
    var pair = pickTwoDifferent();
    var leftKey = pair[0];
    var rightKey = pair[1];

    var A = getAtmosphereClass();

    // --- Left half ---
    state.leftCanvas = buildSplitCanvas('left');
    wrap.appendChild(state.leftCanvas);
    try {
      state.leftAtm = new A(state.leftCanvas, Object.assign({}, A.presets[leftKey]));
    } catch (e) { console.warn('[split_toggle] left atm init failed', e); }

    state.leftSelWrap = buildSelectorWrap('left');
    state.leftSel = buildPresetSelect(leftKey, function (k) { applyPreset(state.leftAtm, k); });
    state.leftSel.style.pointerEvents = 'auto';
    state.leftSelWrap.appendChild(state.leftSel);
    wrap.appendChild(state.leftSelWrap);

    // --- Right half ---
    state.rightCanvas = buildSplitCanvas('right');
    wrap.appendChild(state.rightCanvas);
    try {
      state.rightAtm = new A(state.rightCanvas, Object.assign({}, A.presets[rightKey]));
    } catch (e) { console.warn('[split_toggle] right atm init failed', e); }

    state.rightSelWrap = buildSelectorWrap('right');
    state.rightSel = buildPresetSelect(rightKey, function (k) { applyPreset(state.rightAtm, k); });
    state.rightSel.style.pointerEvents = 'auto';
    state.rightSelWrap.appendChild(state.rightSel);
    wrap.appendChild(state.rightSelWrap);

    // --- Mixer A/B toolbar ---
    state.toolbar = buildToolbar();
    wrap.appendChild(state.toolbar);
    updateActiveSlotUI();

    // Fade in (next frame, so transition fires)
    requestAnimationFrame(function () {
      if (state.leftCanvas) state.leftCanvas.style.opacity = '1';
      if (state.rightCanvas) state.rightCanvas.style.opacity = '1';
      if (state.toolbar) state.toolbar.style.opacity = '1';
    });

    // Resize each half once layout settles.
    if (state.leftAtm && state.leftAtm.resize) state.leftAtm.resize();
    if (state.rightAtm && state.rightAtm.resize) state.rightAtm.resize();

    if (!state.raf) state.raf = requestAnimationFrame(loop);
    window.addEventListener('resize', onResize);
  }

  function deactivate() {
    if (!state.on) return;
    state.on = false;
    state.btn.classList.remove('on');
    state.btn.textContent = '⊞ SPLIT VIEW';

    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    window.removeEventListener('resize', onResize);

    // Stop atmospheres' internal rAFs.
    try { state.leftAtm && state.leftAtm.stop && state.leftAtm.stop(); } catch (e) {}
    try { state.rightAtm && state.rightAtm.stop && state.rightAtm.stop(); } catch (e) {}

    var toRemove = [
      state.leftCanvas, state.rightCanvas,
      state.leftSelWrap, state.rightSelWrap,
      state.toolbar
    ];
    toRemove.forEach(function (el) { if (el) el.style.opacity = '0'; });

    setTimeout(function () {
      toRemove.forEach(function (el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    }, 220);

    state.leftCanvas = state.rightCanvas = null;
    state.leftSel = state.rightSel = null;
    state.leftAtm = state.rightAtm = null;
    state.leftSelWrap = state.rightSelWrap = null;
    state.toolbar = null;
    state.btnSaveA = state.btnSaveB = null;
    state.btnTogA = state.btnTogB = null;
    state.btnKeep = state.btnCancel = null;

    restoreSoloLayers();
  }

  function onResize() {
    if (state.leftAtm && state.leftAtm.resize) state.leftAtm.resize();
    if (state.rightAtm && state.rightAtm.resize) state.rightAtm.resize();
  }

  // ---------- Init ----------
  function init() {
    if (document.getElementById('togSplit')) return;
    state.btn = buildToggleButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging / external orchestration.
  window.splitToggle = {
    activate: activate,
    deactivate: deactivate,
    isOn: function () { return state.on; },
    getSlots: function () {
      return {
        A: state.presetA,
        B: state.presetB,
        original: state.presetOriginal,
        active: state.activeSlot
      };
    }
  };
})();
