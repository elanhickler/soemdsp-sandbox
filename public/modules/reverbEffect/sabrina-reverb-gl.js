// Sabrina Reverb delay lines on the shared picture device.
// Source lives next to the wasm:
//   native_modules/sabrina_reverb/sabrina_reverb.vert.glsl
//   native_modules/sabrina_reverb/sabrina_reverb.frag.glsl
// Positions come from soemdsp_sabrina_reverb_voice_delay (linear seconds / 0.45; > 1 = off-axis, not drawn).

const NODE_GRAPH_SABRINA_REVERB_GL_REV = 1;
const NODE_GRAPH_SABRINA_REVERB_GLSL_REV = "1";
const NODE_GRAPH_SABRINA_DISPLAY_BASE_W = 222;

const nodeGraphSabrinaReverbGlsl = {
  vs: "",
  fs: "",
  promise: null,
  failed: false,
};

const NODE_GRAPH_SABRINA_STEM_RGB = [
  [1, 130 / 255, 110 / 255],
  [110 / 255, 130 / 255, 1],
];
const NODE_GRAPH_SABRINA_RECYCLE_RGB = [86 / 255, 206 / 255, 118 / 255];

function nodeGraphSabrinaStemWidthPx(displayW) {
  const w = Math.max(1, Number(displayW) || 1);
  return Math.max(1, w / NODE_GRAPH_SABRINA_DISPLAY_BASE_W);
}

function nodeGraphSabrinaReverbGlslCandidateUrls(fileName) {
  let embedBase = "";
  try {
    const path = String(window.location.pathname || "");
    const idx = path.indexOf("/soemdsp-sandbox");
    if (idx >= 0) {
      embedBase = `${path.slice(0, idx)}/soemdsp-sandbox/`;
    }
  } catch (_error) {
    embedBase = "";
  }
  const rel = `native_modules/sabrina_reverb/${fileName}?v=sabrina-glsl-${NODE_GRAPH_SABRINA_REVERB_GLSL_REV}`;
  return [
    embedBase ? `${embedBase}${rel}` : "",
    `./${rel}`,
    `/${rel}`,
    `/soemdsp-sandbox/${rel}`,
  ].filter(Boolean);
}

async function nodeGraphSabrinaReverbGlslFetchText(fileName) {
  const urls = nodeGraphSabrinaReverbGlslCandidateUrls(fileName);
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], { cache: "no-cache" });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.indexOf("void main()") >= 0) return text;
    } catch (_error) {
      // try next candidate
    }
  }
  return "";
}

function nodeGraphSabrinaReverbLoadGlsl() {
  if (nodeGraphSabrinaReverbGlsl.promise) return nodeGraphSabrinaReverbGlsl.promise;
  nodeGraphSabrinaReverbGlsl.promise = (async () => {
    const vs = await nodeGraphSabrinaReverbGlslFetchText("sabrina_reverb.vert.glsl");
    const fs = await nodeGraphSabrinaReverbGlslFetchText("sabrina_reverb.frag.glsl");
    if (!vs || !fs) {
      nodeGraphSabrinaReverbGlsl.failed = true;
      console.warn("[Sabrina Reverb] missing native_modules/sabrina_reverb/*.glsl");
      return null;
    }
    nodeGraphSabrinaReverbGlsl.vs = vs;
    nodeGraphSabrinaReverbGlsl.fs = fs;
    return nodeGraphSabrinaReverbGlsl;
  })();
  return nodeGraphSabrinaReverbGlsl.promise;
}

nodeGraphSabrinaReverbLoadGlsl();

