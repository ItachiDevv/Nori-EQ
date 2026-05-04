// Lyrics tab — FFT-driven ASCII Braille (U+2800–U+28FF)
// Pure visual, no real lyrics.
(function(){
  const wrap = document.getElementById('lyricsCanvasWrap');
  if (!wrap) return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
  wrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let w, h, cellSize = 18;
  const cols = 64;               // horizontal braille columns
  const rows = 8;                // vertical history depth
  const history = [];            // row arrays of { byteVal }

  function resize() {
    w = wrap.clientWidth;
    h = wrap.clientHeight;
    canvas.width = w;
    canvas.height = h;
    cellSize = Math.max(10, Math.floor(w / cols));
  }
  resize();
  window.addEventListener('resize', resize);

  // Build braille row from global FFT spectrum (set by concert.js each frame)
  function buildRow() {
    const spectrum = window._lastSpectrum || new Array(256).fill(0);
    const bands = 8;
    const binsPerBand = Math.floor(spectrum.length / bands);
    const cells = [];
    for (let c = 0; c < cols; c++) {
      let byteVal = 0;
      for (let b = 0; b < bands; b++) {
        const idx = Math.min(spectrum.length - 1, c * Math.floor(spectrum.length / cols) + Math.floor(b * binsPerBand / bands));
        const amp = spectrum[idx] / 255;
        if (amp > 0.35) byteVal |= (1 << b);
      }
      cells.push({ byteVal });
    }
    return cells;
  }

  function draw() {
    ctx.fillStyle = '#0f0520';
    ctx.fillRect(0, 0, w, h);

    //compute new row
    const newRow = buildRow();
    history.push(newRow);
    if (history.length > rows) history.shift();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${cellSize}px monospace`;

    const startY = h - rows * cellSize - 16;
    for (let r = 0; r < history.length; r++) {
      const row = history[r];
      const y = startY + r * cellSize + cellSize / 2;
      for (let c = 0; c < row.length; c++) {
        const ch = String.fromCharCode(0x2800 + row[c].byteVal);
        const x = c * cellSize + cellSize / 2;
        const br = row[c].byteVal;
        const brightness = Math.min(1, br / 255);
        const rColor = 50 + brightness * 180;
        const gColor = 20 + brightness * 60;
        const bColor = 80 + brightness * 170;
        ctx.fillStyle = `rgb(${rColor|0},${gColor|0},${bColor|0})`;
        ctx.fillText(ch, x, y);
      }
    }

    requestAnimationFrame(draw);
  }

  draw();
})();
