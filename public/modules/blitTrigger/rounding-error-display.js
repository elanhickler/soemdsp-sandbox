// Rounding Error Sequencer display: the loop computed ahead of time, one bar
// per step (height = that step's accent), playhead on the live Step output.
// Same math as blit_trigger.cpp: step k starts at Rotate + k * Spacing
// internal samples, a band-limited gate of Gate samples; its peak on the grid
// is the accent. Length 0 (free) shows the next 16 steps. GPU only, shared
// line / text drawer (gl-line-renderer).

const NODE_GRAPH_ROUNDING_ERROR_LATENCY = 2;

function nodeGraphRoundingErrorCdf(x) {
  if (x <= -2) return 0;
  if (x >= 2) return 1;
  if (x <= -1) { const t = x + 2; return t * t * t * t / 24; }
  if (x <= 0) { const x2 = x * x; return 1 / 24 + (4 * x - 2 * x2 * x - 0.75 * x2 * x2 + 2.75) / 6; }
  return 1 - nodeGraphRoundingErrorCdf(-x);
}

function nodeGraphRoundingErrorGateAt(x, t0, w) {
  const L = NODE_GRAPH_ROUNDING_ERROR_LATENCY;
  return nodeGraphRoundingErrorCdf(x - L - t0) - nodeGraphRoundingErrorCdf(x - L - t0 - w);
}

/** Accent of a step starting at t0 (internal samples): its peak on the grid. */
function nodeGraphRoundingErrorPeak(t0, w) {
  if (!(w > 0)) return 0;
  const a = Math.floor(t0 + NODE_GRAPH_ROUNDING_ERROR_LATENCY - 2);
  let best = 0;
  const n = 8 + Math.floor(w);
  for (let i = 0; i < n; i += 1) best = Math.max(best, nodeGraphRoundingErrorGateAt(a + i, t0, w));
  return best;
}

function nodeGraphRoundingErrorParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/** { accents[], loop } for the node's current settings. */
function nodeGraphRoundingErrorPattern(node) {
  const spacing = Math.max(1, nodeGraphRoundingErrorParam(node, "spacing", 7.3));
  const rotate = Math.min(1, Math.max(0, nodeGraphRoundingErrorParam(node, "rotate", 0)));
  const gate = Math.max(0, nodeGraphRoundingErrorParam(node, "gate", 2));
  const length = Math.round(Math.max(0, nodeGraphRoundingErrorParam(node, "length", 8)));
  const count = length > 0 ? Math.min(64, length) : 16;
  const accents = [];
  for (let k = 0; k < count; k += 1) accents.push(nodeGraphRoundingErrorPeak(rotate + k * spacing, gate));
  return { accents, loop: length > 0 };
}

function drawNodeGraphRoundingErrorFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const { accents, loop } = nodeGraphRoundingErrorPattern(node);
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(String(node.id), "Step", Number.NaN))
    : Number.NaN;
  const play = Number.isFinite(live) ? Math.round(live) % Math.max(1, accents.length) : -1;
  const sig = `${w}x${h}|${accents.map((a) => a.toFixed(3)).join(",")}|${play}|${loop}`;
  if (sig === section._roundingErrorSig && !section._roundingErrorForceDraw) return;
  section._roundingErrorSig = sig;
  section._roundingErrorForceDraw = false;
  const rgba = (css, fallback) => (typeof nodeGraphGlGraphParseCssColor === "function"
    ? nodeGraphGlGraphParseCssColor(css, fallback)
    : fallback);
  const batch = nodeGraphGlLinesBegin(canvas, rgba("#06080c", [0.02, 0.03, 0.05, 1]), { scale: pixelRatio });
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "rounding error: no shared GL device");
    return;
  }
  const pad = 6;
  const label = 14;
  const n = Math.max(1, accents.length);
  const slot = (w - pad * 2) / n;
  const gap = Math.min(3, slot * 0.25);
  const floor = h - pad - label;
  const top = pad;
  const gold = rgba("#e2b44a", [0.89, 0.71, 0.29, 1]);
  const goldDim = rgba("#7a6127", [0.48, 0.38, 0.15, 1]);
  const guide = rgba("#1d2633", [0.11, 0.15, 0.2, 1]);
  nodeGraphGlLinesRect(batch, pad, floor, w - pad * 2, 1, guide);
  accents.forEach((a, i) => {
    const x = pad + i * slot + gap * 0.5;
    const bh = Math.max(1, a * (floor - top));
    nodeGraphGlLinesRect(batch, x, floor - bh, Math.max(1, slot - gap), bh, i === play ? gold : goldDim);
  });
  const text = loop ? `${n} steps, loops` : "free: next 16 steps";
  nodeGraphGlLinesText(batch, text, pad, h - pad, {
    px: 11, rgba: rgba("#7fc7d9", [0.5, 0.78, 0.85, 1]), align: "left", baseline: "bottom", weight: 400,
    family: "\"Cascadia Mono\", Consolas, \"Courier New\", monospace",
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "rounding error: GL present failed");
  }
}

function createNodeGraphRoundingErrorFace(nodeId, type = "blitTrigger") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-rounding-error-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "blitTrigger");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-rounding-error-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `roundingError:${el.dataset?.node || ""}`,
    forceKey: "_roundingErrorForceDraw",
    rafKey: "_roundingErrorRaf",
    paint: drawNodeGraphRoundingErrorFace,
    onResize: (el) => {
      el._roundingErrorForceDraw = true;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    section._roundingErrorForceDraw = true;
    drawNodeGraphRoundingErrorFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.roundingErrorFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("roundingErrorFace", createNodeGraphRoundingErrorFace);
}
