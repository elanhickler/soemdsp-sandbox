// Clock Divider face: one dot per Clock edge in a division, wrapped into rows
// of at most 16. The engine's own count (__Count, edges since the last fire,
// from trigger_divider.cpp) lights the dots; the last dot is the fire step.
// The dot an incoming tick just lit flashes (Tick); when Out fires every dot
// and the Out bar flash (Fire). The Out bar under the dots fills while the
// output gate is high. Display Settings `clockDividerFace`: Background,
// Ring (line), Count (dot), Out (fill), Tick (start), Fire (blink) HBS;
// Line thickness (rings + bar), Line smoothing, Blink time (0 = off).
// GPU only, drawn with the shared antialiased line drawer (gl-line-renderer).

const nodeGraphClockDividerFaceDisplaySettingsDefaults = Object.freeze({
  backgroundHue: 205.714,
  backgroundBrightness: 0.009,
  backgroundSaturation: 0.59,
  lineHue: 187.5,
  lineBrightness: 0.3,
  lineSaturation: 0.8,
  lineThickness: 1.5,
  dotHue: 187.5,
  dotBrightness: 0.62,
  dotSaturation: 0.99,
  fillHue: 191.5,
  fillBrightness: 0.3,
  fillSaturation: 0.8,
  startHue: 0,
  startBrightness: 1,
  startSaturation: 0,
  blinkHue: 49,
  blinkBrightness: 0.61,
  blinkSaturation: 0.97,
  blinkTime: 0.12,
});
/** HBS lamps the RoundShape model does not carry (it owns background / line / dot). */
const NODE_GRAPH_CLOCK_DIVIDER_FACE_EXTRA_LAMPS = Object.freeze(["fill", "start", "blink"]);
const NODE_GRAPH_CLOCK_DIVIDER_FACE_MAX_COLS = 16;

function normalizeNodeGraphClockDividerFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphClockDividerFaceDisplaySettingsDefaults;
  const merged = { ...d, ...source };
  const out = { ...normalizeNodeGraphRoundShapeFaceSettings(merged) };
  const unit = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  for (const id of NODE_GRAPH_CLOCK_DIVIDER_FACE_EXTRA_LAMPS) {
    const raw = Number(merged[`${id}Hue`]);
    const hue = Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : d[`${id}Hue`];
    const bright = unit(merged[`${id}Brightness`], d[`${id}Brightness`]);
    const sat = unit(merged[`${id}Saturation`], d[`${id}Saturation`]);
    out[`${id}Hue`] = hue;
    out[`${id}Brightness`] = bright;
    out[`${id}Saturation`] = sat;
    out[`${id}Paint`] = nodeGraphHueBrightnessCss(hue, bright, 1, sat);
  }
  out.blinkTime = unit(merged.blinkTime, d.blinkTime);
  return out;
}

function nodeGraphClockDividerFaceSettingsForNode(node) {
  return normalizeNodeGraphClockDividerFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphClockDividerDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-clock-divider-face[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._clockDividerForceDraw = true;
  drawNodeGraphClockDividerFace(el);
}

/** Division as the engine rounds it (clamp_division_steps: 1..64). */
function nodeGraphClockDividerFaceDivision(node) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, "division", 2) : node?.params?.division;
  const n = Math.floor(Number(live) + 0.5);
  return Number.isFinite(n) ? Math.max(1, Math.min(64, n)) : 2;
}

/**
 * Engine state while playing: { count, out } from the published last samples,
 * or null when the engine is not running. count is wrapped into the division
 * the same way the next edge would wrap it.
 */
function nodeGraphClockDividerFaceEngineState(nodeId, division) {
  const ctx = nodeGraphMvp?.live?.context;
  if (!ctx || ctx.state !== "running" || typeof nodeGraphModuleScopeLatestOutputValue !== "function") return null;
  const count = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "__Count", Number.NaN));
  if (!Number.isFinite(count)) return null;
  const out = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "Out", 0));
  return { count: Math.max(0, Math.round(count)) % division, out: Number.isFinite(out) && out > 0 };
}

