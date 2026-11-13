# Wraparound controls overhaul

**Status:** 2026-11-12 (America/Phoenix). Two uncommitted implementation passes were tried; Argi reports the live app is still broken (wraps to 0, then drag stops). See docs/WRAPAROUND_CONTROLS_ESCALATION.md for what was attempted. Not committed / not pushed. The design below is unchanged.
**Owner:** Argi / Interface.
**Repo:** soemdsp-sandbox.
**Related (read-only):** `docs/PARAM_SURFACES.md` (DOMAIN min/max, `wraparound: true`, smooth then apply MOD), `docs/MODULE_PATTERN_REFERENCE.md`, `docs/APP_POLICY.md`.

This file is the plan for how wrapping controls (Phase, Rotate, and any other `wraparound: true` parameter) should smooth across the seam without a phase-modulation snap, and without exposing a runaway unwrapped number.

## 1. Why

New wrapping controls, including Phase on the DSF oscillator, do not wrap the way a hardware knob should.

The stored value already jumps from 1 to 0 (or 0.99 to 0.01). Smoothing then interpolates that jump as if it were a long trip across the range. The result is a slew / snap of phase modulation instead of a short step through the wrap.

Argi still wants smoothing. A naive unwrapped number (smooth 0 → 1 → 1.00001 and keep climbing) would chase correctly, but it becomes a runaway value on the knob and the readout, which is confusing.

The overhaul is: keep the visible / stored parameter in its defined range, and do the smoothing in a private circular domain that the user never sees.

## 2. What the code does today

### Parameter definitions (already the right SSOT)

`wraparound: true` already lives on the parameter definition, next to min / max / mid / bipolar. Canonical docs: `docs/PARAM_SURFACES.md`. The flag means "always wrap into min/max." Metadata copies it in `public/node-graph-parameter-metadata.js`. The slider dataset copies it in `public/node-graph-slider-values.js`. Native gets it as bit 0 of the domain flags in `public/node-live-audio-worklet-native-graph.js` (`syncNativeGraphParams`, `if (meta.wraparound) flags |= 1`) and `soemdsp_graph_set_param_domain` in `native_modules/graph_engine/graph_engine.cpp`.

DSF Oscillator Phase and DSF Morphing Osc Phase already have the flag (`public/node-graph-module-definitions.js`, `dsfOscillator` and `dsfMorphingOsc` Phase objects, `wraparound: true`, range 0…1). Morphing Osc Rotate also has it. So "DSF Phase does not wrap properly" is not a missing flag on the definition. It is wrap-then-smooth, and drag-at-the-seam, on paths that ignore the circle.

`kind: "phase"` does **not** imply wrap by itself. Readers use `Boolean(parameter.wraparound)`. If a new control is missing the flag, add it on the definition, not as a one-off in the oscillator, a shader, or a draw path.

Shared wrap math already exists:

- `nodeGraphParamWrap` / `nodeGraphParamApplyDomainBounds` in `public/node-graph-stdlib/node-graph-param-surface-helpers.js`
- `wrapNodeSliderValue` in `public/node-graph-slider-values.js`
- `control_wrap_value` / `control_wrap_domain` in `graph_engine.cpp`

MOD already wraps after it is applied when the flag is on (`nodeGraphParamFoldModSources`, and `control_effective` in the engine). That order stays: **smooth the knob, then apply MOD, then wrap the effective value**.

### Native efficient path (already close to the design)

When the host writes a DOMAIN knob (`readContinuous` uses raw `node.params[key]`, not a JS-smoothed value) into `control_set_target`:

```
// Host sends domain-wrapped values (Phase 0…1). For wraparound Controls,
// chase the shortest arc so 0.99→0.01 does not sweep through 0.5.
chase = control_shortest_unwrap(c.out, value, range);
c.target = chase;
```

