#!/usr/bin/env node
// Unit test: Z / center-view pans to the module union at the current zoom,
// subtracting the chrome pin, and still measures viewport-asleep modules.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zoomSrc = fs.readFileSync(path.join(root, "public/node-graph-workspace-zoom.js"), "utf8");
const shortcutSrc = fs.readFileSync(path.join(root, "public/node-graph-keyboard-shortcuts.js"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  /event\.key\.toLowerCase\(\) === "z"/.test(shortcutSrc)
  && /nodeGraphCenterViewOnModules\(\{\s*preferSelection:\s*true\s*\}\)/.test(shortcutSrc),
  "Z hotkey must call nodeGraphCenterViewOnModules({ preferSelection: true })",
);

const panCalls = [];
const helpCalls = [];
const nodesById = new Map();

function makeNode({ id, x, y, width = 0, height = 0, asleep = false, cullW, cullH, hidden = false }) {
  const classes = new Set(asleep ? ["viewport-asleep"] : []);
  if (hidden) classes.add("removed-placeholder");
  const styleVars = { "--node-x": `${x}px`, "--node-y": `${y}px` };
  const node = {
    dataset: { node: id },
    hidden,
    classList: {
      contains(name) { return classes.has(name); },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    style: {
      getPropertyValue(name) { return styleVars[name] || ""; },
    },
    offsetWidth: width,
    offsetHeight: height,
  };
  if (cullW != null) node._viewportCullW = cullW;
  if (cullH != null) node._viewportCullH = cullH;
  nodesById.set(id, node);
  return node;
}

const hostNodes = [];
const annotationNodes = [];
const host = {
  querySelector(sel) {
    const match = String(sel).match(/data-node="([^"]+)"/);
    return match ? (nodesById.get(match[1]) || null) : null;
  },
  querySelectorAll() { return hostNodes; },
};
const annotationHost = {
  querySelectorAll() { return annotationNodes; },
};

const workspace = {
  getBoundingClientRect() {
    return { width: 1000, height: 800, left: 0, top: 0 };
  },
};

const geometry = new Map();
const ctx = {
  window: {},
  document: {
    getElementById(id) {
      if (id === "nodeGraphWorkspace") return workspace;
      return null;
    },
  },
  CSS: { escape: (value) => String(value) },
  Math,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Set,
  Map,
  parseInt,
  parseFloat,
  Infinity,
  console,
  nodeGraphMvp: {
    zoom: 2,
    pan: { x: 0, y: 0 },
    workspaceChromePin: { x: 40, y: -20 },
    activeNodes: new Set(["a", "b", "c"]),
    patch: { view: { zoom: 2 } },
  },
  nodeGraphFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  },
  nodeGraphZoom() { return ctx.nodeGraphMvp.zoom; },
  nodeGraphWorkspaceChromePin() { return ctx.nodeGraphMvp.workspaceChromePin || { x: 0, y: 0 }; },
  nodeGraphZoomSurface() { return host; },
  nodeGraphViewportCullModuleRoots() { return [host, annotationHost]; },
  nodeGraphSelectedNodeIds() { return ctx._selected || new Set(); },
  nodeGraphNodeElement(id) { return nodesById.get(id) || null; },
  nodeGraphModuleGeometryGet(id) { return geometry.get(String(id)) || null; },
  nodeGraphNodeBounds(node) {
    const x = Number.parseFloat(node.style.getPropertyValue("--node-x")) || 0;
    const y = Number.parseFloat(node.style.getPropertyValue("--node-y")) || 0;
    return {
      left: x,
      top: y,
      right: x + (node.offsetWidth || 0),
      bottom: y + (node.offsetHeight || 0),
    };
  },
  setNodeGraphPan(x, y, options = {}) {
    panCalls.push({ x, y, options });
    ctx.nodeGraphMvp.pan = { x, y };
  },
  setNodeInteractionHelp(message) { helpCalls.push(message); },
  clampNodeGraphZoom(value) { return value; },
  syncNodeGraphPatchViewZoom() {},
  applyNodeGraphZoom() {},
  getComputedStyle() {
    return { borderLeftWidth: "0", borderRightWidth: "0", borderTopWidth: "0", borderBottomWidth: "0" };
  },
};

vm.createContext(ctx);
vm.runInContext(zoomSrc, ctx);

function resetScene() {
  panCalls.length = 0;
  helpCalls.length = 0;
  nodesById.clear();
  hostNodes.length = 0;
  annotationNodes.length = 0;
  geometry.clear();
  ctx._selected = new Set();
  ctx.nodeGraphMvp.zoom = 2;
  ctx.nodeGraphMvp.pan = { x: 0, y: 0 };
  ctx.nodeGraphMvp.workspaceChromePin = { x: 40, y: -20 };
}

