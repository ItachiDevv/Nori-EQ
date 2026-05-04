// Now Playing tab — reads analysis results from window.lastAnalysis
(function(){
function upd() {
const a = window.lastAnalysis || {};
document.getElementById('npTrackName').textContent = a.filename || window.currentTrackName || 'Nori Nori';
const d = a.durationSec;
const dur = d != null ? `${Math.floor(d/60)}:${String(Math.floor(d%60)).padStart(2,'0')}` : '--:--';
document.getElementById('npDuration').textContent = dur;
document.getElementById('npPeak').textContent = a.peakDbfs != null ? a.peakDbfs.toFixed(1) + ' dBFS' : '--';
const rmsEl = document.getElementById('npRms');
if (rmsEl) rmsEl.textContent = a.lufs != null ? a.lufs.toFixed(1) + ' LUFS' : (a.crestDb != null ? a.crestDb.toFixed(1) + ' dB crest' : '--');
document.getElementById('npCentroid').textContent = a.spectralCentroidHz != null ? Math.round(a.spectralCentroidHz) : '--';
}
  setInterval(upd, 500);
  upd();

  // Dup upload wiring for this tab's dropzone
  const dz = document.getElementById('npDropzone');
  const input = document.getElementById('npAudioInput');
  if (!dz || !input) return;

  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (typeof handleAudioFile === 'function') {
      handleAudioFile(f);
    } else if (window.analyzeAudioFile) {
      window.analyzeAudioFile(f);
    }
  });
})();