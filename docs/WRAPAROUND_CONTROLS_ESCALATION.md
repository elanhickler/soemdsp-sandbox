# Wraparound controls — escalation handoff

**Resolution (2026-11-12, later pass, uncommitted):** root cause found by a live trace. DSF Phase is a GL module-face cell, so its drag never runs `dragNodeSlider`. It runs the cell `move` closure in `beginNodeGraphModuleFaceGesture` (`public/node-graph-module-face.js`), which clamped gesture travel to 0..1 before calling `nodeSliderValueFromTravel`. Travel pinned at 1 folds to min, so every later move wrote 0. Fix: that closure leaves travel unclamped when `nodeSliderShouldWraparound(input)`; cache tag `...-wrap-3`. Verified in the running app: Phase spins through the seam both ways and stays in 0..1, Blend still stops at its ends. Sections 4 to 8 below describe passes that edited a path this control does not use.

**Date:** 2026-11-12 (America/Phoenix)  
**Repo:** soemdsp-sandbox  
**Checkout:** `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` (work is on this machine, not a cloud agent)  
**Related plan:** `docs/WRAPAROUND_CONTROLS_PLAN.md` (design is still right; the status line at the top of that file was too optimistic)  
**Request:** Argi reports wraparound is still broken in the live app after two uncommitted fix passes. This document is a handoff of what was already tried, what was tested, and where to look next. Do not start from a clean-slate rewrite of the native audio path.

Nothing below is committed or pushed. Do not commit or push unless Argi asks. Do not stash, `reset --hard`, switch branches, or force-push. Other sessions share this tree: touch only wraparound hunks. Slider JS files use CRLF; keep them that way (no `sed -i`). Bump only the two slider script `?v=` tags when those files change. Other dirty cache tags in `public/index.html` / `public/perform.html` belong to other work and must be left alone.

---

## 1. What “done” looks like

A parameter with `wraparound: true` on its **definition** (the source of truth for min, max, mid, bipolar, and wrap — not `kind === "phase"`) should:

- Keep spinning in the gesture direction through the seam. Dragging past max continues at min in the same direction; dragging past min continues at max the other way.
- Show and store a value that always stays inside min/max (Phase is 0…1). Never a runaway `1.00001` / `2.4` on the knob, readout, or patch.
- Still smooth. The lag must take the short way around the seam (0.99 → 0.01 is a +0.02 step, not a slew through 0.5). That private chase is allowed to go past max (1.05, 1.2, …) and must be folded back into min/max when it settles.
- Leave ordinary (non-wrapping) knobs stopping at the ends.

Argi’s own wording for the lag: it should require “smoothing past max and when it settles, it internally gets reset to the wrap value.” That is the design. There is no smarter shortcut that avoids letting travel / private chase go past max. Folding the public value immediately is fine only if something still tracks unwrapped travel for the whole gesture and the smoother still chases a short unwrapped arc.

Primary live check: **DSF Oscillator Phase**, with smoothing on. Also try Morphing Osc Rotate or Chroma Hue, plus a normal non-wrapping knob as a control.

---

## 2. Symptom history (Argi’s words)

1. New controls like Phase on the DSF oscillator do not wrap properly. Existing wrap + smoothing goes from 1 to 0 as a smooth interpolation, which “creates a snap of phase modulation instead of just going to 0.” He still wants smoothing, but not a runaway unwrapped value.
2. A first write-up over-blamed JavaScript smoothers in the audio path. Argi corrected this sharply: **there are no JS smoothers in the C++ audio path.** That correction stands. Do not “fix” native lag by wiring JS lag into it.
3. The UI bug was then refined: **“it just doesn’t wrap, or it does, then stops.”**
4. He asked to go ahead and fix it.
5. After pass 1: **“how is it working? well it’s not working.”** Then: **“it keeps wrapping to 0 then i can’t drag anymore.”**
6. He asked whether it requires letting the value go past max, or whether it can be implemented more cleverly than that. Answer given: travel and the smoother’s private chase must go past max; the shown/stored number can wrap every frame; on settle, fold the internal state. Same math he described.
7. After pass 2 (explicit travel fold + cache bump to `wrap-2`): **still not working.** This escalation followed.

