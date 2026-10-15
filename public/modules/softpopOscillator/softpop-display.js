// Softpop Oscillator module face. Own drawer, structured after the Sabrina
// Reverb line drawer (public/modules/reverbEffect/sabrina-reverb-gl.js):
// vertical full-height lines at an x position, line width scaled from the
// face width, additive light on a dark plate. Kept separate so it can grow
// into a custom Softpop look without touching Sabrina.
//
// Data (no JS audio DSP): the native module bins the L channel's
// instantaneous frequency of every audio sample into a log 20 Hz..20 kHz
// histogram (soemdsp_softpop_oscillator_display_*). The worklet relays it
// on the data bus as SoftpopBins (counts) and SoftpopInfo
// [model, fEff, Q, sampleRate, pitchCents, loHz, hiHz, sampleCount].
//
// Drawing: WebGL via the shared line renderer (public/lib/visual/gl-line-renderer.js,
// shared picture device, shader-expanded line quads), blitted into this face's
// 2D canvas (shared sizing: css x dpr, pixelated above 2.5x zoom). WebGL2 only:
// if GL can't run the face is a plain black square.
//
// Colour: same path as the trace drawers (TraceWoscope present shader):
// brightness 0..1 -> max(brightness, Background brightness) -> shared
// gradient LUT (gradientStops, nodeGraphPhosphorGradientStopsFromSettings +
// nodeGraphSampleGradientStopsRgb). Gradient is edited with the shared
// Display Settings gradient selector (profile "softpopFace", defaultStops "bone").
//
// Sine model: glow[x] += X * a per audio sample landing at x (X from Brightness,
// the max; a = native |Amplitude * Amp Mod gain| clamped to 0..1, so quieter
// output prints dimmer lines),
// glow decays by half every Decay seconds of audio, so Pitch Mod draws a soft
// glowing line around the note. Every printed line is full face height.
// Filter model: the bandpass response at the
// centre frequency with the current Q (Width), on the same pitch axis.

const nodeGraphSoftpopFaceSettingsDefaults = Object.freeze({
  backgroundBrightness: 0.03,
  brightness: 0.4,
  decaySeconds: 0.15,
  lineBrightness: 1,
  lineThickness: 1.5,
  filterStrokeBrightness: 1,
  filterFillBrightness: 0.25,
});

const NODE_GRAPH_SOFTPOP_FACE_FIELDS = Object.freeze([
  ["brightness", "Brightness (per sample)", 0, 1, 0.01],
  ["decaySeconds", "Decay (s)", 0.01, 2, 0.01],
  ["backgroundBrightness", "Background brightness", 0, 1, 0.01],
  ["lineBrightness", "Line brightness", 0, 1, 0.01],
  ["lineThickness", "Line thickness (px)", 0.5, 6, 0.1],
  ["filterStrokeBrightness", "Filter stroke brightness", 0, 1, 0.01],
  ["filterFillBrightness", "Filter fill brightness", 0, 1, 0.01],
]);

// Bone stops from the shared gradient selector / preset list (no local color copy).
function nodeGraphSoftpopFaceDefaultGradientStops() {
  if (typeof NodeGraphGradientSelector !== "undefined" && typeof NodeGraphGradientSelector.defaultStops === "function") {
    const stops = NodeGraphGradientSelector.defaultStops("bone");
    if (Array.isArray(stops) && stops.length >= 2) return stops;
  }
  const presets = typeof SHARED_GRADIENT_PRESETS !== "undefined" ? SHARED_GRADIENT_PRESETS : null;
  const bone = Array.isArray(presets) ? presets.find((p) => p && p.id === "bone") : null;
  if (bone && Array.isArray(bone.stops) && bone.stops.length >= 2) {
    return bone.stops.map((s) => ({ t: Number(s.t), color: String(s.color) }));
  }
  if (bone && Array.isArray(bone.colors) && bone.colors.length >= 2) {
    return bone.colors.map((color, i) => ({
      t: i / (bone.colors.length - 1),
      color: String(color),
    }));
  }
  return null;
}

