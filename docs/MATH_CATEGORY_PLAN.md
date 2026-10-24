# Math category, Logic, and Noise Gate

**Status:** implementing. Decisions in §0 are locked (Argi, 2026-10-23). M1 Math shelf, M2 Logic, and M3 Noise Gate are in. Remaining questions in §8.
**Date:** 2026-10-23.
**Requested by:** Argi.
**Related:** `docs/APP_POLICY.md` (native-only DSP §2 / §5, no shims, one source of truth, face rows §21-ish UI, library edits §19); `docs/GATES_TRIGGERS.md`; `docs/PORT_TYPES.md`; `docs/ADDING_HARDCODED_SANDBOX_MODULE.md`; `docs/SIDECHAIN_PLAN.md` (detector / Hold pattern); `public/node-graph-module-store.js` (departments + catalog).

Approved 2026-10-23. Recategorize first, then Logic, then Noise Gate, each as its own commit.

---

## 0. Locked decisions

- New browser shelf **Math** (`id: "math"`).
- **Gain stays Dynamics.**
- **AM Index** (`attenumax`) moves to Math.
- **RingMod stays Dynamics.**
- **Vectorscope Rotation stays Dynamics.**
- **Mid/Side stays Dynamics.**
- New module **Logic**: simultaneous AND / OR / XOR (and the rest of the boolean outs in §4), not a mode switch.
- New module **Noise Gate** in **Dynamics**, with two thresholds (open loud / close quiet), Attack, Hold, Release, Range.

---

## 1. What Math is

Modules that compute a value from inputs with no timing, no mix-bus, and no “make it louder/safer” intent: arithmetic, comparisons, boolean, range maps, geometric transforms, unit converts.

**Not Math:** mixers, crossovers, clippers / limiters / gates, delays, envelopes / slew, musical pitch theory, programmable logic (LUT / Code), transistor mux/demux, Gain (level tool, stays Dynamics).

**Shelf copy (draft):** “Arithmetic, compares, boolean, and maps. Numbers in, numbers out.”

| Field | Value |
|---|---|
| `id` | `math` |
| Label / title | Math |
| Emoji | ➗ |
| Symbol | ± |
| Order | Immediately **after Dynamics**, before Envelope |

Aliases: `Math`, `math`, and the orphaned `utility` id → `math` (Range currently uses `utility`). **Sample Delay** currently also says `utility`; retarget it to **Space** in the same recategorize so it does not land on Math.

Search: do **not** add Math to the filter/oscillator family boost (`nodeGraphModuleStoreSearchFamilyPriority`). S&H aliases stay as they are.

Saved browser settings: add `math` to the department id set. Old patches do not store shelf; catalog category is enough.

---

## 2. Recategorize (catalog only)

DSP, ports, faces, and type ids do not change. Only `nodeGraphModuleStoreCatalog[].category`, aliases, and `scripts/smoke_module_search.mjs` if a top-hit assertion moves.

### 2.1 Move to Math

| Type | Label | From | Why |
|---|---|---|---|
| `comparator` | Comparator | Digital | Compare / edges / sign |
| `b2u` | B2U | Dynamics | Range convert |
| `u2b` | U2B | Dynamics | Range convert |
| `bias` | Bias | Dynamics | Add |
| `divide` | Divide | Dynamics | Divide |
| `inv` | Inv | Dynamics | Negate |
| `minMax` | Min/Max | Dynamics | Min / max |
| `range` | Range | `utility` (orphan) | Linear map |
| `rotate3dTo2d` | Rotation 3D to 2D | Dynamics | Geometry |
| `attenumax` | AM Index | Dynamics | `Bias + In × Bias × Amplitude` |
| `ampDb` | Amp ↔ dB | Dynamics | Lin ↔ log convert (same family as B2U/U2B) |

### 2.2 Stay Dynamics

Gain, Attenuverter, Amp Curve, Mix4 / MixStereo / Crossfade, RingMod, Tube Saturation, Soft Clipper, Brickwall Limiter, Pump Limiter, Sidechain, Mid/Side, Vectorscope Rotation, Crossovers, **Noise Gate** (new).

Attenuverter stays with Gain: it is a level / invert tool, not a pure operator shelf item.

### 2.3 Stay Digital

LUT Cell, Code, BitConverter, t / tN / Nt mux-demux, Turing Machine.

### 2.4 Stay Musical

Pitch ↔ Hz, Pitch Manager, Freq Manager.

### 2.5 Not in the first pass

**Metallic Ratio** (Modulator, under construction) is closed-form math. Leave it until that module is finished; then consider Math.

### 2.6 Dynamics after the move

Mixers, clippers, limiters, sidechain, tube, crossovers, Gain / Attenuverter / Amp Curve, stereo-image matrices, Noise Gate. Matches the shelf pitch: power, level, and pressure.

