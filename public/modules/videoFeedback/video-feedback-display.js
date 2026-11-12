// Spectrum Circle: FFT of audio In, drawn as a mirrored ring of rays that start
// at the centre (video-feedback-gl.js). Display Settings own the analyzer
// (FFT size, window, freq axis and range, dB floor, bands) and the gradient;
// Decay / Size / Inner / Twist / Bright / Smooth are face params, read through
// their parameter definitions (no limits here).

function nodeGraphVideoFeedbackPortLabel(_node, port) {
  const key = String(port || "");
  if (key === "rgba" || key === "\u{1F4FA}") return "\u{1F4FA}";
  if (key === "A") return "In";
  if (key === "B") return "Spin";
  return key;
}

const NODE_GRAPH_VIDEO_FEEDBACK_DEFAULTS = Object.freeze({
  fftSize: 2048,
  window: 1,
  spectrumAxis: "log",
  minFreq: 30,
  maxFreq: 16000,
  spectrumDbFloor: -72,
  spectrumCircleBands: 64,
  spectrumCircleRayWidth: 0.6,
  spectrumCircleColorBy: "level",
});

// Choice values come from the shared Display Settings choice table (one list).
function nodeGraphVideoFeedbackChoice(key, raw, fallback) {
  const options = typeof nodeGraphDisplaySettingsChoiceMeta === "object"
    ? nodeGraphDisplaySettingsChoiceMeta?.[key]?.options
    : null;
  const want = String(raw ?? "");
  return Array.isArray(options) && options.some((option) => option.value === want) ? want : String(fallback);
}

function normalizeNodeGraphVideoFeedbackSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = NODE_GRAPH_VIDEO_FEEDBACK_DEFAULTS;
  let minFreq = Number(source.minFreq);
  let maxFreq = Number(source.maxFreq);
  if (!(Number.isFinite(minFreq) && minFreq >= 1)) minFreq = d.minFreq;
  if (!Number.isFinite(maxFreq)) maxFreq = d.maxFreq;
  if (!(maxFreq > minFreq)) maxFreq = minFreq * 2;
  // Patches from before the gradient kept one ink color: black to that ink.
  const legacyInk = source.gradientStops == null
    ? (source.dot1Color || source.spectrumColor || source.color)
    : null;
  const gradientStops = normalizeNodeGraphSpectrogramGradientStops(
    legacyInk ? [{ t: 0, color: "#000000" }, { t: 1, color: legacyInk }] : source.gradientStops,
  );
  const hue = Number(source.backgroundHue);
  return {
    fftSize: source.fftSize == null ? d.fftSize : nodeGraphSpectrogramSnapFftSize(source.fftSize),
    window: Number(nodeGraphVideoFeedbackChoice("window", source.window, d.window)),
    spectrumAxis: nodeGraphVideoFeedbackChoice("spectrumAxis", source.spectrumAxis, d.spectrumAxis),
    minFreq,
    maxFreq,
    spectrumDbFloor: Number(nodeGraphVideoFeedbackChoice("spectrumDbFloor", source.spectrumDbFloor, d.spectrumDbFloor)),
    spectrumCircleBands: Number(nodeGraphVideoFeedbackChoice("spectrumCircleBands", source.spectrumCircleBands, d.spectrumCircleBands)),
    spectrumCircleRayWidth: Number(nodeGraphVideoFeedbackChoice("spectrumCircleRayWidth", source.spectrumCircleRayWidth, d.spectrumCircleRayWidth)),
    spectrumCircleColorBy: nodeGraphVideoFeedbackChoice("spectrumCircleColorBy", source.spectrumCircleColorBy, d.spectrumCircleColorBy),
    gradientStops,
    backgroundHue: Number.isFinite(hue) ? hue : 0,
  };
}

// Normalized once per stored settings object (apply replaces the object).
const nodeGraphVideoFeedbackSettingsCache = new WeakMap();
let nodeGraphVideoFeedbackDefaultSettings = null;

function nodeGraphVideoFeedbackSettingsForNode(node) {
  const stored = node?.traceDisplaySettings;
  if (!stored || typeof stored !== "object") {
    nodeGraphVideoFeedbackDefaultSettings ||= normalizeNodeGraphVideoFeedbackSettings();
    return nodeGraphVideoFeedbackDefaultSettings;
  }
  let hit = nodeGraphVideoFeedbackSettingsCache.get(stored);
  if (!hit) {
    hit = normalizeNodeGraphVideoFeedbackSettings(stored);
    nodeGraphVideoFeedbackSettingsCache.set(stored, hit);
  }
  return hit;
}

// Gradient LUT (hue rotation applied) per normalized settings object.
const nodeGraphVideoFeedbackLutCache = new WeakMap();

function nodeGraphVideoFeedbackLutRgb(settings) {
  let lut = nodeGraphVideoFeedbackLutCache.get(settings);
  if (!lut) {
    lut = spectrogramLutRgbForStops(nodeGraphApplyGradientHueRotation(settings.gradientStops, settings));
    nodeGraphVideoFeedbackLutCache.set(settings, lut);
  }
  return lut;
}

