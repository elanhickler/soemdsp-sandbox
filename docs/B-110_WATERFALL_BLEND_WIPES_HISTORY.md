# B-110 — Waterfall blend-mode change wipes history instead of continuing

Report ID: B-110  
Status: fixed  
Severity: see  
Source: user 2026-10-23 (Argi)  
Related: B-097 (Instant Waterfall blank after WebGL restore); B-026 (waterfall drawers after Pause → Stop → Play)

## User symptom

Changing the blend mode erases the display on Sample & Hold. That face is a waterfall, so this is assumed to be every waterfall display. A blend-mode change should only change the blend mode and keep waterfalling. It should not erase the entire display, and it should not redraw everything with the new blend mode. New ink simply continues under the new mode.

## Repro

1. Open Sample & Hold (`sampleHold`) with its waterfall face populated (Play, stereo Left/Right history visible).
2. Change blend mode (Display Settings stereo blend / equivalent waterfall blend).
3. Observe: the waterfall history is gone; the face looks wiped and only new columns refill it.

Spot-check another waterfall face (oscilloscope Instant Waterfall, Gain, etc.) to confirm the shared path.

## Expected behavior

History already on the plate stays as it was drawn. The waterfall keeps scrolling. Only columns stamped after the change use the new blend. No full-plate erase. No replay of old columns under the new blend.

## Notes

- Sample & Hold: `displayType: "waterfall"`, schema `waterfallSampleHold`, stereo Left/Right (`public/node-graph-module-definitions.js`).
- Shared scroll state: `nodeGraphWaterfallState` in `public/node-graph-module-scope-waterfall.js`.
- `modeChanged = st.nowLine !== nowLine || st.blend !== blend`. On that flag (or first start) the path fills the plate with background, clears TraceTape, resets the GPU hold, and drops last-Y keys. Blend is cached on `st.blend`, so a Display Settings edit hits this as a cold start.
- New stamps already take the current blend (`nodeGraphWaterfallBlendMode` → GL `nodeGraphWaterfallGlApplyBlend` / queue). The wipe is extra; continuing would already pick up the new mode on the next column.
- Multiply vs other modes also swaps plate bg (`#ffffff` vs module bg) at paint time. A later fix must not wipe history for that swap either unless Argi says otherwise.
- `nowLine` is bundled in the same `modeChanged` wipe; this report is blend only.

## Investigation / fix shape

Fixed 2026-10-23. `nodeGraphWaterfallState` no longer treats `st.blend !== blend` as a cold start. First start and `nowLine` still wipe. Blend is updated on the running state; new stamps already read the current blend. Cache-bust `node-graph-module-scope-waterfall.js?v=b110-blend-continue-1`.
