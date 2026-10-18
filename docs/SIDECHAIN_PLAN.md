# Sidechain Plan: sidechain ducking helper built on the Pump Limiter

**Status:** built 2026-10-14 (type id 216, committed and pushed (checked 2026-10-18)). Awaiting Argi's ear check (S6). Defaults chosen are in §11.
**Owner once approved:** SandyModules (DSP), WebUI (face).
**Module type (proposed):** `sidechain`, label "Sidechain", category `dynamics`.

## 1. Argi's spec (fixed)

| | |
|---|---|
| Inputs | Dry L, Dry R, Wet L, Wet R, Sidechain, Envelope |
| Outputs | Left, Right |
| Params | Threshold, Ratio, Attack Time, Hold Time, Release Time |

The I/O and the param set are exactly these. Anything extra appears only as an open question (§9).

## 2. Pump Limiter findings (what exists, 2026-10-14)

**Definition:** `public/node-graph-module-definitions.js` ~L13900, type `limiter`, label "Pump Limiter".
- Inputs: `In` (Mono), `Left`, `Right`, `Sidechain` (labelled SC; aliases `SC`, `Key`).
- Outputs: `Out` (Mono), `Left`, `Right`, `Gain` (instant GR multiplier, 1 = no GR), `Env` (detector envelope, clamped to 0..1).
- Face: waterfall of Gain.

| Param | Range / default |
|---|---|
| Input Gain | −24…24 dB, 0 |
| Threshold | −48…0 dB, −18 |
| Ratio | 1…20 :1, 8 (clamped ≤ 100 in C++) |
| Look-ahead | Off/On, On |
| LA Time | 0…50 ms, 5 |
| LA Samples (hidden) | 0…16384 |
| Attack | 0…100 ms, 5 |
| Release | 20…2000 ms, 250 |
| Amplitude | 0…1, 1 |

**Native:** `native_modules/pumping_limiter/pumping_limiter.cpp`. The graph engine calls it through `soemdsp_pumping_limiter_sample(handle, left, right, sidechain, hasSidechain, inputGainDb, thresholdDb, ratio, lookaheadMs, lookaheadSamples, attackMs, releaseMs, sampleRate, lookaheadEnabled, amplitude)` plus the `_left/_right/_gain/_env` getters.

Per-sample algorithm:
1. **Detector:**
   - `peak = hasSidechain ? |sc| : max(|L·inGain|, |R·inGain|)`.
   - Power `peak²` goes into a one-pole `meanSquare` with an attack coefficient when rising and a release coefficient when falling.
   - `env = √meanSquare`, an RMS-ish peak follower.
   - Coefficients: `att = attackMs ≤ 0 ? 1 : 1 − exp(−1/max(1, attMs·0.001·sr))` and `rel = 1 − exp(−1/max(1, relMs·0.001·sr))`, with relMs floored at 1.
2. **Gain computer:** hard knee. `target = env > T ? (T/env)^((R−1)/R) : 1`, with T = dB→amp(threshold) floored at 1e-6, clamped to 0..1.
3. **Gain smoother:** `gain` moves toward the target with the **same** attack coefficient (falling) and release coefficient (rising), so it is double-smoothed with the detector.
4. **Audio path:** look-ahead delay (float ring buffer, 16384 samples per channel), then × gain × amplitude. Stereo-linked: one gain for both channels.

Other facts:
- **No Hold logic exists** in Pump Limiter. Hold is new. The nearest hold pattern in the repo is Speaker Protector 2's `holdSamples` countdown state (`native_modules/speaker_protector2/speaker_protector2.cpp`).
- Instance pool: 16 instances, each with 2 × 16384-float delay buffers.

**Reuse options (Argi decides; a library move needs APP_POLICY §19 approval):**

