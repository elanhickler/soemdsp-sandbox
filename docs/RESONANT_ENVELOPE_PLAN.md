# Resonant Envelope plan

Source: Argi, via the Thoughts agent, 2026-10-18.

**Status: module shipped.** Argi OK'd a new module `resonantEnvelope` and reuse of `tpt_svf.h` unchanged (2026-10-18). Decisions taken as the proposals in §10: Decay + Resonance, ƒ reference 440 Hz, rising edges only, Attack 0 maps to 0.5 ms, Fit clips below 0, ƒ stays live, no z-plane inset. The face is the live Waterfall on Out. A native shape-preview curve is still open.

**Name (Argi, 2026-10-18): Resonant Envelope.** Confirmed. Do not call it "filter envelope": that already means an envelope that modulates a filter's cutoff. "Ping Envelope" is not used as an alternative name, because the sandbox already has a module with that name (see §2).

## 1. The idea

Argi's feedback-based envelopes make the same amplitude shapes a filter makes when you ping it with an impulse. That is not a coincidence:

- A feedback (one-pole) envelope is a lowpass with its pole at, or near, DC (0 Hz). It only decays.
- A resonant filter is the same pole moved off the real axis, as a conjugate pair. It rings while it decays.
- **Pole radius sets the decay time. Pole angle sets the ring frequency.** The ordinary envelope is the angle-zero case.

So an envelope topology run with sub-audio coefficients can make frequency-dependent, ringing envelopes: smooth attack and decay at one end, overshoot and wobble ("bouncy" envelopes) at the other.

## 2. The existing Ping Envelope (context, not renamed)

`pingEnvelope` ("Ping Envelope") already exists: native `native_modules/ping_envelope/ping_envelope.cpp` (version 19), definition in `public/node-graph-module-definitions.js` (`pingEnvelope:`), face preview maths in `public/modules/pingEnvelope/ping-envelope-math.js`.

**What it does today:**

- **Ports.** Input `Trigger` (label "Trig"; aliases Gate, In, Trig). Outputs `Out` and `isIdle` (digital, high when |env| < 1e-5).
- **Core.** An asymmetric one-pole that chases the Trigger level. Rising: `k = 1 - exp(-1 / (Attack · fs))` (Attack 0..2 s, 0 = instant). Falling: a release rate in Hz turned into `k = 1 - exp(-2π · Hz / fs)`.
- **Feedback.** The release rate depends on the envelope's own level, so it is a *nonlinear* one-pole: `x` is mapped through a 5-decade exponential, `10^(5·(x-1))`, to the release rate.
  - Model **for Lin Amp** (key `Long`, choiceId 1, default): `x = env · 0.7718 + (1 - Decay)`, release 0..1000 Hz. Amplitude scales the target (`Trigger · Amplitude`).
  - Model **for Exp Amp** (key `Short`, choiceId 0; soundemote.io / old pluckEnvelope3): `x = clamp01(env + 0.5 - Decay)`, release 0..10 Hz. Amplitude scales the output.
  - High levels fall fast and low levels fall slowly, so the tail stretches out.
- **Recalc On Trig** (On by default): Attack, Decay and Amplitude are latched on each rising Trigger. Off = knobs always live. A rising Trigger never snaps the level back to 0.
- **Face.** Waterfall of `Out` (8 s, unipolar). The shape preview curve is simulated in JS (`nodeGraphPingEnvelopePreviewCurve`) for display only; audio is native.
- **Small finding, not fixed here:** the Decay and Amplitude tooltips look swapped. The "for Lin model" text describes the Short (Exp Amp) formula and the reverse.

**How it relates.** Ping Envelope is the angle-zero case with a *level-dependent* radius. Resonant Envelope keeps the pole radius idea and adds the angle. The level-dependent feedback could come back later as an option (RE-9).

**Open question (A): a new module, or a Resonance control / new Model on Ping Envelope?**

