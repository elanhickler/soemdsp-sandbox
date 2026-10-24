// Robin Sinepulse face: T60 frequency/amplitude field on the shared picture
// device. Native soemdsp_robin_sinepulse_preview_field packs rsFreqSweeper
// coeffs; GLSL evaluates f(t) and paints log1p Hz through the phosphor LUT.
// X is full designed-hit T60 (Decay to 1e-6 * 1.12, 8 ms floor). No oscillator
// polyline. Playhead is __Elapsed. Display Settings `robinSinepulseFace`:
// gradient phosphor; lineSmoothing (envelope/ridge skirt); Ridge (dotThickness);
// pixelDensity. GPU only.
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
  dotThickness: 5,
  pixelDensity: 1,
});

function normalizeNodeGraphRobinSinepulseFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphRobinSinepulseFaceDisplaySettingsDefaults;
  const out = normalizeNodeGraphRoundShapeFaceSettings({ ...d, ...source });
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
  nodeGraphRobinSinepulsePreviewWasm.promise = fetch("/native_modules/robin_sinepulse/robin_sinepulse.wasm?v=kick-face-11")
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

const NODE_GRAPH_SINEPULSE_FIELD_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uLut;
uniform vec4 uCoeff;   // a, b, c, p
uniform vec4 uSweep;   // q, powFree, decay, amp
uniform vec3 uHz;      // fHi, fLo, window
uniform vec3 uLook;    // featherUv, ridgeUv, minHeight
uniform vec2 uHead;    // elapsedSec, 1=haveHit
uniform float uGhost;

float instFreq(float t) {
  float a = uCoeff.x;
  float b = uCoeff.y;
  float c = uCoeff.z;
  float p = uCoeff.w;
  float q = uSweep.x;
  if (uSweep.y > 0.5) return (a + b * t) / (1.0 + c * t);
  if (!(t > 0.0)) return a;
  float lnT = log(max(t, 1e-12));
  float tp = exp(p * lnT);
  float tpq = exp(p * q * lnT);
  return (a + b * tpq) / pow(max(1.0 + c * tp, 1e-12), q);
}

