# Deletable Output and Input modules plan

Status: done locally 2026-10-19 (Grok Bot executor), not pushed. DO-1..DO-9 implemented; see tracker and section 7. Requested by Argi 2026-10-19; Round 2 answers 2026-10-19 (Input added, saved settings). Docs only; nothing committed. Path kept as `docs/DELETABLE_OUTPUT_PLAN.md`.

## 1. Goal

- The Output module (`type: "output"`) can be deleted like any other module. Deleting it really removes the node (and its cables) from the patch.
- It comes back only two ways:
  1. **Undo** (restores the exact node, id, position, settings and cables).
  2. Turning audio **on** with the **Output button** in the lower button bar (`#nodeLiveOutputButton`).
- The Output button keeps its current behavior exactly (toggle on/off; turning it off turns audio off; Input-only engine rules unchanged).
- The **only** place the app checks "does an Output exist?" is the audio-on edge. If none exists, it spawns one, then audio starts.
- Every other auto-spawn / ensure / "must exist" path is removed. No legacy shims.
- **Input (`type: "audioInput"`) gets the same treatment** (Argi, Round 2): deletable; comes back only via Undo or the lower-bar **Input button** (`#nodeLiveInputButton`) turning on, which spawns one if missing. Input button behavior otherwise unchanged.
- **Settings are never erased** (Argi, Round 2): when Output or Input is deleted, its settings (volume/amplitude, pan, display settings, title, etc.) stay saved in the patch. A respawned module restores them. The toolbar volume slider keeps working on the saved value while the module is gone.

## 2. Findings (current code, 2026-10-19)

### 2.1 How Output is protected from deletion today

| Where | What |
| --- | --- |
| `public/node-graph-selection.js` `nodeGraphNodeCanBeDeleted` (~L658) | Returns false for `type === "output"`, `audioInput`, and `id === "home"`. Comment: "Singleton app I/O, always present, never deleted (APP_POLICY)". This single gate feeds everything below. |
| `nodeGraphSelectionCanDelete` (~L679) | Delete is allowed only if some selected node passes the gate; also drives the Delete button `disabled` state (~L793-800). |
| `public/node-graph-context-menu.js` (~L1264, L1779, L2316) | Context-menu Delete `canDelete` uses `nodeGraphNodeCanBeDeleted`. |
| `public/node-graph-keyboard-shortcuts.js` (~L648) | Delete/Backspace key checks `nodeGraphSelectionCanDelete()`. |
| `public/node-graph-patch-core.js` delete action (~L2020) | Bails if `nodeGraphSelectionCanDelete()` is false; marquee multi-select delete goes through the same path, so Output is silently skipped. |
| `nodeGraphNodeDeleteHidesOnly` (~L674) | Dead `false && ...` stub left from the old Input "hide on delete" behavior. Remove (APP_POLICY §10b). |
| `public/modules/metamodule/metamodule-core.js` (~L482) | Output and Input cannot be grouped into a Metamodule ("keep out of groups for v1"). |
| `public/node-graph-module-actions.js` `copySelectedNodeGraphModule` (~L3407) | Output cannot be copied. |
| `docs/APP_POLICY.md` L191, L237 | Policy text: Output is a "singleton, unique, undeleteable"; "must not be deleted". |

### 2.2 Auto-spawn / ensure paths

- No `ensureOutput` function exists (unlike `ensureNodeGraphLiveInputModule` / `ensureNodeGraphMidiModule` in `node-graph-module-actions.js`). Output "always exists" because it cannot be deleted and because patches/presets ship it.
- `public/node-graph-default-preset.js` `nodeGraphDefaultPresetPatchIsUsable` (~L96): rejects a preset with no `id:"output"` node, so boot falls back to Init. `nodeGraphWorkingPatchShouldRestore` (~L140): a one-node patch without Output is not restored. These are implicit "must have Output" rules and must go.
- `nodeGraphPatchIsLegacyEfficientDefault` (~L125) uses `types.has("output")` only to fingerprint the old factory default. Harmless, but it is legacy detection; review under the no-shim rule.
- `public/node-graph-patch-core.js` normalize (~L246): throws `"output module id must be output"` if an Output has any other id. Keeps uniqueness by id.
- `public/node-graph-code-screen.js` (~L631-637): Circuit/code-screen planning maps any planned `output` to the existing id `"output"` and never creates one; breaks if Output was deleted.
- Shop: definition has `uniqueInPatch: true` (`node-graph-module-definitions.js` ~L806/14915/18021, verify which is Output). Output can be placed from the shop only when none exists.

