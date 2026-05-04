let mic, fft, waveform, peakDetect, audioLevel = 0;
let stars = [];
let embers = [];
let particles = [];
let glowsticks = [];
let crowd = [];
let img, crowdImg;
let spriteSheet, currentFrame = 0, frameAnim = 'idle', animTimer = 0;
let lasers = [];
let haze = [];
let pyroBursts = [];
let phoneLights = [];
let kaleidoscope;
let shake = 0;
let lastPeakFrame = -1;
let backdrops = [];
let currentBd = 0, nextBd = 1, bdFade = 0;
let backdropOn = true;
let spritePreprocessed = false;

function preload() {
  img = loadImage('anime_singer.png');
  crowdImg = loadImage('crowd.png');
  spriteSheet = loadImage('sprite_sheet_32.png');
  // Keep only 1, 2, 4 — others were dropped per user
  for (const i of [1, 2, 4]) {
    backdrops.push(loadImage(`backdrops/backdrop_0${i}.png`));
  }
}

function setup() {
  const wrap = document.getElementById('stageWrap');
  const c = createCanvas(wrap.clientWidth, wrap.clientHeight);
  c.parent('stageWrap');
  fft = new p5.FFT(0.8, 64);
  waveform = new p5.FFT(0.5, 1024);
  peakDetect = new p5.PeakDetect(20, 20000, 0.35, 20);
  for (let i = 0; i < 80; i++) stars.push({x: random(width), y: random(height), s: random(1, 3), f: random(0.01, 0.05), o: random(150, 255)});
  for (let i = 0; i < 30; i++) embers.push({x: random(width), y: random(height, height + 200), sx: random(-0.5, 0.5), sy: random(-1, -3), rot: random(TWO_PI), type: random() > 0.5 ? 'tri' : 'hex', size: random(3, 8)});
  for (let i = 0; i < 40; i++) glowsticks.push({x: random(width * 0.2, width * 0.8), y: random(height * 0.75, height), vx: random(-1, 1), vy: random(-2, -5), color: random() > 0.5 ? 'magenta' : 'cyan', size: random(4, 8)});
  for (let i = 0; i < 50; i++) crowd.push({x: random(width), y: random(height * 0.85, height), size: random(10, 20), color: color(random(50, 150), random(0, 50), random(50, 150))});
  for (let i = 0; i < 15; i++) {
    let side = floor(random(4));
    let ox, oy;
    if (side === 0) { ox = random(width); oy = 0; }
    else if (side === 1) { ox = width; oy = random(height); }
    else if (side === 2) { ox = random(width); oy = height; }
    else { ox = 0; oy = random(height); }
    lasers.push({ox, oy, i});
  }
  for (let i = 0; i < 200; i++) haze.push({x: random(width), y: random(height), s: random(1, 3), drift: random(0.1, 0.4)});
  for (let i = 0; i < 80; i++) phoneLights.push({x: random(width), y: random(height * 0.82, height), w: random(2, 3), h: random(3, 5), phase: random(TWO_PI)});
  kaleidoscope = createGraphics(512, 256);
  preprocessSprite();
  // Bake ASCII into stage compositor via screen blend + high opacity
  const _ac = document.getElementById('asciiCanvas');
  if (_ac) {
    _ac.style.mixBlendMode = 'screen';
    _ac.style.opacity = '0.55';
  }
  connectAudio();
  const tb = document.getElementById('togBackdrop');
  if (tb) tb.addEventListener('click', () => {
    backdropOn = !backdropOn;
    tb.classList.toggle('on', backdropOn);
    tb.textContent = backdropOn ? 'Backdrop: ON' : 'Backdrop: OFF';
  });
}

function windowResized() {
  const wrap = document.getElementById('stageWrap');
  resizeCanvas(wrap.clientWidth, wrap.clientHeight);
  stars = [];
  for (let i = 0; i < 80; i++) stars.push({x: random(width), y: random(height), s: random(1, 3), f: random(0.01, 0.05), o: random(150, 255)});
}

function getAudioLevel() {
  let level = 0;
  if (mic) {
    level = mic.getLevel();
    fft.analyze();
    waveform.analyze();
    peakDetect.update(fft);
  }
  return level;
}

function connectAudio() {
  mic = new p5.AudioIn();
  mic.start();
  fft.setInput(mic);
  waveform.setInput(mic);
}

function hslToRgb(h, s, l) {
  h = (h % 360) / 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    let hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    let p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [round(r * 255), round(g * 255), round(b * 255)];
}

