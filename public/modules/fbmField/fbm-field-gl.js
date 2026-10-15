// Fractal Brownian Field present: fBm per pixel in GLSL (shared picture device).
// Source lives next to the wasm:
//   native_modules/fbm_field/fbm_field.vert.glsl
//   native_modules/fbm_field/fbm_field.frag.glsl
// Audio X/Y/Z probes stay in C++/WASM (same fieldAt). Display no longer calls
// fill_grid when GL works â€” only uniforms (seed, octaves, domainTime, â€¦).

const NODE_GRAPH_FBM_FIELD_GL_REV = 5;
const NODE_GRAPH_FBM_FIELD_GLSL_REV = "2";

const nodeGraphFbmFieldGlsl = {
  vs: "",
  fs: "",
  promise: null,
  failed: false,
};

function nodeGraphFbmFieldGlslCandidateUrls(fileName) {
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
  const rel = `native_modules/fbm_field/${fileName}?v=fbm-glsl-${NODE_GRAPH_FBM_FIELD_GLSL_REV}`;
  return [
    embedBase ? `${embedBase}${rel}` : "",
    `./${rel}`,
    `/${rel}`,
    `/soemdsp-sandbox/${rel}`,
  ].filter(Boolean);
}

async function nodeGraphFbmFieldGlslFetchText(fileName) {
  const urls = nodeGraphFbmFieldGlslCandidateUrls(fileName);
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

function nodeGraphFbmFieldLoadGlsl() {
  if (nodeGraphFbmFieldGlsl.promise) return nodeGraphFbmFieldGlsl.promise;
  nodeGraphFbmFieldGlsl.promise = (async () => {
    const vs = await nodeGraphFbmFieldGlslFetchText("fbm_field.vert.glsl");
    const fs = await nodeGraphFbmFieldGlslFetchText("fbm_field.frag.glsl");
    if (!vs || !fs) {
      nodeGraphFbmFieldGlsl.failed = true;
      console.error("[Fractal Brownian Field] missing native_modules/fbm_field/*.glsl");
      return null;
    }
    nodeGraphFbmFieldGlsl.vs = vs;
    nodeGraphFbmFieldGlsl.fs = fs;
    return nodeGraphFbmFieldGlsl;
  })();
  return nodeGraphFbmFieldGlsl.promise;
}

nodeGraphFbmFieldLoadGlsl();

/** @type {WeakMap<HTMLCanvasElement, object>} */
const nodeGraphFbmFieldGlStates = new WeakMap();

function nodeGraphFbmFieldGlCompile(gl, type, source) {
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

function nodeGraphFbmFieldGlLink(gl, vs, fs) {
  const v = nodeGraphFbmFieldGlCompile(gl, gl.VERTEX_SHADER, vs);
  const f = nodeGraphFbmFieldGlCompile(gl, gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) || "link failed";
    gl.deleteProgram(p);
    throw new Error(log);
  }
  return p;
}

function nodeGraphFbmFieldGlEnsure(canvas) {
  if (!canvas) return null;
  const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
  let state = nodeGraphFbmFieldGlStates.get(canvas);
  if (
    state?.gl
    && !state.lost
    && !state.gl.isContextLost()
    && picture?.gl === state.gl
    && state.rev === NODE_GRAPH_FBM_FIELD_GL_REV
  ) {
    return state;
  }
  if (state?.gaveUp) return null;
  if (nodeGraphFbmFieldGlsl.failed) return null;
  if (!nodeGraphFbmFieldGlsl.vs || !nodeGraphFbmFieldGlsl.fs) {
    nodeGraphFbmFieldLoadGlsl();
    return null;
  }

  const gl = picture?.gl || null;
  if (!gl) {
    nodeGraphFbmFieldGlStates.set(canvas, { failed: true });
    return null;
  }

  try {
    const program = nodeGraphFbmFieldGlLink(gl, nodeGraphFbmFieldGlsl.vs, nodeGraphFbmFieldGlsl.fs);
    const buf = picture.quad;
    const aPos = gl.getAttribLocation(program, "aPos");

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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const blank = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i += 1) blank[i * 4 + 3] = 255;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);

    state = {
      gl,
      program,
      buf,
      aPos,
      colorTex,
      colorFbo,
      colorW: 4,
      colorH: 4,
      paletteTex,
      paletteKey: "",
      lost: false,
      failed: false,
      rev: NODE_GRAPH_FBM_FIELD_GL_REV,
      uniforms: {
        uPalette: gl.getUniformLocation(program, "uPalette"),
        uResolution: gl.getUniformLocation(program, "uResolution"),
        uDomainTime: gl.getUniformLocation(program, "uDomainTime"),
        uZoom: gl.getUniformLocation(program, "uZoom"),
        uPanX: gl.getUniformLocation(program, "uPanX"),
        uPanY: gl.getUniformLocation(program, "uPanY"),
        uRotate: gl.getUniformLocation(program, "uRotate"),
        uSeed: gl.getUniformLocation(program, "uSeed"),
        uOctaves: gl.getUniformLocation(program, "uOctaves"),
        uPersistence: gl.getUniformLocation(program, "uPersistence"),
        uLacunarity: gl.getUniformLocation(program, "uLacunarity"),
        uScale: gl.getUniformLocation(program, "uScale"),
        uSmoothness: gl.getUniformLocation(program, "uSmoothness"),
        uContrast: gl.getUniformLocation(program, "uContrast"),
        uBrightness: gl.getUniformLocation(program, "uBrightness"),
        uMotion: gl.getUniformLocation(program, "uMotion"),
      },
    };
    canvas.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
      const s = nodeGraphFbmFieldGlStates.get(canvas);
      if (s) s.lost = true;
    }, false);
    canvas.addEventListener("webglcontextrestored", () => {
      nodeGraphFbmFieldGlStates.delete(canvas);
    }, false);
    nodeGraphFbmFieldGlStates.set(canvas, state);
    return state;
  } catch (err) {
    console.error("[Fractal Brownian Field] WebGL init failed; face shows black", err);
    nodeGraphFbmFieldGlStates.set(canvas, { failed: true, gaveUp: true });
    return null;
  }
}