`control_shortest_unwrap` maps the wrapped target onto the nearest value to the current `out` (shortest arc). The lag / one-pole / linear / Papoulis chase runs on that unwrapped pair. Once `out` has caught `target`, `control_fold_wrap_state` folds target, out, and filter stages back into min/max ("float hygiene"). The user-facing DOMAIN stays in range. The unwrapped 1.00001 exists only privately during the chase.

This is the design we want. It is **not** what the JS smoothers do.

### JS worklet and main-thread smoothers (the snap)

Both JS chases store `wraparound: Boolean(metadata.wraparound)` and then ignore it while they filter:

- Worklet: `public/node-live-audio-worklet-smoother.js` (`updateSmoother`, `stepSmootherOneSample`)
- Main thread / offline: `public/node-graph-slider-values.js` (`updateNodeGraphParameterSmoother`, `nodeGraphStepParameterSmootherOneSample`)

They convert DOMAIN → unit with `parameterValueToNormalizedSignal` / `normalizeNodeGraphSmootherSignal` (and the worklet fallback in `public/node-live-audio-worklet-param-map.js` **wraps or clamps first**), then lag `outputBuffer` toward `targetSignal` in 0…1, then convert back. When the knob goes 0.99 → 0.01, `targetSignal` becomes 0.01 and the filter walks 0.99 down to 0.01 across the whole range. That is wrap-then-smooth: the phase-modulation snap.

`shortestNodeGraphWrapDelta` already exists in `public/node-graph-slider-values.js` (same shortest-arc math as `control_shortest_unwrap`). It is unused. Do not invent a third formula; hook this (or one shared helper) into both JS chases so they match native.

`smootherNeedsWork` compares `outputBuffer` to `targetSignal`. After a circular fix, that test must use the unwrapped target (or a wrapped distance), or a 0.99 → 0.01 move can look like a large error and still take the long road.

### Drag (the other half of "does not wrap properly")

`dragNodeSlider` in `public/node-graph-slider-dragging.js` adds pointer travel to `startTravel`, then:

- `nodeGraphParamDomainFromControlPosition` **wraps or clamps** travel into 0…1 when `wraparound` is set (`node-graph-param-surface-helpers.js`).
- If `nextTravel <= 0 || nextTravel >= 1`, it **re-anchors** the gesture at the pointer.

That is not "spin forward past max and keep going forward." Crossing the seam either jumps the stored value to the other end in one pointer event (then the JS smoother slews the long way) or sticks the user at the edge and re-anchors. Screen-edge `wrapNodeSliderDragAtScreenEdge` is only infinite-desktop pointer wrap, not parameter wrap.

While the user is dragging a wrapping control, travel should unwrap in the **gesture direction**. The value written to the patch / readout is still wrapped into min/max every event. The smoother sees a short forward (or backward) step through the seam, not a jump to the opposite end of the unit interval.

### Faces, shaders, readers

Policy: do not hardcode clamps or wrap behavior in draw paths, shaders, or module DSP. They should read the already-wrapped DOMAIN (or the already-wrapped effective after MOD). `nodeGraphParamSignalInPhaseAdd` (Phase SIGNAL IN) already folds `domain + CV` into 0…1 cycles; that is a jack convention, not a substitute for the parameter flag. Any leftover `Math.min` / `Math.max` on Phase in a face or oscillator should be called out during the audit and removed in favor of the definition flag.

## 3. Recommended design (no runaway value)

The number on the knob, in the patch, and on the readout **stays in the parameter's min/max** (for Phase, 0…1). Never show 1.00001, 2.4, or −0.03 as the parameter. That is what keeps wrap from becoming a runaway counter.

Smoothing happens in a private circular / unwrapped domain, one helper, used by native (already) and JS (not yet):

```
span     = max - min
halfSpan = span / 2
each tick:
  err     = wrap(target - current, -halfSpan, +halfSpan)
  current += lag(err)          // existing smoother / lag, now on the short error
  output  = wrap(current, min, max)   // display, storage, DSP read
```

