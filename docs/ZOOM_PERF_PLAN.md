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
| ZP-2 | Remove the readPixels / putImageData copy path. Faces render into per-face FBO textures (or an atlas) in the shared context at zoom-1 size, and only when their data changes. Every face renders upright, matching the old drawImage orientation. The flips at `gl-line-renderer.js` ~1700 and the UNPACK_FLIP_Y uploads stay as they are. New orientation smoke: paint the top red and the bottom blue, then assert both survive every present path (`nodeGraphPicturePresent`, `nodeGraphDisplayCanvasBlit`, `nodeGraphSharedGlBlitTo2D` at 512 px or less and above). | `readPixels` count 0 during the gesture. Orientation smoke passes | readPixels = 0 | done 2026-10-18 (see ZP-2 result) |
| ZP-3 | The GL graph is the only compositor: one on-screen WebGL canvas. During a gesture only the camera uniform changes; cached meshes are replayed and face quads draw from their textures (NEAREST above 2.5x). Separate "camera moving" from "displays held": with hold off, a gesture frame reuses the cached chrome, wire and plate meshes and only updates face textures. Overlaps GW-2 (camera) in `GPU_WORKSPACE_PLAN.md`, which owns the camera API. | No mesh rebuild and no glyph bake during the gesture | p90 < 20 ms | done 2026-10-18 with ZP-4..6 (p90 16.8 ms; gesture = mesh replay, the HTML only gets one layer transform) |
| ZP-4 | Module HTML is frozen during gestures (a single container transform, or a hidden hit layer). CSS `zoom` and `--node-graph-zoom` are written once on settle. World boxes and text metrics are cached at rebuild. | `getComputedStyle` = 0 and `offset*` = 0 during the gesture | 0 / 0 | done 2026-10-18 (0 / 0, see ZP-4..6 result) |
| ZP-5 | Text drawn from a fixed-size or SDF glyph atlas. The bake size never depends on zoom. | No `nodeGraphGlLinesSetGlyphBakePx` change across a zoom | no re-bake | done 2026-10-18 (bake size from zoom-1 sizes at rebuild, floor 64 px) |
| ZP-6 | Constraint guide and badges go into the cached mesh (no per-frame DOM reads). | No reads from these paths during the gesture | 0 reads | done 2026-10-18 (built on constraint-gpu-1) |
| ZP-7 | `scripts/probe_zoom_perf.mjs` with `GATE=1` as a regression guard (fps floor plus zero forbidden reads). Run before any viewport, gl-graph or picture-device change lands. | Gate passes on softpop at about 60 fps | GATE=1 exit 0 | gate passes 2026-10-18 (57.7 fps, MIN_FPS 50, 0 reads mid-gesture) |

## Tracker

| Date | Stage | fps | p50 | p90 | readPixels | gCS | offset* | Commit |
|---|---|---|---|---|---|---|---|---|
| 2026-10-18 | ZP-1 (baseline) | 3.3 | 217 ms | 700 ms | 246 | 50,784 | 29,760 | d895e36a |
| 2026-10-18 | before ZP-2 (re-run, current tree) | 6.7 | 117 ms | 283 ms | 268 | 52,419 | 30,263 | - |
| 2026-10-18 | ZP-2 | 23.7 | 33 ms | 83 ms | 0 | 3,843 | 17,600 | 5ab0351f + ZP-2b |
| 2026-10-18 | ZP-4 (frozen HTML, cull, heatmap) | 58.3 | 16.7 ms | 16.7 ms | 0 | 13 * | 0 * | ZP-4 commit |
| 2026-10-18 | ZP-5 + ZP-6 | 57.7 | 16.7 ms | 16.8 ms | 0 | 0 * | 0 * | ZP-5/6 commit |

\* From ZP-4 on the probe splits the reads: the gesture itself (first wheel event until the last) and the one
settle after it. The table counts the gesture. The settle after the ZP-6 run: gCS 1,309, getBoundingClientRect
30, offset* 15,868 (one rebuild plus one geometry publish).

## ZP-2 note (2026-10-18, before any code)

ZP-2 is bigger than one stage. It is paused until Argi OKs the scope and the play-blit work in progress is
handed over.

