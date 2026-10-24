// Robin Sinepulse face: one designed hit (velocity 1), cropped to the kick
// body. Native soemdsp_robin_sinepulse_preview (standalone wasm) is the SSOT
// (same rsFreqSweeper / T60 voice as audio). X is not full Decay: window is
// min(sweep land at Low+50 Hz, env -24 dB), at least 3 body periods, +12%
// pad, 8 ms .. 2 s. Native preview_min / preview_max give, per pixel column,
// the range of every sample in that column's time slice (widened to the
// previous column's last sample so bands connect). JS fills min..max per
// column and strokes both edges at Line thickness, so the fast sweep start is
// a solid band and the slow tail a clean antialiased line. No point sampling,
// no aliasing. Playhead is __Elapsed. Display Settings `robinSinepulseFace`:
// Background, Line, Playhead (dot) HBS; Line thickness. GPU only.
const nodeGraphRobinSinepulseFaceDisplaySettingsDefaults = Object.freeze({
  backgroundHue: 205.714,
  backgroundBrightness: 0.009,
  backgroundSaturation: 0.59,
  lineHue: 187.5,
  lineBrightness: 0.56,
  lineSaturation: 0.99,
  lineThickness: 1.5,
  dotHue: 0,
  dotBrightness: 0.85,
  dotSaturation: 0,
  dotThickness: 5,
});

function normalizeNodeGraphRobinSinepulseFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphRobinSinepulseFaceDisplaySettingsDefaults;
  return normalizeNodeGraphRoundShapeFaceSettings({ ...d, ...source });
}

