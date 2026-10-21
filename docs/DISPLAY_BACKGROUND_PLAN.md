# Display background plan (DB-1..DB-6)

Status: **plan only** (2026-10-20). No code yet. Owner: Argi. Related: B-101 (cull / GL face race), `docs/WEBGL_DISPLAY_PLAN.md`, `docs/GPU_WORKSPACE_PLAN.md`, `docs/ENGINE_STATE_DISPLAY_PLAN.md`, `docs/APP_POLICY.md` (no fallbacks, no migrators kept, no hover clutter).

## 1. Goal

Each display type **registers** a background color. While a display is visible, the GL workspace always paints that color as a solid rectangle in the module body pass, using the display rect from **saved geometry** (not the live face canvas). So a display box always shows at least its background square, including when its face:

- is asleep (`viewport-asleep`, display:none, no layout box),
- has not been drawn yet (spawn, boot, cold plate pending),
- is culled, mid-pan or mid-zoom (frozen HTML camera),
- has a canvas the GL rebuild skipped (the B-101 class of bug).

The face texture is still drawn on top when it exists. The background never covers a live face. It is only what you see when the face is missing.

## 2. Current state map

### 2.1 Where a display background comes from today

| Path | Where | Notes |
|---|---|---|
| Per-type settings defaults | `public/node-graph-module-scope-defaults.js` (`nodeGraphScopePhosphorLookDefaults`, `nodeGraphWaterfallSettingsDefaults`, `nodeGraphLineBurnSettingsDefaults`, `nodeGraphZeroDBurnSettingsDefaults`, `nodeGraphValueOscilloscopeSettingsDefaults`, `nodeGraphNumberReadoutSettingsDefaults`, `nodeGraphValueLcdSettingsDefaults`, `nodeGraphVectorDotSettingsDefaults`, `nodeGraphLcdDotSettingsDefaults`, `nodeGraphKnobFaceDisplaySettingsDefaults`, `nodeGraphSliderFaceDisplaySettingsDefaults`, `nodeGraphSpectrogramSettingsDefaults`, `nodeGraphScope2dSettingsDefaults`, `nodeGraphXyPadDisplaySettingsDefaults`, `nodeGraphScope2dTraceSettingsDefaults`, `nodeGraphScope1dTraceSettingsDefaults`). Also `nodeGraphSpectrumLineSettingsDefaults` and `nodeGraphHypersawBurnSettingsDefaults` in `node-graph-module-scope-normalize.js` | Keys differ by type: `background`, `backgroundColor`, `backgroundHue` + `backgroundBrightness` (+ `backgroundSaturation`). Some types store a hue hex plus a brightness amount. |
| Per-module `defaultDisplaySettings` | module defs (e.g. Tube Saturation crt-amber) | Merged under saved bag (B-083 fix). |
| Per-instance user setting | Display Settings window (`node-graph-module-scope-settings-form.js` `nodeGraphDisplaySettingsPushBackgroundHueRow`, `-settings-apply.js`), saved on the patch node | User-editable for most scope/trace/LCD types. |
| Resolver | `nodeGraphFacePlateBackground(settings)` in `node-graph-module-scope-paint-helpers.js` (HBS → hex, else stored hex, default `nodeGraphFacePlateDefaultBackground = "#000000"`). Waterfall uses `nodeGraphWaterfallPlateCss`. Sample waveform uses `nodeGraphSampleWaveformBackgroundColor` | Already close to a single resolver, but not every type goes through it. |
| CSS token | `nodeGraphFacePlateApplyCss` → `--node-scope-background` on the scope window; `nodeGraphModuleScopePlateBackgroundForElement` reads it back via getComputedStyle | Cold plate / stop wipe use this path. A DOM read, so it needs layout. |
| Face canvas clear | `nodeGraphFacePlateFill` / `nodeGraphFacePlateFillCanvas` (shared GL clear + blit), `paintNodeGraphTraceDisplayColdPlate`, `scopePaintEnsureColdPlate`, `matrixDrawColdPlate` / `matrixGlDrawColdPlate` (Asciiscope) | The background only exists **inside the face canvas pixels**. No canvas, or a skipped canvas, means no background. |
| Self-painting custom faces | `nodeGraphModuleScopeCustomRenderers.*` (aberrationFace, additive*, arpKeysFace, ensembleCloud, evolveFieldFace, fbmFieldFace, gradientVectorscopeFace, harmonicCount/Lines/SeriesFace, imageBurnFace, limiterGainFace, phoneToneFace, phosphorLight, placeFace, rasterRgbFace, rgbFractalFace, rgbPictureFace, screenBendFace, sinCos(4)Face, slewShapeFace, softpopFace, spectrogramBurn, spectrumLine, torchFace, transportBpm, tSeriesFace, vectorRgbFace, videoDelayFace, videoFeedbackFace, videoscopeBurn) and module-folder displays (`modules/*/…-display.js`, `…-gl.js`) | Each clears its own canvas with a hard-coded or settings color. Some (fbm, rgbFractal, asciiscope) own their GL program. |
| Non-scope faces | Knob / Slider faces, Keypad (background image), XY Pad, LED/LCD, Text Box (`text-box-widget.js` bg + alpha, HTML), Music Player waveform, round-shape faces | Mixed. Text Box is HTML by policy and is **not** a display. |

