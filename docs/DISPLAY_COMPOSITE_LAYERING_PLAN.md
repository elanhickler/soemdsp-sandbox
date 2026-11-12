# Display composite layering plan

**Status:** plan only (2026-11-11). Decisions recorded 2026-11-11 (America/Phoenix). The full layering overhaul is approved, but do not start coding it until the other agent's Array-buffer allocation failure work on the 1D scope draw path is done. That hold stands (Argi previously told Misty not to change anything yet for that reason).
**Owner:** Argi / Interface.
**Repo:** soemdsp-sandbox.
**Related (read-only):** `docs/WEBGL_DISPLAY_PLAN.md` (migrate faces onto WebGL — not this work), `docs/ZOOM_PERF_PLAN.md` (ZP-2 face textures, ZP-3 mesh replay), `docs/GPU_WORKSPACE_PLAN.md` (workspace picture, Text Box wire sandwich, stacking is GPU plate order), `docs/MINI_PERFORM_VIEW_PLAN.md` (GPU mirror, no reparenting), `docs/APP_POLICY.md` (WebGL-only display/face text).

This file is the plan for compositing module displays in the workspace GL pass, in z-order. It is not a second WebGL-migration plan.

## 1. Why

Two problems remain after the workspace already composites display pictures as GPU quads.

1. **No real z-order.** Overlapping modules cannot hide each other's displays correctly. A single text overlay layer was rejected because it ignores z-order too.
2. **Soft display text.** Display backing is layout CSS x devicePixelRatio (capped at 2), and never follows workspace zoom (`public/lib/visual/display-canvas.js`, `nodeGraphSizeDisplayCanvas`). Parameter faces are crisp because the workspace pass draws them at screen pixels (`nodeGraphModuleFaceDrawAllGl` in `public/node-graph-gl-graph.js`). Display numbers and labels that are burned into the display texture scale with the quad, so they go soft when the workspace is zoomed.

Argi is about to add canvas layering in Performance view. That needs one ordered draw list, shared with the workspace.

## 2. What already landed (do not redo)

ZP-2 / the GPU workspace path already did a large part of "keep the picture as a texture":

- Every display renders on the **one shared WebGL2 context** (`public/lib/visual/picture-device.js` / `nodeGraphPictureDevice`). `public/lib/visual/gl-line-renderer.js` uses that same context (`ensure()`).
- After a face presents, `nodeGraphSharedGlCopyToContext` does a **GPU-to-GPU** copy into a per-face texture at the face canvas size (zoom-1 backing). The GL graph samples that texture in `drawImages` via `nodeGraphSharedGlFaceTexture` — no `readPixels`, no per-frame `texImage2D` of the 2D bitmap (ZP-2).
- A `.node-display-canvas` inside `#nodeGraphWorkspace.gl-graph-on` is **texture-only**: CSS hides the bitmap (`visibility: hidden !important`), and `nodeGraphSharedGlFaceTextureOnly` skips the HEAD `drawImage` onto the 2D canvas.
- Display frames that only need a new picture call `nodeGraphGlGraphPresentDisplaysOnly` / `PresentDisplaysSoon`, which **replay the cached dots-layer mesh**. Face quads sample the live textures. A zoom gesture replays all layers and only changes the camera uniform (ZP-3). Display hold stays off.
- Snapshots (`nodeGraphGlLinesSnapshot`), TV-cable publish, the mini perform view, perform tiles, the magnifier, and smokes that need pixels (`nodeGraphSharedGlFacePixels`) already go through the face texture when the consumer is a GL `nodeGraphGlLinesImage` path.

What this is **not**: per-module draw order, or screen-resolution display text.

## 3. What is still wrong

The workspace present (`nodeGraphGlGraphPresent` in `public/node-graph-gl-graph.js`) still splits a module across CSS layers:

| Canvas | CSS z-index | Contents today |
|---|---|---|
| `node-gl-graph-canvas` | 0 | All plates (except Text Box "Show on top"), chrome, **all** parameter faces, rails |
| `node-gl-graph-wires` | 3 | Cables (two canvases sandwich Text Box HTML: behind / in front of wires — `docs/GPU_WORKSPACE_PLAN.md`) |
| `node-gl-graph-dots` | 4 | Contact dots, then **all** display quads (`nodeGraphGlLinesImage` of each face canvas), button captions, round shapes, output pause bars |
| veil batch (dots canvas, kept) | 4, after displays | "Show on top" Text Box plates, veils, constraint badges |
| `node-gl-graph-snake` | 8 | Select trail, above the mini view |

