#!/usr/bin/env node
/* record_demo.mjs - Headless screen recorder for Nori EQ demo timeline.
 *
 * Pipeline:
 *   1. Static HTTP server on :4747 serving /home/itachi/hackathon
 *   2. Headless Chromium via Puppeteer at 1920x1080
 *   3. Suppress intro modal, ensure _nousSound is playing
 *   4. window.runDemoTimeline() to drive UI automation in sync with audio
 *   5. CDP Page.startScreencast pipes JPEG frames to ffmpeg into MP4
 *   6. Trim final MP4 to exactly meta.totalSec seconds (default 150)
 *
 * Output: /home/itachi/hackathon/remotion/public/screen-capture.mp4
 *
 * Usage:  npm run record:screen
 */

import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import puppeteer from 'puppeteer';
import handler from 'serve-handler';

// -------------------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 4747;
const URL  = `http://localhost:${PORT}/`;
const TIMELINE_JSON = path.join(PROJECT_ROOT, 'demo', 'timeline.json');

const OUT_DIR    = path.join(PROJECT_ROOT, 'remotion', 'public');
const OUT_FINAL  = path.join(OUT_DIR, 'screen-capture.mp4');
const OUT_TMP    = path.join(OUT_DIR, 'screen-capture.mp4.tmp');

const VIDEO_W   = 1920;
const VIDEO_H   = 1080;
const VIDEO_FPS = 30;

// Pull totalSec from timeline.json so trim length tracks the source of truth.
let TOTAL_SEC = 150;
try {
  const meta = JSON.parse(readFileSync(TIMELINE_JSON, 'utf8'));
  if (meta && meta.meta && typeof meta.meta.totalSec === 'number') {
    TOTAL_SEC = meta.meta.totalSec;
  }
} catch (e) {
  console.warn(`[record] could not read ${TIMELINE_JSON}: ${e.message}; defaulting to 150s`);
}
const BUFFER_SEC = 2;
const RECORD_SEC = TOTAL_SEC + BUFFER_SEC;

// -------------------------------------------------------------------------
// PRECHECKS
// -------------------------------------------------------------------------
function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

const FFMPEG = which('ffmpeg');
if (!FFMPEG) {
  console.error('[record] ERROR: ffmpeg not found on PATH. Install with: sudo apt install ffmpeg');
  process.exit(1);
}
console.log(`[record] ffmpeg: ${FFMPEG}`);

if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

// -------------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------------
let server, browser, ffmpegProc;

