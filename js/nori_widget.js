/* nori_widget.js — Floating "Nori Engineering Feedback" pill + slide-out chat panel.
 * Self-contained: injects styles, mounts to <body>, talks to POST /api/feedback.
 * Reads window.lastAnalysis (browser metrics) + window.lastServerAnalysis (Gemini-side).
 */
(function () {
  'use strict';

  // ---------- styles ----------
  const CSS = `
    .nori-pill {
      position: fixed; top: 12px; right: 12px; z-index: 250;
      background: rgba(15,5,32,0.88); border: 1px solid #ffe600;
      box-shadow: 0 0 12px rgba(255,230,0,0.55), inset 0 0 6px rgba(255,230,0,0.18);
      color: #ffe600; font: bold 12px 'Courier New', monospace;
      letter-spacing: 0.08em; padding: 8px 18px; border-radius: 999px;
      cursor: pointer; user-select: none;
      transition: border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }
    .nori-pill:hover { border-color: #00f0ff; color: #00f0ff;
      box-shadow: 0 0 14px rgba(0,240,255,0.65), inset 0 0 6px rgba(0,240,255,0.22);
      transform: translateY(-1px); }
    .nori-pill.is-open { border-color: #ff2bd6; color: #ff2bd6;
      box-shadow: 0 0 14px rgba(255,43,214,0.65), inset 0 0 6px rgba(255,43,214,0.22); }
    .nori-panel {
      position: fixed; top: 70px; right: 0; bottom: 160px;
      width: 380px; max-width: 92vw; z-index: 245;
      background: rgba(15,5,32,0.92); border-left: 2px solid #ff2bd6;
      box-shadow: -8px 0 28px rgba(255,43,214,0.35), inset 0 0 22px rgba(255,230,0,0.10);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      transform: translateX(100%); transition: transform 250ms ease;
      display: flex; flex-direction: column; color: #e8e3ff;
      font-family: -apple-system, system-ui, 'Helvetica Neue', sans-serif;
    }
    .nori-panel.is-open { transform: translateX(0); }
    .nori-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; border-bottom: 1px solid rgba(255,43,214,0.35);
      font: bold 12px 'Courier New', monospace; letter-spacing: 0.08em;
      color: #ffe600; text-shadow: 0 0 8px rgba(255,230,0,0.45);
    }
    .nori-close {
      background: transparent; border: 1px solid rgba(255,255,255,0.25);
      color: #e8e3ff; width: 26px; height: 26px; border-radius: 6px;
      cursor: pointer; font-size: 16px; line-height: 1;
      transition: border-color 120ms ease, color 120ms ease;
    }
    .nori-close:hover { border-color: #ff2bd6; color: #ff2bd6; }
    .nori-chat { flex: 1; overflow-y: auto; padding: 12px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: #ff2bd6 transparent; }
    .nori-chat::-webkit-scrollbar { width: 6px; }
    .nori-chat::-webkit-scrollbar-thumb { background: rgba(255,43,214,0.45); border-radius: 3px; }
    .nori-msg { max-width: 86%; padding: 8px 11px; border-radius: 10px;
      font-size: 13px; line-height: 1.45; word-wrap: break-word; white-space: pre-wrap; }
    .nori-msg.user { align-self: flex-end;
      background: rgba(255,43,214,0.18); border: 1px solid rgba(255,43,214,0.55); color: #ffd6f5; }
    .nori-msg.ai { align-self: flex-start;
      background: rgba(0,240,255,0.10); border: 1px solid rgba(0,240,255,0.45); color: #d6f8ff; }
    .nori-msg.system { align-self: center; opacity: 0.75;
      font: 11px 'Courier New', monospace; color: #ffe600;
      border: 1px dashed rgba(255,230,0,0.35); background: rgba(255,230,0,0.06); }
    .nori-msg.error { align-self: stretch; color: #ffb4b4;
      border: 1px solid rgba(255,80,80,0.55); background: rgba(255,40,40,0.10); }
    .nori-msg .nori-svg { margin-top: 6px; max-width: 100%; }
    .nori-msg .nori-svg svg { width: 100%; height: auto; display: block; }
    .nori-spinner { display: inline-block; width: 10px; height: 10px; margin-right: 6px;
      border: 2px solid rgba(0,240,255,0.25); border-top-color: #00f0ff;
      border-radius: 50%; animation: nori-spin 800ms linear infinite; vertical-align: -2px; }
    @keyframes nori-spin { to { transform: rotate(360deg); } }
    .nori-quick { display: flex; gap: 6px; padding: 8px 10px;
      border-top: 1px solid rgba(255,43,214,0.25); flex-wrap: wrap; }
    .nori-chip { flex: 1 1 auto; background: rgba(15,5,32,0.6);
      border: 1px solid rgba(255,230,0,0.55); color: #ffe600;
      font: bold 10px 'Courier New', monospace; letter-spacing: 0.06em;
      padding: 6px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap;
      transition: border-color 120ms ease, color 120ms ease, background 120ms ease; }
    .nori-chip:hover { border-color: #00f0ff; color: #00f0ff; background: rgba(0,240,255,0.08); }
    .nori-input-row { display: flex; gap: 6px; padding: 10px;
      border-top: 1px solid rgba(255,43,214,0.35); background: rgba(0,0,0,0.25); }
    .nori-input { flex: 1; min-width: 0; background: rgba(0,0,0,0.45);
      border: 1px solid rgba(255,255,255,0.18); color: #e8e3ff;
      padding: 8px 10px; border-radius: 6px;
      font: 13px -apple-system, system-ui, sans-serif; outline: none;
      transition: border-color 120ms ease; }
    .nori-input:focus { border-color: #00f0ff; }
    .nori-send { background: rgba(255,230,0,0.12); border: 1px solid #ffe600;
      color: #ffe600; font: bold 11px 'Courier New', monospace; letter-spacing: 0.08em;
      padding: 0 14px; border-radius: 6px; cursor: pointer;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
    .nori-send:hover:not(:disabled) { background: #ffe600; color: #0f0520; }
    .nori-send:disabled { opacity: 0.45; cursor: wait; }
  `;

  function injectStyles() {
    if (document.getElementById('nori-widget-css')) return;
    const s = document.createElement('style');
    s.id = 'nori-widget-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------- context builder ----------
  function buildContext() {
    const parts = [];
    const a = window.lastAnalysis || null;
    const s = window.lastServerAnalysis || null;

    // Prefer server-side prebuilt context string if present (mirrors producer.js).
    if (s && typeof s.contextString === 'string' && s.contextString) {
      return s.contextString;
    }

    if (a) {
      if (a.filename) parts.push(`File: ${a.filename}`);
      if (a.durationSec != null) parts.push(`Duration: ${a.durationSec}s`);
      if (a.lufs != null) parts.push(`LUFS: ${a.lufs}`);
      if (a.peakDbfs != null) parts.push(`Peak: ${a.peakDbfs}dBFS`);
      if (a.crestDb != null) parts.push(`Crest: ${a.crestDb}dB`);
      if (a.spectralCentroidHz != null) parts.push(`SpectralCentroid: ${a.spectralCentroidHz}Hz`);
      if (a.transientDensity != null) parts.push(`Transients: ${a.transientDensity}/s`);
      if (a.stereoWidth != null) parts.push(`StereoWidth: ${a.stereoWidth}`);
      if (a.lowRatio != null && a.midRatio != null && a.highRatio != null) {
        parts.push(`Tonal Low/Mid/High: ${a.lowRatio}/${a.midRatio}/${a.highRatio}`);
      }
    }

    if (s && s.metrics) {
      const m = s.metrics;
      if (m.artist) parts.push(`Artist: ${m.artist}`);
      if (m.integratedLufs != null) parts.push(`IntegratedLUFS: ${m.integratedLufs}`);
      if (m.truePeakDbfs != null) parts.push(`TruePeak: ${m.truePeakDbfs}dBFS`);
      if (m.lra != null) parts.push(`LRA: ${m.lra}`);
    }

    return parts.join(', ');
  }

  // ---------- DOM construction ----------
  const els = {};

  function buildPill() {
    const pill = document.createElement('button');
    pill.className = 'nori-pill';
    pill.type = 'button';
    pill.setAttribute('aria-label', 'Open Nori engineering feedback');
    pill.textContent = '\u{1F39A} NORI ENGINEERING FEEDBACK';
    pill.addEventListener('click', togglePanel);
    return pill;
  }

  function buildPanel() {
    const panel = document.createElement('aside');
    panel.className = 'nori-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Nori engineering feedback');

    const header = document.createElement('div');
    header.className = 'nori-header';
    const title = document.createElement('span');
    title.textContent = 'NORI — engineering feedback';
    const close = document.createElement('button');
    close.className = 'nori-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => setOpen(false));
    header.appendChild(title);
    header.appendChild(close);

    const chat = document.createElement('div');
    chat.className = 'nori-chat';
    els.chat = chat;

    const quick = document.createElement('div');
    quick.className = 'nori-quick';
    const prompts = [
      { label: 'Mix balance', text: 'Critique the mix balance — low end, midrange clarity, top-end air.' },
      { label: 'Mastering loudness', text: 'Evaluate mastering loudness, headroom, and true-peak safety.' },
      { label: 'Re-analyze (edits)', text: '__REANALYZE__' },
    ];
    prompts.forEach((p) => {
      const chip = document.createElement('button');
      chip.className = 'nori-chip';
      chip.type = 'button';
      chip.textContent = '[ ' + p.label + ' ]';
      chip.addEventListener('click', () => {
        if (p.text === '__REANALYZE__') {
          triggerReanalysis();
          return;
        }
        els.input.value = p.text;
        els.input.focus();
      });
      quick.appendChild(chip);
    });

    const inputRow = document.createElement('div');
    inputRow.className = 'nori-input-row';
    const input = document.createElement('input');
    input.className = 'nori-input';
    input.type = 'text';
    input.placeholder = 'Ask Nori about your mix...';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    const sendBtn = document.createElement('button');
    sendBtn.className = 'nori-send';
    sendBtn.type = 'button';
    sendBtn.textContent = 'SEND';
    sendBtn.addEventListener('click', send);

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(chat);
    panel.appendChild(quick);
    panel.appendChild(inputRow);

    els.panel = panel;
    els.input = input;
    els.send = sendBtn;
    return panel;
  }

  // ---------- panel state ----------
  function setOpen(open) {
    if (!els.panel || !els.pill) return;
    els.panel.classList.toggle('is-open', !!open);
    els.pill.classList.toggle('is-open', !!open);
    if (open) setTimeout(() => { try { els.input.focus(); } catch (_) {} }, 260);
  }
  function togglePanel() {
    setOpen(!els.panel.classList.contains('is-open'));
  }

  // ---------- chat helpers ----------
  function pushMsg(who, text) {
    const div = document.createElement('div');
    div.className = 'nori-msg ' + who;
    div.textContent = text;
    els.chat.appendChild(div);
    els.chat.scrollTop = els.chat.scrollHeight;
    return div;
  }

  function pushAi(text, svgHtml) {
    const wrap = document.createElement('div');
    wrap.className = 'nori-msg ai';
    const body = document.createElement('div');
    body.textContent = text;
    wrap.appendChild(body);
    if (svgHtml && typeof svgHtml === 'string' && svgHtml.indexOf('<svg') !== -1) {
      const svg = document.createElement('div');
      svg.className = 'nori-svg';
      svg.innerHTML = svgHtml;
      wrap.appendChild(svg);
    }
    els.chat.appendChild(wrap);
    els.chat.scrollTop = els.chat.scrollHeight;
    return wrap;
  }

  function pushPending() {
    const div = document.createElement('div');
    div.className = 'nori-msg ai';
    div.innerHTML = '<span class="nori-spinner"></span>Nori is analyzing...';
    els.chat.appendChild(div);
    els.chat.scrollTop = els.chat.scrollHeight;
    return div;
  }

  // ---------- send flow ----------
  let inflight = false;

  const REANALYZE_PATTERNS = [
    /\b(re-?analyz|re-?run|re-?do|analyze again|run.*(again|once more))\b/i,
    /\b(after|with).{0,30}(edits?|changes?|tweaks?)\b/i,
    /\b(my|the|current|latest|new) (mix|edits?|version)\b.*(analy[sz]e|review|check|feedback)/i,
  ];

  async function send() {
    if (inflight) return;
    const text = (els.input.value || '').trim();
    if (!text) return;

    // Intent detection: re-analyze the edited mix instead of /api/feedback.
    const wantsReanalyze = REANALYZE_PATTERNS.some((rx) => rx.test(text));
    if (wantsReanalyze) {
      pushMsg('user', text);
      els.input.value = '';
      await triggerReanalysis();
      return;
    }

    pushMsg('user', text);
    els.input.value = '';
    els.send.disabled = true;
    inflight = true;
    const pending = pushPending();
    const context = buildContext();

    try {
      const resp = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, context }),
      });

      if (resp.status === 404) {
        pending.remove();
        pushMsg('error', 'Nori is offline — start the server with `node server.js`');
        return;
      }

      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        pending.remove();
        pushMsg('error', 'Nori is offline — start the server with `node server.js`');
        return;
      }

      const data = await resp.json();
      pending.remove();
      if (data && data.ok) {
        pushAi(data.text || data.reply || '(no reply)', data.infographic);
      } else {
        const err = (data && data.error) || 'unknown error';
        pushMsg('error', 'Nori: ' + err);
      }
    } catch (e) {
      pending.remove();
      pushMsg('error', 'Nori is offline — start the server with `node server.js`');
    } finally {
      inflight = false;
      els.send.disabled = false;
      try { els.input.focus(); } catch (_) {}
    }
  }

  // ---------- re-analyze edited mix ----------
  async function triggerReanalysis() {
    if (inflight) return;
    inflight = true;
    if (els.send) els.send.disabled = true;
    setOpen(true);

    // Phase 1: offline render of the edited mix
    const renderPending = pushMsg('system', 'Rendering your edited mix...');
    let rendered;
    try {
      if (typeof window.renderEditedMix !== 'function') {
        throw new Error('export pipeline not loaded yet');
      }
      rendered = await window.renderEditedMix({ format: 'wav' });
    } catch (e) {
      renderPending.remove();
      pushMsg('error', 'Could not render edited mix: ' + (e.message || e));
      inflight = false;
      if (els.send) els.send.disabled = false;
      return;
    }
    renderPending.remove();

    // Phase 2: hand off to /api/analyze via runServerAnalysis (which already
    // handles pending UI, response parsing, lastServerAnalysis caching).
    // Wrap blob as a File so it carries a name.
    const file = new File([rendered.blob], rendered.filename, { type: rendered.mimeType });
    inflight = false;          // release before calling runServerAnalysis (which sets its own)
    if (els.send) els.send.disabled = false;
    if (typeof window.runServerAnalysis === 'function') {
      await window.runServerAnalysis(file, window.lastAnalysis || null);
    } else {
      pushMsg('error', 'runServerAnalysis not available');
    }
  }

  // ---------- /api/analyze hookup ----------
  // Called by upload.js when the user drops a file. Posts audio + browser metrics
  // to /api/analyze, surfaces the critique in the Nori panel, caches the result
  // for follow-up /api/feedback calls. Overrides producer.js's stub.
  window.runServerAnalysis = async function (file, metrics) {
    if (inflight) return;
    setOpen(true);
    pushMsg('user', 'Uploaded: ' + (file?.name || 'track'));
    const pending = pushPending();
    if (els.send) els.send.disabled = true;
    inflight = true;
    try {
      const fd = new FormData();
      fd.append('audio', file);
      if (metrics) fd.append('metrics', JSON.stringify(metrics));
      const resp = await fetch('/api/analyze', { method: 'POST', body: fd });

      if (resp.status === 404) {
        pending.remove();
        pushMsg('error', 'Nori is offline — start the server with `node server.js`');
        return;
      }
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        pending.remove();
        pushMsg('error', 'Nori is offline — start the server with `node server.js`');
        return;
      }

      const data = await resp.json();
      pending.remove();
      if (data && data.ok) {
        window.lastServerAnalysis = {
          metrics: data.metrics,
          serverMetrics: data.serverMetrics,
          contextString: data.contextString,
          modelUsed: data.modelUsed,
        };
        pushAi(data.critique || data.text || '(no critique)', data.infographic);
      } else {
        pushMsg('error', 'Nori: ' + ((data && data.error) || 'analysis failed'));
      }
    } catch (e) {
      pending.remove();
      pushMsg('error', 'Nori is offline — start the server with `node server.js`');
    } finally {
      inflight = false;
      if (els.send) els.send.disabled = false;
    }
  };

  // ---------- mount ----------
  function mount() {
    if (document.getElementById('nori-widget-root')) return;
    injectStyles();
    const root = document.createElement('div');
    root.id = 'nori-widget-root';
    const pill = buildPill();
    const panel = buildPanel();
    els.pill = pill;
    root.appendChild(pill);
    root.appendChild(panel);
    document.body.appendChild(root);

    // Greeting bubble.
    pushMsg('system', 'Nori online — drop a track or ask anything about your mix.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
