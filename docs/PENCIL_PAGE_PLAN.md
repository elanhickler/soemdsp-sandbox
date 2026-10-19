# Pencil page plan

**Source:** Argi, 2026-10-18.
**Status:** Round 1 (R1-1..R1-4) done 2026-10-18. PE-1..PE-9 planned, owner TBD.

**Goal:** add hand-drawn notes to patches in two tiers: **basic drawing**, always available in the circuit builder, and a dedicated **Drawing mode** (toggle) with full soundemote-dev-style drawing, layers and a new **Pencil** page in the Command Center. The existing top-bar mouse smoothing slider stays where it is, unchanged.

## Repo read (2026-10-18)

### Command Center pages

All pages are registered in `public/node-graph-unified-window.js`. One page shows at a time, and all pages share one seat (position and size).

A new page needs an entry in each of these places:

1. **Page registry:** `nodeGraphUnifiedWindowPages` (L24). Each entry has key, elementId, workspaceKey, label, icon and showInNav.
2. **Nav order:** `nodeGraphUnifiedWindowPageOrder` (L117).
3. **Close switch:** the switch at ~L575.
4. **Open switch:** the switch at ~L880.
5. **Nav host list:** the list at ~L1530.
6. **Floating-window registry:** `public/node-graph-floating-windows.js` (~L1007). Holds the drag and resize state keys.
7. **Element map:** `public/node-graph-ui-settings-persistence.js` L36.
8. **Outside-click selectors:** `public/node-graph-context-menu.js` L2807 and `public/node-graph-selection.js` L157.
9. **Page DOM:** in both `public/index.html` and `public/perform.html`. It uses the shared chrome `.scene-context-heading` (move, title, close), then `.node-unified-window-nav-host`, then a body that scrolls.
10. **Drag and resize bindings:** `public/node-graph-scene-menu-event-bindings.js`.

The model to copy is the broom page:
- key `patchDefaults`, label "Ready", icon 🧹
- element `#nodePatchDefaultsPanel`
- opened by `setNodeGraphPatchDefaultsVisible` in `public/node-graph-module-actions.js` (~L1450-1526)

There is no "Code" page in this registry. Code Screen is a separate satellite.

### Mouse smoothing widget (where it lives today)

**The control:** `#nodeSnakeMouseSmoothSlider`.
- Lives in the top bar, inside `.node-history-controls` → `.node-room-tool-pair`, next to Room Dimmer and the two magnifier sliders.
- Location: `public/index.html` L383 and `public/perform.html` L379.
- It is a vertical toolbar-fill slider with range 0..0.17 (`NODE_GRAPH_SNAKE_MOUSE_SMOOTH_MAX`) and the label "Mouse smoothing".
- It is bound by `bindNodeGraphSnakeMouseSmoothControl` in `public/node-graph-marquee-selection.js` L265-336, which is called from `public/node-graph-header-event-bindings.js` L30. The slider itself comes from `bindNodeGraphToolbarFillSlider` in `public/node-graph-room-dimmer.js` L1099.

**What it controls today:** the Snake select (lasso) trail only (`marquee-selection.js` L339-358 and L1025-1046).

**The setting:**
- Stored as `nodeGraphMvp.snakeMouseSmooth`.
- Saved in the UI settings blob `view.snakeMouseSmooth` (`node-graph-ui-settings-persistence.js` L817, L956, L1039, L1809).
- Its default lives in `node-graph-state.js` L173.

**Test:** `scripts/smoke_test.py` L15877 asserts the id is in `index.html`.

### Smoothing code

**soemdsp-sandbox:**
- `public/node-graph-papoulis-filter.js` has one algorithm: an order-3 Papoulis lowpass. The amount maps to a 60→2 Hz cutoff at a 120 Hz capture rate. Its API is `createNodeGraphMouseSmoothState`, `nodeGraphMouseSmoothBegin` and `nodeGraphMouseSmoothPoint`.
- Users: Snake select and the Phosphillator XY draw (`node-graph-phosphillator.js`).
- It is app code, not under `public/lib/`.
- The C++ library smoothers are for audio parameters and are not used for the pointer.

**soundemote-dev** (sibling repo, present):
- `public/experiments/pinoisesmoothing/mouse.js` has 31 pointer filters in 4 groups:
  - Chase: 1P, Inertial Filter, Dynamic EMA, 2P, 3P, Linear & 1P/2P/3P, Underdamped Spring, Linear & 2P Adaptive, One Euro, Butterworth 3/4, Papoulis, Bessel, Kalman, Kalman Glide, Gravity, Orbit.
  - Through Points: Catmull-Rom, Monotone Hermite, Kochanek-Bartels.
  - Stroke Smoothing: Chaikin, Zero-Phase Gaussian, Savitzky-Golay.
  - Lazy: Exponential, Moving Average, Double Exponential, Holt Coasting, Lazy Brush, Lazy Brush Smoothed.
- `draw.js` in the same folder is a small WebGL stroke demo. It has an input algorithm (default "Linear & 2P"), an optional finish pass (Gaussian by path length, Catmull-Rom, 2P), width modes (Constant, Speed Thins, Speed Thickens, Pressure), and undo and clear.
- The folder was last changed 2026-10-17.

### Patch save format

- `normalizeNodeGraphPatch` in `public/node-graph-patch-core.js` (~L1015) builds the saved object from a fixed list of keys:
  `activeCameraId, audio, bypassedNodes, cameras, codeScreen, connections, format, graphConnections, grid, info, masterSeed, modularOnlyControlsVisible, modulations, nodes, requiredAssets, samples, …`