`nodeGraphGlGraphRebuildPlates` walks `patch.nodes` and pushes **all plates**, then **all displays**, as two flat lists. The present draws every plate and every parameter face first, then every display on the dots canvas. A back module's display therefore always paints above a front module's plate, chrome, and parameter face.

Display text is still drawn **into the face present**, at display backing resolution:

- `nodeGraphFaceTextSet` / `nodeGraphFaceFrameDraw` in `public/node-graph-module-scope-paint-helpers.js` (MIDI CC numbers strip, and the same hook for other waterfall face text).
- `NODE_GRAPH_WATERFALL_FRAME` in `public/node-graph-module-scope-waterfall.js` is the single source of truth for waterfall padding (left margin + fade). `nodeGraphWaterfallGlPresent` calls `nodeGraphFaceFrameDraw` onto the present, then still calls `nodeGraphDisplayCanvasBlit` (which, in the workspace, becomes the GPU face-texture copy — the 2D bitmap stays unused).

`.pixelated-canvas-zoom` in `public/styles.css` (nearest-neighbour above 2.5x) still targets the DOM display canvases. The workspace path already passes `nearest: pixelated` into `nodeGraphGlLinesImage` when `zoom > 2.5`. After the DOM canvases go away, that CSS rule is not enough; the GL `nearest` flag is the real policy.

Performance-view tiles reparent faces into `.node-layout-canvas-tile` / `.node-screen-solo-host` (`public/node-graph-layout-canvas.js`). Those canvases are **not** inside `#nodeGraphWorkspace.gl-graph-on`, so they still get the HEAD 2D `drawImage` as well as a face texture. `nodeGraphGlGraphPresentTiles` then runs the same GL present into the tile. Screen-solo / Performance ink scale is `nodeGraphGlLinesInkScale` (only not 1 inside `.node-screen-solo-face`).

Hit-testing (`nodeGraphGlHitContextElement` and friends) still `querySelector`s `.node-display-canvas` (and scope / XY-pad canvases) and uses `nodeGraphGlGraphWorldBox`. Mini perform (`nodeGraphGlMiniPerformDisplays`) does the same.

## 4. Target design

- Each display still renders its **picture** on the shared device at its own pixel-for-pixel resolution: layout CSS x dpr (capped at 2) x the Performance-view ink scale (`nodeGraphGlLinesInkScale`). It keeps the result as a GPU texture. Waveform / raster content stays at that cheap size, so graphics cost is no worse than today.
- The workspace pass draws each module **back to front**, as one stack:
  1. plate / chrome
  2. parameter face (already screen pixels, `nodeGraphModuleFaceDrawAllGl`)
  3. display texture, placed in its layout rect
  4. that display's **text** (and waterfall frame chrome) at **screen resolution**, through `nodeGraphGlLinesText` / the shared drawer only
  5. then the next module
- Overlap then works by draw order alone. A front module's plate hides the back module's display and text.
- Performance-view layers become more entries in the same ordered list: **layer then module then parts**. The workspace (Arrange) is the same list with a single implicit layer. Until the Arrange toolbar (section 4.3) exists, module order stays `patch.nodes` order. There is no raise-on-click. When the toolbar later sets z-order (and Performance-view layers add a stack index), this list is the one place that order is applied.
- Display text stays crisp at any workspace zoom, the same way parameter-face text already does. Do not size display backing by workspace zoom. Do not re-bake the picture at zoom. Nearest-neighbour above 2.5x stays the picture-quad filter, not a reason to raise backing resolution.

Policies that already apply, and still apply:

