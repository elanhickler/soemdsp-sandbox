# Future Planning Notes

This file collects project-shaping ideas that should survive day-to-day implementation without becoming immediate scope.

## Math category, Logic, Noise Gate (2026-10-23)

M1 (Math shelf + recategorize) shipping with this work. M2 Logic and M3 Noise Gate still to land. New Math shelf; Comparator / B2U / U2B / Bias / Divide / Inv / Min-Max / Range / Rotation 3D to 2D / AM Index / Amp↔dB on Math. Gain, RingMod, Vectorscope Rotation stay Dynamics. New Logic module (AND/OR/XOR outs) on Math. New Noise Gate (two thresholds, Attack/Hold/Release/Range) on Dynamics. Plan: `docs/MATH_CATEGORY_PLAN.md`.

## Display Settings numbers (2026-10-19)

Plan only (DS-1..DS-7, not started). Display Settings number fields get Ctrl/Cmd+click reset, app-wide fine-drag modifiers (Shift/Ctrl x0.1, both x0.01, no Alt jump), wheel, and one shared drag law. Fixes Sweep (Hz)/Cycles jumping 5 to 100 in ~5 px (dead `waterfallField` quanta + magnitude quantum in control space). Plan: `docs/DISPLAY_SETTINGS_NUMBERS_PLAN.md`.

## Deletable Output and Input (2026-10-19)

Done locally (DO-1..DO-9, not pushed). Output and Input are deletable; each returns only via Undo or its lower-bar button turning on, which respawns it with its saved settings and position (`patch.ioModuleSettings`). Play never spawns. Plan and deviations: `docs/DELETABLE_OUTPUT_PLAN.md`.

## Zoom performance (2026-10-18)

Slow zoom with Play on was ~3 fps; target ~60 with displays running and zero `readPixels` / layout reads during the gesture. Tracker ZP-1..ZP-7. ZP-1 done locally (`d895e36a` / `f2cd9bce`), not pushed. ZP-2 paused for Argi scope OK and owner handoff of the uncommitted play-blit `readPixels` path. Plan: `docs/ZOOM_PERF_PLAN.md`.

## Video graph (2026-10-18)

One ordered GPU pass per video frame for 📺 nodes on the shared WebGL2 context (like the C++ audio graph). Tracker VG-0..VG-9, not started; waits for zoom work and Argi go-ahead; 7 open questions. Plan: `docs/VIDEO_GRAPH_PLAN.md`.

## Resonant Envelope (2026-10-18)

Shipped as `resonantEnvelope` in the Envelope category (Argi OK 2026-10-18, `tpt_svf.h` reused unchanged). Two-pole TPT SVF envelope: Decay, Resonance, ƒ Tracking around 440 Hz, Impulse, Fit / Raw. Face is the live Waterfall. Native shape preview and the z-plane inset are still open. Plan: `docs/RESONANT_ENVELOPE_PLAN.md`.

## Color rows (2026-10-18)

App-wide rule: color widgets sit in horizontal rows of 2 to 4, never stacked one per line (`docs/APP_POLICY.md` §21). RoundShape display settings is the reference; Keypad and 15 other surfaces need converting. Plan: `docs/COLOR_ROW_PLAN.md` (CR-1..CR-7, owner TBD, open questions on single-color panels).

## Mini performance view (2026-10-18)

Live, uniformly scaled copy of the F performance screen inside the circuit builder, turned on from a new Command Center page (Mini Performance View, Shift+F). GPU mirror of the pinned faces; faces stay in their modules; settings are UI preferences. Plan: `docs/MINI_PERFORM_VIEW_PLAN.md`. MP-1..MP-6 and MP-8 done (local `4cc51840`); MP-7 after Pencil PE-4; MP-9 optional. Round 2 MP-10..MP-19 (draggable corners, default cursor, fewer page controls, aspect ratio buttons, Enlarged double-click / Escape; full-screen view renamed Performance view with a labelled Show performance view [ F ] button; F cycles the Performance view and Shift+F cycles the mini view off → Perform → Arrange → off, independently, with mini Arrange editing the layout; empty-canvas bouncing soundemote logo behind one cinematic monospace empty line, WebGL2 NEAREST; Snake select trail above the mini view / Enlarged, coordinated with Pencil PE-4 In-front order) planned, owner TBD.

