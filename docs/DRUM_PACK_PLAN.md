# Drum Pack: plan for the remaining Electro drum modules

**Status:** planned, not started. All open questions resolved (2026-10-19); ready to build.
**Date:** 2026-10-19.
**Requested by:** Argi, via SandyModules (Hat, Toms and every module from the original drum plan, planned now).
**Owner:** SandyModules (Sandbox build agent), unless Argi says otherwise.
**Parent docs:** `docs/SNARE_PLAN.md` (Electro Snare plan, 2026-10-06, with the Electro Hat and Electro Tom seeds); `docs/KICK_PLAN.md` (Kick = Robin Sinepulse, plus the Electro Kick seed); `docs/FUTURE_PLANNING.md` (drum pointers).
**Related:** `docs/APP_POLICY.md` (native-only DSP §2 / §5, no legacy helpers §1, shared library maths and Architect gate §19, a stored 0 is a value §18, Choice / enum persistence, unused code removed §10b); `docs/GATES_TRIGGERS.md`; `docs/PORT_TYPES.md`; `docs/ADDING_HARDCODED_SANDBOX_MODULE.md`.

---

## 1. Scope

### Already exists (not in this plan)

| Module | Key / type | Notes |
|--------|------------|-------|
| Electro Snare | `electroSnare`, type 222 | Done. Algorithms 808 / 909 / Simmons / Modal / FM. Stereo **Snare L / Snare R** + **Env**. Per-channel noise seeds; clean tonal body identical L/R. **This is the template** (`native_modules/electro_snare/electro_snare.cpp`). |
| Kick (SweepKicker) | `robinSinepulse`, type 205 | Built. `docs/KICK_PLAN.md`. |
| Flat Zapper | `robinSinepulseAllpass`, type 206 | Built. `docs/KICK_PLAN.md`. |

### Planned here (every drum module seeded in the original drum docs)

| # | Module | Proposed key | Seed |
|---|--------|--------------|------|
| 1 | **Electro Hat** | `electroHat` (replaces the parked placeholder card) | `docs/SNARE_PLAN.md` §Electro Hat |
| 2 | **Electro Tom** | `electroTom` (new key) | `docs/SNARE_PLAN.md` §Electro Tom |
| 3 | **Electro Kick** | `electroKick` (key freed in C-002) | `docs/KICK_PLAN.md` §Electro Kick. Argi decided 2026-10-06 that it is separate from Kick (SweepKicker): "our common kick algorithms, the classic machines". |

Electro Clap was added later (2026-10-19, §5b). No other drum module is seeded. Clap (now §5b), cymbal, rimshot, cowbell and so on appear only as side facts in the Hat seed (the 808 cymbal / cowbell share the six-oscillator bank). They are listed as **suggestions** in §7 and are not part of the milestones.

---

## 2. Shared rules (all modules, same as Electro Snare)

