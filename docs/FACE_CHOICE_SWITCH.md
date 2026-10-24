# Face choice switch

App-wide face widget for a discrete choice that does not fit a short button row.

## Widget

```
{ kind: "cells", params: [["mode", "Mode"]], horizontal: true, h: 30 }
```

- Label on the left, current choice name on the right.
- A rectangle sits on the selected slot. No divider strokes between slots.
- Click a slot to select it; drag still moves through the choices.
- Same row kind as Clock Phase (continuous fill). Choice params get the slot rectangle instead of a left-to-right fill.

## Do not use

- Face `kind: "slider"` — old DOM slider row (`choices-divided` with strokes). Deleted. A leftover `kind: "slider"` row is upgraded to this cell switch.
- Homemade slot/button widgets.
- `kind: "choices"` when the names fit. Pulse Train Free / Latch is the template: two buttons, labels `Free` and `Latch`. Do not put `Free / Latch` in the cell label.

## Free / Latch

App-wide Recalculate On Trigger. Copy Pulse Train:

```
{ kind: "choices", param: "recalculateOnTrigger", labels: ["Free", "Latch"], h: 26 }
```

- Param key stays `recalculateOnTrigger` or `updateOnTrigger`.
- Choices: `Free` (0, knobs live) / `Latch` (1, freeze on trigger).
- Face shows the two buttons. The param metadata label can stay `Free / Latch` for the hidden slider.

Pluck Envelope uses this row. Cache `pluck-latch-2`.
