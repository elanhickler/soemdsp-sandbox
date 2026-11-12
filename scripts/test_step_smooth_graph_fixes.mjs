// Step / Smooth Graph batch: XY spinner CSS, Y floor agreement, Delete
// not stealing dots, and live playhead paint requests.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function almost(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

const ctx = {
  console,
  globalThis: null,
  document: undefined,
  window: undefined,
};
ctx.globalThis = ctx;
ctx.NODE_GRAPH_SEGMENT_SHAPES = ["rational", "exponential", "log", "smoothstep", "smootherstep", "hold"];
ctx.nodeGraphSegmentNormalizeShape = (value) => {
  const shape = String(value || "").trim().toLowerCase();
  if (shape === "linear") return "rational";
  return ctx.NODE_GRAPH_SEGMENT_SHAPES.includes(shape) ? shape : "rational";
};
ctx.nodeGraphMvp = { live: { node: null } };
ctx.nodeGraphModuleIsGraphType = (type) => type === "stepGraph" || type === "smoothGraph";
ctx.nodeGraphFiniteNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
vm.createContext(ctx);
const utilsPath = path.join(root, "public", "node-graph-graph-utils.js");
vm.runInContext(fs.readFileSync(utilsPath, "utf8"), ctx, { filename: "node-graph-graph-utils.js" });

// --- Y range: stored and interpolated values agree on -1..+1, not 0..1. ---
const addedLow = ctx.addNodeGraphGraphNodeData({
  cursorX: 0.5,
  nodes: [
    { c: 0, shape: "rational", x: 0, y: 1 },
    { c: 0, shape: "rational", x: 1, y: 0 },
  ],
}, { x: 0.4, y: -0.6 });
assert(addedLow.added, "can add a point below 0");
const addedNode = addedLow.graph.nodes[addedLow.selectedIndex];
assert(almost(addedNode.y, -0.6), `add-point keeps Y=-0.6, got ${addedNode.y}`);

const addedHigh = ctx.addNodeGraphGraphNodeData(addedLow.graph, { x: 0.7, y: 1.4 });
const highNode = addedHigh.graph.nodes[addedHigh.selectedIndex];
assert(almost(highNode.y, 1), "add-point clamps stored Y to +1, not above");

const locked = ctx.nodeGraphGraphWithLockedEndpointY({
  cursorX: 0,
  nodes: [
    { c: 0, shape: "rational", x: 0, y: -0.5 },
    { c: 0, shape: "rational", x: 1, y: 0.2 },
  ],
}, 0);
assert(almost(locked.nodes[0].y, -0.5) && almost(locked.nodes[1].y, -0.5),
  "endpoint Y lock preserves a negative floor, does not snap to 0");

const bar = ctx.nodeGraphGraphApplyStepBarHeight({
  cursorX: 0,
  nodes: [
    { c: 0, shape: "hold", x: 0, y: 0.2 },
    { c: 0, shape: "hold", x: 1, y: 0.2 },
  ],
}, 1, -0.8);
assert(almost(bar.nodes[0].y, -0.8) && almost(bar.nodes[1].y, -0.8),
  "step bar can sit at Y=-0.8 (floor is not 0)");

const barDelta = ctx.nodeGraphGraphApplyStepBarHeightDelta({
  cursorX: 0,
  nodes: [
    { c: 0, shape: "hold", x: 0, y: 0 },
    { c: 0, shape: "hold", x: 1, y: 0 },
  ],
}, 1, 0, 0, -0.4);
assert(almost(barDelta.nodes[0].y, -0.4) && almost(barDelta.nodes[1].y, -0.4),
  "step bar delta can move below 0");

ctx.nodeGraphGraphActiveEditZoom = () => ({ zoomMin: 0, zoomMax: 1 });
ctx.nodeGraphGraphClampYToZoom = (value, zoom, fallback = 0) => {
  const z = zoom || { zoomMin: 0, zoomMax: 1 };
  const stored = ctx.nodeGraphGraphClampValue(value, fallback);
  const n = Number.isFinite(stored) ? stored : fallback;
  return Math.max(z.zoomMin, Math.min(z.zoomMax, n));
};
assert(almost(ctx.nodeGraphGraphClampEditableY(-0.2, 0), 0),
  "editable Y cannot drag past a visible 0..1 floor");
assert(almost(ctx.nodeGraphGraphClampEditableY(1.2, 0), 1),
  "editable Y cannot drag past the visible ceiling");
