# WebGL Display Plan: one shader path for every module display

**Status: Phase 1 in progress (2026-10-15 Grok Bot). Helper, marker CSS rule, smoke check + allowlist landed; first batch converted (section 7). Needs visual check.**
**Policy:** `docs/APP_POLICY.md` section 3 (Module displays: WebGL2 + shaders only).
**Owner:** Interface (faces), PlanningDocs (plan, allowlist bookkeeping).

## 1. Policy
- Every module display draws with **WebGL2 + shaders**. No canvas 2D drawing, no CPU pixel loops for the picture.
- **Preferred primitive:** shader-expanded quads with smootherstep edges. Each line/rect/dot is a quad; the fragment shader takes the distance to the shape and fades it over `feather` px past `halfPx`:
  `a = 1 - smootherstep(halfPx, halfPx + feather, dist)` (Perlin quintic). Thickness never depends on fractional pixel position. Fills are the same quads with an infinite `halfPx`. Phosphor keeps gaussian/erf. General-line faces expose Display Settings `lineSmoothing` (CSS px of `feather`, 0–8, default 1). Cables keep a fixed 2 CSS-px fade.
- **One drawing interface:** `public/lib/visual/gl-line-renderer.js`
  - `nodeGraphGlLinesBegin(canvas, clearRgba)` -> batch (or `null`)
  - `nodeGraphGlLinesRect(batch, x, y, w, h, rgba)`
  - `nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba)`
  - `nodeGraphGlLinesPolyline(batch, points, halfPx, feather, rgba)`
  - `nodeGraphGlLinesEnd(batch, blend)`
  It draws on the **single shared WebGL2 context** owned by `public/lib/visual/picture-device.js` (`nodeGraphSharedGlDevice`) and presents into the face canvas. No module creates its own WebGL context.
- **No canvas 2D fallback.** If WebGL2 is missing, the context is lost or a shader fails, `begin()` returns `null` and the display shows **black** (`nodeGraphGlLinesFillBlack`). Nothing else.
- The only `getContext("2d")` allowed is the shared present/blit inside the shared helpers (`picture-device.js` `nodeGraphSharedGlBlitTo2D`, and the shared display-canvas helper in section 4). Modules never call it.
- **Exceptions** only where a shader genuinely is not worth it, and only if listed in section 5 with Argi's OK.
- New primitives (circle/SDF dot, textured quad for pictures and glyph atlases, gradient fill) are added **to gl-line-renderer.js**, not to a module.

## 2. Already on WebGL2
| Module | Face | Notes |
|---|---|---|
| `reverbEffect` (Sabrina Reverb) | `public/modules/reverbEffect/sabrina-reverb-gl.js` | gl-line-renderer, matches the CLAP plugin's kLineFrag |
| `softpopOscillator` / `softpopFilter` (Softpop) | `public/modules/softpopOscillator/softpop-display.js` | gl-line-renderer; both Softpop modules share the `softpopFace` renderer |
| `slewLimiter` (Up/Down shape) | `public/modules/slewLimiter/slew-shape-display.js` | gl-line-renderer |
| `additiveGenerator`, `additiveGrowl`, `additiveBlaster`, `additiveGraph` | waveform / bubble / blaster / filter-curve faces | 2026-10-15 batch 1 (section 7) |
| `lookaheadLimiter` | Instant Waterfall (own GL path) | dead Canvas2D fallback removed 2026-10-15 |

## 3. Migration inventory (grep of `public/modules`, 2026-10-14)
Method: per module folder, any `.js` with `getContext("2d")`, `createElement("canvas")`, or use of the shared GL device. Two folders (Sabrina, Softpop) are already done, which leaves **39 modules** to migrate.
- **2D:** draws the face with canvas 2D. Port to gl-line-renderer.
- **Partial:** already renders on the shared GL device but still has 2D code (atlas bakes, overlays, fallbacks). Remove the 2D path.
- **GL via cycle-line-gl:** already GL on the shared device but through its own renderer (`public/lib/visual/cycle-line-gl.js`). Fold into gl-line-renderer so there is one interface.
- **Own canvas, 2D via filter-curve path:** the module creates its own canvas and draws via the shared filter-curve/scope 2D path. Port to gl-line-renderer.

| # | Module | Files | Today | Notes |
|---|---|---|---|---|
| 1 | `additiveBlaster` | `additive-blaster-display.js` | 2D | bars/curves -> rect/polyline |
| 2 | `additiveGenerator` | `additive-waveform-display.js` | 2D | waveform -> polyline |
| 3 | `additiveGraph` | `additive-filter-curve-display.js` | 2D | curve -> polyline |
| 4 | `additiveGrowl` | `additive-bubble-display.js` | 2D | bubbles -> quads (circle SDF) |
| 5 | `arp` | `arp-display.js` | 2D | grid/steps -> rect |
| 6 | `asciiscope` | `asciiscope-display.js`, `asciiscope-gl.js`, `asciiscope-ui.js` | Partial (shared GL + 2D) | 2D glyph atlas bake; atlas may stay a texture upload (see exceptions) |
| 7 | `attackDecay` | `attack-decay-display.js` | Own canvas, 2D via filter-curve path | envelope curve -> polyline |
| 8 | `audioPlayer` | `audio-player-playlist.js` | 2D | playlist text; proposed exception |
| 9 | `basicShape` | `basic-shape-display.js` | GL via cycle-line-gl (own renderer) | fold cycle-line-gl into gl-line-renderer |
| 10 | `ellipsoid` | `ellipsoid-display.js` | 2D |  |
| 11 | `ensemble` | `ensemble-cloud-display.js` | 2D | dot cloud -> quads |
| 12 | `fbmField` | `fbm-field-gl.js`, `fbm-field-ui.js` | Partial (shared GL + 2D) | remove 2D path |
| 13 | `gradientVectorscope` | `gradient-vectorscope-display.js` | 2D |  |
| 14 | `harmonicLines` | `harmonic-lines-display.js`, `harmonic-count-display.js` | 2D | two faces |
| 15 | `harmonicSeries` | `harmonic-series-display.js` | 2D | bars -> rect |
| 16 | `imageBurn` | `image-burn-display.js`, `image-burn-gl.js`, `image-burn-ui.js` | Partial (shared GL + 2D, 12 2D contexts) | largest 2D user |
| 17 | `knob` | `knob-face.js` | GL | native GL dial (`_shared/controller-face-gl.js`); Slider / Toggle / Momentary share it |
| 18 | `lookaheadLimiter` | `lookahead-limiter-display.js` | 2D | meter -> rect |
| 19 | `matrixDisplay` | `matrix-display-display.js`, `matrix-display-ui.js` | 2D | LCD cells -> rect |
| 20 | `numberReadout` | (`number-readout-gl.js` deleted 2026-10-15: unused) | Done | digit bake in `lib/visual/glyph-sdf-atlas.js` |
| 21 | `phoneTone` | `phone-tone-display.js` | 2D |  |
| 22 | `rasterRgb` | `raster-rgb-display.js` | Partial (shared GL + 2D) |  |
| 23 | `rgbFractal` | `rgb-fractal-display.js`, `rgb-fractal-gl.js`, `rgb-fractal-ui.js` | Partial (shared GL + 2D) |  |
| 24 | `rgbPicture` | `rgb-picture-display.js`, `rgb-picture-ui.js` | 2D | picture -> texture quad |
| 25 | `rgbShape` | `rgb-shape-display.js`, `rgb-shape-ui.js` | 2D |  |
| 26 | `sequencer` | `sequencer-ui.js` | 2D | step grid; proposed exception |
| 27 | `sinCos` | `sin-cos-display.js` | GL via cycle-line-gl (own renderer) | fold cycle-line-gl into gl-line-renderer |
| 28 | `sineWavetable` | `sine-wavetable-display.js` | 2D |  |
| 29 | `softClipper` | `soft-clipper-display.js` | Own canvas, 2D via filter-curve path | transfer curve -> polyline |
| 30 | `softwaveOsc` | `softwave-osc-display.js` | GL via cycle-line-gl (own renderer) | fold cycle-line-gl into gl-line-renderer |
| 31 | `spectrogram` | `spectrogram-display.js (+ spectrogram-gl.js)` | Partial (shared GL + 2D) |  |
| 32 | `spectrum1d` | `spectrum1d-display.js` | 2D | spectrum -> polyline/rect |
| 33 | `speedColorInertia` | `speed-color-inertia-display.js` | 2D |  |
| 34 | `transport` | `transport-display.js` | 2D | text/status; proposed exception |
| 35 | `vectorRgb` | `vector-rgb-display.js` | 2D |  |
| 36 | `videoDelay` | `video-delay-display.js`, `video-delay-ui.js` | Partial (shared GL + 2D) |  |
| 37 | `videoFeedback` | `video-feedback-display.js`, `video-feedback-ui.js` | Partial (shared GL + 2D) |  |
| 38 | `wallDelay` | `wall-delay-room-display.js` | 2D | room drawing -> segment/rect |
| 39 | `xyPad` | `xy-pad-ui.js` | 2D | pad + dot -> rect/quad |

