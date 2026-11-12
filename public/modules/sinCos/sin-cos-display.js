// SinCos face — cheap 1D one-cycle sine (red) and cosine (blue).
// WebGL clinical line + white phase dots (nodeGraphGlLinesPresentFrame: Adapt Max + exact 4x4 Expo).
// Frame-rate paint, no engine-rate ring.
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
  // Phase playhead dot size; 0 = no dot (the default, as the old Show dot off).
  dotThickness: 0,
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
  // Show dot is gone: Dot size 0 = no dot. Saves from before keep their look
  // (Show dot off, or legacy phaseDot 0, load as size 0).
  const legacyOff = Object.prototype.hasOwnProperty.call(source, "showDot")
    ? !source.showDot
    : (Object.prototype.hasOwnProperty.call(source, "phaseDot") ? Number(source.phaseDot) < 1 : false);
  if (legacyOff) look.dotThickness = 0;
  delete look.showDot;
  return look;
}

/** CSS px inset so stroke + phase-dot + Expo skirt stay inside the plate. */
function nodeGraphSinCosFacePadPx(look, pixelRatio, options = {}) {
  const strokeW = Math.max(0, Number(look?.lineThickness) || 0);
  const dotW = Math.max(0, Number(look?.dotThickness) || 0);
  const blur = Math.max(0, Number(look?.lineBlur) || 0);
  const extra = Math.max(0, Number(look?.padExtra) || 0);
  const feather = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look?.lineSmoothing) || 1);
  const lineHalf = strokeW * 0.5;
  const dotR = options.showDot === false || !(dotW > 0) ? 0 : Math.max(0.5, dotW * 0.5);
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
  // Full punch: LCD-only partial cutout is ApplyLcdLightCutout / 2/3.
  section.dataset.lightStrength = "1";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-sincos-canvas");
  canvas.dataset.lightSource = "screen";
  canvas.dataset.lightStrength = "1";
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

// DSF faces use a settled cycle from the native oscillator. The rate must
// match the engine so partial limits and integrator leakage match the sound.
function nodeGraphDsfSampleRate() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  const sr = Number(live?.context?.sampleRate ?? live?.audioContext?.sampleRate);
  if (Number.isFinite(sr) && sr > 1) return sr;
  const target = Number(typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.patch?.audio?.targetSampleRate : NaN);
  return Number.isFinite(target) && target > 1 ? target : 48000;
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


/** Display kernel = dsf_oscillator.cpp dsfGeoSumUnitCS, closed form only:
 *  Σ_{k=0}^{n-1} a^k e^{i(k+1)x} = e^{ix} (1 - (a e^{ix})^n) / (1 - a e^{ix}),
 *  stable |1 - a e^{ix}|^2 = (1-a)^2 + 4a sin^2(x/2), Dirichlet at a≈1.
 *  O(1) per sample at any partial count: no per-harmonic sum. */
