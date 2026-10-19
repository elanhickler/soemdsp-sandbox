# Video graph plan (VG)

Status: **plan only, no code yet** (2026-10-18). Source: Argi via Interface.
Related: `docs/ZOOM_PERF_PLAN.md` (ZP-2 per-face textures are the foundation, ZP-7 is the perf gate),
`docs/WEBGL_DISPLAY_PLAN.md` section 9 (RGBA picture outputs) and section 11 (circuit builder to GL),
`docs/GPU_WORKSPACE_PLAN.md` (GW-2 camera), `docs/SCOPE_VIDEO_OUT_PLAN.md` (scope 📺 outs).

## How to update this file
- Update the tracker row when a stage starts, lands (local commit hash) or is measured.
- Record measurements on ArchIV (RTX 3060 Ti) with the same probe each time.
- Nothing is pushed without Argi's OK.

## Goal
A scheduler for 📺 video that works like the C++ audio graph: one ordered pass per video frame,
every node a GPU pass from input textures into its own output texture, all on the single shared
WebGL2 context (`picture-device.js`). Displays become consumers of graph outputs instead of each
module running its own clock.

## Current state (read-only audit, 2026-10-18)
- **Cable payload:** a texture reference on the shared context, keyed by source node id. Producers
  copy their finished frame into a per-node export texture (`picture-device.js:nodeGraphPicturePublish`).
  Scope faces render straight into it (`gl-line-renderer.js`, `nodeGraphPictureExportTarget`). 2D-era
  faces (softpop, rgbShape, spectrogram) bridge in via `nodeGraphPicturePublishCanvas`. No pixels
  move between modules.
- **Consumers** call `nodeGraphPictureRead(nodeId, "rgba")`, which scans the whole connection list
  every call, every frame.
- **Evaluation:** no graph. Every video module has its own rAF timer
  (`node-graph-module-scope-paint-gate.js:nodeGraphArmDrawingFaceLoop`, `fbm-field-ui.js` tick,
  `rgb-fractal-ui.js`), gated by Simulation FPS. Order is rAF registration order, not wiring order.
  No audio worklet involvement.
- **Feedback:** inside a module by read/write ping-pong (`video-feedback-gl.js:step`,
  `video-delay-gl.js`). Across modules it happens by accident: a consumer reads whatever the source
  last published.
- **Audio to video:** only through display ring buffers. Video Delay X/Y read the newest sample once
  per frame (`video-delay-display.js:nodeGraphVideoDelayLatest`). Video Feedback uploads a waveform
  block into a 1-row texture (`video-feedback-gl.js:uploadWave`).

### Problems
1. **Hop latency is random.** Each hop is 0 or 1 frame late depending on rAF order, i.e. on the order
   modules were added.
2. **Asleep sources freeze the chain.** A source offscreen (`viewport-asleep`), inside a hidden
   metamodule, or excluded by screen solo stops its loop (`fbm-field-ui.js` tick), so every visible
   consumer downstream freezes. The gesture display hold freezes the whole chain.
3. **Publishing with nobody listening.** fbmField, rgbFractal, videoFeedback, videoDelay, imageBurn and
   the user shader publish every step whether or not a 📺 cable is connected (one full-texture copy
   each). Only the scope export path checks `nodeGraphPictureHasConsumer`.
4. **Per-frame cable scans** in `nodeGraphPictureRead` and `nodeGraphPictureHasConsumer`.
5. **Audio handoff is undefined:** it depends on whether the display ring buffers are filling, and
   each module invents its own sampling.
6. **Extra copy per frame:** producer texture -> export texture -> face present, instead of the face
   sampling the node's output directly.

## Design references (ideas only, not dependencies)
- **Blender realtime compositor:** compiles the node tree into an ordered list of GPU shader
  operations, fuses simple per-pixel nodes, evaluates only what reaches an output (Viewer/Composite).
- **TouchDesigner TOPs:** every operator owns a GPU texture; cooking is pull-based from what is viewed
  or exported; a Feedback TOP gives the previous frame to break cycles.
- **Our own C++ audio graph:** topological order from cables, rebuilt on patch change; cycles broken
  with a one-block delay. VG copies that shape with "block" = one video frame.

