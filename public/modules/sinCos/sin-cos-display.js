// SinCos face — cheap 1D one-cycle sine (red) and cosine (blue).
// WebGL line + white phase dots (cycle-line-gl). Frame-rate paint, no engine-rate ring.
// A line is drawn only when a patch wire leaves that output jack.
// Each drawn line gets its own phase dot. Both dots are white.

// Display Settings schema `sinCosFace`: line / dot / background HBS
// (nodeGraphHueBrightnessCss) + line / dot thickness, on the RoundShape model.
// Defaults reproduce the original fixed look exactly: sine #ff2d2d =
// HBS(0, 0.544, 1), white dots, plate #020609 = HBS(205.714, 0.009, 0.59).
// Line HBS drives the sine; the cosine follows it at a fixed hue offset and
// brightness ratio (default HBS(212.6, 0.562, 1) = the original #3d7eff).
const nodeGraphSinCosFaceDisplaySettingsDefaults = Object.freeze({
  lineHue: 0,
  lineBrightness: 0.544,
  lineSaturation: 1,
  lineThickness: 2,
  lineBlur: 0,
  dotHue: 0,
  dotBrightness: 1,
  dotSaturation: 0,
  dotThickness: 5,
  backgroundHue: 205.714,
  backgroundBrightness: 0.009,
  backgroundSaturation: 0.59,
  pixelDensity: 1,
});
const NODE_GRAPH_SINCOS_COS_HUE_OFFSET = 212.6;
const NODE_GRAPH_SINCOS_COS_BRIGHTNESS_RATIO = 0.562 / 0.544;

function normalizeNodeGraphSinCosFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return normalizeNodeGraphRoundShapeFaceSettings({ ...nodeGraphSinCosFaceDisplaySettingsDefaults, ...source });
}

function nodeGraphSinCosFaceSettingsForNode(node) {
  return normalizeNodeGraphSinCosFaceSettings(node?.traceDisplaySettings);
}

function nodeGraphSinCosCosPaint(look) {
  const hue = Number(look.lineHue) + NODE_GRAPH_SINCOS_COS_HUE_OFFSET;
  const bright = Math.min(1, Number(look.lineBrightness) * NODE_GRAPH_SINCOS_COS_BRIGHTNESS_RATIO);
  return nodeGraphHueBrightnessCss(((hue % 360) + 360) % 360, bright, 1, look.lineSaturation);
}

function applyNodeGraphSinCosDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-sincos-display[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._sinCosForceDraw = true;
  el._sinCosLaidOut = false;
  drawNodeGraphSinCosDisplay(el);
}

function createNodeGraphSinCosDisplay(nodeId, type = "sinCos") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-sincos-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "sinCos");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.66";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-sincos-canvas");
  canvas.dataset.lightSource = "screen";
  canvas.dataset.lightStrength = "0.66";
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `sinCos:${el.dataset?.node || ""}`,
    forceKey: "_sinCosForceDraw",
    rafKey: "_sinCosPlayheadRaf",
    paint: drawNodeGraphSinCosDisplay,
    onResize: (el) => {
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
      el._sinCosLaidOut = false;
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawNodeGraphSinCosDisplay(section);
      section._startFaceLoop?.();
    });
  });
  return section;
}