Counts: 25 x 2D, 9 x Partial, 3 x GL via cycle-line-gl, 2 x own canvas / filter-curve path.
Shared code outside `public/modules` that also needs moving: `public/lib/visual/cycle-line-gl.js` (merge), `public/lib/visual/filter-curve-face.js` (2D path), `public/node-graph-module-scope-canvas.js` (light canvas 2D). Scope/waterfall/trace faces in `public/node-graph-module-scope-*` are a separate later pass (not counted above).

**Suggested order:** (1) the 3 cycle-line-gl modules (already GL, proves the merge); (2) simple curve/bar faces (additive*, harmonic*, spectrum1d, lookaheadLimiter, softClipper, attackDecay); (3) the 9 Partial modules; (4) the rest; (5) decide exceptions.

## 4. Enforcement (landed 2026-10-15; see section 7)
1. **One shared display-canvas helper** (new, in `public/lib/visual/`, e.g. `display-canvas.js`): creates the face canvas, applies the shared sizing path (backing = layout CSS box x devicePixelRatio, never x workspace zoom; APP_POLICY 15) and adds one **marker class** (e.g. `node-display-canvas`). `styles.css` adds that class to the `.node-graph-workspace.pixelated-canvas-zoom ...` rule so **>2.5x zoom pixelation applies automatically** (`node-graph-viewport-perf.js` toggles the workspace class at zoom > 2.5). The per-module canvas classes in that rule shrink away as modules move over.
2. **`scripts/smoke_test.py` check** (`check_module_displays_use_shared_gl`): scans `public/modules/**/*.js` and fails on any `getContext("2d")`, `getContext("webgl...")`, or `createElement("canvas")` in a file that is **not** on an allowlist. The allowlist starts as exactly the files in section 3 and is **shrink-only**: the check also fails if an allowlisted file no longer needs its entry (so the entry must be deleted), and new entries are never added. A new module that draws its own canvas fails the smoke test.

## 5. Exceptions (explicit, none approved yet)
Proposed for Argi's call, because they are text/UI widgets rather than pictures: `audioPlayer` playlist, `sequencer` step UI, `transport` status. (`knob` was proposed, then converted to native GL with Slider / Toggle / Momentary.) Glyph atlases (`asciiscope`, `numberReadout`) may bake text once with 2D into a texture; that bake would live in the shared helper, not the module. Until approved, they stay on the shrink-only allowlist as debt.

## 6. Done when
- Section 3 table is empty, the allowlist holds only approved exceptions, and the smoke check passes.
- `cycle-line-gl.js` is merged into gl-line-renderer.js.
- Turning WebGL off shows black squares, never a 2D drawing.

## 7. Phase 1 log (2026-10-15, Grok Bot)
- **Helper:** `public/lib/visual/display-canvas.js` — `nodeGraphDisplayCanvasCreate(className)`, `nodeGraphDisplayCanvasSize(section, canvas)`, `nodeGraphDisplayCanvasMark(canvas)`. Marker class `node-display-canvas` is also added by `nodeGraphSizeDisplayCanvas`, the module face canvas (`node-graph-module-scope-face-canvas.js` create + sync), and the core canvases that were on the old CSS list (cookbook filter, number readout, phosphillator, pulse explosion, sample waveform, waterfall ink overlay, `#...node-module-scope-canvas` in index/perform.html). Every `public/modules/**` `createElement("canvas") + className` now goes through the helper.
- **CSS:** the 22-selector `.pixelated-canvas-zoom` list in `styles.css` is now one rule: `.node-graph-workspace.pixelated-canvas-zoom .node-display-canvas`. Asciiscope (JS-controlled Sharp/Pixel) and the spectrogram smooth-at-1x rule are unchanged. Dropped stale selectors with no creator: `node-phosphor-light-canvas`, `node-evolve-field-canvas`.
- **Renderer:** `gl-line-renderer.js` gained `begin(canvas, clear, { scale })` (CSS-px coords), `nodeGraphGlLinesImage` (textured quad, RGBA8 buffer or TexImageSource, nearest/linear, drawn under the quads), `nodeGraphGlLinesCss` / `nodeGraphGlLinesHsl` colour helpers.
- **Smoke:** `check_display_gl_contract()` in `scripts/smoke_test.py` + shrink-only `scripts/display_gl_allowlist.txt` (each entry has a reason). Allowlist: 57 offending files before (clean tree 4b33aa4b), **41** after. `scripts/smoke_display_gl_batch.mjs` covers batch 1 with a fake GL device (GL draw, no 2D, black when GL is missing).
- **Batch 1 converted (2D code removed):** Additive Generator waveform, Additive Bubble waveform, Additive Blaster blocks, Additive filter curve (Linear/Butterworth/Ladder), Lookahead Limiter (dead 2D fallback). Their tiny "—" / "no Graph" text placeholders became a dim centre dash (no text primitive yet).
- **Not done here:** `cycle-line-gl.js` merge (Basic Shape / SinCos / Softwave), filter-curve-face.js (Attack Decay, Soft Clipper), everything in section 8.

