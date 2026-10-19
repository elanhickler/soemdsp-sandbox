// Instant Waterfall face. WebGL end to end: history texture, scroll left,
// stamp filled bars on the right. Not a Canvas2D plate with a blur composite.
// Sub-texel time is uniform uSub on the present shader. No blur pass.
// Each bar edge is a 1px box coverage (the pixel the edge actually crosses),
// so fractional Y is not a hard stair. Context antialias does not apply:
// bars are drawn into a texture, not the multisampled default framebuffer.
// Smooth lines (default on): a sloped edge (Detail 1 trapezoid) spreads its
// coverage over 1 + |slope| rows, the box-filter area of that edge in the
// pixel, so steep waveform edges get horizontal AA too, not just vertical.
// Rendered once at the face's zoom-1 backing size; never re-rendered sharper.

function nodeGraphWaterfallGlParsePlate(css) {
  const s = String(css || "#000000").trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(s);
  if (rgb) {
    const p = rgb[1].trim().split(/[\s,]+/).map((v) => Number(v));
    return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255];
  }
  return [0, 0, 0];
}

function nodeGraphWaterfallGlCompile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // Caller reports nodeGraphDisplayGlFailed; log the reason here.
    console.error("[waterfall-gl] shader compile failed: " + (gl.getShaderInfoLog(sh) || "no info log"));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function nodeGraphWaterfallGlProgram(gl, vert, frag) {
  const vs = nodeGraphWaterfallGlCompile(gl, gl.VERTEX_SHADER, vert);
  const fs = nodeGraphWaterfallGlCompile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.bindAttribLocation(prog, 1, "aUv");
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("[waterfall-gl] program link failed: " + (gl.getProgramInfoLog(prog) || "no info log"));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// The three session programs are built once per shared context and reused by
// every face. A failed build is cached (false) and logged once, so a broken
// shader never recompiles per frame (ZP-1).
const nodeGraphWaterfallGlProgramCache = new WeakMap();
function nodeGraphWaterfallGlSharedPrograms(gl) {
  const hit = nodeGraphWaterfallGlProgramCache.get(gl);
  if (hit !== undefined) return hit || null;
  const scrollProg = nodeGraphWaterfallGlProgram(gl, NODE_GRAPH_WF_GL_VERT, NODE_GRAPH_WF_GL_SCROLL);
  const presentProg = nodeGraphWaterfallGlProgram(gl, NODE_GRAPH_WF_GL_VERT, NODE_GRAPH_WF_GL_PRESENT);
  const barProg = nodeGraphWaterfallGlProgram(gl, NODE_GRAPH_WF_GL_BAR_VERT, NODE_GRAPH_WF_GL_BAR);
  const out = scrollProg && presentProg && barProg ? { scrollProg, presentProg, barProg } : false;
  if (!out) {
    for (const p of [scrollProg, presentProg, barProg]) if (p) gl.deleteProgram(p);
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(null, "waterfall: GL program link failed");
  }
  nodeGraphWaterfallGlProgramCache.set(gl, out);
  return out || null;
}

function nodeGraphWaterfallGlMakeTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

function nodeGraphWaterfallGlFilter(gl, tex, linear) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
}

const NODE_GRAPH_WF_GL_VERT = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const NODE_GRAPH_WF_GL_SCROLL = `
precision mediump float;
uniform sampler2D uTex;
uniform float uShiftPx;
uniform vec2 uSize;
uniform vec3 uPlate;
void main() {
  float x = gl_FragCoord.x + uShiftPx;
  if (x >= uSize.x) {
    gl_FragColor = vec4(uPlate, 1.0);
  } else {
    gl_FragColor = texture2D(uTex, vec2(x / uSize.x, gl_FragCoord.y / uSize.y));
  }
}
`;

