// Robin Sinepulse face. Display Settings View:
//   envelopeUnipolar — T60 fill from the plate floor, log1p Hz → LUT
//   envelopeBipolar  — T60 fill mirrored about mid, log1p Hz → LUT
//   spectrogram      — fake ridge, log2 Hz Y (Low…High), Sweep Time across X
// Frequency layout is always the sweep; Decay is playhead speed on every view.
const nodeGraphRobinSinepulseFaceDisplaySettingsDefaults = Object.freeze({
  backgroundHue: 205.714,
  backgroundBrightness: 0.009,
  backgroundSaturation: 0.59,
  lineHue: 187.5,
  lineBrightness: 0.56,
  lineSaturation: 0.99,
  lineThickness: 1.5,
  lineSmoothing: 1,
  dotHue: 0,
  dotBrightness: 0.85,
  dotSaturation: 0,
  dotThickness: 0,
  pixelDensity: 1,
  faceView: "spectrogram",
});

function nodeGraphRobinSinepulseFaceView(look) {
  const view = String(look?.faceView || "");
  if (view === "envelopeBipolar") return "envelopeBipolar";
  if (view === "envelopeUnipolar" || view === "envelope" || view === "db" || view === "dbLog" || view === "pitch") {
    return "envelopeUnipolar";
  }
  return "spectrogram";
}

function normalizeNodeGraphRobinSinepulseFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphRobinSinepulseFaceDisplaySettingsDefaults;
  const out = normalizeNodeGraphRoundShapeFaceSettings({ ...d, ...source });
  const ridgeRaw = Number(source.dotThickness);
  out.dotThickness = Number.isFinite(ridgeRaw)
    ? Math.max(0, Math.min(32, ridgeRaw))
    : d.dotThickness;
  out.faceView = nodeGraphRobinSinepulseFaceView(source);
  if (typeof nodeGraphPhosphorGradientStopsFromSettings === "function") {
    out.gradientStops = nodeGraphPhosphorGradientStopsFromSettings(source, "#75ebff");
  } else if (Array.isArray(source.gradientStops) && source.gradientStops.length >= 2) {
    out.gradientStops = source.gradientStops.map((s) => ({ t: Number(s.t), color: String(s.color) }));
  }
  return out;
}

