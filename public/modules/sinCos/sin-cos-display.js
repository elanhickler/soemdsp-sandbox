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
  padExtra: 0,
});
const NODE_GRAPH_SINCOS_COS_HUE_OFFSET = 212.6;
const NODE_GRAPH_SINCOS_COS_BRIGHTNESS_RATIO = 0.562 / 0.544;

function normalizeNodeGraphSinCosFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const look = normalizeNodeGraphRoundShapeFaceSettings({ ...nodeGraphSinCosFaceDisplaySettingsDefaults, ...source });
  const extra = Number(source.padExtra);
  look.padExtra = Number.isFinite(extra) ? Math.max(0, Math.min(64, extra)) : 0;
  return look;
}

/** CSS px inset so stroke + phase-dot + smootherstep skirt stay inside the plate. */
function nodeGraphSinCosFacePadPx(look, pixelRatio, options = {}) {
  const strokeW = Math.max(0, Number(look?.lineThickness) || 0);
  const dotW = Math.max(0, Number(look?.dotThickness) || 0);
  const blur = Math.max(0, Number(look?.lineBlur) || 0);
  const extra = Math.max(0, Number(look?.padExtra) || 0);
  const feather = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look?.lineSmoothing) || 1);
  const lineHalf = strokeW * 0.5;
  const dotR = options.showDot === false ? 0 : Math.max(dotW > 0 ? 0.5 : 0, dotW * 0.5);
  return Math.max(lineHalf, dotR) + blur + feather + extra;
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
    const freq = nodeGraphFiniteNumber(node?.type === "dsfOscillator" || node?.type === "dsfMorphingOsc"
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

// DSF Oscillator face: one steady-state cycle from the original SineSaw closed
// form (n = floor(Nyquist/f), extra partial faded by the fractional part).
// DSF Morphing Osc draws Morph / Symmetry / Width / Rotate / Slice / Spacing /
// Odd-Even of the same object. The engine leaky-integrates (leak → 0.0005); at
// steady state that is the running integral over one cycle minus its mean.
function nodeGraphDsfSampleRate() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  const sr = Number(live?.context?.sampleRate ?? live?.audioContext?.sampleRate);
  return Number.isFinite(sr) && sr > 1 ? sr : 48000;
}

function nodeGraphDsfWrap01(turns) {
  const n = Number(turns);
  if (!Number.isFinite(n)) return 0;
  return n - Math.floor(n);
}

function nodeGraphDsfMakeCoeffs(n, k2) {
  return {
    n,
    k42: Math.pow(2, 2 * k2),
    eightK2: Math.pow(8, k2),
    decay: Math.pow(2, -k2 * (n + 1)),
    twoK2: Math.pow(2, k2),
    denCos: Math.pow(2, 1 + k2),
  };
}

function nodeGraphDsfKernelCS(turns, c) {
  const t = nodeGraphDsfWrap01(turns);
  const x = 2 * Math.PI * t;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cxn = Math.cos(x * c.n);
  const sxn = Math.sin(x * c.n);
  const den = 1 - c.denCos * cx + c.k42;
  // Closed form is 0/0 at t=0. A wide |den| band plus a partial sum is a
  // pulse of height ~n; the leaky integrator turns that into DC and the
  // trace walks off the face. Display samples mid-bin and treats a tiny
  // den as 0 (same as the pre-spectrum face).
  if (!(den > 1e-18 || den < -1e-18)) return { C: 0, S: 0 };
  const cos1 = cxn * cx - sxn * sx;
  const sin1 = sxn * cx + cxn * sx;
  return {
    C: ((c.k42 * cxn - c.eightK2 * cos1) * c.decay + cx * c.k42 - c.twoK2) / den,
    S: ((c.k42 * sxn - c.eightK2 * sin1) * c.decay + sx * c.k42) / den,
  };
}

function nodeGraphDsfSubMean(arr) {
  const n = arr.length;
  if (!n) return arr;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += arr[i];
  mean /= n;
  if (!(mean > 1e-18 || mean < -1e-18)) return arr;
  for (let i = 0; i < n; i += 1) arr[i] -= mean;
  return arr;
}