### 2.3 What the lower-bar Output button does today

- `#nodeLiveOutputButton` (`index.html` ~L2649, `perform.html` ~L2643) → click → `toggleNodeGraphLiveOutput()` (`node-graph-live-runtime.js` ~L1214) → `setNodeGraphLiveOutputEnabled(!outputEnabled)` (~L1049).
- On: idempotent if already live/starting; if the engine is already up (Input-only) it just unmutes (`applyNodeGraphLiveOutputGain`); otherwise bumps `outputToggleSerial` and `startNodeGraphLiveAudio(serial)`.
- Off: mutes; tears the engine down only when Input is also off.
- It never touches the patch. Labels/colors in `node-graph-live-control-rendering.js` (~L94, L189-327).
- The Output module's own face toggle (`node-graph-module-actions.js` ~L2950-2974, `node.id === "output"`) also calls `toggleNodeGraphLiveOutput()`.
- Other callers that turn audio on: Input toggle (Input-only engine, ~L1020), transport Play/restart, `stopNodeGraphLiveEngineFully` (off only). Decision needed on which "audio on" edges spawn (see open question A).

### 2.4 Places that assume Output exists

| Area | Location | Assumption / risk |
| --- | --- | --- |
| Volume | `node-graph-live-runtime.js` `nodeGraphOutputModuleNode`, `get/setNodeGraphOutputModuleVolume(Db)`, `syncNodeGraphLiveOutputVolumeFromOutputModule` (~L163-337, L3772) | Master volume lives on the Output node; already falls back to -3 dB when missing. Toolbar volume slider (`node-graph-live-control-rendering.js` ~L585-627) writes to the node; with no node, decide what happens (open question C). |
| Execution plan | `node-graph-execution-plan.js` ~L412-712 | Already handles `hasOutputNode` false (visual sinks only; `speakerOutputActive` false). Verify no-Output + audio on is impossible after DO-3, and no-Output + visuals still runs. |
| Native graph | `node-live-audio-worklet-native-graph.js` ~L4753, 9318, 9462, 9585, 9665; `node-live-audio-worklet-scope-io.js` ~L71-166; `plugin-host.js` ~L358 | Output params, protected Left/Right reads, scope sink special-cases. Must tolerate absence (silence, no throw). |
| Patch normalize | `node-graph-patch-core.js` ~L246, L731, L853, L1767 | id must be `"output"`; `buttonsForceShow`; `In` port mapping; volume sync on commit. |
| Metamodules | `metamodule-core.js` ~L482 | Output excluded from groups. Keep excluded (open question F). Meta Out portals are separate and stay protected. |
| Perform view | `perform.html` button; scope slots `node-graph-module-scope-*.js` (`slot.type === "output"`) | Output face tile simply absent when deleted; verify layout/perform tile list does not throw on a stale Output tile. |
| Code screen | `node-graph-code-screen.js` ~L635 | Must spawn via the shared spawn function or skip if no Output. |
| Clone/settings | `node-graph-patch-clone.js` ~L359; settings forms ~L1451/1992/228 | Type checks only; fine. |
| Patch save | save writes `patch.nodes` as-is | A patch saved without Output stays without Output. No change needed beyond removing the "usable" checks. |
| Scripts/tests | `scripts/smoke_display_no_canvas_upload.mjs` ~L90 (already skips if no Output face); `scripts/migrate_all_patches.js` ~L46; `scripts/probe_output_right.mjs`, `smoke_graph_block_output_right.mjs` | Check each loads a patch with Output; add new smoke (DO-7). |

### 2.5 Input today (Round 2 study)

