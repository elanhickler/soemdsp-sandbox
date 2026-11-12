// Rounding Error Sequencer display. One bar per step, height = that step's
// accent (after Exaggerate Difference), the same math as blit_trigger.cpp:
// step k starts at Rotate + k * Spacing internal samples, a band-limited gate
// of Gate samples; its peak on the grid is the accent.
//   Length > 0 (loop): the loop's bars stay in place; each step lights up
//     when it fires and fades to a ghost floor (Fade time / Ghost settings).
//   Length 0 (free): a waterfall: the last 16 steps, the newest entering on
//     the right, the row shifting left as each step fires.
// Display Settings `roundingErrorFace` (node.traceDisplaySettings):
// Background / Bars colours, Fade time (s), Ghost (dim floor 0..1).
// GPU only, shared line / text drawer (gl-line-renderer).

const NODE_GRAPH_ROUNDING_ERROR_LATENCY = 2;
const NODE_GRAPH_ROUNDING_ERROR_FREE_STEPS = 16;

const nodeGraphRoundingErrorFaceDisplaySettingsDefaults = Object.freeze({
  backgroundColor: "#06080c",
  barColor: "#e2b44a",
  textColor: "#7fc7d9",
  fadeTime: 0.35,
  ghost: 0.3,
  waterfallSteps: false,
});

function normalizeNodeGraphRoundingErrorFaceSettings(settings = {}) {
  const d = nodeGraphRoundingErrorFaceDisplaySettingsDefaults;
  const source = settings && typeof settings === "object" ? settings : {};
  const color = (key) => {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") return d[key];
    if (typeof normalizeNodeGraphTraceDisplayColor === "function") return normalizeNodeGraphTraceDisplayColor(raw, d[key]);
    const s = String(raw).trim();
    return /^#?[0-9a-f]{6}$/i.test(s) ? (s[0] === "#" ? s : `#${s}`) : d[key];
  };
  const num = (key, lo, hi) => {
    const n = Number(source[key]);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d[key];
  };
  return {
    backgroundColor: color("backgroundColor"),
    barColor: color("barColor"),
    textColor: color("textColor"),
    fadeTime: num("fadeTime", 0, 10),
    ghost: num("ghost", 0, 1),
    waterfallSteps: source.waterfallSteps === undefined
      ? d.waterfallSteps
      : (typeof nodeGraphDisplaySettingsToggleIsOn === "function"
        ? nodeGraphDisplaySettingsToggleIsOn(source.waterfallSteps)
        : (source.waterfallSteps === true || source.waterfallSteps === 1 || source.waterfallSteps === "1" || source.waterfallSteps === "true")),
  };
}

