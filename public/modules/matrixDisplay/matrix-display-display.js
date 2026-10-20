// Asciiscope face: X/Y samples -> GPU phosphor grid -> glyph ramp. GPU only.
//
// Per frame, on the shared WebGL2 device (no per-cell JS, no readbacks):
//   1. live:    clear, then draw only this frame's NEW X/Y samples as 1px
//               points into a cols x rows target (MAX blend: hit cell = 1).
//   2. step:    energy' = max(energy * keep^frames, live * Bright * Burn)
//               on ping-pong float targets. keep is the shared
//               PhosphorResidual curve (Trail rate -> Ghost tail), frames is
//               elapsed time, so Ghost / Trail set decay only.
//   3. present: level = max(film(energy), live * Bright) picks the ramp glyph;
//               pixel = LUT(max(glyph coverage * level, Background)).
// Burn x is one multiply on the deposit. Bright scales the live line and the
// deposit; stored energy is never rescaled. No floor: energy fades to 0 and
// empty cells show Background Brightness.

const MATRIX_DISPLAY_GL_FONT = '"Cascadia Mono", Consolas, "Courier New", monospace';
const MATRIX_DISPLAY_MAX_POINTS = 8192;
const MATRIX_DISPLAY_MONO_DELAY = 32;
const MATRIX_DISPLAY_ATLAS_COLS = 16;
const MATRIX_DISPLAY_ATLAS_CELL_W = 32;
const MATRIX_DISPLAY_ATLAS_CELL_H = 48;
const MATRIX_DISPLAY_ATLAS_CACHE_MAX = 16;

/** nodeId -> { gl, cols, rows, read, write, live, xAbs, yAbs, residualStepMs } */
const matrixDisplayGpuStates = new Map();
/** gl -> linked programs + shared buffers (once per context) */
const matrixDisplayGlShared = new WeakMap();

const MATRIX_DISPLAY_VS_QUAD = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// x, y in -1..1 -> nearest cell centre (row 0 at the bottom, y up).
// Out-of-range samples land outside clip space and draw nothing.
const MATRIX_DISPLAY_VS_POINT = `#version 300 es
layout(location = 0) in vec2 aXY;
uniform vec2 uGrid;
void main() {
  gl_PointSize = 1.0;
  if (abs(aXY.x) > 1.0 || abs(aXY.y) > 1.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }
  vec2 cell = floor((aXY * 0.5 + 0.5) * (uGrid - 1.0) + 0.5);
  gl_Position = vec4((cell + 0.5) / uGrid * 2.0 - 1.0, 0.0, 1.0);
}`;

const MATRIX_DISPLAY_FS_POINT = `#version 300 es
precision mediump float;
out vec4 outColor;
void main() { outColor = vec4(1.0); }`;

// Decay + deposit. Also remaps on a density change (uFrames 0, uDeposit 0).
const MATRIX_DISPLAY_FS_STEP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPrev;
uniform sampler2D uLive;
uniform float uKeepFast;
uniform float uKeepSlow;
uniform float uFrames;
uniform float uDeposit;
out vec4 outColor;
void main() {
  float e = max(texture(uPrev, vUv).r, 0.0);
  float keepFast = clamp(uKeepFast, 0.0, 1.0);
  float keepSlow = max(keepFast, clamp(uKeepSlow, 0.0, 1.0));
  e *= pow(mix(keepSlow, keepFast, pow(clamp(e, 0.0, 1.0), 12.0)), max(uFrames, 0.0));
  e = max(e, texture(uLive, vUv).r * max(uDeposit, 0.0));
  outColor = vec4(e, 0.0, 0.0, 1.0);
}`;

const MATRIX_DISPLAY_FS_PRESENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uEnergy;
uniform sampler2D uLive;
uniform sampler2D uAtlas;
uniform sampler2D uLut;
uniform vec2 uGrid;
uniform vec2 uAtlasGrid;
uniform float uRampLen;
uniform float uBright;
uniform float uBackground;
out vec4 outColor;
float filmEnergy(float raw) { // same film curve as the Matrix faces
  float r = max(raw, 0.0);
  float lifted = r + 0.04 * pow(r, 0.42);
  return pow(clamp(1.0 - exp(-lifted * 2.35), 0.0, 1.0), 0.92);
}
${SoemGl.GLSL_DITHER}
void main() {
  vec2 gp = vUv * uGrid;
  ivec2 cell = ivec2(min(floor(gp), uGrid - 1.0));
  vec2 local = fract(gp);
  float e = texelFetch(uEnergy, cell, 0).r;
  float live = texelFetch(uLive, cell, 0).r * clamp(uBright, 0.0, 1.0);
  float level = max(filmEnergy(e), live);
  // Any level > 0 gets at least ramp glyph 1 (scaled by level below), so a
  // dim cell fades continuously instead of rounding to glyph 0 (blank).
  float gi = clamp(floor(level * (uRampLen - 1.0) + 0.5), 0.0, uRampLen - 1.0);
  if (level > 0.0) gi = max(gi, min(1.0, uRampLen - 1.0));
  float gx = mod(gi, uAtlasGrid.x);
  float gy = floor(gi / uAtlasGrid.x);
  vec2 lu = local * 0.92 + 0.04;
  // Atlas is baked top-down (UNPACK_FLIP_Y 0): tile top = gy / rows.
  vec2 uv = vec2((gx + lu.x) / uAtlasGrid.x, (gy + 1.0 - lu.y) / uAtlasGrid.y);
  vec3 s = texture(uAtlas, uv).rgb;
  float mono = max(s.r, max(s.g, s.b)) * level;
  float t = clamp(max(mono, clamp(uBackground, 0.0, 1.0)), 0.0, 1.0);
  vec3 c = texture(uLut, vec2((t * 255.0 + 0.5) / 256.0, 0.5)).rgb;
  outColor = vec4(soemDitherRgb(c, gl_FragCoord.xy), 1.0);
}`;

