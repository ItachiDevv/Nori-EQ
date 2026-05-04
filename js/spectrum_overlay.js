/* spectrum_overlay.js — black rounded-rect title card: track + LUFS */
const spectrumCanvas = document.getElementById('spectrumCanvas');
const togSpectrum = document.getElementById('togSpectrum');
let specCtx = spectrumCanvas.getContext('2d');

let spectrumOn = true;

function resizeSpec() {
  const wrap = document.getElementById('stageWrap');
  if (!wrap) return;
  spectrumCanvas.width = wrap.clientWidth;
  spectrumCanvas.height = wrap.clientHeight;
}
window.addEventListener('resize', resizeSpec);
resizeSpec();

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawTitleCard() {
  if (!spectrumOn) return;
  const w = spectrumCanvas.width;
  const h = spectrumCanvas.height;
  specCtx.clearRect(0, 0, w, h);

  const cardW = 260;
  const cardH = 70;
  const x = w - cardW - 24;
  const y = h - cardH - 24;

  specCtx.save();
  specCtx.setTransform(1, 0, -0.08, 1, x + cardH * 0.08, y);

  specCtx.fillStyle = 'rgba(0,0,0,0.92)';
  roundRect(specCtx, 0, 0, cardW, cardH, 12);
  specCtx.fill();

  specCtx.fillStyle = '#ffffff';
  specCtx.font = 'bold 14px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  specCtx.textBaseline = 'top';

  const track = window.currentTrackName || 'LIVE MIC';
  specCtx.fillText(track.length > 28 ? track.slice(0, 25) + '...' : track, 14, 12);

  let info = '-';
  if (window.lastAnalysis && typeof window.lastAnalysis.lufs === 'number') {
    info = window.lastAnalysis.lufs.toFixed(1) + ' LUFS';
  } else if (typeof getAudioLevel === 'function') {
    const lvl = getAudioLevel();
    const v = typeof lvl === 'number' ? lvl : (lvl && lvl.vol) || 0;
    info = (v * 100).toFixed(0) + '% LIVE';
  }
  specCtx.font = '12px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  specCtx.fillStyle = '#aaaaaa';
  specCtx.fillText(info, 14, 38);

  specCtx.restore();
}

if (togSpectrum) togSpectrum.addEventListener('click', () => {
  spectrumOn = !spectrumOn;
  togSpectrum.classList.toggle('on', spectrumOn);
  togSpectrum.textContent = spectrumOn ? 'Spectrum: ON' : 'Spectrum: OFF';
  spectrumCanvas.style.opacity = spectrumOn ? '1' : '0';
  if (!spectrumOn) specCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
});

spectrumCanvas.style.opacity = '1';
(function loop() {
  drawTitleCard();
  requestAnimationFrame(loop);
})();