function nodeGraphSinCosLiveParam(node, key, fallback = 0) {
  if (typeof nodeGraphFilterCurveLiveParam === "function") {
    return nodeGraphFilterCurveLiveParam(node, key, fallback);
  }
  const n = Number(node?.params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphSinCosReadPhase(nodeId, node, section) {
  if (typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    const live = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "__Phase", Number.NaN));
    if (Number.isFinite(live)) {
      return live - Math.floor(live);
    }
  }
  if (typeof nodeGraphMvp !== "undefined") {
    const stored = Number(nodeGraphMvp?.live?.runtime?.phases?.get?.(nodeId));
    if (Number.isFinite(stored)) {
      const offset = nodeGraphFiniteNumber(nodeGraphSinCosLiveParam(node, "phase", 0));
      const phase = stored + offset;
      return phase - Math.floor(phase);
    }
  }
  if (typeof nodeGraphRoundShapeLivePlaying === "function" && nodeGraphRoundShapeLivePlaying()) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const freq = nodeGraphFiniteNumber(node?.type === "dsfOscillator"
      ? nodeGraphSinCosLiveParam(node, "frequency", 100)
      : nodeGraphSinCosLiveParam(node, "freq", 1));
    const offset = nodeGraphFiniteNumber(nodeGraphSinCosLiveParam(node, "phase", 0));
    const speed = Number(nodeGraphMvp?.live?.speedMultiplier);
    const mul = Number.isFinite(speed) ? speed : 1;
    if (section && Number.isFinite(section._sinCosClock)) {
      const dt = Math.max(0, Math.min(0.25, now - section._sinCosClock));
      let next = (nodeGraphFiniteNumber(section._sinCosPhase)) + freq * dt * mul;
      next -= Math.floor(next);
      section._sinCosPhase = next;
      section._sinCosClock = now;
      return next;
    }
    if (section) {
      section._sinCosClock = now;
      section._sinCosPhase = offset - Math.floor(offset);
    }
    return offset - Math.floor(offset);
  }
  return Number.NaN;
}

// polarity 1 = Unipolar: same lift as the engine, 0.5*amp*(v+1).
function nodeGraphSinCosSample(phase01, kind, amplitude, polarity = 0) {
  const cycle = nodeGraphFiniteNumber(phase01);
  const wrapped = cycle - Math.floor(cycle);
  const amp = Number(amplitude);
  const scale = Number.isFinite(amp) ? amp : 1;
  const angle = wrapped * Math.PI * 2;
  const y = kind === "cos" ? Math.cos(angle) : Math.sin(angle);
  if (polarity >= 0.5) {
    const lift = scale > 0 ? scale : 0;
    return 0.5 * (y * scale + lift);
  }
  return y * scale;
}

// Patch-graph wire leaving the jack. Not "did the audio thread compute this out".
function nodeGraphSinCosOutputHasWire(nodeId, port) {
  const id = String(nodeId || "").trim();
  const want = String(port || "").trim();
  if (!id || !want) {
    return false;
  }
  const names = want === "sin"
    ? ["sin", "Sin"]
    : (want === "cos" ? ["cos", "Cos"] : [want]);
  if (typeof nodeGraphModuleConnectedSignalPortSets === "function") {
    const outputs = nodeGraphModuleConnectedSignalPortSets(id)?.outputs;
    if (outputs && names.some((name) => outputs.has(name))) {
      return true;
    }
  }
  const patch = (typeof nodeGraphMvp !== "undefined" && nodeGraphMvp?.patch) || null;
  if (!patch) {
    return false;
  }
  const hit = (sourceNode, sourcePort) => sourceNode === id && names.includes(String(sourcePort || ""));
  for (const connection of patch.connections || []) {
    if (hit(connection?.sourceNode, connection?.sourcePort)) return true;
  }
  for (const modulation of patch.modulations || []) {
    if (hit(modulation?.sourceNode, modulation?.sourcePort)) return true;
  }
  for (const graph of patch.graphConnections || []) {
    if (hit(graph?.sourceNode, graph?.sourcePort)) return true;
  }
  return false;
}

function drawNodeGraphSinCosDisplay(section) {
  try {
    drawNodeGraphSinCosDisplayInner(section);
  } catch (error) {
    const detail = error && typeof error === "object"
      ? (error.message || error.name || String(error))
      : String(error);
    console.error("[sincos] draw failed", detail, error);
    if (section) {
      section._sinCosForceDraw = true;
      section._sinCosLaidOut = false;
    }
  }
}

// DSF Oscillator face: one steady-state cycle built from the same closed form
// as native_modules/dsf_oscillator (SineSaw kernel, n = floor(Nyquist/f) - 1).
// The engine leaky-integrates the kernel; at steady state that is the running
// integral over one cycle minus its mean. Sampled finely so Gibbs ringing shows.
function nodeGraphDsfSampleRate() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  const sr = Number(live?.context?.sampleRate ?? live?.audioContext?.sampleRate);
  return Number.isFinite(sr) && sr > 1 ? sr : 48000;
}

