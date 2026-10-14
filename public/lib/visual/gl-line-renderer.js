// Shared WebGL line / fill renderer for module faces (Sabrina Reverb, Softpop).
//
// Draws on the shared picture device (public/lib/visual/picture-device.js,
// one hidden WebGL2 context) and blits the result into the face's own 2D
// canvas. The face canvas keeps the shared sizing path (backing = layout css
// x devicePixelRatio, never x workspace zoom) and its
// .node-module-scope-local-fallback-canvas class, so the styles.css
// .pixelated-canvas-zoom rule pixelates it above 2.5x zoom.
//
// Lines are shader-expanded quads (capsules): each vertex carries its local
// position along/across the segment, the fragment shader takes the distance
// to the segment and fades it over `feather` px past `halfPx`, exactly like
// the Sabrina Reverb CLAP plugin's kLineFrag:
//   a = 1 - smoothstep(halfPx, halfPx + feather, dist)
// so thickness never depends on fractional pixel position. Fills are the
// same quads with an infinite halfPx (solid).
//
// No WebGL2 (no device, context lost, shader failure): begin() returns null and
// the caller shows a plain black square (nodeGraphGlLinesFillBlack). No 2D drawing. Context loss: picture-device drops the
// device; the next begin() sees a new gl and rebuilds the program.