- Format is `{ kind: "soemdsp-sandbox-node-patch", version: 2 }` (`node-graph-module-definitions.js` L17945).
- The migrators were removed in `dc470a16` (2026-10-18).
- Undo is whole-patch snapshots (`recordNodeGraphHistory`, `node-graph-history.js` L55).

### GL graph layering

`node-graph-gl-graph.js` ~L1176 makes these layers, bottom to top:
1. `#nodeGlGraphCanvas`: grid, plates and chrome, placed before `.node-graph-zoom-surface`.
2. `#nodeGraphTextBehind`: Text Boxes set to Behind wires.
3. `#nodeGlGraphWires`: wires.
4. `#nodeGraphTextFront`: Text Boxes set to In front of wires.
5. `#nodeGlGraphDots`: jack dots.

The two text layers come from `nodeGraphEnsureTextWireLayers` in `node-graph-viewport-perf.js`. GW-2 (GPU camera) is in the tree: the batches take a camera uniform, and pan and zoom redraw the retained mesh without rebuilding it.

Shared stroke API in `public/lib/visual/gl-line-renderer.js`: `nodeGraphGlLinesPolyline`, `Ribbon`, `Segment`, `Dot` and `Triangle`. It has **no dash support**.

The touch layer is `public/node-graph-touch-gestures.js` (PH-1). It does double-tap, long hold, pinch and two-finger pan. Workspace pinch and pan is PH-6, not started.

### Basic drawing today

There is **no workspace drawing feature today**. Searches for freehand, pencil, annotation strokes and dotted lines found only:
- the Snake select trail (thick dotted phosphor trail, SVG, `node-graph-marquee-selection.js`), which selects and leaves no mark;
- Text Boxes in `#nodeGraphAnnotationNodes` (the "annotation" layer is Text Boxes, not strokes);
- module-internal drawing (Phosphillator XY draw, XY Pad), which is module UI, not patch notes.

So the basic tier is new work (PE-5), built on the same stroke pipeline as Drawing mode.

The Snake select trail is currently drawn in the wrong place on screen (Argi, 2026-10-18). Round 1 below fixes that by moving it to the GPU.

### ch4os layer UI (reference, found locally)

`C:\Users\argit\Documents\_PROGRAMMING\ch4os\src\main.js`, image editor:
- Panel markup ~L23339: `#imageEditorLayerPanel` holds an add-layer row (`#imageEditorLayerAddRow`), the scrolling list `#imageEditorLayerList`, a drag resizer (`data-image-editor-inspector-resizer`, "up for more controls, down for more layers"), then the per-layer box `#imageEditorLayerInspector` for the selected layer.
- Row markup `imageEditorLayerListMarkup` ~L24271 (rows ~L24317): visibility ◉/○, thumbnail with drag-left/right opacity, name button (click select, double-click rename), lock, extra buttons, drag-handle ▲ to reorder (right-click for more), delete 🗑 with an armed second click.
- Row menus: `closeImageEditorLayerRowMenus` ~L21873. Panel split persisted as `layerPanelPercent` (~L1468, clamp ~L22630). Styles in `ch4os\styles\04-*` to `06-*` (`.image-editor-layer-*`).

### soundemote-dev drawing (reference)

`soundemote-dev\public\experiments\pinoisesmoothing\`: `draw.js` (314 lines, Draw tab), `mouse.js` (filters, `PM_FILTERS`, `PM_USES`, `PM_DEF`, sample rate, finish passes), `index.html` L71-120 (Draw panel: Stroke, Input Smoothing, Finish Smoothing, Sampling sections). Full feature list in **soundemote-dev parity** below.

## Two tiers

| | Basic drawing | Drawing mode |
|---|---|---|
| Where | Always available in the circuit builder (edit mode). | A **Drawing mode** toggle (Pencil page and a top-bar button). While on, the workspace captures the pointer for drawing; while off, normal circuit editing. |
| Gesture | Drag only, with a draw modifier (see open question). A press with no movement leaves **no mark**, so ordinary clicks never draw. | Any press draws with the active tool. A **single click makes a dot**. |
| Smoothing | The existing top-bar **Mouse smoothing** slider (0..0.17, Papoulis, `nodeGraphMvp.snakeMouseSmooth`), unchanged and shared with Snake select. | Its own smoothing: algorithm dropdown with per-algorithm parameters, sample rate (polling speed), and per-layer pen-up finish smoothing. Does not read or change the top-bar slider. |
| Tools | Pen stroke, Solid / Dotted, using the current Color, Thickness and Opacity. | Full tool set, width modes, ghost, layers (below). |
| Target | The active layer (created as "Layer 1" if there is none). | The active layer. |
| History | Drawing history (same stack as Drawing mode). | Drawing history. |

Both tiers save the same stroke format and render through the same pipeline.

## Rules (policy)

- **WebGL2 only (APP_POLICY §16).**
  - Strokes are GPU geometry drawn through the shared `gl-line-renderer.js` (ribbon with round caps and joins, ported from draw.js `pdRibbon`), inside the GL graph passes.
  - No 2D canvas, no SVG and no CSS drawing.
  - If GL fails, drawings are not shown, and the failure is logged the GW-7 way (`nodeGraphDisplayGlFailed`).
- **Full-word labels.** Use: Pencil, Drawing mode, Pen, Straight line, Arrow, Eraser, Move, Undo, Redo, Clear all, Color, Solid, Dotted, Thickness, Opacity, Smoothing algorithm, Sample rate, Look-ahead, Finish smoothing, Amount, Width mode, Constant, Pressure, Speed thins, Speed thickens, Width, Minimum width, Speed range, Response curve, Width smoothing, Width slope limit, Show raw input, Layers, Add layer, Delete layer, Show, Hide, Workspace, Screen, Module, Attach to module, Behind modules, In front of modules, Show in performance mode, Show drawings.
- **Zoom 1.0 is the source of truth.**
  - Workspace and Module strokes are stored in zoom-1 world px, relative to their layer's offset. The camera only scales them.
  - Thickness is in world px for Workspace and Module layers, so it scales with zoom, and in CSS px for Screen layers.
- **Drawings live in their own top-level `drawings` section of the patch** (decided), next to the audio graph, not inside it. Audio code (graph compile, engine, WASM, worklet) never reads it.
  - A missing `drawings` key means no drawings. That is the normal empty state, not a compatibility path.
  - No migration layers (APP_POLICY §1).
- **Shared code over copies.** One pointer-smoothing library, one stroke builder, one stroke pipeline for both tiers, one Command Center page path, no Pencil-only line shader.
- **UI never blocked by engine state.** Drawing, layers, save and undo work with audio stopped or the engine cold.

## Design

### Pencil page and Drawing mode

- Add the page `pencil`: label "Pencil", icon ✏️ (U+270F), element `#nodePencilPage`, nav position after `patchDefaults`.
- **Drawing mode toggle** on the Pencil page and as a top-bar button (same state, `nodeGraphMvp.drawingMode`, not saved in the patch).
  - On: pointer down on the workspace draws with the active tool; modules take no pointer input; Snake select is off.
  - Off: normal circuit editing (basic drawing still available).
  - Escape turns it off. Closing the Pencil page does not.
  - The wheel still zooms and the pan gesture still pans in both states.
