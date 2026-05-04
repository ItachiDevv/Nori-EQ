(function(){
const cv = document.getElementById('atmosphereCanvas');
if (!cv || typeof Atmosphere === 'undefined') return;
const wrap = document.getElementById('stageWrap');
const atm = new Atmosphere(cv, { autoStart: false, gridCols: 64, gridRows: 36 });
atm.resize = function(){
cv.width = cv.clientWidth || wrap.clientWidth;
cv.height = cv.clientHeight || wrap.clientHeight;
this.cs = Math.max(8, Math.floor(Math.min(cv.width / this.cols, cv.height / this.rows)));
};
atm.resize();
window.addEventListener('resize', () => atm.resize());
function loop(){
const fft = window._lastAtmosFFT || { bass: 0, mid: 0, treble: 0, energy: 0 };
atm.setFFT(fft);
const now = performance.now();
const dt = (now - (atm._last || now)) / 1000;
atm._last = now;
atm.update(dt);
atm.draw();
requestAnimationFrame(loop);
}
loop();
})();