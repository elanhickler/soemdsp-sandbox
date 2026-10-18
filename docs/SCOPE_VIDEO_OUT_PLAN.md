# Scope Video Out Plan

**Status:** plan only, not started. Do not start a VO-row until Argi says go.

**Date:** 2026-10-13. Source: Argi via the Thoughts agent; filed by PlanningDocs. Claims spot-checked against the working tree on 2026-10-13 (corrections below).

**Related:** `docs/APP_POLICY.md` (§1, §2, §3, §5 "Live chaos and video", §10, §19); `docs/WEBGL_DISPLAY_PLAN.md` §12 (Phase 0 P0a/P0c/P0d, Face wipe registry W1/W2); `docs/PORT_TYPES.md`; `docs/FUTURE_PLANNING.md` → Scope video out.

---

## How to update this file

- Agents and Argi change the **Status** cell of a row and add a dated note in **Notes**. Set **Owner** when you start.
- Status values: **Not started** / **In progress** / **Done** / **Dropped**. Dropped needs a one-line reason in Notes.
- Do not delete rows. Add new rows with the next free ID.
- **Argi commits.** Agents edit locally and do not commit or push.

---

## Goal

Every oscilloscope, videoscope and display module gets a 📺 `rgba` video output. Each frame it sends out the same picture its face shows, so scopes can be cabled into Video Delay and into video feedback loops.

---

## Current state (verified 2026-10-13)

- **The 📺 path works end to end, and the shared mechanism already exists.** `public/lib/visual/picture-device.js` has `nodeGraphPicturePublish(nodeId, texture, w, h)` (copies a finished texture into a per-node export FBO on the shared picture device), `nodeGraphPictureGet(nodeId)` and `nodeGraphPictureRead(nodeId, port)` (walks the cable to the source's published slot; any source port named `rgba` / `📺` counts). Spectrum Circle (type `videoFeedback`, `public/modules/videoFeedback/video-feedback-register.js`, publish at `video-feedback-gl.js:354`) and Video Delay (`public/modules/videoDelay/`, reads at `video-delay-display.js:117`, publishes at `video-delay-gl.js:269`) use it. So do Image Burn, fBm Field and RGB Fractal.
- All displays render on the one shared WebGL2 picture device (WEBGL_DISPLAY_PLAN §12 P0a/P0c/P0d, Done 2026-10-11) and copy onto their 2D face canvas with `nodeGraphSharedGlBlitTo2D` (`picture-device.js:259`).
- **Videoscope** (`node-graph-module-definitions.js:16018`, `displayType: "videoscopeBurn"`) has **no** `rgba` output today: `outputs: ["Thru"]` only.
- Declared but unimplemented `rgba` taps with the "TV tap — unimplemented" tooltip: **Spectrogram** (`node-graph-module-definitions.js:16106`, tooltip at :16109, `outputs: ["Thru", "rgba"]`) and **RGB Shape** (`public/modules/rgbShape/rgb-shape-register.js:43`/`:55`). Also check the `R, G, B, rgba` module at `node-graph-module-definitions.js:16803` during VO-0.
- `docs/PORT_TYPES.md` line 16 still lists `texture` / 📺 as **reserved** — stale.

### Corrections to the brief

1. The Videoscope `rgba` output and its "TV tap — unimplemented" tooltip are actually on **Spectrogram** (~line 16109). Videoscope has only Thru. → V1 starts with Spectrogram (jack exists) and *adds* the jack to Videoscope.
2. No helper needs extracting from Spectrum Circle: `nodeGraphPicturePublish` / `nodeGraphPictureRead` are already the shared helper in `picture-device.js`. The work is calling it from scopes, not building it.

---

## Rules (APP_POLICY fit)

- **§2 / §5 native, no JS DSP; "Live chaos and video (one universe)".** Scopes stay observers. Video out only re-publishes the picture the face already draws from worklet buffers; it never re-simulates the graph, never computes audio, never adds a second set of phases/seeds/integrators. GPU / WebGL2 only.
- **No special cases.** One shared mechanism: the face's present path calls `nodeGraphPicturePublish(nodeId, tex, w, h)` once. No `if (displayType === …)` branches, no per-type JS or worklet special cases, no per-scope publish code.
- **§3 prefer GPU.** Tap the GPU texture/FBO the face just drew, **before** `nodeGraphSharedGlBlitTo2D`. Never read the 2D face canvas back (no `getImageData`, no `drawImage`→upload of the face).
- **§1 / §10 no shims.** No legacy fallback outputs, no silent stub jack. A jack that is declared must publish; unimplemented "reserved" taps are either wired or removed. Patches that cable a reserved tap break and get repaired (§1).
- **Face wipe W1 (WEBGL_DISPLAY_PLAN §12).** Bypass / Stop / power-off go through `nodeGraphModuleScopeFaceWipes[displayType]`; the published slot follows the face (black or hold, see open questions). No new `if (typeof wipeX)` list.
- **§19 library approval.** Not expected to apply: all work is in `public/` JS/GLSL display code, no `library/include/soemdsp` change. If a row ever touches the library, it needs Argi's OK first.

---

## Fix

1. **Shared helper (exists).** Displays call `nodeGraphPicturePublish` from the one common present step after their GPU draw. Add a single registry/flag per definition (e.g. the presence of an `rgba` output) so the present step publishes generically.
2. **Tap before the 2D copy.** Publish the scissored region of the shared picture canvas / the face's own FBO before the blit. Where a face draws straight into the shared default framebuffer, render to (or copy into) the export FBO first.
3. **Rollout:**
   - **V1:** Spectrogram (jack already declared; wire it, fix tooltip). Videoscope: add `rgba` output and wire it.
   - **V2:** scopes that already draw fully on GPU: phosphor 1D/2D, Trace (woscope / stroke / tape), Vector RGB, Gradient Vectorscope, Matrix/asciiscope, Waterfall GL path, number readout GL. RGB Shape's declared tap goes here too.
   - **V3:** faces still drawn in Canvas2D (1D Waterfall scrolling history, 2D fallbacks). Port to GPU (preferred, matches WEBGL_DISPLAY_PLAN §12), or one texture upload per frame as a stopgap (Argi decides).
4. **Feedback loops.** A consumer reads the previous frame's published texture (like audio's 1-sample history). Never read and write the same texture in one frame; publish copies into the export slot, so a scope in its own loop samples last frame's slot.
5. **Docs.** PORT_TYPES change proposed below; apply it in VO-7.

