# Mini performance view plan

**Source:** Argi, 2026-10-18: "couldn't we have an f mode where we see the performance screen in a mini screen in the workspace? … make it a page with these things, make plan implement right away".
**Status:** MP-1..MP-6 and MP-8 implemented 2026-10-18 (local commit, not pushed). MP-7 waits for Pencil PE-4; MP-9 needs Argi's OK.

**Goal:** while the circuit builder (workspace) is open, show a live, scaled-down copy of the performance screen (the F canvas) inside the workspace. A new Command Center page turns it on and holds its settings. The workspace keeps working underneath; nothing is moved out of the modules.

## Repo read (2026-10-18)

### How the performance screen works today

- **F mode is the layout canvas**, `public/node-graph-layout-canvas.js`. `toggleNodeGraphLayoutCanvasView` (L725) cycles **off → perform → edit (arrange) → off**. Callers: F key (`node-graph-keyboard-shortcuts.js` L393-406, after the metamodule selection check), the 📱 phone button `#nodeModularWindowedViewButton` (`index.html` ~L300, via `node-graph-view-controls.js` L938-958), and the scene menu (`node-graph-scene-menu-event-bindings.js` L157, L169). State: `nodeGraphMvp.layoutCanvasMode` (`"off" | "perform" | "edit"`), read by `nodeGraphLayoutCanvasMode` (L257).
- **Layout data (the source of truth):** `patch.view.canvases.root.elements` and `patch.view.canvases.byMetamodule[metaId].elements` (L7-60). Each element is `{ nodeId, enabled, x, y, w, h, z }`, with x/y/w/h as **fractions of the stage**, normalized by `SoemMath.normalizeCanvasTileRect` (`nodeGraphLayoutCanvasNormalizeRect`, L183). The scope is the open metamodule or root (`nodeGraphLayoutCanvasActiveScopeId`, L29). Pins come from "Show in canvas" (`node.ui.showInCanvas`, `nodeGraphLayoutCanvasPinnedNodeIds`, L129).
- **Opening F reparents the live faces.** `beginNodeGraphLayoutCanvasStage` (L414) collects faces (`nodeGraphScreenSoloCollectFaces`, `node-graph-screen-solo.js` L969), leaves a placeholder in each module, and moves each face into an absolute `.node-layout-canvas-tile` on the full-screen `#nodeScreenSoloStage` (`ensureNodeGraphScreenSoloStage`, screen-solo L279). Tile px = rect fraction × stage size (`nodeGraphLayoutCanvasApplyTileRect`, L372). It also hides whole-module In/Out (`nodeGraphLayoutCanvasSetIoHidden`, L662), and opening perform **starts transport** (L617-628).
- **Fit inside a tile:**
  - Whole-module tiles (`node.ui.canvasWholeModule`) keep their zoom-1 layout and are uniformly scaled to fit with padding: `nodeGraphScreenSoloWholeModuleFit` (screen-solo L867; pad from `nodeGraphScreenSoloWholeModulePadPx` L861; natural size captured at L854 as `_wholeModuleNatural`). Their GL picture comes from `nodeGraphGlGraphPresentTile` (`node-graph-gl-graph.js` L1434): the same GL graph pass, run with a `view` (host, ids, zoom, cam, toWorld) for that one module.
  - Display faces (not whole-module) get the solo-face stretch rules and are re-painted at the tile's size.
- **perform.html / phone / embed:** `public/perform-boot.js` adds `node-perform-mode`, blocks edit mode and (plugin host) live output. The workspace is never shown there.
- **Metamodule shell faces** already present pinned child faces on the Meta face by reparenting (`modules/metamodule/metamodule-display-mirror.js`, `nodeGraphMetamodulePresentCanvasOnFace` L255). An older blit mirror (`.node-metamodule-mirror-canvas`) is retired (always hidden).

### How the workspace draws displays