1. **Native C++/WASM DSP only, sample-accurate.** Trigger / Reset detected per sample in `graph_engine` with `gate_hit`. No JS DSP, no JS twin, no worklet special case, no "temporary" evaluator. Missing native = silence.
2. **No legacy helpers, no shims.** No aliases, dual keys, or migrations from any placeholder's old params / ports. The `electroHat` placeholder (ports and params) is replaced outright; its store / catalog / under-construction entries are removed in the same change (APP_POLICY §10b).
3. **Library edits need Argi's approval** (APP_POLICY §19). **Q1 approved by Argi (2026-10-19):** `ring2`, the hash noise counter and a PolyBLEP square move from `electro_snare.cpp` into `library/include/soemdsp` (DP-1), and every drum module uses them. Electro Snare must stay bit-exact. Copying kernels between modules' `.cpp` files is still not allowed. Any other library edit still needs Argi's approval.
4. **One fixed shared parameter set per module.** Each algorithm interprets every param (no dead knobs). Nothing is added, removed, shown or hidden per algorithm. Switching algorithm never rewrites values (§18).
5. **Algorithm is a Choice stored by stable name** (`choiceKeys`), with `choiceIds` only as the native wire format, resolved key → id in one place in the native param sync. `linearSmoothing: false`.
6. **Full-word labels.** Closed Decay, Open Decay, Body Decay, Bend Time, Amplitude; never abbreviations.
7. **Amplitude 0–1, default 1, spawns in 0–1.** Modulation of every param is clamped to its slider range.
8. **T60 everywhere** for time params: `r = exp(−ln(1000) / (T60 · sr))`. Tooltips say "seconds to −60 dB".
9. **Hit model** (identical to Electro Snare): Trigger latches `v = |height|` (height is velocity, no Accent jack). Reset (height ignored) rewinds every phase, resonator, filter and envelope, reseeds noise, and re-strikes at the last latched `v` (silent before the first Trigger). Same sample: Reset first, then Trigger. Retrigger rule per algorithm (resonators add onto the ring; oscillators phase-reset).
10. **Ports.** Inputs `Trigger` (stamp trigger glyph, white round `digital`) and `Reset`. Audio outputs named **"&lt;name&gt; L"** / **"&lt;name&gt; R"**, then **Env**. No mono output.
11. **Stereo rule** (Argi 2026-10-19, from Electro Snare): everything noise-like is decorrelated per channel (own seed, own filter state; L keeps the base seed); the clean tonal part is identical L/R. Click transients are one shared click, identical L/R. Reset reseeds both channels (bit-exact restart).
12. **Env** = overall amplitude envelope: mix-weighted sum of the component envelope scalars, peaks at `v` on the hit sample, excludes Amplitude, unipolar, mono, Planck-clean (snaps to exact 0 below `kPlanck`).
13. **Face:** the existing `lineBurn` display on the L output (as Electro Snare). Displays are WebGL2 only; anything custom is a WebUI follow-up.
14. **Store category** `drum`, `planRole: "source"`, `planFreeRun: true`, bypass `silence`.
15. **Native type ids:** next free ids in `NATIVE_GRAPH_TYPE_IDS` at build time (222 is the highest seen on 2026-10-19). Check again before picking; other agents have uncommitted engine work.

---

## 3. Electro Hat (`electroHat`)

One hi-hat voice, stereo from the start, closed / open / choke in one module.

### I/O

| Port | Kind | Meaning |
|------|------|---------|
| `Trigger` (label **Closed**) | in, trigger | Closed hit. Chokes a ringing open hat |
| `Open` | in, trigger | Open hit |
| `Reset` | in, reset | Rewind and re-strike the current hit (closed or open, whichever was last) |
| `Hat L`, `Hat R` | out, audio | Stereo hat |
| `Env` | out | Overall amplitude envelope |

Proposed: two trigger jacks (seed default). Alternative in Q4.

### Choke model (one voice)

- **Open** hit: VCA envelope restarts at `v` and decays with **Open Decay**.
- **Closed** hit: VCA envelope restarts at `v` with **Closed Decay**. If an open hat is ringing, the closed hit replaces it (choke) – 808 / 606 behaviour, and the 909 shares one circuit.
- Choke is not an instant cut: the ringing envelope jumps from its current level to the new hit's attack within a fixed ~1 ms declick ramp (by ear), so no clicks.
- **Closed and Open on the same sample:** Closed wins (proposed, Q5).
- The metal oscillator bank never resets on a hit (free-running, like the hardware squares); only envelopes and filters restart. Reset does rewind the oscillator phases (to a fixed spread) for bit-exact repeats.

### Shared params

| Key | Label | Range | Default | Unit | Generic meaning |
|-----|-------|-------|---------|------|-----------------|
| `algorithm` | Algorithm | `tr808` / `tr606` / `fm` / `noise` | `tr808` | choice | Hat design |
| `tune` | Tune | 0.25–4 | 1 | × (ratio, log slider) | Metal pitch scale; 1 = stock frequencies. On `noise`, scales the filter |
| `tone` | Tone | 0–1 | 0.5 | – | Brightness: band-pass / high-pass position |
| `closedDecay` | Closed Decay | 0.005–0.5 | 0.05 | s (T60) | Closed hit decay |
| `openDecay` | Open Decay | 0.05–4 | 0.5 | s (T60) | Open hit decay |
| `metal` | Metal | 0–1 | 1 | – | Metallic source ↔ white noise; 1 = all metal (808 / 606 stock) |
| `amplitude` | Amplitude | 0–1 | 1 | – | Output level |

