# GPU workspace plan

Source: Argi, 2026-10-18. Planning doc, not started. Hand this file to the librarian. Do not implement from this file.

Argi, after confirming pan works: the app menu, the top and bottom button bars, and the extra windows stay HTML/CSS. The gridded workspace is drawn only by the GPU.

## Librarian filing

Do this and stop. No code, no shader edits, no patch edits.

**Filed 2026-10-18** (docs only, not committed): steps 1-5 done. This file owns the workspace picture and the camera; GB-6 = GW-2 is defined only here. `docs/WEBGL_DISPLAY_PLAN.md` GB-6 and `docs/PHONE_AND_GPU_CAMERA_PLAN.md` carry pointer / dependency rows only.

1. Keep this file at `docs/GPU_WORKSPACE_PLAN.md`.
2. Add a pointer at the top of `docs/FUTURE_PLANNING.md`: workspace picture is GPU-only; bars, app menu, and extra windows stay HTML. Plan: this file. Status: planned, not started.
3. In `docs/WEBGL_DISPLAY_PLAN.md` section 11, point GB-6 at this file. GB-6 is stage GW-2 here. Do not open a second camera project. Leave the GB-1..GB-5 history as it is.
4. In `docs/PHONE_AND_GPU_CAMERA_PLAN.md`, note that GB-6's picture scope is this file. The camera API rule stays: `nodeGraphMvp.pan` / `nodeGraphZoom` signatures do not change. PH-6 still waits until GW-2 has landed.
5. One `progress.md` line: planning only, not started, not committed.
6. Do not commit unless Argi says so.

## Decision

Two surfaces.

| Surface | Draws with | Examples |
|---|---|---|
| App chrome | HTML/CSS | App menu, top button bar, bottom bar, command center, module shop, settings, visibility menu, other floating windows, boot menu, docked interaction help |
| Gridded workspace | GPU only, for everything the user sees | Grid, cables, traces, module plates, borders, titles, jacks, port labels, slider tracks and readouts, display pictures |
| Text Box (exception) | HTML/CSS, inside the grid, positioned from the camera | Text Box plate, text, caret, selection. Editable control, not a display (Decision: Text Box below) |

HTML inside the workspace is not a second picture. It is one of these:

- An invisible pointer hit target.
- A live text caret (input, textarea, select, contenteditable, module title while editing).
- A special face that still needs DOM events. The GPU paints that face. The HTML is transparent and only receives the pointer.

Popups and floating windows are chrome. They stay HTML and they are not children of the camera transform. This list is the one in force for GB-6 / GW-2 (it replaces the shorter "text inputs, popups, special faces: graph, keypad, knob" list that GB-6 had before).

Hit testing stays in JavaScript against module rectangles in world space. The GPU does not pick clicks.

Zoom 1.0 is the source of truth. The camera only scales that layout. Stacking of GPU-drawn things inside the workspace is GPU plate order, not a CSS `z-index`. Text Box stacking against cables is the two-wire-canvas rule below.

### Text Box (Argi, 2026-10-18)

- Text Box stays HTML (Argi, 2026-10-18): typing, IME, selection and a11y stay native. It is an editable control, not a display.
- Why GL was considered: per-box Z order relative to wires. Solution: the GL workspace draws wires on **two stacked canvases**, one below and one above the Text Box HTML layer. Each Text Box gets a setting **Behind wires** / **In front of wires** (full-word labels); its wires go to the matching canvas.
- The existing GL Text Box draw (`nodeGraphGlGraphDrawTextBox` in `public/node-graph-gl-graph.js`, plate + glyphs, skipped while the field has focus) is retired. Keep at most a GL plate if the visual check needs one; glyphs stay HTML only, so there is never a second copy of the text.
- **"Show on top" stays (Argi, 2026-10-18).** The existing "Show on top" setting (`layout.showOnTop`, `public/modules/textBox/text-box-settings.js` ~L80, `.text-box-on-top` CSS) is separate: it makes wires draw in front of modules. Keep it.
- **Z-order is independent of Show on top.** Each Text Box's z-order setting (Behind wires / In front of wires) decides on its own: a lower-z Text Box always draws behind wires, a higher-z Text Box always draws in front of wires, regardless of Show on top.
- Future: a GPU-drawn text box (or any GPU box) belongs to the emo Script module (`docs/SCRIPT_LANGUAGE_PLAN.md`), not to Text Box.

No canvas-2D fallback and no SVG-wire fallback in the end state. If WebGL fails, the workspace goes black and logs through `nodeGraphDisplayGlFailed` (GW-7; today it only goes black). There is no `?glGraph=0` switch any more (repo read 2026-10-18: no code reads it, and `gl-graph-on` is set unconditionally); the leftover SVG wire code is deleted in GW-5.