function matrixDisplayGlSharedFor(gl) {
  let shared = matrixDisplayGlShared.get(gl);
  if (shared) return shared.failed ? null : shared;
  const link = (vs, fs) => SoemGl.link(gl, vs, fs, "matrix-display-display.js");
  const point = link(MATRIX_DISPLAY_VS_POINT, MATRIX_DISPLAY_FS_POINT);
  const step = link(MATRIX_DISPLAY_VS_QUAD, MATRIX_DISPLAY_FS_STEP);
  const present = link(MATRIX_DISPLAY_VS_QUAD, MATRIX_DISPLAY_FS_PRESENT);
  if (!point || !step || !present) {
    for (const p of [point, step, present]) if (p) gl.deleteProgram(p);
    matrixDisplayGlShared.set(gl, { failed: true });
    return null;
  }
  const loc = (prog, names) => {
    const out = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  };
  const quadBuf = gl.createBuffer();
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const pointBuf = gl.createBuffer();
  const pointVao = gl.createVertexArray();
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MATRIX_DISPLAY_MAX_POINTS * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const lutTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, matrixDisplayPaletteLutRgba());
  gl.bindTexture(gl.TEXTURE_2D, null);

  shared = {
    point,
    step,
    present,
    uPoint: loc(point, ["uGrid"]),
    uStep: loc(step, ["uPrev", "uLive", "uKeepFast", "uKeepSlow", "uFrames", "uDeposit"]),
    uPresent: loc(present, ["uEnergy", "uLive", "uAtlas", "uLut", "uGrid", "uAtlasGrid", "uRampLen", "uBright", "uBackground"]),
    quadVao,
    pointVao,
    pointBuf,
    scratch: new Float32Array(MATRIX_DISPLAY_MAX_POINTS * 2),
    lutTex,
    atlases: new Map(), // glyph ramp -> { tex, cols, rows, len }
  };
  matrixDisplayGlShared.set(gl, shared);
  return shared;
}

function matrixDisplayAtlasFor(gl, shared, ramp) {
  const hit = shared.atlases.get(ramp);
  if (hit) return hit;
  const glyphs = Array.from(ramp);
  const cols = Math.min(MATRIX_DISPLAY_ATLAS_COLS, glyphs.length);
  const rows = Math.ceil(glyphs.length / cols);
  const canvas = nodeGraphDisplayCanvasBakeGlyphAtlas({
    glyphs,
    count: glyphs.length,
    cols,
    rows,
    cellW: MATRIX_DISPLAY_ATLAS_CELL_W,
    cellH: MATRIX_DISPLAY_ATLAS_CELL_H,
    fontPx: Math.floor(MATRIX_DISPLAY_ATLAS_CELL_H * 0.78),
    family: MATRIX_DISPLAY_GL_FONT,
    yFrac: 0.54,
    weight: 600,
  });
  if (!canvas) return null;
  if (shared.atlases.size >= MATRIX_DISPLAY_ATLAS_CACHE_MAX) {
    for (const a of shared.atlases.values()) gl.deleteTexture(a.tex);
    shared.atlases.clear();
  }
  // Same one-time atlas upload as the Matrix faces (asciiscope-gl.js).
  const tex = matrixGlUploadAtlas(gl, { canvas });
  gl.bindTexture(gl.TEXTURE_2D, null);
  const atlas = { tex, cols, rows, len: glyphs.length };
  shared.atlases.set(ramp, atlas);
  return atlas;
}