function drawSky() {
  let ctx = drawingContext;
  let grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#2a0036');
  grad.addColorStop(1, '#0d0015');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  noStroke();
  for (let s of stars) {
    fill(255, 200, 255, s.o + sin(frameCount * s.f) * 50);
    ellipse(s.x, s.y, s.s, s.s);
  }
}

function updateKaleidoscope(midEnergy) {
  if (!kaleidoscope) return;
  const speedMul = window._vfxAnimSpeedMul || 1;
  kaleidoscope.push();
  kaleidoscope.background(0, 60);
  kaleidoscope.translate(kaleidoscope.width / 2, kaleidoscope.height / 2);
  for (let seg = 0; seg < 6; seg++) {
    kaleidoscope.push();
    kaleidoscope.rotate(seg * TWO_PI / 6 + frameCount * (window._vfxKaleidoSpeed != null ? window._vfxKaleidoSpeed : (window._kaleidoSpeed || 0.015)) * speedMul);
    for (let r = 30; r < 170; r += 25) {
      let hueShift = (frameCount * 1.5 + r * 1.2 + midEnergy * 200) % 360;
      let rgb = hslToRgb(hueShift, 0.85, 0.5 + midEnergy * 0.35);
      kaleidoscope.fill(rgb[0], rgb[1], rgb[2], 200);
      kaleidoscope.noStroke();
      if (seg % 2 === 0) {
        kaleidoscope.triangle(r, -r * 0.35, r + 22, r * 0.25, r - 10, r * 0.5);
      } else {
        kaleidoscope.beginShape();
        for (let a = 0; a < TWO_PI; a += TWO_PI / 6) {
          kaleidoscope.vertex(cos(a) * r * 0.35 + r, sin(a) * r * 0.35);
        }
        kaleidoscope.endShape(CLOSE);
      }
    }
    kaleidoscope.pop();
  }
  kaleidoscope.pop();
}

function drawJumbotron() {
  let w = width * 0.8;
  let h = height * 0.4;
  let x = width * 0.1;
  let y = height * 0.1;
  noStroke();
  fill(5, 0, 10);
  rect(x, y, w, h);

  if (kaleidoscope) {
    image(kaleidoscope, x, y, w, h);
  }

  // Fruity EQ 2 style display: FFT spectrum filled chart + EQ response curve + 3 nodes
  let spec = (typeof fft !== 'undefined' && fft && fft.analyze) ? fft.analyze() : [];
  let sr = (typeof sampleRate === 'function') ? sampleRate() : 44100;
  let nyquist = sr / 2;
  let fMin = 20;
  let fMax = nyquist;
  let logMin = Math.log(fMin);
  let logMax = Math.log(fMax);
  // Filled-area FFT spectrum with vertical gradient
  let segs = 64;
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.moveTo(x, y + h);
  for (let i = 0; i <= segs; i++) {
    let frac = i / segs;
    let f = Math.exp(logMin + (logMax - logMin) * frac);
    let bin = spec.length ? Math.min(spec.length - 1, Math.floor(f / nyquist * spec.length)) : 0;
    let mag = spec.length ? spec[bin] / 255 : 0;
    let sx = x + frac * w;
    let sy = y + h - mag * h;
    drawingContext.lineTo(sx, sy);
  }
  drawingContext.lineTo(x + w, y + h);
  drawingContext.closePath();
  let grad = drawingContext.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,51,102,0.4)');
  grad.addColorStop(1, 'rgba(51,204,255,0.4)');
  drawingContext.fillStyle = grad;
  drawingContext.globalAlpha = 0.4;
  drawingContext.fill();
  drawingContext.globalAlpha = 1.0;
  drawingContext.restore();

  // EQ curve removed — audio_reactivity engine drives visuals automatically now.

  noFill();
  stroke('#ff00ff');
  strokeWeight(4);
  rect(x, y, w, h);
  noStroke();
  textAlign(RIGHT, TOP);
  textSize(24);
  fill('#00ffff');
  text("永遠結合", x + w - 20, y + 15);
  textSize(18);
  fill('#ff00ff');
  text("ETERNAL FUSION", x + w - 20, y + 45);
}