- **Protection:** same gate, `nodeGraphNodeCanBeDeleted` (`type === "audioInput"`), so context menu / key / toolbar / marquee all refuse it. Excluded from Metamodules (`metamodule-core` ~L482). APP_POLICY L237 "must not be deleted". `nodeGraphNodeDeleteHidesOnly` is the dead leftover of Input's old hide-on-delete.
- **Live Input button:** `#nodeLiveInputButton` (`index.html` ~L2616, `perform.html` ~L2610) → `toggleNodeGraphLiveInput()` (`live-runtime` ~L983). On: sets `inputActive`, **already calls `ensureNodeGraphLiveInputModule()`** (`module-actions` ~L9; spawns at a free spot near gx 0, gy 1, id `audioInput` or `audioInput-N`), sets route/mic status, then starts the engine (`startNodeGraphLiveAudio`) or `syncNodeGraphLiveInputSource()`. Off: stops the input source; tears down the engine only if Output is also off. Mic-permission failures keep Input armed with a blocked badge.
- **Other start paths:** `startNodeGraphMockInput` (~L935, test/mock harness) also calls `ensureNodeGraphLiveInputModule()`. Transport Play / Output-on do not touch Input.
- **Assumes Input exists:** `getNodeGraphAudioInputModuleLevel` (~L201, falls back to `live.inputVolume`), `setNodeGraphLiveInputVolume` (~L297), input-status list (`live-input-status.js` ~L133), runtime bypass of Input when not active (`patch-runtime.js` ~L17), face rendering (`module-rendering.js` ~L617, ~L1563), `buttonsForceShow` (`patch-core` ~L731), native-graph silence stub (`native-graph` ~L72). All type-based; most already tolerate absence.
- **Uniqueness:** shop `uniqueInPatch`, and `ensure` only spawns when none exists, but normalize does **not** force id `audioInput` (ensure can make `audioInput-2`). See open question I.

## 3. Behavior spec

Applies to Output; Input mirrors it (section 3b).

1. **Delete.** Output passes `nodeGraphNodeCanBeDeleted`. Context menu, Delete key, toolbar Delete and marquee delete all remove it with its cables in one undoable commit. Audio state is not changed by the delete itself (open question B for what plays while audio is on).
2. **Undo/redo.** Plain patch history. Undo restores the node with id `"output"`, settings, position and cables. Redo deletes it again. The audio-on spawn is its own undo step ("output module spawned"), committed before audio starts, so Undo after audio-on removes the spawned Output without turning audio off (it just goes silent).
2b. **Saved settings.** On delete, the module's full settings (everything except id and cables; position gx/gy included) are written to a patch-level store, e.g. `patch.ioModuleSettings.output` / `.audioInput`. It is saved with the patch, survives reload, and is never erased (overwritten only by the next delete of the same type). While the module exists, its node is the source of truth; while it's gone, the store is. Undo/redo restores the node itself, as normal.
3. **Audio-on check.** One function, e.g. `nodeGraphSpawnOutputModuleIfMissing()`, called only at the off→on edge inside `setNodeGraphLiveOutputEnabled(true)` (before the idempotent early-returns that matter, after the "already live" check). If an Output exists, do nothing. If not, create `createNodeGraphPatchNode("output", { id: "output", gx, gy })` and commit.
4. **Spawn position.** Respawn returns the module to its saved gx/gy from `patch.ioModuleSettings` (Argi, J). If that spot is occupied, use `nodeGraphFindFreeModuleGridPoint` nearest the saved spot. Only when nothing is saved (patch never had the module) use the fallback: `nodeGraphFindFreeModuleGridPoint("output", nodes, preferred)` where `preferred` = right of the rightmost visible module, vertically at the current view center row; if the camera can't see it, do not move the camera (D). Settings come from `patch.ioModuleSettings.output` if present, else defaults (-3 dB, pan 0). No cables auto-connected (Argi: good).
5. **Patch load without Output.** Loads as-is. No spawn, no error, no "unusable preset" fallback. Turning audio on later spawns one.
6. **Multiple Outputs.** Stay forbidden: id must be `"output"` (normalize keeps its check), shop `uniqueInPatch` stays, copy stays blocked. A loaded patch with two Outputs fails normalize as today (no silent repair). Paste/duplicate of Output stays blocked.
7. **Button.** Unchanged behavior, labels and colors. Output face toggle unchanged (it only exists when the module does).
8. **Volume slider with no Output.** Keeps working: reads/writes `patch.ioModuleSettings.output.volume` (seeded from defaults if absent); the engine is silent anyway since there's no speaker sink. A respawn picks the value up. Same for Input level via `setNodeGraphLiveInputVolume`.