- The copy path being replaced is uncommitted, live work (`?v=play-blit-2`: `picture-device.js`, `gl-graph.js`,
  `display-canvas.js`, `draw-orchestrator.js`, and `trace-woscope.js`, which is a BugsFix file). It was added
  because `drawImage` from the 4096 shared canvas resolved the whole buffer once per face per frame (Play at
  about 5 fps).
- Proposed shape: after a face renders into its region of the shared canvas, `copyTexSubImage2D` that region
  into a per-face texture (GPU to GPU, no stall), sized at zoom 1 and re-allocated only on resize. The GL graph
  draws face quads from that texture (the `glSnapshot` path in `drawImages`, plus a v-flip because framebuffer
  rows are bottom-up; image uploads use UNPACK_FLIP_Y false and are top-down). No 2D copy for faces the graph
  composites.
- Open question that sets the size: who else reads a face's 2D canvas pixels (perform-mode tiles, the mini
  view, the magnifier, Music Player pages, smokes that sample face canvases)? Each one must move to the
  texture, or the face keeps a 2D copy for it. That audit is the first ZP-2 task.
- Orientation smoke (parent request): paint the top red and the bottom blue, then assert both survive every
  present path, at 512 px or less and above.

## ZP-2 result (2026-10-18)

Argi: "Just take it over and start stage 2". Interface owns the play-blit path now.

Audit of everything that reads face pixels:
- **GPU consumers** go through `nodeGraphGlLinesImage` / `drawImages`: the GL graph (workspace and perform
  tiles), the mini perform view, the display-layer compositor, camera view and magnifier copies
  (`copyNodeGraphCanvasBitmap`), and the xy-pad. They now sample the face texture.
- **Snapshots** (`nodeGraphGlLinesSnapshot`: face resize hold, burn hold) copy the face texture.
- **TV cable publish** (`nodeGraphPicturePublishCanvas`) blits from the face texture (flipped to FBO rows).
- **2D readers:** `nodeGraphGlGraphPresentDisplaysOnly` (2D drawImage onto the dots layer) is replaced by a
  mesh replay. The phosphor drawer's `lighter` composite is kept by blending into the face texture.
  `smoke_engine_state_stopped_faces` reads `nodeGraphSharedGlFacePixels`.
- **On-screen 2D canvases** (not `.node-display-canvas` inside `#nodeGraphWorkspace.gl-graph-on`) still get the
  HEAD drawImage from the shared canvas as well.

Design: `nodeGraphSharedGlCopyToContext` (picture-device) copies the source rectangle into a scratch texture
(`copyTexSubImage2D`), then draws it into a per-face FBO texture at the face canvas size, v-flipped to top-down,
with the destination context's composite mode and globalAlpha. It runs only when a face presents. The GL graph
replays its cached mesh (camera uniform, NEAREST above 2.5x chosen at replay time) for display frames (dots
layer) and for gesture frames (all layers), so displays keep running while zooming with no rebuild.

| softpop, ArchIV | play-only fps | play readPixels / 3 s | zoom fps | p50 | p90 | gCS | offset* | texImage2D(canvas) |
|---|---|---|---|---|---|---|---|---|
| before | 55 | 1005 (853 ms) | 6.7 | 117 ms | 283 ms | 52,419 | 30,263 | 2501 ms |
| after | 60 | 0 | 23.7 | 33 ms | 83 ms | 3,843 | 17,600 | 215 ms |

musicplayer after: play 60 fps; zoom 42 fps, p50 17 ms, p90 33 ms.

Smokes: `smoke_display_face_orientation.mjs` (new, 65 gates: 4 present paths x 64/600 px x texture-only/DOM,
the face itself and a GL consumer, no readPixels), `smoke_display_gl_programs_link`, `smoke_display_gl_renderers`
(allowlist entry moved from BlitTo2D to CopyToContext), `no_fallback`, `phase3c`, `controller_faces_gl` and
`smoke_engine_state_stopped_faces` pass (the last one passed on a re-run: one run failed the music-player
pages 'playinfo'/'vslr' engine-state check, and those pages show `stopped` when probed directly).
`smoke_display_gl_batch` (4) and `smoke_display_gl_phase3` (3) fail the same way on a clean HEAD worktree.

