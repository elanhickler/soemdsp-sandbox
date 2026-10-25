# B-115 — Deleted Text Box leaves glyphs and a draggable hit target

Report ID: B-115  
Status: open  
Severity: see  
Source: user 2026-10-25 (Argi), sandbox audioplugin  
Related: B-055 (Text Box annotation mount); GPU text layers `#nodeGraphTextFront` / `#nodeGraphTextBehind`

## User symptom

Add a Text Box, type in it, delete the Text Box. The **body / plate is gone**, but the **text stays on the graph**, still **draggable**, with no Text Box body.

Reported in the audioplugin; the same DOM/GPU path is in `soemdsp-sandbox` `public/` (plugin and browser share it). GPU graph is on by default, so the plugin always hits this.

## Repro

1. Open Sandbox (plugin or `index.html` with GL graph on).
2. Add a Text Box, type some text.
3. Select it and delete (Delete / toolbar).
4. Observe: glyphs remain at the old position; the plate fill / body is gone; dragging that leftover still moves it.

## Expected behavior

Delete removes the node from the patch, the GPU plate, and the HTML hit target. No leftover glyphs or drag handle.

## Cause (read-only, 2026-10-25)

Two hosts for Text Box HTML:

1. **Patch mount** (B-055): `#nodeGraphAnnotationNodes` via `nodeGraphModuleMountContainer` / `nodeGraphModuleMountContainers` (`public/node-graph-node-accessors.js`).
2. **GPU camera layers**: `nodeGraphPositionGridHtml` in `public/node-graph-viewport-perf.js` **moves** any `.dsp-node` that has `:scope > .node-text-box-body` into `#nodeGraphTextFront` or `#nodeGraphTextBehind` (from `nodeGraphEnsureTextWireLayers`, created during `nodeGraphGlGraphPresent`).

Delete (`performNodeGraphDeleteSelection` → `commitNodeGraphPatch` with `topologyEdit`) calls `applyNodeGraphPatchToDom({ skipExistingSync: true })`. That pass only removes `.dsp-node` elements whose id is gone from the patch **inside `nodeGraphModuleMountContainers()`** (nodes + annotation). After the first GL present, the Text Box is no longer in those containers, so **the HTML node is never removed**.

GPU plates rebuild from `patch.nodes` (`nodeGraphGlGraphRebuildPlates`). The deleted id is gone, so the plate fill / body disappears. Under `.gl-graph-on` the leftover HTML body is already transparent; `.node-text-box-input` still has a visible `color`. Pointer-events stay `auto` on Text Boxes, so the orphan is still draggable.

`nodeGraphGlGraphDrawTextBox` exists in `public/node-graph-gl-graph.js` but has **no callers**. Live glyphs are the HTML field, not GPU text. A stale `keepMesh` replay is not required for this symptom.

## Fix shape

Not started. Logged only; no code in this report.

When approved:

- Treat `#nodeGraphTextFront` and `#nodeGraphTextBehind` as Text Box mount containers in the delete / `applyNodeGraphPatchToDom` sweep (or query them the same way as annotation).
- In `nodeGraphPositionGridHtml`, remove a Text Box `.dsp-node` when it is missing from `patch.nodes` instead of only re-parenting it.
- Keep `applyNodeGraphModuleElementFromPatch` from yanking a live Text Box out of the front/behind layers on every sync (today it appends back to `#nodeGraphAnnotationNodes` if parent ≠ annotation and the node is not in a canvas tile). Delete should not depend on that yank.