### 3b. Input

- Deletable through the same gate; Undo/redo as Output; settings saved to `patch.ioModuleSettings.audioInput` on delete.
- The **only** spawn point is the off→on edge of `toggleNodeGraphLiveInput()`: its existing `ensureNodeGraphLiveInputModule()` call becomes the shared `nodeGraphSpawnIoModuleIfMissing("audioInput")` (restores saved settings and position, own undo step, rule 4).
- `startNodeGraphMockInput` is a test harness that simulates the button: it calls the same shared function (not a separate ensure).
- Deleting Input while it's on: input source stops feeding (nothing to route), button stays armed, no error.
- Patch load without Input: loads as-is.
- **Input id (Argi, I):** id is forced to `audioInput` like Output; normalize rejects other ids. A one-shot migration script rewrites existing `audioInput-N` patches (ids and cable refs) to `audioInput`, is run once, then deleted (no runtime shim).

## 4. Milestones

| ID | Milestone | Status |
| --- | --- | --- |
| DO-1 | APP_POLICY: replace "Singleton app I/O ... must not be deleted" (L191, L237) with: Output and Input are unique per patch and deletable; each returns only via Undo or its lower-bar button turning on (spawns if missing); their settings are saved in the patch and never erased. Add checklist row. | Done `db043232` |
| DO-2 | Allow delete of Output and Input: drop both from `nodeGraphNodeCanBeDeleted`; remove dead `nodeGraphNodeDeleteHidesOnly`; context menu, key, toolbar, marquee; one undo step. | Done `63f1951b` |
| DO-3 | Saved settings store `patch.ioModuleSettings.{output, audioInput}` = node fields minus id, including gx/gy (write only on delete, save/load with patch, normalize validates); volume getters/setters and toolbar slider read/write it when the module is absent. | Done `40d9cc24` |
| DO-4 | Shared `nodeGraphSpawnIoModuleIfMissing(type)`: Output called only from the off→on edge of `setNodeGraphLiveOutputEnabled`; Input replaces `ensureNodeGraphLiveInputModule` in `toggleNodeGraphLiveInput` and `startNodeGraphMockInput`. Restores saved settings and saved position (nearest free spot if occupied; fallback rule only when nothing saved), own undo step. Delete `ensureNodeGraphLiveInputModule`. | Done `ce169d18` |
| DO-4b | Input id: normalize forces `audioInput`; one-shot migration script for `audioInput-N` patches in the repo, run once, then delete the script. | Done `c7c60d55`, script removed `05430d3a` (103 repo patches, 3 Input modules, all already `audioInput`: 0 renamed) |
| DO-5 | Remove other must-exist paths: default-preset / working-restore Output checks; review `nodeGraphPatchIsLegacyEfficientDefault`; code-screen Output mapping uses DO-4 or skips. No shims. | Done `d3d65ea3` |
| DO-6 | Absence hardening for both: execution plan, native graph, scope IO, plugin host, input status, runtime bypass tolerate missing modules (silence, no throw, no console errors). | Done: verified, no code needed (audio on with Output/Input deleted: no throw, no console errors, visuals keep running) |
| DO-7 | Perform view / scope slots / layout canvas: no stale Output/Input tile after delete; tile returns on undo/spawn. | Done `b86deb40` |
| DO-8 | Smoke tests (section 5) as `scripts/smoke_deletable_io.mjs`; update any script that assumes Output/Input. | Done `8a733c6c`, `23d546c4` |
| DO-9 | Docs: progress entry, FUTURE_PLANNING status. | Done (this doc, progress, FUTURE_PLANNING) |

## 5. Smoke tests

