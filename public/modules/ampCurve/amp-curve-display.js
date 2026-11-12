// Amp Curve face: Lin / Exp transfer (X Env 0..1, Y Curve 0..1).
// Same law as native_modules/amp_curve/amp_curve.cpp. Display only;
// does not process audio.
//
// Drawing: WebGL2 only via public/lib/visual/gl-line-renderer.js. Canvas sized
// by nodeGraphSizeDisplayCanvas (layout css x dpr, never x workspace zoom).

const NODE_GRAPH_AMP_CURVE_FACE = Object.freeze({
  background: [2 / 255, 6 / 255, 9 / 255, 1],
  curve: [226 / 255, 168 / 255, 109 / 255, 1],
  identity: [127 / 255, 199 / 255, 217 / 255, 0.28],
  grid: [127 / 255, 199 / 255, 217 / 255, 0.18],
  lineThicknessCss: 1.5,
});

// Exp: 10^(5*(x-1)) — unity at 1, ~-100 dB near 0, exact 0 at x<=0.
const NODE_GRAPH_AMP_CURVE_EXP_DB_SPAN = 5;

/** true = Exp (default), false = Lin. */
function nodeGraphAmpCurveIsExp(node) {
  const stored = node?.params?.mode;
  let v = stored != null && stored !== "" ? stored : 1;
  if (node && typeof nodeGraphFilterCurveLiveParam === "function") {
    const live = nodeGraphFilterCurveLiveParam(node, "mode", v);
    if (live != null && live !== "") v = live;
  }
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "lin") return false;
    if (t === "exp") return true;
  }
  const n = Number(v);
  return !(Number.isFinite(n) && n < 0.5);
}

function nodeGraphAmpCurveY(x, exp) {
  const p = x <= 0 ? 0 : (x >= 1 ? 1 : x);
  if (!exp) return p;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return Math.pow(10, NODE_GRAPH_AMP_CURVE_EXP_DB_SPAN * (p - 1));
}

function drawNodeGraphAmpCurveDisplay(section) {
  if (!section?.isConnected) return;
  const canvas = section.querySelector("canvas");
  if (!canvas || typeof nodeGraphSizeDisplayCanvas !== "function") return;
  const metrics = nodeGraphSizeDisplayCanvas(section, canvas);
  if (!metrics) return;
  const node = typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(section.dataset.node || "")
    : null;
  const exp = nodeGraphAmpCurveIsExp(node);
  const { cssWidth: width, cssHeight: height, pixelRatio } = metrics;
  const key = `${width}x${height}|${exp ? "exp" : "lin"}`;
  if (section._ampCurveKey === key && !section._ampCurveForce) return;
  section._ampCurveForce = false;

  const F = NODE_GRAPH_AMP_CURVE_FACE;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, F.background, { scale: pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "amp curve: no shared GL device");
    } else if (typeof nodeGraphGlLinesFillBlack === "function") {
      nodeGraphGlLinesFillBlack(canvas);
    }
    section._ampCurveKey = "";
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const pad = Math.max(4, Math.min(width, height) * 0.08);
  const x0 = pad;
  const y0 = pad;
  const x1 = width - pad;
  const y1 = height - pad;
  const spanX = Math.max(1, x1 - x0);
  const spanY = Math.max(1, y1 - y0);
  const toX = (x) => x0 + x * spanX;
  const toY = (y) => y1 - y * spanY;
  const line = (ax, ay, bx, by, rgba) => nodeGraphGlLinesSegment(batch, ax, ay, bx, by, 0.5, fine, rgba);

  line(x0, y1, x1, y1, F.grid);
  line(x0, y0, x0, y1, F.grid);
  line(toX(0), toY(0), toX(1), toY(1), F.identity);

  const pts = Math.max(64, Math.floor(spanX));
  const curveW = typeof nodeGraphFaceStrokeWidth === "function"
    ? nodeGraphFaceStrokeWidth(section, F.lineThicknessCss)
    : F.lineThicknessCss;
  const curve = [];
  for (let i = 0; i < pts; i += 1) {
    const t = i / (pts - 1);
    curve.push(toX(t), toY(nodeGraphAmpCurveY(t, exp)));
  }
  nodeGraphGlLinesPolyline(batch, curve, curveW * 0.5, fine, F.curve);
  const ok = nodeGraphGlLinesEnd(batch, "alpha");
  if (!ok && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "amp curve: GL present failed");
  }
  section._ampCurveKey = ok ? key : "";
}

function createNodeGraphAmpCurveDisplay(nodeId, type = "ampCurve") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-amp-curve-display node-module-face";
  if (typeof markCurveFacePlate === "function") {
    markCurveFacePlate(section, "ampCurveFace");
  } else {
    section.dataset.faceKind = "ampCurveFace";
    section.setAttribute("data-face-kind", "ampCurveFace");
  }
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "ampCurve");
  section.dataset.parameterVisual = "true";
  const canvas = typeof nodeGraphDisplayCanvasCreate === "function"
    ? nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-amp-curve-canvas")
    : document.createElement("canvas");
  if (!canvas.className) canvas.className = "node-filter-curve-canvas node-amp-curve-canvas";
  section.append(canvas);
  section.syncFromParameters = () => {
    section._ampCurveForce = true;
    if (typeof syncFaceMetrics === "function") syncFaceMetrics(section);
    drawNodeGraphAmpCurveDisplay(section);
  };
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      if (!section.isConnected) return;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(section);
      section._ampCurveForce = true;
      drawNodeGraphAmpCurveDisplay(section);
    });
    try { ro.observe(section); } catch (_error) { /* ignore */ }
  }
  requestAnimationFrame(() => drawNodeGraphAmpCurveDisplay(section));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.ampCurveFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("ampCurveFace", createNodeGraphAmpCurveDisplay);
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { nodeGraphAmpCurveY, createNodeGraphAmpCurveDisplay };
}