## Architecture

### Nodes and edges
- A **video node** is any module with a 📺 input or output (internal port id `rgba`; never shown as
  "RGBA"). It registers a descriptor:
  `{ type, inputs: ["rgba", ...], outputs: ["rgba"], size(node), pass(ctx), audio: [ports], feedback: bool }`.
- `pass(ctx)` draws into `ctx.target` (the node's output FBO) using `ctx.input("rgba")` textures,
  `ctx.prev` (its own previous output), params, and audio handoff textures/uniforms. No DOM access,
  no 2D canvas, no readback.
- **Edge table:** built from `nodeGraphMvp.patch.connections` filtered to 📺 ports, cached, rebuilt on a
  patch-change event (connect, disconnect, add/remove node, page/patch load, metamodule enter/exit).
  Replaces the scan in `nodeGraphPictureRead` / `nodeGraphPictureHasConsumer` (both become O(1)
  lookups into the table during migration).

### Order and cycles
- Topological sort (Kahn) over the edge table. Strongly connected components are found (Tarjan);
  inside a cycle, the back edge reads the source's **previous-frame** texture (the source keeps a
  ping-pong pair). This is the video equivalent of a one-block delay, documented as 1 frame on that
  edge only. Nodes with `feedback: true` (videoFeedback, videoDelay, user shader `prev`) always keep
  their own ping-pong.
- Every acyclic edge has **0 frames** hop latency: the consumer runs after its source in the same frame.

### Frame clock
- **One rAF scheduler** (`node-graph-video-graph.js`, new file) runs one pass per video frame.
- Video rate = display refresh, divided down by Simulation FPS (`nodeGraphSimFpsShouldPaint("videoGraph")`).
  FPS <= 0 freezes all video nodes (current behaviour).
- Engine state follows APP_POLICY §3b: param-driven sources may render while stopped; buffer/audio-driven
  inputs hold black when stopped and frozen when paused. The UI is never blocked.
- Per-module rAF loops for migrated modules are removed; the module face loop only presents.

### Pull-based culling
Each frame (or on edge-table rebuild plus visibility change), mark **sinks**:
- a face that is visible (in viewport, current page, not hidden by solo/metamodule),
- a 📺 output leaving the patch (perform tiles, mini perform view, camera view, magnifier),
- a recorder or export consumer (future).
Walk upstream from sinks; only marked nodes run. **A source that is offscreen or asleep still runs if
anything downstream is visible.** A node nobody reaches costs nothing (no pass, no publish).

### Output and publishing
- Each node owns its output texture at **zoom-1 size** (face canvas backing size, from
  `nodeGraphDisplayCanvasSize`, never scaled by camera zoom). Realloc only on resize.
- Textures are published only when a 📺 consumer or a visible face needs them. The separate
  "copy into export texture" step goes away: the node's output **is** the published texture
  (ping-pong nodes publish the read side after swap).
- Wire convention stays as WEBGL_DISPLAY_PLAN §9: premultiplied RGBA, FBO row order; consumers draw
  upright (the ZP-2 orientation smoke covers it).

### Displays as consumers
- With ZP-2, faces already land in per-face textures that the GL graph, mini view, perform tiles and
  magnifier sample. VG makes the face of a video node simply **sample the node's output texture**
  (same `drawImages` path), with no extra present copy.
- Zoom: the GL graph composites face quads through the camera; NEAREST above 2.5x, the node is never
  re-rendered for zoom (Zoom-1 is the source of truth).
- During gestures the graph keeps running if the display hold is off (ZP-3 decouples camera from hold).

### Audio-to-video handoff
Defined once in the scheduler, not per module. At the start of each video frame:
- **Latest sample (control):** for each audio input a node declares as `control`, read the newest value
  from its scope ring (`nodeGraphModuleScopeConnectedSourceBuffer`) -> uniform.
  Latency: audio output latency + up to one video frame (about 16.7 ms at 60 Hz).
- **Block texture (signal):** for inputs declared `block`, upload the samples since the last frame
  (fixed N, e.g. 1024, resampled) into a 1-row R32F texture (a missing float format is a GL failure, reported, not a fallback). Shaders sample
  it by x. Latency: same as above plus block length.