## Pencil page (2026-10-18)

Command Center Pencil page: a mini drawing program for hand-drawn notes on patches. WebGL2 strokes; layers with Workspace / Screen / Module anchors and Behind / In front of modules; saved in the patch as `drawings`. The mouse smoothing slider stays in the top bar. Plan: `docs/PENCIL_PAGE_PLAN.md` (Round 1 done, pushed `3277ddc5`; PE-1..PE-9, owner TBD, open questions).

## Patch migration purge (2026-10-18)

Argi policy (APP_POLICY §1): migrations are one-shot. Convert every stored patch to the current format, then delete the 26 migrators; `node-graph-patch-migrations.js` stays as an empty hook. Plan and inventory: `docs/PATCH_MIGRATION_PURGE_PLAN.md` (PM-1..PM-5, owner TBD).

## Core shell standing items (from CORE_REDUCTION_PLAN, 2026-10-18)

Standing rules, no end date. The core shell that unites modules stays small; `public/modules/**` may grow. History: `docs/archive/CORE_REDUCTION_PLAN.md`.

- Delete dead CSS when you find it. Do not add `*-heading` classes for floating chrome; use the shared `.scene-context-heading` and `.scene-context-resize-handle`.
- Scopes megafile: lazy-load the rare display modes (careful).
- Optional: split `styles.css`.
- Shell freeze: review each new feature for core-shell growth (aim for net-negative core LOC).

## GPU-only workspace picture (2026-10-18)

Workspace picture is GPU-only; the app menu, top and bottom bars, and extra windows stay HTML. Owns the true GPU camera (GB-6 = GW-2). Text Box stays HTML (editable control), with wires on two stacked canvases and a per-box Behind wires / In front of wires setting. Status: planned, not started. Plan: `docs/GPU_WORKSPACE_PLAN.md`

## Phone compatibility + GPU camera (2026-10-18)

Make the sandbox itself work on phones, mainly performance mode: one shared touch-gesture layer (double-tap, long hold, pinch, two-finger pan), audio unlock on first touch, no accidental scroll/zoom, double-tap reset and long-hold text edit on parameters, hover info on touch. Not a phone app; no soundemote.com special-casing. PH-1..PH-5 in tree. The GPU camera (GB-6) is now GW-2 in `docs/GPU_WORKSPACE_PLAN.md` and lands before the workspace gestures (PH-6). Plan: `docs/PHONE_COMPAT_PLAN.md`

## Engine state and displays (2026-10-17)

Displays must spawn and work while stopped; buffer faces black when stopped and frozen on pause; parameter faces always update; UI never blocked by engine state. Stages ES-1..ES-6 replace the ~138 engine gates with engineState() + per-face paint policy. ES-1..ES-6 committed and pushed (checked 2026-10-18) (2026-10-17); awaiting Argi testing. Plan: `docs/ENGINE_STATE_DISPLAY_PLAN.md`

## Seed code (2026-10-17)

Show seeds as a 4-character scrambled URL-safe base64 code (e.g. 🎲 P6nC) instead of 7-8 digit decimals; input also accepts decimal and #hex (raw 24-bit). Storage unchanged. Done (`84877a07`, 2026-10-17). Plan: `docs/SEED_CODE_PLAN.md`

## Sandbox Script Language (2026-10-17)

Argi's own small C-like language for DSP classes with state and audio-rate param modulation, compiled in the browser to WASM (Lezer parser, Binaryen codegen) and run in the worklet; never JS in the audio path. A `display {}` block of raw GLSL draws the face and can publish on 📺. Built in six stages, starting with one-line expressions. Argi said execute all stages (2026-10-17); implementation committed in `a6c99720` (`public/lib/emo/`, `script` module); per-stage status not tracked. Plan: `docs/SCRIPT_LANGUAGE_PLAN.md`

## Sandbox DAW plugin (2026-10-16)

Designer runs in the plugin (CLAP/VST3) with the native engine, but output is still silent in REAPER. Milestones DAW-1..8 (audible, DAW state, host integration, automation, glitch-free editing, editor, robustness, release) and the rename to 'Sandbox'. Plan: soemdsp-sandbox-audioplugin `docs/DAW_PLAN.md`