## What exists today (repo read, 2026-10-18)

- GB-1..GB-4 are on by default. Cables, grid, plates, jacks, titles, port labels, and slider tracks/readouts draw in `public/node-graph-gl-graph.js` on the shared picture device (`public/lib/visual/picture-device.js`, `public/lib/visual/gl-line-renderer.js`). Always on: no code reads a `?glGraph` query any more and `nodeGraphGlGraphPresent` (~L1150) adds `gl-graph-on` unconditionally. SVG wire code is still present (`syncNodeGraphWireSvgViewBox` in `public/node-graph-viewport-perf.js`).
- On GL failure the GL graph calls `nodeGraphGlLinesFillBlack` and returns false (`node-graph-gl-graph.js` ~L1169). It does not call `nodeGraphDisplayGlFailed` (defined in `public/lib/visual/display-canvas.js` L202; today only the emo shader path in `gl-line-renderer.js` calls it), so the failure is not logged.
- GB-5 was measured 2026-10-16. Zoom-out 40→0.35 was 201 ms (old HTML gesture was about 5.5 s). Pan at 40× was 53 ms. Numbers are in `docs/WEBGL_DISPLAY_PLAN.md` section 11.
- GB-1's "pan/zoom only change a uniform" is not met. Each camera change reprojects cached world geometry on the CPU. The HTML world layers still move by an inline CSS transform.
- That transform is `nodeGraphApplyPanVarsToWorldLayers` in `public/node-graph-viewport-perf.js` (about line 43): `translate3d(x, y, 0) scale(zoom)` on every `.node-graph-world-layer`.
- When `.node-graph-workspace.gl-graph-on` is set, `.dsp-node *` has `pointer-events: none` except an allowlist in `public/styles.css` (about line 13013). Display canvases under the GPU quad are `visibility: hidden`. Keypad chrome is already forced transparent.
- The allowlist is the HTML that still lives in the grid: text fields and the editing title; module popovers; graph face; keypad; knob; XY pad; acid sequencer; arp keys; plugin toggle and momentary buttons; seed row; sample waveform; piano keyboard; grid keyboard; text-box body.
- Text boxes currently also draw their plate and glyphs in the GL pass (`nodeGraphGlGraphDrawTextBox`; `showOnTop` boxes go on the upper veil batch), and the field stays HTML for the caret. Per the Text Box decision this GL copy is retired (GW-4).
- Phone gestures are a separate plan (`docs/PHONE_AND_GPU_CAMERA_PLAN.md`); PH-1..PH-5 are in the tree. They do not decide this picture split. PH-6 (workspace pinch and two-finger pan) waits for GW-2, and PH-5b (tooltip positioning) follows GW-2.

## Order

1. **GW-1** inventory, so later stages delete paint instead of guessing.
2. **GW-2** camera. This is GB-6. It lands before any new workspace gesture work (PH-6).
3. **GW-3** and **GW-4** can proceed in parallel after GW-1. GW-3 is module chrome that is already drawn in GL. GW-4 is the special-face list.
4. **GW-5** deletes the old draw after GW-3 and GW-4, and after a visual check.
5. **GW-6** re-measures. Same traces as GB-5.
6. **GW-7** (GL failure logging) is independent and can land any time.

## Tracker

