# Display Settings Numbers Plan

Status: plan only (2026-10-19, Argi via Librarian). No code changed. Not committed.

## Goal

Display Settings number fields (per-display settings such as scope Sweep (Hz), Sweep (c), History (Hz), Cycles, Size, Blur, Bright, Bins, FFT Size, Dot Budget...) must:

1. Reset to default on Ctrl/Cmd+click (missing today, except the hue title row).
2. Follow the app-wide mouse modifier conventions for fine tuning, the same ones module sliders and knobs use. Alt+click (jump to pointer) does not apply here.
3. Stop misbehaving. Sweep (Hz) and Cycles jump from 5 to 100 in about 5 px today.

There's one shared drag law, written once, and no per-field gain constants. Code that becomes unused gets deleted (APP_POLICY §10b). There are no shims.

## App-wide modifier conventions (from code)

Source: `public/node-graph-slider-values.js` (`nodeGraphNumericDragMultiplier`, `nodeGraphPointerDragScreenDelta`, `nodeGraphPointerDragTravelDelta`) and `public/node-graph-slider-dragging.js` (`nodeSliderFineTuneScale`, `nodeSliderCtrlClickDefaultValue`, `bindNodeGraphNativeSliderModifiers`, click handling around lines 1193-1251).

| Gesture | Module sliders/knobs | Display Settings target |
|---|---|---|
| Drag axes | `combined = (x - startX) + (startY - y)`: right and up increase. | same (already used) |
| Drag gain | `combined / travelWidthPx * fineScale` of the full range. travelWidth = lane width (slider) or dial size (knob). Native ranges use `max(48, rect.width)`. | one fixed travel per full control range (see DS-3) |
| Fine | Shift **or** Ctrl/Cmd held while dragging = ×0.1 | same (already wired via `nodeGraphNumericDragMultiplier`) |
| Extra fine | Shift + Ctrl/Cmd = ×0.01 | same (already wired) |
| Modifier change mid-drag | re-anchor start value/position, no jump | same (already) |
| Ctrl/Cmd+click (no Shift/Alt) | reset to default (`dataset.paramDefault` then `dataset.default`) | **add** |
| Alt+click | jump to pointer + snap smoother | **not applied** (number fields have no lane) |
| Wheel | native ranges: one step = declared step (or 1% of range) × fine scale | **none**: the wheel only zooms, never changes a parameter (APP_POLICY §21c). Native-range wheel is removed in DS-9 |
| Keyboard step (module slider) | declared step ×10 with Shift, ×0.1 with Ctrl/Cmd | the existing −/+ steppers stay; arrow keys are out of scope |
| Double-click | text edit (`event.detail > 1` skips drag) | unchanged |

Note the existing inconsistency: in a drag Shift is *fine* (×0.1), but in the module keyboard step Shift is *coarse* (×10). This plan only touches the pointer, so it follows the drag rule.

## How Display Settings numbers work today

- Rendered as read-only `<input data-trace-display-field="key">` with −/+ steppers. Metadata is in `nodeGraphDisplaySettingsFieldMeta` (`public/node-graph-module-scope-trace-controls.js:1190`, 85 entries: label/id/title/inputmode, optional `sliderCurve`/`curveAmount`, **no min/max/default/step**).
- Defaults: `nodeGraphDisplaySettingsDefaultValue(key)` (`node-graph-module-scope-settings-form-io.js:626`), backed by `node-graph-module-scope-defaults.js`. Clamps: `normalizeNodeGraphTraceDisplaySettingValueForKey` plus per-key clamps in `node-graph-module-scope-settings-controls.js:678+` and `node-graph-module-scope-normalize.js`.
- Drag: one capture listener on the popover (`node-graph-module-scope-settings-window.js:880` → `beginNodeGraphTraceDisplayFieldDrag` / `dragNodeGraphTraceDisplayField` / `endNodeGraphTraceDisplayFieldDrag` in `node-graph-module-scope-settings-field-edit.js`). It picks one of six gain paths:
  - `historyPercent`: combined/220 × 100
  - unit fields (`nodeGraphTraceDisplayUnitDragField`, ~80 keys): combined/220 (Value Line `lineLength` 480)
  - integer pixel (`dotBudget`): 1 per px
  - size (`dot1Size`, `secondarySize`, `imageSize`): control-space combined/520
  - blur (waterfall Blur, Image Burn Blur): control-space combined/640
  - **everything else**: `combined/8 × quantum`, where quantum = `nodeGraphTraceDisplayStepperQuantum(input, startValue)`.
- Steppers: `stepNodeGraphTraceDisplaySetting`, using the same quantum.
- Ctrl+click: only `[data-hue-title-stepper]` rows (Brightness→0.5, Saturation→1, hard-coded, not the real default).
- Wheel: none (correct under §21c).
- Separately, some module-owned settings panels use native `<input type=range/number>` and *already* get Ctrl+click reset, fine drag and a parameter wheel (to be removed, DS-9) through `bindNodeGraphNativeSliderModifiers(In)`: scope settings form IO host (`form-io.js:265`), UI dev helper, Harmonic Lines, Keypad, Lookahead Limiter, Softpop, Text Box, Sample Waveform. Plugin button settings (`modules/plugin/plugin-button-settings.js`) use the read-only field path.

