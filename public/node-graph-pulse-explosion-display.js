// Pulse Explosion face: XY sparks the engine will play. Dim dots at each
// scheduled (x, y); they light when __Elapsed passes their time. Pivot (X0,Y0)
// and the Spread disk are the Line/Playhead lamps. Schedule comes from
// soemdsp_pulse_explosion_preview (pulse_explosion.wasm) — same Seed as audio.
// Display Settings `pulseExplosionFace`: Background, Line (disk), Dot (unlit),
// Playhead (pivot), Lit (fired). nodeGraphPulseFaceNormalize is shared with
// the Pulse Train face. GPU only (gl-line-renderer).

const nodeGraphPulseExplosionFaceDisplaySettingsDefaults = Object.freeze({
  backgroundHue: 205.714,
  backgroundBrightness: 0.009,
  backgroundSaturation: 0.59,
  lineHue: 187.5,
  lineBrightness: 0.32,
  lineSaturation: 0.9,
  lineThickness: 1.5,
  dotHue: 187.5,
  dotBrightness: 0.72,
  dotSaturation: 0.95,
  dotThickness: 5,
  playheadHue: 0,
  playheadBrightness: 0.85,
  playheadSaturation: 0,
  litHue: 49,
  litBrightness: 0.61,
  litSaturation: 0.97,
});
/** HBS lamps the RoundShape model does not carry (it owns background / line / dot). */
const NODE_GRAPH_PULSE_EXPLOSION_FACE_EXTRA_LAMPS = Object.freeze(["playhead", "lit"]);

function normalizeNodeGraphPulseExplosionFaceSettings(settings = {}) {
  return nodeGraphPulseFaceNormalize(settings, nodeGraphPulseExplosionFaceDisplaySettingsDefaults, NODE_GRAPH_PULSE_EXPLOSION_FACE_EXTRA_LAMPS);
}

/**
 * Pulse face settings (Pulse Explosion, Pulse Train): RoundShape background /
 * line / dot, the extra HBS lamps, Line thickness, Dot size, and Fade time /
 * Ghost opacity when the defaults carry them.
 */
function nodeGraphPulseFaceNormalize(settings, d, lamps) {
  const source = settings && typeof settings === "object" ? settings : {};
  const merged = { ...d, ...source };
  const out = { ...normalizeNodeGraphRoundShapeFaceSettings(merged) };
  const unit = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  for (const id of lamps) {
    const raw = Number(merged[`${id}Hue`]);
    const hue = Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : d[`${id}Hue`];
    out[`${id}Hue`] = hue;
    out[`${id}Brightness`] = unit(merged[`${id}Brightness`], d[`${id}Brightness`]);
    out[`${id}Saturation`] = unit(merged[`${id}Saturation`], d[`${id}Saturation`]);
    out[`${id}Paint`] = nodeGraphHueBrightnessCss(hue, out[`${id}Brightness`], 1, out[`${id}Saturation`]);
  }
  const span = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  out.lineThickness = span(merged.lineThickness, 0.25, 16, d.lineThickness);
  out.dotThickness = span(merged.dotThickness, 0.25, 32, d.dotThickness);
  if ("ghostOpacity" in d) out.ghostOpacity = span(merged.ghostOpacity, 0, 1, d.ghostOpacity);
  if ("fadeTime" in d) out.fadeTime = span(merged.fadeTime, 0, 60, d.fadeTime);
  return out;
}

