# Module rails plan (hybrid Spawn IO layout): implementation status

Source plan: Badger / Librarian "Ping Pong Delay Interface Plan" (2026-10-20), copied below unchanged after this status section.

## Landed (2026-10-20)

- **PP-0 defaults** (Argi: "implement the plan" = take each proposed default). Every tunable is one constant in `public/node-graph-module-rails.js`:
  - Q25 rail width: `NODE_GRAPH_RAIL_WIDTH_PX = 40` (zoom 1.0; CSS `--node-rail-width`).
  - Q5 short label rule: `NODE_GRAPH_RAIL_SHORT_LABEL_CHARS = 4`, keeping ` L` / ` R`; an explicit param `shortName` wins.
  - Q27 rails-only placement: inputs on the left rail, outputs on the right rail, top-aligned under the title bar (reuses InletOutletLayout chrome); height = longer side.
  - Q28 layout choice: `definition.faceLayout` (`"spawn"` | `"railsOnly"`), else `railsOnly` when the module has ports and neither visible params nor a display (`displayType`, `displayModes`, `layout`, `customDisplayArea`), else `spawn`. Declared fields only, never names. `"sideRails"` (Layout 2) is reserved and not built.
  - Q7 mod depth: today's param MOD amount path is unchanged (no per-cable amount control added).
  - Q8 heavy custom faces: unchanged bodies; they get the same param-band rails where they have generic param rows.
  - Q11 no reveal during a drag: the mod rail opens only after a cable lands.
  - Q12 / Q13 / Q14 / Q15: recorded as the plan's defaults; not built yet (see Not yet built).
- **PP-1 inventory**: `scripts/inventory_module_faces.mjs` -> `docs/module_faces_inventory.json` (359 definitions: 346 spawn, 13 railsOnly; 139 with a whole-face `layout` kind; 82 with a custom folder).
  railsOnly: b2u, buttonEvents, comparator, hostBpm, inv, minMax, ringMod, shootingStarTail, u2b, windowReopen, wireBreak, wireConnect, wireDisconnect.
- **PP-2 / PP-3b Layout 1 param band** on the existing generic param rows: `[mod rail | params | thru rail]`.
  - Thru rail always shows (40 px), one short-label thru tag per param; no option.
  - Mod rail opens on the module's first param cable and closes on the last unplug; inlet tag (short label) only on patched params; many cables share one inlet.
  - "Mod rail" button in the module menu = `ui.modRailAlwaysOn` (off by default, saved with the patch).
  - Module width, display and IO band never move; the params shrink between the rails.
- **PP-3 drop rule**: a cable from an output dropped anywhere on a param control lands on that param's mod inlet; from an input, on its thru. Works in GL graph mode (module boxes are found by rect, the DOM sits under the GL canvas).
- **Layout 3**: rails-only modules render title bar + input rail | output rail with short labels.
- **No hover text**: the module `title` tooltip (store description) is removed.
- Ping Pong Delay: explicit `shortName`s for the LFO / filter params (Styl, Rate, Amp, Vary, LPF, HPF).
- Smoke: `scripts/smoke_module_rails.mjs` (all checks pass headless).
- **Face row `span`** (Start / Center / End, 2026-10-22): kind `span` { lo, mid, hi } in `node-graph-module-face.js` (row kinds are listed in its header). Values on top, bar below; a press grabs the nearest handle, so it works by finger. An edge moves its end and pushes Center along; Center moves all three. First used by Pulse Explosion (with a `band` for Low / High Amplitude). Face releases record one undo step for every row kind. Smoke: `scripts/smoke_module_face_span.mjs`.

## Not yet built

- PP-1b widget groups (`hero`, `vsliders(N)`, `tempo`, `segmented`, `waveformPicker`, `band`, `seed`, `number`), Layer 1/2/3 face lists, rail anchors per group.
- PP-4 `fullFace` gate, PP-5 Ping Pong hand-written `face`, PP-6 migrator, PP-7 switch/deleting the old renderer, PP-10 canvas display sizing, PP-L layout regression probe.
- The other planned smokes (`smoke_face_layers`, `smoke_widget_groups`, `smoke_all_faces`, `smoke_canvas_display_size`, `probe_layout_regression`).

---

# Ping Pong Delay Interface Plan (wiring-style module faces)

Status: plan only (2026-10-19, Argi via Librarian). No code changed. Not committed. Not pushed.

## Goal

Redesign the Ping Pong Delay module face in the sandbox around the **wiring experiments** in soundemote-dev, as the first of a new way of building module interfaces. Every module moves to the new system at once (decided, see Options).

Ground rules (APP_POLICY, `argi-wt/docs/APP_POLICY.md`): the wheel only zooms; displays are WebGL2 + shaders (§3); port labels are `<name> L` / `<name> R`, jack order M / L / R (§13); workspace zoom 1.0 is the only size truth; sliders have no dim fill; unused code is deleted, no shims, no dual keys or migration layers (§1, §10b); no input jacks that duplicate parameters (§17).

## Where the work happens (Argi, 2026-10-20)

All implementation work happens directly in Argi's local repos under his `_PROGRAMMING` folder on his own computer, including soundemote-dev and the sandbox. No PRs. Nothing is cloned onto the box. The box paths in this doc (`/workspace/argi-wt`) are reference copies used for the research only.

## Where things live

- **soundemote-dev** = GitHub `elanhickler/soundemote-dev` (private, main @ `0b7e15b`). The wiring experiment is **not on the box**: `/workspace/sedev`, `sedev-mirror`, `sedev-archiv` are older copies with no `wiring/` or `condensed-widgets/` folder (and are not git repos). Read via GitHub.
  - `public/experiments/wiring/index.html`, `page.js` (~470 lines), `style.css` — route `/interface/wiring`, section Interface.
  - `public/experiments/condensed-widgets/` — the Ping Pong face chrome it builds on ("sandbox vs condensed vs C5"); classes `c2 c3 c5 c6`.
  - `public/experiments/README.md` describes both.