function nodeGraphRoundingErrorFaceSettingsForNode(node) {
  return normalizeNodeGraphRoundingErrorFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphRoundingErrorDisplaySettingsToFace(node) {
  const id = String(node?.id || "");
  document.querySelectorAll(`.node-rounding-error-face[data-node="${CSS.escape(id)}"]`).forEach((el) => {
    el._roundingErrorForceDraw = true;
  });
  if (typeof markNodeGraphRenderPending === "function") markNodeGraphRenderPending();
}

function nodeGraphRoundingErrorCdf(x) {
  if (x <= -2) return 0;
  if (x >= 2) return 1;
  if (x <= -1) { const t = x + 2; return t * t * t * t / 24; }
  if (x <= 0) { const x2 = x * x; return 1 / 24 + (4 * x - 2 * x2 * x - 0.75 * x2 * x2 + 2.75) / 6; }
  return 1 - nodeGraphRoundingErrorCdf(-x);
}

function nodeGraphRoundingErrorGateAt(x, t0, w) {
  const L = NODE_GRAPH_ROUNDING_ERROR_LATENCY;
  return nodeGraphRoundingErrorCdf(x - L - t0) - nodeGraphRoundingErrorCdf(x - L - t0 - w);
}

/** Accent of a step starting at t0 (internal samples): its peak on the grid. */
function nodeGraphRoundingErrorPeak(t0, w) {
  if (!(w > 0)) return 0;
  const a = Math.floor(t0 + NODE_GRAPH_ROUNDING_ERROR_LATENCY - 2);
  let best = 0;
  const n = 8 + Math.floor(w);
  for (let i = 0; i < n; i += 1) best = Math.max(best, nodeGraphRoundingErrorGateAt(a + i, t0, w));
  return best;
}

function nodeGraphRoundingErrorParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/** The pattern: accent(k) after Exaggerate Difference, as the DSP plays it. */
function nodeGraphRoundingErrorPattern(node) {
  const spacing = Math.max(1, nodeGraphRoundingErrorParam(node, "spacing", 7.3));
  // Loop Shift: the DSP plays Rotate + the shift so far (__LoopShift tap), so the bars follow each loop.
  const shiftKnob = nodeGraphRoundingErrorParam(node, "loopShift", 0);
  const shiftSoFar = shiftKnob > 0 && typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(String(node.id), "__LoopShift", 0))
    : 0;
  const rotate = Math.min(1, Math.max(0, nodeGraphRoundingErrorParam(node, "rotate", 0)))
    + (Number.isFinite(shiftSoFar) ? shiftSoFar : 0);
  // Gate 0 = the tiny-gate limit (same floor as the DSP), never off.
  const gate = Math.max(1e-6, nodeGraphRoundingErrorParam(node, "gate", 2));
  const length = Math.round(Math.max(0, nodeGraphRoundingErrorParam(node, "length", 8)));
  const amount = Math.min(1, Math.max(0, nodeGraphRoundingErrorParam(node, "exaggerate", 0)));
  const raw = (k) => nodeGraphRoundingErrorPeak(rotate + k * spacing, gate);
  // Same range as the DSP (update_stats): the loop, or the first 64 free steps.
  const statN = length > 0 ? Math.min(length, 256) : 64;
  let lo = Infinity;
  let hi = -Infinity;
  if (amount > 0) {
    for (let k = 0; k < statN; k += 1) { const a = raw(k); lo = Math.min(lo, a); hi = Math.max(hi, a); }
  }
  const accent = (k) => {
    const a = raw(k);
    const range = hi - lo;
    if (!(amount > 0) || !(range > 1e-9)) return a;
    const norm = Math.min(1, Math.max(0, (a - lo) / range));
    return a + (norm - a) * amount;
  };
  // Pulse shape (same as the DSP): edge unit in grid samples from Sharpness,
  // never under one host sample (the anti-aliasing floor).
  const rate = Math.max(0, nodeGraphRoundingErrorParam(node, "rate", 4));
  const sharp = Math.min(1, Math.max(0, nodeGraphRoundingErrorParam(node, "sharpness", 0)));
  const hostRate = Math.max(1, Number(nodeGraphModuleScopeState?.sampleRate) || Number(nodeGraphMvp?.sampleRate) || 48000);
  const perHost = Math.min(64, rate * spacing / hostRate);
  const unit = perHost >= 1 ? perHost : Math.max(perHost, Math.exp(sharp * Math.log(Math.max(perHost, 1e-9))));
  return { accent, length, spacing, gate, unit };
}

/** A step's normalized pulse (peak 1) at grid time x after its start (latency removed). */
function nodeGraphRoundingErrorPulse(x, gate, unit) {
  const peak = 2 * nodeGraphRoundingErrorCdf(0.5 * gate) - 1;
  if (!(peak > 1e-12)) return 0;
  const v = nodeGraphRoundingErrorCdf(x / unit) - nodeGraphRoundingErrorCdf((x - gate * unit) / unit);
  return v / peak;
}

function drawNodeGraphRoundingErrorFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const look = nodeGraphRoundingErrorFaceSettingsForNode(node);
  const { accent, length, spacing, gate, unit } = nodeGraphRoundingErrorPattern(node);
  // Waterfall (scrolling) or the fixed loop; Length 0 always scrolls.
  const waterfall = length === 0 || look.waterfallSteps;
  const now = performance.now() / 1000;

  // Fired steps, from the Step output (held index; free run counts up).
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(String(node.id), "Step", Number.NaN))
    : Number.NaN;
  const st = section._roundingErrorState || (section._roundingErrorState = { last: Number.NaN, fired: new Map(), history: [] });
  if (Number.isFinite(live) && live !== st.last) {
    const k = Math.round(live);
    const prev = Number.isFinite(st.last) ? Math.round(st.last) : k - 1;
    st.last = live;
    // Steps can fire faster than the screen refreshes: mark every step passed
    // since the last frame, not only the one showing now.
    // History for the waterfall (loop index when Length > 0).
    {
      const from0 = Math.max(prev + 1, k - NODE_GRAPH_ROUNDING_ERROR_FREE_STEPS + 1);
      if (length > 0) {
        const span = ((k - prev) % length + length) % length || length;
        for (let i = span - 1; i >= 0; i -= 1) st.history.push((((k - i) % length) + length) % length);
      } else {
        for (let j = from0; j <= k; j += 1) st.history.push(j);
      }
      while (st.history.length > NODE_GRAPH_ROUNDING_ERROR_FREE_STEPS) st.history.shift();
    }
    if (length > 0) {
      const from = ((prev % length) + length) % length;
      const to = ((k % length) + length) % length;
      let passed = (to - from + length) % length;
      if (passed === 0) passed = length;  // a whole loop (or more) went by
      for (let i = 1; i <= passed; i += 1) st.fired.set((from + i) % length, now);
    } else {
      const start = Math.max(prev + 1, k - NODE_GRAPH_ROUNDING_ERROR_FREE_STEPS + 1);
      for (let j = start; j <= k; j += 1) st.fired.set(j, now);
      if (st.fired.size > 256) st.fired.clear();
    }
  }

  // Bars: [accent, brightness 0..1].
  const bars = [];
  const fade = look.fadeTime;
  const ghost = look.ghost;
  const lit = (t) => {
    if (!Number.isFinite(t)) return ghost;
    if (fade <= 0) return 1;
    return ghost + (1 - ghost) * Math.exp(-(now - t) / fade);
  };
  if (!waterfall) {
    const n = Math.min(64, length);
    let newest = -1;
    let newestT = -Infinity;
    st.fired.forEach((t, k) => { if (t > newestT) { newestT = t; newest = k; } });
    for (let k = 0; k < n; k += 1) {
      const t = st.fired.get(k);
      // Fade time 0: only the current step is lit.
      const b = fade <= 0 ? (k === newest ? 1 : ghost) : lit(t);
      bars.push([accent(k), b]);
    }
  } else {
    // Waterfall: oldest on the left, newest entering on the right.
    const hist = st.history;
    const pad = NODE_GRAPH_ROUNDING_ERROR_FREE_STEPS - hist.length;
    for (let i = 0; i < pad; i += 1) bars.push([0, ghost]);
    hist.forEach((k, i) => bars.push([accent(k), i === hist.length - 1 ? 1 : lit(st.fired.get(k))]));
  }

  const sig = `${w}x${h}|${look.backgroundColor}|${look.barColor}|${look.textColor}|${gate.toFixed(4)}|${unit.toPrecision(4)}|${spacing.toFixed(4)}|${waterfall}|${bars.map((b) => `${b[0].toFixed(3)}:${b[1].toFixed(2)}`).join(",")}`;
  if (sig === section._roundingErrorSig && !section._roundingErrorForceDraw) return;
  section._roundingErrorSig = sig;
  section._roundingErrorForceDraw = false;

  const hex = (css, fb) => (typeof nodeGraphGlGraphParseCssColor === "function" ? nodeGraphGlGraphParseCssColor(css, fb) : fb);
  const bg = hex(look.backgroundColor, [0.02, 0.03, 0.05, 1]);
  const fg = hex(look.barColor, [0.89, 0.71, 0.29, 1]);
  const ink = hex(look.textColor, [0.5, 0.78, 0.85, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, bg, { scale: pixelRatio });
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "rounding error: no shared GL device");
    return;
  }
  const pad = 6;
  const label = 14;
  const n = Math.max(1, bars.length);
  const slot = (w - pad * 2) / n;
  const floor = h - pad - label;
  const top = pad;
  const mix = (b) => [bg[0] + (fg[0] - bg[0]) * b, bg[1] + (fg[1] - bg[1]) * b, bg[2] + (fg[2] - bg[2]) * b, 1];
  nodeGraphGlLinesRect(batch, pad, floor, w - pad * 2, 1, mix(0.18));
  // Each step drawn as its real pulse, in the slot's time scale (one slot =
  // Spacing grid samples): Sharpness 0 = a soft hump with grid-wide
  // shoulders (can blur into neighbours), 1 = a thin needle; Gate sets the
  // flat top. Height = the accent. Anti-aliased like the app's plots: the
  // body is a fill under the sampled curve, its outline an AA stroke in the
  // same color; a pulse thinner than a pixel is one AA vertical stroke; a
  // zero accent a short floor marker.
  const gridPerPx = spacing / Math.max(1e-9, slot);
  const lead = 2 * unit;                       // the shoulder before the start
  const spanGrid = gate * unit + 4 * unit;     // whole pulse, grid samples
  const spanPx = spanGrid / gridPerPx;
  const stroke = (pts, rgba) => {
    if (typeof nodeGraphGlLinesStroke === "function") nodeGraphGlLinesStroke(batch, pts, 0.5, 1, rgba);
    else if (typeof nodeGraphGlLinesPolyline === "function") nodeGraphGlLinesPolyline(batch, pts, 0.5, 1, rgba);
  };
  bars.forEach(([a, b], i) => {
    const x0 = pad + i * slot;
    const color = mix(b);
    const hMax = Math.max(0, a) * (floor - top);
    if (!(hMax > 0.5)) {
      stroke([x0, floor - 1, x0 + Math.max(1, Math.min(slot, 3)), floor - 1], color);
      return;
    }
    if (spanPx < 1) {
      // Needle: one AA vertical line at the pulse's peak.
      const xp = x0 + (gate * unit * 0.5) / gridPerPx;
      stroke([xp, floor, xp, floor - hMax], color);
      return;
    }
    // Sample the curve finely (sub-pixel), clipped to the face.
    const n = Math.min(400, Math.max(24, Math.ceil(spanPx * 3)));
    const pts = [];
    for (let j = 0; j <= n; j += 1) {
      const xg = -lead + (spanGrid * j) / n;   // grid time relative to the step start
      const x = x0 + xg / gridPerPx;
      if (x < pad || x > w - pad) continue;
      pts.push(x, floor - nodeGraphRoundingErrorPulse(xg, gate, unit) * hMax);
    }
    if (pts.length < 4) return;
    nodeGraphGlLinesFillUnder(batch, pts, floor, color);
    stroke(pts, color);
  });
  const text = length === 0 ? "free: last 16 steps" : (waterfall ? `${length} steps, scrolling` : `${length} steps, loops`);
  nodeGraphGlLinesText(batch, text, pad, h - pad, {
    px: 11, rgba: ink, align: "left", baseline: "bottom", weight: 400,
    family: "\"Cascadia Mono\", Consolas, \"Courier New\", monospace",
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "rounding error: GL present failed");
  }
}

function createNodeGraphRoundingErrorFace(nodeId, type = "blitTrigger") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-rounding-error-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "blitTrigger");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-rounding-error-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `roundingError:${el.dataset?.node || ""}`,
    forceKey: "_roundingErrorForceDraw",
    rafKey: "_roundingErrorRaf",
    paint: drawNodeGraphRoundingErrorFace,
    onResize: (el) => {
      el._roundingErrorForceDraw = true;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    section._roundingErrorForceDraw = true;
    drawNodeGraphRoundingErrorFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.roundingErrorFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("roundingErrorFace", createNodeGraphRoundingErrorFace);
}