- Display / face text and graphics are WebGL only, through `public/lib/visual/gl-line-renderer.js` (`nodeGraphGlLinesText`). Never DOM overlays or 2D-canvas text.
- Displays are pixel for pixel. Modules should feel like small, carefully designed hardware devices.
- External standards never dictate UX.
- Zoom 1.0 is the source of truth. The camera only scales that layout (`docs/GPU_WORKSPACE_PLAN.md`).
- No canvas-2D fallback. GL failure is black + `nodeGraphDisplayGlFailed`.
- Gesture behaviour stays: cached mesh replay, live face textures, no display hold, `GATE=1` `scripts/probe_zoom_perf.mjs` must stay green.

### 4.1 Cables vs the module stack

**Decided (Argi, 2026-11-11, America/Phoenix):** draw **all cables under the module stacks**. The Text Box wire sandwich is unchanged: the wire canvases stay, so "Behind wires" / "In front of wires" and "Show on top" keep working as in `docs/GPU_WORKSPACE_PLAN.md`.

Today cables sit on their own canvas **between** all plates and all displays: cables paint over chassis, under displays. That global split is exactly what prevents a front plate from covering a back display. The only way overlap works is for a module's plate and its display to share one draw order on the same target (one batch / one color buffer), back to front.

This is a visible change: cables that used to cross a module plate on top of the chassis will go behind that module, and a front module will also cover cables that used to show between its plate and a back module's display. Clip-or-stencil around display rects is not in this overhaul.

Do not invent a DOM text overlay, a fourth "all text" canvas, or a second compositor.

### 4.2 One ordered list

Build the list once per rebuild (not per display frame):

    for layer in layersBackToFront:          # workspace: one implicit layer
      for module in modulesBackToFront:      # patch.nodes until the Arrange toolbar sets z-order
        plate, chrome, rails that belong to it
        parameter face
        each display quad (texture, layout rect, nearest flag)
        that display's screen-resolution ink: frame padding, face text, pause / protect banners

"Show on top" Text Boxes stay a post-pass on the veil, as they do now, unless a later Text Box change says otherwise.

Display-only frames keep a **replay** of the cached mesh (now including per-module display quads and screen-res text that is static for that mesh). When only the picture texture changes, replay is enough. When face text cells change (`nodeGraphFaceTextSet`), mark the text runs dirty and either rewrite those text commands or do one rebuild — do not burn the numbers into the cheap texture.

### 4.3 Arrange helper: Display Settings, z-order, and blend (architecture only)

These belong with Arrange / Performance layering controls. Recorded here so the ordered list and the later toolbar share one design. Do not implement them in the first coding pass of stages 1-4, and do not start any of this until the 1D-scope Array-buffer hold lifts.

- **Right-click a display in Arrange view** opens Display Settings for that display (the existing settings for that face, not a new panel type). Hit-testing must resolve the display under the pointer once displays are GPU quads (section 6). This is an Arrange-view gesture; it must not fight Performance-view pointer forwarding or the mini view.
- **Arrange toolbar** (a small Arrange-view helper) for setting **z-order** and **blend modes**. Z-order is set here, not by clicking a module to raise it. The toolbar writes the stack index that section 4.2's ordered list already consumes. Blend modes are entries on that same list (how a module or display composites over what is behind it), so Performance-view layers and Arrange overlap stay one path.

Until the toolbar exists, Arrange z-order remains `patch.nodes` order.

## 5. Stages

**Decided (Argi, 2026-11-11, America/Phoenix):** do the **entire** layering overhaul (all stages), not only a gated first step. Switches can still be used while landing work, but the goal is the full overhaul.

**Hold:** do not start coding these stages until the other agent's Array-buffer allocation failure work on the 1D scope draw path is done. Argi previously told Misty not to change anything yet for that reason; that hold stands.

Each stage should still land in a working tree of its own, behind a switch if that helps A/B while it is in progress. **Git for this work (overrides the original brief):** commit all work, squash unpushed local work, and push; then leave the tree clean. Merge with origin, no rebase. Never force-push, stash, `reset --hard`, or switch branches. Do not squash or rewrite commits that are already on origin. The `Co-Authored-By: Claude Opus 5.5` trailer is not required on every commit; use it only when a commit is clearly that agent's already-attributed work.

Other sessions edit the same tree: commit only your own files and hunks. Preserve each file's line endings (many are CRLF; edit byte-exact, never Git Bash sed -i, which strips CR). Bump `?v=` cache tags in `public/index.html` and `public/perform.html` for every changed script (live runtime / worklet tags live in `public/node-graph-live-runtime.js`).

