// Harmonic count face — shows H for Additive Generator / Effect.

function createNodeGraphHarmonicCountDisplay(nodeId, type = "additiveGenerator") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-harmonic-count-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "additiveGenerator");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.5";
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-harmonic-count-canvas");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `harmonicCount:${el.dataset?.node || ""}`,
    paint: drawNodeGraphHarmonicCountDisplay,
  });
  return section;
}

const ADDITIVE_NAMED_FACE = Object.freeze({
  additiveFrequencySkew: "FreqSkew",
  additiveSync: "Sync",
  additiveQuantizeFreq: "QFreq",
  additiveQuantizePhase: "QPhase",
  additiveNoisyFreq: "NoisyFreq",
  additiveNoisyPhase: "NoisyPhase",
  additivePan: "AutoPan",
  additiveNoisyPan: "NoisyPan",
  additiveNoisyAmp: "NoisyAmp",
  additiveDiffusor: "Diffusor",
  additivePhaseEntry: "PhaseEntry",
});

function nodeGraphHarmonicCountReadH(nodeId, type) {
  if (type === "additiveGenerator") {
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
    const stored = Number(node?.params?.harmonics ?? node?.parameters?.harmonics);
    const base = Number.isFinite(stored) && stored > 0 ? stored : 0;
    const meta = (typeof nodeGraphReadPatchParameterMetadata === "function"
      ? nodeGraphReadPatchParameterMetadata(nodeId, "harmonics")
      : node?.paramMeta?.harmonics) || {};
    const ghost = typeof nodeGraphParameterGhostSignal === "function"
      ? nodeGraphParameterGhostSignal(nodeId, "harmonics")
      : null;
    const ghostN = Number(ghost?.effectiveDomain);
    if (Number.isFinite(ghostN) && ghostN > 0) return ghostN;
    if (typeof nodeGraphParamFoldOrBase === "function" && base > 0) {
      const folded = Number(nodeGraphParamFoldOrBase(base, [], meta));
      if (Number.isFinite(folded) && folded > 0) return folded;
    }
    if (base > 0) return base;
  }
  const graph = typeof readNodeGraphDataInput === "function"
    ? readNodeGraphDataInput(nodeId, "Graph")
    : null;
  const published = typeof nodeGraphDataBus !== "undefined"
    ? nodeGraphDataBus.get?.(`${nodeId}.Graph`)
    : null;
  const g = published || graph;
  if (g && Number.isFinite(g.harmonicsExact)) return g.harmonicsExact;
  if (g && Number.isFinite(g.harmonics)) return g.harmonics;
  if (g?.ratio?.length) return g.ratio.length;
  return 0;
}

function nodeGraphHarmonicCountFaceText(nodeId, type) {
  if (ADDITIVE_NAMED_FACE[type]) {
    return ADDITIVE_NAMED_FACE[type];
  }
  const H = nodeGraphHarmonicCountReadH(nodeId, type);
  if (!(H > 0)) return "—";
  // Show one decimal when fractional (30.5); integers stay clean ("32").
  const rounded = Math.round(H);
  if (Math.abs(H - rounded) < 1e-6) return String(rounded);
  return H.toFixed(1);
}

function drawNodeGraphHarmonicCountDisplay(section) {
  if (!section) return;
  const canvas = section.querySelector("canvas");
  if (!canvas) return;

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
  const type = section.dataset.nodeType;
  const text = nodeGraphHarmonicCountFaceText(nodeId, type);
  // Named faces (Bubble / Noisy) need a smaller font than a single H digit.
  const isName = Boolean(ADDITIVE_NAMED_FACE[type]);
  const fontPx = isName
    ? Math.max(11, Math.min(18, Math.floor(Math.min(h * 0.42, w / Math.max(8, text.length) * 1.6))))
    : Math.max(14, Math.floor(h * 0.45));
  // CMYK Y face ink (Yellow Graph plane), shared glyph atlas.
  nodeGraphGlLinesText(batch, text, w * 0.5, h * 0.5, { px: fontPx, weight: 600, family: "ui-monospace, monospace", rgba: [1, 230 / 255, 0, 1] });
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
  section._forceDraw = false;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.harmonicCount = () => {};
}
