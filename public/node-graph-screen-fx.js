// Screen Space Shader host and View Feedback (one GPU pass chain over the
// whole circuit area). The GL graph's workspace canvases (plates, cables,
// dots and faces) keep their pictures as face textures on the shared picture
// device; this composites them into one scene texture, runs every enabled
// Screen Space Shader over it in patch order (ping-pong), and shows the result
// on #nodeScreenFxCanvas. View Feedback publishes the previous frame's final
// picture on its 📺 out (its own ping-pong pair, never read and written in the
// same frame).

const NODE_GRAPH_SCREEN_FX_MAX = 4096;

const nodeGraphScreenFxState = {
  active: false,
  kit: null,
  scene: null,
  passes: [null, null],
  views: [null, null],
  viewIndex: 0,
  programs: new Map(), // nodeId -> { source, program, uniforms, error }
  status: new Map(), // nodeId -> label text
  frames: 0,
  raf: 0,
};

const NODE_GRAPH_SCREEN_FX_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Face textures are top-down; the scene is FBO-style (row 0 = bottom) like every 📺 picture.
const NODE_GRAPH_SCREEN_FX_LAYER_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vec2(vUv.x, 1.0 - vUv.y));
}`;

const NODE_GRAPH_SCREEN_FX_COPY_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

function nodeGraphScreenFxShaderHeader() {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fxColor;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uTime;
vec4 scene(vec2 uv) { return texture(uScene, uv); }
#line 1
`;
}

function nodeGraphScreenFxCompile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) || gl.isContextLost()) return { shader };
  const log = String(gl.getShaderInfoLog(shader) || "compile failed");
  gl.deleteShader(shader);
  return { error: log };
}

function nodeGraphScreenFxLink(gl, vsSource, fsSource) {
  const vs = nodeGraphScreenFxCompile(gl, gl.VERTEX_SHADER, vsSource);
  if (vs.error) return { error: vs.error };
  const fs = nodeGraphScreenFxCompile(gl, gl.FRAGMENT_SHADER, fsSource);
  if (fs.error) {
    gl.deleteShader(vs.shader);
    return { error: fs.error };
  }
  const program = gl.createProgram();
  gl.attachShader(program, vs.shader);
  gl.attachShader(program, fs.shader);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(vs.shader);
  gl.deleteShader(fs.shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = String(gl.getProgramInfoLog(program) || "link failed");
    gl.deleteProgram(program);
    return { error: log };
  }
  return { program };
}

/** First error line, short: "line 4: 'foo' : undeclared identifier". */
function nodeGraphScreenFxErrorLabel(log) {
  const first = String(log || "").split("\n").map((line) => line.trim()).find(Boolean) || "error";
  const m = first.match(/^ERROR:\s*\d+:(\d+):\s*(.*)$/);
  return (m ? `line ${m[1]}: ${m[2]}` : first.replace(/^ERROR:\s*/, "")).slice(0, 120);
}

function nodeGraphScreenFxSurface(gl, w, h, surface) {
  if (surface && surface.w === w && surface.h === h) return surface;
  if (surface) {
    gl.deleteFramebuffer(surface.fbo);
    gl.deleteTexture(surface.texture);
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, fbo, w, h };
}

function nodeGraphScreenFxKit(gl) {
  const st = nodeGraphScreenFxState;
  if (st.kit?.gl === gl && !gl.isContextLost()) return st.kit;
  st.programs.clear();
  st.scene = null;
  st.passes = [null, null];
  st.views = [null, null];
  const layer = nodeGraphScreenFxLink(gl, NODE_GRAPH_SCREEN_FX_VS, NODE_GRAPH_SCREEN_FX_LAYER_FS);
  const copy = nodeGraphScreenFxLink(gl, NODE_GRAPH_SCREEN_FX_VS, NODE_GRAPH_SCREEN_FX_COPY_FS);
  if (!layer.program || !copy.program) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(null, "Screen FX: GL program link failed");
    st.kit = null;
    return null;
  }
  const black = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, black);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.bindTexture(gl.TEXTURE_2D, null);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  st.kit = {
    gl,
    vao,
    black,
    layer: layer.program,
    layerTex: gl.getUniformLocation(layer.program, "uTex"),
    copy: copy.program,
    copyTex: gl.getUniformLocation(copy.program, "uTex"),
  };
  return st.kit;
}

