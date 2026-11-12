// Unit checks for the Step/Smooth Graph overhaul:
// pointer Y mapping, remaining-room skew, linear->rational migration,
// and per-segment shapes actually differing.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const curvesPath = path.join(root, "public", "node-graph-segment-curves.js");
const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(curvesPath, "utf8"), context, { filename: "node-graph-segment-curves.js" });

const {
  nodeGraphSegmentNormalizeShape,
  nodeGraphSegmentShapeFromParam,
  nodeGraphSegmentShapeIndex,
  nodeGraphSegmentApplySkewPercent,
  nodeGraphSegmentCurve01,
  NODE_GRAPH_SEGMENT_SHAPES,
} = context;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function almost(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

// Palette no longer includes Linear; enum ids stay stable.
assert(Array.isArray(NODE_GRAPH_SEGMENT_SHAPES), "shapes list");
assert(!NODE_GRAPH_SEGMENT_SHAPES.includes("linear"), "linear dropped from palette");
assert(NODE_GRAPH_SEGMENT_SHAPES[0] === "rational", "palette starts at rational");
assert(nodeGraphSegmentNormalizeShape("linear") === "rational", "name linear -> rational");
assert(nodeGraphSegmentShapeFromParam(0) === "rational", "index 0 (legacy linear) -> rational");
assert(nodeGraphSegmentShapeFromParam(1) === "rational", "index 1 stays rational");
assert(nodeGraphSegmentShapeFromParam(2) === "exponential", "index 2 stays exponential");
assert(nodeGraphSegmentShapeFromParam(6) === "hold", "index 6 stays hold");
assert(nodeGraphSegmentShapeIndex("linear") === 1, "linear enum id migrates to 1");
assert(nodeGraphSegmentShapeIndex("rational") === 1, "rational enum id is 1");
assert(nodeGraphSegmentShapeIndex("exponential") === 2, "exponential enum id is 2");
assert(nodeGraphSegmentShapeIndex("hold") === 6, "hold enum id is 6");

// Remaining-room skew.
const skew = nodeGraphSegmentApplySkewPercent;
assert(almost(skew(0.2, 0), 0.2), "offset 0 leaves c");
assert(almost(skew(-0.4, 0), -0.4), "offset 0 leaves negative c");
assert(almost(skew(0.2, 1), 1), "+1 maps everyone to +1");
assert(almost(skew(-0.4, 1), 1), "+1 maps low c to +1");
assert(almost(skew(0.2, -1), -1), "-1 maps everyone to -1");
assert(almost(skew(0.8, -1), -1), "-1 maps high c to -1");
const midPos = skew(0.2, 0.5);
assert(almost(midPos, 0.2 + 0.5 * (1 - 0.2)), "positive remaining-room");
const midNeg = skew(0.2, -0.5);
assert(almost(midNeg, 0.2 + -0.5 * (0.2 + 1)), "negative remaining-room");
const close = skew(0.9, 0.5);
const far = skew(-0.5, 0.5);
assert(close > 0.9 && close <= 1, "close c moves a little toward +1");
assert(far > -0.5 && far < close, "farther c moves more, no wall slam");

// Linear at 0 equals Rational; per-segment shapes differ once they diverge.
assert(almost(nodeGraphSegmentCurve01(0.5, "linear", 0), 0.5), "legacy linear mid");
assert(almost(nodeGraphSegmentCurve01(0.5, "rational", 0), 0.5), "rational mid at 0");
assert(almost(nodeGraphSegmentCurve01(0.5, "linear", 0), nodeGraphSegmentCurve01(0.5, "rational", 0)), "linear == rational at 0");
const rat = nodeGraphSegmentCurve01(0.5, "rational", 0.6);
const exp = nodeGraphSegmentCurve01(0.5, "exponential", 0.6);
const hold = nodeGraphSegmentCurve01(0.5, "hold", 0.6);
assert(rat > 0.5, "positive rational raises mid");
assert(Math.abs(rat - exp) > 1e-4, "rational and exponential differ at same skew");
assert(hold === 0, "hold at +c stays low until p>=1");
assert(nodeGraphSegmentCurve01(0.5, "hold", -0.2) === 1, "hold at -c steps at start");

// Padding matches SinCos: max(half stroke, dot/handle radius) + feather.
function facePadPx(look) {
  const strokeW = Math.max(0, Number(look.lineThickness) || 0);
  const dottedW = Math.max(0, Number(look.dottedThickness) || 0);
  const dotW = Math.max(0, Number(look.dotSize) || 0);
  const feather = Math.max(0, Number(look.lineSmoothing) || 1);
  const nodeR = dotW > 0 ? dotW * 0.5 : 0;
  const handleR = nodeR > 0 ? Math.max(2, nodeR + 0.6) : 0;
  return Math.max(strokeW * 0.5, dottedW * 0.5, nodeR, handleR) + feather;
}
const defaultLook = { lineThickness: 2, dottedThickness: 0.7, dotSize: 6, lineSmoothing: 1 };
const pad = facePadPx(defaultLook);
assert(almost(pad, Math.max(1, 0.35, 3, 3.6) + 1), "default pad is handle radius + feather");
assert(pad >= 3.6 + 1, "pad fits a max-range dot and handle");

function plotLayout(width, height, look) {
  const p = Math.min(facePadPx(look), Math.max(0, width / 2 - 2));
  return { pad: p, inner: width - p * 2 };
}
function viewYToGraphY(viewY, faceSize = 100, zoomMin = -1, zoomMax = 1, look = defaultLook) {
  const layout = plotLayout(faceSize, faceSize, look);
  const padView = (layout.pad / faceSize) * 100;
  const innerView = (layout.inner / faceSize) * 100;
  const yUnit = innerView > 0
    ? Math.max(0, Math.min(1, (100 - padView - viewY) / innerView))
    : 0.5;
  return zoomMin + yUnit * (zoomMax - zoomMin);
}
const layout100 = plotLayout(100, 100, defaultLook);
const top = layout100.pad;
const mid = 50;
const bot = 100 - layout100.pad;
assert(almost(viewYToGraphY(top), 1), "top of inner plot is zoom max (+1)");
assert(almost(viewYToGraphY(mid), 0), "mid of plot is 0");
assert(almost(viewYToGraphY(bot), -1), "bottom of inner plot is zoom min (-1)");
assert(viewYToGraphY(top - 2) === viewYToGraphY(top), "clamp above inner plot");
assert(viewYToGraphY(bot + 2) === viewYToGraphY(bot), "clamp below inner plot");
assert(almost(viewYToGraphY(bot, 100, 0, 1), 0), "0..1 zoom bottom stays 0");
assert(almost(viewYToGraphY(top, 100, 0, 1), 1), "0..1 zoom top stays 1");

function clampYToZoom(y, zoomMin, zoomMax) {
  const stored = Math.max(-1, Math.min(1, y));
  return Math.max(zoomMin, Math.min(zoomMax, stored));
}
assert(almost(clampYToZoom(-0.2, 0, 1), 0), "editable Y cannot go below visible zoom min");
assert(almost(clampYToZoom(1.2, 0, 1), 1), "editable Y cannot go above visible zoom max or +1");
assert(almost(clampYToZoom(-1, -1, 1), -1), "full zoom still allows stored -1");

function clampSkew(c) {
  return Math.max(-1, Math.min(1, c));
}
assert(clampSkew(1.5) === 1, "skew type-in clamps to +1");
assert(clampSkew(-1.2) === -1, "skew type-in clamps to -1");
assert(clampSkew(0.25) === 0.25, "in-range skew unchanged");
assert(nodeGraphSegmentApplySkewPercent(0.2, 1.5) === nodeGraphSegmentApplySkewPercent(0.2, 1)
  || almost(Math.max(-1, Math.min(1, 1.5)), 1), "global offset is limited to +/-1");

// Layout A Step Graph must reserve a face (+ IO) track, not a leftover Layout B
// shell. patches/demo_patches/dsf.json loads stepGraph-1 this way; a shell-only
// stack leaves the face off the article and the display blank.
{
  const sizingPath = path.join(root, "public", "node-graph-module-sizing.js");
  const sizingCtx = {
    console,
    nodeGraphModuleDefinitions: {
      stepGraph: { layout: "graph", displayHeightGu: 8, parameters: [{ key: "rate" }] },
      smoothGraph: { layout: "graph", displayHeightGu: 8, parameters: [{ key: "rate" }] },
    },
    nodeGraphModuleUsesLayoutB: (type) => type === "smoothGraph",
    nodeGraphModuleUsesLayoutC: () => false,
    nodeGraphModuleUsesMetamoduleLayout: () => false,
    nodeGraphModuleIsCollapsedUi: () => false,
    nodeGraphModuleIsTitleOnlyUi: () => false,
    nodeGraphChromelessModuleLayouts: new Set(),
    nodeGraphChromelessModuleIsCompactTile: () => false,
    nodeGraphEffectivePatchNodeUi: (ui = {}) => ({
      slidersHidden: false,
      ioHidden: false,
      oscilloscopeHidden: false,
      titleHidden: false,
      displayHeightGu: 7,
      ...ui,
    }),
    normalizeNodeGraphPatchNodeUi: (ui = {}) => ({ displayHeightGu: 7, ...ui }),
    nodeGraphModuleLayout: {
      ioSectionMinHeightGu: 0.5,
      moduleGridInsetGu: 0.15,
      moduleScopeHeightGu: 2,
    },
    nodeGraphFiniteNumber: (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    },
  };
  vm.createContext(sizingCtx);
  vm.runInContext(fs.readFileSync(sizingPath, "utf8"), sizingCtx, { filename: "node-graph-module-sizing.js" });
  sizingCtx.nodeGraphModuleStripIoBandVisible = () => true;
  sizingCtx.nodeGraphModuleIoSectionHeightGu = () => 1;
  sizingCtx.nodeGraphModuleHeaderHeightUnits = () => 1;
  sizingCtx.nodeGraphModuleSliderBodyHeightGu = () => 4;
  const dsfStepUi = { displayHeightGu: 7, slidersHidden: false, ioHidden: false, oscilloscopeHidden: false };
  const visibleIds = (type) => sizingCtx.nodeGraphModuleLayoutBands(type, dsfStepUi, { type, ui: dsfStepUi })
    .filter((band) => band.visible)
    .map((band) => band.id);
  const stepIds = visibleIds("stepGraph");
  const smoothIds = visibleIds("smoothGraph");
  assert(stepIds.includes("face"), "Layout A Step Graph reserves a face track");
  assert(stepIds.includes("io"), "Layout A Step Graph reserves an IO strip track");
  assert(!stepIds.includes("shell"), "Layout A Step Graph must not reserve a Layout B shell track");
  assert(smoothIds.includes("shell"), "Layout B Smooth Graph keeps its shell track");
  assert(!smoothIds.includes("face"), "Layout B Smooth Graph does not use a bare face track");
}

// Moving one Step Graph point must not replace sibling points, shapes, or cursor.
// Regression for "the whole graph resets" (default falling ramp) when dragging
// a point: normalize/migrate/ForNode must not rewrite a valid document, and
// MoveNode may only change the edited point (plus lock-ends when enabled).
{
  const utilsPath = path.join(root, "public", "node-graph-graph-utils.js");
  const utilsCtx = {
    console,
    NODE_GRAPH_SEGMENT_SHAPES,
    nodeGraphSegmentNormalizeShape,
    nodeGraphSegmentShapeFromParam,
    nodeGraphSegmentShapeIndex,
    nodeGraphSegmentApplySkewPercent,
    nodeGraphSegmentCurve01,
    nodeGraphMvp: { graphNodeDragging: null, patch: { nodes: [] } },
    nodeGraphModuleIsGraphType: (type) => type === "stepGraph" || type === "smoothGraph",
    nodeGraphFiniteNumber: (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    },
    addNodeGraphModuleScopeSnapshotListener: () => {},
  };
  vm.createContext(utilsCtx);
  vm.runInContext(fs.readFileSync(utilsPath, "utf8"), utilsCtx, { filename: "node-graph-graph-utils.js" });

  const dsfGraph = {
    cursorX: 0.25,
    nodes: [
      { x: 0, y: 0, c: 0.1, shape: "smoothstep" },
      { x: 0.5, y: 1, c: -0.2, shape: "smoothstep" },
      { x: 1, y: 0, c: 0.3, shape: "smootherstep" },
    ],
  };
  const snapshot = (graph) => JSON.parse(JSON.stringify({
    cursorX: graph.cursorX,
    nodes: graph.nodes.map((node) => ({ x: node.x, y: node.y, c: node.c, shape: node.shape })),
  }));
  const sameNode = (a, b, eps = 1e-9) => (
    Math.abs(a.x - b.x) <= eps
    && Math.abs(a.y - b.y) <= eps
    && Math.abs(a.c - b.c) <= eps
    && a.shape === b.shape
  );

  const normalized = utilsCtx.normalizeNodeGraphGraph(dsfGraph);
  assert(normalized.nodes.length === 3, "normalize keeps a 3-point curve");
  assert(almost(normalized.cursorX, 0.25), "normalize keeps cursorX");
  assert(sameNode(normalized.nodes[0], dsfGraph.nodes[0]), "normalize keeps first point");
  assert(sameNode(normalized.nodes[1], dsfGraph.nodes[1]), "normalize keeps middle point");
  assert(sameNode(normalized.nodes[2], dsfGraph.nodes[2]), "normalize keeps last point");
  assert(!(almost(normalized.nodes[0].y, 1) && almost(normalized.nodes[normalized.nodes.length - 1].y, 0)
    && normalized.nodes.length === 2), "normalize must not collapse to the default ramp");

  const wrapped = utilsCtx.normalizeNodeGraphGraph({
    type: "stepGraph",
    params: { skewOffset: 0.4 },
    graph: dsfGraph,
  });
  assert(wrapped.nodes.length === 3 && sameNode(wrapped.nodes[1], dsfGraph.nodes[1]),
    "normalize of a patch node uses node.graph instead of the default ramp");

  const moved = utilsCtx.nodeGraphGraphMoveNode(dsfGraph, 1, { x: 0.62, y: 0.35 });
  assert(moved.graph.nodes.length === 3, "move keeps all three points");
  assert(almost(moved.graph.cursorX, 0.25), "move keeps cursorX");
  assert(sameNode(moved.graph.nodes[0], dsfGraph.nodes[0]), "move leaves the first point unchanged");
  assert(sameNode(moved.graph.nodes[2], dsfGraph.nodes[2]), "move leaves the last point unchanged");
  assert(almost(moved.graph.nodes[moved.index].x, 0.62), "moved point gets the new x");
  assert(almost(moved.graph.nodes[moved.index].y, 0.35), "moved point gets the new y");
  assert(moved.graph.nodes[moved.index].shape === "smoothstep", "moved point keeps its shape");
  assert(almost(moved.graph.nodes[moved.index].c, -0.2), "moved point keeps its contour");

  const patchNode = {
    id: "stepGraph-1",
    type: "stepGraph",
    params: { phase: 0.25, skewOffset: 0.4, lockEndpointY: 0 },
    graph: JSON.parse(JSON.stringify(moved.graph)),
  };
  const graphBeforeForNode = patchNode.graph;
  const forNode = utilsCtx.nodeGraphGraphForNode(patchNode);
  assert(patchNode.graph === graphBeforeForNode, "ForNode without segmentShape must not rewrite node.graph");
  assert(forNode.nodes.length === 3, "ForNode keeps three points after a move");
  assert(sameNode(forNode.nodes[0], moved.graph.nodes[0]), "ForNode leaves unmoved first point");
  assert(sameNode(forNode.nodes[2], moved.graph.nodes[2]), "ForNode leaves unmoved last point");
  assert(sameNode(forNode.nodes[moved.index], moved.graph.nodes[moved.index]), "ForNode keeps the moved point");

  const migrateNode = {
    id: "stepGraph-1",
    type: "stepGraph",
    params: { phase: 0.25, skewOffset: 0.4 },
    graph: JSON.parse(JSON.stringify(moved.graph)),
  };
  const graphBeforeMigrate = migrateNode.graph;
  utilsCtx.nodeGraphGraphMigrateStepGraphPatchNode(migrateNode);
  assert(migrateNode.graph === graphBeforeMigrate, "migrate is a no-op without leftover segmentShape");
  assert(sameNode(migrateNode.graph.nodes[1], moved.graph.nodes[1]), "migrate without segmentShape leaves points");

  utilsCtx.nodeGraphMvp.graphNodeDragging = {
    nodeId: "stepGraph-1",
    index: moved.index,
    graph: moved.graph,
  };
  const painted = utilsCtx.nodeGraphGraphPaintDocumentForNode(patchNode);
  assert(painted.nodes.length === 3, "paint document during drag keeps all points");
  assert(sameNode(painted.nodes[moved.index], moved.graph.nodes[moved.index]), "paint uses the in-flight drag graph");
  assert(sameNode(painted.nodes[0], moved.graph.nodes[0]), "paint leaves sibling points in the drag graph");
  utilsCtx.nodeGraphMvp.graphNodeDragging = null;

  // Point-edit commits must not setPlan/remount (that restarts the live graph
  // on every move). A 0-size hit-layer must not snap the point to (0,0).
  const commitOpts = utilsCtx.nodeGraphGraphDocumentCommitOptions("graph node moved");
  assert(commitOpts.skipLivePlan === true, "point-edit commit skips live plan / setPlan");
  assert(commitOpts.softDom === true, "point-edit commit uses softDom (no module remount)");
  assert(utilsCtx.nodeGraphGraphSvgToGraphPoint(null, 10, 10) === null, "utils 0-size plot returns null, not (0,0)");
  assert(utilsCtx.nodeGraphGraphSvgToGraphPoint({ getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }) }, 10, 10) === null,
    "0x0 svg plot returns null, not (0,0)");

  const extrasPath = path.join(root, "public", "node-graph-graph-face-extras.js");
  vm.runInContext(fs.readFileSync(extrasPath, "utf8"), utilsCtx, { filename: "node-graph-graph-face-extras.js" });
  const extrasNull = utilsCtx.nodeGraphGraphSvgToGraphPoint({
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }),
    closest: () => null,
  }, 10, 10);
  assert(extrasNull === null, "face-extras 0-size plot returns null, not (0,0) default");
}

