# Nori EQ — Demo Script

**Total runtime:** 2:30 · **Track:** *Nori Nori* by Clawville (default `/nous.mp3`)
**Voice:** confident, fast, anime-cyberpunk-tech. The "humanizer" voice from `lib/gemini.js` — sweet, warm, playful, lowkey lethal. Reference frequencies in Hz when it sells the point.

> Pacing rule: knob/fader moves take 1.5–3 s, hold for 4–8 s, then move again. Nothing robotic.

---

## 0:00 – 0:08 · Intro

**On-screen caption:** *NORI EQ — mix your music, see your music.*

**Voiceover:**
> Nori EQ. A web audio mixer that turns the song into the stage. The bass is the lighting. The mids are the camera. Press play.

**Visual:** Title card over the live atmosphere layer. Logo glow pulses on the first chorus hit. No automation — neutral preset, just music breathing.

---

## 0:08 – 0:18 · Live Web Audio Mixer

**On-screen caption:** *Sub · Low · Mid · High · Master · drive · reverb · width · filter*

**Voiceover:**
> Five faders, four FX knobs, all running through real Web Audio nodes. Pill bar at the top is reading the FFT live — sigil, pixel, ASCII, kaleido, strobe. Every fader is wired to a visual.

**Visual:** Camera crash-zooms onto the mixer panel. All faders sit at 0 dB. Pill bar pulses with the kick. Filter knob shows 22 kHz, reverb 0.25, drive 15.

---

## 0:18 – 0:28 · SUB → SIGIL

**On-screen caption:** *SUB → sigil intensity on every kick.*

**Voiceover:**
> Push SUB up — sigils ignite on the kick. That's a real lowpass at 80 Hz feeding the bass envelope into the visual layer. Pull it back, sigils calm.

**Visual:** Hand cursor drags SUB fader from 0 dB → +9 dB over ~2 s. Sigil pill flashes hot pink. Hold 4 s through the chorus hit. Drag back to 0 dB by t=27.

---

## 0:28 – 0:38 · MID → ASCII

**On-screen caption:** *MID → ASCII grain size.*

**Voiceover:**
> Mid down, ASCII grain goes chunky — you can read the cells. Push it up, the grid gets fine, vocals slice through. Same knob, two looks.

**Visual:** MID fader pulls down to -10 dB. ASCII overlay visibly fattens to ~16 px cells. Hold 2 s. Push up to +8 dB — cells shrink to ~6 px, detail returns. Settle at 0 by t=38.

---

## 0:38 – 0:48 · HIGH → KALEIDO

**On-screen caption:** *HIGH → LED rotation speed.*

**Voiceover:**
> High end spins the kaleido. Hi-hats steer the LED rig. Push it, the room rotates. It's not a preset — it's the signal.

**Visual:** HIGH fader → +9 dB. Kaleido layer accelerates noticeably. Hi-hat onsets punch the rotation. Drop back to 0 dB by t=47.5.

---

## 0:48 – 1:00 · REVERB

**On-screen caption:** *Real ConvolverNode reverb. You hear it because the audio is rendered offline through the same chain.*

**Voiceover:**
> Reverb is a ConvolverNode — a real impulse response, not a fake. Crank it, the tail blooms and the stage glows brighter. This is in the demo MP3 too, because Remotion is rendering the audio through the same chain you're hearing on the page.

**Visual:** REVERB knob ramps 0.25 → 0.85 over 3 s. p5 canvas drop-shadow bloom blossoms (up to 30 px). Hold the wash for 4 s. Pull back to 0.25 by t=59.

---

## 1:00 – 1:12 · FILTER

**On-screen caption:** *FILTER → cutoff Hz + stage hue rotation.*

**Voiceover:**
> Filter is a lowpass cutoff. Sweep it down, the track gets dark and the whole stage rotates hue. 22 k down to six hundred — the room turns magenta.

**Visual:** FILTER knob exponential sweep 22000 Hz → 600 Hz over 5 s. Audible brightness loss. `#stageWrap` CSS hue-rotate climbs to ~175°. Hold 1.5 s. Sweep back open exponentially.

---

## 1:12 – 1:24 · DRIVE

**On-screen caption:** *DRIVE → soft saturation + pixel posterize.*

**Voiceover:**
> Drive is a WaveShaper — soft clip on the audio, posterize on the picture. At 85, the mix is crunchy and the pixel layer drops to three color steps. It's not a filter, it's a coupling.

**Visual:** DRIVE knob 15 → 85 over 2.5 s. Audible grit. Pixel overlay posterize collapses (16 → 3 levels). Hold 4 s. Pull back to 15 by t=82.5.

---

## 1:24 – 1:42 · NORI

**On-screen caption:** *Gemini multimodal listens to your mix and replies — grounded in real ebur128 + FFT metrics.*

**Voiceover:**
> Open Nori. Ask her anything about the mix. She uploads the audio to Gemini 2.5 Pro, multimodal. The reply is grounded in real ffmpeg ebur128 — integrated LUFS, true peak, loudness range — plus the browser's FFT analysis. She replies in numbers and Hz.

**Visual:** NORI pill click → slide-out panel. User types: *"Is the bass too thin?"* Spinner ("Nori is analyzing..."), then a chat bubble streams in: *"okay so cutie, your sub-band is sitting at -11 dB relative to 200 Hz — a touch shy. Try +2 at 60 Hz..."* Inline infographic SVG renders below the bubble.

---

## 1:42 – 2:00 · SPLIT

**On-screen caption:** *Split: compare two mixer states. Pick the winner.*

**Voiceover:**
> Hit Split. Two random presets, side by side, one song. Save A. Tweak the right side. Save B. Toggle — faders snap between them. A/B without leaving the page.

**Visual:** Click SPLIT toggle. Stage divides into two atmospheres. Faders animate to preset A: SUB +4, LOW -3, HIGH +5, width 1.4. Click "Save A". Faders animate to preset B: SUB -2, LOW +3, MID -4, drive 35. Click "Save B". Toggle A↔B once. Exit split, faders return to neutral by t=120.

---

## 2:00 – 2:18 · EXPORT

**On-screen caption:** *Render your mix. OfflineAudioContext + lamejs MP3.*

**Voiceover:**
> Export. OfflineAudioContext renders your mix faster than real time, through the exact same EQ and FX chain. Pick MP3, lamejs encodes it, and you're holding the file in eight seconds.

**Visual:** Click EXPORT pill. Modal opens. Click MP3. Progress bar fills (render → encode phases). Confirmation: "DOWNLOADED ✓". File `nori-mix.mp3` slides into the dock.

---

## 2:18 – 2:30 · Outro

**On-screen caption:** *Made with Hermes · Suno · Kimi K2.6.*

**Voiceover:**
> Web Audio. Gemini. p5. No plugins, no install, no DAW. Mix your music, see your music. That's Nori.

**Visual:** SUB +6, HIGH +6, master +2, reverb 0.6, width 1.4 — full stage lit, all overlays pulsing. Logo fades in over the wash. Master fader pulls to -12 dB across the last 4 s, audio fades, logo holds.

---

## Calls to action

- **Code:** github.com/your/nori-eq
- **Live:** hackathon-three-rose-57.vercel.app
- **Made with Hermes.**
