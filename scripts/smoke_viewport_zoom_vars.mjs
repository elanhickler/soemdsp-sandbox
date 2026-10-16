// Smoke: per-step zoom never writes the inherited --node-graph-zoom.
// Mid-gesture only the world layers' inline transform changes; the inherited
// var (module stroke compensate, grid size) is caught up once on settle.
// Setting it per wheel step restyled ~2.9k elements (~27 ms a step).
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
};
const ctx = {
  console,
  performance: { now: () => 1000 },
  window: { setTimeout: () => 1, clearTimeout() {}, cancelAnimationFrame() {}, requestAnimationFrame: () => 1, addEventListener() {}, __nodeGraphViewportStrokeRescue: true },
  document: { getElementById: (id) => (id === "nodeGraphWorkspace" ? workspace : null), addEventListener() {} },
  nodeGraphMvp: { zoom: 3, pan: { x: 10, y: 20 } },
  nodeGraphFiniteNumber: (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f),
};
ctx.nodeGraphZoom = () => ctx.nodeGraphMvp.zoom;
ctx.nodeGraphRenderedOriginOffset = (pan) => pan;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("public/node-graph-viewport-perf.js", "utf8"), ctx);

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
const t = layers[0].style.transform;
if (!/scale\(4\)/.test(t) || !/translate3d\(10px, 20px, 0\)/.test(t)) fail(`world layer transform not live: ${t}`);
if (layers[1].style.transform !== t) fail("both world layers must carry the camera transform");
ok(`world layers carry the camera transform (${t})`);
if (!classes.has("pixelated-canvas-zoom")) fail("pixelation above 2.5x must stay live mid-gesture");
ok("nearest-neighbor class live above 2.5x");

// Gesture display hold: displays are held mid-gesture, released on settle.
if (ctx.nodeGraphViewportHoldsDisplays() !== true) fail("displays must be held mid-gesture");
if (layers[0].style.willChange !== "transform") fail("world layers must be GPU-hinted mid-gesture");
ok("mid-gesture: displays held, world layers will-change: transform");
for (const [file, needle] of [
  ["public/node-graph-module-scopes.js", "nodeGraphViewportHoldsDisplays()"],
  ["public/node-graph-module-scope-paint-gate.js", "nodeGraphViewportHoldsDisplays()"],
]) {
  if (!fs.readFileSync(file, "utf8").includes(needle)) fail(`${file} must skip painting while nodeGraphViewportHoldsDisplays()`);
}
ok("scope frames and face pumps honour the gesture hold");

// Settle: one write of the inherited var.
log.length = 0;
ctx.window.setTimeout = () => 1;
ctx.performance.now = () => 1e9;
ctx.clearNodeGraphViewportGestureClass();
const settle = log.filter(([o, k]) => k === "--node-graph-zoom");
if (settle.length !== 1 || settle[0][2] !== "4") fail(`settle must write --node-graph-zoom once: ${JSON.stringify(settle)}`);
ok("settle writes --node-graph-zoom once");
if (ctx.nodeGraphViewportHoldsDisplays() !== false) fail("settle must release the display hold");
if (layers[0].style.willChange) fail("settle must drop will-change");
ok("settle releases the display hold and drops will-change");

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