## Circuit builder to GL (2026-10-16)

Zoom-out from ~40x is GPU-bound on HTML raster; move cables/grid, module bodies, jacks/labels to the shared GL context in flagged stages GB-1..GB-5, HTML only for inputs/popups. Shares the glyph atlas with the Music Player Text Box. Status: GB-1..GB-4 on by default, GB-5 measured 2026-10-16; GB-6 = GW-2 in `docs/GPU_WORKSPACE_PLAN.md`. Plan: `docs/WEBGL_DISPLAY_PLAN.md` section 11

## Music Player metadata, Album Art, rich Text Box (2026-10-15)

Build-time ID3 metadata + small extracted covers in soundemote-com `playlist.json`; player API `track-change`; Music Player **Album Art** (RGBA) and **Track** (data) outputs; rich Text Box (safe HTML subset, live metadata fields, WebGL glyph atlas, loadable fonts); soundemote.dev rich-text editor. Status: planned, not started; Argi must OK step 1. Plan: `docs/MUSIC_PLAYER_METADATA_PLAN.md`

## WebGL2 displays everywhere (2026-10-14)
All module displays move to WebGL2 + shaders via `gl-line-renderer.js` on the shared picture device; no 2D fallback (black on GL failure). 39 modules to migrate, enforced by a shrink-only smoke allowlist. Plan: `docs/WEBGL_DISPLAY_PLAN.md`.

## Slider buffered modulation (destination = real effective-param history)

Parked under **0.5.0 RGB**. First visual when we return: live occupancy + caret on the value axis, not a mini-scope. Do not implement until asked.

Primary note:

```text
docs/SLIDER_BUFFERED_MODULATION_PLAN.md
```

## Lo-Fi Pitch Shift (component-first)

Realtime pitch tools aimed at **abusable lo-fi character**, not transparent stretch. Build lowest modules first (buffer → varispeed → grains → grain pitch → optional spectral dirt), each useful alone, then compose.

Primary note:

```text
docs/LOFI_PITCH_SHIFT_PLAN.md
```

## Dropdown Window Buttons

Next version: consider turning Command Center buttons into dropdowns instead of opening separate floating windows for every tool.

The current floating-window direction is good enough for this release. The next pass can consolidate window bodies into button-owned dropdown panels, because the panels are already starting to look and behave like compact modules.

Keep this as a next-version cleanup, not a release blocker.

## Inlets / outlets above displays (app-wide)

**Implemented.** LayoutA (and sample / phosphor face stacks) use `header → io → face → params → lip`. Display off and Display Height 0 omit the face track; I/O stays under the header.

Standing rule: `docs/APP_POLICY.md` (LayoutA I/O above the face). Band contract: `docs/archive/MODULE_LAYOUT_PLAN.md`.

LayoutB (ports beside the face) and InletOutletLayout (title + I/O, no face) are unchanged. Do not add a second layout or an old-patch shim for the previous face-then-I/O stack.


## Instant Waterfall Display Settings (premium look + amp law)

**Status:** **Implemented** on ArchIV (Website & UI, 2026-09-28, local, no PR). Display/UI only — **no JS audio DSP**.

**Scope:** Instant Waterfall schemas only (`waterfall` / `waterfallRgb` / `waterfallXyz`). Does **not** change `scope1dTrace`.

**Done:**
- Premium Instant Waterfall controls: **Blur** (soft vertical skirt on filled bars) + **Bright** for mono/stereo/XYZ/RGB. **Persist / Bloom / Detail removed** (2026-09-28).
- Display Settings waterfall-first (History / Scale / Amp law / Bright / Blur). Dropped Trace Size / Persist / Bloom / Detail / stamp-density from the Instant Waterfall form.
- Visual amplitude compression for painted height only: Amp law **Linear / Sqrt / Log / mu-law** (`ampLaw`). Scales face energy, not audio.
- Wired via `normalizeNodeGraphWaterfallSettings` + Canvas2D hold paint (same Bright path as existing ink). Defaults / cache-bust updated.

