# Plugin Repo Plan: `soemdsp-sandbox-plugins`

**Status:** plan only, nothing built or pushed. Filed 2026-10-14.
**Repo:** `github.com/elanhickler/soemdsp-sandbox-plugins` (private, created by Argi 2026-10-14). Sabrina history pushed 2026-10-14: `main` = `8da83ea4378b0486fb78e80ad3cc5a78a42406eb`, no tags.
**Basis:** the **Sabrina Reverb** plugin shell (`C:\Users\argit\Documents\_PROGRAMMING\sabrina-reverb-clap`), **not** `soemdsp-sandbox-audioplugin`.
**Rule:** every product shares the shell (CLAP/VST3/AU via clap-wrapper, engine, UI, presets, CI/release) and differs only in **DSP + parameters**. Every plugin looks like Sabrina.
**Site side:** `soundemote-com/docs/PRODUCT_CATALOG_PLAN.md` (each product's `release.repo` points here).

## 0. Decisions recorded (Argi, 2026-10-14)

- **History push:** done. `main` @ `8da83ea4378b0486fb78e80ad3cc5a78a42406eb` pushed with `git push plugins main:main` (no tags, no other branches). Gitlinks for all 17 submodules came along. `libs/soemdsp` → `https://github.com/elanhickler/soemdsp.git` (commit `05f840b`). Uncommitted local work in sabrina-reverb-clap was **not** pushed: `dsp/sabrina_reverb.cpp` (12+/12−) and the `libs/sst/sst-plugininfra` userdefaults.h edit (the CMake MSVC patch writes it at configure time).
- **Licensing:** JUCE **Starter** licence (free, closed source allowed up to US$20K revenue). Still open, see the GPL list below.
- **Repo visibility:** stays **private**. See the download caveat in §4.
- **Look:** every product uses Sabrina's exact look. No per-product themes.
- **Version:** the first release from the new repo is `sabrina-reverb-v0.2.0`.
- **Old repo archive:** deferred. Ask Argi again at PR-13.

### GPL3 dependencies (open item)

Checked `libs/` LICENSE files 2026-10-14:

| Submodule | License | Linked by the shell? |
| --- | --- | --- |
| `sst-basic-blocks` | **GPL3** | **Yes** (`ParamMetaData`, `Lag`, `LagCollection`, linked `sst-basic-blocks`) |
| `sst-filters` | **GPL3** | submodule only, not in the link list |
| `sst-effects` | **GPL3** | submodule only |
| `sst-waveshapers` | **GPL3** | submodule only |
| `sst-plugininfra` | "majority MIT" (mixed, check per file) | Yes (filesystem, tinyxml, strnatcmp, patchbase, version_information, userdefaults) |
| `sst-jucegui`, `sst-cpputils`, `sst-clap-helpers`, `sst-voicemanager` | MIT | Yes (jucegui, cpputils, clap_juce_shim) |
| `clap`, `clap-helpers`, `clap-wrapper` | MIT | Yes |
| `JUCE` | AGPLv3 / commercial (Starter) | Yes (Starter covers closed source) |
| `fmt`, `simde`, `MTS-ESP`, `magic_enum` | permissive | Yes / headers |

Even with JUCE Starter, the shell today is GPL3 through `sst-basic-blocks` (and any GPL files in `sst-plugininfra`), and patch.h's own header says the combined work is GPL3. A closed-source release would need to:
1. replace `sst-basic-blocks` uses (`ParamMetaData` → our own descriptor from `product.json`, `LinearLag`/`LagCollection` → soemdsp smoothers);
2. audit `sst-plugininfra` per file and replace any GPL parts (patch-base, userdefaults) or confirm they're MIT;
3. drop the unused GPL submodules (`sst-filters`, `sst-effects`, `sst-waveshapers`) from the repo;
4. keep the sidequest MIT attribution, and keep each kernel's own licence (Sabrina DSP MIT, Walter Hackett).

Open: GPL3 open-source for every product, or do the replacements for closed-source paid products?

## 1. What sabrina-reverb-clap is today (verified 2026-10-14)

- Origin: baconpaul/sidequest-startingpoint ("Sidequest Base Start", 41 commits on `main`, pack about 405 KiB, so history is small). The license header says the source is MIT, but the GPL3 dependencies (JUCE / sst) make the combined work GPL3. The face links JUCE (AGPLv3 note in headers).
- Build: CMake 3.28, `make_clapfirst_plugins(...)` gives CLAP + VST3 + AUV2 + standalone. 17 submodules: sst-*, clap, clap-wrapper, clap-helpers, JUCE, MTS-ESP, fmt, simde, `libs/soemdsp` (= `elanhickler/soemdsp`, submodule's own origin still soundemote). magic_enum via FetchContent.
- DSP: `dsp/sabrina_reverb.cpp` (36 KB), a vendored copy of sandbox `native_modules/sabrina_reverb/sabrina_reverb.cpp`, with a C ABI (`soemdsp_sabrina_reverb_create/destroy/reset/set_params/process/left/right/is_idle/advance_mod/delay_times…`), plus `dsp/include/soemdsp/{constant,debug,math}` and `runtime/{msvc_builtins.h,wasm_simd128_shim}` so the sandbox kernel compiles natively.
- CI: `.github/workflows/build-plugin.yml`: windows / macos-universal / linux (docker ubuntu20_gcc11) matrix, archives `Sabrina-Reverb-{windows.zip,macos.zip,linux.tgz}`, release on tag `v**` when owner is soundemote or elanhickler. macOS signing is commented out.

### Generic shell vs Sabrina-specific

| Area | File(s) | Generic | Sabrina-specific |
| --- | --- | --- | --- |
| Build | `CMakeLists.txt` | clapfirst setup, sst/JUCE linking, day-of-year AU version bump, sst userdefaults patch | `project(sabrina-reverb-clap)`, `PRODUCT_NAME "Sabrina Reverb"`, `PRODUCT_VERSION "0.1.6"`, `PATCH_EXTENSION ".sabrina"`, `BUNDLE_IDENTIFER/clap id "org.soundemote.sabrina-reverb"`, `cmrc` namespace `sabrina_patches`, links `soemdsp::sabrina` |
| DSP build | `cmake/soemdsp.cmake` | plugin-support lib (curve/string helpers), runtime shim includes, MSVC flags | `SABRINA_SRC`, target `soemdsp-sabrina` |
| CLAP entry | `src/clap/plugin-clap-entry*.cpp`, `plugin-clap.cpp` | factory, AUv2/VST3 info factories, params/state/audio-ports/GUI extensions | features `AUDIO_EFFECT, STEREO, REVERB`, manufacturer "Soundemote" (shared), stereo effect port layout |
| Params | `src/engine/patch.h` (`SabrinaNode`, idBase 500, 11 params with names/groups/ranges/defaults) and `src/engine/soem-params.h` (`SabrinaSoemParams`, the same 11 again plus a hand `byClapId` switch 500..510) | `Param`, `PatchBase`, `unit01/unitRange/intMd` helpers, group sorting ("Main" first), patch versioning/migration hooks | the whole table, **written twice**, which is the main blocker |
| Engine | `src/engine/engine.{h,cpp}`, `sabrina-api.h` | blockSize 8, sample-rate handling, UI↔audio queues, idle/silence detection, gesture counting | `sabrinaHandle`, `syncSabrinaParamsFromPatch()` (positional `set_params(mix, …, lfoStyle)`), per-sample `process/left/right`, `advance_mod`, `delay_times(out14)` for the face, `amp` post-gain |
| Presets | `src/presets/preset-manager.*` | user/factory folders, cmrc factory loading, natural sort, host param rescan | vendor path `("Soundemote","SabrinaReverb")`, `cmrc::sabrina_patches`, `.sabrina`. `resources/factory_patches/` doesn't exist (glob empty) |
| UI | `src/ui/plugin-editor.*`, `main-panel.*`, `patch-data-bindings.h`, `ui-defaults.h` | window panel, zoom/skin/screen-size defaults, `PatchContinuous/PatchDiscrete` bindings, right-click version menu | namespace `soundemote::sabrina::ui` everywhere |
| Face | `src/ui/sabrina-face.{h,cpp}` (24 KB) | `SabrinaSlider` (sandbox-style slider, type-in), `SabrinaTitleBar`, palette `kModuleFill/kFaceBg/kPosition/…` (sandbox colours), Cascadia Mono font, the GL line shader | `SabrinaWaterfall` (14 delay-time stems), the slider list/order, title text |
| Resources | `resources/` | `ReadmeZip.txt` (install text), mac `entitlements.plist`, `Icon.icns`, `License.txt` | product name inside ReadmeZip/License |
| CI | `build-plugin.yml` | the whole matrix and the docker linux build | `TARGET_NAME`, `PLUGIN_NAME`, archive names, tag `v**` |
| Namespaces/guards | everywhere | n/a | `soundemote::sabrina`, `SOUNDEMOTE_SABRINA_*` |

How params bind today: the host param id (500+i) goes to `Patch` `Param` (sst ParamMetaData, the value the host sees) and to `Engine::handleParamValue`. `syncSabrinaParamsFromPatch` copies the values into `SabrinaSoemParams` (soemdsp `Parameter`, linear vs mapped), then a positional C call into the kernel. The UI binds `SabrinaSlider(paramId)` through `PatchContinuous/PatchDiscrete`. So adding a param today means editing patch.h, soem-params.h, engine.cpp, sabrina-api.h, the kernel and the face.

## 2. Proposed layout

```text
soemdsp-sandbox-plugins/
  CMakeLists.txt              # includes shell, loops products/*
  cmake/
    add_product.cmake         # add_product(<slug>)
    compile-options.cmake  CmakeRC.cmake
  shell/
    clap/                     # entry, factories, plugin-clap (generic)
    engine/                   # Engine, Patch built from descriptor table
    presets/                  # PresetManager (vendor/ext from product)
    ui/                       # editor, panel, bindings, defaults
      face/                   # SeSlider, SeTitleBar, palette/theme, GL helpers
      viz/                    # optional shared visualisers (stems/waterfall, scope)
    product-api.h             # the interface below
    resources/                # ReadmeZip.txt.in, entitlements, License template
  runtime/                    # msvc_builtins.h, wasm_simd128_shim (shared)
  dsp-common/include/soemdsp/ # constant/debug/math headers shared by kernels
  products/
    sabrina-reverb/
      product.json            # identity + params + layout (source of truth)
      dsp/sabrina_reverb.cpp  # kernel (vendored from sandbox native_modules)
      adapter.cpp             # binds C ABI to ProductKernel (small)
      viz/                    # optional product visual (Sabrina stems)
      presets/*.sabrina       # factory presets
      assets/                 # icon.icns, ReadmeZip extras
    <next-slug>/ …
  libs/                       # same 17 submodules, soemdsp included
  tests/                      # shell tests + per-product parity tests
  .github/workflows/build.yml
```

`product.json` is turned into `products/<slug>/generated/product_desc.h` at configure time by a small CMake/Python step, so C++ gets a `constexpr` table and there's no JSON parsing at runtime.

```json
{
  "slug": "sabrina-reverb",
  "name": "Sabrina Reverb",
  "version": "0.1.6",
  "clapId": "org.soundemote.sabrina-reverb",
  "auCodes": { "manufacturer": "SoEm", "subtype": "SbRv" },
  "kind": "audio-effect",
  "features": ["audio-effect", "stereo", "reverb"],
  "io": { "in": 2, "out": 2 },
  "presetExt": ".sabrina",
  "vendorFolder": "SabrinaReverb",
  "license": "MIT-DSP+GPL3",
  "sandboxModule": "reverbEffect",
    "params": [
    { "key": "mix", "id": 500, "name": "Mix", "group": "Main", "type": "float",
      "min": 0, "max": 1, "default": 0.43, "format": "percent" },
    { "key": "lfoStyle", "id": 508, "name": "Mod(~)Style", "group": "Mod", "type": "choice",
      "default": 0, "choices": ["Parabol", "FBM"] },
    { "key": "seed", "id": 509, "name": "Seed", "group": "Mod", "type": "int",
      "min": 0, "max": 16777215, "default": 0 }
  ],
  "layout": { "order": ["mix","diffusionSize","diffusionAmount","delaySize","recycle",
                        "lfoAmplitude","lfoBaseSpeed","lfoVariation","lfoStyle","seed","amplitude"],
              "viz": "sabrina-stems" }
}
```

Param ids are stable forever, because hosts store automation by id. The generator fails if an id is reused or changed between versions (it checks against a committed `params.lock`).

### `add_product(<slug>)`

Reads `product.json` and generates the descriptor header. It builds `<slug>-impl` from `shell/*` + `products/<slug>/{dsp,adapter.cpp,viz}`, embeds `presets/` with cmrc (namespace `<slug>_presets`), defines `PRODUCT_*` from JSON, and calls `make_clapfirst_plugins(TARGET_NAME <slug> OUTPUT_NAME "<name>" BUNDLE_IDENTIFER <clapId> PLUGIN_FORMATS CLAP VST3 AUV2 STANDALONE_CONFIGURATIONS …)`. Top level: `-DSE_PRODUCTS=all|sabrina-reverb;…`.

### CI / releases

- Matrix `os × product`. The product list comes from a setup job that reads `products/*/product.json`, or from the tag.
- Tag `<slug>-v<version>` (e.g. `sabrina-reverb-v0.2.0`) builds and releases only that product. The tag must equal `product.json` version or the job fails.
- Push/PR builds every product for every OS (smoke test).
- Artifacts: `<Name-With-Dashes>-windows.zip`, `-macos.zip`, `-linux.tgz` (e.g. `Sabrina-Reverb-windows.zip`), matching the site schema. Release URL: `github.com/elanhickler/soemdsp-sandbox-plugins/releases/download/<slug>-v<ver>/<file>`.
- The publish job's owner check becomes `elanhickler` only (drop `soundemote`).
- macOS signing/notarisation stays a TODO (secrets), shared by all products.

## 3. The product interface (`shell/product-api.h`)

A product provides exactly three things, and the shell has no `if (slug == …)`:

```cpp
namespace se::product {
struct ParamDesc { uint32_t id; const char* key; const char* name; const char* group;
                   enum Type { Float, Int, Bool, Choice } type;
                   double min, max, def; Format fmt; const char* const* choices; };
struct Descriptor { const char* slug; const char* name; const char* version;
                    const char* clapId; const char* const* features;
                    uint32_t inChannels, outChannels;
                    const ParamDesc* params; size_t numParams;
                    const char* presetExt; const char* vendorFolder;
                    LayoutSpec layout; };          // generated from product.json

struct Kernel {                                    // implemented by adapter.cpp
  virtual ~Kernel() = default;
  virtual void prepare(double sampleRate, int maxBlock) = 0;
  virtual void reset() = 0;
  virtual void setParam(uint32_t index, double mappedValue) = 0; // by table index
  virtual void process(const float* const* in, float* const* out, int frames) = 0;
  virtual bool isIdle() const { return false; }
  virtual void advanceIdle(int frames) {}          // Sabrina's advance_mod
  virtual size_t vizData(float* out, size_t max) { return 0; } // e.g. 14 delay times
};
const Descriptor& descriptor();
std::unique_ptr<Kernel> makeKernel();
std::unique_ptr<juce::Component> makeViz(VizHost&); // optional, nullptr = none
}
```

How the shell uses it:
- `Patch` builds its `Param`s by looping over `descriptor().params` (no more `SabrinaNode`). The `SabrinaSoemParams` duplicate is deleted. If soemdsp `Parameter` linear/mapped curves are needed, they're built from the same table.
- `Engine` calls `kernel->setParam(i, v)` only for changed params (dirty flags), and `process` per block (8 frames today). Post-gain `amplitude` stays a normal param that the kernel handles. Sabrina's adapter keeps its per-sample loop inside `process`.
- UI: `SabrinaFace` becomes `SeFace`. It lays out one `SeSlider` per `layout.order` entry (choice params as segmented sliders, like Lfo Style), with the title bar showing `descriptor().name`, and the optional `makeViz` panel above the sliders. Palette and font live in `shell/ui/face/theme.h`. No per-product themes (Argi, 2026-10-14): every product uses Sabrina's exact look. Products differ only in sliders (from params) and an optional viz panel.
- Presets: the extension, vendor folder and cmrc namespace come from the descriptor.
- Namespaces become `soundemote::shell` and `soundemote::products::<slug>`.

## 4. Migration of Sabrina (repo history)

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| **(a) Keep history** | `git push` sabrina-reverb-clap `main` (41 commits, about 0.4 MiB) into the empty repo, then restructure in follow-up commits (`git mv src shell`, `git mv dsp products/sabrina-reverb/dsp`, …) | `git log --follow`/blame survive, the sidequest attribution is in history (helps the MIT/GPL credit), cheap because the history is tiny | the old `v0.1.x` tags come along. Delete them from the new repo or never push them, so they don't clash with the `<slug>-v` scheme |
| (b) Fresh import, squashed | copy the tree, one "Import Sabrina Reverb shell from elanhickler/sabrina-reverb@8da83ea" commit | clean start | blame lost, provenance only in a message |

**Recommend (a)**: push only `main`, no tags (`git push <new> main`, not `--tags`). It needs Argi's OK for the push. The restructure is a series of reviewable commits; each must still build Sabrina and pass parity before the next.

**Old releases:** leave `elanhickler/sabrina-reverb` and its v0.1.4–v0.1.6 releases untouched, because soundemote.com links `…/sabrina-reverb/releases/download/v0.1.6/…`. The first release from the new repo is `sabrina-reverb-v0.2.0` (or `v0.2.0`). Then:
1. CI publishes `sabrina-reverb-v0.2.0` with the same artifact names.
2. The site's `sabrina-reverb.json` changes `release.repo` → `elanhickler/soemdsp-sandbox-plugins` and `tagPrefix` → `sabrina-reverb-v`, `version` → `0.2.0` (one hotfix push; release-sync fills in the sizes).
3. Old URLs keep working forever, because old releases are kept.

**Private-repo download caveat:** the repo stays private, so its release assets are **not publicly downloadable** (they need GitHub auth). Before soundemote.com links to any new-repo release, the archives must be published somewhere public. Open question for Argi:
- mirror the release archives to the public `elanhickler/sabrina-reverb` releases (same names, tag `v0.2.0`). The simplest option, but it's per product (each product needs a public repo);
- Lovable storage (`.asset.json` stubs, like the existing `Sabrina-Reverb-*.asset.json`);
- a future checkout / download host (Lemon Squeezy/Paddle file delivery, R2/S3), which fits paid products.
In that case the site's `release.repo` points at the public mirror, not at `soemdsp-sandbox-plugins`.

**Archiving the old repo:** deferred by Argi (2026-10-14). Ask again when PR-13 is reached. Recommendation: after the first new-repo release is live on the site, add a README banner "moved to soemdsp-sandbox-plugins" and archive it (read-only, releases stay downloadable). Never delete it. Note the KVR thread links there.

**Plugin identity must not change** across the move: CLAP id `org.soundemote.sabrina-reverb`, VST3/AU ids, param ids 500–510, `.sabrina` preset format and patchVersion. Otherwise DAW sessions break. A test asserts this against `params.lock`.

## 5. Porting a sandbox module into a product

1. Pick a native module in `soemdsp-sandbox/native_modules/<key>/` (170 there). Only native C++ kernels qualify. APP_POLICY: DSP is native only, JS is UI/observer, and no JavaScript DSP is ever ported or rewritten in JS. A module whose DSP is still JS must first be ported to native in the sandbox (C-001 rules).
2. Vendor the `.cpp` into `products/<slug>/dsp/` with its `// soemdsp-native-module:` header kept. Shared math headers go in `dsp-common/` (or later, the shared library from `soemdsp`). Record the source sandbox commit in `product.json` (`sandboxCommit`).
3. Params: generate the `params` array from the sandbox module definition (`public/node-graph-module-definitions.js`: knob keys, labels, ranges, defaults, choice labels) with a `tools/import-sandbox-module.mjs <key>` script. It **reads** definitions only and emits JSON, so that's not JS DSP. Argi then picks the host-facing subset, order and groups, and assigns ids (`idBase + i`, never reused).
4. Write `adapter.cpp`, mapping the module's C ABI (`soemdsp_<key>_create/set_params/process…`) to `Kernel`.
5. Parity test: render a fixed input through the sandbox native build and through the plugin kernel, and require a bit match or ≤1e-6. Same idea as the Kick parity test.
6. Add `presets/`, an icon/viz if any, then `add_product` picks it up automatically. Add the site `<slug>.json` + `.md` per the catalog plan.

Inputs/outputs: start with stereo effects (2→2). Instruments (note/MIDI input, Trigger) need a `kind: "instrument"` shell path (note ports, voice handling via sst-voicemanager, already a submodule). That's planned as a separate row.

## 6. Tracker

| ID | Item | Status |
| --- | --- | --- |
| PR-1 | Push sabrina-reverb-clap `main` (no tags) into `soemdsp-sandbox-plugins` | Done 2026-10-14, `8da83ea` (verified on GitHub) |
| PR-2 | Restructure: `src/` → `shell/`, `dsp/` → `products/sabrina-reverb/dsp/`, `runtime/`, `dsp-common/` | Done locally 2026-10-14, `f7132bb` (not pushed) |
| PR-3 | `product.json` schema + generator → `product_desc.h`, plus `params.lock` check | Done locally, `2ffbb95`: CMake `string(JSON)` generator `cmake/product_json.cmake` → `build/generated/<slug>/product_generated.h` (not pushed) |
| PR-4 | `product-api.h` (`Descriptor`, `Kernel`, `makeViz`) + Sabrina adapter | Done locally, `c81db67`: `shell/product/product-api.h` (Kernel), `product-face.h` (Face, makeFace), `products/sabrina-reverb/src/sabrina-kernel.cpp` (not pushed) |
| PR-5 | `Patch` built from the descriptor. Delete `SabrinaNode` + `SabrinaSoemParams` duplication | Done locally, `2ffbb95` (not pushed) |
| PR-6 | `Engine` uses `Kernel` (dirty-param push, block process, idle) | Done locally, `c81db67`: block process + idle via Kernel. Params still pushed every block (no dirty flags yet, keeps golden identical) (not pushed) |
| PR-7 | Generic `SeFace` from `layout.order` + theme file. Sabrina stems → `products/sabrina-reverb/viz` | Partly: sliders follow `layout.order` (`2ffbb95`), face is behind `se::product::Face`/`makeFace` (`c81db67`). Still open: move SabrinaSlider/TitleBar/palette into `shell/ui/face/`, waterfall into `products/sabrina-reverb/viz/` |
| PR-8 | Presets from the descriptor (ext, vendor folder, cmrc namespace) | Done locally, `c81db67` (cmrc namespace is now `se_presets` for every product) (not pushed) |
| PR-9 | `cmake/add_product.cmake` + `SE_PRODUCTS` selection | Done locally, `a6c5793` (not pushed) |
| PR-10 | Identity regression test: clap id, param ids, preset load of a v0.1.6 `.sabrina` file | Partly, `2ffbb95`: test checks clap/patch id, patchVersion 2, `.sabrina`, 11 params with ids 500–510. Still open: load a real v0.1.6 `.sabrina` preset file |
| PR-11 | Sabrina parity test: new repo output == sabrina-reverb v0.1.6 output | Done locally, `46c422d`: golden FNV-1a hash `158daa45d1c696c3` (48 kHz, block 8, 4 s impulse+noise, fixed params + one automation step) recorded from the unmodified pushed code and unchanged after every commit (not pushed) |
| PR-12 | CI: OS × product matrix, `<slug>-v<ver>` tags, artifact names, owner = elanhickler | Written, not run, `98bd1b8`: `.github/workflows/build.yml` (not pushed) |
| PR-13 | First release `sabrina-reverb-v0.2.0` + public download host + site switch (catalog plan) | Not started |
| PR-14 | Old repo: banner + archive (deferred, ask Argi again at PR-13) | Not started |
| PR-15 | `tools/import-sandbox-module.mjs` (definitions → params JSON) | Not started |
| PR-16 | Product #2 ported from `native_modules` (Argi picks) | Not started |
| PR-17 | Instrument shell path (note ports, voices) | Not started |
| PR-18 | macOS signing + notarisation secrets | Not started |
| PR-20 | `products/sabrina-reverb/ReadmeZip.txt` still links the old Sabrina repo under the banned GitHub org; change it to the elanhickler repo | Not started |
| PR-21 | Rename leftover shell identifiers (`soundemote::sabrina` namespace, `SabrinaPlugin`, `sabrina_*_factory`, header guards) to neutral names | Not started |
| PR-19 | Fix `libs/soemdsp` submodule's own remote (soundemote → elanhickler) in the new repo | Not started |

### Restructure log (2026-10-14, local only, not pushed)

Clone: `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox-plugins`. Each commit was built (CLAP + VST3 + tests, VS 2022 x64 Release) and passed the golden render with `scripts/verify.ps1`:

| sha | step |
| --- | --- |
| `46c422d` | golden render test + verify script |
| `f7132bb` | move to `shell/` + `products/sabrina-reverb/` |
| `a6c5793` | `add_product(<slug>)`, `SE_PRODUCTS` |
| `2ffbb95` | `product.json` single source, generated table, `params.lock`, identity test, version 0.2.0 (no tag) |
| `c81db67` | `product-api.h` Kernel + Face, shell has no Sabrina branches |
| `98bd1b8` | CI workflow (not run) |

The DSP file is byte-identical to `8da83ea`. Argi's uncommitted DSP edit in sabrina-reverb-clap was not carried over.

## 7. Open questions for Argi

1. **Licensing per product** (JUCE Starter chosen, GPL3 sst items open, see §0): the shell links JUCE + sst (GPL3/AGPL), so every build is GPL3 unless JUCE is commercially licensed. Paid closed-source products would need a JUCE licence (or a non-JUCE UI) and sst parts relicensed or replaced. Should each product carry its own DSP licence (Sabrina's MIT from Walter Hackett) on top of the GPL3 build?
2. **Plugin ID scheme:** keep `org.soundemote.<slug>` for CLAP/bundle ids (Sabrina already uses it)? AU manufacturer code (4 chars, one for all) and per-product subtype codes, and VST3 class-id derivation. Who assigns them, and where is the registry kept (`products/IDS.md`)?
3. ~~**Themes:**~~ answered: Sabrina's exact look, no themes. Old text: one fixed Sabrina look for all, or a `theme` key (palette/accent only, same layout)?
4. **Visualisers:** can products have their own viz panel (like Sabrina's stems), or are only shared viz types allowed?
5. ~~**Private → public:**~~ answered: stays private. Open instead: **public download host** (see §4 caveat). Old text: when does the repo go public: at the first release, or never (release assets need a public repo or a separate public release mirror for soundemote.com downloads to work without auth)? **Important:** private-repo release downloads aren't public, so the site switch (PR-13) needs the repo public, or releases mirrored to a public repo.
6. ~~Version on the move~~ answered: `sabrina-reverb-v0.2.0`.
7. **Old tags:** fine to leave `v0.1.x` tags only on the old repo?
8. **Max params / fixed host slots:** Sabrina has 11. Is there a cap (soemdsp-sandbox-audioplugin used a fixed 32)?
9. Does `soemdsp-sandbox-audioplugin` (patch-player host) continue separately, or get shelved?