resetScene();
const onScreen = makeNode({ id: "a", x: 0, y: 0, width: 100, height: 100 });
hostNodes.push(onScreen);
assert(ctx.nodeGraphCenterViewOnModules({ preferSelection: false, help: false }) === true, "center all should succeed");
assert(panCalls.length === 1, "center should pan once");
// Module centre is (50, 50); zoom 2; pin (40, -20)
// pan = -50*2 - 40, -50*2 - (-20) = (-140, -80)
assert(panCalls[0].x === -140 && panCalls[0].y === -80, `chrome pin must be subtracted, got ${JSON.stringify(panCalls[0])}`);

resetScene();
ctx.nodeGraphMvp.workspaceChromePin = { x: 0, y: 0 };
hostNodes.push(makeNode({ id: "a", x: 0, y: 0, width: 100, height: 100 }));
assert(ctx.nodeGraphCenterViewOnModules({ preferSelection: false, help: false }) === true, "pin 0 should still center");
assert(panCalls[0].x === -100 && panCalls[0].y === -100, `pin 0 pan should be -center*zoom, got ${JSON.stringify(panCalls[0])}`);

resetScene();
const asleep = makeNode({
  id: "b",
  x: 400,
  y: 200,
  width: 0,
  height: 0,
  asleep: true,
  cullW: 120,
  cullH: 80,
});
hostNodes.push(asleep);
assert(ctx.nodeGraphCenterViewOnModules({ preferSelection: false, help: false }) === true, "asleep module with cull size should center");
assert(asleep.classList.contains("viewport-asleep"), "asleep module should stay asleep after measure");
// centre (460, 240); zoom 2; pin (40, -20) => pan (-960, -460)
assert(panCalls[0].x === -960 && panCalls[0].y === -460, `asleep cull-size pan wrong: ${JSON.stringify(panCalls[0])}`);

resetScene();
const geoOnly = makeNode({ id: "c", x: 20, y: 10, width: 0, height: 0, asleep: true });
hostNodes.push(geoOnly);
geometry.set("c", { box: { x: 20, y: 10, w: 80, h: 40 } });
assert(ctx.nodeGraphCenterViewOnModules({ preferSelection: false, help: false }) === true, "asleep module with geometry should center");
// centre (60, 30); zoom 2; pin (40, -20) => pan (-160, -40)
assert(panCalls[0].x === -160 && panCalls[0].y === -40, `geometry pan wrong: ${JSON.stringify(panCalls[0])}`);

resetScene();
const selected = makeNode({ id: "a", x: 200, y: 0, width: 50, height: 50 });
const other = makeNode({ id: "b", x: 0, y: 0, width: 50, height: 50 });
hostNodes.push(selected, other);
ctx._selected = new Set(["a"]);
assert(ctx.nodeGraphCenterViewOnModules({ preferSelection: true }) === true, "selection center should succeed");
// selected centre (225, 25); zoom 2; pin (40, -20) => pan (-490, -30)
assert(panCalls[0].x === -490 && panCalls[0].y === -30, `selection pan wrong: ${JSON.stringify(panCalls[0])}`);
assert(helpCalls[0] === "View centered on selection.", `help should mention selection, got ${helpCalls[0]}`);

resetScene();
const emptySel = makeNode({ id: "a", x: 0, y: 0, width: 0, height: 0, asleep: true });
const visible = makeNode({ id: "b", x: 100, y: 100, width: 40, height: 40 });
hostNodes.push(emptySel, visible);
ctx._selected = new Set(["a"]);
assert(ctx.nodeGraphCenterViewOnModules({ preferSelection: true, help: false }) === true, "empty selection bounds should fall back to all modules");
// union of visible only (emptySel has no size): centre (120, 120); pan (-280, -220)
assert(panCalls[0].x === -280 && panCalls[0].y === -220, `fallback pan wrong: ${JSON.stringify(panCalls[0])}`);

resetScene();
const annot = makeNode({ id: "note", x: 300, y: 300, width: 40, height: 20 });
annotationNodes.push(annot);
assert(ctx.nodeGraphCenterViewOnModules({ preferSelection: false, help: false }) === true, "annotation-host modules should be collected");
// centre (320, 310); zoom 2; pin (40, -20) => pan (-680, -600)
assert(panCalls[0].x === -680 && panCalls[0].y === -600, `annotation pan wrong: ${JSON.stringify(panCalls[0])}`);

const pinPan = ctx.nodeGraphPanToCenterWorldPoint(10, 20, { zoom: 2, persist: false, immediate: true });
assert(pinPan.x === -60 && pinPan.y === -20, `helper pan wrong: ${JSON.stringify(pinPan)}`);

console.log("ok: Z / center-view accounts for chrome pin and culled module sizes");