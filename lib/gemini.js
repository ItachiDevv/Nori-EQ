/* Shared Gemini helpers: text + multimodal (audio inline), retry + flash fallback. */

const KEY = () => process.env.GEMINI_API_KEY;
const CHAT_MODEL = () => process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
const AUDIO_MODEL = () => process.env.GEMINI_AUDIO_MODEL || "gemini-2.5-pro";
const FALLBACK_AUDIO_MODEL = () => process.env.GEMINI_AUDIO_FALLBACK || "gemini-2.5-flash";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geminiGenerate({ model, parts, generationConfig, timeoutMs }) {
  if (!KEY()) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY()}`;
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig,
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let json;
    try { json = await resp.json(); } catch { json = {}; }
    if (!resp.ok) {
      const e = new Error(json?.error?.message || `Gemini ${resp.status}`);
      e.status = resp.status;
      throw e;
    }
    const cand = json?.candidates?.[0];
    const text = (cand?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "").trim();
    if (!text) {
      const reason = cand?.finishReason || "unknown";
      const block = json?.promptFeedback?.blockReason;
      const e = new Error(`empty response (finishReason=${reason}${block ? `, block=${block}` : ""})`);
      e.empty = true;
      throw e;
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function callGemini(prompt, { model = CHAT_MODEL(), timeoutMs = 25000 } = {}) {
  return geminiGenerate({
    model,
    parts: [{ text: prompt }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 1500 },
    timeoutMs,
  });
}

/* Multimodal: tries pro with retries, then falls back to flash on persistent 503/empty. */
async function callGeminiAudio(prompt, audioBuffer, mimeType, { timeoutMs = 120000 } = {}) {
  const data = audioBuffer.toString("base64");
  const parts = [
    { text: prompt },
    { inlineData: { mimeType, data } },
  ];
  const generationConfig = {
    temperature: 0.7,
    maxOutputTokens: 8000,
    thinkingConfig: { thinkingBudget: 4000 },
  };

  const attempts = [
    { model: AUDIO_MODEL(), wait: 0 },
    { model: AUDIO_MODEL(), wait: 3000 },
    { model: AUDIO_MODEL(), wait: 8000 },
    { model: FALLBACK_AUDIO_MODEL(), wait: 0 },
  ];

  let lastErr;
  for (const { model, wait } of attempts) {
    if (wait) await sleep(wait);
    try {
      const text = await geminiGenerate({ model, parts, generationConfig, timeoutMs });
      return { text, modelUsed: model };
    } catch (err) {
      lastErr = err;
      const retryable = err.status === 503 || err.status === 429 || err.empty;
      if (!retryable) throw err;
    }
  }
  throw lastErr || new Error("Gemini audio: all attempts failed");
}

/* Strip marketing-speak / LLM tics. */
function humanize(text) {
  if (!text) return text;
  let out = text;
  const swaps = [
    [/\b(leverages?)\b/gi, "uses"],
    [/\b(robust)\b/gi, "solid"],
    [/\b(elegant)\b/gi, "clean"],
    [/\b(delve)\b/gi, "dig"],
    [/\b(it's important to note that)\b/gi, ""],
    [/\b(additionally)\b/gi, "plus"],
    [/\b(crucial)\b/gi, "key"],
    [/\b(underscores?)\b/gi, "shows"],
    [/\b(highlights?)\b/gi, "shows"],
    [/\b(intricate)\b/gi, "complex"],
    [/\b(landscape)\b/gi, "scene"],
    [/\b(testament)\b/gi, "sign"],
    [/\b(pivotal)\b/gi, "key"],
    [/\b(seamless(ly)?)\b/gi, "smooth"],
    [/\b(at its core)\b/gi, "basically"],
    [/\b(in order to)\b/gi, "to"],
    [/\b(due to the fact that)\b/gi, "because"],
    [/\b(let me know)\b[,.]?/gi, ""],
    [/\b(i hope this helps)\b[,.]?/gi, ""],
    [/\b(certainly)\b[,.]?/gi, ""],
    [/\b(of course)\b[,.]?/gi, ""],
    [/\b(you're absolutely right)\b[,.]?/gi, ""],
    [/\b(great question)\b[,.]?/gi, ""],
    [/\b(furthermore)\b/gi, "also"],
    [/\b(moreover)\b/gi, "plus"],
    [/\b(consequently)\b/gi, "so"],
    [/\b(therefore)\b/gi, "so"],
    [/\b(however)\b/gi, "but"],
    [/\b(in conclusion)\b/gi, ""],
    [/\b(to summarize)\b/gi, ""],
    [/\b(in summary)\b/gi, ""],
    [/—/g, ","],
  ];
  for (const [pat, repl] of swaps) {
    try { out = out.replace(pat, repl); } catch (_) {}
  }
  out = out.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").trim();
  return out.replace(/[.,;:!?\s]/g, "") ? out : text;
}

module.exports = { callGemini, callGeminiAudio, humanize };