## Inventory

Ranges are from the clamp/range helpers in `node-graph-module-scope-settings-controls.js` and defaults from `node-graph-module-scope-defaults.js`. DS-1 generates the full per-key table (all 85 meta keys × form type) with a script and checks it into this doc. The groups below cover every key by its drag path.

| Group (keys) | Range | Default | Taper | Drag gain today | Stepper | Ctrl+click | Wheel | Status |
|---|---|---|---|---|---|---|---|---|
| Sweep (Hz) `sweepHz` | 0–100 (title says 0.01–100) | 4 | power t^3.5 from 0 (`HistoryCurveExponent`) | combined/8 × **magnitude quantum** (1 at 1–10, 10 at ≥10) control units → ~8 px = whole range | same quantum | no | no | **BROKEN** |
| Sweep (c) `sweepCycles` | 0.05–100 | 4 | log | same | same | no | no | **BROKEN** |
| History (Hz) `historyHz` | 0–100 | form default | power t^3.5 | same | same | no | no | **BROKEN** |
| Cycles `historyCycles` | 0.05–100 | form default | log | same | same | no | no | **BROKEN** |
| History (s) `historySeconds`, `zoomSeconds`, Waterfall `detail` | 0–10 / 0.1–30 spectrogram / 0–3600 waterfall | per form | power (meta skew) or log | combined/8 × 0.025 → 320 px | 0.025 | no | no | OK (fixed earlier, see comment at controls.js:88) |
| History % `historyPercent` | 0–100 | per form | linear | combined/220 × 100 | 1 | no | no | OK |
| Unit fields (Bright, Ghost, Residual, Trail, Burn, paddings, shadow, slider look, Saturation, *Brightness...) | 0–1 mostly; −1–1 offsets; Contrast 0–2; Face Padding −0.5–1; Burn Amount 0–4; SinCos4 0–50/0–10 | per form | linear | combined/220 (Line Length 480) | 0.1 | no (hue rows hard-coded) | no | gain OK; ranges >1 (0–50, 0–4) are 50×/4× hotter per px than 0–1 |
| Size `dot1Size`, `secondarySize`, `imageSize` | 0–32 / 0–4 | per form | power t^3 | control combined/520 | 0.04 | no | no | OK |
| Blur (waterfall Blur, Image Burn Blur) | 0–1 | per form | power | control combined/640 | 0.03/0.025 | no | no | OK |
| Dot Budget `dotBudget` | integer | per form | linear | 1 per px | magnitude (should be 1) | no | no | quantum wrong |
| Integers `cycles`, `decimals`, `maxDigits`, `textSizePx`, `textWeight`, `bins`, `fftSize`, `lineThickness` (Hypersaw) | various | per form | linear / table (FFT) | combined/8 × magnitude quantum | magnitude (should be 1/100/8/table) | no | no | **BROKEN**, coarse and value-dependent |
| `pixelDensity`, `stampDensity` | 0–1 | per form | power (pixelDensity) / linear | pixelDensity on the size path; stampDensity unit | magnitude (should be 0.05) | no | no | stepper too coarse |
| Hue `hue`, `backgroundHue` | 0–360 | per form | linear wrap | combined/8 × magnitude (10 or 100) → 1 px can be 12°+ | magnitude (should be 1) | no | no | **BROKEN**, too hot |
| Everything else (`scale`, `padding`, `lineThickness` non-vector, text sizes...) | per clamp | per form | linear | combined/8 × magnitude quantum: gain grows ×10 each time the value passes a decade | magnitude | no | no | erratic |
| Native panels (Harmonic Lines, Keypad, Lookahead Limiter, Softpop, Text Box, Sample Waveform, scope form IO host, UI dev) | input min/max | `dataset.default` | linear | `max(48, width)` px per range, fine ×0.1/×0.01 | none (wheel 1%) | **yes** | yes, **violates §21c** | reference for Ctrl+click and fine drag; wheel removed in DS-9 |

## DS-1 probe table (before DS-2..DS-7)

Generated by `node scripts/probe_display_settings_numbers.mjs --markdown` against the pre-change build. Covers every number field each form type renders in its default state (235 rows, 50 keys). "Full sweep px" is an unmodified drag from min to max through the real drag handlers. Finding: on this HEAD the Sweep (Hz)/History (Hz) fields already used the 0.05 control quantum (≈160 px full sweep), so the "5→100 in ~5 px" symptom no longer reproduces here; the remaining hot fields are below (18 rows under 150 px).

