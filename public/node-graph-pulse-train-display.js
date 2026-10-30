// Pulse Train face: where the pulses land, adapted from the Pulse Explosion
// face (node-graph-pulse-explosion-display.js) without sharing its state.
// One stem per pulse at its time after the trigger, height = amplitude, dot
// on top, time axis 0 .. Time (Loop: the whole cycle; the playhead wraps).
// The schedule is the same E_k closed form as pulse_train.cpp
// (t_i = End * E_curve(u_i)); Count DSP goes to 16384. Slider domain is the Count param max.
// Count is continuous (pulse_train v37): positions use C, the last forward
// pulse plays at C - (ceil(C) - 1). Integer Count draws with the instanced GL
// forest; a fractional one draws its stems from the preview schedule.
// tap trains. Stems/dots are an instanced GL pass (nodeGraphGlLinesPulseTrain)
// so the vertex shader evaluates the formula from gl_InstanceID. With audio
// running it uses the engine's params in effect (__Count .. __Amp). Playhead:
// __Elapsed (seconds since trigger, -1 idle) shifted to the heard time; fired
// pulses light up.
// Latch: the plate is the in-effect (latched) cycle — Time, Stretch, Frequency,
// Pulse Mode, Count. Live knobs that have not latched yet do not redraw or
// retime the playhead. Free: the plate follows the knobs; Loop playhead is
// phase-locked so a Frequency sweep does not modulo-reset the stems.
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
  nodeGraphPulseTrainPreviewWasm.promise = fetch("/native_modules/pulse_train/pulse_train.wasm?v=pt-count-frac-1")
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

function nodeGraphPulseTrainTimeWarp(k, u, i, nFwd, loop, spacing) {
  const fam = Math.round(Number(spacing) || 0);
  if (!(u >= 0)) u = 0;
  if (u > 1) u = 1;
  if (fam === 1) {
    const n = nFwd;
    const h = loop
      ? (n > 0 ? (i * (i + 1)) / (n * (n + 1)) : 0)
      : (nFwd > 1 ? (i * (i + 1)) / ((n - 1) * n) : 0);
    const w = Math.min(1, Math.abs(k) * 0.1);
    if (!(k < 0)) return u + w * (h - u);
    const hr = loop
      ? (n > 0 ? (i * (2 * n - i + 1)) / (n * (n + 1)) : 0)
      : (nFwd > 1 ? (i * (2 * n - i - 1)) / ((n - 1) * n) : 0);
    return u + w * (hr - u);
  }
  if (fam === 2) {
    let s = k * 0.1;
    if (s > 0.99) s = 0.99;
    if (s < -0.99) s = -0.99;
    const den = 1 - s + 2 * s * u;
    if (!(Math.abs(den) > 1e-12)) return u;
    return ((1 + s) * u) / den;
  }
  return nodeGraphPulseTrainCurveShape(k, u);
}

// Continuous Count C, same domain as pulse_train.cpp countContOf: NaN reads
// as 1, <= 0 is 0 (one silent pulse), max 16384.
function nodeGraphPulseTrainClampCount(count) {
  const c = Number(count);
  if (!(c === c)) return 1;
  if (!(c > 0)) return 0;
  return c > NODE_GRAPH_PULSE_TRAIN_MAX ? NODE_GRAPH_PULSE_TRAIN_MAX : c;
}

// Stretch s -> span multiplier m: 0 at s <= -1, (1+s)^2 up to 0, Count^s above
// (Count < 1 counts as 1). NaN reads as 0 (m = 1). Mirrors graph_engine.
function nodeGraphPulseTrainStretchSpan(s, count) {
  const v = Number(s);
  if (v > 0) {
    const c = Number(count);
    return c > 1 ? c * Math.exp((v - 1) * Math.log(c)) : 1;
  }
  if (v <= 0) {
    const a = 1 + v;
    return a > 0 ? a * a : 0;
  }
  return 1;
}