1. Delete Output and Input via context menu, Delete key, toolbar Delete, and marquee: modules and cables gone; no console errors.
2. Undo restores each (id, position, settings, cables); Redo removes it.
3. Audio off, no Output, click Output button: one Output spawns (fallback spot if never saved, else saved position), audio starts, button green.
4. Set Output volume to -12 dB, delete Output, reload patch, click Output button: respawned Output has -12 dB and is back at its old position (or nearest free spot if occupied).
5. With Output deleted, move toolbar volume slider: no throw; value persists in the patch and the respawn uses it.
6. Audio on, delete Output: no throw, speaker silent, button follows real engine state; visuals keep running.
7. Output button off/on with Output present: no second Output.
8. Undo right after spawn removes the spawned module; audio state unchanged.
9. No Input, click Input button: one Input spawns with saved settings (amplitude etc.), engine starts or syncs; mic-blocked badge path unchanged.
10. Input on, delete Input: no throw, input stops feeding, button stays armed.
11. `startNodeGraphMockInput` with no Input spawns exactly one via the shared function.
12. Load patches without Output and/or Input: load unchanged, no spawn, no fallback to Init; boot restore keeps a one-module patch.
13. Two Outputs / wrong Output id rejected as today; shop allows Output/Input only when none exists; copy/paste of Output still blocked.
14. Input-only engine running, no Output, turn Output on: spawn, then unmute.
15. Perform view and mini perform view with Output/Input deleted, then restored.

## 6. Open questions

### Resolved (Argi, 2026-10-19)

- **A.** Only the Output button (and Output face toggle) turning on spawns Output. Play and Input-on don't. Input spawns only from the Input button (and the mock harness).
- **B.** Deleting Output while audio is on: audio stays on, speaker silent, nothing auto-stops. Same for Input.
- **C.** Volume slider keeps working on the saved value while Output is gone (section 3, rule 8).
- **D.** Fallback spawn spot (only when nothing is saved): free grid spot right of the rightmost module, view center row; camera doesn't move.
- **E/H.** Settings are saved in the patch and never erased; a respawn restores them. No auto-wiring.
- **F/G.** Input is deletable and part of this plan, mirroring Output.
- **I.** Input id forced to `audioInput`; one-shot migration of `audioInput-N` patches, then the migration code is deleted (DO-4b).
- **J.** Respawn returns the module to its saved position (gx/gy in the store); nearest free spot if occupied.
- **K (adopted default, not asked).** Store shape `patch.ioModuleSettings = { output: {...}, audioInput: {...} }`, node fields minus id, including position.
- **L.** Store updates only on delete; while the module exists its node is the source of truth.
- **M.** Output and Input both stay out of Metamodules.
- **N.** Cables are not restored on respawn; only Undo brings them back.

### New

- None open.

## 7. Implementation notes and deviations (2026-10-19)

- **Spawn hook.** Rule 3 says the Output check sits inside `setNodeGraphLiveOutputEnabled(true)`, but transport Play also calls it, and decision A says Play must not spawn. So the check sits on the off->on edge of `toggleNodeGraphLiveOutput()` (Output button, Output face toggle, external toggle) and of `soemdspSandboxSetLiveOutput(true)` (the external on/off switch that mirrors the button). Play never spawns.
- **Shop.** Adding Output/Input from the shop with none present now uses the fixed id (`output` / `audioInput`); before, it made `output-1`, which normalize rejects. A shop-placed module starts from defaults; the saved store is untouched.
- **Tooltip.** `actions.deleteUnavailableOutput` became `actions.deleteUnavailableProtected` (home and protected Metamodule portals are the only undeletable modules now).
- **Legacy default fingerprint.** `nodeGraphPatchIsLegacyEfficientDefault` was removed (no-shim rule): an autosaved old factory default now restores like any other session.
- **Code screen.** With no Output, a planned `output` is skipped with an error instead of spawning (only the Output button spawns).
- **Tiles.** A deleted Output/Input keeps its performance-canvas pin (delete, pin prune and save keep it) but shows no tile, so Undo and respawn bring the tile back at its rect.
- **Toolbar volume and Undo.** The toolbar slider writes in place without a history step (unchanged), so Undo of a delete restores the volume of the last committed state.
- **Migration.** Only repo patches were scanned (`patches`, `public/presets`, `saved-patches`, `library`, `fixtures`). Patches stored only in a browser (working patch, local saves) were not migrated; one with an `audioInput-N` id now fails to load with "audioInput module id must be audioInput".

