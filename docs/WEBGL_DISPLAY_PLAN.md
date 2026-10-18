# WebGL Display Plan: one shader path for every module display

**Status: Phase 1 in progress (2026-10-15 Grok Bot). Helper, marker CSS rule, smoke check + allowlist landed; first batch converted (section 7). Needs visual check.**
**Policy:** `docs/APP_POLICY.md` section 3 (Module displays: WebGL2 + shaders only).
**Owner:** Interface (faces), PlanningDocs (plan, allowlist bookkeeping).

## 1. Policy
- Every module display draws with **WebGL2 + shaders**. No canvas 2D drawing, no CPU pixel loops for the picture.
- **Preferred primitive:** shader-expanded quads with smoothstep edges. Each line/rect/dot is a quad; the fragment shader takes the distance to the shape and fades it over `feather` px past `halfPx`:
  `a = 1 - smoothstep(halfPx, halfPx + feather, dist)`. Thickness never depends on fractional pixel position. Fills are the same quads with an infinite `halfPx`.
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
(local, not pushed yet).

### Tracker
| ID | Stage | Status |
|----|-------|--------|
| GB-1 | Cables and grid drawn in screen space with a camera matrix, replacing wire SVGs and the grid background; pan/zoom only change a uniform | testing. Default on. `?glGraph=0` restores SVG. Look is approximate (flat cables, coarse grid when zoomed out). |
| GB-2 | Module bodies: plates, borders, rounded corners, shadows as batched GL quads; existing display canvases become textures placed in the same pass | testing. Plates, border, and shadow are GL rects (square corners). Display canvases are textures in the same pass. HTML titles, jacks, and sliders stay. |
| GB-3 | Jacks, labels, slider readouts: jacks/dots as GL sprites, text via the shared glyph atlas | testing. Jacks, titles, port labels, and slider tracks/readouts draw in the graph pass. HTML stays as the click target. |
| GB-4 | HTML only for text inputs and popups, positioned from the camera; hit-testing in JS against module rectangles | testing. Module chrome does not take hits. Clicks resolve against plate, jack, slider, and title rectangles and call the existing drag, wire, and menu actions. Text fields, popups, and special faces (graph, keypad, knob) stay HTML. |
| GB-5 | Measure every stage with the same zoom-in / zoom-out / pan traces at 40x and low zoom | measured 2026-10-16, `nodeGraphGlGraphMeasureGb5()`, 24 frames each, same numbers on a second run. Zoom-out 40→0.35: total 201 ms, present 40 ms, max frame 41 ms. Zoom-in 0.35→40: total 86 ms, present 38 ms, max frame 8 ms. Pan at 40×: total 53 ms, present 20 ms, max frame 3 ms. Pan at 0.35×: total 100 ms, present 35 ms, max frame 13 ms. The old HTML zoom-out gesture was about 5.5 s. |
| GB-6 | True GPU camera (Argi approved 2026-10-18; owner TBD). Merged into `docs/PHONE_AND_GPU_CAMERA_PLAN.md` (full spec, acceptance, ordering with phone PH-6). | planned |

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