function nodeGraphFbmFieldGlUploadPalette(state, stops) {
  const gl = state.gl;
  const key = Array.isArray(stops)
    ? stops.map((s) => `${s?.t}|${s?.color}`).join(";")
    : "";
  if (state.paletteKey === key) return;
  state.paletteKey = key;
  const data = new Uint8Array(256 * 4);
  const sample = typeof nodeGraphSampleGradientStopsRgb === "function"
    ? (t) => nodeGraphSampleGradientStopsRgb(stops, t, "#ffffff")
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
  gl.bindTexture(gl.TEXTURE_2D, state.paletteTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

/**
 * Present field from uniforms (no WASM face grid). canvas sized to gridWÃ—gridH.
 */
function nodeGraphFbmFieldGlPresentParams(canvas, params = {}) {
  const state = nodeGraphFbmFieldGlEnsure(canvas);
  if (!state?.gl || state.lost) return false;
  const gridW = Math.max(1, params.width | 0);
  const gridH = Math.max(1, params.height | 0);
  nodeGraphDisplayCanvasSetBacking(canvas, gridW, gridH);

  const gl = state.gl;
  nodeGraphFbmFieldGlUploadPalette(state, params.gradientStops);

  if (state.colorW !== gridW || state.colorH !== gridH) {
    state.colorW = gridW;
    state.colorH = gridH;
    gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gridW, gridH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, state.colorFbo);
  gl.viewport(0, 0, gridW, gridH);
  gl.scissor(0, 0, gridW, gridH);
  gl.enable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
  gl.enableVertexAttribArray(state.aPos);
  gl.vertexAttribPointer(state.aPos, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.paletteTex);
  gl.uniform1i(state.uniforms.uPalette, 0);
  gl.uniform2f(state.uniforms.uResolution, gridW, gridH);
  // Defaults apply only to missing/non-finite values; explicit 0 is kept.
  // Engine-safe floors (documented): zoom >= 0.05 and scale >= 1e-6 avoid a
  // divide-by-zero in the domain transform; octaves >= 1 so fBm has a term;
  // lacunarity >= 1 so frequencies never shrink.
  const M = globalThis.SoemMath;
  gl.uniform1f(state.uniforms.uDomainTime, M.finiteOr(params.domainTime, 0));
  gl.uniform1f(state.uniforms.uZoom, M.clamp(params.zoom, 0.05, Infinity, 1));
  gl.uniform1f(state.uniforms.uPanX, M.finiteOr(params.panX, 0));
  gl.uniform1f(state.uniforms.uPanY, M.finiteOr(params.panY, 0));
  gl.uniform1f(state.uniforms.uRotate, M.finiteOr(params.rotate, 0));
  // Seed 0 is a real seed; full Seed range 0..SEED_MAX (float32-exact).
  gl.uniform1f(state.uniforms.uSeed, Math.round(M.clamp(params.seed, 0, M.SEED_MAX, 0)));
  gl.uniform1f(state.uniforms.uOctaves, Math.round(M.clamp(params.octaves, 1, 8, 4)));
  gl.uniform1f(state.uniforms.uPersistence, M.clamp(params.persistence, 0, 0.99, 0.5));
  gl.uniform1f(state.uniforms.uLacunarity, M.clamp(params.lacunarity, 1, 4, 2));
  gl.uniform1f(state.uniforms.uScale, M.clamp(params.scale, 1e-6, Infinity, 1));
  gl.uniform1f(state.uniforms.uSmoothness, M.clamp01(params.smoothness, 0.55));
  // Explicit zero valid for contrast/brightness â€” never coerce with ||.
  const contrast = Number(params.contrast);
  gl.uniform1f(state.uniforms.uContrast, Number.isFinite(contrast) ? Math.max(0, contrast) : 1);
  const brightness = Number(params.brightness);
  gl.uniform1f(state.uniforms.uBrightness, Number.isFinite(brightness) ? Math.max(0, brightness) : 1);
  const motion = Number(params.motion);
  gl.uniform1f(
    state.uniforms.uMotion,
    Number.isFinite(motion) ? Math.max(0, Math.min(1, Math.round(motion))) : 1,
  );

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (params.nodeId && typeof nodeGraphPicturePublish === "function") {
    nodeGraphPicturePublish(params.nodeId, state.colorTex, gridW, gridH);
  }
  if (typeof nodeGraphPicturePresent === "function") {
    return nodeGraphPicturePresent(state.colorTex, gridW, gridH, canvas, canvas.width | 0, canvas.height | 0);
  }
  return true;
}

/**
 * Legacy entry: GL params path only (the mono-grid Canvas2D fallback is gone).
 */
function nodeGraphFbmFieldGlPresent(canvas, monoGrid, gridW, gridH, options = {}) {
  if (options && options.fieldParams) {
    return nodeGraphFbmFieldGlPresentParams(canvas, {
      ...options.fieldParams,
      width: gridW,
      height: gridH,
      gradientStops: options.gradientStops,
      background: options.background,
      nodeId: options.nodeId,
    });
  }
  return false;
}

function nodeGraphFbmFieldGlClearBlack(canvas) {
  if (!canvas) return false;
  nodeGraphDisplayCanvasSetBacking(canvas, Math.max(1, canvas.width | 0), Math.max(1, canvas.height | 0));
  if (typeof nodeGraphGlLinesFillBlack !== "function") return false;
  nodeGraphGlLinesFillBlack(canvas);
  return true;
}
