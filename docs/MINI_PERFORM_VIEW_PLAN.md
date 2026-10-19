# Mini performance view plan

**Source:** Argi, 2026-10-18: "couldn't we have an f mode where we see the performance screen in a mini screen in the workspace? … make it a page with these things, make plan implement right away".
**Status:** MP-1..MP-6 and MP-8 implemented 2026-10-18 (local commit `4cc51840`, not pushed). MP-7 waits for Pencil PE-4; MP-9 needs Argi's OK. Round 2 (MP-10..MP-19: draggable corners, default cursor, fewer page controls, aspect ratio buttons, Enlarged double-click / Escape, "Performance view" naming with a labelled Show performance view [ F ] button, Shift+F cycles the mini view off → Perform → Arrange → off, empty-canvas cinematic line + optional DVD soundemote logo easter egg (🐞 debug panel), Snake trail above mini view) planned 2026-10-18, owner TBD; see the end of this file.

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
- **Read-only to the patch.** *(Round 2 MP-17 exception: in mini **Arrange** mode, dragging tiles writes tile rects in `patch.view.canvases` through `nodeGraphLayoutCanvasWriteRect`, exactly like F arrange. Mini **Perform** stays read-only.)* The mini view never writes `patch.view.canvases`, never pins or unpins, never changes transport (opening it does **not** press Play the way F perform does), never touches audio. No JS audio DSP.
- **No legacy shims.** No compatibility paths, no aliases for old settings.
- **Shared code over copies.** One rect/fit helper used by both F and the mini view (app code: move the fit math out of `nodeGraphScreenSoloWholeModuleFit` into a pure helper and call it from both). One GL module pass (the `view` path), not a second plate/chrome renderer.
- **Library:** v1 needs **no** library edit. It only calls existing `gl-line-renderer.js` functions (`nodeGraphGlLinesBegin`, `Image`, `Rect`, `Text`, `End`). A per-frame shared texture cache for face canvases (so the workspace and the mini view upload each face once per frame) would be a library edit and needs Argi's OK; it is listed as optional MP-9.
- **Full-word labels**, no "RGBA".
- **UI never blocked by engine state.** With audio stopped the mini view shows the same cold plates the faces show.

## Design

### Command Center page

