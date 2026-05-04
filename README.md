# Nori EQ

Web audio playground with reactive visuals, an in-browser EQ rack, and AI engineering feedback. Drop a track, mix it through a 6-band EQ + drive/reverb/width FX, and ask **Nori** — a cute anime-idol mixing engineer powered by Gemini 2.5 multimodal — what to fix.

**Live demo:** https://www.norieq.com
**Catch us on https.x.com/ClawvilleWorld**
<img width="25" height="50" alt="anime_singer-removebg-preview" src="https://github.com/user-attachments/assets/95e06297-4a42-4943-906f-a58cb8793c72" />
---

## Features

- **In-browser EQ + FX rack** — 6-band parametric EQ, drive, reverb, stereo width, lowpass filter. Every parameter scales the visual reactivity layer too.
- **Audio-reactive visuals** — anime-idol concert scene with FFT-driven particles, ASCII-shader overlay, pixel/dither overlay, kinetic typography overlay, and atmosphere layers.
- **Nori AI engineering feedback** — slide-out chat panel. Gemini 2.5 Pro listens to your track (multimodal audio input) and grounds its critique in real `ffmpeg ebur128` measurements (integrated LUFS, true peak, LRA) plus FFT-derived metrics (BPM, spectral centroid/rolloff/flatness, vocal/sibilance band energies, stereo width, bass mono compatibility, 6-band tonal balance). Quick-prompt chips for "Mix balance", "Mastering loudness", and "Re-analyze (edits)". Free-form follow-up Q&A.
- **Offline-rendered mix export** — `OfflineAudioContext` renders the mix faster than real time through the same FX chain used live, then encodes to WAV (built-in) or MP3 (lamejs, loaded on demand).
- **"Re-analyze with edits"** — click the chip or type a re-analyze message in chat → Nori re-renders the post-edit mix and runs a fresh critique against the latest version.
- **Now-playing widget**, **lyrics waterfall**, **atmosphere personality battle** — additional panes for inspecting and comparing.

---

## Quick start

### Prerequisites
- **Node.js 20+** (native `fetch` is required)
- **A Gemini API key** — free at <https://aistudio.google.com/apikey>

### Install + run locally
```bash
git clone <your-fork-url> nori-eq
cd nori-eq
npm install
cp .env.example .env
# edit .env and set GEMINI_API_KEY=...
node server.js
```
Open **http://localhost:3000**.

`@ffmpeg-installer/ffmpeg` ships a static binary, so no system `ffmpeg` install is required.

### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | — | Get one at https://aistudio.google.com/apikey |
| `GEMINI_AUDIO_MODEL` | no | `gemini-2.5-pro` | Multimodal model used by `/api/analyze` |
| `GEMINI_AUDIO_FALLBACK` | no | `gemini-2.5-flash` | Used when the audio model 503's |
| `GEMINI_CHAT_MODEL` | no | `gemini-2.5-flash` | Text-only model used by `/api/feedback` |
| `FFMPEG_BIN` | no | bundled | Override the bundled ffmpeg binary path |
| `PORT` | no | `3000` | Express dev port |

---

## How it works

### Pipeline
```
[Browser]
  audio_analysis.js   ── FFT, 6-band tonal split, BPM, bass mono compat,
                         vocal/sibilance band energy, spectral flatness/rolloff
  eq_panel.js         ── live EQ + FX (drive, reverb, width, lowpass filter)
  export_widget.js    ── OfflineAudioContext renders edited mix → WAV/MP3 blob
  nori_widget.js      ── slide-out chat, "Re-analyze (edits)" chip, intent regex
       │
       │   FormData: audio File + browser metrics JSON
       ▼
[POST /api/analyze]
       │
       ├──── lib/ffmpeg.js   ── ebur128: integrated LUFS, true peak, LRA
       └──── lib/gemini.js   ── Gemini 2.5 Pro multimodal (audio inline + metrics)
                                with retry + Flash fallback on 503
       │
       ▼
   { critique, infographic SVG, contextString, serverMetrics, modelUsed }
       │   cached in window.lastServerAnalysis
       ▼
[POST /api/feedback]   text-only follow-up using cached contextString
       └──── lib/gemini.js   ── Gemini 2.5 Flash
```

### API endpoints

#### `POST /api/analyze`
`multipart/form-data`:
- `audio` — File (mp3, wav, flac, ogg, m4a, aac, aiff). ~18MB inline limit.
- `metrics` — optional JSON string of browser-side measurements.

