# B-113 — Face grid divider lines flicker with zoom (no 1px floor)

Report ID: B-113  
Status: fixed  
Severity: see  
Source: user 2026-10-24 (Argi)

## User symptom

New grid-style controls (for example multiple stacks of vertical sliders in a row) have divider lines that flicker in and out with zoom. Nothing ensured at least 1 pixel visibility.

## Fix

Face hairlines go through `nodeGraphRailGrid` (same device-pixel floor as module rails): thickness is at least 1 device pixel, and the thin axis is snapped to the grid. Cell-stack gaps use that thickness instead of a raw 1 face-px hole.

Cache-bust: `public/node-graph-module-face.js?v=b113-hairline-1`.