**Files:** `node-graph-module-scope-defaults.js`, `…-normalize.js`, `…-waterfall.js`, `…-trace-controls.js`, `…-settings-form.js`, `…-settings-controls.js`, `…-metrics.js`, `index.html`.

## Waterfall redesign (amp-per-frame bars)

**Status:** **Implemented** on ArchIV (Website & UI, 2026-09-28, local, no PR). Filled-bar strip contract 2026-09-28.

**Done:**
- `public/node-graph-module-scope-waterfall.js` — classic waterfall: **solid filled** peak-to-peak column rects (`fillRect` min..max Y), stamp on the **right**, history **scrolls left** on a Canvas2D hold plate. **No full-face redraw** (Sync no longer ClearTapes+rebuild). Freerun fractional `barAcc` seeds column 0.
- Vibrato Generator face set to waterfall (was misnamed Instant Trace) as reference consumer.
- Preserved: color, blend (Add/Multiply; Meet≈lighter on filled bars), scale, History Hz, now-line, hold, stereo/XYZ/RGB.

**Decision (2026-09-29):** Remove Sync from waterfall scopes. It is fundamentally incompatible with them. No Sync control, Sync Off/On, or cycle-lock on these scopes. Planning record only; code not changed here.

## True metamodule parameter mirror

**Status:** planned follow-up — not now. Website is shipping a **limited** mirror first (outer Show-on-metamodule checkbox resolves via `metaExpose` to the inner expose target). This item is the later **true** mirror.

**Today (limited):**
- Inner child params are exposed with `paramVisibility["childId|paramKey"]`.
- Outer UI is a synthetic `mx_*` shell param: mirrored **values**, but separate `paramMeta` / context-menu identity (two records that happen to share a value).

**Goal (true mirror):**
- Right-click / edit / menus on an outer `mx_*` metaparameter behave as if targeting the **inner child parameter** — one conceptual parameter (metadata, visibility semantics, related menus), not two forked records.
- Nested metamodule ambiguity stays **explicit**: unexpose on the parent vs expose the shell upward to a grandparent must remain distinguishable actions/UX, not collapsed into one vague toggle.

**Out of scope for this seed:** implementing code; changing the limited checkbox path Website is doing now.

**Owner / path:** planning SSOT here; implement later on ArchIV (direct local edits, no PR unless Architect asks). Repo `soundemote/soemdsp-sandbox`.

## Keytracking / pitch-tracking modulation UI

**Status:** seed only — details TBD; do not implement until Architect expands this.

**Direction:** UI for modulating parameters from pitch / keytracking (tracked pitch or keyboard note as a modulation source), so settings can follow note/frequency without hand-wiring every destination each time.

**Still open:** source (MIDI note vs tracked pitch vs both), mapping curve, per-param vs global routing, overlap with existing CV / modulation paths.

## Circuits on a keyboard (play like a sample library)

**Status:** seed only — details TBD; do not implement until Architect expands this.

**Direction:** Put circuits (patches / metamodule graphs) onto a keyboard and play them like a sample library — each key or zone triggers / voices a circuit the way a sampler triggers samples.

**Still open:** one circuit vs many mapped across keys, voice management, how a “circuit preset” is stored/selected, MIDI vs on-screen keyboard, relation to existing patch / metamodule load paths.

## Dimensional parameter prototyping

**Status:** seed only — details TBD; do not implement until Architect expands this.

**Direction:** Help the case “these settings sound right at this frequency, but other frequencies need different settings.” Prototype parameters along a dimension (typically pitch / frequency) so values can vary across that axis instead of a single global knob.

**Still open:** which params are dimensional, interpolation vs breakpoints, authoring UI, runtime evaluation, overlap with keytracking modulation UI (may share infrastructure later; keep as separate seeds for now).

## Delay with exposed feedback path

**Status:** seed only — details TBD; do not implement until Architect expands this.

**Direction:** A delay module that exposes a **feedback output** (and matching return) so the user can insert arbitrary modules into the feedback path — filters, distortion, pitch tools, etc. — instead of a closed internal feedback loop only.

**Still open:** wet/dry and time controls vs feedback jacks, mono/stereo, max delay, anti-howl / clip behavior, relation to existing delay / ping-pong modules.