- **Sandbox** = `/workspace/argi-wt` (repo `soundemote/soemdsp-sandbox`, branch `argi-ds`, HEAD `5f5a81ed`). `/workspace/soemdsp-sandbox` is the same repo, older checkout (last commit 2026-09-17).

## What the wiring experiment does (the new direction)

A two-module mock patch: an **LFO** (source) on the left with three output rows (Amount, Rate, Smooth), each with an out-port button at the row's right edge, and a **condensed Ping Pong Delay** face on the right: title bar, full-width display strip (`node-waterfall`, 40 px), then a row of compact param cells (Amp, Hz, Vary, plus a long-name test). Each cell is a box with a vertical fill bar (`.vf`) showing value. Cables are SVG cubic beziers. (The experiment colors cables and cells per source param; that is **not** adopted, see Q6.)

Two subtabs, two answers to "where does a param inlet live":

1. **Gutter** (`#w-pane-gutter`, saved two-module patcher). The destination has a permanent narrow **gutter** on its left edge (`.c6-gutter`). Drag an LFO output and drop it **on a param cell**; the cable ends in the gutter, never crossing the face. The gutter grows an inlet tag (first 4 letters of the param name) at the cell's vertical position. Many cables can share one inlet. Click a cable (hit test within 10 px) to unplug that one; drag an inlet tag to pull its cable off. Hover dims unrelated cables to 15% and thickens the hot one. A status line narrates (`Patched LFO Rate → Ping Pong Hz (2 into Hz)`). (The experiment's "coral cable into blue cell" mis-patch tell is **not** adopted: a wrong-param patch is never signaled by color.)
2. **Spawn IO** (`#w-pane-spawn`). Module width never changes and the display stays full width. Nothing is there until you patch: dropping a cable on a slider spawns a **param band below the display** (`.w-param-band`) with an inlet gutter on the left (`.c6-gutter-in`) and a **thru** gutter on the right (`.c6-gutter-out`); sliders shrink inward to make room. Thru is the same param post-widget, so it can be chained; dragging a thru rubber-bands a new cable (mocked). Unplugging the last cable removes the band. (In this plan the experiment's gutters are called **rails**: mod rail on the left, thru rail on the right.)

### Chosen layout: hybrid, three layouts (Argi, 2026-10-20)

This replaces the 2026-10-19 "Gutter design" choice. There are three layouts. Every module uses exactly one; which one comes from the module definition (`faceLayout`), not from a name search.

#### Layout 1 (default): Spawn IO with rails under the display

Taken from the experiment's **Spawn IO** subtab (`wiring/index.html` `#w-pane-spawn`, `page.js` `spawnIo()` ~l.259-480, `style.css` l.40-46):
- **Order, top to bottom:**
  - **IO band above the display, exactly as today** (sandbox audio and CV ports, unchanged; ports do **not** move onto rails).
  - Title bar.
  - **Full-width display** (`c2-hero`).
  - **Param band** (`.w-param-band`).
- **Module width never changes.** The experiment's module is a fixed 224 px.
- **Param band at rest:** two columns, **params | thru rail**. The thru rail always shows (Q26), so the params always give up one rail width. The experiment's single full-width column at rest is not used.
- **Param band with rails:** three columns, **mod rail | params | thru rail** (`40px minmax(0,1fr) 40px` in the experiment; our rail width is set at zoom 1.0, see Q25). The **parameter section shrinks inward** to make room. The display above stays full width.
- **Rails sit under the display only.** They span the param band's height, never the title bar, IO band or display.
- **Mod rail (left) holds param inlets only.**
  - Each tag is aligned to its param's row, or stacked inside a vertical group's span (`gutterSlot`, `page.js` ~l.300-314).
  - Many cables can share one inlet.
  - Drop a cable **on the param control itself**; the inlet spawns in the mod rail.
  - Unplug by clicking a cable or dragging its inlet tag away.
  - The **mod rail** collapses when the last cable is unplugged (the experiment shows "Last cable gone — gutters collapsed"). The thru rail stays.
- **Thru rail (right) holds thru tags only:** the same param after modulation, dragged out to chain. It **always shows** on Layout 1 modules that have params, with no option (Argi, 2026-10-20; Q26). A module with no params has no param band, so there's no thru rail.
- **"Mod rail always on"** (off by default, saved with the patch) keeps the mod-rail column present even with nothing patched.
- **Drop target during a drag:** the param control itself. The rail spawns after the drop, so there's no drag-reveal (Q11).

#### Layout 2 (reserved, not default): full-height side rails

The 2026-10-19 Gutter design is kept on file for modules that may want it later. No module uses it at launch, and nothing is built for it until one does (§10b: no unused code).
- Mod rail on the left and thru rail on the right, each running the **full module height**.
- Showing a rail widens the module by one rail width, and the face is unchanged.
- The same param-inlet, thru and short-label rules apply. How its thru rail shows would be decided when a module first uses Layout 2.

#### Layout 3: rails only (IO-only modules, no params)

For modules with ports and **no params**, such as **Comparator** (`comparator`, `node-graph-module-definitions.js:6734`: input `In`; outputs `Up, Down, Change, Steady, Sign, Thru`; `parameters: []`). 51 definitions have `parameters: []`; PP-1 lists which of them have no display either.
- **Title bar plus rails only**, with no face and no display.
- Inputs sit on the left rail and outputs on the right rail, in M / L / R order (§13), with short labels (Q27).

#### Rules for all layouts

- **Short names only.** Every inlet, thru tag and rail port shows one static short label: an explicit `shortName` from the definition (for example `"SC L"`), else the shared rule (first 4 characters, keeping ` L` / ` R`).
  - Port naming rules hold: `<name> L` / `<name> R`, and the TV emoji for video ports.
- **No hover text, no tooltips, no pop-ups or pop-outs**, no clutter (APP POLICY; phones).
- **Choices:** single click on inline buttons (6 or fewer); above 6, drag-to-scrub only. No arrows, nothing opens.
- **Colors:** wires and IO use §13 jack colors only. Nothing is signaled by color.
- The cable highlight dims unrelated cables by opacity and width only; on touch it triggers on press.
- **Sizes:** all sizes are set at workspace zoom 1.0. The wheel only zooms. Sliders have no dim fill. Drawing is WebGL2.

So the interaction model is: **params are the patch points** (drop on the control itself), rails spawn under the display on demand, cables stay outside the face, and IO stays where it is.

## Widget groups

A face is built from **widget groups**: reusable layout blocks declared as data in the module definition. This is the core of the update. Custom displays are not the subject.

### What exists today (inventory)

**Sandbox (`/workspace/argi-wt`): there is no group concept.**
- `parameters[]` is a flat list. The generic face renders one horizontal slider row per param (`public/node-graph-module-rendering.js`).
- Choice params (195 `displayChoices: true`) render as a divided choice slider (`public/node-graph-slider-readout.js:25-157`).
- `control: "number"` gives a number field (13 uses).
- A module-level `layout` string picks a whole special face, not a block. There are 36 kinds. The main ones are `scopeFace` (23), `filterCurve` (23), `envelopeCurve` (7) and `sliderWidget` (4); `sliderWidget` is handled in `node-graph-module-rendering.js:475,959` and `node-graph-module-sizing.js:275,484,1641`. Most of the rest are one-offs (keyboard, sequencer, chordPad...).
- Tempo: there is no tempo widget. `timeNumerator` / `timeDenominator` / `timingMode` are three separate rows in `transport`, `pingPongDelay` and `soemReverb` (`node-graph-module-definitions.js`, ~6468 for transport). Tap tempo lives in the header (`node-graph-module-header-rendering.js:9,344`).

**soundemote-dev `condensed-widgets/page.js` (main @ `0b7e15b`)** has two hand-written Ping Pong faces:
- **Condensed** (`condensedHtml`, ~l.198): `.pp-sec` sections, each with a label.
  - Mode: segmented control (`segs`).
  - Meter: Numer `/` Denom plus N·T divisions plus Offset mini-slider (`.pp-frac`).
  - LFO: style segs, an LFO preview and a Vary mini-slider.
  - Band: HPF/LPF range handles (`.pp-band`).
  - Mix: a pair (`.pp-2`) plus Mix.
  - Seed: value, dice, +/−, plus Amplitude.
- **Condensed 5** (`condensed5Html`, ~l.235):
  - `c2-hero`: title bar plus scope.
  - `c2-modes`: segmented Off / L↔R / LMR.
  - `c2-time`: n / n plus Normal / Dotted / Triplet plus an Offset cell. **This is the tempo group.**
  - `c2-lfo`: style picker whose buttons carry preview canvases, plus `c2-lfo-row`, three vertical-fill cells (Amp, Hz, Vary). **This is a vertical slider group, N = 3.**
  - `c5-filt`: HPF/LPF band over a response curve with Hz ticks.
  - `c2-pair` ×2: Feedback | Saturate and Mix | Amplitude. **These are vertical groups, N = 2.**
  - `c2-seed`: value, dice, +, −.
  - Cells are built by `cell()` (`.c2-cell`, `.vf` vertical fill, `.k` label, `.v` value). The optional `c6-jack` is a per-cell mod jack, which the mod rail replaces.
- **`wiring/`** reuses the C5 blocks (`c2-hero`, `c2-lfo-row`, `c2-pair`) inside `.c6-shell`.

### Group catalog (proposed)

| Group | Params | Origin |
|---|---|---|
| `hero` | title bar plus the module's display, full width | C5 `c2-hero` |
| `hslider` | 1 param, today's horizontal slider row (unchanged) | sandbox generic row |
| `vsliders(N)` | N params side by side, vertical-fill cells, any N ≥ 2 | C5 `c2-lfo-row` (3), `c2-pair` (2) |
| `tempo` | numerator, denominator, division (Normal / Dotted / Triplet), optional extra cell (for example Offset) | C5 `c2-time`; transport, Ping Pong, soemReverb params |
| `segmented` | 1 text choice param: inline buttons up to the shared choice threshold, otherwise a compact scrub control showing the current choice, dragging across it scrubs through all choices in one motion like a slider (app drag law, Shift = fine, Ctrl/Cmd+click = reset to default). No arrows, and nothing opens (no popover, list or grid), and the wheel never changes it (Q18) | C5 `c2-modes`; sandbox choice slider |
| `waveformPicker` | 1 choice param, inline buttons with WebGL waveform previews up to 6 choices, otherwise the same compact scrub control showing the current preview (Q17) | C5 `c2-lfo-styles` |
| `band` | 2 params (low / high) as a range over a response curve | C5 `c5-filt`, Condensed `.pp-band` |
| `seed` | 1 seed param: value, dice, +, − | C5 `c2-seed` |
| `number` | 1 number field | sandbox `control: "number"` |

The whole-face `layout` kinds (`scopeFace`, `filterCurve`, `envelopeCurve`, keyboards...) become either a group (for example `curve`) or stay as a single full-face group. Each gets a `fullFace` group before the switch (PP-4).

### Declaring a face

The definition gets one ordered `face` list. Params are referenced by key, so `parameters[]` stays the single source for ranges and defaults. Ping Pong would be:

```js
face: [
  { group: "hero" },
  { group: "segmented", param: "pingPong" },
  { group: "tempo", params: ["timeNumerator", "timeDenominator", "timingMode"], extra: "offset" },
  { group: "waveformPicker", param: "lfoStyle" },
  { group: "vsliders", params: ["lfoAmp", "lfoRate", "lfoVariation"] },
  { group: "band", params: ["hpfFrequency", "lpfFrequency"] },
  { group: "vsliders", params: ["feedback", "saturate"] },
  { group: "vsliders", params: ["mix", "amplitude"] },
  { group: "seed", param: "seed" },
]
```

(Param keys are the real ones from `node-graph-module-definitions.js:13741`. The hidden `interpolation` param is omitted.)

- A module **without** `face` gets the Layer 1 auto face (see Layered face design). That's a visible starting point, not a hidden translation.
- Hidden params are omitted from `face`.
- Every visible param appears exactly once. The smoke test enforces this.

### Layered face design (Argi, 2026-10-19)

The module definitions are the single source of truth for every layer.

1. **Layer 1, auto face (fallback and starting point only).** Shared rules build a face from `parameters[]`:
   - The display goes into `hero`.
   - Choice params with ≤ 6 choices become `segmented` buttons; with more, the compact scrub control (drag to scrub only). Choices with waveform previews use `waveformPicker` under the same rule.
   - Numeric params become `hslider`, and `control: "number"` params become `number`.
   - A param with `kind: "seed"` becomes `seed`. That uses the param's declared kind, not its name.
   - **Layer 1 never searches param keys or labels (Argi, 2026-10-19).** It only reads declared fields: choice count, `control`, `kind`, `hidden`. Groups like `tempo` and the LFO trio are **hand-declared** in a module's `face` list (Layer 2).
   - Hidden params are skipped. Order follows `parameters[]`.
2. **Layer 2, explicit face.** The definition's `face` list says which groups, in what order, with which params. When present it replaces Layer 1 entirely.
3. **Layer 3, overrides.** Per group and per choice, inside the `face` entry:
   - `choiceStyle: "buttons" | "scrub"`, which forces the style regardless of the 6 cutoff.
   - Per-choice `labels`, `icons`, or waveform `previews`.
   - `perRow` (buttons per row).
   - `label` (group label).

Example: `{ group: "segmented", param: "pingPong", choiceStyle: "buttons", perRow: 3, labels: ["Off", "L↔R", "LMR"] }`.

Ping Pong gets a **hand-written** `face` list at the switch. Every other module starts on the Layer 1 auto face and gets its hand-written list later, one module at a time. Layer 1 is the fallback and where an author starts.

### Hand-declared groups and candidate modules

Tempo and the LFO trio are hand-rolled: each module that has them declares the group in its hand-written `face` list. No rule searches names. Until a module gets its hand-written face, its auto face shows those params as ordinary rows.

- **`tempo`** (Numer / Denom, plus the Normal / Dotted / Triplet division when present). These modules have the params:
  - **Transport** (`transport`): `timeNumerator`, `timeDenominator`, `timingMode`.
  - **Ping Pong Delay** (`pingPongDelay`): the same three, plus `offset` as the extra cell.
  - **soemReverb** (`soemReverb`): the same three.
  - Not tempo: `clockDivider`, `triggerDivider` and `timeQuantizer` have a `division` param that is a subdivision count.
- **LFO trio, `vsliders(3)`.** The trio is the three LFO params that usually appear together: **amplitude, rate (also called speed or frequency), variation**, in that order (for example `lfoAmp`, `lfoRate`, `lfoVariation`). Resolved in Q20.
  - **Ping Pong Delay**: `lfoAmp`, `lfoRate`, `lfoVariation`.
  - **soemReverb**: `lfoAmp`, `lfoFrequency`, `lfoVariation`.
  - **Cinematic Reverb** (`reverbEffect`): `lfoAmplitude`, `lfoBaseSpeed`, `lfoVariation`.
  - **Sabrina Reverb** (`sabrinaReverbOriginal`): the same keys as Cinematic Reverb.

### Mod rail alignment

- Each group reports its patchable params with a **rail anchor**: a y position in module space at zoom 1.0.
  - `hslider`, `segmented`, `number`, `seed`, `waveformPicker`: one anchor at the row's vertical center.
  - `tempo`: one anchor per param, side by side on one row (see Q13).
  - `band`: two anchors, low and high.
- **Vertical groups (`vsliders(N)`):** the N cells share one row, so their inlets stack on the rail **inside that group's vertical span**, in left-to-right order (cell 1 at the top). The span is divided evenly into N slots. This is what `gutterSlot` already does in `wiring/page.js:90`.
- Dropping a cable still targets the param cell itself; the rail tag is only where the cable lands. The thru rail uses the same anchors.

### Scaling

- Every group defines its size at workspace zoom 1.0: fixed height per group type, with width taken from the module's face width.
- `vsliders(N)` splits the width evenly.
- The whole face scales uniformly with workspace zoom. Groups never compute sizes from screen pixels or the DPR.
- Group visuals (fills, previews, band curve) draw with WebGL2 through `gl-line-renderer.js`. Sliders have no dim fill, and the wheel only zooms.

## Canvas display sizing (Argi, 2026-10-20)

**Rule.** In Canvas view, a **display's** size comes from its canvas tile only. The module's size in the circuit workspace (`ui.displayHeightGu`, the face's zoom-1 box, its aspect) has no say.
- A display made 1 grid tall in the workspace must **fill** its canvas tile when expanded, not keep its slim height or aspect.
- This partly supersedes "canvas tiles uniformly scale the zoom-1.0 workspace layout": workspace zoom 1.0 still governs module faces **in the workspace**, and **whole-module** canvas tiles (`ui.canvasWholeModule`) still scale the zoom-1 module uniformly (Q22). Display sizing in canvas is independent of the workspace.

### Where canvas display size depends on the workspace today (`/workspace/argi-wt`)

1. **Mini Performance View, display tiles.**
   - `public/node-graph-gl-mini-perform.js:58-69`: `nodeGraphGlMiniPerformDisplays` reads each display canvas's **workspace layout box** (`nodeGraphModuleLayoutBox(c, el)`).
   - `:370-390`: the bounding box of those workspace rects is contain-fitted into the tile with `nodeGraphContainFitBox` (`public/node-graph-canvas-fit.js:30`).
   - So a 1-grid-tall display keeps its slim aspect and is letterboxed in the tile. **This is the reported bug.**
2. **Classic F solo "contain" fit.**
   - `public/node-graph-screen-solo.js:1049-1060`: `sourceWidth`/`sourceHeight` are captured from the face's workspace box (`sourceBox` / `clientWidth`/`clientHeight`), with a square override for SinCos4 faces.
   - `:540-562`: in `fit === "contain"` the cell size is `min(cellW/srcW, cellH/srcH)` of that source and is written to `--node-screen-solo-item-w/h`, which `styles.css:13398-13403` applies.
   - Same coupling: the workspace aspect decides the canvas size. `modules/sineWavetable/sine-wavetable-display.js:215-216` also reads those vars.
3. **Layout canvas (freeform F stage) display faces.** `public/node-graph-layout-canvas.js:472-479`, CSS `styles.css:13284-13290` (`inset: 0; width/height: 100%`): display faces already **fill** the tile.
   - However, `nodeGraphTextBoxCaptureCanvasScaleSource` (`modules/textBox/text-box-widget.js:724`, called at `layout-canvas.js:477`, "B-071 … source-min") captures workspace plate metrics as the scale source. That's text-box only, so verify it stays put.
   - `styles.css:13412-13419` (SinCos4 / filter-curve "short module-band height") is a per-face workaround for the same coupling.
4. **Whole-module tiles (unchanged by this rule).** `node-graph-canvas-fit.js:18-27` (`nodeGraphWholeModuleFitBox`) and `node-graph-screen-solo.js:860` (`nodeGraphScreenSoloWholeModuleFit`) scale the zoom-1 module uniformly. That's correct for whole modules.

### Target

- A display tile gives the display its tile's CSS box (minus the shared padding, if any). The display redraws at that size through `nodeGraphDisplayCanvasSize` (APP_POLICY §15: display size redraws, zoom pixelates).
- No workspace rect, `displayHeightGu` or source aspect is read.
- Faces that need a fixed aspect (round/SinCos4 unit-square faces) declare it on the display itself (`aspect: 1`) and are contain-fitted to the **tile**, not to the workspace box (Q23).
- Delete the `sourceWidth`/`sourceHeight` capture, the `--node-screen-solo-item-w/h` contain path, the mini-perform display bounding-box fit, and the SinCos4 CSS workaround once nothing reads them (§10b).

## Layout breakage (Argi's concern)

Approach approved as written (Argi, 2026-10-20).

Two changes can move things in saved work: the face switch (PP-7), and canvas display sizing (PP-10). The plan:

1. **Inventory what's saved.** Per patch: `ui.displayHeightGu`, `ui.showInCanvas`, `ui.canvasWholeModule`, canvas tile rects (`normalizeCanvasTileRect`), module positions, and face/IO visibility flags (`ui.*Hidden` etc., see `node-graph-patch-clone.js:839`). Sources are the 99 `patches/**/*.json`, 2 `saved-patches/`, plus the other sources in `docs/PATCH_MIGRATION_PURGE_PLAN.md`.
2. **Before/after screenshot probe** (`scripts/probe_layout_regression.mjs`):
   - Load every stored patch on the current build and capture the workspace at zoom 1.0, the Canvas view and the Mini Performance View.
   - Repeat on the new build, then diff the two. Results go into a per-patch report (pass / moved / broken), with thumbnails for Argi to review.
   - Run it before PP-7 and before PP-10, and again after.
3. **One-shot migrator** (§1; it runs over all stored patches and is deleted in the same change):
   - Canvas tile rects are kept as is. They're stage fractions, so they're unaffected.
   - `displayHeightGu` stays as the workspace face height; it simply stops influencing canvas.
   - Modules whose workspace footprint changes under the new faces (rails, groups) are re-spaced so they don't overlap, keeping their top-left positions and order.
   - Any rename of `ui` keys is applied once.
4. **What can't be preserved** (listed in the probe report per patch):
   - Displays that relied on the slim workspace aspect looking letterboxed in canvas now fill the tile. That's intended, and may look different.
   - Exact workspace module heights and widths change where the new face (rails, groups, auto face) is taller or shorter than the old one.
   - Hand-tuned overlaps or alignments between neighboring modules in the workspace.
   - Any patches outside the repos (browser localStorage, exported files) aren't migrated (§1).

## How module interfaces work today (sandbox)

- 294 module definitions in one table, `public/node-graph-module-definitions.js` (18,863 lines). Each entry is data: `planRole`, `displayType`/`displayModes`, `inputs`/`outputs` + `*Labels`/`*Aliases`, `parameters[]` (key, label, min/max/mid/step, default, `choices`, `control: "number"`, `hidden`, `nonlinearSlider`, smoothing, `tooltip`; the existing `tooltip` field is not shown by the new face).
- Catalog/metadata in `public/node-graph-module-store.js` (category, description, notes, source links); native DSP list in `public/native-modules-catalog.json` (179 native entries; 180 folders under `native_modules/`).
- Shared generic face: `public/node-graph-module-rendering.js` (1,682 lines) builds header, param rows, sliders, ports for every definition; ports/wires in `node-graph-port-geometry.js`, `node-graph-wires.js`, `node-graph-wire-rendering.js`, `node-graph-wire-actions.js`; jack colors in `node-graph-jack-chrome.js`; sliders in `node-graph-slider-values.js` / `node-graph-slider-dragging.js`.
- Per-module code is the exception: 91 folders in `public/modules/` (custom displays, evaluators, faces such as `keypad`, `slider`, `pingEnvelope`), plus `_shared/` (`controller-face-gl.js`, etc.).
- Param modulation today goes through the existing param MOD path on the generic face (not separate jacks, per §17).

### Ping Pong Delay specifically

- Definition: `node-graph-module-definitions.js:13741` (`pingPongDelay`). Inputs `Mono, Left, Right`; outputs `Mix L, Mix R, LFO L, LFO R` (LFO = gold CV). Display: Waterfall only, stereo from Mix L/R. Params include hidden `interpolation`, `pingPong` Mode (Off / Left Right / Left Middle Right), `timeNumerator`/`timeDenominator` number fields, `timingMode` (Normal/Dotted/Triplet), feedback, filter, LFO (parabol, random walk, fbm), tape, soft clip, mix/level, seed.
- Catalog: `node-graph-module-store.js:2177`, `:3698`; label at `node-graph-module-definitions.js:243`.
- DSP: `native_modules/ping_pong_delay/ping_pong_delay.cpp` (840 lines) → wasm; runtime glue in `node-live-audio-worklet-native-graph.js` / `-native-exports.js`.
- No custom face folder: it uses the generic face entirely, which is why it's a clean first target.
- Smokes: `scripts/smoke_ping_pong_param_stick.mjs`, `scripts/smoke_ping_pong_lfo.mjs` (headless DSP only).

## Options

### A. Keep both (new face opt-in per module)

- Cost: two face renderers, two port/hit-test paths, two layout rules, two cable endpoint models forever. Every UI fix (zoom, slider modifiers, DS plan work) has to land twice.
- Risk: directly against §1/§10b (dual paths, "just in case" code). Drift between the two is guaranteed; agents will patch the wrong one.
- Upside: zero risk to the ~290 other modules while the design is still unproven.

### B. All modules on the new way

- Cost: big. 294 definitions, 91 custom module folders, the whole wire/port stack. Modules with heavy custom faces (keypad, sequencers, xyPad, scopes, video) need individual decisions.
- Risk: the layout is chosen (the experiment's Gutter tab, rails in this plan) but unproven in the real app; moving everything before it's proven risks rework, which is mitigated by the PP-4 gate. Saved patches that reference port ids may break (allowed by §1; one-shot migration, then delete the migrator).
- Upside: one renderer, one interaction model, matches the app's "one key, one path" rule. Because faces are mostly data-driven, most modules move by changing the shared renderer, not per module.

### Decision: B, one switch (Argi, 2026-10-19)

The old and new renderers **never both run**. The new system lands as a single switch:
- Ping Pong Delay gets its hand-written `face` list.
- Every other module renders through the Layer 1 auto face on the new renderer, with rails.
- The old face renderer, its port and hit-test paths, and its CSS are deleted **in the same change**.

Before the switch, the new renderer runs only in smoke harnesses and dummy definitions, never in the app. After the switch, giving a module a proper hand-written `face` list is ordinary follow-up work, one module at a time. It isn't a "conversion", because every module is already on the new system.

**Regression risk and how the plan handles it.**
- 36 whole-face `layout` kinds (`scopeFace` 23, `filterCurve` 23, `envelopeCurve` 7, `sliderWidget` 4, keyboards, sequencers, chordPad, codeBox...) and the 91 custom folders in `public/modules/` can't be expressed by the Layer 1 auto rules today.
- If the switch lands before they have a working home, those modules lose their faces.
- So PP-4 below is a **gate**. Every `layout` kind gets a working `fullFace` group, or a launch group that covers it, which hosts the existing display or face code inside the new chrome (header, rails, zoom 1.0 sizes). Every custom face folder is verified on the new renderer.
- The switch (PP-7) doesn't land until the PP-4 smoke test shows every one of the 294 definitions rendering with no errors and no empty faces.
- Anything that fails blocks the switch; it isn't patched with a fallback to the old renderer.

## Milestones

| ID | What | Done when |
|---|---|---|
| PP-0 | Answer the remaining open questions. | Answers written here. |
| PP-1 | Inventory script: every definition's params, ports, `layout`, custom folder, its Layer 1 auto face, and whether that face is complete or needs `fullFace`. | JSON + table in this doc. |
| PP-1b | **Group system**: shared renderer pieces for each launch group (Q12), Layer 1 auto-face rules (choice cutoff 6; above it, the shared scrub control, with no popovers), Layer 2 `face` list reader, Layer 3 overrides, per-group rail anchors, zoom-1.0 sizes, WebGL2 visuals. Harness only. | Group smoke passes. |
| PP-2 | Shared face chrome: header, full-width display, a mod rail column under the display with 'Mod rail always on' (default off, saved with the patch), spawned on the first patch and collapsed on the last unplug, **Layout 1**: IO band unchanged above the display; param band that spawns mod/thru rail columns under the display and shrinks the params inward; fixed module width. **Layout 3**: title bar plus rails only, for IO-only modules. Short static labels (`shortName`), no hover text or tooltips. §13 jack colors only. Sizes at zoom 1.0 only; no dim fill on sliders; wheel only zooms. | Renders dummy definitions. |
| PP-3 | Wire model: a cable targets a **param** (no duplicate jack, §17); many-to-one inlets; unplug by clicking a cable or dragging an inlet; one undo step per patch or unplug. | Wire smoke passes. |
| PP-3b | Thru rail: an always-present right column in the param band under the display (no option), drag thru cables out of it; the module width doesn't change, and the params are permanently one rail width narrower. | Thru smoke passes. |
| PP-4 | **Gate: `fullFace` group** for all 36 `layout` kinds, plus every custom face folder verified in the new chrome (Layout 1), and every IO-only module on Layout 3. New group types go into the shared catalog, never into a module. | All 294 definitions render in the harness. |
| PP-5 | Ping Pong Delay's hand-written `face` list (overrides where needed). Ports stay `Mix L`/`Mix R`, `LFO L`/`LFO R`; inputs in M/L/R order; display stays Waterfall. | Argi signs off visually. |
| PP-6 | Patch format: one-shot migrator for any changed ids over all stored patches; the migrator ships with PP-7 and is deleted in that same change. | Migrator ready. |
| PP-7 | **The switch, in one change.** All modules move to the new renderer: Ping Pong with its `face` list, the rest via the auto face or `fullFace`. Delete the old face renderer, the old port and hit-test paths, and the old CSS; run and delete the migrator. | Full smoke green; `rg` finds no old-face symbols. |
| PP-10 | **Canvas display sizing**: display tiles size from the tile only (mini perform, F solo, layout canvas); delete the workspace-aspect paths listed in Canvas display sizing. Run the layout probe before and after. | Canvas smokes green; Argi reviews the probe report. |
| PP-L | **Layout safety** (runs before PP-7 and PP-10): saved-layout inventory, `probe_layout_regression.mjs` baseline, migrator mapping. | Baseline captured; report reviewed. |
| PP-8+ | Follow-up: hand-written `face` lists, one module at a time, done as needed (no fixed order, Q19), starting from its auto face and the PP-1 mapping. | Per module: Argi signs off. |

## Smoke tests

- Ping Pong DSP smokes still pass unchanged (`smoke_ping_pong_param_stick.mjs`, `smoke_ping_pong_lfo.mjs`).
- New `smoke_param_wire_face.mjs` (Layout 1):
  - Dropping on a param creates exactly one inlet in the mod rail column under the display; a second cable to the same param shares it.
  - Unplugging the last cable collapses the mod rail; the thru rail stays.
  - Module width and display width never change; only the param band's middle column shrinks or grows by the rail widths.
  - Rails never extend into the title bar, IO band or display.
  - The IO band above the display is identical to today's.
- New `smoke_thru_rail.mjs`:
  - Every Layout 1 module with params shows the thru column at rest, in the param band only, and the module width is unchanged.
  - No "Thru rail on" option exists in module options or in saved patches.
  - Dragging from a thru tag creates a cable.
- New `smoke_mod_rail.mjs`:
  - "Mod rail always on" is off by default, and the setting survives save/load.
  - With it off, an unpatched module has no mod rail column, so the params span from the left edge to the thru column.
  - With it on, the column is always present.
  - No drag-reveal: dragging a cable over the module does not change the layout.
  - Modifier keys have no effect.
- New `smoke_rail_only_layout.mjs` (Layout 3):
  - Every module with ports and no params (for example Comparator) renders as title bar plus rails, with no face.
  - Inputs are on the left and outputs on the right, in M / L / R order.
  - Labels are short, fit the rail width at zoom 1.0, follow `<name> L` / `<name> R`, and video ports carry the TV emoji.
- New `smoke_rail_labels.mjs`:
  - No rail, port, inlet or face element has a `title` attribute, a tooltip or a hover or pop-up label.
  - Every short label fits the rail width at zoom 1.0.
  - An explicit `shortName` wins over the shared rule.
- Layout 2 has no smoke test until a module uses it.
- New `smoke_canvas_display_size.mjs`:
  - A display set to 1 grid tall in the workspace, expanded in Canvas view, fills its tile. The display canvas's CSS box equals the tile box (minus padding) in Canvas view, the Mini Performance View and F solo.
  - Changing `displayHeightGu` or the workspace module size leaves the canvas display size unchanged.
  - Resizing the canvas tile resizes the display, which redraws rather than stretches.
  - Whole-module tiles still scale the zoom-1 module uniformly.
  - A display that declares `aspect: 1` is contain-fitted to the tile.
- `probe_layout_regression.mjs`: every stored patch is captured before and after; the report lists moved or broken patches and what can't be preserved.
- New `smoke_face_layers.mjs`:
  - The Layer 1 code reads no param key or label strings (a grep check on the auto-face module).
  - The auto face renders for any module without a `face` list.
  - A 6-choice param gives buttons and a 7-choice param gives the scrub control; the same holds for `waveformPicker`.
  - On a scrub control:
    - One drag from end to end passes through every choice.
    - Shift makes it fine; Ctrl/Cmd+click resets to the default.
    - No arrow or stepper buttons exist on it.
    - A click never opens anything, and no popover, list or grid element exists.
    - The wheel never changes it.
  - A `face` list replaces the auto face.
  - `choiceStyle` overrides beat the auto rule in both directions.
  - Per-choice labels, icons, previews, `perRow` and group `label` render as declared.
  - No face data exists outside the module definitions.
- New `smoke_widget_groups.mjs`:
  - Every definition's `face` (where present) references only known groups and existing param keys.
  - Every visible param appears exactly once.
  - Each group's size at zoom 1.0 matches its spec, and at zoom 2.0 is exactly double.
  - `vsliders(N)` works for N = 2, 3, 4 and 5.
  - Every patchable param has exactly one rail anchor inside its group's vertical span.
  - Vertical-group anchors are in left-to-right order.
- Cables never intersect the face rect (geometry check).
- Wheel over face/cells changes no parameter (zoom only).
- Zoom 1.0 vs 2.0: layout scales uniformly; no size computed from another source.
- `check_display_gl_contract` in `scripts/smoke_test.py` passes for any new face drawing.
- Port labels match `<name> L` / `<name> R`; jack order M / L / R.
- Cable and inlet colors come only from §13 jack chrome (no per-source or per-param color).
- After PP-7: no references to the old renderer.
- New `smoke_all_faces.mjs` (PP-4 gate, then permanent):
  - All 294 definitions render on the new renderer with no errors and no empty face.
  - Every `layout` kind resolves to `fullFace` or a launch group.
  - Every visible param is reachable and has a rail anchor.
  - Each module resolves to exactly one of Layout 1 or Layout 3 (Layout 2 unused).

## Open questions (proposed defaults)

- **Q1 Look and feel. Resolved (Argi, 2026-10-20, replaces 2026-10-19):** a hybrid with three layouts. Layout 1, the default, is Spawn IO with rails under the display and params that shrink inward. Layout 2 is the reserved full-height side rails. Layout 3 is rails only, for IO-only modules. See Chosen layout.
- **Q2 Keep both or all modules? Resolved (Argi, 2026-10-19):** all modules in one switch (PP-7); the old renderer is deleted in the same change.
- **Q3 Thru. Resolved (Argi, 2026-10-19; updated 2026-10-20):** you drag thru cables out of the thru rail, and thru carries the param's value after modulation. In Layout 1 the thru rail is the right column of the param band and **always shows** (Q26). There's no "Thru rail on" option.
- **Q4 Audio and CV ports. Resolved (Argi, 2026-10-20, replaces the earlier ports-on-rails decision):** in Layout 1, IO stays in today's band above the display, unchanged, and the rails carry only param inlets and thru. In Layout 3 (IO-only), ports sit on the rails.
- **Q5 Port and inlet labels. Resolved (Argi, 2026-10-20):** short names win. Each label is a static short label (an explicit `shortName` in the definition, else the shared first-4-characters rule keeping ` L` / ` R`). No hover text, tooltips or pop-ups.
- **Q6 Cable color. Resolved (Argi, 2026-10-19):** no color-based cues. No per-source cable coloring and no color mismatch tell; wires and IO keep the app's explicit jack colors (§13).
- **Q7 Mod depth.** The experiment has no amount control per cable. Default: reuse today's param MOD amount, shown on the inlet tag (drag it).
- **Q8 Heavy custom faces (keypad, sequencers, scopes, video).** Default: they keep their custom body inside a `fullFace` group (PP-4 gate) and adopt the shared header, rails and cable model.
- **Q9 Bring soundemote-dev onto the box? Resolved (Argi, 2026-10-20):** no. It's already on Argi's computer in his `_PROGRAMMING` folder, so nothing gets cloned onto the box.
- **Q10 Turning off the thru rail while thru cables are connected. Moot (2026-10-20):** the thru rail always shows and has no toggle (Q26).
- **Q11 Mod rail reveal during a drag.** Default (Layout 1): no reveal during a drag. You drop on the param control itself, and the mod rail column spawns after the drop, as in Spawn IO. The only thing that changes during a drag is the cable highlight.
- **Q12 Which groups exist at launch?** Default: `hero`, `hslider`, `vsliders(N)`, `tempo`, `segmented`, `waveformPicker`, `band` and `seed`; that's the set Ping Pong needs. `number` and `fullFace` are also required before the switch (auto face and PP-4 gate); other curve groups come later, as needed.
- **Q13 How a vertical group's inlets sit on the rail.** Default: stacked within the group's span inside the param band, evenly divided, in left-to-right cell order (as `gutterSlot` does in Spawn IO, `page.js` ~l.300).
- **Q14 Tempo group contents.** Default: Numer / Denom, a Normal · Dotted · Triplet division, and one optional extra cell (Offset for Ping Pong). Tap tempo stays in the header.
- **Q15 Where `face` lives.** Default: in the module definition, beside `parameters[]`. Groups reference params by key and never redefine ranges or defaults.
- **Q16 Group labels.** Resolved by Layer 3: an optional `label` per group, off unless set.
- **Q17 Lots of waveforms (unsolved, Argi).** Default:
  - Up to 6 choices: inline preview buttons.
  - Above 6: show the current waveform's preview. Dragging across the preview scrubs through all waveforms in one motion, like a slider (app drag law, Shift = fine, Ctrl/Cmd+click = reset to default). Drag-to-scrub only: no ‹ › arrows, nothing opens (no popover, list or grid), and no two-click choosing (Argi, 2026-10-20).
  - The wheel never changes it.
  - It stays one `waveformPicker` group type; the module only declares its choices.
- **Q18 Auto rule for many choices. Resolved (Argi, 2026-10-19):** a fixed cutoff of **6 choices**, using one rule and one code path for `segmented` and `waveformPicker`. Layer 3 `choiceStyle` can override it.
  - At or below the threshold: inline buttons (text for `segmented`, previews for `waveformPicker`).
  - Above it: the compact scrub control shows the current choice (text or waveform preview). Dragging across it scrubs through all choices in one motion (app drag law, Shift = fine, Ctrl/Cmd+click = reset to default). Drag-to-scrub only: no ‹ › arrows, nothing opens (no popover, list or grid), and no two-click choosing (Argi, 2026-10-20).
  - The wheel never changes it.
  - The threshold is a fixed count, not width-based.
- **Q19 Order of hand-written face lists after the switch. Resolved (Argi, 2026-10-19):** no fixed order; they're done as needed after Ping Pong.
- **Q20 What is the LFO trio? Resolved (Argi, 2026-10-20):** amplitude, rate (also called speed or frequency) and variation, the three LFO params that usually appear together (for example `lfoAmp`, `lfoRate`, `lfoVariation`). Each module hand-declares them as one `vsliders(3)`.
- **Q22 Whole-module canvas tiles. Resolved (Argi, 2026-10-20).** Decision: unchanged. They keep the uniform zoom-1 scale, because they show the module, not a display.
- **Q23 Displays that need a fixed aspect (SinCos4, round faces). Resolved (Argi, 2026-10-20).** Decision: they declare `aspect` on the display definition and are contain-fitted to the tile. Everything else fills.
- **Q24 Order of PP-10 vs the face switch. Resolved (Argi, 2026-10-20).** Decision: PP-10 lands first, as a small, independent change, so the layout probe isolates each change.
- **Q25 Rail column width at zoom 1.0 (Layout 1).** The experiment uses 40 px per side out of a 224 px module, so params lose 80 px when both rails show. Default: 40 px at zoom 1.0, sized so a 4-character short label in the 9 px mono label font fits.
- **Q26 Thru rail visibility. Resolved (Argi, 2026-10-20):** for now the thru rail **always shows** in Layout 1, with no "Thru rail on" option.
  - Knock-on: params are always one rail width (40 px at zoom 1.0, Q25) narrower, and 80 px narrower once the mod rail spawns.
  - Mod rail behavior is unchanged: it spawns on the first patch, collapses on the last unplug, and has "Mod rail always on". At rest the band is lopsided (params | thru).
- **Q27 Layout 3 port placement.** Default: inputs on the left rail and outputs on the right rail, top-aligned under the title bar, with the module height set by the longer side. The alternative is today's IO band under the title bar with no rails at all.
- **Q28 Choosing a module's layout.** Default: an explicit `faceLayout` in the definition (`"spawn"`, `"sideRails"` or `"railsOnly"`). If it's absent: `"railsOnly"` when the module has ports and neither params nor a display, otherwise `"spawn"`. This is decided by declared fields, never by name.