The live failure to chase is therefore: the control wraps to 0 once, then further dragging does nothing. Treat that as the reproduction target. Also listen for the original phase-modulation snap, in case the drag and the lag are both still wrong.

---

## 3. What was already correct (do not regress)

These were checked and left alone on purpose:

- **Native C++** already does the circular chase: `control_shortest_unwrap` / `control_fold_wrap_state` / `control_set_target` in `native_modules/graph_engine/graph_engine.cpp`. Host writes a wrapped DOMAIN target; native unwraps to the nearest arc, lags, then folds state when settled.
- **Efficient path wrap flag:** `public/node-live-audio-worklet-native-graph.js`, `syncNativeGraphParams` — `if (meta.wraparound) flags |= 1`. That path must **not** sample JS smoothers. `readContinuous` reads raw `node.params[key]`.
- **JS worklet smoothers** (`public/node-live-audio-worklet-smoother.js`) exist only when `!efficientProduct` (`?product=full`). They still lag linearly. They were left alone so JS lag would not get near the native audio path.
- **Definitions already have the flag.** DSF Oscillator Phase, DSF Morphing Osc Phase, Morphing Osc Rotate, Chroma Hue, and many others already have `wraparound: true` in `public/node-graph-module-definitions.js`. This is not “add the flag and you’re done.”
- Factories and metadata apply already write `slider.dataset.wraparound` (`"true"` / `"false"`). `nodeSliderShouldWraparound(slider)` is `slider.dataset.wraparound === "true"` in `public/node-graph-slider-metadata.js`. `nodeSliderMetadata()` includes `wraparound` from that helper.
- Shared wrap helpers already exist: `wrapNodeSliderValue`, `nodeGraphParamWrap`, `nodeGraphParamApplyDomainBounds`, `shortestNodeGraphWrapDelta`.

`wrapNodeSliderValue(1, 0, 1)` is `0`. That is correct for a circle (0 and 1 are the same point) and is also the footgun behind “wraps to 0 and sticks”: if travel is **clamped to 1** and then wrapped, every later move still looks like 1 and stays 0.

---

## 4. Pass 1 (uncommitted, cache `?v=...-wrap-1`)

**Intent:** stop re-anchoring wrapping drags at 0/1, let travel go outside 0–1, write a wrapped value, and make the main-thread UI smoother chase the shortest arc.

**Files:**

- `public/node-graph-slider-dragging.js` (CRLF kept)
- `public/node-graph-slider-values.js` (CRLF kept)
- `public/index.html` and `public/perform.html` — only the two slider script tags bumped to `...-wrap-1`
- `docs/WRAPAROUND_CONTROLS_PLAN.md` — a status note only, not a design rewrite

**Dragging changes:**

- `dragNodeSlider`: `nextTravel = drag.startTravel + travelDelta` is allowed outside `[0,1]`. The 0/1 re-anchor is skipped when `nodeSliderShouldWraparound(drag.slider)`. Non-wrapping sliders still re-anchor at the ends.
- Native-range / number-field path (`bindNodeGraphNativeSliderModifiers`): `bound()` wraps when `dataset.wraparound === "true"` instead of clamping; re-anchor at min/max is skipped for wrapping inputs; `startValue` stays the value at pointer-down (or last fine-scale re-anchor).
- Keyboard nudges wrap for wraparound params (Home/End still jump to min/max). Arrow keys on module faces now nudge when you are not in type-in; the old handler returned false for all arrows, which also blocked wrap. Type-in caret still keeps the arrows.

**Values / smoother changes:**

- Main-thread UI smoother (`updateNodeGraphParameterSmoother`) sets `targetSignal` with `nodeGraphSmootherCircularTargetSignal` (shortest arc via `shortestNodeGraphWrapDelta`) when `wraparound` is set.
- Displayed/stored smoother output is folded into min/max. `nodeGraphSettleParameterSmoother` folds private unwrapped target/state back into range.
- `nodeSliderValueFromRelativeTravel` was given a comment saying wraparound travel maps outside `[0,1]` back into min/max, but **the body still only delegated** to `nodeSliderValueFromPointerTravel` (no explicit wrap there yet). That was a gap pass 2 tried to close.
- `normalizeNodeSliderTravel` and contour-taper travel already wrapped when the flag was on.

