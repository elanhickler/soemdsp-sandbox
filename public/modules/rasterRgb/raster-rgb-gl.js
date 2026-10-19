// Raster RGB (Scan Grid) on the GPU (docs/WEBGL_DISPLAY_PLAN.md).
//
// Beam: the grid is one persistent RGBA8 texture per node (row 0 = top).
// Each frame only the new samples go up (one R32F texture per channel, the
// newest `take` samples of the R/G/B rings) and scanDraw() draws one point per
// pixel write (raster_rgb.scan.*.glsl): the scan position maths runs in the
// vertex shader, the colour is clamp(|v|, 0, 1). A pixel changes only when the
// beam writes it again. No CPU pixel buffer, no full-grid upload.
//
// Present, per frame (same look as the old Canvas2D path):
//   1. Source pass, per face pixel: nearest-neighbour lookup of the grid
//      texel (drawImage with smoothing off) → grade LUT texture (contrast →
//      brightness → invert, built by nodeGraphRasterRgbGradeLut from
//      nodeGraphRasterRgbGradeChannel01) → HSL hue rotate, a straight GLSL
//      port of nodeGraphRasterRgbHueRotate. Transparent outside the dest
//      rect (Square ratio letterbox).
//   2. Blur / glow: separable Gaussian, premultiplied, outside the image is
//      transparent (what CSS blur() does on a drawImage). Sigma = the CSS
//      radius in face px. Up to SIGMA_DIRECT px the kernel runs at full
//      resolution (taps at ±ceil(3σ), like Skia's GPU blur). Wider sigmas
//      first halve the image with 2×2 box passes, blur at that level with the
//      box + bilinear-upsample variance taken out, and upsample bilinearly
//      in the composite (Skia does the same above sigma 4).
//   3. Composite: plate under the (blurred) image, source-over, then
//      glow · glowLayer added ("lighter" at globalAlpha = Glow). Opaque.
// The hue rotation is HSL (not linear), so it is ported per pixel rather than
// as a colour matrix; a matrix would not match nodeGraphRasterRgbHueRotate.
//
// Device: the shared picture device (public/lib/visual/picture-device.js).
// Its 4096² canvas never resizes: the composite draws into the bottom-left
// cw×ch scissor rect, which is drawImage'd onto the face. Scratch targets are
// grow-only and shared by every Raster RGB face. No new WebGL context.
// Failure: returns false and raster-rgb-display.js calls
// nodeGraphDisplayGlFailed (black face, one console.error). No fallback.
// A lost context loses the grid; it restarts black on the new context.
//
// GLSL lives next to the wasm:
//   native_modules/raster_rgb/raster_rgb.vert.glsl
//   native_modules/raster_rgb/raster_rgb.{source,blur,down,composite}.frag.glsl
//   native_modules/raster_rgb/raster_rgb.scan.{vert,frag}.glsl (beam writes)

