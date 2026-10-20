// Residual faces on the shared WebGL2 device (Phosphor Dot, Hypersaw stems).
// Load after node-graph-module-scope-draw-burn.js; needs SoemGl,
// nodeGraphSharedGlDevice (picture-device.js) and display-canvas.js at draw
// time.
//
// Each face keeps its picture in two float energy textures on the shared
// device (SoemGl.energyTarget: RGBA32F, RGBA16F, rgba8 last resort;
// ping-pong, premultiplied energy above the face background). A frame is:
//   decay    one full-plate pass read -> write, swap: the shared time-based
//            residual model (PhosphorResidual keeps, per texel on alpha)
//   deposit  batched quads blended into the read plate
//   present  plate over the face background (8x8 dither, exact k/255) into
//            the device present region, then one blit into the face canvas.
// The plate is the face's backing size (layout x dpr x workspace zoom x
// density), so everything scales with canvas zoom. There is no 2D drawing
// path: no device / program / FBO -> nodeGraphDisplayGlFailed (black plus one
// console.error per face and reason).

const NODE_GRAPH_RESIDUAL_FACE_KEY = "_faceResidualGl";

const NODE_GRAPH_RESIDUAL_FACE_DECAY_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform sampler2D uSrc;
  uniform vec2 uSize;
  uniform float uKeepFast;
  uniform float uKeepSlow;
  uniform float uFrames;
  uniform float uFloor8;
  void main() {
    vec4 t = texture2D(uSrc, gl_FragCoord.xy / uSize);
    // PhosphorResidual.applyResidual per texel (energy = alpha).
    float k = pow(mix(uKeepSlow, uKeepFast, pow(clamp(t.a, 0.0, 1.0), 12.0)), uFrames);
    if (uFloor8 > 0.5) {
      // rgba8 last resort: round toward 0 so dim texels never stall.
      gl_FragColor = floor(floor(t * 255.0 + 0.5) * k) / 255.0;
    } else {
      gl_FragColor = t * k;
    }
  }
`;

const NODE_GRAPH_RESIDUAL_FACE_PRESENT_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform sampler2D uSrc;
  uniform vec2 uSize;
  uniform vec3 uBg;
  ${SoemGl.GLSL_DITHER}
  void main() {
    vec4 p = texture2D(uSrc, gl_FragCoord.xy / uSize);
    // Premultiplied plate over the opaque face background.
    vec3 c = p.rgb + uBg * (1.0 - clamp(p.a, 0.0, 1.0));
    gl_FragColor = vec4(soemDitherRgb(c, gl_FragCoord.xy), 1.0);
  }
`;

// Batched quads in plate pixels (x right, y up = framebuffer rows).
const NODE_GRAPH_RESIDUAL_FACE_QUAD_VS = `
  attribute vec2 aPos;
  attribute vec4 aColor;
  attribute vec4 aParam;
  attribute vec2 aParam2;
  uniform vec2 uSize;
  varying vec4 vColor;
  varying vec4 vParam;
  varying vec2 vParam2;
  void main() {
    vColor = aColor;
    vParam = aParam;
    vParam2 = aParam2;
    gl_Position = vec4(aPos / uSize * 2.0 - 1.0, 0.0, 1.0);
  }
`;

