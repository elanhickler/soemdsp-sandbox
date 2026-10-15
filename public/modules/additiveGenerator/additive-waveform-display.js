// Additive Generator face — cheap one-cycle bake from Yellow Graph.
// O(min(H,64)·N); rebakes when Graph fingerprint changes.

function createNodeGraphAdditiveWaveformDisplay(nodeId, type = "additiveGenerator") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-additive-waveform-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "additiveGenerator");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.55";
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-additive-waveform-canvas");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `additiveWaveform:${el.dataset?.node || ""}`,
    paint: drawNodeGraphAdditiveWaveformDisplay,
    onSync: (el) => { el._bakeKey = ""; },
  });
  return section;
}

/** First Additive Out reached by walking Graph outputs. */
function nodeGraphAdditiveWaveformDownstreamOutId(nodeId) {
  const connections = Array.isArray(nodeGraphMvp?.patch?.connections)
    ? nodeGraphMvp.patch.connections
    : [];
  const start = String(nodeId || "");
  const stack = [start];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id !== start) {
      const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
      if (String(node?.type || "") === "additiveOut") return id;
    }
    for (let i = 0; i < connections.length; i += 1) {
      const c = connections[i];
      if (!c || String(c.sourceNode || "") !== id) continue;
      if (String(c.sourcePort || "") !== "Graph") continue;
      stack.push(String(c.destinationNode || ""));
    }
  }
  return "";
}

function nodeGraphAdditiveWaveformReadGraph(nodeId) {
  const outId = nodeGraphAdditiveWaveformDownstreamOutId(nodeId) || String(nodeId || "");
  if (typeof nodeGraphDataBus !== "undefined") {
    const pub = nodeGraphDataBus.get?.(`${outId}.Graph`);
    if (pub?.ratio) return pub;
  }
  if (outId === String(nodeId || "") && typeof readNodeGraphDataInput === "function") {
    const g = readNodeGraphDataInput(nodeId, "Graph");
    if (g?.ratio) return g;
  }
  return null;
}

function nodeGraphAdditiveWaveformFingerprint(graph) {
  if (!graph || !graph.ratio) return "";
  const H = Math.min(graph.ratio.length | 0, 64);
  let h = `${H}|`;
  // Sparse sample of ratio/amp/phase — enough to detect waveform changes.
  const step = Math.max(1, (H / 8) | 0);
  for (let i = 0; i < H; i += step) {
    h += `${(nodeGraphFiniteNumber(graph.ratio[i])).toFixed(4)},`;
    h += `${(nodeGraphFiniteNumber(graph.amplitude?.[i])).toFixed(3)},`;
    h += `${(nodeGraphFiniteNumber(graph.phase?.[i])).toFixed(3)};`;
  }
  return h;
}

function drawNodeGraphAdditiveWaveformDisplay(section) {
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
  const graph = nodeGraphAdditiveWaveformReadGraph(nodeId);
  if (!graph || !graph.ratio || !graph.ratio.length) {
    nodeGraphGlLinesText(batch, "—", w * 0.5, h * 0.5, { px: 11, weight: 400, family: "ui-monospace, monospace", rgba: [0.4, 0.4, 0.4, 1] });
    nodeGraphGlLinesEnd(batch);
    section._forceDraw = false;
    return;
  }

  const N = Math.max(64, Math.min(256, Math.round(w)));
  const key = `${N}|${nodeGraphAdditiveWaveformFingerprint(graph)}`;
  if (!section._wave || section._wave.length !== N || section._bakeKey !== key) {
    if (!section._wave || section._wave.length !== N) {
      section._wave = new Float32Array(N);
    }
    if (typeof additiveGraphBakeWaveform === "function") {
      const hCap = Math.min(256, Math.max(8, graph.ratio.length | 0));
      additiveGraphBakeWaveform(graph, section._wave, hCap);
    }
    section._bakeKey = key;
  }

  const wave = section._wave;
  const midY = h * 0.5;
  const ampY = h * 0.42;
  const pad = Math.max(2, w * 0.03);
  const span = Math.max(1, w - pad * 2);

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
  nodeGraphModuleScopeCustomRenderers.additiveWaveform = () => {};
}
