# Engine State and Displays Plan

Source: Interface agent for Argi, 2026-10-17. Planning/tracking doc.

Status: **in progress (ES-1, ES-2 landed locally).** Owner: Grok Bot executor (perf/GL agent). Policy: `docs/APP_POLICY.md` §3b "Displays and engine state".

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
| ES-3 | Buffer faces: a shared `ensureColdPlate(face)` on spawn and on stop, holding the last frame on pause. | TBD | planned |
| ES-4 | Draw loops keep running while any param face is visible; engine start re-arms them and is no longer the only way to wake them. | TBD | planned |
| ES-5 | Audit UI handlers, plus a smoke test: load a patch stopped, switch every Music Player page, drag a module, and assert every face painted. | TBD | planned |
| ES-6 | A static guard flagging new `live.node`, `outputEnabled` or `speedMultiplier` reads in display or UI files outside `paint-gate.js` and `live-runtime.js`. | TBD | planned |

## Landed

- **Playlist fix** (`70d0d06a`): GL graph skips canvases in hidden Music Player pages; audioPlayer waveform loop runs in every engine state; face switch flushes the GPU page.
- **ES-1**: `public/node-graph-module-scope-paint-gate.js` adds `scopePaintEngineState()` ("stopped" / "paused" / "playing"), `scopePaintFacePolicy(kind, state)` (`{ paint, black, freeze, animate }`), the kind table `nodeGraphFacePaintKindTable` (renderer key or node type), `nodeGraphRegisterFacePaintKind`, `nodeGraphDeclareFacePaintKind` (element `data-face-paint`), `nodeGraphFacePaintKindFor(slot | element | id | key)`, and `nodeGraphInstallDrawingFacePump({ paintKind })`. Unlisted faces default to "buffer" (old behaviour). Smoke: `scripts/smoke_engine_state_policy.mjs`.
- **ES-2**: `scopePaintShouldColdBootFace(nodeId, slot)` wipes on stop only for buffer / modulation kinds (power-off still wipes everything). New `paintNodeGraphParamFacesNow()` paints visible param faces that draw through the shared renderer table (today: Transport BPM) from both not-live branches of the scope draw (`scheduleNodeGraphModuleScopeDraw`, `drawNodeGraphModuleScopes`). Audit result: the other listed param faces (shapes, sin/cos, softwave, slew, arp keys, harmonic / additive curves, phone tone) self-paint on create and `syncFromParameters` already; their engine reads gate only live overlays (playheads, dots, lamps), which ES-2 allows. Softpop face, FBM field and RGB fractal are buffer / sample-driven and stay black while stopped (ES-3).

## Cross-references

- `docs/WEBGL_DISPLAY_PLAN.md`: displays are WebGL2 only; cold plates and frozen frames still draw through `gl-line-renderer.js` / `nodeGraphGlLinesFillBlack` (no 2D fallback). Section 11 (circuit builder to GL) is the GL graph work.
- GL graph agent's uncommitted `?v=page-always-1` work (cache-bust in `public/index.html` and `public/perform.html`): fixes the Music Player Playlist bug and **must be committed together** with it.
- `docs/APP_POLICY.md` L348: faces observe the worklet run and never re-simulate; a cold plate is black or the last frame, never a fake simulation.