- One hidden WebGL2 **picture device** (`public/lib/visual/picture-device.js`) does the GPU work; face canvases (`.node-display-canvas`) are presentation surfaces.
- The GL graph lists every module's display canvases in `nodeGraphGlGraphRebuildPlates` (gl-graph L112-179, `state.displays`: canvas, node id, zoom-1 world box) and draws each as a textured quad with `nodeGraphGlLinesImage(dotBatch, face.canvas, …)` (L1352-1368; library L915). Plates, chrome, titles, sliders, seed rows, captions and veils are GL too. The GW-2 camera uniform places everything (`frameCamera`, L1203).
- **Culling:** offscreen modules are `display:none` through the IntersectionObserver cull (`node-graph-viewport-perf.js` L1169-1210, `nodeGraphViewportCullApply` L1136, painters slept at L847). Scope paint skips offscreen slots (`node-graph-module-scope-screen-items.js` L527-535) unless the face sits on a stage (L500-515). Open bug **B-069** (canvas mode misses displays that were out of view) is the same visibility problem.

### Command Center pages

Same ten places as `docs/PENCIL_PAGE_PLAN.md` (Repo read → Command Center pages). The newest, simplest model is the **Emojis** page:
- registry `nodeGraphUnifiedWindowPages.emoji` (`node-graph-unified-window.js` L105-112) and `nodeGraphUnifiedWindowPageOrder` (L117-129);
- size hook (L479), close switch (L602), open switch (L904), nav host list (L1590);
- floating-window registry (`node-graph-floating-windows.js` ~L958, drag/resize keys);
- persistence page list and element map (`node-graph-ui-settings-persistence.js` L24, L41);
- page DOM `#nodeEmojiPage` in `index.html` (L549) and `perform.html` (L545), with its own script (`node-graph-emoji-page.js`, listed in `scripts/smoke_test.py` L91).
- Outside-click selectors (`node-graph-context-menu.js` L2807, `node-graph-selection.js` L157) list some pages; add the new page there like `#nodePatchDefaultsPanel`.

## Approach (decided for v1): GPU mirror, no reparenting

A DOM face can only live in one place. F mode moves faces out of the modules, so a "live copy" that also reparents would empty the modules the user is editing. The mini view instead **draws a second GL picture of the same faces**:

- Display faces: the mini pass draws each pinned module's existing display canvases as textured quads (`nodeGraphGlLinesImage` path, same as the workspace display quads).
- Whole-module tiles: the mini pass runs the GL graph module pass for that module with a `view` mapped onto the mini tile, the same mechanism `nodeGraphGlGraphPresentTile` uses for perform tiles.
- Faces stay in their modules. The workspace, F mode and the metamodule face sessions are not touched.

Rejected for v1: reparenting faces into a mini stage (empties modules, fights the screen-solo singleton and metamodule sessions); an iframe of `perform.html` (second app and engine); a 2D/CSS/SVG copy (APP_POLICY §16).

## Rules (policy)

- **WebGL2 only (§16).** The mini view is one GL canvas drawn through `gl-line-renderer.js` on the picture device. No 2D context, SVG, CSS paint or DOM clone of faces. GL failure → no mini picture, logged with `nodeGraphDisplayGlFailed(canvas, "GL mini perform begin")` (GW-7 pattern).
- **Zoom 1.0 / no reflow.** The mini view is the perform layout at a **reference screen size**, scaled uniformly by one factor `s = miniWidth / referenceWidth`. Tile rects are `rect × reference size × s`. Whole-module tiles use the same fit math as `nodeGraphScreenSoloWholeModuleFit` (padding and contain) computed at reference size, then × `s`. Nothing is laid out at mini size.
- **Read-only to the patch.** The mini view never writes `patch.view.canvases`, never pins or unpins, never changes transport (opening it does **not** press Play the way F perform does), never touches audio. No JS audio DSP.
- **No legacy shims.** No compatibility paths, no aliases for old settings.
- **Shared code over copies.** One rect/fit helper used by both F and the mini view (app code: move the fit math out of `nodeGraphScreenSoloWholeModuleFit` into a pure helper and call it from both). One GL module pass (the `view` path), not a second plate/chrome renderer.
- **Library:** v1 needs **no** library edit. It only calls existing `gl-line-renderer.js` functions (`nodeGraphGlLinesBegin`, `Image`, `Rect`, `Text`, `End`). A per-frame shared texture cache for face canvases (so the workspace and the mini view upload each face once per frame) would be a library edit and needs Argi's OK; it is listed as optional MP-9.
- **Full-word labels**, no "RGBA".
- **UI never blocked by engine state.** With audio stopped the mini view shows the same cold plates the faces show.