function drawTruss(lowEnergy, peakNow) {
  fill(30);
  noStroke();
  rect(0, 0, width, 15);
  let palette = [color('#00ffff'), color('#ff00ff'), color('#ffffff'), color('#0066ff'), color('#ff0066')];
  for (let i = 0; i < 8; i++) {
    let sx = width * (0.1 + i * 0.1);
    let angle = sin(frameCount * 0.02 + i) * 0.4;
    let spread = 40;
    let baseAlpha = 30 + lowEnergy * 40;
    if (peakNow) baseAlpha = min(120, baseAlpha + 50);
    let col = palette[i % palette.length];
    fill(red(col), green(col), blue(col), baseAlpha);
    noStroke();
    beginShape();
    vertex(sx, 15);
    vertex(sx - spread + angle * 100, height * 0.5);
    vertex(sx + spread + angle * 100, height * 0.5);
    vertex(sx, 15);
    endShape(CLOSE);
    drawingContext.shadowColor = col.toString();
    drawingContext.shadowBlur = 30;
    fill(255, 255, 255, 70 + (peakNow ? 50 : 0));
    ellipse(sx, 15, 12, 12);
    drawingContext.shadowBlur = 0;
  }
}

function drawEmbers() {
  noStroke();
  for (let e of embers) {
    e.y += e.sy;
    e.x += e.sx + sin(frameCount * 0.01 + e.y * 0.01) * 0.5;
    e.rot += 0.02;
    if (e.y < -10) {
      e.y = height + random(100);
      e.x = random(width);
    }
    fill(255, 100 + sin(frameCount * 0.05 + e.x) * 50, 0, 150);
    push();
    translate(e.x, e.y);
    rotate(e.rot);
    if (e.type === 'tri') {
      triangle(-e.size/2, e.size/2, e.size/2, e.size/2, 0, -e.size/2);
    } else {
      beginShape();
      for (let a = 0; a < TWO_PI; a += TWO_PI / 6) {
        vertex(cos(a) * e.size, sin(a) * e.size);
      }
      endShape(CLOSE);
    }
    pop();
  }
}

function drawHaze(level) {
  noStroke();
  for (let h of haze) {
    h.y -= h.drift;
    if (h.y < 0) { h.y = height; h.x = random(width); }
    let a = (20 + level * 60) * (h.s / 3);
    fill(255, 255, 255, a);
    ellipse(h.x, h.y, h.s, h.s);
  }
}

function drawLasers(level) {
  let palette = [color('#00ffff'), color('#ff00ff'), color('#ffffff')];
  drawingContext.globalCompositeOperation = 'lighter';
  for (let l of lasers) {
    let sweep = sin(frameCount * 0.02 + l.i * 0.7);
    let tx = width / 2 + sweep * width * 0.35;
    let ty = height * 0.3 + cos(frameCount * 0.025 + l.i * 0.5) * height * 0.2;
    let col = palette[l.i % palette.length];
    let alpha = (60 + level * 40) * (window._vfxLaserMul != null ? window._vfxLaserMul : (window._laserMul || 1));
    strokeWeight(1.5);
    stroke(red(col), green(col), blue(col), alpha);
    line(l.ox, l.oy, tx, ty);
    noStroke();
    fill(red(col), green(col), blue(col), alpha + 40);
    drawingContext.shadowColor = col.toString();
    drawingContext.shadowBlur = 30;
    ellipse(l.ox, l.oy, 6, 6);
    drawingContext.shadowBlur = 0;
  }
  drawingContext.globalCompositeOperation = 'source-over';
}

function spawnPyro() {
  let px = random(width * 0.3, width * 0.7);
  let py = height * 0.85;
  pyroBursts.push({x: px, originY: py, y: py, vy: random(-10, -14), life: 255, state: 'streak', sparks: []});
}

function updateAndDrawPyro() {
  for (let i = pyroBursts.length - 1; i >= 0; i--) {
    let p = pyroBursts[i];
    if (p.state === 'streak') {
      p.y += p.vy;
      p.vy += 0.25;
      p.life -= 3;
      let streakLen = p.originY - p.y;
      let steps = 8;
      noStroke();
      for (let j = 0; j < steps; j++) {
        let sy = p.originY - (streakLen * (j / steps));
        let alpha = map(j, 0, steps, 0, p.life);
        fill(255, 100 + j * 15, 0, alpha);
        ellipse(p.x, sy, 4 - j * 0.3, 4 - j * 0.3);
      }
      if (p.vy >= 0 || p.life < 150) {
        p.state = 'sparks';
        for (let s = 0; s < 14; s++) {
          p.sparks.push({x: p.x, y: p.y, vx: random(-3, 3), vy: random(-5, 0), life: 255});
        }
      }
    } else {
      for (let s = p.sparks.length - 1; s >= 0; s--) {
        let sp = p.sparks[s];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.15;
        sp.life -= 6;
        if (sp.life <= 0) { p.sparks.splice(s, 1); continue; }
        noStroke();
        fill(255, random(80, 180), 0, sp.life);
        ellipse(sp.x, sp.y, 3, 3);
      }
      if (p.sparks.length === 0) pyroBursts.splice(i, 1);
    }
  }
}

