# Phone and GPU Camera Plan

Source: Argi, 2026-10-18 (phone scope by Webby for Argi, approved 2026-10-18; GB-6 approved by Argi 2026-10-18). PH-1 through PH-5 are in the tree. GB-6, PH-6, PH-5b, and PH-7 are not started.

Merges the former `docs/PHONE_COMPAT_PLAN.md` and GB-6 (true GPU camera) from `docs/WEBGL_DISPLAY_PLAN.md` section 11 into one plan, because phone workspace gestures (PH-6) and the camera move (GB-6) share the same camera.

**2026-10-18 update:** GB-6 is now defined only in `docs/GPU_WORKSPACE_PLAN.md` as **GW-2**, which owns the workspace picture and camera. This plan keeps a dependency row for it, the camera-API rule, the ordering and PH-5b.

## Scope (Webby / Argi)

soemdsp-sandbox phone compatibility pass. Scope: make the sandbox itself work well on phones, mainly performance mode. NOT turning the sandbox into a phone app, and no soundemote.com special-casing. Every gesture goes in one shared touch-gesture layer that every module gets. Fold the Music Player's current double-tap fix (audio-player-playlist.js pointerup double-tap, touch-action: manipulation on rows) into it.

**In scope:**
1. Double-tap a music playlist row: load and play (same path as desktop double-click).
2. Double-tap a parameter: reset to default.
3. Long hold on a parameter: open text editing of its value.
4. First touch unlocks/resumes audio (AudioContext resume inside the gesture).
5. No page scroll/zoom while touching controls (touch-action on controls; performance mode prevents accidental scroll/zoom).
6. Hover-only info (tooltips, readouts) shows while touching or on long hold.
7. Light workspace editing: pinch zoom and two-finger pan only.

**Out of scope (Argi judged iffy):** bigger touch targets (overlap; zoom 1.0 stays the source of truth), tap-to-connect cables, long hold on cables/ports, fine-adjust drag, haptics, orientation/safe-area polish, full phone editing UI.

**Policies:** displays in WebGL; shared code over copies; workspace zoom 1.0 source of truth; no legacy shims.

## Decisions (Argi, 2026-10-18)

1. **Long hold = 500 ms.** A long hold also shows the hover info (PH-5).
2. **Seed rows:** double-tap on the code = text entry; tap 🎲 = random; tap + = +1; tap − = −1.
3. **Page pinch-zoom stays allowed.** Performance mode does **not** block page pinch-zoom (users choose their framing). `touch-action` only stops a control from scrolling/zooming the page while that control is being touched. This replaces "performance mode prevents accidental scroll/zoom" in scope item 5.
4. ~~**Workspace pinch/pan timing:** pending.~~ **Resolved:** build PH-6 now, through the existing `nodeGraphMvp.pan` / `nodeGraphZoom` pan/zoom functions, so it survives the later move to a GPU camera. With the merged plan, GB-6 lands before PH-6 (see Order).
5. **Workspace touch gestures:** keep one-finger pan on empty workspace. **Add two-finger pan:** two fingers moving together translate the view. This is distinct from pinch zoom, which responds to a change in finger distance.

## What exists today (repo read, 2026-10-18)

- **Music Player double-tap:** `public/modules/audioPlayer/audio-player-playlist.js` ~L2404-2466. Double-click and touch double-tap share one path, detected on pointerup because mobile browsers often never fire `dblclick`; the second tap's `click` is kept from queueing play-next, and a later `dblclick` is ignored. CSS: `touch-action: manipulation` on rows in `public/styles.css` L2188-2189 ("Double-tap plays the row: no double-tap zoom / tap delay").
- **Parameter sliders:** `public/node-graph-slider-dragging.js`.
  - Desktop **double-click = type-in edit**, detected manually from pointerdown timing (< 400 ms, < 6 px; ~L1183-1200), routed to `beginNodeSliderReadoutEdit` (`public/node-graph-slider-readout-controls.js` L170). Button faces skip type-in.
  - Desktop **reset = Ctrl/Cmd+click** (~L767-773, `nodeSliderCtrlClickDefaultValue`, falling back to `dataset.paramDefault` / `dataset.default`). Native range/number inputs get the same via `bindNodeGraphNativeSliderModifiers` (L680).
  - So on touch the mapping is **swapped** vs desktop gestures: double-tap -> the Ctrl-click reset path; long hold -> the double-click type-in path. Same functions, different gesture.
  - Seed rows have their own pointer handling in `public/node-graph-seed-control.js` (double-click type-in, 🎲, +/-).