## Design

### Command Center page

- Page key `miniPerform`, label **"Mini Performance View"**, icon 🖼️ (U+1F5BC U+FE0F), element `#nodeMiniPerformPage`, nav position after `patchDefaults` (before `pencil` if that lands first). Script `public/node-graph-mini-perform.js` (page, state, layout math, hit testing) and the GL pass in `public/node-graph-gl-graph.js` (or a sibling `public/node-graph-gl-mini-perform.js` if gl-graph is still under other agents' edits).
- Shortcut **Shift+F** toggles Show mini view (free today: the F handler requires no Shift). Listed on the Hotkeys page. Same typing gate as F.
- In `perform.html`, phone canvas and embed (`node-perform-mode`, `soemdspMobileCanvasMode`, `soemdsp-embed`), the page shows its controls disabled with the note "Only in the circuit builder." and the mini view never draws.

### Settings (UI preferences, `nodeGraphMvp.miniPerform`, saved in the UI settings blob as `view.miniPerform`)

| Setting | Values | Default |
|---|---|---|
| Show mini view | On / Off | Off |
| Anchor | Screen / Workspace | Screen |
| Corner (Screen) | Top left / Top right / Bottom left / Bottom right | Bottom right |
| Margin (Screen) | 0..200 CSS px | 16 |
| Position (Workspace) | zoom-1 world x, y (set by dragging) | centre of the current view when switched to Workspace |
| Width | 120..1600 px (Screen: CSS px; Workspace: zoom-1 world px, scales with the camera). Height follows the reference aspect. | 360 |
| Reference screen | Window / Phone portrait (9:19.5) / Phone landscape (19.5:9) | Window |
| Opacity | 0.1..1 | 1 |
| Pointer | Click-through / Interactive | Click-through |
| Refresh rate | Every frame / 30 / 15 per second | 30 per second |
| Show frame | On / Off (1 px border plus a dark backdrop matching the F stage) | On |

- **Reference screen = Window** uses the size `#nodeScreenSoloStage` would have now (`window.innerWidth × innerHeight`), so the mini view is exactly what F would show on this window. Phone presets use the same aspect as the arrange-mode phone guides (`NODE_GRAPH_LAYOUT_CANVAS_PHONE_ASPECT`, layout-canvas L273) with height = window height.
- **Scope:** follows the current view, like F (root, or the open metamodule's bucket).
- Screen anchor: drawn in CSS px in the workspace viewport (identity camera), like Pencil Screen layers. Workspace anchor: placed in zoom-1 world px through the GW-2 camera uniform, so it pans and zooms with the modules.
- Z: the mini canvas sits above `#nodeGlGraphDots` (in front of modules, wires, jacks). Popups and floating windows stay above it (they are chrome).

### What each tile shows

| Tile kind | Mini view draws |
|---|---|
| Display face | The module's display canvases (`.node-display-canvas`, as in `state.displays`) as textured quads. The face picture keeps its own aspect and is fitted **contain** inside the tile (uniform scale, centred). |
| Whole-module (`canvasWholeModule`) | The GL module pass for that one module (plates, chrome, sliders, seed rows, display quads), with the In/Out band cropped off (I/O sits above the face, so the crop is the top band) and fitted like `nodeGraphScreenSoloWholeModuleFit`. |
| Text Box pinned | Plate and text through the same module pass. Read-only preview; the mini view is not the grid, so GW's "one copy of Text Box text" rule (grid only) does not apply. |
| Face not yet GPU-painted (GW-4 list) | Whatever the GL graph paints for it in the workspace (plate); it fills in as GW-4 lands. |
| Empty canvas | Backdrop with "Canvas is empty. Turn on Show in canvas on a module." |

Known difference from F (accepted for v1): in F a stretched display face re-paints at the tile's aspect; the mini view shows the face's workspace picture fitted contain, and at the resolution the face canvas has at the current workspace zoom.

### Keeping pinned faces painting

While the mini view is shown, every node pinned in the current scope counts as **presented**: the viewport cull keeps it awake (`nodeGraphViewportCullApply` does not sleep it), and scope screen-items take the `presentedOnStage` branch for it (screen-items L500-515), so a module that is panned out of view keeps painting into its face canvas. One predicate, `nodeGraphMiniPerformPresentsNode(nodeId)`, used by both. This is the same fix shape as B-069; share it with that bug's owner.

### Pointer

- **Click-through:** the mini canvas has `pointer-events: none`; the workspace gets every event.
- **Interactive:** JS hit test against the mini rect (no GPU picking).
  - Click a tile: select its module and pan the camera to centre it (`nodeGraphMvp.pan` / `nodeGraphZoom`, signatures unchanged).
  - Double-click: open F perform (`toggleNodeGraphLayoutCanvasView` from off).
  - Drag the frame: move (Screen: snaps to the nearest corner and stores the margin; Workspace: stores world x, y). Drag a corner grip: resize width.
  - Wheel over the mini view does nothing in the mini view (the workspace still zooms).
  - Touch goes through `node-graph-touch-gestures.js` (PH-1): tap = click, double-tap = double-click, long hold shows hover info.

### Lifecycle

- Hidden while F perform or arrange is open (the faces are on the stage), while screen-solo is active, and on perform / phone / embed pages. It returns when F closes.
- Redraw triggers: display paint frames (throttled by Refresh rate), pin changes (`nodeGraphLayoutCanvasSetPinned`), arrange edits (`nodeGraphLayoutCanvasWriteRect`), patch load, metamodule view change, window resize (Reference = Window), camera change (Workspace anchor only; Screen anchor ignores pan and zoom).
- Pinned node deleted: it is already pruned by `nodeGraphLayoutCanvasPruneMissingPins`; the mini view only reads.

### Drawings (Pencil coordination)

After PE-4, Pencil layers with **Show in performance mode** draw in the mini view exactly as they would over the F screen: Module layers inside their module's tile; Screen layers (CSS px from a corner of the performance screen) scaled by `s` inside the mini rect; Workspace layers are not on the performance screen and are not drawn. Same cached stroke meshes, one extra transform; no second stroke path.

## Milestones

| ID | Step | Done when | Status | Owner |
|---|---|---|---|---|
| MP-1 | **Page and settings.** Register `miniPerform` in all ten places (Emojis page as the model); page DOM in `index.html` and `perform.html`; `public/node-graph-mini-perform.js` with the settings table above, saved as `view.miniPerform` in UI settings; Shift+F toggle (typing gate) and Hotkeys page row; disabled state on perform / phone / embed. | Page opens from the nav; settings persist across reload; Shift+F toggles Show mini view; nothing draws yet. | Done 2026-10-18. Settings in localStorage key `soemdsp.miniPerform` (per machine), not UI settings / patch. | Grok Bot |
| MP-2 | **Layout math (pure).** Shared helper that F and the mini view both call: reference size, `s`, mini rect for each anchor / corner / margin, tile rects from the scope's pinned elements (`nodeGraphLayoutCanvasPinnedElementsForScope`, z order), whole-module fit (moved out of `nodeGraphScreenSoloWholeModuleFit`, which now calls it), display contain fit, In/Out crop. | F tiles are pixel-identical before and after the refactor; mini rects equal F rects × `s`. | Done 2026-10-18. `node-graph-canvas-fit.js`; screen-solo and layout-canvas call it. | Grok Bot |
| MP-3 | **GL mini pass.** Canvas `#nodeGlGraphMiniPerform` above `#nodeGlGraphDots`; backdrop and frame; display quads via `nodeGraphGlLinesImage`; whole-module and Text Box tiles via the GL graph `view` path aimed at the mini tile; Opacity; Refresh rate throttle; Screen anchor identity camera, Workspace anchor GW-2 camera; GL failure → `nodeGraphDisplayGlFailed`. | With the window at size W×H, the mini view matches an F screenshot scaled by `s` (apart from the accepted display-fit difference); pan and zoom do not rebuild it (Screen anchor). | Done 2026-10-18. `node-graph-gl-mini-perform.js`. Backdrop is the clear colour (renderer draws images under rects). Workspace anchor re-lays out each frame (no GW-2 hook). | Grok Bot |
| MP-4 | **Keep pinned faces painting.** `nodeGraphMiniPerformPresentsNode` in the cull and in scope screen-items; coordinate with B-069. | A pinned scope panned out of view keeps moving in the mini view; with the mini view off, culling is unchanged. | Done 2026-10-18. Hook lines in viewport-perf and screen-items. | Grok Bot |
| MP-5 | **Pointer.** Click-through and Interactive modes; click select + centre, double-click opens F, drag move, corner resize; touch through the gesture layer. | Click-through never steals a workspace click; Interactive actions work at any zoom and with audio stopped. | Done 2026-10-18. Touch uses plain pointer events + own 320 ms double-tap, not the PH-1 layer (follow-up). | Grok Bot |
| MP-6 | **Lifecycle.** Hide during F / arrange / screen-solo and on perform / phone / embed pages; redraw triggers above; metamodule scope follows the view. Opening the mini view never starts transport. | F in and out leaves the mini view correct; entering a metamodule switches its contents; transport unchanged by the mini view. | Done 2026-10-18. | Grok Bot |
| MP-7 | **Drawings.** Pencil layers with Show in performance mode in the mini view (Module and Screen layers). | Same layers as over the F screen, at `s`. | Planned (after PE-4) | TBD |
| MP-8 | **Tests.** `scripts/smoke_test.py`: page registered in all ten places; `view.miniPerform` round trip; no 2D context / SVG in mini code; mini pass exists in the GL graph; layout helper unit checks (rect × `s`, corners, aspect presets, whole-module fit equals F); Shift+F bound with the typing gate; mini view never calls transport. | Checks pass. | Done 2026-10-18. `check_mini_perform_view`, `scripts/smoke_mini_perform_unit.cjs`, real-mouse probe `scripts/probe_mini_perform.mjs`. | Grok Bot |
| MP-9 | *Optional:* per-frame shared texture for face canvases so each face uploads once per frame for the workspace and the mini view. **Library edit (`gl-line-renderer.js`): needs Argi's OK.** Only if MP-3 profiling shows the second upload matters. | Upload count per frame halves with the mini view on. | Optional (needs Argi OK) | TBD |

**Order:** MP-1 and MP-2 in parallel, then MP-3, then MP-4, MP-5, MP-6 (any order), MP-8 alongside. MP-7 after Pencil PE-4. MP-9 only if needed.

## Coordination

- **`docs/GPU_WORKSPACE_PLAN.md`:** the mini view is a new GL canvas in the workspace host (add it to the GW-1 inventory as "workspace, GPU picture"). It uses the GW-2 camera uniform for Workspace anchor and the `view` path for whole-module tiles. `node-graph-gl-graph.js`, `node-graph-viewport-perf.js` and `node-graph-workspace-geometry.js` have other agents' uncommitted edits (git status 2026-10-18: also `index.html`, `perform.html`, `gl-line-renderer.js`, `node-graph-workspace-zoom.js`); agree with that owner before MP-3 / MP-4, or put the pass in a sibling file. GW-7 failure logging covers the mini canvas. GW-6 traces should include a run with the mini view on.
- **`docs/PENCIL_PAGE_PLAN.md`:** MP-7 reuses PE-4 meshes. The Pencil "In front of modules" canvas and the Snake select trail sit **under** the mini canvas; settle the final top-of-stack order in PE-4 together with this plan. Both pages go after `patchDefaults` in the nav.
- **`docs/PHONE_COMPAT_PLAN.md`:** MP-5 touch uses the PH-1 gesture layer; no new timers.
- **B-069** (`docs/B-069_CANVAS_MODE_OFFSCREEN_DISPLAY_MISSING.md`): MP-4 shares the presented-node predicate.

## Decisions (defaults chosen so work can start)

1. GPU mirror, no reparenting; faces stay in their modules.
2. Settings are UI preferences (not saved in the patch), like the magnifier.
3. Display faces fit contain inside their tile; whole-module tiles use F's fit with the In/Out band cropped.
4. Opening the mini view never starts or stops transport.
5. Shift+F toggles it; Click-through is the default pointer mode.
6. Hidden while F is open and on perform / phone / embed pages.

## Open questions (none block MP-1..MP-6)

1. **Save in the patch?** Default: no, UI preference (each machine keeps its own corner and size). Say so if a patch should carry "mini view on, bottom right, 360 px".
