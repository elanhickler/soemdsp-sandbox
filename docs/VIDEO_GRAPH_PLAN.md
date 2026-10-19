# Video graph plan (VG)

Status: **decisions recorded, executing from VG-0** (2026-10-18). Source: Argi via Interface.
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
- Video rate = min(display refresh, Simulation FPS) (Decision 1; `nodeGraphSimFpsShouldPaint("videoGraph")`).
  FPS <= 0 freezes all video nodes (current behaviour).
- Engine state follows APP_POLICY §3b: param-driven sources may render while stopped; buffer/audio-driven
  inputs hold black when stopped and frozen when paused. The UI is never blocked.
- Per-module rAF loops for migrated modules are removed; the module face loop only presents.

### Pull-based culling
Each frame (or on edge-table rebuild plus visibility change), mark **sinks**:
- a face that is visible (in viewport, current page, not hidden by solo/metamodule),
- a 📺 output leaving the patch (perform tiles, mini perform view, camera view, magnifier),
- a recorder or export consumer (out of scope, Decision 7; later plan).
Walk upstream from sinks; only marked nodes run. **A source that is offscreen or asleep still runs, at full
rate, if anything downstream is visible** (Decision 2). A node nobody reaches pauses and costs nothing (no
pass, no publish).

### Output and publishing
- Each node owns its output texture at **zoom-1 size** (face canvas backing size, from
  `nodeGraphDisplayCanvasSize`, never scaled by camera zoom). Realloc only on resize. Optional per-node
  resolution Half / Full / Double (Decision 6), capped at screen size x devicePixelRatio and the GPU's
  MAX_TEXTURE_SIZE (replaces the 512 px cap).
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
- During gestures the graph keeps running (Decision 3; display hold stays off). A display whose pass costs
  more than its frame budget during a gesture may hold its last frame while the others keep moving, chosen
  from ZOOM_PERF profiling, not by default.

### Audio-to-video handoff
Defined once in the scheduler, not per module. At the start of each video frame:
- Default is **latest sample** (Decision 4); block mode is a later per-module "Send whole block" option.
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
Argi's OK. Measurements on ArchIV, softpop plus a test patch `vg-chain`
(built in memory by the probe; videoFeedback has no ?? inlet, so the chain is split): fbmField ->
videoDelay -> imageBurn, videoFeedback -> imageBurn, a videoDelay <-> imageBurn loop, and an fbmField
parked ~10000 px off screen feeding a visible videoDelay.

| ID | Task | Done when | Gate | Status |
|---|---|---|---|---|
| VG-0 | Probe: `scripts/probe_video_graph.mjs` builds `vg-chain`, stamps a frame counter into each node's output (test-only uniform or a 1-px corner), reads it back **in the probe only** (`nodeGraphSharedGlFacePixels`), and reports hop latency per edge, frames updated per node, fps, p50/p90. Baseline recorded. | Probe runs on today's code and records the current random latencies | baseline row in tracker | done (2026-10-18). Probe hooks publish/read instead of stamping pixels: each read records how many frames ago its source published, so no pixel readback at all. |
| VG-1 | Edge table: cached 📺 edges, rebuilt on patch change. `nodeGraphPictureRead` / `nodeGraphPictureHasConsumer` use it. | 0 connection-list scans per frame (counter) | scans/frame = 0 | done (2026-10-18). `nodeGraphPictureEdges()` in picture-device.js, keyed on the connections array and its length (every commit makes a fresh array); `nodeGraphPictureEdgesInvalidate()` for in-place edits; `nodeGraphPictureEdgeStats()` counts rebuilds. Probe also checks a rewire through `commitNodeGraphPatch`. |
| VG-2 | Publish only if connected: every publisher checks the edge table (or a visible face) before publishing. | Unconnected fbmField/rgbFractal/feedback/delay/imageBurn/user shader do 0 publish copies | publish copies with no cable = 0 | done (2026-10-18). One gate in `nodeGraphPicturePublish` (all module publishers go through it; the user-shader export target was already gated). Consumers = ?? out cables plus R/G/B/rgba cables into RGB Picture (it reads `nodeGraphPictureGet`). |
| VG-3 | Scheduler skeleton (`node-graph-video-graph.js`): one rAF, topological order, SCC back edges on previous frame, Simulation FPS clock, engine-state gating. Modules not yet migrated are called through an adapter that wraps their existing step function. | Single rAF drives all video nodes; per-module rAF loops disabled for adapted modules | hop latency 0 frames on every acyclic edge of `vg-chain`; loop edge exactly 1 | done (2026-10-18). `public/node-graph-video-graph.js`: Tarjan SCC over the ?? edge table, cached per edge-table rebuild; one rAF runs queued nodes by rank. Adapters: the shared face pump (Video Delay, Video Feedback, Image Burn) and the fbmField / rgbFractal loops swap rAF for `nodeGraphVideoGraphRequestFrame`; fbmField and the pump use the one `videoGraph` Simulation FPS clock (rgbFractal keeps its own FPS limiter until VG-7). Engine-state gating is still each module's own check. |
| VG-4 | Pull-based culling and asleep sources: sink marking, upstream walk, sources run while offscreen/asleep/hidden when a visible sink needs them. | Probe: fbmField scrolled offscreen (asleep) while its consumer is visible keeps updating; an unreachable chain runs 0 passes | offscreen source frames updated = sink frames; unreachable passes = 0 | done (2026-10-18). Needed set per frame in the scheduler: visible sinks (video nodes and anything a picture cable feeds, on screen and allowed by screen solo) plus their upstream closure over the edge table's `upstream` map. Modules ask `nodeGraphVideoGraphShouldSleep` instead of checking viewport-asleep / solo; the viewport cull no longer stops a needed fbmField; wakes registered per node restart loops that become needed. Face pump force is now one paint for video nodes (it stayed set and pushed off-screen nodes through the frame clock). |
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