- **Audio resume:** `public/node-graph-live-runtime.js` calls `context.resume()` at ~L3701, L3758, L3884, L4035; `public/node-graph-live-control-rendering.js` and `public/modules/audioPlayer/audio-player-embed.js` also resume.
- **Tooltips / hover:** `public/node-graph-tooltips.js` (stores and strips native `title` attributes and shows its own tooltip). Hover readouts live in the slider readout files.
- **Workspace zoom/pan:** `public/node-graph-workspace-view.js` already has touch pan and pinch zoom. One finger (`pointerType === "touch"`, primary) on empty workspace pans (`nodeGraphWorkspacePanPointerAllowed` L886, capture-phase `pointerdown`, `preventDefault` + `stopPropagation`, so marquee selection does not start); touches on modules, ports, controls, buttons and inputs are excluded (`nodeGraphWorkspaceTouchPanBlockSelector` ~L909). A second finger switches to pinch zoom (`beginNodeGraphWorkspacePinchZoom`, helpers ~L762-800, cancels the pan). `.node-graph-workspace` has `touch-action: none`, so the page does not scroll there. Bindings: `public/node-graph-workspace-event-bindings.js` ~L74-95. Wheel zoom also in `public/node-graph-viewport-perf.js` and `public/node-graph-gl-graph.js`.
- **Performance mode entry:** `public/perform-boot.js`. Plugin-host perform (`/perform.html`), light perform (`?mode=perform` / `?view=perform`) and phone canvas (capability detection: `(pointer: coarse)`, no hover, `maxTouchPoints`, width <= 920; preview `?mobile=1` / `?phone=1`, force desktop `?desktop=1`). Detection is capability-based, not hostname-based, which fits "no soundemote.com special-casing" (only comments mention soundemote.io).
- `index.html` and `perform.html` use `<meta name="viewport" content="width=device-width, initial-scale=1">` (page zoom not disabled; PH-3 relies on `touch-action`, not on disabling user zoom).
- Many controls already set `touch-action: none` in `public/styles.css` (e.g. L2466, L3414, L3547, L3758, L5059, L7699, L7930).

## Shared rule: one camera API

`nodeGraphMvp.pan` / `nodeGraphZoom` are the single camera API. Phone gestures (PH-6), wheel zoom, and the GL graph all read and write the camera only through them. **Neither side changes their signatures.** GB-6 / GW-2 (`docs/GPU_WORKSPACE_PLAN.md`) changes what the camera drives (a shader uniform and per-element HTML positions instead of CPU reprojection and a CSS transform), not how it is set.

## Order

1. **In parallel:** PH-1, PH-2, PH-3, PH-4, PH-5 (phone side) and GB-6 (GPU camera side).
2. **GB-6 lands before PH-6**, so the new workspace gestures are built and tested on the final camera.
3. **PH-6** (workspace touch gestures) on the PH-1 layer.
4. **PH-5b:** tooltip positioning touched up after GB-6.
5. **PH-7:** device test pass + smoke test, last.

## Tracker

