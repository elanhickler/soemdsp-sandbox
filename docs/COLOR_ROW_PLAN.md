# Color row plan (color widgets in rows of 2 to 4)

**Source:** Argi, 2026-10-18: "we need to get all color widgets as 2 to 4 horizontally spaced app wide, so for example, keypad display settings would be violating this policy, RoundShape display settings would be following the policy."
**Status:** implemented 2026-10-18 (CR-1..CR-7). Policy text: `docs/APP_POLICY.md` §21. Open questions used the suggested answers (single-color half-width, delete LED rim, Legacy Display one row, spectrogram exempt, add Knob Text, leave numeric HSL sliders).
**Audience:** an agent working outside this environment. Everything you need is in this file; line numbers are from the working tree on 2026-10-18 and may drift by a few lines.

## Policy

Every color widget in a settings surface sits in a **horizontal row of 2, 3 or 4 color widgets**. Colors are never stacked one per line, and a row never holds 5 or more.

- **Color widget** means any control whose job is to pick a color: the shared Sound Color Widget host (`data-trace-display-color-widget`), the hue-title (HBS) stepper (`data-hbs-widget`), the RoundShape HSL lamp (`data-hsl-lamp`), and plain `<input type="color">`.
- Applies app-wide: Display Settings bodies for every face, Command Center pages, the UIDEV helper, the UI Settings page, and any floating window with colors.
- Group by meaning first (fill / stroke / text, or inactive / active / hover), then balance the rows: 5 = 3 + 2, 6 = 3 + 3, 7 = 4 + 3, 8 = 4 + 4, 9 = 3 + 3 + 3, 10 = 4 + 3 + 3, 12 = 4 + 4 + 4. Never leave a row of 1 behind.
- Colors that belong together but are built in different sections (for example Background in one section and Line in another) are merged into one row.
- A panel with exactly **one** color is the open edge case; see "Edge cases" and open question 1.
- Non-color controls (sliders, steppers, image rows) do not go inside a color row. They sit above or below it.

**Reference (compliant): RoundShape display settings** (`roundShapeFace`, the Ellipsoid module). `public/node-graph-module-scope-settings-form.js` L2308-2321 builds three HSL lamps (Line, Dot, Background) as cells, and L2330-2332 wraps them with the shared row helper `nodeGraphDisplaySettingsHbsRow(cells)` (L425-431), which emits `<div class="node-trace-display-hbs-row">`. One row of 3.

**Example (violating): Keypad display settings** (`keypadFace`). `public/modules/keypad/keypad-settings.js` L110-118 calls `nodeGraphDisplaySettingsBuildColorRowHtml` six times in a row with no row wrapper (and an image row wedged between Background and Button), so six full-width colors stack vertically.

## Repo read (2026-10-18)

### The shared pieces that exist today

- **Color cell builder:** `nodeGraphDisplaySettingsBuildColorRowHtml(key, formType, options)` in `public/node-graph-module-scope-settings-form.js` L1684-1701. Despite the name it builds **one cell** (`.node-trace-display-color-widget-row`), not a row. Label / aria / id come from `nodeGraphDisplaySettingsColorRowMeta` (L535-650).
- **Hue-title (HBS) cell:** `nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml(options)` L382-423 (`.node-trace-display-hbs-widget`, a brightness stepper whose title drags the hue). Also one cell.
- **Row wrapper:** `nodeGraphDisplaySettingsHbsRow(cells)` L425-431. This is the helper RoundShape, Knob, Number Readout, the Dot family and mono Instant Waterfall already use.
- **Row CSS:** `public/styles.css` L6949-6961. `.node-trace-display-hbs-row` is a grid with a **fixed** `repeat(3, minmax(0, 1fr))`. So 2 cells leave an empty third column, 4 cells wrap to 3 + 1, and 7 cells wrap to 3 + 3 + 1. The row needs to size its columns from its cell count (CR-1).
- **Widget mount:** `public/color-widget.js` (`SoundColorWidget`, `mountColorWidget` L1154), booted by `public/color-widget-boot.js`, mounted into every `[data-trace-display-color-widget]` host by `public/node-graph-module-scope-settings-form-io.js` (~L2497-2530). Moving a host into a row does not change how it mounts.
- **Plain color inputs:** the UIDEV helper and Legacy Display window in `public/index.html` and `public/perform.html` use raw `<input type="color">` inside `label.node-ui-dev-color-control` (CSS `public/styles.css` ~L12430-12470); the UI Settings page mirrors them through `createNodeUserUiSettingsMirrorControl` (`public/node-graph-user-ui-settings-controls.js` L36-60, section render L336-349, definitions `public/node-graph-ui-settings-definitions.js` L120-205).