function drawSpeakers() {
  let level = getAudioLevel();
  let sw = 56;
  let sh = 110;
  let yBase = height * 0.52;
  for (let side of [0, 1]) {
    let xBase = side === 0 ? 12 : width - sw - 12;
    fill(18);
    noStroke();
    rect(xBase, yBase, sw, sh);
    fill(8);
    rect(xBase + 4, yBase + 36, sw - 8, 3);
    rect(xBase + 4, yBase + 72, sw - 8, 3);
    for (let i = 0; i < 3; i++) {
      let cx = xBase + sw / 2;
      let cy = yBase + 20 + i * 34;
      let active = level > 0.12 + i * 0.1;
      if (active) {
        fill(220, 60, 60);
        drawingContext.shadowColor = '#ff2222';
        drawingContext.shadowBlur = 8;
      } else {
        fill(50, 10, 10);
        drawingContext.shadowBlur = 0;
      }
      rect(cx - 8, cy - 8, 16, 16);
      drawingContext.shadowBlur = 0;
    }
    for (let j = 0; j < 5; j++) {
      let ledX = xBase + 6 + j * 10;
      let ledY = yBase + 6;
      if (level > 0.1 + j * 0.08) {
        fill(0, 255, 120);
        drawingContext.shadowColor = '#00ff78';
        drawingContext.shadowBlur = 4;
      } else {
        fill(20, 40, 20);
        drawingContext.shadowBlur = 0;
      }
      rect(ledX, ledY, 6, 4);
      drawingContext.shadowBlur = 0;
    }
  }
}

function drawBackupBand() {
  let y = height * 0.66;
  for (let side of [-1, 1]) {
    let bx = width / 2 + side * 170;
    fill(8);
    noStroke();
    rect(bx - 10, y - 58, 20, 18);
    rect(bx - 14, y - 38, 28, 44);
    rect(bx - 14, y + 6, 10, 24);
    rect(bx + 4, y + 6, 10, 24);
    stroke(8);
    strokeWeight(4);
    line(bx - 8, y - 28, bx + side * 28, y - 18);
    strokeWeight(2);
    noStroke();
    fill(15);
    rect(bx + side * 24, y - 26, 20, 14);
    fill(25);
    rect(bx + side * 10, y - 24, 18, 4);
  }
  noStroke();
}

function drawCrowdImg() {
  // disabled — was creating a hard horizontal seam at height*0.75
}

function drawCrowd() {
  let level = getAudioLevel();
  for (let c of crowd) {
    let bounce = map(level, 0, 1, 0, 15);
    fill(c.color);
    noStroke();
    ellipse(c.x, c.y - abs(sin(frameCount * 0.1 + c.x) * bounce), c.size, c.size * 0.8);
  }
}

function drawPhoneLights(lowEnergy) {
  noStroke();
  for (let pl of phoneLights) {
    let blink = sin(frameCount * 0.15 + pl.phase) * 0.5 + 0.5;
    let a = (80 + lowEnergy * 175) * blink;
    fill(255, 255, 200, a);
    rect(pl.x, pl.y, pl.w, pl.h);
  }
}

function drawGlowsticks() {
  let level = getAudioLevel();
  for (let g of glowsticks) {
    let targetY = height;
    let beatBounce = 0;
    if (level > 0.15) {
      beatBounce = -random(10, 50) * level;
    }
    g.y += g.vy;
    g.x += g.vx * (window._vfxStageWidth != null ? window._vfxStageWidth : (window._stageWidth || 1));
    if (g.y < height * 0.75) {
      g.y = height;
      g.vy = random(-2, -5);
    }
    if (g.x < 0 || g.x > width) g.vx *= -1;
    let drawY = g.y + beatBounce;
    if (g.color === 'magenta') {
      fill('#ff00ff');
      drawingContext.shadowColor = '#ff00ff';
    } else {
      fill('#00ffff');
      drawingContext.shadowColor = '#00ffff';
    }
    drawingContext.shadowBlur = 8;
    ellipse(g.x, drawY, g.size, g.size);
    drawingContext.shadowBlur = 0;
  }
}