## Decisions (Argi via Librarian, 2026-10-18)
The seven open questions, answered:
1. **Video rate** = min(display refresh, Simulation FPS). Simulation FPS is the user's knob; the display
   refresh is the ceiling.
2. **Offscreen sources** run at full rate unless their ?? output feeds no visible display (the display is
   off screen and nothing else reads it); then they pause.
3. **Zoom gestures:** video keeps running by default. Per-display exception: a display that costs more than
   its frame budget during a gesture holds its last frame while the others keep moving; such displays are
   identified with ZOOM_PERF profiling (`probe_zoom_perf.mjs PROFILE=1`).
4. **Audio to video** defaults to the latest sample. A later per-module "Send whole block" option is for
   modules that need it (e.g. scopes).
5. **No UI marker** for the 1-frame feedback delay.
6. **Node resolution** defaults to the face's zoom-1 size (zoom 1.0 is the source of truth), plus an optional
   per-node resolution setting (Half / Full / Double). The max cap is the user's screen resolution in device
   pixels (screen size x devicePixelRatio), clamped to the GPU's MAX_TEXTURE_SIZE. This replaces the 512 px
   cap.
7. **Recorder / export** is out of scope; it gets a later plan.

User-facing labels say ??, never "RGBA".

## Tracker
| Date | Stage | hop latency (acyclic) | offscreen source updates | fps idle | fps zoom | Commit |
|---|---|---|---|---|---|---|
| 2026-10-18 | VG-0 baseline | fbm->delay 1, delay->burn 0, feedback->burn 0; loop delay->burn 0, burn->delay 1 (every frame, order-dependent) | fbm-far asleep: 0 updates, its visible consumer reads a picture 92-331 frames old (stale) | 60 (p50 16.7, p90 16.7 ms) | - (VG-9) | VG-0 commit |
| 2026-10-18 | VG-1 | unchanged (1/0/0; loop 0/1) | unchanged (fbm-far 0) | 60 (p50 16.7, p90 16.7 ms) | - (VG-9) | VG-1 commit; connection-list scans 6/frame -> 0/frame |
| 2026-10-18 | VG-2 | unchanged (1/0/0; loop 0/1) | unchanged (fbm-far 0) | 60 (p50 16.7, p90 16.7 ms) | - (VG-9) | VG-2 commit; 5 uncabled nodes (fbm, rgbFractal, feedback, delay, burn) and the chain ends ib-1/ib-2/vd-far: 0 copies/frame (were 1) |
| 2026-10-18 | VG-3 | **0 on every acyclic edge** (fbm->delay 0, delay->burn 0, feedback->burn 0); loop: delay->burn 0, burn->delay 1 (1 back edge) | unchanged (fbm-far 0; VG-4) | 60 (p50 16.7, p90 16.7 ms) | softpop 58.2, musicplayer 60 | VG-3 commit |
| 2026-10-18 | VG-4 | 0 on every acyclic edge; loop 0/1 | **fbm-far asleep: 1 update/frame, consumer reads age 0, picture lit**; panned back it is woken; whole graph off screen: 0 passes on every node (were 0.9) | 60 (p50 16.7, p90 16.7 ms) | softpop 57.5-58.0, - | VG-4 commit |

VG-0 baseline notes (ArchIV, `node scripts/probe_video_graph.mjs`, 4 s window, play on):
- Hop latency is fixed per edge but depends on rAF registration order, not graph order: fbmField
  renders after Video Delay, so fbm->delay is always 1 frame late while delay->burn is 0.
- The off-screen fbmField stops (viewport-asleep) while its consumer is on screen: the consumer shows
  a frozen picture. VG-4 fixes this.
- The opposite leak: with the whole cluster panned off screen, Video Delay, Image Burn and Video
  Feedback still publish ~0.9 times per frame (only fbmField stops). Nothing visible needs them.
- `nodeGraphPictureRead` scans the connection list 6 times per frame on this patch (VG-1 target 0).
