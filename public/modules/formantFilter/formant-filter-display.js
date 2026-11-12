// Formant Filter face: the filter's combined magnitude response on the
// filter faces' log-Hz / dB axes (node-graph-cookbook-filter.js): 0 dB line,
// cyan response curve, amber Body.
//   - the combined response (5 bandpasses + Body lowpass, complex sum) as a curve
//   - the Body (lowpassed dry) part as a shaded curve
//   - numbered dots 1-5 on each band peak (Off bands dimmed)
// Every number comes from the native core (formant_filter.wasm
// soemdsp_formant_filter_eval_response: same sweep / shift / edge fade / Q / gain / Body
// code as the audio path, exact TPT response), so face and sound cannot drift.
// Drive is not drawn (it is a level-dependent saturation, not a filter).
// Drawing: WebGL2 only via public/lib/visual/gl-line-renderer.js.
//
// Display Settings `formantFilterFace` (saved in node.traceDisplaySettings):
// Dot size + Curve / Body thickness (ink px at a 96px face; 0 = that element
// is not drawn at all) and the shared HBS lamps Background / Dots / Curve /
// Body (Brightness 0 = not drawn; Body brightness 0 also hides the fill).

const NODE_GRAPH_FORMANT_FILTER_FACE = Object.freeze({
  background: [2 / 255, 6 / 255, 9 / 255, 1],
  zeroDb: [1, 1, 1, 0.22],
  grid: [1, 1, 1, 0.07],
  envelope: [61 / 255, 224 / 255, 1, 0.95],
  bodyFill: [226 / 255, 168 / 255, 109 / 255, 0.2],
  bodyLine: [226 / 255, 168 / 255, 109 / 255, 0.7],
  dot: [1, 220 / 255, 170 / 255, 1],
  dotOff: [1, 220 / 255, 170 / 255, 0.3],
  label: [229 / 255, 238 / 255, 242 / 255, 0.82],
  labelOff: [229 / 255, 238 / 255, 242 / 255, 0.3],
  minHz: 30,
  maxHz: 16000,
  minDb: -48,
  maxDb: 15,
});

// Lamp defaults are the HBS points that land exactly on the face colors above
// (nodeGraphHueBrightnessRgb01). Untouched lamps draw the constants as-is.
const nodeGraphFormantFilterFaceDisplaySettingsDefaults = Object.freeze({
  dotSize: 9,
  formantCurveThickness: 1.5,
  bodyThickness: 1,
  backgroundHue: 205.714,
  backgroundBrightness: 0.0093,
  backgroundSaturation: 0.6273,
  dotHue: 44.963,
  dotBrightness: 0.71979,
  dotSaturation: 1,
  curveHue: 187.651,
  curveBrightness: 0.56251,
  curveSaturation: 1,
  bodyHue: 36.573,
  bodyBrightness: 0.57336,
  bodySaturation: 0.63258,
});
/** HBS lamp ids, in form order. */
const NODE_GRAPH_FORMANT_FILTER_FACE_LAMPS = Object.freeze(["background", "dot", "curve", "body"]);
const NODE_GRAPH_FORMANT_FILTER_FACE_SIZE_MAX = Object.freeze({
  dotSize: 32,
  formantCurveThickness: 16,
  bodyThickness: 16,
});

