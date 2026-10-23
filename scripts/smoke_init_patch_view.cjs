// Init Patch: untitled identity, origin camera, play-mode face plate.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures += 1; console.log(`FAIL ${msg}`); } };

const actions = read("public/node-graph-file-actions.js");
ok(actions.includes("loadedPatchSlug = \"\""), "Init clears loadedPatchSlug");
ok(actions.includes("selectedSavedPatchFilename = \"\""), "Init clears selectedSavedPatchFilename");
ok(actions.includes("function nodeGraphUntitledInitPatch"), "Init wipes info.name");
ok(actions.includes("resetEditorView: true"), "Init commit resets the editor view");

const zoom = read("public/node-graph-workspace-zoom.js");
ok(zoom.includes("function resetNodeGraphEditorViewToOrigin"), "origin camera helper exists");
ok(/nodeGraphMvp\.pan = \{ x: 0, y: 0 \}/.test(zoom) && /nodeGraphMvp\.zoom = 1/.test(zoom), "origin is pan 0 zoom 1");

const core = read("public/node-graph-patch-core.js");
ok(core.includes("options.resetEditorView"), "commit honors resetEditorView");
ok(core.includes("nodeGraphPlateFacesAfterPatchLoad"), "commit plates faces after Init");
ok(core.includes("preserveNodeGraphEditorZoomOnPatch"), "ordinary commits still keep editor zoom");

const slots = read("public/node-graph-module-scope-slots.js");
ok(slots.includes("function nodeGraphPlateFacesAfterPatchLoad"), "play-mode Init plate helper exists");
ok(slots.includes("scopePaintEnsureColdPlates"), "Init plates through the cold-plate path");
ok(slots.includes("nodeGraphGlGraphRebuildPlates"), "Init rebuilds GPU display quads");

const helpers = read("public/node-graph-module-scope-paint-helpers.js");
ok(helpers.includes("options.replaceTape"), "cold plate can drop a started tape");
ok(helpers.includes("nodeGraphWaterfallWipeHistory"), "replaceTape wipes waterfall history");

const gate = read("public/node-graph-module-scope-paint-gate.js");
ok(gate.includes("replaceTape: options.assumeStopped === true || options.replaceTape === true"), "stopped/init plates replace tape");

const header = read("public/node-graph-module-header-rendering.js");
ok(header.includes("Untitled"), "header fallback is Untitled");

if (failures) {
  console.log(`${failures} init-patch view check(s) failed`);
  process.exit(1);
}
console.log("init patch view ok");