---

## 3. Face / UI rules (both new modules)

- GPU faces only. No tooltips, no popups. Phone-friendly.
- At most 4 controls per row. Choice buttons only when the text fits; otherwise the plain param slider.
- Delete dead code. One source of truth per behavior.
- Bump `?v=` on every touched script in `index.html` and `perform.html`. Confirm every script still resolves.
- Native C++/WASM, sample-accurate, combined wasm rebuild, `soemdsp_*_version` + `soemdsp_graph_version` bump. No JS DSP twin.

---

## 4. Logic module (`logic`)

Boolean combine. Comparator stays the edge / sign detector; Logic is the gate pack. Min/Max stays analog min/max (not boolean AND/OR).

**Category:** Math. **planRole:** processor. **Bypass:** thru A.

### I/O

| Dir | Key | Type | Meaning |
|---|---|---|---|
| in | `A` | audio | First operand. True = `> 0` (`gate_on`) |
| in | `B` | audio | Second operand. Same law. Unwired = 0 (false) |
| out | `AND` | digital | A and B |
| out | `OR` | digital | A or B |
| out | `XOR` | digital | A xor B |
| out | `NAND` | digital | not AND |
| out | `NOR` | digital | not OR |
| out | `XNOR` | digital | not XOR |
| out | `NOT` | digital | not A (B ignored) |
| out | `Thru` | audio | A passthrough (Comparator pattern) |

All boolean outs are exact **0 or 1** every sample. No slew. `audio` ↔ `digital` wiring stays allowed.

No parameters. Face: GPU lamps for A, B, and each boolean out (high = on). Labels are the op names.

### DSP

```
a = gate_on(A);   // > 0
b = gate_on(B);
AND  = a && b
OR   = a || b
XOR  = a != b
NAND = !AND
NOR  = !OR
XNOR = !XOR
NOT  = !a
Thru = A
```

Native file `native_modules/logic/logic.cpp`. Graph type id = next free at build (highest seen 2026-10-23 is `dsfMorphingOsc` **232**). Export create/destroy/sample or process_block + version. Smoke: truth table of the four A/B combinations `{0,1}×{0,1}` plus a negative A (false, re-arms Comparator-style).

Search notes: `and`, `or`, `xor`, `nand`, `nor`, `xnor`, `not`, `boolean`, `logic`, `gate`.

---

## 5. Noise Gate module (`noiseGate`)

Classic downward gate with hysteresis. **Category: Dynamics** (not Math). **planRole:** processor. **Bypass:** audio thru.

This is not the Gate jack (`docs/GATES_TRIGGERS.md`). The module name is Noise Gate; it does not publish a Gate/Trigger bus unless we add a **Gain** CV out (below).

### I/O

| Dir | Key | Label | Meaning |
|---|---|---|---|
| in | `In` | Mono | Audio. Alone feeds both channels |
| in | `Left`, `Right` | | Stereo. Mono fallback per `stereo_route.h` |
| in | `Sidechain` | SC | Optional detect key. Aliases `SC`, `Key`. Unwired: detect from the audio path (`max(\|L\|, \|R\|)` after Input Gain) |
| out | `Out` | Mono | `(L+R)/2` after the gate |
| out | `Left`, `Right` | | Gated audio, stereo-linked gain |
| out | `Gain` | | Instant open amount **0…1** (1 = fully open, 0 = fully closed *before* Range — see DSP) |
| out | `Env` | | Detector envelope as amplitude 0…1 (same domain as Pump Limiter Env) |

### Parameters (fixed set)

Face rows (≤ 4 per row):

1. Open, Close
2. Attack, Hold, Release, Range
3. Amplitude

| Key | Label | Range | Default | Unit | Meaning |
|---|---|---|---|---|---|
| `openThreshold` | Open | −80…0 | −32 | dB | How loud the detect envelope must be to **open** |
| `closeThreshold` | Close | −80…0 | −44 | dB | After open, how quiet it must fall to **start closing**. DSP clamps Close to ≤ Open |
| `attack` | Attack | 0…100 | 1 | ms | Time to ramp gain from closed → open |
| `hold` | Hold | 0…2000 | 50 | ms | After the envelope drops below Close, stay fully open this long before Release |
| `release` | Release | 1…2000 | 80 | ms | Time to ramp gain from open → closed (the “decay”) |
| `range` | Range | −80…0 | −80 | dB | Closed gain floor. −80 ≈ mute. 0 dB = gate does nothing when closed |
| `amplitude` | Amplitude | 0…1 | 1 | | Output trim after the gate |

No Look-ahead in the first version (0 latency). No Peak/RMS switch: **peak** of the key. No sidechain EQ.