- The **top-bar Mouse smoothing slider stays** in `.node-room-tool-pair`, unchanged (decided): same id, range, setting name `snakeMouseSmooth`, and smoke test. It drives Snake select and basic drawing only.

### Pencil page layout (top to bottom)

1. **Tool bar:** Drawing mode, Pen / Straight line / Arrow / Eraser / Move, Undo, Redo, Clear all, Show drawings.
2. **Stroke:** Color, Solid / Dotted, Opacity, Width mode, Width, and (by mode) Minimum width, Speed range, Response curve, Width smoothing, Width slope limit. Show raw input.
3. **Input smoothing** (Drawing mode, global): Smoothing algorithm dropdown and only that algorithm's parameters; Sample rate.
4. **Layers** (ch4os layout): scrolling list, resizer, per-layer settings box.

### Drawing mode smoothing (decided)

- **Algorithm dropdown** grouped as in soundemote-dev (Chase, Lazy, Through Points, Stroke Smoothing), fed by the shared registry (PE-1). Default **Linear & 2P** (draw.js default).
- Selecting an algorithm shows **only that algorithm's parameters**, each with the range and taper from soundemote-dev `PM_DEF` (log or linear), so very heavy smoothing (ultra-smooth lines) is reachable. Chase algorithms add **Look-ahead**.
- **Sample rate** (polling speed): 1..1000 Hz, log taper, default 30 Hz as in mouse.js. Raw pointer events (coalesced) are resampled at this rate before smoothing.
- Live (input) smoothing is **global**: one algorithm and settings for all layers, saved as a UI preference.
- **Finish smoothing is per layer** (decided): runs once on pen-up for strokes drawn on that layer. Options as draw.js `pd-fin`: None, Gaussian (path length), Catmull-Rom, 2P, or any registry algorithm, each with its own parameters (Amount for Gaussian / 2P). Stored in the layer's settings in the patch. Changing it affects new strokes only; saved points are never re-smoothed on load.
- Snake select and basic drawing keep the top-bar Papoulis slider (decided); Drawing mode never touches it.

### Controls behavior

| Control | Behavior |
|---|---|
| Pen / Straight line / Arrow / Eraser / Move | One active. Straight line and Arrow: press, drag, release, two points, no smoothing. Arrow head sized from Width. **Move** drags the active layer by changing its offset, never the points. |
| Single click (Drawing mode) | A press with no movement makes a **dot**: a one-point stroke drawn as a filled circle of the current width (draw.js `pdFan`). |
| Color | Color picker, `#rrggbb` per stroke. |
| Solid / Dotted | Dotted is round dots spaced along arc length by the stroke builder. |
| Width mode | Constant / Speed thins / Speed thickens / Pressure, with the draw.js width pipeline (speed or pressure → Gaussian width smoothing → response curve → slope limit → arc smoothing). Result saved per point. |
| Opacity | 0..1 per stroke. |
| Show raw input | draw.js "Ghost": shows the raw sampled path as a faint line while drawing. Not saved. |
| Undo / Redo | Drawing-only history via Pencil page buttons and Ctrl+Z / Ctrl+Shift+Z while Drawing mode is on (decided). Separate from patch history. |
| Clear all | Confirm; clears the active layer only. One history step. |

- Tool, color, style, width settings, opacity, input smoothing and sample rate are UI preferences, not patch data.
- **Settle:** with lagging (Chase) filters the stroke keeps animating toward the pen-up point for a short tail (draw.js `PD_TAIL`, 4 s; per-sample filters are padded with the held last sample). The stroke is committed with its settled, finish-smoothed points; loading never runs a smoother.
- Eraser removes whole strokes it touches (world-space hit test).
- Drawing history is in memory per open patch: stroke add or erase, Clear all, Move, every layer action. It resets on patch load.

### Layers (ch4os model, decided)