So 0.99 → 0.01 is a short +0.02 step through the seam, not a long slew from 0.99 down to 0.01. After the chase settles, fold the private `current` / `target` back into min/max (native already does this in `control_fold_wrap_state`) so float error cannot drift.

Equivalently: unwrap the target to the nearest value to `current` (or, during a drag, to the value consistent with the gesture), lag toward that, wrap for output. Same math as `control_shortest_unwrap`. The 1.00001 exists only as that private target, and only until the lag catches it.

**Two ways a new target arrives:**

1. **No gesture** (typed value, MIDI, patch load, a cable-driven jump of the knob itself): use the **shortest arc**. 0.99 → 0.01 goes forward +0.02, not backward through 0.5.
2. **While the user is dragging** a wrapping knob or slider: use the **gesture direction**. Spinning forward past max keeps going forward (private unwrap follows the pointer); spinning backward past min keeps going backward. The stored / visible value still wraps at the seam every event.

Do not smooth the already-modulated value. Keep `effective = applyMod(smooth(knob), MOD)`, then wrap the effective if the flag is on.

## 4. What must stay in the parameter definition

The parameter definition remains the source of truth for **min, max, mid, bipolar, and wrap**. Readers (smoother, drag, native domain flags, readout, MOD fold) consult `wraparound` on that metadata. They do not invent a clamp or a wrap in the DSF oscillator, a face renderer, or a shader.

If a new control such as a future Phase is not wrapping, the fix is `wraparound: true` on its definition (and a range that defines the circle). Do not special-case the module.

## 5. DSF Phase as the first test

First visual and audible check: DSF Oscillator Phase, with smoothing on (the user's lag, not Off).

- Turn the knob slowly through 0.99 → 0.01 (and 0.01 → 0.99). The tone's phase should take a short step through the wrap, not a sweep of almost a full cycle.
- Spin the knob quickly past the seam in one direction; it should keep going that way for the whole gesture.
- Type or jump the value from 0.99 to 0.01 without a drag; that jump uses the shortest arc.
- The readout and the stored patch value never leave 0…1.
- Repeat on DSF Morphing Osc Phase and Rotate, then on an older wraparound Phase (for example Softwave or PolyBLEP) so the JS and native paths both stay honest.

## 6. Stages

Do not start coding until Argi OKs this plan.

1. **Audit.** List every `wraparound: true` parameter. List every `kind: "phase"` (and Rotate-style) parameter that is missing the flag. Add the flag on the definition where it is genuinely a circle. Note any face / shader / oscillator that still hard-clamps Phase.
2. **One circular-chase helper.** Share shortest-arc error (the existing `shortestNodeGraphWrapDelta` / `control_shortest_unwrap` math) and use it in the worklet smoother and the main-thread smoother. Needs-work / settle / fold-on-settle must use that domain. No new public unwrapped parameter.
3. **Drag.** Gesture-direction unwrap while the pointer is down on a wrapping control; keep writing wrapped DOMAIN to the patch; stop treating travel 0 and 1 as a hard stop that re-anchors before the seam can be crossed.
4. **Keep native.** Do not regress `control_set_target` / `control_fold_wrap_state`. Host should keep pushing raw wrapped DOMAIN, not a JS-smoothed value, so the two chases never stack.
5. **Check.** DSF Phase first (section 5), then other wraparound controls, with smoothing on and off, on the efficient native path and on any remaining JS worklet path.

## 7. Open questions

Only two; neither blocks the design above.

1. **Long-way drags.** If the user slowly drags a Phase knob the long way (0.99 down through 0.5 to 0.01) in one gesture, follow the gesture (the long way). Shortest-arc is only for jumps that are not a live drag. Confirm that is what Argi wants. (Recommended: yes.)
2. **`kind: "phase"` without a flag.** Do not infer wrap in readers. Missing flags get added on the definition during the audit. Confirm that is preferred over silently treating every Phase as wrapping.

No other open design question: the stored value stays in range; smoothing is circular and private; the runaway number is never the parameter.