// Energy: no blend (decay copies). Live: MAX-blended points.
function matrixDisplayTarget(gl, cols, rows, blend) {
  return SoemGl.energyTarget(gl, cols, rows, { blend, filter: gl.NEAREST });
}

function matrixDisplayFreeTargets(gl, st) {
  for (const t of [st?.read, st?.write, st?.live]) {
    if (!t) continue;
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
  }
}

function matrixDisplayRunStep(gl, shared, prevTex, liveTex, dstFbo, cols, rows, keepFast, keepSlow, frames, deposit) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
  gl.viewport(0, 0, cols, rows);
  gl.useProgram(shared.step);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  gl.uniform1i(shared.uStep.uPrev, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, liveTex);
  gl.uniform1i(shared.uStep.uLive, 1);
  gl.uniform1f(shared.uStep.uKeepFast, keepFast);
  gl.uniform1f(shared.uStep.uKeepSlow, keepSlow);
  gl.uniform1f(shared.uStep.uFrames, frames);
  gl.uniform1f(shared.uStep.uDeposit, deposit);
  gl.bindVertexArray(shared.quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function matrixDisplayClearTarget(gl, target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/** Per-node GPU state at cols x rows; a density change remaps (no wipe). */
function matrixDisplayGpuState(gl, shared, nodeId, cols, rows) {
  let st = matrixDisplayGpuStates.get(nodeId);
  if (st && st.gl === gl && st.cols === cols && st.rows === rows) return st;
  const next = {
    gl,
    cols,
    rows,
    read: matrixDisplayTarget(gl, cols, rows, false),
    write: matrixDisplayTarget(gl, cols, rows, false),
    live: matrixDisplayTarget(gl, cols, rows, true),
    xAbs: st?.xAbs,
    yAbs: st?.yAbs,
    residualStepMs: st?.residualStepMs,
  };
  if (!next.read || !next.write || !next.live) {
    matrixDisplayFreeTargets(gl, next);
    return null;
  }
  if (st && st.gl === gl) {
    // Remap old energy into the new grid (frames 0, deposit 0).
    matrixDisplayRunStep(gl, shared, st.read.tex, next.live.tex, next.read.fbo, cols, rows, 1, 1, 0, 0);
    matrixDisplayFreeTargets(gl, st);
  }
  matrixDisplayGpuStates.set(nodeId, next);
  return next;
}

function matrixDisplayReadPortBuffer(nodeId, port) {
  try {
    const buffers = typeof nodeGraphModuleScopeState !== "undefined"
      ? nodeGraphModuleScopeState?.buffers
      : null;
    if (buffers?.get) {
      const keyed = buffers.get(`${nodeId}:${port}`);
      if (keyed?.length) return keyed;
    }
    // Same path as scope2d: follow wire to source node's output buffer.
    if (typeof nodeGraphModuleScopeConnectedSourceBuffer === "function") {
      const connected = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port);
      if (connected?.length) return connected;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

/** Samples written since the last frame (ring metadata), capped to the buffer. */
function matrixDisplayFreshCount(st, key, buf) {
  const abs = Number(buf.nodeGraphScopeAbsoluteFrame);
  if (!Number.isFinite(abs)) return buf.length;
  const last = st[key];
  st[key] = abs;
  if (!Number.isFinite(last) || abs < last) return buf.length;
  return Math.min(buf.length, abs - last);
}

/**
 * Interleave only this frame's new X/Y samples into the shared scratch.
 * One input: mono (v[i], v[i - 32]) so a single signal still draws a figure.
 */
function matrixDisplayCollectSamples(st, nodeId, scratch) {
  const xb = matrixDisplayReadPortBuffer(nodeId, "X");
  const yb = matrixDisplayReadPortBuffer(nodeId, "Y");
  const fin = (v) => (Number.isFinite(v) ? v : 9);
  if (xb?.length && yb?.length) {
    const nx = matrixDisplayFreshCount(st, "xAbs", xb);
    const ny = matrixDisplayFreshCount(st, "yAbs", yb);
    const n = Math.min(nx, ny, MATRIX_DISPLAY_MAX_POINTS);
    const xo = xb.length - n;
    const yo = yb.length - n;
    for (let i = 0; i < n; i += 1) {
      scratch[i * 2] = fin(xb[xo + i]);
      scratch[i * 2 + 1] = fin(yb[yo + i]);
    }
    return n;
  }
  const mono = xb?.length ? xb : yb;
  if (!mono?.length) return 0;
  const n = Math.min(matrixDisplayFreshCount(st, xb?.length ? "xAbs" : "yAbs", mono), MATRIX_DISPLAY_MAX_POINTS);
  const start = mono.length - n;
  for (let i = 0; i < n; i += 1) {
    const k = start + i;
    scratch[i * 2] = fin(mono[k]);
    scratch[i * 2 + 1] = fin(mono[Math.max(0, k - MATRIX_DISPLAY_MONO_DELAY)]);
  }
  return n;
}

function matrixDisplayResetGl(gl) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.useProgram(null);
  gl.disable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  for (let u = 3; u >= 0; u -= 1) {
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

/** Step + present one Asciiscope face. Returns true when drawn. */
function matrixDisplayDrawFace(canvas, nodeId, glyphRamp, params) {
  const host = canvas?.parentElement || canvas;
  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(host, canvas) : null;
  if (!m) return false;
  const w = Math.max(1, Math.min(4096, m.width));
  const h = Math.max(1, Math.min(4096, m.height));
  const fail = (why, error) => {
    nodeGraphDisplayGlFailed(canvas, `Asciiscope: ${why}`, error);
    return false;
  };
  const gl = typeof nodeGraphSharedGlDevice === "function" ? nodeGraphSharedGlDevice()?.gl : null;
  if (!gl || gl.isContextLost()) return fail("shared WebGL2 device unavailable");
  if (!(typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext)) {
    return fail("needs WebGL2");
  }
  const shared = matrixDisplayGlSharedFor(gl);
  if (!shared) return fail("GL program link failed");
  const grid = matrixResolveDensityGrid(params.density, w / h);
  const cols = Math.max(1, grid.columns | 0);
  const rows = Math.max(1, grid.rows | 0);
  try {
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    const st = matrixDisplayGpuState(gl, shared, nodeId, cols, rows);
    if (!st) {
      matrixDisplayResetGl(gl);
      return fail("render targets incomplete");
    }
    const atlas = matrixDisplayAtlasFor(gl, shared, glyphRamp);
    if (!atlas) {
      matrixDisplayResetGl(gl);
      return fail("glyph atlas unavailable");
    }
    if (!params.freeze) {
      // 1. live: this frame's new samples only.
      const count = matrixDisplayCollectSamples(st, nodeId, shared.scratch);
      gl.viewport(0, 0, cols, rows);
      matrixDisplayClearTarget(gl, st.live);
      if (count > 0) {
        gl.useProgram(shared.point);
        gl.uniform2f(shared.uPoint.uGrid, cols, rows);
        gl.bindVertexArray(shared.pointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, shared.pointBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, shared.scratch, 0, count * 2);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.disable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
      }
      // 2. decay + deposit (Bright x Burn: one multiply on the deposit).
      const keeps = PhosphorResidual.residualKeeps(params.trail, params.ghost);
      const frames = PhosphorResidual.stepFrames(st);
      matrixDisplayRunStep(
        gl, shared, st.read.tex, st.live.tex, st.write.fbo, cols, rows,
        keeps.keepFast, keeps.keepSlow, frames, params.brightness * params.burnAmount,
      );
      const swap = st.read;
      st.read = st.write;
      st.write = swap;
    } else {
      // Freeze holds the picture; resume steps one frame, not the pause.
      st.residualStepMs = undefined;
    }
    // 3. present.
    nodeGraphSharedGlBindPresent(gl, w, h);
    gl.useProgram(shared.present);
    const u = shared.uPresent;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.read.tex);
    gl.uniform1i(u.uEnergy, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, st.live.tex);
    gl.uniform1i(u.uLive, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
    gl.uniform1i(u.uAtlas, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, shared.lutTex);
    gl.uniform1i(u.uLut, 3);
    gl.uniform2f(u.uGrid, cols, rows);
    gl.uniform2f(u.uAtlasGrid, atlas.cols, atlas.rows);
    gl.uniform1f(u.uRampLen, atlas.len);
    gl.uniform1f(u.uBright, params.brightness);
    gl.uniform1f(u.uBackground, params.backgroundBrightness);
    gl.bindVertexArray(shared.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    nodeGraphSharedGlEndPresent(gl);
    matrixDisplayResetGl(gl);
    const ctx = nodeGraphDisplayCanvasPresentContext(canvas);
    if (!ctx || !nodeGraphSharedGlBlitTo2D(ctx, w, h)) return fail("present copy failed");
    return true;
  } catch (error) {
    try { matrixDisplayResetGl(gl); } catch (_) { /* context gone */ }
    return fail("draw failed", error);
  }
}

/** Zero the phosphor (UI "Clear trails"). */
function matrixDisplayClearTrails(nodeId) {
  const st = matrixDisplayGpuStates.get(String(nodeId));
  if (!st?.gl || st.gl.isContextLost()) return;
  const gl = st.gl;
  gl.disable(gl.SCISSOR_TEST);
  for (const t of [st.read, st.write, st.live]) matrixDisplayClearTarget(gl, t);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function matrixDisplayTickFace(face) {
  const nodeId = face?.dataset?.node;
  if (!nodeId || !face.isConnected) return;
  if (
    typeof nodeGraphElementInSkippedContentVisibility === "function"
    && nodeGraphElementInSkippedContentVisibility(face)
  ) {
    return;
  }
  // Scope system must not leave a Trace local-fallback canvas over this face.
  for (const overlay of face.querySelectorAll?.(
    ":scope > .node-module-scope-local-fallback-canvas",
  ) || []) {
    overlay.remove();
  }
  if (typeof nodeGraphModuleScopePersistentCanvases !== "undefined") {
    nodeGraphModuleScopePersistentCanvases.delete?.(nodeId);
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const canvas = face.querySelector(".node-matrix-display-canvas");
  if (!canvas) return;
  const store = normalizeNodeGraphMatrixDisplay(node?.asciiscope);
  matrixDisplayDrawFace(canvas, nodeId, store.glyphRamp, matrixDisplayParamsFromNode(node));
}

/** Free GPU state of faces that left the DOM. */
function matrixDisplayPruneStates(liveIds) {
  for (const [id, st] of matrixDisplayGpuStates) {
    if (liveIds.has(id)) continue;
    if (st.gl && !st.gl.isContextLost()) matrixDisplayFreeTargets(st.gl, st);
    matrixDisplayGpuStates.delete(id);
  }
}

let matrixDisplayRaf = 0;
function matrixDisplaySchedulePump() {
  if (matrixDisplayRaf) return;
  matrixDisplayRaf = window.requestAnimationFrame(() => {
    matrixDisplayRaf = 0;
    const faces = document.querySelectorAll(".node-matrix-display-face");
    if (!faces.length) {
      matrixDisplayPruneStates(new Set());
      return;
    }
    // Respect Simulation FPS (same clock as scopes / phosphor / LCD / LED).
    const frameReady = typeof nodeGraphDisplayFrameReady === "function"
      ? nodeGraphDisplayFrameReady("matrixDisplay")
      : true;
    if (frameReady && !(typeof nodeGraphDisplaysFrozen === "function" && nodeGraphDisplaysFrozen())) {
      const ids = new Set();
      for (const face of faces) {
        if (face.dataset?.node) ids.add(face.dataset.node);
        if (typeof nodeGraphScreenSoloAllowsNode === "function"
          && !nodeGraphScreenSoloAllowsNode(
            typeof nodeGraphDisplayNodeIdFromElement === "function"
              ? nodeGraphDisplayNodeIdFromElement(face)
              : face.closest?.(".dsp-node")?.dataset?.node,
          )) {
          continue;
        }
        matrixDisplayTickFace(face);
      }
      matrixDisplayPruneStates(ids);
    }
    matrixDisplaySchedulePump();
  });
}

function matrixDisplayStartPump() {
  matrixDisplaySchedulePump();
}

if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    matrixDisplayStartPump();
  });
}