## 8. Remaining inventory, ranked (2026-10-15)
Effort: **S** < 1 h, **M** a few hours, **L** a day+. Every row is on the allowlist unless noted.

| Rank | Module / file | Today | Effort | Plan |
|---|---|---|---|---|
| 1 | `spectrum1d` | 2D on face canvas | S | polyline/rects |
| 2 | `phoneTone` | 2D curve + own pixelation | S | polyline |
| 3 | `harmonicSeries` | 2D bars | S | rects |
| 4 | `harmonicLines` (lines face) | 2D curves | S-M | polyline; Count face is text (needs atlas) |
| 5 | `sineWavetable` | 2D curves + own sizing | S-M | polyline |
| 6 | `ensemble` | 2D dot cloud | S-M | zero-length capsules = round dots |
| 7 | `speedColorInertia` | 2D colour plate; **file not loaded** by index/perform.html | S | delete or one rect (Argi) |
| 8 | Basic Shape / SinCos / Softwave (`cycle-line-gl.js`, not allowlisted) | GL, own renderer | M | fold into gl-line-renderer |
| 9 | Attack Decay / Soft Clipper (`filter-curve-face.js`, outside modules) | 2D shared path | M | port filter-curve-face once, both follow |
| 10 | `ellipsoid`, `arp`, `wallDelay`, `rgbShape`, `matrixDisplay` | 2D faces | M | rects/segments/polylines |
| 11 | `xyPad` | 2D, interactive | M | rects + dot |
| 12 | `rgbPicture` | 2D blit | M | `nodeGraphGlLinesImage` |
| 13 | `fbmField`, `rasterRgb`, `rgbFractal`, `spectrogram`, `vectorRgb`, `videoDelay`, `videoFeedback` | Partial: GL + 2D fallback / own sizing | M each | delete fallback, present via shared helper |
| 14 | `gradientVectorscope` | TraceWoscope/2D then trails | M-L | needs trace pass |
| 15 | `numberReadout`, `asciiscope` | Partial: 2D glyph-atlas bake | M-L | shared atlas bake helper (one 2D bake in lib, not module) |
| 16 | `imageBurn` | Partial, 12 2D contexts (decode, dry flash, fallback) | L | image decode can stay `createImageBitmap` -> texture |
| — | `audioPlayer`, `sequencer`, `transport` | Text/UI widgets | ? | **proposed exceptions, Argi decides** |
| — | Scope / waterfall / trace faces in `public/node-graph-module-scope-*` | own paths | L | separate pass; `trace-woscope.js` and Phosphor are BugsFix's (exceptions until they say) |

**Text:** no text primitive. Recommended: one shared glyph atlas (reuse `number-readout-gl.js` SDF/EDT bake, moved into `public/lib/visual/`), drawn as image/SDF quads through gl-line-renderer. The one-time atlas bake may use a 2D canvas inside the shared lib only.

## 9. RGBA picture outputs (Argi, 2026-10-15; plan only)
- **Transport today:** `nodeGraphPicturePublish` copies a producer texture into a per-node RGBA8 FBO texture with blending off (`picture-device.js`), and `nodeGraphPictureRead` hands that texture to consumers. The device is `alpha: true, premultipliedAlpha: false`, so the wire **can** carry straight alpha end to end.
- **In practice it is RGB:** every publisher's final shader writes `alpha = 1.0` (fbm_field.frag, raster_rgb composite/source, rgb-fractal-gl, image-burn-gl present, video-delay-gl, video-feedback-gl). Consumers (Video Delay / Feedback `uHasPic` sample) never use the alpha. gl-line-renderer also forces opaque alpha (`blendFuncSeparate(..., ONE, ONE)` + opaque clear).
- **Real publishers (6):** fbmField, imageBurn, rgbFractal, rasterRgb, videoDelay, videoFeedback. **Declared but not published:** rgbShape (`rgba` out in its register), plus the `rgba` outs in `node-graph-module-definitions.js` (~lines 16647, 17344). Uppercase `RGBA` outs (~16346, 16355, 16407) are **not** TV taps: `isTvPort` only accepts `rgba` / 📺.
- **Should get an `rgba` out** (any face that is a picture, not a UI widget): Sabrina Reverb, Softpop, Slew shape, the Additive faces, Spectrogram, Spectrum 1D, Vector RGB / Gradient Vectorscope, RGB Shape, RGB Picture, Matrix, Ensemble cloud, Wall Delay room, XY Pad, Instant Waterfall / Sidechain / Limiter Gain. Not: Number Readout / transport / sequencer / audio player / knob.
- **Cheap path on the single context:** add `options.publishNodeId` to `nodeGraphGlLinesEnd`. When set, draw the batch into that node's export FBO (`ensureExport` in picture-device, same size as the face) instead of the default framebuffer, then present the face by blitting that texture (`nodeGraphPicturePresent`). One extra full-screen copy per frame, no readback. For real alpha: clear to `[0,0,0,0]` and use `blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)` for the export pass; the face present composites over its plate colour. Only publish when an `rgba` cable is connected (`nodeGraphPictureRead` already walks cables) so idle faces pay nothing.

## 10. Phase 2 log (2026-10-15)

Allowlist: 57 (pre phase 1) -> 41 (phase 1) -> 32 (phase 2). `smoke_test.py` passes.

### Approved exceptions (Argi 2026-10-15)
Audio Player, Sequencer, Transport stay non-WebGL. Marked
`APPROVED EXCEPTION (Argi 2026-10-15)` in `scripts/display_gl_allowlist.txt`.
Also excluded: `trace-woscope.js` and Phosphor (owned by BugsFix; not touched).

### Controller faces (Knob, Slider, Toggle, Momentary)
Native WebGL controls in `modules/_shared/controller-face-gl.js`: smoothstep
quads / polylines + glyph-atlas text on the shared context, layout a pure
function of the face box (zoom-1 layout; a 2x tile is exactly 2x). DOM keeps
only transparent hit / edit elements over layout rects. Knob dropped its
image layers and left the allowlist (4 -> 3). Smoke:
`scripts/smoke_controller_faces_gl.mjs`.

### Unified renderer (`lib/visual/gl-line-renderer.js`)
- New primitives: Triangle, FillUnder, Dot, Image.
- Shared glyph atlas + `nodeGraphGlLinesText(batch, text, x, y, {px, rgba, align, baseline, maxWidth, family, weight})`,
  `nodeGraphGlLinesMeasureText`. Atlas baked once at 64 px (mipmapped), tinted in shader.
- `lib/visual/glyph-sdf-atlas.js`: the SDF digit bake moved out of number-readout-gl.js (shared text infra).