- The ring buffers must be filled for any connected video audio input regardless of whether a scope
  face is visible (today they fill only for displays). That is a worklet tap change and needs care.
- Documented in the node descriptor so each module states which mode each input uses.

### Failure policy
- No 2D fallbacks anywhere in the video path.
- On GL failure (program link, FBO incomplete, context lost) the affected node's face goes black and
  `nodeGraphDisplayGlFailed` is called once with the node id and reason. Downstream inputs read black
  (a shared 1x1 black texture), never stale garbage. No silent `return false`.
- Program link failures are cached once (ZP-1 pattern), no per-frame retry.
- Context loss: the scheduler drops all node textures, rebuilds on restore, and reports once.

### Policies (carried over)
- 📺 is the only label for video ports; never "RGBA" in UI text.
- Single shared WebGL2 context only; no new contexts, no WebGL1.
- Zoom-1 resolution; nearest-neighbour above 2.5x; never re-bake for zoom.
- Settings live in the patch only when they are patch content; scheduler tuning is per machine.

## Stages

Every stage is committed locally on its own and measured with the VG probe. Nothing pushed without
Argi's OK. Measurements on ArchIV, softpop plus a test patch `vg-chain` (fbmField -> videoDelay ->
videoFeedback -> imageBurn, plus a videoFeedback <-> videoDelay loop).

| ID | Task | Done when | Gate | Status |
|---|---|---|---|---|
| VG-0 | Probe: `scripts/probe_video_graph.mjs` builds `vg-chain`, stamps a frame counter into each node's output (test-only uniform or a 1-px corner), reads it back **in the probe only** (`nodeGraphSharedGlFacePixels`), and reports hop latency per edge, frames updated per node, fps, p50/p90. Baseline recorded. | Probe runs on today's code and records the current random latencies | baseline row in tracker | open |
| VG-1 | Edge table: cached 📺 edges, rebuilt on patch change. `nodeGraphPictureRead` / `nodeGraphPictureHasConsumer` use it. | 0 connection-list scans per frame (counter) | scans/frame = 0 | open |
| VG-2 | Publish only if connected: every publisher checks the edge table (or a visible face) before publishing. | Unconnected fbmField/rgbFractal/feedback/delay/imageBurn/user shader do 0 publish copies | publish copies with no cable = 0 | open |
| VG-3 | Scheduler skeleton (`node-graph-video-graph.js`): one rAF, topological order, SCC back edges on previous frame, Simulation FPS clock, engine-state gating. Modules not yet migrated are called through an adapter that wraps their existing step function. | Single rAF drives all video nodes; per-module rAF loops disabled for adapted modules | hop latency 0 frames on every acyclic edge of `vg-chain`; loop edge exactly 1 | open |
| VG-4 | Pull-based culling and asleep sources: sink marking, upstream walk, sources run while offscreen/asleep/hidden when a visible sink needs them. | Probe: fbmField scrolled offscreen (asleep) while its consumer is visible keeps updating; an unreachable chain runs 0 passes | offscreen source frames updated = sink frames; unreachable passes = 0 | open |
| VG-5 | Node outputs are the published textures (no export copy); faces of video nodes sample them directly via ZP-2 `drawImages`. | One pass per node per frame, no extra copy; orientation smoke passes | copies per node per frame = 0 beyond the pass | open |
| VG-6 | Audio handoff: control and block modes in the scheduler; rings filled for connected video audio inputs without a visible scope. Latency documented in this file. | Video Delay X/Y and Video Feedback wave use the scheduler handoff; a 1 Hz sine into Video Delay X moves the picture with the face scrolled away | latency measured and recorded | open |
| VG-7 | Migrate modules in the order below; remove each module's own clock. | All modules in the migration table are `migrated` | per-module smoke passes | open |
| VG-8 | Failure policy smokes: forced link failure and FBO failure per node give a black face, one `nodeGraphDisplayGlFailed`, black downstream, no retry loop. | `scripts/smoke_video_graph_gl_failure.mjs` passes | 1 report per failure, 0 retries | open |
| VG-9 | Perf gate: `vg-chain` and softpop with play on, idle and during a slow 1x-40x zoom (ZP probe). Add to ZP-7 `GATE=1`. | fps targets met | `vg-chain` play >= 58 fps idle; zoom fps no worse than ZP tracker's latest row; GPU frame time recorded | open |

