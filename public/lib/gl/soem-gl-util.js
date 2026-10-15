/**
 * SoemGl -- shared WebGL helpers for display code (no per-file copies).
 *   SoemGl.link(gl, vs, fs, label)        compile + link, null on failure
 *   SoemGl.program(gl, key, vs, fs)       link once per (gl, key); cached
 *   SoemGl.quad(gl)                       shared fullscreen quad buffer (6 verts, xy in -1..1)
 *   SoemGl.drawQuad(gl, aPosLoc)          bind the quad and draw it
 *   SoemGl.watchContextLoss(canvas, onLost, onRestored)
 *                                         preventDefault on loss, drops this gl's caches
 *   SoemGl.GLSL_FULLSCREEN_VS             WebGL1-syntax vertex shader (aPos -> vUv)
 *   SoemGl.GLSL_HSL                       soemHueUnit / soemRgbToHsl / soemHslToRgb
 * Plain IIFE, no dependencies; loads early with soem-math.js.
 */
(function initSoemGl(global) {
  "use strict";

  const caches = new WeakMap(); // gl -> { programs: Map, quad: WebGLBuffer|null }

  function cacheFor(gl) {
    let c = caches.get(gl);
    if (!c) {
      c = { programs: new Map(), quad: null };
      caches.set(gl, c);
    }
    return c;
  }

  function compile(gl, type, source, label) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      if (!gl.isContextLost()) {
        console.warn(`[SoemGl] ${label || "shader"} compile failed`, gl.getShaderInfoLog(shader));
      }
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function link(gl, vsSource, fsSource, label) {
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource, label);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, label);
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
        console.warn(`[SoemGl] ${label || "program"} link failed`, gl.getProgramInfoLog(program));
      }
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function program(gl, key, vsSource, fsSource) {
    if (!gl) return null;
    const c = cacheFor(gl);
    if (c.programs.has(key)) return c.programs.get(key);
    const p = link(gl, vsSource, fsSource, key);
    if (p) c.programs.set(key, p);
    return p;
  }

  function quad(gl) {
    if (!gl) return null;
    const c = cacheFor(gl);
    if (c.quad) return c.quad;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    c.quad = buf;
    return buf;
  }

  function drawQuad(gl, aPosLoc) {
    if (!gl || aPosLoc == null || aPosLoc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad(gl));
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function forget(gl) {
    if (gl) caches.delete(gl);
  }

  /** Context-loss wiring: preventDefault (so restore can fire) + drop caches. */
  function watchContextLoss(canvas, gl, onLost, onRestored) {
    if (!canvas) return () => {};
    const lost = (event) => {
      event.preventDefault();
      forget(gl);
      if (typeof onLost === "function") onLost(event);
    };
    const restored = (event) => {
      forget(gl);
      if (typeof onRestored === "function") onRestored(event);
    };
    canvas.addEventListener("webglcontextlost", lost, false);
    canvas.addEventListener("webglcontextrestored", restored, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost, false);
      canvas.removeEventListener("webglcontextrestored", restored, false);
    };
  }

  const GLSL_FULLSCREEN_VS = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  // Shared hue / HSL maths (colour picker plane, Raster RGB hue rotate).
  // soemHueUnit: fully saturated hue (HSV c = 1) for hueDeg in degrees.
  // soemRgbToHsl / soemHslToRgb: CSS HSL, h in cycles (0..1). Port of
  // nodeGraphRasterRgbHueRotate's maths.
  const GLSL_HSL = `
vec3 soemHueUnit(float hueDeg) {
  float h = mod(mod(hueDeg, 360.0) + 360.0, 360.0);
  float hp = h / 60.0;
  float x = 1.0 - abs(mod(hp, 2.0) - 1.0);
  if (hp < 1.0) return vec3(1.0, x, 0.0);
  if (hp < 2.0) return vec3(x, 1.0, 0.0);
  if (hp < 3.0) return vec3(0.0, 1.0, x);
  if (hp < 4.0) return vec3(0.0, x, 1.0);
  if (hp < 5.0) return vec3(x, 0.0, 1.0);
  return vec3(1.0, 0.0, x);
}

float soemHslChannel(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 soemRgbToHsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0;
  float s = 0.0;
  if (d > 1e-9) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) {
      h = ((c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0)) / 6.0;
    } else if (mx == c.g) {
      h = ((c.b - c.r) / d + 2.0) / 6.0;
    } else {
      h = ((c.r - c.g) / d + 4.0) / 6.0;
    }
  }
  return vec3(h, s, l);
}

vec3 soemHslToRgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return clamp(vec3(
    soemHslChannel(p, q, h + 1.0 / 3.0),
    soemHslChannel(p, q, h),
    soemHslChannel(p, q, h - 1.0 / 3.0)
  ), 0.0, 1.0);
}
`;

  global.SoemGl = {
    link,
    program,
    quad,
    drawQuad,
    forget,
    watchContextLoss,
    GLSL_FULLSCREEN_VS,
    GLSL_HSL,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
