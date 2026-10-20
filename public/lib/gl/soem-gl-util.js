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
 *   SoemGl.energyFormats(gl, {blend})     WebGL2 float accumulation formats, best first
 *   SoemGl.energyTarget(gl, w, h, opts)   texture + FBO in the best complete format
 *   SoemGl.lutCoord(t, width)             JS mirror of the GLSL texel-centre LUT coord
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

  // Accumulation (burn / trail / ghost / energy) render-target formats.
  // On WebGL2 float textures are core; the WebGL1 OES_texture_(half_)float
  // extensions return null, so pickers keyed on them silently fell back to
  // rgba8, where anything under 0.5/255 rounds to 0 (low Bright never
  // prints, then suddenly does) and slow decays stall into a floor.
  // 32F first: 16F has an 11-bit mantissa, so keep > ~0.9995 rounds back to
  // the same value. Blending into 32F needs EXT_float_blend; 16F always
  // blends. rgba8 is last (callers that keep it dither).
  function energyFormats(gl, options) {
    const blend = !options || options.blend !== false;
    const key = blend ? "_soemEnergyFormatsBlend" : "_soemEnergyFormatsNoBlend";
    if (gl[key]) return gl[key];
    const out = [];
    const gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    if (gl2) {
      const cbFloat = gl.getExtension("EXT_color_buffer_float");
      const cbHalf = cbFloat || gl.getExtension("EXT_color_buffer_half_float");
      const floatBlend = gl.getExtension("EXT_float_blend");
      const floatLinear = gl.getExtension("OES_texture_float_linear");
      if (cbFloat && (!blend || floatBlend)) {
        out.push({
          internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT,
          filter: floatLinear ? gl.LINEAR : gl.NEAREST, label: "rgba32f", quantizeBits: 0,
        });
      }
      if (cbHalf) {
        out.push({
          internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT,
          filter: gl.LINEAR, label: "rgba16f", quantizeBits: 0,
        });
      }
    }
    out.push({
      internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR, label: "rgba8", quantizeBits: 8,
    });
    gl[key] = out;
    return out;
  }

  /** Texture + FBO in the first complete energy format; cleared to 0. */
  function energyTarget(gl, w, h, options) {
    const width = Math.max(1, w | 0);
    const height = Math.max(1, h | 0);
    for (const fmt of energyFormats(gl, options)) {
      const filter = options && options.filter != null ? options.filter : fmt.filter;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, width, height, 0, fmt.format, fmt.type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return { tex, fbo, width, height, label: fmt.label, quantizeBits: fmt.quantizeBits, linear: fmt.filter === gl.LINEAR };
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return null;
  }

  // A 0..1 level must hit LUT texel centres: texture(uLut, vec2(t, .5))
  // clamps t < 0.5/W to texel 0, a dead zone where low levels all show the
  // floor colour. GLSL: (t * (W - 1.0) + 0.5) / W.
  function lutCoord(t, width) {
    const w = Math.max(1, width || 256);
    return (Math.max(0, Math.min(1, t)) * (w - 1) + 0.5) / w;
  }

  // Ordered 8x8 Bayer offset in (-0.5, 0.5) for 8-bit output dither: sub-LSB
  // levels average out instead of banding or vanishing. Exact k/255 colours
  // stay exact (|offset| < 0.5 LSB). 8x8 (not 4x4): the largest offset is
  // 0.492 LSB, so a level of 0.0001 (0.0255 LSB) still lights 2 of 64 pixels.
  const GLSL_DITHER = `
float soemDither(vec2 fragCoord) {
  vec2 p = mod(floor(fragCoord), 8.0);
  vec2 a = mod(p, 2.0);
  vec2 b = mod(floor(p * 0.5), 2.0);
  vec2 c = floor(p * 0.25);
  float v = 16.0 * mod(2.0 * a.x + 3.0 * a.y, 4.0)
    + 4.0 * mod(2.0 * b.x + 3.0 * b.y, 4.0)
    + mod(2.0 * c.x + 3.0 * c.y, 4.0);
  return (v + 0.5) / 64.0 - 0.5;
}
// Dither + quantise to exact k/255 in the shader: the GPU's own float->unorm8
// conversion is only specified to ~0.6 LSB (D3D), which swallowed sub-LSB
// dither (a 0.0001 level never lit a pixel). Exact k/255 inputs stay exact.
vec3 soemDitherRgb(vec3 c, vec2 fragCoord) {
  return floor(clamp(c, 0.0, 1.0) * 255.0 + soemDither(fragCoord) + 0.5) / 255.0;
}
`;
  // Largest soemDither offset below the rounding edge: an output change of
  // less than this many LSB can never flip an 8-bit pixel.
  const DITHER_INVISIBLE_LSB = 0.5 / 64;

  global.SoemGl = {
    energyFormats,
    energyTarget,
    lutCoord,
    GLSL_DITHER,
    DITHER_INVISIBLE_LSB,
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