- *New module `resonantEnvelope`* (recommended). It needs two-pole state, an `f` input, Decay in seconds rather than a 0..1 feedback offset, and its own output-range handling. Putting all of that into Ping Envelope would change the ports and the meaning of Decay on existing patches. Ping Envelope stays as it is.
- *Third Model on Ping Envelope* ("Resonant"). One module fewer, but Decay would mean different things depending on the Model, and the `f` jack and Tracking would be dead under the two existing Models.
- *A Resonance knob added to both existing Models.* This is the most direct form of "move the pole off the axis", but the feedback-dependent radius makes the ringing nonlinear and harder to predict. It is better tried as RE-9 once the linear core is understood.

## 3. Maths sketch

### 3.1 Pole from time and ring frequency

Continuous-time two-pole lowpass (unity DC gain, so a held gate settles at 1):

    H(s) = ω0² / (s² + 2ζ·ω0·s + ω0²)
    poles  s = -σ ± j·ωd,   σ = ζ·ω0,   ωd = ω0·√(1 - ζ²)   (ζ < 1)

- Decay time constant τ (time to fall to 1/e of the envelope of the ringing): `σ = 1/τ`. For a T60-style time: `σ = ln(1000) / T60 ≈ 6.908 / T60`.
- Ring frequency f_ring: `ωd = 2π · f_ring`.
- Going back: `ω0 = √(σ² + ωd²)`, `ζ = σ / ω0`.

The same in the z-plane at sample rate fs, which is the "radius and angle" picture:

    pole  z = R · e^(±jθ),   R = e^(-σ/fs) = e^(-1/(τ·fs)),   θ = ωd/fs = 2π·f_ring/fs

- R → 1 means a long decay. θ = 0 means no ringing: that is the plain envelope.
- A one-pole envelope coefficient is the same R: `k = 1 - R`, which is what Ping Envelope computes.

**Only two of the three are free.** Decay time, ring frequency and damping ζ are tied together by the formulas above. Argi's core idea is one Resonance control, so v1 uses **Decay (seconds) + Resonance**, and the ring frequency is derived and shown on the face. Open question (B) asks whether to offer Decay + Ring Frequency instead.

### 3.2 Resonance → damping, holding the decay time

Hold the *dominant* decay rate at `σ = 1/τ` while Resonance moves ζ:

- **ζ ≥ 1** (no overshoot): two real poles. The slow pole is `ω0·(ζ - √(ζ² - 1))`. Set `ω0 = σ / (ζ - √(ζ² - 1))`. At ζ = 4 the second pole is about 62× faster, so the shape is practically a one-pole, like today's envelopes.
- **ζ < 1** (rings): set `ω0 = σ / ζ`. The decay stays the same and the ring frequency rises as ζ falls: `f_ring = σ·√(1 - ζ²) / (2π·ζ)`.
- The two branches meet at ζ = 1 (ω0 = σ, critically damped).

Proposed mapping: `ζ = 4 · 200^(-Resonance)`.

| Resonance | ζ | Feel |
|---|---|---|
| 0 | 4 | practically one-pole: smooth attack and decay |
| ≈ 0.26 | 1 | critically damped: fastest without overshoot |
| 0.5 | ≈ 0.28 | about 40% overshoot, one or two wobbles |
| 1 | 0.02 | about 94% overshoot, roughly 8 visible wobbles before 1/e |

Step overshoot for ζ < 1: `1 + e^(-π·ζ / √(1 - ζ²))`. About `√(1 - ζ²) / (2π·ζ)` ring cycles fit in one decay time constant.

### 3.3 Topology: coupled integrators (approach 1, the core)

