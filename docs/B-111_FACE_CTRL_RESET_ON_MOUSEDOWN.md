# B-111 — Face widgets reset to default on Ctrl+mousedown instead of mouse-up

Report ID: B-111  
Status: fixed  
Severity: see  
Source: user 2026-10-23 (Argi)

## User symptom

After switching slider parameters to the new face style, Ctrl+click to smooth-adjust / fine-tune snaps to default. Reset runs on mouse down instead of mouse up. Mouse down and drag is not a reset gesture.

## Expected

- Ctrl/Cmd+click **mouse up** (no drag) resets to default.
- Ctrl/Cmd+click **mouse down and drag** fine-tunes the value.

## Fix

`beginNodeGraphModuleFaceGesture` no longer resets on pointerdown. Capture uses the same move threshold as old sliders: if the pointer never moves, pointerup resets; if it moves, `nodeGraphNumericDragMultiplier` applies the Ctrl/Cmd fine scale. Pointercancel does not reset.

Cache-bust: `public/node-graph-module-face.js?v=b111-ctrl-drag-1`.