- **Layer panel**, top to bottom:
  1. **Add layer** row.
  2. **Layer list** that scrolls when it has more rows than fit. One horizontal row per layer: **[name] [×] [Show / Hide] [reorder ▲ drag handle]**. Name: click selects the active layer, double-click renames. ×: deletes (Undo restores it). Active row highlighted.
  3. A drag **resizer** between list and settings box (more layers vs more settings), remembered as a UI preference, like ch4os `layerPanelPercent`.
  4. **Layer settings box** for the selected layer: Anchor (Workspace / Screen / Module), Attach to module (Module anchor), Screen corner (Screen anchor), Z order (Behind modules / In front of modules), Show in performance mode, Finish smoothing (algorithm and its parameters).
- **Anchor:**
  - **Workspace:** zoom-1 world coordinates.
  - **Screen:** fixed to the workspace viewport, stored in CSS px from a chosen corner (decided direction: pixels plus a pinned corner), so notes keep their size and stay near that corner when the window resizes.
  - **Module:** follows a module's zoom-1 top-left (`nodeGraphModuleGeometryGet`).
- **Position is relative to the anchor:** each layer has an `offset` from its anchor origin; points are relative to it; Move changes only the offset.
- Changing anchor or **Attach to module** recomputes the offset so the drawing stays where it is on screen, even if the module is far away; afterwards it follows the module at that offset until moved.
- **Deleting an anchor module:** the layer becomes a Workspace layer at `module's last position + old offset`, name kept, done in the module delete path. Patch Undo of the delete does not re-attach it; use Attach to module.
- **Z order** decides the GL pass (see Rendering); it is part of the layer settings.
- **Show in performance mode:** Module layers draw inside their module's tile; Workspace / Screen layers draw over the performance view; off hides the layer there.
- **Show drawings** (global) is saved in the patch.
- Copying a module or inserting a patch never touches drawings.

### Rendering

- Each stroke is built once into a cached mesh in layer-local coordinates (port of draw.js ribbon: arc resample at 0.75 px, per-point radius, round joins and caps, single-point dot fan), using the GL graph's retained-mesh path. Camera uniform pans and zooms with no rebuild (GW-2); per-layer translation covers offset and module position; Screen layers use an identity camera with a corner origin.
- **Behind modules:** in the `#nodeGlGraphCanvas` pass after the grid, before plates.
- **In front of modules:** above modules, wires, front Text Boxes and jack dots; **and above the Mini Performance View**, but **below the Snake select trail** (see `docs/MINI_PERFORM_VIEW_PLAN.md` Round 2 MP-19). Z-index: mini view `.node-mini-perform-view` is **6**, Pencil In-front `#nodeGlGraphPencil` takes **7**, Snake `#nodeGlGraphSnake` is **8**. Do not put In-front as the last batch on `#nodeGlGraphDots` (that canvas stays at z-index 4, under the mini). Settled finally in PE-4 with the GPU workspace owner; keep both plans in sync.
- Within a z group, layers draw in list order, strokes in time order.
- Opacity below 1 must not darken self-overlaps: one ribbon per stroke or per-layer composite. Check in PE-4.

### Patch schema (`drawings`, top level)

```json
"drawings": {
  "visible": true,
  "activeLayerId": "l1",
  "layers": [
    {
      "id": "l1",
      "name": "Layer 1",
      "visible": true,
      "showInPerform": true,
      "anchor": { "kind": "workspace" },
      "offset": [0, 0],
      "z": "inFrontOfModules",
      "finish": { "algorithm": "gauss", "params": { "fin": 40 } },
      "strokes": [
        {
          "id": "s1",
          "tool": "pen",
          "color": "#ffd166",
          "opacity": 1,
          "style": "solid",
          "points": [10.5, 20, 11.2, 21.4],
          "widths": [2.4, 3.1]
        }
      ]
    }
  ]
}
```

**Point format (decided):** `points` is a flat array `[x0, y0, x1, y1, …]` of the final smoothed points in layer-local px, rounded to 0.1. `widths` is a parallel array of absolute per-point widths (rounded to 0.1): one entry for Constant strokes (a single width for the whole stroke), one per point otherwise. A dot is one point and one width. No timestamps or raw input are saved.

- `anchor.kind`: `"workspace"`, `"screen"` (adds `"corner": "topLeft" | "topRight" | "bottomLeft" | "bottomRight"`, offset in CSS px from that corner) or `"module"` (adds `"nodeId"`).
- `z`: `"behindModules"` or `"inFrontOfModules"`.
- `finish.algorithm`: `"none"`, `"gauss"`, `"cr"`, `"2p"` or a registry id; `params` holds only that algorithm's parameter keys.
- `tool`: `"pen"`, `"line"` or `"arrow"`; `style`: `"solid"` or `"dotted"`.
- `normalizeNodeGraphPatchDrawings` is added to `normalizeNodeGraphPatch` as a separate top-level key: keeps known fields, clamps numbers, drops strokes with no points or mismatched `widths`, keeps a Module layer whose `nodeId` is missing as a Workspace layer with a logged warning, and writes nothing when there are no layers. Drawings are not in patch history snapshots.

## soundemote-dev parity

Everything the soundemote-dev Draw tab does, and where it lands. Source: `pinoisesmoothing/draw.js`, `mouse.js`, `index.html` L71-120.