function nodeGraphDsfKernelCSDisplay(turns, c) {
  let n = c.n;
  if (!(n > 0)) return { C: 0, S: 0 };
  if (n > 1048576) n = 1048576;
  const a = c.twoK2 > 0 ? 1 / c.twoK2 : 1;
  const x = 2 * Math.PI * nodeGraphDsfWrap01(turns);
  const cosx = Math.cos(x);
  const sinx = Math.sin(x);
  const sinHalf = Math.sin(0.5 * x);
  const den2 = (1 - a) * (1 - a) + 4 * a * sinHalf * sinHalf;
  if (den2 < 1e-30) return { C: n, S: 0 };
  if (a > 1 - 1e-12) {
    if (sinHalf > -1e-15 && sinHalf < 1e-15) return { C: n, S: 0 };
    const scale = Math.sin(0.5 * n * x) / sinHalf;
    const ah = 0.5 * (n + 1) * x;
    return { C: scale * Math.cos(ah), S: scale * Math.sin(ah) };
  }
  const zr = a * cosx;
  const zi = a * sinx;
  const rn = Math.pow(a, n);
  const numr = 1 - rn * Math.cos(n * x);
  const numi = -rn * Math.sin(n * x);
  const denr = 1 - zr;
  const deni = -zi;
  const qr = (numr * denr + numi * deni) / den2;
  const qi = (numi * denr - numr * deni) / den2;
  return { C: cosx * qr - sinx * qi, S: cosx * qi + sinx * qr };
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

// = dsf_oscillator.cpp geoSeriesCS: Σ_{k<count} r^k cos(2π((start + k·step) turns + rot)),
// closed form only (stable den, Dirichlet at r≈1). No per-partial loop.
function nodeGraphDsfGeoSeries(r, start, step, count, turns, rotTurns) {
  if (count < 1) return 0;
  const a0 = 2 * Math.PI * nodeGraphDsfWrap01(turns * start + rotTurns);
  const cosA = Math.cos(a0);
  const sinA = Math.sin(a0);
  if (count === 1) return cosA;
  const phi = 2 * Math.PI * nodeGraphDsfWrap01(turns * step);
  const sinHalf = Math.sin(2 * Math.PI * nodeGraphDsfWrap01(0.5 * turns * step));
  let den2 = (1 - r) * (1 - r) + 4 * r * sinHalf * sinHalf;
  if (den2 < 0) den2 = 0;
  if (den2 < 1e-30) return count * cosA;
  if (r > 1 - 1e-12 && r < 1 + 1e-12) {
    if (sinHalf > -1e-15 && sinHalf < 1e-15) return count * cosA;
    const sn = Math.sin(2 * Math.PI * nodeGraphDsfWrap01(0.5 * count * turns * step));
    const ah = 2 * Math.PI * nodeGraphDsfWrap01(0.5 * (count - 1) * turns * step);
    const scale = sn / sinHalf;
    return scale * (cosA * Math.cos(ah) - sinA * Math.sin(ah));
  }
  const denr = 1 - r * Math.cos(phi);
  const deni = -r * Math.sin(phi);
  let rm = Math.pow(Math.abs(r), count);
  if (r < 0 && (count & 1)) rm = -rm;
  const am = 2 * Math.PI * nodeGraphDsfWrap01(turns * step * count);
  const numr = 1 - rm * Math.cos(am);
  const numi = -rm * Math.sin(am);
  const qr = (numr * denr + numi * deni) / den2;
  const qi = (numi * denr - numr * deni) / den2;
  return cosA * qr - sinA * qi;
}

function nodeGraphDsfSeriesCount(start, step, end) {
  const absStep = Math.abs(step);
  if (!(absStep > 1e-12)) return 0;
  let n = (end - start) / absStep + 1;
  if (n < 1) return 0;
  // Engine kMaxSeriesLoop is only for rare recovery; audible N uses kMaxPartials.
  const cap = typeof NODE_GRAPH_DSF_MAX_PARTIALS === "number" ? NODE_GRAPH_DSF_MAX_PARTIALS : 1048576;
  if (n > cap) n = cap;
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

function nodeGraphDsfPartials(sr, f, spacing = 1, partialsCap = 1048576) {
  // Same formula as native sawPartials / spaced N (kMaxPartials = 1048576),
  // then the Partials cap (native preparePartials: clamp 1..kMaxPartials).
  const nfRaw = typeof nodeGraphDsfPartialsNf === "function"
    ? nodeGraphDsfPartialsNf(sr, f, spacing)
    : (() => {
      const freq = Math.max(1e-9, Math.abs(Number(f) || 0));
      const nyquist = Math.max(1, Number(sr) || 48000) * 0.5;
      let absS = Math.abs(Number(spacing));
      if (!(absS > 1e-9)) absS = 1;
      let n = absS > 0.999999 && absS < 1.000001
        ? nyquist / freq - 1
        : (nyquist / freq - 2) / absS + 1;
      if (!(n > 1)) n = 1;
      if (n > 1048576) n = 1048576;
      return n;
    })();
  let cap = Number(partialsCap);
  if (!(cap >= 1)) cap = 1;
  if (cap > 1048576) cap = 1048576;
  const nf = nfRaw > cap ? cap : nfRaw;
  const nLo = Math.max(1, Math.floor(nf));
  const nHi = nLo < 1048576 ? nLo + 1 : nLo;
  const frac = nHi > nLo ? nf - nLo : 0;
  return { nLo, nHi, frac, nf };
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
  // The engine's leaky integrator (dsf v23): leak = max(0.0005, 2*pi*f / (20*sr))
  // per audio sample, acc = acc*(1-leak) + raw*dt. Display steps are 1/count of
  // a cycle; map the per-sample leak through audio samples per display step so
  // the shape matches the engine.
  const audioPerCycle = sr / f;
  const audioPerStep = audioPerCycle / count;
  const leak = Math.max(0.0005, (2 * Math.PI * f) / (20 * sr));
  const r = Math.pow(1 - leak, audioPerStep);
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
      // Trimorph (dsf v23): the saw integrated over the Morph window =
      // P(t) - P(t - Morph), P = the saw's integral; level 1.3 / (Morph*(1-Morph)).
      const P = integrateArr((i) => saw[i]);
      const back = pw * count;
      const tri = new Float64Array(count);
      const scale = (ampAdjust * 1.3) / (pw * (1 - pw));
      for (let i = 0; i < count; i += 1) {
        let src = i - back;
        src -= Math.floor(src / count) * count;
        const i0 = Math.floor(src);
        const fr = src - i0;
        const lagged = P[i0] + (P[(i0 + 1) % count] - P[i0]) * fr;
        tri[i] = (P[i] - lagged) * scale;
      }
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

/** One settled, phase-aligned cycle of native DSF output at unit level. */
function nodeGraphDsfDisplayCycle(params, count) {
  return typeof nodeGraphDsfOscillatorPreviewCycle === "function"
    ? nodeGraphDsfOscillatorPreviewCycle(params, count)
    : null;
}


function drawNodeGraphSinCosDisplayInner(section) {
  const nodeId = section?.dataset?.node
    || section?.closest?.(".dsp-node")?.dataset?.node
    || "";
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const canvas = section?.querySelector?.(".node-sincos-canvas")
    || section?.querySelector?.(".node-display-face");
  if (!node || !canvas) {
    return;
  }
  const isDsf = node.type === "dsfOscillator" || node.type === "dsfMorphingOsc";
  const amplitude = isDsf ? nodeGraphSinCosLiveParam(node, "amplitude", 1) : nodeGraphSinCosLiveParam(node, "amp", 1);
  const dsfParams = isDsf ? {
    morphing: node.type === "dsfMorphingOsc",
    waveform: nodeGraphSinCosLiveParam(node, "waveform", 1),
    frequency: nodeGraphSinCosLiveParam(node, "frequency", 100),
    // DSF Oscillator: Bright = tilt, Morph = Trimorph peak / PWM. DSF Morphing Osc: Morph = tilt.
    morph: node.type === "dsfOscillator"
      ? nodeGraphSinCosLiveParam(node, "bright", 1)
      : nodeGraphSinCosLiveParam(node, "morph", 1),
    pulseWidth: node.type === "dsfOscillator" ? nodeGraphSinCosLiveParam(node, "morph", 0.5) : 0.5,
    blend: nodeGraphSinCosLiveParam(node, "blend", 0.5),
    partials: node.type === "dsfOscillator" ? nodeGraphSinCosLiveParam(node, "partials", 20000) : 1048576,
    symmetry: nodeGraphSinCosLiveParam(node, "symmetry", 0),
    width: nodeGraphSinCosLiveParam(node, "width", 0),
    rotate: nodeGraphSinCosLiveParam(node, "rotate", 0),
    slice: nodeGraphSinCosLiveParam(node, "slice", 0),
    spacing: nodeGraphSinCosLiveParam(node, "spacing", 1),
    oddEven: nodeGraphSinCosLiveParam(node, "oddEven", 0),
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
    isDsf ? "unit-level-face" : String(Number(amplitude).toFixed(4)),
    polarity ? "uni" : "bi",
    String((phaseParam - Math.floor(phaseParam)).toFixed(4)),
    `${Math.round(rawW)}x${Math.round(rawH)}`,
    look.strokePaint, look.dotPaint, look.backgroundPaint, strokeW, dotW,
    String(Number(look.padExtra) || 0),
    String(nodeGraphLineSmoothingPx(look, 1)),
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
  const strokeInset = strokeW * 0.5 + 1;
  // DSF matches BLIT: ~6%/12% margins so the whole cycle + Gibbs fit with room.
  const padX = isDsf
    ? Math.max(6, drawW * 0.06) + strokeInset
    : nodeGraphSinCosFacePadPx(look, pixelRatio, { showDot });
  const padY = isDsf
    ? Math.max(6, drawH * 0.12) + strokeInset
    : padX;
  const innerW = Math.max(4, drawW - padX * 2);
  const innerH = Math.max(4, drawH - padY * 2);
  const midY = padY + innerH * 0.5;
  const halfH = innerH * 0.5;
  const mapX = (phase) => padX + phase * innerW;
  // DSF uses native unit-level samples; amplitude does not change the face.
  const yFull = 1;
  const mapY = polarity
    ? (value) => padY + innerH - value * innerH
    : (value) => midY - (value / yFull) * halfH;
  const samples = Math.max(32, Math.min(256, Math.ceil(innerW)));
  const wrap01 = (p) => {
    const n = nodeGraphFiniteNumber(p);
    return n - Math.floor(n);
  };
  const phaseOff = wrap01(phaseParam);
  const sampleKind = (cycle01, kind) => nodeGraphSinCosSample(wrap01(cycle01 + phaseOff), kind, amplitude, polarity);
  // Clinical Expo: math closed-form cycle → per-pixel min/max envelopes.
  // Display Settings > Line blur (lineSmoothing, CSS px skirt) drives the drawer blur.
  const blur = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look.lineSmoothing) || 1);
  const polylines = [];
  const pushPoly = (kind, color) => {
    const raw = new Float32Array((samples + 1) * 2);
    for (let i = 0; i <= samples; i += 1) {
      const phase = i / samples;
      raw[i * 2] = mapX(phase);
      raw[i * 2 + 1] = mapY(sampleKind(phase, kind));
    }
    const pts = typeof nodeGraphGlLinesAdaptPoints === "function"
      ? nodeGraphGlLinesAdaptPoints(raw, Math.max(64, Math.ceil(innerW * 4)))
      : raw;
    polylines.push({ points: pts, color, width: strokeW });
  };
  if (drawSin) pushPoly("sin", look.strokePaint);
  if (drawCos) pushPoly("cos", nodeGraphSinCosCosPaint(look));
  let dsfSamples = null;
  if (isDsf && dsfParams) {
    nodeGraphDsfOscillatorLoadWasm();
    if (!nodeGraphDsfOscillatorWasm.exports
      && !nodeGraphDsfOscillatorWasm.failed
      && !section._dsfFaceAwaitingWasm) {
      section._dsfFaceAwaitingWasm = true;
      nodeGraphDsfOscillatorWasm.promise?.then(() => {
        section._dsfFaceAwaitingWasm = false;
        if (!section.isConnected || nodeGraphDsfOscillatorWasm.failed) return;
        section._sinCosForceDraw = true;
        drawNodeGraphSinCosDisplay(section);
      });
    }
    const sr = nodeGraphDsfSampleRate();
    const f = Math.max(1e-6, Math.abs(nodeGraphFiniteNumber(dsfParams.frequency)));
    const spacing = dsfParams.morphing ? nodeGraphFiniteNumber(dsfParams.spacing, 1) : 1;
    const { nf } = nodeGraphDsfPartials(sr, f, spacing, dsfParams.partials);
    const N = Math.max(1, Math.floor(nf));
    const count = typeof nodeGraphMathCycleSampleCount === "function"
      ? nodeGraphMathCycleSampleCount(innerW, N)
      : Math.max(64, Math.min(120000, Math.ceil(Math.max(innerW * 8, Math.min(N, innerW) * 24))));
    // Below audio rate the cycle depends on the pitch only through the partial
    // count, so a modulated slow pitch reuses the cached cycle.
    const pitchKey = typeof nodeGraphDsfPreviewPitchKey === "function"
      ? nodeGraphDsfPreviewPitchKey(dsfParams, sr)
      : String(dsfParams.frequency);
    const cycleKey = `${JSON.stringify({ ...dsfParams, frequency: pitchKey })}@${sr}|${count}`;
    if (section._dsfFaceCycleKey !== cycleKey || !section._dsfFaceCycle) {
      section._dsfFaceCycle = nodeGraphDsfDisplayCycle(dsfParams, count);
      section._dsfFaceCycleKey = section._dsfFaceCycle ? cycleKey : "";
    }
    dsfSamples = section._dsfFaceCycle;
    // Phase: the output at oscillator phase x is the cycle at x + Phase, so
    // the drawn cycle starts Phase into it (no re-render, just a rotation).
    if (dsfSamples?.length && phaseOff > 0) {
      const n = dsfSamples.length;
      const rotated = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        const src = wrap01(i / n + phaseOff) * n;
        const i0 = Math.floor(src) % n;
        const fr = src - Math.floor(src);
        rotated[i] = dsfSamples[i0] + (dsfSamples[(i0 + 1) % n] - dsfSamples[i0]) * fr;
      }
      dsfSamples = rotated;
    }
    if (dsfSamples?.length && typeof nodeGraphMathCycleClinicalGeom === "function") {
      const geom = nodeGraphMathCycleClinicalGeom(
        dsfSamples, mapX, mapY, Math.max(1, Math.floor(innerW)), strokeW, look.strokePaint,
      );
      polylines.push(...geom.polylines);
    }
  }

  // Dot size 0 = no phase dot.
  const showPhaseDot = dotW > 0;
  let play = nodeGraphSinCosReadPhase(nodeId, node, section);
  if (!Number.isFinite(play)) {
    play = phaseOff;
  }
  play = wrap01(play);
  const playX = wrap01(play - phaseOff);
  const px = mapX(playX);
  const dotR = Math.max(0.5, dotW * 0.5);
  const dots = [];
  if (showPhaseDot) {
    const pushDot = (kind) => {
      const py = mapY(nodeGraphSinCosSample(play, kind, amplitude, polarity));
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      dots.push({ x: px, y: py, color: look.dotPaint, radius: dotR });
    };
    if (drawSin) pushDot("sin");
    if (drawCos) pushDot("cos");
    if (isDsf && dsfSamples?.length) {
      const n = dsfSamples.length;
      const idx = Math.min(n - 1, Math.max(0, Math.round(playX * (n - 1))));
      const py = mapY(dsfSamples[idx]);
      if (Number.isFinite(px) && Number.isFinite(py)) {
        dots.push({ x: px, y: py, color: look.dotPaint, radius: dotR });
      }
    }
  }

  if (typeof nodeGraphGlLinesPresentFrame !== "function") {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "line renderer missing");
    }
    return;
  }
  nodeGraphGlLinesPresentFrame(canvas, {
    cssWidth: drawW,
    cssHeight: drawH,
    background: look.backgroundPaint,
    waveKey: signature,
    blur,
    polylines,
    dots,
  });
}


if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.sinCosFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("sinCosFace", createNodeGraphSinCosDisplay);
}
