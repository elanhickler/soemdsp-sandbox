# Zoom performance plan (ZP)

Owner: Interface (executing). Filed 2026-10-18 at Argi's request ("make a plan, give it to librarian, then execute").
Related: `docs/WEBGL_DISPLAY_PLAN.md` section 11 (GB-1..GB-5, history and the GB-5 measurements) and
`docs/GPU_WORKSPACE_PLAN.md` (owns the workspace picture and the camera; GB-6 = GW-2). This file does not
duplicate them. It covers the zoom gesture with displays running. Where a stage overlaps GW-2 or GW-5, that
plan's scope wins and this file links to it.

## Problem

Argi wants displays running while zooming. Display hold was turned off (`NODE_GRAPH_GESTURE_HOLD_DISPLAYS = false`
in `node-graph-viewport-perf.js`). It stays off. Since then a slow zoom with play on is a slideshow.

Measured 2026-10-18 on ArchIV (real GPU, headed Chromium, ANGLE D3D11), `softpop`, play on, slow wheel zoom
1x -> 40x -> 1x, `node scripts/probe_zoom_perf.mjs softpop` (after the ZP-1 shader fix):

| | fps | p50 | p90 | p99 | readPixels | getComputedStyle | offset* reads |
|---|---|---|---|---|---|---|---|
| baseline | 3.3 | 217 ms | 700 ms | 2100 ms | 246 | 50,784 | 29,760 |

Target: about 60 fps (p90 under 20 ms) for the same gesture, with displays running, and **zero** readPixels,
getComputedStyle and offsetWidth/Height/Left/Top reads during the gesture.

Policies that hold for every stage: all displays are WebGL2 on the shared context (`picture-device.js`), no 2D
fallback, no silent failure (`nodeGraphDisplayGlFailed`). Zoom-1 is the source of truth. Above 2.5x faces and text
are scaled nearest-neighbour. Nothing is re-baked at zoom.

## Root causes

1. **Waterfall onset line link failure, retried every frame.** `NODE_GRAPH_ONSET_LINE_FS` declared
   `uniform vec2 uCss` at mediump while the vertex stage has it at highp. The link failed silently, and
   `nodeGraphOnsetGlEnsureLine` rebuilt the program on every stroke. Fixed in ZP-1.
2. **Synchronous GPU readback per face.** `nodeGraphSharedGlCopyToContext` (`picture-device.js`, uncommitted)
   copies every face of 512x512 or smaller with `gl.readPixels` + `putImageData`. Each call stalls the GPU
   pipeline. It also pastes the rows bottom-up without a flip, so those faces are upside down (faces above
   512 px still use drawImage and are upright).
3. **Display hold off means the gesture takes the full rebuild path.** `nodeGraphGlGraphPresent` uses
   `nodeGraphViewportHoldsDisplays()` as its "gesturing" flag. With hold off, every zoom frame with a fresh display
   paint rebuilds every batch: wires reprojected, plates, chrome, captions and face uploads.
4. **Style and layout reads in the per-frame path.** Per 8 s gesture: `nodeGraphGlGraphSettleTextBake` and
   `nodeGraphGlGraphDrawChrome` call `getComputedStyle` per slider (about 23k calls), `nodeGraphModuleLayoutBox`
   reads `offsetWidth/Height/Left/Top` (about 23k reads), and there are constraint guide and badge
   `getComputedStyle` / `getBoundingClientRect` reads (`node-graph-gl-graph.js`, uncommitted).
5. **Module HTML relayout on each zoom step.** CSS `zoom` and `--node-graph-zoom` on modules are written per step
   (82007e05), so every frame recalculates style and layout for the whole module DOM.
6. **Text re-baked at zoom.** `nodeGraphGlGraphSettleTextBake` sizes the glyph atlas by `fit * zoom` (up to
   384 px). With hold off it runs every frame, so the atlas re-bakes as zoom changes (bf99c05d). This breaks the
   "never re-bake at zoom" policy.

## Stages

Each stage is measured with the gesture above. The tracker row records fps / p50 / p90 and the forbidden-read
counts. Each stage is committed locally on its own. Nothing is pushed without Argi's OK.

| ID | Task | Done when | Gate | Status |
|---|---|---|---|---|
| ZP-1 | Waterfall `uCss` precision fixed. Failed links are cached once (`lineProgFailed`; session programs shared per context in a WeakMap, `false` on failure) and reported once through `nodeGraphDisplayGlFailed`, with no per-frame retry. New smoke: every renderer's GL programs link. | `scripts/smoke_display_gl_programs_link.mjs` passes on softpop and musicplayer: no link failure, no GL-failed entry, no links once warm | 0 links during the gesture | done 2026-10-18 (links during gesture 0) |
| ZP-2 | Remove the readPixels / putImageData copy path. Faces render into per-face FBO textures (or an atlas) in the shared context at zoom-1 size, and only when their data changes. Every face renders upright, matching the old drawImage orientation. The flips at `gl-line-renderer.js` ~1700 and the UNPACK_FLIP_Y uploads stay as they are. New orientation smoke: paint the top red and the bottom blue, then assert both survive every present path (`nodeGraphPicturePresent`, `nodeGraphDisplayCanvasBlit`, `nodeGraphSharedGlBlitTo2D` at 512 px or less and above). | `readPixels` count 0 during the gesture. Orientation smoke passes | readPixels = 0 | open |
| ZP-3 | The GL graph is the only compositor: one on-screen WebGL canvas. During a gesture only the camera uniform changes; cached meshes are replayed and face quads draw from their textures (NEAREST above 2.5x). Separate "camera moving" from "displays held": with hold off, a gesture frame reuses the cached chrome, wire and plate meshes and only updates face textures. Overlaps GW-2 (camera) in `GPU_WORKSPACE_PLAN.md`, which owns the camera API. | No mesh rebuild and no glyph bake during the gesture | p90 < 20 ms | open |
| ZP-4 | Module HTML is frozen during gestures (a single container transform, or a hidden hit layer). CSS `zoom` and `--node-graph-zoom` are written once on settle. World boxes and text metrics are cached at rebuild. | `getComputedStyle` = 0 and `offset*` = 0 during the gesture | 0 / 0 | open |
| ZP-5 | Text drawn from a fixed-size or SDF glyph atlas. The bake size never depends on zoom. | No `nodeGraphGlLinesSetGlyphBakePx` change across a zoom | no re-bake | open |
| ZP-6 | Constraint guide and badges go into the cached mesh (no per-frame DOM reads). | No reads from these paths during the gesture | 0 reads | open |
| ZP-7 | `scripts/probe_zoom_perf.mjs` with `GATE=1` as a regression guard (fps floor plus zero forbidden reads). Run before any viewport, gl-graph or picture-device change lands. | Gate passes on softpop at about 60 fps | GATE=1 exit 0 | probe exists (ZP-1), gate open |

## Tracker

| Date | Stage | fps | p50 | p90 | readPixels | gCS | offset* | Commit |
|---|---|---|---|---|---|---|---|---|
| 2026-10-18 | ZP-1 (baseline) | 3.3 | 217 ms | 700 ms | 246 | 50,784 | 29,760 | (this commit) |