/** Dot grid in face px: centers for `division` dots, rows of <= 16, plus the Out bar. */
function nodeGraphClockDividerFaceGeometry(w, h, division, stroke) {
  const cols = Math.min(division, NODE_GRAPH_CLOCK_DIVIDER_FACE_MAX_COLS);
  const rows = Math.ceil(division / cols);
  const pad = Math.max(5, Math.min(w, h) * 0.06) + stroke * 0.5;
  const barH = Math.max(4, h * 0.14);
  const gap = Math.max(3, h * 0.06);
  const areaW = Math.max(1, w - pad * 2);
  const areaH = Math.max(1, h - pad * 2 - barH - gap);
  const cell = Math.min(areaW / cols, areaH / rows);
  const r = Math.max(1, cell * 0.36);
  const x0 = (w - cell * cols) * 0.5;
  const y0 = pad + (areaH - cell * rows) * 0.5;
  const dots = [];
  for (let i = 0; i < division; i += 1) {
    dots.push([x0 + cell * ((i % cols) + 0.5), y0 + cell * (Math.floor(i / cols) + 0.5)]);
  }
  return { dots, r, bar: { x: pad, y: h - pad - barH, w: w - pad * 2, h: barH } };
}

function drawNodeGraphClockDividerFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const now = performance.now() / 1000;
  const division = nodeGraphClockDividerFaceDivision(node);
  const state = nodeGraphClockDividerFaceEngineState(section.dataset.node, division);
  const count = state ? state.count : 0;
  const high = Boolean(state?.out);
  // Tick: the engine count moved. Fire: Out rose, or the count wrapped to 0
  // (a pulse shorter than one published frame still shows).
  if (state && Number.isFinite(section._clockDividerLastCount) && count !== section._clockDividerLastCount) {
    section._clockDividerTick = now;
    if (count === 0) section._clockDividerFire = now;
  }
  if (high && !section._clockDividerLastOut) section._clockDividerFire = now;
  section._clockDividerLastCount = state ? count : Number.NaN;
  section._clockDividerLastOut = high;
  const look = nodeGraphClockDividerFaceSettingsForNode(node);
  const recent = (t) => look.blinkTime > 0 && Number.isFinite(t) && now - t < look.blinkTime;
  const firing = state && recent(section._clockDividerFire);
  const ticking = state && recent(section._clockDividerTick);
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "clock divider face: no shared GL device");
    return;
  }
  const smoothing = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look.lineSmoothing) || 1);
  const stroke = look.lineThickness;
  const g = nodeGraphClockDividerFaceGeometry(w, h, division, stroke);
  const ring = rgba(look.strokePaint);
  const bg = rgba(look.backgroundPaint);
  const lit = rgba(look.dotPaint);
  const tick = rgba(look.startPaint);
  const fire = rgba(look.blinkPaint);
  // Dot i lights once i + 1 edges are counted; the last dot is the fire step
  // (the count is back at 0 then, so it lights only on Fire).
  g.dots.forEach(([x, y], i) => {
    const isLit = i < count;
    if (firing) {
      nodeGraphGlLinesDot(batch, x, y, g.r, smoothing, fire);
    } else if (isLit) {
      nodeGraphGlLinesDot(batch, x, y, g.r, smoothing, ticking && i === count - 1 ? tick : lit);
    } else {
      nodeGraphGlLinesDot(batch, x, y, g.r, smoothing, ring);
      const inner = g.r - Math.max(0.5, stroke);
      if (inner > 0.5) nodeGraphGlLinesDot(batch, x, y, inner, smoothing, bg);
    }
  });
  // Out bar: fills while the output gate is high.
  const { bar } = g;
  if (high) nodeGraphGlLinesRect(batch, bar.x, bar.y, bar.w, bar.h, rgba(firing ? look.blinkPaint : look.fillPaint));
  const xa = bar.x;
  const xb = bar.x + bar.w;
  const ya = bar.y;
  const yb = bar.y + bar.h;
  nodeGraphGlLinesPolyline(batch, [xa, ya, xb, ya, xb, yb, xa, yb, xa, ya], stroke * 0.5, smoothing, firing ? fire : ring);
  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "clock divider face: GL present failed");
}

function createNodeGraphClockDividerFace(nodeId, type = "clockDivider") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-clock-divider-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "clockDivider");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-clock-divider-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `clockDivider:${el.dataset?.node || ""}`,
    forceKey: "_clockDividerForceDraw",
    rafKey: "_clockDividerRaf",
    paint: drawNodeGraphClockDividerFace,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphClockDividerFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.clockDividerFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("clockDividerFace", createNodeGraphClockDividerFace);
}