- Page key `miniPerform`, label **"Mini Performance View"**, icon 🖥️ (U+1F5A5 U+FE0F; was 🖼️ in Round 1). Implemented page in local commit `4cc51840` still uses 🖼️ in `public/node-graph-unified-window.js` (`miniPerform.icon`); change it to 🖥️ when touching that registration (docs-only note — do not edit code in this pass). Element `#nodeMiniPerformPage`, nav position after `patchDefaults` (before `pencil` if that lands first). Script `public/node-graph-mini-perform.js` (page, state, layout math, hit testing) and the GL pass in `public/node-graph-gl-graph.js` (or a sibling `public/node-graph-gl-mini-perform.js` if gl-graph is still under other agents' edits).
- Shortcut **Shift+F** toggles Show mini view (free today: the F handler requires no Shift). Listed on the Hotkeys page. Same typing gate as F. *(Round 2 MP-17: Shift+F cycles the mini view off → Perform → Arrange → off.)*
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
- Z (Round 2 MP-19 supersedes v1): the mini canvas sits **above** modules / wires / jacks and **below** the Snake select trail. Popups and floating windows stay above everything (they are chrome). See Round 2 Design 9.

### What each tile shows

| Tile kind | Mini view draws |
|---|---|
| Display face | The module's display canvases (`.node-display-canvas`, as in `state.displays`) as textured quads. The face picture keeps its own aspect and is fitted **contain** inside the tile (uniform scale, centred). |
| Whole-module (`canvasWholeModule`) | The GL module pass for that one module (plates, chrome, sliders, seed rows, display quads), with the In/Out band cropped off (I/O sits above the face, so the crop is the top band) and fitted like `nodeGraphScreenSoloWholeModuleFit`. |
| Text Box pinned | Plate and text through the same module pass. Read-only preview; the mini view is not the grid, so GW's "one copy of Text Box text" rule (grid only) does not apply. |
| Face not yet GPU-painted (GW-4 list) | Whatever the GL graph paints for it in the workspace (plate); it fills in as GW-4 lands. |
| Empty canvas | Backdrop with one cinematic empty line (monospace, centred, almost full width, never wraps; MP-18). The bouncing soundemote logo is an **easter egg** (MP-18): off by default; shown only after the 🐞 button in the Debug Log panel is clicked. |

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
- **`docs/PENCIL_PAGE_PLAN.md`:** MP-7 reuses PE-4 meshes. Stack order with Pencil "In front of modules" and the Snake select trail is settled in Round 2 **MP-19** (Snake above mini; PE-4 In-front between mini and Snake, or same overlay with Snake last — see Design 9 / open question 19). Update PE-4 when that lands so the two plans do not disagree.
- **`docs/PHONE_COMPAT_PLAN.md`:** MP-5 touch uses the PH-1 gesture layer; no new timers.
- **B-069** (`docs/B-069_CANVAS_MODE_OFFSCREEN_DISPLAY_MISSING.md`): MP-4 shares the presented-node predicate.

## Decisions (defaults chosen so work can start)

1. GPU mirror, no reparenting; faces stay in their modules.
2. Settings are UI preferences (not saved in the patch), like the magnifier.
3. Display faces fit contain inside their tile; whole-module tiles use F's fit with the In/Out band cropped.
4. Opening the mini view never starts or stops transport.
5. Shift+F toggles it; Click-through is the default pointer mode. *(Round 2: Click-through removed (MP-11); Shift+F cycles off → Perform → Arrange → off (MP-17).)*
6. Hidden while F is open and on perform / phone / embed pages.

## Open questions (none block MP-1..MP-6)

1. **Save in the patch?** Default: no, UI preference (each machine keeps its own corner and size). Say so if a patch should carry "mini view on, bottom right, 360 px".

## Round 2: direct handling (MP-10..MP-19)

**Source:** Argi, 2026-10-18: "make a plan to add a more interactive performance view panel. 1. make the corners draggable 2. do not change mouse to hand when interacting with it 3. since the corners are draggable we can reduce the number of controls in the picture frame page 4. to get aspect ratios just provide a handful of buttons, wrapping, horizontally stacked or whatever". Follow-ups same day: "double click makes it bigger" / "escape to exit that view"; and the phone button should go straight to full-screen F (perform) instead of cycling through arrange. Then (superseding the phone-button follow-up): "shift f can do the same thing. have a button 'show game view [ f ]', shift f can cycle the mini view through the arrange, and the other modes f can cycle the game view and we can keep those two modes separate. so we can optionally perform or arrange fast swap (mini and full game view) or perhaps keep both modes in perform view." Later same day Argi reversed the interim "Performance view" label: user-facing name is **Performance view** (button "Show performance view [ F ]", mini "Mini performance view [ Shift+F ]", module setting "Show in performance view", page stays "Mini Performance View").
**Status:** planned 2026-10-18, owner TBD. Docs only. When it lands, it replaces the v1 Settings table rows and the Pointer section above (those stay as the v1 record until then).

### What v1 does today (read 2026-10-18, commit `4cc51840`)

- **Pointer is opt-in.** `.node-mini-perform-view` has `pointer-events: none`; only `pointer: "interactive"` turns it on (`styles.css` ~L5617-5627, `.interactive` class toggled in `node-graph-gl-mini-perform.js` L170). The press is caught by a window capture listener (gl-mini L32-36) that calls `beginNodeGraphMiniPerformPointer` (`node-graph-mini-perform.js` L326).
- **One resize grip.** `nodeGraphMiniPerformGripAt` (mini L315-324) only hits the corner opposite the anchor corner (Workspace: bottom right), in a 14 px box, and only changes `width` along x.
- **Screen drag snaps.** Moving in Screen anchor writes `style.left/top` directly, then on release snaps to the nearest corner and stores `corner` + one `margin` (min of x and y gap) (mini L360-390). The view jumps on release.
- **Hand cursor.** `.node-mini-perform-view.interactive { cursor: pointer; }` (styles ~L5626). That is the only cursor rule in the mini code.
- **Size and aspect.** Stored `width` (Screen: CSS px; Workspace: zoom-1 world px, × zoom on screen), clamp 120..1600. Height = width × reference aspect. Reference size comes from `nodeGraphMiniPerformReferenceSize` (`node-graph-canvas-fit.js`): Window = `innerWidth × innerHeight`; phone presets keep window height and take `NODE_GRAPH_CANVAS_PHONE_ASPECT` (9:19.5) or its inverse. Frame rect from `nodeGraphMiniPerformFrameRect` (same file).
- **Page ("picture frame" page, 🖥️ Mini Performance View; icon change from Round 1 🖼️ — code still 🖼️ until updated).** `renderNodeGraphMiniPerformPage` (mini L478-504) builds ten rows: Show mini view (Shift+F), Anchor, Corner, Margin (px), Width (px), Reference screen, Opacity, Pointer, Refresh rate, Show frame. Corner and Margin hide when Anchor = Workspace.
- **Settings store.** localStorage `soemdsp.miniPerform`, cleaned by `normalizeNodeGraphMiniPerformSettings`, which already drops unknown keys. So removed keys simply vanish on next load; no migration code is needed or wanted.
- No other agent has uncommitted edits in the mini files, `node-graph-canvas-fit.js` or `styles.css` (git status 2026-10-18).

### Design

**1. Always handled, never click-through.** Whenever the mini view is shown it takes the pointer (`pointer-events: auto`). The Pointer setting, the `.interactive` class and the Click-through path are deleted. Hit zones, tested in JS against the frame rect (no GPU picking):

| Zone | Press and drag | Click (under 4 px of travel) |
|---|---|---|
| Any of the four corners (14 px square inside the frame, same size as today's grip) | Resize. The **opposite corner stays fixed**. Aspect stays locked to the selected ratio: new width follows whichever axis moved further in proportion (`max(|dx|, |dy| × refW / refH)`, signed by the corner). Workspace anchor divides by zoom (zoom 1.0 is the stored truth). Clamp width 120..1600; Screen anchor also clamps so the frame stays inside the workspace host. | Same as the frame (tile click). |
| Anywhere else on the frame | Move. Follows the pointer through settings (`persist: false` while dragging, saved on release), **no snap and no jump**. Screen anchor clamps inside the host. | Tile under the pointer: select its module and centre the camera (unchanged). Double-click on a **tile**: open F perform (unchanged). Double-click on the **frame / empty area**: toggle Enlarged (MP-15). |

- Wheel is not handled by the mini view; it bubbles to the workspace host as today (check that workspace zoom still works with the pointer over the frame).
- Touch uses the same pointer path; the PH-1 gesture-layer follow-up from MP-5 stays open.
- Cost, accepted: the frame now covers the workspace under it. Shift+F hides it; Opacity does not make it click-through.

**2. Cursor: default arrow everywhere.** Delete `cursor: pointer`. Set `cursor: default` on `.node-mini-perform-view` and its children, and keep it while dragging (pointer capture stays on the view; the mini drag adds no body drag class). Proposed: **no** resize cursors at the corners either (open question 1). So the corners are still findable, draw small L-shaped corner marks in the GL pass (`nodeGraphGlLinesRect`, WebGL2) **only while the pointer is over the frame or a drag is running**, hidden when idle (APP_POLICY §14 hover-only resize grips). `pointerenter` / `pointerleave` on the view request a redraw.

**3. Screen position storage.** Replace `margin` with `offsetX`, `offsetY` (CSS px from the pinned corner). `corner` stays as an **internal** value, not a page control: on release of a move or resize it becomes the corner nearest the frame centre, and the offsets are measured from that corner, so a window resize keeps the view near where it was left. Workspace anchor keeps `worldX`, `worldY` (top-left, zoom-1 world px); resize from a top or left corner also moves `worldX` / `worldY` so the opposite corner stays put.

**4. Aspect ratio buttons.** `reference` is replaced by `aspect`. One wrapping horizontal row of buttons (flex-wrap; the pressed one has `aria-pressed="true"`), labelled:

| Button | Key | Reference size (stage the layout is read at) |
|---|---|---|
| Window | `window` | `innerWidth × innerHeight` (what F shows on this window) |
| 16:9 | `16:9` | height = window height, width = height × 16/9 |
| 4:3 | `4:3` | same rule, 4/3 |
| 1:1 | `1:1` | same rule, 1 |
| 9:16 | `9:16` | same rule, 9/16 |
| Phone portrait | `phonePortrait` | same rule, `NODE_GRAPH_CANVAS_PHONE_ASPECT` (9:19.5, matches the arrange-mode phone guides) |
| Phone landscape | `phoneLandscape` | same rule, 19.5:9 |

- Ratios live in one table in `node-graph-canvas-fit.js`; `nodeGraphMiniPerformReferenceSize(aspect, winW, winH)` reads it. Pure app code, no library edit.
- Picking a ratio keeps the width and the pinned corner (Screen) or the top-left (Workspace) fixed, then clamps inside the host.
- The ratio changes the **reference stage**, not just the frame shape: tiles are fractions of the reference stage and whole-module fit is computed at reference px, then × `s`. Same zoom-1 / no-reflow rule as v1.

### 5. Enlarged (double-click / Escape)

**Source:** Argi, 2026-10-18: "double click makes it bigger" and "escape to exit that view".

- **Enter:** double-click the mini view **frame or empty area** (not a tile) toggles **Enlarged** on. The previous mini size and position are remembered in session state (not a new settings key unless useful): Screen `offsetX` / `offsetY` / `width` / `corner`, or Workspace `worldX` / `worldY` / `width`.
- **While Enlarged:** large centred view in the workspace host, same chosen aspect ratio, still the GPU mirror, never touches transport. Enlarged works in both mini modes: in mini Perform it is read-only to the patch; in mini Arrange tiles can be dragged in the Enlarged view (MP-17), which is the easiest place to arrange. Corner resize and frame drag stay available (they edit the Enlarged rect; on exit those edits are discarded and the remembered mini rect returns). Default: **remembered mini size is restored on exit**; Enlarged size is session-only (open question 8).
- **Exit Enlarged:** Escape, or double-click the frame / empty area again. Restores the remembered mini size and position. Does **not** hide the mini view (Shift+F still does that). Does **not** open or close F.
- **Double-click on a tile** still opens F perform (MP-5 / Round 2 hit table) while the mini view is in Perform. In mini Arrange a tile double-click does nothing (it is too easy to trigger while dragging tiles; open question 11). Tile double-click never toggles Enlarged.
- **Escape never changes the mini mode.** Escape exits Enlarged only; it does not step mini Arrange back to Perform or hide the mini view (Shift+F does that).
- **F mode Escape unchanged.** While the Performance view (F, Perform or Arrange) is open the mini view is already hidden (Lifecycle above). Opening the Performance view drops Enlarged (the mini view comes back at its normal rect when the Performance view closes). Escape in the Performance view / screen-solo keeps today's behaviour.

**Escape precedence (read 2026-10-18):** existing Escape handlers, in order of who runs first today:

| Order | Where | What |
|---|---|---|
| 1 (capture) | `node-graph-screen-solo.js` ~L1266 | If screen-solo / F stage is live → `endNodeGraphScreenSolo()`. Also mirrored early in `handleNodeGraphKeydown` ~L328. |
| 2 | `handleNodeGraphKeydown` ~L334 | Inside a Metamodule → return to Root. |
| 3 | ~L362 | Cancel port-connection mode. |
| 4 | ~L366 | Exit modular-only / wiring panel view. |
| 5 | ~L370 | Reset V chrome bars to "all". |
| 6 | ~L674 | Keyboard-nav cue clear. |

**Proposed for Enlarged:** insert **after** screen-solo (1) and the typing / Text Box gates, and **before** Metamodule-to-Root (2). Reasoning: mini view is hidden while F / screen-solo is open, so (1) never conflicts; when Enlarged is on, Escape should exit that overlay before leaving a Metamodule or resetting chrome. Implement in `handleNodeGraphKeydown` (same file as Shift+F), not a second capture listener. If Enlarged handles Escape it `preventDefault` + `return` so chrome-bars and metamodule Escape do not also fire.

### 6. Performance view and mini view modes (supersedes "phone button opens perform only")

**Source:** Argi, 2026-10-18 (quoted under Source above). Decision (after reversing an interim "Game view" label the same day): the full-screen perform view is called **Performance view** in user-facing labels; F cycles the Performance view, Shift+F cycles the mini view, and the two keep **separate** modes. This replaces the earlier "phone button opens perform only" follow-up (old MP-16 design), which was never built.

**Today (read 2026-10-18):**
- Top-bar 📱 `#nodeModularWindowedViewButton` (`index.html` L299-304, `perform.html` L295-300; icon only, `aria-label="Layout canvas"`, title "Layout canvas — pinned displays (same as F)") → `toggleNodeGraphModularWindowedView` (`node-graph-view-controls.js` L952) → `toggleNodeGraphLayoutCanvasView()` (`node-graph-layout-canvas.js` L725): **off → perform → edit (arrange) → off**. It does **not** run the Metamodule selection check.
- F key (`node-graph-keyboard-shortcuts.js` L400) runs the Metamodule selection check, then the same cycle.
- Scene menu, group "Modular view" (`index.html` L1942-1951, `perform.html` L1938-1947): 💻 `#nodeSceneToggleModularInfiniteView` (Computer view: closes the canvas), 📱 `#nodeSceneToggleModularWindowedView` (`aria-label="Layout canvas"`; Metamodule selection check, then the full cycle; `node-graph-scene-menu-event-bindings.js` L149-159), and the hidden legacy `#nodeSceneToggleModularOnlyView` / `#nodeSceneToggleModularOnlyControls` (L160-172). So the scene menu 📱 already behaves like F; only the top-bar 📱 skips the Metamodule check.
- Shift+F (`node-graph-keyboard-shortcuts.js` L394) → `toggleNodeGraphMiniPerformView` (`node-graph-mini-perform.js` L123): on/off only. Stored as `show` in `soemdsp.miniPerform`.
- Pressed state for the top-bar and scene 📱 comes from `renderNodeGraphModularViewModeButtons` (view-controls L971-985).

**Naming (user-facing only).** "Layout canvas" / "Canvas" for the full-screen view becomes **Performance view**; its modes are **Perform** and **Arrange** (code keeps `"perform"` / `"edit"`). Internal names stay (`layoutCanvas*`, `toggleNodeGraphLayoutCanvasView`, `nodeGraphMvp.layoutCanvasMode`, `miniPerform*`, `soemdsp.miniPerform`); renaming code is churn with no user benefit. Strings to change:
- Top-bar button and scene-menu button (`aria-label`, `title`), both pages.
- Hotkeys page rows (`index.html` L498-499; and `perform.html` if it carries them): F → "Performance view: off → Perform → Arrange → off"; Shift+F → "Mini performance view: off → Perform → Arrange → off".
- Help strings in `node-graph-layout-canvas.js` (L634-635, L647, L950: "Layout canvas arrange…", "Canvas arrange (…)", "F = canvas, F again = arrange…") and `node-graph-interaction-help.js` L142.
- Settled (open question 9, Argi 2026-10-18): page label stays **"Mini Performance View"**; module setting "Show in canvas" → **"Show in performance view"** (label only; `node.ui.showInCanvas` stays). Page icon 🖼️ → 🖥️ (code still 🖼️ in `4cc51840`).

**Top-bar button.** The 📱 icon-only button becomes a labelled text button **"Show performance view [ F ]"** (same id, full words, `[ F ]` as part of the visible label). It does **exactly what F does**: one shared entry `toggleNodeGraphPerformanceView()` (Metamodule selection check, then `toggleNodeGraphLayoutCanvasView()`), called by the F key, the top-bar button and the scene-menu button, so the three can never drift. `aria-pressed="true"` while the Performance view is in Perform or Arrange; the title names the current mode ("Performance view: Perform. F = Arrange."). Proposed default: the label stays "Show performance view [ F ]" in every state (open question 10). `toggleNodeGraphModularWindowedView` is replaced by the shared entry (no alias; `toggleNodeGraphModularOnlyView` is a deprecated alias of it and goes too if nothing else calls it).

**Scene menu (proposed, consistent with the top bar).** In the "Modular view" group:
- 💻 Computer view: unchanged (closes the Performance view; does not touch the mini view).
- 📱 `#nodeSceneToggleModularWindowedView` → labelled **"Performance view [ F ]"**, calls `toggleNodeGraphPerformanceView()` (same full cycle as today, now through the shared entry).
- New **"Mini performance view [ Shift+F ]"** button, calls the mini cycle (`toggleNodeGraphMiniPerformView`, below). Pressed while the mini mode is not off. Hidden / disabled where the mini view is not allowed (perform / phone / embed), like the page.
- Delete the hidden legacy `#nodeSceneToggleModularOnlyView` and `#nodeSceneToggleModularOnlyControls` and their bindings / `renderNodeGraphModularViewModeButtons` fallback (no legacy shims; check nothing else clicks them first).

**F: Performance view cycle (unchanged behaviour).** off → Perform → Arrange → off, as today. Opening Perform still starts transport (L617-628); that is Performance view behaviour, not the mini view's.

**Shift+F: mini view cycle (new).** `toggleNodeGraphMiniPerformView` steps **off → Perform → Arrange → off** (same typing gate; no Metamodule check, it never pins). Settings: `show` is replaced by `mode` (`"off" | "perform" | "arrange"`, default `"off"`); `show` is dropped by the normalizer (no alias), so a machine that had the mini view on comes back off once. Proposed: a stored `"arrange"` loads as `"perform"` after reload, so a fresh session never starts in an editing state (open question 12).
- **Mini Perform** = Round 2 behaviour above (read-only, tile click selects + centres, tile double-click opens Performance view Perform, frame drag moves, corners resize, double-click empty toggles Enlarged).
- **Mini Arrange** = MP-17 below. Tiles can be moved and resized in the mini view.

**Independent modes.** The Performance view mode (`nodeGraphMvp.layoutCanvasMode`) and the mini mode (`nodeGraphMiniPerform.mode`) are separate state; neither key changes the other. Any combination is allowed (mini Arrange + Performance view Perform, both Perform, …). Typical fast swap: keep the mini view in Arrange while working, press F to check the result full screen in Perform, press F twice more (or Escape) to come back to the workspace with the mini view still in Arrange.

**When the Performance view opens while the mini view is shown.** As today: the mini view is hidden while the Performance view is in Perform or Arrange (and during screen-solo) and comes back when it closes (`nodeGraphMiniPerformShown`, mini L115-117). Added rules:
- The mini mode is kept, not reset (mini Arrange returns as Arrange).
- Enlarged is dropped on open (MP-15).
- A mini tile drag in progress is **cancelled** and the tile rect restored to its value at drag start (live drags write with `persist: false`, which already changes the patch object, so the start rect must be put back).
- Shift+F while the Performance view is open: proposed, it still steps the hidden mini mode and shows help text ("Mini performance view: Arrange (shows when the performance view closes).") (open question 13).
- Both views edit the same `patch.view.canvases` data, but never at the same time (the mini view is hidden whenever the Performance view is open), so there is no conflict. Arrange edits from either view redraw the other through the existing `nodeGraphLayoutCanvasWriteRect` redraw trigger.

### 7. Mini Arrange (MP-17)

**No longer purely read-only.** In mini Arrange, dragging tiles edits the layout in `patch.view.canvases` (root or the open metamodule bucket). This is a deliberate exception to v1 rule "Read-only to the patch": the mini view becomes a second editor for the same layout F arrange edits. It still never pins or unpins, never touches transport or audio, and mini Perform stays read-only.

- **Write path:** only `nodeGraphLayoutCanvasWriteRect(nodeId, rect, { persist: false })` while dragging and `nodeGraphLayoutCanvasWriteRect(nodeId, rect)` on release (marks the patch dirty), exactly as F arrange (`nodeGraphLayoutCanvasBindTileInteractions`, layout-canvas L769). Rects are normalized there by `nodeGraphLayoutCanvasNormalizeRect`. No second rect writer.
- **Coordinates:** pointer delta in CSS px → stage fraction by dividing by the mini tile scale (reference size × `s`; Workspace anchor also × camera zoom). Zoom 1.0 / reference px stays the truth; nothing is laid out at mini size.
- **Same rules as F arrange:** same minimum tile size and clamping (whatever F arrange uses, through the shared helper in `node-graph-canvas-fit.js`; move it there if it lives inline in layout-canvas), same z order. Undo: none today in F arrange, so none in mini Arrange (follow F if it gains undo).
- **Hit zones in mini Arrange (JS hit test, outermost wins):**

| Zone | Press and drag | Click |
|---|---|---|
| Frame corner (14 px, as Round 2) | Resize the mini frame (unchanged). | — |
| Tile corner (grip size scaled from F arrange's grip, at least 8 px on screen) | Resize that tile. | Select the module (no camera move). |
| Tile body | Move that tile. | Select the module (no camera move). |
| Empty area / frame | Move the mini frame (unchanged). | Nothing. Double-click toggles Enlarged. |

- **Look (WebGL2, mini pass):** tile outlines and tile corner grips drawn with `nodeGraphGlLinesRect`; a small "Arrange" label in a frame corner; the phone guides that F arrange shows (`NODE_GRAPH_CANVAS_PHONE_ASPECT`, orientation from `nodeGraphLayoutCanvasPhoneGuideOrientation`) drawn as thin lines in the mini frame. G flips the guides while the mini view is in Arrange, the same shared orientation as F (`toggleNodeGraphLayoutCanvasPhoneGuideOrientation`). Cursor stays the default arrow (Round 2 rule 2).
- **Tile double-click** does nothing in mini Arrange (open question 11).
- **Help text** on entering mini Arrange: "Mini performance view: Arrange. Drag tiles to move, tile corners to resize. Shift+F exits arrange."

### 8. Empty-canvas cinematic line + DVD logo easter egg (MP-18)

**Source:** Argi, 2026-10-18: "canvas empty message should have a background soundemote logo bouncing around dvd style, and then also do whatever it is the app does to make those pixels when we zoom in as in don't sharpen the image when we zoom in." Follow-up (same day): keep the current empty-message look — monospace, centred; make it a single cinematic line spanning nearly the full width with small padding; font size scaled to fit the view width (mini, Enlarged and full); never wrapping. Logo bounces behind the text. If MP-16 renames "Show in canvas" to "Show in performance view", the empty line's wording follows that label. **Easter egg (same day):** "make it an easter egg. show it only if you click the bug button in the bug debug menu, you know, the actual bug that makes it print \"bug\"."

**Bug button (trigger, read 2026-10-18):** the 🐞 control in the in-app Debug Log panel, not the Bug Button module.
- Markup: `public/node-graph-debug-console.js` ~L601 — `<button class="se-bug" data-se-fake-err …>🐞</button>` in `#seDebugPanel` (built by `buildPanel`).
- Click handler: same file ~L623-627 — `p.querySelector("[data-se-fake-err]").addEventListener("click", () => { push("ERROR", "ladybug", "debug-console"); });` (the log line is the string `"ladybug"`; Argi calls this the button that prints "bug").
- Panel open path: top-bar `#seDebugButton` (~L576-592) opens `#seDebugPanel`; the 🐞 sits in the panel head next to the "Debug Log" title.
- Hook the egg off this same click (after or alongside the existing `push`), not off a new UI control and not off the Bug Button module (`public/modules/bugButton/…`).

**Where the empty message lives today (read 2026-10-18):**
- **Mini view (drawn):** `public/node-graph-gl-mini-perform.js` ~L189-196. When `tiles.length === 0`, the mini pass draws GL text: `"Canvas is empty. Turn on Show in canvas on a module."` centred in the frame (`align: "center"`, `baseline: "middle"`, `px: Math.max(9, Math.min(14, cssW / 32))`, weight 400). This is the host for the cinematic line always, and for the bouncing logo **only when the easter egg is on**. Keep the same sentence (or the MP-16-renamed wording); change only layout/scale so it stays one line almost full width.
- **Performance view / F (help only, no stage):** `public/node-graph-layout-canvas.js` `nodeGraphLayoutCanvasOpen` ~L595-603. With no pinned ids it refuses to open (`layoutCanvasMode = "off"`) and, unless `silent`, shows the same idea as help text via `setNodeInteractionHelp`: `"Canvas is empty. Open Display Settings on a module and enable "Show in canvas"."` No empty stage is drawn today. Open question 15 (settled default below): keep that refusal when the egg is **off**; when the egg is **on**, open an empty Performance stage that shows the cinematic line + DVD logo (still no transport).

**Default empty look (egg off):**
- One cinematic empty line only — no logo, no bounce state, no logo texture load required for the default path.
- Same line rules as below (monospace, centred, almost full width, never wraps) in mini and Enlarged. Full Performance view still refuses to open (help text only) while the egg is off.

**Easter egg gate:**
- Session flag, proposed name `nodeGraphMvp.emptyCanvasDvdEgg` (or a sibling under mini-perform state). **Session only — not written to the UI settings blob, not in the patch, not in localStorage.** Reload / new tab starts with the egg **off**.
- **Toggle:** each click of the 🐞 (`[data-se-fake-err]`) flips the flag on ↔ off. Keep the existing `push("ERROR", "ladybug", …)` so the debug pipeline test still works; the egg is an extra side effect of that click.
- When the flag turns **on** and the current empty mini (or Enlarged) frame is showing: start bounce state and draw the logo behind the line. When it turns **off**: stop bounce state and drop the logo draw (line stays). When tiles appear: never draw the logo regardless of the flag (empty-only).
- No Command Center control, no Hotkeys entry, no settings row — discoverable only via the Debug Log 🐞.

**Empty line look (keep what Argi likes; always on when empty):**
- One sentence, monospace (`nodeGraphGlLinesText` / existing mini text opts), centred horizontally and vertically in the frame.
- **Single cinematic line:** never wraps. Font size is derived from the frame width so the measured line (plus small side padding, proposed ~4–6% of `cssW` total) spans nearly the full width. Same rule in mini, Enlarged and (when the egg opens it) full empty Performance view — one shared size helper, e.g. binary-search or measure-and-scale until the line's advance width fits `cssW * (1 - 2 * padFraction)`.
- Do not use the current clamped `px: Math.max(9, Math.min(14, cssW / 32))` for the empty line; that shrinks too hard on wide frames and would force wrapping or tiny type. Other mini labels (Arrange badge, etc.) keep their own sizes.
- Wording: start from today's `"Canvas is empty. Turn on Show in canvas on a module."` If open question 9 / MP-16 renames the module setting to "Show in performance view", this string becomes `"Canvas is empty. Turn on Show in performance view on a module."` (one shared constant with the Display Settings label, not a second hard-coded sentence).
- Drawn **after** the logo (when the egg is on) so the text sits on top; logo never covers the glyphs. When the egg is off, draw the line alone.

**Logo asset (found in repo; load only when egg is on, or lazily on first egg-on):** `public/soundemote-logo.svg` (400×400 viewBox; dark square + pink/purple mark). Already used by the boot splash (`index.html` / `perform.html` ~L73 / ~L72: `<img class="node-boot-logo-icon" src="./public/soundemote-logo.svg" …>`). No separate PNG; use this SVG. Load once (HTML `Image` or equivalent), keep a cached handle on the mini (and Performance-view empty, if built) state. Do not add a second logo file. Prefer lazy load on first egg-on so the default empty path stays free of the asset.

**Pixelated / no-smooth zoom (reuse existing app technique; egg-on only):**
- WebGL2 textured quads go through `nodeGraphGlLinesImage(batch, source, x, y, w, h, { nearest })` (`public/lib/visual/gl-line-renderer.js` ~L928-937, upload path ~L1476-1478): `nearest: true` sets `gl.TEXTURE_MIN_FILTER` / `TEXTURE_MAG_FILTER` to `gl.NEAREST` (no bilinear blur when magnified).
- The mini view already uses that for face plates when a face pixel covers more than 2.5 screen pixels (`node-graph-gl-mini-perform.js` ~L224-226: `nearest: w / d.canvas.width > 2.5`), matching the workspace policy.
- CSS presentation side (face canvases, not the GL logo path): workspace class `.pixelated-canvas-zoom` and `.display-canvas-pixelated` set `image-rendering: pixelated` / `crisp-edges` (`styles.css` ~L15161-15168; toggled by `nodeGraphDisplayCanvasPixelated` in `display-canvas.js`). The logo is drawn inside the WebGL2 mini/Game pass, so the CSS class is not the draw path — **pass `{ nearest: true }` (always) on the logo quad** so enlarged / Enlarged / high-DPI never smooths it. Same default as `nodeGraphGlLinesImage` when `nearest` is omitted (`options.nearest !== false`), but set it explicitly so a future default change cannot blur the logo.
- Optional bake: rasterize the SVG once into an offscreen canvas at a fixed integer size (proposed 256×256 or the SVG's 400×400) and upload that bitmap; NEAREST then samples hard pixels. Open question 16.

**DVD bounce behaviour (egg-on and empty only):**
- One logo sprite, drawn **behind** the empty-message text (image first, then `nodeGraphGlLinesText`).
- Position in frame CSS px; velocity in CSS px per second (constant speed). On each paint, advance by `dt`; when the logo's axis-aligned box hits a frame edge, negate that axis's velocity (classic DVD screensaver). Start near centre with a non-axis-aligned velocity so both axes move (proposed speed ~80 CSS px/s; open question 17).
- Size: fixed fraction of the shorter frame side (proposed ~28% of `min(cssW, cssH)`), aspect locked to the logo (1:1). Recompute size when the frame resizes; keep the bounce box inside the new frame.
- Opacity: soft enough that the text stays readable (proposed ~0.35); text colour unchanged.
- Only while the canvas is empty (`tiles.length === 0` for mini; empty Performance stage when egg-on opens it) **and** the session egg flag is on. When the first tile appears, or the egg turns off, stop the bounce state and do not draw the logo.
- WebGL2 only (§16): logo + text through the existing mini (and optional Game empty) pass; no DOM `<img>`, CSS animation, SVG overlay or 2D canvas. GL failure → keep today's text-only empty message (same `nodeGraphDisplayGlFailed` path), still as the single cinematic line if the text path still runs.
- No library edit: only call `nodeGraphGlLinesImage` / `Text` / existing begin/end.
- Shared helper preferred: one `nodeGraphEmptyCanvasDvdLogo*` (step + draw + egg flag) and one empty-line size helper used by the mini empty branch and by any Performance-view empty stage, so the two cannot drift.

### 9. Snake select trail above the mini view (MP-19)

**Source:** Argi (via Librarian), 2026-10-18: the Snake select dotted trail (GPU on `#nodeGlGraphDots` since Round 1 / commit `3277ddc5`) must draw **on top of** the mini view, including Enlarged. Resolves the v1 limitation that the trail sat under the mini canvas. Coordinate with Pencil PE-4 "In front of modules".

**What is wrong today (read 2026-10-18):**
- Mini view host: `.node-mini-perform-view` is `position: absolute; z-index: 6` (`styles.css` ~L152032), appended to `#nodeGraphWorkspace` (`node-graph-gl-mini-perform.js` ~L15-38). Canvas id `#nodeGlGraphMiniPerform`.
- Snake trail: drawn last on the shared workspace dots canvas `#nodeGlGraphDots` (`node-graph-gl-graph.js` ~L1226-1227, trail pass ~L1664+; marquee notes "The GL graph owns it (on `#nodeGlGraphDots`)" at `node-graph-marquee-selection.js` ~L162). That canvas is `.node-gl-graph-dots { z-index: 4 }` (`styles.css` ~L347589).
- Because **6 > 4**, the mini (and Enlarged, same element) paints over the trail. The plan already flagged this under Related docs (v1: trail and Pencil In-front sit under mini). Round 2 always-on handling (MP-11) makes the mini take the mouse, so a trail that crosses the frame is even more important to see.

**Required stack (workspace paint, bottom → top):**
1. Existing GL graph plates / wires / module chrome (unchanged).
2. `#nodeGlGraphDots` **non-trail** content that belongs with modules (contact dots, veils, jack highlights — whatever shares that canvas today besides the trail batch).
3. **Mini Performance View** (`.node-mini-perform-view` / `#nodeGlGraphMiniPerform`), including Enlarged — same node, so one z fix covers both.
4. Pencil **"In front of modules"** layers (PE-4; not built yet) — above the mini so drawings over the performance picture stay visible; below Snake so selection feedback wins. Open question 19 if PE-4 prefers the same canvas as Snake with Snake drawn last.
5. **Snake select trail** — topmost workspace paint.
6. Chrome above all of that: Command Center / floating windows / popups (unchanged; page already `z-index: 80`).

**How to implement (preferred):**
- **Do not** simply raise all of `#nodeGlGraphDots` above the mini. That canvas also carries contact/veil content that should stay under (or with) modules relative to the mini picture; lifting the whole canvas would cover the mini with jack dots and veils.
- **Split the trail onto its own full-workspace overlay canvas** (proposed id `#nodeGlGraphSnake`, class e.g. `node-gl-graph-snake`), sibling under `#nodeGraphWorkspace`, `pointer-events: none`, `z-index` above the mini (proposed mini stays at 6; snake overlay at **7**). Move only the trail `nodeGraphGlLinesBegin` / End from the dots pass onto this canvas (`node-graph-gl-graph.js` trail batch ~L1226-1227 and the trail draw ~L1664+). Reuse the same GW-2 camera uniform and the existing trail mesh path from R1-2 / `3277ddc5` — no second trail algorithm, no library edit.
- Enlarged needs no extra code: it is the same `.node-mini-perform-view` with a larger rect; correct z-order keeps the trail on top automatically.
- Hit testing unchanged: the trail canvas is `pointer-events: none`; mini Round 2 still receives clicks on its frame; Snake still starts from empty workspace (not from on top of the mini). A trail that **crosses** the mini frame must still paint over it (visual only).

**Pencil PE-4 coordination:**
- PE-4 currently says In-front may be "last batch on `#nodeGlGraphDots` or a new `#nodeGlGraphPencil`" (`docs/PENCIL_PAGE_PLAN.md`). When PE-4 lands, place In-front **above mini and below Snake** (new `#nodeGlGraphPencil` at z-index 6.5-equivalent — use integer **6** for mini and bump mini to stay below pencil, or mini 6 / pencil 7 / snake 8). Record the chosen integers in both plans in the same edit.
- MP-7 (Pencil in the mini view) is separate: those are layers drawn *inside* the mini pass for "Show in performance mode", not the workspace In-front overlay.
- Until PE-4 exists, MP-19 only requires: mini below Snake. Leave a z-index gap (e.g. mini 6, snake 8) so PE-4 can take 7 without reshuffling again.

**Rules:** WebGL2 only; no SVG trail return; no library edit; zoom-1 / camera unchanged from R1-2.

### Page controls


| Control | Round 2 | Why |
|---|---|---|
| Mini view mode (Shift+F) | **Changed** (MP-17): three-button row Off / Perform / Arrange instead of the Show mini view checkbox | Same three modes Shift+F cycles. |
| Anchor (Screen / Workspace) | **Stays** | Dragging cannot express it. |
| Aspect ratio | **New** (button row) | Replaces Reference screen. |
| Opacity | **Stays** | Dragging cannot express it. |
| Refresh rate | **Stays** | Performance setting. |
| Show frame | **Stays** | Look setting. |
| Reset position and size | **New button, proposed** (open question 4) | Gets the view back if it is dragged somewhere awkward: Screen → bottom right, 16 px offsets, width 360; Workspace → centre of the current view, width 360. |
| Corner | **Removed** | Set by dragging (nearest corner on release). |
| Margin (px) | **Removed** | Set by dragging (`offsetX` / `offsetY`). |
| Width (px) | **Removed** | Set by corner dragging. |
| Reference screen dropdown | **Removed** | Replaced by the Aspect ratio buttons. |
| Pointer (Click-through / Interactive) | **Removed** | Always handled. |

No migration: stored `margin`, `pointer`, `reference` and `show` are dropped by the normalizer on next load; the view comes back at default offsets with `aspect: "window"`. Per-machine preference, so a one-time reset is fine.

### Rules

- WebGL2 only: corner marks and frame go through `gl-line-renderer.js` in the existing mini pass. No CSS borders, SVG or DOM grips.
- Zoom 1.0 is the source of truth: Workspace size and position stored in zoom-1 world px; Screen in CSS px; nothing laid out at mini size.
- Full-word labels ("Phone portrait", not "PP"; "Reset position and size").
- No legacy shims: no alias from `reference` to `aspect` or from `show` to `mode`, no reading of `margin` or `pointer`; the hidden legacy scene-menu buttons are deleted, not re-pointed.
- Library: no library edit. `gl-line-renderer.js` is only called.
- Never touches transport or audio. Read-only to the patch in mini Perform; mini Arrange writes tile rects only, through `nodeGraphLayoutCanvasWriteRect` (MP-17).
- One entry per view: `toggleNodeGraphPerformanceView()` for F / top-bar button / scene-menu Performance view; `toggleNodeGraphMiniPerformView()` for Shift+F / scene-menu Mini performance view / page mode row.

### Milestones

| ID | Step | Done when | Status | Owner |
|---|---|---|---|---|
| MP-10 | **Settings cut-over.** In `node-graph-mini-perform.js`: defaults and normalizer drop `margin`, `pointer`, `reference`; add `aspect` (choices above, default `window`), `offsetX`, `offsetY` (0..host size, default 16); `corner` stays internal. In `node-graph-canvas-fit.js`: one aspect table; `nodeGraphMiniPerformReferenceSize` takes `aspect`; `nodeGraphMiniPerformFrameRect` places Screen frames by `corner` + offsets and clamps inside the host. | Old stored settings load as defaults for the removed keys; frame rect matches the table for every aspect; unit checks updated. | Planned | TBD |
| MP-11 | **Always-on handling.** `pointer-events: auto` whenever shown; delete `.interactive` and the Click-through path. Four corner zones resize with the opposite corner fixed and aspect locked (Screen and Workspace, any zoom); frame drag moves with no snap; on release pick the nearest corner and store offsets; clamp inside the host. Tile click and double-click unchanged; wheel still zooms the workspace. | Each corner resizes from the opposite corner at zoom 0.5, 1 and 2 (Workspace) and in Screen; move never jumps on release; window resize keeps the view near its corner. | Planned | TBD |
| MP-12 | **Cursor and corner marks.** Remove `cursor: pointer`; `cursor: default` on the view and children, also during drags. GL corner marks shown only on hover or drag (§14). | Computed cursor is `default` at the centre, at each corner and mid-drag; marks hidden when the pointer is away. | Planned | TBD |
| MP-13 | **Page.** Rows: Mini view mode (Off / Perform / Arrange button row, Shift+F), Anchor, Aspect ratio (wrapping button row), Opacity, Refresh rate, Show frame, plus Reset position and size if approved. Delete Corner, Margin, Width, Reference screen, Pointer rows and their sync code (including the Corner/Margin hide rule). | Page shows only the kept controls; buttons wrap when the page is narrow; the pressed aspect button follows the setting; the pressed mode button follows Shift+F. | Planned | TBD |
| MP-14 | **Tests.** `scripts/smoke_mini_perform_unit.cjs`: aspect table, offsets, clamping, normalizer drops removed keys (`margin`, `pointer`, `reference`, `show`) and keeps `mode`; stored `"arrange"` loads as `"perform"` (if open question 12 stays default); mini cycle off → perform → arrange → off; Enlarged enter/exit restores remembered mini rect; mini Arrange px → fraction conversion equals F arrange's for the same drag at reference size (Screen and Workspace at zoom 0.5 / 1 / 2); Escape handler order documented (screen-solo before Enlarged; Enlarged before metamodule / chrome). `scripts/probe_mini_perform.mjs`: four-corner resize, no-snap move, cursor `default`; double-click empty frame toggles Enlarged; double-click tile opens the Performance view in mini Perform and does nothing in mini Arrange; Escape exits Enlarged only and never changes the mini mode; Shift+F cycles off → Perform → Arrange → off; in mini Arrange a tile drag changes that element's rect in `patch.view.canvases` and marks the patch dirty, a frame-corner drag still resizes the frame, and mini Perform drags never change `patch.view.canvases`; the Show performance view [ F ] button and F produce the same mode sequence (off → Perform → Arrange → off) and the same Metamodule selection behaviour; modes stay independent (mini Arrange survives F → Perform → Arrange → off; F state unchanged by Shift+F); opening the Performance view hides the mini view, cancels a mini tile drag and restores its start rect, drops Enlarged, and closing it brings the mini view back in its previous mode. `scripts/smoke_test.py` `check_mini_perform_view`: no `cursor: pointer` and no `pointer` / `reference` / `margin` / `show` settings in mini code; page has no Corner / Margin / Width / Reference screen / Pointer controls and has the Off / Perform / Arrange row; `#nodeModularWindowedViewButton` label reads "Show performance view [ F ]" in `index.html` and `perform.html`; F handler, top-bar button and scene-menu Performance view button all call `toggleNodeGraphPerformanceView`; no user-facing "Layout canvas" string left in `index.html`, `perform.html`, `node-graph-layout-canvas.js`, `node-graph-interaction-help.js`; legacy `nodeSceneToggleModularOnlyView` / `nodeSceneToggleModularOnlyControls` gone; mini code writes the layout only through `nodeGraphLayoutCanvasWriteRect` and never calls transport; empty-canvas **default** path draws the cinematic line only (no logo draw, no required logo load); egg flag is session-only (not in UI settings / patch / localStorage); 🐞 `[data-se-fake-err]` click in `node-graph-debug-console.js` toggles the egg and still pushes `"ladybug"`; when egg is on and empty, path loads `public/soundemote-logo.svg` (or the agreed bake) and draws it with `nodeGraphGlLinesImage` and `nearest: true` (no `LINEAR` logo upload); no DOM/CSS/SVG overlay for the bounce; DVD step reverses velocity on each axis at the frame edge and stops when tiles are present or egg turns off; empty line is a single monospace centred string whose measured width fits inside the frame with small side padding at mini, Enlarged and (when egg opens full empty Performance view) full widths, with no wrap and no leftover `cssW / 32` clamp on that line; if MP-16 renamed the setting, the empty line uses "Show in performance view". Unit: egg defaults false; toggle flips; bounce step hits left/right/top/bottom and reverses the matching axis; logo rect stays inside the frame after a resize; `nearest: true` is passed for the logo; line-size helper returns a px that keeps advance width within the padded frame for several widths (e.g. 200, 360, 800, 1280); with egg off, empty Performance open still refuses (help only); with egg on, empty Performance open draws stage + logo + line and does not start transport. Probe: empty mini shows the one-line message and **no** logo until 🐞 is clicked; second 🐞 click hides the logo again; pinning a module removes the logo even with egg on; Enlarged empty with egg on still uses NEAREST (no smoothed logo) and still one unwrapped line; workspace paint order is mini view below Snake trail overlay (computed/CSS z-index or DOM sibling order with documented z-index values); `#nodeGlGraphDots` non-trail content is not raised above the mini; trail canvas is `pointer-events: none`; probe: Snake drag that crosses the mini frame (and Enlarged) leaves trail texels above the mini pixels; PE-4 In-front slot (z gap) is documented in this plan and mirrored in `PENCIL_PAGE_PLAN.md`. | All three pass. | Planned | TBD |
| MP-15 | **Enlarged.** Double-click frame / empty area toggles a large centred Enlarged state (same aspect, GPU mirror; works in mini Perform and mini Arrange); remember previous mini size/position and restore on exit. Double-click tile still opens F. Escape exits Enlarged only (implement in `handleNodeGraphKeydown` after screen-solo, before metamodule-to-Root / chrome reset); F / screen-solo Escape unchanged. | Double-click empty toggles Enlarged; Escape restores mini; tile double-click still opens F; Escape while F open still ends F. | Planned | TBD |
| MP-16 | **Performance view naming and button.** User-facing "Layout canvas" / "Canvas" → Performance view (strings listed in Design 6). Page icon 🖼️ → 🖥️ (code in `4cc51840` still 🖼️ — update `miniPerform.icon` in `node-graph-unified-window.js` when implementing). Top-bar 📱 becomes the labelled button "Show performance view [ F ]". One shared `toggleNodeGraphPerformanceView()` (Metamodule selection check, then the off → Perform → Arrange → off cycle) used by the F key, the top-bar button and the scene-menu Performance view button; `toggleNodeGraphModularWindowedView` removed. Scene menu: Performance view [ F ] and new Mini performance view [ Shift+F ] buttons; hidden legacy buttons deleted. Supersedes the earlier "phone → perform only" design (not built). | Button and F behave identically in every mode; no user-facing "Layout canvas" left; scene menu has Computer view, Performance view [ F ], Mini performance view [ Shift+F ]. | Planned | TBD |
| MP-17 | **Mini view modes and mini Arrange.** Settings `show` → `mode` (`off` / `perform` / `arrange`); Shift+F, the page row and the scene-menu button cycle off → Perform → Arrange → off; modes independent of the Performance view. Mini Arrange per Design 7: tile move / tile-corner resize through `nodeGraphLayoutCanvasWriteRect` (`persist: false` while dragging), frame corners and empty-area drag unchanged, GL tile outlines, grips, "Arrange" label and phone guides, G flips guides, tile double-click ignored. Opening the Performance view hides the mini view (as now), keeps its mode, drops Enlarged and cancels a mini tile drag (restores start rect). Mini Perform stays read-only. | Arranging in the mini view gives the same rects F arrange gives for the same drag; F → Perform shows the edit full screen; closing it returns the mini view in Arrange; mini Perform never writes the patch. | Planned | TBD |

| MP-18 | **Empty-canvas cinematic line + DVD logo easter egg.** Always: when the mini view has no tiles, draw today's monospace centred sentence as **one non-wrapping line** whose font size scales to nearly the full frame width (small side padding) in mini / Enlarged / (egg-on) full empty Performance view; wording follows MP-16's "Show in performance view" rename when that lands. Easter egg: session-only flag toggled by the Debug Log 🐞 (`[data-se-fake-err]` in `node-graph-debug-console.js` ~L601 / ~L625-627, which still pushes `"ladybug"`); when on and empty, draw `public/soundemote-logo.svg` bouncing DVD-style behind the line via WebGL2 `nodeGraphGlLinesImage(…, { nearest: true })`. Shared step+draw, egg flag and line-size helpers; Performance-view empty stage only while egg is on (open question 15). | Empty mini shows the full-width line with **no** logo by default; 🐞 toggles the bouncing logo on/off for the session; logo stays pixel-hard when enlarged; first pinned tile removes the logo; click again turns egg off; line never wraps; no DOM/CSS/SVG overlay; egg not persisted. | Planned | TBD |

| MP-19 | **Snake trail above mini.** Split the Snake select trail off `#nodeGlGraphDots` onto its own workspace overlay canvas (proposed `#nodeGlGraphSnake`, `pointer-events: none`, z-index above `.node-mini-perform-view`) so the trail paints over the mini view and Enlarged. Keep non-trail dots content under the mini. Leave a z-index gap for Pencil PE-4 "In front of modules" (above mini, below Snake). Update the PE-4 note in `docs/PENCIL_PAGE_PLAN.md` to match. No library edit; same R1-2 / `3277ddc5` trail pass and camera. | Trail pixels visible over the mini frame and over Enlarged while dragging Snake across them; jack/contact dots do not cover the mini; smoke asserts DOM/CSS order mini < snake (and documents the PE-4 slot). | Planned | TBD |

**Order:** MP-10 first, then MP-11, MP-12, MP-13 and MP-16 (any order), MP-15 after MP-11 (needs always-on hit testing), MP-17 after MP-11 and MP-13 (needs always-on hit testing and the mode row), MP-18 after the empty-message draw path exists (mini today; Performance empty stage when egg on per open question 15) and after MP-16 if the "Show in performance view" string is shared; egg hook wires into `node-graph-debug-console.js` `[data-se-fake-err]` without changing the ladybug push, **MP-19 anytime after the mini canvas exists (independent of MP-10..MP-18 behaviour; do not wait for PE-4)**, MP-14 alongside (include MP-18 and MP-19 checks). Independent of MP-7 (Pencil) and MP-9.

### Open questions (defaults chosen so work can start)

1. **Resize cursors at the corners?** Default: no, the default arrow everywhere, with the GL corner marks on hover for findability. Alternative: diagonal resize arrows at the corners only, default arrow everywhere else.
2. **Free resize?** Default: corner drag keeps the selected ratio locked. Alternative: free resize that unpresses the ratio buttons and shows a "Custom" shape (the reference stage would then follow the frame shape).
3. **Ratio set.** Default: the seven buttons above. Drop 9:16 since Phone portrait (9:19.5) covers phones? Add 21:9?
4. **Reset position and size button?** Default: add it.
5. **No click-through at all?** Default: clicks over the frame always go to the mini view. Alternative: hold a key (for example Alt) to click through to the workspace under it.
6. **No snap on release?** Default: the view stays exactly where it is dropped (v1 snapped to a corner).
7. ~~Scene menu phone entries?~~ Settled by Argi 2026-10-18: F, the Show performance view [ F ] button and the scene menu all use the same full Performance view cycle (Design 6).
8. **Enlarged size persistence?** Default: Enlarged size is session-only; exiting restores the remembered mini rect. Alternative: store a separate Enlarged width in settings.
9. ~~Rename the rest to "game view"?~~ Settled by Argi 2026-10-18 (reversed the interim Game view label): keep **Performance view** naming. Page stays "Mini Performance View"; module setting "Show in canvas" → "Show in performance view"; page icon 🖼️ → 🖥️ (implemented `4cc51840` still has 🖼️ in `public/node-graph-unified-window.js` — change when editing that file). Code identifiers unchanged (`layoutCanvas*`, `miniPerform*`).

10. **Button label by state?** Default: always "Show performance view [ F ]", pressed while on. Alternative: show the next step ("Arrange performance view [ F ]", "Close performance view [ F ]").
11. **Tile double-click in mini Arrange?** Default: does nothing. Alternative: opens the Performance view in Arrange.
12. **Mini Arrange after reload?** Default: comes back as mini Perform. Alternative: restore Arrange as stored.
13. **Shift+F while the Performance view is open?** Default: steps the hidden mini mode, with help text; it takes effect when the Performance view closes. Alternative: Shift+F does nothing while the Performance view is open.
14. **Button should still be Perform on/off only?** Default: no, it mirrors F (full cycle), since its label says [ F ]. Alternative: keep the earlier "button opens Perform only" behaviour while F does the full cycle.
15. **Performance view empty stage (egg-aware)?** Default: **egg off** → keep today's refuse-to-open + help text (cinematic line is mini / Enlarged only). **Egg on** → when F / Show performance view is pressed with no pins, open an empty Performance stage that shows the cinematic line + DVD logo (and do not start transport), so the egg is visible full-screen too. Alternative: always refuse empty Performance open even with egg on (logo stays mini / Enlarged only).
16. **Logo bake size?** Default: load the SVG into an `Image` and upload that; NEAREST samples whatever resolution the browser gives the SVG. Alternative: rasterize once to a fixed bitmap (256×256 or 400×400) so every zoom sees the same hard pixels.
17. **Bounce speed / size / opacity?** Default: ~80 CSS px/s, logo ~28% of the shorter frame side, opacity ~0.35. Alternative: slower / larger / more opaque — tune once on screen.
18. **Empty-line side padding?** Default: ~5% of frame width total (2.5% each side) so the line is almost full width. Alternative: fixed CSS px padding (e.g. 12 px) at every size.
19. **Pencil In-front vs Snake canvas?** Default: separate canvases with z mini < Pencil In-front < Snake (leave a gap in MP-19, e.g. 6 / 7 / 8). Alternative: one overlay canvas shared by Pencil In-front and Snake, with Snake drawn last in the same frame. Decide with PE-4; MP-19 alone only needs mini < Snake.
20. **Raise whole `#nodeGlGraphDots` instead of splitting?** Default: no — split the trail only, so contact dots / veils stay under the mini. Alternative: raise the whole dots canvas (simpler code, but jacks would cover the mini).
21. **Egg persistence?** Default: **session only** — `emptyCanvasDvdEgg` (or equivalent) lives in memory for this page load; not UI settings, not patch, not localStorage. Reload starts off. Alternative: remember in UI settings / localStorage so the logo stays on across reloads.
22. **Egg toggle vs one-shot?** Default: **toggle** — each 🐞 click flips on ↔ off (and still pushes `"ladybug"`). Alternative: first click arms it for the session only (no off except reload); or a long-press / modifier click to arm so casual fake-ERR clicks do not surprise.