No width knob (Argi, Q6 resolved 2026-10-19). Stereo comes only from per-channel noise. A separate Stereo module is seeded in `docs/FUTURE_PLANNING.md`.

### Algorithms

| Key | Label | Design | Param reading |
|-----|-------|--------|---------------|
| `tr808` | 808 | Six band-limited (PolyBLEP) ≈48 % duty squares at 205.3, 304.4, 369.6, 522.7, 540, 800 Hz × Tune, summed → band-pass ≈7100 Hz (hat band; the 3440 Hz band is the cymbal's) → high-pass → VCA | Tune scales all six; Tone moves the band-pass / high-pass together (±1 oct around stock); Metal crossfades squares with white noise |
| `tr606` | 606 | Same six-square bank, 606 tuning (by ear; unit-varying), high band → resonant high-pass → VCA, no noise at stock | As 808, with a resonant high-pass |
| `fm` | FM | Metallic FM / ring-mod: inharmonic pulse pairs, ring-modulated, high-passed (Gordon Reid SOS patches) | Tune scales operators; Tone = modulation index + high-pass; Metal = metal vs noise |
| `noise` | Noise | White noise → band-pass → high-pass → VCA | Tune scales the filter centre (stock 8 kHz); Tone = band-pass Q / high-pass; Metal = band-passed noise ↔ raw noise (keeps the knob live) |

**909 is skipped** (Argi, Q7 resolved: 909 hats are 6-bit ROM samples; synthesis cannot reproduce them, and sample playback would need Roland's data).

### Stereo

- **Noise parts** (white noise in every algorithm): own seed and filter state per channel, as Electro Snare.
- **Metal bank:** identical L/R (same frequencies and phases). No width knob; stereo comes only from the per-channel noise (Q6 resolved).
- Envelopes, choke and Env are shared (mono).

### Env

`Env = VCA envelope` (open or closed), peaks at `v`. One envelope per voice, so no mix weighting needed.

---

## 4. Electro Tom (`electroTom`)

One tom voice. Low / mid / high is a free Tune, not three modules (Q9).

### I/O

`Trigger`, `Reset` in; **`Tom L`**, **`Tom R`**, **`Env`** out.

### Shared params (Argi's seed list; Tune and Bend primary, first and largest on the card)

| Key | Label | Range | Default | Unit | Generic meaning |
|-----|-------|-------|---------|------|-----------------|
| `algorithm` | Algorithm | `tr808` / `tr909` / `simmons` | `tr808` | choice | Tom design |
| `tune` | Tune | 40–400 | 135 | Hz (`kind: "frequency"`) | Rest pitch (808 mid tom ≈135) |
| `bend` | Bend | 0–4 | 0.25 | oct | Pitch drop at the hit (starts above Tune, falls back) |
| `tone` | Tone | 0–1 | 0.5 | – | Timbre, per algorithm |
| `bodyDecay` | Body Decay | 0.02–3 | 0.2 | s (T60) | Body ring |
| `noise` | Noise | 0–1 | 0.2 | – | Attack noise amount (noise envelope is a fixed per-algorithm constant) |
| `amplitude` | Amplitude | 0–1 | 1 | – | Output level |

### Algorithms

| Key | Label | Design | Param reading |
|-----|-------|--------|---------------|
| `tr808` | 808 | Pinged 2-pole resonator with amplitude-dependent pitch drop ("tonk"), plus a little low-passed pink noise on a slightly longer envelope. Retrigger adds onto the ring | Tune = resonator Hz; Bend = small drop tied to the decaying amplitude (stock ≈ a few semitones); Body Decay = ring T60; Tone = noise lowpass; Noise = pink-noise level |
| `tr909` | 909 | Three phase-reset triangle VCOs (fixed ratios by ear), each soft-clipped toward sine; ENV-4 sweeps all three; tom noise mixed into the attack | Tune = base Hz; Bend = ENV-4 depth (fixed ~ by-ear bend time); Body Decay = VCA decays; Tone = VCO-1 clipper hardness (square → sine); Noise = tom-noise level |
| `simmons` | Simmons | SDS-V: sine with a big downward bend over 0.5 × Body Decay, noise through a resonant lowpass, shared VCA, click | Tune = tone pitch; Bend = big drop (1–2 oct suggested); Body Decay = VCA T60; Tone = noise filter cutoff; Noise = noise level |

### Stereo

Tonal body identical L/R; noise per-channel seeds and filters; click shared. Tone 0 / Noise 0 gives bit-identical L and R.

### Env

`Env = (eBody + noise · eNoise) / (1 + noise)`, peaks at `v`.

---

## 5. Electro Kick (`electroKick`)

Separate from Kick (SweepKicker). The classic machines.

### I/O

`Trigger`, `Reset` in; **`Kick L`**, **`Kick R`**, **`Env`** out.

### Shared params (seed list)

| Key | Label | Range | Default | Unit | Generic meaning |
|-----|-------|-------|---------|------|-----------------|
| `algorithm` | Algorithm | `tr808` / `tr909` / `simmons` | `tr808` | choice | Kick design |
| `tune` | Tune | 30–200 | 52 | Hz | Rest pitch (808 ≈49–56) |
| `bend` | Bend | 0–4 | 1.5 | oct | Pitch above Tune at the hit |
| `bendTime` | Bend Time | 0.001–0.3 | 0.005 | s (T60) | How fast the pitch falls |
| `decay` | Decay | 0.05–4 | 0.6 | s (T60) | Body decay |
| `click` | Click | 0–1 | 0.3 | – | Attack transient level |
| `tone` | Tone | 0–1 | 0.5 | – | Timbre, per algorithm |
| `amplitude` | Amplitude | 0–1 | 1 | – | Output level |

### Algorithms

| Key | Label | Design | Param reading |
|-----|-------|--------|---------------|
| `tr808` | 808 | Pinged 2-pole resonator (bridged-T stand-in), short attack frequency jump, slow downward "sigh" (fixed) | Tune = resonator Hz; Bend / Bend Time = attack jump (stock ≈1.5 oct, ≈5 ms); Decay = ring T60; Click = trigger-pulse level; Tone = output lowpass |
| `tr909` | 909 | Phase-reset triangle VCO soft-clipped toward sine, pitch envelope, pulse + low-passed noise attack | Tune = rest Hz; Bend = sweep depth; Bend Time = ENV-3 (909 panel Tune); Decay = ENV-1; Click = 909 Attack; Tone = clipper drive (sine → square) |
| `simmons` | Simmons | Oscillator with bend, filtered noise, click | Tune = tone pitch; Bend / Bend Time = bend; Decay = VCA; Click = click; Tone = noise ↔ tone balance |

### Stereo

Kick body is identical L/R (keeps the low end mono). Only the 909 attack noise and Simmons noise are per-channel decorrelated. The pulse click is shared.

### Env

`Env = (eBody + click · eClick) / (1 + click)`, peaks at `v`.

---

## 5b. Electro Clap (`electroClap`)

Added 2026-10-19 (Argi: "we forgot a clap module"). One hand-clap voice, stereo. Type id: next free at build time (226).

### I/O

`Trigger`, `Reset` in; **`Clap L`**, **`Clap R`**, **`Env`** out.

### Shared params

| Key | Label | Range | Default | Unit | Generic meaning |
|-----|-------|-------|---------|------|-----------------|
| `algorithm` | Algorithm | `tr808` / `tr909` / `simple` | `tr808` | choice | Clap design |
| `tone` | Tone | 0–1 | 0.5 | – | Band-pass centre, one octave down (0) / up (1) from stock, level-compensated (1/√shift) |
| `spread` | Spread | 0–1 | 0.5 | – | Burst spacing 5–20 ms (exponential; stock ≈10 ms 808 / ≈11 ms 909 at 0.5). Simple: length of its one burst on the same scale |
| `decay` | Decay | 0.05–2 | 0.3 | s (T60) | Tail ("reverb") decay |
| `snappy` | Snappy | 0–1 | 0.6 | – | Burst vs tail mix (0 tail only, 1 bursts only) |
| `amplitude` | Amplitude | 0–1 | 1 | – | Output level |

Burst count is fixed per algorithm (no knob): 808 / 909 = 4 (three sawtooth bursts, T60 = 3 × spacing, then a longer last one, T60 = 6 × spacing), Simple = 1.

### Algorithms

| Key | Label | Design | Source |
|-----|-------|--------|--------|
| `tr808` | 808 | White noise → one band-pass ≈1 kHz feeding two VCAs: a sawtooth Burst envelope retriggered four times ≈10 ms apart, and a decay-only Tail envelope | TR-808 service notes; Baratatronix 808 clap outline |
| `tr909` | 909 | Same burst train (≈11 ms) on a 1140 Hz, Q ≈1.95 band-pass; the tail runs on its own brighter, wider band (≈2.4 kHz, by ear) | network-909 hand clap notes (808-derived circuit); KVR schematic analysis (1140 Hz / Q 1.95) |
| `simple` | Simple | One noise burst (no retrigger train) + tail through one ≈1.2 kHz band-pass: the common single-burst synth clap | Generic subtractive patch; LinnDrum / later machines are samples, so not modelled |

Mix: `out = snappy · eBurst · burst + (1 − snappy) · eTail · tail`.

### Stereo

No width knob. Envelopes are computed once (shared); only the white noise is per channel (own seed, own filter state; L keeps the base seed). So L ≠ R always.

### Env

`Env = snappy · eBurst + (1 − snappy) · eTail`, peaks at `v` on the hit sample, excludes Amplitude, exact 0 at rest. Retrigger restarts both envelopes at the new `v` (the sawtooth edge is the clap attack).

### Tests

Shared smoke list (§6) plus: L ≠ R; block sizes 1 / 64 / 128 identical; `scripts/smoke_graph_electro_clap.mjs`.

---

## 6. Milestones and tracker

Build order: helpers decision → Hat → Tom → Kick (Hat first because it has a placeholder card to replace and the most new design). Each module milestone follows the Electro Snare build checklist (`docs/SNARE_PLAN.md` §Build checklist): native `.cpp` with `create / destroy / sample / right / env / version / metadata_json`, fixed 64-instance pool, no heap on the audio path; `scripts/build_native_modules.ps1`; `graph_engine` opcode with per-sample `gate_hit`; `NATIVE_GRAPH_TYPE_IDS` and the param push in `public/node-live-audio-worklet-native-graph.js`; definitions, labels, bypass, store entry, `public/native-modules-catalog.json`, APP_POLICY live-audio allowlist; tooltips with per-algorithm meanings.

| ID | Milestone | Status | Notes |
|----|-----------|--------|-------|
| DP-1 | Shared helpers (Q1, **approved by Argi 2026-10-19**) | not started | Electro Snare must stay bit-exact: `ring2`, hash noise and PolyBLEP square promoted to `library/include/soemdsp` with Electro Snare refactored onto them under a bit-identical regression (Snare L/R / Env sample-equal before and after) |
| DP-2 | Electro Hat native module + engine opcode (all four algorithms, choke, stereo) | not started | Type id: next free |
| DP-3 | Electro Hat JS definitions / store / catalog; remove the `electroHat` placeholder card everywhere (under-construction lists, notes, label "ElectroHat" → "Electro Hat") | not started | No alias, no migration |
| DP-4 | Electro Hat smoke + Live-path test | not started | See tests |
| DP-5 | Electro Tom native + opcode + JS (three algorithms) | not started | |
| DP-6 | Electro Tom smoke + Live-path test | not started | |
| DP-7 | Electro Kick native + opcode + JS (three algorithms) | not started | |
| DP-8 | Electro Kick smoke + Live-path test | not started | |
| DP-9 | Drum pack parity and docs: cross-module parity checks, store shelf order (Kick, Electro Kick, Electro Snare, Electro Tom, Electro Hat), WAV renders for Argi's listening test, status updates here / `progress.md` / `docs/FUTURE_PLANNING.md` after Argi tests | not started | |

### Smoke tests (per module, every algorithm; native smoke script + `scripts/smoke_test.py` export list, modelled on `scripts/smoke_graph_electro_snare.mjs`)

1. Silent before Trigger; a hit sounds on both L and R.
2. Every shared param changes the output (no dead knobs), per algorithm.
3. Env peaks at `v` on the hit sample (within 1e-6) and reaches exact 0.
4. Reset mid-hit restarts the hit; with noise reseeded, the repeat is bit-exact.
5. Reset before the first Trigger is silent. Reset + Trigger on one sample = Trigger height wins.
6. Algorithm choice survives save / load by name (`choiceKeys`).
7. No NaN, Inf or denormals at range extremes (all params min / max, Tune max near Nyquist).
8. Amplitude 0 gives exact silence on L/R while Env still moves; Amplitude spawns at 1 within 0–1.
9. Sample accuracy: a Trigger at sample n produces the first non-zero output at sample n (block-boundary independence: same output for block sizes 1, 64, 128).
10. Real Live path tested, not only Render Sample.

**Hat-specific:** Closed after Open chokes (Env drops to Closed-Decay curve within the declick ramp, no click above a threshold); Closed + Open same sample follows Q5; Metal 1 (no noise) gives L == R bit-exact; Metal 0 vs 1 changes spectrum; PolyBLEP squares show no aliasing spurs above a set level at Tune 4.

**Tom / Kick-specific:** Noise 0 (Tom) / Click 0 and Tone 0 (Kick) give L == R bit-exact; Bend 0 gives a constant pitch (zero-crossing period check).

### Parity tests (DP-9)

- **Template parity:** Electro Snare outputs unchanged (bit-exact against a stored render) after any shared-helper change.
- **Stereo law parity:** in every drum module, L-only seeds match the module's base seed, and with all noise-like params at 0, L == R.
- **Env parity:** all four Electro modules' Env peaks at `v`, excludes Amplitude, and goes Planck-clean, the same way.
- **Reference ballpark:** 808 Hat closed decay ≈50 ms at defaults, 808 tom defaults near 135 Hz / 130 ms, 808 kick ≈52 Hz with ≈5 ms jump (spectral peak checks, tolerance by ear).

---

## 7. Suggestions (not seeded; not planned, listed for Argi only)

- **Electro Cymbal** – the 808 cymbal uses the same six-square bank through the 3440 Hz band too (Werner, Abel, Smith 2014). Could be a Hat algorithm or its own module.
- **Electro Cowbell** – 808 cowbell = two of the same squares (≈540 / 800 Hz) through a band-pass.
- **Electro Clap** – 808/909 style multi-burst filtered noise.
- **Rimshot / Claves** – short pinged resonators.
- **Hat isIdle output** for Metamodule voice idle (kept out, as on Electro Snare).

---

## 8. Open questions

All questions are resolved. The plan is ready to build.

**Resolved (Argi, 2026-10-19):**

1. Shared helpers: **approved.** `ring2`, the hash noise counter and a PolyBLEP square move to `library/include/soemdsp`. Electro Snare is refactored onto them and must stay bit-exact (Snare L/R and Env sample-equal before and after).
2. Build order: Hat → Tom → Kick.
3. Electro Kick is in this pack, built last.
4. Hat triggers: two jacks (Closed `Trigger` + `Open`).
5. Hat Closed + Open on the same sample: Closed wins.
6. Hat stereo: **no Stereo Spread knob**; stereo only from per-channel noise, metal bank identical L/R. A separate Stereo module is seeded in `docs/FUTURE_PLANNING.md`.
7. 909 hat: skipped.
8. 606 frequencies: picked by ear at build.
9. Tom: one free Tune (40–400 Hz, default 135), no low / mid / high presets.
10. Tom bend time: fixed per algorithm (808 / 909); 0.5 × Body Decay on Simmons.
11. Kick Bend Time: a shared param.
12. Kick stereo: body identical L/R, only noise decorrelated.
13. Velocity: Amplitude only, `|height|`, no accent extras.
14. Env: overall amplitude envelope, excludes Amplitude, for all modules.
15. Default algorithm: `tr808` for all three.
16. Hat Closed jack shows "Closed"; port key stays `Trigger`.

---

## 9. Non-goals

- JS DSP, JS twins, worklet special cases
- Per-algorithm params
- Sample playback (909 hats / cymbals)
- Accent / Velocity jacks, cross-module choke groups, polyphony inside one module
- Custom faces beyond `lineBurn`
- Aliases or migrations from placeholders
- Library edits without Argi's approval