// Hypersaw stem: column coverage exactly as the old per-column fills.
// vParam = (left, right, coreIx, alpha); vParam2 = (mode, aaW).
// mode 0: coverage of the pixel column, core column forced to 1.
// mode 1 (Sabrina taps): solid core + linear feather of aaW px.
const NODE_GRAPH_RESIDUAL_FACE_STEM_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec4 vColor;
  varying vec4 vParam;
  varying vec2 vParam2;
  void main() {
    float ix = floor(gl_FragCoord.x);
    float left = vParam.x;
    float right = vParam.y;
    float gain = 0.0;
    if (vParam2.x < 0.5) {
      gain = clamp(min(right, ix + 1.0) - max(left, ix), 0.0, 1.0);
      if (abs(ix - vParam.z) < 0.5) gain = 1.0;
    } else {
      float c = ix + 0.5;
      float aa = vParam2.y;
      if (c >= left && c <= right) {
        gain = 1.0;
      } else if (aa > 0.0 && c < left) {
        gain = max(0.0, 1.0 - (left - c) / aa);
      } else if (aa > 0.0) {
        gain = max(0.0, 1.0 - (c - right) / aa);
      }
    }
    float a = clamp(vParam.w * min(1.0, gain), 0.0, 1.0);
    // "lighter": premultiplied add (blend ONE, ONE).
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;

// Phosphor Dot stamp: TraceDotSprite circle kernel (hermite edge between
// inner / outer) tinted by its radial gradient c0 -> cm(t) -> c1.
// vParam = (cx, cy, inner, outer); vParam2 = (r0, r1).
const NODE_GRAPH_RESIDUAL_FACE_DOT_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec4 vColor;
  varying vec4 vParam;
  varying vec2 vParam2;
  uniform vec3 uC0;
  uniform vec3 uCm;
  uniform vec3 uC1;
  uniform float uMidT;
  void main() {
    float r = distance(gl_FragCoord.xy, vParam.xy);
    float span = max(1e-6, vParam.w - vParam.z);
    float h = clamp((r - vParam.z) / span, 0.0, 1.0);
    float mask = 1.0 - h * h * (3.0 - 2.0 * h);
    float u = clamp((r - vParam2.x) / max(1e-6, vParam2.y - vParam2.x), 0.0, 1.0);
    vec3 c;
    if (uMidT > 0.0 && uMidT < 1.0) {
      c = u <= uMidT ? mix(uC0, uCm, u / uMidT) : mix(uCm, uC1, (u - uMidT) / (1.0 - uMidT));
    } else {
      c = mix(uC0, uC1, u);
    }
    float a = clamp(mask * vColor.a, 0.0, 1.0);
    // source-over (blend ONE, ONE_MINUS_SRC_ALPHA).
    gl_FragColor = vec4(c * a, a);
  }
`;

const nodeGraphResidualFaceGlStats = { frames: 0, decays: 0, quads: 0, presents: 0 };

// Float energy target, blendable (deposits are additive / source-over).
function nodeGraphResidualFaceGlTarget(gl, w, h) {
  const t = SoemGl.energyTarget(gl, w, h, { blend: true, filter: gl.NEAREST });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t || null;
}

/** Drop a face's GPU plate (wipe / resize / context change). */
function nodeGraphResidualFaceGlDrop(canvas) {
  const st = canvas?.[NODE_GRAPH_RESIDUAL_FACE_KEY];
  if (!st) return;
  canvas[NODE_GRAPH_RESIDUAL_FACE_KEY] = null;
  const gl = st.gl;
  if (!gl || gl.isContextLost()) return;
  for (const t of [st.read, st.write]) {
    if (t?.fbo) gl.deleteFramebuffer(t.fbo);
    if (t?.tex) gl.deleteTexture(t.tex);
  }
  if (st.vbo) gl.deleteBuffer(st.vbo);
}

/** Ping-pong plate for this face at its backing size, or null (no GL). */
function nodeGraphResidualFaceGlPlate(canvas, kind) {
  if (!canvas || typeof nodeGraphSharedGlDevice !== "function" || typeof SoemGl === "undefined") {
    return null;
  }
  const dev = nodeGraphSharedGlDevice();
  const gl = dev?.gl;
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  if (!gl || gl.isContextLost() || w < 1 || h < 1 || w > dev.canvas.width || h > dev.canvas.height) {
    return null;
  }
  let st = canvas[NODE_GRAPH_RESIDUAL_FACE_KEY] || null;
  if (st && (st.gl !== gl || st.kind !== kind)) {
    if (st.gl === gl) nodeGraphResidualFaceGlDrop(canvas);
    st = null;
    canvas[NODE_GRAPH_RESIDUAL_FACE_KEY] = null;
  }
  if (st && st.w === w && st.h === h) {
    return st;
  }
  // New size: start from an empty plate (same as the old canvas resize wipe).
  if (st) nodeGraphResidualFaceGlDrop(canvas);
  const read = nodeGraphResidualFaceGlTarget(gl, w, h);
  const write = read ? nodeGraphResidualFaceGlTarget(gl, w, h) : null;
  if (!read || !write) {
    for (const t of [read, write]) {
      if (t?.fbo) gl.deleteFramebuffer(t.fbo);
      if (t?.tex) gl.deleteTexture(t.tex);
    }
    return null;
  }
  st = { gl, dev, kind, w, h, read, write, vbo: null };
  canvas[NODE_GRAPH_RESIDUAL_FACE_KEY] = st;
  return st;
}

function nodeGraphResidualFaceGlReset(gl) {
  if (gl.bindVertexArray) gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
}

function nodeGraphResidualFaceGlFullPass(st, dstFbo, fs, key, setUniforms) {
  const gl = st.gl;
  const prog = SoemGl.program(gl, key, SoemGl.GLSL_FULLSCREEN_VS, fs);
  if (!prog) return false;
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, st.read.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
  gl.uniform2f(gl.getUniformLocation(prog, "uSize"), st.w, st.h);
  setUniforms(gl, prog);
  if (dstFbo) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.viewport(0, 0, st.w, st.h);
  }
  SoemGl.drawQuad(gl, gl.getAttribLocation(prog, "aPos"));
  gl.bindTexture(gl.TEXTURE_2D, null);
  return true;
}

function nodeGraphResidualFaceGlSwap(st) {
  const tmp = st.read;
  st.read = st.write;
  st.write = tmp;
  nodeGraphResidualFaceGlStats.decays += 1;
}

/**
 * Decay on the shared time-based residual model: keeps =
 * PhosphorResidual.residualKeeps(trail, ghost), frames = 60 fps frames
 * elapsed. Trail freeze (keepFast 1) or 0 frames: no pass.
 */
function nodeGraphResidualFaceGlDecay(st, keeps, frames) {
  const gl = st.gl;
  nodeGraphResidualFaceGlReset(gl);
  const keepFast = Math.max(0, Math.min(1, Number(keeps?.keepFast)));
  const keepSlow = Math.max(keepFast, Math.min(1, Number(keeps?.keepSlow)));
  if (!(keepFast < 1) || !(frames > 0)) return true;
  const ok = nodeGraphResidualFaceGlFullPass(st, st.write.fbo, NODE_GRAPH_RESIDUAL_FACE_DECAY_FS, "residual-face-decay", (g, p) => {
    g.uniform1f(g.getUniformLocation(p, "uKeepFast"), keepFast);
    g.uniform1f(g.getUniformLocation(p, "uKeepSlow"), keepSlow);
    g.uniform1f(g.getUniformLocation(p, "uFrames"), frames);
    g.uniform1f(g.getUniformLocation(p, "uFloor8"), st.write.quantizeBits === 8 ? 1 : 0);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (ok) nodeGraphResidualFaceGlSwap(st);
  return ok;
}

/** Decay step for a face draw: time-based, paused time not counted. */
function nodeGraphResidualFaceGlStep(st, trail, ghost, frozen) {
  if (frozen) {
    st.residualStepMs = 0;
    return true;
  }
  return nodeGraphResidualFaceGlDecay(st, PhosphorResidual.residualKeeps(trail, ghost), PhosphorResidual.stepFrames(st));
}

/**
 * Deposit a batch of quads into the read plate in one draw. verts: 12 floats
 * per vertex (pos2, color4, param4, param2), 6 vertices per quad.
 * blend "add" = lighter (ONE, ONE); otherwise source-over (premultiplied).
 */
function nodeGraphResidualFaceGlQuads(st, verts, vertexCount, fs, key, blend, setUniforms = null) {
  if (!(vertexCount > 0)) return true;
  const gl = st.gl;
  const prog = SoemGl.program(gl, key, NODE_GRAPH_RESIDUAL_FACE_QUAD_VS, fs);
  if (!prog) return false;
  nodeGraphResidualFaceGlReset(gl);
  if (!st.vbo) st.vbo = gl.createBuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, st.read.fbo);
  gl.viewport(0, 0, st.w, st.h);
  gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, "uSize"), st.w, st.h);
  if (setUniforms) setUniforms(gl, prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, st.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, vertexCount * 12), gl.STREAM_DRAW);
  const locs = [
    [gl.getAttribLocation(prog, "aPos"), 2, 0],
    [gl.getAttribLocation(prog, "aColor"), 4, 8],
    [gl.getAttribLocation(prog, "aParam"), 4, 24],
    [gl.getAttribLocation(prog, "aParam2"), 2, 40],
  ];
  for (const [loc, size, offset] of locs) {
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 48, offset);
  }
  gl.enable(gl.BLEND);
  if (blend === "add") {
    gl.blendFunc(gl.ONE, gl.ONE);
  } else {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  gl.disable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  for (const [loc] of locs) {
    if (loc >= 0) gl.disableVertexAttribArray(loc);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  nodeGraphResidualFaceGlStats.quads += vertexCount / 6;
  return true;
}

/** Append one axis-aligned quad (plate px) to verts; returns new vertex count. */
function nodeGraphResidualFaceGlPushQuad(verts, n, x0, y0, x1, y1, c, p, p2) {
  const xs = [x0, x1, x0, x0, x1, x1];
  const ys = [y0, y0, y1, y1, y0, y1];
  let o = n * 12;
  for (let i = 0; i < 6; i += 1) {
    verts[o] = xs[i];
    verts[o + 1] = ys[i];
    verts[o + 2] = c[0]; verts[o + 3] = c[1]; verts[o + 4] = c[2]; verts[o + 5] = c[3];
    verts[o + 6] = p[0]; verts[o + 7] = p[1]; verts[o + 8] = p[2]; verts[o + 9] = p[3];
    verts[o + 10] = p2[0]; verts[o + 11] = p2[1];
    o += 12;
  }
  return n + 6;
}

/** Plate over bg (rgb 0..1) -> present region -> one blit into the face. */
function nodeGraphResidualFaceGlPresent(st, canvas, bgRgb) {
  const gl = st.gl;
  if (typeof nodeGraphDisplayCanvasPresentContext !== "function" || typeof nodeGraphDisplayCanvasBlit !== "function") {
    return false;
  }
  const ctx = nodeGraphDisplayCanvasPresentContext(canvas);
  if (!ctx) return false;
  nodeGraphResidualFaceGlReset(gl);
  nodeGraphSharedGlBindPresent(gl, st.w, st.h);
  const ok = nodeGraphResidualFaceGlFullPass(st, null, NODE_GRAPH_RESIDUAL_FACE_PRESENT_FS, "residual-face-present", (g, p) => {
    g.uniform3f(g.getUniformLocation(p, "uBg"), bgRgb[0], bgRgb[1], bgRgb[2]);
  });
  nodeGraphSharedGlEndPresent(gl);
  if (!ok || gl.isContextLost()) return false;
  const dev = st.dev;
  nodeGraphDisplayCanvasBlit(ctx, dev.canvas, 0, dev.canvas.height - st.h, st.w, st.h, 0, 0, st.w, st.h, false);
  nodeGraphResidualFaceGlStats.presents += 1;
  return true;
}

function nodeGraphResidualFaceHexRgb01(value, fallback = [0, 0, 0]) {
  const s = String(value || "").trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = Number.parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) {
    return [...m[1]].map((c) => Number.parseInt(c + c, 16) / 255);
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) {
    return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  }
  return fallback.slice();
}

/** Phosphor Dot LUT colour (nodeGraphPhosphorDotLutCss maths) as rgb 0..1. */
function nodeGraphResidualFaceDotLutRgb(settings, amount01) {
  const t = Math.max(0, Math.min(0.999, nodeGraphFiniteNumber(amount01)));
  const stops = Array.isArray(settings?.gradientStops) ? settings.gradientStops : null;
  const peak = nodeGraphResidualFaceHexRgb01(settings?.dot1Color || "#75ebff", [0x75 / 255, 0xeb / 255, 1]);
  if (!(stops?.length >= 2)) return peak;
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= Number(stops[i].t)) {
      a = stops[i - 1];
      b = stops[i];
      break;
    }
  }
  const pa = /^#?([0-9a-f]{6})$/i.exec(String(a.color || ""));
  const pb = /^#?([0-9a-f]{6})$/i.exec(String(b.color || ""));
  if (!pa || !pb) {
    return nodeGraphResidualFaceHexRgb01(b.color || a.color || "#75ebff", peak);
  }
  const span = Math.max(1e-6, Number(b.t) - Number(a.t));
  const u = (t - Number(a.t)) / span;
  const na = Number.parseInt(pa[1], 16);
  const nb = Number.parseInt(pb[1], 16);
  const ch = (shift) => {
    const ca = (na >> shift) & 255;
    const cb = (nb >> shift) & 255;
    return Math.round(ca + (cb - ca) * u) / 255;
  };
  return [ch(16), ch(8), ch(0)];
}

/**
 * Phosphor Dot: one centred stamp per frame (energy x Bright through the
 * gradient LUT) on a GPU residual plate faded by Ghost / Trail.
 */
function drawNodeGraphPhosphorDotGlItem(renderer, item, pixelRatio) {
  const buffer = item?.buffer;
  const settings = nodeGraphZeroDBurnSettingsForNode(nodeGraphModuleScopeNodeForSlot(item.slot));
  const canvas = nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  if (!canvas || !syncNodeGraphModuleScopeLocalFallbackCanvas(
    canvas,
    screenElement,
    pixelRatio,
    settings.pixelDensity,
  )) {
    return;
  }
  if (buffer && typeof renderNodeGraphModuleScopeAnalyzer === "function") {
    renderNodeGraphModuleScopeAnalyzer(item.slot, buffer);
  }
  const bg = nodeGraphFacePlateBackground(settings);
  nodeGraphFacePlateApplyCss(screenElement, bg);
  canvas.style.mixBlendMode = "normal";
  const st = nodeGraphResidualFaceGlPlate(canvas, "phosphorDot");
  if (!st) {
    nodeGraphDisplayGlFailed(canvas, "Phosphor Dot GL unavailable");
    return;
  }
  const width = st.w;
  const height = st.h;
  const minSide = Math.max(1, Math.min(width, height));
  const size01 = clampNodeSliderValue(settings.dot1Size, 0, 1);
  const radius = minSide * 0.5 * size01;
  const blur = nodeGraphTraceDisplayClampStampBlur(settings.lineThickness);
  const Residual = typeof PhosphorResidual !== "undefined" ? PhosphorResidual : null;
  const trail = Residual?.migrateTrail
    ? Residual.migrateTrail(settings, 0.78)
    : clampNodeSliderValue(Number(settings.trail ?? 0.78), 0, 1);
  const ghost = Residual?.migrateGhost
    ? Residual.migrateGhost(settings, 0.4)
    : clampNodeSliderValue(nodeGraphFiniteNumber(settings.ghost), 0, 1);
  const lampBright = clampNodeSliderValue(nodeGraphFiniteNumber(settings.dot1Brightness), 0, 1);
  const energy = nodeGraphVectorDotFrameEnergy01(buffer, canvas);
  const amount = Math.max(0, Math.min(1, energy * lampBright));
  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen();
  let ok = nodeGraphResidualFaceGlStep(st, trail, ghost, frozen);
  if (!frozen) {
    if (ok && amount > 0 && radius > 0.05) {
      const io = typeof TraceDotSprite !== "undefined" && TraceDotSprite.innerOuter
        ? TraceDotSprite.innerOuter(radius, blur)
        : { inner: radius * 0.9, outer: radius * 1.1 + 1 };
      const r0 = Math.max(0, io.inner);
      const r1 = Math.max(r0 + 0.75, io.outer);
      // Same stops as TraceDotSprite's radial gradient.
      let midT = 0;
      let mid = null;
      if (amount > 0.51) {
        midT = Math.max(0.04, Math.min(0.96, 1 - 0.5 / amount));
        mid = nodeGraphResidualFaceDotLutRgb(settings, 0.5);
      } else if (amount > 0.08) {
        midT = 0.45;
        mid = nodeGraphResidualFaceDotLutRgb(settings, amount * 0.45);
      }
      const c0 = nodeGraphResidualFaceDotLutRgb(settings, amount);
      const c1 = nodeGraphResidualFaceDotLutRgb(settings, 0);
      const cm = mid || c0;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const ext = io.outer + 2;
      const verts = st.dotVerts || (st.dotVerts = new Float32Array(6 * 12));
      nodeGraphResidualFaceGlPushQuad(
        verts, 0,
        Math.max(0, cx - ext), Math.max(0, cy - ext), Math.min(width, cx + ext), Math.min(height, cy + ext),
        [1, 1, 1, 1], [cx, cy, io.inner, io.outer], [r0, r1],
      );
      ok = nodeGraphResidualFaceGlQuads(st, verts, 6, NODE_GRAPH_RESIDUAL_FACE_DOT_FS, "residual-face-dot", "over", (g, p) => {
        g.uniform3f(g.getUniformLocation(p, "uC0"), c0[0], c0[1], c0[2]);
        g.uniform3f(g.getUniformLocation(p, "uCm"), cm[0], cm[1], cm[2]);
        g.uniform3f(g.getUniformLocation(p, "uC1"), c1[0], c1[1], c1[2]);
        g.uniform1f(g.getUniformLocation(p, "uMidT"), mid ? midT : 0);
      });
    }
  }
  if (!ok || !nodeGraphResidualFaceGlPresent(st, canvas, nodeGraphResidualFaceHexRgb01(bg))) {
    nodeGraphDisplayGlFailed(canvas, "Phosphor Dot GL draw failed");
    return;
  }
  nodeGraphResidualFaceGlStats.frames += 1;
  recordNodeGraphModuleScopeRenderMetrics(1, 1);
}

/**
 * Hypersaw stems: x = voice phase across the face, one batched quad per stem
 * and colour (additive red / blue, Sabrina taps green), on a GPU plate that
 * fades toward the face background (Trail / Ghost of the phosphor look).
 */
function drawNodeGraphHypersawBurnGlItem(renderer, item, pixelRatio) {
  const nodeId = item?.slot?.nodeId;
  if (!nodeId) {
    return;
  }
  const canvas = nodeGraphScope2dBurnCanvasForSlot(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  const sync = syncNodeGraphScope2dBurnCanvas(canvas, screenElement, pixelRatio, 1);
  if (!sync.synced || !canvas) {
    return;
  }
  const bus = typeof nodeGraphDataBus !== "undefined" ? nodeGraphDataBus : null;
  const phases = bus ? bus.get(nodeGraphDataBusKey(String(nodeId), "Phases")) : null;
  const pans = bus ? bus.get(nodeGraphDataBusKey(String(nodeId), "Pans")) : null;
  const amps = bus ? bus.get(nodeGraphDataBusKey(String(nodeId), "Amplitudes")) : null;
  const look = typeof nodeGraphScopePhosphorLookDefaults !== "undefined"
    ? nodeGraphScopePhosphorLookDefaults
    : null;
  const trail = clampNodeSliderValue(Number(look?.trail ?? 0.35), 0, 1);
  const ghost = clampNodeSliderValue(Number(look?.ghost ?? 0.45), 0, 1);
  const bgHex = typeof nodeGraphFacePlateBackground === "function"
    ? nodeGraphFacePlateBackground({ background: look?.background ?? "#000004" })
    : (look?.background ?? "#000004");
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, bgHex);
  }
  // No voice data: hold the last frame (no fade, no present).
  if (!Array.isArray(phases) || !phases.length) {
    return;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const sabrinaStems = ["reverbEffect", "sabrinaReverbOriginal"].includes(String(patchNode?.type || ""));
  if (sabrinaStems && typeof nodeGraphSabrinaReverbGlPresent === "function") {
    const cssW = Math.max(1, canvas.clientWidth || screenElement?.clientWidth || 1);
    const sabrinaSettings = typeof nodeGraphHypersawBurnSettingsForNode === "function"
      ? nodeGraphHypersawBurnSettingsForNode(patchNode)
      : null;
    if (nodeGraphSabrinaReverbGlPresent(canvas, phases, cssW, sabrinaSettings)) {
      return;
    }
  }
  const st = nodeGraphResidualFaceGlPlate(canvas, "hypersaw");
  if (!st) {
    nodeGraphDisplayGlFailed(canvas, "Hypersaw GL unavailable");
    return;
  }
  const bgRgb = nodeGraphResidualFaceHexRgb01(bgHex);
  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen();
  // Stems are energy above the face background: same residual model.
  let ok = nodeGraphResidualFaceGlStep(st, trail, ghost, frozen);
  const faceSettings = typeof nodeGraphHypersawBurnSettingsForNode === "function"
    ? nodeGraphHypersawBurnSettingsForNode(patchNode)
    : (typeof normalizeNodeGraphHypersawBurnSettings === "function"
      ? normalizeNodeGraphHypersawBurnSettings(patchNode?.traceDisplaySettings)
      : { lineThickness: 0.01 });
  // Screen px of the module face; canvas mode / workspace zoom enlarge the
  // backing, and thickness grows by the same factor (pixelScale).
  const screenPx = clampNodeSliderValue(nodeGraphFiniteNumber(faceSettings?.lineThickness, 2), 0, 64);
  const widthPx = st.w;
  const heightPx = st.h;
  const pixelScale = nodeGraphModuleFacePixelScale(canvas);
  const thicknessPx = screenPx * pixelScale;
  const count = phases.length;
  const need = count * 2 * 6 * 12;
  if (!st.stemVerts || st.stemVerts.length < need) {
    st.stemVerts = new Float32Array(Math.max(need, 64 * 12));
  }
  const verts = st.stemVerts;
  let n = 0;
  const RED = [255 / 255, 130 / 255, 110 / 255, 1];
  const BLUE = [110 / 255, 130 / 255, 255 / 255, 1];
  const GREEN = [86 / 255, 206 / 255, 118 / 255, 1];
  const cssW = Math.max(1, canvas.clientWidth || screenElement?.clientWidth || 1);
  for (let i = 0; ok && i < count; i += 1) {
    const p = Number(phases[i]);
    if (!Number.isFinite(p) || !(screenPx > 0)) continue;
    const xCenter = clampNodeSliderValue(p, 0, 1) * widthPx;
    const pan = Array.isArray(pans) && i < pans.length ? Number(pans[i]) : 0;
    const ampRaw = Array.isArray(amps) && i < amps.length ? Number(amps[i]) : 1;
    const alpha = clampNodeSliderValue(Math.abs(Number.isFinite(ampRaw) ? ampRaw : 0), 0, 1);
    if (!(alpha > 0)) continue;
    let left;
    let right;
    let x0;
    let x1;
    let coreIx = -1;
    let mode = 0;
    let aaW = 0;
    if (sabrinaStems) {
      const solidW = Math.max(1, cssW / 222) * pixelScale;
      aaW = 2 * pixelScale;
      left = xCenter - solidW * 0.5;
      right = left + solidW;
      x0 = Math.floor(left - aaW);
      x1 = Math.ceil(right + aaW);
      mode = 1;
    } else {
      const coreW = Math.max(thicknessPx, 1);
      left = xCenter - coreW * 0.5;
      right = left + coreW;
      coreIx = Math.max(0, Math.min(widthPx - 1, Math.floor(xCenter)));
      x0 = Math.min(Math.floor(left), coreIx);
      x1 = Math.max(Math.ceil(right), coreIx + 1);
    }
    x0 = Math.max(0, x0);
    x1 = Math.min(widthPx, x1);
    if (!(x1 > x0)) continue;
    const params = [left, right, coreIx, alpha];
    const params2 = [mode, aaW];
    const colors = sabrinaStems
      ? [i >= 12 ? GREEN : ((i & 1) ? BLUE : RED)]
      : (pan < -0.25 ? [RED] : (pan > 0.25 ? [BLUE] : [RED, BLUE]));
    for (const c of colors) {
      n = nodeGraphResidualFaceGlPushQuad(verts, n, x0, 0, x1, heightPx, c, params, params2);
    }
  }
  if (ok) {
    ok = nodeGraphResidualFaceGlQuads(st, verts, n, NODE_GRAPH_RESIDUAL_FACE_STEM_FS, "residual-face-stem", "add");
  }
  if (!ok || !nodeGraphResidualFaceGlPresent(st, canvas, bgRgb)) {
    nodeGraphDisplayGlFailed(canvas, "Hypersaw GL draw failed");
    return;
  }
  nodeGraphResidualFaceGlStats.frames += 1;
}