| Form | Key | Min | Max | Default | Taper | Step | Full sweep px | Default +20 px |
|---|---|---|---|---|---|---|---|---|
| arpKeysFace | strokeBrightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| arpKeysFace | fontBrightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| basicShapeFace | lineThickness | 0.25 | 16 | 2 |  |  | 1260 | 4.5 |
| basicShapeFace | lineBrightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| basicShapeFace | dotThickness | 0.25 | 32 | 5 |  |  | 2540 | 7.5 |
| basicShapeFace | dotBrightness | 0 | 1 | 1 |  |  | 220 | 1 |
| basicShapeFace | backgroundBrightness | 0 | 1 | 0.03 |  |  | 220 | 0.1209 |
| basicShapeFace | lineBlur | 0 | 8 | 0 |  |  | 640 | 0.25 |
| basicShapeFace | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| dot | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| dot | backgroundHue | 0 | 360 | 240 |  |  | 2880 | 242.5 |
| dot | dot1Size | 0 | 1 | 0.6667 |  |  | 520 | 0.7587 |
| dot | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| dot | dot1Brightness | 0 | 1 | 1 |  |  | 220 | 1 |
| dot | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| dot | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| dot | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| dot | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| dot | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| gradientVectorscopeFace | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| gradientVectorscopeFace | historyHz | 0 | 100 | 1 |  |  | 160 | 3.8143 |
| gradientVectorscopeFace | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| gradientVectorscopeFace | backgroundHue | 0 | 360 | 240 |  |  | 2880 | 242.5 |
| gradientVectorscopeFace | dot1Size | 0 | 1 | 0.06 |  |  | 520 | 0.0795 |
| gradientVectorscopeFace | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| gradientVectorscopeFace | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| gradientVectorscopeFace | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| hypersawBurn | lineThickness | 0 | 1 | 0.01 |  |  | 80 | 0.26 |
| imageBurnFace | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| knobFace | decimals | 0 | 8 | 2 |  |  | 60 | 5 |
| knobFace | rotationDegrees | -1000000000 | 1000000000 | 270 |  |  | > 4000 (at -999500000) | 520 |
| knobFace | dialSize | 0 | 1 | 1 |  |  | 220 | 1 |
| knobFace | labelSize | 0 | 1 | 0.45 |  |  | 220 | 0.5409 |
| knobFace | valueSize | 0 | 1 | 0.45 |  |  | 220 | 0.5409 |
| knobFace | innerRadius | -1000000000 | 1000000000 | 0.7 |  |  | > 4000 (at 0) | 0.7909 |
| lcd | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| lcd | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| lcd | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| lcd | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| lcd | dot1Size | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| lcd | lineThickness | 0 | 1000000000 | 0.15 |  |  | > 4000 (at 50) | 0.4 |
| lcd | secondarySize | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| lcdDot | unlitSegments | 0 | 1 | 0.22 |  |  | 220 | 0.3109 |
| lcdDot | innerShadowDistance | 0 | 1 | 1 |  |  | 220 | 1 |
| lcdDot | innerShadowSharpness | 0 | 1 | 0.732 |  |  | 220 | 0.8229 |
| lcdDot | innerShadowOffsetX | -1 | 1 | 0 |  |  | 440 | 0.0909 |
| lcdDot | innerShadowOffsetY | -1 | 1 | 0.135 |  |  | 440 | 0.2259 |
| lcdDot | backgroundBrightness | 0 | 1 | 0.88 |  |  | 220 | 0.9709 |
| lcdDot | dot1Brightness | 0 | 1 | 0.18 |  |  | 220 | 0.2709 |
| lcdDot | dot1Size | 0 | 1 | 0.72 |  |  | 520 | 0.8167 |
| lcdDot | lineThickness | 0 | 1 | 0.12 |  |  | 80 | 0.37 |
| lcdDot | shapeParam | 0 | 1 | 0.5 |  |  | 80 | 0.75 |
| led | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| led | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| led | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| led | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| led | dot1Size | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| led | lineThickness | 0 | 1000000000 | 0.15 |  |  | > 4000 (at 50) | 0.4 |
| led | secondarySize | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| lineBurn | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| lineBurn | sweepHz | 0 | 100 | 4 |  |  | 160 | 10.3905 |
| lineBurn | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| lineBurn | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| lineBurn | dot1Size | 0 | 1 | 0.02 |  |  | 520 | 0.0298 |
| lineBurn | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| lineBurn | dot1Brightness | 0 | 1 | 1 |  |  | 220 | 1 |
| lineBurn | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| lineBurn | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| lineBurn | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| lineBurn | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| lineBurn | dotBudget | 1 | 8192 | 2048 |  |  | > 4000 (at 4001) | 2068 |
| lineBurn | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| momentaryButtonFace | textBrightness | 0 | 1 | 0.82 |  |  | 220 | 0.9109 |
| momentaryButtonFace | buttonBrightness | 0 | 1 | 0.22 |  |  | 220 | 0.3109 |
| momentaryButtonFace | buttonStrokeBrightness | 0 | 1 | 0.38 |  |  | 220 | 0.4709 |
| momentaryButtonFace | hoverBrightness | 0 | 1 | 0.42 |  |  | 220 | 0.5109 |
| momentaryButtonFace | onBrightness | 0 | 1 | 0.48 |  |  | 220 | 0.5709 |
| numberReadout | digits | 1 | 12 | 8 |  |  | 84 | 11 |
| numberReadout | decimals | 0 | 8 | 2 |  |  | 60 | 5 |
| numberReadout | facePadding | -0.5 | 1 | 0.1 |  |  | 330 | 0.1909 |
| numberReadout | dot1Brightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| numberReadout | dot1Saturation | 0 | 1 | 1 |  |  | 220 | 1 |
| numberReadout | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| numberReadout | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| numberReadout | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| numberReadout | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| oscilloscopeBankBurn | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| oscilloscopeBankBurn | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| oscilloscopeBankBurn | dot1Size | 0 | 1 | 0.02 |  |  | 520 | 0.0298 |
| oscilloscopeBankBurn | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| oscilloscopeBankBurn | dot1Brightness | 0 | 1 | 1 |  |  | 220 | 1 |
| oscilloscopeBankBurn | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| oscilloscopeBankBurn | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| oscilloscopeBankBurn | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| oscilloscopeBankBurn | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| oscilloscopeBankBurn | dotBudget | 1 | 8192 | 2048 |  |  | > 4000 (at 4001) | 2068 |
| oscilloscopeBankBurn | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| output | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| output | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| output | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| output | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| output | dot1Size | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| output | lineThickness | 0 | 1000000000 | 0.15 |  |  | > 4000 (at 50) | 0.4 |
| output | secondarySize | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| phosphorLight | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| phosphorLight | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| phosphorLight | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| phosphorLight | dot1Size | 0 | 1 | 0.02 |  |  | 520 | 0.0298 |
| phosphorLight | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| phosphorLight | dot1Brightness | 0 | 1 | 1 |  |  | 220 | 1 |
| phosphorLight | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| phosphorLight | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| phosphorLight | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| phosphorLight | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| phosphorLight | dotBudget | 1 | 8192 | 2048 |  |  | > 4000 (at 4001) | 2068 |
| phosphorLight | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| pulseDot | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| pulseDot | dot1Brightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| pulseDot | dot1Size | 0 | 1 | 0.85 |  |  | 520 | 0.9578 |
| pulseDot | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| pulseDot | shapeParam | 0 | 1 | 0.5 |  |  | 80 | 0.75 |
| rasterRgbFace | edgeSpacing | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| rasterRgbFace | cornerRadius | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| roundShapeFace | lineThickness | 0.25 | 16 | 2 |  |  | 1260 | 4.5 |
| roundShapeFace | lineBrightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| roundShapeFace | dotThickness | 0.25 | 32 | 5 |  |  | 2540 | 7.5 |
| roundShapeFace | dotBrightness | 0 | 1 | 1 |  |  | 220 | 1 |
| roundShapeFace | backgroundBrightness | 0 | 1 | 0.03 |  |  | 220 | 0.1209 |
| roundShapeFace | lineBlur | 0 | 8 | 0 |  |  | 640 | 0.25 |
| roundShapeFace | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| scope2d | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| scope2d | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| scope2d | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| scope2d | dot1Size | 0 | 1 | 0.02 |  |  | 520 | 0.0298 |
| scope2d | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| scope2d | dot1Brightness | 0 | 1 | 1 |  |  | 220 | 1 |
| scope2d | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| scope2d | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| scope2d | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| scope2d | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| scope2d | dotBudget | 1 | 8192 | 2048 |  |  | > 4000 (at 4001) | 2068 |
| scope2d | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| scope2dTrace | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| scope2dTrace | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| scope2dTrace | backgroundHue | 0 | 360 | 240 |  |  | 2880 | 242.5 |
| scope2dTrace | dot1Size | 0 | 1 | 0.02 |  |  | 520 | 0.0298 |
| scope2dTrace | dot1Brightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| scope2dTrace | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| softwaveOscFace | lineThickness | 0.25 | 16 | 3 |  |  | 1260 | 5.5 |
| softwaveOscFace | lineBrightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| softwaveOscFace | backgroundBrightness | 0 | 1 | 0.03 |  |  | 220 | 0.1209 |
| softwaveOscFace | dotThickness | 0.25 | 32 | 5 |  |  | 2540 | 7.5 |
| toggleButtonFace | textBrightness | 0 | 1 | 0.82 |  |  | 220 | 0.9109 |
| toggleButtonFace | buttonBrightness | 0 | 1 | 0.22 |  |  | 220 | 0.3109 |
| toggleButtonFace | buttonStrokeBrightness | 0 | 1 | 0.38 |  |  | 220 | 0.4709 |
| toggleButtonFace | hoverBrightness | 0 | 1 | 0.42 |  |  | 220 | 0.5109 |
| toggleButtonFace | onBrightness | 0 | 1 | 0.48 |  |  | 220 | 0.5709 |
| trace | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| trace | historyHz | 0 | 100 | 4 |  |  | 160 | 10.3905 |
| trace | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| trace | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| trace | dot1Size | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| trace | lineThickness | 0 | 1 | 0.15 |  |  | 640 | 0.1781 |
| trace | stampDensity | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| trace | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| traceRgb | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| traceRgb | historyHz | 0 | 100 | 4 |  |  | 160 | 10.3905 |
| traceRgb | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| traceRgb | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| traceRgb | dot1Size | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| traceRgb | lineThickness | 0 | 1000000000 | 0.15 |  |  | > 4000 (at 1) | 0.1781 |
| traceRgb | stampDensity | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| traceRgb | dot1Brightness | 0 | 1 | 0.95 |  |  | 220 | 1 |
| traceRgb | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| traceXyz | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| traceXyz | historyHz | 0 | 100 | 4 |  |  | 160 | 10.3905 |
| traceXyz | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| traceXyz | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| traceXyz | dot1Size | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| traceXyz | lineThickness | 0 | 1000000000 | 0.15 |  |  | > 4000 (at 1) | 0.1781 |
| traceXyz | stampDensity | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| traceXyz | dotBudget | 1 | 8192 | 1024 |  |  | > 4000 (at 4001) | 1044 |
| traceXyz | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| traceXyz | fade | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| value | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| value | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| value | backgroundHue | 0 | 360 | 240 |  |  | 2880 | 242.5 |
| value | dot1Size | 0 | 1 | 0.04 |  |  | 520 | 0.0551 |
| value | lineThickness | 0 | 1000000000 | 0.18 |  |  | > 4000 (at 1) | 0.2116 |
| value | dot1Brightness | 0 | 1 | 0.72 |  |  | 220 | 0.8109 |
| value | lineLength | 0 | 1 | 1 |  |  | 480 | 1 |
| value | capSize | 0 | 1 | 0.1 |  |  | 220 | 0.1909 |
| value | capLength | 0 | 1 | 0.16 |  |  | 220 | 0.2509 |
| value | capPadding | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| valueLcd | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| valueLcd | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| valueLcd | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| valueLcd | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| valueLcd | dot1Size | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| valueLcd | lineThickness | 0 | 1000000000 | 0.15 |  |  | > 4000 (at 50) | 0.4 |
| valueLcd | secondarySize | 0 | 1 | 0.035 |  |  | 520 | 0.0489 |
| vectorDot | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| vectorDot | dot1Brightness | 0 | 1 | 0.5 |  |  | 220 | 0.5909 |
| vectorDot | dot1Size | 0 | 1 | 0.85 |  |  | 520 | 0.9578 |
| vectorDot | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| vectorDot | shapeParam | 0 | 1 | 0.5 |  |  | 80 | 0.75 |
| vectorRgbFace | ghost | 0 | 1 | 0.35 |  |  | 220 | 0.4409 |
| vectorRgbFace | trail | 0 | 1 | 0.86 |  |  | 220 | 0.9509 |
| vectorRgbFace | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| vectorRgbFace | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| vectorRgbFace | dot1Brightness | 0 | 1 | 1 |  |  | 220 | 1 |
| vectorRgbFace | dot1Size | 0 | 1 | 0.08 |  |  | 520 | 0.1034 |
| videoscopeBurn | scale | 0 | 1000000000 | 1 |  |  | > 4000 (at 50) | 3.5 |
| videoscopeBurn | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| videoscopeBurn | backgroundHue | 0 | 360 | 0 |  |  | 2880 | 2.5 |
| videoscopeBurn | dot1Size | 0 | 1 | 0.02 |  |  | 520 | 0.0298 |
| videoscopeBurn | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| videoscopeBurn | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| videoscopeBurn | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| videoscopeBurn | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| videoscopeBurn | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| videoscopeBurn | dotBudget | 1 | 8192 | 2048 |  |  | > 4000 (at 4001) | 2068 |
| videoscopeBurn | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| xyPad | backgroundBrightness | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| xyPad | backgroundHue | 0 | 360 | 240 |  |  | 2880 | 242.5 |
| xyPad | dot1Size | 0 | 1 | 0.02 |  |  | 520 | 0.0298 |
| xyPad | lineThickness | 0 | 1 | 0.35 |  |  | 80 | 0.6 |
| xyPad | dot1Brightness | 0 | 1 | 1 |  |  | 220 | 1 |
| xyPad | ghost | 0 | 1 | 0.25 |  |  | 220 | 0.3409 |
| xyPad | trail | 0 | 1 | 0.3 |  |  | 220 | 0.3909 |
| xyPad | burn | 0 | 1 | 0 |  |  | 220 | 0.0909 |
| xyPad | burnAmount | 0 | 4 | 1 |  |  | 880 | 1.0909 |
| xyPad | dotBudget | 1 | 8192 | 2048 |  |  | > 4000 (at 4001) | 2068 |
| xyPad | pixelDensity | 0 | 1 | 1 |  |  | 220 | 1 |
| xyPad | puckSize | 0.005 | 0.25 | 0.045 |  |  | 20 | 0.25 |