### How the inventory was made

Every Display Settings form type was rendered headless (all classic scripts from `index.html` loaded in a Node `vm` context, `buildNodeGraphDisplaySettingsBodyHtml(formType, node)` called per form type and per stereo / XYZ variant), and the HTML was parsed for color cells and their enclosing `.node-trace-display-hbs-row`. HTML pages were read directly. CR-6 turns this harness into the enforcing smoke test.

## Inventory

Counts: **36 color surfaces.** 10 compliant, 16 violating (must convert: 10 Display Settings faces, 6 window groups), 9 single-color (8 Display Settings faces plus the Command Center LED rim color; edge case, Argi decides), 1 exempt. Plus 3 dead-code spots to delete. Raw `<input type="color">` count: 28 in `index.html`, 28 in `perform.html`.

### Compliant (no change except CR-1 column sizing)

| Surface | Form type / file | Row(s) |
|---|---|---|
| RoundShape (Ellipsoid) | `roundShapeFace`, settings-form L2308-2332 | Line · Dot · Background |
| Basic Shape | `basicShapeFace`, same lines | Line · Dot · Background |
| Softwave Oscillator | `softwaveOscFace`, same lines | Line · Background |
| Knob | `knobFace`, generic section loop L2327-2332 | Background · Arc fill · Arc track |
| Number Readout (Helmholtz Pitch, Simulation Time, Value LED/LCD) | `numberReadout`, L2224-2263 + L2331 | Background · LED/Foreground (hue-title) |
| Vector Dot / Clock / Dot Oscilloscope | `vectorDot`, L2265-2296 + L2331 | BG · Dot (hue-title) |
| Pulse Dot | `pulseDot`, same | BG · Dot (hue-title) |
| LCD Dot | `lcdDot`, same | Background · Foreground (hue-title) |
| Instant Waterfall, mono | `waterfall` (plain node), L1627-1632 | Background · In · Stroke |
| Instant Waterfall, stereo (Output and stereo trace modules) | `waterfall` (stereo node), L1619-1626 | Five cells in one `HbsRow` call; renders 3 + 2 only because the grid wraps at 3. Compliant by accident: make the split explicit in CR-3 (Background · Left · Right / Left stroke · Right stroke) so CR-1's count-based columns don't turn it into a row of 5. |

### Violating (checklist)

Display Settings faces:

- [x] **Keypad** (`keypadFace`) — `public/modules/keypad/keypad-settings.js` L110-118. 6 colors stacked (Background, Button, Hover, Down, Text, Stroke), Background image row between Background and Button. Proposed: Background · Button · Stroke / Text · Hover · Down; Background image row right below the two rows.
- [x] **Toggle Button** (`toggleButtonFace`) — `public/modules/plugin/plugin-button-settings.js` L132, L144. 6 stacked. Proposed: Background · Stroke · Text / Inactive · Active · Hover.
- [x] **Momentary Button** (`momentaryButtonFace`) — same file and lines. Same proposal.
- [x] **Plugin Slider** (`pluginSliderFace`) — `public/modules/slider/slider-face.js` L108, L117. 5 stacked (Background, Slider, Track, Text, Number). Proposed: Background · Slider · Track / Text · Number.
- [x] **Text Box / Animated Text Box** (`textBoxFace`) — `public/modules/textBox/text-box-settings.js` L60-62, L155-156. 2 stacked. Proposed: Background · Text.
- [x] **Arp / Gravity Walker keys** (`arpKeysFace`) — `public/modules/arp/arp-settings.js` L193-199 (7 hue-title cells), L231-233 (`slice(0,3)`, `slice(3,6)`, `slice(6)`). Renders 3 + 3 + **1**. Proposed: Inactive fill · Active fill · Inactive text · Active text / Stroke · Font · Previously activated.
- [x] **Patch face** (`patchFace`) — generic section loop, settings-form L2327-2332: Background lands in the `waterfall` section row and the Dot color in the `dot1` section row, so two rows of 1. Proposed: one row Background · Dot.
- [x] **Spectrum 1D** (`spectrumLine`) — same cause and lines. Proposed: one row Background · Line.
- [x] **RGB Waterfall** (`waterfallRgb`) — Instant Trace body: Stroke alone at L1518-1519, Background in the leftover row L1645-1665. Two rows of 1. Proposed: Background · Stroke.
- [x] **XYZ Waterfall** (`waterfallXyz`) — same lines. Proposed: Background · Stroke.
- [x] **Instant Waterfall, stereo** — L1619-1626, make the 3 + 2 split explicit (counted as compliant above; tracked here so CR-3 does it).

