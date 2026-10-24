# B-109 — Red dotted wire-break line on own-inlet poke (no real wire)

Report ID: B-109  
Status: fixed  
Severity: see  
Source: user 2026-10-23 (Argi)  
Related: `docs/PORT_TYPES.md` (mismatch refused connect still uses the wire-break animation)

## User symptom

The dotted red wire-break line is shown when doing a jack's **own** inlet. Example: double-clicking a Trigger inlet should not show that line. The line is only for when there is actually a wire length.

## Repro

1. Click a Trigger inlet (or any inlet) once to arm a wire from that jack.
2. Click the same inlet again, or double-click it.
3. Observe: a short red dotted break line flashes at the jack even though no cable was drawn.

## Expected behavior

Own-inlet poke / self-plug does not draw the red dotted break line. That animation only runs when a real wire exists between two distinct ends (refused connect, disconnect, drag-break, and similar).

Spark / impulse on the inlet can stay; this report is the dotted line with no wire length.

## Notes

- Path: `public/node-graph-wires.js`. Re-click of the single selected input is treated as an attempted self-connection and calls `pokeInputPortImpulse`.
- `pokeInputPortImpulse` fires a unit impulse, a zap burst, and `animateDestroyedWire(from, to)` with a synthetic `to` 10 px right and 8 px up from the jack, so the poke looks like a break spark even with no cable.
- `nodeGraphAnimateDestroyedWire` in `public/node-graph-wire-actions.js` draws `.node-wire-break-line` (red dashed SVG). CSS: `public/styles.css`.
- Outlet self-click uses zap + `triggerWireBreak("port-click-self")` and does not draw that fake line.
- A refused connect between two different jacks still has real from/to points and is out of this report's expected change unless that pair has zero length.

## Investigation / fix shape

Fixed 2026-10-23. `pokeInputPortImpulse` no longer draws a synthetic 10×8 px `.node-wire-break-line`. Same-inlet poke still fires zap + unit impulse (`triggerWireBreak("port-impulse")` / `triggerNodeGraphInputWireBreakPulse`). Real wires (refused connect, drag-break) still use `animateDestroyedWire`. Cache-bust `node-graph-wires.js?v=b109-own-inlet-1`.