## Broken controls and causes

1. **Dead special-case quanta (root cause of Sweep/Cycles).** `nodeGraphTraceDisplayStepperQuantum` keys its special cases on `input.dataset.waterfallField`. Live Display Settings rows only set `data-trace-display-field`, and `waterfallField` is set only in Plugin button settings. So the branches for `sweepHz`/`sweepCycles`/`historyHz`/`historyCycles` (0.05), `cycles`/`decimals`/`maxDigits`/`textSizePx`/`dotBudget` (1), `textWeight` (100), `bins` (8), `fftSize`, `pixelDensity`/`stampDensity` (0.05) and `hue`/`backgroundHue` (1) never run. Only History was patched (controls.js:88-99), by also reading `traceDisplayField`.
2. **Magnitude quantum applied in control space.** Sweep/Cycles then get `nodeGraphMagnitudeStepperQuantum(value)` = 1 at value 5. The drag adds `combined/8 × 1` to a 0–1 *control* value, so 8 px covers the whole taper. From 5 Hz (t≈0.43 on the t^3.5 map) to 100 Hz is ≈4.6 px. That's the "5 to 100 in a few pixels" bug. One − or + click is also a full-range jump.
3. **Quantum frozen at drag start and value-dependent.** For linear "everything else" keys the gain depends on the starting value's decade, so the same gesture feels 10× different at 9 vs 10.
4. **Sweep (Hz) range mismatch.** The title says 0.01–100 but the clamp allows 0 (0 = collapsed burn). The power taper from 0 puts 0–1 Hz in the first 40% of travel. A log taper can't hold 0, see Q2.
5. **No Ctrl+click reset** on any read-only field. The hue-row special case hard-codes 0.5/1 instead of the real default.
6. Native panels change parameters with the wheel, which breaks the wheel-is-zoom-only rule (§21c). Read-only fields correctly have none.
7. **Unit ranges wider than 1** (SinCos4 0–50, Burn Amount 0–4, Contrast 0–2) use the 0–1 gain (220 px per unit), so they're 2–50× hotter than other fields.

