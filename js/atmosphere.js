// Atmosphere — screen-filling FFT-reactive ASCII glyph field
// No character. No portrait. Full canvas coverage.
class Atmosphere {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = Object.assign({}, Atmosphere.presets.hyperpop, opts);
    this.cols = this.cfg.gridCols || 48;
    this.rows = this.cfg.gridRows || 48;
    this.fft = { bass: 0, mid: 0, treble: 0, energy: 0 };
    this.time = 0;

    // Each cell is a slot with phase + age. Content is recomputed per frame.
    this.cells = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        this.cells.push({
          x, y,
          phase: Math.random() * Math.PI * 2,
          age: Math.random()
        });
      }
    }
    this.resize();
    if (this.cfg.autoStart !== false) this.animate();
  }

  resize() {
    const cs = Math.max(8, Math.min(20, Math.floor(
      Math.min(this.canvas.clientWidth / this.cols, this.canvas.clientHeight / this.rows)
    )));
    this.cs = cs || 14;
    this.canvas.width = this.cols * this.cs;
    this.canvas.height = this.rows * this.cs;
  }

  setFFT(o) { this.fft = o; }

  // Vertical spatial separation: bass at bottom, treble at top
  _bandAt(y) {
    const r = y / this.rows;
    return r < 0.33 ? 'treble' : r < 0.66 ? 'mid' : 'bass';
  }

  _glyphFor(cell, layer) {
    const set = this.cfg.glyphSet || ['·','∙','•','▪','▫','░','▒','▓'];
    const off = Math.min(set.length - 1, layer.offset || 0);
    const subset = set.slice(off, off + Math.max(1, Math.ceil(set.length / 3)));
    const idx = Math.floor(Math.abs(Math.sin(cell.phase + this.time * (layer.speed || 1))) * subset.length) % subset.length;
    return subset[idx] || set[0];
  }

  _colorFor(cell, energy) {
    const p = this.cfg.palette || {};
    const colors = [p.fg0, p.fg1, p.fg2, p.fg3].filter(Boolean);
    const idx = Math.floor((cell.x / this.cols + cell.phase + energy) * colors.length) % Math.max(1, colors.length);
    return colors[idx] || p.fg0 || '#f0e6ff';
  }

  update(dt) {
    this.time += dt || 0.016;
  }

  draw() {
    const { ctx, canvas, cells, cols, rows, cs, cfg, fft, time } = this;
    const p = cfg.palette || {};
    ctx.fillStyle = p.bg || '#050010';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(8, cs - 2)}px monospace`;

    const densityFn = cfg.densityCurve || (e => 0.3 + e * 0.7);
    const density = densityFn(fft.energy || 0);
    const mode = cfg.flowMode || 'drift';
    const layers = cfg.bandLayers || {};

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const band = this._bandAt(cell.y);
      const layer = layers[band] || { offset: 0, speed: 1 };

      // Flow-mode position offset
      let rx = cell.x;
      let ry = cell.y;

      if (mode === 'waves') {
        rx += Math.sin(cell.y * 0.3 + time * 2) * (fft.bass || 0) * 3;
      } else if (mode === 'tunnel') {
        const dx = cell.x - cols / 2;
        const dy = cell.y - rows / 2;
        const dist = Math.hypot(dx, dy) + 0.1;
        const ang = Math.atan2(dy, dx);
        const push = (fft.energy || 0) * 2 / dist * 5;
        rx += Math.cos(ang) * push;
        ry += Math.sin(ang) * push;
      } else if (mode === 'shatter') {
        if ((fft.energy || 0) > 0.55) {
          rx += (Math.random() - 0.5) * (fft.energy || 0) * 5;
          ry += (Math.random() - 0.5) * (fft.energy || 0) * 5;
        }
      }

      // Wrap
      rx = ((rx % cols) + cols) % cols;
      ry = ((ry % rows) + rows) % rows;

      // Activation — density + per-cell noise + band-speed modulation
      const noise = Math.sin(cell.phase + time * (layer.speed || 1) + rx * 0.1);
      const active = noise < (density * 2 - 1);
      if (!active) continue;

      const ch = this._glyphFor(cell, layer);
      const color = this._colorFor(cell, fft.energy || 0);

      // Opacity: base shimmer + mode accent
      let alpha = 0.45 + 0.55 * Math.sin(cell.phase + time * 3);
      if (mode === 'pulse') {
        alpha *= 0.25 + 0.75 * (fft.bass || 0);
      }
      if (mode === 'drift') {
        alpha *= 0.8 + 0.2 * (fft.mid || 0);
      }

      const px = rx * cs + cs / 2;
      const py = ry * cs + cs / 2;
      ctx.globalAlpha = Math.max(0.08, Math.min(1, alpha));
      ctx.fillStyle = color;
      ctx.fillText(ch, px, py + 1);
    }
    ctx.globalAlpha = 1;
  }

  animate() {
    const now = performance.now();
    const dt = (now - (this._last || now)) / 1000;
    this._last = now;
    this.update(dt);
    this.draw();
    this._raf = requestAnimationFrame(() => this.animate());
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}

// Presets map to old singer personality names for easy room migration.
Atmosphere.presets = {
  hyperpop: {
    glyphSet: ['·','∙','•','▪','▫','░','▒','▓','█','◆','◇','○'],
    palette: { bg:'#050010', fg0:'#33ccff', fg1:'#ff3366', fg2:'#f0e6ff', fg3:'#7a33ff' },
    densityCurve: e => 0.25 + e * 0.75,
    flowMode: 'drift',
    gridCols: 48,
    gridRows: 48,
    bandLayers: {
      bass:   { offset: 0, speed: 1.0 },
      mid:    { offset: 4, speed: 0.7 },
      treble: { offset: 8, speed: 0.4 }
    }
  },
  melt: {
    glyphSet: ['~','*','·','∙','•','◦','◯','◉','▫','▪','◈','◇'],
    palette: { bg:'#1a0510', fg0:'#ff66aa', fg1:'#ff0066', fg2:'#ffccdd', fg3:'#cc0066' },
    densityCurve: e => 0.2 + e * 0.8,
    flowMode: 'drift',
    gridCols: 48,
    gridRows: 48,
    bandLayers: {
      bass:   { offset: 0, speed: 0.8 },
      mid:    { offset: 3, speed: 0.5 },
      treble: { offset: 6, speed: 0.3 }
    }
  },
  acid: {
    glyphSet: ['▓','▒','░','╱','╲','╳','┼','│','─','·','◢','◣','◤','◥'],
    palette: { bg:'#0a1a0a', fg0:'#33ff99', fg1:'#99ff33', fg2:'#ccff66', fg3:'#00ff66' },
    densityCurve: e => 0.3 + e * 0.6,
    flowMode: 'shatter',
    gridCols: 48,
    gridRows: 48,
    bandLayers: {
      bass:   { offset: 0, speed: 1.2 },
      mid:    { offset: 4, speed: 0.8 },
      treble: { offset: 8, speed: 0.5 }
    }
  },
  desert: {
    glyphSet: ['·','∙','•','░','▒','▓','█','▪','▫','◦','◆','◇'],
    palette: { bg:'#1a1205', fg0:'#ffaa33', fg1:'#ffcc66', fg2:'#ffeeaa', fg3:'#cc7722' },
    densityCurve: e => 0.15 + e * 0.65,
    flowMode: 'waves',
    gridCols: 48,
    gridRows: 48,
    bandLayers: {
      bass:   { offset: 0, speed: 0.6 },
      mid:    { offset: 3, speed: 0.4 },
      treble: { offset: 6, speed: 0.25 }
    }
  },
  vapor: {
    glyphSet: ['·','∙','•','░','▒','▓','█','◢','◣','◤','◥','▪','▫','◈'],
    palette: { bg:'#0a0a1a', fg0:'#9966ff', fg1:'#66ccff', fg2:'#ff66ff', fg3:'#cc99ff' },
    densityCurve: e => 0.2 + e * 0.7,
    flowMode: 'tunnel',
    gridCols: 48,
    gridRows: 48,
    bandLayers: {
      bass:   { offset: 0, speed: 0.9 },
      mid:    { offset: 4, speed: 0.6 },
      treble: { offset: 8, speed: 0.35 }
    }
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = Atmosphere;
