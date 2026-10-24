# B-112 — Band widget handles draw past the left/right widget edges

Report ID: B-112  
Status: fixed  
Severity: see  
Source: user 2026-10-23 (Argi)

## User symptom

The new two-handle widget (left and right handles), for example Spectrogram frequency, draws the right handle clipping / over the right edge. The left handle is also not limited to the slider widget area.

## Fix

`nodeGraphModuleFaceBandBarX` places the 3 px bar from travel *t* and clamps it so the bar stays inside the widget box. Travel 0 pins to the left edge; travel 1 pins to the right edge. Cache-bust `node-graph-module-face.js?v=b112-band-handle-1`.
