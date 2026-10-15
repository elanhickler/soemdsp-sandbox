// Blaster face — blocks for phase bins.
// Index layout: equal-width columns (Q=2 → half/half, Q=4 → quarters).
// Log Freq layout: equal segments of the shared log-Hz axis.

function createNodeGraphAdditiveBlasterDisplay(nodeId, type = "additiveBlaster") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-additive-blaster-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "additiveBlaster");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.6";
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-additive-blaster-canvas");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `additiveBlaster:${el.dataset?.node || ""}`,
    paint: drawNodeGraphAdditiveBlasterDisplay,
  });
  return section;
}

function nodeGraphAdditiveBlasterReadGraph(nodeId) {
  if (typeof nodeGraphDataBus !== "undefined") {
    const pub = nodeGraphDataBus.get?.(`${nodeId}.Graph`);
    if (pub?.ratio) return pub;
  }
  if (typeof readNodeGraphDataInput === "function") {
    const g = readNodeGraphDataInput(nodeId, "Graph");
    if (g?.ratio) return g;
  }
  return null;
}

function nodeGraphAdditiveBlasterPhaseColor(phase01, binIndex = 0) {
  const p = ((nodeGraphFiniteNumber(phase01)) % 1 + 1) % 1;
  // Prefer true phase hue; fall back to bin index so empty/identical still read.
  const hue = Math.floor((((p > 1e-6 ? p : (binIndex * 0.17)) % 1) + 1) % 1 * 360);
  return `hsl(${hue} 80% 55%)`;
}

function nodeGraphAdditiveBlasterPhaseRgba(phase01, binIndex = 0, alpha = 1) {
  const p = ((nodeGraphFiniteNumber(phase01)) % 1 + 1) % 1;
  const hue = Math.floor((((p > 1e-6 ? p : (binIndex * 0.17)) % 1) + 1) % 1 * 360);
  return nodeGraphGlLinesHsl(hue, 0.8, 0.55, alpha);
}

function drawNodeGraphAdditiveBlasterDisplay(section) {
  if (!section) return;
  const canvas = section.querySelector("canvas");
  if (!canvas) return;

  // Shared sizing (css x dpr, never zoom); drawing is WebGL2 via gl-line-renderer.
  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(section, canvas) : null;
  if (!m || m.cssWidth < 8 || m.cssHeight < 8) return;
  const w = m.cssWidth;
  const h = m.cssHeight;

  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [10 / 255, 10 / 255, 18 / 255, 1], { scale: m.pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    section._forceDraw = false;
    return;
  }

  const nodeId = section.dataset.node;
  const graph = nodeGraphAdditiveBlasterReadGraph(nodeId);
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const p = node?.params || node?.parameters || {};
  const Q = Number(p.quantization);
  const quantization = Number.isFinite(Q) ? Q : 0;
  // Face always uses equal-width index columns (Layout control removed).
  const layout = 0;

  if (!graph || !graph.ratio || !graph.ratio.length) {
    nodeGraphGlLinesText(batch, "no Graph", w * 0.5, h * 0.5, { px: 12, weight: 400, family: "ui-monospace, monospace", rgba: [0.4, 0.4, 0.4, 1] });
    nodeGraphGlLinesEnd(batch);
    section._forceDraw = false;
    return;
  }

  const H = Math.max(1, graph.ratio.length | 0);
  let freqHz = Number(graph.frequencyHz ?? node?.params?.frequency ?? 100);
  if (!Number.isFinite(freqHz) || !(freqHz > 0)) freqHz = 100;
  const sr = nodeGraphFiniteNumber(nodeGraphMvp?.sampleRate, nodeGraphFiniteNumber(nodeGraphMvp?.live?.sampleRate, 44100));

  const bins = typeof additiveGraphBlasterBins === "function"
    ? additiveGraphBlasterBins(H, quantization, layout, graph, freqHz, sr)
    : [{ start: 0, end: H, phase: 0, t0: 0, t1: 1 }];

  const padY = 4;
  const barH = Math.max(8, h - padY * 2);
  const gap = 1;

  // Both layouts use t0/t1 in 0…1 across the face so Q=2/4 read as halves/quarters.
  // Index: t from equal slot bins. Log: t from equal log-Hz segments.
  for (let b = 0; b < bins.length; b += 1) {
    const bin = bins[b];
    const t0 = Number.isFinite(bin.t0) ? bin.t0 : b / Math.max(1, bins.length);
    const t1 = Number.isFinite(bin.t1) ? bin.t1 : (b + 1) / Math.max(1, bins.length);
    const left = t0 * w;
    const right = t1 * w;
    const bw = Math.max(2, right - left - gap);
    const phase = Number.isFinite(bin.phase)
      ? bin.phase
      : (bin.start >= 0 ? nodeGraphFiniteNumber(graph.phase?.[bin.start]) : 0);
    nodeGraphGlLinesRect(batch, left, padY, bw, barH, nodeGraphAdditiveBlasterPhaseRgba(phase, b, bin.start >= 0 ? 0.9 : 0.25));
    // 1 px dark inner border (was strokeRect).
    const edge = [0, 0, 0, 0.65];
    nodeGraphGlLinesRect(batch, left, padY, bw, 1, edge);
    nodeGraphGlLinesRect(batch, left, padY + barH - 1, bw, 1, edge);
    nodeGraphGlLinesRect(batch, left, padY + 1, 1, barH - 2, edge);
    nodeGraphGlLinesRect(batch, left + bw - 1, padY + 1, 1, barH - 2, edge);
  }
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);

  section._forceDraw = false;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.additiveBlasterBlocks = () => {};
}
