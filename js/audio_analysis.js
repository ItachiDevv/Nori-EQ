/* audio_analysis.js — offline audio file analysis (LUFS, spectral centroid, transients, crest) */
window.lastAnalysis = null;

async function analyzeAudioFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const sr = audio.sampleRate;
    const ch0 = audio.getChannelData(0);
    const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : ch0;

    const FRAME = 2048;
    const HOP = 1024;
    const windowFn = hannWindow(FRAME);

    let sumSq = 0, sampleCount = 0, peak = 0;
    let frameLoudness = [];
    let frameCentroid = [];
    let frameEnergy = [];
    let frameRolloff = [];
    let frameFlatness = [];
    // 6-band tonal split + vocal-band + sibilance-band
    let subSum = 0, lowSum = 0, lowMidSum = 0, midSum = 0, highMidSum = 0, airSum = 0;
    let vocalSum = 0, sibilanceSum = 0, magSum = 0;

    const win = new Float32Array(FRAME);
    const re = new Float32Array(FRAME);
    const im = new Float32Array(FRAME);

    for (let off = 0; off + FRAME <= ch0.length; off += HOP) {
      let frameSq = 0;
      for (let i = 0; i < FRAME; i++) {
        const s = (ch0[off + i] + ch1[off + i]) * 0.5;
        win[i] = s * windowFn[i];
        re[i] = win[i];
        im[i] = 0;
        frameSq += s * s;
        sumSq += s * s;
        if (Math.abs(s) > peak) peak = Math.abs(s);
      }
      sampleCount += FRAME;
      const rms = Math.sqrt(frameSq / FRAME);
      const dbfs = rms > 0 ? 20 * Math.log10(rms) : -120;
      frameLoudness.push(dbfs);

      fftRadix2(re, im);
      let centNum = 0, centDen = 0, frameMag = 0;
      let logMagSum = 0, validBins = 0;
      // For per-frame rolloff, store cumulative magnitudes
      const halfN = FRAME / 2;
      const mags = new Float32Array(halfN);
      for (let k = 1; k < halfN; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        mags[k] = mag;
        const freq = (k * sr) / FRAME;
        centNum += freq * mag;
        centDen += mag;
        frameMag += mag;
        // 6-band split (sub <60, low 60-250, lowMid 250-500, mid 500-2k, highMid 2k-6k, air 6k+)
        if (freq < 60) subSum += mag;
        else if (freq < 250) lowSum += mag;
        else if (freq < 500) lowMidSum += mag;
        else if (freq < 2000) midSum += mag;
        else if (freq < 6000) highMidSum += mag;
        else airSum += mag;
        // Vocal band 200-3000 Hz
        if (freq >= 200 && freq < 3000) vocalSum += mag;
        // Sibilance band 5000-9000 Hz
        if (freq >= 5000 && freq < 9000) sibilanceSum += mag;
        magSum += mag;
        if (mag > 1e-10) { logMagSum += Math.log(mag); validBins++; }
      }
      frameCentroid.push(centDen > 0 ? centNum / centDen : 0);
      frameEnergy.push(frameMag);
      // Spectral rolloff (85% cumulative energy)
      let cumul = 0, rolloff = 0;
      const target = frameMag * 0.85;
      for (let k = 1; k < halfN; k++) {
        cumul += mags[k];
        if (cumul >= target) { rolloff = (k * sr) / FRAME; break; }
      }
      frameRolloff.push(rolloff);
      // Spectral flatness: geometric mean / arithmetic mean of bin magnitudes
      if (validBins > 0 && frameMag > 0) {
        const geo = Math.exp(logMagSum / validBins);
        const ari = frameMag / validBins;
        frameFlatness.push(ari > 0 ? geo / ari : 0);
      }
    }

    // Integrated loudness (mean of frame RMS in dBFS, gated above silence threshold)
    const validLoud = frameLoudness.filter((d) => d > -70);
    const integratedDbfs =
      validLoud.length > 0
        ? validLoud.reduce((a, b) => a + b, 0) / validLoud.length
        : -70;
    // Map dBFS to LUFS-ish: real LUFS adds K-weighting that shifts roughly +1 to +3 for music
    const lufs = integratedDbfs + 2;

    const spectralCentroid =
      frameCentroid.length > 0
        ? frameCentroid.reduce((a, b) => a + b, 0) / frameCentroid.length
        : 0;

    // Transient density: count frames where energy > 1.5x running mean
    let runMean = frameEnergy[0] || 0;
    let transients = 0;
    for (const e of frameEnergy) {
      runMean = runMean * 0.95 + e * 0.05;
      if (e > runMean * 1.6) transients++;
    }
    const durationSec = audio.duration;
    const transientDensity = durationSec > 0 ? transients / durationSec : 0;

    // Crest factor (dynamic range proxy)
    const integratedRms = Math.sqrt(sumSq / sampleCount);
    const crestDb = integratedRms > 0 && peak > 0 ? 20 * Math.log10(peak / integratedRms) : 0;

    // Stereo correlation
    const ch1Real = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
    let stereoWidth = 0;
    if (ch1Real) {
      let dot = 0, l2 = 0, r2 = 0;
      const step = Math.max(1, Math.floor(ch0.length / 50000));
      for (let i = 0; i < ch0.length; i += step) {
        dot += ch0[i] * ch1Real[i];
        l2 += ch0[i] * ch0[i];
        r2 += ch1Real[i] * ch1Real[i];
      }
      const corr = l2 > 0 && r2 > 0 ? dot / Math.sqrt(l2 * r2) : 1;
      stereoWidth = Math.max(0, Math.min(1, 1 - corr)); // 0 = mono, 1 = anti-phase
    }

    // Tonal balance ratios — 6-band + back-compat 3-band
    const total = subSum + lowSum + lowMidSum + midSum + highMidSum + airSum;
    const subRatio = total > 0 ? subSum / total : 0;
    const lowRatio6 = total > 0 ? lowSum / total : 0;
    const lowMidRatio = total > 0 ? lowMidSum / total : 0;
    const midRatio6 = total > 0 ? midSum / total : 0;
    const highMidRatio = total > 0 ? highMidSum / total : 0;
    const airRatio = total > 0 ? airSum / total : 0;
    // 3-band aggregates for back-compat with deriveMetrics() / SVG
    const lowRatio = subRatio + lowRatio6;
    const midRatio = lowMidRatio + midRatio6;
    const highRatio = highMidRatio + airRatio;
    // Vocal band & sibilance band ratios (relative to total spectral energy)
    const vocalBandRatio = magSum > 0 ? vocalSum / magSum : 0;
    const sibilanceRatio = magSum > 0 ? sibilanceSum / magSum : 0;

    // Spectral flatness (mean across frames; 0 = pure tone, 1 = white noise)
    const meanFlatness = frameFlatness.length > 0
      ? frameFlatness.reduce((a, b) => a + b, 0) / frameFlatness.length : 0;
    const meanRolloff = frameRolloff.length > 0
      ? frameRolloff.reduce((a, b) => a + b, 0) / frameRolloff.length : 0;

    // LRA proxy: 95th - 10th percentile of frame loudness (above silence)
    const sortedLoud = [...frameLoudness].filter((d) => d > -70).sort((a, b) => a - b);
    const pct = (p) => sortedLoud.length > 0 ? sortedLoud[Math.floor((sortedLoud.length - 1) * p)] : -70;
    const lraDb = sortedLoud.length > 0 ? pct(0.95) - pct(0.10) : 0;

    // BPM estimate (autocorrelation on onset envelope from frameEnergy)
    const bpm = estimateBPM(frameEnergy, sr, HOP);

    // Bass mono compatibility (<120Hz L-R correlation via simple LPF)
    const bassMonoCompat = (audio.numberOfChannels > 1)
      ? estimateBassMonoCompat(ch0, ch1, sr) : 1;

    const result = {
      filename: file.name,
      durationSec: parseFloat(durationSec.toFixed(1)),
      sampleRate: sr,
      channels: audio.numberOfChannels,
      lufs: parseFloat(lufs.toFixed(1)),
      peakDbfs: parseFloat((20 * Math.log10(peak || 1e-6)).toFixed(1)),
      crestDb: parseFloat(crestDb.toFixed(1)),
      lraDb: parseFloat(lraDb.toFixed(1)),
      bpm: bpm,
      spectralCentroidHz: Math.round(spectralCentroid),
      spectralRolloffHz: Math.round(meanRolloff),
      spectralFlatness: parseFloat(meanFlatness.toFixed(3)),
      transientDensity: parseFloat(transientDensity.toFixed(2)),
      stereoWidth: parseFloat(stereoWidth.toFixed(2)),
      bassMonoCompat: parseFloat(bassMonoCompat.toFixed(2)),
      vocalBandRatio: parseFloat(vocalBandRatio.toFixed(3)),
      sibilanceRatio: parseFloat(sibilanceRatio.toFixed(3)),
      // 6-band spectral split
      subRatio: parseFloat(subRatio.toFixed(2)),
      lowRatio6: parseFloat(lowRatio6.toFixed(2)),
      lowMidRatio: parseFloat(lowMidRatio.toFixed(2)),
      midRatio6: parseFloat(midRatio6.toFixed(2)),
      highMidRatio: parseFloat(highMidRatio.toFixed(2)),
      airRatio: parseFloat(airRatio.toFixed(2)),
      // 3-band aggregates (back-compat)
      lowRatio: parseFloat(lowRatio.toFixed(2)),
      midRatio: parseFloat(midRatio.toFixed(2)),
      highRatio: parseFloat(highRatio.toFixed(2)),
    };
    window.lastAnalysis = result;
    ctx.close();
    console.log("Audio analysis:", result);
    return result;
  } catch (e) {
    console.warn("Audio analysis failed:", e);
    return null;
  }
}