Command Center and other windows:

- [x] **UIDEV helper, workspace and module colors** — `public/index.html` L1100 (workspace background), L1276 (grid), L1281 (module fill), L1299 (module title fill), L1304 (module stroke), L1309 (selected module stroke); `public/perform.html` L1096, L1272, L1277, L1295, L1300, L1305. Stacked one per line, interleaved with the two alpha sliders. Proposed: Workspace background · Grid / Module fill · Module title fill · Module stroke · Selected module stroke; Module fill alpha and Selected stroke alpha sliders below the row.
- [x] **UIDEV helper, jack colors (12)** — `index.html` L1353-1408, `perform.html` L1349-1404. Proposed: RGB red · RGB green · RGB blue · Analog / Digital · Gold · Parameter · Graph / Modulation · Voices · Purple · Magenta.
- [x] **UIDEV helper, slider text colors (3)** — `index.html` L1428-1438, `perform.html` L1424-1434. Proposed: Slider label · Slider value · Slider unit.
- [x] **UIDEV helper, bypass colors (4)** — `index.html` L1679-1694, `perform.html` L1675-1690. Proposed: Bypass icon glow · Bypass icon on · Bypass on background · Bypass off background.
- [x] **UI Settings page (User tab)** — `public/node-graph-user-ui-settings-controls.js` L36-60 builds one `label.node-user-ui-setting-control.color` per exposed color and L336-349 appends them stacked. Group consecutive color definitions of a section into rows using the same grouping as the UIDEV helper (the section ids come from `nodeUiDevSettingSections`).
- [x] **Legacy Display window** ("LEGACY DISPLAY / internal controls") — `index.html` L2518 (dot color, inside the Dot row) and L2538 (display background, its own block); `perform.html` L2512, L2532. Two colors in separate blocks. Proposed: one row Dot · Background, or delete the window (open question 3).

### Single color (edge case, decision needed)

- [x] **Lookahead Limiter gain face** (`limiterGainFace`) — `public/modules/lookaheadLimiter/lookahead-limiter-display.js` L47-48, L70. Background only, full width, no row.
- [x] **Vector RGB** (`vectorRgbFace`, phosphor body) — settings-form L1782-1784: each phosphor color is pushed as its own full-width row.
- [x] **Video Feedback** (`videoFeedbackFace`) — `public/modules/videoFeedback/video-feedback-display.js` L41-47. Spectrum color only, full width.
- [x] **Scan Grid / Raster RGB** (`rasterRgbFace`) — generic loop L2327-2332, Background in a row of 1.
- [x] **RGB Fractal** (`rgbFractalFace`) — same, Background in a row of 1.
- [x] **Evolve Field** (`evolveFieldFace`) — same, Background in a row of 1.
- [x] **Image Burn** (`imageBurnFace`) — `public/modules/imageBurn/image-burn-display.js` L645-660, one Background hue-title cell in a row of 1.
- [x] **T-series value faces** (`value`, 22 modules t, t2…) — Instant Trace leftover row L1645-1665 ends up with Dot color alone (Background is filtered out). Check whether Background should be shown here; if yes it becomes Background · Dot (compliant).
- [x] **Command Center LED rim color** — `index.html` L2140, `perform.html` L2134, logic `public/node-graph-context-menu.js` L2168-2178 (its own title calls it a "legacy swatch. Prefer Display Settings"). Proposed: delete it (Display Settings owns LED color; no legacy shims). See open question 2.

### Exempt

