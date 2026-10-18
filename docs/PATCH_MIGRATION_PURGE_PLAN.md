# Patch migration purge plan

**Date:** 2026-10-18
**Status:** PM-1 through PM-4 done in soemdsp-sandbox (2026-10-18). PM-5 docs are updated. Gitignored build outputs were not rebuilt. The user note in section E was not posted.
**Policy:** APP_POLICY §1 "Patch migrations are one-shot" (Argi, 2026-10-18). Convert every stored patch to the current format once, then delete the migration code. `public/node-graph-patch-migrations.js` may remain as an empty hook (`migrateNodeGraphPatchToCurrent` with no migrators). Any future migrator must be run over all patches and deleted in the same change.

## What runs today

- `public/node-graph-patch-migrations.js` holds 26 migrators. Load path: raw JSON → `migrateNodeGraphPatchToCurrent` (called from `public/node-graph-patch-core.js` L191-192) → validate. index.html and perform.html load it as a script.
- Migrators: PhosphorLightNodes, SineWavetableDropAmplitudeJack, AdditiveFilterSlopeToDbOct, NoisyFreqAmountToAdd, AdditiveGeneratorWaveformsBasic, AdditiveGeneratorWaveformsPwm, GrowlHarmonicReduceToCutoff, ToQuantizeFreq, FrequencyMathBipolar, FrequencySkewCurveExpRational, PhaseRotationOutToGenerator, SlopeGeneratorToOut, AdditiveSlopeModel, GrowlToBubble, BubbleSlimParams, AdditiveEnvelopeMods, FrequencySlopeToSkew, BubbleBrickwallToDampen, NoisyAmountToAdd, AdditiveFilterCutoffToHz, OutputVolumeLinearToDb, MidSideGainLinearToDb, MetaPolyphonyToVoices, ValueSliderToKnob, V0ToV1, V1ToV2 (each prefixed `nodeGraphPatchMigrate`). Two were added after the no-migration policy: AdditiveSlopeModel (`798480ef`, 2026-10-10) and SlopeGeneratorToOut (`b783b26f`, 2026-10-11).
- Other migration code outside that file:
  - `node-graph-patch-core.js`: the local `migrateNodeGraphPhosphorLightToScope2d` fallback (L158-181, used L239-256).
  - `node-graph-patch-core.js` L566-567: `_…` migration stamps (e.g. `_wfBasic`, `_freqSkewCurve`) are kept through normalize and save so one-shot migrators stay idempotent.
  - `node-graph-default-patch.js` `nodeGraphResolveModuleTypeAlias` (L13: phosphorLight, gainBias, gainBiasMix, noisy …). This is a type-alias bridge of the kind §1 forbids. Audit it in PM-3 (code change, needs its own OK).
- Tests that use migrators: `scripts/test_keyboard_chord_memory.js` L235-239 slices `nodeGraphPatchMigrateMetaPolyphonyToVoices` out of the migrations file and tests it, and `scripts/smoke_test.py` references `node-graph-patch-migrations.js`.

## Inventory (scanned 2026-10-18, files with the patch-JSON signature)

Patch JSON top-level keys: `format`, `nodes`, `connections`, `graphConnections`, `modulations`, `cameras`, `activeCameraId`, `audio`, `bypassedNodes`, `codeScreen`, `grid`, `info`, `masterSeed`, `requiredAssets`. `patches/index.json` is an index (`{kind, version, base, patches}`), not a patch.

### A. Sources of truth, git-tracked: migrate these

| Repo | Path | Patches | Notes |
|---|---|---|---|
| soemdsp-sandbox | `patches/**/*.json` | 99 | Includes `init.json`. Subfolders: demo_patches 10, livedemos 7, guitar_pedals 6, modulator_breadboards 3, filter_breadboards 2, voice_breadboards 2, Soundemote_Softwave_prototypes 2, Alarm / demonstration / foley / hyperpluck / visuals 1 each; the rest at top level. |
| soemdsp-sandbox | `patches/index.json` | (index) | Regenerate or check if any path or name changes. |
| soemdsp-sandbox | `public/presets/default.json` | 1 | |
| soemdsp-sandbox | `saved-patches/` | 2 | bank000-program000-lorenz-demonstration…, bank001-program000-round-trip-test |
| soundemote-com | `public/soemdsp-sandbox/patches/` | 99 + index | Site copy of the sandbox patches. |
| soundemote-io | `public/soemdsp-sandbox/patches/` | 100 + index | Site copy; one patch more than com, so diff before re-syncing. |
| **Total** | | **301 patch files + 3 index files** | |

Patches embedded in JS (current format, built in code): `public/node-graph-default-patch.js` (offline Init fallback, `nodeGraphBlankStartupPatch`) and `public/node-graph-default-preset.js` (empty fallback; live Init is `patches/init.json`). Nothing to convert. Only check them in PM-4.

Test fixtures: no patch JSON or inline patch literals in `scripts/` (git grep). The one migration test is listed above.

### B. Build output, gitignored: regenerate, never edit by hand

| Repo | Path | Patch files |
|---|---|---|
| soundemote-com | `.output/` (also `dist/` when built) | 96 + index |
| soundemote-io | `dist/` | 96 + index |
| soemdsp-sandbox-audioplugin | `build/soemdsp-perform-pack/` | 99 + index |
| soemdsp-sandbox-audioplugin | `build/soemdsp-sandbox-audioplugin_assets/` (CLAP, VST3, Standalone) | 297 + 3 index |
| **Total** | | **588** |

