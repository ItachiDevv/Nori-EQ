/* default_track.js — auto-load nous.mp3 as default mix, play on first user gesture */
(async function () {
  const URL_MP3 = '/nous.mp3';
  const NAME = 'Nori Nori';
  const ARTIST = 'Clawville';
  window.currentTrackName = NAME;
  window.currentTrackArtist = ARTIST;

  // Pre-fetch and run offline analysis so the producer tab + title card have data immediately
  let blob = null;
  try {
    const resp = await fetch(URL_MP3);
    blob = await resp.blob();
    const file = new File([blob], NAME, { type: blob.type || 'audio/mpeg' });
    if (typeof window.analyzeAudioFile === 'function') {
      await window.analyzeAudioFile(file);
    }
    const meta = document.getElementById('uploadedName');
    if (meta && window.lastAnalysis) {
      const a = window.lastAnalysis;
      meta.textContent = `Default mix: ${NAME} — LUFS ${a.lufs}, centroid ${a.spectralCentroidHz}Hz, transients ${a.transientDensity}/s. Click anywhere to play.`;
    } else if (meta) {
      meta.textContent = `Default mix: ${NAME}. Click anywhere to play.`;
    }
  } catch (e) {
    console.warn('default track preload failed:', e);
  }

  // Show a tiny "click to start" hint over the stage
  const hint = document.createElement('div');
  hint.id = 'startHint';
  hint.textContent = '▶ click anywhere to start Nori Nori — Clawville';
  Object.assign(hint.style, {
    position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '8px 16px',
    borderRadius: '999px', fontSize: '13px', fontWeight: '600',
    zIndex: '50', cursor: 'pointer', letterSpacing: '0.5px',
    border: '1px solid rgba(255,255,255,0.3)'
  });
  const stageWrap = document.getElementById('stageWrap');
  if (stageWrap) stageWrap.appendChild(hint);

  let started = false;
  function start() {
    if (started) return;
    started = true;
    if (hint.parentNode) hint.parentNode.removeChild(hint);

    // Resume AudioContext SYNCHRONOUSLY inside the gesture handler.
    // If we wait until loadSound's callback (which fires later, async),
    // the user-gesture window has closed and strict autoplay policies
    // (Chrome on HTTPS production, Safari, Firefox) keep the context
    // suspended. Localhost is exempt from those policies, which is why
    // this only manifested in production.
    try {
      if (typeof userStartAudio === 'function') userStartAudio();
      if (typeof getAudioContext === 'function') {
        const ac = getAudioContext();
        if (ac && ac.state === 'suspended') ac.resume();
      }
    } catch (e) { console.warn('audio context resume failed:', e); }

    // Attribution card — 2s solid hold, then 3s fade-out, total 5s visible
    const card = document.createElement('div');
    card.textContent = 'Made with Hermes Suno prompts and Kimi K2.6';
    Object.assign(card.style, {
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0,0,0,0.8)', color: '#f0e6ff',
      padding: '18px 32px', borderRadius: '12px',
      fontFamily: '"Courier New", monospace', fontSize: '16px',
      letterSpacing: '1px', border: '1px solid var(--magenta)',
      zIndex: '60', opacity: '1', transition: 'opacity 3s ease'
    });
    if (stageWrap) stageWrap.appendChild(card);
    setTimeout(() => { card.style.opacity = '0'; }, 2000);
    setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); }, 5300);

    if (typeof loadSound === 'function') {
      const objUrl = URL.createObjectURL(blob);
      const sound = loadSound(objUrl, () => {
        // Belt-and-suspenders: try resume again here, in case the first attempt was suppressed.
        try {
          if (typeof getAudioContext === 'function') {
            const ac = getAudioContext();
            if (ac && ac.state === 'suspended') ac.resume();
          }
        } catch (_) {}
        sound.setLoop(true);
        sound.play();
        if (typeof fft !== 'undefined' && fft && typeof fft.setInput === 'function') fft.setInput(sound);
        if (typeof waveform !== 'undefined' && waveform && typeof waveform.setInput === 'function') waveform.setInput(sound);
        // Stop the mic stream and patch mic.getLevel() to read the sound's amplitude.
        // concert.js's draw() calls mic.getLevel() directly, so this routes the song's level into the whole reactive chain.
        try {
          if (typeof mic !== 'undefined' && mic) {
            if (typeof mic.stop === 'function') mic.stop();
            mic.getLevel = () => {
              try { return Math.max(0, Math.min(1, (sound.getLevel ? sound.getLevel() : 0) * 1.5)); }
              catch (_) { return 0; }
            };
          }
        } catch (_) {}
        window._nousSound = sound;
      }, (err) => {
        console.warn('loadSound failed for default track:', err);
      });
    }
  }

  // First click anywhere starts the track (browser autoplay policy)
  document.addEventListener('click', start, { once: true });
  document.addEventListener('keydown', start, { once: true });
  document.addEventListener('touchstart', start, { once: true });
})();