### Converted
harmonic-count (GL text), phone-tone, harmonic-series, harmonic-lines, spectrum1d,
ensemble (row history as rects), sine-wavetable, number-readout-gl (bake moved to lib; 1:1 blit).
Real text restored where placeholders were: "—" on Additive Waveform/Bubble, "no Graph" on Blaster.
Deleted `speedColorInertia/speed-color-inertia-display.js` (never loaded). `speedColorInertiaFace`
displayType still named in module definitions (harmless leftover).

### RGBA with true alpha (section 9 implemented)
- Wire convention: **premultiplied RGBA**. Opaque sources unchanged.
- `nodeGraphGlLinesEnd` renders into `nodeGraphPictureExportTarget(nodeId)` (clear 0,0,0,0, alpha-preserving
  blend) only when `nodeGraphPictureHasConsumer(nodeId)`; the face is presented from that texture over the plate.
  Node id from `batch.publishNodeId` or closest `.dsp-node`/`[data-node]`.
- 2D bridge `nodeGraphPicturePublishCanvas` (flip + premultiply on upload) for faces not yet on GL
  (rgbShape, spectrogram).
- `rgba` outs added: reverbEffect (Sabrina), softpopOscillator, softpopFilter, slewLimiter, additive
  Generator/Bubble/Blaster/LinearFilter/LadderFilter/Out, spectrum1d, ensemble, sineWavetable.
- Consumers: picture present + Video Delay unpremultiply/respect alpha. Native worklet skips TV cables.
- Caveats: Image Burn and Raster consumers still treat input as opaque/straight. New jacks may grow
  module height (check layouts). Saved patches load (outs appended, no renames).

### Left
32 allowlisted files (see allowlist; 4 approved exceptions). Core
`node-graph-module-scope-number-readout.js` still has its Canvas2D fallback path.
Medium batch not started this phase.

## 11. Phase 2: circuit builder to GL (planned, 2026-10-16)

Owner: another agent executes. Status: **GB-1 through GB-5 measured** (2026-10-16). Source: Interface/Argi.
(Not the same as section 10 "Phase 2 log", which covers module displays.)

### Why
On ArchIV with softpop, zooming out from ~40x is GPU-bound: Chrome redraws the HTML graph
(~2.7k elements, ~1,400 raster jobs at ~4 ms each, ~5.5 s per gesture). CSS fixes are exhausted
(removing shadows/filters saved only 12%; oversized layers and display resizes ruled out).
Zoom-in and pan are already fixed by a will-change hint + display hold during gestures
(since committed and pushed (checked 2026-10-18)).

### Tracker
| ID | Stage | Status |
|----|-------|--------|
| GB-1 | Cables and grid drawn in screen space with a camera matrix, replacing wire SVGs and the grid background; pan/zoom only change a uniform | testing. Always on (the `?glGraph=0` switch no longer exists in code, checked 2026-10-18; leftover SVG wire code is deleted in `docs/GPU_WORKSPACE_PLAN.md` GW-5). Look is approximate (flat cables, coarse grid when zoomed out). |
| GB-2 | Module bodies: plates, borders, rounded corners, shadows as batched GL quads; existing display canvases become textures placed in the same pass | testing. Plates, border, and shadow are GL rects (square corners). Display canvases are textures in the same pass. HTML titles, jacks, and sliders stay. |
| GB-3 | Jacks, labels, slider readouts: jacks/dots as GL sprites, text via the shared glyph atlas | testing. Jacks, titles, port labels, and slider tracks/readouts draw in the graph pass. HTML stays as the click target. |
| GB-4 | HTML only for text inputs and popups, positioned from the camera; hit-testing in JS against module rectangles | testing. Module chrome does not take hits. Clicks resolve against plate, jack, slider, and title rectangles and call the existing drag, wire, and menu actions. Text fields, popups, and special faces (graph, keypad, knob) stay HTML. |
| GB-5 | Measure every stage with the same zoom-in / zoom-out / pan traces at 40x and low zoom | measured 2026-10-16, `nodeGraphGlGraphMeasureGb5()`, 24 frames each, same numbers on a second run. Zoom-out 40→0.35: total 201 ms, present 40 ms, max frame 41 ms. Zoom-in 0.35→40: total 86 ms, present 38 ms, max frame 8 ms. Pan at 40×: total 53 ms, present 20 ms, max frame 3 ms. Pan at 0.35×: total 100 ms, present 35 ms, max frame 13 ms. The old HTML zoom-out gesture was about 5.5 s. |
| GB-6 | True GPU camera (Argi approved 2026-10-18). Defined only in `docs/GPU_WORKSPACE_PLAN.md` as GW-2 (spec, acceptance; lands before phone PH-6). | planned |

Note (2026-10-18): GB-1's "pan/zoom only change a uniform" is **not yet met**. Today the GL pass reprojects cached geometry on the CPU on every camera change, and the HTML world layers move by a CSS transform. GB-6 completes it.

All stages run on the shared picture-device context. Each stage ships behind a flag and is measured
(GB-5) before the next. Stage 1 alone won't fix zoom-out; the gain comes in stages 2-3.

### Policies
- Zoom-1 layout is the source of truth; the camera only scales it.
- No 2D fallbacks: on GL failure go black and log via `nodeGraphDisplayGlFailed`.
- Jack labels use inward arrows.
- Port labels are `<name> L/R` (bare Mono/Left/Right OK).

### Shared glyph atlas
GB-3 needs a shared glyph atlas, and so does the Music Player Text Box
(`docs/MUSIC_PLAYER_METADATA_PLAN.md`, MM-5). Build one atlas for both.

### Open question for Argi
- Should module text be pixelated above 2.5x like displays, or stay sharp?

## 12. Display shaders (merged from `docs/DISPLAY_SHADER_PLAN.md`, 2026-10-18)

Formerly its own file; moved here unchanged except heading levels, so this plan is the one home for display GPU work. Section references like "§Face wipe registry" or "P0a" now mean the subsections below.

**Status:** living tracker for moving display per-pixel work out of JavaScript (and off CPU/WASM fill-grid) into GLSL. M1–M10 landed (need visual check). Phase 0 infra, G-rows (`.vert` / `.frag` next to wasm), and **W-rows (one Stop/bypass face-wipe registry)** wait for Argi go on each row.

**Date:** 2026-10-06. Source: Argi via LibraryCode. GLSL-on-disk: 2026-10-09 Argi. Face wipe registry: 2026-10-09 Argi.

**Related:** `docs/APP_POLICY.md` (no JS DSP, no GPU audio, no worklet / JS special cases); `docs/BUG_PLAN.md` → **Cleanup** → **C-001** (JS DSP removal; overlaps P0e-1); `docs/archive/SCOPE_PAINT_SIMPLIFICATION_PLAN.md`; `docs/SCOPE_VIDEO_OUT_PLAN.md` (📺 `rgba` out for every scope, builds on P0a/P0c/P0d and W1); `docs/FUTURE_PLANNING.md` §Display shaders.

---

### How to update this section