const NODE_GRAPH_WF_GL_PRESENT = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uSub;
void main() {
  float x = gl_FragCoord.x + uSub;
  gl_FragColor = texture2D(uTex, vec2(x / uSize.x, gl_FragCoord.y / uSize.y));
}
`;

// Bars are batched: every per-bar value that used to be a uniform is a
// per-vertex attribute (constant across the bar's 6 vertices), so a whole
// face's columns go out in one bufferSubData + one drawArrays per blend run.
// Layout: NODE_GRAPH_WF_GL_BAR_FLOATS floats per vertex, see
// nodeGraphWaterfallGlQueueBar.
const NODE_GRAPH_WF_GL_BAR_FLOATS = 15;
// Blends that need the destination colour: drawn with blending off, the
// shader samples a copy of the history (ping-pong write target) as uDst.
const NODE_GRAPH_WF_GL_DST_READ = new Set(["difference", "exclusion", "xor"]);
const NODE_GRAPH_WF_GL_BAR_VERT = `
attribute vec2 aPos;
attribute vec3 aColor;
attribute vec2 aSpan;
attribute vec4 aEdge;
attribute vec4 aMisc;
varying vec3 uColor;
varying vec2 uSpan;
varying vec4 uEdge;
varying vec4 vMisc;
void main() {
  uColor = aColor;
  uSpan = aSpan;
  uEdge = aEdge;
  vMisc = aMisc;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const NODE_GRAPH_WF_GL_BAR = `
precision mediump float;
uniform vec2 uSize;
uniform sampler2D uDst;
uniform vec3 uPlate;
varying vec3 uColor;
varying vec2 uSpan;
varying vec4 uEdge;
varying vec4 vMisc;
void main() {
  float uBlendKind = vMisc.x;
  // Ink alpha (channel Brightness), same as the canvas rgba() fill it replaces.
  float inkA = vMisc.w;
  // Mode + 8 = Smooth lines on (slope-aware edge coverage).
  float smoothOn = step(7.5, vMisc.y);
  float uMode = vMisc.y - 8.0 * smoothOn;
  float uStrokePx = vMisc.z;
  // uMode 2 = queued column clear: opaque plate colour (source-over with
  // alpha 1 replaces, same pixels/colour as the old scissored gl.clear).
  if (uMode > 1.5) {
    gl_FragColor = vec4(uColor, 1.0);
    return;
  }
  // Canvas Y, top-down. Coverage is the 1px box overlap with the span at
  // this x, so a fractional edge is a partial pixel, not a stair.
  // uMode 0 = solid fill. uMode 1 = stroke along the top and bottom only.
  // Stroke does not draw the vertical ends or a line to the next bar.
  float y = uSize.y - gl_FragCoord.y;
  float span = max(uSpan.y - uSpan.x, 1e-4);
  float t = clamp((gl_FragCoord.x - uSpan.x) / span, 0.0, 1.0);
  float yTop = mix(uEdge.x, uEdge.y, t);
  float yBot = mix(uEdge.z, uEdge.w, t);
  float lo = min(yTop, yBot);
  float hi = max(yTop, yBot);
  // Each edge ramps over 1 + |slope| rows (1 row when smoothing is off, which
  // is the same box overlap as before). Top and bottom combine as an
  // intersection: cTop + cBot - 1.
  float mTop = abs(uEdge.y - uEdge.x) / span;
  float mBot = abs(uEdge.w - uEdge.z) / span;
  float wLo = 1.0 + smoothOn * (yTop <= yBot ? mTop : mBot);
  float wHi = 1.0 + smoothOn * (yTop <= yBot ? mBot : mTop);
  float cTop = clamp((y - lo) / wLo + 0.5, 0.0, 1.0);
  float cBot = clamp((hi - y) / wHi + 0.5, 0.0, 1.0);
  float body = clamp(cTop + cBot - 1.0, 0.0, 1.0);
  float cover = body;
  if (uMode > 0.5) {
    float halfS = max(uStrokePx * 0.5, 0.5);
    float topC = clamp(min(y + 0.5, yTop + halfS) - max(y - 0.5, yTop - halfS), 0.0, 1.0);
    float botC = clamp(min(y + 0.5, yBot + halfS) - max(y - 0.5, yBot - halfS), 0.0, 1.0);
    cover = max(topC, botC);
  }
  if (cover <= 0.0) discard;
  float k = cover * inkA;
  if (uBlendKind > 2.5) {
    // 3 difference, 4 exclusion, 5 xor (covered ink punches through to the plate).
    vec3 d = texture2D(uDst, gl_FragCoord.xy / uSize).rgb;
    vec3 r = abs(d - uColor);
    if (uBlendKind > 4.5) r = uPlate;
    else if (uBlendKind > 3.5) r = d + uColor - 2.0 * d * uColor;
    gl_FragColor = vec4(mix(d, r, k), 1.0);
  } else if (uBlendKind > 1.5) {
    gl_FragColor = vec4(mix(vec3(1.0), uColor, k), 1.0);
  } else if (uBlendKind > 0.5) {
    gl_FragColor = vec4(uColor * k, 0.0);
  } else {
    gl_FragColor = vec4(uColor * k, k);
  }
}
`;

function nodeGraphWaterfallGlEnsure(canvas, plateCss) {
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const w = Math.max(1, canvas.width | 0);
  const h = Math.max(1, canvas.height | 0);
  let s = canvas._wfGlSession;
  if (s && s.gl && s.gl.isContextLost()) s = null;
  if (s && s.w === w && s.h === h && s.gl && s.read) {
    s.plate = nodeGraphWaterfallGlParsePlate(plateCss);
    return s;
  }
  if (s && s.gl && s.read && s.presentProg) {
    s.plate = nodeGraphWaterfallGlParsePlate(plateCss);
    nodeGraphWaterfallGlResizeHistory(s, w, h);
    return s;
  }
  const pic = typeof nodeGraphSharedGlDevice === "function" ? nodeGraphSharedGlDevice() : null;
  const gl = pic?.gl || null;
  if (!gl || gl.isContextLost()) return null;
  const progs = nodeGraphWaterfallGlSharedPrograms(gl);
  if (!progs) return null;
  const { scrollProg, presentProg, barProg } = progs;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1,
    -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
  ]), gl.STATIC_DRAW);
  const barBuf = gl.createBuffer();
  s = {
    gl,
    w,
    h,
    plate: nodeGraphWaterfallGlParsePlate(plateCss),
    read: nodeGraphWaterfallGlMakeTarget(gl, w, h),
    write: nodeGraphWaterfallGlMakeTarget(gl, w, h),
    scrollProg,
    presentProg,
    barProg,
    quad,
    barBuf,
  };
  canvas._wfGlSession = s;
  nodeGraphWaterfallGlClearRead(s);
  return s;
}

function nodeGraphWaterfallGlDropTarget(gl, target) {
  if (!gl || !target) return;
  if (target.tex) gl.deleteTexture(target.tex);
  if (target.fbo) gl.deleteFramebuffer(target.fbo);
}

// Stretch the existing history into a new texture size. A failed copy keeps
// the old texture. An empty plate is only for a session that has no history yet.
function nodeGraphWaterfallGlResizeHistory(s, w, h) {
  if (!s?.gl || !s.read?.tex || !s.presentProg) return false;
  if (s.w === w && s.h === h) return true;
  nodeGraphWaterfallGlFlush(s);
  const gl = s.gl;
  const nextRead = nodeGraphWaterfallGlMakeTarget(gl, w, h);
  const nextWrite = nodeGraphWaterfallGlMakeTarget(gl, w, h);
  const oldRead = s.read;
  const oldWrite = s.write;
  const oldW = s.w;
  const oldH = s.h;
  s.read = nextRead;
  s.write = nextWrite;
  s.w = w;
  s.h = h;
  gl.bindFramebuffer(gl.FRAMEBUFFER, nextRead.fbo);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  if (!complete || !nodeGraphWaterfallGlCopyHistory(s, oldRead.tex)) {
    nodeGraphWaterfallGlDropTarget(gl, nextRead);
    nodeGraphWaterfallGlDropTarget(gl, nextWrite);
    s.read = oldRead;
    s.write = oldWrite;
    s.w = oldW;
    s.h = oldH;
    return false;
  }
  nodeGraphWaterfallGlDropTarget(gl, oldRead);
  nodeGraphWaterfallGlDropTarget(gl, oldWrite);
  return true;
}

function nodeGraphWaterfallGlCopyHistory(s, srcTex) {
  const gl = s.gl;
  if (!srcTex) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.read.fbo);
  gl.viewport(0, 0, s.w, s.h);
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  nodeGraphWaterfallGlFilter(gl, srcTex, true);
  nodeGraphWaterfallGlBindQuad(gl, s, s.presentProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(gl.getUniformLocation(s.presentProg, "uTex"), 0);
  const sizeLoc = gl.getUniformLocation(s.presentProg, "uSize");
  if (sizeLoc) gl.uniform2f(sizeLoc, s.w, s.h);
  const subLoc = gl.getUniformLocation(s.presentProg, "uSub");
  if (subLoc) gl.uniform1f(subLoc, 0);
  nodeGraphWaterfallGlDrawQuad(s);
  nodeGraphWaterfallGlFilter(gl, srcTex, false);
  return true;
}

function nodeGraphWaterfallGlBindQuad(gl, s, prog) {
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, s.quad);
  const pLoc = gl.getAttribLocation(prog, "aPos");
  const uLoc = gl.getAttribLocation(prog, "aUv");
  if (pLoc >= 0) {
    gl.enableVertexAttribArray(pLoc);
    gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 16, 0);
  }
  if (uLoc >= 0) {
    gl.enableVertexAttribArray(uLoc);
    gl.vertexAttribPointer(uLoc, 2, gl.FLOAT, false, 16, 8);
  }
}