function nodeGraphSabrinaReverbGlCompile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "compile failed";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function nodeGraphSabrinaReverbGlLink(gl, vs, fs) {
  const v = nodeGraphSabrinaReverbGlCompile(gl, gl.VERTEX_SHADER, vs);
  const f = nodeGraphSabrinaReverbGlCompile(gl, gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "link failed";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

let nodeGraphSabrinaReverbGlState = null;

function nodeGraphSabrinaReverbGlEnsure() {
  const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
  const gl = picture?.gl || null;
  if (
    nodeGraphSabrinaReverbGlState?.gl
    && gl
    && nodeGraphSabrinaReverbGlState.gl === gl
    && !nodeGraphSabrinaReverbGlState.gl.isContextLost()
    && nodeGraphSabrinaReverbGlState.rev === NODE_GRAPH_SABRINA_REVERB_GL_REV
  ) {
    return nodeGraphSabrinaReverbGlState;
  }
  if (nodeGraphSabrinaReverbGlsl.failed || !gl) return null;
  if (!nodeGraphSabrinaReverbGlsl.vs || !nodeGraphSabrinaReverbGlsl.fs) {
    nodeGraphSabrinaReverbLoadGlsl();
    return null;
  }
  try {
    const program = nodeGraphSabrinaReverbGlLink(gl, nodeGraphSabrinaReverbGlsl.vs, nodeGraphSabrinaReverbGlsl.fs);
    const buf = gl.createBuffer();
    nodeGraphSabrinaReverbGlState = {
      gl,
      program,
      buf,
      rev: NODE_GRAPH_SABRINA_REVERB_GL_REV,
      position: gl.getAttribLocation(program, "position"),
      distPx: gl.getAttribLocation(program, "distPx"),
      colour: gl.getUniformLocation(program, "colour"),
      halfPx: gl.getUniformLocation(program, "halfPx"),
    };
    return nodeGraphSabrinaReverbGlState;
  } catch (error) {
    nodeGraphSabrinaReverbGlsl.failed = true;
    console.warn("[Sabrina Reverb] line shader failed", error);
    return null;
  }
}

function nodeGraphSabrinaReverbGlPresent(canvas, phases, cssWidth) {
  const state = nodeGraphSabrinaReverbGlEnsure();
  if (!state || !canvas || !Array.isArray(phases) || !phases.length) return false;
  const gl = state.gl;
  const w = Math.max(1, canvas.width | 0);
  const h = Math.max(1, canvas.height | 0);
  const cssW = Math.max(1, Number(cssWidth) || canvas.clientWidth || 1);
  if (typeof nodeGraphSharedGlBindPresent === "function") {
    nodeGraphSharedGlBindPresent(gl, w, h);
  } else {
    gl.viewport(0, 0, w, h);
  }
  if (gl.bindVertexArray) gl.bindVertexArray(null);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(state.program);
  const halfPx = nodeGraphSabrinaStemWidthPx(cssW) * 0.5;
  const reach = halfPx + 2;
  gl.uniform1f(state.halfPx, halfPx);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
  if (state.position >= 0) gl.enableVertexAttribArray(state.position);
  if (state.distPx >= 0) gl.enableVertexAttribArray(state.distPx);
  const stride = 12;
  if (state.position >= 0) gl.vertexAttribPointer(state.position, 2, gl.FLOAT, false, stride, 0);
  if (state.distPx >= 0) gl.vertexAttribPointer(state.distPx, 1, gl.FLOAT, false, stride, 8);
  const ndc = (px) => (px / cssW) * 2 - 1;
  const count = Math.min(14, phases.length);
  for (let i = 0; i < count; i += 1) {
    const t = Number(phases[i]);
    if (!Number.isFinite(t) || t > 1) continue;
    const x01 = Math.max(0, t);
    const xPx = x01 * cssW;
    const x0 = ndc(xPx - reach);
    const x1 = ndc(xPx + reach);
    const verts = new Float32Array([
      x0, -1, -reach,
      x1, -1, reach,
      x0, 1, -reach,
      x1, 1, reach,
    ]);
    const rgb = i >= 12 ? NODE_GRAPH_SABRINA_RECYCLE_RGB : NODE_GRAPH_SABRINA_STEM_RGB[i & 1];
    gl.uniform4f(state.colour, rgb[0], rgb[1], rgb[2], 1);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  if (state.position >= 0) gl.disableVertexAttribArray(state.position);
  if (state.distPx >= 0) gl.disableVertexAttribArray(state.distPx);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  if (typeof nodeGraphSharedGlEndPresent === "function") {
    nodeGraphSharedGlEndPresent(gl);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof nodeGraphSharedGlBlitTo2D !== "function") return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  nodeGraphSharedGlBlitTo2D(ctx, w, h);
  return true;
}
