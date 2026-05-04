/* now_playing_widget.js — floating top-center pill: track + play/pause + upload.
   Defensive against missing globals: _nousSound, currentTrackName, lastAnalysis,
   lastServerAnalysis, handleAudioFile, runServerAnalysis, loadSound. */
(function () {
  if (document.getElementById('nowPlayingWidget')) return; // idempotent

  // ---------- DOM ----------
  const wrap = document.createElement('div');
  wrap.id = 'nowPlayingWidget';
  Object.assign(wrap.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '250', display: 'flex', alignItems: 'center', gap: '10px',
    padding: '8px 16px', borderRadius: '999px',
    background: 'rgba(15,5,32,0.88)', border: '1px solid #ff2bd6',
    boxShadow: '0 0 18px rgba(255,43,214,0.45), 0 0 32px rgba(0,229,255,0.18)',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    fontFamily: '"Courier New", monospace', fontSize: '12px',
    color: '#00e5ff', userSelect: 'none', maxWidth: 'calc(100vw - 32px)'
  });

  const mkBtn = (txt, title) => {
    const b = document.createElement('button');
    b.textContent = txt; b.title = title || '';
    Object.assign(b.style, {
      background: 'transparent', border: 'none', color: '#00e5ff',
      fontSize: '14px', cursor: 'pointer', padding: '0 4px',
      lineHeight: '1', fontFamily: 'inherit', transition: 'color .15s, text-shadow .15s'
    });
    b.onmouseenter = () => { b.style.color = '#ffd86b'; b.style.textShadow = '0 0 8px #ffd86b'; };
    b.onmouseleave = () => { b.style.color = '#00e5ff'; b.style.textShadow = 'none'; };
    return b;
  };

  const playBtn = mkBtn('▶', 'Play / Pause (Space)');
  const trackEl = document.createElement('span');
  Object.assign(trackEl.style, {
    color: '#ffd86b', fontSize: '13px', letterSpacing: '0.5px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    maxWidth: '50vw'
  });
  trackEl.textContent = 'Nori Nori';

  const sep = document.createElement('span');
  sep.textContent = '·'; sep.style.opacity = '0.5'; sep.style.display = 'none';

  const artistEl = document.createElement('span');
  Object.assign(artistEl.style, {
    color: '#00e5ff', opacity: '0.85',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    maxWidth: '30vw', display: 'none'
  });

  const uploadBtn = mkBtn('↑ UPLOAD', 'Upload audio file');
  uploadBtn.style.borderLeft = '1px solid rgba(255,230,0,0.5)';
  uploadBtn.style.paddingLeft = '12px';
  uploadBtn.style.marginLeft = '6px';
  uploadBtn.style.color = '#ffe600';
  uploadBtn.style.fontWeight = '700';
  uploadBtn.style.letterSpacing = '1px';
  uploadBtn.style.textShadow = '0 0 6px rgba(255,230,0,0.5)';
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'audio/*';
  fileInput.style.display = 'none';

  wrap.appendChild(playBtn);
  wrap.appendChild(trackEl);
  wrap.appendChild(sep);
  wrap.appendChild(artistEl);
  wrap.appendChild(uploadBtn);
  wrap.appendChild(fileInput);

  function mount() {
    if (document.body) document.body.appendChild(wrap);
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(wrap), { once: true });
  }
  mount();

  // ---------- helpers ----------
  const truncate = (s, n) => (s && s.length > n) ? s.slice(0, n - 1) + '…' : (s || '');
  const stripExt = (s) => (s || '').replace(/\.[^.]+$/, '');

  function isPlaying() {
    const s = window._nousSound;
    try { return !!(s && typeof s.isPlaying === 'function' && s.isPlaying()); }
    catch (_) { return false; }
  }

  // ---------- play/pause ----------
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = window._nousSound;
    if (!s) {
      // Pre-first-gesture: synthesize a click so default_track.js's once-listener fires.
      try { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (_) {}
      return;
    }
    try {
      if (typeof s.isPlaying === 'function' && s.isPlaying()) {
        if (typeof s.pause === 'function') s.pause();
      } else {
        if (typeof s.play === 'function') s.play();
      }
    } catch (err) { console.warn('play/pause failed:', err); }
  });

  // ---------- upload ----------
  uploadBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    routeFile(file);
    fileInput.value = '';
  });

  function routeFile(file) {
    window.currentTrackName = file.name;
    if (typeof window.handleAudioFile === 'function') {
      try { return window.handleAudioFile(file); } catch (err) { console.warn('handleAudioFile threw:', err); }
    }
    if (typeof window.runServerAnalysis === 'function') {
      try { window.runServerAnalysis(file); } catch (_) {}
    }
    // Last-resort: swap _nousSound via p5 loadSound if available.
    try {
      const url = URL.createObjectURL(file);
      if (typeof window.loadSound === 'function') {
        const old = window._nousSound;
        if (old && typeof old.stop === 'function') { try { old.stop(); } catch (_) {} }
        const snd = window.loadSound(url, () => {
          try { snd.setLoop && snd.setLoop(true); snd.play(); } catch (_) {}
          window._nousSound = snd;
        }, (err) => console.warn('fallback loadSound failed:', err));
      }
    } catch (err) { console.warn('blob fallback failed:', err); }
  }

  // ---------- update loop ----------
  let lastIcon = '', lastTrack = '', lastArtist = '';
  function tick() {
    const playing = isPlaying();
    const icon = playing ? '⏸' : '▶';
    if (icon !== lastIcon) { playBtn.textContent = icon; lastIcon = icon; }

    const a = window.lastAnalysis || {};
    const sa = window.lastServerAnalysis || null;
    const rawName = window.currentTrackName || a.filename || 'Nori Nori';
    const niceName = truncate(stripExt(rawName), 30);
    if (niceName !== lastTrack) { trackEl.textContent = niceName; trackEl.title = rawName; lastTrack = niceName; }

    let artist = '';
    if (sa && sa.metrics) artist = sa.metrics.artist || sa.metrics.title || '';
    if (!artist && typeof window.currentTrackArtist === 'string') artist = window.currentTrackArtist;
    if (artist !== lastArtist) {
      lastArtist = artist;
      if (artist) {
        artistEl.textContent = '— ' + truncate(artist, 28);
        artistEl.style.display = '';
        sep.style.display = '';
      } else {
        artistEl.style.display = 'none';
        sep.style.display = 'none';
      }
    }

    // Active-state visual cue
    wrap.style.borderColor = playing ? '#ffd86b' : '#ff2bd6';
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- keyboard: Space toggles when widget not focused on input ----------
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    playBtn.click();
  });
})();
