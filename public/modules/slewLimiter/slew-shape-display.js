// Up/Down Slew (slewLimiter) face: normalized glide shapes.
// Left half  = UP shape   0 -> 1 over its own normalized time.
// Right half = DOWN shape 1 -> 0 over its own normalized time.
// Times (Up/Down Slew) only scale the time axis, so the face shows the curve
// shape alone. Shape law = native_modules/slew_limiter/slew_limiter.cpp
// applyShape (kCurveK 3.5): Lin x | Log 1-(1-x)^k | Exp x^k | Smooth 0.5-0.5cos(pi x).
// Display twin only; does not process audio.
//
// Drawing: WebGL2 only via public/lib/visual/gl-line-renderer.js (shader-
// expanded capsules, smoothstep edge). No 2D drawing; if GL can't run the face
// is a plain black square. Canvas sized by nodeGraphSizeDisplayCanvas (layout
// css x dpr, never x zoom); class node-filter-curve-canvas is on the
// styles.css .pixelated-canvas-zoom list (nearest-neighbor above 2.5x).

const NODE_GRAPH_SLEW_SHAPE_CURVE_K = 3.5;
const NODE_GRAPH_SLEW_SHAPE_FACE = Object.freeze({
  background: [2 / 255, 6 / 255, 9 / 255, 1],
  up: [127 / 255, 199 / 255, 217 / 255, 1],
  down: [255 / 255, 130 / 255, 110 / 255, 1],
  lineThicknessCss: 1.5,
});

function nodeGraphSlewShapeNorm(shape) {
  const n = Math.round(Number(shape) || 0);
  return Math.max(0, Math.min(3, n));
}

// slew_limiter.cpp applyShape(t, shape).
function nodeGraphSlewShapeApply(t, shape) {
  const x = t <= 0 ? 0 : (t >= 1 ? 1 : t);
  const k = NODE_GRAPH_SLEW_SHAPE_CURVE_K;
  switch (nodeGraphSlewShapeNorm(shape)) {
    case 1: return 1 - Math.pow(1 - x, k);
    case 2: return Math.pow(x, k);
    case 3: return 0.5 - 0.5 * Math.cos(Math.PI * x);
    default: return x;
  }
}

function nodeGraphSlewShapeParam(nodeId, key) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const stored = Number(node?.params?.[key]);
  const fallback = Number.isFinite(stored) ? stored : 0;
  // Live slider / modulated value when available (same helper as filter faces).
  if (node && typeof nodeGraphFilterCurveLiveParam === "function") {
    const v = Number(nodeGraphFilterCurveLiveParam(node, key, fallback));
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

/**
 * Pure geometry (device px) for tests and drawing.
 * @returns {{ up: number[], down: number[], halfPx: number }}
 */
function nodeGraphSlewShapeGeometry(w, h, upShape, downShape, pixelRatio = 1) {
  const pr = Math.max(0.25, Number(pixelRatio) || 1);
  const halfPx = Math.max(0.5, (NODE_GRAPH_SLEW_SHAPE_FACE.lineThicknessCss * pr) * 0.5 - 0.5);
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.08)) + halfPx + 1;
  const half = w / 2;
  const top = pad;
  const bottom = h - pad;
  const spanY = Math.max(1, bottom - top);
  const curve = (x0, x1, fn) => {
    const pts = [];
    const n = Math.max(8, Math.ceil(x1 - x0));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      pts.push(x0 + t * (x1 - x0), bottom - fn(t) * spanY);
    }
    return pts;
  };
  return {
    // Up ends and Down starts at the same peak point (x = half, y = top): seamless.
    up: curve(pad, half, (t) => nodeGraphSlewShapeApply(t, upShape)),
    down: curve(half, w - pad, (t) => 1 - nodeGraphSlewShapeApply(t, downShape)),
    halfPx,
  };
}

function drawNodeGraphSlewShapeDisplay(section) {
  if (!section?.isConnected) return;
  const canvas = section.querySelector("canvas");
  if (!canvas || typeof nodeGraphSizeDisplayCanvas !== "function") return;
  const metrics = nodeGraphSizeDisplayCanvas(section, canvas, { pixelDensity: 1 });
  if (!metrics) return;
  const nodeId = String(section.dataset.node || "");
  const upShape = nodeGraphSlewShapeParam(nodeId, "upShape");
  const downShape = nodeGraphSlewShapeParam(nodeId, "downShape");
  const key = `${canvas.width}x${canvas.height}|${nodeGraphSlewShapeNorm(upShape)}|${nodeGraphSlewShapeNorm(downShape)}`;
  if (section._slewShapeKey === key && !section._slewShapeForce) return;
  section._slewShapeForce = false;
  const geo = nodeGraphSlewShapeGeometry(canvas.width, canvas.height, upShape, downShape, metrics.pixelRatio);
  const ok = nodeGraphSlewShapePresent(canvas, geo);
  // Only cache a good GL frame; a black square retries next sync/resize.
  section._slewShapeKey = ok ? key : "";
}

function nodeGraphSlewShapePresent(canvas, geo) {
  const F = NODE_GRAPH_SLEW_SHAPE_FACE;
  const batch = typeof nodeGraphGlLinesBegin === "function" ? nodeGraphGlLinesBegin(canvas, F.background) : null;
  if (batch) {
    nodeGraphGlLinesPolyline(batch, geo.up, geo.halfPx, 1, F.up);
    nodeGraphGlLinesPolyline(batch, geo.down, geo.halfPx, 1, F.down);
    if (nodeGraphGlLinesEnd(batch, "alpha")) return true;
  }
  if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
  return false;
}

function createNodeGraphSlewShapeDisplay(nodeId, type = "slewLimiter") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-slew-shape-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "slewLimiter");
  section.dataset.parameterVisual = "true";
  const canvas = document.createElement("canvas");
  canvas.className = "node-filter-curve-canvas node-slew-shape-canvas";
  section.append(canvas);
  // Param-driven (no animation): repaint on param sync and resize only.
  section.syncFromParameters = () => {
    section._slewShapeForce = true;
    drawNodeGraphSlewShapeDisplay(section);
  };
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      if (!section.isConnected) return;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(section);
      section._slewShapeForce = true;
      drawNodeGraphSlewShapeDisplay(section);
    });
    try { ro.observe(section); } catch (_error) { /* ignore */ }
  }
  requestAnimationFrame(() => drawNodeGraphSlewShapeDisplay(section));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.slewShapeFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("slewShapeFace", createNodeGraphSlewShapeDisplay);
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { nodeGraphSlewShapeApply, nodeGraphSlewShapeGeometry, nodeGraphSlewShapePresent };
}