function normalizeNodeGraphSoftpopFaceSettings(settings = {}) {
  const src = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphSoftpopFaceSettingsDefaults;
  const out = {};
  for (const [key, , min, max] of NODE_GRAPH_SOFTPOP_FACE_FIELDS) {
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d[key];
  }
  // Same stops normalisation as the trace drawers (keeps saved stops as-is).
  // Fresh Softpop faces get the shared Bone preset (profile softpopFace / defaultStops "bone").
  if ((src.gradientStops || src.gradient) && typeof nodeGraphPhosphorGradientStopsFromSettings === "function") {
    out.gradientStops = nodeGraphPhosphorGradientStopsFromSettings(src, "#ffffff");
  } else if (Array.isArray(src.gradientStops) && src.gradientStops.length >= 2) {
    out.gradientStops = src.gradientStops.map((s) => ({ t: Number(s.t), color: String(s.color) }));
  } else {
    const bone = nodeGraphSoftpopFaceDefaultGradientStops();
    if (bone) out.gradientStops = bone;
  }
  return out;
}

function nodeGraphSoftpopFaceSettingsForNode(node) {
  return normalizeNodeGraphSoftpopFaceSettings(node?.traceDisplaySettings);
}

// Brightness slider 0..1 -> X per audio sample, log 1e-4 .. 0.1.
function nodeGraphSoftpopFacePerSample(brightness01) {
  return 1e-4 * Math.pow(1000, Math.max(0, Math.min(1, Number(brightness01) || 0)));
}

// 256-entry RGB LUT from the shared gradient path (cached per stops).
function nodeGraphSoftpopFaceLut(settings) {
  const stops = typeof nodeGraphPhosphorGradientStopsFromSettings === "function"
    ? nodeGraphPhosphorGradientStopsFromSettings(settings || {}, "#ffffff")
    : settings?.gradientStops;
  const key = JSON.stringify(stops || null);
  if (nodeGraphSoftpopFaceLut._key === key && nodeGraphSoftpopFaceLut._lut) return nodeGraphSoftpopFaceLut._lut;
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    let rgb = null;
    if (typeof nodeGraphSampleGradientStopsRgb === "function") rgb = nodeGraphSampleGradientStopsRgb(stops, i / 255, "#ffffff");
    lut[i * 3] = rgb ? rgb[0] : i; lut[i * 3 + 1] = rgb ? rgb[1] : i; lut[i * 3 + 2] = rgb ? rgb[2] : i;
  }
  nodeGraphSoftpopFaceLut._key = key;
  nodeGraphSoftpopFaceLut._lut = lut;
  return lut;
}

// Trace-drawer mapping: LUT position = max(brightness, plate).
function nodeGraphSoftpopFaceLutIndex(bright01, plate01) {
  const t = Math.max(Math.max(0, Math.min(1, bright01)), Math.max(0, Math.min(1, plate01)));
  return Math.round(t * 255);
}

function nodeGraphSoftpopFaceRgb01(lut, idx) {
  return [lut[idx * 3] / 255, lut[idx * 3 + 1] / 255, lut[idx * 3 + 2] / 255, 1];
}

function buildNodeGraphSoftpopDisplaySettingsBodyHtml() {
  const rows = NODE_GRAPH_SOFTPOP_FACE_FIELDS.map(([key, label, min, max, step]) => `
      <label class="node-led-settings-row">
        <span>${label}</span>
        <input type="range" min="${min}" max="${max}" step="${step}" data-softpop-face-field="${key}" aria-label="Softpop ${label}">
      </label>`).join("");
  return `
    <div class="node-led-display-settings-panel" data-softpop-face-display-settings-panel>${rows}
    </div>
    <div class="metadata-field-section node-trace-display-gradient-section">
      <div
        id="nodeTraceDisplayGradientSelectorHost"
        class="node-gradient-selector-host node-shared-gradient-host node-spectrogram-gradient-host"
        data-gradient-selector-host
        data-shared-gradient-host
        data-spectrogram-gradient-host></div>
    </div>`;
}