## Proposed shared behavior

One function computes the control mapping per key and one drag law applies it:

- **Field spec** (extends `nodeGraphDisplaySettingsFieldMeta` entries, single source): `min`, `max`, `taper` (`linear` | `log` | `power` with exponent | `table`), `step` (stepper quantum in *control* units or value units for integers), `integer`, `wrap` (hue). `default` stays in `node-graph-module-scope-defaults.js` (read through `nodeGraphDisplaySettingsDefaultValue`). Form-specific ranges stay as small overrides keyed by form type (the existing `HistoryControlRange` / `UnitDragRange` logic moves into the spec).
- **Mapping:** value ↔ control 0–1 through the taper. Reuse the existing `nodeGraphTraceDisplaySecondsToControlValue` / `ControlToSecondsValue` and the size maps. Rename them to neutral names (`nodeGraphDisplaySettingsValueToControl` / `ControlToValue`) with **no aliases**, and update callers.
- **Drag:** `controlDelta = nodeGraphPointerDragTravelDelta(startX, startY, x, y, DISPLAY_SETTINGS_TRAVEL_PX, nodeGraphNumericDragMultiplier(event))`, the same helper module sliders use. One travel constant for every field (proposed 220 px per full control range, the current unit-field feel). Fields that need a longer throw get it from the taper, not a private px constant. Integers round after mapping. Hue wraps.
- **Steppers:** one −/+ click = spec `step` in control units (integers: 1 value unit; FFT: table).
- **No wheel:** the wheel never changes a display setting (APP_POLICY §21c). Wheel over the panel does whatever it does elsewhere (zoom or scroll the panel).
- **Ctrl/Cmd+click (no Shift/Alt):** set `nodeGraphDisplaySettingsDefaultValue(key)` and commit as one undo step (`applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true })`). This replaces the hue-row hard-code.
- **Alt+click:** ignored (no jump), plain drag.
- Delete afterwards: `nodeGraphMagnitudeStepperQuantum` (if no other caller), the six gain branches, `nodeGraphTraceDisplayUnitDragPixels` / `SizeDragPixels` / `BlurDragPixels`, `IntegerPixelDragField`, the `waterfallField` key lookups, and the hue-row Ctrl special case.
- App rules: no dim fill on any slider look, full-word labels (e.g. "Sweep (cycles)" not "Sweep (c)", see Q4), and pixel travel measured in screen px at zoom 1.0 (Display Settings is a screen-space popover; gain must not scale with canvas zoom).