Left open for later stages:
- Mid-gesture, the scope light layer (`#nodeModuleScopeLightCanvas`) shows a soft glow blob that is not there
  when settled. The light pass draws from layout rects that are frozen during the gesture (ZP-4).
- Waterfall ink overlays (`.node-waterfall-ink-overlay`, a 2D canvas) are re-uploaded about 3 times per frame
  (about 110 ms per 3 s of play). Done 2026-10-18, see "Waterfall ink on the GPU" below.
- Remaining gesture reads: `nodeGraphModuleLayoutBox` offset* (ZP-4) and occasional full presents
  (`SettleTextBake`, ZP-5).
- `trace-woscope.js` (BugsFix) keeps its uncommitted edits. ZP-2 did not need to touch it.

## ZP-4..ZP-6 result (2026-10-18)

Measured on ArchIV, softpop, play on, slow wheel zoom 1x -> 40x -> 1x (`probe_zoom_perf.mjs`):

| | play fps | play gCS / 3 s | zoom fps | p50 | p90 | p99 | readPixels | gCS | gBCR | offset* |
|---|---|---|---|---|---|---|---|---|---|---|
| ZP-2 | 60 | 26,588 | 20.7-23.7 | 33 ms | 83 ms | 267 ms | 0 | 3,843-4,950 | 199 | 17,896 |
| ZP-6 | 60 | 0 | 57.7 | 16.7 ms | 16.8 ms | 33 ms | 0 | 0 | 0 | 0 |

musicplayer: zoom 60 fps, 0 reads. `GATE=1 node scripts/probe_zoom_perf.mjs softpop` passes.

What changed:
- **ZP-4, frozen module HTML** (`node-graph-viewport-perf.js`). The CPU profile showed the cost was CSS `zoom`
  written on every module every frame (`nodeGraphPositionGridHtml`): a full relayout per frame, which fired
  the resize observers (filter curve measure, seed fit, slider widths, face metrics). Mid-gesture no module
  style is written now: each module keeps the zoom and translate it had at gesture start, and one transform
  per world/text layer (`translate(o - o0 * s) scale(z / z0)`) carries the HTML from the frozen camera to the
  live one, so hit targets stay on the GPU plates (0.1 px). The settle (`clearNodeGraphViewportGestureClass`)
  thaws: CSS zoom, `--node-graph-zoom` and the module transforms are written once, then one cull runs.
- **Cull deferred to the settle.** The geometric cull and the IntersectionObserver no longer sleep or wake
  modules while the HTML is frozen (each sleep/wake is a module relayout). GPU plates are drawn for every
  module anyway. A module that was asleep when the gesture started shows its plate mid-gesture and its face
  after the settle.
- **Light blob fixed.** It was not the scope light canvas but `#nodeGridHeatmap`: the module glows are
  screen-space radial gradients built on the last full update and never moved mid-gesture, so the zoom-1
  glows (a grid of small blobs) stayed under the zoomed picture. A once-a-frame `updateNodeGraphGridHeatmap
  ({ camera: true })` pass now rebuilds glows, mask, grid cell and phase from the cached module bounds. The grid
  lines take their size from the JS cell (`--node-grid-heatmap-grid-size`, same value as before) instead of
  `--node-graph-zoom`, which is settle-only.
- **Cached reads.** Slider widths keep their last value while frozen (hidden sliders measured 0 and were
  re-measured with getBoundingClientRect every ghost-slider frame). Workspace layout metrics are reused while the
  size and classes are unchanged. Heatmap tuning vars reuse the last value mid-gesture.
- **`gl.isTexture` removed from `drawTexts`.** It is a synchronous GPU round trip per text run (about 4 ms a
  frame on replays). Retired atlases are marked when they are deleted.
- **ZP-5, fixed glyph bake.** The bake size is computed at rebuild from zoom-1 text sizes (floor 64 px, cap
  384) and never from the zoom. Slider label/value/unit font sizes and unit colour, the seed value size and the
  ghost/seed line colours are read at rebuild, not per present. The plate stroke vars and wire thickness are
  read once per rebuild generation. Play went from about 26k getComputedStyle calls per 3 s (ghost sliders
  trigger a full present most frames) to 0.