function nodeGraphPulseExplosionFaceSettingsForNode(node) {
  return normalizeNodeGraphPulseExplosionFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphPulseExplosionDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-pulse-curve-display[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._pulseForceDraw = true;
  if (typeof el.syncFromParameters === "function") el.syncFromParameters();
  else drawNodeGraphPulseCurveDisplay(el);
}

// Engine preview: pulse_explosion.wasm, loaded once on the main thread.
const nodeGraphPulseExplosionPreviewWasm = { promise: null, exports: null, failed: false };

function nodeGraphPulseExplosionPreviewLoad() {
  if (nodeGraphPulseExplosionPreviewWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphPulseExplosionPreviewWasm.promise;
  }
  nodeGraphPulseExplosionPreviewWasm.promise = fetch("/native_modules/pulse_explosion/pulse_explosion.wasm?v=pulse-xy-1")
    .then((response) => {
      if (!response.ok) throw new Error(`pulse_explosion wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((result) => {
      nodeGraphPulseExplosionPreviewWasm.exports = result.instance.exports;
      document.querySelectorAll?.(".node-pulse-curve-display").forEach((el) => {
        el._pulseForceDraw = true;
        drawNodeGraphPulseCurveDisplay(el);
      });
    })
    .catch(() => {
      nodeGraphPulseExplosionPreviewWasm.failed = true;
    });
  return nodeGraphPulseExplosionPreviewWasm.promise;
}

function nodeGraphPulseExplosionFaceParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The schedule a trigger with these params plays, from the engine:
 * { times, xs, ys, end, spread, x0, y0 } (seconds after trigger, sorted), or
 * null until pulse_explosion.wasm is ready. Cached per parameter set.
 */
function nodeGraphPulseExplosionSchedule(section, node) {
  const wasm = nodeGraphPulseExplosionPreviewWasm.exports;
  if (!wasm?.soemdsp_pulse_explosion_preview) {
    nodeGraphPulseExplosionPreviewLoad();
    return null;
  }
  const p = (key, fallback) => nodeGraphPulseExplosionFaceParam(node, key, fallback);
  const args = [
    p("startTime", 0), p("centerTime", 0.5), p("endTime", 1), p("timeSpread", 0.3),
    Math.round(p("numberOfPulses", 20)), p("spread", 0.5), p("x0", 0), p("y0", 0),
    p("seed", 0),
  ];
  const key = args.join(",");
  if (section._pulseScheduleKey === key && section._pulseSchedule) return section._pulseSchedule;
  if (typeof wasm.soemdsp_pulse_explosion_preview_x !== "function") return null;
  const count = wasm.soemdsp_pulse_explosion_preview(...args);
  const times = new Float64Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    times[i] = wasm.soemdsp_pulse_explosion_preview_time(i);
    xs[i] = wasm.soemdsp_pulse_explosion_preview_x(i);
    ys[i] = wasm.soemdsp_pulse_explosion_preview_y(i);
  }
  const start = Math.max(0, args[0]);
  let end = args[2] > start ? args[2] : start + 0.001;
  if (count) end = Math.max(end, times[count - 1]);
  section._pulseScheduleKey = key;
  section._pulseSchedule = { times, xs, ys, end, spread: args[5], x0: args[6], y0: args[7] };
  return section._pulseSchedule;
}

/**
 * Heard seconds since the last trigger, or NaN when no burst is playing.
 * Each new engine value is anchored at the context time it arrived and then
 * advanced in real time to the context time now coming out of the speakers
 * (getOutputTimestamp). After the engine goes idle the heard playhead keeps
 * running from the last anchor until it passes the window end.
 */
function nodeGraphPulseExplosionHeardElapsed(section, end) {
  const ctx = nodeGraphMvp?.live?.context;
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Elapsed", Number.NaN))
    : Number.NaN;
  if (!ctx || ctx.state !== "running") {
    section._pulseAnchorTime = Number.NaN;
    return Number.NaN;
  }
  if (Number.isFinite(live) && live >= 0 && live !== section._pulseAnchorValue) {
    section._pulseAnchorValue = live;
    section._pulseAnchorTime = ctx.currentTime;
  }
  if (!Number.isFinite(section._pulseAnchorTime)) return Number.NaN;
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  const e = section._pulseAnchorValue + (heard - section._pulseAnchorTime);
  if (e > end) {
    if (!(live >= 0)) section._pulseAnchorTime = Number.NaN;
    return Number.NaN;
  }
  return Math.max(0, e);
}

/** Plot geometry: bipolar XY (−1…1) in a square inset. y-up (scope). */
function nodeGraphPulseExplosionFaceGeometry(w, h, dotR) {
  const pad = Math.max(6, Math.min(w, h) * 0.06) + dotR;
  const side = Math.max(1, Math.min(w, h) - pad * 2);
  const ox = (w - side) * 0.5;
  const oy = (h - side) * 0.5;
  return {
    ox, oy, side,
    at: (x, y) => ({
      x: ox + (Math.max(-1.5, Math.min(1.5, x)) + 1) * 0.5 * side,
      y: oy + (1 - Math.max(-1.5, Math.min(1.5, y))) * 0.5 * side,
    }),
  };
}

function drawNodeGraphPulseCurveDisplay(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const look = nodeGraphPulseExplosionFaceSettingsForNode(node);
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "pulse explosion face: no shared GL device");
    return;
  }
  const smoothing = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look.lineSmoothing) || 1);
  const halfPx = look.lineThickness * 0.5;
  const dotR = look.dotThickness * 0.5;
  const schedule = nodeGraphPulseExplosionSchedule(section, node);
  const end = schedule ? schedule.end : Math.max(0.001, nodeGraphPulseExplosionFaceParam(node, "endTime", 1));
  const g = nodeGraphPulseExplosionFaceGeometry(w, h, dotR);
  const line = rgba(look.strokePaint);
  const dot = rgba(look.dotPaint);
  const lit = rgba(look.litPaint);
  const pivotPaint = rgba(look.playheadPaint);
  const dim = (c, a) => [c[0], c[1], c[2], (c[3] == null ? 1 : c[3]) * a];
  const x0 = schedule ? schedule.x0 : nodeGraphPulseExplosionFaceParam(node, "x0", 0);
  const y0 = schedule ? schedule.y0 : nodeGraphPulseExplosionFaceParam(node, "y0", 0);
  const spread = schedule ? schedule.spread : nodeGraphPulseExplosionFaceParam(node, "spread", 0.5);
  const origin = g.at(x0, y0);
  if (spread > 0.002) {
    const segs = 48;
    const ring = [];
    for (let i = 0; i <= segs; i += 1) {
      const a = (i / segs) * Math.PI * 2;
      const p = g.at(x0 + spread * Math.cos(a), y0 + spread * Math.sin(a));
      ring.push(p.x, p.y);
    }
    nodeGraphGlLinesPolyline(batch, ring, Math.max(0.4, halfPx * 0.55), smoothing, dim(line, 0.45));
  }
  const tick = Math.max(4, g.side * 0.03);
  nodeGraphGlLinesSegment(batch, origin.x - tick, origin.y, origin.x + tick, origin.y, halfPx, smoothing, pivotPaint);
  nodeGraphGlLinesSegment(batch, origin.x, origin.y - tick, origin.x, origin.y + tick, halfPx, smoothing, pivotPaint);
  const elapsed = schedule ? nodeGraphPulseExplosionHeardElapsed(section, end) : Number.NaN;
  const playing = Number.isFinite(elapsed);
  if (schedule) {
    const { times, xs, ys } = schedule;
    for (let i = 0; i < times.length; i += 1) {
      const p = g.at(xs[i], ys[i]);
      const fired = playing && times[i] <= elapsed;
      if (dotR > 0) {
        const age = fired ? elapsed - times[i] : Infinity;
        if (age < 0.12) nodeGraphGlLinesDot(batch, p.x, p.y, dotR * 2.2, smoothing, dim(lit, 0.35 * (1 - age / 0.12)));
        nodeGraphGlLinesDot(batch, p.x, p.y, dotR, smoothing, fired ? lit : dim(dot, 0.55));
      }
    }
  }
  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "pulse explosion face: GL present failed");
}

function createNodeGraphPulseCurveDisplay(nodeId, type = "pulseExplosion") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-pulse-curve-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "pulseExplosion");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-pulse-curve-canvas"));
  nodeGraphPulseExplosionPreviewLoad();
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `pulseExplosion:${el.dataset?.node || ""}`,
    forceKey: "_pulseForceDraw",
    rafKey: "_pulseRaf",
    paint: drawNodeGraphPulseCurveDisplay,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphPulseCurveDisplay(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.pulseExplosionFace = () => {};
}
