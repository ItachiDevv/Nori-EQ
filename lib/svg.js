/* Infographic SVG built from analysis context. */

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function deriveMetrics(context) {
  const ctx = context || "";
  const parseNum = (key) => {
    const m = ctx.match(new RegExp(`${key}:\\s*(-?[\\d.]+)`));
    return m ? parseFloat(m[1]) : null;
  };
  const parsePct = (key) => {
    const m = ctx.match(new RegExp(`${key}:\\s*([\\d.]+)%`));
    return m ? parseFloat(m[1]) / 100 : null;
  };

  const lufs = parseNum("LUFS");
  const crest = parseNum("Crest");
  const centroid = parseNum("SpectralCentroid");
  const transients = parseNum("Transients");
  const stereoWidth = parseNum("StereoWidth");
  const tonalMatch = ctx.match(/Tonal Low\/Mid\/High:\s*([\d.]+)\/([\d.]+)\/([\d.]+)/);
  const low = tonalMatch ? parseFloat(tonalMatch[1]) : (parsePct("Low") || 0.4);
  const high = tonalMatch ? parseFloat(tonalMatch[3]) : (parsePct("High") || 0.2);

  const bassVal = low > 0.45 ? "Heavy" : low > 0.30 ? "Punchy" : low > 0.18 ? "Warm" : "Thin";
  let highVal = "Balanced";
  if (centroid !== null) {
    if (centroid > 5500) highVal = "Harsh";
    else if (centroid > 3500) highVal = "Bright";
    else if (centroid > 2000) highVal = "Balanced";
    else highVal = "Dull";
  } else if (high > 0.35) highVal = "Bright";
  const lufsValue = lufs !== null ? `${lufs.toFixed(1)} LU` : "n/a";
  let dynVal = "Medium";
  if (crest !== null) {
    if (crest > 16) dynVal = "Dynamic";
    else if (crest > 11) dynVal = "Open";
    else if (crest > 8) dynVal = "Tight";
    else dynVal = "Crushed";
  }
  let stereoVal = "Mono-ish";
  if (stereoWidth !== null) {
    if (stereoWidth > 0.6) stereoVal = "Wide";
    else if (stereoWidth > 0.3) stereoVal = "Stereo";
    else if (stereoWidth > 0.1) stereoVal = "Center";
    else stereoVal = "Mono-ish";
  }
  let grooveVal = "Steady";
  if (transients !== null) {
    if (transients > 6) grooveVal = "Frantic";
    else if (transients > 3.5) grooveVal = "Driving";
    else if (transients > 1.8) grooveVal = "Grooving";
    else if (transients > 0.6) grooveVal = "Loose";
    else grooveVal = "Sparse";
  }

  const lufsPct = lufs !== null ? Math.max(5, Math.min(100, Math.round(((lufs + 30) / 30) * 100))) : 50;
  const crestPct = crest !== null ? Math.max(5, Math.min(100, Math.round((crest / 24) * 100))) : 50;
  const stereoPct = stereoWidth !== null ? Math.max(5, Math.round(stereoWidth * 100)) : 30;
  const grooveScale = transients !== null ? Math.max(5, Math.min(100, Math.round((transients / 8) * 100))) : 40;

  return [
    { label: "BASS", value: bassVal, color: "#ff00a0", pct: Math.max(5, Math.round(low * 200)) },
    { label: "HIGHS", value: highVal, color: "#00f0ff", pct: centroid !== null ? Math.max(5, Math.min(100, Math.round((centroid / 8000) * 100))) : Math.round(high * 200) },
    { label: "STEREO", value: stereoVal, color: "#ffe600", pct: stereoPct },
    { label: "LUFS", value: lufsValue, color: "#ff00a0", pct: lufsPct },
    { label: "DYNAMICS", value: dynVal, color: "#00f0ff", pct: crestPct },
    { label: "GROOVE", value: grooveVal, color: "#ffe600", pct: grooveScale },
  ];
}

function buildInfographic(metrics) {
  const items = metrics && metrics.length ? metrics : [];
  const W = 400, H = 140, cols = 3, rows = 2, pad = 6;
  const pw = (W - pad * (cols + 1)) / cols;
  const ph = (H - pad * (rows + 1)) / rows;

  let panels = "";
  items.forEach((it, i) => {
    const cx = pad + (i % cols) * (pw + pad);
    const cy = pad + Math.floor(i / cols) * (ph + pad);
    const bar = Math.max(2, (pw - 8) * (it.pct / 100));
    panels += `
      <rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="3" fill="#12021f" stroke="${escapeXml(it.color)}" stroke-width="0.5" opacity="0.9"/>
      <rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${pw.toFixed(1)}" height="2" rx="1" fill="${escapeXml(it.color)}" opacity="0.8"/>
      <text x="${(cx + 5).toFixed(1)}" y="${(cy + 14).toFixed(1)}" fill="#9b7cb6" font-size="7" font-family="monospace" font-weight="bold">${escapeXml(it.label)}</text>
      <text x="${(cx + 5).toFixed(1)}" y="${(cy + 30).toFixed(1)}" fill="${escapeXml(it.color)}" font-size="13" font-family="monospace" font-weight="bold">${escapeXml(String(it.value))}</text>
      <rect x="${(cx + 5).toFixed(1)}" y="${(cy + 36).toFixed(1)}" width="${bar.toFixed(1)}" height="2.5" rx="1.2" fill="${escapeXml(it.color)}" opacity="0.5"/>
    `;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px;margin-top:8px;border-radius:8px;background:#0b0014;border:1px solid #ff00a0;display:block;">
    <defs>
      <pattern id="igrid" width="16" height="16" patternUnits="userSpaceOnUse">
        <path d="M16 0L0 0 0 16" fill="none" stroke="#ff00a0" stroke-width="0.3" opacity="0.15"/>
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="#0b0014"/>
    <rect width="${W}" height="${H}" fill="url(#igrid)"/>
    ${panels}
  </svg>`;
}

module.exports = { deriveMetrics, buildInfographic, escapeXml };
