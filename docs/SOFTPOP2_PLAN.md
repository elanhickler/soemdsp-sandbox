# Softpop2 plan

Source: Thoughts agent for Argi, 2026-10-16. Planning only, no implementation until Argi says so.

## Decisions (Argi, 2026-10-16)

1. **Approved:** add Blue and Violet to the shared library `library/include/soemdsp/math/noise_colors.h`. Existing colours stay bit-identical, with a regression test.
2. Softpop2 Color list: **White, Gaussian, Average, Pink, Brown, Blue, Violet.**
3. **Approved:** move the tilt correction, level gains and `sin(w)/w` decramp (`kFilterGain`, `kTiltAlpha`, `tilt_warp` from `native_modules/softpop_filter/softpop_filter.cpp`) into the shared library. Softpop Filter then uses the library version, output bit-identical.
4. The video output port is shown to users as the 📺 emoji, never labeled "RGBA". The internal id stays lowercase `rgba`, like Softpop.
5. Softpop Oscillator, Softpop Filter and Noise Generator also get **Blue** and **Violet**, appended to the end of their Color choice lists so existing saved indices/presets stay valid (choices also persist by name, APP_POLICY "Choice / enum persistence"). Existing colours bit-identical.
6. Amp over Crossfade uses the **squared** curve by default: `out = Amplitude · x · (1 − a·c)²` (ear check can confirm).
7. **Face (Argi, 2026-10-17):** keep the sine line and add a noise band centred at the pitch whose width follows Q. The band's brightness rises with the crossfade noise gain while the line fades; Amp over Crossfade dims the whole picture. WebGL/shaders only, using values the engine already computes.

**Module:** `softpop2` ("Softpop 2"), native C++ `native_modules/softpop2/softpop2.cpp`. Reuses `native_modules/softpop_oscillator/softpop_core.h`, `library/include/soemdsp/filter/tpt_svf.h`, `library/include/soemdsp/math/noise_colors.h`, `math/seed.h`. No JS DSP.

**Intent (Argi):** an oscillator dispersing into noise. As Crossfade rises, a sine fades into band-limited noise centred on its own pitch, and the noise band widens so the energy spreads over a frequency range. Amp over Crossfade decides whether loudness holds or the sound fades away, so it sounds like it's disappearing into noise or reverberating away.

## Ports
- Inputs: `Reset` (rising edge reseeds every noise generator from Seed), `f` (Hz; wired replaces the Frequency knob, like Softpop / polyBlep).
- Outputs: `Mono` (= Left render, Softpop convention), `Left`, `Right`, 📺 (internal id `rgba`; users see the 📺 emoji, never the text "RGBA"). Publishes the face plate via `nodeGraphPicturePublish` / `nodeGraphPicturePublishCanvas` in `public/lib/visual/picture-device.js`, like Spectrum Circle. Confirmed by Argi: 📺 = video out.

## Parameters (in order)
| Param | Range / default | Behavior |
|---|---|---|
| Frequency | 0-20000 Hz, default 440 | Sine pitch and noise band centre. Wired `f` replaces it. |
| Crossfade | 0-1, default 0 | 0 = pure sine, 1 = full noise at the widest band. |
| Amp over Crossfade | 0-1, default 0 | 0 = constant loudness across the crossfade; 1 = level falls to silence as Crossfade reaches 1. |
| Color | choice, default White | **White, Gaussian, Average, Pink, Brown, Blue, Violet** (Argi, 2026-10-16). Softpop's five colours plus new high-emphasis colours opposite pink/brown: **Blue** (+3 dB/oct) and **Violet** (+6 dB/oct, differentiated white). Persisted by name. Colour tilt correction so level stays flat across the keyboard, using the shared library tilt/level code (moved from Softpop Filter). |
| Seed | 0-16777215, default 1 | Master seed (required, Argi). |
| Amplitude | 0-1, default 1 | Required (Argi). App policy: spawn range 0-1. |