### 2.2 GL body / plate path

- `nodeGraphGlGraphRebuildPlates()` (`node-graph-gl-graph.js`) builds `plates[]` from **published geometry** `geo.box` (`node-graph-module-geometry.js`, kept while asleep), with fill `--node-module-fill`. Text Box plates use their own bg + alpha.
- `displays[]` is built in the same pass from live `.node-display-canvas` elements via `nodeGraphGlGraphLayoutBox(face, el)` (offsetLeft/Width). **An asleep module has no layout box, so it gets no display entry.** Present draws plates, then chrome, `nodeGraphModuleFaceDrawAllGl`, rails, then `nodeGraphGlLinesImage(face.canvas)` per display, then the onTop plates and veils.
- Published geometry (`ModuleGeometry`) has `box`, `ports` and `paramJacks`. **It has no display rects today.**
- Plates and displays are rebuilt only on a full paint (settle). B-100 made geometry translate on move. B-101 made the cull reconcile before the settle rebuild.

### 2.3 Display visibility knowledge

| State | Source |
|---|---|
| Displays off / Display Height 0 / hide-display | module layout bands (`face-track-omitted`, `scripts/test_module_layout_bands.js`). The face track is not laid out. |
| Module asleep / hidden | `.viewport-asleep` (geometric cull SSOT, `node-graph-viewport-perf.js`), `[hidden]` interiors. |
| Presented elsewhere | `nodeGraphPresentedDisplayFace` (`.node-screen-solo-face`): screen solo, Layout Canvas pin, metamodule mirror. `nodeGraphMiniPerformPresentsNode`, and Canvas mode tiles via `nodeGraphGlGraphPresentTile` (`state.view`). |
| Music Player pages | `[data-music-player-page][hidden]` |
| Round-shape canvases | excluded from `displays[]` (`node-round-shape-canvas`) |

## 3. Proposed design

### 3.1 Registration (SSOT)

One registry, `public/node-graph-display-background.js` (new, loaded before the GL graph):

```js
// type -> { resolve(settings, patchNode) -> "#rrggbb", default: "#rrggbb" }
nodeGraphDisplayBackgroundRegister(displayType, { default, resolve });
nodeGraphDisplayBackgroundFor(nodeId, faceKey) -> "#rrggbb"   // cached per settings epoch
```

- **Per-type default** comes from that type's existing settings defaults object, not a new literal.
- **Per-instance override** is the already-saved display settings. `resolve` defaults to `nodeGraphFacePlateBackground` (one resolver). Types with a different storage (waterfall, sample waveform, Text Box excluded) register their own `resolve`, which must read only the **current** keys of that type. Per APP_POLICY there are no fallback readers for old key names and no new migrator.
- **No user-facing change** to Display Settings. Same controls, same keys. Nothing new is added to the UI.
- Registration is **required**. A dev check (smoke) fails if a mounted display has a `displayType` with no registration. There is no silent `#000000` default for unknown types (policy: no fallbacks). The one global default stays `nodeGraphFacePlateDefaultBackground` and is used only by types that register it explicitly.
- Cache key: node id + display settings revision (bumped by settings-apply). The resolver never runs in present. Present reads a cached `[r,g,b,a]`.

### 3.2 Geometry: display rects in the published geometry

Extend `ModuleGeometry` with `displays: [{ key, x, y, w, h, visible }]`. These are layout-px rects of each display box (the face/scope window band, **not** the canvas), recorded by `nodeGraphModuleGeometryPublishFromDom` while the module is awake.

- They are kept while asleep, like `box`, and translated with the module by `nodeGraphModuleGeometryTranslate` (B-100).
- `visible: false` when the band is omitted (hide display, Display Height 0, Music Player page hidden), or when the face is presented elsewhere and the module slot is a placeholder (see 3.4).

### 3.3 Body painter

In `nodeGraphGlGraphRebuildPlates`, build `displayBacks[]` from `geo.displays` plus `nodeGraphDisplayBackgroundFor` for every plate's module, **including asleep modules**. In present, draw them in the **plate batch** right after each module plate (before chrome and faces), using `nodeGraphGlGraphScreenRect` so the edges snap to the plate pixel grid exactly like faces. The face image then draws on top in the dot batch, unchanged.