| ID | Milestone | Owner | Status |
|----|-----------|-------|--------|
| PH-1 | Shared touch-gesture layer: one module (pointer events) recognizing tap / double-tap / long-hold / pinch / two-finger pan, used by every module. Fold the Music Player double-tap (`audio-player-playlist.js` pointerup path + row `touch-action: manipulation`) into it and delete the local copy. | | in tree (`node-graph-touch-gestures.js`; playlist uses it) |
| PH-2 | Audio unlock: the first touch resumes the AudioContext inside the gesture, through one shared call (not one per resume site). | | in tree (`nodeGraphTouchGestureUnlockAudio` on touch pointerdown) |
| PH-3 | `touch-action` on all controls so touching a control never scrolls or zooms the page. Page pinch-zoom elsewhere stays allowed, also in performance mode (Decision 3). | | in tree (`touch-action: none` on controls; html/body unchanged) |
| PH-4 | Parameter double-tap = reset to default (reuse the Ctrl/Cmd-click reset path, `nodeSliderCtrlClickDefaultValue`); long hold (500 ms) = text edit (reuse `beginNodeSliderReadoutEdit`). Seed rows differ (Decision 2): double-tap on the code = text entry, tap 🎲 = random, tap + / − = ±1. | | in tree (slider drag + seed readout) |
| PH-5 | Hover-only info (tooltips, readouts) shows while touching or on long hold (500 ms), via `node-graph-tooltips.js`. | | in tree (`.node-touch-hover-tip`; docked help still updates) |
| GB-6 | Dependency: true GPU camera = **GW-2** in `docs/GPU_WORKSPACE_PLAN.md` (defined only there). Must land before PH-6 and PH-5b. | GW owner | planned |
| PH-6 | Workspace touch on the PH-1 layer: keep one-finger pan on empty workspace; pinch zoom (finger distance change); add two-finger pan (both fingers moving together translate the view, distinct from pinch). Reuse/replace the existing touch pan and pinch code in `node-graph-workspace-view.js`, driving the existing `nodeGraphMvp.pan` / `nodeGraphZoom` functions after GB-6 lands (Decisions 4, 5; see Order). Zoom 1.0 stays the source of truth. | TBD | planned |
| PH-5b | Tooltip touch-up after GB-6: PH-5 tooltip / hover-readout positioning switched to the GB-6 per-element camera positioning. | TBD | planned |
| PH-7 | Device test pass (real phones, performance mode first) + a smoke test that drives synthetic pointer events through PH-1..PH-6, plus the GB-6 acceptance checks. | TBD | planned |

## File ownership

- **GB-6 / GW-2 and the rest of the workspace picture:** owned by `docs/GPU_WORKSPACE_PLAN.md` (GL graph, viewport, picture device, world-layer CSS, per-element HTML positioning; popups and floating windows are chrome and do not follow the camera).
- **Phone (PH-1..PH-7):** the new shared gesture layer, the slider files (`public/node-graph-slider-dragging.js`, `public/node-graph-slider-readout-controls.js`, `public/node-graph-seed-control.js`), the tooltip file (`public/node-graph-tooltips.js`), `public/modules/audioPlayer/audio-player-playlist.js` (PH-1 fold-in), the audio resume call sites (PH-2) and the workspace touch handlers in `public/node-graph-workspace-view.js` / `public/node-graph-workspace-event-bindings.js` (PH-6).
- Overlap points: `public/styles.css` (both sides; edit only your own rules), the camera API (shared rule above), and the seed row `public/node-graph-seed-control.js` (PH-4 touch gestures are in tree; GW-4 makes the seed row a transparent hit target over a GPU-painted face). Whoever edits the seed row second keeps the other side's behaviour and coordinates first.

## Coordination

- **Interface, `docs/ENGINE_STATE_DISPLAY_PLAN.md`:** ES-1..ES-6 are committed (ES-5 UI handler audit and the stopped-faces GPU smoke `scripts/smoke_engine_state_stopped_faces.mjs`). PH-1 / PH-4 / PH-6 change the same UI handlers (slider drag, workspace drag); reuse that smoke harness, and APP_POLICY §3b rule 5 (UI never blocked by engine state) applies to touch too. ES-6's static guard flags new engine reads in UI files.
- **`docs/WEBGL_DISPLAY_PLAN.md` section 11:** GB-1..GB-4 are in testing and always on (the `?glGraph=0` switch no longer exists in code, checked 2026-10-18); GB-5 was measured 2026-10-16. Today the GL pass reprojects cached world geometry on the CPU on each camera change and the HTML world layers move by an inline CSS `translate3d(...) scale(zoom)`; GB-1's "pan/zoom only change a uniform" is completed by GB-6 = GW-2 in `docs/GPU_WORKSPACE_PLAN.md`.
- Those files landed in `9f568d73`. Later touch-gesture edits are on top of that commit.
- Script language "Code page" is unaffected; the seed widget is touched by PH-4's seed-row gestures and by GW-4 (`public/node-graph-seed-control.js`; see File ownership).