function pickFrame(audioLevel, peak) {
  let target = 'idle';
  let rate = 10;

  if (peak > 0.9) {
    target = 'dramatic';
    rate = 5;
  } else if (peakDetect.isDetected || peak > 0.7) {
    target = 'dance';
    rate = 5;
  } else if (audioLevel > 0.4) {
    target = 'mic';
    rate = 7;
  }

  let priority = { idle: 0, mic: 1, dance: 2, dramatic: 3 };

  if (target !== frameAnim && (animTimer <= 0 || priority[target] > priority[frameAnim])) {
    frameAnim = target;
    animTimer = 30;
    if (frameAnim === 'idle') currentFrame = 0;
    else if (frameAnim === 'mic') currentFrame = 8;
    else if (frameAnim === 'dance') currentFrame = 16;
    else if (frameAnim === 'dramatic') currentFrame = 24;
  }

  if (animTimer > 0) animTimer--;

  if (frameCount % rate === 0) {
    let start = 0, end = 7;
    if (frameAnim === 'mic') { start = 8; end = 15; }
    else if (frameAnim === 'dance') { start = 16; end = 23; }
    else if (frameAnim === 'dramatic') { start = 24; end = 31; }

    currentFrame++;
    if (currentFrame < start || currentFrame > end) {
      currentFrame = start;
    }
  }
}

function preprocessSprite() {
  if (!spriteSheet || spriteSheet.width === 0) {
    setTimeout(preprocessSprite, 200);
    return;
  }
  spriteSheet.loadPixels();
  const px = spriteSheet.pixels;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i+1], b = px[i+2];
    const lum = (r + g + b) / 3;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 230 && sat < 30) {
      px[i+3] = 0;
    } else if (lum > 195 && sat < 40) {
      const t = (lum - 195) / 35;
      px[i+3] = Math.max(0, Math.min(255, Math.round((1 - t) * px[i+3])));
    }
  }
  spriteSheet.updatePixels();
  spritePreprocessed = true;
  console.log('sprite preprocessed');
}

function drawSinger() {
  let level = getAudioLevel();
  let sx = width / 2;
  let sy = height * 0.6;
  if (level > 0.25) {
    drawingContext.shadowColor = '#00ffff';
    drawingContext.shadowBlur = 30 + level * 40;
  } else {
    drawingContext.shadowBlur = 0;
  }

  if (spriteSheet && spritePreprocessed) {
    imageMode(CENTER);
    let row = floor(currentFrame / 8);
    let col = currentFrame % 8;
    let srcX = col * 848;
    let srcY = row * 1264;
    let srcW = 848;
    let srcH = 1264;
    image(spriteSheet, sx, sy, 220, 280, srcX, srcY, srcW, srcH);
  } else if (img) {
    imageMode(CENTER);
    image(img, sx, sy, 200, 240);
  } else {
    fill(255, 220, 220);
    noStroke();
    ellipse(sx, sy - 40, 60, 60);
    fill('#ff0080');
    rect(sx - 30, sy - 10, 60, 90, 10);
    fill('#00ffff');
    triangle(sx, sy - 30, sx - 8, sy + 10, sx + 8, sy + 10);
    fill(0);
    ellipse(sx - 12, sy - 45, 6, 8);
    ellipse(sx + 12, sy - 45, 6, 8);
    fill('#ff0066');
    arc(sx, sy - 35, 15, 10, 0, PI);
  }
  drawingContext.shadowBlur = 0;
}

