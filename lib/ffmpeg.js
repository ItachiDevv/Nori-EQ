/* Server-side ffmpeg ebur128 — runs the bundled @ffmpeg-installer binary
   to produce ground-truth K-weighted loudness, true peak, and LRA. */

const { spawn } = require("child_process");

let cachedBin = null;
function ffmpegBin() {
  if (cachedBin) return cachedBin;
  if (process.env.FFMPEG_BIN) return (cachedBin = process.env.FFMPEG_BIN);
  try {
    cachedBin = require("@ffmpeg-installer/ffmpeg").path;
  } catch {
    cachedBin = "ffmpeg";
  }
  return cachedBin;
}

function runEbur128(filePath, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), [
      "-nostats", "-i", filePath,
      "-filter_complex", "ebur128=peak=true",
      "-f", "null", "-",
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    const t = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch (_) {}
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    proc.on("error", (err) => { clearTimeout(t); reject(new Error(`ffmpeg spawn: ${err.message}`)); });
    proc.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`));
      const parsed = parseEbur128(stderr);
      if (parsed.integratedLufs === -70 || parsed.integratedLufs == null) {
        // Suspicious result — log stderr tail for diagnosis.
        console.warn("[ebur128] suspicious result:", parsed, "\nstderr tail:", stderr.slice(-1500));
      }
      resolve(parsed);
    });
  });
}

function parseEbur128(stderr) {
  // ffmpeg's ebur128 prints "Integrated loudness:" / "Loudness range:" / "True peak:"
  // both as filter-init labels at the top AND as the Summary block at the end.
  // Always anchor on the LAST occurrence (Summary block) so we don't match the
  // silent-init values from the filter banner.
  const after = (anchor) => {
    const i = stderr.lastIndexOf(anchor);
    return i >= 0 ? stderr.slice(i) : "";
  };
  const grab = (block, re) => {
    const m = block.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  const integratedBlock = after("Integrated loudness:");
  const lraBlock = after("Loudness range:");
  const peakBlock = after("True peak:");
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const durationSec = dur ? (parseInt(dur[1]) * 3600 + parseInt(dur[2]) * 60 + parseFloat(dur[3])) : null;

  return {
    integratedLufs: grab(integratedBlock, /I:\s*(-?[\d.]+)\s*LUFS/),
    threshold: grab(integratedBlock, /Threshold:\s*(-?[\d.]+)\s*LUFS/),
    loudnessRange: grab(lraBlock, /LRA:\s*(-?[\d.]+)\s*LU/),
    lraLow: grab(lraBlock, /LRA low:\s*(-?[\d.]+)/),
    lraHigh: grab(lraBlock, /LRA high:\s*(-?[\d.]+)/),
    truePeakDbfs: grab(peakBlock, /Peak:\s*(-?[\d.]+)\s*dBFS/),
    durationSec: durationSec !== null ? parseFloat(durationSec.toFixed(2)) : null,
  };
}

module.exports = { runEbur128, ffmpegBin };
