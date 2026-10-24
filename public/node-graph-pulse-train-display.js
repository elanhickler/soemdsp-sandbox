// Pulse Train face: where the pulses land, adapted from the Pulse Explosion
// face (node-graph-pulse-explosion-display.js) without sharing its state.
// One stem per pulse at its time after the trigger, height = amplitude, dot
// on top, time axis 0 .. Time (Loop: the whole cycle; the playhead wraps).
// The schedule is the same E_k closed form as pulse_train.cpp
// (t_i = End * E_curve(u_i)); Count goes to 16384 for acoustic-dispersion
// tap trains. Stems/dots are an instanced GL pass (nodeGraphGlLinesPulseTrain)
// so the vertex shader evaluates the formula from gl_InstanceID. With audio
// running it uses the engine's params in effect (__Count .. __Amp). Playhead:
// __Elapsed (seconds since trigger, -1 idle) shifted to the heard time; fired
// pulses light up.
// Recalculate On: the plate is the in-effect (latched) cycle — Time, Duty,
// Frequency, Pulse Mode, Count. Live knobs that have not latched yet do not
// redraw or retime the playhead. Recalculate Off: the plate follows the knobs.
// Display Settings `pulseTrainFace`: Background, Line, Dot, Playhead, Lit;
// Line thickness, Dot size, Fade time (s). Fade 0 holds the lit dots until
// retrigger; >0 is PhosphorResidual.energyAfterSeconds.
// GPU only
// (gl-line-renderer); canvas size comes from the tile.

const nodeGraphPulseTrainFaceDisplaySettingsDefaults = Object.freeze({
  ...nodeGraphPulseExplosionFaceDisplaySettingsDefaults,
  fadeTime: 0,
});
const NODE_GRAPH_PULSE_TRAIN_FACE_EXTRA_LAMPS = NODE_GRAPH_PULSE_EXPLOSION_FACE_EXTRA_LAMPS;

function normalizeNodeGraphPulseTrainFaceSettings(settings = {}) {
  return nodeGraphPulseFaceNormalize(settings, nodeGraphPulseTrainFaceDisplaySettingsDefaults, NODE_GRAPH_PULSE_TRAIN_FACE_EXTRA_LAMPS);
}

function nodeGraphPulseTrainFaceSettingsForNode(node) {
  return normalizeNodeGraphPulseTrainFaceSettings(node?.traceDisplaySettings);
}

const nodeGraphPulseTrainPreviewWasm = { promise: null, exports: null, failed: false };

function nodeGraphPulseTrainPreviewLoad() {
  if (nodeGraphPulseTrainPreviewWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphPulseTrainPreviewWasm.promise;
  }
  nodeGraphPulseTrainPreviewWasm.promise = fetch("/native_modules/pulse_train/pulse_train.wasm?v=pulse-revfwd-1")
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

const NODE_GRAPH_PULSE_TRAIN_MAX = 16384;

function nodeGraphPulseTrainCurveShape(k, u) {
  if (!(Math.abs(k) > 1e-6)) return u;
  return (Math.exp(k * u) - 1) / (Math.exp(k) - 1);
}

function nodeGraphPulseTrainClampCount(count) {
  const n = Math.round(Number(count));
  if (!(n >= 1)) return 1;
  return n > NODE_GRAPH_PULSE_TRAIN_MAX ? NODE_GRAPH_PULSE_TRAIN_MAX : n;
}

/** { times, amps, end, peak } from the E_k formula (same as pulse_train.cpp). */
function nodeGraphPulseTrainSchedule(section, node) {
  nodeGraphPulseTrainPreviewLoad();
  const p = (key, fallback) => nodeGraphPulseTrainFaceParam(node, key, fallback);
  // Time is the E_k window. Wired ƒ scales the whole Count→End Delay cycle into 1/ƒ.
  // Frequency (or wired ƒ) + Duty -> Time / End Delay seconds, same as process_pulse_train.
  const fPeriod = nodeGraphPulseTrainFPeriod(node);
  const fKnob = p("frequency", 1);
  const periodS = Number.isFinite(fPeriod) && fPeriod > 0 ? fPeriod : (fKnob > 0 ? 1 / fKnob : 0);
  const duty = p("duty", 0.5);
  const pulseModeKnob = nodeGraphPulseTrainPulseMode(p("pulseMode", 0));
  let endTime = duty * periodS / ((pulseModeKnob === 1 || pulseModeKnob === 3) ? 2 : 1);
  const args = [
    nodeGraphPulseTrainClampCount(p("count", 12)), endTime, p("curve", 3),
    p("ampStart", 1), p("ampEnd", 0.2), p("ampCurve", 0), p("amplitude", 1),
    Math.round(p("mode", 1)), pulseModeKnob, (1 - duty) * periodS,
  ];
  // Audio running: draw the params the engine is playing with (latched at the
  // trigger / cycle start with Recalculate On, live with it Off; idle = what
  // the next trigger latches), so the face always matches what is heard.
  // Live Frequency / Duty knobs that have not latched must not retune the plate.
  // __Amp is Amplitude * trigger velocity.
  const ctx = nodeGraphMvp?.live?.context;
  if (ctx?.state === "running" && typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    const eng = ["__Count", "__End", "__Curve", "__AmpStart", "__AmpEnd", "__AmpCurve", "__Amp"]
      .map((name) => Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, name, Number.NaN)));
    if (Number.isFinite(eng[1])) {
      // __Count = count + Pulse Mode / 4 (both latched).
      if (Number.isFinite(eng[0])) {
        const countIn = Math.floor(eng[0] + 1e-9);
        args[0] = nodeGraphPulseTrainClampCount(countIn);
        args[8] = nodeGraphPulseTrainPulseMode(Math.round((eng[0] - countIn) * 4));
      }
      for (let i = 1; i < 7; i += 1) if (Number.isFinite(eng[i])) args[i] = eng[i];
      endTime = eng[1];
    }
    const delayLive = Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Delay", Number.NaN));
    if (Number.isFinite(delayLive)) args[9] = delayLive;
  }
  const key = args.join(",");
  if (section._pulseTrainKey === key && section._pulseTrainSchedule) return section._pulseTrainSchedule;
  const sched = nodeGraphPulseTrainPreviewJs(args, endTime);
  section._pulseTrainKey = key;
  section._pulseTrainSchedule = sched;
  return sched;
}

