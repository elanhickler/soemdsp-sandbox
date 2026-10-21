// Pulse Explosion face: where the pulses land. One vertical stem per pulse at
// its time after the trigger, stem height = amplitude, a dot on top. The time
// axis runs from 0 to the end of the window (End Time). The schedule comes
// from the engine itself (soemdsp_pulse_explosion_preview in
// pulse_explosion.wasm), so the Random schedule for the node's Seed
// shows exactly what a trigger plays; there is no JS copy of the math.
// Playhead: the engine's seconds-since-trigger (__Elapsed, -1 idle), shifted to
// the time the speakers play it; stems light up as their pulse fires.
// Display Settings `pulseExplosionFace`: Background, Line (stems), Dot (tops),
// Playhead, Lit (fired pulses) HBS; Line thickness, Dot size.
// GPU only, drawn with the shared antialiased line drawer (gl-line-renderer).

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
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphPulseExplosionFaceDisplaySettingsDefaults;
  const merged = { ...d, ...source };
  const out = { ...normalizeNodeGraphRoundShapeFaceSettings(merged) };
  const unit = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  for (const id of NODE_GRAPH_PULSE_EXPLOSION_FACE_EXTRA_LAMPS) {
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
  nodeGraphPulseExplosionPreviewWasm.promise = fetch("/native_modules/pulse_explosion/pulse_explosion.wasm?v=pulse-random-1")
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
 * { times, amps, end } (seconds after trigger, sorted; end = window end), or
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
    Math.round(p("numberOfPulses", 20)), p("lowAmplitude", 0.3), p("highAmplitude", 1),
    p("seed", 0),
  ];
  const key = args.join(",");
  if (section._pulseScheduleKey === key && section._pulseSchedule) return section._pulseSchedule;
  const count = wasm.soemdsp_pulse_explosion_preview(...args);
  const times = new Float64Array(count);
  const amps = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    times[i] = wasm.soemdsp_pulse_explosion_preview_time(i);
    amps[i] = wasm.soemdsp_pulse_explosion_preview_amplitude(i);
  }
  // Window end as the engine sees it (End Time, at least just past Start).
  const start = Math.max(0, args[0]);
  let end = args[2] > start ? args[2] : start + 0.001;
  if (count) end = Math.max(end, times[count - 1]);
  section._pulseScheduleKey = key;
  section._pulseSchedule = { times, amps, end };
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

/** Plot geometry in face px: x0..x1 is 0..end seconds, base is amplitude 0, top is amplitude 1. */
function nodeGraphPulseExplosionFaceGeometry(w, h, end, dotR) {
  const padX = Math.max(6, w * 0.04) + dotR;
  const padTop = Math.max(5, h * 0.08) + dotR;
  const padBottom = Math.max(5, h * 0.08);
  const x0 = padX;
  const x1 = Math.max(x0 + 1, w - padX);
  const base = h - padBottom;
  const top = Math.min(base - 1, padTop);
  const safeEnd = end > 0 ? end : 1;
  return { x0, x1, base, top, at: (t) => x0 + (x1 - x0) * Math.max(0, Math.min(1, t / safeEnd)) };
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
  const fine = 1 / Math.max(1, pixelRatio);
  const halfPx = look.lineThickness * 0.5;
  const dotR = look.dotThickness * 0.5;
  const schedule = nodeGraphPulseExplosionSchedule(section, node);
  const end = schedule ? schedule.end : Math.max(0.001, nodeGraphPulseExplosionFaceParam(node, "endTime", 1));
  const g = nodeGraphPulseExplosionFaceGeometry(w, h, end, dotR);
  const line = rgba(look.strokePaint);
  const dot = rgba(look.dotPaint);
  const lit = rgba(look.litPaint);
  const dim = (c, a) => [c[0], c[1], c[2], c[3] * a];
  // Time axis: 0 .. window end, with a faint tick at 0 and at the end.
  nodeGraphGlLinesSegment(batch, g.x0, g.base, g.x1, g.base, Math.max(0.5, halfPx * 0.5), fine, dim(line, 0.6));
  for (const x of [g.x0, g.x1]) {
    nodeGraphGlLinesSegment(batch, x, g.base - 3, x, g.base + 3, 0.5, fine, dim(line, 0.6));
  }
  const elapsed = schedule ? nodeGraphPulseExplosionHeardElapsed(section, end) : Number.NaN;
  const playing = Number.isFinite(elapsed);
  if (schedule) {
    const { times, amps } = schedule;
    const height = g.base - g.top;
    for (let i = 0; i < times.length; i += 1) {
      const x = g.at(times[i]);
      const y = g.base - Math.max(0, Math.min(1, amps[i])) * height;
      const fired = playing && times[i] < elapsed;
      if (g.base - y > 0.5) nodeGraphGlLinesSegment(batch, x, g.base, x, y, halfPx, fine, fired ? lit : line);
      if (dotR > 0) {
        // A fresh hit glows for 120 ms around its dot.
        const age = fired ? elapsed - times[i] : Infinity;
        if (age < 0.12) nodeGraphGlLinesDot(batch, x, y, dotR * 2.2, fine, dim(lit, 0.35 * (1 - age / 0.12)));
        nodeGraphGlLinesDot(batch, x, y, dotR, fine, fired ? lit : dot);
      }
    }
  }
  if (playing) {
    const x = g.at(elapsed);
    nodeGraphGlLinesSegment(batch, x, g.top - dotR, x, g.base, Math.max(0.5, halfPx), fine, rgba(look.playheadPaint));
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
