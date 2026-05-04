/* /api/feedback — text-only Gemini follow-up using cached metrics. */

const { callGemini, humanize } = require("../lib/gemini");
const { deriveMetrics, buildInfographic } = require("../lib/svg");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(200).json({ ok: false, error: "GEMINI_API_KEY not set" });
  }

  const body = req.body || (await readJson(req));
  const { prompt, context } = body || {};
  if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt" });

  const persona = "You are Hermes Producer — a cute anime-idol mixing engineer who's lethal at mastering. Voice: sweet, warm, playful, slightly bubbly. Use natural soft phrases ('okay so', 'cutie', 'bestie', 'lowkey'). Use *italics* and ♡/~ sparingly. Answer ONLY the user's specific question — don't redo the whole mix critique. Stay short: 1-2 short paragraphs. Reference specific numbers and frequency ranges in Hz only when they make the answer concrete. No bullet lists, no filler.";
  const fullPrompt = context
    ? `${persona}\n\nTrack metrics:\n${context}\n\nUser: ${prompt}`
    : `${persona}\n\nUser: ${prompt}`;

  try {
    const raw = await callGemini(fullPrompt);
    const humanized = humanize(raw) || "(Hermes Producer fell silent.)";
    const infographic = buildInfographic(deriveMetrics(context || ""));
    res.status(200).json({ ok: true, reply: humanized, text: humanized, infographic });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
};

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