**What was not changed:** native C++, efficient-path flag push, worklet smoother.

---

## 5. Pass 2 (uncommitted, cache `?v=...-wrap-2`)

**Trigger:** Argi: “it keeps wrapping to 0 then i can’t drag anymore.”

**Diagnosis (theoretical, not confirmed in a live debugger):** if travel is left unwrapped and a later mapper **clamps** it to 1, then `normalizeNodeSliderValue` / `wrapNodeSliderValue(1, 0, 1)` writes `0`. Further pointer movement still has `nextTravel >= 1`, so the value stays `0`. That matches the report. A contributing risk: `nodeSliderValueFromPointerTravel` / `nodeSliderValueFromTravel` usually call `nodeGraphParamDomainFromControlPosition` (in `public/node-graph-stdlib/node-graph-param-surface-helpers.js`), which wraps only if `metadata.wraparound` is truthy; otherwise it clamps. Pass 1’s unit tests stubbed that helper, so they could not catch a live-path clamp.

**Change:** fold travel into `[0,1)` **first**, using `nodeSliderShouldWraparound(slider)` + `wrapNodeSliderValue(unit, 0, 1)`, in:

- `nodeSliderValueFromRelativeTravel` (the drag path)
- `nodeSliderValueFromPointerTravel`
- `nodeSliderValueFromTravel`

Then pass the folded unit into the contour / domain / curve mappers. Example: travel `1.05` becomes `0.05` before any clamp can turn it into `1` and then `0`.

Cache tags are now:

- `node-graph-slider-values.js?v=ds-numbers-1-zp-hover-skew-taper-2-wrap-2`
- `node-graph-slider-dragging.js?v=unit-pct-1-skew-taper-2-wrap-2`

in both `public/index.html` and `public/perform.html`.

Argi reported it is still not working after this pass. **Do not assume the diagnosis in this section was the live bug.** It may be necessary but not sufficient, or the live gesture may not be going through these helpers, or the running page may not be executing this code, or a later step may still be pinning the drag.

---

## 6. How it was tested (and why that can lie)

A standalone Node script lives at:

`TEMP/_test_wraparound.mjs`

It loads `public/node-graph-slider-values.js` in a `vm` context with stubs. After both passes it printed **ALL TESTS PASSED**. Coverage includes wrap math, travel `1.05 → 0.05` and `2.25 → 0.25`, clamp still stopping at the ends, backward wrap through 0, circular target `0.99 → 0.01` ≈ `1.01`, lag staying near the seam and not crossing 0.5, and settle folding back into 0–1. A simulated drag with a **fixed** `startTravel` and cumulative deltas also “keeps going past the seam.”

**Those tests are not a live pass.** They stub `nodeGraphParamDomainFromControlPosition`, `nodeSliderMetadata`, `nodeSliderShouldWraparound`, and related helpers. They never run `dragNodeSlider`, never load the real stdlib helper, never paint a face, and never start the app.

There was **no Playwright / browser pass, no screenshot, and no debugger session on a running DSF Phase knob** in either pass. The person implementing asked Argi to hard-refresh and try it by hand. He did, and it failed both times.

Trust a live reproduction over this script.

---

## 7. Live code paths the next pass must actually trace

Do not only re-read the helpers. Confirm which path DSF Phase uses in the running page, and log it.

### Drag (`public/node-graph-slider-dragging.js`)

- `beginNodeSliderDrag` / `dragNodeSlider`. `pointerMode` is always `"relative"`. `startTravel` is computed once from `nodeSliderTravelFromValue(slider, nodeSliderDomainForTravel(slider))` (folded 0–1).
- Each move: `nextTravel = drag.startTravel + travelDelta`, then `setNodeSliderValue(..., nodeSliderValueFromRelativeTravel(slider, nextTravel))`.
- Re-anchor at 0/1 is skipped for wraparound. **Other re-anchors still exist** and set `startTravel` from the *folded* domain value via `reanchorNodeSliderDragAtPointer`:
  - `wrapNodeSliderDragAtScreenEdge` (every move; fires within 30px of the screen edge)
  - Shift / fine-scale change (pointer origin is reset in the same call, so this one should still be able to continue from 0)