## Milestones

| ID | Milestone | Status |
|---|---|---|
| DS-1 | Inventory script `scripts/probe_display_settings_numbers.mjs`: for every form type × meta key, dump range, default, taper, step, drag path, and px for a full sweep. Paste the table into this doc. | todo |
| DS-2 | Add `min/max/taper/step/integer/wrap` to the field spec, moving range logic from the HistoryControlRange / UnitDragRange / SensitiveControlMax / clamp helpers into it. No behavior change except fixing dead `waterfallField` branches. | todo |
| DS-3 | Single drag law via `nodeGraphPointerDragTravelDelta` + `nodeGraphNumericDragMultiplier`. Delete the six gain branches and px constants. Sweep (Hz)/Sweep (c)/History (Hz)/Cycles get log (or power, see Q2) taper with a full sweep ≈220 px. | todo |
| DS-4 | −/+ steppers on the spec `step`. Delete `nodeGraphMagnitudeStepperQuantum` if unused. | todo |
| DS-5 | Ctrl/Cmd+click reset to real default (one undo step). Remove the hue-row hard-code. Alt+click = plain drag. | todo |
| DS-6 | Native-panel parity: confirm `bindNodeGraphNativeSliderModifiers` panels match DS-3 travel (Q5) and share the same Ctrl+click code path. Remove any duplicate. | todo |
| DS-7 | Label pass (full words: "Sweep (c)" becomes "Sweep (cycles)", "Cycles" becomes "History (cycles)", per Q4) + smoke script `scripts/smoke_display_settings_numbers.mjs`. Update `docs/APP_POLICY.md` with the Display Settings modifier table. | todo |
| DS-9 | Remove every parameter wheel handler (APP_POLICY §21c), deleting the code. (1) The `wheel` listener and `nudge` helper in `bindNodeGraphNativeSliderModifiers` (`node-graph-slider-dragging.js` ~874). That one listener is the wheel for all native-range panels: Keypad, Text Box settings, Softpop, Harmonic Lines, Lookahead Limiter, Sample Waveform, the UI dev helper and the scope settings form IO host. (2) Stale comments saying "drag/wheel/arrows" (`node-graph-uidev-event-bindings.js:217`, `node-graph-sample-waveform.js:1174`, the modifier comment block above `bindNodeGraphNativeSliderModifiers`). Keep the zoom and scroll wheels listed in the wheel inventory. | todo |
| DS-8 | Settings order (APP_POLICY §21b): the sweep/history pair near the top, colors after everything else (image slots may follow colors). Done only through `nodeGraphDisplaySettingsSharedStackOrder` and the per-display field lists in `nodeGraphTraceDisplaySectionControls`, plus one builder rule that pushes every color, including gradient selectors, last. No per-display branches. Fixes V1-V5 below and removes the dead code listed there. | todo |