/** 1/ƒ seconds when the ƒ jack is wired and > 0, else NaN. */
function nodeGraphPulseTrainFPeriod(node) {
  const id = String(node?.id || "");
  if (!id || typeof nodeGraphModuleScopeConnectionsTo !== "function") return Number.NaN;
  const wire = nodeGraphModuleScopeConnectionsTo(id, "f")
    .find((c) => c?.sourceNode && c?.sourcePort);
  if (!wire) return Number.NaN;
  const hz = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(wire.sourceNode, wire.sourcePort, Number.NaN))
    : Number.NaN;
  if (!(hz > 0)) return Number.NaN;
  return 1 / hz;
}

function nodeGraphPulseTrainPulseMode(v) {
  const m = Math.round(Number(v) || 0);
  if (m < 0) return 0;
  if (m > 3) return 3;
  return m;
}

const nodeGraphPulseTrainIsDual = (m) => m === 1 || m === 3;

/** Schedule for args [count, time, curve, ampStart, ampEnd, ampCurve, amplitude, mode, pulseMode, endDelay]. */
function nodeGraphPulseTrainPreviewJs(args, endTime) {
  const pulseMode = nodeGraphPulseTrainPulseMode(args[8]);
  const nFwd = nodeGraphPulseTrainClampCount(args[0]);
  const loop = args[7] > 0.5;
  const fwdCap = nodeGraphPulseTrainIsDual(pulseMode) ? Math.min(nFwd, 8192) : nFwd;
  const count = !nodeGraphPulseTrainIsDual(pulseMode) || fwdCap <= 1 ? fwdCap : (loop ? 2 * fwdCap - 2 : 2 * fwdCap - 1);
  const duration = Number(endTime) > 0 ? Number(endTime) : 0;
  const delayRaw = Number(args[9]);
  const delay = Number.isFinite(delayRaw) ? delayRaw : 0;
  const curve = Number(args[2]) || 0;
  const ampStart = Number(args[3]) || 0;
  const ampEnd = Number(args[4]) || 0;
  const ampCurve = Number(args[5]) || 0;
  const amplitude = Number(args[6]) || 0;
  const times = new Float64Array(count);
  const amps = new Float64Array(count);
  let peak = 0;
  const wasm = nodeGraphPulseTrainPreviewWasm.exports;
  if (wasm?.soemdsp_pulse_train_preview && count <= 256) {
    const n = wasm.soemdsp_pulse_train_preview(...args);
    const used = Math.min(count, n);
    for (let i = 0; i < used; i += 1) {
      times[i] = wasm.soemdsp_pulse_train_preview_time(i);
      amps[i] = wasm.soemdsp_pulse_train_preview_amplitude(i);
      peak = Math.max(peak, Math.abs(amps[i]));
    }
  } else {
    // One forward-family pulse: Forward-Reverse index j (mode 1) or the other modes.
    const fwdT = (i) => {
      let t = !loop && i === fwdCap - 1 && fwdCap > 1 ? duration : duration * nodeGraphPulseTrainCurveShape(curve, loop ? i / fwdCap : (fwdCap > 1 ? i / (fwdCap - 1) : 0));
      if (!(t >= 0)) t = 0;
      if (t > duration) t = duration;
      return t;
    };
    const L = 2 * fwdCap - 2;
    for (let jj = 0; jj < count; jj += 1) {
      // Reverse-Forward: Forward-Reverse rotated half a trip (same as the DSP).
      let j = jj, wrapped = false;
      if (pulseMode === 3 && fwdCap > 1) {
        if (loop) { j = jj + fwdCap - 1; wrapped = j >= L; if (wrapped) j -= L; }
        else { wrapped = jj >= fwdCap; j = wrapped ? jj - fwdCap + 1 : jj + fwdCap - 1; }
      }
      const dual = nodeGraphPulseTrainIsDual(pulseMode);
      let i = j;
      if (dual) {
        if (j >= fwdCap) i = 2 * fwdCap - 2 - j;
      } else if (pulseMode === 2 && fwdCap > 1) {
        i = fwdCap - 1 - j;
      }
      const u = loop ? i / fwdCap : (fwdCap > 1 ? i / (fwdCap - 1) : 0);
      let t = !loop && i === fwdCap - 1 && fwdCap > 1 ? duration : duration * nodeGraphPulseTrainCurveShape(curve, u);
      if (!(t >= 0)) t = 0;
      if (t > duration) t = duration;
      if (dual && j >= fwdCap) t = 2 * duration - t;
      else if (pulseMode === 2 && fwdCap > 1) {
        if (loop) t = j === 0 ? 0 : duration - Math.min(duration, Math.max(0, duration * nodeGraphPulseTrainCurveShape(curve, (fwdCap - j) / fwdCap)));
        else t = duration - t;
      }
      if (pulseMode === 3 && fwdCap > 1) {
        t = t - fwdT(fwdCap - 1) + (wrapped ? 2 * duration : 0);
        if (!(t >= 0)) t = 0;
      }
      times[jj] = t;
      const a = (ampStart + (ampEnd - ampStart) * nodeGraphPulseTrainCurveShape(ampCurve, u)) * amplitude;
      amps[jj] = a;
      peak = Math.max(peak, Math.abs(a));
    }
  }
  const span = (nodeGraphPulseTrainIsDual(pulseMode) ? 2 : 1) * duration;
  const last = count ? times[count - 1] : 0;
  const cutoff = loop ? span + delay : last + delay;
  const end = Math.max(0.001, loop || delay !== 0 ? Math.max(0, cutoff) : last || 0.001);
  return {
    times, amps, end, duration, peak, loop, pulseMode, delay,
    count, nFwd: fwdCap, curve, ampStart, ampEnd, ampCurve, amplitude,
  };
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
  const look = nodeGraphPulseTrainFaceSettingsForNode(node);
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "pulse train face: no shared GL device");
    return;
  }
  const smoothing = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look.lineSmoothing) || 1);
  const halfPx = look.lineThickness * 0.5;
  const dotR = look.dotThickness * 0.5;
  const schedule = nodeGraphPulseTrainSchedule(section, node);
  const timeScale = 1; // Time + End Delay already span the 1/ƒ cycle
  const fKnobFace = nodeGraphPulseTrainFaceParam(node, "frequency", 1);
  const period = nodeGraphPulseTrainFPeriod(node);
  const end = schedule ? schedule.end
    : (Number.isFinite(period) && period > 0 ? period : Math.max(0.001, fKnobFace > 0 ? 1 / fKnobFace : 1));
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
  nodeGraphGlLinesSegment(batch, x0, base, x1, base, Math.max(0.5, halfPx * 0.5), smoothing, dim(line, 0.6));
  for (const x of [x0, x1]) nodeGraphGlLinesSegment(batch, x, base - 3, x, base + 3, 0.5, smoothing, dim(line, 0.6));
  let elapsed = schedule ? nodeGraphPulseTrainHeardElapsed(section, schedule.loop ? Infinity : end) : Number.NaN;
  // Loop: the heard playhead wraps every cycle (the engine restarts __Elapsed at 0).
  if (schedule?.loop && Number.isFinite(elapsed)) elapsed %= end;
  const playing = Number.isFinite(elapsed);
  if (schedule) {
    // Height = amplitude; the plot top is 1, or the loudest pulse when Amplitude goes past 1 (no clamp).
    const scale = Math.max(1, schedule.peak);
    const forest = (sched, lineC, dotC, litC, elapsedVal) => {
      if (typeof nodeGraphGlLinesPulseTrain !== "function") return false;
      nodeGraphGlLinesPulseTrain(batch, {
        count: sched.nFwd || sched.count,
        total: sched.count,
        pulseMode: sched.pulseMode,
        duration: sched.duration * timeScale,
        axisEnd: end,
        curve: sched.curve,
        ampStart: sched.ampStart,
        ampEnd: sched.ampEnd,
        ampCurve: sched.ampCurve,
        amplitude: sched.amplitude,
        loop: sched.loop,
        x0, x1, base, top,
        peak: scale,
        halfPx, feather: smoothing, dotR,
        elapsed: elapsedVal,
        fadeTau: Number(look.fadeTime) || 0,
        line: lineC, dot: dotC, lit: litC,
      });
      return true;
    };
    forest(schedule, line, dot, lit, playing ? elapsed : Number.NaN);
  }
  if (playing) {
    const x = at(elapsed);
    batch._over = true;
    nodeGraphGlLinesSegment(batch, x, top - dotR, x, base, Math.max(0.5, halfPx), smoothing, rgba(look.playheadPaint));
    batch._over = false;
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

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.pulseTrainFace = () => {};
}
