/* demo_timeline.js — Page-side demo driver for Nori EQ.
 *
 * Reads /demo/timeline.json, then over its `meta.totalSec` window:
 *  - Animates window.eqState param values via linear/exponential/step ramps,
 *    re-broadcasting the snapshot via the `eq-state-applied` CustomEvent so
 *    the visible faders/knobs follow.
 *  - Fires segment-scoped UI hints (button clicks, highlight pulses, NORI
 *    chat type-and-send) at each segment's tStart.
 *
 * Audio comes from the already-playing _nousSound. This driver does NOT
 * render audio — it only mirrors the same automation onto the live page
 * for screen-recording.
 *
 * Public API:
 *   window.runDemoTimeline({ autoStart: true, autoPlay: true })
 *   window.demoTimeline = { stop(), state }
 *
 * Invoked from devtools console during the recording session — no UI button.
 */
(function () {
  'use strict';

  console.log('[demo-timeline] loaded — call runDemoTimeline() to start');

  // =========================================================================
  // CONFIG / STYLE INJECTION
  // =========================================================================
  var TIMELINE_URL = 'demo/timeline.json';
  var DEFAULT_NEUTRAL = {
    sub: 0, low: 0, mid: 0, high: 0, master: 0,
    drive: 15, reverb: 0.25, width: 1, speed: 1, filter: 22000,
  };

  function injectStyle() {
    if (document.getElementById('demo-timeline-style')) return;
    var s = document.createElement('style');
    s.id = 'demo-timeline-style';
    s.textContent =
      '.demo-highlight { box-shadow: 0 0 24px gold !important; ' +
      'transition: box-shadow .3s; outline: 1px solid rgba(255,215,0,0.7); } ' +
      '.demo-stage-bloom { filter: drop-shadow(0 0 22px rgba(255,140,255,0.55)) ' +
      'drop-shadow(0 0 44px rgba(0,240,255,0.35)) !important; ' +
      'transition: filter .4s ease; } ' +
      '.demo-stage-hue { filter: hue-rotate(175deg) saturate(1.3) !important; ' +
      'transition: filter .6s ease; } ' +
      '.demo-stage-pulse { filter: drop-shadow(0 0 30px rgba(255,255,255,0.6)) ' +
      'drop-shadow(0 0 60px rgba(255,43,214,0.4)) saturate(1.4) !important; ' +
      'transition: filter .4s ease; } ' +
      '.demo-logo-fade { animation: demo-logo-fade-kf 4s ease-in forwards; } ' +
      '@keyframes demo-logo-fade-kf { from { opacity: 0; } to { opacity: 1; } }';
    document.head.appendChild(s);
  }

  // =========================================================================
  // SAFE DOM HELPERS
  // =========================================================================
  function $(sel) { try { return document.querySelector(sel); } catch (_) { return null; } }
  function $$(sel) { try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (_) { return []; } }

  function safeClick(el, label) {
    if (!el) { console.warn('[demo-timeline] click target missing:', label); return false; }
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (_) {
        console.warn('[demo-timeline] click failed:', label, e);
        return false;
      }
    }
  }

  function pulse(el, ms) {
    if (!el) return;
    try {
      el.classList.add('demo-highlight');
      setTimeout(function () { try { el.classList.remove('demo-highlight'); } catch (_) {} }, ms || 1500);
    } catch (_) {}
  }

  function pulseAll(els, ms) { (els || []).forEach(function (e) { pulse(e, ms); }); }

  function findFader(name) {
    // eq_panel mounts <webaudio-slider> inside .strip whose .strip-label text matches the bus name.
    var strips = $$('#eqPanel .strip');
    for (var i = 0; i < strips.length; i++) {
      var lbl = strips[i].querySelector('.strip-label');
      if (lbl && lbl.textContent.trim().toUpperCase() === name.toUpperCase()) {
        return strips[i].querySelector('webaudio-slider') || strips[i];
      }
    }
    return null;
  }

  function findFxKnob(name) {
    var strips = $$('#eqPanel .fx-strip');
    for (var i = 0; i < strips.length; i++) {
      var lbl = strips[i].querySelector('.fx-label');
      if (lbl && lbl.textContent.trim().toUpperCase() === name.toUpperCase()) {
        return strips[i].querySelector('webaudio-knob') || strips[i];
      }
    }
    return null;
  }

  function findPill(key) {
    // eqPillBar children: .vfx with .name text === label e.g. SIGIL, ASCII...
    var labelMap = { sub: 'SIGIL', low: 'PIXEL', mid: 'ASCII', high: 'KALEIDO',
                     master: 'STROBE', reverb: 'BLOOM', width: 'STEREO',
                     speed: 'TIME', drive: 'POSTERIZE', filter: 'HUE' };
    var want = (labelMap[key] || key).toUpperCase();
    var vfxs = $$('#eqPillBar .vfx');
    for (var i = 0; i < vfxs.length; i++) {
      var n = vfxs[i].querySelector('.name');
      if (n && n.textContent.trim().toUpperCase() === want) return vfxs[i];
    }
    return null;
  }

  // =========================================================================
  // EQ STATE BROADCAST
  // =========================================================================
  function applyEqState(snap) {
    if (!window.eqState) window.eqState = {};
    Object.keys(snap).forEach(function (k) { window.eqState[k] = snap[k]; });
    // Mirror onto live audio nodes too, in case eq_panel listener doesn't cover all.
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
    } catch (_) {}
    try {
      var ev = new CustomEvent('eq-state-applied', { detail: Object.assign({}, window.eqState) });
      document.dispatchEvent(ev);
      window.dispatchEvent(ev);
    } catch (_) {}
  }

  function resetToNeutral() {
    var snap = Object.assign({}, DEFAULT_NEUTRAL);
    applyEqState(snap);
  }

  // =========================================================================
  // RAMP MATH
  // =========================================================================
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  function evalAutomationAt(now, byParam) {
    // byParam[param] = sorted array of {t, to, ramp, rampSec, _from}
    var out = {};
    Object.keys(byParam).forEach(function (param) {
      var entries = byParam[param];
      var current = (typeof window.eqState === 'object' && window.eqState && typeof window.eqState[param] === 'number')
        ? window.eqState[param]
        : (typeof DEFAULT_NEUTRAL[param] === 'number' ? DEFAULT_NEUTRAL[param] : 0);
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (now < e.t) break; // future, leave `current` as-is
        var rampSec = e.rampSec || 0;
        var from = (typeof e._from === 'number') ? e._from : current;
        if (e.ramp === 'step' || rampSec <= 0) {
          current = e.to;
          continue;
        }
        var endT = e.t + rampSec;
        if (now >= endT) {
          current = e.to;
          continue;
        }
        var p = clamp01((now - e.t) / rampSec);
        if (e.ramp === 'exponential' && from > 0 && e.to > 0) {
          current = from * Math.pow(e.to / from, p);
        } else {
          // linear (and exponential fallback when from <= 0)
          current = lerp(from, e.to, p);
        }
      }
      out[param] = current;
    });
    return out;
  }

  function preindexAutomation(automation) {
    // Group by param, sort by t, set _from = previous resolved 'to' or default.
    var byParam = {};
    automation.forEach(function (a) {
      if (!a || typeof a.param !== 'string') return;
      (byParam[a.param] = byParam[a.param] || []).push({
        t: +a.t || 0,
        to: +a.to,
        ramp: a.ramp || 'step',
        rampSec: +a.rampSec || 0,
        _from: undefined,
      });
    });
    Object.keys(byParam).forEach(function (param) {
      byParam[param].sort(function (a, b) { return a.t - b.t; });
      var prev = (typeof DEFAULT_NEUTRAL[param] === 'number') ? DEFAULT_NEUTRAL[param] : 0;
      byParam[param].forEach(function (e) { e._from = prev; prev = e.to; });
    });
    return byParam;
  }

  // =========================================================================
  // UI HINT HANDLERS
  // =========================================================================
  function applyStageClass(cls, durationMs) {
    var stage = $('#stageWrap');
    if (!stage) { console.warn('[demo-timeline] #stageWrap not found for', cls); return; }
    stage.classList.add(cls);
    setTimeout(function () { try { stage.classList.remove(cls); } catch (_) {} }, durationMs || 5000);
  }

  function noriOpenAndAsk(question) {
    var pill = $('.nori-pill') || $('#nori-widget-root .nori-pill');
    if (!pill) { console.warn('[demo-timeline] uiHint open-nori-panel: target not found'); return; }
    safeClick(pill, 'NORI pill');
    setTimeout(function () {
      var input = $('.nori-input');
      var send = $('.nori-send');
      if (!input || !send) {
        console.warn('[demo-timeline] uiHint open-nori-panel: input/send not found');
        return;
      }
      try { input.focus(); } catch (_) {}
      // Type char-by-char over ~2s
      input.value = '';
      var chars = (question || '').split('');
      var totalMs = 2000;
      var stepMs = Math.max(20, Math.floor(totalMs / Math.max(1, chars.length)));
      var idx = 0;
      function typeNext() {
        if (idx >= chars.length) {
          // After typing finishes (~2s), dispatch send click.
          setTimeout(function () { safeClick(send, 'NORI send'); }, 200);
          return;
        }
        input.value += chars[idx++];
        try {
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (_) {}
        setTimeout(typeNext, stepMs);
      }
      typeNext();
    }, 100);
  }

  function findSplitButton() { return $('#togSplit'); }

  function findSplitToolbarBtn(textPrefix) {
    var bar = $('#splitMixerToolbar');
    if (!bar) return null;
    var btns = bar.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim().indexOf(textPrefix) === 0 ||
          btns[i].textContent.indexOf(textPrefix) !== -1) return btns[i];
    }
    return null;
  }

  function clickToggleAB() {
    var a = findSplitToolbarBtn('◐ A');
    if (a) { safeClick(a, 'toggle A'); }
    else { console.warn('[demo-timeline] uiHint toggle-A-B: A button not found'); }
    setTimeout(function () {
      var b = findSplitToolbarBtn('◑ B');
      if (b) { safeClick(b, 'toggle B'); }
      else { console.warn('[demo-timeline] uiHint toggle-A-B: B button not found'); }
    }, 1500);
  }

  function openExportModal() {
    var pill = $('#exportPill');
    if (!pill) { console.warn('[demo-timeline] uiHint open-export-modal: #exportPill not found'); return; }
    safeClick(pill, 'EXPORT pill');
  }

  function selectMp3() {
    // Menu opt: button.opt with text containing 'MP3'
    var menu = $('#exportMenu');
    var opts = menu ? menu.querySelectorAll('.opt') : $$('.exp-menu .opt');
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].textContent.indexOf('MP3') !== -1) {
        safeClick(opts[i], 'MP3 opt');
        return;
      }
    }
    console.warn('[demo-timeline] uiHint select-mp3: option not found');
  }

  // Hint dispatcher.
  var HINT_TARGETS = {
    'highlight-sub-fader':    function () { return [findFader('SUB'), findPill('sub')]; },
    'highlight-low-fader':    function () { return [findFader('LOW'), findPill('low')]; },
    'highlight-mid-fader':    function () { return [findFader('MID'), findPill('mid')]; },
    'highlight-high-fader':   function () { return [findFader('HIGH'), findPill('high')]; },
    'highlight-reverb-knob':  function () { return [findFxKnob('REVERB'), findPill('reverb')]; },
    'highlight-filter-knob':  function () { return [findFxKnob('FILTER'), findPill('filter')]; },
    'highlight-drive-knob':   function () { return [findFxKnob('DRIVE'), findPill('drive')]; },
    'flash-sigil-pill':       function () { return [findPill('sub')]; },
    'highlight-ascii-overlay':function () { return [findPill('mid'), $('#asciiCanvas')]; },
    'highlight-pixel-overlay':function () { return [findPill('drive'), $('#pixelCanvas')]; },
    'spin-kaleido':           function () { return [findPill('high')]; },
    'highlight-mixer':        function () { return [$('#eqPanel')]; },
    'show-pillbar':           function () { return [$('#eqPillBar')]; },
    'title-card':             function () { return [$('#noriLogo'), $('h1')]; },
    'logo-bloom':             function () { return [$('#noriLogo'), $('h1')]; },
    'logo-fade-in':           function () { return [$('#noriLogo'), $('h1')]; },
    'credits':                function () { return [$('#noriLogo')]; },
  };

  function runUiHint(hintId, segment) {
    try {
      switch (hintId) {
        case 'open-nori-panel':
          noriOpenAndAsk('Is the bass too thin?');
          return;
        case 'show-ai-bubble':
        case 'show-infographic':
        case 'show-progress':
        case 'show-download-confirm':
          // No-op: handled by widget itself.
          return;
        case 'enter-split-mode': {
          var btn = findSplitButton();
          if (btn) safeClick(btn, 'SPLIT');
          else console.warn('[demo-timeline] uiHint enter-split-mode: target not found');
          return;
        }
        case 'save-A': {
          var saveA = findSplitToolbarBtn('SAVE A') || findSplitToolbarBtn('⊕ SAVE A');
          if (saveA) safeClick(saveA, 'SAVE A');
          else console.warn('[demo-timeline] uiHint save-A: target not found');
          return;
        }
        case 'save-B': {
          var saveB = findSplitToolbarBtn('SAVE B') || findSplitToolbarBtn('⊕ SAVE B');
          if (saveB) safeClick(saveB, 'SAVE B');
          else console.warn('[demo-timeline] uiHint save-B: target not found');
          return;
        }
        case 'toggle-A-B':
          clickToggleAB();
          return;
        case 'open-export-modal':
          openExportModal();
          return;
        case 'select-mp3':
          selectMp3();
          return;
        case 'stage-bloom':
          applyStageClass('demo-stage-bloom', ((segment && (segment.tEnd - segment.tStart)) || 8) * 1000);
          return;
        case 'hue-rotate-stage':
          applyStageClass('demo-stage-hue', ((segment && (segment.tEnd - segment.tStart)) || 8) * 1000);
          return;
        case 'full-stage-pulse':
          applyStageClass('demo-stage-pulse', ((segment && (segment.tEnd - segment.tStart)) || 12) * 1000);
          return;
        default: {
          // Generic highlight: resolve via HINT_TARGETS, fall back to no-op.
          var resolver = HINT_TARGETS[hintId];
          if (resolver) {
            var els = resolver().filter(Boolean);
            if (els.length === 0) {
              console.warn('[demo-timeline] uiHint', hintId, ': target not found');
            } else {
              pulseAll(els, 1500);
            }
          } else {
            console.warn('[demo-timeline] uiHint', hintId, ': unknown id, no-op');
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[demo-timeline] uiHint', hintId, 'threw:', e);
    }
  }

  // =========================================================================
  // PLAYBACK BOOTSTRAP
  // =========================================================================
  function ensurePlaying(timeoutMs) {
    return new Promise(function (resolve) {
      var start = performance.now();
      function tick() {
        var s = window._nousSound;
        var playing = false;
        try { playing = !!(s && typeof s.isPlaying === 'function' && s.isPlaying()); } catch (_) {}
        if (s && playing) return resolve(true);
        if (performance.now() - start > timeoutMs) return resolve(!!(s && playing));
        // Try to nudge first-gesture listener.
        try {
          document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        // Or directly play if the sound exists.
        try { if (s && typeof s.play === 'function' && !playing) s.play(); } catch (_) {}
        setTimeout(tick, 50);
      }
      tick();
    });
  }

  // =========================================================================
  // RUNNER
  // =========================================================================
  var runner = null;

  function stop() {
    if (!runner) return;
    if (runner.raf) {
      try { cancelAnimationFrame(runner.raf); } catch (_) {}
      runner.raf = 0;
    }
    runner.stopped = true;
    // Cleanup stage classes
    try {
      var stage = $('#stageWrap');
      if (stage) {
        ['demo-stage-bloom', 'demo-stage-hue', 'demo-stage-pulse'].forEach(function (c) {
          stage.classList.remove(c);
        });
      }
    } catch (_) {}
    // Remove lingering highlight classes
    try {
      $$('.demo-highlight').forEach(function (el) { el.classList.remove('demo-highlight'); });
    } catch (_) {}
    // Reset eq state to neutral
    try { resetToNeutral(); } catch (_) {}
  }

  window.demoTimeline = {
    stop: stop,
    get state() { return runner ? runner.cursor : null; },
  };

  window.runDemoTimeline = async function (opts) {
    opts = Object.assign({ autoStart: true, autoPlay: true }, opts || {});
    injectStyle();

    // Stop any prior run.
    if (runner && !runner.stopped) {
      try { stop(); } catch (_) {}
    }

    // Fetch timeline.
    var data;
    try {
      var resp = await fetch(TIMELINE_URL, { cache: 'no-cache' });
      data = await resp.json();
    } catch (e) {
      console.error('[demo-timeline] failed to load timeline.json:', e);
      return;
    }
    if (!data || !data.meta || !Array.isArray(data.segments) || !Array.isArray(data.automation)) {
      console.error('[demo-timeline] invalid timeline.json shape');
      return;
    }

    // Reset to neutral defaults BEFORE starting.
    resetToNeutral();

    // Ensure track is playing.
    if (opts.autoPlay) {
      var ok = await ensurePlaying(5000);
      if (!ok) console.warn('[demo-timeline] _nousSound did not start within 5s — continuing anyway');
    }

    // Try to rebase audio to t=0.
    try {
      var snd = window._nousSound;
      if (snd && typeof snd.jump === 'function') snd.jump(0);
    } catch (e) {
      console.warn('[demo-timeline] could not jump(0); starting from current playhead', e);
    }

    var byParam = preindexAutomation(data.automation);
    var segments = data.segments.slice();
    segments.forEach(function (s) { s._fired = false; });

    runner = {
      raf: 0,
      stopped: false,
      cursor: { t: 0, segment: null },
      t0: performance.now(),
      total: +data.meta.totalSec || 150,
    };

    function tick() {
      if (!runner || runner.stopped) return;
      var now = (performance.now() - runner.t0) / 1000;
      runner.cursor.t = now;

      // Fire segment hooks at tStart.
      for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        if (seg._fired) continue;
        if (now >= seg.tStart - 0.016) {
          seg._fired = true;
          runner.cursor.segment = seg.id;
          (seg.uiHints || []).forEach(function (h) { runUiHint(h, seg); });
        }
      }

      // Compute and apply current automation values.
      var snap = evalAutomationAt(now, byParam);
      try { applyEqState(snap); } catch (e) { /* swallow */ }

      if (now >= runner.total) {
        runner.stopped = true;
        runner.raf = 0;
        console.log('[demo-timeline] complete at t=' + now.toFixed(2));
        return;
      }
      runner.raf = requestAnimationFrame(tick);
    }

    if (opts.autoStart) {
      runner.t0 = performance.now();
      runner.raf = requestAnimationFrame(tick);
    }
    return runner;
  };
})();