/** { times, amps, end, peak } from the E_k formula (same as pulse_train.cpp). */
function nodeGraphPulseTrainSchedule(section, node) {
  nodeGraphPulseTrainPreviewLoad();
  const p = (key, fallback) => nodeGraphPulseTrainFaceParam(node, key, fallback);
  // Time is the E_k window. Wired ƒ scales the whole Count→End Delay cycle into 1/ƒ.
  // Frequency (or wired ƒ) + Stretch -> Time / End Delay seconds, same as process_pulse_train.
  const fPeriod = nodeGraphPulseTrainFPeriod(node);
  const fKnob = p("frequency", 1);
  const periodS = Number.isFinite(fPeriod) && fPeriod > 0 ? fPeriod : (Math.abs(fKnob) > 0 ? 1 / Math.abs(fKnob) : 0);
  // Stretch -1..+1 -> span m in cycles (same as graph_engine process_pulse_train).
  const span = nodeGraphPulseTrainStretchSpan(p("stretch", 0), p("count", 12));
  const pulseModeKnob = nodeGraphPulseTrainPulseMode(p("pulseMode", 0));
  const polarityKnob = nodeGraphPulseTrainPolarity(p("curvePolarity", 0));
  let endTime = span * periodS / nodeGraphPulseTrainSpanScale(pulseModeKnob);
  const args = [
    nodeGraphPulseTrainClampCount(p("count", 12)), endTime, p("curve", 3),
    p("ampStart", 1), p("ampEnd", 0.2), p("ampCurve", 0), p("amplitude", 1),
    Math.round(p("mode", 1)), pulseModeKnob, (1 - span) * periodS, polarityKnob,
    Math.round(p("spacing", 0)),
    // Edge Fade: stored 0 On / 1 Off (face stack order). JS preview only; the wasm preview ignores it.
    Math.round(p("edgeFade", 0)) === 0 ? 1 : 0,
    // Reverse (negative ƒ): the face draws the time-mirrored schedule the DSP plays (pulse_train v40).
    nodeGraphPulseTrainReversed(node, fKnob) ? 1 : 0,
  ];
  // Audio running: draw the params the engine is playing with (latched at the
  // trigger / cycle start with Latch, live with Free; idle = what
  // the next trigger latches), so the face always matches what is heard.
  // Live Frequency / Stretch knobs that have not latched (Latch mode) must not retune the plate.
  // __Amp is Amplitude * trigger velocity.
  const ctx = nodeGraphMvp?.live?.context;
  if (ctx?.state === "running" && typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    const eng = ["__Count", "__End", "__Curve", "__AmpStart", "__AmpEnd", "__AmpCurve", "__Amp"]
      .map((name) => Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, name, Number.NaN)));
    if (Number.isFinite(eng[1])) {
      // __Count = the continuous Count in effect (graph 298). Fwd-Rev comes from the knob.
      if (Number.isFinite(eng[0])) args[0] = nodeGraphPulseTrainClampCount(eng[0]);
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
/** Wired ƒ value (signed Hz), or NaN when the ƒ jack is not wired. */
function nodeGraphPulseTrainFWired(node) {
  const id = String(node?.id || "");
  if (!id || typeof nodeGraphModuleScopeConnectionsTo !== "function") return Number.NaN;
  const wire = nodeGraphModuleScopeConnectionsTo(id, "f")
    .find((c) => c?.sourceNode && c?.sourcePort);
  if (!wire) return Number.NaN;
  return typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(wire.sourceNode, wire.sourcePort, Number.NaN))
    : Number.NaN;
}

/** 1/|ƒ| seconds when the ƒ jack is wired and nonzero, else NaN (negative ƒ plays backwards). */
function nodeGraphPulseTrainFPeriod(node) {
  const hz = Math.abs(nodeGraphPulseTrainFWired(node));
  if (!(hz > 0)) return Number.NaN;
  return 1 / hz;
}

/** Negative ƒ (wired, or the Frequency knob): the cycle plays backwards (pulse_train v40). */
function nodeGraphPulseTrainReversed(node, fKnob) {
  const wired = nodeGraphPulseTrainFWired(node);
  return Number.isFinite(wired) ? wired < 0 : Number(fKnob) < 0;
}

function nodeGraphPulseTrainPulseMode(v) {
  const p = Number(v);
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  return p;
}

function nodeGraphPulseTrainPreAmt(p) {
  if (!(p > 0)) return 0;
  if (p >= 0.5) return 1;
  return p * 2;
}

function nodeGraphPulseTrainPostAmt(p) {
  if (p >= 1) return 0;
  if (!(p > 0.5)) return 1;
  return (1 - p) * 2;
}

function nodeGraphPulseTrainSpanScale(p) {
  return nodeGraphPulseTrainPreAmt(p) + nodeGraphPulseTrainPostAmt(p);
}

function nodeGraphPulseTrainDualAmt(p) {
  return nodeGraphPulseTrainPreAmt(p) > 0 && nodeGraphPulseTrainPostAmt(p) > 0 ? 1 : 0;
}

function nodeGraphPulseTrainPolarity(v) {
  return Number(v) > 0.5 ? 1 : 0;
}

const nodeGraphPulseTrainIsDual = (p) => nodeGraphPulseTrainPreAmt(p) > 0 && nodeGraphPulseTrainPostAmt(p) > 0;