## Migration order (per module)

Order: simplest pure sources first, then feedback, then consumers, then the 2D/scope bridges.

| # | Module | Today | VG shape | Notes | Status |
|---|---|---|---|---|---|
| 1 | fbmField | own rAF (`fbm-field-ui.js`), publishes `state.colorTex` always, stops when asleep | source node, `pass` = field shader; X/Y/Z audio outs unaffected | Proves asleep-source fix (VG-4) | open |
| 2 | rgbFractal | own rAF (`rgb-fractal-ui.js`), publishes `sceneTex` always | source node | Hx/Hy outs unaffected | open |
| 3 | videoFeedback | face pump, ping-pong, wave block upload, publishes always | `feedback: true` node, `block` audio input | First block-handoff user | open |
| 4 | videoDelay | face pump, ping-pong, frame-period counter, X/Y latest sample | `feedback: true`, `control` audio X/Y; delay period counted in video frames | Loop with videoFeedback is the SCC test | open |
| 5 | imageBurn | face pump, consumes 📺, publishes residual always | consumer + source node | Image file input stays a texture upload on load only | open |
| 6 | user shader (emo `display {}`, `gl-line-renderer.js:nodeGraphGlLinesUserShader`, `emo-display.js`) | 8-frame ring, `prev`, `rgbaIn`, publishes via `publishNodeId` | `feedback: true` node; ring stays inside the node | Script recompile = node rebuild | open |
| 7 | rasterRgb | consumes 📺 (`raster-rgb-display.js` reads by cable and by `nodeGraphPictureGet`), own rAF | consumer node; remove the cable-free `nodeGraphPictureGet` lookup or make it an explicit edge | Check what the by-id lookup is for before migrating | open |
| 8 | rgb trails (`lib/trace/trace-rgb-trails-gl.js`) | trace renderer on the shared device, not a 📺 publisher | becomes a node only if it gets a 📺 out; otherwise a face consumer | BugsFix-adjacent trace code: ask before editing | open |
| 9 | Scope export targets (`gl-line-renderer.js` export target; softpop, rgbShape, spectrogram via `nodeGraphPicturePublishCanvas`) | render into export FBO when connected | adapter node: its face draw is the pass; buffer faces follow §3b | Many faces; keep adapter until each is native | open |

## Risks
- **Shared files under concurrent edit** (`picture-device.js`, `gl-line-renderer.js`, `node-graph-gl-graph.js`,
  paint gate). New code goes in new files; shared files get minimal hooks.
- **Running offscreen sources costs GPU.** A big patch of offscreen video chains feeding one visible face
  runs everything upstream. Mitigation: culling is strict to reachability; optional per-node resolution cap.
- **Ring-buffer taps for hidden scopes** change worklet traffic; must not hurt audio.
- **Timing vs. audio:** video at screen rate means fast audio modulation aliases; block mode is the answer,
  control mode is documented as lossy.
- **Adapter period:** mixed migrated/unmigrated modules can show 1-frame hops until all are migrated.
- **Context loss / 4096 canvas:** many node textures add memory; budget and log total texture bytes.
- **BugsFix ownership:** trace-woscope, Phosphor files and rgb trails need BugsFix's OK.

## Open questions for Argi
1. Video rate: lock to display refresh, or to Simulation FPS? (Plan: display refresh divided by Simulation FPS.)
2. Should offscreen sources run at full rate, or at a reduced rate when only feeding a visible sink?
3. Should video keep running during zoom gestures by default (display hold off)?
4. Which audio-to-video mode should be the default for new modules: latest sample or block?
5. Should the 1-frame delay on a feedback loop's back edge be visible in the UI (e.g. a marker on the cable)?
6. Video node resolution: always the face's zoom-1 size, or a per-node resolution setting independent of the face?
7. Recorder / export sink: in scope for this plan or a later one?

## Tracker
| Date | Stage | hop latency (acyclic) | offscreen source updates | fps idle | fps zoom | Commit |
|---|---|---|---|---|---|---|
| - | - | - | - | - | - | - |