float smoother(float e0, float e1, float x) {
  float t = clamp((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 lutOf(float t) {
  float u = clamp(t, 0.0, 1.0);
  return texture2D(uLut, vec2((u * 255.0 + 0.5) / 256.0, 0.5)).rgb;
}

void main() {
  float win = max(uHz.z, 1e-6);
  float tSec = vUv.x * win;
  float f = max(instFreq(tSec), 0.0);
  float lutT = log(1.0 + f) / log(1.0 + max(uHz.x, 1.0));
  vec3 plate = lutOf(0.0);
  vec3 field = lutOf(lutT);
  vec3 ridgeC = lutOf(1.0);
  float decay = uSweep.z;
  float amp = max(uSweep.w, 0.0);
  float env = 0.0;
  if (decay > 0.0) {
    env = amp * exp(-6.907755278982137 * tSec / decay);
  }
  if (env > 1e-6) env = max(env, uLook.z);
  float y = abs(vUv.y * 2.0 - 1.0);
  float mask = 1.0 - smoother(env, env + uLook.x, y);
  float ridge = 1.0 - smoother(0.0, max(uLook.y, 1e-6), y);
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
  vec3 rgb = mix(plate, field, mask * gain);
  rgb = mix(rgb, ridgeC * gain, ridge * mask * gain);
  gl_FragColor = vec4(rgb, 1.0);
}
`;

/** @type {WeakMap<HTMLCanvasElement, object>} */
const nodeGraphRobinSinepulseGlStates = new WeakMap();

function nodeGraphRobinSinepulseGlEnsure(canvas) {
  if (!canvas) return null;
  const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
  let state = nodeGraphRobinSinepulseGlStates.get(canvas);
  if (state?.gl && !state.lost && !state.gl.isContextLost() && picture?.gl === state.gl) return state;
  const gl = picture?.gl || null;
  if (!gl || typeof SoemGl === "undefined") {
    nodeGraphRobinSinepulseGlStates.set(canvas, { failed: true });
    return null;
  }
  const program = SoemGl.link(gl, SoemGl.GLSL_FULLSCREEN_VS, NODE_GRAPH_SINEPULSE_FIELD_FS, "robin-sinepulse-display.js");
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
  state = {
    gl,
    program,
    buf: picture.quad,
    aPos: gl.getAttribLocation(program, "aPos"),
    colorTex,
    colorFbo,
    colorW: 4,
    colorH: 4,
    lutTex,
    lutKey: "",
    lost: false,
    uniforms: {
      uLut: u("uLut"),
      uCoeff: u("uCoeff"),
      uSweep: u("uSweep"),
      uHz: u("uHz"),
      uLook: u("uLook"),
      uHead: u("uHead"),
      uGhost: u("uGhost"),
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
 * Heard seconds since the last trigger, or NaN when no hit is in the window.
 * Each new engine value is anchored at the context time it arrived and then
 * advanced in real time to the speakers (getOutputTimestamp). After the engine
 * goes idle the heard playhead keeps running from the last anchor until it
 * passes the window end plus fade.
 */
function nodeGraphRobinSinepulseHeardElapsed(section, end) {
  const ctx = nodeGraphMvp?.live?.context;
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Elapsed", Number.NaN))
    : Number.NaN;
  if (!ctx || ctx.state !== "running") {
    section._sinepulseAnchorTime = Number.NaN;
    return Number.NaN;
  }
  if (Number.isFinite(live) && live >= 0 && live !== section._sinepulseAnchorValue) {
    section._sinepulseAnchorValue = live;
    section._sinepulseAnchorTime = ctx.currentTime;
  }
  if (!Number.isFinite(section._sinepulseAnchorTime)) return Number.NaN;
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  const e = section._sinepulseAnchorValue + (heard - section._sinepulseAnchorTime);
  if (e > end + 0.12) {
    if (!(live >= 0)) section._sinepulseAnchorTime = Number.NaN;
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
  const face = typeof ensureFaceMetrics === "function" ? ensureFaceMetrics(section, { observe: true }) : null;
  const cssW = Math.max(1, face?.cssW || section.clientWidth || 1);
  const cssH = Math.max(1, face?.cssH || section.clientHeight || 1);
  const dpr = Math.max(1, face?.dpr || window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(Math.round(cssW * dpr) * Math.max(density, 1e-6)));
  const h = Math.max(1, Math.round(Math.round(cssH * dpr) * Math.max(density, 1e-6)));
  if (typeof nodeGraphDisplayCanvasSetBacking === "function") nodeGraphDisplayCanvasSetBacking(canvas, w, h);
  else {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }
  canvas.style.imageRendering = density < 0.999 ? "pixelated" : "";
  const state = nodeGraphRobinSinepulseGlEnsure(canvas);
  if (!state?.gl) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "robin sinepulse face: no shared GL device");
    }
    return;
  }
  const field = nodeGraphRobinSinepulseField(section, node);
  if (!field) {
    nodeGraphRobinSinepulsePreviewLoad();
    return;
  }
  nodeGraphRobinSinepulseUploadLut(state, look.gradientStops);
  const gl = state.gl;
  if (state.colorW !== w || state.colorH !== h) {
    state.colorW = w;
    state.colorH = h;
    gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  const pack = field.pack;
  const windowSec = field.window;
  const elapsed = nodeGraphRobinSinepulseHeardElapsed(section, windowSec);
  const feather = Math.max(0, Number(look.lineSmoothing) || 0) / Math.max(1, cssH);
  const ridge = Math.max(0.25, Number(look.dotThickness) || 5) * 0.5 / Math.max(1, cssH);
  const minH = Math.max(1.5 / Math.max(1, cssH), 1e-4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, state.colorFbo);
  gl.viewport(0, 0, w, h);
  gl.scissor(0, 0, w, h);
  gl.enable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
  gl.enableVertexAttribArray(state.aPos);
  gl.vertexAttribPointer(state.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.lutTex);
  gl.uniform1i(state.uniforms.uLut, 0);
  gl.uniform4f(state.uniforms.uCoeff, pack[0], pack[1], pack[2], pack[3]);
  gl.uniform4f(state.uniforms.uSweep, pack[4], pack[5], pack[6], pack[7]);
  gl.uniform3f(state.uniforms.uHz, pack[8], pack[9], windowSec);
  gl.uniform3f(state.uniforms.uLook, Math.max(feather, 1e-4), ridge, minH);
  gl.uniform2f(state.uniforms.uHead, Number.isFinite(elapsed) ? elapsed : -1, Number.isFinite(elapsed) ? 1 : 0);
  gl.uniform1f(state.uniforms.uGhost, 0.22);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
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