| Option | How | Verdict |
|---|---|---|
| A. Call `soemdsp_pumping_limiter_sample` as-is | Feed Wet as L/R, set look-ahead Off, Input Gain 0, Amplitude 1, and read `_gain` | **Not enough.** No Hold, no Envelope bypass, it takes slots from Pump Limiter's 16-instance pool and its delay buffers, and adding Hold would change Pump Limiter itself. |
| B. **Shared library helper** (proposed, **needs Argi's §19 approval**) | Move detector, gain computer and gain smoother verbatim into `library/include/soemdsp/dynamics/pump_gain.h`: `PumpGainState {meanSquare, gain, holdLeft}`, `pump_coeffs(attMs, relMs, sr)`, `pump_detect(state, peak, coeffs)`, `pump_target_gain(env, thresholdDb, ratio)`, `pump_smooth_gain(state, target, coeffs, holdSamples)`. Refactor Pump Limiter onto it with holdSamples = 0, guarded by a bit-identical regression test (golden render before the move, as in the Softpop extraction). | Recommended: one code path, and Sidechain matches Pump Limiter by construction. |
| C. Module-local copy in `sidechain.cpp` | Copy the ~25 lines | No approval needed, but duplicated maths. Fallback if B is declined. |

## 3. Proposed behaviour (per sample)

```
Dry: dL, dR    Wet: wL, wR    (mono fallback, §4)

if Envelope wired:   e = clamp(Envelope, 0, 1)                    // external duck amount, unipolar
                     target = 1 − e                                // bypasses detector + Threshold/Ratio
else:
    peak = Sidechain wired ? |SC| : max(|dL|, |dR|)                // key: SC, else Dry (Q1)
    env  = pump_detect(peak)                                       // Pump Limiter detector
    target = pump_target_gain(env, Threshold, Ratio)               // Pump Limiter hard knee

g = pump_smooth_gain(target, Attack, Release, Hold)               // one gain, stereo-linked
Left  = dL + g · wL            Right = dR + g · wR                 // Output option O1 (default)
```

**Hold:** whenever the target gain is at or below the current gain (GR rising or steady), reset `holdLeft = Hold·sr`. While `holdLeft > 0` the gain may fall (attack) but not rise. Release starts only after the countdown reaches 0. With Hold = 0 it is bit-identical to Pump Limiter's smoother.

**Envelope input:** 0..1 unipolar, the sandbox's usual CV range, clamped. It is the *duck amount*: 1 = Wet fully ducked, 0 = no duck. Attack/Hold/Release still smooth it (set them to 0 for raw). Threshold and Ratio are ignored while it is wired. Alternatives are in Q3/Q4.

**What gets ducked:** only Wet. Dry always passes at unity.

**Output options (Q2):**

| | Formula | Use |
|---|---|---|
| **O1 (proposed default): Dry + ducked Wet** | `out = dry + g·wet` | Send/return style: a reverb or delay ducks under the dry signal or a kick. Dry is never touched. |
| O2: Crossfade | `out = g·wet + (1 − g)·dry` | Wet and dry trade places: when ducking, the Dry takes over. Classic "dry on hits, wet in gaps". Equal-gain linear; an equal-power variant is possible. |

**No look-ahead, no Input Gain, no Amplitude:** they're not in the spec, so latency is 0. Listed as a question.

**Times:**
- Attack: 0–100 ms, default 5 (= Pump Limiter).
- Hold: 0–2000 ms, default 0 (new; range proposed).
- Release: 20–2000 ms, default 250 (= Pump Limiter).
- Threshold: −48…0 dB, default −18; Ratio 1…20 :1, default 8 (= Pump Limiter).

## 4. Unwired inputs
- **Sidechain unwired:** the detector keys from **Dry** (proposed; max of |Left Dry|, |Right Dry|). Alternative: key from Wet, i.e. self-compressing (Q1).
- **Envelope unwired:** use the detector. Wired: it bypasses the detector (wiring wins over Sidechain).
- **Mono fallback per pair:** only Left wired → Right = Left; only Right wired → Left = Right. Applied separately to the Dry pair and the Wet pair.
- **Dry unwired:** dry = 0, so the output is just the ducked Wet. If the detector is keyed from Dry and there is no SC, there is no GR (g = 1).
- **Wet unwired:** wet = 0, so the output = Dry.
- **Nothing wired:** silence.

## 5. Parameters (fixed set, exactly the spec)

| Key | Label | Range | Default | Unit |
|---|---|---|---|---|
| `threshold` | Threshold | −48…0 | −18 | dB |
| `ratio` | Ratio | 1…20 | 8 | :1 |
| `attack` | Attack Time | 0…100 | 5 | ms |
| `hold` | Hold Time | 0…2000 | 0 | ms |
| `release` | Release Time | 20…2000 | 250 | ms |

There are no choice params in the spec. If Q1 or Q2 become user choices, they'd be added as choices stored by stable name (e.g. `detectFrom: dry|wet`, `mix: add|crossfade`), which needs Argi's OK to extend the fixed set.

## 6. I/O (exactly the spec)

| Dir | Key | Label | Notes |
|---|---|---|---|
| In | `Dry L` | Dry L | |
| In | `Dry R` | Dry R | |
| In | `Wet L` | Wet L | |
| In | `Wet R` | Wet R | |
| In | `Sidechain` | Sidechain | Aliases `SC`, `Key` (as on Pump Limiter) |
| In | `Envelope` | Envelope | 0..1 duck amount; alias `Env` |
| Out | `Left` | Left | |
| Out | `Right` | Right | |

Face (WebUI, proposed): a Gain waterfall like Pump Limiter's, fed by an internal display tap, not a jack.

## 7. Rules
- Native C++/wasm only (`native_modules/sidechain/sidechain.cpp`). No JS DSP.
- Fixed param set. No shims. Choices stored by name.
- A library change (option B) only with Argi's §19 approval.
- Simple maths: one-pole detector + hard knee + hold countdown.

## 8. Tests
1. **Pump Limiter parity:** with Hold 0, no Envelope, the same key and Threshold/Ratio/Attack/Release, Sidechain's `g` equals Pump Limiter's `_gain` sample-for-sample (bit-identical under option B) vs Pump Limiter with LA Off, Input Gain 0, Amp 1.
2. **Library regression (option B only):** Pump Limiter output is byte-identical before and after the move (golden capture first).
3. **Static curve:** a steady sine at L dB above Threshold settles to GR = L·(1 − 1/R) dB (±0.1 dB).
4. **Hold:** after a burst ends, `g` stays within 0.01 dB of its minimum for Hold ms (±1 sample), then releases. Hold 0 → immediate release.
5. **Attack / Release:** time constants match Pump Limiter (63 % step response within ±2 %).
6. **Envelope bypass:**
   - Envelope wired → output independent of Sidechain, Dry level and Threshold/Ratio.
   - Envelope = 0 → g = 1; Envelope = 1 → g → 0; Envelope = 0.5 (times 0) → g = 0.5.
   - Out-of-range values are clamped.
7. **Output formula:** O1 → Dry passes bit-exact when Wet is unwired; with g = 1, out = dry + wet exactly. (O2 if chosen: g = 1 → wet, g = 0 → dry.)
8. **Unwired / mono fallback:** every combination in §4, including Left-only pairs giving L == R.
9. **Stereo link:** a hit on one channel ducks both equally.
10. **Safety:** NaN/Inf on any input → finite output; 0 latency (impulse on Dry appears at sample 0).

## 9. Open questions
1. **Detector source without Sidechain:** Dry (proposed; ducks Wet under the dry signal) or Wet (self-ducking)?
2. **Output:** O1 Dry + ducked Wet (proposed) or O2 dry/wet crossfade (linear or equal-power)?
3. **Envelope scaling:** 0..1 = duck amount, g = 1 − e (proposed), or e = gain (1 = full wet)?
4. **Envelope routing:** bypass detector *and* Threshold/Ratio (proposed), or feed it into the gain computer as the detector level (so Threshold/Ratio still act)? Should Attack/Hold/Release smooth it (proposed yes)?
5. **Envelope + Sidechain both wired:** Envelope wins (proposed), or multiply both gains?
6. **Reuse:** option B (shared `soemdsp/dynamics/pump_gain.h`, Pump Limiter refactored, bit-identical; **needs §19 approval**) or option C (local copy)?
7. **Hold range/default:** 0–2000 ms, default 0?
8. **Detector/smoother coupling:** keep Pump Limiter's shared attack/release on both detector and gain (proposed, for parity), or let only the gain smoother use them?
9. **Extras not in spec:** Env / Gain-reduction output, look-ahead, Input Gain, Amplitude, soft knee? (I/O stays as specified unless Argi adds them.)
10. **Name / type key:** "Sidechain" / `sidechain`? Category dynamics?

## 10. Tracker

| # | Item | Owner | Status |
|---|---|---|---|
| S0 | Argi answers §9 (esp. Q1–Q6) | Argi | Defaults picked per Argi's build brief (§11); open to change |
| S1 | Option B only: golden capture of Pump Limiter, `pump_gain.h` extraction, regression | SandyModules | Skipped: Option C (module-local copy) used; B still needs §19 |
| S2 | `native_modules/sidechain/sidechain.cpp` + graph-engine wiring | Grok Bot | Done (type 216) |
| S3 | Definition, store card, tooltips | Grok Bot | Done |
| S4 | Tests §8 | Grok Bot | Done: `scripts/smoke_graph_sidechain.mjs` (in combined build) + smoke_test exports; full smoke passes |
| S5 | Face | Grok Bot | Done: Instant Waterfall (WebGL scroll strip, same as Pump Limiter) on Envelope |
| S6 | Argi's ear check | Argi | Waiting (code committed and pushed (checked 2026-10-18)) |

## 11. As built (2026-10-14)

Every default below is a named constant or one small function at the top of `sidechain.cpp`, so each is a one-line change.

- **Detector key (Q1, Argi 2026-10-14):** Sidechain only. With neither Sidechain nor Envelope wired, env = 0 and the output holds at Mix (detector state resets). To duck on the dry signal, patch Dry into Sidechain too. The Dry fallback is removed.
- **Mix law (Q2, Argi 2026-10-14, replaces O1):** equal-gain linear crossfade. `env` = duck amount 0..1 (`1 − gain` from the detector). `m = Mix + (Ducked Mix − Mix)·env`, `out = Dry·(1 − m) + Wet·m` (`mix_amount`, `mix_out`). Mix 0..1 default 0.35, Ducked Mix 0..1 default 0. Ducked Mix > Mix makes the Wet swell on hits. The old Dry + g·Wet path and the crossfade switch are removed.
- **Envelope (Q3):** a wired Envelope input is `env` directly: `clamp(e, 0, 1)`, raw per sample. Threshold, Ratio, Attack, Hold and Release are ignored.
- **Envelope output:** `env` at audio rate (0 = no ducking).
- **Maths:** module-local copy of Pump Limiter's mean-square detector, hard-knee gain `(T/env)^((R−1)/R)` and gain smoother, plus Hold (gain held after the last attack for Hold ms, then Release). No library edit.
- **Stereo:** one linked gain for both sides; a lone L or R input in a pair feeds both sides.
- **Bypass:** Dry only, Envelope 0 (Argi accepted).
- **Ports:** Wet L/R → Left/Right, Dry L/R → Dry L/Dry R, Sidechain → Morph bus, Envelope → Square; outputs Left/Right, Mono = Left, Envelope on Saw.
- **Params:** Threshold −48…0 dB (−18), Ratio 1…20 (8), Attack Time 0…100 ms (5), Hold Time 0…2000 ms (0), Release Time 20…2000 ms (250), Mix 0…1 (0.35), Ducked Mix 0…1 (0).
- **Face:** Instant Waterfall, the same face Pump Limiter always used (`node-graph-module-scope-waterfall.js` + `-waterfall-gl.js`: WebGL history texture on the shared device, scrolls left, stamps only the new columns). Source = Envelope output; 0..1 maps onto the full face (0 at the top, ducking pulls the line down, APP_POLICY 3). Mono line colour widget is labelled Line, next to Background.

## 12. Decisions log
- 2026-10-14: v1 built with Dry + ducked Wet (O1).
- 2026-10-14 (Argi): mix law changed to the Mix → Ducked Mix crossfade, Envelope output added, Pump Limiter's face moved to the shared GL face and reused here.
- 2026-10-14 (Argi): only the Sidechain input keys ducking; Dry fallback removed (unwired key = env 0, output at Mix). Bypass = Dry only accepted.
- 2026-10-14 (Argi): face must waterfall like Pump Limiter's (no full redraw); the limiterGainFace rewrite was dropped and both modules use Instant Waterfall. Fix for the blank face: the worklet published Sidechain's Saw tap as "Saw", not "Envelope", and did not ring it for faces.
