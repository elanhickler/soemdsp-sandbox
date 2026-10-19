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
| ZP-3 | The GL graph is the only compositor: one on-screen WebGL canvas. During a gesture only the camera uniform changes; cached meshes are replayed and face quads draw from their textures (NEAREST above 2.5x). Separate "camera moving" from "displays held": with hold off, a gesture frame reuses the cached chrome, wire and plate meshes and only updates face textures. Overlaps GW-2 (camera) in `GPU_WORKSPACE_PLAN.md`, which owns the camera API. | No mesh rebuild and no glyph bake during the gesture | p90 < 20 ms | open |
| ZP-4 | Module HTML is frozen during gestures (a single container transform, or a hidden hit layer). CSS `zoom` and `--node-graph-zoom` are written once on settle. World boxes and text metrics are cached at rebuild. | `getComputedStyle` = 0 and `offset*` = 0 during the gesture | 0 / 0 | open |
| ZP-5 | Text drawn from a fixed-size or SDF glyph atlas. The bake size never depends on zoom. | No `nodeGraphGlLinesSetGlyphBakePx` change across a zoom | no re-bake | open |
| ZP-6 | Constraint guide and badges go into the cached mesh (no per-frame DOM reads). | No reads from these paths during the gesture | 0 reads | open |
| ZP-7 | `scripts/probe_zoom_perf.mjs` with `GATE=1` as a regression guard (fps floor plus zero forbidden reads). Run before any viewport, gl-graph or picture-device change lands. | Gate passes on softpop at about 60 fps | GATE=1 exit 0 | probe exists (ZP-1), gate open |

## Tracker

| Date | Stage | fps | p50 | p90 | readPixels | gCS | offset* | Commit |
|---|---|---|---|---|---|---|---|---|
| 2026-10-18 | ZP-1 (baseline) | 3.3 | 217 ms | 700 ms | 246 | 50,784 | 29,760 | d895e36a |
| 2026-10-18 | before ZP-2 (re-run, current tree) | 6.7 | 117 ms | 283 ms | 268 | 52,419 | 30,263 | - |
| 2026-10-18 | ZP-2 | 23.7 | 33 ms | 83 ms | 0 | 3,843 | 17,600 | 5ab0351f + ZP-2b |

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
  (about 110 ms per 3 s of play).
- Remaining gesture reads: `nodeGraphModuleLayoutBox` offset* (ZP-4) and occasional full presents
  (`SettleTextBake`, ZP-5).
- `trace-woscope.js` (BugsFix) keeps its uncommitted edits. ZP-2 did not need to touch it.