### Proposed PORT_TYPES.md change (not applied)

Replace line 16:

```
| `texture` | TV / RGBA video-style taps (📺) | live — port name `rgba`, label 📺. Source publishes once per paint via `nodeGraphPicturePublish` (picture-device.js); sink reads the cabled source's last published frame via `nodeGraphPictureRead`. Contract: WebGL2 RGBA8 texture on the shared picture device, size = source's published plate (see SCOPE_VIDEO_OUT_PLAN open question 1), values unipolar 0…1, one frame per display paint (Sim FPS), readers see the previous frame; bypass/Stop/power-off follow face wipe W1. Never read back to CPU. |
```

---

## Open questions for Argi

1. Output resolution: face size, or a fixed or settable video size?
2. Keep publishing when the face is offscreen, collapsed or paused?
3. On bypass / Stop / power-off: send black, or hold the last frame?
4. 2D-only faces: allow the one-upload-per-frame stopgap, or wait for the GPU port?
5. (new) Spectrogram and RGB Shape already have declared "reserved" taps — wire them in V1/V2 (proposed) or remove them until their row lands?

---

## Progress tracker

| ID | Item | Files / lines | Size | Status | Owner | Notes |
|----|------|---------------|------|--------|-------|-------|
| VO-0 | Inventory every display module and its draw path (GPU / Canvas2D) and existing `rgba` declarations | `node-graph-module-definitions.js`, `public/modules/*/…-register.js` | S | Not started | | |
| VO-1 | Generic publish step in the shared present path (no per-type branches) | `public/lib/visual/picture-device.js` | S | Not started | | Helper exists; add generic call site. |
| VO-2 | V1: Spectrogram — wire declared `rgba`, fix tooltip | `node-graph-module-definitions.js:16106`, `public/modules/spectrogram/` | S | Not started | | |
| VO-3 | V1: Videoscope — add `rgba` output and wire it | `node-graph-module-definitions.js:16018` | S | Not started | | Locks I/O once shipped. |
| VO-4 | V2: GPU scopes (phosphor 1D/2D, Trace woscope/stroke/tape, Vector RGB, Gradient Vectorscope, Matrix/asciiscope, Waterfall GL, number readout GL, RGB Shape) | `public/lib/phosphor/`, `public/lib/trace/`, `asciiscope-gl.js`, `node-graph-module-scope-waterfall-gl.js`, `rgb-shape-register.js` | M | Not started | | |
| VO-5 | V3: Canvas2D faces — GPU port or upload stopgap | 1D Waterfall history, 2D fallbacks | M | Not started | | Waits on open question 4. |
| VO-6 | Bypass / Stop / power-off: published slot follows W1 | `node-graph-module-scope-wipe.js` | S | Not started | | Waits on open question 3. |
| VO-7 | PORT_TYPES.md: mark `texture`/📺 live + contract | `docs/PORT_TYPES.md` | S | Not started | | Wording above. |
| VO-8 | Feedback-loop test: scope → Video Delay → scope, previous-frame read, no same-texture read/write | test + patch | S | Not started | | |