function nodeGraphWaterfallGlDrawQuad(s) {
  s.gl.drawArrays(s.gl.TRIANGLES, 0, 6);
}

function nodeGraphWaterfallGlClearRead(s) {
  nodeGraphWaterfallGlFlush(s);
  const gl = s.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.read.fbo);
  gl.viewport(0, 0, s.w, s.h);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(s.plate[0], s.plate[1], s.plate[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.write.fbo);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

const NODE_GRAPH_ONSET_LINE_VS = `
attribute vec2 aPos;
attribute float aSide;
attribute float aCore;
attribute vec4 aColor;
uniform vec2 uCss;
varying float vSide;
varying float vCore;
varying vec4 vColor;
void main() {
  vec2 clip = (aPos / uCss) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  vSide = aSide;
  vCore = aCore;
  vColor = aColor;
}
`;

const NODE_GRAPH_ONSET_LINE_FS = `
precision mediump float;
varying float vSide;
varying float vCore;
varying vec4 vColor;
void main() {
  float alpha = 1.0 - smoothstep(vCore, 1.0, abs(vSide));
  gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
}
`;

function nodeGraphOnsetGlLineProgram(gl) {
  const vs = nodeGraphWaterfallGlCompile(gl, gl.VERTEX_SHADER, NODE_GRAPH_ONSET_LINE_VS);
  const fs = nodeGraphWaterfallGlCompile(gl, gl.FRAGMENT_SHADER, NODE_GRAPH_ONSET_LINE_FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("[waterfall-gl] onset line link failed: " + (gl.getProgramInfoLog(prog) || "no info log"));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// A failed link is cached on the session: no per-frame recompile (ZP-1).
function nodeGraphOnsetGlEnsureLine(s) {
  if (s.lineProg || s.lineProgFailed) return s;
  const gl = s.gl;
  const prog = nodeGraphOnsetGlLineProgram(gl);
  if (!prog) {
    s.lineProgFailed = true;
    return s;
  }
  s.lineProg = prog;
  s.lineBuf = gl.createBuffer();
  s.lineLoc = {
    pos: gl.getAttribLocation(prog, "aPos"),
    p0: gl.getAttribLocation(prog, "aP0"),
    color: gl.getAttribLocation(prog, "aColor"),
    p1: gl.getAttribLocation(prog, "aP1"),
    half: gl.getAttribLocation(prog, "aHalf"),
    css: gl.getUniformLocation(prog, "uCss"),
  };
  return s;
}

function nodeGraphOnsetGlStrokePolyline(canvas, points, widthPx, rgb) {
  const s = canvas && canvas._wfGlSession;
  if (!s || !points || points.length < 2) return false;
  nodeGraphOnsetGlEnsureLine(s);
  if (!s.lineProg) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "onset line: GL program link failed");
    return false;
  }
  nodeGraphWaterfallGlFlush(s);
  const gl = s.gl;
  const width = Math.max(0.75, Number(widthPx) || 1);
  const half = width * 0.5;
  const expand = half + 0.75;
  const core = half / expand;
  // rgb is 0..255 (nodeGraphWaterfallStrokeRgb / ParseInkRgb), like the bar
  // path. Clamping it to 0..1 without /255 pushed every non-zero channel to
  // full, so dark picks drew as bright primaries / white.
  const color = [
    Math.max(0, Math.min(255, Number(rgb?.[0]) || 0)) / 255,
    Math.max(0, Math.min(255, Number(rgb?.[1]) || 0)) / 255,
    Math.max(0, Math.min(255, Number(rgb?.[2]) || 0)) / 255,
    1,
  ];
  const chunks = [];
  for (let p = 1; p < points.length; p += 1) {
    const p0 = points[p - 1];
    const p1 = points[p];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-4)) continue;
    const inv = 1 / len;
    const dirX = dx * inv;
    const dirY = dy * inv;
    const nx = -dirY;
    const ny = dirX;
    const ax = p0.x - dirX * half;
    const ay = p0.y - dirY * half;
    const bx = p1.x + dirX * half;
    const by = p1.y + dirY * half;
    const corners = [
      [ax + nx * expand, ay + ny * expand, 1],
      [ax - nx * expand, ay - ny * expand, -1],
      [bx + nx * expand, by + ny * expand, 1],
      [ax - nx * expand, ay - ny * expand, -1],
      [bx - nx * expand, by - ny * expand, -1],
      [bx + nx * expand, by + ny * expand, 1],
    ];
    for (let c = 0; c < corners.length; c += 1) {
      const corner = corners[c];
      chunks.push(corner[0], corner[1], corner[2], core, color[0], color[1], color[2], color[3]);
    }
  }
  if (!chunks.length) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.read.fbo);
  gl.viewport(0, 0, s.w, s.h);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(s.lineProg);
  gl.uniform2f(s.lineLoc.css, s.w, s.h);
  gl.bindBuffer(gl.ARRAY_BUFFER, s.lineBuf);
  nodeGraphWaterfallGlUploadFloats(gl, s.lineBuf, chunks);
  const stride = 32;
  gl.enableVertexAttribArray(s.lineLoc.pos);
  gl.vertexAttribPointer(s.lineLoc.pos, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(s.lineLoc.side);
  gl.vertexAttribPointer(s.lineLoc.side, 1, gl.FLOAT, false, stride, 8);
  gl.enableVertexAttribArray(s.lineLoc.core);
  gl.vertexAttribPointer(s.lineLoc.core, 1, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(s.lineLoc.color);
  gl.vertexAttribPointer(s.lineLoc.color, 4, gl.FLOAT, false, stride, 16);
  gl.drawArrays(gl.TRIANGLES, 0, chunks.length / 8);
  return true;
}

function nodeGraphWaterfallGlReset(canvas, plateCss) {
  const s = nodeGraphWaterfallGlEnsure(canvas, plateCss);
  if (!s) return false;
  s.plate = nodeGraphWaterfallGlParsePlate(plateCss);
  nodeGraphWaterfallGlClearRead(s);
  return true;
}

// Transport Stop: blank an existing history session in place. Never creates
// a session (a face with no GL context yet must not be claimed for WebGL).
// Clears both ping-pong history targets AND the presented framebuffer
// (preserveDrawingBuffer keeps the last present), so Play has nothing old
// to re-present.
function nodeGraphWaterfallGlWipe(canvas) {
  const s = canvas && canvas._wfGlSession;
  if (!s || !s.gl || s.gl.isContextLost() || !s.read || !s.write) return false;
  const gl = s.gl;
  nodeGraphWaterfallGlClearRead(s);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, s.w, s.h);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return true;
}