function normalizeNodeGraphFormantFilterFaceSettings(settings = {}) {
  const d = nodeGraphFormantFilterFaceDisplaySettingsDefaults;
  const source = settings && typeof settings === "object" ? settings : {};
  const out = {};
  for (const [key, max] of Object.entries(NODE_GRAPH_FORMANT_FILTER_FACE_SIZE_MAX)) {
    const n = Number(source[key]);
    out[key] = source[key] !== "" && source[key] != null && Number.isFinite(n)
      ? Math.max(0, Math.min(max, n))
      : d[key];
  }
  const unit = (v, fallback) => {
    const n = Number(v);
    return v !== "" && v != null && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  for (const id of NODE_GRAPH_FORMANT_FILTER_FACE_LAMPS) {
    const raw = source[`${id}Hue`];
    const n = Number(raw);
    // Wrap only outside 0..360 so stored hues (and the defaults) stay bit-exact.
    const wrapped = n >= 0 && n < 360 ? n : ((n % 360) + 360) % 360;
    out[`${id}Hue`] = raw !== "" && raw != null && Number.isFinite(n) ? wrapped : d[`${id}Hue`];
    out[`${id}Brightness`] = unit(source[`${id}Brightness`], d[`${id}Brightness`]);
    out[`${id}Saturation`] = unit(source[`${id}Saturation`], d[`${id}Saturation`]);
  }
  return out;
}

function nodeGraphFormantFilterFaceSettingsForNode(node) {
  return normalizeNodeGraphFormantFilterFaceSettings(node?.traceDisplaySettings);
}

/** Main-thread formant_filter.wasm (display eval only; audio runs in the worklet). */
const nodeGraphFormantFilterWasm = { promise: null, exports: null, failed: false };

function nodeGraphFormantFilterLoadWasm() {
  if (nodeGraphFormantFilterWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphFormantFilterWasm.promise;
  }
  nodeGraphFormantFilterWasm.promise = fetch("/native_modules/formant_filter/formant_filter.wasm?v=formant-filter-5")
    .then((response) => {
      if (!response.ok) throw new Error(`formant_filter wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((result) => {
      nodeGraphFormantFilterWasm.exports = result.instance.exports;
    })
    .catch(() => {
      nodeGraphFormantFilterWasm.failed = true;
    });
  return nodeGraphFormantFilterWasm.promise;
}

/**
 * Forced repaint through the face pump's sync (paints, then presents the GL
 * graph copy), so the change shows in the graph view too.
 */
function nodeGraphFormantFilterFaceRepaint(section) {
  if (!section) return;
  section._formantFilterForce = true;
  if (typeof section.syncFromParameters === "function") {
    section.syncFromParameters();
    return;
  }
  drawNodeGraphFormantFilterDisplay(section);
  if (typeof nodeGraphGlGraphPresentDisplaysSoon === "function") nodeGraphGlGraphPresentDisplaysSoon();
}

/** Display Settings changed: repaint this node's face now. */
function applyNodeGraphFormantFilterDisplaySettingsToFace(node) {
  if (!node?.id || typeof document === "undefined") return;
  const id = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(node.id)) : String(node.id);
  document.querySelectorAll?.(`.node-formant-filter-display[data-node="${id}"]`)?.forEach((section) => {
    nodeGraphFormantFilterFaceRepaint(section);
  });
}

/**
 * Lamp color as [r, g, b, alpha]; null when its Brightness is 0 (not drawn).
 * A lamp left at its default returns the face constant exactly.
 */
function nodeGraphFormantFilterFaceLampRgba(look, id, constantRgba, alpha) {
  const d = nodeGraphFormantFilterFaceDisplaySettingsDefaults;
  const hue = look[`${id}Hue`];
  const bright = look[`${id}Brightness`];
  const sat = look[`${id}Saturation`];
  if (!(bright > 0)) return null;
  const a = alpha ?? constantRgba[3];
  if (hue === d[`${id}Hue`] && bright === d[`${id}Brightness`] && sat === d[`${id}Saturation`]) {
    return [constantRgba[0], constantRgba[1], constantRgba[2], a];
  }
  const rgb = typeof nodeGraphHueBrightnessRgb01 === "function"
    ? nodeGraphHueBrightnessRgb01(hue, bright, sat)
    : [constantRgba[0], constantRgba[1], constantRgba[2]];
  return [rgb[0], rgb[1], rgb[2], a];
}

const NODE_GRAPH_FORMANT_FILTER_EVAL_HEADER = 32;
const NODE_GRAPH_FORMANT_FILTER_EVAL_MAX_POINTS = 2048;

const NODE_GRAPH_FORMANT_FILTER_PARAM_DEFAULTS = Object.freeze({
  vowel: 0, sweep: 0, shift: 0, resonance: 1, body: 0.5, amplitude: 1,
  gain1: 1, gain2: 1, gain3: 1, gain4: 1, gain5: 1,
  on1: 1, on2: 1, on3: 1, on4: 1, on5: 1,
});

function nodeGraphFormantFilterFaceStored(node, key) {
  const raw = node?.params?.[key];
  const n = Number(raw);
  if (raw !== "" && raw != null && Number.isFinite(n)) return n;
  // Choice params may be saved by key (Sweep "aou" / "ae" / ...).
  const meta = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions?.formantFilter?.parameters?.find?.((p) => p.key === key)
    : null;
  const keys = Array.isArray(meta?.choiceKeys) ? meta.choiceKeys : null;
  if (keys && raw != null) {
    const i = keys.indexOf(String(raw));
    if (i >= 0) return Array.isArray(meta.choiceIds) && Number.isFinite(Number(meta.choiceIds[i])) ? Number(meta.choiceIds[i]) : i;
  }
  return NODE_GRAPH_FORMANT_FILTER_PARAM_DEFAULTS[key];
}

function nodeGraphFormantFilterFaceParam(node, key) {
  const base = nodeGraphFormantFilterFaceStored(node, key);
  if (node && typeof nodeGraphFilterCurveLiveParam === "function") {
    // Slider mid-drag and MOD ghost, as the filter faces.
    const v = Number(nodeGraphFilterCurveLiveParam(node, key, base));
    if (Number.isFinite(v)) return v;
  }
  return base;
}

function nodeGraphFormantFilterFaceReadParams(node) {
  const out = {};
  for (const key of Object.keys(NODE_GRAPH_FORMANT_FILTER_PARAM_DEFAULTS)) {
    out[key] = nodeGraphFormantFilterFaceParam(node, key);
  }
  out.sweep = Math.max(0, Math.min(9, Math.round(out.sweep)));
  for (let b = 1; b <= 5; b += 1) out[`on${b}`] = out[`on${b}`] >= 0.5 ? 1 : 0;
  return out;
}

function nodeGraphFormantFilterFaceSweepLabel(index) {
  const choices = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions?.formantFilter?.parameters?.find?.((p) => p.key === "sweep")?.choices
    : null;
  return Array.isArray(choices) && choices[index] != null ? String(choices[index]) : "";
}

/** Native eval (shared with the audio path); null until the wasm is ready. */
function nodeGraphFormantFilterFaceEval(params, sampleRate, points, minHz, maxHz) {
  nodeGraphFormantFilterLoadWasm();
  const wasm = nodeGraphFormantFilterWasm.exports;
  if (!wasm?.soemdsp_formant_filter_eval_response || !wasm?.soemdsp_formant_filter_eval_buffer || !wasm?.memory) {
    return null;
  }
  const F = NODE_GRAPH_FORMANT_FILTER_FACE;
  const P = Math.max(2, Math.min(NODE_GRAPH_FORMANT_FILTER_EVAL_MAX_POINTS, points | 0));
  wasm.soemdsp_formant_filter_eval_response(
    sampleRate, params.vowel, params.sweep, params.shift, params.resonance, params.body, params.amplitude,
    params.gain1, params.gain2, params.gain3, params.gain4, params.gain5,
    params.on1, params.on2, params.on3, params.on4, params.on5,
    P, minHz ?? F.minHz, maxHz ?? F.maxHz,
  );
  const len = NODE_GRAPH_FORMANT_FILTER_EVAL_HEADER + 2 * P;
  // Copy out: the view dies if the module memory ever grows.
  const E = new Float64Array(wasm.memory.buffer, wasm.soemdsp_formant_filter_eval_buffer(), len).slice();
  const h0 = NODE_GRAPH_FORMANT_FILTER_EVAL_HEADER;
  return {
    P,
    bandHz: E.subarray(0, 5),
    bandQ: E.subarray(5, 10),
    bandGain: E.subarray(10, 15),
    bandOn: E.subarray(15, 20),
    bandDotLevel: E.subarray(20, 25),
    bodyCutoffHz: E[25],
    makeup: E[28],
    response: E.subarray(h0, h0 + P),
    bodyResponse: E.subarray(h0 + P, h0 + 2 * P),
  };
}

function drawNodeGraphFormantFilterDisplay(section) {
  if (!section?.isConnected) return;
  const canvas = section.querySelector(".node-display-face");
  if (!canvas || typeof nodeGraphSizeDisplayCanvas !== "function") return;
  const metrics = nodeGraphSizeDisplayCanvas(section, canvas);
  if (!metrics) return;
  const { cssWidth: width, cssHeight: height, pixelRatio } = metrics;
  if (!(width >= 8) || !(height >= 8)) return;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section.dataset.node || "") : null;
  const params = nodeGraphFormantFilterFaceReadParams(node);
  const sampleRate = Math.max(1, nodeGraphFiniteNumber(
    typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.sampleRate : 0,
    44100,
  ));
  const wasmReady = Boolean(nodeGraphFormantFilterWasm.exports);
  const look = nodeGraphFormantFilterFaceSettingsForNode(node);
  const key = `${width}x${height}@${pixelRatio}|${sampleRate}|${wasmReady ? 1 : 0}|`
    + Object.keys(NODE_GRAPH_FORMANT_FILTER_PARAM_DEFAULTS).map((k) => Number(params[k]).toPrecision(6)).join(",")
    + "|" + Object.keys(nodeGraphFormantFilterFaceDisplaySettingsDefaults).map((k) => look[k]).join(",");
  if (section._formantFilterKey === key && !section._formantFilterForce) return;
  section._formantFilterForce = false;

  const F = NODE_GRAPH_FORMANT_FILTER_FACE;
  const lamp = (id, constantRgba, alpha) => nodeGraphFormantFilterFaceLampRgba(look, id, constantRgba, alpha);
  // Background brightness 0 is a black plate (the plate itself always clears).
  const background = lamp("background", F.background) || [0, 0, 0, 1];
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, background, { scale: pixelRatio, textInk: false })
    : null;
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "formant filter: no shared GL device");
    } else if (typeof nodeGraphGlLinesFillBlack === "function") {
      nodeGraphGlLinesFillBlack(canvas);
    }
    section._formantFilterKey = "";
    return;
  }

  const fine = 1 / Math.max(1, pixelRatio);
  const faceMin = typeof faceMinSide === "function" ? faceMinSide(width, height) : Math.min(width, height);
  const ink = (px) => (typeof faceInkPx === "function" ? faceInkPx(px, faceMin) : px);
  const strokeGrid = ink(1);
  // Display Settings sizes. 0 = that element is skipped (no minimum width).
  const strokeCurve = look.formantCurveThickness > 0 ? ink(look.formantCurveThickness) : 0;
  const strokeBody = look.bodyThickness > 0 ? Math.max(0.5 * look.bodyThickness, ink(look.bodyThickness)) : 0;
  const colCurve = strokeCurve > 0 ? lamp("curve", F.envelope) : null;
  const colBodyFill = lamp("body", F.bodyFill);
  const colBodyLine = strokeBody > 0 ? lamp("body", F.bodyLine) : null;
  const colDot = lamp("dot", F.dot);
  const colDotOff = lamp("dot", F.dotOff);
  // Text is sized here from the face box (faceInkPx), so the batch is told not to scale it again.
  const fontPx = Math.max(8, ink(11));
  const titlePx = Math.max(8, ink(12));
  const titlePad = ink(4);
  const dotSize = look.dotSize;
  const dotR = dotSize > 0 ? Math.max(2.5 * dotSize / 9, ink(dotSize * 0.5)) : 0;
  const family = "system-ui, sans-serif";
  const logMin = Math.log10(F.minHz);
  const logRange = Math.log10(F.maxHz) - logMin;
  const xOf = (hz) => ((Math.log10(Math.max(1e-9, hz)) - logMin) / logRange) * width;
  const dbOf = (amp) => 20 * Math.log10(Math.max(1e-9, Math.abs(amp)));
  const yOfDb = (db) => (1 - ((Math.max(F.minDb, Math.min(F.maxDb, db)) - F.minDb) / (F.maxDb - F.minDb))) * height;
  const yOf = (amp) => yOfDb(dbOf(amp));

  // Axes as the filter faces: 0 dB line; faint decade lines at 100 Hz / 1 kHz / 10 kHz.
  for (const hz of [100, 1000, 10000]) {
    const x = xOf(hz);
    nodeGraphGlLinesSegment(batch, x, 0, x, height, strokeGrid * 0.5, fine, F.grid);
  }
  const zeroDbY = yOfDb(0);
  nodeGraphGlLinesSegment(batch, 0, zeroDbY, width, zeroDbY, strokeGrid * 0.5, fine, F.zeroDb);

  const points = Math.max(64, Math.min(NODE_GRAPH_FORMANT_FILTER_EVAL_MAX_POINTS, Math.round(width)));
  const ev = nodeGraphFormantFilterFaceEval(params, sampleRate, points);
  section._formantFilterLastEval = ev;
  if (ev) {
    const xAt = (i) => (ev.P > 1 ? (i / (ev.P - 1)) * width : 0);
    // Body: the lowpassed dry part, shaded.
    const bodyPts = [];
    for (let i = 0; i < ev.P; i += 1) {
      if (ev.bodyResponse[i] > 0) bodyPts.push(xAt(i), yOf(ev.bodyResponse[i]));
    }
    if (bodyPts.length >= 4) {
      if (colBodyFill && typeof nodeGraphGlLinesFillUnder === "function") {
        nodeGraphGlLinesFillUnder(batch, bodyPts, height, colBodyFill);
      }
      if (colBodyLine) nodeGraphGlLinesPolyline(batch, bodyPts, strokeBody * 0.5, fine, colBodyLine);
    }
    // Combined response: bank + Body, complex sum (what In -> Out does at Drive 0).
    if (colCurve) {
      const pts = [];
      for (let i = 0; i < ev.P; i += 1) pts.push(xAt(i), yOf(ev.response[i]));
      nodeGraphGlLinesPolyline(batch, pts, strokeCurve * 0.5, fine, colCurve);
    }
    // Numbered dots on each band peak. A number that would sit on another
    // band's number moves beside its dot instead (bands can cross).
    // A band Shift pushed past the axis (or faded out at Nyquist / 20 Hz) has no dot.
    const dots = [0, 1, 2, 3, 4].filter((b) => {
      const hz = ev.bandHz[b];
      if (hz > F.maxHz || hz < F.minHz) return false;
      return !(ev.bandOn[b] >= 0.5 && ev.bandGain[b] === 0 && (hz >= sampleRate * 0.4 || hz <= 40));
    }).map((b) => ({
      b,
      on: ev.bandOn[b] >= 0.5 && ev.bandGain[b] !== 0,
      x: Math.max(dotR, Math.min(width - dotR, xOf(ev.bandHz[b]))),
      y: Math.max(dotR, Math.min(height - dotR, yOf(ev.bandDotLevel[b]))),
    })).sort((p, q) => p.x - q.x);
    const placed = [];
    const half = fontPx * 0.45;
    for (const d of dots) {
      // Dot size 0 or Dots brightness 0: no dot; the band number stays.
      const dotRgba = d.on ? colDot : colDotOff;
      if (dotR > 0 && dotRgba) nodeGraphGlLinesDot(batch, d.x, d.y, dotR, fine, dotRgba);
      let tx = d.x;
      let ty = d.y - dotR - fontPx * 0.55 < 0 ? d.y + dotR + fontPx * 0.6 : d.y - dotR - fontPx * 0.55;
      const clash = (x, y) => placed.some((p) => Math.abs(p.x - x) < half * 2 && Math.abs(p.y - y) < fontPx);
      if (clash(tx, ty)) {
        tx = d.x + dotR + half + 1;
        ty = d.y;
        if (clash(tx, ty) || tx + half > width) tx = d.x - dotR - half - 1;
      }
      placed.push({ x: tx, y: ty });
      nodeGraphGlLinesText(batch, String(d.b + 1), tx, ty, {
        px: fontPx, rgba: d.on ? F.label : F.labelOff, align: "center", baseline: "middle", family, weight: 700,
      });
    }
  }

  // Title (as the filter faces): the Sweep path.
  const title = nodeGraphFormantFilterFaceSweepLabel(params.sweep);
  if (title) {
    const titleW = nodeGraphGlLinesMeasureText(title, titlePx, family, 600);
    const titleY = titlePad * 0.5;
    nodeGraphGlLinesRect(batch, titlePad, titleY - titlePad * 0.15, titleW + titlePad * 0.7, titlePx + titlePad * 0.35, [background[0], background[1], background[2], 0.65]);
    nodeGraphGlLinesText(batch, title, titlePad * 1.3, titleY, {
      px: titlePx, rgba: F.label, align: "left", baseline: "top", family, weight: 600,
    });
  }

  const ok = nodeGraphGlLinesEnd(batch, "alpha");
  if (!ok && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "formant filter: GL present failed");
  }
  section._formantFilterKey = ok ? key : "";
}

function createNodeGraphFormantFilterDisplay(nodeId, type = "formantFilter") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-formant-filter-display node-module-face";
  if (typeof markCurveFacePlate === "function") {
    markCurveFacePlate(section, "formantFilterFace");
  } else {
    section.dataset.faceKind = "formantFilterFace";
    section.setAttribute("data-face-kind", "formantFilterFace");
  }
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "formantFilter");
  section.dataset.parameterVisual = "true";
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-formant-filter-canvas");
  section.append(canvas);
  // Simulation-FPS pump (as the filter faces) so a MOD on any knob moves the
  // face live; param sync and resize force one paint.
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `formantFilterFace:${el.dataset?.node || ""}`,
    forceKey: "_formantFilterForce",
    paint: drawNodeGraphFormantFilterDisplay,
    paintKind: "param",
  });
  // The native eval loads with formant_filter.wasm; repaint once it lands.
  const pending = nodeGraphFormantFilterLoadWasm();
  if (pending && typeof pending.then === "function") {
    pending.then(() => nodeGraphFormantFilterFaceRepaint(section));
  }
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.formantFilterFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("formantFilterFace", createNodeGraphFormantFilterDisplay);
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createNodeGraphFormantFilterDisplay,
    nodeGraphFormantFilterFaceEval,
    normalizeNodeGraphFormantFilterFaceSettings,
    nodeGraphFormantFilterFaceDisplaySettingsDefaults,
  };
}