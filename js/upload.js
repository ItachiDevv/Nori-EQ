/* upload.js — audio file upload + microphone handling */
const dropzone = document.getElementById('dropzone');
const audioInput = document.getElementById('audioInput');
const uploadedName = document.getElementById('uploadedName');
const micBtn = document.getElementById('micBtn');
const micStatus = document.getElementById('micStatus');

let currentSound = null;
let currentMic = null;

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
  if (currentMic) { currentMic.stop(); currentMic = null; }
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
    currentSound.play();
    if (typeof connectAudio === 'function') connectAudio('file', currentSound);
    micStatus.textContent = '';
    switchToPane('stagePane');
  }, (err) => {
    uploadedName.textContent = 'Error loading audio';
    console.error(err);
  });
}

micBtn.addEventListener('click', async () => {
  if (currentMic) {
    currentMic.stop();
    currentMic = null;
    micBtn.textContent = 'Use Microphone';
    micStatus.textContent = 'Mic stopped';
    if (typeof connectAudio === 'function') connectAudio(null, null);
    return;
  }
  try {
    currentMic = new p5.AudioIn();
    await currentMic.start();
    micStatus.textContent = 'Microphone active';
    micBtn.textContent = 'Stop Microphone';
    if (typeof connectAudio === 'function') connectAudio('mic', currentMic);
    switchToPane('stagePane');
  } catch (e) {
    micStatus.textContent = 'Mic blocked or unavailable';
    console.error(e);
  }
});