function nodeGraphWaterfallGlScroll(canvas, px, plateCss) {
  const s = nodeGraphWaterfallGlEnsure(canvas, plateCss);
  if (!s) return false;
  s.plate = nodeGraphWaterfallGlParsePlate(plateCss);
  const shift = Math.round(Number(px) || 0);
  if (shift < 1) return true;
  nodeGraphWaterfallGlFlush(s);
  const gl = s.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.write.fbo);
  gl.viewport(0, 0, s.w, s.h);
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  nodeGraphWaterfallGlFilter(gl, s.read.tex, false);
  nodeGraphWaterfallGlBindQuad(gl, s, s.scrollProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.read.tex);
  gl.uniform1i(gl.getUniformLocation(s.scrollProg, "uTex"), 0);
  gl.uniform1f(gl.getUniformLocation(s.scrollProg, "uShiftPx"), shift);
  gl.uniform2f(gl.getUniformLocation(s.scrollProg, "uSize"), s.w, s.h);
  gl.uniform3f(gl.getUniformLocation(s.scrollProg, "uPlate"), s.plate[0], s.plate[1], s.plate[2]);
  nodeGraphWaterfallGlDrawQuad(s);
  const tmp = s.read;
  s.read = s.write;
  s.write = tmp;
  return true;
}

