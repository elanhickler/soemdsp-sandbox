# WebGL Display Plan: one shader path for every module display

**Status: PLAN, docs only (2026-10-14). Nothing migrated yet beyond the two faces already on it.**
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

## 3. Migration inventory (grep of `public/modules`, 2026-10-14)
Method: per module folder, any `.js` with `getContext("2d")`, `createElement("canvas")`, or use of the shared GL device. Two folders (Sabrina, Softpop) are already done, which leaves **39 modules** to migrate. 2026-10-14: `lookaheadLimiter` (the shared `limiterGainFace`, now on Pump Limiter and Sidechain) moved to gl-line-renderer and left the table, so **38** remain (numbering kept).
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
| 17 | `knob` | `knob-face.js` | 2D | knob face; proposed exception |
| 19 | `matrixDisplay` | `matrix-display-display.js`, `matrix-display-ui.js` | 2D | LCD cells -> rect |
| 20 | `numberReadout` | `number-readout-gl.js` | Partial (shared GL + 2D) | digit atlas bake |
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

Counts: 24 x 2D, 9 x Partial, 3 x GL via cycle-line-gl, 2 x own canvas / filter-curve path.
Shared code outside `public/modules` that also needs moving: `public/lib/visual/cycle-line-gl.js` (merge), `public/lib/visual/filter-curve-face.js` (2D path), `public/node-graph-module-scope-canvas.js` (light canvas 2D). Scope/waterfall/trace faces in `public/node-graph-module-scope-*` are a separate later pass (not counted above).

**Suggested order:** (1) the 3 cycle-line-gl modules (already GL, proves the merge); (2) simple curve/bar faces (additive*, harmonic*, spectrum1d, softClipper, attackDecay); (3) the 9 Partial modules; (4) the rest; (5) decide exceptions.

## 4. Enforcement
1. **One shared display-canvas helper** (new, in `public/lib/visual/`, e.g. `display-canvas.js`): creates the face canvas, applies the shared sizing path (backing = layout CSS box x devicePixelRatio, never x workspace zoom; APP_POLICY 15) and adds one **marker class** (e.g. `node-display-canvas`). `styles.css` adds that class to the `.node-graph-workspace.pixelated-canvas-zoom ...` rule so **>2.5x zoom pixelation applies automatically** (`node-graph-viewport-perf.js` toggles the workspace class at zoom > 2.5). The per-module canvas classes in that rule shrink away as modules move over.
2. **`scripts/smoke_test.py` check** (`check_module_displays_use_shared_gl`): scans `public/modules/**/*.js` and fails on any `getContext("2d")`, `getContext("webgl...")`, or `createElement("canvas")` in a file that is **not** on an allowlist. The allowlist starts as exactly the files in section 3 and is **shrink-only**: the check also fails if an allowlisted file no longer needs its entry (so the entry must be deleted), and new entries are never added. A new module that draws its own canvas fails the smoke test.

## 5. Exceptions (explicit, none approved yet)
Proposed for Argi's call, because they are text/UI widgets rather than pictures: `audioPlayer` playlist, `sequencer` step UI, `transport` status, `knob` face. Glyph atlases (`asciiscope`, `numberReadout`) may bake text once with 2D into a texture; that bake would live in the shared helper, not the module. Until approved, they stay on the shrink-only allowlist as debt.

## 6. Done when
- Section 3 table is empty, the allowlist holds only approved exceptions, and the smoke check passes.
- `cycle-line-gl.js` is merged into gl-line-renderer.js.
- Turning WebGL off shows black squares, never a 2D drawing.