Run a TPT state-variable filter (two coupled integrators) with envelope-rate coefficients. Take the lowpass tap as `Out`. The sandbox already has this filter in `library/include/soemdsp/filter/tpt_svf.h`: `g = tan(ω0 / (2·fs))`, damping `r = 2ζ` (the header's `r = 1/Q`). See §6 for the library rule.

- **Gate high:** use σ from Attack. **Gate low:** use σ from Decay. Same ζ for both.
- The SVF state carries no coefficients, so swapping between the Attack and Decay coefficients on a gate edge does not jump the output. Ping Envelope's asymmetric one-pole works the same way.
- Held gate: settles at Amplitude (sustain). Release: rings around 0 with undershoot when ζ < 1.

### 3.4 Key tracking through the `f` input (approach 2)

Argi, 2026-10-18: add an `f` input, same convention as other modules' `f` jacks. Softpop 2 is the reference: input `f`, label `ƒ`, alias `ƒ`, an absolute Hz cable (in the engine, `g.mixF` through `mix_live_port(..., kPortF, ...)`, as `resolve_osc_hz` does). Resonant Envelope has no Frequency knob, so a wired `f` drives tracking only; it replaces nothing.

**Tracking** (0..1): 0 = ignore `f`, 1 = full tracking.

    scale = (f / f_ref) ^ Tracking
    σ'  = σ  · scale        (decay and attack get faster for higher notes)
    ω0' = ω0 · scale        (ring frequency rises with the note; ζ is unchanged)

- **Reference frequency f_ref = 440 Hz** (A4, MIDI 69). That is the engine's default patch pitch reference (`pitchReferenceMidiNote = 69` in `graph_engine.cpp`) and Softpop 2's default Frequency. At f = 440 Hz, tracking has no effect at any Tracking amount. Open question (C): should f_ref follow the patch pitch reference instead of being fixed?
- At Tracking 1, one octave up halves the decay and attack times and doubles the ring frequency. The number of wobbles per decay stays constant, like a pinged filter or plucked string with constant Q.
- `f` unwired, f ≤ 0, or not finite: scale = 1.
- Clamp scale to [1/256, 256] (±8 octaves around 440 Hz) so a stray cable cannot make τ absurd.
- `f` may change every sample (glides). Recompute coefficients when `f` or a knob changes. A `tan` per sample is affordable.

### 3.5 Gate as impulse plus step (approach 3)

Drive the filter with the gate edge as well as the gate level, so it really pings and the attack shape comes from the impulse response:

    edge[n]  = gate[n] - gate[n-1]          (+1 on a rising edge)
    drive[n] = (1 - Impulse) · gate[n] · Amplitude  +  Impulse · edge[n] · K · Amplitude

- **K** normalises the impulse so its response peaks at about 1. The lowpass impulse response is `(ω0/√(1-ζ²)) · e^(-σt) · sin(ωd·t)`, so `K ≈ fs / (ω0 · peak)`. Compute the peak analytically for ζ < 1 and numerically for ζ ≥ 1, only when the coefficients change.
- **Impulse 0:** step drive. The envelope attacks, holds, and releases with the gate.
- **Impulse 1:** pure ping. It starts at 0, rises with finite slope, rings and decays to 0 even while the gate is held. Gate length then only matters for retriggering.
- Falling edges: by default only rising edges ping, because a negative ping on release would push `Out` below 0 (§5). Open question (D).

## 4. Stability notes

- **TPT SVF is stable for every g > 0 and r > 0** with fixed coefficients. It stays well-behaved when the coefficients move every sample, which is why it suits tracking and attack/decay switching.
- **Damping floor:** ζ ≥ 0.02 (r ≥ 0.04, far above the header's 1e-9 floor), so the envelope always decays and never self-oscillates.
- **ω0 ceiling:** cap ω0 at 2π · 0.25 · fs. `tpt_svf_setup` already clamps ω to 0.999π. With tracking and short times, ring frequencies can reach audio rate; that buzz is part of the "pinged filter" character up to the cap.
- **Attack 0:** in Ping Envelope, 0 means instant. Here, with ζ < 1, instant would ring at the ω0 cap. Proposal: Attack minimum 0.5 ms in the DSP; the slider 0 maps to that. Open question (E).
- **Very slow settings:** at 0.01 Hz and 192 kHz, g ≈ 1.6e-7. Doubles handle that fine; no special path is needed.
- **Tails and denormals:** flush state below 1e-20. `isIdle` needs |Out|, |z1| and |z2| all < 1e-5 *and* the gate low, because a ringing output passes through 0 while still active.
- **NaN guards:** the sandbox `safe()` / `x * 0.0 == 0.0` pattern on every input and on the state, as Ping Envelope does.
- **Retrigger:** a rising edge never resets the state, same as Ping Envelope. A retrigger while ringing adds to the motion.

## 5. Output range

At ζ < 1 the step response overshoots above Amplitude (up to about 1.94× at Resonance 1), and the release undershoots below 0. Both conflict with the sandbox rules: amplitude spawns in 0..1, and modulation at the destination is clamped to the slider's range. A raw 1.9 peak driving a 0..1 slider just flattens at the top, so the wobble is lost exactly where it matters.

Proposal: an **Output Range** choice.

- **Fit** (default): scale by `1 / peakGain`, where peakGain is the analytic or precomputed peak for the current ζ and Impulse, so the highest point equals Amplitude (≤ 1). Clip below 0 to 0. The release undershoot then reads as short silences between bounces, a "bouncing ball". With Amplitude ≤ 1, `Out` stays inside 0..1, and nothing is lost to the destination clamp.
- **Raw:** the true filter output, above 1 and below 0. For users who want the full bipolar wobble, for example into an offset/scale or another filter. The tooltip states that the destination clamp still applies.

Open question (F): is Fit's clip-below-zero right, or should Fit also squeeze the undershoot into range? Doing that moves the rest level off 0, which is bad for amplitude, so it is not proposed.

## 6. Rules this follows

- **Native C++ DSP only:** `native_modules/resonant_envelope/resonant_envelope.cpp`, run by the native graph (`graph_engine.cpp`) in the efficient build. No JS DSP, not even a fallback (APP_POLICY §0b).
- **Shared library needs Argi's approval.** The plan reuses `library/include/soemdsp/filter/tpt_svf.h` unchanged, plus existing scalar helpers. Argi to OK that use at RE-2. Any *new* or changed library helper (for example a ζ/overshoot helper, or moving Ping Envelope's 5-decade curve into the library) needs Argi's approval first (APP_POLICY §19). Nothing in this plan edits the library.
- **Displays are WebGL2 only** (APP_POLICY §3), through `public/lib/visual/gl-line-renderer.js`.
- **Amplitude spawns in 0..1** (default 1). **Modulation is clamped to the slider range**; §5 is how the overshoot lives with that.
- **Mono.** One handle, `Out` only. No stereo jacks on a mono module (APP_POLICY §296, §448). If a stereo variant is approved later (for example L/R detune of the ring), outputs follow the `<name> L` / `<name> R` naming: `Out L`, `Out R`.
- **Full-word labels** on knobs and jacks (no "Trig" or "Recalc").

## 7. Proposed ports and parameters (v1)

**Inputs**

| Id | Label | Notes |
|---|---|---|
| `Trigger` | Trigger | Gate or trigger (aliases Gate, In, Trig, as on Ping Envelope). Rising edge = above 0. |
| `f` | ƒ | Hz cable for tracking (alias `ƒ`). Unwired = 440 Hz reference, so no tracking effect. |

**Outputs**

| Id | Label | Notes |
|---|---|---|
| `Out` | Out | The envelope, after Output Range. |
| `isIdle` | isIdle | Digital, as on Ping Envelope; see §4 for the ringing-aware test. |

**Parameters (in order)**

| Key | Label | Range / default | Notes |
|---|---|---|---|
| `attack` | Attack | 0..2 s, mid 0.01, default 0.01 | Time constant while the gate is high. 0 maps to the 0.5 ms floor. |
| `decay` | Decay | 0.001..10 s, mid 0.3, default 0.3 | Dominant time constant after the gate falls (σ = 1/Decay). |
| `resonance` | Resonance | 0..1, default 0 | ζ = 4 · 200^(-Resonance). 0 = smooth, 1 = most bounce. |
| `impulse` | Impulse | 0..1, default 0 | 0 = step drive (attack/hold/release), 1 = pure ping from the rising edge. |
| `tracking` | Tracking | 0..1, default 0 | 0 = ignore ƒ, 1 = full tracking around 440 Hz. |
| `amplitude` | Amplitude | 0..1, default 1 | Peak height (spawn range 0..1). |
| `outputRange` | Output Range | Fit / Raw, default Fit | §5. |
| `recalculateOnTrigger` | Recalculate On Trigger | Off / On, default On | Latch Attack, Decay, Resonance, Impulse and Amplitude on each rising edge, as on Ping Envelope. Tracking and ƒ stay live, so glides keep tracking. |

Open question (G): should ƒ be latched too when Recalculate On Trigger is On?

## 8. Display idea (WebGL2)

- **Shape preview face:** the curve for the current knobs (gate held for a short fixed time, then released), drawn as a polyline through `gl-line-renderer.js`. Guides at 0 and 1. In Raw, anything above 1 or below 0 gets a tint so the overshoot is obvious. A small readout shows the derived ring frequency and ζ.
- **The preview comes from native code**, not a JS re-implementation: an exported `soemdsp_resonant_envelope_preview(...)` (or a fixed-size preview buffer, like Softpop 2's display bins) fills N points whenever the knobs change. One source of truth, unlike Ping Envelope's JS preview simulation.
- **Live mode:** the existing Waterfall renderer on `Out` (as Ping Envelope), with polarity switching to bipolar in Raw.
- **Optional inset:** a z-plane dot pair (radius R, angle ±θ) moving as Resonance and Tracking change. It shows the core idea directly. Open question (H).

## 9. Milestones

| Step | What | Status |
|---|---|---|
| RE-1 | **Prototype and listening test.** Standalone C++ test program under `scripts/` (not in the app). It renders WAVs of the envelope on a sine and a noise burst, plus CSV curves, across Resonance 0 / 0.26 / 0.5 / 0.8 / 1, Impulse 0 / 1, Tracking 0 / 1 at a few notes, and Fit vs Raw. Argi listens. Decision gate: go/no-go, and (A) new module vs Ping Envelope Model. | planned |
| RE-2 | Decisions recorded here: module shape (A), parametrisation (B), f_ref (C), Argi's OK to reuse `tpt_svf.h`, and any library helper proposals. | done (proposals; OK 2026-10-18) |
| RE-3 | Native module core (approach 1): `resonant_envelope.cpp`, `graph_engine.cpp` process function, module definition (ports and params from §7), combined/efficient wasm registration, `isIdle`. | done |
| RE-4 | `f` input and Tracking (approach 2), with the 440 Hz neutral point and the clamps. | done |
| RE-5 | Impulse (approach 3), with K normalisation. | done |
| RE-6 | Output Range Fit / Raw (§5), with peakGain. | done |
| RE-7 | WebGL2 face: native shape preview, Waterfall, optional z-plane inset. | planned |
| RE-8 | Tests (native unit test: decay time, ring frequency, overshoot vs formula, tracking neutral at 440 Hz, no NaN, `isIdle`), smoke test, a livedemo patch, docs. | planned |
| RE-9 | Optional: level-dependent feedback on the pole radius (Ping Envelope style), or a Resonance option on Ping Envelope if (A) goes that way. | idea |

## 10. Open questions

- **(A)** New module `resonantEnvelope`, a third Model on Ping Envelope, or a Resonance knob on Ping Envelope's existing Models? Recommended: new module.
- **(B)** Controls: Decay + Resonance (ring frequency derived; proposed), or Decay + Ring Frequency (Resonance derived), or a choice between them?
- **(C)** Tracking reference: fixed 440 Hz (proposed), or follow the patch pitch reference note?
- **(D)** Should Impulse also ping on the falling edge (a negative ping on release)?
- **(E)** Attack 0: keep a 0.5 ms floor (proposed), or snap to the target and skip the attack ringing?
- **(F)** Output Range Fit: is clipping the undershoot below 0 right?
- **(G)** Latch ƒ on trigger when Recalculate On Trigger is On, or keep it live (proposed)?
- **(H)** Is the z-plane inset on the face wanted?
- **(I)** Is the ζ mapping `4 · 200^(-Resonance)` right, or should Resonance 0 start at critically damped (ζ = 1) instead of near one-pole?
- **(J)** Should Ping Envelope's swapped Decay / Amplitude tooltips (§2) be fixed separately?