function drawParticles() {
  let level = getAudioLevel();
  if (level > 0.2 || frameCount % 3 === 0) {
    for (let i = 0; i < 3; i++) {
      particles.push({x: width / 2 + random(-50, 50), y: height * 0.5, vx: random(-2, 2), vy: random(-3, -1), life: 255, color: random(['#ff00ff', '#00ffff', '#ffffff'])});
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 5;
    p.vy += 0.05;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    noStroke();
    fill(red(color(p.color)), green(color(p.color)), blue(color(p.color)), p.life);
    ellipse(p.x, p.y, 6, 6);
  }
}

function draw() {
  const speedMul = window._vfxAnimSpeedMul || 1;
  let level = 0;
  if (mic) {
    level = mic.getLevel();
    fft.analyze();
    waveform.analyze();
    peakDetect.update(fft);
  }
  audioLevel = level;

  // Bridge to atmosphere + lyrics + battle tabs
  let spectrum = fft ? fft.analyze() : [];
  window._lastSpectrum = spectrum.slice();
  if (spectrum.length) {
    const third = Math.floor(spectrum.length / 3);
    let bass = 0, mid = 0, treble = 0, energy = 0;
    for (let i = 0; i < spectrum.length; i++) {
      const v = spectrum[i] / 255;
      energy += v;
      if (i < third) bass += v;
      else if (i < third * 2) mid += v;
      else treble += v;
    }
    window._lastAtmosFFT = {
      bass: bass / third,
      mid: mid / third,
      treble: treble / (spectrum.length - third * 2),
      energy: energy / spectrum.length
    };
    if (window._atmosphere) window._atmosphere.setFFT(window._lastAtmosFFT);
  }
let lowEnergy = 0, midEnergy = 0, highEnergy = 0;
if (spectrum.length) {
let lowEnd = floor(spectrum.length * 0.15);
let midEnd = floor(spectrum.length * 0.6);
for (let i = 0; i < lowEnd; i++) lowEnergy += spectrum[i];
for (let i = lowEnd; i < midEnd; i++) midEnergy += spectrum[i];
for (let i = midEnd; i < spectrum.length; i++) highEnergy += spectrum[i];
lowEnergy = lowEnergy / max(1, lowEnd * 255);
midEnergy = midEnergy / max(1, (midEnd - lowEnd) * 255);
highEnergy = highEnergy / max(1, (spectrum.length - midEnd) * 255);
window._lastSpectrum = spectrum;
window._lastAtmosFFT = {
bass: lowEnergy, mid: midEnergy, treble: highEnergy,
energy: (lowEnergy + midEnergy + highEnergy) / 3
};
}

  let peakNow = peakDetect.isDetected;
  if (peakNow && frameCount !== lastPeakFrame) {
    shake = 2.5 * (window._vfxStrobeBoost || 1);
    spawnPyro();
    lastPeakFrame = frameCount;
  }
  if (shake > 0.1) shake *= 0.78; else shake = 0;

  updateKaleidoscope(midEnergy);

  push();
  if (shake > 0) translate(random(-shake, shake), random(-shake, shake));

  pickFrame(audioLevel, audioLevel);

  drawSky();
  if (backdropOn && backdrops.length >= 2 && backdrops[currentBd] && backdrops[currentBd].width > 0) {
    push();
    // Audio-reactive parallax/zoom driven by track progress (creates "arc")
    const _tp = (window.audioReact && window.audioReact.trackProgress) || 0;
    translate(width / 2, height / 2);
    scale(1 + _tp * 0.20);
    translate(-width / 2, -height / 2);
    translate(sin(_tp * Math.PI * 2) * 30, cos(_tp * Math.PI * 2) * 18);
    // cover-fit: scale so backdrop fills canvas, crop overflow
    const drawCover = (img2, alpha) => {
      const ar = img2.width / img2.height;
      const cAr = width / height;
      let dw, dh, dx, dy;
      if (ar > cAr) { dh = height; dw = height * ar; dx = (width - dw) / 2; dy = 0; }
      else { dw = width; dh = width / ar; dx = 0; dy = (height - dh) / 2; }
      tint(255, alpha);
      image(img2, dx, dy, dw, dh);
    };
    drawCover(backdrops[currentBd], 255 * (1 - bdFade));
    drawCover(backdrops[nextBd], 255 * bdFade);
    pop();
    noTint();
    bdFade += 0.0008;
    if (bdFade >= 1) {
      bdFade = 0;
      currentBd = nextBd;
      nextBd = (nextBd + 1) % backdrops.length;
    }
  }
  drawJumbotron();
  drawLasers(level);
  drawTruss(lowEnergy, peakNow);
  drawEmbers();
  drawHaze(level);
  updateAndDrawPyro();
  // drawSpeakers + drawBackupBand removed — placeholder shapes that hurt the look
  drawCrowdImg();
  drawCrowd();
  drawPhoneLights(lowEnergy);
  drawGlowsticks();
  drawSinger();
  drawParticles();


  // Jumbotron bloom (filter on stage canvas)
  const bloom = window._vfxBloomPx || 0;
  const dc = document.getElementById("defaultCanvas0");
  if (dc) dc.style.filter = bloom > 1 ? `drop-shadow(0 0 ${bloom.toFixed(1)}px #ff00ff)` : "";
  // Stage hue rotation (filter on stageWrap)
  const hue = window._vfxStageHue || 0;
  const sw = document.getElementById("stageWrap");
  if (sw) sw.style.filter = hue > 1 ? `hue-rotate(${hue.toFixed(0)}deg)` : "";

  pop();
}