function nodeGraphDsfCycle(params, count) {
  const waveform = Math.max(0, Math.min(4, Math.round(nodeGraphFiniteNumber(params.waveform))));
  const amp = Number.isFinite(params.amplitude) ? params.amplitude : 1;
  const out = new Float64Array(count);
  if (waveform === 0) {
    for (let i = 0; i < count; i += 1) out[i] = Math.max(-1.5, Math.min(1.5, Math.sin(2 * Math.PI * i / count))) * amp;
    return out;
  }
  const sr = nodeGraphDsfSampleRate();
  const f = Math.max(1e-6, Math.abs(nodeGraphFiniteNumber(params.frequency)));
  let n = Math.floor((sr * 0.5) / f) - 1;
  n = Math.max(1, Math.min(4096, n));
  const m = Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.morph)));
  const k = Math.max(1e-6, (1 - (m > 0 ? Math.pow(m, 0.14) : 0)) * 4);
  const k2 = k * k;
  const k42 = Math.pow(2, 2 * k2);
  const eightK2 = Math.pow(8, k2);
  const decay = Math.pow(2, -k2 * (n + 1));
  const twoK2 = Math.pow(2, k2);
  const denCos = Math.pow(2, 1 + k2);
  const kernel = (turns) => {
    const t = turns - Math.floor(turns);
    const x = 2 * Math.PI * t;
    const cx = Math.cos(x);
    const sx = Math.sin(x);
    const cxn = Math.cos(x * n);
    const sxn = Math.sin(x * n);
    const num = (k42 * cxn - eightK2 * (cxn * cx - sxn * sx)) * decay + cx * k42 - twoK2;
    const den = 1 - denCos * cx + k42;
    return Math.abs(den) < 1e-12 ? 0 : num / den;
  };
  // Engine accumulator: acc = acc*exp(-0.23026*dt) + raw*dt per sample. In
  // turns that is dy/dt = -a*y + raw(t), a = 0.23026. Its periodic steady state
  // is y0 = I/(1 - e^-a), with I = one cycle from y = 0. Resolution-free.
  const leak = 0.23026;
  const integrateArr = (rawAt) => {
    const acc = new Float64Array(count);
    const h = 1 / count;
    const r = Math.exp(-leak * h);
    let y = 0;
    for (let i = 0; i < count; i += 1) { y = y * r + rawAt(i) * h; acc[i] = y; }
    const y0 = y / (1 - Math.exp(-leak));
    let carry = y0;
    for (let i = 0; i < count; i += 1) { carry *= r; acc[i] += carry; }
    return acc;
  };
  // Midpoints: t = 0 is the closed form's 0/0 point and would drop the spike.
  const integrate = (raw) => integrateArr((i) => raw((i + 0.5) / count));
  const saw = integrate(kernel);
  const pw = Math.max(0.01, Math.min(0.99, nodeGraphFiniteNumber(params.pulseWidth)));
  let shape = saw;
  if (waveform === 4) {
    const sq = integrate((t) => kernel(t) - kernel(t - 0.5));
    const b = Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.blend)));
    shape = saw.map((v, i) => v * (1 - b) + sq[i] * b);
  } else if (waveform === 2 || waveform === 3) {
    const sq = integrate((t) => kernel(t) - kernel(t - pw));
    shape = sq;
    if (waveform === 3) {
      const tri = integrateArr((i) => sq[i] * 4);
      const comp = 1 / Math.max(0.05, Math.min(1, Math.abs(Math.sin(Math.PI * pw))));
      let absMean = 0;
      for (let i = 0; i < count; i += 1) { tri[i] *= comp; absMean += Math.abs(tri[i]); }
      const peak = Math.max(1, absMean / count);
      for (let i = 0; i < count; i += 1) tri[i] /= peak;
      shape = tri;
    }
  }
  for (let i = 0; i < count; i += 1) out[i] = Math.max(-1.5, Math.min(1.5, shape[i])) * amp;
  return out;
}