function nodeGraphRobinSinepulseFaceSettingsForNode(node) {
  return normalizeNodeGraphRobinSinepulseFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphRobinSinepulseDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-robin-sinepulse-face[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._sinepulseForceDraw = true;
  if (typeof el.syncFromParameters === "function") el.syncFromParameters();
  else drawNodeGraphRobinSinepulseFace(el);
}

const nodeGraphRobinSinepulsePreviewWasm = { promise: null, exports: null, failed: false };

function nodeGraphRobinSinepulsePreviewLoad() {
  if (nodeGraphRobinSinepulsePreviewWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphRobinSinepulsePreviewWasm.promise;
  }
  nodeGraphRobinSinepulsePreviewWasm.promise = fetch("/native_modules/robin_sinepulse/robin_sinepulse.wasm?v=kick-face-4")
    .then((response) => {
      if (!response.ok) throw new Error(`robin_sinepulse wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((result) => {
      nodeGraphRobinSinepulsePreviewWasm.exports = result.instance.exports;
      document.querySelectorAll?.(".node-robin-sinepulse-face").forEach((el) => {
        el._sinepulseForceDraw = true;
        drawNodeGraphRobinSinepulseFace(el);
      });
    })
    .catch(() => {
      nodeGraphRobinSinepulsePreviewWasm.failed = true;
    });
  return nodeGraphRobinSinepulsePreviewWasm.promise;
}

function nodeGraphRobinSinepulseFaceParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphRobinSinepulseWaveId(node) {
  const raw = typeof nodeGraphSinCosLiveParam === "function"
    ? nodeGraphSinCosLiveParam(node, "wave", 0)
    : node?.params?.wave;
  if (typeof nodeGraphChoiceIdForKey === "function") {
    const id = nodeGraphChoiceIdForKey("robinSinepulse", "wave", raw);
    if (Number.isFinite(Number(id))) return Number(id);
  }
  if (typeof raw === "string") {
    const k = raw.toLowerCase();
    if (k === "sinfatsaw") return 1;
    if (k === "trisaw") return 2;
    return 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(2, Math.round(n))) : 0;
}

/**
 * Designed-hit min/max bands from the engine: { mins, maxs, window, cols },
 * or null until robin_sinepulse.wasm is ready. Cached per parameter set +
 * column count.
 */
function nodeGraphRobinSinepulsePreview(section, node, columns) {
  const wasm = nodeGraphRobinSinepulsePreviewWasm.exports;
  if (!wasm?.soemdsp_robin_sinepulse_preview || !wasm.soemdsp_robin_sinepulse_preview_min) {
    nodeGraphRobinSinepulsePreviewLoad();
    return null;
  }
  const sr = Number(nodeGraphMvp?.live?.context?.sampleRate);
  const sampleRate = Number.isFinite(sr) && sr > 0 ? sr : 48000;
  const cols = Math.max(2, Math.min(512, columns | 0));
  const args = [
    nodeGraphRobinSinepulseFaceParam(node, "highFreq", 10000),
    nodeGraphRobinSinepulseFaceParam(node, "lowFreq", 0),
    nodeGraphRobinSinepulseFaceParam(node, "sweepTime", 0.2),
    nodeGraphRobinSinepulseFaceParam(node, "chirp", 0),
    nodeGraphRobinSinepulseFaceParam(node, "chirpShape", 0),
    nodeGraphRobinSinepulseWaveId(node),
    nodeGraphRobinSinepulseFaceParam(node, "waveShape", 0),
    nodeGraphRobinSinepulseFaceParam(node, "phase", 0),
    nodeGraphRobinSinepulseFaceParam(node, "decay", 0.5),
    nodeGraphRobinSinepulseFaceParam(node, "amplitude", 1),
    sampleRate,
    cols,
  ];
  const key = args.join(",");
  if (section._sinepulsePreviewKey === key && section._sinepulsePreview) return section._sinepulsePreview;
  const count = wasm.soemdsp_robin_sinepulse_preview(...args) | 0;
  const mins = new Float32Array(count);
  const maxs = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    mins[i] = wasm.soemdsp_robin_sinepulse_preview_min(i);
    maxs[i] = wasm.soemdsp_robin_sinepulse_preview_max(i);
  }
  const windowSec = wasm.soemdsp_robin_sinepulse_preview_window();
  section._sinepulsePreviewKey = key;
  section._sinepulsePreview = { mins, maxs, window: windowSec > 0 ? windowSec : 0.008, cols: count };
  return section._sinepulsePreview;
}
/**
 * Heard seconds since the last trigger, or NaN when no hit is in the window.
 * Each new engine value is anchored at the context time it arrived and then
 * advanced in real time to the speakers (getOutputTimestamp). After the engine
 * goes idle the heard playhead keeps running from the last anchor until it
 * passes the window end.
 */
function nodeGraphRobinSinepulseHeardElapsed(section, end) {
  const ctx = nodeGraphMvp?.live?.context;
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Elapsed", Number.NaN))
    : Number.NaN;
  if (!ctx || ctx.state !== "running") {
    section._sinepulseAnchorTime = Number.NaN;
    return Number.NaN;
  }
  if (Number.isFinite(live) && live >= 0 && live !== section._sinepulseAnchorValue) {
    section._sinepulseAnchorValue = live;
    section._sinepulseAnchorTime = ctx.currentTime;
  }
  if (!Number.isFinite(section._sinepulseAnchorTime)) return Number.NaN;
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  const e = section._sinepulseAnchorValue + (heard - section._sinepulseAnchorTime);
  if (e > end) {
    if (!(live >= 0)) section._sinepulseAnchorTime = Number.NaN;
    return Number.NaN;
  }
  return Math.max(0, e);
}

function drawNodeGraphRobinSinepulseFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const look = nodeGraphRobinSinepulseFaceSettingsForNode(node);
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "robin sinepulse face: no shared GL device");
    return;
  }
  const feather = 1;
  const halfPx = Math.max(0.5, look.lineThickness * 0.5);
  const pad = Math.max(4, halfPx + feather + 2);
  const x0 = pad;
  const x1 = Math.max(x0 + 1, w - pad);
  const y0 = pad;
  const y1 = Math.max(y0 + 1, h - pad);
  const midY = (y0 + y1) * 0.5;
  const amp = Math.max(1, (y1 - y0) * 0.5);
  const yAt = (v) => {
    const n = Number.isFinite(v) ? Math.max(-1.25, Math.min(1.25, v)) : 0;
    return midY - n * amp;
  };
  const cols = Math.max(2, Math.min(512, Math.round(x1 - x0)));
  const preview = nodeGraphRobinSinepulsePreview(section, node, cols);
  const line = rgba(look.strokePaint);
  const dim = (c, a) => [c[0], c[1], c[2], (c[3] == null ? 1 : c[3]) * a];
  nodeGraphGlLinesPolyline(batch, [x0, midY, x1, midY], Math.max(0.35, halfPx * 0.35), feather, dim(line, 0.22));
  if (preview && preview.cols >= 2) {
    // Column i covers [xl, xr]; band fills max..min (screen y top..bottom).
    // Top and bottom edges are stroked at Line thickness for AA and so a
    // flat stretch never gets thinner than the line.
    const { mins, maxs, cols: n } = preview;
    const colW = (x1 - x0) / n;
    const top = [];
    const bot = [];
    for (let i = 0; i < n; i += 1) {
      const xl = x0 + i * colW;
      const xr = xl + colW;
      const yt = yAt(maxs[i]);
      const yb = yAt(mins[i]);
      if (yb - yt > 0.5) nodeGraphGlLinesRect(batch, xl, yt, colW, yb - yt, line);
      top.push(xl, yt, xr, yt);
      bot.push(xl, yb, xr, yb);
    }
    nodeGraphGlLinesPolyline(batch, top, halfPx, feather, line);
    nodeGraphGlLinesPolyline(batch, bot, halfPx, feather, line);
  }
  const windowSec = preview ? preview.window : 0.2;
  const elapsed = nodeGraphRobinSinepulseHeardElapsed(section, windowSec);
  if (Number.isFinite(elapsed) && windowSec > 0) {
    const xp = x0 + (elapsed / windowSec) * (x1 - x0);
    nodeGraphGlLinesPolyline(batch, [xp, y0, xp, y1], halfPx, feather, rgba(look.dotPaint));
  }  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "robin sinepulse face: GL present failed");
}

function createNodeGraphRobinSinepulseFace(nodeId, type = "robinSinepulse") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-robin-sinepulse-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "robinSinepulse");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-robin-sinepulse-canvas"));
  nodeGraphRobinSinepulsePreviewLoad();
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `robinSinepulse:${el.dataset?.node || ""}`,
    forceKey: "_sinepulseForceDraw",
    rafKey: "_sinepulseRaf",
    paint: drawNodeGraphRobinSinepulseFace,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphRobinSinepulseFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.robinSinepulseFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("robinSinepulseFace", createNodeGraphRobinSinepulseFace);
}