- **ZP-6, constraint marks.** Badge world boxes are collected at rebuild; the badges draw into the veil batch,
  so they ride the cached mesh. The guide HUD is a screen overlay: it draws once per rebuild and when the
  toggles/metrics call it, and never mid-gesture (it marks itself dirty and redraws on the settle rebuild).
  Built on the uncommitted constraint-gpu-1 work and committed with it.

Real-mouse check right after a zoom: `scripts/smoke_zoom_settle_input.mjs` (new). Wheel to 3.4x with real
wheel events, assert the frozen HTML sits on the GL plates mid-gesture and after the settle (worst 0.08 px),
every module has the live CSS zoom after the settle, then drag a slider, drag a module by its title and drag
a cable output -> input with the real mouse. All pass.

Smokes: orientation, programs_link, renderers, no_fallback, controller_faces_gl, stopped_faces,
face_text_container_scale and the new zoom-settle smoke pass. `smoke_display_gl_batch` (4), `phase3` (3) and
`smoke_gl_text_emoji` (2) fail the same way on a clean HEAD worktree.

Still open:
- **Settle hitch.** The settle is one frame of 150-230 ms: CSS zoom on every module, one cull, one geometry
  publish and one GL rebuild (about 16k offset* reads). Next step: cache chrome boxes relative to their module
  and re-read only modules whose size changed.
- Mid-gesture the GL picture shows slider readouts as of the gesture start (the mesh replays; ghost-slider
  values update on settle). Displays keep running.
- Waterfall ink overlay uploads (`texImage2D(canvas)`, about 60 ms per second of gesture) are still there.
- `trace-woscope.js` (BugsFix) still has uncommitted edits from another agent. ZP-4..6 did not touch it.

## Waterfall ink on the GPU (2026-10-18)

The face ink (Output pause / protect marks, RMS dB guides) was a second 2D canvas stacked on every trace face
(`.node-waterfall-ink-overlay`, 9 on softpop). The GL graph composited each one by `texImage2D(canvas)` every
frame (about 4,100 uploads per probe run, 128 ms per 3 s of play), and fade frames uploaded it once more into the
waterfall history (`nodeGraphWaterfallGlStampCanvas`).

Now the ink is drawn by GL straight into the waterfall face: `nodeGraphWaterfallGlPresent` draws the history quad,
the onset position line and then the ink (`nodeGraphFaceInkDraw` -> `nodeGraphGlLinesDrawInto`, a gl-line-renderer
batch drawn into the bound framebuffer without clear or copy) in one pass; fade frames burn the same batch into the
history FBO (`nodeGraphWaterfallGlStampInk`). No overlay canvas, no 2D context, no upload. GL failure goes through
`nodeGraphDisplayGlFailed`. The onset position line was drawn after the face copy before, so it never reached the
face; it is drawn in the present pass now.

Why the guards missed it: `smoke_display_gl_renderers` only looked for `getContext('2d')` and 2D draw calls. The
overlay's 2D surface came from the allowlisted shared helper (`endBatch`), the overlay was made with a bare
`createElement("canvas")`, and the uploads (`texImage2D(canvas)` in `drawImages` and in the waterfall stamp) were
not scanned. `smoke_display_gl_no_fallback` only greps for fallback wording. Fix: the renderer scan now also flags
`texImage2D`/`texSubImage2D` with a DOM source (6 / 7 args) and canvases stacked over a face; one-time atlas bakes,
`<img>`/snapshot uploads and the face-texture seed are listed as UPLOAD. New runtime smoke
`smoke_display_no_canvas_upload.mjs`: no canvas is uploaded repeatedly while playing (except Audio Player playlist,
Sequencer, Transport), no overlay canvas, pause bars in the Output face's GPU picture, RMS guides armed. Both fail
on the old code.

Softpop after: play 60 fps, no `texImage2D(canvas)` time; zoom 57.8 / 57.3 fps (two runs), p50 16.7 ms, 0 reads
mid-gesture.