function nodeGraphDsfCyclePointCount(node) {
  const sr = nodeGraphDsfSampleRate();
  const f = Math.max(1e-6, Math.abs(nodeGraphFiniteNumber(nodeGraphSinCosLiveParam(node, "frequency", 100))));
  const n = Math.max(1, Math.min(4096, Math.floor((sr * 0.5) / f) - 1));
  // ~12 points per ripple of the highest partial, 2048..8192.
  return Math.max(2048, Math.min(8192, Math.ceil(n * 12)));
}

function drawNodeGraphSinCosDisplayInner(section) {
  const nodeId = section?.dataset?.node
    || section?.closest?.(".dsp-node")?.dataset?.node
    || "";
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const canvas = section?.querySelector?.(".node-sincos-canvas")
    || section?.querySelector?.("canvas");
  if (!node || !canvas) {
    return;
  }
  const isDsf = node.type === "dsfOscillator";
  const amplitude = isDsf ? nodeGraphSinCosLiveParam(node, "amplitude", 1) : nodeGraphSinCosLiveParam(node, "amp", 1);
  const dsfParams = isDsf ? {
    waveform: nodeGraphSinCosLiveParam(node, "waveform", 1),
    frequency: nodeGraphSinCosLiveParam(node, "frequency", 100),
    morph: nodeGraphSinCosLiveParam(node, "morph", 1),
    pulseWidth: nodeGraphSinCosLiveParam(node, "pulseWidth", 0.5),
    blend: nodeGraphSinCosLiveParam(node, "blend", 0.5),
    amplitude,
  } : null;
  const polarity = isDsf ? 0 : Math.round(nodeGraphFiniteNumber(nodeGraphSinCosLiveParam(node, "polarity", 0))) >= 1 ? 1 : 0;
  const phaseParam = nodeGraphFiniteNumber(nodeGraphSinCosLiveParam(node, "phase", 0));
  // DSF has one output: its cycle is always drawn.
  const drawSin = isDsf ? false : nodeGraphSinCosOutputHasWire(nodeId, "sin");
  const drawCos = isDsf ? false : nodeGraphSinCosOutputHasWire(nodeId, "cos");
  const look = nodeGraphSinCosFaceSettingsForNode(node);
  const strokeW = look.lineThickness;
  const dotW = look.dotThickness;
  const pixelDensity = 1;
  const faceMetrics = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(section, { observe: true })
    : null;
  const rawW = faceMetrics
    ? faceMetrics.cssW
    : nodeGraphFiniteNumber(section.clientWidth || section.offsetWidth);
  const rawH = faceMetrics
    ? faceMetrics.cssH
    : nodeGraphFiniteNumber(section.clientHeight || section.offsetHeight);
  const signature = [
    String(nodeId),
    drawSin ? "sin" : "",
    drawCos ? "cos" : "",
    dsfParams ? JSON.stringify(dsfParams) + "@" + nodeGraphDsfSampleRate() : "",
    String(Number(amplitude).toFixed(4)),
    polarity ? "uni" : "bi",
    String((phaseParam - Math.floor(phaseParam)).toFixed(4)),
    `${Math.round(rawW)}x${Math.round(rawH)}`,
    look.strokePaint, look.dotPaint, look.backgroundPaint, strokeW, dotW,
  ].join("|");
  const livePlaying = typeof nodeGraphRoundShapeLivePlaying === "function"
    ? nodeGraphRoundShapeLivePlaying()
    : true;
  if (
    !livePlaying
    && section._sinCosSignature === signature
    && !section._sinCosForceDraw
    && section._sinCosLaidOut === true
  ) {
    return;
  }
  if (rawW < 8 || rawH < 8) {
    section._sinCosLaidOut = false;
    section._sinCosForceDraw = true;
    if (!section._sinCosRetryFrame) {
      section._sinCosRetryFrame = requestAnimationFrame(() => {
        section._sinCosRetryFrame = 0;
        drawNodeGraphSinCosDisplay(section);
      });
    }
    return;
  }

  const metrics = typeof nodeGraphCycleLineGlMetrics === "function"
    ? nodeGraphCycleLineGlMetrics(section, canvas, pixelDensity)
    : null;
  if (!metrics) {
    return;
  }
  const pixelRatio = metrics.pixelRatio || 1;
  const drawW = metrics.cssWidth;
  const drawH = metrics.cssHeight;
  section._sinCosSignature = signature;
  section._sinCosForceDraw = false;
  section._sinCosLaidOut = true;

  const strokeInset = strokeW * 0.5 + 1 / Math.max(pixelRatio, 1);
  const padX = Math.max(6, drawW * 0.06) + strokeInset;
  const padY = Math.max(6, drawH * 0.12) + strokeInset;
  const innerW = Math.max(4, drawW - padX * 2);
  const innerH = Math.max(4, drawH - padY * 2);
  const midY = padY + innerH * 0.5;
  const halfH = innerH * 0.5;
  const mapX = (phase) => padX + phase * innerW;
  // Bipolar: -1..1 over the full height. Unipolar: 0 at the bottom, 1 at the top.
  const mapY = polarity
    ? (value) => padY + innerH - value * innerH
    : (value) => midY - value * halfH;
  const samples = Math.max(32, Math.min(256, Math.ceil(innerW)));
  const wrap01 = (p) => {
    const n = nodeGraphFiniteNumber(p);
    return n - Math.floor(n);
  };
  const phaseOff = wrap01(phaseParam);
  const sampleKind = (cycle01, kind) => nodeGraphSinCosSample(wrap01(cycle01 + phaseOff), kind, amplitude, polarity);
  const lines = [];
  const pushLine = (kind, color) => {
    const points = [];
    for (let i = 0; i <= samples; i += 1) {
      const xNorm = i / samples;
      points.push({ x: mapX(xNorm), y: mapY(sampleKind(xNorm, kind)) });
    }
    lines.push({ points, color, width: strokeW, blur: 0 });
  };
  // Red sine only if a wire leaves the sin jack. Blue cosine only for cos.
  if (drawSin) pushLine("sin", look.strokePaint);
  if (drawCos) pushLine("cos", nodeGraphSinCosCosPaint(look));
  let dsfCycle = null;
  if (isDsf) {
    if (section._dsfCycleKey !== signature) {
      section._dsfCycle = nodeGraphDsfCycle(dsfParams, nodeGraphDsfCyclePointCount(node));
      section._dsfCycleKey = signature;
    }
    dsfCycle = section._dsfCycle;
    const count = dsfCycle.length;
    const shift = Math.floor(phaseOff * count) % count;
    const points = [];
    for (let i = 0; i <= count; i += 1) {
      points.push({ x: mapX(i / count), y: mapY(dsfCycle[(i + shift) % count]) });
    }
    lines.push({ points, color: look.strokePaint, width: strokeW, blur: 0 });
  }

  let play = nodeGraphSinCosReadPhase(nodeId, node, section);
  if (!Number.isFinite(play)) {
    play = phaseOff;
  }
  play = wrap01(play);
  const playX = wrap01(play - phaseOff);
  const px = mapX(playX);
  const dotR = Math.max(0.5, dotW * 0.5);
  const dots = [];
  // One white phase marker per drawn line. Lines stay red/blue; dots do not.
  const pushDot = (kind) => {
    const py = mapY(nodeGraphSinCosSample(play, kind, amplitude, polarity));
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    dots.push({ x: px, y: py, color: look.dotPaint, radius: dotR });
  };
  if (drawSin) pushDot("sin");
  if (drawCos) pushDot("cos");
  if (dsfCycle) {
    // Line starts at the Phase offset; dot x is play - offset, value is cycle(play).
    const idx = Math.min(dsfCycle.length - 1, Math.floor(play * dsfCycle.length));
    const py = mapY(dsfCycle[idx]);
    if (Number.isFinite(px) && Number.isFinite(py)) dots.push({ x: px, y: py, color: look.dotPaint, radius: dotR });
  }
  nodeGraphCycleLineGlPresent(canvas, {
    cssWidth: drawW,
    cssHeight: drawH,
    background: look.backgroundPaint,
    waveKey: signature,
    lines,
    dots,
  });
}


if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.sinCosFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("sinCosFace", createNodeGraphSinCosDisplay);
}