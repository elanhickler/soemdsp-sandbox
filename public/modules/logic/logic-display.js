// Logic face: GPU lamps for A, B, and each boolean out (high = on).
// Layout (3×3): A B AND / OR XOR NAND / NOR XNOR NOT. Thru is analog (no lamp).
// Reads live named outs; A from Thru (>0), B from __B. WebGL2 only.

const nodeGraphLogicLampsFaceKeys = Object.freeze([
  ["A", "A"],
  ["B", "B"],
  ["AND", "AND"],
  ["OR", "OR"],
  ["XOR", "XOR"],
  ["NAND", "NAND"],
  ["NOR", "NOR"],
  ["XNOR", "XNOR"],
  ["NOT", "NOT"],
]);

function nodeGraphLogicLampsFaceOn(nodeId, key) {
  if (typeof nodeGraphModuleScopeLatestOutputValue !== "function") return false;
  const port = key === "A" ? "Thru" : key === "B" ? "__B" : key;
  const v = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, port, 0));
  return Number.isFinite(v) && v > 0;
}

function nodeGraphLogicLampsFaceGeometry(w, h, stroke, smoothing = 0) {
  const cols = 3;
  const rows = 3;
  const pad = Math.max(6, Math.min(w, h) * 0.08) + stroke * 0.5 + Math.max(0, smoothing);
  const cell = Math.min(Math.max(1, w - pad * 2) / cols, Math.max(1, h - pad * 2) / rows);
  const r = Math.max(1, cell * 0.32);
  const x0 = (w - cell * cols) * 0.5;
  const y0 = (h - cell * rows) * 0.5;
  const dots = [];
  for (let i = 0; i < 9; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    dots.push([x0 + cell * (col + 0.5), y0 + cell * (row + 0.5)]);
  }
  return { dots, r };
}

function drawNodeGraphLogicLampsFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const look = typeof nodeGraphClockDividerFaceSettingsForNode === "function"
    ? nodeGraphClockDividerFaceSettingsForNode(node)
    : typeof normalizeNodeGraphRoundShapeFaceSettings === "function"
      ? normalizeNodeGraphRoundShapeFaceSettings(node?.traceDisplaySettings)
      : { backgroundPaint: "#05080c", strokePaint: "#3a6a78", dotPaint: "#7ad4ff", lineThickness: 1.5, lineSmoothing: 1 };
  const rgba = (css) => (typeof nodeGraphGlGraphParseCssColor === "function"
    ? nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1])
    : [1, 1, 1, 1]);
  const bg = rgba(look.backgroundPaint);
  const batch = nodeGraphGlLinesBegin(canvas, bg, { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "logic lamps face: no shared GL device");
    return;
  }
  const smoothing = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look.lineSmoothing) || 1);
  const stroke = look.lineThickness;
  const g = nodeGraphLogicLampsFaceGeometry(w, h, stroke, smoothing);
  const ring = rgba(look.strokePaint);
  const lit = rgba(look.dotPaint);
  const nodeId = section.dataset.node;
  g.dots.forEach(([x, y], i) => {
    const on = nodeGraphLogicLampsFaceOn(nodeId, nodeGraphLogicLampsFaceKeys[i][0]);
    if (on) {
      nodeGraphGlLinesDot(batch, x, y, g.r, smoothing, lit);
    } else {
      nodeGraphGlLinesDot(batch, x, y, g.r, smoothing, ring);
      const inner = g.r - Math.max(0.5, stroke);
      if (inner > 0.5) nodeGraphGlLinesDot(batch, x, y, inner, smoothing, bg);
    }
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "logic lamps face: GL present failed");
}

function createNodeGraphLogicLampsFace(nodeId, type = "logic") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-logic-lamps-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "logic");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-logic-lamps-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `logicLamps:${el.dataset?.node || ""}`,
    forceKey: "_logicLampsForceDraw",
    rafKey: "_logicLampsRaf",
    paint: drawNodeGraphLogicLampsFace,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphLogicLampsFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.logicLampsFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("logicLampsFace", createNodeGraphLogicLampsFace);
}