(function initRasterRgbGl(global) {
  const SIGMA_DIRECT = 6; // px; above this, blur at a halved level
  const MAX_TAPS_RADIUS = 24; // ceil(3 · SIGMA_DIRECT) + margin; must match blur.frag loop
  const MAX_LEVELS = 8;
  const GLSL_REV = "3";
  const SAMPLE_TEX_W = 4096; // sample textures are row-major, this wide
  const CHUNK_STAMPS = 4096; // stamps per draw: keeps the shader's float maths exact
  const TIE = 1e-3; // same tie margin as the scan shader's kTie

  const glsl = {
    vs: "",
    source: "",
    blur: "",
    down: "",
    composite: "",
    scanVs: "",
    scanFs: "",
    promise: null,
    failed: false,
  };

  function glslUrls(fileName) {
    let embedBase = "";
    try {
      const path = String(window.location.pathname || "");
      const idx = path.indexOf("/soemdsp-sandbox");
      if (idx >= 0) embedBase = `${path.slice(0, idx)}/soemdsp-sandbox/`;
    } catch (_error) {
      embedBase = "";
    }
    const rel = `native_modules/raster_rgb/${fileName}?v=scan-glsl-${GLSL_REV}`;
    return [
      embedBase ? `${embedBase}${rel}` : "",
      `./${rel}`,
      `/${rel}`,
      `/soemdsp-sandbox/${rel}`,
    ].filter(Boolean);
  }

  async function fetchGlsl(fileName) {
    const urls = glslUrls(fileName);
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const res = await fetch(urls[i], { cache: "no-cache" });
        if (!res.ok) continue;
        const text = await res.text();
        if (text && text.indexOf("void main()") >= 0) return text;
      } catch (_error) {
        // next candidate
      }
    }
    return "";
  }

  function loadGlsl() {
    if (glsl.promise) return glsl.promise;
    glsl.promise = (async () => {
      const vs = await fetchGlsl("raster_rgb.vert.glsl");
      const source = (await fetchGlsl("raster_rgb.source.frag.glsl"))
        .replace("// #include <soem-hsl>", SoemGl.GLSL_HSL);
      const blur = await fetchGlsl("raster_rgb.blur.frag.glsl");
      const down = await fetchGlsl("raster_rgb.down.frag.glsl");
      const composite = await fetchGlsl("raster_rgb.composite.frag.glsl");
      const scanVs = await fetchGlsl("raster_rgb.scan.vert.glsl");
      const scanFs = await fetchGlsl("raster_rgb.scan.frag.glsl");
      if (!vs || !source || !blur || !down || !composite || !scanVs || !scanFs) {
        glsl.failed = true;
        console.error("[raster-rgb-gl] missing native_modules/raster_rgb/*.glsl");
        return null;
      }
      glsl.vs = vs;
      glsl.source = source;
      glsl.blur = blur;
      glsl.down = down;
      glsl.composite = composite;
      glsl.scanVs = scanVs;
      glsl.scanFs = scanFs;
      global.NODE_GRAPH_RASTER_RGB_GL_SOURCE_FS = source;
      global.NODE_GRAPH_RASTER_RGB_GL_BLUR_FS = blur;
      return glsl;
    })();
    return glsl.promise;
  }

  loadGlsl();

  const entries = new WeakMap();
  /** Per state: the grade LUT texture (WeakMap: dropped states free it). */
  const stateGpu = new WeakMap();
  const watchedCanvases = new WeakSet();

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      if (!gl.isContextLost()) {
        console.error("[raster-rgb-gl] shader compile failed", gl.getShaderInfoLog(shader));
      }
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function link(gl, fsSrc, uniforms, vsSrc = glsl.vs) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) {
        console.error("[raster-rgb-gl] program link failed", gl.getProgramInfoLog(program));
      }
      gl.deleteProgram(program);
      return null;
    }
    const u = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(program, name);
    return { program, aPos: gl.getAttribLocation(program, "aPos"), u };
  }

  function entryFor(dev) {
    const gl = dev?.gl;
    if (!gl || gl.isContextLost()) return null;
    if (glsl.failed) return null;
    if (!glsl.vs || !glsl.source || !glsl.blur || !glsl.down || !glsl.composite || !glsl.scanVs || !glsl.scanFs) {
      loadGlsl();
      return null;
    }
    let entry = entries.get(gl);
    if (entry) return entry.ok ? entry : null;
    entry = { ok: false };
    entries.set(gl, entry);
    if (dev.canvas && !watchedCanvases.has(dev.canvas)) {
      watchedCanvases.add(dev.canvas);
      dev.canvas.addEventListener("webglcontextrestored", () => {
        entries.delete(gl);
      }, false);
    }
    const source = link(gl, glsl.source, ["uRaw", "uLut", "uBuf", "uFace", "uDest", "uHue", "uFlipY"]);
    const blur = link(gl, glsl.blur, ["uTex", "uTexSize", "uInOffset", "uInMin", "uInMax", "uAxis", "uSigma", "uRadius"]);
    const down = link(gl, glsl.down, ["uTex", "uTexSize"]);
    const composite = link(gl, glsl.composite, [
      "uImage", "uGlow", "uImageUv", "uImageOff", "uGlowUv", "uGlowOff", "uGlowAlpha", "uPlate",
    ]);
    const scan = link(gl, glsl.scanFs, [
      "uR", "uG", "uB", "uTexW", "uSkip", "uHas", "uBase", "uLast",
      "uCell0", "uCells", "uLine0", "uFrameEnd", "uTiming",
    ], glsl.scanVs);
    if (!source || !blur || !down || !composite || !scan) return null;
    entry.ok = true;
    entry.scan = scan;
    // Empty VAO: the beam draws from gl_VertexID only, never from another
    // renderer's enabled attribute arrays.
    entry.scanVao = gl.createVertexArray();
    entry.samples = { R: null, G: null, B: null, rows: 0 };
    entry.source = source;
    entry.blur = blur;
    entry.down = down;
    entry.composite = composite;
    entry.maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048;
    entry.targets = new Map(); // name → { tex, fbo, w, h }
    return entry;
  }

  function makeTexture(gl, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Grow-only RGBA8 render target shared by every face on this context. */
  function target(gl, entry, name, w, h) {
    let t = entry.targets.get(name);
    if (t && t.w >= w && t.h >= h) return t;
    const nw = Math.max(w, t?.w || 0);
    const nh = Math.max(h, t?.h || 0);
    if (nw > entry.maxTex || nh > entry.maxTex) return null;
    if (t) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
      entry.targets.delete(name);
    }
    const tex = makeTexture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return null;
    }
    t = { tex, fbo, w: nw, h: nh };
    entry.targets.set(name, t);
    return t;
  }

  function lutFor(state, grade) {
    // Grade cache key lives on the shared state fields.
    const key = `${grade.invert}|${grade.contrast}|${grade.brightness}`;
    if (state.gradeLutKey !== key || !state.gradeLut) {
      state.gradeLut = nodeGraphRasterRgbGradeLut(grade);
      state.gradeLutKey = key;
    }
    return { lut: state.gradeLut, key };
  }

  function syncLut(gl, state, grade) {
    let g = stateGpu.get(state);
    if (!g || g.gl !== gl) {
      g = { gl, lut: makeTexture(gl, gl.NEAREST), lutKey: "" };
      stateGpu.set(state, g);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const { lut, key } = lutFor(state, grade);
    if (g.lutKey !== key) {
      const rgba = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i += 1) {
        rgba[i * 4] = lut[i];
        rgba[i * 4 + 1] = lut[i];
        rgba[i * 4 + 2] = lut[i];
        rgba[i * 4 + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, g.lut);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      g.lutKey = key;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return g;
  }

  /** The node's persistent grid (RGBA8, row 0 = top), created opaque black. */
  function gridFor(gl, state) {
    const g = state.gpu;
    if (g && g.gl === gl && g.w === state.width && g.h === state.height) return g;
    nodeGraphRasterRgbGlFree(state);
    const tex = makeTexture(gl, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, state.width, state.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return null;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, state.width, state.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    state.gpu = { gl, tex, fbo, w: state.width, h: state.height };
    return state.gpu;
  }

  /** Delete a state's grid (Clear, resize, stop, power off). */
  function nodeGraphRasterRgbGlFree(state) {
    const g = state?.gpu;
    if (!g) return;
    state.gpu = null;
    if (g.gl.isContextLost()) return;
    g.gl.deleteFramebuffer(g.fbo);
    g.gl.deleteTexture(g.tex);
  }

  /** Grow-only R32F sample textures (one per channel), SAMPLE_TEX_W wide. */
  function sampleTextures(gl, entry, rows) {
    const s = entry.samples;
    if (s.R && s.rows >= rows) return s;
    const cap = Math.max(rows, s.rows * 2, 1);
    for (const ch of ["R", "G", "B"]) {
      if (s[ch]) gl.deleteTexture(s[ch]);
      s[ch] = makeTexture(gl, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, SAMPLE_TEX_W, cap, 0, gl.RED, gl.FLOAT, null);
    }
    s.rows = cap;
    return s;
  }

  function uploadSamples(gl, tex, data) {
    const n = data.length;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const full = Math.floor(n / SAMPLE_TEX_W);
    if (full > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SAMPLE_TEX_W, full, gl.RED, gl.FLOAT, data, 0);
    const rest = n - full * SAMPLE_TEX_W;
    if (rest > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, full, rest, 1, gl.RED, gl.FLOAT, data, full * SAMPLE_TEX_W);
  }

  function posMod(pos, period) {
    const m = pos % period;
    return m < 0 ? m + period : m;
  }

  /**
   * Beam writes for one frame. input: { take, channels: [R, G, B] each a
   * Float32Array of the newest samples (length <= take; shorter rings are
   * zero-padded at the front) or null, logicalW, logicalH, speed, syncs:
   * sorted [{ at, kind: "h" | "v" }] (sample index; applied before that
   * sample) }. Updates state.beam / state.writePos (stamps written).
   * Returns false on a GL failure.
   */
  function nodeGraphRasterRgbGlScan(state, input) {
    const dev = nodeGraphPictureDevice();
    const gl = dev?.gl;
    if (!gl || gl.isContextLost()) return false;
    const entry = entryFor(dev);
    if (!entry) return false;
    const g = gridFor(gl, state);
    if (!g) return false;
    const take = Math.max(0, Math.floor(input.take || 0));
    if (!take) return true;
    const W = input.logicalW;
    const H = input.logicalH;
    const s = input.speed;
    if (!(W > 0) || !(H > 0) || !(s > 0)) return true;
    // Raster timing in samples: line D = W / speed (= sampleRate / Line Rate),
    // column D / W, frame F = H * D. See raster_rgb.scan.vert.glsl.
    const D = W / s;
    const DW = 1 / s;
    const F = H * D;
    const Wc = g.w;
    const Hc = g.h;
    const rows = Math.ceil(take / SAMPLE_TEX_W);
    const tex = sampleTextures(gl, entry, rows);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const skip = [0, 0, 0];
    const has = [0, 0, 0];
    ["R", "G", "B"].forEach((ch, c) => {
      const data = input.channels[c];
      if (!data?.length) return;
      has[c] = 1;
      skip[c] = take - data.length;
      uploadSamples(gl, tex[ch], data);
    });
    const p = entry.scan;
    gl.useProgram(p.program);
    ["R", "G", "B"].forEach((ch, c) => {
      gl.activeTexture(gl.TEXTURE0 + c);
      gl.bindTexture(gl.TEXTURE_2D, tex[ch]);
    });
    gl.uniform1i(p.u.uR, 0);
    gl.uniform1i(p.u.uG, 1);
    gl.uniform1i(p.u.uB, 2);
    gl.uniform1i(p.u.uTexW, SAMPLE_TEX_W);
    gl.uniform3i(p.u.uSkip, skip[0], skip[1], skip[2]);
    gl.uniform3f(p.u.uHas, has[0], has[1], has[2]);
    gl.uniform2i(p.u.uCells, Wc, Hc);
    gl.uniform3f(p.u.uTiming, D, DW, F);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    gl.viewport(0, 0, g.w, g.h);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(entry.scanVao);
    // Beam: next cell (r, c) and the start times of its line and frame, in
    // samples relative to sample 0 of this take. A writePos that no longer
    // matches (Clear / cold start set it to 0, a new size) restarts the raster.
    let b = state.beam;
    const q0 = Number.isFinite(state.writePos) ? state.writePos : 0;
    if (!b || b.q !== q0 || b.Wc !== Wc || b.Hc !== Hc) {
      b = { q: 0, r: 0, c: 0, line: 0, frame: 0, Wc, Hc };
    }
    let { r, c, line, frame } = b;
    let q = b.q;
    const syncs = input.syncs || [];
    let draws = 0;
    let stampsTotal = 0;
    let next = 0;
    let i = 0;
    const clampInt = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
    while (i < take) {
      // Sync hits at this sample move the beam before it writes: the line
      // (H: the next one, unless the beam already waits at column 0) or the
      // frame (V) starts at that sample.
      while (next < syncs.length && syncs[next].at <= i) {
        const at = syncs[next].at;
        if (syncs[next].kind === "v") {
          r = 0; c = 0; line = at; frame = at;
        } else {
          if (c > 0) { c = 0; r += 1; }
          if (r >= Hc) { r = 0; frame = at; }
          line = at;
        }
        next += 1;
      }
      const end = next < syncs.length ? Math.min(take, syncs[next].at) : take;
      // Stamps whose sample is below `end`, at most CHUNK_STAMPS per draw.
      const r0 = r;
      const c0 = c;
      const line0 = line;
      const frameEnd0 = frame + F;
      let count = 0;
      let firstT = NaN;
      // A cell is due when the beam left it by `end` (sample = ceil(exit) - 1).
      const exitOf = (col, ln, fe) => Math.min(ln + Math.min((col + 1) * DW, D), fe);
      while (count < CHUNK_STAMPS) {
        const frameEnd = frame + F;
        const lim = end + TIE;
        let due = clampInt(Math.floor((lim - line) / DW), 0, Wc);
        if (due < Wc && (line + D <= lim || frameEnd <= lim)) due = Wc;
        let upto = Math.min(due, c + (CHUNK_STAMPS - count));
        if (upto > c) {
          if (!(firstT === firstT)) firstT = exitOf(c, line, frameEnd);
          count += upto - c;
          c = upto;
        }
        if (c < Wc) break;
        c = 0;
        r += 1;
        if (r >= Hc) { r = 0; frame = frameEnd; line = frame; } else line += D;
      }
      if (count > 0) {
        const base = Math.max(0, Math.ceil(firstT - TIE) - 1);
        gl.uniform1i(p.u.uBase, base);
        gl.uniform1i(p.u.uLast, Math.max(0, end - 1));
        gl.uniform2i(p.u.uCell0, c0, r0);
        gl.uniform1f(p.u.uLine0, line0 - base);
        gl.uniform1f(p.u.uFrameEnd, frameEnd0 - base);
        gl.drawArrays(gl.POINTS, 0, count);
        draws += 1;
        stampsTotal += count;
        q += count;
        continue;
      }
      i = end;
    }
    // Rebase times to the next take's sample 0.
    state.beam = { q, r, c, line: line - take, frame: frame - take, Wc, Hc };
    state.writePos = q;
    state.scanCredit = 0;
    state.lastScan = { take, draws, stamps: stampsTotal };
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let c = 2; c >= 0; c -= 1) {
      gl.activeTexture(gl.TEXTURE0 + c);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    return !gl.isContextLost();
  }

  /** Smoke/probe only: the grid as RGBA bytes, row 0 = top. */
  function nodeGraphRasterRgbGlReadGrid(state) {
    const g = state?.gpu;
    if (!g || g.gl.isContextLost()) return null;
    const gl = g.gl;
    const out = new Uint8Array(g.w * g.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    gl.readPixels(0, 0, g.w, g.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: g.w, height: g.h, pixels: out };
  }

  function parsePlate(plate) {
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(String(plate || ""));
    if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
    const c = nodeGraphRasterRgbParseHexRgb(plate, "#000000");
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  /** Level for a CSS blur sigma: 0 = full res, k = image halved k times. */
  function blurLevel(sigma) {
    let level = 0;
    while (level < MAX_LEVELS && sigma / (1 << level) > SIGMA_DIRECT) level += 1;
    return level;
  }

  function drawQuad(gl, dev, prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, dev.quad);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function bindTarget(gl, t, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.scissor(0, 0, w, h);
  }

  /**
   * Gaussian with CSS sigma (face px) of the level-0 source. Returns
   * { tex, uv, off }: texture coords = face px · uv + off.
   */
  function gaussian(gl, dev, entry, pyramid, sigma, outName, W0, H0) {
    const level = blurLevel(sigma);
    const scale = 1 << level;
    const lw = W0 / scale;
    const lh = H0 / scale;
    const src = pyramid[level];
    // Box downsample (4^L - 1)/12 + bilinear upsample 4^L/6, in face px².
    const extra = level > 0 ? (scale * scale - 1) / 12 + (scale * scale) / 6 : 0;
    const s = Math.sqrt(Math.max(0, sigma * sigma - extra)) / scale;
    const tmp = target(gl, entry, "tmp", W0 + 2, H0 + 2);
    const out = target(gl, entry, outName, W0 + 2, H0 + 2);
    if (!tmp || !out) return null;
    const prog = entry.blur;
    gl.useProgram(prog.program);
    gl.uniform1i(prog.u.uTex, 0);
    gl.uniform1f(prog.u.uSigma, Math.max(1e-3, s));
    gl.uniform1f(prog.u.uRadius, Math.min(MAX_TAPS_RADIUS, Math.ceil(3 * s)));
    gl.activeTexture(gl.TEXTURE0);
    // Horizontal: level source (no margin) → tmp (1px margin).
    bindTarget(gl, tmp, lw + 2, lh + 2);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(prog.u.uTexSize, src.w, src.h);
    gl.uniform1f(prog.u.uInOffset, 0);
    gl.uniform2f(prog.u.uInMin, 0, 0);
    gl.uniform2f(prog.u.uInMax, lw, lh);
    gl.uniform2f(prog.u.uAxis, 1, 0);
    drawQuad(gl, dev, prog);
    // Vertical: tmp → out (both with margin).
    bindTarget(gl, out, lw + 2, lh + 2);
    gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
    gl.uniform2f(prog.u.uTexSize, tmp.w, tmp.h);
    gl.uniform1f(prog.u.uInOffset, 1);
    gl.uniform2f(prog.u.uInMin, -1, -1);
    gl.uniform2f(prog.u.uInMax, lw + 1, lh + 1);
    gl.uniform2f(prog.u.uAxis, 0, 1);
    drawQuad(gl, dev, prog);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return {
      tex: out.tex,
      uv: [1 / (scale * out.w), 1 / (scale * out.h)],
      off: [1 / out.w, 1 / out.h],
    };
  }

  /**
   * Source pass: nearest texel -> grade LUT -> hue, into the bound target
   * (face px cw x ch, image at dest). Shared by the face present and the 📺 out.
   */
  function sourcePass(gl, dev, entry, srcTex, lut, grade, buf, face, dest, flipY) {
    const sp = entry.source;
    gl.useProgram(sp.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(sp.u.uRaw, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lut);
    gl.uniform1i(sp.u.uLut, 1);
    gl.uniform2f(sp.u.uBuf, buf[0], buf[1]);
    gl.uniform2f(sp.u.uFace, face[0], face[1]);
    gl.uniform4f(sp.u.uDest, dest[0], dest[1], dest[2], dest[3]);
    gl.uniform1f(sp.u.uFlipY, flipY ? 1 : 0);
    const hue = nodeGraphFiniteNumber(grade?.hue);
    gl.uniform1f(sp.u.uHue, Math.abs(hue) > 1e-9 ? hue : 0);
    drawQuad(gl, dev, sp);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * 📺 out: the graded grid (grade LUT + hue, no blur / glow / plate) at grid
   * resolution into the node's published picture (nodeGraphPictureExportTarget,
   * FBO convention: row 0 = bottom). The caller only asks when a cable reads
   * it. With an fBm picture on R/G/B the passthrough picture is what goes out,
   * as on the face. Returns false on GL failure.
   */
  function nodeGraphRasterRgbGlExport(nodeId, state, grade, opts = {}) {
    const picTex = opts.sourceTex || null;
    const usePic = Boolean(picTex) && (opts.sourceW | 0) > 0 && (opts.sourceH | 0) > 0;
    if (!usePic && !state) return false;
    const bufW = usePic ? (opts.sourceW | 0) : (state.width | 0);
    const bufH = usePic ? (opts.sourceH | 0) : (state.height | 0);
    const dev = nodeGraphPictureDevice();
    const gl = dev?.gl;
    if (!gl || gl.isContextLost() || !bufW || !bufH) return false;
    const entry = entryFor(dev);
    if (!entry) return false;
    const out = nodeGraphPictureExportTarget(nodeId, bufW, bufH);
    if (!out?.framebuffer) return false;
    try {
      const g = syncLut(gl, state || { width: bufW, height: bufH }, grade);
      const grid = usePic ? null : gridFor(gl, state);
      if (!usePic && !grid) return false;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.enable(gl.SCISSOR_TEST);
      bindTarget(gl, { fbo: out.framebuffer }, bufW, bufH);
      sourcePass(gl, dev, entry, usePic ? picTex : grid.tex, g.lut, grade, [bufW, bufH], [bufW, bufH], [0, 0, bufW, bufH], usePic);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return !gl.isContextLost();
    } catch (err) {
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      console.error("[raster-rgb-gl] 📺 export failed", err);
      return false;
    }
  }

  /** True when this face can present through the shared device. */
  function nodeGraphRasterRgbGlUsable(cw, ch) {
    const dev = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!dev?.gl || !dev.canvas || dev.gl.isContextLost()) return false;
    const entry = entryFor(dev);
    if (!entry) return false;
    return cw >= 1 && ch >= 1 && cw <= dev.canvas.width && ch <= dev.canvas.height
      && cw <= entry.maxTex && ch <= entry.maxTex;
  }

  /**
   * opts: { cw, ch, dx, dy, dw, dh, blurPx, glowPx, plate } — the same numbers
   * the Canvas2D present uses. Returns false when the caller must fall back.
   */
  function nodeGraphRasterRgbGlPresent(state, grade, destCtx, opts) {
    if (!destCtx || !opts) return false;
    const picTex = opts.sourceTex || null;
    const picW = opts.sourceW | 0;
    const picH = opts.sourceH | 0;
    const usePic = Boolean(picTex) && picW > 0 && picH > 0;
    if (!usePic && !state) return false;
    const cw = opts.cw | 0;
    const ch = opts.ch | 0;
    const bufW = usePic ? picW : (state.width | 0);
    const bufH = usePic ? picH : (state.height | 0);
    if (!bufW || !bufH || !nodeGraphRasterRgbGlUsable(cw, ch)) return false;
    const dev = nodeGraphPictureDevice();
    const gl = dev.gl;
    const entry = entryFor(dev);
    if (!entry) return false;
    try {
      // Same tests and the same 2-decimal sigma as the ctx.filter strings.
      const blurOn = opts.blurPx > 0.05;
      const glowOn = grade.glow > 0.001 && opts.glowPx > 0.05;
      const blurSigma = blurOn ? Number(opts.blurPx.toFixed(2)) : 0;
      const glowSigma = glowOn ? Number(opts.glowPx.toFixed(2)) : 0;
      const levels = Math.max(blurOn ? blurLevel(blurSigma) : 0, glowOn ? blurLevel(glowSigma) : 0);
      const unit = 1 << levels;
      // Level-0 region padded to a multiple of 2^levels so every 2×2 box
      // stays inside written (transparent) pixels.
      const W0 = Math.ceil(cw / unit) * unit;
      const H0 = Math.ceil(ch / unit) * unit;
      const g = syncLut(gl, state || { width: bufW, height: bufH }, grade);
      const grid = usePic ? null : gridFor(gl, state);
      if (!usePic && !grid) return false;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.enable(gl.SCISSOR_TEST);

      // 1. Source: grade + hue + nearest placement.
      const src = target(gl, entry, "src", W0, H0);
      if (!src) return false;
      bindTarget(gl, src, W0, H0);
      sourcePass(gl, dev, entry, usePic ? picTex : grid.tex, g.lut, grade, [bufW, bufH], [cw, ch], [opts.dx, opts.dy, opts.dw, opts.dh], usePic);

      // 2. Pyramid (only as deep as the widest sigma needs), then blur / glow.
      const pyramid = [src];
      const dp = entry.down;
      for (let k = 1; k <= levels; k += 1) {
        const prev = pyramid[k - 1];
        const t = target(gl, entry, `lvl${k}`, W0 >> k, H0 >> k);
        if (!t) return false;
        bindTarget(gl, t, W0 >> k, H0 >> k);
        gl.useProgram(dp.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prev.tex);
        gl.uniform1i(dp.u.uTex, 0);
        gl.uniform2f(dp.u.uTexSize, prev.w, prev.h);
        drawQuad(gl, dev, dp);
        pyramid.push(t);
      }
      let image = { tex: src.tex, uv: [1 / src.w, 1 / src.h], off: [0, 0] };
      if (blurOn) {
        image = gaussian(gl, dev, entry, pyramid, blurSigma, "blurOut", W0, H0);
        if (!image) return false;
      }
      let glow = null;
      if (glowOn) {
        glow = gaussian(gl, dev, entry, pyramid, glowSigma, "glowOut", W0, H0);
        if (!glow) return false;
      }

      // 3. Composite into the shared canvas (bottom-left cw×ch).
      bindTarget(gl, null, cw, ch);
      const cp = entry.composite;
      gl.useProgram(cp.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, image.tex);
      gl.uniform1i(cp.u.uImage, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glow ? glow.tex : image.tex);
      gl.uniform1i(cp.u.uGlow, 1);
      gl.uniform2f(cp.u.uImageUv, image.uv[0], image.uv[1]);
      gl.uniform2f(cp.u.uImageOff, image.off[0], image.off[1]);
      gl.uniform2f(cp.u.uGlowUv, glow ? glow.uv[0] : 0, glow ? glow.uv[1] : 0);
      gl.uniform2f(cp.u.uGlowOff, glow ? glow.off[0] : 0, glow ? glow.off[1] : 0);
      gl.uniform1f(cp.u.uGlowAlpha, glow ? grade.glow : 0);
      const plate = parsePlate(opts.plate);
      gl.uniform3f(cp.u.uPlate, plate[0], plate[1], plate[2]);
      drawQuad(gl, dev, cp);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.SCISSOR_TEST);
      if (gl.isContextLost()) return false;

      destCtx.filter = "none";
      nodeGraphDisplayCanvasBlit(destCtx, dev.canvas, 0, dev.canvas.height - ch, cw, ch, 0, 0, cw, ch, false);
      return true;
    } catch (err) {
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      console.error("[raster-rgb-gl] present failed; face shows black", err);
      return false;
    }
  }

  global.nodeGraphRasterRgbGlUsable = nodeGraphRasterRgbGlUsable;
  global.nodeGraphRasterRgbGlPresent = nodeGraphRasterRgbGlPresent;
  global.nodeGraphRasterRgbGlScan = nodeGraphRasterRgbGlScan;
  global.nodeGraphRasterRgbGlExport = nodeGraphRasterRgbGlExport;
  global.nodeGraphRasterRgbGlFree = nodeGraphRasterRgbGlFree;
  global.nodeGraphRasterRgbGlReadGrid = nodeGraphRasterRgbGlReadGrid;
})(typeof globalThis !== "undefined" ? globalThis : window);
