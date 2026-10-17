# Sandbox Script Language Plan

Source: Thoughts agent for Argi, 2026-10-17. Planning only, no implementation until Argi says so.

**Goal:** Argi's own small, C-like language for writing simple DSP classes with state, doing math, and modulating parameters at audio rate (first use: experimenting with decay envelope curves). It compiles to WASM and runs in the worklet at near-native speed. **Never JS in the audio path** (hard rule).

**Decisions so far (Argi, 2026-10-17):**
- Our own language, built in stages. Not AngelScript (its JIT can't run inside WASM, so it would be interpreter-only and too slow), not Faust (Argi: "nevermind faust"), not AssemblyScript.
- C-style syntax without C's ugly parts: no pointers, no `new`/`malloc`/`free`, no headers, no macros, no garbage collector.
- Scope: simple DSP classes with state, math, audio-rate modulation of params.
- Don't hand-roll the compiler plumbing. Reuse libraries: a parser generator (Lezer preferred, since it also gives editor syntax highlighting; Chevrotain or Ohm are alternatives) and **Binaryen** for WASM generation, optimization and validation. The browser's WASM engine compiles to native code.
- Displays: a `display { ... }` block of raw GLSL inside the same script (Argi likes this).

**Decisions (Argi, 2026-10-17, round 2):**
1. **Parameter sets:** fixed per compiled script, keyed by declared name. A recompile that removes a name drops its cables and modulation, with no shim.
2. **Audio engine:** one `Script` module type on the native allowlist; each compiled script runs inside it.
3. **Displays:** add a new user-shader-quad primitive to `gl-line-renderer.js` / the shared picture device. No exception.
4. **`process()` runs per sample.**

**Decisions (Argi, 2026-10-17, round 3):**
1. **Loops:** only `for` loops with fixed compile-time bounds. No `while`.
2. **Numbers** (Argi delegated to efficiency and long-term stability): `float` is the default (f32), `int` is i32. Implicit int -> float widening is allowed; float -> int needs an explicit cast; no implicit narrowing.
3. **Editor:** a Code page in the Command Center, showing the selected module's script when it is a Script module.
4. **Libraries:** a package manifest or bundled libraries are both acceptable; the implementer chooses. Binaryen is lazy-loaded.
5. **Use real mod values:** yes, script params receive raw values in "Use real mod values" mode.

## Language sketch
```
class OnePole {
  float z;
  float tick(float x, float k) { z += k * (x - z); return z; }
}

param float decay = 0.5;   // slider, audio-rate modulatable
in float gate;
out float y;

OnePole lp;
float t;

void process() {
  t = gate > 0.5 ? 0 : t + dt;
  y = lp.tick(exp(-t / decay), 0.01);
}
```
- Types: `float`, `int`, `bool`, user classes, fixed-size arrays (`float buf[512];`).
- `in`/`out` declarations become the module's jacks. `param` declarations become sliders whose values arrive per sample (audio-rate modulation), clamped to slider range per app policy.
- Built-ins: `exp`, `sin`, `cos`, `pow`, `log`, `abs`, `min`, `max`, `clamp`, `floor`, etc., plus `dt` and `sr`.
- Classes: fields + methods; instances declared at top level, laid out in fixed state memory at compile time, and they keep their state across samples. No inheritance or virtuals (maybe simple interfaces later). Implementation is the standard lowering: a struct in linear memory plus functions taking its offset.
- Real-time rules from day one: all sizes known at compile time, no allocation in `process()`, fixed-bound loops, no strings/closures/exceptions/dynamic containers.

## Display block
```
show float env;
display {
  float d = abs(uv.y - env);
  out_color = vec4(vec3(smoothstep(0.02, 0.0, d)), 1.0);
}
```
- The `display { ... }` body is raw GLSL fragment code. The compiler takes everything up to the matching brace as text and compiles it on the shared WebGL2 picture device, drawn on the module's face quad. Editor highlights it as GLSL. Same pattern as Vue/Svelte blocks or Unity `CGPROGRAM` blocks.
- Built-in shader inputs (Shadertoy-style): `uv`, `time`, `resolution`, plus `prev` = last frame's image for trails or phosphor (read previous frame only, same rule as video feedback).
- The image can publish on the module's 📺 video output via `nodeGraphPicturePublish` (`public/lib/visual/picture-device.js`).
- **Values over time, audio to display**, carried on the worklet's existing scope ring-buffer path (audio writes, display reads, never re-simulated):
  - `show float x;` = latest value per frame, as a uniform.
  - `show trace float x[512];` = ring buffer of recent samples (every sample or every Nth), uploaded each frame as a 1-pixel-tall texture; shader reads `trace(x, uv.x)`.
  - `show peak float x;` = min and max since last frame, so spikes between frames aren't lost (like the waterfall columns).

## Architecture
- Compiler runs in JS on the main thread (never the audio thread): parse (Lezer grammar), type check, lay out state memory, emit WASM via Binaryen, instantiate, hand the module to the worklet.
- Keep parser, checker and code generator as separate stages so each language stage only adds parts.
- Worklet glue: a "Script" module type that calls the compiled `process` per block, maps `in`/`out`/`param` to graph ports and control sinks, and exposes `show` buffers.
- Errors with line and column shown in the module editor. A failed compile keeps the last good build running (or outputs silence).

## Stages (each usable on its own)
1. **Expressions:** one-line `y = exp(-t * k)` with math, built-ins, inputs and params, in a Script module. Covers decay-curve experiments.
2. **Statements and state:** multi-line, locals, `if`/`else`, ternary, state that persists across samples (`prev`, phase accumulators).
3. **Functions and fixed arrays.**
4. **Classes:** fields and methods, top-level instances.
5. **Display block:** GLSL `display {}`, `show` / `show trace` / `show peak`, `prev`, 📺 video out.
6. **Polish:** good error messages, a small standard library written in the language (filters, noise, envelopes), multiple outputs.

## Open questions for Argi
- Language name and file extension. Candidates: Sandscript `.sand`, Emote `.emo`, Tick `.tick`, Grain `.grain`, Soe `.soe`.
- ~~Loop syntax.~~ **Resolved (round 3):** `for` with fixed compile-time bounds only, no `while`.
- ~~Integer/float conversion rules.~~ **Resolved (round 3):** f32 default, i32 int, implicit int -> float only, explicit cast for float -> int.
- ~~Is `process()` per sample or per block?~~ **Resolved (round 2):** per sample.
- ~~Where the editor lives.~~ **Resolved (round 3):** Code page in the Command Center, showing the selected Script module's script.
- How scripts are saved: embedded in the patch JSON, as separate files, or both. Suggested: embedded in the patch JSON.
- ~~Package manifest vs bundled libraries for Lezer / Binaryen.~~ **Resolved (round 3):** implementer chooses; lazy-load Binaryen.
- ~~How a `param` behaves in "Use real mod values" mode.~~ **Resolved (round 3):** raw values.

## Policy check (Grok Bot, 2026-10-17)

Checked against `docs/APP_POLICY.md`, known Argi policies and the current repo.

**Paths and dependencies**
- `public/lib/visual/picture-device.js` exists; `nodeGraphPicturePublish(nodeId, texture, width, height)` is at L115 (exported L289). `nodeGraphPicturePublishCanvas(nodeId, canvas)` (L178) also exists.
- **Lezer and Binaryen are not dependencies today.** **Resolved (round 3):** either a package manifest or bundled libraries is fine (implementer chooses); lazy-load Binaryen. There is no `package.json` in the repo (none tracked; `node_modules/` is gitignored and holds only `playwright` / `playwright-core`). No Lezer, Binaryen, Chevrotain or Ohm anywhere. Adding them means adding a package manifest or vendoring browser builds under `public/` (decide which; Binaryen's JS/WASM build is several MB, so load it only when a Script module is opened).

**No JS DSP (APP_POLICY §0b L244-256, §2 L283): complies, with one rule to state.**
- The compiler in JS on the main thread is fine: it is authoring/tooling, not audio. The audio path is the compiled WASM.
- **A failed compile must never fall back to JS** (no interpreter, no JS evaluator of the script). Only "keep the last good build" or silence, as the plan says. State this as a hard rule in the Script module.
- ~~Integration gap~~ **Resolved (round 2):** one `Script` module type on the native allowlist; each compiled script runs inside it. Original note: the efficient worklet runs the native graph (`processNativeGraphQuantum`) and refuses foreign types with `not in efficient build` (L244). The Script module is a runtime-compiled WASM module, not a catalog native. Plan how it joins the graph (instantiate it inside the worklet and have the native graph call it per block through an import/table slot) and get it added to the allowlist explicitly, so it isn't treated as a foreign JS type.

**Displays WebGL2 only (APP_POLICY §3 L315-321): complies.** **Resolved (round 2):** new user-shader-quad primitive in `gl-line-renderer.js` / shared picture device, no exception.
- The `display {}` block is GLSL on the shared picture-device WebGL2 context, so it is GPU-only.
- §3 says every display draws through the one interface `gl-line-renderer.js` (begin / rect / segment / polyline / end). A user fragment shader on the face quad is a different path. Decided: add it as a new primitive in `gl-line-renderer.js` ("user shader quad", L321: new primitives go there, never into a module); no exception in `docs/WEBGL_DISPLAY_PLAN.md` section 5.
- Text: text is not a primitive; any text in a script display must use the glyph-atlas texture (APP_POLICY L321, `docs/WEBGL_DISPLAY_PLAN.md` section 8). The shared atlas is also planned for the Music Player Text Box and circuit builder GL (`docs/MUSIC_PLAYER_METADATA_PLAN.md`, `docs/WEBGL_DISPLAY_PLAN.md` section 11).
- Shader compile errors should also show line/column; a failed shader goes black and logs via `nodeGraphDisplayGlFailed` (no 2D fallback).

**Observers never re-simulate (APP_POLICY L33, L348): complies.** `show` / `show trace` / `show peak` read the worklet's scope ring buffers; the display never runs the script again.

**Modulation clamped to slider range (APP_POLICY L622): complies.** `param` values are clamped to the slider range per sample. Note the "Use real mod values" mode: there the cable is a raw unit and not clamped to the range; **resolved (round 3):** script params receive the raw value in that mode.

**📺 video port (APP_POLICY §11): complies if** the script's video out shows the 📺 emoji to users with internal id `rgba`, never the text "RGBA".

**Fixed parameter sets: resolved (round 2).** Fixed per compiled script, keyed by declared name; a recompile that removes a name drops its cables, no shim. Original note: Scripts generate jacks and params from `in` / `out` / `param` declarations, so the set changes when the script changes. That conflicts with the fixed-parameter-set rule. Proposed rule (now adopted): the set is fixed per compiled script (no change at runtime); params are identified by their declared name (choices/params persist by stable name, APP_POLICY "Choice / enum persistence"); a recompile that removes a name drops its cables and modulation (no shim, §1).

**Port labels: rule to apply.** Stereo pairs declared in a script use the `<name> L` / `<name> R` form (bare `Mono` / `Left` / `Right` OK). Jack inventory must match what the script actually computes (APP_POLICY L432: no stereo ports on mono-only modules).

**Amplitude spawn 0-1: rule to apply.** A script `param` named Amplitude (or any amplitude param in the standard library) spawns with range 0-1.

**Library maths reuse (APP_POLICY §19 L629-639): rule to apply.** Built-ins (`sin`, `cos`, `exp`, `pow`, `log`, `clamp`, ...) should map to `library/include/soemdsp` where an equivalent exists (e.g. the shared sine LUT `dsp_sin_turns_lut`, APP_POLICY L294, and `scalar_helpers.h` `clamp01`), so scripts match native modules. Practical path: compile the needed library functions to WASM once and import them into the script module, rather than re-implementing them in Binaryen IR. Any new library helper needs Argi's approval.

**No legacy shims (APP_POLICY §1): complies.** New module type, no old behaviour to preserve. Keep it that way: old saved scripts that no longer compile show the error and run silent, with no compatibility mode.

**Also related:** the existing **Code** module (`codeBox`, `docs/CODE_BOX_AND_TEXT_CATEGORY.md`) is a control-plane document box for Graph curve JSON and "not a programming language". The Script module is separate; don't overload `codeBox`.