ctx.nodeGraphGraphActiveEditZoom = () => ({ zoomMin: -1, zoomMax: 1 });
assert(almost(ctx.nodeGraphGraphClampEditableY(-1, 0), -1),
  "full zoom still allows the stored -1 floor");

const catmullGraph = {
  cursorX: 0,
  nodes: [
    { c: 0, shape: "rational", x: 0, y: 0 },
    { c: 0, shape: "rational", x: 0.5, y: -0.7 },
    { c: 0, shape: "rational", x: 1, y: 0 },
  ],
};
const mid = ctx.nodeGraphGraphValueAt(catmullGraph, 0.5, "catmull", 1);
assert(mid < -0.2, `Smooth Graph catmull follows a point below 0 (got ${mid})`);
const bez = ctx.nodeGraphGraphBezierPointAt(
  catmullGraph.nodes.map((n) => ({ x: n.x, y: n.y })),
  0.5,
);
assert(bez.y < 0, `Bezier controls keep Y below 0 (got ${bez.y})`);

// --- Live playhead: a new __GraphPhase sample requests a face paint. ---
const paints = [];
const loops = [];
const display = {
  dataset: { graphNode: "g1" },
  classList: { contains: () => false },
  _startFaceLoop() { loops.push("start"); },
};
ctx.document = {
  querySelectorAll: () => [display],
};
ctx.nodeGraphPatchNode = (id) => (id === "g1" ? { id, type: "smoothGraph" } : null);
ctx.nodeGraphModuleScopeLatestOutputValue = (id, port) => (
  id === "g1" && port === "__GraphPhase" ? 0.33 : null
);
ctx.scopePaintIsDrawingLive = () => true;
ctx.nodeGraphGraphFaceGlRequestPaint = (el) => { paints.push(el._graphPlayheadX); };
ctx.syncNodeGraphGraphLivePlayheads();
assert(display._graphPlayheadLive === true, "live playhead is armed from __GraphPhase");
assert(almost(display._graphPlayheadX, 0.33), "live playhead X tracks GraphPhase");
assert(paints.length === 1 && almost(paints[0], 0.33), "playhead change requests a GL paint");
assert(loops.length === 1, "playhead change starts the face pump");
paints.length = 0;
loops.length = 0;
ctx.syncNodeGraphGraphLivePlayheads();
assert(paints.length === 0 && loops.length === 0, "unchanged playhead does not repaint");
ctx.scopePaintIsDrawingLive = () => false;
ctx.syncNodeGraphGraphLivePlayheads();
assert(display._graphPlayheadLive === false && display._graphPlayheadX === null,
  "playhead hides when the engine is not drawing-live");
assert(paints.length === 1, "hiding the playhead also requests a paint");

// --- Delete is not captured by the graph face. ---
const keysPath = path.join(root, "public", "node-graph-keyboard-shortcuts.js");
const keysSrc = fs.readFileSync(keysPath, "utf8");
assert(
  !/if\s*\(\s*removeFocusedNodeGraphGraphNode\s*\(\s*\)\s*\)/.test(keysSrc),
  "Delete handler must not remove graph dots",
);
assert(
  keysSrc.includes("right-click only") && keysSrc.includes("nodeGraphSelectionCanDelete"),
  "Delete still deletes selected modules, dots stay right-click only",
);

// Cream phase cursor stays distinct from the purple live playhead.
const glSrc = fs.readFileSync(path.join(root, "public", "node-graph-graph-face-gl.js"), "utf8");
assert(glSrc.includes("255 / 255, 236 / 255, 181 / 255"), "phase cursor is cream");
assert(glSrc.includes("playRgba") && glSrc.includes("if (playheadX !== null)"),
  "live playhead still draws in playheadColor");

// --- Spinner arrows are hidden on the XY number fields, fields stay type=number. ---
const css = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
assert(
  css.includes('.node-module-graph-point-strip-input[type="number"]')
  && css.includes("-webkit-inner-spin-button")
  && css.includes("appearance: textfield"),
  "point-strip number inputs hide spinner arrows",
);
const extras = fs.readFileSync(path.join(root, "public", "node-graph-graph-face-extras.js"), "utf8");
assert(
  extras.includes('input.type = "number"') && extras.includes('input.inputMode = "decimal"'),
  "XY fields stay editable number inputs",
);

console.log("test_step_smooth_graph_fixes: ok");