## Name-based choice persistence

**Status:** standing policy in `docs/APP_POLICY.md` (Choice / enum persistence). Follow-up work: audit and migrate any remaining **index-based** saved choices so reordering options cannot break patches.

**Direction:** All discrete UI choices store stable names/keys; no index-as-identity. One-shot migrations only when Architect asks — no dual-key shims (§1).

## AcidSequencer

**Status:** shop-shipped. Native type 199; efficient allowlist `acidSequencer`. Not under construction.

Primary note:

```text
docs/ACID_SEQUENCER_PLAN.md
```

**Direction:** Own module (`acidSequencer`), not a change to **Sequencer** (`sequencer` piano roll). TB-303-style step sequencer: 13-note C–C piano grid with four per-step modifiers above it. Native C++/WASM DSP only; face/UI in JS; no JS DSP twin; no shims.

**Locked (Argi):**

- **Step length** (active step count) **1–32**, default **16**.
- Per-step modifiers: **Gate** (on / off / tie), **Accent** (Trigger), **Slide**, **Octave** (−1 / 0 / +1).
- **Tie does not hold pitch.** Tie = Gate stays high / no envelope retrigger across the boundary. Pitch may still change (piano note and/or Octave); Slide still applies when flagged.
- Params: local **bpm** (1-320, default 120), step length, Gate height 0-1, Accent height 0-1, Slide time (default 0.06 s), **semitone offset** integer -48..+48 default 0. Per-step Octave stays.
- **Left/right** rotate all 32 stored steps (wrap), not a viewport.
- Base grid **C2-C3** (MIDI 36-48). Outs **Gate, Trigger, pitch, f, inc**. No Clock/Reset jacks. One step = one 16th, transport start/stop. Accent = 1 ms trigger when Gate is on or tie. Slide = linear glide to the next step. Gate off holds pitch and kills Accent.

**Still open:** none for shop parking. Face/transport polish if something fails in use.

## VU meter

**Status:** seed only — details TBD; do not implement until Architect expands this.

**Direction:** A VU meter. Architect named it on 2026-09-29. Behavior, face, ports, and what it reads are not specified yet.

**Still open:** module vs a display on an existing face, needle vs bar, mono/stereo, ballistics, scale, and the signal it measures.

## Varispeed Delay

**Status:** plan in `docs/VARISPEED_DELAY_PLAN.md`. Do not build until Architect says so.

**Direction:** Stereo live-buffer pitch by read-head speed, not by moving delay time. Locked params: Memory (seconds), Mix, Speed (0.5, -2 to +2), Filter Slope (1 to 4), LPF, HPF, Saturation, Amplitude. Chain is HPF then LPF then saturation then Amplitude. Waterfall is pre-Amplitude. Playhead running out is silence, no click avoidance. Do not implement yet. Doppler is a separate parked Space card, not this DSP.

## Doppler

**Status:** under-construction module in Space. No DSP. Not Varispeed.

**Direction:** A parked card so the name exists. Moving delay-time pitch only. Do not implement the varispeed read head here.

## Unipolar switch on 1D displays

**Status:** not implemented. Plan only. Dated 2026-09-29. Do not implement until Architect expands this.

**Request (Argi, 2026-09-29):** a unipolar switch on every 1D display.

**Proposed meaning (not locked):** the repo already uses bipolar as -1...+1 and unipolar as 0...+1 (U2B / B2U; Sample Hold Polarity). 1D paint currently centers a bipolar span: 1D Phosphor clamps the sample to -1...1 around mid-height, and Instant Waterfall uses midY - bipolar * halfHeight (comment: bipolar +/-1 reaches the face edges). Reading the switch as "draw 0...+1 instead of -1...+1" is a proposal only. Argi did not specify the exact range or where the control sits.

