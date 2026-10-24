# B-108 — Whole-module canvas/mini Arrange tiles keep inset padding from the arrange box

Report ID: B-108  
Status: open  
Severity: see  
Source: user 2026-10-23 (Argi)  
Related: B-068 (canvas-mode slider/knob/text scaling); B-071 (canvas Text Box tile scale); `docs/MINI_PERFORM_VIEW_PLAN.md` (shared whole-module fit)

## User symptom

The **Show module in canvas / mini view** whole-module tile, once in **Arrange**, has padding all around between the module and the arrange box. That gap is a problem when pushing the module against the arrange-view wall for a tight fit.

## Repro

1. Turn on Show module in canvas (whole-module / `ui.canvasWholeModule`) on a module.
2. Open Arrange: F-cycle the performance view to arrange, or Shift+F-cycle the mini view to Arrange.
3. Drag the tile so it sits against a wall of the arrange view.
4. Observe: the module chrome stays inset from the arrange box on every side. The tile cannot flush to the wall.

## Expected behavior

A whole-module tile can sit flush on the arrange-box edges. Pushing it against the arrange-view wall yields a tight fit, with no forced inner padding.

## Notes

- Shared fit path: `public/node-graph-canvas-fit.js` (`nodeGraphWholeModuleFitBox`, `nodeGraphWholeModulePadPx`). F layout canvas and Mini Performance View both call it.
- Current pad law in that file: 4% of the smaller tile side, at least 12 px, never more than a quarter of that side. Contain-fit then uses `tw - 2 * pad` / `th - 2 * pad` and centers the leftover as `ox` / `oy`.
- `docs/MINI_PERFORM_VIEW_PLAN.md` documents this as intentional contain-fit **with padding**. This report treats that inset as the bug in Arrange, where the arrange box is the layout wall.
- Display-only (non whole-module) tiles are a separate path; this report is the whole-module Arrange inset.

## Investigation / fix shape

Not started. Logged only; Argi said do not code now. Docs-only bug report; no code change included.