Rebuild these after PM-2 lands.

### C. No patches

soundemote-dev, soemdsp-sandbox-plugins (plugin repo packs: none tracked), soemdsp-sandbox-standalone: 0.

### D. Stale fork: Argi decides

soemdsp-sandbox-native has no git remote, and its last commit is 2026-07-18. Tracked patches: `clap-plugin/graph-engine/test-fixtures/sine-to-output.json` (test fixture), `public/presets/default.json`, `saved-patches/` (2), so 4 files. Six files under `src-tauri/` matched the scan as well; check whether they are real patches or config. Default: out of scope unless Argi says otherwise.

### E. User-side: not migrated (note for users)

- Browser localStorage keys: `soemdsp-sandbox.patchPresets.v1` (saved patch presets, `node-graph-file-actions.js` L58), `soemdsp-sandbox.defaultPatch.live.v6` (live default-patch blob), `soemdsp-sandbox.userSession.startup.v1` (session).
- Patch files users exported or downloaded.
- Patch state saved inside DAW projects by the audio plugin (not verified).
- After PM-3 ships these may fail to load or load wrong (APP_POLICY §1: fail loud, no shims). Suggested note on the sites: "Patches saved in your browser or exported before <date> may not load. The bundled patches are updated. Re-create or re-save your own." Argi approves the text and whether to post it.

## Steps

| ID | Step | Done when | Status | Owner |
|---|---|---|---|---|
| PM-1 | Headless script (Node, e.g. `scripts/migrate_all_patches.js`): load each patch through `node-graph-patch-core.js` and `node-graph-patch-migrations.js` (the same path as app load), write the migrated JSON back with each file's line endings and indentation kept. Flags: `--check` (report only) and `--write`. Verify by round trip: migrating the output again is a no-op (byte-identical), and the output validates. Then optionally strip the `_…` migration stamps, which nothing needs once the migrators are gone, and validate again. Report any patch that throws or changes on the second pass. | The script exists; `--check` is clean on soemdsp-sandbox. | Planned | TBD |
| PM-2 | Run the script over every source in table A (sandbox, then the com and io site copies; native only if Argi includes it). Review the diffs per repo, spot-load a sample per folder in the app (audio and display), and diff the site copies against the sandbox (com 99 vs io 100). Land the converted JSON. | All table A files are in the current format; the round trip is a no-op everywhere. | Planned | TBD |
| PM-3 | Delete all 26 migrators. Keep `node-graph-patch-migrations.js` as an empty hook (`migrateNodeGraphPatchToCurrent` returns the patch, with a header comment stating the one-shot rule). Remove the migrator registration and the phosphorLight fallback in `node-graph-patch-core.js` (L158-181, L239-256), and the stamp-keeping rule at L566-567. Drop the migrator test block in `scripts/test_keyboard_chord_memory.js`. Audit `nodeGraphResolveModuleTypeAlias`. Same change as PM-2's final run, or right after it with no patch edits in between. | No migrator code is left; the hook is empty. | Planned | TBD |
| PM-4 | Tests and smoke: load every table A patch, plus the JS-embedded defaults, with the empty hook. No throw, no unknown module or param, plan compiles. Add the check to `scripts/smoke_test.py` or a new `scripts/test_all_patches_load.js`. | The check passes in CI or locally. | Planned | TBD |
| PM-5 | Docs and comments: move `docs/PATCH_MIGRATIONS.md` to `docs/archive/` and update its links (`docs/ARCHITECTURE.md` L60 and L173). Update the code comments: migration comments in `node-graph-patch-core.js`, plus the stale doc paths `public/node-graph-plan-roles.js` and `public/node-graph-patch-migrations.js` → `docs/archive/HIGH_RISK_HIGH_REWARD_PLAN.md`, `public/modules/rasterRgb/raster-rgb-gl.js` and `public/modules/spectrogram/spectrogram-gl.js` → `docs/WEBGL_DISPLAY_PLAN.md` §12. Also new since the 2026-10-18 archive: `public/index.html` L3150, `public/perform.html` L3142 and `public/node-graph-code-screen-loader.js` L1 → `docs/archive/CORE_REDUCTION_PLAN.md`. Then rebuild the table B outputs and post the user note (E) if Argi approves it. | No stale references; the builds are regenerated. | Planned | TBD |

## Push and permissions

- soundemote-com, soundemote-io and soundemote-dev (site repos) have the push-OK hotfix exception.
- Everything else (soemdsp-sandbox, soemdsp-sandbox-audioplugin, soemdsp-sandbox-plugins, soemdsp-sandbox-native) needs Argi's push permission for each change.
- PM-3 to PM-5 are code changes and need their own go-ahead. This plan is docs only.

## Risks

- A migrator that is not idempotent, or that depends on stamps, would show up as a non-empty second pass in PM-1. Fix the data, not the loader.
- Site copies that drift from the sandbox: prefer re-syncing them from the migrated sandbox over migrating them separately, once the com/io difference is understood.
- Other agents may edit `patches/` while PM-2 runs. Run on a clean tree and re-run `--check` just before landing.
