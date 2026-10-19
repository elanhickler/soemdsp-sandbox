## 2026-10-19 - Deletable Output and Input (done locally)

- Implemented `docs/DELETABLE_OUTPUT_PLAN.md` DO-1..DO-9 (Grok Bot executor, Argi via Librarian), local commits `db043232`..`23d546c4`, not pushed. Output and Input are deletable (one undo step, cables go too) and come back only via Undo or their lower-bar button turning on (`nodeGraphSpawnIoModuleIfMissing`; transport Play never spawns). On delete, settings and position go to `patch.ioModuleSettings` (saved with the patch, never erased); respawn restores them at the saved spot or the nearest free one. Toolbar volume / input level use the saved value while the module is gone. Input id forced to `audioInput` (one-shot migration: 0 of 103 repo patches needed it; script deleted). Must-have-Output boot checks and the legacy-default fingerprint removed. Smoke: `scripts/smoke_deletable_io.mjs`.

## 2026-10-18 - Zoom performance plan (docs only)

- Added `docs/ZOOM_PERF_PLAN.md` (Interface executing, Argi request): slow zoom with Play on was ~3 fps; target ~60 with displays running and zero `readPixels` / `getComputedStyle` / `offset*` during the gesture. Tracker ZP-1..ZP-7. ZP-1 done locally (`d895e36a` / `f2cd9bce`), not pushed. ZP-2 paused for Argi scope OK and owner handoff of the uncommitted play-blit `readPixels` path. Pointer in `docs/FUTURE_PLANNING.md`. Not committed.

## 2026-10-18 - Video graph plan (docs only)

- Added `docs/VIDEO_GRAPH_PLAN.md` (Argi via Interface; plan only, no code): one ordered GPU pass per video frame for 📺 nodes on the shared WebGL2 context, like the C++ audio graph. Tracker VG-0..VG-9, not started; waits for zoom work and Argi go-ahead; 7 open questions. Depends on ZP per-face textures. Pointer in `docs/FUTURE_PLANNING.md`. Not committed.

## 2026-10-18 - Resonant Envelope plan (docs only)