| # | soundemote-dev feature | Source | Carry over | Milestone |
|---|---|---|---|---|
| 1 | Input smoothing algorithm dropdown, 31 filters in 4 groups (Chase, Lazy, Through Points, Stroke Smoothing) | `PM_FILTERS`, `pdOpts` | Yes, full registry | PE-1, PE-6 |
| 2 | Only the selected algorithm's parameters are shown, with per-parameter range, taper and units | `PM_USES`, `PM_DEF`, `pdBank.show` | Yes | PE-1, PE-6 |
| 3 | Look-ahead parameter for Chase filters | `pdUses` (`la`) | Yes | PE-1, PE-6 |
| 4 | Finish smoothing pass (None, Gaussian path length, Catmull-Rom, 2P, or any filter) with its own parameter bank | `pd-fin`, `pdRun`, `pmFinGauss`, `pmFinCR`, `pmFin2P` | Yes, **per layer** | PE-1, PE-7 |
| 5 | Sample rate (mouse polling speed) 1..1000 Hz, log, default 30 Hz; raw input resampled at that rate | `pm-rate`, `pdSample`, `pdPos` | Yes | PE-6 |
| 6 | Coalesced pointer events for full-rate input | `getCoalescedEvents` | Yes | PE-6 |
| 7 | Single click makes a dot (one-point stroke, filled circle) | `pdRun` n<2, `pdRibbon` | Yes, Drawing mode only (never basic) | PE-4, PE-6 |
| 8 | Width modes: Constant, Speed thins, Speed thickens, Pressure | `pd-wmode`, `pdWidth` | Yes | PE-6 |
| 9 | Width 1..60 px (log, default 6); Minimum width 5..100 % (30); Speed range 50..10000 px/s (800); Response curve 0.25..4 (1); Width smoothing 5..2000 ms (150); Width slope limit 0.01..2 (0.25); mode-dependent visibility | `pdW`…`pdSlope` | Yes, same ranges and defaults | PE-6 |
| 10 | Pen/touch pressure, mouse = 1, missing pressure = 0.5 | `pdP` | Yes | PE-6, PE-8 |
| 11 | Ribbon: arc resample 0.75 px, round joins, round caps, per-point radius | `pdRibbon`, `pdFan` | Yes, in the shared stroke builder | PE-4 |
| 12 | Settle tail: stroke keeps converging after pen-up (4 s), per-sample filters padded with held last sample | `PD_TAIL`, `PD_PAD` | Yes; commit after settle | PE-6 |
| 13 | Ghost: faint raw sampled path overlay | `pd-ghost` | Yes, as "Show raw input" | PE-6 |
| 14 | Undo button and Ctrl+Z; Clear | `pdUndo`, `pd-clear` | Yes, plus Redo; Clear all = active layer with confirm | PE-6 |
| 15 | Pointer capture, pointercancel ends the stroke, `touch-action: none`, crosshair cursor | pointer handlers, CSS | Yes, in Drawing mode | PE-6, PE-8 |
| 16 | Left button only | `if (e.button) return` | Yes | PE-6 |
| 17 | Cached finished strokes, rebuilt only when settings change | `pdOut`, `pdKey` | Yes (cached meshes; settings apply to new strokes only) | PE-4 |
| 18 | Jitter size (adds test noise to input) | `pm-jit` | **No**: test-only, not a drawing feature | — |
| 19 | Strokes kept in canvas-height units, not saved | `pdXY` | **No**: replaced by zoom-1 world px and patch save | PE-3 |

## Round 1: move today's drawing to the GPU (fixes the position bug)

**Source:** Argi, 2026-10-18. "Just fix the drawing stuff we have now, currently it doesn't draw in the right position … the round 1 plan should include getting that onto GPU drawing so we are not wasting time fixing a bug on code that is soon not going to exist."

**Rule for this round:** do not patch the SVG positioning. The fix is the port: the trail is drawn by the GL graph with the GPU camera, and the SVG is deleted. Round 1 adds no new drawing features.

### What is drawing today (repo read, 2026-10-18)

The only workspace drawing is the **Snake select trail**, in `public/node-graph-marquee-selection.js`:
- `<svg id="nodeSelectionHitTrail">` with `<path id="nodeSelectionHitTrailPath">`. It sits inside `#nodeGraphWorldLayer` in both `public/index.html` (~L667) and `public/perform.html` (~L664). CSS is `.node-selection-hit-trail` / `.node-selection-hit-trail-path` in `public/styles.css` (~L13128).
- `renderNodeGraphMarqueeSelection` (L222) sets `viewBox="0 0 w h"` to the world layer's client size, then writes one `<path>` per stroke (`nodeGraphHitTrailSyncPaths` L207). `nodeGraphHitTrailSmoothPathD` (L54) turns the points into Catmull-Rom cubic Béziers for display only.
- Three kinds of stroke are drawn (`nodeGraphHitTrailAllStrokes`, L189): the live trail (`drag.points`), the trails kept with Ctrl (`nodeGraphMvp.hitTrailKeptStrokes`, up to 48), and the Shift mirror strokes (`drag.mirrorStrokes`).
- The pen is `nodeGraphHitTrailLivePen` (L93): width `6 / zoom` and dash `14/zoom 11/zoom`. That only made sense while the world layer was CSS-scaled.
- Redraw calls: `marquee-selection.js` L959, L999, L1075, L1193 and `node-graph-workspace-zoom.js` L26, L164.
- Points come from `nodeGraphClientPoint` → `nodeGraphClientToZoomSurfacePoint` (`node-graph-workspace-geometry.js` ~L495). Hit testing works on these raw points, not on the SVG (except `nodeGraphSurfacePointHitsSvgPath`, which tests wire paths).

Other HTML or SVG in the world layer, not drawings but hit by the same bug:
- `#nodeSelectionMarquee`: the old rectangle marquee. CSS calls it unused; `renderNodeGraphMarqueeSelection` only hides it. `scripts/smoke_test.py` L5617 still lists its id. Dead code.
- `#nodeCameraOverlayLayer`: video camera frames (`node-graph-camera-view.js` ~L380-430). These are HTML divs placed with `left` / `top` from `--camera-frame-x/y` in world px, with drag handles.
- `#nodeGraphOriginMarker`: the world origin marker (CSS `left: 0; top: 0`).