/** Compiled program for a node's current source (cached per source). */
function nodeGraphScreenFxProgram(gl, nodeId, script) {
  const st = nodeGraphScreenFxState;
  const cached = st.programs.get(nodeId);
  if (cached && cached.source === script.source) return cached;
  if (cached?.program) gl.deleteProgram(cached.program);
  const linked = nodeGraphScreenFxLink(
    gl,
    NODE_GRAPH_SCREEN_FX_VS,
    `${nodeGraphScreenFxShaderHeader()}${script.source}\nvoid main() { fxColor = effect(vUv); }\n`,
  );
  const entry = { source: script.source, program: linked.program || null, error: linked.error ? nodeGraphScreenFxErrorLabel(linked.error) : "" };
  if (entry.program) {
    const p = entry.program;
    entry.uScene = gl.getUniformLocation(p, "uScene");
    entry.uResolution = gl.getUniformLocation(p, "uResolution");
    entry.uTime = gl.getUniformLocation(p, "uTime");
    entry.floats = script.floats.map((name) => [name, gl.getUniformLocation(p, name)]);
    entry.samplers = script.samplers.map((name) => [name, gl.getUniformLocation(p, name)]);
  }
  st.programs.set(nodeId, entry);
  return entry;
}

/** Plain on-face label: compile error, or the input count. */
function nodeGraphScreenFxSetStatus(nodeId, text) {
  const st = nodeGraphScreenFxState;
  if (st.status.get(nodeId) === text) return;
  st.status.set(nodeId, text);
  const el = document.querySelector(`.node-screen-space-shader-body[data-node="${CSS.escape(nodeId)}"] [data-screen-space-shader-status]`);
  if (el) {
    el.textContent = text;
    el.classList.toggle("is-error", !text.startsWith("ok"));
  }
}

function nodeGraphScreenFxStatusFor(nodeId, script) {
  return nodeGraphScreenFxState.status.get(nodeId) || `ok · ${script.inputs.length} in`;
}

function nodeGraphScreenFxNodes() {
  const nodes = nodeGraphMvp?.patch?.nodes;
  const shaders = [];
  const feedback = [];
  if (!Array.isArray(nodes)) return { shaders, feedback };
  const bypassed = new Set(nodeGraphMvp?.patch?.bypassedNodes || []);
  for (const node of nodes) {
    if (!node?.id || bypassed.has(node.id) || node.bypass === true) continue;
    if (node.type === "screenSpaceShader") {
      const script = normalizeNodeGraphScreenSpaceShader(node.screenSpaceShader);
      if (script.enabled) shaders.push({ id: String(node.id), script });
    } else if (node.type === "viewFeedback") {
      feedback.push(String(node.id));
    }
  }
  return { shaders, feedback };
}

function nodeGraphScreenFxSources() {
  if (typeof nodeGraphGlGraphState === "undefined") return [];
  const g = nodeGraphGlGraphState;
  return [g.canvas, g.wireCanvas, g.dotsCanvas].filter((canvas) => canvas?.isConnected);
}

function nodeGraphScreenFxOverlay(host) {
  let canvas = document.getElementById("nodeScreenFxCanvas");
  if (!canvas || canvas.parentElement !== host) {
    canvas?.remove();
    canvas = document.createElement("canvas");
    canvas.id = "nodeScreenFxCanvas";
    canvas.className = "node-screen-fx-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
  }
  return canvas;
}

function nodeGraphScreenFxBackground(host) {
  const st = nodeGraphScreenFxState;
  const gen = typeof nodeGraphGlGraphState !== "undefined" ? nodeGraphGlGraphState.gen : 0;
  if (st.bgGen === gen && st.bg) return st.bg;
  st.bgGen = gen;
  const css = getComputedStyle(host).backgroundColor;
  st.bg = typeof nodeGraphGlGraphParseCssColor === "function"
    ? nodeGraphGlGraphParseCssColor(css, [0, 0, 0, 1])
    : [0, 0, 0, 1];
  st.bg[3] = 1;
  return st.bg;
}

function nodeGraphScreenFxSetActive(host, on) {
  const st = nodeGraphScreenFxState;
  if (st.active === on) return;
  st.active = on;
  host?.classList.toggle("screen-fx-on", on);
  for (const canvas of nodeGraphScreenFxSources()) {
    if (on) canvas.dataset.screenFxSource = "1";
    else delete canvas.dataset.screenFxSource;
  }
  if (!on) {
    const overlay = document.getElementById("nodeScreenFxCanvas");
    overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
  }
  // Sources switch between 2D bitmaps and face textures: repaint them once.
  if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
}

function nodeGraphScreenFxDraw(kit, target, program, textures) {
  const gl = kit.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.w, target.h);
  gl.useProgram(program);
  for (let i = 0; i < textures.length; i += 1) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textures[i]);
  }
  gl.bindVertexArray(kit.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
}