function nodeGraphRobinSinepulseFaceSettingsForNode(node) {
  return normalizeNodeGraphRobinSinepulseFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphRobinSinepulseDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-robin-sinepulse-face[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._sinepulseForceDraw = true;
  if (typeof el.syncFromParameters === "function") el.syncFromParameters();
  else drawNodeGraphRobinSinepulseFace(el);
}

const nodeGraphRobinSinepulsePreviewWasm = { promise: null, exports: null, failed: false };

function nodeGraphRobinSinepulsePreviewLoad() {
  if (nodeGraphRobinSinepulsePreviewWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphRobinSinepulsePreviewWasm.promise;
  }
  nodeGraphRobinSinepulsePreviewWasm.promise = fetch("/native_modules/robin_sinepulse/robin_sinepulse.wasm?v=kick-wave-1")
    .then((response) => {
      if (!response.ok) throw new Error(`robin_sinepulse wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((result) => {
      nodeGraphRobinSinepulsePreviewWasm.exports = result.instance.exports;
      document.querySelectorAll?.(".node-robin-sinepulse-face").forEach((el) => {
        el._sinepulseForceDraw = true;
        drawNodeGraphRobinSinepulseFace(el);
      });
    })
    .catch(() => {
      nodeGraphRobinSinepulsePreviewWasm.failed = true;
    });
  return nodeGraphRobinSinepulsePreviewWasm.promise;
}

function nodeGraphRobinSinepulseFaceParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

const NODE_GRAPH_SINEPULSE_CURVE_VS = `
attribute vec2 aPos;   // x 0..1 along the window, y 0..1 unipolar height
attribute float aLutT;
attribute float aEnv;
varying float vX;
varying float vY;
varying float vLutT;
varying float vEnv;
uniform float uPx;     // one framebuffer pixel in clip Y
void main() {
  vX = aPos.x;
  vY = aPos.y;
  vLutT = aLutT;
  vEnv = aEnv;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, aPos.y * 2.0 - 1.0 - uPx, 0.0, 1.0);
}
`;

const NODE_GRAPH_SINEPULSE_CURVE_FS = `
precision mediump float;
varying float vX;
varying float vY;
varying float vLutT;
varying float vEnv;
uniform sampler2D uLut;
uniform vec2 uHead;    // elapsedSec, 1=haveHit
uniform float uWin;
uniform float uGhost;
uniform float uFade;   // C2 skirt in plate Y (0..1)
uniform float uBipolar;

float smoother(float e0, float e1, float x) {
  float t = clamp((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

void main() {
  vec3 field = texture2D(uLut, vec2((clamp(vLutT, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5)).rgb;
  float gain = 1.0;
  if (uHead.y > 0.5) {
    float head = uHead.x;
    float win = max(uWin, 1e-6);
    float progress = head / win;
    float played = progress <= 1.0
      ? (vX <= progress ? 1.0 : uGhost)
      : mix(1.0, vX <= 1.0 ? 1.0 : uGhost, 1.0 - clamp((head - win) / 0.12, 0.0, 1.0));
    float idleMix = progress > 1.0 ? clamp((head - win) / 0.12, 0.0, 1.0) : 0.0;
    gain = mix(played, 1.0, idleMix);
  }
  float fe = max(uFade, 1e-6);
  float env = max(vEnv, 0.0);
  float a;
  if (uBipolar > 0.5) {
    float half = 0.5 * env;
    float lo = 0.5 - half;
    float hi = 0.5 + half;
    a = smoother(lo, lo + fe, vY) * (1.0 - smoother(hi, hi + fe, vY));
  } else {
    a = smoother(0.0, fe, vY) * (1.0 - smoother(env, env + fe, vY));
  }
  gl_FragColor = vec4(field * gain, a);
}
`;

function nodeGraphRobinSinepulseInstFreq(pack, t) {
  const a = pack[0];
  const b = pack[1];
  const c = pack[2];
  const p = pack[3];
  const q = pack[4];
  if (pack[5] > 0.5) return (a + b * t) / (1 + c * t);
  if (!(t > 0)) return a;
  const lnT = Math.log(Math.max(t, 1e-12));
  return (a + b * Math.exp(p * q * lnT)) / Math.pow(Math.max(1 + c * Math.exp(p * lnT), 1e-12), q);
}

const NODE_GRAPH_SINEPULSE_FREQ_GLSL = `
float instFreq(float t) {
  float a = uCoeff.x;
  float b = uCoeff.y;
  float c = uCoeff.z;
  float p = uCoeff.w;
  float q = uSweep.x;
  if (uSweep.y > 0.5) return (a + b * t) / (1.0 + c * t);
  if (t <= 0.0) return a;
  float lnT = log(max(t, 1e-12));
  float tp = exp(p * lnT);
  float tpq = exp(p * q * lnT);
  return (a + b * tpq) / pow(max(1.0 + c * tp, 1e-12), q);
}
float logHzY(float f, float fLo, float fHi) {
  float hi = max(fHi, 1.0);
  float lo = max(fLo, 20.0);
  if (hi <= lo) lo = max(hi * 0.5, 0.001);
  return clamp((log(max(f, lo)) - log(lo)) / max(log(hi) - log(lo), 1e-6), 0.0, 1.0);
}
float blobY(float y, float yC, float bw, float amp) {
  float d = y - yC;
  return amp * exp(-d * d / max(2.0 * bw * bw, 1e-8));
}
`;

const NODE_GRAPH_SINEPULSE_SPEC_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uLut;
uniform vec4 uCoeff;
uniform vec4 uSweep;
uniform vec3 uHz;
uniform vec3 uPlate;
uniform vec2 uHead;
uniform float uWin;
uniform float uGhost;
uniform float uFade;
uniform float uPx;
${NODE_GRAPH_SINEPULSE_FREQ_GLSL}
vec3 lutOf(float t) {
  float s = clamp(t, 0.0, 1.0);
  return texture2D(uLut, vec2((s * 255.0 + 0.5) / 256.0, 0.5)).rgb;
}
void main() {
  float win = max(uWin, 1e-6);
  float sweepDur = max(uHz.z, 1e-3);
  float tFreq = vUv.x * sweepDur;
  float tEnv = tFreq;
  float decay = max(uSweep.z, 1e-6);
  float amp = max(uSweep.w, 0.0);
  float env = amp * exp(-6.907755278982137 * tEnv / decay);
  float fInst = max(instFreq(tFreq), 0.0);
  float fLo = max(uHz.y, 0.0);
  float fHi = max(uHz.x, fLo + 1.0);
  float yC = logHzY(fInst, fLo, fHi);
  float attack = exp(-tFreq / 0.008);
  float minBw = max(max(uPx * 1.5, uFade), 0.012);
  float bw = mix(minBw, minBw * 7.0 + 0.045, attack);
  float energy = blobY(vUv.y, yC, bw, env);
  energy += env * attack * 0.12 * (0.1 + 0.4 * vUv.y);
  energy = clamp(energy, 0.0, 1.0);
  float gain = 1.0;
  if (uHead.y > 0.5) {
    float head = uHead.x;
    float progress = head / win;
    float played = progress <= 1.0
      ? (vUv.x <= progress ? 1.0 : uGhost)
      : mix(1.0, vUv.x <= 1.0 ? 1.0 : uGhost, 1.0 - clamp((head - win) / 0.12, 0.0, 1.0));
    float idleMix = progress > 1.0 ? clamp((head - win) / 0.12, 0.0, 1.0) : 0.0;
    gain = mix(played, 1.0, idleMix);
  }
  vec3 field = lutOf(energy);
  gl_FragColor = vec4(mix(uPlate, field, energy * gain), 1.0);
}
`;

/** @type {WeakMap<HTMLCanvasElement, object>} */
const nodeGraphRobinSinepulseGlStates = new WeakMap();

function nodeGraphRobinSinepulseGlEnsure(canvas) {
  if (!canvas) return null;
  let picture = null;
  try {
    picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
  } catch {
    return null;
  }
  let state = nodeGraphRobinSinepulseGlStates.get(canvas);
  if (state?.failed) return state;
  if (state?.gl && !state.lost && !state.gl.isContextLost() && picture?.gl === state.gl && state.specProgram) {
    return state;
  }
  const gl = picture?.gl || null;
  if (!gl || typeof SoemGl === "undefined") {
    return null;
  }
  const program = SoemGl.link(gl, NODE_GRAPH_SINEPULSE_CURVE_VS, NODE_GRAPH_SINEPULSE_CURVE_FS, "robin-sinepulse-display.js:view-3");
  const specProgram = SoemGl.link(gl, SoemGl.GLSL_FULLSCREEN_VS, NODE_GRAPH_SINEPULSE_SPEC_FS, "robin-sinepulse-display.js:spec-view-5");
  if (!program) {
    nodeGraphRobinSinepulseGlStates.set(canvas, { failed: true });
    return null;
  }
  const colorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const colorFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, colorFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
  const fboOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!fboOk) {
    gl.deleteFramebuffer(colorFbo);
    gl.deleteTexture(colorTex);
    nodeGraphRobinSinepulseGlStates.set(canvas, { failed: true });
    return null;
  }
  const lutTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const blank = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) blank[i * 4 + 3] = 255;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
  const u = (name) => gl.getUniformLocation(program, name);
  const su = (name) => (specProgram ? gl.getUniformLocation(specProgram, name) : null);
  const mesh = gl.createBuffer();
  state = {
    gl,
    program,
    specProgram,
    mesh,
    aPos: gl.getAttribLocation(program, "aPos"),
    aLutT: gl.getAttribLocation(program, "aLutT"),
    aEnv: gl.getAttribLocation(program, "aEnv"),
    specAPos: specProgram ? gl.getAttribLocation(specProgram, "aPos") : -1,
    colorTex,
    colorFbo,
    colorW: 4,
    colorH: 4,
    lutTex,
    lutKey: "",
    lost: false,
    uniforms: {
      uLut: u("uLut"),
      uHead: u("uHead"),
      uWin: u("uWin"),
      uGhost: u("uGhost"),
      uFade: u("uFade"),
      uBipolar: u("uBipolar"),
      uPx: u("uPx"),
    },
    specUniforms: {
      uLut: su("uLut"),
      uCoeff: su("uCoeff"),
      uSweep: su("uSweep"),
      uHz: su("uHz"),
      uPlate: su("uPlate"),
      uHead: su("uHead"),
      uWin: su("uWin"),
      uGhost: su("uGhost"),
      uFade: su("uFade"),
      uPx: su("uPx"),
    },
  };
  nodeGraphRobinSinepulseGlStates.set(canvas, state);
  return state;
}

function nodeGraphRobinSinepulseUploadLut(state, stops) {
  const gl = state.gl;
  const key = Array.isArray(stops) ? stops.map((s) => `${s?.t}|${s?.color}`).join(";") : "";
  if (state.lutKey === key) return;
  state.lutKey = key;
  const data = new Uint8Array(256 * 4);
  const sample = typeof nodeGraphSampleGradientStopsRgb === "function"
    ? (t) => nodeGraphSampleGradientStopsRgb(stops, t, "#75ebff")
    : (t) => {
      const v = Math.round(t * 255);
      return [v, v, v];
    };
  for (let i = 0; i < 256; i += 1) {
    const rgb = sample(i / 255);
    const o = i * 4;
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 255;
  }
  gl.bindTexture(gl.TEXTURE_2D, state.lutTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

/** Plate RGB 0..1 from gradient stop 0. */
function nodeGraphRobinSinepulseStop0Rgb(stops) {
  if (typeof nodeGraphSampleGradientStopsRgb === "function") {
    const rgb = nodeGraphSampleGradientStopsRgb(stops, 0, "#000000");
    const r = Number(rgb?.[0]);
    const g = Number(rgb?.[1]);
    const b = Number(rgb?.[2]);
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return [r / 255, g / 255, b / 255];
    }
  }
  const hex = Array.isArray(stops) ? stops[0]?.color : null;
  if (hex && typeof nodeGraphGlGraphParseCssColor === "function") {
    const c = nodeGraphGlGraphParseCssColor(String(hex), [0, 0, 0, 1]);
    return [c[0], c[1], c[2]];
  }
  return [0, 0, 0];
}

/** Seconds on the face X axis: env hits half a CSS pixel. */
function nodeGraphRobinSinepulseFaceWindow(decay, amp, cssH) {
  const dec = Number(decay);
  const a = Math.max(Number(amp), 0);
  const thresh = 0.5 / Math.max(1, cssH);
  let tBlack = 0.008;
  if (dec > 0 && a > thresh) {
    tBlack = dec * Math.log(a / thresh) / Math.log(1000);
    if (!(tBlack > 0) || !Number.isFinite(tBlack)) tBlack = 0.008;
  }
  return Math.max(0.008, tBlack);
}

function nodeGraphRobinSinepulseField(section, node) {
  const wasm = nodeGraphRobinSinepulsePreviewWasm.exports;
  if (!wasm?.soemdsp_robin_sinepulse_preview_field || !wasm.soemdsp_robin_sinepulse_preview_field_at) {
    nodeGraphRobinSinepulsePreviewLoad();
    return null;
  }
  const sr = Number(nodeGraphMvp?.live?.context?.sampleRate);
  const sampleRate = Number.isFinite(sr) && sr > 0 ? sr : 48000;
  const args = [
    nodeGraphRobinSinepulseFaceParam(node, "highFreq", 10000),
    nodeGraphRobinSinepulseFaceParam(node, "lowFreq", 0),
    nodeGraphRobinSinepulseFaceParam(node, "sweepTime", 0.2),
    nodeGraphRobinSinepulseFaceParam(node, "chirp", 0),
    nodeGraphRobinSinepulseFaceParam(node, "chirpShape", 0),
    nodeGraphRobinSinepulseFaceParam(node, "decay", 0.5),
    nodeGraphRobinSinepulseFaceParam(node, "amplitude", 1),
    sampleRate,
  ];
  const key = args.join(",");
  if (section._sinepulseFieldKey === key && section._sinepulseField) return section._sinepulseField;
  const windowSec = wasm.soemdsp_robin_sinepulse_preview_field(...args);
  const pack = new Float32Array(11);
  for (let i = 0; i < 11; i += 1) pack[i] = wasm.soemdsp_robin_sinepulse_preview_field_at(i);
  section._sinepulseFieldKey = key;
  section._sinepulseField = { pack, window: windowSec > 0 ? windowSec : 0.008 };
  return section._sinepulseField;
}

/**
 * Heard seconds since the last trigger, or NaN when the playhead is done.
 * Axis is captured on the hit (Sweep Time). Decay never remaps that axis, so
 * lengthening Decay cannot rewind or invent tail. Once past the captured end
 * plus fade, stay idle until the next Trigger.
 */
function nodeGraphRobinSinepulseHeardElapsed(section, end) {
  const ctx = nodeGraphMvp?.live?.context;
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Elapsed", Number.NaN))
    : Number.NaN;
  if (!ctx || ctx.state !== "running") {
    section._sinepulseAnchorTime = Number.NaN;
    section._sinepulsePlayDone = false;
    return Number.NaN;
  }
  const axisIn = Math.max(Number(end), 1e-6);
  if (Number.isFinite(live) && live >= 0) {
    const prev = section._sinepulseAnchorValue;
    const retrigger = Number.isFinite(prev) && live + 0.002 < prev;
    const first = !Number.isFinite(section._sinepulseAnchorTime);
    if (retrigger || first) {
      section._sinepulseAnchorEnd = axisIn;
      section._sinepulsePlayDone = false;
    }
    if (live !== prev) {
      section._sinepulseAnchorValue = live;
      section._sinepulseAnchorTime = ctx.currentTime;
    }
  }
  if (section._sinepulsePlayDone || !Number.isFinite(section._sinepulseAnchorTime)) {
    return Number.NaN;
  }
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  const e = section._sinepulseAnchorValue + (heard - section._sinepulseAnchorTime);
  const axis = section._sinepulseAnchorEnd > 0 ? section._sinepulseAnchorEnd : axisIn;
  if (e > axis + 0.12) {
    section._sinepulsePlayDone = true;
    return Number.NaN;
  }
  return Math.max(0, e);
}

function drawNodeGraphRobinSinepulseFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.("canvas");
  if (!node || !canvas) return;
  const look = nodeGraphRobinSinepulseFaceSettingsForNode(node);
  const density = typeof nodeGraphResolveDisplayPixelDensity === "function"
    ? nodeGraphResolveDisplayPixelDensity(look.pixelDensity)
    : (Number.isFinite(Number(look.pixelDensity)) && Number(look.pixelDensity) > 0 ? Number(look.pixelDensity) : 1);
  const sized = typeof nodeGraphDisplayCanvasSize === "function"
    ? nodeGraphDisplayCanvasSize(section, canvas, { pixelDensity: density })
    : null;
  if (!sized) return;
  const cssW = Math.max(1, sized.cssWidth);
  const cssH = Math.max(1, sized.cssHeight);
  const w = Math.max(1, sized.width);
  const h = Math.max(1, sized.height);
  if (typeof nodeGraphDisplayCanvasPixelated === "function") {
    nodeGraphDisplayCanvasPixelated(canvas, density < 0.999);
  }
  const state = nodeGraphRobinSinepulseGlEnsure(canvas);
  if (state?.failed) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "robin sinepulse face: GL program failed");
    }
    return;
  }
  if (!state?.gl) return;
  const field = nodeGraphRobinSinepulseField(section, node);
  if (!field) {
    nodeGraphRobinSinepulsePreviewLoad();
    return;
  }
  const drawStops = typeof nodeGraphApplyGradientHueRotation === "function"
    ? nodeGraphApplyGradientHueRotation(look.gradientStops, look)
    : look.gradientStops;
  nodeGraphRobinSinepulseUploadLut(state, drawStops);
  const gl = state.gl;
  if (state.colorW !== w || state.colorH !== h) {
    state.colorW = w;
    state.colorH = h;
    gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  const pack = field.pack;
  const view = nodeGraphRobinSinepulseFaceView(look);
  const smoothPx = Math.max(0, Number(look.lineSmoothing) || 0);
  const windowSec = nodeGraphRobinSinepulseFaceWindow(pack[6], pack[7], cssH);
  const sweepTime = Math.max(nodeGraphRobinSinepulseFaceParam(node, "sweepTime", 0.2), 0.001);
  const elapsed = nodeGraphRobinSinepulseHeardElapsed(section, sweepTime);
  const playWin = section._sinepulseAnchorEnd > 0 ? section._sinepulseAnchorEnd : sweepTime;
  const plate = nodeGraphRobinSinepulseStop0Rgb(drawStops);
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    const r = Math.round(plate[0] * 255);
    const g = Math.round(plate[1] * 255);
    const b = Math.round(plate[2] * 255);
    nodeGraphFacePlateApplyCss(section, `rgb(${r},${g},${b})`);
  }
  const decay = pack[6];
  const amp = Math.max(pack[7], 0);
  const fHi = Math.max(pack[8], 1);
  const fLo = Math.max(pack[9], 0);
  const lnHi = Math.log(1 + fHi);
  const pxY = 1 / Math.max(1, cssH);
  const fade = Math.max(1, smoothPx) * pxY;
  gl.bindFramebuffer(gl.FRAMEBUFFER, state.colorFbo);
  gl.viewport(0, 0, w, h);
  gl.scissor(0, 0, w, h);
  gl.enable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(plate[0], plate[1], plate[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.lutTex);
  if (view === "spectrogram") {
    if (state.specProgram && state.specAPos >= 0) {
      if (state.aPos >= 0) gl.disableVertexAttribArray(state.aPos);
      if (state.aLutT >= 0) gl.disableVertexAttribArray(state.aLutT);
      if (state.aEnv >= 0) gl.disableVertexAttribArray(state.aEnv);
      gl.useProgram(state.specProgram);
      const su = state.specUniforms;
      gl.uniform1i(su.uLut, 0);
      gl.uniform4f(su.uCoeff, pack[0], pack[1], pack[2], pack[3]);
      gl.uniform4f(su.uSweep, pack[4], pack[5], pack[6], pack[7]);
      gl.uniform3f(su.uHz, fHi, fLo, sweepTime);
      gl.uniform3f(su.uPlate, plate[0], plate[1], plate[2]);
      gl.uniform2f(su.uHead, Number.isFinite(elapsed) ? elapsed : -1, Number.isFinite(elapsed) ? 1 : 0);
      gl.uniform1f(su.uWin, playWin);
      gl.uniform1f(su.uGhost, 0.22);
      gl.uniform1f(su.uFade, fade);
      gl.uniform1f(su.uPx, 1 / Math.max(1, h));
      gl.disable(gl.BLEND);
      SoemGl.drawQuad(gl, state.specAPos);
    }
  } else {
    const bipolar = view === "envelopeBipolar";
    const cols = Math.max(2, w);
    const samples = [];
    for (let i = 0; i < cols; i += 1) {
      const u = i / (cols - 1);
      const tSec = u * windowSec;
      const env = decay > 0 ? amp * Math.exp(-6.907755278982137 * tSec / decay) : 0;
      const tFreq = u * sweepTime;
      const f = Math.max(nodeGraphRobinSinepulseInstFreq(pack, tFreq), 0);
      const height = Math.max(env, 0);
      const lutT = Math.log(1 + f) / lnHi;
      if (env < 0.5 * pxY && i > 0) {
        if (!bipolar) samples.push({ u, height, lutT });
        break;
      }
      samples.push({ u, height, lutT });
    }
    const n = samples.length;
    if (n >= 2) {
      const mesh = new Float32Array(n * 2 * 4);
      let o = 0;
      for (let i = 0; i < n; i += 1) {
        const s = samples[i];
        const yBot = bipolar ? Math.max(0, 0.5 - 0.5 * s.height) : 0;
        const yTop = bipolar
          ? Math.min(1, 0.5 + 0.5 * s.height + fade)
          : Math.min(1, s.height + fade);
        mesh[o] = s.u; mesh[o + 1] = yBot; mesh[o + 2] = s.lutT; mesh[o + 3] = s.height;
        mesh[o + 4] = s.u; mesh[o + 5] = yTop; mesh[o + 6] = s.lutT; mesh[o + 7] = s.height;
        o += 8;
      }
      if (state.specAPos >= 0) gl.disableVertexAttribArray(state.specAPos);
      gl.useProgram(state.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.mesh);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(state.aPos);
      gl.vertexAttribPointer(state.aPos, 2, gl.FLOAT, false, 16, 0);
      if (state.aLutT >= 0) {
        gl.enableVertexAttribArray(state.aLutT);
        gl.vertexAttribPointer(state.aLutT, 1, gl.FLOAT, false, 16, 8);
      }
      if (state.aEnv >= 0) {
        gl.enableVertexAttribArray(state.aEnv);
        gl.vertexAttribPointer(state.aEnv, 1, gl.FLOAT, false, 16, 12);
      }
      gl.uniform1i(state.uniforms.uLut, 0);
      gl.uniform2f(state.uniforms.uHead, Number.isFinite(elapsed) ? elapsed : -1, Number.isFinite(elapsed) ? 1 : 0);
      gl.uniform1f(state.uniforms.uWin, playWin);
      gl.uniform1f(state.uniforms.uGhost, 0.22);
      gl.uniform1f(state.uniforms.uFade, fade);
      gl.uniform1f(state.uniforms.uBipolar, bipolar ? 1 : 0);
      gl.uniform1f(state.uniforms.uPx, 2 / Math.max(1, h));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, n * 2);
      gl.disable(gl.BLEND);
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.SCISSOR_TEST);
  if (typeof nodeGraphPicturePresent !== "function"
    || !nodeGraphPicturePresent(state.colorTex, w, h, canvas, canvas.width, canvas.height)) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "robin sinepulse face: GL present failed");
    }
  }
}

function createNodeGraphRobinSinepulseFace(nodeId, type = "robinSinepulse") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-robin-sinepulse-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "robinSinepulse");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-robin-sinepulse-canvas"));
  nodeGraphRobinSinepulsePreviewLoad();
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `robinSinepulse:${el.dataset?.node || ""}`,
    forceKey: "_sinepulseForceDraw",
    rafKey: "_sinepulseRaf",
    paint: drawNodeGraphRobinSinepulseFace,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphRobinSinepulseFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.robinSinepulseFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("robinSinepulseFace", createNodeGraphRobinSinepulseFace);
}