function hannWindow(N) {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  return w;
}

// In-place radix-2 FFT (size must be power of 2)
function fftRadix2(re, im) {
  const N = re.length;
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const xRe = re[i + k];
        const xIm = im[i + k];
        const yRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const yIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = xRe + yRe;
        im[i + k] = xIm + yIm;
        re[i + k + len / 2] = xRe - yRe;
        im[i + k + len / 2] = xIm - yIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/* BPM via autocorrelation on onset envelope. */
function estimateBPM(frameEnergy, sr, hop) {
  if (!frameEnergy || frameEnergy.length < 32) return null;
  const frameRate = sr / hop;
  const env = new Float32Array(frameEnergy.length);
  for (let i = 1; i < frameEnergy.length; i++) {
    env[i] = Math.max(0, frameEnergy[i] - frameEnergy[i - 1]);
  }
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length;
  for (let i = 0; i < env.length; i++) env[i] -= mean;
  const minLag = Math.max(2, Math.floor(frameRate * 60 / 200));
  const maxLag = Math.min(env.length - 1, Math.floor(frameRate * 60 / 60));
  let bestLag = -1, bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    const limit = env.length - lag;
    for (let i = 0; i < limit; i++) c += env[i] * env[i + lag];
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  if (bestLag < 0) return null;
  return Math.round(60 * frameRate / bestLag);
}

/* Bass mono compatibility: low-pass both channels then correlate.
   1.0 = perfect mono fold, 0 = uncorrelated, <0 = phase issues. */
function estimateBassMonoCompat(ch0, ch1, sr) {
  const fc = 120;
  const Q = 0.707;
  const w0 = 2 * Math.PI * fc / sr;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = (1 - cosw) / 2, b1 = 1 - cosw, b2 = (1 - cosw) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
  const stride = Math.max(1, Math.floor(ch0.length / 200000));
  let lx1 = 0, lx2 = 0, ly1 = 0, ly2 = 0;
  let rx1 = 0, rx2 = 0, ry1 = 0, ry2 = 0;
  let dot = 0, l2 = 0, r2 = 0;
  for (let i = 0; i < ch0.length; i += stride) {
    const xL = ch0[i], xR = ch1[i];
    const yL = (b0 * xL + b1 * lx1 + b2 * lx2 - a1 * ly1 - a2 * ly2) / a0;
    const yR = (b0 * xR + b1 * rx1 + b2 * rx2 - a1 * ry1 - a2 * ry2) / a0;
    lx2 = lx1; lx1 = xL; ly2 = ly1; ly1 = yL;
    rx2 = rx1; rx1 = xR; ry2 = ry1; ry1 = yR;
    dot += yL * yR; l2 += yL * yL; r2 += yR * yR;
  }
  return l2 > 0 && r2 > 0 ? dot / Math.sqrt(l2 * r2) : 1;
}

window.analyzeAudioFile = analyzeAudioFile;