Returns:
```json
{
  "ok": true,
  "modelUsed": "gemini-2.5-pro",
  "critique": "Okay so, bestie...",
  "reply": "...",
  "text": "...",
  "infographic": "<svg ...>",
  "contextString": "File: ..., LUFS: -13.4 (ebur128), TruePeak: -2.4dBFS, ...",
  "metrics": { "...": "browser metrics echoed" },
  "serverMetrics": {
    "integratedLufs": -13.4,
    "truePeakDbfs": -2.4,
    "loudnessRange": 3.6,
    "lraLow": -15.6,
    "lraHigh": -12,
    "durationSec": 162.72
  }
}
```

#### `POST /api/feedback`
`application/json`:
- `prompt` — user question
- `context` — cached metric string (returned by the previous `/api/analyze`)

Returns:
```json
{
  "ok": true,
  "reply": "Okay so, for the vocal...",
  "text": "...",
  "infographic": "<svg ...>"
}
```

---

## Project structure

```
api/
  analyze.js          multipart → ffmpeg + Gemini multimodal critique
  feedback.js         JSON → Gemini text-only follow-up
lib/
  gemini.js           Gemini API helpers (retry + Flash fallback)
  ffmpeg.js           ebur128 wrapper
  svg.js              infographic SVG builder
js/
  audio_analysis.js   browser FFT, BPM, spectral shape, bass mono compat
  audio_reactivity.js visual reactivity wiring
  concert.js          p5 main draw loop
  eq_panel.js         6-band EQ + drive/reverb/width FX rack
  export_widget.js    offline mix render + WAV/MP3 encode + window.renderEditedMix
  nori_widget.js      floating "NORI ENGINEERING FEEDBACK" panel + re-analyze flow
  upload.js           file drop / mic input
  intro_modal.js      first-load click-through explainer
  default_track.js    auto-load nous.mp3 on page load
  ascii_overlay.js    ASCII shader on top of canvas
  pixel_overlay.js    pixel/dither shader
  pretext_overlay.js  kinetic typography overlay
  spectrum_overlay.js FFT spectrum
  atmosphere.js       atmosphere/weather layer
  now_playing_widget.js floating now-playing pill
  ...
nous.mp3              default track ("Nori Nori" by Clawville)
server.js             local Express dev server (delegates to api/*.js handlers)
vercel.json           Vercel production config (function timeouts)
```

The Express server in `server.js` and the Vercel functions in `api/*.js` share the **same handler modules**. `node server.js` and `vercel dev` run identical code.

---

## Deploy to Vercel

```bash
vercel link
vercel env add GEMINI_API_KEY            # required
vercel env add GEMINI_AUDIO_MODEL        # optional
vercel env add GEMINI_AUDIO_FALLBACK     # optional
vercel env add GEMINI_CHAT_MODEL         # optional
vercel deploy --prod
```

`vercel.json` sets function timeouts: analyze 120s, feedback 30s.

**Body-size note:** Vercel limits serverless function request bodies to ~4.5MB. The default `nous.mp3` (3.9MB) fits. For real-world WAVs you'll want to add Vercel Blob upload + URL-based analyze instead of inline multipart.

---

## Tech stack

- **Frontend** — vanilla JS, p5.js + p5.sound, Web Audio API, OfflineAudioContext, lamejs (on-demand for MP3 export)
- **Backend** — Express (local dev) / Vercel functions (production), formidable for multipart, native `fetch`
- **AI** — Google Gemini 2.5 Pro (multimodal audio) + 2.5 Flash (text follow-ups)
- **Measurement** — `ffmpeg` ebur128 filter, bundled via `@ffmpeg-installer/ffmpeg`

---

## Credits

- **Default track** — *"Nori Nori"* by **Clawville**, generated with **Suno** via **Hermes** (Nous Research) prompts.
- **Engineering** — built with **Kimi K2.6** (Moonshot AI) and **Hermes** (Nous Research).
- **AI critique** — **Google Gemini 2.5** (Pro multimodal + Flash).
- **Concept art** — `anime_singer.png` and `crowd.png` generated with **Imagen 4 Ultra**.
- **Audio analysis** — `ffmpeg`'s `ebur128` filter (R128 / EBU loudness recommendation).

---

## License

MIT — see [LICENSE](LICENSE).