function nodeGraphDsfGeoSeries(r, start, step, count, turns, rotTurns) {
  if (count < 1) return 0;
  const t0 = nodeGraphDsfWrap01(turns * start + rotTurns);
  const a0 = 2 * Math.PI * t0;
  const cosA = Math.cos(a0);
  const sinA = Math.sin(a0);
  if (count === 1) return cosA;
  const tz = nodeGraphDsfWrap01(turns * step);
  const az = 2 * Math.PI * tz;
  const zr = r * Math.cos(az);
  const zi = r * Math.sin(az);
  const denr = 1 - zr;
  const deni = -zi;
  const den2 = denr * denr + deni * deni;
  if (!(den2 > 1e-4) || count > 4096) {
    let tr = cosA, ti = sinA, sr = 0;
    const n = Math.min(count, 4096);
    for (let k = 0; k < n; k += 1) {
      sr += tr;
      const nr = tr * zr - ti * zi;
      ti = tr * zi + ti * zr;
      tr = nr;
    }
    return sr;
  }
  const mag = Math.abs(r);
  let rm = mag === 0 ? 0 : Math.pow(mag, count);
  if (r < 0 && (count & 1)) rm = -rm;
  const tm = nodeGraphDsfWrap01(turns * step * count);
  const am = 2 * Math.PI * tm;
  const zmr = rm * Math.cos(am);
  const zmi = rm * Math.sin(am);
  const numr = 1 - zmr;
  const numi = -zmi;
  const inv = 1 / den2;
  const qr = (numr * denr + numi * deni) * inv;
  const qi = (numi * denr - numr * deni) * inv;
  return cosA * qr - sinA * qi;
}

function nodeGraphDsfSeriesCount(start, step, end) {
  const absStep = Math.abs(step);
  if (!(absStep > 1e-12)) return 0;
  let n = (end - start) / absStep + 1;
  if (n < 1) return 0;
  if (n > 4096) n = 4096;
  return Math.floor(n + 1e-12);
}

function nodeGraphDsfMorphImpulse(turns, a, start, end, rotTurns, width, symmetry, spacing, oddEven) {
  if (end < start) return 0;
  const w = Math.max(0, Math.min(1, width));
  const s = Math.max(0, Math.min(1, symmetry));
  const oe = Math.max(0, Math.min(1, oddEven));
  let sp = spacing;
  if (!(sp > 1e-9) && !(sp < -1e-9)) sp = 1;
  const kernelR = (r) => {
    let all = 0;
    let odd = 0;
    if (w < 1) {
      all = nodeGraphDsfGeoSeries(r, start, sp, nodeGraphDsfSeriesCount(start, sp, end), turns, rotTurns);
      if (oe > 0) {
        const evenStart = start + sp;
        const nEven = nodeGraphDsfSeriesCount(evenStart, 2 * sp, end);
        if (nEven > 0) {
          all -= oe * r * nodeGraphDsfGeoSeries(r * r, evenStart, 2 * sp, nEven, turns, rotTurns);
        }
      }
    }
    if (w > 0) {
      let oddStart = start;
      if ((oddStart & 1) === 0) oddStart += 1;
      if (oddStart <= end) {
        odd = nodeGraphDsfGeoSeries(r, oddStart, 2, nodeGraphDsfSeriesCount(oddStart, 2, end), turns, rotTurns);
      }
    }
    return all * (1 - w) + odd * w;
  };
  if (s <= 0) return kernelR(a);
  if (s >= 1) return kernelR(-a);
  return kernelR(a) * (1 - s) + kernelR(-a) * s;
}

function nodeGraphDsfSliceStart(slice, n) {
  const a = 1 + Math.max(0, Math.min(1, slice)) * (n - 1);
  return Math.max(1, Math.min(Math.max(1, n), Math.floor(a + 1e-12)));
}

function nodeGraphDsfPartials(sr, f, spacing = 1) {
  let absS = Math.abs(spacing);
  if (!(absS > 1e-9)) absS = 1;
  let nf;
  if (absS > 0.999999 && absS < 1.000001) {
    nf = (sr * 0.5) / f - 1;
  } else {
    nf = ((sr * 0.5) / f - 2) / absS + 1;
  }
  nf = Math.max(1, Math.min(4096, nf));
  const nLo = Math.max(1, Math.floor(nf));
  const nHi = Math.min(4096, nLo + 1);
  const frac = nHi > nLo ? nf - nLo : 0;
  return { nLo, nHi, frac };
}