function buildNodeGraphVideoFeedbackDisplaySettingsBodyHtml() {
  const type = "videoFeedbackFace";
  return `
    <div class="metadata-field-section" data-video-feedback-display-settings-panel>
      <div class="metadata-section-title">SPECTRUM</div>
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("fftSize")}
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("window")}
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("spectrumAxis")}
      ${nodeGraphDisplaySettingsBuildStepperRowHtml("minFreq", type)}
      ${nodeGraphDisplaySettingsBuildStepperRowHtml("maxFreq", type)}
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("spectrumDbFloor")}
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("spectrumCircleBands")}
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("spectrumCircleRayWidth")}
      ${nodeGraphDisplaySettingsBuildSwitchRowHtml("spectrumCircleColorBy")}
    </div>
    <div class="metadata-field-section node-trace-display-gradient-section">
      <div
        id="nodeTraceDisplayGradientSelectorHost"
        class="node-gradient-selector-host node-shared-gradient-host node-spectrogram-gradient-host"
        data-gradient-selector-host
        data-shared-gradient-host
        data-spectrogram-gradient-host></div>
    </div>
  `;
}

function nodeGraphVideoFeedbackWindow(n, kind) {
  const w = new Float64Array(n);
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < n; i += 1) {
    const x = (2 * Math.PI * i) / denom;
    if (kind === 0) w[i] = 1;
    else if (kind === 1) w[i] = 0.5 * (1 - Math.cos(x));
    else if (kind === 2) w[i] = 0.54 - 0.46 * Math.cos(x);
    else if (kind === 3) w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    else w[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
  }
  return w;
}

// Slot u (0..1 around the half circle, bass first) -> Hz on the chosen axis.
function nodeGraphVideoFeedbackSlotHz(u, settings, sampleRate) {
  const axis = settings.spectrumAxis;
  if (axis === "log") {
    const band = spectrogramResolveViewBand(settings.minFreq, settings.maxFreq, sampleRate);
    return band.minFreq * Math.pow(band.maxFreq / band.minFreq, u);
  }
  const scaleIdx = axis === "mel" ? 1 : (axis === "bark" ? 2 : 0);
  return spectrogramRowTToHz(1 - u, scaleIdx, sampleRate, settings.minFreq, settings.maxFreq);
}

function nodeGraphVideoFeedbackSpectrumState(canvas, n, windowKind) {
  let st = canvas._videoFeedbackSpectrum;
  if (st && st.n === n && st.windowKind === windowKind) return st;
  const win = nodeGraphVideoFeedbackWindow(n, windowKind);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += win[i];
  st = {
    n,
    windowKind,
    win,
    // Full-scale sine peak = 0 dBFS.
    gain: Math.max(1e-9, sum / 2),
    real: new Float64Array(n),
    imag: new Float64Array(n),
    mag: new Float32Array(n / 2),
    smooth: new Float32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
    layoutKey: "",
    lo: new Int32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
    hi: new Int32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
    center: new Float32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
  };
  canvas._videoFeedbackSpectrum = st;
  return st;
}

/** One level 0..1 per slot (band, or texel when Continuous), smoothed over time. */
function nodeGraphVideoFeedbackSpectrumLevels(canvas, ring, settings, smooth) {
  const n = settings.fftSize;
  const st = nodeGraphVideoFeedbackSpectrumState(canvas, n, settings.window);
  const bins = n / 2;
  const count = settings.spectrumCircleBands > 0 ? settings.spectrumCircleBands : NODE_GRAPH_VIDEO_FEEDBACK_WAVE;
  const sampleRate = ring ? nodeGraphScopeSampleRate(ring) : nodeGraphMvp?.sampleRate || 44100;
  const layoutKey = `${count}|${settings.spectrumAxis}|${settings.minFreq}|${settings.maxFreq}|${sampleRate}`;
  if (st.layoutKey !== layoutKey) {
    const binHz = sampleRate / n;
    for (let j = 0; j < count; j += 1) {
      const f0 = nodeGraphVideoFeedbackSlotHz(j / count, settings, sampleRate) / binHz;
      const f1 = nodeGraphVideoFeedbackSlotHz((j + 1) / count, settings, sampleRate) / binHz;
      st.center[j] = Math.min(bins - 1, nodeGraphVideoFeedbackSlotHz((j + 0.5) / count, settings, sampleRate) / binHz);
      st.lo[j] = Math.max(0, Math.min(bins - 1, Math.ceil(f0)));
      st.hi[j] = Math.max(0, Math.min(bins - 1, Math.floor(f1)));
    }
    st.layoutKey = layoutKey;
  }
  st.real.fill(0);
  st.imag.fill(0);
  const available = nodeGraphVideoGraphAudioCount(ring);
  const take = Math.min(available, n);
  const src0 = available - take;
  const dst0 = n - take;
  for (let i = 0; i < take; i += 1) {
    st.real[dst0 + i] = (Number(ring[src0 + i]) || 0) * st.win[dst0 + i];
  }
  nodeGraphSpectrumFftInPlace(st.real, st.imag);
  for (let k = 0; k < bins; k += 1) {
    st.mag[k] = Math.hypot(st.real[k], st.imag[k]) / st.gain;
  }
  const floor = settings.spectrumDbFloor;
  const attack = 1 - 0.97 * smooth;
  for (let j = 0; j < count; j += 1) {
    let mag;
    if (st.hi[j] > st.lo[j]) {
      // Wide slot: peak of its bins, so a pure tone keeps its full height.
      mag = 0;
      for (let k = st.lo[j]; k <= st.hi[j]; k += 1) mag = Math.max(mag, st.mag[k]);
    } else {
      const c = st.center[j];
      const k0 = Math.floor(c);
      const k1 = Math.min(bins - 1, k0 + 1);
      mag = st.mag[k0] + (st.mag[k1] - st.mag[k0]) * (c - k0);
    }
    const db = 20 * Math.log10(mag + 1e-12);
    const v = Math.max(0, Math.min(1, (db - floor) / -floor));
    st.smooth[j] += (v - st.smooth[j]) * attack;
  }
  return { values: st.smooth, count };
}

function nodeGraphVideoFeedbackEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-video-feedback-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-video-feedback-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.appendChild(canvas);
  }
  // Shared sizing (layout css x dpr, never zoom); backing stays >= 8 px.
  if (typeof nodeGraphDisplayCanvasSize === "function") {
    const m = nodeGraphDisplayCanvasSize(face, canvas);
    if (m && (m.width < 8 || m.height < 8) && typeof nodeGraphDisplayCanvasSizeCss === "function") {
      nodeGraphDisplayCanvasSizeCss(canvas, Math.max(8, m.width) / m.pixelRatio, Math.max(8, m.height) / m.pixelRatio, 1);
    }
  }
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "5";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  return canvas;
}

function nodeGraphVideoFeedbackCircuitLive() {
  try {
    if (typeof nodeGraphModuleScopeEnginePaused === "function" && nodeGraphModuleScopeEnginePaused()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  try {
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  try {
    if (typeof nodeGraphModuleScopePhosphorFrozen === "function" && nodeGraphModuleScopePhosphorFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  return true;
}

function drawNodeGraphVideoFeedbackFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  // The face pump owns the clock: one FFT + one plate step per video frame.
  if (face._videoFeedbackOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) {
    return;
  }
  const canvas = nodeGraphVideoFeedbackEnsureCanvas(face);
  if (!canvas) return;
  // Present surface for the shared-GL blit (display-canvas.js); no 2D drawing here.
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function" ? nodeGraphSharedGlPresentTarget(canvas) : null;
  if (!ctx) return;
  if (typeof nodeGraphVideoFeedbackGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const host = canvas;
  const renderer = nodeGraphVideoFeedbackGlEnsure(host, canvas.width, canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const nodeId = slot.nodeId;
  if (nodeGraphVideoFeedbackCircuitLive()) {
    const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
      ? nodeGraphModuleScopeNodeForSlot(slot)
      : nodeGraphPatchNode(nodeId);
    const settings = nodeGraphVideoFeedbackSettingsForNode(node);
    const smooth = nodeGraphReadNodeNumber(nodeId, "smooth");
    // VG-6: block mode for the spectrum (A), control mode for spin (B).
    const levels = nodeGraphVideoFeedbackSpectrumLevels(canvas, nodeGraphVideoGraphAudioBlock(nodeId, "A"), settings, smooth);
    nodeGraphVideoFeedbackGlStep(host, {
      nodeId,
      decay: nodeGraphReadNodeNumber(nodeId, "decay"),
      size: nodeGraphReadNodeNumber(nodeId, "size"),
      inner: nodeGraphReadNodeNumber(nodeId, "zoom"),
      twist: nodeGraphReadNodeNumber(nodeId, "twist"),
      spin: nodeGraphVideoGraphAudioLatest(nodeId, "B"),
      bright: nodeGraphReadNodeNumber(nodeId, "bright"),
      smooth,
      levels: levels.values,
      count: levels.count,
      bands: settings.spectrumCircleBands,
      rayWidth: settings.spectrumCircleRayWidth,
      colorByRadius: settings.spectrumCircleColorBy === "radius",
      lutRgb: nodeGraphVideoFeedbackLutRgb(settings),
    });
  }
  nodeGraphVideoFeedbackGlPresent(host, ctx, canvas.width, canvas.height);
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphVideoFeedbackScreensToColdBoot(canvas) {
  const host = canvas || null;
  if (host && typeof nodeGraphVideoFeedbackGlWipe === "function") {
    nodeGraphVideoFeedbackGlWipe(host);
  }
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") {
    nodeGraphGlLinesFillBlack(canvas);
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.videoFeedbackFace = drawNodeGraphVideoFeedbackFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("videoFeedbackFace", (canvas) => {
    wipeNodeGraphVideoFeedbackScreensToColdBoot(canvas);
  });
}