- **Spectrogram gradient editor stop color** — `public/modules/spectrogram/spectrogram-gradient-editor.js` L936. A gradient stop editor picks the color of the selected stop; it is one picker for a strip, not a list of colors. Proposed exempt (open question 4).

### Dead code found while reading (delete in CR-7, no shims)

- `public/node-graph-module-scope-settings-form.js` L2350-2378: the stereo-waterfall color section and the `type === "value"` color row in the generic body are unreachable, because both `waterfall` and `value` are Instant Trace form types and return at L1934-1937.
- `public/node-graph-module-scope-trace-controls.js` L798: `knobFace` lists `textColor` as active, but no section carries it, so the Knob form never shows a Text color. Either add it to the Knob row (Background · Arc fill · Arc track · Text, a row of 4) or drop it from the active list. Ask Argi (open question 5).
- `public/node-graph-context-menu.js` ~L1209-1220: looks up `nodeSceneKeypadButtonColor` / `nodeSceneKeypadTextColor` and other `nodeSceneKeypad*` ids that no longer exist in `index.html` (`#nodeSceneKeypadControls` is an empty div). Remove the dead lookups.

## Milestones

| ID | Work | Done when | Status |
|---|---|---|---|
| CR-1 | **Shared color row helper.** In `node-graph-module-scope-settings-form.js` add `nodeGraphDisplaySettingsColorRows(cells, groups?)`: takes color cells (any of the four kinds) and optional explicit groups, returns one or more `.node-trace-display-hbs-row` elements of 2 to 4 cells each, balanced per the Policy table, and throws in debug builds if a group has 1 or 5+ cells. Keep `nodeGraphDisplaySettingsHbsRow` as the single-row primitive the helper calls (no second row class). Change the CSS at `styles.css` L6949 so columns come from the cell count (for example `grid-template-columns: repeat(var(--color-row-cells), minmax(0, 1fr))`, with the helper setting `--color-row-cells` 2 to 4), so 2-cell rows fill the width. Add a plain-DOM twin for HTML pages: a `.node-color-row` class on a wrapper div (same 2 to 4 column grid) for `label.node-ui-dev-color-control` cells. This is app JS / CSS, not `library/include/soemdsp`, so it does not need the library gate. | Helper and CSS exist; RoundShape, Knob, Number Readout and the Dot family look the same or better at zoom 1.0; no other change. | Done |
| CR-2 | **Display Settings batch A (module-owned bodies):** Keypad, Toggle Button, Momentary Button, Plugin Slider, Text Box, Arp keys. Each body passes its cells through CR-1 with the groups in the checklist. Keypad's Background image row moves below the color rows. | Checklist items ticked; each panel opened at zoom 1.0 shows rows of 2 to 4. | Done |
| CR-3 | **Display Settings batch B (shared form):** Patch face, Spectrum 1D, RGB Waterfall, XYZ Waterfall, stereo Instant Waterfall. In the generic section loop, collect color cells across sections into one list and emit them once through CR-1 at the end of the color-bearing sections, instead of one `HbsRow` per section. In the Instant Trace body, put Stroke into the same row as Background. | Same as CR-2. | Done |
| CR-4 | **Single-color panels:** apply Argi's answer to open question 1 to the 8 single-color Display Settings faces (or record them as allowed exceptions in the smoke test's allowlist with the reason). | All 8 handled one way, no ad hoc layouts. | Done (proposal A: half-width) |
| CR-5 | **Command Center, UIDEV helper, UI Settings, Legacy Display.** Wrap the UIDEV color labels in `.node-color-row` groups in both `index.html` and `perform.html` (keep the two files identical); group the UI Settings mirror's consecutive color controls per section into rows; fix Legacy Display per open question 3; LED rim color per open question 2. While touching the UIDEV labels, use full words (for example "module stroke rgba" becomes "Module stroke"). | Checklist items ticked; both HTML files match. | Done |
| CR-6 | **Smoke test enforcing the rule.** `scripts/smoke_color_rows.cjs`: load the classic scripts from `public/index.html` in a Node `vm` context with minimal DOM stubs, render `buildNodeGraphDisplaySettingsBodyHtml` for every form type in `nodeGraphTraceDisplayActiveControlsForType` plus the custom bodies (and the stereo / XYZ node variants), and assert every color cell (`[data-trace-display-color-row]`, `[data-hbs-widget]`, `[data-hsl-lamp]`, bare `[data-trace-display-color-widget]`) sits in a row with 2 to 4 color cells. Statically parse `index.html` and `perform.html`: every `input[type=color]` must sit in a `.node-color-row` with 2 to 4 color inputs. A small explicit allowlist covers single-color exceptions approved under CR-4 and the gradient editor. Register it in `scripts/smoke_test.py` as `check_color_rows` (same pattern as `check_mini_perform_view` calling `smoke_mini_perform_unit.cjs`, ~L18283). | Smoke fails on today's tree (proves it catches Keypad) and passes after CR-2..CR-5. | Done (`scripts/smoke_color_rows.cjs`) |
| CR-7 | **Cleanup:** delete the dead code listed above; resolve Knob `textColor` per open question 5. | Dead blocks gone; smoke still green. | Done (Knob Text kept in the collected color row) |