function syncNodeGraphSoftpopDisplaySettingsControls(root, settings) {
  if (!root || !settings) return;
  for (const [key] of NODE_GRAPH_SOFTPOP_FACE_FIELDS) {
    const el = root.querySelector?.(`[data-softpop-face-field="${key}"]`);
    if (el && document.activeElement !== el) el.value = String(settings[key]);
  }
}

function readNodeGraphSoftpopDisplaySettingsForm(root, current) {
  const panel = root?.querySelector?.("[data-softpop-face-display-settings-panel]") || root;
  const next = { ...(current || {}) };
  for (const [key] of NODE_GRAPH_SOFTPOP_FACE_FIELDS) {
    const input = panel?.querySelector?.(`[data-softpop-face-field="${key}"]`);
    if (input) next[key] = Number(input.value);
  }
  // Shared gradient stops from the single active selector (same as trace forms).
  const editor = typeof NodeGraphGradientSelector !== "undefined"
    ? NodeGraphGradientSelector.getActive?.()
    : (typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.gradientSelector : null);
  if (editor && typeof editor.getStops === "function") next.gradientStops = editor.getStops();
  return normalizeNodeGraphSoftpopFaceSettings(next);
}

function bindNodeGraphSoftpopDisplaySettingsBody(host) {
  if (!host || host.dataset.softpopFaceSettingsBound === "true") return;
  host.dataset.softpopFaceSettingsBound = "true";
  const keys = NODE_GRAPH_SOFTPOP_FACE_FIELDS.map(([key]) => key);
  const apply = (persist) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty(keys);
    }
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") {
      applyNodeGraphTraceDisplaySettingsForm({ persist, record: persist === "immediate" });
    }
  };
  host.addEventListener("input", (event) => {
    if (event.target?.closest?.("[data-softpop-face-field]")) apply("debounce");
  });
  host.addEventListener("change", (event) => {
    if (event.target?.closest?.("[data-softpop-face-field]")) apply("immediate");
  });
  if (typeof bindNodeGraphNativeSliderModifiers === "function") {
    for (const key of keys) {
      const input = host.querySelector(`[data-softpop-face-field="${key}"]`);
      if (input) bindNodeGraphNativeSliderModifiers(input, nodeGraphSoftpopFaceSettingsDefaults[key]);
    }
  }
}

// Per-face glow state (kept on the canvas so it survives settings changes).
function nodeGraphSoftpopFaceAccumulate(canvas, bins, info, settings) {
  const n = bins.length;
  if (!canvas._softpopGlow || canvas._softpopGlow.length !== n) {
    canvas._softpopGlow = new Float32Array(n);
  }
  const glow = canvas._softpopGlow;
  if (canvas._softpopLastBins === bins) return glow;  // already consumed
  canvas._softpopLastBins = bins;
  const sr = Math.max(1, Number(info?.[3]) || 48000);
  const count = Math.max(0, Number(info?.[7]) || 0);
  const decay = Math.pow(0.5, count / (sr * Math.max(0.01, settings.decaySeconds)));
  const x = nodeGraphSoftpopFacePerSample(settings.brightness);
  for (let i = 0; i < n; i += 1) {
    glow[i] = glow[i] * decay + x * (Number(bins[i]) || 0);
  }
  return glow;
}