### Switch

One const in `public/node-graph-gl-graph.js` (or a tiny dedicated flags object used by the present path), default all off until a stage is proven, then flip that stage on in its commit:

    const NODE_GRAPH_DISPLAY_COMPOSITE = {
      waterfallInPass: false,   // stage 1
      faceTextInPass: false,    // stage 2
      customFacesInPass: false, // stage 3
    };

Stage 4 removes the per-display canvases and then removes the flags. No URL query is required; a const is enough for A/B while a stage is in progress. Do not bring back `?glGraph=0`. The flags are a landing aid, not a reason to ship only stage 1.

While a flag is on, that family of displays is drawn in the per-module stack on the **same batch as the plate** (the graph canvas, or whatever single target the ordered list uses). Other displays stay on the dots layer until their stage. Mixed z behaviour during migration is expected and is why the switch exists.

### Stage 1 — Waterfall displays in the workspace pass

**Test modules:** MIDI CC, Output.

- Keep `nodeGraphWaterfallGlPresent` (`public/node-graph-module-scope-waterfall-gl.js`) as the picture producer: present the tape into the shared device at the existing backing size, land it on the per-face GPU texture.
- When `waterfallInPass` is on, those display quads are issued in the module's slot in the ordered list (after that module's plate / chrome / parameter face), not in the global "all displays" dots loop.
- Do **not** yet move face text or frame padding out of the present (that is stage 2). Stage 1 is compositing order only.
- Leave the hidden DOM canvas in place as the texture key, size owner, and hit target.
- Gesture / displays-only replay must still sample the live waterfall texture without a full rebuild.

**Done when:** two overlapping modules (for example MIDI CC behind Output, and the reverse) hide the back waterfall when the front plate covers it. Picture quality and fps are unchanged. `GATE=1` zoom probe still passes. Flag can default on after the visual check.

### Stage 2 — Display text in the per-module layer

These already exist; move them, do not invent a new text path:

- `nodeGraphFaceTextSet` / `nodeGraphFaceFrameDraw` in `public/node-graph-module-scope-paint-helpers.js` (the MIDI CC numbers strip, and any other `_faceText` cells).
- `NODE_GRAPH_WATERFALL_FRAME` in `public/node-graph-module-scope-waterfall.js` — **keep this the single source of truth** for waterfall padding (minPadY, padRight, padLeft, fadeLeft). `nodeGraphWaterfallFramePx` / `nodeGraphWaterfallPlotBox` stay the layout math so the waveform never runs over the numbers or the margin.

When `faceTextInPass` is on:

- Waterfall present draws **only the tape** (plus anything that must be burned into history, e.g. stamped pause/protect fade frames that scroll away — `nodeGraphWaterfallGlStampInk`). It does not call `nodeGraphFaceFrameDraw` into the cheap texture.
- After the display quad in that module's stack, the workspace pass draws the left plate margin, the fade, and the face text at **screen resolution** (device pixels of the workspace canvas, same as parameter-face text). Use `nodeGraphGlLinesBegin` / `nodeGraphGlLinesText` / `nodeGraphGlLinesRect` only.
- The reserved strip and frame padding are still computed in **layout CSS space** (zoom-1), then placed by the camera, so plot-box insets do not change with zoom.
- `nodeGraphFaceTextSet` no longer needs to re-present the whole waterfall just to change the numbers; it dirties the module's text runs.

**Done when:** MIDI CC numbers (and any other face-text cells) are crisp at 1x, about 2x, and well above 2.5x, and they hide correctly when a module overlaps them. The tape itself stays at cheap resolution. Padding still matches `NODE_GRAPH_WATERFALL_FRAME`.

### Stage 3 — Custom faces that already use `nodeGraphGlLinesBegin`

Same compositing path as stage 1, then the same text split as stage 2 where the face has labels or readouts that should stay crisp.

Named in the brief, plus the rest of `public/modules/*/`:

- `public/modules/clock/clock-display.js`
- `public/modules/pitchManager/pitch-manager-display.js`
- `public/modules/blitTrigger/rounding-error-display.js`
- Every other `public/modules/*/*-display.js` (and the shared scope faces that are not waterfalls).