**1D kinds found:** catalog labels in `public/node-graph-module-store.js` — 1D Waterfall (`waterfall`), 1D Waterfall Stereo (`waterfallStereo`), 1D Waterfall RGB (`waterfallRgb`), 1D Waterfall XYZ (`waterfallXyz`), 1D Phosphor (`lineBurnOscilloscope`), 1D Trace (`scope1dTrace`), 1D Trace Stereo (`scope1dTraceStereo`). Display Settings clipboard families in `public/node-graph-module-scope-trace-controls.js` also name 1D Phosphor (`lineBurn`), 1D Waterfall (`waterfall`, `waterfallRgb`, and `value`), and 1D Trace (`scope1dTrace`). `waterfallXyz` is catalog-labeled 1D Waterfall XYZ but that clipboard family returns 2D Instant Waterfall, so its membership is not locked. 2D Phosphor and 2D Trace are separate. No display-settings unipolar switch exists. Sample Hold Polarity remaps audio outs; its tooltip says the face/waterfall stays bipolar full height and ignores Polarity. `nodeGraphModuleScopeUnipolarTypes` is a module-id set and is not used by face paint.

**Still open:** exact range, which of the named 1D faces (including the waterfall-labeled ones and the XYZ mismatch), and control placement. Do not fold 1D Trace into the Instant Waterfall settings schema (`docs/APP_POLICY.md` section 15a). This seed does not prescribe DSP, worklet, or audio-thread changes.

## Display shaders

**Status:** plan + progress tracker in `docs/WEBGL_DISPLAY_PLAN.md` §12 (2026-10-06; GLSL-on-disk 2026-10-09; face wipe 2026-10-09): move per-pixel display math into GLSL on one shared WebGL context; audio stays native C++/WASM. Shipped present shaders that belong to a native module live as `.vert.glsl` / `.frag.glsl` next to that module’s wasm (`WEBGL_DISPLAY_PLAN.md` §12 §GLSL files next to WASM). Stop / power-off must use one face-wipe registry (`WEBGL_DISPLAY_PLAN.md` §12 §Face wipe registry, W1/W2). Do not start a G-row or W-row until Argi says go.

## Scope video out

**Status:** plan only, not started (2026-10-13, Argi via Thoughts). Plan + tracker: `docs/SCOPE_VIDEO_OUT_PLAN.md`. Every scope / videoscope / display gets a 📺 `rgba` out that re-publishes its GPU face picture through the existing `nodeGraphPicturePublish` (picture-device.js), so scopes can feed Video Delay and video feedback loops. Observers only (APP_POLICY §5 Live chaos and video), no per-type special cases, bypass/Stop follow face wipe W1. Do not start a VO-row until Argi says go.

## Electro Snare

Planned, not started; do not build until Argi says go. Plan: `docs/SNARE_PLAN.md`.

## Kick (SweepKicker)

Built as Robin Sinepulse (`robinSinepulse`, type 205), committed. Plan: `docs/KICK_PLAN.md`.

## Flat Zapper

Built as Robin Sinepulse Allpass (`robinSinepulseAllpass`, type 206), committed. Plan: `docs/KICK_PLAN.md` §Flat Zapper module.

## Electro Kick

Seed only, not final; separate from Kick. Moved to `docs/KICK_PLAN.md` §Electro Kick (2026-10-18). Planned (2026-10-19): `docs/DRUM_PACK_PLAN.md`.

## Electro Hat

Seed only, not final. Moved to `docs/SNARE_PLAN.md` §Electro Hat (2026-10-18). Planned (2026-10-19): `docs/DRUM_PACK_PLAN.md`.

## Electro Tom

Seed only, not final. Moved to `docs/SNARE_PLAN.md` §Electro Tom (2026-10-18). Planned (2026-10-19): `docs/DRUM_PACK_PLAN.md`.

## Stereo (module)

Seed only, not final (Argi, 2026-10-19, from the drum pack plan). A separate stereo module (width / spread processing) so drum modules such as Electro Hat need no Stereo Spread knob; their stereo comes only from per-channel noise. Behaviour, params and ports not specified yet. Native C++ only. Context: `docs/DRUM_PACK_PLAN.md` (Q6).

## Softpop Oscillator (pure tone ↔ noise)