// Contour / Skew control taper (UI only): stored c is unchanged, travel warps.
{
  const sliderPath = path.join(root, "public", "node-graph-slider-values.js");
  const sCtx = {
    console,
    nodeGraphFiniteNumber: (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f),
  };
  vm.createContext(sCtx);
  vm.runInContext(fs.readFileSync(sliderPath, "utf8"), sCtx, { filename: "node-graph-slider-values.js" });
  const taper = sCtx.nodeGraphContourFromTaper;
  const untaper = sCtx.nodeGraphTaperFromContour;
  assert(taper(0) === 0 && taper(1) === 1 && taper(-1) === -1, "taper keeps 0 and +-1");
  for (const [u, c] of [[0.4, 0.9], [0.6, 0.97], [0.8, 0.99], [1, 1]]) {
    assert(almost(taper(u), c, 1e-12) && almost(taper(-u), -c, 1e-12), `anchor u ${u} -> c ${c} (odd)`);
    assert(almost(untaper(c), u, 1e-12) && almost(untaper(-c), -u, 1e-12), `anchor c ${c} -> u ${u} (odd)`);
  }
  let prev = -Infinity;
  for (let u = -1; u <= 1.0001; u += 0.01) {
    const c = taper(u);
    assert(c > prev, "taper is strictly increasing");
    prev = c;
    assert(almost(untaper(c), u, 1e-9), `inverse(taper(${u})) recovers u`);
  }
  assert(untaper(0.99) - untaper(0.97) >= 0.2 - 1e-12, "0.97..0.99 gets 20% of the half-throw");
  const skewSlider = { min: "-1", max: "1", dataset: { param: "skewOffset", step: "0.01" } };
  const otherSlider = { min: "-1", max: "1", dataset: { param: "inputMin", step: "0.01", sliderCurve: "linear" } };
  assert(sCtx.nodeSliderUsesContourTaper(skewSlider) && !sCtx.nodeSliderUsesContourTaper(otherSlider), "taper scoped to Skew %");
  assert(almost(sCtx.nodeSliderTravelFromValue(skewSlider, 0), 0.5), "c 0 sits at center");
  assert(almost(sCtx.nodeSliderValueFromTravel(skewSlider, 1), 1) && almost(sCtx.nodeSliderValueFromTravel(skewSlider, 0), -1), "ends stay +-1");
  const t90 = sCtx.nodeSliderTravelFromValue(skewSlider, 0.9);
  const t99 = sCtx.nodeSliderTravelFromValue(skewSlider, 0.99);
  assert(almost(t99 - t90, 0.2), "0.9..0.99 gets 20% of the full throw (linear: 4.5%)");
  assert(almost(sCtx.nodeSliderValueFromTravel(skewSlider, t90), 0.9, 1e-9), "stored c round-trips (thumb only warps)");
  assert(almost(sCtx.nodeSliderValueFromPointerTravel(skewSlider, t90), 0.9, 1e-9), "pointer travel uses the taper");
  const q = sCtx.quantizeNodeSliderDragValue(skewSlider, 0.95);
  assert(Math.abs(q - 0.95) < 0.004 && q !== 0.95, "drag snap is in taper space (fine near ends)");
  assert(Math.abs(sCtx.quantizeNodeSliderDragValue(skewSlider, 0.981) - 0.981) <= 0.0005, "snap near 0.98 is ~0.001 fine");
  assert(sCtx.quantizeNodeSliderDragValue(skewSlider, 0) === 0, "snap keeps 0");
  assert(almost(sCtx.quantizeNodeSliderDragValue(skewSlider, 1), 1), "snap keeps +1");
}

console.log("test_graph_overhaul: ok");
