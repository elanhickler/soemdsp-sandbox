// Clock face: one clock cycle. The gate is a closed rectangle (Pulse Start to
// Pulse End), centered vertically. While the playhead is inside the gate the
// gate fills from Pulse Start up to the playhead. A dim marker sits at the
// phase the clock starts from (Phase). The playhead follows the engine's own
// phase (__Phase), shifted to the time the speakers play it, and flashes when
// T fires. Display Settings `clockFace`: Background, Pulse (line), Playhead
// (dot), Fill HBS, and one line thickness for the gate and the playhead.
// GPU only, drawn with the shared antialiased line drawer (gl-line-renderer).

const nodeGraphClockFaceDisplaySettingsDefaults = Object.freeze({
  backgroundHue: 205.714,
  backgroundBrightness: 0.009,
  backgroundSaturation: 0.59,
  lineHue: 187.5,
  lineBrightness: 0.56,
  lineSaturation: 0.99,
  lineThickness: 2,
  dotHue: 0,
  dotBrightness: 1,
  dotSaturation: 0,
  fillHue: 191.5,
  fillBrightness: 0.075,
  fillSaturation: 0.67,
});
const NODE_GRAPH_CLOCK_FACE_START = [1, 214 / 255, 102 / 255, 0.45];
const NODE_GRAPH_CLOCK_FACE_FLASH = [1, 214 / 255, 102 / 255, 1];
const NODE_GRAPH_CLOCK_FACE_FLASH_S = 0.12;

function normalizeNodeGraphClockFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphClockFaceDisplaySettingsDefaults;
  const merged = { ...d, ...source };
  const look = normalizeNodeGraphRoundShapeFaceSettings(merged);
  const unit = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  const hue = Number(merged.fillHue);
  const fillHue = Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : d.fillHue;
  const fillBrightness = unit(merged.fillBrightness, d.fillBrightness);
  const fillSaturation = unit(merged.fillSaturation, d.fillSaturation);
  return {
    ...look,
    fillHue,
    fillBrightness,
    fillSaturation,
    fillPaint: nodeGraphHueBrightnessCss(fillHue, fillBrightness, 1, fillSaturation),
  };
}

function nodeGraphClockFaceSettingsForNode(node) {
  return normalizeNodeGraphClockFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphClockDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-clock-face[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._clockForceDraw = true;
  drawNodeGraphClockFace(el);
}

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

/**
 * Gate geometry in face px: x0..x1 the cycle, xs/xe the gate ends, high/low
 * the gate top and bottom with equal margins above and below.
 */
function nodeGraphClockFaceGeometry(w, h, pulseStart, pulseEnd, amp, stroke) {
  const padX = Math.max(6, w * 0.06) + stroke * 0.5;
  const padY = Math.max(6, h * 0.16) + stroke * 0.5;
  const x0 = padX;
  const x1 = w - padX;
  const half = Math.max(0, h * 0.5 - padY) * amp;
  const at = (v) => x0 + (x1 - x0) * v;
  return { x0, x1, xs: at(pulseStart), xe: at(pulseEnd), high: h * 0.5 - half, low: h * 0.5 + half, at };
}

/** Fill spans [x, x] from Pulse Start up to the playhead, only while the playhead is in the gate. */
function nodeGraphClockFaceFillSpans(g, pulseStart, pulseEnd, phase) {
  const xp = g.at(phase);
  if (pulseEnd >= pulseStart) return phase >= pulseStart && phase < pulseEnd ? [[g.xs, xp]] : [];
  if (phase >= pulseStart) return [[g.xs, xp]];
  if (phase < pulseEnd) return [[g.xs, g.x1], [g.x0, xp]];
  return [];
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
  const look = nodeGraphClockFaceSettingsForNode(node);
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "clock face: no shared GL device");
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const pulseStart = clamp01(nodeGraphClockFaceParam(node, "pulseStart", 0));
  const pulseEnd = clamp01(nodeGraphClockFaceParam(node, "pulseEnd", 0.5));
  const amp = clamp01(nodeGraphClockFaceParam(node, "amplitude", 1));
  const stroke = look.lineThickness;
  const halfPx = stroke * 0.5;
  const g = nodeGraphClockFaceGeometry(w, h, pulseStart, pulseEnd, amp, stroke);
  const { x0, x1, xs, xe, high, low } = g;
  const fill = rgba(look.fillPaint);
  for (const [a, b] of nodeGraphClockFaceFillSpans(g, pulseStart, pulseEnd, phase)) {
    if (b > a) nodeGraphGlLinesRect(batch, a, high, b - a, low - high, fill);
  }
  // Gate: a closed rectangle. End before Start wraps it across the cycle edge.
  const pulse = rgba(look.strokePaint);
  if (pulseEnd >= pulseStart) {
    const mid = (xs + xe) * 0.5;
    nodeGraphGlLinesPolyline(batch, [mid, low, xs, low, xs, high, xe, high, xe, low, mid, low], halfPx, fine, pulse);
  } else {
    nodeGraphGlLinesPolyline(batch, [x1, low, xs, low, xs, high, x1, high], halfPx, fine, pulse);
    nodeGraphGlLinesPolyline(batch, [x0, high, xe, high, xe, low, x0, low], halfPx, fine, pulse);
  }
  // Phase start marker: where the clock starts (Phase).
  const xm = g.at(startPhase);
  nodeGraphGlLinesSegment(batch, xm, high, xm, low, 0.75, fine, NODE_GRAPH_CLOCK_FACE_START);
  // Playhead: the gate's height and stroke; flashes when the clock fires.
  const xp = g.at(phase);
  nodeGraphGlLinesSegment(batch, xp, high, xp, low, halfPx, fine, flashing ? NODE_GRAPH_CLOCK_FACE_FLASH : rgba(look.dotPaint));
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