function nodeGraphSoftpopFacePresent(canvas, bins, info, settings, cssWidth) {
  const w = Math.max(1, canvas.width | 0);
  const h = Math.max(1, canvas.height | 0);
  const lut = nodeGraphSoftpopFaceLut(settings);
  const plate = Math.max(0, Math.min(1, Number(settings.backgroundBrightness) || 0));
  const model = Math.round(Number(info?.[0]) || 0);
  const loHz = Math.max(1, Number(info?.[5]) || 20);
  const hiHz = Math.max(loHz * 2, Number(info?.[6]) || 20000);
  const spanLn = Math.log(hiHz / loHz);
  const black = () => {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return true;
  };
  const cssW = Math.max(1, Number(cssWidth) || w);
  const dpr = w / cssW;
  const thickCss = Math.max(0.5, Math.min(6, Number(settings.lineThickness) || 1.5));
  if (model === 1) {
    const glow = nodeGraphSoftpopFaceAccumulate(canvas, bins, info, settings);
    const n = glow.length;
    const lineGain = Math.max(0, Math.min(1, Number.isFinite(Number(settings.lineBrightness)) ? Number(settings.lineBrightness) : 1));
    const col = new Float32Array(w);
    for (let px = 0; px < w; px += 1) {
      const t = ((px + 0.5) / w) * n - 0.5;
      const i0 = Math.max(0, Math.min(n - 1, Math.floor(t)));
      const i1 = Math.min(n - 1, i0 + 1);
      const f = Math.max(0, Math.min(1, t - i0));
      const im = Math.max(0, i0 - 1);
      const ip = Math.min(n - 1, i1 + 1);
      const a = 0.25 * glow[im] + 0.5 * glow[i0] + 0.25 * glow[i1];
      const b = 0.25 * glow[i0] + 0.5 * glow[i1] + 0.25 * glow[ip];
      col[px] = lineGain * (1 - Math.exp(-(a + (b - a) * f)));
    }
    // Line thickness: peak-preserving widening (max over a tapered window
    // of thickness device px). At ~1.5 css px on 1x screens this is a no-op.
    const r = Math.max(0, (thickCss * dpr - 1) / 2);
    const ri = Math.floor(r);
    const wide = ri > 0 ? new Float32Array(w) : col;
    if (ri > 0) {
      for (let px = 0; px < w; px += 1) {
        let m = col[px];
        for (let d = 1; d <= ri; d += 1) {
          const k = 1 - d / (r + 1);
          if (px - d >= 0 && col[px - d] * k > m) m = col[px - d] * k;
          if (px + d < w && col[px + d] * k > m) m = col[px + d] * k;
        }
        wide[px] = m;
      }
    }
    // WebGL (shared line renderer): one full-height quad per run of equal colour.
    const plateIdxS = nodeGraphSoftpopFaceLutIndex(0, plate);
    const batch = typeof nodeGraphGlLinesBegin === "function"
      ? nodeGraphGlLinesBegin(canvas, nodeGraphSoftpopFaceRgb01(lut, plateIdxS))
      : null;
    if (batch) {
      let runStart = 0;
      let runIdx = nodeGraphSoftpopFaceLutIndex(wide[0], plate);
      for (let px = 1; px <= w; px += 1) {
        const idx = px < w ? nodeGraphSoftpopFaceLutIndex(wide[px], plate) : -1;
        if (idx === runIdx) continue;
        if (runIdx !== plateIdxS) nodeGraphGlLinesRect(batch, runStart, 0, px - runStart, h, nodeGraphSoftpopFaceRgb01(lut, runIdx));
        runStart = px;
        runIdx = idx;
      }
      if (nodeGraphGlLinesEnd(batch, "alpha")) return true;
    }
    return black();
  }
  // Filter model: constant-peak bandpass |H| at the centre with Q (Width).
  // Softpop decramps Q, so the analog response is what you hear.
  // Plate = LUT(Background brightness); area under the curve = LUT at a
  // Filter fill brightness x |H|; curve stroke = LUT(Filter stroke brightness), constant.
  canvas._softpopLastBins = bins;
  const plateIdx = nodeGraphSoftpopFaceLutIndex(0, plate);
  const fc = Math.abs(Number(info?.[1]) || 0);
  const q = Math.max(0.01, Number(info?.[2]) || 1);
  const glBatch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, nodeGraphSoftpopFaceRgb01(lut, plateIdx))
    : null;
  if (!glBatch) return black();
  if (!(fc > 0)) return nodeGraphGlLinesEnd(glBatch, "alpha") ? true : black();
  const top = h * 0.1;
  const span = h * 0.85;
  const lineW = Math.max(1, dpr * thickCss);
  const num = (v, dflt) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : dflt);
  const strokeB = num(settings.filterStrokeBrightness, 1);
  const fillB = num(settings.filterFillBrightness, 0.25);
  const magAt = (f) => {
    const u = f / fc - fc / f;
    return 1 / Math.sqrt(1 + q * q * u * u);
  };
  // Edge magnitudes at column boundaries; per column the max |H| over its
  // frequency interval (true peak if fc is inside, else max of endpoints) and
  // the min (endpoint min; |H| is unimodal), so narrow peaks light whole pixels.
  const edge = new Float32Array(w + 1);
  for (let px = 0; px <= w; px += 1) edge[px] = magAt(loHz * Math.exp((px / w) * spanLn));
  const fcPx = (Math.log(fc / loHz) / spanLn) * w;
  const yHi = new Float32Array(w);
  const yLo = new Float32Array(w);
  const colMax = new Float32Array(w);
  for (let px = 0; px < w; px += 1) {
    const mx = (fcPx >= px && fcPx < px + 1) ? 1 : Math.max(edge[px], edge[px + 1]);
    const mn = Math.min(edge[px], edge[px + 1]);
    colMax[px] = mx;
    yHi[px] = top + (1 - mx) * span;
    yLo[px] = top + (1 - mn) * span;
  }
  // Outline: one continuous path through column spans (pixel centres,
  // min..max y per column) so it never fades with position.
  const pts = [];
  for (let px = 0; px < w; px += 1) {
    const x = px + 0.5;
    const rising = px + 1 <= fcPx;
    const a = rising ? yLo[px] : yHi[px];
    const b = rising ? yHi[px] : yLo[px];
    pts.push(x, a);
    if (b !== a) pts.push(x, b);
  }
  const strokeIdx = nodeGraphSoftpopFaceLutIndex(strokeB, plate);
  {
    // Fill columns, then the constant-colour stroke as shader-expanded
    // capsules: solid core lineW/2 - 0.5, 1 px smoothstep edge (Sabrina kLineFrag).
    for (let px = 0; px < w; px += 1) {
      const y = Math.floor(yHi[px]);
      nodeGraphGlLinesRect(glBatch, px, y, 1, h - y, nodeGraphSoftpopFaceRgb01(lut, nodeGraphSoftpopFaceLutIndex(fillB * colMax[px], plate)));
    }
    nodeGraphGlLinesPolyline(glBatch, pts, Math.max(0.25, lineW * 0.5 - 0.5), 1, nodeGraphSoftpopFaceRgb01(lut, strokeIdx));
    if (nodeGraphGlLinesEnd(glBatch, "alpha")) return true;
  }
  return black();
}