## DSP (per sample, per channel)
1. Sine `s = sin(2πφ)`, one phasor shared by L and R.
2. Noise: Color-shaped noise from `noise_colors.h` (Blue/Violet added to the shared header, approved by Argi 2026-10-16; existing colours bit-identical, with a regression test). Independent L/R generators via `seed_mix` offsets, through the constant-peak TPT SVF bandpass (`tpt_svf_setup_bandpass_const_peak`) centred on |f|.
3. Bandwidth driven by Crossfade (no extra knob): `Q = 2000·(0.5/2000)^Crossfade` (Softpop Filter's Width curve). Use the shared library `sin(w)/w` Q decramp, level gains and tilt correction (moved from `softpop_filter.cpp`), so noise RMS matches sine RMS at every Q, pitch and Color.
4. Equal-power crossfade: `x = cos(π/2·c)·s + sin(π/2·c)·n`.
5. Amp over Crossfade: `out = Amplitude · x · (1 − a·c)²` (squared, Argi 2026-10-16; ear check can confirm).
6. Stereo: sine identical in L/R, noise independent per channel, so the sound widens as it dissolves.
7. Safety: Nyquist clamp like Softpop, bandpass centre floor at about 1 Hz.

## Face
Reuse `softpopFace` (`public/modules/softpopOscillator/softpop-display.js`), WebGL, same display data from `softpop_core.h`. The 📺 output publishes that plate.

**Decision (Argi, 2026-10-17, Decision 7):** keep the sine line (fades as Crossfade rises) and add a noise band centred at the pitch whose width follows the Crossfade-driven Q. Band brightness rises with the crossfade noise gain (`sin(π/2·c)`) while the line fades (`cos(π/2·c)`); Amp over Crossfade (`(1 − a·c)²`) dims the whole picture. WebGL/shaders only (`gl-line-renderer.js`), using values the engine already computes (pitch, Q, crossfade gains, Amp over Crossfade); no re-simulation in the display.

**Publish call (to add):** `softpop-display.js` does not call `nodeGraphPicturePublish` / `nodeGraphPicturePublishCanvas` today, although Softpop Oscillator already lists an `rgba` output. Add the publish call after the face draws, the way Spectrogram (`spectrogram-display.js` L711-713) and RGB Shape (`rgb-shape-display.js` L198) call `nodeGraphPicturePublishCanvas(nodeId, canvas)`; this also fixes the existing Softpop outputs.

## Wiring checklist
- Definition in `public/node-graph-module-definitions.js`, store card in `node-graph-module-store.js` (category oscillator), bypass `"silence"` in `node-graph-module-bypass.js`.
- Library (approved): Blue/Violet in `noise_colors.h` with a regression test that existing colours are bit-identical; tilt/level/decramp moved from `softpop_filter.cpp` into the library, with a test that Softpop Filter output is bit-identical before/after.
- Blue/Violet in existing modules: append to the Color choices of Softpop Oscillator, Softpop Filter (`node-graph-module-definitions.js`, native colour enums, `kFilterGain` / `kTiltAlpha` entries) and Noise Generator. Regression test: every existing colour renders bit-identical in all three modules; old patches load the same colour.
- `native-modules-catalog.json` entry, `scripts/build_native_modules.ps1`, rebuild `graph_engine` + `combined/soemdsp_combined.wasm`.
- Smoke test: renders; Crossfade 0 = pure sine (THD near 0); Crossfade 1 with Amp over Crossfade 0 keeps sine RMS within about 0.5 dB for each Color; Amp over Crossfade 1 at Crossfade 1 = silent; Reset gives exact repeat.
- Demo patch `patches/livedemos/softpop2.json` with an LFO or envelope on Crossfade.
- Policies: modulation clamps to slider range; port labels Mono/Left/Right; video out shown as 📺 (id `rgba`).

## Still open
- ~~Curve of Amp over Crossfade (linear vs squared).~~ **Resolved (Argi, 2026-10-16):** squared `(1 − a·c)²` (Decision 6); ear check can confirm.
- ~~Whether Blue/Violet go into shared `noise_colors.h` or stay module-local.~~ **Resolved (Argi, 2026-10-16):** shared `noise_colors.h`, existing colours bit-identical, regression test.
- ~~Whether the face needs any change to show the crossfade/dispersion.~~ **Resolved (Argi, 2026-10-17):** see Face (Decision 7).
- ~~Whether Softpop Oscillator / Softpop Filter / Noise Generator also expose Blue/Violet.~~ **Resolved (Argi, 2026-10-16):** yes, appended to their choice lists; existing colours bit-identical (Decision 5).

## Policy check (Grok Bot, 2026-10-16)

Checked against `docs/APP_POLICY.md`, known Argi policies, and the current code.

**Referenced paths: all exist.** `native_modules/softpop_oscillator/softpop_core.h`; `library/include/soemdsp/filter/tpt_svf.h` with `tpt_svf_setup_bandpass_const_peak(TptSvfCoeffs&, double omega, double q)` (L62); `library/include/soemdsp/math/noise_colors.h`; `library/include/soemdsp/math/seed.h` with `seed_mix(seed, component, index)` (L33); `public/lib/visual/picture-device.js` with `nodeGraphPicturePublish` (L115, exported L289); `public/modules/softpopOscillator/softpop-display.js` (`softpopFace`); `public/node-graph-module-definitions.js`, `public/node-graph-module-store.js`, `public/node-graph-module-bypass.js`, `public/native-modules-catalog.json`, `scripts/build_native_modules.ps1`; `patches/livedemos/`. New (expected not to exist yet): `native_modules/softpop2/`.

**Complies:**
- No JS DSP: native C++ only (APP_POLICY L38, L244, L254-256, L283).
- Amplitude spawns 0-1 (Argi policy): Amplitude 0-1, default 1.
- Port labels: bare `Mono` / `Left` / `Right` are OK; any paired port would use the `<name> L/R` form (Argi policy).
- Modulation clamped to slider range (Argi policy; APP_POLICY L622: a cable is an offset inside the parameter range and is clamped there unless "Use real mod values" is on).
- Displays WebGL only (APP_POLICY §3): `softpopFace` is verified WebGL. `softpop-display.js` header (L13) says WebGL via the shared `gl-line-renderer.js`; it draws through `nodeGraphGlLinesBegin` / `Rect` / `End`, has no `getContext("2d")`, and is listed as WebGL in `docs/WEBGL_DISPLAY_PLAN.md` section 2 (L27).
- Shared maths from `library/include/soemdsp` instead of copies (APP_POLICY L631).
- Fixed parameter set; full-word labels (APP_POLICY L406: no cryptic abbreviations).
- Frequency 0-20000 Hz matches Softpop Oscillator's slider (0-20 kHz, wired `f` replaces it). A 0 Hz knob floor is fine there, with the plan's ~1 Hz bandpass centre floor as the DSP guard.

**Library edits (APP_POLICY L599, L637-639): approved by Argi 2026-10-16.**
- Blue/Violet in `noise_colors.h` (today it has only white / pink / brown; modes Uniform, Gaussian, Brown, Pink, Sparse). Existing colours bit-identical, regression test.
- Tilt/level/decramp moved from `softpop_filter.cpp` into the library; Softpop Filter output bit-identical.

**Findings (resolved 2026-10-16 unless noted):**
- ~~Softpop's Color choices are White / Gaussian / Average / Pink / Brown, not just White / Pink / Brown.~~ **Resolved:** Softpop2 keeps all five plus Blue, Violet.
- ~~Tilt correction and level gains live in `softpop_filter.cpp`, not `softpop_core.h`.~~ **Resolved:** moved into the shared library (approved); Softpop Filter output bit-identical. Still to do: Blue/Violet need new measured gain/tilt constants (`kFilterGain` / `kTiltAlpha` entries).
- ~~📺 publish: `softpop-display.js` has no publish call.~~ **Resolved as plan:** add `nodeGraphPicturePublishCanvas` after the face draws (see Face).
- "Like Spectrum Circle": Spectrum Circle is type `videoFeedback` (`public/modules/videoFeedback/video-feedback-register.js`); its 📺 out feeds Video Delay. (Info only.)
- ~~Port label case `RGBA` vs `rgba`.~~ **Resolved:** internal id `rgba`, users see 📺 only (APP_POLICY §11).

**Side observations (no fix in this plan):**
- `softpopFilter` has no entry in `public/node-graph-module-bypass.js` (only `softpopOscillator: "silence"`, L147).
- `softpop_filter` has no entry in `scripts/build_native_modules.ps1` (only `softpop_oscillator`, L213), though it is in `native-modules-catalog.json` and `native_modules/softpop_filter/` exists.
