# Engine State and Displays Plan

Source: Interface agent for Argi, 2026-10-17. Planning/tracking doc.

Status: **ES-1 to ES-6 committed and pushed (checked 2026-10-18): `0fab9f69`..`87eaa37b`, plus `3a5b21c6` (cold-plate GL failure path), 2026-10-17. Awaiting Argi testing.** Owner: Grok Bot executor (perf/GL agent). Policy: `docs/APP_POLICY.md` §3b "Displays and engine state".

## Rules from Argi (2026-10-17)

1. Displays spawn and work while stopped.
2. Buffer displays show black while stopped and freeze on pause.
3. Parameter-driven displays update while stopped.
4. Modulation displays may wait for project start.
5. UI must never be blocked by engine state.

## Findings

- About **138 gate sites**.
- Central gates in `public/node-graph-module-scope-paint-gate.js`: `scopePaintIsLive`, `scopePaintIsEnginePlaying`, `scopePaintIsFrozen`, `scopePaintFaceShouldAnimate`, `nodeGraphArmDrawingFaceLoop`, `nodeGraphModuleScopePhosphorFrozen`; plus `nodeGraphModuleScopeCircuitRunning` and `syncNodeGraphModuleScopeHeartbeat`. They all answer "is the engine producing samples?", and faces use that to decide whether to exist.
- **Wrongly gated parameter faces:** sample-waveform / Music Player, arp, sequencer, graph playheads, softwave, softpop, ellipsoid, rgbFractal / fbmField (to verify), number readouts, screen-items cold boot, transport BPM, badval monitor.
- **UI:** dragging while frozen skips the scope redraw.
- **Music Player Playlist bug** (refresh, click Playlist, stale wave drawn over it): the GL graph drew hidden-page canvases and the waveform loop gate stopped the repaint. Fixed by the `?v=page-always-1` work, committed locally as `70d0d06a`.

## Tracker

| ID | Stage | Owner | Status |
|----|-------|-------|--------|
| ES-1 | Paint-gate exposes `engineState()` (stopped / paused / playing) and `facePaintPolicy(kind)` (param / buffer / modulation); each face declares its kind at registration. | Grok Bot | done (local) |
| ES-2 | Param faces paint on create and on every parameter change regardless of engine state; only live overlays (playheads, lamps) check the engine. | Grok Bot | done (local) |
| ES-3 | Buffer faces: a shared `ensureColdPlate(face)` on spawn and on stop, holding the last frame on pause. | Grok Bot | done (local) |
| ES-4 | Draw loops keep running while any param face is visible; engine start re-arms them and is no longer the only way to wake them. | Grok Bot | done (local) |
| ES-5 | Audit UI handlers, plus a smoke test: load a patch stopped, switch every Music Player page, drag a module, and assert every face painted. | Grok Bot | done (local) |
| ES-6 | A static guard flagging new `live.node`, `outputEnabled` or `speedMultiplier` reads in display or UI files outside `paint-gate.js` and `live-runtime.js`. | Grok Bot | done (local) |

## Landed

