// Clock face: one full clock cycle as a pulse shape (high for Pulse Width,
// then low). A playhead sweeps at Rate with the cycle phase; the region behind
// it fills; a tick at the rising edge flashes when the clock fires.
// GPU only, drawn with the shared antialiased line drawer (gl-line-renderer).

const NODE_GRAPH_CLOCK_FACE_INK = Object.freeze({
  background: [2 / 255, 6 / 255, 9 / 255, 1],
  pulse: [61 / 255, 224 / 255, 1, 0.95],
  fill: [61 / 255, 224 / 255, 1, 0.22],
  playhead: [1, 1, 1, 0.9],
  tick: [1, 214 / 255, 102 / 255, 0.45],
  flash: [1, 214 / 255, 102 / 255, 1],
});
const NODE_GRAPH_CLOCK_FACE_FLASH_S = 0.12;

function nodeGraphClockFaceParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/** Cycle phase 0..1: the engine's phase when published, else Rate integrated per frame while playing. */
function nodeGraphClockFacePhase(section, node, now) {
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Phase", Number.NaN))
    : Number.NaN;
  if (Number.isFinite(live)) return live - Math.floor(live);
  const playing = typeof nodeGraphRoundShapeLivePlaying === "function" ? nodeGraphRoundShapeLivePlaying() : false;
  const rate = Math.max(0, nodeGraphClockFaceParam(node, "rate", 2));
  const speed = Number(nodeGraphMvp?.live?.speedMultiplier);
  const dt = Number.isFinite(section._clockT) ? Math.max(0, Math.min(0.25, now - section._clockT)) : 0;
  section._clockT = now;
  let phase = Number.isFinite(section._clockPhase) ? section._clockPhase : 0;
  if (playing) phase += rate * dt * (Number.isFinite(speed) ? speed : 1);
  phase -= Math.floor(phase);
  section._clockPhase = phase;
  const offset = nodeGraphClockFaceParam(node, "phase", 0);
  const p = phase + offset;
  return p - Math.floor(p);
}

function drawNodeGraphClockFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  const phase = nodeGraphClockFacePhase(section, node, now);
  // Rising edge fired: the phase wrapped since the last frame.
  if (Number.isFinite(section._clockLast) && phase < section._clockLast - 0.5) section._clockFlash = now;
  section._clockLast = phase;
  const flashing = Number.isFinite(section._clockFlash) && now - section._clockFlash < NODE_GRAPH_CLOCK_FACE_FLASH_S;
  const ink = NODE_GRAPH_CLOCK_FACE_INK;
  const batch = nodeGraphGlLinesBegin(canvas, ink.background, { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "clock face: no shared GL device");
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const duty = Math.max(0, Math.min(1, nodeGraphClockFaceParam(node, "duty", 0.5)));
  const amp = Math.max(0, Math.min(1, nodeGraphClockFaceParam(node, "amplitude", 1)));
  const padX = Math.max(6, w * 0.06);
  const padY = Math.max(6, h * 0.16);
  const x0 = padX;
  const x1 = w - padX;
  const low = h - padY;
  const high = low - (h - padY * 2) * amp;
  const xd = x0 + (x1 - x0) * duty;
  const xp = x0 + (x1 - x0) * phase;
  // Filled region behind the playhead, under the pulse shape.
  const hiEnd = Math.min(xp, xd);
  if (hiEnd > x0) nodeGraphGlLinesRect(batch, x0, high, hiEnd - x0, low - high, ink.fill);
  // Pulse: rising edge, high for Pulse Width, falling edge, low to the cycle end.
  nodeGraphGlLinesPolyline(batch, [x0, low, x0, high, xd, high, xd, low, x1, low], 1, fine, ink.pulse);
  // Rising-edge tick, flashes when the clock fires.
  nodeGraphGlLinesSegment(batch, x0, padY * 0.35, x0, h - padY * 0.35, flashing ? 1.5 : 0.75, fine, flashing ? ink.flash : ink.tick);
  // Playhead.
  nodeGraphGlLinesSegment(batch, xp, padY * 0.5, xp, h - padY * 0.5, 0.75, fine, ink.playhead);
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
