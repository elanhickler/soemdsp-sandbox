// Harmonic Series face — harmonic index (zero-based + offset) and output Hz.

const NODE_GRAPH_HARMONIC_SERIES_FACE_FONT =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

function nodeGraphHarmonicSeriesFaceFormatEffective(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n - Math.round(n)) < 0.0005) {
    return String(Math.round(n));
  }
  const fixed = n.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
}

function nodeGraphHarmonicSeriesFaceFormatHz(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(1);
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 10) return n.toFixed(2);
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return n.toFixed(2);
}

function nodeGraphHarmonicSeriesFaceHasInput(nodeId, port) {
  if (typeof nodeGraphModuleScopeConnectionsTo !== "function") {
    return false;
  }
  return nodeGraphModuleScopeConnectionsTo(nodeId, port).some(
    (candidate) => candidate?.sourceNode && candidate?.sourcePort,
  );
}

function nodeGraphHarmonicSeriesFaceInputValue(nodeId, port) {
  if (typeof nodeGraphModuleScopeConnectedSourceBuffer !== "function") {
    return 0;
  }
  const buffer = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port);
  if (!buffer?.length) {
    return 0;
  }
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    const value = Number(buffer[index]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function nodeGraphHarmonicSeriesFaceReadout(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const harmonic = Number(node?.params?.harmonic);
  const offset = Number(node?.params?.offset);
  const h = Number.isFinite(harmonic) ? harmonic : 0;
  const o = Number.isFinite(offset) ? offset : 0;
  const effective = typeof nodeGraphHarmonicSeriesEffective === "function"
    ? nodeGraphHarmonicSeriesEffective(h, o)
    : h + o;

  let hz = Number.NaN;
  if (typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    hz = nodeGraphModuleScopeLatestOutputValue(nodeId, "f", Number.NaN);
  }
  if (!Number.isFinite(hz)) {
    const knobHz = Number(node?.params?.frequency);
    const base = nodeGraphHarmonicSeriesFaceHasInput(nodeId, "f")
      ? nodeGraphHarmonicSeriesFaceInputValue(nodeId, "f")
      : (Number.isFinite(knobHz) ? knobHz : 100);
    if (typeof nodeGraphHarmonicSeriesSample === "function") {
      hz = nodeGraphHarmonicSeriesSample(base, h, o).f;
    } else {
      const mult = effective >= 0 ? 1 + effective : 1 / (1 - effective);
      hz = base * mult;
    }
  }
  return { effective, hz };
}

function createNodeGraphHarmonicSeriesDisplay(nodeId, type = "harmonicSeries") {
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-harmonic-series-display node-module-face";
  section.dataset.node = String(nodeId || "");
  section.dataset.nodeType = String(type || "harmonicSeries");
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.4";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-harmonic-series-canvas node-module-scope-vector-trace");
  canvas.setAttribute("aria-hidden", "true");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `harmonicSeries:${el.dataset?.node || ""}`,
    paint: drawNodeGraphHarmonicSeriesFaceItem,
    onResize: (el) => { el._harmonicSeriesLaidOut = false; },
  });
  return section;
}

function drawNodeGraphHarmonicSeriesFaceItem(sectionOrRenderer, item) {
  const section = sectionOrRenderer?.classList?.contains?.("node-harmonic-series-display")
    ? sectionOrRenderer
    : (item?.screenElement?.closest?.(".node-harmonic-series-display")
      || item?.slot?.scopeElement
      || null);
  if (!section) {
    return;
  }
  const nodeId = section.dataset?.node || item?.slot?.nodeId;
  if (!nodeId) {
    return;
  }
  const canvas = section.querySelector?.(".node-harmonic-series-canvas")
    || section.querySelector?.("canvas");
  if (!canvas) {
    return;
  }
  const readout = nodeGraphHarmonicSeriesFaceReadout(nodeId);
  const harmText = nodeGraphHarmonicSeriesFaceFormatEffective(readout.effective);
  const hzText = nodeGraphHarmonicSeriesFaceFormatHz(readout.hz);
  const faceMetrics = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(section, { observe: true })
    : null;
  const rawW = faceMetrics
    ? faceMetrics.cssW
    : nodeGraphFiniteNumber(section.clientWidth || section.offsetWidth);
  const rawH = faceMetrics
    ? faceMetrics.cssH
    : nodeGraphFiniteNumber(section.clientHeight || section.offsetHeight);
  const signature = `${harmText}|${hzText}|${Math.round(rawW)}|${Math.round(rawH)}`;
  if (
    !section._forceDraw
    && section._harmonicSeriesSignature === signature
    && section._harmonicSeriesLaidOut
  ) {
    return;
  }
  if (rawW < 8 || rawH < 8) {
    section._harmonicSeriesLaidOut = false;
    section._forceDraw = true;
    return;
  }

  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(section, canvas) : null;
  if (!m || !(m.cssWidth >= 8) || !(m.cssHeight >= 8)) {
    return;
  }
  const width = m.cssWidth;
  const height = m.cssHeight;
  section._harmonicSeriesSignature = signature;
  section._forceDraw = false;
  section._harmonicSeriesLaidOut = true;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [0, 0, 4 / 255, 1], { scale: m.pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const harmSize = Math.max(14, Math.min(height * 0.42, width * 0.28));
  const hzSize = Math.max(11, Math.min(height * 0.28, width * 0.18));
  const unitSize = Math.max(8, Math.min(height * 0.16, width * 0.08));
  const opt = (px, rgba) => ({ px, rgba, weight: 700, family: NODE_GRAPH_HARMONIC_SERIES_FACE_FONT, maxWidth: width - 8 });
  nodeGraphGlLinesText(batch, harmText, width * 0.5, height * 0.38, opt(harmSize, [160 / 255, 214 / 255, 228 / 255, 0.98]));
  nodeGraphGlLinesText(batch, hzText, width * 0.5, height * 0.68, opt(hzSize, [160 / 255, 214 / 255, 228 / 255, 0.92]));
  nodeGraphGlLinesText(batch, "Hz", width * 0.5, height * 0.88, opt(unitSize, [160 / 255, 167 / 255, 176 / 255, 0.82]));
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.harmonicSeriesFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("harmonicSeriesFace", createNodeGraphHarmonicSeriesDisplay);
}