Times use the same one-pole law as Pump Limiter / Sidechain (`1 − exp(−1 / (t·sr))`), Attack 0 = snap open, Hold 0 = release immediately after Close.

### DSP (per sample, stereo-linked)

```
peak = SC wired ? |SC| : max(|L|, |R|)
env  = peak follower (one-pole up/down using Attack/Release coeffs, or a faster detect;
       proposed: env tracks |peak| with a short fixed detect, and Attack/Release apply to gain only)

openAmp  = dB→amp(Open)     // e.g. −32 dB
closeAmp = dB→amp(min(Close, Open))
rangeAmp = dB→amp(Range)    // closed floor, 0 dB → 1

state: Closed | Open | Holding | Opening | Closing
gain in [rangeAmp, 1]

Closed:   if env >= openAmp → Opening (or snap if Attack 0)
Opening:  gain → 1 with Attack; when gain hits 1 → Open
Open:     if env < closeAmp → Holding (Hold 0 → Closing)
Holding:  if env >= openAmp → Open (re-arm)
          else count Hold; when done → Closing
Closing:  if env >= openAmp → Opening from current gain
          else gain → rangeAmp with Release; when at floor → Closed

L' = L * gain * Amplitude
R' = R * gain * Amplitude
Gain jack = (gain − rangeAmp) / (1 − rangeAmp)   // 0 closed, 1 open, independent of Range
             if Range is 0 dB, Gain jack = 1
Env jack  = clamp(env, 0, 1)
```

A new peak above Open during Hold or Closing **reopens** (does not finish the close first). That is the usual gate chatter-reject plus retrigger.

**Do not** reuse Pump Limiter’s ratio/knee. This is a two-threshold switch plus ramps, not a compressor. Copying the limiter detector into a shared `library/include/soemdsp/dynamics/` helper needs APP_POLICY §19; first version keeps the follower **inside** `noise_gate.cpp`.

### Face

Waterfall of **Gain** (1 at rest / open at the top, dips toward 0 when closed), same idea as Pump Limiter. WebGL2 only.

### Search notes

`noise gate`, `gate`, `hysteresis`, `threshold`, `hold`, `expander`.

Smoke: silence stays closed; a burst above Open opens (Gain → 1); a drop below Close waits Hold then Release; a burst that never exceeds Open stays closed; Close > Open on the slider still closes at Open (clamp).

---

## 6. Build order (separate commits)

| # | Commit | What |
|---|---|---|
| M1 | Math shelf + recategorize | Department, aliases (`utility` → math except Sample Delay → space), catalog category flips, cache tags, search smoke |
| M2 | Logic | Native + graph + face lamps + combined wasm + truth-table smoke |
| M3 | Noise Gate | Native + graph + Gain waterfall + combined wasm + hysteresis smokes |

Do not mix M1 with Logic/Gate wasm. Do not force-push. Stage only these files.

Touched for M1: `public/node-graph-module-store.js`, `index.html` / `perform.html` `?v=`, `scripts/smoke_module_search.mjs`. Settings persistence validation if it lists department ids.

Touched for M2/M3: definitions, store, labels, efficient-product if needed, `NATIVE_GRAPH_TYPE_IDS`, `graph_engine.cpp`, `build_native_modules.ps1` (byte-preserve), combined wasm, live-runtime cache, smokes. Follow `docs/ADDING_HARDCODED_SANDBOX_MODULE.md`.

---

## 7. Out of scope

- Dedicated Add / Multiply modules (Bias + AM Index / Gain already cover + and ×)
- Look-ahead, RMS detect, sidechain HPF/LPF, ducking, expander-upward
- Moving Metallic Ratio, BitConverter, or transistor muxes
- Boosting Math in search family rank
- Changing Comparator DSP

---

## 8. Open questions (not blocking M1)

1. **Amp ↔ dB on Math** — planned as a convert next to B2U/U2B. Say if it should stay Dynamics.
2. **Logic outs** — full set AND/OR/XOR/NAND/NOR/XNOR/NOT. Cut NAND/NOR/XNOR if the jack row is too wide.
3. **Noise Gate Look-ahead** — omitted in v1. Add later like Pump Limiter if transients click through Attack.
4. **Noise Gate Open/Close defaults** (−32 / −44 dB) and Range (−80). Change by ear at build time.
5. **Gain jack** — 0…1 open amount, Range-independent. Alternative: raw multiplier including Range.

---

## 9. Pointers

- Comparator def: `public/node-graph-module-definitions.js` `comparator` (Up/Down/Change/Steady/Sign/Thru).
- AM Index: `attenumax`, native type **187**.
- Pump Limiter Hold/detector: `docs/SIDECHAIN_PLAN.md`, `native_modules/pumping_limiter`.
- Next native type ids: check `NATIVE_GRAPH_TYPE_IDS` at build; 232 was the high-water mark on 2026-10-23.