- Agents and Argi change the **Status** cell of a row and add a dated note in **Notes** (e.g. `2026-10-07 LibraryCode: shared context landed for Phosphor + Trace`). Set **Owner** when you start.
- Status values: **Not started** / **In progress** / **Done** / **Dropped**. Dropped needs a one-line reason in Notes.
- Do not delete rows. Add new rows with the next free ID.
- **Argi commits.** Agents edit locally and do not commit or push.

---

### Goal

Move the per-pixel math that JavaScript does today into GLSL fragment shaders. This is not about faster drawing calls: the per-pixel work itself moves to the GPU. Every display shares **one** WebGL context.

Audio stays native C++/WASM and never runs on the GPU. This is consistent with `docs/APP_POLICY.md`: no JS DSP, no GPU audio.

---

### Rules

- Per APP_POLICY: no worklet or JS special cases. The display reads what the native engine already publishes; it never computes or re-simulates audio.
- The face / patch drives the display. A shader is a renderer for a face's settings, not a new source of truth for them.
- **The shared context is mandatory for every new GL face.** No new `getContext("webgl")` per canvas.
- Audio never runs on the GPU (no WebGPU/WebGL audio kernels).
- Line numbers below are from Argi's uncommitted tree as of 2026-10-06 and may drift. Re-check before editing.

Size key: **S** = small, **M** = medium, **L** = large (combinations like S-M mean between the two).

---

### What uses shaders today

Shared picture device is **WebGL2** (P0d). Face shaders are still GLSL ES 1.00 (`attribute` / `gl_FragColor`) compiled on that context. Room dimmer and the scope overlay request WebGL2 on their own canvases. No WebGL1 fallback.

| Display | File | Context |
|---------|------|---------|
| Phosphor | `public/lib/phosphor/phosphor-energy-gl.js` | shared |
| Trace | `public/lib/trace/trace-woscope.js`, `trace-stroke.js`, `trace-tape.js` | shared contexts |
| Vector RGB | `public/lib/trace/trace-rgb-points.js` | one context **per face** |
| Basic Shape / Sin/Cos / Softwave | `public/lib/visual/cycle-line-gl.js` | one per canvas, **no fallback** |
| Picture | `public/lib/visual/picture-device.js` | shared 4096×4096 canvas (about 64 MB). Image Ghost, Soft Fractal and fbm Field draw through it |
| Matrix | `public/modules/asciiscope/asciiscope-gl.js` | one per canvas |
| Waterfall | `public/node-graph-module-scope-waterfall-gl.js` | one per canvas |
| Others | `public/node-graph-module-scope-webgl.js` (overlay), `public/node-graph-room-dimmer.js`, legacy `public/node-graph-module-scope-draw-burn.js` | — |
| WebGPU | `public/node-graph-gpu-additive-backend.js` | for the retired `gpuAdditiveOsc`. Its script still loads |

---

### Phase 0: infrastructure and risk

- **P0a. One shared WebGL context for every display.** About 7 contexts are always open, plus one per Basic Shape / SinCos / Softwave / Matrix / Waterfall / Vector RGB face. Past about 16, Chrome evicts the oldest contexts (the shared ones), and those can keep evicting each other.
- **P0b. Vector RGB recompiles its shaders every frame** once there are 2+ faces (`trace-rgb-points.js:53-83`, `109-117`). Fix.
- **P0c. Stop the shared canvas being resized on each present** (`phosphor-energy-gl.js:1727`, `trace-woscope.js:609`, `trace-stroke.js:382`). Use grow-only sizing or a scissor rect.
- **P0d. Consider merging the shared devices into one WebGL2 context.** Decision item.
- **P0e. Cleanups** (separate tracker rows):
  - P0e-1: remove the retired WebGPU oscillator script and its JS DSP fallback. It is JS DSP, so it is also part of C-001 in `docs/BUG_PLAN.md`.
  - P0e-2: free the boot GPU probe context (`boot-loading.js:219`).
  - P0e-3: delete the stray `_fs_aug2.glsl` (repo root).
  - P0e-4: remove dead functions `nodeGraphPhosphorMapEnergyToColorCanvas`, `nodeGraphNumberReadoutPresentBurnPlate`, `paintNodeGraphPhosphorLiveStampOverlay`.

### Migration items (ranked)

- **M1. Spectrogram** (`spectrogram-display.js:536`). Today: per-pixel `fillRect` plus rgb strings. Move to a looping magnitude texture, frequency mapping in the shader, and a colour LUT, in one shader pass. **S-M.**
- **M2. Stereo / 3-layer Trace Meet** (`trace-stroke.js:782`, `:895`). Today: `getImageData` readbacks every frame. Reuse `MEET_FRAG` from `trace-tape.js:81` and add the 3-layer case. **S-M.**
- **M3. Raster RGB** (`raster-rgb-display.js:262`). Today: JS LUT / hue grading and `ctx.filter` blurs. Move to a LUT texture, a hue matrix, and a separable blur. **S-M.**
- **M4. Vector RGB / Vectorscope trails** (`scope-paint-helpers.js:981`). Today: about 8 2D passes, 8-bit. Move to an RGB half-float variant of the phosphor fade shader. **M.**
- **M5. LED / LCD Dot / RGB Shape** (`trace-dot-sprite.js:258`). Today: JS shape SDF baked per pixel, with cache misses when modulated. Port the 13 shapes to GLSL. **M.** Must use the shared context.
- **M6. Number Readout / Value LCD / Pitch digits** (`number-readout.js:1725`). Today: `fillText` plus `shadowBlur`. Move to an SDF glyph atlas with exp glow. **M-L.** Caching glyph sprites first is cheaper.
- **M7. Colour picker plane** (`color-widget.js:851`). HSL computed per pixel. **S**, low priority.
- **M8. Room dimmer.** 128 rects in about 512 uniforms. Pack into a texture or cull per tile. **S.**

### Not worth moving

- GPU paths that already have a 2D fallback.
- SVG wires.
- Small or cached plots.

---

### GLSL files next to WASM

Shipped present shaders that belong to a **native module** live beside that module’s `.cpp` / `.wasm`, not as JS template strings.

Layout (Field is the pattern):

```
native_modules/<name>/
  <name>.cpp
  <name>.wasm
  <name>.vert.glsl
  <name>.frag.glsl      (or extra .frag.glsl per pass: source, blur, …)
```

**Rules**

- Text assets the face `fetch()`es. Same debug-server path as wasm. No clang, no combined link, no worklet.
- Audio stays C++. The `.glsl` is the face present only.
- One `.vert` (usually the 4-line fullscreen quad) + one `.frag` per program. Extra passes = extra `.frag` files, same folder.
- JS (`*-gl.js`) fetches, compiles on the **shared picture device**, Canvas2D/WASM fallback until the files land.
- Cache-bust with `?v=` like wasm.
- **Easy** means: a `native_modules/<name>/` folder already exists **and** that module owns the GL programs (not a shared lib).
- Shared stack (phosphor, traces, Meet, cycle-line, room dimmer, colour picker, number readout, waterfall) stays in `public/lib/…-gl.js` until someone wants a `public/shaders/` shelf. Do not invent a wasm-less `native_modules/` folder just to park GLSL.
- Live typing (Apply without reload, saved in the patch) is the parked **Screen Space Shader** host. Repo `.glsl` is the shipped default, not the live buffer.

