/* /api/analyze — multipart audio + browser metrics → Gemini multimodal critique. */

const fs = require("fs");
const formidable = require("formidable").default || require("formidable");
const { callGeminiAudio, humanize } = require("../lib/gemini");
const { deriveMetrics, buildInfographic } = require("../lib/svg");
const { runEbur128 } = require("../lib/ffmpeg");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(200).json({ ok: false, error: "GEMINI_API_KEY not set" });
  }

  let fields, files;
  try {
    ({ fields, files } = await parseMultipart(req));
  } catch (err) {
    return res.status(400).json({ ok: false, error: `multipart parse: ${err.message}` });
  }

  const file = pickFile(files);
  if (!file) return res.status(400).json({ ok: false, error: "no audio file in request" });

  const filename = file.originalFilename || "track";
  const rawMime = file.mimetype;
  const mimeType = (!rawMime || rawMime === "application/octet-stream") ? mimeFromName(filename) : rawMime;
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > 18) {
    fs.promises.unlink(file.filepath).catch(() => {});
    return res.status(200).json({ ok: false, error: `file too large (${sizeMB.toFixed(1)}MB); inline limit ~18MB` });
  }

  let metricsObj = null;
  const metricsField = pickField(fields, "metrics");
  if (metricsField) {
    try { metricsObj = JSON.parse(metricsField); } catch { /* ignore bad json */ }
  }

  // Server-side ffmpeg ebur128 — ground truth loudness/peak/LRA.
  let serverMetrics = null;
  try {
    serverMetrics = await runEbur128(file.filepath);
  } catch (err) {
    console.warn("ebur128 failed, continuing with browser metrics only:", err.message);
  }

  const promptLines = [
    "You are Hermes Producer — a cute anime-idol mixing engineer who's absolutely lethal at mastering. Voice: sweet, warm, playful, slightly bubbly. Use natural soft phrases ('okay so', 'cutie', 'bestie', 'lowkey'). Use *italic emphasis* and ♡/~ very sparingly — at most once per paragraph. Don't sound saccharine.",
    "",
    "RULES:",
    "- Pick only the TOP 2-3 things to focus on. Don't dump every observation. The user will ask follow-ups for the rest.",
    "- One quick win for what's already working, then 2-3 specific fixes that would have the biggest impact.",
    "- Reference exact metric numbers and frequency ranges in Hz where it makes the advice concrete.",
    "- 2-3 short paragraphs total. No bullet lists. No 'in conclusion' wrap-ups.",
    "- End with one short inviting question (e.g. 'wanna dig into the low end?' or 'should I break down the vocal?'). One question, not a list.",
  ];
  if (serverMetrics) {
    promptLines.push("", "GROUND-TRUTH MEASUREMENTS (ffmpeg ebur128, K-weighted, exact — prefer these over any approximations):");
    if (serverMetrics.integratedLufs != null) promptLines.push(`- Integrated loudness: ${serverMetrics.integratedLufs} LUFS`);
    if (serverMetrics.truePeakDbfs != null) promptLines.push(`- True peak: ${serverMetrics.truePeakDbfs} dBFS`);
    if (serverMetrics.loudnessRange != null) promptLines.push(`- Loudness range (LRA): ${serverMetrics.loudnessRange} LU`);
    if (serverMetrics.lraLow != null) promptLines.push(`- LRA low: ${serverMetrics.lraLow} LUFS`);
    if (serverMetrics.lraHigh != null) promptLines.push(`- LRA high: ${serverMetrics.lraHigh} LUFS`);
    if (serverMetrics.durationSec != null) promptLines.push(`- Duration: ${serverMetrics.durationSec}s`);
  }
  if (metricsObj) {
    promptLines.push("", "Supplementary browser-side measurements (FFT-derived, approximate but useful for what ffmpeg doesn't give us — BPM, spectral shape, stereo, vocal/sibilance bands):");
    const skipKeys = new Set(["filename", "sampleRate", "channels", "lufs", "peakDbfs", "durationSec"]);
    for (const [k, v] of Object.entries(metricsObj)) {
      if (v == null || skipKeys.has(k)) continue;
      promptLines.push(`- ${k}: ${v}`);
    }
  }

  try {
    const audioBuffer = await fs.promises.readFile(file.filepath);
    const { text: raw, modelUsed } = await callGeminiAudio(promptLines.join("\n"), audioBuffer, mimeType);
    const critique = humanize(raw) || "(Hermes Producer fell silent.)";

    const contextString = buildContextString(filename, metricsObj, serverMetrics);
    const infographic = buildInfographic(deriveMetrics(contextString));

    res.status(200).json({
      ok: true,
      modelUsed,
      metrics: metricsObj || null,
      serverMetrics,
      contextString,
      critique,
      reply: critique,
      text: critique,
      infographic,
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  } finally {
    fs.promises.unlink(file.filepath).catch(() => {});
  }
};

module.exports.config = { api: { bodyParser: false } };

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 25 * 1024 * 1024, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function pickFile(files) {
  if (!files) return null;
  const v = files.audio || files.file || Object.values(files)[0];
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

function pickField(fields, name) {
  const v = fields?.[name];
  if (v == null) return null;
  return Array.isArray(v) ? v[0] : v;
}

function mimeFromName(name) {
  const ext = (name || "").toLowerCase().split(".").pop();
  return {
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac",
    m4a: "audio/aac", aac: "audio/aac", ogg: "audio/ogg",
    oga: "audio/ogg", opus: "audio/ogg", aiff: "audio/aiff", aif: "audio/aiff",
  }[ext] || "audio/mpeg";
}

function buildContextString(filename, m, srv) {
  const parts = [`File: ${filename}`];
  if (srv?.durationSec != null) parts.push(`Duration: ${srv.durationSec}s`);
  else if (m?.durationSec != null) parts.push(`Duration: ${m.durationSec}s`);
  if (m?.bpm != null) parts.push(`BPM: ${m.bpm}`);
  // Prefer ffmpeg ground-truth where available.
  if (srv?.integratedLufs != null) parts.push(`LUFS: ${srv.integratedLufs} (ebur128)`);
  else if (m?.lufs != null) parts.push(`LUFS: ${m.lufs}`);
  if (srv?.truePeakDbfs != null) parts.push(`TruePeak: ${srv.truePeakDbfs}dBFS`);
  else if (m?.peakDbfs != null) parts.push(`Peak: ${m.peakDbfs}dBFS`);
  if (srv?.loudnessRange != null) parts.push(`LRA: ${srv.loudnessRange}LU (ebur128)`);
  else if (m?.lraDb != null) parts.push(`LRA: ${m.lraDb}LU`);
  if (m?.crestDb != null) parts.push(`Crest: ${m.crestDb}dB`);
  if (m?.spectralCentroidHz != null) parts.push(`SpectralCentroid: ${m.spectralCentroidHz}Hz`);
  if (m?.spectralRolloffHz != null) parts.push(`Rolloff85: ${m.spectralRolloffHz}Hz`);
  if (m?.spectralFlatness != null) parts.push(`Flatness: ${m.spectralFlatness}`);
  if (m?.transientDensity != null) parts.push(`Transients: ${m.transientDensity}/s`);
  if (m?.stereoWidth != null) parts.push(`StereoWidth: ${m.stereoWidth}`);
  if (m?.bassMonoCompat != null) parts.push(`BassMonoCompat: ${m.bassMonoCompat}`);
  if (m?.vocalBandRatio != null) parts.push(`VocalBand: ${m.vocalBandRatio}`);
  if (m?.sibilanceRatio != null) parts.push(`Sibilance: ${m.sibilanceRatio}`);
  if (m?.subRatio != null) {
    parts.push(`6band Sub/Low/LowMid/Mid/HighMid/Air: ${m.subRatio}/${m.lowRatio6}/${m.lowMidRatio}/${m.midRatio6}/${m.highMidRatio}/${m.airRatio}`);
  } else if (m?.lowRatio != null && m?.midRatio != null && m?.highRatio != null) {
    parts.push(`Tonal Low/Mid/High: ${m.lowRatio}/${m.midRatio}/${m.highRatio}`);
  }
  return parts.join(", ");
}
