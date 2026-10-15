// Bubble face — one-cycle bake of the waveform Bubble produces.
// Clone incoming Graph → ApplyGrowl with current knobs → BakeWaveform.

function createNodeGraphAdditiveBubbleDisplay(nodeId, type = "additiveBubble") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-additive-bubble-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "additiveBubble");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.55";
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-additive-bubble-canvas");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `additiveBubble:${el.dataset?.node || ""}`,
    paint: drawNodeGraphAdditiveBubbleDisplay,
    onSync: (el) => { el._bakeKey = ""; },
  });
  return section;
}

function nodeGraphAdditiveBubbleReadIncomingGraph(nodeId) {
  // Prefer published output (already processed) when the bus has it.
  if (typeof nodeGraphDataBus !== "undefined") {
    const pub = nodeGraphDataBus.get?.(`${nodeId}.Graph`);
    if (pub?.ratio) return { graph: pub, processed: true };
  }
  if (typeof readNodeGraphDataInput === "function") {
    const g = readNodeGraphDataInput(nodeId, "Graph");
    if (g?.ratio) return { graph: g, processed: false };
  }
  return { graph: null, processed: false };
}

function nodeGraphAdditiveBubbleReadParams(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const p = node?.params || node?.parameters || {};
  const num = typeof nodeGraphFiniteNumber === "function"
    ? nodeGraphFiniteNumber
    : (v, fb) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fb;
    };
  const bubble = Math.max(0, Math.min(1, num(p.bubble, 0)));
  const invert = num(p.invertBubble, 0) >= 0.5;
  return {
    phaseSkew: num(p.phaseSkew, 0),
    bubble,
    invertBubble: invert ? 1 : 0,
    skewAmount: invert ? -bubble : bubble,
    cutoff: num(p.cutoff, 1),
    unskew: num(p.unskew, 481.53),
  };
}

function nodeGraphAdditiveBubbleFingerprint(graph, params) {
  if (!graph || !graph.ratio) return "";
  const H = Math.min(graph.ratio.length | 0, 64);
  let h = `${H}|`;
  const step = Math.max(1, (H / 8) | 0);
  for (let i = 0; i < H; i += step) {
    h += `${(nodeGraphFiniteNumber(graph.ratio[i])).toFixed(4)},`;
    h += `${(nodeGraphFiniteNumber(graph.amplitude?.[i])).toFixed(3)},`;
    h += `${(nodeGraphFiniteNumber(graph.phase?.[i])).toFixed(3)};`;
  }
  h += `|${params.phaseSkew.toFixed(3)}|${(nodeGraphFiniteNumber(params.bubble)).toFixed(4)}`;
  h += `|${params.invertBubble ? 1 : 0}|${params.cutoff.toFixed(4)}|${params.unskew.toFixed(3)}`;
  return h;
}

function nodeGraphAdditiveBubbleBuildPreviewGraph(incoming, params) {
  if (!incoming?.ratio || typeof additiveGraphClonePayload !== "function") return null;
  if (typeof additiveGraphApplyGrowl !== "function") return additiveGraphClonePayload(incoming);
  const out = additiveGraphClonePayload(incoming);
  if (!out) return null;
  let cutoff = Number(params.cutoff);
  if (!(cutoff === cutoff)) cutoff = 1;
  const phaseSkew = typeof additiveGraphBubbleEffectivePhaseSkew === "function"
    ? additiveGraphBubbleEffectivePhaseSkew(params.phaseSkew, params.unskew, cutoff)
    : params.phaseSkew;
  additiveGraphApplyGrowl(
    out,
    0,
    phaseSkew,
    params.skewAmount,
    2, // Logarithmic
    cutoff,
    0,
    null,
  );
  return out;
}

function drawNodeGraphAdditiveBubbleDisplay(section) {
  if (!section) return;
  const canvas = section.querySelector("canvas");
  if (!canvas) return;

  // Shared sizing (css x dpr, never zoom); drawing is WebGL2 via gl-line-renderer.
  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(section, canvas) : null;
  if (!m || m.cssWidth < 8 || m.cssHeight < 8) return;
  const w = m.cssWidth;
  const h = m.cssHeight;

  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [5 / 255, 5 / 255, 8 / 255, 1], { scale: m.pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    section._forceDraw = false;
    return;
  }

  const nodeId = section.dataset.node;
  const params = nodeGraphAdditiveBubbleReadParams(nodeId);
  const { graph: incoming, processed } = nodeGraphAdditiveBubbleReadIncomingGraph(nodeId);
  if (!incoming || !incoming.ratio || !incoming.ratio.length) {
    nodeGraphGlLinesText(batch, "—", w * 0.5, h * 0.5, { px: 11, weight: 400, family: "ui-monospace, monospace", rgba: [0.4, 0.4, 0.4, 1] });
    nodeGraphGlLinesEnd(batch);
    section._forceDraw = false;
    return;
  }

  // If bus already has Bubble's output, bake that; else apply knobs locally.
  const preview = processed
    ? incoming
    : nodeGraphAdditiveBubbleBuildPreviewGraph(incoming, params);
  if (!preview?.ratio) {
    nodeGraphGlLinesEnd(batch);
    section._forceDraw = false;
    return;
  }

  const N = Math.max(64, Math.min(256, Math.round(w)));
  const key = `${N}|${nodeGraphAdditiveBubbleFingerprint(preview, params)}|${processed ? 1 : 0}`;
  if (!section._wave || section._wave.length !== N || section._bakeKey !== key) {
    if (!section._wave || section._wave.length !== N) {
      section._wave = new Float32Array(N);
    }
    if (typeof additiveGraphBakeWaveform === "function") {
      additiveGraphBakeWaveform(preview, section._wave, 64);
    }
    section._bakeKey = key;
  }

  const wave = section._wave;
  const midY = h * 0.5;
  const ampY = h * 0.42;
  const pad = Math.max(2, w * 0.03);
  const span = Math.max(1, w - pad * 2);

  // CMYK Y ink — same plane as Generator face.
  const pts = new Array(wave.length * 2);
  for (let n = 0; n < wave.length; n += 1) {
    pts[n * 2] = pad + (n / Math.max(1, wave.length - 1)) * span;
    pts[n * 2 + 1] = midY - (nodeGraphFiniteNumber(wave[n])) * ampY;
  }
  // 1.5 px CMYK Y ink (was 2D lineWidth 1.5): core 0.4 + 0.7 smoothstep feather.
  nodeGraphGlLinesPolyline(batch, pts, 0.4, 0.7, [1, 210 / 255, 40 / 255, 1]);
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
  section._forceDraw = false;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.additiveBubbleCascade = () => {};
}