| ID | Milestone | Status |
|----|-----------|--------|
| GW-1 | Inventory every element inside `#nodeGraphWorkspace` / `.node-graph-world-layer` that still paints (background, border, text, shadow, canvas, svg). Mark each as chrome-outside-the-grid (leave) or workspace (GPU picture, or invisible hit target). Write the list into this file. Do not restyle during the inventory. | planned |
| GW-2 | True GPU camera. Same stage as GB-6 (Argi approved 2026-10-18); this row is its only definition. Pan/zoom write `nodeGraphMvp.pan` / `nodeGraphZoom` and a camera uniform (view matrix) in the GL graph shaders. Remove the per-camera CPU reprojection of cached geometry. Remove the CSS `translate3d` / `scale` on `.node-graph-world-layer`. Remaining in-grid HTML (carets, Text Boxes, and GW-4 hit targets) is positioned per element from the camera; popups and floating windows are chrome and do not follow it. Hit testing stays JS, world space. Zoom 1.0 stays the source of truth. Do not change the pan/zoom function signatures. Acceptance: no CSS transform on world layers; pan/zoom causes no geometry rebuild; GB-5 timing re-measured (GW-6). Unblocks PH-6 and PH-5b. | planned |
| GW-3 | Workspace module chrome paints only in the GL pass: plates, borders, titles, jacks, port labels, slider tracks, slider readouts, cables, traces, grid. Delete the CSS paint on those nodes while `gl-graph-on` (background, border, shadow, label color). Display canvases stay hidden under the GPU quad. | planned |
| GW-4 | Special faces in the grid. GPU paints the face. HTML is a transparent hit target positioned from the camera: graph face, keypad, knob, XY pad, acid sequencer, arp keys, plugin toggle and momentary buttons, seed row, sample waveform, piano keyboard, grid keyboard. A face that is not yet drawn by the GPU stays listed here until it is. It does not get a new CSS look. **Seed row:** `public/node-graph-seed-control.js` also carries the phone PH-4 touch gestures (in tree); keep those handlers working and coordinate with the phone plan owner before editing. **Text Box (not a special face):** stays HTML (Argi, 2026-10-18). Draw wires on two stacked GL canvases, below and above the Text Box HTML layer; add the per-box setting **Behind wires** / **In front of wires** and route each box's stacking to it; this z-order is independent of the existing "Show on top" setting (wires in front of modules), which stays: lower-z boxes always draw behind wires, higher-z boxes always in front, regardless of Show on top. Retire `nodeGraphGlGraphDrawTextBox` (keep a GL plate only if needed; never GL glyphs). | planned |
| GW-5 | Delete the old workspace picture: the SVG wire code (`syncNodeGraphWireSvgViewBox` and the wire SVGs), and HTML plate/jack/label paint. (The `?glGraph=0` switch is already gone.) One workspace picture remains. | planned |
| GW-6 | Re-run the GB-5 zoom-in, zoom-out, and pan traces at 40× and low zoom (`nodeGraphGlGraphMeasureGb5()`). Record the numbers next to the 2026-10-16 baseline. | planned |
| GW-7 | GL failure logs: when `nodeGraphGlLinesBegin` fails in the GL graph (`node-graph-gl-graph.js` ~L1169), call `nodeGraphDisplayGlFailed` (`public/lib/visual/display-canvas.js`) as well as filling black, so a black workspace is always logged. | planned |

## Acceptance

- Bars, the app menu, and floating windows still look and click as HTML.
- Panning and zooming the grid does not move those windows with the camera.
- No CSS transform on `.node-graph-world-layer`.
- A pan or zoom does not rebuild workspace geometry.
- Nothing inside the grid draws a second copy of a plate, cable, jack, title, slider, or Text Box text.
- A Text Box set to Behind wires shows cables over it; In front of wires hides them; typing, IME and selection work at any zoom.
- Zoom 1.0 layout matches what the camera scales.
- GL failure is a black workspace, logged through `nodeGraphDisplayGlFailed` (GW-7).

## Files

- Camera and GL picture: `public/node-graph-gl-graph.js`, `public/node-graph-viewport-perf.js`, `public/lib/visual/gl-line-renderer.js`, `public/lib/visual/picture-device.js`.
- Workspace paint rules: `public/styles.css` (`.gl-graph-on`, `.node-graph-world-layer`).
- Pages that load the graph: `public/index.html`, `public/perform.html`. Cache-bust query strings move together.
- Text Box: `public/modules/textBox/text-box-host.js`, `public/modules/textBox/text-box-settings.js`, `public/node-graph-text-box-utils.js`.
- Shared with the phone plan: `public/node-graph-seed-control.js` (PH-4 gestures, GW-4 hit target) and `public/styles.css` (edit only your own rules). The camera API (`nodeGraphMvp.pan` / `nodeGraphZoom`) is shared and its signatures do not change.
- Related plans, read only: `docs/WEBGL_DISPLAY_PLAN.md` section 11, `docs/PHONE_AND_GPU_CAMERA_PLAN.md`.

## Out of scope

- Restyling the app menu, toolbars, command center, module shop, or other floating windows.
- Phone gesture recognition (PH-1..PH-7), except that PH-6 must wait for GW-2.
- The module-display migration in `docs/WEBGL_DISPLAY_PLAN.md` sections 1–10, except where a face is still a painted picture inside the grid (that face is GW-4).
- Performance-mode hotkeys. Escape, F, and V already stay off there.
- Soundemote.com and soundemote.io page chrome.
- A GPU-drawn text box (or any GPU box): future work for the emo Script module (`docs/SCRIPT_LANGUAGE_PLAN.md`).

## Open question (not blocking)

Module text above 2.5×: pixelated like displays, or sharp. Already open in `docs/WEBGL_DISPLAY_PLAN.md` section 11. Do not decide it while filing this plan.