- **Playlist fix** (`70d0d06a`): GL graph skips canvases in hidden Music Player pages; audioPlayer waveform loop runs in every engine state; face switch flushes the GPU page.
- **ES-1**: `public/node-graph-module-scope-paint-gate.js` adds `scopePaintEngineState()` ("stopped" / "paused" / "playing"), `scopePaintFacePolicy(kind, state)` (`{ paint, black, freeze, animate }`), the kind table `nodeGraphFacePaintKindTable` (renderer key or node type), `nodeGraphRegisterFacePaintKind`, `nodeGraphDeclareFacePaintKind` (element `data-face-paint`), `nodeGraphFacePaintKindFor(slot | element | id | key)`, and `nodeGraphInstallDrawingFacePump({ paintKind })`. Unlisted faces default to "buffer" (old behaviour). Smoke: `scripts/smoke_engine_state_policy.mjs`.
- **ES-2**: `scopePaintShouldColdBootFace(nodeId, slot)` wipes on stop only for buffer / modulation kinds (power-off still wipes everything). New `paintNodeGraphParamFacesNow()` paints visible param faces that draw through the shared renderer table (today: Transport BPM) from both not-live branches of the scope draw (`scheduleNodeGraphModuleScopeDraw`, `drawNodeGraphModuleScopes`). Audit result: the other listed param faces (shapes, sin/cos, softwave, slew, arp keys, harmonic / additive curves, phone tone) self-paint on create and `syncFromParameters` already; their engine reads gate only live overlays (playheads, dots, lamps), which ES-2 allows. Softpop face, FBM field and RGB fractal are buffer / sample-driven and stay black while stopped (ES-3).
- **ES-3**: param list now also covers filter / envelope / shape / pulse / soft-clipper curve faces (class-marked: eqFilter, passiveFilter, cookbook filters, ...), controllers (knob, keyboard, buttons, plugin slider, round shape) and the sample waveform. New `scopePaintEnsureColdPlate(slot, { force, assumeStopped })` and `scopePaintEnsureColdPlates()`: param faces are never blanked; buffer / modulation faces get the registered face wipe, then the GL trace cold plate for waterfall / dot / value / lineBurn faces, else a black fill of the existing 2D face canvas; paused holds the frame. Called from Stop (`wipeNodeGraphModuleScopeScreensToColdBoot`, with `assumeStopped`), from slot spawn while stopped (`registerNodeGraphModuleScopeSlot`, two frames after layout), and from the typed-item cold boot in the orchestrator. ArchIV check on softpop (Play, Pause, Stop): param faces lit in every state; every buffer face held on pause; on Stop the Instant Waterfall faces (Output, Ping Pong, Time Quantizer) no longer keep the last trace (they did before ES-3); Output shows its designed stopped plate. Note: buffer faces spawned while stopped have no face canvas until first live draw, so they show their CSS plate.
- **ES-4**: face loops no longer depend on engine start to wake. `scopePaintNotifyFaceLoops({ force })` carries a force flag; drawing-face pumps repaint once on a forced wake and on every viewport wake, in any engine state. Stop sends a forced wake so param pictures stay and live overlays (playheads, dots) drop to idle. A face spawned while stopped or paused queues one coalesced param paint pass per frame (buffer faces get the ES-3 cold plate). Param faces still do not spin a rAF while stopped: they only change on parameter, resize, viewport or forced wakes, all of which paint, so an idle loop would only cost frames.
- **ES-5**: UI handler audit (`*-ui.js`, node dragging, selection, context menu, keyboard shortcuts, external UI events). No UI is wrongly blocked now that the Playlist is fixed. The remaining engine reads only guard posting messages to the worklet (keypad, external UI, quick restart) after the UI state is already updated, show status (badval lamp, Live Output menu tick), or keep paused residuals during a drag (`dragNodeGraphNode` skips the scope draw only while frozen, so held frames are not overwritten). New GPU smoke `scripts/smoke_engine_state_stopped_faces.mjs` (headed, needs server.py on :8765 and a real GPU): softpop loads stopped and every param face paints, a module drags while stopped and faces stay painted, and every Music Player page (wave, waveplay, pl, playinfo, vslr) shows alone while stopped, with no page errors.
- **ES-6**: `scripts/smoke_engine_state_gate_guard.mjs` scans display and UI files (`*-display.js`, `*-ui.js`, `node-graph-module-scope*.js`, display / face / scope / waveform / dragging / selection / gl-graph / visual files, `public/lib/visual/`) for `live.node`, `live.outputEnabled` and `live.speedMultiplier` reads outside `paint-gate.js` and `live-runtime.js`. The 47 existing reads in 21 files are baselined in `scripts/engine_state_gate_allowlist.txt`, shrink-only: a new read fails, and so does a removed read until its count is lowered. `--write-baseline` regenerates the list (only for shrinking).
- **ES-3b** (Argi, 2026-10-17): a buffer / modulation face created while stopped or paused now gets its face canvas at once and a drawn plate, same as after Stop: trace faces get their GL cold plate, number readouts their idle plate, everything else a GL black plate (`nodeGraphGlLinesBegin` clear; plain black only if GL failed). `scopePaintEnsureColdPlate(slot, { create: true })` creates the canvas; spawn retries for up to ~1.5 s while the face lays out. A culled face that wakes while stopped (or paused with no held canvas) gets the same plate (`nodeGraphViewportWakeColdPlate`). `smoke_engine_state_stopped_faces` adds Line Burn, Number Readout, Softpop and Time Quantizer while stopped and two more while paused, and checks each has an opaque painted plate.

## Follow-ups

- Burn down `scripts/engine_state_gate_allowlist.txt`: move each face's engine read to `scopePaintEngineState()` / `scopePaintFacePolicy()`. Most are live overlays (softwave / ellipsoid / sin-cos dots, sequencer playhead) or worklet-port sends (keypad), which are allowed by policy but should still go through the gate.

## Cross-references

- `docs/WEBGL_DISPLAY_PLAN.md`: displays are WebGL2 only; cold plates and frozen frames still draw through `gl-line-renderer.js` / `nodeGraphGlLinesFillBlack` (no 2D fallback). Section 11 (circuit builder to GL) is the GL graph work.
- GL graph agent's `?v=page-always-1` work (Music Player Playlist bug fix): committed together in `70d0d06a` (2026-10-17); the cache-bust string has since moved on.
- `docs/APP_POLICY.md` L348: faces observe the worklet run and never re-simulate; a cold plate is black or the last frame, never a fake simulation.
