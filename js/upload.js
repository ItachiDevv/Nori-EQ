/* upload.js — audio file upload */
const dropzone = document.getElementById('dropzone');
const audioInput = document.getElementById('audioInput');
const uploadedName = document.getElementById('uploadedName');

let currentSound = null;

function switchToPane(id) {
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.pane').forEach(x=>x.classList.remove('active'));
  document.querySelector(`.tab[data-pane="${id}"]`).classList.add('active');
  document.getElementById(id).classList.add('active');
}

dropzone.addEventListener('click', () => audioInput.click());
audioInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  handleAudioFile(file);
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--magenta)'; });
dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--cyan)'; });
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = 'var(--cyan)';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('audio/')) handleAudioFile(file);
});

function handleAudioFile(file) {
  window.currentTrackName = file.name;
  window.currentTrackFile = file;  // stash for on-demand analysis (Nori, etc.)
  uploadedName.textContent = `Loaded: ${file.name} — analyzing...`;
  if (currentSound) { currentSound.stop(); currentSound = null; }
  window.lastServerAnalysis = null;

  // Run browser-side analysis FIRST so metrics are available for the server call.
  const localAnalyzed = (typeof window.analyzeAudioFile === 'function')
    ? window.analyzeAudioFile(file)
    : Promise.resolve(null);

  localAnalyzed.then((r) => {
    if (r) {
      uploadedName.textContent = `Loaded: ${file.name} — LUFS ${r.lufs}, centroid ${r.spectralCentroidHz}Hz, transients ${r.transientDensity}/s`;
    } else {
      uploadedName.textContent = `Loaded: ${file.name}`;
    }
  });

  const url = URL.createObjectURL(file);
  currentSound = loadSound(url, () => {
    // Stop the old default track if it's still playing — leftover from
    // first-click default_track.js that started before this upload.
    if (window._nousSound && window._nousSound !== currentSound) {
      try { if (typeof window._nousSound.stop === 'function') window._nousSound.stop(); } catch (_) {}
    }
    // Promote the uploaded sound to the global slot every other module
    // reads from (audio_reactivity.js, eq_panel.js speed knob, etc.).
    window._nousSound = currentSound;
    currentSound.play();
    // Reroute the EQ + FX chain inputs from the old source to this one
    // (no-op if the EQ chain hasn't been built yet — initAudio will pick
    // up _nousSound on its next poll).
    if (typeof window.rerouteToNewSource === 'function') {
      window.rerouteToNewSource(currentSound);
    }
    if (typeof connectAudio === 'function') connectAudio('file', currentSound);
    switchToPane('stagePane');
  }, (err) => {
    uploadedName.textContent = 'Error loading audio';
    console.error(err);
  });
}