function nodeGraphDsfCycle(params, count) {
  const amp = Number.isFinite(params.amplitude) ? params.amplitude : 1;
  const out = new Float64Array(count);
  const morphing = params.morphing === true;
  const waveform = Math.max(0, Math.min(4, Math.round(nodeGraphFiniteNumber(params.waveform))));
  if (!morphing && waveform === 0) {
    for (let i = 0; i < count; i += 1) out[i] = Math.max(-1.5, Math.min(1.5, Math.sin(2 * Math.PI * i / count))) * amp;
    return out;
  }
  const sr = nodeGraphDsfSampleRate();
  const f = Math.max(1e-6, Math.abs(nodeGraphFiniteNumber(params.frequency)));
  const { nLo, nHi, frac } = nodeGraphDsfPartials(sr, f, morphing ? nodeGraphFiniteNumber(params.spacing) : 1);
  const m = Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.morph)));
  const k = (1 - (m > 0 ? Math.pow(m, 0.14) : 0)) * 4;
  const k2 = k * k;
  const cLo = nodeGraphDsfMakeCoeffs(nLo, k2);
  const cHi = frac > 0 ? nodeGraphDsfMakeCoeffs(nHi, k2) : cLo;
  const kernel = morphing
    ? (turns) => {
      const a = Math.pow(0.5, k2);
      const rot = nodeGraphDsfWrap01(nodeGraphFiniteNumber(params.rotate));
      const width = nodeGraphFiniteNumber(params.width);
      const symmetry = nodeGraphFiniteNumber(params.symmetry);
      const slice = nodeGraphFiniteNumber(params.slice);
      let spacing = nodeGraphFiniteNumber(params.spacing);
      if (!(spacing > 1e-9) && !(spacing < -1e-9)) spacing = 1;
      const oddEven = Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.oddEven)));
      const harmonic = spacing > 0.999999 && spacing < 1.000001;
      if (!harmonic) {
        const ct = nodeGraphDsfWrap01(turns + rot);
        const mt = nodeGraphDsfWrap01(ct * spacing);
        const spaced = (c) => {
          const m = nodeGraphDsfKernelCS(mt, c);
          const ang = 2 * Math.PI * nodeGraphDsfWrap01(ct - mt);
          let y = Math.cos(ang) * m.C - Math.sin(ang) * m.S;
          if (oddEven > 0) {
            const nEven = Math.max(1, Math.floor(c.n * 0.5));
            const ce = nodeGraphDsfMakeCoeffs(nEven, k2 * 2);
            const me = nodeGraphDsfKernelCS(nodeGraphDsfWrap01(2 * mt), ce);
            y -= oddEven * (Math.cos(ang) * me.C - Math.sin(ang) * me.S) / c.twoK2;
          }
          return y;
        };
        const lo = spaced(cLo);
        if (frac <= 0) return lo;
        return lo + (spaced(cHi) - lo) * frac;
      }
      const startLo = nodeGraphDsfSliceStart(slice, nLo);
      const lo = nodeGraphDsfMorphImpulse(turns, a, startLo, nLo, rot, width, symmetry, 1, oddEven);
      if (frac <= 0) return lo;
      const startHi = nodeGraphDsfSliceStart(slice, nHi);
      return lo + (nodeGraphDsfMorphImpulse(turns, a, startHi, nHi, rot, width, symmetry, 1, oddEven) - lo) * frac;
    }
    : (turns) => {
      const ct = nodeGraphDsfWrap01(turns);
      const lo = nodeGraphDsfKernelCS(ct, cLo).C;
      return frac <= 0 ? lo : lo + (nodeGraphDsfKernelCS(ct, cHi).C - lo) * frac;
    };
  // Original leaky integrator: leak → 0.0005, acc = acc*(1-leak) + raw*dt.
  // Display steps are 1/count of a cycle; map the per-sample leak through
  // audio samples per display step so the shape matches the engine.
  const audioPerCycle = sr / f;
  const audioPerStep = audioPerCycle / count;
  const r = Math.pow(0.9995, audioPerStep);
  const h = 1 / count;
  const ampAdjust = m * (2.7 - 3.15) + 3.15;
  const integrateArr = (rawAt) => {
    const raw = new Float64Array(count);
    for (let i = 0; i < count; i += 1) raw[i] = rawAt(i);
    nodeGraphDsfSubMean(raw);
    const acc = new Float64Array(count);
    let y = 0;
    for (let i = 0; i < count; i += 1) { y = y * r + raw[i] * h; acc[i] = y; }
    const den = 1 - Math.pow(r, count);
    if (den > 1e-12 || den < -1e-12) {
      let carry = y / den;
      for (let i = 0; i < count; i += 1) { carry *= r; acc[i] += carry; }
    }
    return nodeGraphDsfSubMean(acc);
  };
  // Midpoints: t = 0 is the closed form's 0/0 point and would drop the spike.
  const integrate = (raw) => integrateArr((i) => raw((i + 0.5) / count));
  const saw = integrate(kernel);
  const pw = Math.max(0.01, Math.min(0.99, nodeGraphFiniteNumber(params.pulseWidth)));
  let shape = saw;
  if (morphing) {
    shape = saw;
  } else if (waveform === 4) {
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
  const gain = waveform === 3 ? 1 : ampAdjust;
  nodeGraphDsfSubMean(shape);
  for (let i = 0; i < count; i += 1) out[i] = Math.max(-1.5, Math.min(1.5, shape[i] * gain)) * amp;
  return out;
}