**Easy moves**

| ID | Module folder | From | Files | Status | Notes |
|----|---------------|------|-------|--------|-------|
| G1 | `native_modules/fbm_field/` | `fbm-field-gl.js` | `fbm_field.vert.glsl`, `fbm_field.frag.glsl` | Done | 2026-10-09 Grok: Field present fetches both; fill_grid until they land. |
| G2 | `native_modules/raster_rgb/` | `raster-rgb-gl.js` | one `.vert` + `source` / `blur` / `down` / `composite` `.frag` | Done | 2026-10-09 Grok: Scan Grid present fetches five files; Canvas2D until they land. |
| G3 | `native_modules/basic_shape/` (only if cycle-line is **not** shared) | `cycle-line-gl.js` | skip unless split | Dropped | Shared by Basic Shape / SinCos / Softwave. Keep in `public/lib/visual/cycle-line-gl.js`. |
| G4 | `public/lib/trace/` (shared shelf, no wasm) | `trace-dot-sprite-gl.js` | `trace-dot-sprite.vert.glsl`, `trace-dot-sprite.frag.glsl` | Done | 2026-10-09 Grok: LED / LCD Dot / RGB Shape SDF present. Same fetch as G1. |

**Not snug (no wasm sibling, or shared lib)** — leave in JS until a native folder exists: Image Ghost, Soft Fractal / rgbFractal, Spectrogram, Phosphor, traces, LED dots, number readout, colour picker, room dimmer, waterfall.

---

### Face wipe registry (Stop / power off)

GL faces keep residual **off** the 2D canvas (FBO, rolling buffer, rAF). Stop’s generic plate fill never sees that, so each new face grew a private `wipeXScreensToColdBoot` hook. Vector RGB missed Stop until 2026-10-09 because wipe looked for `.dsp-node` and paint still `presentTo`’d the old FBO.

**Law**

| Event | Face |
|-------|------|
| Pause | Hold residual |
| Stop | Cold-boot plate (dark / idle) |
| Power off / bypass | Same as Stop **for that module** |
| Play | Paint again |

Same idea as `scopePaintIsFrozen` in `node-graph-module-scope-paint-gate.js`: one gate, no per-file pause predicates.

**Target**

```text
nodeGraphModuleScopeFaceWipes[displayType] = (canvas, bg) => { … }
```

- Stop walks visible face canvases (persistent map + `[data-node-type]` articles) and calls the wipe for that `displayType`, then fills the plate.
- Bypass calls the same wipe for that node only.
- Custom paint **must** early-out through the gate: stopped / bypassed → wipe + return; frozen → hold. No `presentTo` after Stop.
- No new `if (typeof wipeX === "function")` in `node-graph-module-scope-wipe.js`.
- LCD / LED / Pitch idle digits stay the one exception (idle plate, not a solid black fill). Filter-curve plots redraw, they do not black out.

**Today’s special cases to fold in:** phosphor energy destroy, waterfall history, spectrogram history, number readout idle, Field, Scan Grid, Vector RGB.

---

### Progress tracker

Full paths: `public/lib/phosphor/phosphor-energy-gl.js`, `public/lib/trace/{trace-woscope,trace-stroke,trace-tape,trace-rgb-points,trace-dot-sprite}.js`, `public/modules/spectrogram/spectrogram-display.js`, `public/modules/rasterRgb/raster-rgb-display.js`, `public/node-graph-module-scope-paint-helpers.js`, `public/node-graph-module-scope-number-readout.js`, `public/color-widget.js`, `public/boot-loading.js`. Sizes for Phase 0 rows were not given; they say TBD until someone estimates them.

