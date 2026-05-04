/* intro_modal.js
 * One-time click-through explainer for Nori EQ.
 * Shows 4 slides on first page load, dismissable via Skip / GET STARTED / ESC.
 * Persists "seen" via localStorage key 'nori_eq_intro_seen_v2'.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'nori_eq_intro_seen_v2';

  // ---------- localStorage helpers (defensive) ----------
  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }

  if (safeGet(STORAGE_KEY) === '1') {
    return; // already seen, never mount
  }

  // ---------- Slide data ----------
  var SLIDES = [
    {
      heading: 'Welcome to Nori EQ',
      body: 'A web-based audio playground with reactive visuals, an in-browser EQ rack, and AI engineering feedback.'
    },
    {
      heading: 'Click anywhere to start the show',
      body: 'Browsers block autoplay until you interact. The default track is <strong>Nori Nori</strong> by <strong>Clawville</strong> &mdash; generated with Suno via Hermes prompts.'
    },
    {
      heading: 'Mix the song to drive the visuals',
      body: 'The mixer at the bottom controls audio AND scales every visual effect. Push SUB up &mdash; bigger sigil flashes. Pull MID down &mdash; finer ASCII detail.'
    },
    {
      heading: 'Made with Hermes Suno prompts + Kimi K2.6',
      body: 'Built with Hermes (Nous Research) for the Suno prompts and Kimi K2.6 (Moonshot AI) for the engineering. Open source under MIT.'
    }
  ];

  var currentIndex = 0;

  // ---------- Style injection ----------
  var style = document.createElement('style');
  style.id = 'hermes-intro-style';
  style.textContent =
    '#hermes-intro-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;font-family:"Segoe UI",sans-serif;animation:hermesIntroFade 280ms ease-out}' +
    '@keyframes hermesIntroFade{from{opacity:0}to{opacity:1}}' +
    '#hermes-intro-card{position:relative;width:560px;max-width:90vw;padding:32px;background:rgba(15,5,32,0.95);border:1px solid #ff2bd6;border-radius:12px;box-shadow:0 0 24px rgba(255,43,214,0.45),0 0 60px rgba(255,43,214,0.25),0 0 120px rgba(0,229,255,0.15);display:flex;flex-direction:column;gap:20px}' +
    '#hermes-intro-indicator{position:absolute;top:14px;right:18px;font-family:"Courier New",monospace;font-size:12px;color:#9988aa;letter-spacing:1px}' +
    '#hermes-intro-content{min-height:140px;display:flex;flex-direction:column;gap:14px;transition:opacity 200ms ease}' +
    '#hermes-intro-content.fading{opacity:0}' +
    '#hermes-intro-heading{font-family:"Courier New",monospace;font-size:22px;font-weight:700;color:#ffe600;text-shadow:0 0 8px rgba(255,230,0,0.55),0 0 18px rgba(255,230,0,0.25);margin:0;line-height:1.25}' +
    '#hermes-intro-body{font-family:"Segoe UI",sans-serif;font-size:15px;line-height:1.5;color:#f0e6ff;margin:0}' +
    '#hermes-intro-body code{font-family:"Courier New",monospace;background:rgba(255,43,214,0.15);border:1px solid rgba(255,43,214,0.4);padding:1px 6px;border-radius:4px;color:#ffe600}' +
    '#hermes-intro-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:4px}' +
    '.hermes-intro-btn{font-family:"Courier New",monospace;font-size:13px;letter-spacing:1px;background:rgba(20,8,40,0.9);border:1px solid #ff2bd6;color:#00e5ff;padding:10px 18px;border-radius:6px;cursor:pointer;transition:all 140ms ease;text-transform:uppercase}' +
    '.hermes-intro-btn:hover:not(:disabled){border-color:#00e5ff;color:#ffe600;box-shadow:0 0 12px rgba(0,229,255,0.5)}' +
    '.hermes-intro-btn:focus{outline:2px solid #ffe600;outline-offset:2px}' +
    '.hermes-intro-btn:disabled{opacity:0.3;cursor:not-allowed}' +
    '.hermes-intro-btn.skip{border-color:#555;color:#9988aa;background:transparent}' +
    '.hermes-intro-btn.skip:hover{border-color:#888;color:#ccc;box-shadow:none}' +
    '.hermes-intro-btn.get-started{background:linear-gradient(90deg,#ffe600 0%,#00e5ff 100%);color:#0a0418;border-color:#ffe600;font-weight:700;box-shadow:0 0 18px rgba(255,230,0,0.55),0 0 28px rgba(0,229,255,0.35)}' +
    '.hermes-intro-btn.get-started:hover{filter:brightness(1.15);box-shadow:0 0 24px rgba(255,230,0,0.8),0 0 40px rgba(0,229,255,0.5)}';
  document.head.appendChild(style);

  // ---------- DOM construction ----------
  var overlay = document.createElement('div');
  overlay.id = 'hermes-intro-overlay';

  var card = document.createElement('div');
  card.id = 'hermes-intro-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'hermes-intro-heading');
  card.setAttribute('aria-describedby', 'hermes-intro-body');

  var indicator = document.createElement('div');
  indicator.id = 'hermes-intro-indicator';

  var content = document.createElement('div');
  content.id = 'hermes-intro-content';

  var heading = document.createElement('h2');
  heading.id = 'hermes-intro-heading';

  var body = document.createElement('p');
  body.id = 'hermes-intro-body';

  content.appendChild(heading);
  content.appendChild(body);

  var footer = document.createElement('div');
  footer.id = 'hermes-intro-footer';

  var backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'hermes-intro-btn back';
  backBtn.textContent = '← Back';
  backBtn.setAttribute('aria-label', 'Previous slide');

  var skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'hermes-intro-btn skip';
  skipBtn.textContent = 'Skip';
  skipBtn.setAttribute('aria-label', 'Skip intro');

  var nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'hermes-intro-btn next';
  nextBtn.textContent = 'Next →';
  nextBtn.setAttribute('aria-label', 'Next slide');

  footer.appendChild(backBtn);
  footer.appendChild(skipBtn);
  footer.appendChild(nextBtn);

  card.appendChild(indicator);
  card.appendChild(content);
  card.appendChild(footer);
  overlay.appendChild(card);

  // ---------- Render / state ----------
  function render() {
    var slide = SLIDES[currentIndex];
    indicator.textContent = (currentIndex + 1) + ' / ' + SLIDES.length;
    heading.textContent = slide.heading;
    body.innerHTML = slide.body;

    backBtn.disabled = currentIndex === 0;

    if (currentIndex === SLIDES.length - 1) {
      nextBtn.textContent = 'GET STARTED';
      nextBtn.classList.add('get-started');
      nextBtn.setAttribute('aria-label', 'Get started');
    } else {
      nextBtn.textContent = 'Next →';
      nextBtn.classList.remove('get-started');
      nextBtn.setAttribute('aria-label', 'Next slide');
    }
  }

  function crossfadeTo(newIndex) {
    if (newIndex < 0 || newIndex >= SLIDES.length) return;
    if (newIndex === currentIndex) return;
    content.classList.add('fading');
    setTimeout(function () {
      currentIndex = newIndex;
      render();
      content.classList.remove('fading');
    }, 200);
  }

  function goNext() {
    if (currentIndex === SLIDES.length - 1) {
      dismiss();
    } else {
      crossfadeTo(currentIndex + 1);
    }
  }

  function goBack() {
    if (currentIndex > 0) crossfadeTo(currentIndex - 1);
  }

  function dismiss() {
    safeSet(STORAGE_KEY, '1');
    document.removeEventListener('keydown', onKey, true);
    if (overlay && overlay.parentNode) {
      overlay.style.transition = 'opacity 200ms ease';
      overlay.style.opacity = '0';
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (style.parentNode) style.parentNode.removeChild(style);
      }, 220);
    }
  }

  // ---------- Focus trap ----------
  function getFocusable() {
    return [backBtn, skipBtn, nextBtn].filter(function (b) { return !b.disabled; });
  }

  function trapFocus(e) {
    var focusables = getFocusable();
    if (focusables.length === 0) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---------- Keyboard ----------
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      dismiss();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      goNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      goBack();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
  }

  // ---------- Wire events ----------
  backBtn.addEventListener('click', goBack);
  skipBtn.addEventListener('click', dismiss);
  nextBtn.addEventListener('click', goNext);
  document.addEventListener('keydown', onKey, true);

  // Block backdrop clicks from passing through, but don't dismiss on backdrop click
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) {
      // Optional: could dismiss here, but spec says only Skip / GET STARTED / ESC dismiss
      e.stopPropagation();
    }
  });

  // ---------- Mount ----------
  function mount() {
    document.body.appendChild(overlay);
    render();
    // Initial focus on Next per tab order ending point; spec lists Back -> Skip -> Next.
    // Focus the first interactive item that's enabled (Skip when Back is disabled on slide 0).
    setTimeout(function () {
      var f = getFocusable();
      if (f.length) f[0].focus();
    }, 30);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