- Pointer capture is taken on the **surface** (`setPointerCapture`), not the thumb.
- `setNodeSliderValue` writes `dataset.domainValue`, sets `slider.value` to the folded domain on drag, and syncs the patch / readout.
- Phase uses `step: "0.01"`. `quantizeNodeSliderDragValue` can snap `0.995` to `1.0`, which then wraps to `0`. That is a seam dead-zone risk, not a full explanation of “can’t drag anymore,” unless travel is also stuck at 1.
- Native-range path is separate (`nodeGraphNativeRangeDrag`). Confirm Phase is not accidentally going through a hidden `<input type="range">` instead of `dragNodeSlider`.

### Readout / face

- Wraparound sliders use a CSS “portal” handle (`syncNodeSliderPortalHandle` in `public/node-graph-slider-readout.js`). It only sets CSS variables; it should not rebuild the surface. Still verify that wrapping the thumb to 0 does not drop pointer capture or end the gesture.
- Module-face paint / knob rotation must not clamp a wrapping param to a 0–1 end-stop in a way that looks stuck even if the stored value moved (or must not fight the drag). Policy: no hardcoded clamps in draw paths that override the definition.

### After the write

- Follow `syncNodeGraphPatchParameterFromSlider` and the main-thread smoother. During a drag, a lag write-back must not reset gesture travel.
- Confirm the page that is actually running loaded `...-wrap-2` (hard refresh; check the script URL in DevTools). If an old `wrap-1` or pre-fix file is cached, you are debugging the wrong code.

---

## 8. Suggested next investigation (in order)

1. **Reproduce with instrumentation.** On DSF Phase, log per `pointermove`: `dataset.wraparound`, `startTravel`, `travelDelta`, `nextTravel`, the value returned by `nodeSliderValueFromRelativeTravel`, `dataset.domainValue`, `slider.value`, and whether any re-anchor ran. That single log will tell you whether travel is still clamped, whether `startTravel` is being reset from 0 without a matching pointer reset, or whether moves stop arriving (capture / listener).
2. **Confirm the DOM flag.** The hidden range / face slider for Phase must have `data-wraparound="true"` at drag time. If it is missing, every wrap skip and travel fold is a no-op or only half-applied (`normalizeNodeSliderValue` would not wrap either — unless some other path still wraps `1` to `0`).
3. **Keep unwrapped travel on the gesture** for the whole pointer-down (`drag.unwrappedTravel` or a frozen `startTravel` that is never re-read from the folded domain, except when the pointer origin is also reset and subsequent deltas are measured from there). The public value stays folded. This is Argi’s “go past max, reset when settled” idea applied to the drag.
4. **Verify smoothing in the live app** with lag on: 0.99 → 0.01 must not slew through 0.5. Private chase may go to ~1.01, then fold on settle. Do not put that chase into the C++ path; native already has it. Do not stack two chases.
5. **Leave native and the efficient-path push alone** unless you have a live trace showing they are wrong.
6. **Add a test that loads the real** `node-graph-param-surface-helpers.js` **and, better, a Playwright / in-app drag** on DSF Phase. The current script is not enough.
7. When it actually works in the app: hard-refresh check, non-wrapping knob still stops at the ends, Shift fine-drag still wraps, backward through 0 still works. Then wait for Argi before committing.

---

## 9. Current dirty files (this work)

Uncommitted / untracked as of 2026-11-12, after pass 2:

- `M public/node-graph-slider-dragging.js`
- `M public/node-graph-slider-values.js`
- `M public/index.html` (this work only intends the two slider `?v=` tags; inspect the diff before staging)
- `M public/perform.html` (same)
- `?? docs/WRAPAROUND_CONTROLS_PLAN.md`
- this file: `docs/WRAPAROUND_CONTROLS_ESCALATION.md`

There is also `TEMP/_test_wraparound.mjs` (local test harness, not a formal suite).

---

## 10. Constraints the next model must keep

- Parameter definitions are the only source of truth for limits and wrap. Do not hardcode clamps in shaders, draw paths, or readers that override them.
- Display scaling must not visually clip traces; unrelated, but it is app-wide policy in this repo.
- MIDI policy and other module work in this tree are out of scope.
- soundemote-dev is test-bed history; apply wins here, do not refactor that repo.
- Default: no commit, no push, no PR, unless Argi says so.