Inventory at plan time: many already call `nodeGraphGlLinesBegin` (clock, pitch manager, rounding-error, additive*, amp-curve, arp, attack-decay, clock-divider, ensemble, formant, harmonic*, image-burn, midi-monitor, logic, phone-tone, plot, rgb-*, slew, soft-clipper, softpop, spectrum1d, transport, trigger-divider, t-series crossfade, vactrol, wall-delay, and others). Some still go through a specialist GL path (waterfall-xyz, spectrogram, raster, video, asciiscope, and others). Those specialists still present onto the shared device and must join the same ordered list; they do not get a private compositor.

For each face:

- Picture stays at layout CSS x dpr (cap 2) x ink scale, as a face texture.
- Vector / text ink that should stay crisp (labels, readouts, banners) is drawn in the per-module layer at screen resolution, not baked into the texture.
- If a face is only a picture (no text), stage 3 is "quad in the ordered list" only.

**Done when:** every live workspace display of these faces goes through the pass, overlaps correctly, and any face text is crisp at zoom.

### Stage 4 — Remove per-display canvases and the per-frame copy

Only after every display goes through the pass (workspace, Performance tiles, screen solo, mini Performance view).

- Stop calling `nodeGraphDisplayCanvasBlit` / the 2D present context for those faces. The present lands only in the face texture (or, if a later cleanup draws the picture straight into the face FBO, drop the shared-canvas intermediate too — not required to start stage 4).
- Remove the hidden `.node-display-canvas` DOM nodes from the live workspace once nothing keys off them. Replace the WeakMap canvas key with a stable face identity (node id + face slot). Keep a sizing / layout record at zoom-1 CSS.
- Delete dead helpers that only exist to blit into those canvases, once no caller remains (no shims).
- CSS: retire `.node-graph-workspace.gl-graph-on .node-display-canvas` hide rules and the `.pixelated-canvas-zoom .node-display-canvas` rule if nothing on-screen uses them; the GL `nearest` flag stays.
- Remove `NODE_GRAPH_DISPLAY_COMPOSITE` once the old path is gone.

Stage 4a (landed 2026-11-11): every display Argi sees composites from its face texture.
- Canvas view section tiles and screen solo: `nodeGraphGlGraphPresentFaceHost` draws each display's face texture plus its screen-res ink (frame, face text, Output pause bars) into one GL canvas behind the face's own DOM (`.gl-face-host`). Whole-module tiles hold their `PresentTile` mesh and replay it on displays-only frames, so their displays keep running.
- `nodeGraphSharedGlFaceTextureOnly` covers `.gl-face-host` too, so no 2D bitmap is drawn for a composited face anywhere; a new face texture starts empty (no canvas upload) and a composited face with no texture yet draws nothing (no `texImage2D(canvas)` back door).
- Quad filter flags: `nodeGraphGlGraphFacePin` (pixelated class / inline pixelated = nearest at every zoom; `.display-canvas-smooth` / inline auto = linear) in the workspace, its replay, tiles and Mini Canvas. The `.pixelated-canvas-zoom .node-display-canvas` and pinned-smooth CSS rules are gone; the 2.5x threshold is unchanged.
- Wire end dots draw in their module's stack (a module in front hides them); only free ends (drag cursor) stay on the dots canvas.
- `NODE_GRAPH_DISPLAY_COMPOSITE` is gone. Mini Canvas and the display hit-test already read the published rects.

Stage 4b (left): the DOM canvases are still there as hidden layout records and texture keys. Swap `nodeGraphDisplayCanvasCreate` and the raw `createElement("canvas")` faces for a non-canvas face box keyed by node id + face slot, replace `nodeGraphDisplayCanvasPresentContext` (still `getContext("2d")`) with a present target, delete `nodeGraphDisplayCanvasBlit`, then retire the hide rules. Display canvases outside any GPU pass (popups, floating windows, embeds that are not tiles) still show their own 2D bitmap.

## 6. Also migrate (they still depend on DOM display canvases)

Do these as part of the stages that would otherwise break them, and finish any leftovers in stage 4. Do not leave a 2D canvas as a back door.