function nodeGraphDsfCyclePointCount(node) {
  const sr = nodeGraphDsfSampleRate();
  const f = Math.max(1e-6, Math.abs(nodeGraphFiniteNumber(nodeGraphSinCosLiveParam(node, "frequency", 100))));
  const n = Math.max(1, Math.min(4096, Math.floor((sr * 0.5) / f)));
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
  const isDsf = node.type === "dsfOscillator" || node.type === "dsfMorphingOsc";
  const amplitude = isDsf ? nodeGraphSinCosLiveParam(node, "amplitude", 1) : nodeGraphSinCosLiveParam(node, "amp", 1);
  const dsfParams = isDsf ? {
    morphing: node.type === "dsfMorphingOsc",
    waveform: nodeGraphSinCosLiveParam(node, "waveform", 1),
    frequency: nodeGraphSinCosLiveParam(node, "frequency", 100),
    morph: nodeGraphSinCosLiveParam(node, "morph", 1),
    pulseWidth: nodeGraphSinCosLiveParam(node, "pulseWidth", 0.5),
    blend: nodeGraphSinCosLiveParam(node, "blend", 0.5),
    symmetry: nodeGraphSinCosLiveParam(node, "symmetry", 0),
    width: nodeGraphSinCosLiveParam(node, "width", 0),
    rotate: nodeGraphSinCosLiveParam(node, "rotate", 0),
    slice: nodeGraphSinCosLiveParam(node, "slice", 0),
    spacing: nodeGraphSinCosLiveParam(node, "spacing", 1),
    oddEven: nodeGraphSinCosLiveParam(node, "oddEven", 0),
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
    String(Number(look.padExtra) || 0),
    String(Number(look.lineSmoothing) || 1),
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

  const showDot = isDsf || drawSin || drawCos;
  const pad = nodeGraphSinCosFacePadPx(look, pixelRatio, { showDot });
  const innerW = Math.max(4, drawW - pad * 2);
  const innerH = Math.max(4, drawH - pad * 2);
  const midY = pad + innerH * 0.5;
  const halfH = innerH * 0.5;
  const mapX = (phase) => pad + phase * innerW;
  // DSF engine clamps to ±1.5; map that to the inner rect so peaks sit on the
  // padded edge. SinCos stays ±1 (unipolar 0..1).
  const yFull = isDsf ? 1.5 : 1;
  const mapY = polarity
    ? (value) => pad + innerH - value * innerH
    : (value) => midY - (value / yFull) * halfH;
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
    lines.push({ points, color, width: strokeW, blur: 0, feather: nodeGraphLineSmoothingPx(look, 1) });
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
    // Same idea as 1D Onset: one vertex every half CSS pixel, then the shared
    // GL ribbon (gl-line-renderer). Dumping 2k–8k Gibbs samples into a ~200px
    // face made a scribbled capsule. Do not touch the onset drawer.
    const nDraw = Math.max(32, Math.min(count, Math.ceil(innerW) * 2));
    const shiftF = phaseOff * count;
    const points = [];
    for (let i = 0; i <= nDraw; i += 1) {
      const t = i / nDraw;
      let src = t * count + shiftF;
      src -= Math.floor(src / count) * count;
      const i0 = Math.floor(src);
      const f = src - i0;
      const v0 = dsfCycle[i0];
      const v1 = dsfCycle[(i0 + 1) % count];
      points.push({ x: mapX(t), y: mapY(v0 + (v1 - v0) * f) });
    }
    lines.push({
      points,
      color: look.strokePaint,
      width: strokeW,
      blur: 0,
      half: Math.max(0, strokeW * 0.5 - 0.5),
      feather: nodeGraphLineSmoothingPx(look, 1),
    });
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
    smoothing: nodeGraphLineSmoothingPx(look, 1),
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