| ID | Item | Files / lines | Size | Status | Owner | Notes |
|----|------|---------------|------|--------|-------|-------|
| P0a | One shared WebGL context for every display | `phosphor-energy-gl.js`, `trace-woscope.js`, `trace-stroke.js`, `trace-tape.js`, `trace-rgb-points.js`, `cycle-line-gl.js`, `picture-device.js`, `asciiscope-gl.js`, `node-graph-module-scope-waterfall-gl.js` | TBD | Done | Grok Bot | 2026-10-11 Grok: `nodeGraphSharedGlDevice` is the picture-device 4096 canvas. Phosphor, woscope, stroke, tape, cycle-line, waterfall, matrix, rgb-points compile/present on it and blit to 2D faces. Room dimmer keeps its own full-viewport veil canvas. Hard-refresh required (faces that were WebGL are now 2D). |
| P0b | Vector RGB: stop recompiling shaders every frame with 2+ faces | `trace-rgb-points.js` | TBD | Done, needs visual check | Librarian | 2026-10-06 Librarian: WeakMap keyed by face canvas keeps one GL program per canvas; switching faces no longer nulls a global device and recompiles. Files: `public/lib/trace/trace-rgb-points.js` |
| P0c | Shared canvas: grow-only or scissor instead of resize per present | `phosphor-energy-gl.js:1727`, `trace-woscope.js:609`, `trace-stroke.js:382` | TBD | Done | Grok Bot | 2026-10-11 Grok: picture canvas stays 4096; present uses scissor+viewport then `nodeGraphSharedGlBlitTo2D`. No per-present resize (resize would wipe shared textures). |
| P0d | Decide: merge shared devices into one WebGL2 context | all shared GL devices | TBD | Done | Grok Bot | 2026-10-11 Argi: modern GPUs only. Picture device is `getContext("webgl2")` with no WebGL1 fallback. Dimmer + scope overlay also WebGL2. GLSL ES 1.00 shaders stay until a later ES 3.00 pass (MRT / integer textures). |
| P0e-1 | Remove retired WebGPU oscillator script and its JS DSP fallback | `public/node-graph-gpu-additive-backend.js` (+ JS fallback) | TBD | Done | Grok Bot | 2026-10-11 Grok: deleted `node-graph-gpu-additive-backend.js`; dropped script tags. Additive sample stays WASM in `node-graph-oscillator-runtime.js`. |
| P0e-2 | Free the boot GPU probe context | `boot-loading.js:219` | TBD | Done | Grok Bot | 2026-10-11 Grok: `WEBGL_lose_context` after UNMASKED_RENDERER / VRAM probe. |
| P0e-3 | Delete stray `_fs_aug2.glsl` | `_fs_aug2.glsl` (repo root) | TBD | Done | Grok Bot | 2026-10-11 Grok: file removed. |
| P0e-4 | Remove dead functions `nodeGraphPhosphorMapEnergyToColorCanvas`, `nodeGraphNumberReadoutPresentBurnPlate`, `paintNodeGraphPhosphorLiveStampOverlay` | `node-graph-module-scope-phosphor.js:188`, `node-graph-module-scope-number-readout.js:703`, `node-graph-module-scope-draw-burn.js:551` | TBD | Done | Grok Bot | 2026-10-11 Grok: removed MapEnergyToColorCanvas and LiveStampOverlay. **Kept** `nodeGraphNumberReadoutPresentBurnPlate` — still the LED burn-plate blit. |
| M1 | Spectrogram: looping magnitude texture + shader freq mapping + colour LUT, one pass | `spectrogram-display.js:536` | S-M | Done, needs visual check | Grok Bot | Replaces per-pixel `fillRect` + rgb strings. 2026-10-06 Grok Bot: ring of raw bins + per-column settings + LUT rows, one shader pass on the shared picture device (no new context); Canvas2D kept as fallback, rebuilt from the ring on context loss. Files: new `public/modules/spectrogram/spectrogram-gl.js`; `spectrogram-display.js`; script tag in `public/index.html` + `public/perform.html`; `scripts/smoke_test.py` PUBLIC_SCRIPT_PATHS |
| M2 | Stereo / 3-layer Meet (R+B=G): one shared Meet GLSL for every display | `trace-meet-glsl.js` (new); `node-graph-module-scope-waterfall.js:605`; `node-graph-module-scope-waterfall-gl.js:626`, `:700`; `trace-tape.js:84` | S-M | Done, needs visual check | Librarian | Removes per-frame `getImageData` readbacks. 2026-10-06 Librarian: inventory found one live Meet site, the 1D Waterfall column bars (Output and every `stereoWaterfallPorts` face, normal and onset paths, blend R+B=G with two channels). It now draws each column once on its existing waterfall GL context; the shader picks L / R / meet colour per pixel from the shared `TraceMeetGlsl.MEET_SPAN_GLSL` (same result as the old L, R-only and overlap bar stamps, ≤1/255 rounding). Shared lib `public/lib/trace/trace-meet-glsl.js` holds both Meet formulas (`traceMeet2`/`traceMeet3` coverage mix, `traceMeetSpan2` waterfall span); `trace-tape.js` Meet programs now use it. Removed the dead per-pixel JS Meet: `TraceStroke.drawStereo` / `drawStereoRedBlueGreen` / `drawMeet` (+ mask helpers) and their only callers `TraceHistoryDraw.strokeStereo` / `strokeLayers`; dropped the earlier GPU port `trace-meet-gl.js` with them. XYZ / RGB waterfalls with R+B=G stay additive (unchanged). Files: new `public/lib/trace/trace-meet-glsl.js`; `public/node-graph-module-scope-waterfall.js`; `public/node-graph-module-scope-waterfall-gl.js`; `public/lib/trace/trace-tape.js`; `public/lib/trace/trace-stroke.js`; `public/lib/trace/trace-history-draw.js`; script tags in `public/index.html` + `public/perform.html`; `scripts/smoke_test.py` PUBLIC_SCRIPT_PATHS |
| M3 | Raster RGB: LUT texture + hue matrix + separable blur | `raster-rgb-display.js:262` | S-M | Done, needs visual check | LibraryCleaner | Replaces JS LUT / hue grading + `ctx.filter` blurs. 2026-10-06 LibraryCleaner: raw pixel buffer uploaded as a texture on the shared picture device (no new context); shader does nearest placement, grade LUT texture (contrast/brightness/invert), HSL hue rotate (ported per pixel: the JS hue is HSL, not a linear matrix), then separable Gaussian blur and glow (sigma = CSS px; levels halved above 6px) and plate/glow composite. Canvas2D path kept as fallback. Files: new `public/modules/rasterRgb/raster-rgb-gl.js`; `public/modules/rasterRgb/raster-rgb-display.js`; script tag in `public/index.html` + `public/perform.html`; `scripts/smoke_test.py` PUBLIC_SCRIPT_PATHS |
| M4 | Vector RGB / Vectorscope trails: RGB half-float phosphor fade variant | `trace-rgb-trails-gl.js` (new); `vector-rgb-display.js`; `gradient-vectorscope-display.js`; `trace-rgb-points.js` | M | Done, needs visual check | Librarian | Replaces ~8 8-bit DestFade 2D passes. 2026-10-06 Librarian: RGB dual residual (hot*keepFast, max(min(prev*keepSlow, cap))) on shared picture device FBO (half-float when EXT_color_buffer_half_float else rgba8); Vector RGB stamps points into FBO; Gradient Vectorscope still draws via TraceWoscope/2D then ingestCanvas. DestFade/TraceRgbPoints kept as fallback. Also closes P0b (WeakMap). Files: new `public/lib/trace/trace-rgb-trails-gl.js`; `public/modules/vectorRgb/vector-rgb-display.js`; `public/modules/gradientVectorscope/gradient-vectorscope-display.js`; `public/lib/trace/trace-rgb-points.js`; script tags in `public/index.html` + `public/perform.html`; `scripts/smoke_test.py` PUBLIC_SCRIPT_PATHS |
| M5 | LED / LCD Dot / RGB Shape: port 13 shapes to GLSL | `trace-dot-sprite-gl.js` (new); `trace-dot-sprite.js` | M | Done, needs visual check | Librarian | Must use the shared context. 2026-10-06 Librarian: 13 stamp shapes (circle/oval, pill, squircle, ngon, star, heart, trapezoid, diamond, cross, ring, teardrop, flower) evaluated as SDF in one fragment shader on the shared picture device; live TraceDotSprite.draw prefers GL and skips JS bake; CPU bake kept as fallback. Files: new `public/lib/trace/trace-dot-sprite-gl.js`; `public/lib/trace/trace-dot-sprite.js`; script tags in `public/index.html` + `public/perform.html`; `scripts/smoke_test.py` PUBLIC_SCRIPT_PATHS |
| M6 | Number Readout / Value LCD / Pitch digits: SDF glyph atlas + exp glow | `number-readout-gl.js` (deleted 2026-10-15, never wired; bake lives in `lib/visual/glyph-sdf-atlas.js`); `node-graph-module-scope-number-readout.js` | M-L | Done, needs visual check | Librarian | 2026-10-06 Librarian: DSEG/mono SDF glyph atlas (EDT bake) on shared picture device; glow=exp(-d^2/sigma^2), core=smoothstep; LCD inner shadow via rounded-box SDF (no fillText/shadowBlur/ctx.filter when GL works). Canvas2D kept as fallback. Files: new `public/modules/numberReadout/number-readout-gl.js`; `public/node-graph-module-scope-number-readout.js`; script tags in `public/index.html` + `public/perform.html`; `scripts/smoke_test.py` PUBLIC_SCRIPT_PATHS |
| M7 | Colour picker plane in a shader | `color-widget-plane-gl.js` (new); `color-widget.js` | S | Done, needs visual check | Librarian | 2026-10-06 Librarian: colour plane is a fullscreen quad on the shared picture device (HSV plane / HSL lamp / BW from UV + hue uniform); Canvas2D putImageData kept as fallback. Files: new `public/lib/visual/color-widget-plane-gl.js`; `public/color-widget.js`; script tags in `public/index.html` + `public/perform.html`; `scripts/smoke_test.py` PUBLIC_SCRIPT_PATHS |
| M8 | Room dimmer: pack 128 rects into a texture or cull per tile | `node-graph-room-dimmer.js` | S | Done, needs visual check | Librarian | 2026-10-06 Librarian: pack up to 128 rects into a 2-row data texture (float preferred, RGBA8 fallback) instead of ~512 uniforms; fragment loop unchanged (same rounded-box SDF look). Files: `public/node-graph-room-dimmer.js` (SHADER_REV 16); script tag version bump in `public/index.html` + `public/perform.html` |
| M9 | Fractal Brownian Field: fBm per texel in GLSL from uniforms | `fbm-field-gl.js`; `fbm-field-display.js`; `fbm_field.cpp` fill_grid | M | Done, needs visual check | Librarian | 2026-10-06 Librarian: face present evaluates fBm in the fragment shader on the shared picture device (no new context); fill_grid WASM only for Canvas2D fallback. Audio X/Y/Z probes stay in C++/WASM (fieldAt / eval_at / sample) — WISIWIH approximate (GL float hash vs C++ uint32). 2026-10-09 Grok: present source extracted to `native_modules/fbm_field/fbm_field.{vert,frag}.glsl` (G1); `fbm-field-gl.js` fetches. Files: `public/modules/fbmField/fbm-field-gl.js`; `public/modules/fbmField/fbm-field-display.js`; `native_modules/fbm_field/fbm_field.vert.glsl`; `native_modules/fbm_field/fbm_field.frag.glsl` |
| M10 | Image Ghost: dry flash + contrast in PRESENT shader (zero hot-path getImageData) | `image-burn-gl.js`; `image-burn-display.js` | M | Done | Librarian | 2026-10-06 Librarian: residual path already GL; DrawDry contrast/brightness moved into PRESENT_FRAG screen composite so live frames do no getImageData when GL works; Canvas2D/getImageData kept as fallback. 2026-10-11 Argi: visual pass. |
| G1 | Field present `.vert` + `.frag` next to wasm | `native_modules/fbm_field/fbm_field.{vert,frag}.glsl`; `fbm-field-gl.js` | S | Done | Grok Bot | 2026-10-09 Grok: fetch + compile; fill_grid until files land. Pattern for G2. |
| G2 | Scan Grid present shaders next to wasm | `native_modules/raster_rgb/`; `raster-rgb-gl.js` | S | Done | Grok Bot | 2026-10-09 Grok: `raster_rgb.vert.glsl` + `source` / `blur` / `down` / `composite` `.frag.glsl`. Fetch + compile; Canvas2D until they land. Blur tap loop is literal 24 (matches MAX_TAPS_RADIUS). |
| G4 | LED Dot SDF present `.vert` + `.frag` on the shared shelf | `public/lib/trace/trace-dot-sprite.{vert,frag}.glsl`; `trace-dot-sprite-gl.js` | S | Done | Grok Bot | 2026-10-09 Grok: no wasm sibling; LED / LCD / Pulse / RGB Shape share one SDF program. Fetch + compile; JS bake until files land. |
| W1 | Face wipe registry: Stop / bypass / power-off through `nodeGraphModuleScopeFaceWipes[displayType]` | `node-graph-module-scope-wipe.js`; `node-graph-module-scope-paint-gate.js`; Field / Scan Grid / Vector RGB / phosphor / waterfall / spectrogram / number readout | M | Done | Grok Bot | 2026-10-09 Grok: `nodeGraphModuleScopeRegisterFaceWipe` / `WipeCanvas` / `WipeNode`. Pause holds (`scopePaintIsFrozen`). Stop + orchestrator early-out + power-off call the registry. LCD idle exception kept. |
| W2 | Fold existing special-case wipes into W1 and delete the `if (typeof wipeX)` list | same as W1 | S | Done | Grok Bot | 2026-10-09 Grok: Field / Scan Grid / Vector RGB register; phosphor / waterfall / spectrogram / LCD builtins in wipe.js. Removed the `if (typeof wipeX)` tail. |
| A1 | Audit fixes: shared GL util (`SoemGl`) | new `public/lib/gl/soem-gl-util.js`; `picture-device.js`, `trace-dot-sprite-gl.js`, `trace-rgb-trails-gl.js`, `trace-tape.js`, `trace-woscope.js`, `phosphor-energy-gl.js`, `color-widget-plane-gl.js`, `number-readout-gl.js`, `image-burn-gl.js`, `video-delay-gl.js`, `video-feedback-gl.js` | M | Done, needs visual check | Cody | 2026-10-14 Cody: one compile/link (`SoemGl.link`), per-gl program cache, shared fullscreen quad (`SoemGl.quad`), context-loss wiring (`SoemGl.watchContextLoss`, used by picture-device). Local link copies now delegate. Room dimmer quad and phosphor's strip quad left as-is (own context / different layout). |
| A2 | Number Readout burn-plate tint on GPU | `node-graph-module-scope-number-readout.js` (`nodeGraphNumberReadoutPresentBurnPlate`) | S | Done, needs visual check | Cody | 2026-10-14 Cody: plate alpha indexes the 256 ghost LUT in a fragment shader on the shared picture device; the `getImageData` loop is now the no-GL fallback only. |
| A3 | Shared HSL GLSL | `SoemGl.GLSL_HSL`; `color-widget-plane-gl.js`; `native_modules/raster_rgb/raster_rgb.source.frag.glsl` (spliced at `// #include <soem-hsl>` by `raster-rgb-gl.js`) | S | Done, needs visual check | Cody | 2026-10-14 Cody: same maths, refactored only; glslangValidator clean. |
| A4 | Confirmed fallback-only CPU pixel paths | Image Ghost loops (`image-burn-display.js`, only when `nodeGraphImageBurnDrawGl` fails), Soft Fractal CPU blur (`paintNodeGraphRgbFractalFaceCpu`, WebGL missing), Spectrogram `createImageData` (one-off rebuild on context loss), FBM `nodeGraphFbmFieldPresentCanvas2d` (no-GL) | - | Done | Cody | 2026-10-14 Cody: no live per-pixel JS left in these. |
| A5 | Still standalone contexts | `node-graph-module-scope-webgl.js` (scope overlay), `node-graph-module-scope-draw-burn.js` (scope2d burn, one per canvas) | L | Not started | - | 2026-10-14 Cody: not moved; both are large renderers with their own FBO ping-pong. Needs its own pass. |
| D1 | Module display WebGL-only migration (helper, marker CSS, smoke allowlist, batches) | `docs/WEBGL_DISPLAY_PLAN.md` sections 7-9 | L | In progress | Grok Bot | 2026-10-15 Grok: phase 1 landed locally (allowlist 57 -> 41). Tracked in WEBGL_DISPLAY_PLAN.md, not duplicated here. |

D1 note - Phase 2 (2026-10-15): shared GL text, RGBA export, 8 more faces converted; see WEBGL_DISPLAY_PLAN.md section 10.
