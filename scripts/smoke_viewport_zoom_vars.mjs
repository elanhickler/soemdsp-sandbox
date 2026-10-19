// Smoke: per-step zoom never writes the inherited --node-graph-zoom.
// ZP-4 design (docs/ZOOM_PERF_PLAN.md): mid-gesture no module style is
// written; one transform per world/text layer carries the frozen HTML picture
// to the live camera. Settle writes CSS zoom, the module transforms and the
// inherited var (module stroke compensate, grid size) once. Displays keep
// painting through the gesture (display hold off).
// Setting the var per wheel step restyled ~2.9k elements (~27 ms a step).
import fs from "node:fs";
import vm from "node:vm";

const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const ok = (m) => console.log("ok  ", m);

function makeStyle(log, owner) {
  const props = new Map();
  return {
    _t: "",
    get transform() { return this._t; },
    set transform(v) { this._t = v; log.push([owner, "transform", v]); },
    setProperty(k, v) { props.set(k, String(v)); log.push([owner, k, String(v)]); },
    getPropertyValue(k) { return props.get(k) || ""; },
    removeProperty(k) { props.delete(k); if (k === "will-change") this.willChange = ""; log.push([owner, "-" + k]); },
  };
}
const log = [];
const classes = new Set();
const layers = [0, 1].map((i) => ({ style: makeStyle(log, "layer" + i) }));
const workspace = {
  style: makeStyle(log, "workspace"),
  dataset: {},
  classList: {
    add: (...c) => c.forEach((x) => classes.add(x)),
    remove: (...c) => c.forEach((x) => classes.delete(x)),
    contains: (c) => classes.has(c),
    toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
  },
  getElementsByClassName: () => layers,
  querySelector: () => null,
  querySelectorAll: () => nodes,
};
const textLayers = Object.fromEntries(["nodeGraphTextBehind", "nodeGraphTextFront"].map((id) => [id, { id, append() {}, style: makeStyle(log, id) }]));
const nodeStyle = makeStyle(log, "module");
nodeStyle.setProperty("--node-x", "100px");
nodeStyle.setProperty("--node-y", "40px");
const nodes = [{
  style: nodeStyle,
  dataset: {},
  parentElement: null,
  querySelector: () => null,
  closest: () => null,
}];
const ctx = {
  console,
  performance: { now: () => 1000 },
  window: { setTimeout: () => 1, clearTimeout() {}, cancelAnimationFrame() {}, requestAnimationFrame: () => 1, addEventListener() {}, __nodeGraphViewportStrokeRescue: true },
  document: {
    getElementById: (id) => {
      if (id === "nodeGraphWorkspace") return workspace;
      if (id === "nodeGraphTextBehind" || id === "nodeGraphTextFront") return textLayers[id];
      return null;
    },
    addEventListener() {},
  },
  nodeGraphMvp: { zoom: 3, pan: { x: 10, y: 20 } },
  nodeGraphFiniteNumber: (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f),
};
ctx.nodeGraphZoom = () => ctx.nodeGraphMvp.zoom;
ctx.nodeGraphRenderedOriginOffset = (pan) => pan;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("public/node-graph-viewport-perf.js", "utf8"), ctx);

// Camera written once outside a gesture (zoom 3): modules carry it.
ctx.applyNodeGraphViewportCssLight({ zoom: true, pan: true, readouts: false });
if (nodeStyle.zoom !== "3") fail(`module zoom must follow the camera outside a gesture: ${nodeStyle.zoom}`);

// Wheel gesture: several zoom steps.
ctx.markNodeGraphViewportGesture("wheel");
log.length = 0;
for (const z of [3.3, 3.6, 4.0]) {
  ctx.nodeGraphMvp.zoom = z;
  ctx.applyNodeGraphViewportCssLight({ zoom: true, pan: true, readouts: false });
}
const zoomWrites = log.filter(([o, k]) => k === "--node-graph-zoom");
if (zoomWrites.length) fail(`per-step zoom wrote the inherited var: ${JSON.stringify(zoomWrites)}`);
ok("per-step zoom does not write --node-graph-zoom");
const moduleWrites = log.filter(([o]) => o === "module");
if (moduleWrites.length || nodeStyle.zoom !== "3") fail(`mid-gesture module style must stay frozen: ${JSON.stringify(moduleWrites)} zoom=${nodeStyle.zoom}`);
ok("mid-gesture: no module style writes (HTML frozen at the gesture-start camera)");
// Frozen at zoom 3, origin (10,20); live zoom 4: s = 4/3, t = o - o0 * s.
const sc = 4 / 3;
const want = `translate(${10 - 10 * sc}px, ${20 - 20 * sc}px) scale(${sc})`;
for (const el of [layers[0], layers[1], textLayers.nodeGraphTextBehind, textLayers.nodeGraphTextFront]) {
  if (el.style.transform !== want) fail(`frozen layer transform: got ${el.style.transform}, want ${want}`);
}
ok(`world and text layers carry ${want}`);
if (!classes.has("pixelated-canvas-zoom")) fail("pixelation above 2.5x must stay live mid-gesture");
ok("nearest-neighbor class live above 2.5x");
if (ctx.nodeGraphViewportHoldsDisplays() !== false) fail("display hold must stay off: displays paint through gestures");
if (layers[0].style.willChange !== "transform") fail("world layers must be GPU-hinted mid-gesture");
ok("mid-gesture: displays not held, world layers will-change: transform");

// Settle: one write of the inherited var.
log.length = 0;
ctx.window.setTimeout = () => 1;
ctx.performance.now = () => 1e9;
ctx.clearNodeGraphViewportGestureClass();
const settle = log.filter(([o, k]) => k === "--node-graph-zoom");
if (settle.length !== 1 || settle[0][2] !== "4") fail(`settle must write --node-graph-zoom once: ${JSON.stringify(settle)}`);
ok("settle writes --node-graph-zoom once");
if (nodeStyle.zoom !== "4") fail(`settle must write module zoom: ${nodeStyle.zoom}`);
if (nodeStyle.transform !== "translate(2.5px, 5px)") fail(`settle module translate must be pan/zoom: ${nodeStyle.transform}`);
if (layers[0].style.transform !== "none" || textLayers.nodeGraphTextFront.style.transform !== "") fail("settle must return the layers to identity");
ok(`settle: modules carry CSS zoom 4 and translate(2.5px, 5px); layers back to identity`);
if (layers[0].style.willChange) fail("settle must drop will-change");
ok("settle drops will-change");

// Outside a gesture (programmatic zoom), the var is written directly.
log.length = 0;
ctx.nodeGraphMvp.zoom = 1;
ctx.applyNodeGraphViewportCssLight({ zoom: true, pan: false, readouts: false });
if (!log.some(([o, k, v]) => k === "--node-graph-zoom" && v === "1")) fail("non-gesture zoom must write the var");
if (classes.has("pixelated-canvas-zoom")) fail("pixelation class must drop at zoom 1");
ok("non-gesture zoom writes the var; zoom 1 is unpixelated");

// Other writers must route through the light path (no per-step var writes).
const zoomSrc = fs.readFileSync("public/node-graph-workspace-zoom.js", "utf8");
const setZoom = zoomSrc.slice(zoomSrc.indexOf("function setNodeGraphZoom("), zoomSrc.indexOf("function clampNodeGraphZoom("));
if (!/applyNodeGraphViewportCssLight\(\{ zoom: true, pan: true/.test(setZoom)) fail("setNodeGraphZoom must use applyNodeGraphViewportCssLight");
ok("setNodeGraphZoom uses the light path");
console.log("smoke_viewport_zoom_vars ok");