**Status:** built (split into Softpop Oscillator + Softpop Filter 2026-10-14; Softpop 2 shipped 2026-10-17; committed and pushed (checked 2026-10-18)). Plans: `docs/SOFTPOP_PLAN.md`, `docs/SOFTPOP2_PLAN.md`. Original seed (2026-10-07), owner SandyModules: Redefine `softpopOscillator` in place as a native C++ oscillator. **Model** by stable name, default `filter` (TPT/ZDF SVF constant-peak bandpass on noise + √Q trim + effective-frequency tilt correction `(1000/fc)^(α/2)`, α = +1 white / 0 pink / −1 brown) or `sine`. No Purity. One fixed param set, every knob active in both models: Frequency, Width (noise bandwidth = Filter Q on a log scale, and mod-noise speed; no Mod Rate knob), Pitch Mod (cents, exponential), Amp Mod (level-preserving), Amplitude, Color, Stereo, Seed. I/O: Reset, `f` in; Mono / Left / Right out; no pitch input, no Trigger. Frequency-only like `polyBlep`: a wired `f` (Hz) replaces the Frequency knob; Pitch Mod and the tilt use that effective frequency. Independent seeded noise per target and channel (`seed_mix`). **Argi approved (2026-10-07, APP_POLICY §19)** extracting the TPT SVF and white/pink/brown noise into `library/include/soemdsp/filter/tpt_svf.h` and `math/noise_colors.h`, with EQ Filter and Noise Generator refactored onto them under a bit-identical regression test. Plan: `docs/SOFTPOP_PLAN.md`.

## Ohmicide Slew I / Slew II

**Status:** seed only — planning note captured 2026-10-08. Do not implement until Architect says go.

**Direction:** Port Ohm Force Ohmicide's **Slew 1** (amp slew-rate limiter / max `|dy/dt|` clip) and **Slew 2** (waveshaped slew rate distortion) as sandbox modules or modes. Useful dark edge-bevel / damage character for Softwave and general distortion.

**Key fact:** existing `slewLimiter` (Up/Down Slew) is time-to-target glide, **not** Ohmicide's slope-clip law. Real Slew I needs a max-delta clipper (new native or Rate mode). Slew II = that clip into `softClipper` / `tubeSaturation`.

**Have already:** `softClipper`, `tubeSaturation`, `gain`, `bias`, `mix`, `sampleHold`.  
**Missing:** true slope-rate clip.

Primary note:

```text
docs/OHMICIDE_SLEW_PLAN.md
```

## Soundemote product catalog + sandbox module plugin ports

Turn sandbox modules into products on soundemote.com: one shared plugin repo (`soemdsp-sandbox-plugins`, Sabrina shell; see `docs/PLUGIN_REPO_PLAN.md`) builds many CLAP/VST3/AU products, and the site gets each product from one data file + article (`/<slug>` root pages, auto-listed on `/plugins`). Sabrina Reverb is product #1. Planning only.

Primary note (in the site repo):

```text
soundemote-com/docs/PRODUCT_CATALOG_PLAN.md
```

## Plugin repo: soemdsp-sandbox-plugins (Sabrina shell, many products)

One shared plugin repo (`elanhickler/soemdsp-sandbox-plugins`, private) built from the Sabrina Reverb CLAP shell. Products differ only in DSP + params (`products/<slug>/product.json` + native kernel from `native_modules`). Sabrina is product #1. Planning only.

Primary note:

```text
docs/PLUGIN_REPO_PLAN.md
```

## Sidechain

**Status:** built (type 216, 2026-10-14, committed and pushed (checked 2026-10-18)); awaiting Argi's ear check. Plan: `docs/SIDECHAIN_PLAN.md`. Original seed (2026-10-14): New module **Sidechain**, a ducking helper reusing the Pump Limiter (`limiter` / `native_modules/pumping_limiter`) detector, hard-knee gain computer and gain smoother. Hold is new; Pump Limiter has none. Inputs: Left Dry, Right Dry, Left Wet, Right Wet, Sidechain, Envelope. Outputs: Left, Right. Params: Threshold, Ratio, Attack Time, Hold Time, Release Time. Proposed: the detector keys from Sidechain (else Dry); a wired Envelope (0..1) bypasses the detector as the duck amount; Wet is ducked; Out = Dry + g·Wet (crossfade is an alternative). Reuse via a shared `soemdsp/dynamics/pump_gain.h` needs Argi's APP_POLICY §19 approval. Native only, owner SandyModules once approved. Plan: `docs/SIDECHAIN_PLAN.md`.