- Added `docs/RESONANT_ENVELOPE_PLAN.md` (Argi via Thoughts; exploration idea, not a committed build, owner TBD). Name confirmed **Resonant Envelope**; not "filter envelope", and not "Ping Envelope" (an existing module, documented in section 2 for context). Idea: a feedback envelope is a lowpass with its pole at DC; moving the pole off-axis makes it ring (radius = decay time, angle = ring frequency). Core: TPT SVF (`tpt_svf.h`, reuse needs Argi's OK) at envelope rate, Decay + Resonance (zeta = 4*200^-Resonance, dominant decay held). New `f` input (Softpop 2 convention, label ƒ) with Tracking 0..1, neutral at 440 Hz; Impulse (gate edge ping); Output Range Fit / Raw for overshoot vs the 0..1 / slider-clamp rules; native C++ only; WebGL2 shape preview from native. Milestones RE-1 (prototype and listening test) to RE-9, open questions A-J. Pointer in `docs/FUTURE_PLANNING.md`. Not committed.

## 2026-10-18 - Mini performance view Round 2: Performance view naming (docs only)

- Argi reversed the interim "Game view" label. User-facing name is **Performance view**: button "Show performance view [ F ]", mini "Mini performance view [ Shift+F ]", module setting "Show in performance view", page stays "Mini Performance View". Page icon planned 🖼️ → 🖥️ (code in local `4cc51840` still 🖼️ in `node-graph-unified-window.js` — change when implementing, not in this pass). Updated `docs/MINI_PERFORM_VIEW_PLAN.md` Round 2 (Design 6, MP-16, open question 9 settled), `docs/FUTURE_PLANNING.md`, `docs/PENCIL_PAGE_PLAN.md`. Behaviour unchanged. Not committed.

## 2026-10-18 - Mini performance view Round 2: Game view naming and mini modes (docs only)

- Revised Round 2 in `docs/MINI_PERFORM_VIEW_PLAN.md` (Argi): full-screen perform view is "Game view" in user-facing labels; top-bar 📱 becomes the labelled button "Show game view [ F ]" and, with F and the scene menu, calls one shared Game view cycle (off → Perform → Arrange → off). MP-16 rewritten (supersedes "phone opens perform only", never built); new MP-17: Shift+F cycles the mini view off → Perform → Arrange → off, independent of the Game view; mini Arrange drags tiles through `nodeGraphLayoutCanvasWriteRect` (mini view no longer purely read-only in Arrange). Scene menu proposal: Game view [ F ] + new Mini game view [ Shift+F ], legacy hidden buttons deleted. Mini stays hidden while the Game view is open (keeps its mode, drops Enlarged, cancels a tile drag). MP-14 tests, tracker updated; open questions 9-14. Not committed.

## 2026-10-18 - Mini performance view Round 2: Enlarged + phone button (docs only)

- Extended Round 2 in `docs/MINI_PERFORM_VIEW_PLAN.md` (Argi): MP-15 Enlarged (double-click frame/empty toggles large centred view, Escape exits, tile double-click still opens F; Escape precedence after screen-solo, before metamodule/chrome; F Escape unchanged); MP-16 top-bar phone button opens/closes perform only (never arrange); arrange stays on F key and scene menu. MP-14 tests cover both. Tracker `docs/FUTURE_PLANNING.md` now MP-10..MP-16. Not committed.

## 2026-10-18 - Mini performance view round 2 plan (docs only)

- Added Round 2 to `docs/MINI_PERFORM_VIEW_PLAN.md` (Argi; planned, owner TBD), tracker MP-10..MP-14: all four corners drag to resize (opposite corner fixed, ratio locked) and the frame drags to move with no snap, always on (Pointer / Click-through removed); default arrow cursor everywhere with GL corner marks on hover; page drops Corner, Margin, Width, Reference screen and Pointer; Aspect ratio becomes a wrapping button row (Window, 16:9, 4:3, 1:1, 9:16, Phone portrait, Phone landscape). No migration of removed per-machine settings. Six open questions. Not committed.

## 2026-10-18 - Color row plan (docs only)

- Added `docs/COLOR_ROW_PLAN.md` (Argi; planned, owner TBD, for an outside agent): app-wide rule that color widgets sit in horizontal rows of 2 to 4 (`docs/APP_POLICY.md` §21). RoundShape display settings is the reference; Keypad is the example violator. Inventory of 36 color surfaces (10 compliant, 16 violating, 9 single-color pending a decision, 1 exempt) with file and line, tracker CR-1..CR-7 (shared row helper, conversion batches, headless smoke test `check_color_rows`), open questions. Pointer in `docs/FUTURE_PLANNING.md`. Not committed.

## 2026-10-18 - Mini performance view plan (docs only)

- Added `docs/MINI_PERFORM_VIEW_PLAN.md` (Argi; planned, ready to implement, owner TBD): a live scaled copy of the F performance screen inside the circuit builder, turned on from a new Command Center page (Mini Performance View, Shift+F). GPU mirror of the pinned faces (no reparenting), WebGL2 only, uniform scale of the zoom-1 perform layout, read-only to the patch and transport. Tracker MP-1..MP-9 (MP-9 optional library edit needs Argi OK); pointer in `docs/FUTURE_PLANNING.md`. Not committed.

## 2026-10-18 - Pencil page plan (docs only)

- Added `docs/PENCIL_PAGE_PLAN.md` (Argi; planned, owner TBD): new Command Center Pencil page for hand-drawn notes on patches. Strokes are WebGL2 through gl-line-renderer, layers have Workspace / Screen / Module anchors and Behind / In front of modules, and drawings are saved in the patch as `drawings`. The mouse smoothing slider stays in the top bar. Round 1 done (pushed `3277ddc5`); tracker PE-1..PE-9 and open questions; pointer in `docs/FUTURE_PLANNING.md`. Not committed.

## 2026-10-18 - Patch migration purge plan + docs archive (docs only)

- Argi policy: patch migrations are one-shot (APP_POLICY §1). Added `docs/PATCH_MIGRATION_PURGE_PLAN.md` (inventory of every patch source, tracker PM-1..PM-5, owner TBD); pointer in `docs/FUTURE_PLANNING.md`; banner on `docs/PATCH_MIGRATIONS.md`.
- Closed and moved to `docs/archive/`: UNCONFUSE_REFACTOR_PLAN (4/4), CODE_CLEANUP_PASS_PLAN (9/9), CORE_REDUCTION_PLAN (12/16; the 4 open items are now FUTURE_PLANNING "Core shell standing items"). Not committed.

## 2026-10-18 - GPU workspace plan filed (docs only)

- Filed `docs/GPU_WORKSPACE_PLAN.md` (Argi): workspace picture GPU-only; app menu, bars and floating windows stay HTML. It owns the camera: GB-6 = GW-2, defined only there; `docs/WEBGL_DISPLAY_PLAN.md` GB-6 and `docs/PHONE_AND_GPU_CAMERA_PLAN.md` (now `docs/PHONE_COMPAT_PLAN.md`) now point at it (PH-6 and PH-5b still wait for GW-2). Added GW-7 (GL graph logs failure via `nodeGraphDisplayGlFailed`), seed-row PH-4 / GW-4 coordination, and Argi's Text Box decision: Text Box stays HTML, wires on two stacked canvases, per-box Behind wires / In front of wires, retire `nodeGraphGlGraphDrawTextBox`. Corrected stale `?glGraph=0` claims. APP_POLICY §16: displays WebGL2 only; Text Box is an editable-control exception. Planning only, not started, not committed.

## 2026-10-18 - Phone gestures PH-1..PH-5

- Shared pointer layer `public/node-graph-touch-gestures.js`: double-tap, 500 ms long hold, pinch, two-finger pan. Playlist double-tap uses it. Touch on a parameter double-taps to the default and long-holds into type-in. Seed double-tap still edits the code. First touch resumes the AudioContext through one call. Controls use `touch-action: none`; page pinch-zoom elsewhere stays. A floating tip shows hover text while the finger is down. GB-6 and PH-6 not started.

## 2026-10-18 - Phone + GPU camera plans merged (docs only)

- Merged `docs/PHONE_COMPAT_PLAN.md` and GB-6 into `docs/PHONE_AND_GPU_CAMERA_PLAN.md` (now `docs/PHONE_COMPAT_PLAN.md`) (one ordered tracker: PH-1..PH-5 and GB-6 in parallel, GB-6 before PH-6, PH-5b tooltip touch-up after GB-6, PH-7 last; file ownership; `nodeGraphMvp.pan` / `nodeGraphZoom` are the single camera API). `docs/WEBGL_DISPLAY_PLAN.md` GB-6 row now points there; GB-1 not-met note kept. Old file removed (was untracked). Not committed.

## 2026-10-18 - GB-6 True GPU camera planned (docs only)

- Added GB-6 to `docs/WEBGL_DISPLAY_PLAN.md` section 11 (Argi approved 2026-10-18; owner TBD): pan/zoom as a camera uniform only, no CPU reprojection, no CSS world-layer transform, HTML positioned per element. Noted that GB-1's uniform claim is not yet met. Cross-ref `docs/PHONE_AND_GPU_CAMERA_PLAN.md` (now `docs/PHONE_COMPAT_PLAN.md`) PH-6. Not committed.

## 2026-10-18 - Phone compatibility plan (docs only)

- Added `docs/PHONE_AND_GPU_CAMERA_PLAN.md` (now `docs/PHONE_COMPAT_PLAN.md`) (scope from Webby/Argi, repo findings, tracker PH-1..PH-7, coordination with ENGINE_STATE_DISPLAY_PLAN and WEBGL_DISPLAY_PLAN section 11); pointer in `docs/FUTURE_PLANNING.md`. Not started. Not committed.

## 2026-10-17 - Seed code: done

- Argi confirms the seed code plan is implemented (`docs/SEED_CODE_PLAN.md`, status set to done). Docs note only. Not committed.

## 2026-10-17 - Engine state and displays plan (docs only)

- Added `docs/ENGINE_STATE_DISPLAY_PLAN.md` (rules, findings, tracker ES-1..ES-6) and APP_POLICY section 3b "Displays and engine state"; pointer in `docs/FUTURE_PLANNING.md`. The Playlist fix in the GL graph agent's uncommitted `?v=page-always-1` work must be committed together. Not committed.

## 2026-10-17 - Seed code plan (docs only)

- Added `docs/SEED_CODE_PLAN.md` (Thoughts' plan + hex addendum verbatim, notes from the repo); pointer in `docs/FUTURE_PLANNING.md`. Planning only. Not committed.

## 2026-10-17 - Script language plan (docs only)

- Added `docs/SCRIPT_LANGUAGE_PLAN.md` (Thoughts' plan verbatim + Policy check); pointer in `docs/FUTURE_PLANNING.md`. Planning only, no implementation until Argi says so. Not committed.

## 2026-10-17 - Softpop 2

- Shipped native `softpop2` (type 219): sine dispersing into band-limited Color noise. Blue/Violet on Softpop Oscillator, Softpop Filter, and Noise Generator. Tilt/decramp in `library/include/soemdsp/filter/softpop_band.h`. Combined wasm + livedemo `patches/livedemos/softpop2.json`.

## 2026-10-16 - Softpop2 plan (docs only)

- Added `docs/SOFTPOP2_PLAN.md` (Thoughts' plan verbatim + Policy check); See also in `docs/SOFTPOP_PLAN.md`. Implemented 2026-10-17.

## 2026-10-16 - Circuit builder GL, cables and grid (GB-1)

- Screen-space WebGL cables and grid (`public/node-graph-gl-graph.js`). Pan/zoom reprojects a cached polyline list. SVG wires and the CSS grid hide while it is on. Default on; `?glGraph=0` restores the old draw (2026-10-18: that switch no longer exists in code; the GL graph is always on). Look is approximate.

## 2026-10-16 - DAW plugin plan (docs only)

- Added `docs/DAW_PLAN.md` in soemdsp-sandbox-audioplugin (DAW-1..8, rename to Sandbox, open decisions); pointer in `docs/FUTURE_PLANNING.md`. Not committed.

## 2026-10-16 - Circuit builder to GL plan (docs only)

- Added section 11 "Phase 2: circuit builder to GL" (GB-1..GB-5) to `docs/WEBGL_DISPLAY_PLAN.md`; cross-linked the shared glyph atlas with `docs/MUSIC_PLAYER_METADATA_PLAN.md`; pointer in `docs/FUTURE_PLANNING.md`. Planned; another agent executes. Not committed.

## 2026-10-15 - Music Player metadata plan (docs only)

- Added `docs/MUSIC_PLAYER_METADATA_PLAN.md` (tracker MM-1..MM-9, open questions) and linked it from `docs/FUTURE_PLANNING.md`. Planned, not started; Argi must OK step 1. Not committed.

## 2026-10-14 - Sidechain waterfall dips from the top (local commit)

- Argi: reduction displays dip from the top. Sidechain Envelope maps 0 = top, 1 = bottom (waterfall amp gain -2, offset 1); APP_POLICY 3 line added; smoke checks the orientation. Not pushed.

## 2026-10-14 - Sidechain display fix: Envelope on Instant Waterfall (local commit)

- Root cause: the worklet named Sidechain's Saw tap "Saw", so the display source "Envelope" never got data, and the Saw tap was not in the face ring list. Fixed in the existing port-name / ring tables. Stale cache-bust strings (combined wasm, worklet, definitions, waterfall, form) bumped.
- Argi rejected the full-redraw limiterGainFace: Pump Limiter is back on, and Sidechain now uses, Instant Waterfall (already WebGL: history texture scroll + new-column stamps). limiterGainFace file and WebGL plan row 18 restored. Mono waterfall line colour labelled Line for these two; Background already labelled Background.
- Smoke: worklet port-name / ring / definitions / waterfall-map checks. Not pushed.

## 2026-10-14 - Sidechain: Mix / Ducked Mix crossfade, Envelope out, shared GL gain face (local commit)

- Argi: mix law is now an equal-gain crossfade `out = Dry(1-m) + Wet m`, `m = lerp(Mix, Ducked Mix, env)`; new params Mix (0.35) and Ducked Mix (0) after Release Time; old Dry + g*Wet path removed. New Envelope output (duck amount, or the Envelope input when wired). Bypass = Dry.
- Pump Limiter's face was the Canvas 2D Instant Waterfall on Gain. The unused `limiterGainFace` is now WebGL2 via gl-line-renderer and is the face of both Pump Limiter (Gain) and Sidechain (Envelope). Removed from the WebGL migration table.
- Sidechain smoke rewritten for the new law plus face geometry; full smoke passes. Not pushed.

## 2026-10-14 - Sidechain module (type 216, local commit)

- Argi: implement `docs/SIDECHAIN_PLAN.md`. New native `native_modules/sidechain/sidechain.cpp` (module-local copy of the Pump Limiter detector/gain plus Hold), graph-engine type 216, worklet params/ports, definition with tooltips, store card, efficient-product, build entry. Inputs Dry L/R, Wet L/R, Sidechain, Envelope; outputs Left/Right.
- Defaults (isolated constants): key = Sidechain else Dry; out = Dry + g·Wet; Envelope gives g = 1 − e and bypasses the dynamics; bypass = Dry + Wet. No face yet.
- New `scripts/smoke_graph_sidechain.mjs` (in the combined build) and smoke_test export list. Full smoke passes. Local commit only, not pushed.

## 2026-10-14 - WebGL display policy + Softpop split docs (docs only)

- New `docs/WEBGL_DISPLAY_PLAN.md`: WebGL2 + shaders only for module displays, one interface (`gl-line-renderer.js` on `picture-device.js`'s shared context), no 2D fallback, explicit exceptions, migration table of 39 modules, shared display-canvas helper + shrink-only smoke allowlist. APP_POLICY 3 rewritten to match; FUTURE_PLANNING pointer.
- `docs/SOFTPOP_PLAN.md` updated for the split: Softpop Oscillator (Source / Morph / Width swing limit) and new Softpop Filter (old Filter model + Mono/Left/Right inputs replacing the noise). No commit.

## 2026-10-14 — Product catalog plan for soundemote.com (docs only)

- Filed `soundemote-com/docs/PRODUCT_CATALOG_PLAN.md`: data-driven products (`src/content/products/<slug>.json` + `.md`, zod checks, `$slug` root route, shared install paths, checkout-ready schema) and a shared "sandbox module plugin ports" repo based on `soemdsp-sandbox-audioplugin`. Seed added to `docs/FUTURE_PLANNING.md`. Git remotes moved off the soundemote org (sabrina-reverb-clap, jerobeam-modules, soemdsp, soemdsp-sandbox-native). No commit.

## Agent Rules
- Do not ask questions unless truly blocked.
- Make reasonable assumptions and continue.
- Work on unfinished TODOs in order.
- Mark completed TODOs with [x].
- Add new bugs, ideas, or follow-up work as TODOs.
- Run smoke tests (`python scripts\smoke_test.py`) after each fix.
- Build native modules after editing `native_modules/*.cpp`.
- Do not run destructive commands, force pushes, production deploys, or database resets.
- When editing sandbox source, restore `public/presets/useruisettings.json` and `useruisettings.js` from commit `4639c84` before running smoke tests (the test's UI settings update contract writes them back dirty).
- Never put JavaScript on the audio path: no JS DSP evaluators, no restoring `create*State` / worklet-evaluator twins for allowlisted natives. Fix `setPlan` / native GraphEngine instead. Missing native = silence or refuse — never stubs.

## Bugs

Plan: **`docs/BUG_PLAN.md`** — numbered inventory (B-001…). User reports go in that file’s Inbox; do not start a second list.

## Graphify

Plan: **`docs/GRAPHIFY_WINS_PLAN.md`** (primary work queue).

```text
graphify update . --force   # no LLM; AST re-extract
# → graphify-out/GRAPH_REPORT.md  (gitignored)
```

### Parked (0.5.0 RGB)

- [ ] **Slider buffered modulation** — destination slider paints the real `readEffectiveParameter` buffer (occupancy + caret). Plan: `docs/SLIDER_BUFFERED_MODULATION_PLAN.md`. Do not start unless asked.

### Where we are
- **Track 1** Code Screen peel — **complete enough**: Box, Lookup, Registry, Workspace, Render (main shell ~1.8k events + script APIs)
- Scopes / Display Settings peels done; event-binder god-nodes stay fat
- **Dead CSS** — opportunistic; standing item in `docs/FUTURE_PLANNING.md` "Core shell standing items"
- **Product backlog** — `docs/FUTURE_PLANNING.md`

## Active / hygiene

- [x] Peel `node-graph-module-scope-settings-ui.js` by symbol cluster (form-io / field-edit / apply / window)
- [x] Speed Limit runtime-only; EQ 0 Hz; UI Settings action row fixed height (`4d25266`)
- [x] Scope paint gate (single live/pause/schedule policy)
- [ ] Ongoing: dead CSS when found (FUTURE_PLANNING "Core shell standing items")
- [x] `graphify-out/` gitignored (local analysis only)

## Backlog Ideas

The product backlog lives in **`docs/FUTURE_PLANNING.md`**, one section per idea with its own status line. Do not keep a second copy here (rebuilt 2026-10-18; the old list is in `docs/archive/progress-archive-2026-09.md`).

Sections there: GPU-only workspace picture (2026-10-18) · Zoom performance (2026-10-18) · Video graph (2026-10-18) · Phone compatibility + GPU camera (2026-10-18) · Engine state and displays (2026-10-17) · Seed code (2026-10-17) · Sandbox Script Language (2026-10-17) · Sandbox DAW plugin (2026-10-16) · Circuit builder to GL (2026-10-16) · Music Player metadata, Album Art, rich Text Box (2026-10-15) · WebGL2 displays everywhere (2026-10-14) · Slider buffered modulation (destination = real effective-param history) · Lo-Fi Pitch Shift (component-first) · Dropdown Window Buttons · Inlets / outlets above displays (app-wide) · Instant Waterfall Display Settings (premium look + amp law) · Waterfall redesign (amp-per-frame bars) · True metamodule parameter mirror · Keytracking / pitch-tracking modulation UI · Circuits on a keyboard (play like a sample library) · Dimensional parameter prototyping · Delay with exposed feedback path · Name-based choice persistence · AcidSequencer · VU meter · Varispeed Delay · Doppler · Unipolar switch on 1D displays · Display shaders · Scope video out · Electro Snare · Kick (SweepKicker) · Flat Zapper · Electro Kick · Electro Hat · Electro Tom · Softpop Oscillator (pure tone ↔ noise) · Ohmicide Slew I / Slew II · Soundemote product catalog + sandbox module plugin ports · Plugin repo: soemdsp-sandbox-plugins (Sabrina shell, many products) · Sidechain.

Open items tracked outside that file:
- [ ] JS DSP removal (audio native WASM/C++ only) — in progress (updated 2026-10-06). Landed in `9c3a4d7d` (pushed 2026-10-04): Speaker Protector 2 native (Render Sample uses `createNodeGraphNativeEarProtector`, no JS fallback), live-worklet decimator native (`native_modules/rapt_elliptic_decimator/`), all 50 dead `*-math.js` deleted. `node-graph-musical-engines.js` deleted in `87b1b517`. Top blocker now: Render Sample still runs a JS copy of the rapt elliptic decimator in `public/node-graph-render-output.js`. Open list: `docs/BUG_PLAN.md` → **Cleanup** → **C-001** → State (2026-10-06). Do not commit/push without Argi's ok.
- [ ] **Sabrina instance handles** — multi-instance (`docs/INSTANCE_HANDLE_PATTERN.md`)

## Notes

- Plugin export / host packaging is **out of scope** for this repo (Make Plugin stays disabled placeholder).
- Use `graphify update .` after substantial code changes; open `graphify-out/GRAPH_REPORT.md` or `graphify god-nodes` / `graphify query "..."`.