- **Hit-testing on displays.** Today `nodeGraphGlHit*` queries `.node-display-canvas` / `.node-module-scope-canvas` / `.node-xy-pad-canvas` and uses `nodeGraphGlGraphWorldBox`. Move to published zoom-1 display rects in the same geometry used to place the quads (`nodeGraphGlGraphLayoutBox` / module layout). Special faces that are real controls (XY pad, knob, graph face, and the rest of the GW-4 list) stay transparent HTML hit targets; the GPU still paints them.
- **`.pixelated-canvas-zoom`** (`public/styles.css`, nearest-neighbour above 2.5x). The workspace already sets `batch` / `dotBatch.textPixelated` and `nearest: pixelated` on the quad. Carry that flag with the ordered-list quad. Apply the same filter in Performance tiles and the mini view. When a face pins smooth (`.display-canvas-smooth` / `nodeGraphDisplayCanvasPixelated` with pinSmoothWhenOff), honour that on the quad, not via CSS on a hidden canvas.
- **Snapshots / thumbnails.** Already texture-based (`nodeGraphGlLinesSnapshot`, `nodeGraphSharedGlFaceCopyTexture`, `nodeGraphSharedGlFacePixels`). After canvas removal, those helpers must take the face identity / texture entry, not a 2D canvas. Smokes that read face pixels keep using `nodeGraphSharedGlFacePixels`.
- **Output pause / protect banners (face ink).** `paintNodeGraphOutputPauseBars` is already drawn in the workspace present (dots batch) for paused Output displays. `nodeGraphFaceInkDraw` / `stampNodeGraphOutputPauseBanners` / protect fades also ink the face. Banners and guides that should stay crisp become screen-resolution ink in that module's layer (stage 2/3). History-stamped ink that must scroll with the tape stays in the waterfall texture (`nodeGraphWaterfallGlStampInk`). No second DOM overlay.
- **Screen solo and Performance-view tiles** (`public/node-graph-layout-canvas.js`, `nodeGraphGlGraphPresentTiles` / `PresentTile`). Tiles already reuse `nodeGraphGlGraphPresent` with `state.view`. Once the ordered list lives in that present, tiles get it for free — but only if they stop depending on a 2D blit of a reparented canvas. Extend "texture only" (or always-texture) so a face that is not inside `#nodeGraphWorkspace.gl-graph-on` still composites from the face texture. Ink scale (`nodeGraphGlLinesInkScale`) stays the Performance / solo size term in the picture resolution.
- **Mini Performance view** (`public/node-graph-mini-perform.js`, `public/node-graph-gl-mini-perform.js`). Already a GPU mirror: `nodeGraphGlMiniPerformPresentModule` saves workspace GL state and calls the same present; `nodeGraphGlMiniPerformDisplays` still lists `.node-display-canvas`. Switch that collection to published rects + face textures. Pointer forwarding must keep working without a DOM canvas under the cursor.

- **Arrange: right-click a display** to open Display Settings for that display. Depends on the migrated display hit-test (the bullet above). Arrange-view only.
- **Arrange toolbar** for z-order and blend modes (section 4.3). The ordered list must already accept a stack index and a blend mode so the toolbar has somewhere to write. Performance-view canvas layers use the same fields.

## 7. Cost and zoom

- Picture resolution does not grow with workspace zoom. Same cap (dpr at most 2) and same ink scale as today.
- No extra per-frame 2D copy in the workspace. Stage 1-3 may still GPU-copy into the face texture on paint (already the ZP-2 path); stage 4 may collapse that if it is free, but must not add a CPU readback.
- Screen-resolution text is the same glyph-atlas path as parameter faces (ZP-5: bake size from zoom-1, never from zoom).
- Displays-only frames stay a mesh replay. Do not rebuild cables when only a scope frame changed.
- Measure: `GATE=1 node scripts/probe_zoom_perf.mjs softpop` (and the video-graph gate if that patch is touched). Play-only fps should stay at the current 60. If a stage regresses p90 or adds `readPixels` / mid-gesture style reads, it is not done.

## 8. File rules (implementation, later)