/** One frame of the chain. Returns the final surface, or null. */
function nodeGraphScreenFxRender(host, shaders, feedback) {
  const st = nodeGraphScreenFxState;
  const dev = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
  const gl = dev?.gl;
  if (!gl || gl.isContextLost()) return null;
  const kit = nodeGraphScreenFxKit(gl);
  if (!kit) return null;
  const sources = nodeGraphScreenFxSources();
  const base = sources[0];
  if (!base) return null;
  const w = Math.max(1, Math.min(NODE_GRAPH_SCREEN_FX_MAX, base.width | 0));
  const h = Math.max(1, Math.min(NODE_GRAPH_SCREEN_FX_MAX, base.height | 0));
  st.scene = nodeGraphScreenFxSurface(gl, w, h, st.scene);
  st.passes[0] = nodeGraphScreenFxSurface(gl, w, h, st.passes[0]);
  st.passes[1] = nodeGraphScreenFxSurface(gl, w, h, st.passes[1]);
  if (feedback.length) {
    st.views[0] = nodeGraphScreenFxSurface(gl, w, h, st.views[0]);
    st.views[1] = nodeGraphScreenFxSurface(gl, w, h, st.views[1]);
  }
  const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
  // 1. Scene: workspace background, then each layer in z order (straight alpha, like drawImage).
  const bg = nodeGraphScreenFxBackground(host);
  gl.bindFramebuffer(gl.FRAMEBUFFER, st.scene.fbo);
  gl.viewport(0, 0, w, h);
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  gl.useProgram(kit.layer);
  gl.uniform1i(kit.layerTex, 0);
  for (const canvas of sources) {
    const face = typeof nodeGraphSharedGlFaceTexture === "function" ? nodeGraphSharedGlFaceTexture(canvas) : null;
    if (!face?.texture) continue;
    nodeGraphScreenFxDraw(kit, st.scene, kit.layer, [face.texture]);
  }
  gl.disable(gl.BLEND);
  // 2. Screen Space Shaders in patch order, ping-pong.
  let input = st.scene;
  let out = 0;
  const now = performance.now() / 1000;
  for (const { id, script } of shaders) {
    const entry = nodeGraphScreenFxProgram(gl, id, script);
    if (!entry.program) {
      nodeGraphScreenFxSetStatus(id, entry.error);
      continue;
    }
    nodeGraphScreenFxSetStatus(id, `ok · ${script.inputs.length} in`);
    const target = st.passes[out];
    gl.useProgram(entry.program);
    gl.uniform1i(entry.uScene, 0);
    gl.uniform2f(entry.uResolution, w, h);
    gl.uniform1f(entry.uTime, now);
    for (const [name, loc] of entry.floats) {
      const v = typeof nodeGraphVideoGraphAudioLatest === "function" ? nodeGraphVideoGraphAudioLatest(id, name) : 0;
      gl.uniform1f(loc, Number.isFinite(v) ? v : 0);
    }
    const textures = [input.texture];
    entry.samplers.forEach(([name, loc], i) => {
      const pic = typeof nodeGraphPictureRead === "function" ? nodeGraphPictureRead(id, name) : null;
      gl.uniform1i(loc, i + 1);
      textures.push(pic?.texture || kit.black);
    });
    nodeGraphScreenFxDraw(kit, target, entry.program, textures);
    input = target;
    out ^= 1;
  }
  // 3. View Feedback: this frame's picture into the view texture nobody reads
  //    this frame, published for the next one.
  if (feedback.length) {
    const view = st.views[st.viewIndex];
    nodeGraphScreenFxDraw(kit, view, kit.copy, [input.texture]);
    gl.useProgram(kit.copy);
    for (const id of feedback) {
      if (typeof nodeGraphPicturePublish === "function") {
        nodeGraphPicturePublish(id, view.texture, w, h, { byReference: true });
      }
    }
    st.viewIndex ^= 1;
  }
  for (let i = 0; i < 5; i += 1) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(prevActive);
  gl.useProgram(prevProgram);
  return input;
}

function nodeGraphScreenFxTick() {
  const st = nodeGraphScreenFxState;
  st.raf = requestAnimationFrame(nodeGraphScreenFxTick);
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host) return;
  const { shaders, feedback } = nodeGraphScreenFxNodes();
  const want = (shaders.length > 0 || feedback.length > 0) && host.classList.contains("gl-graph-on") && host.clientWidth > 0;
  nodeGraphScreenFxSetActive(host, want);
  if (!want) return;
  // The GL graph can recreate its canvases: keep every source on face textures.
  for (const canvas of nodeGraphScreenFxSources()) {
    if (canvas.dataset.screenFxSource !== "1") {
      canvas.dataset.screenFxSource = "1";
      if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
    }
  }
  for (const id of st.programs.keys()) {
    if (!shaders.some((s) => s.id === id)) st.programs.delete(id);
  }
  const final = nodeGraphScreenFxRender(host, shaders, feedback);
  if (!final) return;
  const overlay = nodeGraphScreenFxOverlay(host);
  if (overlay.width !== final.w || overlay.height !== final.h) {
    overlay.width = final.w;
    overlay.height = final.h;
  }
  if (typeof nodeGraphPicturePresent === "function") {
    nodeGraphPicturePresent(final.texture, final.w, final.h, overlay, final.w, final.h);
  }
  st.frames += 1;
}

if (typeof window !== "undefined" && !nodeGraphScreenFxState.raf) {
  nodeGraphScreenFxState.raf = requestAnimationFrame(nodeGraphScreenFxTick);
}