async function main() {
  // ---- 1. STATIC SERVER ------------------------------------------------
  server = http.createServer((req, res) =>
    handler(req, res, { public: PROJECT_ROOT })
  );
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(PORT, '127.0.0.1', () => res());
  });
  console.log(`[record] Server up on ${URL}`);

  // ---- 2. BROWSER ------------------------------------------------------
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
      '--use-fake-ui-for-media-stream',
      '--disable-dev-shm-usage',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    defaultViewport: { width: VIDEO_W, height: VIDEO_H, deviceScaleFactor: 1 },
  });
  console.log('[record] Browser launched');

  const page = await browser.newPage();
  await page.setViewport({ width: VIDEO_W, height: VIDEO_H, deviceScaleFactor: 1 });

  // Surface in-page console output to our log.
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[page:${type}]`, msg.text());
    } else if (process.env.RECORD_VERBOSE === '1') {
      console.log(`[page:${type}]`, msg.text());
    }
  });
  page.on('pageerror', (err) => console.log('[page:pageerror]', err.message));

  // Suppress intro modal BEFORE first navigation so the page boot reads it.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('nori_eq_intro_seen_v2', '1'); } catch (_) {}
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('[record] Page loaded');

  // Synthetic body click to satisfy any once-listener gesture gates.
  await page.evaluate(() => {
    try {
      document.body.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window,
      }));
    } catch (_) {}
  });

  // ---- 3. WAIT FOR _nousSound TO START ---------------------------------
  const audioOk = await page.waitForFunction(() => {
    const s = window._nousSound;
    if (!s) return false;
    try {
      return typeof s.isPlaying === 'function' ? !!s.isPlaying() : false;
    } catch (_) { return false; }
  }, { polling: 100, timeout: 10000 }).then(() => true).catch(() => false);

  if (!audioOk) {
    console.warn('[record] _nousSound not playing within 10s - proceeding anyway');
  } else {
    console.log('[record] Audio started');
  }

  // ---- 4. START CDP SCREENCAST + ffmpeg PIPE ---------------------------
  const client = await page.target().createCDPSession();

  ffmpegProc = spawn(FFMPEG, [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(VIDEO_FPS),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '23',
    '-movflags', '+faststart',
    '-s', `${VIDEO_W}x${VIDEO_H}`,
    '-f', 'mp4',
    OUT_TMP,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  let ffmpegExited = false;
  let ffmpegExitCode = null;
  ffmpegProc.on('exit', (code) => {
    ffmpegExited = true;
    ffmpegExitCode = code;
    console.log(`[record] ffmpeg exited code=${code}`);
  });
  ffmpegProc.stdin.on('error', (e) => {
    if (e.code !== 'EPIPE') console.warn('[record] ffmpeg stdin error:', e.message);
  });

  let frameCount = 0;
  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    frameCount++;
    try {
      const buf = Buffer.from(data, 'base64');
      if (!ffmpegExited && ffmpegProc.stdin.writable) {
        ffmpegProc.stdin.write(buf);
      }
    } catch (_) { /* swallow */ }
    try {
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch (_) { /* may fail at teardown */ }
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    everyNthFrame: 1,
    maxWidth: VIDEO_W,
    maxHeight: VIDEO_H,
  });

  // ---- 5. KICK OFF THE TIMELINE ----------------------------------------
  await page.evaluate(() => {
    if (typeof window.runDemoTimeline === 'function') {
      window.runDemoTimeline({ autoStart: true, autoPlay: true });
    } else {
      console.warn('[record] runDemoTimeline not defined');
    }
  });
  console.log('[record] Timeline started');
  console.log(`[record] Recording ${RECORD_SEC} seconds (timeline ${TOTAL_SEC}s + ${BUFFER_SEC}s buffer)`);

  // ---- 6. WAIT FOR DURATION --------------------------------------------
  const start = Date.now();
  const deadline = start + RECORD_SEC * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed % 10 === 0) {
      console.log(`[record] t=${elapsed}s frames=${frameCount}`);
    }
  }
  console.log(`[record] Recording done - ${frameCount} frames captured`);

  // ---- 7. STOP SCREENCAST + CLOSE ffmpeg STDIN -------------------------
  try { await client.send('Page.stopScreencast'); } catch (_) {}
  try { ffmpegProc.stdin.end(); } catch (_) {}

  // Wait for ffmpeg to flush.
  if (!ffmpegExited) {
    await new Promise((res) => ffmpegProc.once('exit', () => res()));
  }
  if (ffmpegExitCode !== 0 && ffmpegExitCode !== null) {
    throw new Error(`ffmpeg encode failed with code ${ffmpegExitCode}`);
  }
  console.log(`[record] Encoded to ${OUT_TMP}`);

  // ---- 8. TRIM TO EXACT TOTAL_SEC --------------------------------------
  const trim = spawnSync(FFMPEG, [
    '-y',
    '-i', OUT_TMP,
    '-t', String(TOTAL_SEC),
    '-c', 'copy',
    OUT_FINAL,
  ], { stdio: 'inherit' });
  if (trim.status !== 0) {
    throw new Error(`ffmpeg trim failed with code ${trim.status}`);
  }
  console.log(`[record] Trimmed final video to ${TOTAL_SEC}s at ${OUT_FINAL}`);

  // Clean tmp.
  try { unlinkSync(OUT_TMP); } catch (_) {}
}

// -------------------------------------------------------------------------
// ENTRY + CLEANUP
// -------------------------------------------------------------------------
let exitCode = 0;
try {
  await main();
} catch (e) {
  exitCode = 1;
  console.error('[record] FATAL:', e && (e.stack || e.message || e));
} finally {
  try { if (browser) await browser.close(); } catch (_) {}
  try { if (server) server.close(); } catch (_) {}
  try { if (ffmpegProc && !ffmpegProc.killed) ffmpegProc.kill('SIGKILL'); } catch (_) {}
  process.exit(exitCode);
}