/** Schedule for args [count, time, curve, ampStart, ampEnd, ampCurve, amplitude, mode, pulseMode, endDelay, polarity, spacing]. */
function nodeGraphPulseTrainPreviewJs(args, endTime) {
  const pulseMode = nodeGraphPulseTrainPulseMode(args[8]);
  const polarity = nodeGraphPulseTrainPolarity(args[10]);
  const spacing = Math.round(Number(args[11]) || 0);
  const countC = nodeGraphPulseTrainClampCount(args[0]);
  const loop = args[7] > 0.5;
  const dual = nodeGraphPulseTrainIsDual(pulseMode);
  // Continuous C (positions) and ceil(C) pulses; forward pulse fwdCap-1 plays at fade.
  const countF = dual ? Math.min(countC, 8192) : countC;
  const fwdCap = Math.max(1, Math.ceil(countF));
  const fade = Math.min(1, Math.max(0, countF - (fwdCap - 1)));
  const uOf = (i, asLoop) => (asLoop
    ? (countF > 0 ? i / countF : 0)
    : (fwdCap > 1 ? Math.min(1, i / (countF - 1)) : 0));
  const count = !dual || fwdCap <= 1 ? fwdCap : 2 * fwdCap - 1;
  const duration = Number(endTime) > 0 ? Number(endTime) : 0;
  const delayRaw = Number(args[9]);
  const delay = Number.isFinite(delayRaw) ? delayRaw : 0;
  const curve = Number(args[2]) || 0;
  const kTime = curve;
  const ampStart = Number(args[3]) || 0;
  const ampEnd = Number(args[4]) || 0;
  const ampCurve = Number(args[5]) || 0;
  const a0 = polarity > 0.5 ? ampEnd : ampStart;
  const a1 = polarity > 0.5 ? ampStart : ampEnd;
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
    const pre = nodeGraphPulseTrainPreAmt(pulseMode);
    const post = nodeGraphPulseTrainPostAmt(pulseMode);
    const revOnly = pre > 0 && !(post > 0);
    const oneWay = (i, asLoop) => {
      const u = uOf(i, asLoop);
      let t = !asLoop && i === fwdCap - 1 && fwdCap > 1 ? duration : duration * nodeGraphPulseTrainTimeWarp(kTime, u, i, countF, asLoop, spacing);
      if (!(t >= 0)) t = 0;
      if (t > duration) t = duration;
      return t;
    };
    const fwdRevIndex = (j) => (j < fwdCap ? j : 2 * fwdCap - 1 - j);
    const fwdRevTime = (j) => {
      const i = fwdRevIndex(j);
      const rev = j >= fwdCap;
      const tf = oneWay(i, rev ? false : loop);
      if (rev) {
        let t = pre * (duration - tf);
        if (!(t >= 0)) t = 0;
        return t;
      }
      return pre * duration + post * tf;
    };
    const timeOrderK = (j) => {
      const nRev = count - fwdCap;
      return j < nRev ? fwdCap + j : j - nRev;
    };
    for (let jj = 0; jj < count; jj += 1) {
      let i = jj;
      let uLoop = loop;
      let t;
      if (fwdCap > 1 && revOnly) {
        i = fwdCap - 1 - jj;
        uLoop = false;
        t = duration - oneWay(i, false);
        if (!(t >= 0)) t = 0;
        if (t > duration) t = duration;
        if (loop) t *= (countF - 1) / countF;
      } else if (dual && fwdCap > 1) {
        const k = timeOrderK(jj);
        i = fwdRevIndex(k);
        uLoop = k >= fwdCap ? false : loop;
        t = fwdRevTime(k);
      } else {
        t = oneWay(jj, loop);
      }
      const u = uOf(i, uLoop);
      times[jj] = t;
      let a = (a0 + (a1 - a0) * nodeGraphPulseTrainCurveShape(ampCurve, u)) * amplitude;
      if (i === fwdCap - 1 && fade < 1) a *= fade;
      amps[jj] = a;
      peak = Math.max(peak, Math.abs(a));
    }
  }
  const span = nodeGraphPulseTrainSpanScale(pulseMode) * duration;
  const last = count ? times[count - 1] : 0;
  const cutoff = loop ? span + delay : last + delay;
  const end = Math.max(0.001, loop || delay !== 0 ? Math.max(0, cutoff) : last || 0.001);
  // Reverse (pulse_train v40): mirror around the cut (Loop: the cycle, its pulse
  // at 0 stays; One shot: last pulse + End Delay). Pulses past the cut stay past it.
  let reversed = false;
  if (args[13] && count > 0) {
    reversed = true;
    const E = Math.max(0, cutoff);
    let m = 0;
    while (m < count && (loop ? times[m] < E : times[m] <= E)) m += 1;
    const fwdT = Float64Array.from(times);
    const fwdA = Float64Array.from(amps);
    for (let j = 0; j < count; j += 1) {
      if (j >= m) {
        times[j] = loop ? E : E + 1;
        amps[j] = fwdA[j];
        continue;
      }
      const k = loop ? (j === 0 ? 0 : m - j) : m - 1 - j;
      times[j] = loop && j === 0 ? 0 : Math.max(0, E - fwdT[k]);
      amps[j] = fwdA[k];
    }
  }
  // Edge Fade (pulse_train v38): the last pulse before the cutoff plays at
  // (cutoff - t_k) / (t_k+1 - t_k), same test as pulseAfterCutoff.
  let edgeFaded = false;
  if (args[12] && !(loop && !(cutoff > 0))) {
    const after = (t) => (loop ? t >= cutoff : t > cutoff);
    for (let j = 0; j + 1 < count; j += 1) {
      if (after(times[j])) break;
      if (!after(times[j + 1])) continue;
      const gap = times[j + 1] - times[j];
      if (gap > 0) {
        const f = Math.min(1, Math.max(0, (cutoff - times[j]) / gap));
        if (f < 1) {
          amps[j] *= f;
          edgeFaded = true;
        }
      }
      break;
    }
  }
  return {
    edgeFaded,
    reversed,
    times, amps, end, duration, peak, loop, pulseMode, polarity, delay,
    count, nFwd: fwdCap, countF, curve, spacing, ampStart, ampEnd, ampCurve, amplitude,
  };
}