function drawNodeGraphSoftpopFaceItem(_renderer, item, pixelRatio) {
  const slot = item?.slot;
  const nodeId = slot?.nodeId;
  if (!nodeId) return;
  if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) return;
  const canvas = typeof nodeGraphModuleScopeLocalFallbackCanvas === "function"
    ? nodeGraphModuleScopeLocalFallbackCanvas(slot)
    : null;
  const screenElement = item?.screenElement || slot?.scopeElement;
  if (
    !canvas
    || typeof syncNodeGraphModuleScopeLocalFallbackCanvas !== "function"
    || !syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio)
  ) {
    return;
  }
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(slot)
    : (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null);
  const settings = nodeGraphSoftpopFaceSettingsForNode(node);
  const bins = typeof nodeGraphDataBus !== "undefined"
    ? nodeGraphDataBus.get(nodeGraphDataBusKey(String(nodeId), "SoftpopBins"))
    : null;
  const info = typeof nodeGraphDataBus !== "undefined"
    ? nodeGraphDataBus.get(nodeGraphDataBusKey(String(nodeId), "SoftpopInfo"))
    : null;
  if (!bins || !bins.length || !info) return;  // no data yet: nothing to draw
  const cssW = Math.max(1, canvas.clientWidth || screenElement?.clientWidth || 1);
  nodeGraphSoftpopFacePresent(canvas, bins, info, settings, cssW);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.softpopFace = drawNodeGraphSoftpopFaceItem;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeNodeGraphSoftpopFaceSettings,
    nodeGraphSoftpopFaceDefaultGradientStops,
    nodeGraphSoftpopFaceAccumulate,
    nodeGraphSoftpopFacePerSample,
    nodeGraphSoftpopFaceLut,
    nodeGraphSoftpopFaceLutIndex,
    nodeGraphSoftpopFacePresent,
  };
}
