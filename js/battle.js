// Battle tab — split-screen dual atmosphere, no voting
(function(){
  const pane = document.getElementById('battlePane');
  if (!pane) return;

  const names = Object.keys(Atmosphere.presets || {});
  const selA = document.getElementById('battleSelA');
  const selB = document.getElementById('battleSelB');
  names.forEach(n => {
    const optA = document.createElement('option'); optA.value = n; optA.textContent = n; selA.appendChild(optA);
    const optB = document.createElement('option'); optB.value = n; optB.textContent = n; selB.appendChild(optB);
  });
  if (names[0]) selA.value = names[0];
  if (names[1] || names[0]) selB.value = names[1] || names[0];

  function mkCanvas(container) {
    const c = document.createElement('canvas');
    c.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    container.appendChild(c);
    return c;
  }

  const cA = mkCanvas(document.getElementById('battleA'));
  const cB = mkCanvas(document.getElementById('battleB'));

  const atmA = new Atmosphere(cA, { autoStart: false });
  const atmB = new Atmosphere(cB, { autoStart: false });

  function pickPreset(name) {
    return Atmosphere.presets[name] || Atmosphere.presets.hyperpop || {};
  }

  atmA.cfg = Object.assign({}, pickPreset(selA.value));
  atmB.cfg = Object.assign({}, pickPreset(selB.value));

  selA.addEventListener('change', () => { atmA.cfg = Object.assign({}, pickPreset(selA.value)); });
  selB.addEventListener('change', () => { atmB.cfg = Object.assign({}, pickPreset(selB.value)); });

  function frame() {
    const fft = window._lastAtmosFFT || { bass: 0, mid: 0, treble: 0, energy: 0 };
    atmA.setFFT(fft); atmB.setFFT(fft);
    const now = performance.now();
    const dtA = (now - (atmA._last || now)) / 1000;
    const dtB = (now - (atmB._last || now)) / 1000;
    atmA._last = now; atmB._last = now;
    atmA.update(dtA); atmA.draw();
    atmB.update(dtB); atmB.draw();
    if (!pane.classList.contains('active')) {
      requestAnimationFrame(frame);
      return;
    }
    requestAnimationFrame(frame);
  }
  frame();
})();