/** Heard seconds since the last trigger, or NaN when no train is playing.
 *  Loop Free: keep phase against the axis captured with __Elapsed, then map
 *  onto the current cycle so shrinking Frequency does not `e % newEnd` to 0. */
function nodeGraphPulseTrainHeardElapsed(section, end, loop) {
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
    section._pulseTrainAnchorEnd = end;
  }
  if (!Number.isFinite(section._pulseTrainAnchorTime)) return Number.NaN;
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  const dt = heard - section._pulseTrainAnchorTime;
  const axis = section._pulseTrainAnchorEnd > 0 ? section._pulseTrainAnchorEnd : end;
  if (loop && axis > 0 && end > 0) {
    let phase = (section._pulseTrainAnchorValue + dt) / axis;
    phase -= Math.floor(phase);
    if (!(phase >= 0) || phase >= 1) phase = 0;
    return phase * end;
  }
  const e = section._pulseTrainAnchorValue + dt;
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
  let elapsed = schedule
    ? nodeGraphPulseTrainHeardElapsed(section, end, schedule.loop)
    : Number.NaN;
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
        polarity: sched.polarity,
        duration: sched.duration * timeScale,
        axisEnd: end,
        curve: sched.curve,
        spacing: sched.spacing,
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
    // Fractional Count (or < 1), an Edge-Faded pulse or Reverse: the instanced
    // forest only knows forward integer Counts at full height, so draw the preview schedule's
    // stems on the CPU (up to 4096).
    const fractional = !(schedule.countF === Math.floor(schedule.countF)) || schedule.countF < 1;
    if ((fractional || schedule.edgeFaded || schedule.reversed) && schedule.count <= 4096) {
      const elapsedVal = playing ? elapsed : Number.NaN;
      const fadeTau = Number(look.fadeTime) || 0;
      const mixC = (a, b, w) => [0, 1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * w);
      for (let j = 0; j < schedule.count; j += 1) {
        const t = schedule.times[j];
        if (!(t <= end)) continue;
        const amp = Math.abs(schedule.amps[j]);
        const x = at(t);
        const y = base - (amp / scale) * (base - top);
        const litAmt = elapsedVal >= 0 && t <= elapsedVal
          ? (fadeTau > 0 ? Math.exp(-(elapsedVal - t) / fadeTau) : 1) : 0;
        if (base - y > 0.5) nodeGraphGlLinesSegment(batch, x, base, x, y, halfPx, smoothing, mixC(line, lit, litAmt));
        if (dotR > 0 && amp > 0) nodeGraphGlLinesDot(batch, x, y, dotR, smoothing, mixC(dot, lit, litAmt));
      }
    } else {
      forest(schedule, line, dot, lit, playing ? elapsed : Number.NaN);
    }
  }
  // No playhead line: the lit stems already show where the train is.
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