Order: CR-1 first; CR-6 can be written right after CR-1 (it fails until the batches land); CR-2, CR-3, CR-5 in any order; CR-4 after Argi answers; CR-7 last.

## Edge cases and proposals

- **1 color.** Proposal A (preferred): a lone color is allowed only when the panel truly has one color, and it renders as one cell at the width of a 2-cell row cell (half width), never stretched full width, so it looks like the other panels. Proposal B: always pair it with a second color the face could use (for example a Stroke or Text color) only where the face actually draws one; never invent a fake color. Proposal C: treat 1 color as a violation and require a partner cell (for example the related brightness hue-title). Argi decides (open question 1).
- **5 or more colors.** Split by meaning, then balance: 5 = 3 + 2, 6 = 3 + 3, 7 = 4 + 3, 8 = 4 + 4, 12 = 4 + 4 + 4. No row of 1, no row of 5+.
- **Colors split across sections.** Merge into one row (Patch face, Spectrum 1D, RGB / XYZ Waterfall).
- **Mixed cells.** Hue-title HBS steppers, HSL lamps and plain color cells all count as color widgets and can share a row (Number Readout already mixes Background and LED hue-title cells).
- **Numeric color triples** (UIDEV slider fill hue / saturation / lightness / alpha, slider handle hue / brightness / alpha, Snake select hue / brightness / alpha in `node-graph-ui-settings-definitions.js` L180-196) are number sliders, not color widgets, so the rule does not cover them as written (open question 6).
- **perform.html** carries a copy of the UIDEV helper and Legacy Display markup; every HTML change lands in both files.
- **Zoom.** Lay rows out and check them at zoom 1.0 (the source of truth). Display Settings windows are DOM chrome and do not follow the workspace camera.

## Rules for the implementing agent

- Zoom 1.0 is the source of truth for layout checks.
- Labels use full words (Background, Stroke, Foreground; never "BG", "rgba").
- No legacy shims: no old-layout fallback, no dual helpers, no "if row helper missing then stack" branches beyond the existing `typeof` guard pattern. Delete what you replace.
- Do not edit `library/include/soemdsp` or the shared maths without Argi's OK (this plan should not need to).
- Displays stay WebGL2 only; this plan only touches DOM settings chrome.
- Do not change saved settings keys; this is layout only, so patches and UI settings files are untouched.
- Do not push without Argi's OK. Commit locally per milestone if asked; otherwise leave changes uncommitted and report.
- Code and docs never link to `github.com/soundemote`.

## Open questions for Argi

1. **Single-color panels (8 Display Settings faces):** allowed as a half-width single cell (A), must pair with a real second color (B), or always a violation (C)? Suggested: A.
2. **Command Center LED rim color:** delete it (Display Settings already owns LED color and the code calls it a legacy swatch)? Suggested: delete.
3. **Legacy Display window:** put Dot · Background in one row, or delete the window? Suggested: ask whoever still uses it; default to one row.
4. **Spectrogram gradient stop color:** exempt? Suggested: yes.
5. **Knob Text color:** Knob lists `textColor` but never shows it. Add it (Background · Arc fill · Arc track · Text) or drop it? Suggested: add.
6. **Numeric hue / saturation / lightness slider groups in UIDEV:** leave as sliders, or turn each group into a real color widget (which would then fall under this rule)? Suggested: leave for now.