The GPU camera only places `.dsp-node` elements (`nodeGraphPositionGridHtml`, `node-graph-viewport-perf.js`). So the camera frames and the origin marker have the same offset as the trail. They are not drawings, so they are not part of Round 1. They belong in GPU_WORKSPACE_PLAN as GW-1 inventory and GW-4 items: GPU paint plus an HTML hit target placed from the camera. That is flagged for the GPU workspace owner.

Not affected: SVG drawn inside a module (graph face `node-graph-graph-utils.js` ~L1030, fbm Field `fbm-field-ui.js`, slider choice debug layer `node-graph-slider-readout.js`). Those move with their module's CSS zoom and are GW-4 face work. The Phosphillator XY draw is module UI.

### Why it draws in the wrong place

GW-2 (`bf99c05d`) removed the CSS `translate3d` / `scale` from `.node-graph-world-layer`. Now the GPU draws the picture, and each `.dsp-node` gets its own CSS zoom and translate. The trail SVG is still inside the world layer, which is now untransformed, and its `viewBox` matches the layer's screen size. So it paints world coordinates as if they were screen pixels:
- **No camera origin:** it is missing the `nodeGraphRenderedOriginOffset` shift (workspace center + pan + chrome pin), so it is off even at zoom 1.
- **No zoom scale:** the offset grows as you zoom away from 1.
- **Wrong thickness:** width and dash are still divided by zoom, so the trail gets thinner when you zoom in and thicker when you zoom out.

There are also uncommitted edits in `node-graph-workspace-geometry.js` (not ours). They make `nodeGraphClientToZoomSurfacePoint` subtract the camera origin, so the points become true zoom-1 world coordinates and hits line up with modules. Because the SVG still has no camera, the visible trail moves even further from the cursor. Round 1 relies on those world-coordinate points.

### Milestones (Round 1)

| ID | Step | Done when | Status | Owner |
|---|---|---|---|---|
| R1-1 | **Repro and baseline.** On the current tree (with the GW-2 world-coordinate fix), record where the trail lands compared with the cursor at zoom 0.25, 1 and 4, panned and not panned, in edit mode and in `perform.html`. Confirm the input points are zoom-1 world coordinates by checking that hits match the modules under the cursor. Record the current look (color from `--node-selection-hit-trail-color` and the UI Dev snake select hue, brightness and alpha; alpha 0.95; round caps; 6 px wide; 14 / 11 dash). | Notes in this file; hits correct, drawing offset confirmed. | Done 2026-10-18 | executor |
| R1-2 | **Trail drawn in the GL graph.** Add a trail pass in `node-graph-gl-graph.js` that draws on the top canvas (`#nodeGlGraphDots`, inside `nodeGraphGlGraphDrawOver`) so the trail stays above modules, wires and jacks as it does today. It reads `nodeGraphHitTrailAllStrokes()` (live, kept and mirror strokes). Points stay in zoom-1 world coordinates and go through the same camera as everything else (`nodeGraphMvp.pan` / `nodeGraphZoom`, GW-2 camera uniform or `toX` / `toY`). No CPU reprojection is cached per camera. Width (6) and dash (14 / 11) are in **screen** px, so the trail looks the same at every zoom. Display smoothing keeps the Catmull-Rom shape: resample the curve into points, not SVG Béziers. Draw through `gl-line-renderer.js` with the existing `Segment` / `Polyline` / `Dot` calls. The library has no dash support, so the new app-side **shared stroke builder** (for example `public/node-graph-stroke-builder.js`) splits the curve into round-capped dashes along its length. That avoids a library edit; adding dash support to the library instead needs Argi's OK. A drag requests a GL frame instead of writing SVG. Pan and zoom redraw without a rebuild. If GL fails, the GW-7 path applies (`nodeGraphDisplayGlFailed`) and no trail is shown. | The trail sits under the cursor at every zoom and pan, in edit and perform; it looks the same on screen at every zoom; Ctrl kept trails and Shift mirror strokes stay where they were drawn while panning and zooming; hits unchanged. | Done 2026-10-18 | executor |
| R1-3 | **Delete the old drawing.** Remove `#nodeSelectionHitTrail` / `#nodeSelectionHitTrailPath` and the dead `#nodeSelectionMarquee` from `index.html` and `perform.html`. Remove their CSS (`.node-selection-hit-trail*`, `.node-selection-marquee`), `nodeGraphHitTrailSyncPaths`, `nodeGraphHitTrailSmoothPathD`, the SVG code in `renderNodeGraphMarqueeSelection` (rename it to what it now does; update the six callers), and the `/ zoom` pen math in `nodeGraphHitTrailLivePen`. Leave nothing behind for compatibility (APP_POLICY §1). Mouse smoothing, hits, Ctrl and Shift behavior stay unchanged. | No SVG, 2D canvas or CSS paint left for the trail; Snake select behaves the same. | Done 2026-10-18 | executor |
| R1-4 | **Checks.** Update `scripts/smoke_test.py`: drop the `nodeSelectionMarquee` id (L5617); add checks that `index.html` and `perform.html` have no `nodeSelectionHitTrail` SVG, that `marquee-selection.js` has no `createElementNS` call, and that the trail pass exists in the GL graph. Keep the mouse smoothing checks (L15877-15881). If `scripts/smoke_viewport_zoom_vars.mjs` covers it, add a check that a trail point drawn at zoom 1 and zoom 4 lands under the client point it came from. | Checks pass. | Done 2026-10-18 | executor |