- Preserve each file's line endings. Many are CRLF and some are mixed. Edit byte-exact, for example with Python on raw bytes. Never Git Bash sed -i (it strips CR).
- Bump the `?v=` cache tags in `public/index.html` and `public/perform.html` for every changed script (live runtime / worklet tags live in `public/node-graph-live-runtime.js`).
- Other sessions edit the same tree. Commit only your own files and hunks. Never stash, `reset --hard`, or switch branches. For this overhaul: commit all of its work, squash only unpushed local commits (no rewrite of origin), merge origin (no rebase), and push. Never force-push.
- Preview: `.claude/launch.json` config `soemdsp-sandbox`. Click START SANDBOX before the app's functions exist. The Browser pane must be visible for modules to render.
- This plan file is LF, like the other `docs/*.md` plans next to it.

## 9. Done means

- Displays and their text draw in z-order in one pass.
- Overlapping modules hide each other's displays and text.
- Display text is crisp at any zoom.
- Performance view and mini Performance view still work (tiles, screen solo, pointer, ink scale).
- Graphics cost is no worse (zoom probe + play fps).
- Checked in the browser at several zooms and with overlapping modules (MIDI CC, Output, plus at least one custom face from stage 3).
- The ordered list is ready for the Arrange toolbar's z-order and blend, and for Performance-view canvas layers. The toolbar and the Arrange right-click for Display Settings are follow-on controls (section 4.3), not a reason to delay stages 1-4 once the hold lifts.

## 10. Test plan (each stage, in the browser)

- Arrange two modules so they overlap (back / front by `patch.nodes` order). Confirm the front plate, chrome, parameter face, display, and display text cover the back module's display and text.
- Zooms: 1x, just below 2.5x (smooth picture filter), just above 2.5x (nearest), and a large zoom (for example 8-40x). Picture stays cheap and pixel-for-pixel; text stays crisp.
- MIDI CC: numbers strip stays in the reserved band, not over the tape, and does not smear when the waterfall scrolls.
- Output: pause / protect banners draw as face ink, stay crisp, and still follow pause / protect behaviour (including tape-stamped fades).
- Performance view: existing tiles still paint; when canvas layers land, back-to-front layer order matches the same list.
- Arrange (when section 4.3 lands): right-click a display opens that display's Display Settings; the Arrange toolbar sets z-order (not raise-on-click) and blend, and overlapping modules follow the new order.
- Mini Performance view: modules, displays, and pointer forwarding still work; empty-canvas / enlarged paths untouched unless they collect display canvases.
- Gesture: displays keep running while zooming; no slideshow; no new light-blob / settle regressions.
- Smokes that already cover faces: `smoke_display_face_orientation.mjs`, `smoke_display_gl_programs_link`, `smoke_engine_state_stopped_faces`, `GATE=1` zoom probe. Update any smoke that still samples a 2D bitmap of a texture-only face.

## 11. Decisions (Argi, 2026-11-11, America/Phoenix)

1. **Cables vs module stacks.** Decided: cables under the module stacks. Text Box wire sandwich unchanged. This is a visible change from "cables over plates, under displays." Clip-around-displays is not in this overhaul.
2. **Module order.** Decided: keep today's `patch.nodes` order, with no raise-on-click, until Performance-view layers exist. Z-order will be set later via the new Arrange toolbar (section 4.3), not by clicking a module to raise it.
3. **Scope.** Decided: do the **entire** layering overhaul (all stages), not only a gated first step. Switches can still be used while landing work, but the goal is the full overhaul. **Do not start coding** until the other agent's Array-buffer allocation failure work on the 1D scope draw path is done. Argi previously told Misty not to change anything yet for that reason; that hold stands.
4. **Git for this work.** Decided: commit all work, squash unpushed local work, and push (then leave the tree clean). This overrides the original brief's "never push" / "commit when a step works, never push." Merge with origin, no rebase. Never force-push, stash, `reset --hard`, or switch branches. Do not squash or rewrite commits that are already on origin.

Also recorded (architecture, not implement until the hold lifts and, for these two, not in the first coding pass of stages 1-4):

- Right-click a display in Arrange view to open Display Settings for that display.
- An Arrange helper: a toolbar in Arrange view for setting z-order and blend modes.
