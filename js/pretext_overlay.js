/* pretext_overlay.js — kinetic type overlay using @chenglou/pretext */
const layer = document.getElementById('pretextLayer');
const togPretext = document.getElementById('togPretext');
let pretextOn = true; // DEFAULT ON

const WORDS = ['ENERGY','DROP','BASS','NEON','FEEL IT','ALIVE','PEAK','ENCORE','GLITCH','HERMES'];
const FONT = "900 70px 'Impact', 'Arial Black', sans-serif";
const FALLBACK_FONT = "900 120px 'JetBrains Mono', monospace";
const DURATION = 1500; // ms total per word
const PEAK_THRESH_VOL = 0.78;
const PEAK_THRESH_LOW = 0.72;
const COOLDOWN = 1200;

// Create inner canvas
const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.top = '0';
canvas.style.left = '0';
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.pointerEvents = 'none';
layer.appendChild(canvas);
const ctx = canvas.getContext('2d');

let pretextReady = false;
let prepareWithSegments, layoutWithLines;

async function initPretext() {
  try {
    const mod = await import('https://esm.sh/@chenglou/pretext@0.0.6');
    prepareWithSegments = mod.prepareWithSegments;
    layoutWithLines = mod.layoutWithLines;
    pretextReady = true;
  } catch (e) {
    console.warn('pretext esm.sh failed, fallback mode:', e);
    pretextReady = false;
  }
}
initPretext();

let lastWordIdx = -1;
let lastPeakTime = 0;
let anim = null; // { word, graphemes, startTime, isFallback }

function resize() {
  const wrap = document.getElementById('stageWrap');
  if (!wrap) return;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
window.addEventListener('resize', resize);
resize();

function getAudioLevelObj() {
  let level = 0;
  if (typeof getAudioLevel === 'function') level = getAudioLevel();
  if (typeof level === 'object' && level !== null) return level;
  return { vol: level, low: Math.min(1.0, level * 1.4), mid: level, high: Math.max(0, level - 0.3) * 1.4 };
}

function pickWord() {
  let idx;
  do { idx = Math.floor(Math.random() * WORDS.length); } while (idx === lastWordIdx && WORDS.length > 1);
  lastWordIdx = idx;
  return WORDS[idx];
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeInCubic(t) { return t * t * t; }

function spawnFallback(word) {
  ctx.font = FALLBACK_FONT;
  const m = ctx.measureText(word);
  const targetX = (canvas.width - m.width) / 2;
  const targetY = canvas.height / 2;
  anim = {
    word,
    isFallback: true,
    startTime: performance.now(),
    targetX,
    targetY,
    width: m.width,
  };
}

function spawnPretext(word) {
  const prepared = prepareWithSegments(word, FONT);
  const { lines } = layoutWithLines(prepared, canvas.width, 90);
  const line = lines && lines[0] ? lines[0] : { text: word };
  const text = line.text;

  // Measure per-grapheme positions
  ctx.font = FONT;
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = [];
  let totalW = 0;
  for (const { segment } of seg.segment(text)) {
    const w = ctx.measureText(segment).width;
    graphemes.push({ ch: segment, w });
    totalW += w;
  }

  const startX = (canvas.width - totalW) / 2;
  const targetY = canvas.height / 2 + 20;

  let xAcc = 0;
  for (const g of graphemes) {
    g.targetX = startX + xAcc;
    g.targetY = targetY;
    xAcc += g.w;
    // Scatter starts
    g.startX = canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.9;
    g.startY = canvas.height / 2 + (Math.random() - 0.5) * canvas.height * 0.6;
    g.startScale = 3.0 + Math.random() * 2.0;
    g.startRot = (Math.random() - 0.5) * Math.PI * 3;
    // Exit velocities
    const angle = Math.random() * Math.PI * 2;
    const speed = 200 + Math.random() * 300;
    g.exitVx = Math.cos(angle) * speed;
    g.exitVy = Math.sin(angle) * speed;
  }

  anim = { word, isFallback: false, startTime: performance.now(), graphemes };
}

function drawPretext(now) {
  if (!pretextOn || !anim) return;
  const elapsed = now - anim.startTime;
  if (elapsed > DURATION) { anim = null; return; }
  const t = elapsed / DURATION;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (anim.isFallback) {
    // Fallback: single giant gold text, scale-in then fade
    let scale, alpha;
    if (t < 0.35) {
      const p = t / 0.35;
      scale = easeOutBack(p);
      alpha = 1;
    } else if (t < 0.75) {
      scale = 1;
      alpha = 1;
    } else {
      const p = (t - 0.75) / 0.25;
      scale = 1 + p * 0.3;
      alpha = 1 - p;
    }
    const cx = anim.targetX + anim.width / 2;
    const cy = anim.targetY;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.font = FALLBACK_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,220,0,0.9)';
    ctx.fillText(anim.word, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
    return;
  }

  // Pretext path: per-grapheme tumbling animation
  ctx.font = FONT;
  ctx.textBaseline = 'middle';

  let phase, p;
  if (t < 0.35) {
    phase = 'in';
    p = t / 0.35;
  } else if (t < 0.80) {
    phase = 'hold';
    p = (t - 0.35) / 0.45;
  } else {
    phase = 'out';
    p = (t - 0.80) / 0.20;
  }

  for (const g of anim.graphemes) {
    let x, y, scale, rot, alpha;

    if (phase === 'in') {
      const ep = easeOutCubic(p);
      const sp = easeOutBack(p);
      x = g.startX + (g.targetX - g.startX) * ep;
      y = g.startY + (g.targetY - g.startY) * ep;
      scale = g.startScale - (g.startScale - 1.0) * sp;
      rot = g.startRot * (1.0 - sp);
      alpha = sp;
    } else if (phase === 'hold') {
      const breathe = 1.0 + Math.sin(p * Math.PI * 2 + g.targetX * 0.01) * 0.06;
      x = g.targetX;
      y = g.targetY + Math.sin(p * Math.PI * 3 + g.targetX * 0.02) * 6;
      scale = breathe;
      rot = 0;
      alpha = 1;
    } else {
      const ep = easeInCubic(p);
      x = g.targetX + g.exitVx * ep * 0.003;
      y = g.targetY + g.exitVy * ep * 0.003;
      scale = 1.0 + ep * 1.5;
      rot = g.startRot * ep * 0.5;
      alpha = 1.0 - ep;
    }

    const cx = x + g.w / 2;
    const cy = y;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    // Chromatic aberration: red and blue offsets
    ctx.save();
    ctx.translate(cx - 2.5, cy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255,40,60,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(cx + 2.5, cy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(40,170,255,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'center';
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();

    ctx.restore();
  }
}

function tick(now) {
  // Audio peak detection
  const audio = getAudioLevelObj();
  const isPeak = audio.vol > PEAK_THRESH_VOL || audio.low > PEAK_THRESH_LOW;
  if (isPeak && now - lastPeakTime > COOLDOWN) {
    lastPeakTime = now;
    const word = pickWord();
    if (pretextReady) {
      try { spawnPretext(word); } catch (e) { spawnFallback(word); }
    } else {
      spawnFallback(word);
    }
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPretext(now);
  requestAnimationFrame(tick);
}

// Toggle
togPretext.addEventListener('click', () => {
  pretextOn = !pretextOn;
  togPretext.classList.toggle('on', pretextOn);
  togPretext.textContent = pretextOn ? 'Type: ON' : 'Type: OFF';
  layer.style.opacity = pretextOn ? '0.85' : '0';
});

// Default ON
layer.style.opacity = '0.85';
requestAnimationFrame(tick);
