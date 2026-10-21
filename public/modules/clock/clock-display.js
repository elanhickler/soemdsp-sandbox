// Clock face: one clock cycle. The gate shows its left edge, top shelf and
// right edge (Pulse Start to Pulse End). A dim marker sits at the phase the
// clock starts from (Phase). The playhead follows the engine's own phase
// (__Phase), shifted to the time the speakers play it, and flashes when T fires.
// GPU only, drawn with the shared antialiased line drawer (gl-line-renderer).

const NODE_GRAPH_CLOCK_FACE_INK = Object.freeze({
  background: [2 / 255, 6 / 255, 9 / 255, 1],
  pulse: [61 / 255, 224 / 255, 1, 0.95],
  playhead: [1, 1, 1, 0.9],
  start: [1, 214 / 255, 102 / 255, 0.45],
  flash: [1, 214 / 255, 102 / 255, 1],
});
const NODE_GRAPH_CLOCK_FACE_FLASH_S = 0.12;

function nodeGraphClockFaceParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Heard phase 0..1, or NaN when the engine is not publishing. Each new engine
 * value is anchored at the context time it arrived; the phase is then advanced
 * at Rate to the context time now coming out of the speakers
 * (getOutputTimestamp), which also takes the output latency off.
 */
function nodeGraphClockFacePhase(section, node) {
  const ctx = nodeGraphMvp?.live?.context;
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Phase", Number.NaN))
    : Number.NaN;
  if (!ctx || ctx.state !== "running" || !Number.isFinite(live)) return Number.NaN;
  if (live !== section._clockAnchorValue) {
    section._clockAnchorValue = live;
    section._clockAnchorTime = ctx.currentTime;
  }
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  const rate = Math.max(0, nodeGraphClockFaceParam(node, "rate", 2));
  const p = live + rate * (heard - section._clockAnchorTime);
  return p - Math.floor(p);
}

function drawNodeGraphClockFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const now = performance.now() / 1000;
  const offset = nodeGraphClockFaceParam(node, "phase", 0);
  const startPhase = offset - Math.floor(offset);
  const heard = nodeGraphClockFacePhase(section, node);
  const phase = Number.isFinite(heard) ? heard : startPhase;
  // Wrapped since the last frame: the clock fired (T).
  if (Number.isFinite(heard) && Number.isFinite(section._clockLast) && heard < section._clockLast - 0.5) section._clockFlash = now;
  section._clockLast = heard;
  const flashing = Number.isFinite(section._clockFlash) && now - section._clockFlash < NODE_GRAPH_CLOCK_FACE_FLASH_S;
  const ink = NODE_GRAPH_CLOCK_FACE_INK;
  const batch = nodeGraphGlLinesBegin(canvas, ink.background, { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "clock face: no shared GL device");
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const pulseStart = clamp01(nodeGraphClockFaceParam(node, "pulseStart", 0));
  const pulseEnd = clamp01(nodeGraphClockFaceParam(node, "pulseEnd", 0.5));
  const amp = clamp01(nodeGraphClockFaceParam(node, "amplitude", 1));
  const padX = Math.max(6, w * 0.06);
  const padY = Math.max(6, h * 0.16);
  const x0 = padX;
  const x1 = w - padX;
  const low = h - padY;
  const high = low - (h - padY * 2) * amp;
  const at = (v) => x0 + (x1 - x0) * v;
  const xs = at(pulseStart);
  const xe = at(pulseEnd);
  // Gate: left edge, top shelf, right edge. End before Start wraps the shelf.
  if (pulseEnd >= pulseStart) {
    nodeGraphGlLinesPolyline(batch, [xs, low, xs, high, xe, high, xe, low], 1, fine, ink.pulse);
  } else {
    nodeGraphGlLinesPolyline(batch, [xs, low, xs, high, x1, high], 1, fine, ink.pulse);
    nodeGraphGlLinesPolyline(batch, [x0, high, xe, high, xe, low], 1, fine, ink.pulse);
  }
  // Phase start marker: where the clock starts (Phase).
  const xm = at(startPhase);
  nodeGraphGlLinesSegment(batch, xm, high, xm, low, 0.75, fine, ink.start);
  // Playhead, the same height as the gate; flashes when the clock fires.
  const xp = at(phase);
  nodeGraphGlLinesSegment(batch, xp, high, xp, low, flashing ? 1.5 : 0.75, fine, flashing ? ink.flash : ink.playhead);
  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "clock face: GL present failed");
}

function createNodeGraphClockFace(nodeId, type = "clock") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-clock-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "clock");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-clock-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `clock:${el.dataset?.node || ""}`,
    forceKey: "_clockForceDraw",
    rafKey: "_clockRaf",
    paint: drawNodeGraphClockFace,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphClockFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.clockFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("clockFace", createNodeGraphClockFace);
}