(function initNodeGraphGlLineRenderer(global) {
  const MAX_DIM = 4096;
  const FLOATS = 11; // pos2, local2, len1, half1, feather1, rgba4
  const VS = `
attribute vec2 position;
attribute vec2 local;
attribute float segLen;
attribute float halfPx;
attribute float feather;
attribute vec4 colour;
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying vec4 vColour;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  vLocal = local;
  vLen = segLen;
  vHalf = halfPx;
  vFeather = feather;
  vColour = colour;
}
`;
  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying vec4 vColour;
void main() {
  float u = vLocal.x;
  float d = u < 0.0 ? length(vLocal) : (u > vLen ? length(vec2(u - vLen, vLocal.y)) : abs(vLocal.y));
  float a = 1.0 - smoothstep(vHalf, vHalf + max(vFeather, 1e-4), d);
  gl_FragColor = vec4(vColour.rgb, vColour.a * a);
}
`;
  let state = null;
  let failedGl = null;

  function compile(gl, type, source) {
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

  function ensure() {
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    const gl = dev?.gl || null;
    if (!gl || typeof gl.createShader !== "function" || gl.isContextLost?.()) return null;
    if (state && state.gl === gl) return state;
    if (failedGl === gl) return null;
    try {
      const v = compile(gl, gl.VERTEX_SHADER, VS);
      const f = compile(gl, gl.FRAGMENT_SHADER, FS);
      const program = gl.createProgram();
      gl.attachShader(program, v);
      gl.attachShader(program, f);
      gl.linkProgram(program);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "link failed");
      }
      state = {
        gl,
        dev,
        program,
        buf: gl.createBuffer(),
        attribs: ["position", "local", "segLen", "halfPx", "feather", "colour"].map((n) => gl.getAttribLocation(program, n)),
      };
      return state;
    } catch (error) {
      failedGl = gl;
      state = null;
      console.warn("[gl-line-renderer] shader failed; faces show black", error);
      return null;
    }
  }

  /**
   * Start a frame for a face canvas (device px, y down).
   * @returns {object|null} batch, or null -> caller fills black.
   */
  function nodeGraphGlLinesBegin(canvas, clearRgba = [0, 0, 0, 1]) {
    if (!canvas) return null;
    const w = Math.max(1, canvas.width | 0);
    const h = Math.max(1, canvas.height | 0);
    if (w > MAX_DIM || h > MAX_DIM) return null;
    const s = ensure();
    if (!s) return null;
    return { s, canvas, w, h, clear: clearRgba, data: [], blend: "alpha" };
  }

  function push(batch, x, y, lu, lv, len, half, feather, c) {
    batch.data.push(
      (x / batch.w) * 2 - 1, 1 - (y / batch.h) * 2,
      lu, lv, len, half, feather,
      c[0], c[1], c[2], c.length > 3 ? c[3] : 1,
    );
  }

  /** Solid axis-aligned rect in device px. */
  function nodeGraphGlLinesRect(batch, x, y, w, h, rgba) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const big = 1e6;
    const q = [[x, y], [x + w, y], [x, y + h], [x + w, y], [x + w, y + h], [x, y + h]];
    for (const [px, py] of q) push(batch, px, py, 0, 0, 0, big, 0, rgba);
  }

  /**
   * Capsule segment (x0,y0)-(x1,y1) in device px: solid core halfPx, then
   * `feather` px of smoothstep fade (Sabrina kLineFrag). Round ends/joins.
   */
  function nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba) {
    if (!batch) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const ux = len > 1e-6 ? dx / len : 0;
    const uy = len > 1e-6 ? dy / len : 1;
    const nx = -uy;
    const ny = ux;
    const r = Math.max(0, halfPx) + Math.max(0, feather);
    const corner = (along, across) => [
      x0 + ux * along + nx * across,
      y0 + uy * along + ny * across,
      along,
      across,
    ];
    const a = corner(-r, -r);
    const b = corner(len + r, -r);
    const c = corner(-r, r);
    const d = corner(len + r, r);
    for (const v of [a, b, c, b, d, c]) push(batch, v[0], v[1], v[2], v[3], len, halfPx, feather, rgba);
  }

  /** Polyline as capsules (one continuous outline; joins are round). */
  function nodeGraphGlLinesPolyline(batch, points, halfPx, feather, rgba) {
    if (!batch || !points || points.length < 4) return;
    for (let i = 2; i < points.length; i += 2) {
      const x0 = points[i - 2]; const y0 = points[i - 1];
      const x1 = points[i]; const y1 = points[i + 1];
      if (x0 === x1 && y0 === y1 && i > 2) continue;
      nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba);
    }
  }

  /**
   * Draw the batch and blit it into the face's 2D canvas.
   * blend "add" = GL_SRC_ALPHA, GL_ONE (Sabrina plugin); "alpha" = normal over.
   * @returns {boolean} false -> caller fills black.
   */
  function nodeGraphGlLinesEnd(batch, blend = "alpha") {
    if (!batch) return false;
    const { s, w, h } = batch;
    const gl = s.gl;
    if (gl.isContextLost()) return false;
    const ctx = batch.canvas.getContext("2d");
    if (!ctx) return false;
    if (typeof global.nodeGraphSharedGlBindPresent === "function") {
      global.nodeGraphSharedGlBindPresent(gl, w, h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
    }
    if (gl.bindVertexArray) gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const cl = batch.clear || [0, 0, 0, 1];
    gl.clearColor(cl[0], cl[1], cl[2], cl.length > 3 ? cl[3] : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const count = batch.data.length / FLOATS;
    if (count > 0) {
      gl.enable(gl.BLEND);
      // Colour additive / over; alpha always accumulates to opaque.
      gl.blendFuncSeparate(gl.SRC_ALPHA, blend === "add" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
      gl.useProgram(s.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.data), gl.STREAM_DRAW);
      const sizes = [2, 2, 1, 1, 1, 4];
      let off = 0;
      for (let i = 0; i < sizes.length; i += 1) {
        const loc = s.attribs[i];
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, FLOATS * 4, off * 4);
        }
        off += sizes[i];
      }
      gl.drawArrays(gl.TRIANGLES, 0, count);
      for (const loc of s.attribs) if (loc >= 0) gl.disableVertexAttribArray(loc);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (typeof global.nodeGraphSharedGlEndPresent === "function") global.nodeGraphSharedGlEndPresent(gl);
    if (gl.isContextLost()) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (typeof global.nodeGraphSharedGlBlitTo2D === "function") {
      return global.nodeGraphSharedGlBlitTo2D(ctx, w, h) !== false;
    }
    ctx.drawImage(s.dev.canvas, 0, Math.max(0, s.dev.canvas.height - h), w, h, 0, 0, w, h);
    return true;
  }

  /** GL unavailable: plain black square (no 2D drawing fallback). */
  function nodeGraphGlLinesFillBlack(canvas) {
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const api = {
    nodeGraphGlLinesFillBlack,
    nodeGraphGlLinesBegin,
    nodeGraphGlLinesRect,
    nodeGraphGlLinesSegment,
    nodeGraphGlLinesPolyline,
    nodeGraphGlLinesEnd,
  };
  Object.assign(global, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
