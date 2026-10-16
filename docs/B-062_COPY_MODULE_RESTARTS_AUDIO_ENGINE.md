# B-062 - Non-audio UI changes restart audio engine

**Status:** fixed (2026-10-16)  
**Severity:** hear  
**Source:** user 2026-09-27 (inert module copy); user 2026-09-28 (Text Box deletion)

## User symptom

Copying a module restarts the audio engine even when the copied module is not connected and is doing nothing. Deleting a Text Box also restarts the audio engine, even though a Text Box is non-audio UI with no live audio role. These unnecessary restarts interrupt otherwise-running audio.

## Repro

1. Run a patch with live audio.
2. Reproduce either case:
   - Copy a module and leave the new copy unconnected and otherwise inert.
   - Delete a Text Box.
3. Observe the audio-engine restart or interruption.
4. Compare with a change that actually alters the active audio graph, such as connecting the copied module.

## Investigation / fix shape

`commitNodeGraphPatch` posted a live plan for every commit that was not layout, face, or chrome. Copying or deleting a Text Box took that path. A failed `soemdsp_graph_process_block` (`compiled == false`) then cleared `nativeGraphCompiled`, and the next sync called `soemdsp_graph_clear`.

Chrome types (Text Box and the other efficient-product chrome set, except named portals) now commit with `skipLivePlan`. A normal module title does too. Named-portal titles still post a plan because the title is the bus key. `process_block` returning -1 recompiles the existing nodes and does not clear `nativeGraphCompiled`.

## Verification target

With audio already running, copying an unconnected inert module or deleting a Text Box should preserve engine/session continuity and produce no restart gap or click. Connecting the copy, or making another change that affects live audio execution, should still receive whatever live update is required. Listen check not run in this change; the commit flags and the process_block path are what the code now does.

## Verification target

With audio already running, copying an unconnected inert module or deleting a Text Box should preserve engine/session continuity and produce no restart gap or click. Connecting the copy, or making another change that affects live audio execution, should still receive whatever live update is required.