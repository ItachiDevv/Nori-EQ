# Nori EQ — Screen Recording Checklist

Use this with `demo/timeline.json` and `demo/script.md`. Captures are layered into the Remotion comp on top of the offline-rendered MP3.

**Capture rules**
- 1920×1080, 30 fps, full window of the live page (Chrome, no extensions visible).
- Hide the cursor between cuts; show it only during deliberate fader/knob/button moves.
- Every caption in `script.md` becomes a Remotion lower-third. **Never** replace footage with a title card — the page must keep moving underneath.
- Screen-record a single take per segment, leave 0.5 s pre/post-roll for transitions.
- Audio in the recording itself can be muted — Remotion uses the offline-rendered MP3 as the soundtrack.

---

## Pre-roll setup (do once)

1. Hard-refresh `/` so the intro modal is dismissed (`localStorage.setItem('nori_eq_intro_seen_v2', '1')`).
2. Confirm `_nousSound` is loaded and looping. Pause it at t=0 of the recording, the timeline driver will start it.
3. Open devtools console, paste `runDemoTimeline()` (Step 2). Recording begins on the call.
4. Reset all faders to 0 dB, FX knobs to defaults: drive 15, reverb 0.25, width 1.0, speed 1.0, filter 22 kHz.

---

## Segment-by-segment capture

### 0:00 – 0:08 · Intro
- Stage already breathing (atmosphere canvas alive). No UI interaction.
- Capture: full-stage shot, NORI EQ logo top-left visible.

### 0:08 – 0:18 · Mixer baseline
- Camera reframe: zoom CSS to highlight the bottom mixer panel + pill bar.
- No fader moves. Just let the FFT pulse the pills.

### 0:18 – 0:28 · SUB → SIGIL
- Cursor hovers over SUB fader thumb at t=18.5.
- `runDemoTimeline()` drags SUB 0 → +9 dB across t=19–21.
- Hold at +9 through t=25. Sigil pill should flash hot pink on every kick.
- Drag back to 0 dB across t=25–27.

### 0:28 – 0:38 · MID → ASCII
- Cursor on MID fader at t=28.5.
- Pull down to -10 dB across t=29–30.5. ASCII grain visibly fattens.
- Hold 2 s. Push up to +8 dB across t=33–35.
- Settle at 0 by t=36.5.

### 0:38 – 0:48 · HIGH → KALEIDO
- Cursor on HIGH fader.
- Push to +9 dB across t=39–41. Kaleido visibly accelerates on hi-hats.
- Hold through t=45.5. Drop to 0 dB across t=45.5–47.5.

### 0:48 – 1:00 · REVERB *(headline shot — make it count)*
- Cursor on REVERB knob.
- Ramp 0.25 → 0.85 across t=49–52. p5 canvas drop-shadow bloom must visibly grow.
- HOLD the wash 4 s through t=52–56.
- Pull back to 0.25 across t=56–59.

### 1:00 – 1:12 · FILTER
- Cursor on FILTER knob.
- Exponential sweep 22 kHz → 600 Hz across t=61–66. Stage `hue-rotate` should climb to ~175°.
- Hold at 600 Hz for 1.5 s.
- Sweep back to 22 kHz across t=67.5–71.

### 1:12 – 1:24 · DRIVE
- Cursor on DRIVE knob.
- Push 15 → 85 across t=73–75.5. Pixel overlay posterize visibly collapses (16 → 3 levels).
- Hold 4 s. Pull back across t=80–82.5.

### 1:24 – 1:42 · NORI
- Click NORI pill (top-right) at t=84.5.
- Slide-out panel opens. At t=86, type *"Is the bass too thin?"* into the input.
- Press Enter at t=89. Spinner "Nori is analyzing…" shows for ~2 s.
- Reply streams in starting t=91. Show inline infographic SVG render below the bubble.
- Leave panel open through t=102.

### 1:42 – 2:00 · SPLIT
- Click SPLIT toggle (top-left, gold border on activate) at t=102.5.
- Stage divides. Two preset states load on left/right.
- At t=104, click "⊕ SAVE A". Faders snap to preset A.
- At t=108, drag a couple faders on the right side to mutate B.
- At t=110, click "⊕ SAVE B". Faders snap to preset B.
- At t=113, click ◐ A → faders flip to A. At t=116, click ◑ B → flip to B.
- At t=119, click "× CANCEL" or "★ KEEP". Stage merges back.

### 2:00 – 2:18 · EXPORT
- Click EXPORT pill (top-right area) at t=120.5.
- Modal opens. Click "MP3" radio at t=123.
- Click "Render" at t=125. Progress bar fills across two phases (render → encode), ~6 s.
- "DOWNLOADED ✓" confirmation at t=133. File `nori-mix.mp3` lands in browser dock.
- Close modal at t=137.

### 2:18 – 2:30 · Outro
- Faders animate to celebratory preset (SUB +6, HIGH +6, master +2, reverb 0.6, width 1.4) across t=138–140.
- All overlays pulsing on the chorus. Full-stage shot.
- Master pulls to -12 dB across t=146–150 → audio fades.
- Logo fades in over the wash at t=146.

---

## What NOT to do

- Don't pause `_nousSound` mid-segment for a clean shot — viewers must hear the audio change in sync with the visual change.
- Don't cut to a black title card. The atmosphere canvas keeps breathing through every transition.
- Don't reset faders between segments unless the timeline does it. The script intentionally lets some moves bleed (e.g., MID stays at -10 a beat into the next segment is fine).
- Don't show devtools, network requests, or console. The page is the entire stage.

---

## Post-capture

Drop the recording into `remotion/public/screen-capture.mp4`. The Composition reads `demo/timeline.json` for caption timings and overlays them at the correct frames.