## Smoke tests

1. Sweep (Hz) at 5: dragging +20 px moves it a modest amount (not to 100). The full 0→100 sweep takes ≈220 px. Same for Sweep (cycles), History (Hz), Cycles.
2. With Shift held, the same drag covers 1/10 of the change. With Shift+Ctrl, 1/100. Pressing or releasing Shift mid-drag doesn't jump.
3. Ctrl+click on every field type (unit, size, blur, Hz, cycles, integer, hue, FFT) sets the form's default. One Undo restores the previous value.
4. Alt+click doesn't jump. Alt+drag acts like a plain drag.
5. The wheel over any Display Settings field or native-range panel (Keypad, Text Box, Softpop, Harmonic Lines, Lookahead Limiter, Sample Waveform, UI dev helper) changes no value. `rg 'addEventListener\("wheel"' public` lists only the zoom and scroll handlers in the inventory.
6. − and + step by the spec step. FFT walks the size table. Integers stay integers.
7. Hue wraps 359→0. A 1 px drag is ≤ 2°.
8. Gain is the same at canvas zoom 0.5, 1.0 and 2.0.
9. Double-click still opens text edit, and typed values clamp to range.
10. Native panels (Keypad, Text Box, Softpop...) unchanged or matched per Q5.
11. DS-1 probe: no field covers its full range in < 150 px unmodified.
12. DS-8 order probe: open Display Settings on every display type, in both Sync on and off where present. Within the first 3 numeric rows (after any Sync toggle and Scale), find the sweep or history row if the display has one. Confirm no stepper, choice, toggle or button comes after the first color widget, and that only an image slot may.

## Wheel handler inventory (DS-9)

These are all the `addEventListener("wheel")` calls in `public/`, from `rg`:

| Handler | What it does | Verdict |
|---|---|---|
| `node-graph-slider-dragging.js:874` (`bindNodeGraphNativeSliderModifiers`) | Steps a parameter value. Covers Keypad, Text Box settings, Softpop, Harmonic Lines, Lookahead Limiter, Sample Waveform, the UI dev helper and the scope settings form IO host. | **Remove (DS-9)**. It's the only parameter wheel found. |
| `node-graph-workspace-zoom.js` `handleNodeGraphWorkspaceWheel` | Workspace zoom | keep |
| `node-graph-sample-waveform.js` Shift+wheel | Waveform view zoom (also updates the saved Time Window) | keep (zoom). See Q8. |
| `modules/textBox/text-box-widget.js:509` / `text-box-host.js:104` | Passes the wheel to workspace zoom, except while editing text | keep |
| `node-graph-magnifier.js` (capture) / `resizeNodeGraphMagnifierByWheel` | Resizes the magnifier lens | keep (view tool, not a parameter). See Q9. |
| `modules/audioPlayer/audio-player-playlist.js:2385` | Scrolls the playlist one slot | keep (scroll, not a parameter). See Q9. |
| `node-graph-workspace-event-bindings.js:20` / `node-graph-workspace-view.js` | Page scroll guard / scrollport scrolling | keep |

## Settings order: current violations (DS-8)

Found by reading the code statically (`node-graph-module-scope-settings-form.js`, `node-graph-module-scope-trace-controls.js`, `modules/imageBurn/image-burn-display.js`). The DS-8 probe confirms them at runtime per display.

| # | Where | Violation |
|---|---|---|
| V1 | Generic builder `buildNodeGraphDisplaySettingsBodyHtml`, `waterfall` section of `nodeGraphTraceDisplaySectionControls` (~trace-controls.js:1056) | `sweepHz` is 11th in the field list, after decimals, maxDigits, residual, rotation and the dial/label/value sizes. |
| V2 | Same section | `zoomSeconds` / `historySeconds` / `detail` (History) sit after ~20 fields, below Ghost, Trail, Burn, padding and inner shadow. |
| V3 | Same builder, structurally | Each section emits choices, then toggles, then fields, and the `dot1` section is built before the `waterfall` section. Any display built this way puts every choice, toggle and dot setting ahead of the sweep/history pair. |
| V4 | Scan Grid (`rasterRgbFace`) | The Clear packing row is appended after the colors section. |
| V5 | Image Burn (`buildNodeGraphImageBurnDisplaySettingsBodyHtml`) | The PLATE Background hue-title color sits above the Clear button. The image slot sitting first is allowed. |
| (possible) | Value LED (`numberReadout`) | The Ghost Gradient selector goes inside the `waterfall` section rows. If a later section has non-color rows, they land after it. Check in the probe. |

Compliant today: the Phosphor builder (1D Phosphor, 1D Trace, 2D: Sync, then Scale, then Sweep; colors, then gradient last) and the Instant Trace/Waterfall builder (History second after Scale; colors, then gradient last).

Dead code to remove in DS-8 (§10b): `nodeGraphDisplaySettingsPushBackgroundHueRow` (no callers) and the `inkHueTitle = false` branch in the Instant Trace builder.

**Count: 5 confirmed violations (V1-V5) and 1 possible.**

## Open questions (proposed defaults)

- **Q1. Resolved (Argi, 2026-10-19, accepted default):** Travel for a full control range: **220 px** for all fields (current unit-field feel). Alternative: the width of the field row.
- **Q2. Resolved (Argi, 2026-10-19):** Sweep (Hz) / History (Hz) at 0 means pause. Keep 0 as the bottom detent with log 0.01–100 above it (the first ~4 px = 0).
- **Q3. Resolved (Argi, 2026-10-19, accepted default):** Cycles min: **0.05** as today, log to 100.
- **Q4. Resolved (Argi, 2026-10-19):** rename "Sweep (c)" to **"Sweep (cycles)"** and "Cycles" to **"History (cycles)"**. Sweep (Hz) and History (Hz) stay unchanged. No "Number of Cycles". Sweep (cycles) sets how many input cycles fit in one left-to-right pass (1D Phosphor, 1D Trace). History (cycles) sets how many input cycles of trail stay drawn (Gradient Vectorscope).

All open questions are resolved.
- **Q5. Resolved (Argi, 2026-10-19, accepted default):** Native range panels use `max(48, width)` px travel. **Switch them to the same 220 px** so every settings number feels the same.
- **Q6. Resolved (Argi, 2026-10-19):** no wheel on Display Settings. The wheel only zooms and never changes a parameter anywhere (APP_POLICY §21c, DS-9).
- **Q8.** Sample Waveform Shift+wheel zoom also writes the saved Time Window (s) setting. **Keep it**: it's a view zoom that happens to be saved, not a parameter knob.
- **Q9.** Magnifier resize and playlist scrolling use the wheel for view and scroll, not zoom. **Keep both**, since neither changes a parameter. The rule bans parameter changes, not scrolling.
- **Q7. Resolved (Argi, 2026-10-19, accepted default):** Shift on the −/+ steppers: **fine ×0.1** (matches drag), not ×10 like the module keyboard step.