**Round 1 notes (2026-10-18):**

- **R1-1 baseline:** softpop patch, slewLimiter, real mouse at zoom 0.25 / 1 / 4, pan 0 and (+140, -90). Input points were true zoom-1 world coordinates (start point at world x -1838 / -1358 / -1238 for a cursor 160 px left of the module). The SVG trail painted them as screen px, so it sat off screen in every case (0 trail pixels at the cursor). Hits were correct: a drag that crossed the module's input wire first locked to wires (first-hit rule), and a drag from above locked to modules and selected it. No hit-test change was needed.
- **R1-2:** `public/node-graph-stroke-builder.js` (Catmull-Rom resample with the old 1/6 handles, then dashes). `nodeGraphGlGraphDrawTrail` draws on `#nodeGlGraphDots` as the last batch (after the veil batch) with the GW-2 camera. Dashes use `Ribbon` plus round end `Dot`s, 3 px half width and 14 / 11 dash in screen px (world lengths divided by zoom when drawn). A drag calls `nodeGraphGlGraphPresentTrail`, which rebuilds only the trail batch and re-ends the held mesh (the pan/zoom gesture path). Begin failure goes to `nodeGraphDisplayGlFailed(canvas, "GL snake trail begin")`. Colour comes from `--node-selection-hit-trail-color` / `-alpha`.
- **Verified:** real mouse at zoom 0.25 / 1 / 4, pan 0 and (+140, -90): trail pixels under the cursor every time, hit true every time, no page errors. A Ctrl kept trail stays on its world spot after a pan and after zooming to 2, with the same on-screen width and dash. Shift mirror draws. `perform.html` never shows the workspace (edit mode is blocked there), so it has no Snake select to test. It loads with no errors after the markup removal.
- **R1-3:** SVG trail, `#nodeSelectionMarquee`, their CSS (including the patch-locked selector) and the dead selectors in `node-graph-magnifier.js` / `node-graph-camera-view.js` are gone. `renderNodeGraphMarqueeSelection` is now `presentNodeGraphHitTrail`. The pen is screen px (`{ width: 6, dash: [14, 11] }`).
- **R1-4:** `check_snake_trail_gl` in `smoke_test.py`. The optional placement check in `smoke_viewport_zoom_vars.mjs` was not added (another agent is editing that file); the real-mouse probe covers placement.

**Order:** R1-1, then R1-2, then R1-3 (only after R1-2 works on screen), with R1-4 alongside. Round 1 does not wait for PE-1 (no library change) and goes before PE-4.

**What later steps get from it:** the trail pass and the shared stroke builder from R1-2 are where PE-4 starts. PE-4 adds per-point width, ribbon joins, single-point dots, arrow heads, cached layer-local meshes and the Behind / In front of modules passes to the same builder. It does not write a second line path. PE-5 basic Dotted strokes reuse R1-2's dashes. Snake select stays a live overlay, not a saved stroke.

**Coordination (`docs/GPU_WORKSPACE_PLAN.md`):**
- **GW-2** is in the tree and is what R1-2 depends on (camera uniform, world layers not transformed). R1-2 uses the GW-2 camera; it does not add its own.
- `node-graph-gl-graph.js`, `node-graph-viewport-perf.js` and `node-graph-workspace-geometry.js` have other agents' uncommitted edits, including the world-coordinate fix in `nodeGraphClientToZoomSurfacePoint`. Land those, or agree with that owner, before R1-2 starts.
- **GW-1:** the inventory should list the trail SVG, `#nodeSelectionMarquee`, `#nodeCameraOverlayLayer` and `#nodeGraphOriginMarker`. Round 1 takes the first two. The camera frames and origin marker go to GW-4 for the GPU workspace owner.
- **GW-5:** R1-3 is the same kind of SVG deletion for the trail.
- **GW-6:** the GB-5 timing traces should include a Snake select drag after R1-2.
- **GW-7:** GL failure logging covers the trail pass.
- **PHONE_COMPAT_PLAN:** touch Snake select uses the same pass, so there is no extra phone work in Round 1.

## Milestones

