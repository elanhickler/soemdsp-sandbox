# Adding a Module to the Sandbox

**Rule: DSP is C++ only.** Every sound-producing or sound-processing module
runs in the native graph engine (`native_modules/graph_engine/graph_engine.cpp`,
linked into `native_modules/combined/soemdsp_combined.wasm`). Render Sample
and Live Audio both run that same engine. There is no JS DSP: no
`*-live-evaluator.js`, no `*-worklet-evaluator.js`, no JS state Maps. JS is
interface only: definitions, param plumbing, faces, displays.

Old `public/modules/*/…-live-evaluator.js` / `…-worklet-evaluator.js` files
are vestigial. Do not copy them and do not add new ones.

## Two ways to hold the DSP

- **Inline in graph_engine** (e.g. Ellipsoid Osc): the process function and
  its state live in `graph_engine.cpp`, on the `Node`. Simplest. Use it unless
  the DSP is big or reused elsewhere.
- **Separate native module** (e.g. Basic Shape, Step Graph): its own
  `native_modules/<name>/<name>.cpp` with a `create/destroy/sample` handle
  pool, declared `extern "C"` in graph_engine and called from the process
  function. Needs a build-script entry and a catalog entry (below).

## Edit points

### C++ (`native_modules/graph_engine/graph_engine.cpp`)

1. **Type id**: `static const int kType<Name> = <next free id>;` next to the
   other `kType…` constants.
2. **Param slots**: the engine has fixed generic `Control` slots on `Node`
   (`frequency`, `amplitude`, `shape`, `width`, `center`, `mode`, `stages`,
   `waveform`, `seed`, `lfoRate`, …). Pick one slot per parameter and write
   the mapping in a comment above the process function. Add per-slot
   defaults for the new type in the default tables (grep an existing type,
   e.g. `kTypeEllipsoidOsc`, for every table it appears in).
3. **Process function**: `static void process_<name>(Circuit& g, Node& node, int frames)`.
   - Call `control_frame(g, node, f)` at the top of every sample, then read
     continuous params inside the loop (`control_audio` / `control_effective`
     after `control_frame`). Never read a continuous param once before the
     loop and use it inside: that zippers knob moves and staircases
     modulation (see `docs/PARAM_CONSUMPTION_AUDIT.md`).
   - Block reads are only for discrete choices and setup params, or behind a
     fast path guarded by `node_needs_sample_accurate_controls`.
   - Live signal inputs: `mix_live_port(g, node, kPort…, frames, g.mix…)`;
     pitch via `resolve_osc_hz`.
   - Write outputs to `node.buf[kPort…][f]`.
4. **Dispatch**: add `if (node.typeId == kType<Name>) { process_<name>(g, node, frames); … }`
   in the main per-node process switch.
5. **Separate native module only**: `extern "C"` declarations, `create` in
   the native-handle create switch, `destroy` in the destroy switch, and the
   type in the `needsNative` list.
6. **Per-node array data** (points, steps, tables): add an `extern "C"`
   setter on the graph (`soemdsp_graph_…`) and add it to the graph_engine
   `Exports` in `scripts/build_native_modules.ps1`.

### Build (`scripts/build_native_modules.ps1`)

7. Separate native module: add `@{ Name = "<name>"; Simd = $false; Exports = @(…) }`.
   New graph exports: add to the `graph_engine` entry.
8. Run the script (builds every module and the combined wasm). Bump the
   `soemdsp_combined.wasm?v=` tag in `public/node-graph-live-runtime.js`.

### JS interface

9. **Definition**: `nodeGraphModuleDefinitions.<type>` in
   `public/node-graph-module-definitions.js`: `inputs`, `outputs`,
   `parameters` (and optional `face`). Label in `nodeGraphNodeLabels`.
   `inputs` are jacks; `parameters` are knobs (each gets a MOD port
   automatically). See `docs/MODULE_PATTERN_REFERENCE.md`.
10. **Native type id**: `NodeLiveAudioProcessor.NATIVE_GRAPH_TYPE_IDS` in
    `public/node-live-audio-worklet-native-graph.js`, same number as `kType<Name>`.
11. **Param → slot mapping**: the `push("<paramKey>", P.NATIVE_GRAPH_PARAM_<SLOT>, cont/disc(...))`
    block for the type in the same file. `cont` for continuous, `disc` for choices.
12. **Ports**: input/output port-name → engine port mapping in the same file
    (grep how a similar module's port names resolve).
13. **Efficient product allowlist**: add the type to the list in
    `public/node-graph-efficient-product.js`.
14. **Add Module menu / store**: `public/node-graph-module-store.js` entry, and
    `public/index.html` menu if needed.
15. **Separate native module only**: catalog entry in
    `public/native-modules-catalog.json`.
16. **Display / face** (optional): `public/modules/<type>/<name>-display.js`,
    loaded from `public/index.html` and `public/perform.html`. Faces read
    engine outputs (e.g. hidden `__…` taps) through the scope taps; they do
    no DSP.
17. Bump `?v=` on every changed script in `public/index.html` and
    `public/perform.html`.

## Verify

- Render Sample a patch with the module (offline engine path).
- Play it live. If it is missing from `NATIVE_GRAPH_TYPE_IDS` or the
  efficient allowlist, it will render nothing.
- Modulate a continuous param at audio rate and check the output changes
  every sample, not every block.
- If the module should stay covered, add it to `patches/smoke_test.json`,
  re-render, save over `patches/smoke_test.wav`; `node scripts/smoke.mjs`
  checks it.

## Patch JSON boundary

Patch JSON saves instances, positions, params, param meta, connections,
modulations, and visual settings. It cannot define a new module type; a
patch can only instantiate types already built into the sandbox.
