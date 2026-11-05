// Clinical line drawer for soemdsp-sandbox faces (SinCos / BLIT / DSF / SinCos4).
// Adapt Max (caller may pre-sample) + SSAA 4× MAX coverage + Expo falloff.
// Uses the shared picture-device WebGL2, then blits into the face's 2D canvas
// (same present path as gl-line-renderer). Does not replace cycle-line-gl —
// clock / logic / pulse / ellipsoid / basicShape keep that presenter.
//
// Coordinates: CSS pixels, origin top-left, y down (same as cycle-line-gl).
//   nodeGraphClinicalLineGlPresent(canvas, {
//     cssWidth, cssHeight, background, waveKey?,
//     polylines: [{ points:Float32Array|number[] x0,y0,x1,y1,..., color, width }],
//     columns: [{ x, yMin, yMax, color, width }] per-pixel envelopes,
//     dots: [{ x, y, color, radius }],
//   })
// Thickness is full stroke width in CSS px at the face's circuit-builder size;
// in canvas view / screen solo thickness and dots scale with the face, while
// smoothing (antialiasing) stays in CSS px. Expo blur defaults to 1.2 CSS px;
// faces pass their Line blur (stored as lineSmoothing).

(function initNodeGraphClinicalLineGl(global) {
  "use strict";

  const SSAA = 4;
  const DEFAULT_BLUR = 1.2;
  const MAX_DIM = 4096;

  const SEG_VS = `#version 300 es
in vec4 aSeg;
uniform vec2 uFbo;
uniform float uScale;
uniform float uReach;
out vec2 vPos;
flat out vec4 vSeg;
void main() {
  vec4 s = aSeg * uScale;
  vec2 p0 = s.xy, p1 = s.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 u = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 pos = mix(p0 - u * uReach, p1 + u * uReach, c.x) + n * uReach * (c.y * 2.0 - 1.0);
  vPos = pos; vSeg = s;
  gl_Position = vec4(pos.x / uFbo.x * 2.0 - 1.0, 1.0 - pos.y / uFbo.y * 2.0, 0.0, 1.0);
}`;

  // Expo falloff only (clinical). Coverage in .r for MAX blend.
  // Outer skirt (AA Blur experiment, "Outer (solid core)"): coverage is 1 out
  // to the stroke's half width and the blur fades outside it, so smoothing
  // never eats into the line and more smoothing only softens the edge.
  const SEG_FS = `#version 300 es
precision highp float;
in vec2 vPos;
flat in vec4 vSeg;
uniform float uHalf;
uniform float uBlur;
out vec4 outColor;
float expoCover(float d, float halfW, float blur) {
  float a = halfW;
  float b = halfW + blur;
  float t = clamp((d - a) / max(b - a, 1e-8), 0.0, 1.0);
  float e = 1.0 - exp(-3.0 * t);
  float e1 = 1.0 - exp(-3.0);
  float s = e / max(e1, 1e-8);
  return 1.0 - s;
}
void main() {
  vec2 a = vSeg.xy;
  vec2 ba = vSeg.zw - a;
  vec2 pa = vPos - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  float d = length(pa - ba * h);
  float c = expoCover(d, uHalf, uBlur);
  outColor = vec4(c, 0.0, 0.0, 1.0);
}`;

  const DOT_VS = `#version 300 es
in vec4 aDot; // xy center (device px), z radius, w unused
uniform vec2 uFbo;
uniform float uScale;
uniform float uReach;
out vec2 vPos;
flat out vec3 vDot; // xy center, z radius (device)
void main() {
  vec2 c = aDot.xy * uScale;
  float r = aDot.z * uScale;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 pos = c + (corner * 2.0 - 1.0) * uReach;
  vPos = pos;
  vDot = vec3(c, r);
  gl_Position = vec4(pos.x / uFbo.x * 2.0 - 1.0, 1.0 - pos.y / uFbo.y * 2.0, 0.0, 1.0);
}`;

  const DOT_FS = `#version 300 es
precision highp float;
in vec2 vPos;
flat in vec3 vDot;
uniform float uBlur;
out vec4 outColor;
void main() {
  float d = length(vPos - vDot.xy);
  float halfW = vDot.z;
  float a = halfW;
  float b = halfW + uBlur;
  float t = clamp((d - a) / max(b - a, 1e-8), 0.0, 1.0);
  float e = 1.0 - exp(-3.0 * t);
  float e1 = 1.0 - exp(-3.0);
  float s = e / max(e1, 1e-8);
  outColor = vec4(1.0 - s, 0.0, 0.0, 1.0);
}`;

  const COMP_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uCov;
uniform int uS;
uniform vec3 uInk;
uniform int uPremul; // 1: out (ink*c, c) for over; 0: opaque mix with uBg
uniform vec3 uBg;
out vec4 outColor;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * uS;
  float acc = 0.0;
  for (int j = 0; j < 4; j++)
    for (int i = 0; i < 4; i++)
      if (i < uS && j < uS) acc += texelFetch(uCov, base + ivec2(i, j), 0).r;
  acc /= float(uS * uS);
  acc = clamp(acc, 0.0, 1.0);
  if (uPremul == 1) {
    outColor = vec4(uInk * acc, acc);
  } else {
    outColor = vec4(mix(uBg, uInk, acc), 1.0);
  }
}`;

  let cache = null;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "shader compile");
    }
    return sh;
  }
  function link(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || "link");
    }
    return p;
  }
  function uni(gl, p, names) {
    const o = {};
    for (const n of names) o[n] = gl.getUniformLocation(p, n);
    return o;
  }

  function cssColor(c) {
    if (Array.isArray(c)) {
      return [+c[0] || 0, +c[1] || 0, +c[2] || 0, c.length > 3 ? +c[3] : 1];
    }
    if (typeof c === "string" && typeof global.nodeGraphGlLinesCss === "function") {
      return global.nodeGraphGlLinesCss(c);
    }
    if (typeof c === "string") {
      const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
      if (m) {
        const n = parseInt(m[1], 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
      }
    }
    return [1, 1, 1, 1];
  }

  function ensure(gl) {
    if (cache && cache.gl === gl) return cache;
    const segProg = link(gl, SEG_VS, SEG_FS);
    const dotProg = link(gl, DOT_VS, DOT_FS);
    const compProg = link(gl, COMP_VS, COMP_FS);
    const segVao = gl.createVertexArray();
    const segBuf = gl.createBuffer();
    gl.bindVertexArray(segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    const aSeg = gl.getAttribLocation(segProg, "aSeg");
    gl.enableVertexAttribArray(aSeg);
    gl.vertexAttribPointer(aSeg, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(aSeg, 1);
    const dotVao = gl.createVertexArray();
    const dotBuf = gl.createBuffer();
    gl.bindVertexArray(dotVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
    const aDot = gl.getAttribLocation(dotProg, "aDot");
    gl.enableVertexAttribArray(aDot);
    gl.vertexAttribPointer(aDot, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(aDot, 1);
    gl.bindVertexArray(null);
    cache = {
      gl,
      segProg,
      dotProg,
      compProg,
      uSeg: uni(gl, segProg, ["uFbo", "uScale", "uReach", "uHalf", "uBlur"]),
      uDot: uni(gl, dotProg, ["uFbo", "uScale", "uReach", "uBlur"]),
      uComp: uni(gl, compProg, ["uCov", "uS", "uInk", "uBg", "uPremul"]),
      segVao,
      segBuf,
      dotVao,
      dotBuf,
      emptyVao: gl.createVertexArray(),
      cov: null,
      colorFbo: null,
    };
    return cache;
  }

  function ensureCov(st, w, h) {
    const gl = st.gl;
    if (!st.cov) st.cov = { tex: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 };
    if (st.cov.w === w && st.cov.h === h) return;
    gl.bindTexture(gl.TEXTURE_2D, st.cov.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.cov.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.cov.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    st.cov.w = w; st.cov.h = h;
  }

  function ensureColor(st, w, h) {
    const gl = st.gl;
    if (!st.colorFbo) st.colorFbo = { tex: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 };
    if (st.colorFbo.w === w && st.colorFbo.h === h) return;
    gl.bindTexture(gl.TEXTURE_2D, st.colorFbo.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.colorFbo.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.colorFbo.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    st.colorFbo.w = w; st.colorFbo.h = h;
  }

  // Arc-length Adapt Max resample of a CSS-space polyline (x0,y0,x1,y1,... interleaved points).
  function adaptPoints(pts, outCount) {
    const n = (pts.length / 2) | 0;
    if (n < 2) return pts;
    outCount = Math.max(2, outCount | 0);
    const dist = new Float64Array(n);
    dist[0] = 0;
    for (let i = 1; i < n; i++) {
      dist[i] = dist[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    }
    const total = dist[n - 1] || 1;
    const out = new Float32Array(outCount * 2);
    let j = 0;
    for (let i = 0; i < outCount; i++) {
      const target = total * (i / (outCount - 1));
      while (j < n - 2 && dist[j + 1] < target) j++;
      const d0 = dist[j], d1 = dist[j + 1];
      const a = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
      out[i * 2] = pts[j * 2] + (pts[j * 2 + 2] - pts[j * 2]) * a;
      out[i * 2 + 1] = pts[j * 2 + 1] + (pts[j * 2 + 3] - pts[j * 2 + 1]) * a;
    }
    return out;
  }

  function pointsToSegs(pts) {
    const n = (pts.length / 2) | 0;
    if (n < 2) return new Float32Array(0);
    const segs = new Float32Array((n - 1) * 4);
    let o = 0;
    for (let i = 0; i < n - 1; i++) {
      segs[o++] = pts[i * 2]; segs[o++] = pts[i * 2 + 1];
      segs[o++] = pts[i * 2 + 2]; segs[o++] = pts[i * 2 + 3];
    }
    return segs;
  }

  function drawCoverage(st, segs, W, H, halfCss, blurCss, scale) {
    const gl = st.gl;
    const S = SSAA;
    const FW = W * S, FH = H * S;
    const half = halfCss * scale;
    const blur = Math.max(blurCss, 0.05) * scale;
    const reach = half + blur + 1.5;
    const n = segs.length / 4;
    ensureCov(st, FW, FH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.cov.fbo);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, FW, FH);
    // Caller clears coverage when starting an ink pass.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(st.segProg);
    gl.bindVertexArray(st.segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, segs, gl.STREAM_DRAW);
    gl.uniform2f(st.uSeg.uFbo, FW, FH);
    gl.uniform1f(st.uSeg.uScale, S);
    gl.uniform1f(st.uSeg.uReach, reach * S);
    gl.uniform1f(st.uSeg.uHalf, half * S);
    gl.uniform1f(st.uSeg.uBlur, blur * S);
    if (n > 0) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function drawDotCoverage(st, dots, W, H, blurCss, scale) {
    const gl = st.gl;
    if (!dots.length) return;
    const S = SSAA;
    const FW = W * S, FH = H * S;
    const blur = Math.max(blurCss, 0.05) * scale;
    const data = new Float32Array(dots.length * 4);
    let maxR = 0;
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      data[i * 4] = d.x;
      data[i * 4 + 1] = d.y;
      data[i * 4 + 2] = Math.max(0.5, d.radius);
      data[i * 4 + 3] = 0;
      if (data[i * 4 + 2] > maxR) maxR = data[i * 4 + 2];
    }
    const reach = maxR + blur + 1.5;
    ensureCov(st, FW, FH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.cov.fbo);
    gl.viewport(0, 0, FW, FH);
    // Keep existing coverage (lines already drawn) — do not clear.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(st.dotProg);
    gl.bindVertexArray(st.dotVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.dotBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.uniform2f(st.uDot.uFbo, FW, FH);
    gl.uniform1f(st.uDot.uScale, S);
    gl.uniform1f(st.uDot.uReach, reach * S);
    gl.uniform1f(st.uDot.uBlur, blur * S);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dots.length);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function compositeToColor(st, W, H, ink, bg) {
    const gl = st.gl;
    ensureColor(st, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.colorFbo.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(st.compProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.cov.tex);
    gl.uniform1i(st.uComp.uCov, 0);
    gl.uniform1i(st.uComp.uS, SSAA);
    gl.uniform3f(st.uComp.uInk, ink[0], ink[1], ink[2]);
    gl.uniform3f(st.uComp.uBg, bg[0], bg[1], bg[2]);
    gl.bindVertexArray(st.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function blitColorToFace(st, canvas, W, H) {
    const gl = st.gl;
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    if (!dev?.canvas || !dev.program || !dev.quad) return false;
    // Land color FBO into the shared device's bottom-left present rect, then copy to the face 2D canvas.
    if (typeof global.nodeGraphSharedGlBindPresent === "function") {
      global.nodeGraphSharedGlBindPresent(gl, W, H);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(dev.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, dev.quad);
    if (dev.aPos >= 0) {
      gl.enableVertexAttribArray(dev.aPos);
      gl.vertexAttribPointer(dev.aPos, 2, gl.FLOAT, false, 0, 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.colorFbo.tex);
    if (dev.uTexture != null) gl.uniform1i(dev.uTexture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (typeof global.nodeGraphSharedGlEndPresent === "function") {
      global.nodeGraphSharedGlEndPresent(gl);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (typeof global.nodeGraphSharedGlBlitTo2D === "function") {
      return global.nodeGraphSharedGlBlitTo2D(ctx, W, H, { replace: true }) !== false;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(dev.canvas, 0, Math.max(0, dev.canvas.height - H), W, H, 0, 0, W, H);
    return true;
  }

  function nodeGraphClinicalLineGlPresent(canvas, frame = {}) {
    if (!canvas) return false;
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    const gl = dev?.gl;
    if (!gl || gl.isContextLost?.()) {
      if (typeof global.nodeGraphDisplayGlFailed === "function") {
        global.nodeGraphDisplayGlFailed(canvas, "clinical line: no shared GL device");
      }
      return false;
    }
    let st;
    try { st = ensure(gl); }
    catch (err) {
      if (typeof global.nodeGraphDisplayGlFailed === "function") {
        global.nodeGraphDisplayGlFailed(canvas, "clinical line: " + (err?.message || err));
      }
      return false;
    }

    const cssWidth = Math.max(1, Number(frame.cssWidth) || canvas.clientWidth || 1);
    const cssHeight = Math.max(1, Number(frame.cssHeight) || canvas.clientHeight || 1);
    const scale = Math.max(1e-6, canvas.width / cssWidth);
    const W = Math.max(1, Math.min(MAX_DIM, canvas.width | 0));
    const H = Math.max(1, Math.min(MAX_DIM, canvas.height | 0));
    const bg = cssColor(frame.background || "#020609");
    // The circuit builder face is the source of truth for ink size. A face
    // shown bigger or smaller in canvas view / screen solo keeps the same
    // relative line width and dot size: ink x (now / builder). Smoothing is
    // antialiasing, so it stays the set number of pixels at every size.
    const minCss = Math.min(cssWidth, cssHeight);
    const presented = typeof canvas.closest === "function" && canvas.closest(".node-screen-solo-face");
    if (!presented) canvas.__clinicalBuilderMinCss = minCss;
    const builderMin = Number(canvas.__clinicalBuilderMinCss);
    const ink = presented && builderMin > 0 ? minCss / builderMin : 1;
    const blurCss = Number.isFinite(Number(frame.blur)) ? Math.max(0.05, Number(frame.blur)) : DEFAULT_BLUR;

    // Build per-ink segment lists (CSS-space segs).
    const byColor = new Map();
    // Per-pixel min/max envelopes (Gibbs denser than a pixel stays bright).
    for (const col of Array.isArray(frame.columns) ? frame.columns : []) {
      const xs = col && col.x;
      const y0 = col && col.yMin;
      const y1 = col && col.yMax;
      const n = Math.min(xs && xs.length || 0, y0 && y0.length || 0, y1 && y1.length || 0);
      if (n < 1) continue;
      const color = cssColor(col.color || "#ffffff");
      const key = color.slice(0, 3).map((x) => x.toFixed(4)).join(",");
      if (!byColor.has(key)) byColor.set(key, { color, segs: [], half: 0, dots: [] });
      const g = byColor.get(key);
      g.half = Math.max(g.half, Math.max(0.02, (Number(col.width) || 1.5) * 0.5) * ink);
      const segs = new Float32Array(n * 4);
      let w = 0;
      for (let i = 0; i < n; i += 1) {
        const x = Number(xs[i]);
        let a = Number(y0[i]);
        let b = Number(y1[i]);
        if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (b < a) { const tmp = a; a = b; b = tmp; }
        if (!(b > a)) { a -= 0.35; b += 0.35; }
        segs[w] = x * scale; segs[w + 1] = a * scale;
        segs[w + 2] = x * scale; segs[w + 3] = b * scale;
        w += 4;
      }
      if (!w) continue;
      const slice = w === segs.length ? segs : segs.subarray(0, w);
      const merged = new Float32Array(g.segs.length + slice.length);
      merged.set(g.segs, 0);
      merged.set(slice, g.segs.length);
      g.segs = merged;
    }
    for (const line of Array.isArray(frame.polylines) ? frame.polylines : []) {
      if (!line?.points || line.points.length < 4) continue;
      // Thickness 0 = no line at all (no skirt either); dots still draw.
      const lineWidth = line.width == null ? 1.5 : Number(line.width);
      if (!(lineWidth > 0)) continue;
      let pts = line.points instanceof Float32Array ? line.points : Float32Array.from(line.points);
      // Same ceiling as AA Blur's sample count; below it every point is drawn.
      if ((pts.length / 2) > 120000) pts = adaptPoints(pts, 120000);
      // CSS px → device px (canvas.width / cssWidth).
      for (let i = 0; i < pts.length; i++) pts[i] *= scale;
      const segs = pointsToSegs(pts);
      if (!segs.length) continue;
      const color = cssColor(line.color || "#ffffff");
      const key = color.slice(0, 3).map((x) => x.toFixed(4)).join(",");
      // No width floor: sub-pixel thickness draws razor thin (AA Blur), the
      // 4x supersampling and the Expo skirt antialias it.
      if (!byColor.has(key)) byColor.set(key, { color, segs: [], half: 0, dots: [] });
      const g = byColor.get(key);
      g.half = Math.max(g.half, Math.max(0.02, lineWidth * 0.5) * ink);
      const merged = new Float32Array(g.segs.length + segs.length);
      merged.set(g.segs, 0); merged.set(segs, g.segs.length);
      g.segs = merged;
    }
    for (const dot of Array.isArray(frame.dots) ? frame.dots : []) {
      if (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) continue;
      const color = cssColor(dot.color || "#ffffff");
      const key = color.slice(0, 3).map((x) => x.toFixed(4)).join(",");
      if (!byColor.has(key)) byColor.set(key, { color, segs: new Float32Array(0), half: 0, dots: [] });
      byColor.get(key).dots.push({
        x: dot.x * scale, y: dot.y * scale,
        radius: Math.max(0.5, Number(dot.radius) || 0.5) * ink * scale,
        color,
      });
    }

    ensureColor(st, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.colorFbo.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    function overPremul(ink) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.colorFbo.fbo);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(st.compProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st.cov.tex);
      gl.uniform1i(st.uComp.uCov, 0);
      gl.uniform1i(st.uComp.uS, SSAA);
      gl.uniform3f(st.uComp.uInk, ink[0], ink[1], ink[2]);
      gl.uniform3f(st.uComp.uBg, 0, 0, 0);
      gl.uniform1i(st.uComp.uPremul, 1);
      gl.bindVertexArray(st.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    for (const g of byColor.values()) {
      // Clear coverage, stamp lines + dots of this ink, over onto plate.
      ensureCov(st, W * SSAA, H * SSAA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.cov.fbo);
      gl.viewport(0, 0, W * SSAA, H * SSAA);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (g.segs.length) drawCoverage(st, g.segs, W, H, g.half, blurCss, scale);
      if (g.dots.length) drawDotCoverage(st, g.dots, W, H, blurCss, scale);
      overPremul(g.color);
    }

    const ok = blitColorToFace(st, canvas, W, H);
    if (!ok && typeof global.nodeGraphDisplayGlFailed === "function") {
      global.nodeGraphDisplayGlFailed(canvas, "clinical line: blit failed");
    }
    canvas.__clinicalLineGl = { waveKey: `${frame.waveKey || ""}|${W}x${H}` };
    return ok;
  }

  // Adapt Max helper for callers building y=f(x) / parametric curves in CSS space.
  function nodeGraphClinicalLineAdaptPoints(points, outCount) {
    const pts = points instanceof Float32Array ? points : Float32Array.from(points);
    return adaptPoints(pts, outCount);
  }

  global.nodeGraphClinicalLineGlPresent = nodeGraphClinicalLineGlPresent;
  global.nodeGraphClinicalLineAdaptPoints = nodeGraphClinicalLineAdaptPoints;
  global.nodeGraphClinicalLineSSAA = SSAA;
  global.nodeGraphClinicalLineBlur = DEFAULT_BLUR;
})(typeof window !== "undefined" ? window : globalThis);