function nodeGraphWaterfallGlClearColumn(canvas, x, w, plateCss) {
  const s = canvas && canvas._wfGlSession;
  if (!s) return false;
  s.plate = nodeGraphWaterfallGlParsePlate(plateCss || "#000000");
  const gl = s.gl;
  const x0 = Math.max(0, Math.floor(Number(x) || 0));
  const x1 = Math.min(s.w, Math.ceil((Number(x) || 0) + (Number(w) || 0)));
  if (x1 <= x0) return true;
  // Queue the clear as an opaque quad in the current (or last) draw run, so
  // clear + stamp per column no longer splits a frame into one draw each.
  const q = s.wfQueue;
  const kind = q && q.n > 0 ? q.kind : (s.wfLastKind || "bar");
  if (kind === "bar" || (kind === "meet" && s.meetProg)) {
    const clip = (px, py) => nodeGraphWaterfallGlClip(px, py, s.w, s.h);
    const a = clip(x0, 0);
    const b = clip(x1, 0);
    const c = clip(x0, s.h);
    const d = clip(x1, s.h);
    const p = s.plate;
    if (kind === "bar") {
      nodeGraphWaterfallGlQueueBar(
        s, [a[0], a[1], b[0], b[1], c[0], c[1], c[0], c[1], b[0], b[1], d[0], d[1]],
        s.read.fbo, "source-over", [p[0], p[1], p[2]], x0, x1, [0, 0, s.h, s.h], 0, 2, 1,
      );
    } else {
      const corners = [a, b, c, c, b, d];
      const mq = nodeGraphWaterfallGlQueueFor(s, "meet", "source-over", s.read.fbo, NODE_GRAPH_WF_GL_MEET_FLOATS * 6);
      const dd = mq.data;
      let o = mq.n;
      for (let v = 0; v < 6; v += 1) {
        dd.fill(0, o, o + NODE_GRAPH_WF_GL_MEET_FLOATS);
        dd[o] = corners[v][0]; dd[o + 1] = corners[v][1];
        dd[o + 14] = 2;
        dd[o + 15] = p[0]; dd[o + 16] = p[1]; dd[o + 17] = p[2];
        o += NODE_GRAPH_WF_GL_MEET_FLOATS;
      }
      mq.n = o;
    }
    return true;
  }
  nodeGraphWaterfallGlFlush(s);
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.read.fbo);
  gl.viewport(0, 0, s.w, s.h);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x0, 0, x1 - x0, s.h);
  gl.clearColor(s.plate[0], s.plate[1], s.plate[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
  return true;
}

function nodeGraphWaterfallGlApplyBlend(gl, mode) {
  gl.enable(gl.BLEND);
  const m = String(mode || "source-over");
  if (NODE_GRAPH_WF_GL_DST_READ.has(m)) {
    gl.disable(gl.BLEND);
  } else if (m === "screen") {
    // 1 - (1 - d)(1 - c): src * (1 - dst) + dst.
    gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
  } else if (m === "lighter" || m === "combine" || m === "meet") {
    gl.blendFunc(gl.ONE, gl.ONE);
  } else if (m === "multiply") {
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
  } else {
    // Bar shader writes premultiplied coverage.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}

/**
 * Upload `count` floats from `values` into the bound ARRAY_BUFFER `buf`
 * without reallocating: one grow-only scratch Float32Array and one GPU store
 * per buffer, refreshed with bufferSubData. The waterfall issues ~100 tiny
 * uploads a frame (meet columns / bars); `new Float32Array` + `bufferData`
 * each time was the top GL cost and allocation source on busy patches.
 */
function nodeGraphWaterfallGlUploadFloats(gl, buf, values, count = values.length) {
  const n = Math.max(0, count | 0);
  if (!buf || typeof gl.bufferSubData !== "function") {
    // No buffer object to cache on (mock / lost context): plain upload.
    gl.bufferData(gl.ARRAY_BUFFER, values instanceof Float32Array && n === values.length ? values : new Float32Array(Array.prototype.slice.call(values, 0, n)), gl.DYNAMIC_DRAW);
    return;
  }
  let scratch = buf._wfScratch;
  if (!scratch || scratch.length < n) {
    scratch = new Float32Array(Math.max(64, n * 2));
    buf._wfScratch = scratch;
  }
  if (values !== scratch) {
    for (let i = 0; i < n; i += 1) {
      scratch[i] = values[i];
    }
  }
  const bytes = n * 4;
  if (!(buf._wfCapBytes >= bytes)) {
    buf._wfCapBytes = Math.max(256, bytes * 2);
    gl.bufferData(gl.ARRAY_BUFFER, buf._wfCapBytes, gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.subarray(0, n));
}

function nodeGraphWaterfallGlBlendKind(mode) {
  const m = String(mode || "source-over");
  if (m === "lighter" || m === "screen" || m === "combine" || m === "meet") return 1;
  if (m === "multiply") return 2;
  if (m === "difference") return 3;
  if (m === "exclusion") return 4;
  if (m === "xor") return 5;
  return 0;
}

/*
 * Draw queue (one per session). Bars and Meet columns are appended as
 * vertices; consecutive stamps with the same program, blend and target go
 * out in ONE bufferSubData + ONE drawArrays. Order inside a draw is
 * primitive order, so overlapping bars blend exactly as the old one-draw-
 * per-bar path. Every other operation on the session (scroll, clear,
 * present, polyline, ink, reset, resize) flushes first; a microtask flush
 * covers a frame that stamps without presenting.
 * s.wfQueue = { kind: "bar"|"meet", blend, fbo, data: Float32Array, n }.
 */
function nodeGraphWaterfallGlQueueFor(s, kind, blend, fbo, floats) {
  let q = s.wfQueue;
  if (q && q.n > 0 && (q.kind !== kind || q.blend !== blend || q.fbo !== fbo)) {
    nodeGraphWaterfallGlFlush(s);
  }
  if (!q) {
    q = s.wfQueue = { kind, blend, fbo, data: new Float32Array(NODE_GRAPH_WF_GL_MEET_FLOATS * 6 * 64), n: 0 };
  }
  q.kind = kind;
  q.blend = blend;
  q.fbo = fbo;
  s.wfLastKind = kind;
  if (q.n + floats > q.data.length) {
    const next = new Float32Array(Math.max(q.data.length * 2, q.n + floats));
    next.set(q.data.subarray(0, q.n));
    q.data = next;
  }
  if (!s.wfFlushScheduled) {
    s.wfFlushScheduled = true;
    const run = () => {
      s.wfFlushScheduled = false;
      nodeGraphWaterfallGlFlush(s);
    };
    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else Promise.resolve().then(run);
  }
  return q;
}

function nodeGraphWaterfallGlFlush(s) {
  const q = s && s.wfQueue;
  if (!q || q.n <= 0) return;
  const gl = s.gl;
  const n = q.n;
  q.n = 0;
  q.boxes = null;
  if (!gl || gl.isContextLost()) return;
  const dstRead = q.kind === "bar" && NODE_GRAPH_WF_GL_DST_READ.has(q.blend) && q.fbo === s.read.fbo;
  if (dstRead) {
    // Destination copy: history (read) -> write target, sampled as uDst below.
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.write.fbo);
    gl.viewport(0, 0, s.w, s.h);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    nodeGraphWaterfallGlFilter(gl, s.read.tex, false);
    nodeGraphWaterfallGlBindQuad(gl, s, s.presentProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.read.tex);
    gl.uniform1i(gl.getUniformLocation(s.presentProg, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(s.presentProg, "uSize"), s.w, s.h);
    gl.uniform1f(gl.getUniformLocation(s.presentProg, "uSub"), 0);
    nodeGraphWaterfallGlDrawQuad(s);
    s.wfDstCopies = (s.wfDstCopies || 0) + 1;
  }
  const isMeet = q.kind === "meet";
  const prog = isMeet ? s.meetProg : s.barProg;
  if (!prog) return;
  const stride = isMeet ? NODE_GRAPH_WF_GL_MEET_FLOATS : NODE_GRAPH_WF_GL_BAR_FLOATS;
  gl.bindFramebuffer(gl.FRAMEBUFFER, q.fbo);
  gl.viewport(0, 0, s.w, s.h);
  gl.disable(gl.SCISSOR_TEST);
  if (q.blend === "position") {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  } else {
    nodeGraphWaterfallGlApplyBlend(gl, q.blend);
  }
  gl.useProgram(prog);
  const attribs = isMeet ? s.meetLoc.attribs : nodeGraphWaterfallGlBarAttribs(s);
  const sizeLoc = isMeet ? s.meetLoc.size : s.barSizeLoc;
  if (sizeLoc) gl.uniform2f(sizeLoc, s.w, s.h);
  if (!isMeet) {
    gl.uniform3f(gl.getUniformLocation(prog, "uPlate"), s.plate[0], s.plate[1], s.plate[2]);
    gl.uniform1i(gl.getUniformLocation(prog, "uDst"), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dstRead ? s.write.tex : null);
    gl.activeTexture(gl.TEXTURE0);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, s.barBuf);
  nodeGraphWaterfallGlUploadFloats(gl, s.barBuf, q.data, n);
  let off = 0;
  for (const [loc, comps] of attribs) {
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, stride * 4, off * 4);
    }
    off += comps;
  }
  gl.drawArrays(gl.TRIANGLES, 0, n / stride);
  // Shared context: leave no extra arrays enabled for the next user.
  for (const [loc] of attribs) {
    if (loc > 0) gl.disableVertexAttribArray(loc);
  }
  if (dstRead) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }
  s.wfDraws = (s.wfDraws || 0) + 1;
}

function nodeGraphWaterfallGlBarAttribs(s) {
  if (!s.barAttribs) {
    const gl = s.gl;
    const a = (name) => gl.getAttribLocation(s.barProg, name);
    s.barAttribs = [[a("aPos"), 2], [a("aColor"), 3], [a("aSpan"), 2], [a("aEdge"), 4], [a("aMisc"), 4]];
    s.barSizeLoc = gl.getUniformLocation(s.barProg, "uSize");
  }
  return s.barAttribs;
}

// verts: 6 clip-space (x, y) pairs. Same values the old uniforms carried.
function nodeGraphWaterfallGlQueueBar(s, verts, fbo, blendKey, c, span0, span1, edge, blendKind, mode, strokePx, alpha = 1) {
  if (blendKind >= 3) {
    // Destination-read blends sample a copy taken at flush time, so a stamp
    // that overlaps one already queued must see it: flush first.
    const pad = Math.max(1, Number(strokePx) || 1) + 1;
    const box = [
      Math.min(span0, span1), Math.max(span0, span1),
      Math.min(edge[0], edge[1], edge[2], edge[3]) - pad, Math.max(edge[0], edge[1], edge[2], edge[3]) + pad,
    ];
    const pq = s.wfQueue;
    if (pq && pq.n > 0 && pq.kind === "bar" && pq.blend === blendKey && pq.fbo === fbo && pq.boxes) {
      for (const b of pq.boxes) {
        if (box[0] < b[1] && b[0] < box[1] && box[2] < b[3] && b[2] < box[3]) {
          nodeGraphWaterfallGlFlush(s);
          break;
        }
      }
    }
    const q0 = nodeGraphWaterfallGlQueueFor(s, "bar", blendKey, fbo, NODE_GRAPH_WF_GL_BAR_FLOATS * 6);
    (q0.boxes || (q0.boxes = [])).push(box);
  }
  const q = nodeGraphWaterfallGlQueueFor(s, "bar", blendKey, fbo, NODE_GRAPH_WF_GL_BAR_FLOATS * 6);
  const d = q.data;
  let o = q.n;
  for (let v = 0; v < 6; v += 1) {
    d[o] = verts[v * 2]; d[o + 1] = verts[v * 2 + 1];
    d[o + 2] = c[0]; d[o + 3] = c[1]; d[o + 4] = c[2];
    d[o + 5] = span0; d[o + 6] = span1;
    d[o + 7] = edge[0]; d[o + 8] = edge[1]; d[o + 9] = edge[2]; d[o + 10] = edge[3];
    d[o + 11] = blendKind; d[o + 12] = mode; d[o + 13] = strokePx;
    d[o + 14] = alpha;
    o += NODE_GRAPH_WF_GL_BAR_FLOATS;
  }
  q.n = o;
}

function nodeGraphWaterfallGlDrawBar(s, verts, rgb, blend, edge, mode, strokePx) {
  const c = [
    Math.max(0, Math.min(255, Number(rgb?.[0]) || 0)) / 255,
    Math.max(0, Math.min(255, Number(rgb?.[1]) || 0)) / 255,
    Math.max(0, Math.min(255, Number(rgb?.[2]) || 0)) / 255,
  ];
  nodeGraphWaterfallGlQueueBar(
    s, verts, s.read.fbo, String(blend || "source-over"), c, edge.x0, edge.x1,
    [edge.top0, edge.top1, edge.bot0, edge.bot1],
    nodeGraphWaterfallGlBlendKind(blend), (mode > 0 ? 1 : 0) + (s.smooth !== false ? 8 : 0), Math.max(0.5, Number(strokePx) || 1),
    Number.isFinite(Number(rgb?.[3])) ? Math.max(0, Math.min(1, Number(rgb[3]))) : 1,
  );
}

function nodeGraphWaterfallGlClip(x, y, w, h) {
  return [(x / w) * 2 - 1, 1 - (y / h) * 2];
}

function nodeGraphWaterfallGlStampQuad(s, x0, wid, top0, top1, bot0, bot1, fringe, rgb, blend, mode, strokePx) {
  const clip = (px, py) => nodeGraphWaterfallGlClip(px, py, s.w, s.h);
  // Smooth lines: a steep edge's coverage ramp reaches past the slanted quad
  // side, so the quad is the column's bounding rows (+fringe) instead.
  const smooth = s.smooth !== false;
  const qt0 = smooth ? Math.min(top0, top1) : top0;
  const qt1 = smooth ? qt0 : top1;
  const qb0 = smooth ? Math.max(bot0, bot1) : bot0;
  const qb1 = smooth ? qb0 : bot1;
  const a = clip(x0, qt0 - fringe);
  const b = clip(x0 + wid, qt1 - fringe);
  const c = clip(x0, qb0 + fringe);
  const d = clip(x0 + wid, qb1 + fringe);
  const verts = [a[0], a[1], b[0], b[1], c[0], c[1], c[0], c[1], b[0], b[1], d[0], d[1]];
  nodeGraphWaterfallGlDrawBar(s, verts, rgb, blend, {
    x0,
    x1: x0 + wid,
    top0,
    top1,
    bot0,
    bot1,
  }, mode, strokePx);
}

function nodeGraphWaterfallGlStampBar(canvas, x, spanW, ys, prevEdge, connect, rgb, blend, thickness, filled, stroke) {
  const s = canvas && canvas._wfGlSession;
  if (!s || !ys) return false;
  const thick = Math.max(0, Math.min(1, Number(thickness)));
  if (!(thick > 0)) return true;
  let x0 = Number(x) || 0;
  let wid = Math.max(0, Number(spanW) || 0);
  if (thick < 0.999) {
    const pad = wid * (1 - thick) * 0.5;
    x0 += pad;
    wid *= thick;
  }
  if (!(wid > 0)) return true;
  const yTop = Math.min(ys.y0, ys.y1);
  const yBot = Math.max(ys.y0, ys.y1);
  const strokeTop = Math.min(
    Number.isFinite(ys.strokeY0) ? ys.strokeY0 : yTop,
    Number.isFinite(ys.strokeY1) ? ys.strokeY1 : yBot,
  );
  const strokeBot = Math.max(
    Number.isFinite(ys.strokeY0) ? ys.strokeY0 : yTop,
    Number.isFinite(ys.strokeY1) ? ys.strokeY1 : yBot,
  );
  const strokeOn = !!(stroke && stroke.on);
  const strokePx = Math.max(0.5, Number(stroke?.px) || 1);
  if (filled !== false) {
    let top0 = yTop;
    let bot0 = yBot;
    let top1 = yTop;
    let bot1 = yBot;
    if (connect && prevEdge && Number.isFinite(prevEdge.y0) && Number.isFinite(prevEdge.y1)) {
      top0 = Math.min(prevEdge.y0, prevEdge.y1);
      bot0 = Math.max(prevEdge.y0, prevEdge.y1);
      top1 = yTop;
      bot1 = yBot;
    }
    nodeGraphWaterfallGlStampQuad(s, x0, wid, top0, top1, bot0, bot1, 1, rgb, blend, 0, 1);
  }
  if (strokeOn) {
    // This column only. Flat top and bottom. No join to the previous bar.
    nodeGraphWaterfallGlStampQuad(
      s, x0, wid, strokeTop, strokeTop, strokeBot, strokeBot, strokePx, stroke.rgb || rgb, blend, 1, strokePx,
    );
  }
  return true;
}

// R+B=G column (blend "combine", two channels) in one draw. The per-pixel
// colour is the shared Meet GLSL (public/lib/trace/trace-meet-glsl.js);
// JS only passes the spans and colours. uFormula 0 = the waterfall span
// variant (same result as the old L / R-only / overlap bar stamps).
// uFormula 1 = Trace's coverage mix (traceMeet2), kept as a switch only.
function nodeGraphWaterfallGlMeetFrag(spanGlsl, meetGlsl) {
  return `
precision mediump float;
uniform vec2 uSize;
varying vec2 uSpan;
varying vec4 uEdgeL;
varying vec4 vRaRb;
varying vec3 vOF;
varying vec3 uColorL;
varying vec3 uColorR;
varying vec3 uColorM;
${spanGlsl}
${meetGlsl}
// Smooth lines: same slope-aware edge coverage as the bar shader.
float wfSlopeCover(float y, float yTop, float yBot, float mTop, float mBot, float smoothOn) {
  float lo = min(yTop, yBot);
  float hi = max(yTop, yBot);
  float wLo = 1.0 + smoothOn * (yTop <= yBot ? mTop : mBot);
  float wHi = 1.0 + smoothOn * (yTop <= yBot ? mBot : mTop);
  float cTop = clamp((y - lo) / wLo + 0.5, 0.0, 1.0);
  float cBot = clamp((hi - y) / wHi + 0.5, 0.0, 1.0);
  return clamp(cTop + cBot - 1.0, 0.0, 1.0);
}
void main() {
  // vOF.z + 8 = Smooth lines on. Then 2 = queued column clear (see the bar
  // shader's uMode 2), 1 = Trace coverage formula.
  float smoothOn = step(7.5, vOF.z);
  float flag = vOF.z - 8.0 * smoothOn;
  if (flag > 1.5) {
    gl_FragColor = vec4(uColorL, 1.0);
    return;
  }
  // Canvas Y, top-down, as the bar shader. L may join the previous column
  // (uEdgeL = top0, top1, bot0, bot1); the R-only parts and L∩R are flat.
  float y = uSize.y - gl_FragCoord.y;
  float span = max(uSpan.y - uSpan.x, 1e-4);
  float t = clamp((gl_FragCoord.x - uSpan.x) / span, 0.0, 1.0);
  float yTop = mix(uEdgeL.x, uEdgeL.y, t);
  float yBot = mix(uEdgeL.z, uEdgeL.w, t);
  float cL = smoothOn > 0.5
    ? wfSlopeCover(y, yTop, yBot, abs(uEdgeL.y - uEdgeL.x) / span, abs(uEdgeL.w - uEdgeL.z) / span, 1.0)
    : traceBoxCover(y, min(yTop, yBot), max(yTop, yBot));
  float cRa = traceBoxCover(y, vRaRb.x, vRaRb.y);
  float cRb = traceBoxCover(y, vRaRb.z, vRaRb.w);
  float cO = traceBoxCover(y, vOF.x, vOF.y);
  vec4 o = flag > 0.5
    ? traceMeet2(cL, min(cRa + cRb + cO, 1.0), uColorL, uColorR, uColorM)
    : traceMeetSpan2(cL, cRa, cRb, cO, uColorL, uColorR, uColorM);
  if (o.a <= 0.0) discard;
  gl_FragColor = o;
}
`;
}

// Meet columns batch like bars: NODE_GRAPH_WF_GL_MEET_FLOATS per vertex.
const NODE_GRAPH_WF_GL_MEET_FLOATS = 24;
const NODE_GRAPH_WF_GL_MEET_VERT = `
attribute vec2 aPos;
attribute vec2 aSpan;
attribute vec4 aEdgeL;
attribute vec4 aRaRb;
attribute vec3 aOF;
attribute vec3 aColorL;
attribute vec3 aColorR;
attribute vec3 aColorM;
varying vec2 uSpan;
varying vec4 uEdgeL;
varying vec4 vRaRb;
varying vec3 vOF;
varying vec3 uColorL;
varying vec3 uColorR;
varying vec3 uColorM;
void main() {
  uSpan = aSpan;
  uEdgeL = aEdgeL;
  vRaRb = aRaRb;
  vOF = aOF;
  uColorL = aColorL;
  uColorR = aColorR;
  uColorM = aColorM;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

function nodeGraphWaterfallGlEnsureMeet(s) {
  if (s.meetProg !== undefined) return s.meetProg;
  const lib = typeof TraceMeetGlsl !== "undefined" ? TraceMeetGlsl : null;
  if (!lib || typeof lib.MEET_SPAN_GLSL !== "string" || typeof lib.MEET_GLSL !== "string") return null;
  const gl = s.gl;
  const prog = nodeGraphWaterfallGlProgram(
    gl,
    NODE_GRAPH_WF_GL_MEET_VERT,
    nodeGraphWaterfallGlMeetFrag(lib.MEET_SPAN_GLSL, lib.MEET_GLSL),
  );
  s.meetProg = prog;
  if (prog) {
    const u = (name) => gl.getUniformLocation(prog, name);
    const a = (name) => gl.getAttribLocation(prog, name);
    s.meetLoc = {
      size: u("uSize"),
      // [location, components] in vertex order (NODE_GRAPH_WF_GL_MEET_FLOATS).
      attribs: [
        [a("aPos"), 2], [a("aSpan"), 2], [a("aEdgeL"), 4], [a("aRaRb"), 4],
        [a("aOF"), 3], [a("aColorL"), 3], [a("aColorR"), 3], [a("aColorM"), 3],
      ],
    };
  }
  return prog;
}

/**
 * One 1px column of a two-channel Meet. leftYs / leftPrevEdge as
 * nodeGraphWaterfallGlStampBar gets them for L; parts =
 * nodeGraphWaterfallRightOnlySpans(leftYs, rightYs); colours 0…255.
 * Returns false (caller stamps the bars instead) when the shared GLSL or
 * the session is missing.
 */
function nodeGraphWaterfallGlStampMeetColumn(canvas, x, leftYs, leftPrevEdge, parts, rgbL, rgbR, rgbM, formula = 0) {
  const s = canvas && canvas._wfGlSession;
  if (!s || !s.gl || s.gl.isContextLost() || !s.read || !leftYs || !parts) return false;
  if (!Number.isFinite(leftYs.y0) || !Number.isFinite(leftYs.y1)) return false;
  const prog = nodeGraphWaterfallGlEnsureMeet(s);
  if (!prog) return false;
  const x0 = Number(x) || 0;
  const x1 = x0 + 1;
  const yTop = Math.min(leftYs.y0, leftYs.y1);
  const yBot = Math.max(leftYs.y0, leftYs.y1);
  let top0 = yTop;
  let bot0 = yBot;
  if (leftPrevEdge && Number.isFinite(leftPrevEdge.y0) && Number.isFinite(leftPrevEdge.y1)) {
    top0 = Math.min(leftPrevEdge.y0, leftPrevEdge.y1);
    bot0 = Math.max(leftPrevEdge.y0, leftPrevEdge.y1);
  }
  const only = Array.isArray(parts.only) ? parts.only : [];
  const flat = (span) => (span && Number.isFinite(span.y0) && Number.isFinite(span.y1)
    ? [Math.min(span.y0, span.y1), Math.max(span.y0, span.y1)]
    : [0, 0]);
  const ra = flat(only[0]);
  const rb = flat(only[1]);
  const ov = flat(parts.overlap);
  const c255 = (rgb) => [
    Math.max(0, Math.min(255, Number(rgb?.[0]) || 0)) / 255,
    Math.max(0, Math.min(255, Number(rgb?.[1]) || 0)) / 255,
    Math.max(0, Math.min(255, Number(rgb?.[2]) || 0)) / 255,
  ];
  const cl = c255(rgbL);
  const cr = c255(rgbR);
  const cm = c255(rgbM);
  // Quad = the rows any span can touch (+1px), like the bar stamps' fringe.
  let lo = Math.min(top0, yTop);
  let hi = Math.max(bot0, yBot);
  for (const span of [ra, rb, ov]) {
    if (span[1] > span[0]) {
      lo = Math.min(lo, span[0]);
      hi = Math.max(hi, span[1]);
    }
  }
  lo = Math.max(-1, lo - 1);
  hi = Math.min(s.h + 1, hi + 1);
  const clip = (px, py) => nodeGraphWaterfallGlClip(px, py, s.w, s.h);
  const a = clip(x0, lo);
  const b = clip(x1, lo);
  const c = clip(x0, hi);
  const d = clip(x1, hi);
  const corners = [a, b, c, c, b, d];
  const fm = (Number(formula) > 0.5 ? 1 : 0) + (s.smooth !== false ? 8 : 0);
  const mq = nodeGraphWaterfallGlQueueFor(s, "meet", "source-over", s.read.fbo, NODE_GRAPH_WF_GL_MEET_FLOATS * 6);
  const dd = mq.data;
  let o = mq.n;
  for (let v = 0; v < 6; v += 1) {
    const p = corners[v];
    dd[o] = p[0]; dd[o + 1] = p[1];
    dd[o + 2] = x0; dd[o + 3] = x1;
    dd[o + 4] = top0; dd[o + 5] = yTop; dd[o + 6] = bot0; dd[o + 7] = yBot;
    dd[o + 8] = ra[0]; dd[o + 9] = ra[1]; dd[o + 10] = rb[0]; dd[o + 11] = rb[1];
    dd[o + 12] = ov[0]; dd[o + 13] = ov[1]; dd[o + 14] = fm;
    dd[o + 15] = cl[0]; dd[o + 16] = cl[1]; dd[o + 17] = cl[2];
    dd[o + 18] = cr[0]; dd[o + 19] = cr[1]; dd[o + 20] = cr[2];
    dd[o + 21] = cm[0]; dd[o + 22] = cm[1]; dd[o + 23] = cm[2];
    o += NODE_GRAPH_WF_GL_MEET_FLOATS;
  }
  mq.n = o;
  return true;
}

function nodeGraphOnsetGlPositionLine(canvas, x) {
  const s = canvas && canvas._wfGlSession;
  if (!s || !s.gl) return;
  const gl = s.gl;
  nodeGraphWaterfallGlFlush(s);
  const px = Math.max(0, Math.min(s.w - 1, Math.floor(Number(x) || 0)));
  const clip = (ax, ay) => nodeGraphWaterfallGlClip(ax, ay, s.w, s.h);
  const a = clip(px, -1);
  const b = clip(px + 1, -1);
  const c = clip(px, s.h + 1);
  const d = clip(px + 1, s.h + 1);
  const verts = [a[0], a[1], b[0], b[1], c[0], c[1], c[0], c[1], b[0], b[1], d[0], d[1]];
  nodeGraphWaterfallGlQueueBar(s, verts, null, "position", [0.55, 0.55, 0.55], px, px + 1, [0, 0, s.h, s.h], 1, 0, 1);
  nodeGraphWaterfallGlFlush(s);
}

function nodeGraphWaterfallGlPresent(canvas, plateCss) {
  const s = nodeGraphWaterfallGlEnsure(canvas, plateCss || "#000000");
  if (!s) return false;
  nodeGraphWaterfallGlFlush(s);
  const gl = s.gl;
  const sub = Number(canvas._wfSubPx) || 0;
  const tex = s.read.tex;
  if (typeof nodeGraphSharedGlBindPresent === "function") {
    nodeGraphSharedGlBindPresent(gl, s.w, s.h);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, s.w, s.h);
  }
  gl.disable(gl.BLEND);
  nodeGraphWaterfallGlFilter(gl, tex, Math.abs(sub) > 0.001);
  nodeGraphWaterfallGlBindQuad(gl, s, s.presentProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(gl.getUniformLocation(s.presentProg, "uTex"), 0);
  gl.uniform2f(gl.getUniformLocation(s.presentProg, "uSize"), s.w, s.h);
  gl.uniform1f(gl.getUniformLocation(s.presentProg, "uSub"), sub);
  nodeGraphWaterfallGlDrawQuad(s);
  if (typeof nodeGraphSharedGlEndPresent === "function") {
    nodeGraphSharedGlEndPresent(gl);
  }
  const ctx = nodeGraphDisplayCanvasPresentContext(canvas);
  const dev = typeof nodeGraphSharedGlDevice === "function" ? nodeGraphSharedGlDevice() : null;
  if (!ctx || !dev?.canvas || gl.isContextLost()) return false;
  nodeGraphDisplayCanvasBlit(ctx, dev.canvas, 0, dev.canvas.height - s.h, s.w, s.h, 0, 0, s.w, s.h, false);
  if (canvas.style.imageRendering === "pixelated" || canvas.style.imageRendering === "auto") {
    canvas.style.imageRendering = "";
  }
  return true;
}

function nodeGraphWaterfallGlCold(canvas, plateCss) {
  if (!canvas) return false;
  // A live tape already has history. Present it. The next column or sweep
  // paints the new plate color. Do not clear the face because a setting changed.
  const started = Boolean(canvas._waterfall && canvas._waterfall.started);
  const hasHistory = Boolean(canvas._wfGlSession && canvas._wfGlSession.read);
  if (started || hasHistory || canvas._onset) {
    return nodeGraphWaterfallGlPresent(canvas, plateCss);
  }
  if (!nodeGraphWaterfallGlReset(canvas, plateCss)) return false;
  return nodeGraphWaterfallGlPresent(canvas, plateCss);
}

function nodeGraphWaterfallGlStampCanvas(face, sourceCanvas) {
  const s = face && face._wfGlSession;
  if (!s?.gl || !s.read?.fbo || !sourceCanvas) return false;
  nodeGraphWaterfallGlFlush(s);
  const gl = s.gl;
  if (!s.inkTex) {
    s.inkTex = gl.createTexture();
  }
  gl.bindTexture(gl.TEXTURE_2D, s.inkTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.read.fbo);
  gl.viewport(0, 0, s.w, s.h);
  gl.enable(gl.BLEND);
  // Canvas2D ink (pause/protect) is straight RGBA + globalAlpha — not premultiplied bars.
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  nodeGraphWaterfallGlBindQuad(gl, s, s.presentProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.inkTex);
  const texLoc = gl.getUniformLocation(s.presentProg, "uTex");
  if (texLoc) gl.uniform1i(texLoc, 0);
  const sizeLoc = gl.getUniformLocation(s.presentProg, "uSize");
  if (sizeLoc) gl.uniform2f(sizeLoc, s.w, s.h);
  const subLoc = gl.getUniformLocation(s.presentProg, "uSub");
  if (subLoc) gl.uniform1f(subLoc, 0);
  nodeGraphWaterfallGlDrawQuad(s);
  gl.disable(gl.BLEND);
  return true;
}

function nodeGraphWaterfallInkOverlay(face) {
  if (!face || !face.parentElement) return null;
  let ink = face._wfInkOverlay;
  if (!ink) {
    ink = document.createElement("canvas");
    ink.className = "node-module-scope-local-fallback-canvas node-waterfall-ink-overlay node-display-canvas";
    ink.setAttribute("aria-hidden", "true");
    ink.style.zIndex = "3";
    ink.style.background = "transparent";
    face._wfInkOverlay = ink;
  }
  if (ink.parentElement !== face.parentElement) face.parentElement.appendChild(ink);
  const w = Math.max(1, face.width | 0);
  const h = Math.max(1, face.height | 0);
  if (ink.width !== w) ink.width = w;
  if (ink.height !== h) ink.height = h;
  return ink;
}
