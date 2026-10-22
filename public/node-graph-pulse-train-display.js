// Pulse Train face: where the pulses land, adapted from the Pulse Explosion
// face (node-graph-pulse-explosion-display.js) without sharing its state.
// One stem per pulse at its time after the trigger, height = amplitude, dot
// on top, time axis 0 .. Time (Loop: the whole cycle; the playhead wraps). The schedule comes from the engine
// (soemdsp_pulse_train_preview in pulse_train.wasm), so it is exactly what a
// trigger with velocity 1 plays. Playhead: __Elapsed (seconds since trigger,
// -1 idle) shifted to the heard time; fired pulses light up.
// Display Settings: the pulseExplosionFace schema (Background, Line, Dot,
// Playhead, Lit, Line thickness, Dot size). GPU only (gl-line-renderer);
// canvas size comes from the tile.

const nodeGraphPulseTrainPreviewWasm = { promise: null, exports: null, failed: false };

function nodeGraphPulseTrainPreviewLoad() {
  if (nodeGraphPulseTrainPreviewWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphPulseTrainPreviewWasm.promise;
  }
  nodeGraphPulseTrainPreviewWasm.promise = fetch("/native_modules/pulse_train/pulse_train.wasm?v=pulse-train-loop-2")
    .then((response) => {
      if (!response.ok) throw new Error(`pulse_train wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((result) => {
      nodeGraphPulseTrainPreviewWasm.exports = result.instance.exports;
      document.querySelectorAll?.(".node-pulse-train-display").forEach((el) => {
        el._pulseTrainForceDraw = true;
        drawNodeGraphPulseTrainDisplay(el);
      });
    })
    .catch(() => {
      nodeGraphPulseTrainPreviewWasm.failed = true;
    });
  return nodeGraphPulseTrainPreviewWasm.promise;
}

function nodeGraphPulseTrainFaceParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/** { times, amps, end, peak } from the engine preview, or null until pulse_train.wasm is ready. */
function nodeGraphPulseTrainSchedule(section, node) {
  const wasm = nodeGraphPulseTrainPreviewWasm.exports;
  if (!wasm?.soemdsp_pulse_train_preview) {
    nodeGraphPulseTrainPreviewLoad();
    return null;
  }
  const p = (key, fallback) => nodeGraphPulseTrainFaceParam(node, key, fallback);
  // ƒ wired (Time row owned by the jack): the engine's effective Time (__End = 1/ƒ).
  let endTime = p("endTime", 3);
  const owned = section.closest?.(".node, article")?.querySelector?.('.node-parameter-row.f-jack-owns-frequency[data-param="endTime"]');
  if (owned && typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    const live = Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__End", Number.NaN));
    if (Number.isFinite(live) && live > 0) endTime = live;
  }
  const args = [
    Math.round(p("count", 12)), endTime, p("curve", 3),
    p("ampStart", 1), p("ampEnd", 0.2), p("ampCurve", 0), p("amplitude", 1),
    Math.round(p("mode", 0)),
  ];
  const key = args.join(",");
  if (section._pulseTrainKey === key && section._pulseTrainSchedule) return section._pulseTrainSchedule;
  const count = wasm.soemdsp_pulse_train_preview(...args);
  const times = new Float64Array(count);
  const amps = new Float64Array(count);
  let peak = 0;
  for (let i = 0; i < count; i += 1) {
    times[i] = wasm.soemdsp_pulse_train_preview_time(i);
    amps[i] = wasm.soemdsp_pulse_train_preview_amplitude(i);
    peak = Math.max(peak, Math.abs(amps[i]));
  }
  // Axis: 0 .. Time (One shot: the last pulse; Loop: the whole cycle, last pulse before it).
  const loop = args[7] > 0.5;
  const end = loop ? Math.max(0.001, Number(endTime) || 0) : (count ? Math.max(0.001, times[count - 1]) : 0.001);
  section._pulseTrainKey = key;
  section._pulseTrainSchedule = { times, amps, end, peak, loop };
  return section._pulseTrainSchedule;
}

/** Heard seconds since the last trigger, or NaN when no train is playing. */
function nodeGraphPulseTrainHeardElapsed(section, end) {
  const ctx = nodeGraphMvp?.live?.context;
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Elapsed", Number.NaN))
    : Number.NaN;
  if (!ctx || ctx.state !== "running") {
    section._pulseTrainAnchorTime = Number.NaN;
    return Number.NaN;
  }
  if (Number.isFinite(live) && live >= 0 && live !== section._pulseTrainAnchorValue) {
    section._pulseTrainAnchorValue = live;
    section._pulseTrainAnchorTime = ctx.currentTime;
  }
  if (!Number.isFinite(section._pulseTrainAnchorTime)) return Number.NaN;
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  const e = section._pulseTrainAnchorValue + (heard - section._pulseTrainAnchorTime);
  if (e > end + 0.15) {
    if (!(live >= 0)) section._pulseTrainAnchorTime = Number.NaN;
    return Number.NaN;
  }
  return Math.max(0, e);
}

function drawNodeGraphPulseTrainDisplay(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const look = typeof nodeGraphPulseExplosionFaceSettingsForNode === "function"
    ? nodeGraphPulseExplosionFaceSettingsForNode(node)
    : null;
  if (!look) return;
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "pulse train face: no shared GL device");
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const halfPx = look.lineThickness * 0.5;
  const dotR = look.dotThickness * 0.5;
  const schedule = nodeGraphPulseTrainSchedule(section, node);
  const end = schedule ? schedule.end : Math.max(0.001, nodeGraphPulseTrainFaceParam(node, "endTime", 3));
  const padX = Math.max(6, w * 0.04) + dotR;
  const padTop = Math.max(5, h * 0.08) + dotR;
  const base = h - Math.max(5, h * 0.08);
  const top = Math.min(base - 1, padTop);
  const x0 = padX;
  const x1 = Math.max(x0 + 1, w - padX);
  const at = (t) => x0 + (x1 - x0) * Math.max(0, Math.min(1, t / end));
  const line = rgba(look.strokePaint);
  const dot = rgba(look.dotPaint);
  const lit = rgba(look.litPaint);
  const dim = (c, a) => [c[0], c[1], c[2], c[3] * a];
  nodeGraphGlLinesSegment(batch, x0, base, x1, base, Math.max(0.5, halfPx * 0.5), fine, dim(line, 0.6));
  for (const x of [x0, x1]) nodeGraphGlLinesSegment(batch, x, base - 3, x, base + 3, 0.5, fine, dim(line, 0.6));
  let elapsed = schedule ? nodeGraphPulseTrainHeardElapsed(section, schedule.loop ? Infinity : end) : Number.NaN;
  // Loop: the heard playhead wraps every cycle (the engine restarts __Elapsed at 0).
  if (schedule?.loop && Number.isFinite(elapsed)) elapsed %= end;
  const playing = Number.isFinite(elapsed);
  if (schedule) {
    const { times, amps } = schedule;
    // Height = amplitude; the plot top is 1, or the loudest pulse when Amplitude goes past 1 (no clamp).
    const scale = Math.max(1, schedule.peak);
    const height = base - top;
    for (let i = 0; i < times.length; i += 1) {
      const x = at(times[i]);
      const y = base - (Math.abs(amps[i]) / scale) * height;
      const fired = playing && times[i] <= elapsed;
      if (base - y > 0.5) nodeGraphGlLinesSegment(batch, x, base, x, y, halfPx, fine, fired ? lit : line);
      if (dotR > 0) {
        const age = fired ? elapsed - times[i] : Infinity;
        if (age < 0.12) nodeGraphGlLinesDot(batch, x, y, dotR * 2.2, fine, dim(lit, 0.35 * (1 - age / 0.12)));
        nodeGraphGlLinesDot(batch, x, y, dotR, fine, fired ? lit : dot);
      }
    }
  }
  if (playing) {
    const x = at(elapsed);
    nodeGraphGlLinesSegment(batch, x, top - dotR, x, base, Math.max(0.5, halfPx), fine, rgba(look.playheadPaint));
  }
  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "pulse train face: GL present failed");
}

function applyNodeGraphPulseTrainDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-pulse-train-display[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._pulseTrainForceDraw = true;
  drawNodeGraphPulseTrainDisplay(el);
}

function createNodeGraphPulseTrainDisplay(nodeId, type = "pulseTrain") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-pulse-train-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "pulseTrain");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-pulse-train-canvas"));
  nodeGraphPulseTrainPreviewLoad();
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `pulseTrain:${el.dataset?.node || ""}`,
    forceKey: "_pulseTrainForceDraw",
    rafKey: "_pulseTrainRaf",
    paint: drawNodeGraphPulseTrainDisplay,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphPulseTrainDisplay(section);
    section._startFaceLoop?.();
  }));
  return section;
}