| ID | Step | Done when | Status | Owner |
|---|---|---|---|---|
| PE-1 | **Shared pointer smoothing library.** New `public/lib/pointer/pointer-smoothing.js`: registry with id, label, group, parameter definitions (range, taper, default, units), `create` / `begin` / `point`, plus finish passes (Gaussian path length, Catmull-Rom, 2P). Port **all** soundemote-dev `mouse.js` filters (parity 1-4). Move the existing Papoulis smoother in too; Snake select, basic drawing and the Phosphillator call it with unchanged behavior; delete the old file. **Library code: needs Argi's approval before work starts.** | Registry lists every filter with its parameters; Snake select and Phosphillator unchanged; old file deleted. | Planned (needs Argi OK) | TBD |
| PE-2 | **Pencil page and Drawing mode toggle.** Register `pencil` in every place in the repo read; page DOM in `index.html` and `perform.html`; Drawing mode toggle on the page and in the top bar. The top-bar Mouse smoothing slider and `snakeMouseSmooth` stay unchanged. | Page opens from the nav; Drawing mode on captures workspace pointer input, off restores circuit editing; top-bar slider untouched. | Planned | TBD |
| PE-3 | **Schema.** Top-level `drawings` with the decided point format, per-layer `finish`, Screen `corner`: normalize, save, load round trip; not in patch history; audio code never reads it. Module-delete rule; module copy and patch insert leave drawings alone. | Round trip identical; graph compile ignores `drawings`; delete keeps the drawing in place. | Planned | TBD |
| PE-4 | **GL rendering.** Extends the R1-2 trail pass and shared stroke builder (ribbon port, dots, dotted, arrow head, per-point width, opacity), cached layer-local meshes, per-layer translation, Z order passes, anchors, Show drawings, overlap check; settle the In front of modules canvas with the GPU workspace owner. | Drawings render at any zoom with no rebuild on pan, zoom, Move or module drag; no 2D or SVG. | Planned | TBD |
| PE-5 | **Basic drawing tier.** Always-on drag-to-draw in the circuit builder with the agreed gesture, top-bar Papoulis smoothing, Solid / Dotted, current Color / Thickness / Opacity, into the active layer; presses with no movement leave no mark; drawing history. | Ordinary clicks and selection never leave marks; basic strokes save and undo. | Planned (gesture to confirm) | TBD |
| PE-6 | **Drawing mode tools and soundemote-dev input.** Tools (Pen, Straight line, Arrow, Eraser, Move), single-click dots, global algorithm dropdown with per-algorithm parameters, Sample rate, coalesced events, width modes and width controls, pressure, settle tail, Show raw input, Undo / Redo / Clear all, keyboard shortcuts (parity 1-3, 5-10, 12-16). | Every parity row marked PE-6 works side by side with soundemote-dev and feels the same; works with audio stopped. | Planned | TBD |
| PE-7 | **Layers UI (ch4os model).** Add layer row, scrolling list with [name][×][Show / Hide][reorder] rows, resizer, per-layer settings box (anchor, attach to module, screen corner, Z order, Show in performance mode, finish smoothing). | All layer actions save and go through drawing history; list scrolls with many layers. | Planned | TBD |
| PE-8 | **Touch, pen and performance mode.** Through `node-graph-touch-gestures.js`: one finger or pen draws in Drawing mode; two fingers pan and zoom (needs PH-6); long hold opens no menus while drawing; pressure; Show in performance mode. | Drawing works on a phone; hidden layers stay hidden in performance mode. | Planned (after PH-6) | TBD |
| PE-9 | **Tests.** Smoke checks: page registered; top-bar slider still present and unchanged; schema round trip; graph compile ignores `drawings`; basic tier leaves no mark on a click; Drawing mode click makes a dot; module delete and Attach keep drawings in place; module copy untouched; histories separate; no 2D-context or SVG draw calls in pencil code. | Checks pass. | Planned | TBD |

**Order:** Round 1 (R1-1..R1-4) first. Then PE-1 after Argi's OK. Then PE-2 and PE-3 in parallel, then PE-4, then PE-5, PE-6 and PE-7 (any order). PE-8 after PH-6. PE-9 grows with each step. If PE-1 is not approved, Drawing mode ships with Papoulis only from the existing file and the full parity list waits.

## Coordination

- **`docs/GPU_WORKSPACE_PLAN.md`:** see Round 1 for the GW-1 / GW-4 / GW-5 / GW-6 / GW-7 links. Drawings use the GW-2 camera uniform and retained meshes; the In front of modules pass joins the GW layer stack without changing Text Box wire ordering. `node-graph-gl-graph.js` and `node-graph-viewport-perf.js` have other agents' uncommitted edits; coordinate first.
- **`docs/PHONE_COMPAT_PLAN.md`:** touch drawing uses the shared gesture layer, no new timers. PE-8 waits for PH-6.
- **APP_POLICY §1 and §16:** no migrations; WebGL2 only.

## Decisions (Argi, 2026-10-18)

1. The existing top-bar Mouse smoothing slider (0..0.17) stays where it is, unchanged, and drives Snake select and basic drawing; `snakeMouseSmooth` is not renamed. Drawing mode has its own separate smoothing.
2. Undo / Redo is a separate drawing-only history, via Pencil page buttons.
3. Deleting an anchor module leaves the layer at the module's last spot. Layers can be re-attached; position is relative to the anchor; a re-attached drawing stays put until moved with Move.
4. Pen pressure and speed change stroke width in v1.
5. Layers: one horizontal row per layer [name][×][few controls]. Clear all clears the active layer, with confirmation.
6. Show drawings is saved in the patch.
7. Copying a module does not interact with drawing layers.
8. Each layer has Show in performance mode.
9. Stroke points and layer settings are saved in the patch, in their own top-level `drawings` section, separate from the audio graph. Point format as above; Screen layers in CSS px from a pinned corner.
10. Z placement is part of each layer's settings.
11. Drawing mode smoothing: algorithm dropdown showing only that algorithm's parameters with suited ranges (soundemote-dev style); live smoothing global.
12. Pen-up finish smoothing is a per-layer setting.
13. Layer UI follows ch4os: scrolling list, settings box for the selected layer beneath it.
14. Match soundemote-dev drawing (sample rate / polling speed, single-click dots, etc.); see parity table.
15. Two tiers: basic drawing always available (no single-click dots); a Drawing mode toggle for full drawing.

## Open questions

1. **Basic drawing gesture.** Today a drag on empty canvas is Snake select, so basic drawing needs its own trigger. Suggested: hold a modifier (for example Alt + drag, or holding D while dragging) to draw; plain drag stays Snake select. Needed before PE-5.

## Note (outside scope)

The Snake select SVG trail is now part of this plan (Round 1, R1-2 and R1-3). The video camera frames (`#nodeCameraOverlayLayer`) and the origin marker (`#nodeGraphOriginMarker`) have the same camera offset but are not drawings. They are flagged for the GPU workspace owner (GW-1 / GW-4).