- Cost: one rect per display per frame from cached data. No DOM reads in present.
- Because the background sits in the plate batch, it rides the cached mesh mid-gesture the same way plates do (ZP-6 style).

### 3.4 Special cases

| Case | Behavior |
|---|---|
| Hide display / Display Height 0 | `visible:false`, no background (the band doesn't exist). |
| Screen solo / Layout Canvas pin / metamodule mirror (`node-screen-solo-face`) | The module slot keeps its background square (Argi to confirm, see D2). The presented target paints its own background behind its tile using the same registry entry. |
| Canvas mode tiles (`nodeGraphGlGraphPresentTile`) | Tile view rebuild already calls `nodeGraphGlGraphRebuildPlates` with `state.view`. Display backgrounds come from the same geometry measured with `toSurface`, so the tile always shows the square. |
| Mini Perform | Same as tiles (`node-graph-gl-mini-perform.js` calls RebuildPlates). |
| Text Box | **Excluded.** It is HTML and not a display (APP_POLICY). It keeps its own plate fill. |
| Round-shape faces | Register their background but draw it as the shape's bounding square only if Argi wants that (D3). The default is to skip them, as today. |
| Faces with transparent / overlay layers (light layers, `nodeGraphFaceClearTransparent`) | The background is drawn under them, which is the intent. |
| Engine stopped / cold plate | Cold plate keeps using the same registry color, so a cold face and a missing face look identical. |
| Output paused bars | Unchanged; drawn after faces. |

## 4. Migration list (every display type)

Each row needs: register type, confirm the resolver reads that type's current keys, and remove any hard-coded clear color in favor of `nodeGraphDisplayBackgroundFor` (one color path).

**Scope / trace family (settings defaults objects):** waterfall (Instant Waterfall, `waterfallRgb`, `waterfallXyz`), lineBurn, zeroDBurn, valueOscilloscope, numberReadout, valueLcd, vectorDot / dot, lcdDot, spectrogram, scope2d, scope2dTrace, scope1dTrace (TraceWoscope / Tube Sat crt-amber), spectrumLine, hypersawBurn, xyPad, knob face, slider face.

**Custom renderers (`nodeGraphModuleScopeCustomRenderers`):** aberrationFace, additiveBlasterBlocks, additiveBubbleCascade, additiveFilterCurve, additiveWaveform, arpKeysFace, ensembleCloud, evolveFieldFace, fbmFieldFace, gradientVectorscopeFace, harmonicCount, harmonicLines, harmonicSeriesFace, imageBurnFace, limiterGainFace, phoneToneFace, phosphorLight, placeFace, rasterRgbFace, rgbFractalFace, rgbPictureFace, screenBendFace, sinCos4Face, sinCosFace, slewShapeFace, softpopFace, spectrogramBurn, spectrumLine, torchFace, transportBpm, tSeriesFace, vectorRgbFace, videoDelayFace, videoFeedbackFace, videoscopeBurn.

**Other face types seen in code:** sampleWaveform (Music Player / sample faces), selfPaintFace, rgbShapeFace, roundShapeFace, keypadFace (has background image: the background is drawn under the image), keyboardControllerFace, momentaryButtonFace, matrixWaterfallFace, matrixDisplayFace (Asciiscope cold plate), patchFace, emoScript (GPU box, Script plan), graph display (`.node-module-graph-display`), LED face.

**Excluded:** textBoxFace (HTML, not a display).

Phase DB-1 produces the authoritative list by script: walk `docs/module_faces_inventory.json` (359 entries) plus every `displayType` and custom renderer key, and write a checked table into this doc. The lists above come from a code grep and must be reconciled against that.

## 5. Risks

- **Color mismatch** between the background and a face's own clear (HBS vs hex rounding, alpha), which shows as a 1px seam or a flash. Mitigation: the face clear uses the same registry color (one path). Smoke compares pixels.
- **Faces that are intentionally transparent** or composite over the module plate (overlay/light layers, keypad image, round shapes) would change look. Audit each in DB-3. These register `transparent` only if Argi approves (D3).
- **Geometry for display rects** goes stale on layout changes (Display Height, hide display, resize). It must republish on `applyNodeGraphModuleLayout`, which already calls `nodeGraphModuleGeometryPublishAfterLayout`.
- **Policy:** no fallback key readers and no migrators. Types whose saved bags use mixed keys today need their **stored patches converted once** (PATCH_MIGRATION_PURGE_PLAN rules), not a dual reader.
- **Perf:** must add no DOM read in present and no per-frame resolve. The per-plate draw adds about N rects (trivial).
- **Self-GL faces** (fbm, rgbFractal, asciiscope, video*) own contexts. They are only affected by where they read their clear color.

## 6. Test plan

- Extend `scripts/smoke_cull_pan_return.mjs`: after each pan case, for every in-view module with a mounted display, assert `nodeGraphGlGraphState.displayBacks` has an entry with the registry color and a rect inside the plate. Also assert it **while asleep / mid-gesture** (sample before settle), which is the point of the feature. Then read back GL pixels at the rect center on a module whose face is forced asleep, and expect the registry color ±2/255.
- New `scripts/smoke_display_background_registry.mjs`: spawn every display type (module shop list), check each has a registration, that the resolved color equals the face's cold-plate color, and that changing Display Settings background updates the square without a reload.
- `scripts/test_module_layout_bands.js`: hide-display or Display Height 0 gives no background rect.
- Existing: `scripts/smoke_test.py`, `smoke_display_gl_*`, `smoke_engine_state_stopped_faces.mjs`, `smoke_canvas_display_size.mjs`, `smoke_viewport_zoom_vars.mjs`.

## 7. Phases

| ID | Step | Done when |
|---|---|---|
| DB-1 | Inventory script plus the checked table in §4. Pick the resolver per type. | Table complete, every type mapped to a current key set. |
| DB-2 | Registry module plus a required-registration smoke. Scope/trace family registered via their defaults objects. | Smoke green for the scope family. |
| DB-3 | Geometry `displays[]` in publish/translate. Body painter draws `displayBacks` in the plate batch. | Pan-return smoke asserts backgrounds incl. asleep / mid-gesture. |
| DB-4 | Migrate the custom renderers and other faces (§4), one color path each (face clear reads the registry). | Registry smoke covers every spawnable display. |
| DB-5 | Presented elsewhere: screen solo, Layout Canvas, Mini Perform, tiles. | Hand check plus a tile smoke case. |
| DB-6 | Cleanup: drop `nodeGraphModuleScopePlateBackgroundForElement` DOM reads in favor of the registry. Update WEBGL_DISPLAY_PLAN / GPU_WORKSPACE_PLAN cross-links. | No getComputedStyle color reads in the face or cold-plate path. |

## 8. Decisions for Argi

- **D1.** Are backgrounds user-editable for **every** type (add the Display Settings background row where it's missing), or only where it exists today, with the other types fixed at their registered default?
- **D2.** When a face is presented elsewhere (screen solo, Canvas pin, metamodule mirror), should the module's own slot still show the background square, or nothing?
- **D3.** Faces that are transparent on purpose (keypad background image, round shapes, overlay/light layers): should they draw the square under them, or opt out?
- **D4.** Should the background follow the engine state (e.g. dimmer when stopped), or is it always the registered color?
- **D5.** Is it OK to convert stored patches whose background keys differ by type to one key set per type (a one-shot conversion, per APP_POLICY)?

### Answers (Argi, 2026-10-20)

- **D1:** editable only where it already is; other types use their registered default.
- **D2:** TV screen. If the module is not culled, its screen area is always drawn (on, off or paused), also when the face is shown elsewhere (placeholder keeps the rect).
- **D3:** see-through faces register an explicit, first-class `TRANSPARENT` value (no square).
- **D4:** the background never dims.
- **D5:** yes, one-shot conversion to one key set per type (see status: deferred).
- **Rule:** never draw the square when the display is hidden (Hide display) or has 0 GU height.

## 9. Status (2026-10-20)

| ID | Status |
|---|---|
| DB-1 | Done. Inventory lives in `scripts/smoke_display_background_registry.mjs` (spawns every display type). |
| DB-2 | Done. `public/node-graph-display-background.js`: register `{color}`, `{resolve}` or `{transparent}`; unregistered key logs once and draws nothing. |
| DB-3 | Done. `geo.displays[]` (publish + translate) in `node-graph-module-geometry.js`; `displayBacks` built in plate rebuild and drawn in `node-graph-gl-graph.js`. Canvas-face squares draw in the face batch right before face images (the plate batch drew them under the plate fill, so they were invisible). layoutOwned squares stay in the plate batch under their GL face pass. |
| DB-4 | Done for every mounted key (registry smoke: all keys registered, color or transparent). LUT/matrix faces use fixed approximations (see registry file). |
| DB-5 | Covered by D2: the placeholder keeps the rect. Tile smoke case not added; hand check. |
| DB-6 | Not done: `nodeGraphModuleScopePlateBackgroundForElement` DOM reads remain (separate pass, regression risk). |
| D5 conversion | Deferred: numberReadout / valueLcd / vectorDot / lcdDot mix `background`, `backgroundColor`, HBS keys; normalizers, settings form and `nodeGraphFacePlateBackground` dual reads need their own one-shot pass. |
