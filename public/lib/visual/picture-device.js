// One hidden WebGL2 context (4096²) for every display that shares GPU work.
// Faces are face boxes with a face texture; present scissors then copies. A 📺 cable
// publishes a texture id on this device — no byte copy between modules.
// Never resize the canvas: a resize wipes every texture on the context.
// WebGL1 is not requested (P0d).

(function initNodeGraphPictureDevice(global) {
  const MAX_DIM = 4096;
  let device = null;
  // nodeId -> { texture, width, height, framebuffer?, ref? }. A ref slot
  // (VG-5) points at the producer's own output texture: nothing to copy and
  // nothing to delete here (the producer owns it).
  const published = new Map();
  const publishStats = { copies: 0, refs: 0 };

  const COPY_FS = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main() {
      gl_FragColor = texture2D(uTexture, vUv);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "picture-device.js");
  }

  function nodeGraphPictureDevice() {
    if (device?.gl && !device.gl.isContextLost()) return device;
    device = null;
    published.clear();
    const canvas = document.createElement("canvas");
    canvas.width = MAX_DIM;
    canvas.height = MAX_DIM;
    const attrs = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    };
    const gl = canvas.getContext("webgl2", attrs);
    if (!gl) return null;
    const program = link(gl, SoemGl.GLSL_FULLSCREEN_VS, COPY_FS);
    if (!program) return null;
    const quad = SoemGl.quad(gl);
    SoemGl.watchContextLoss(canvas, gl, () => {
      device = null;
      published.clear();
    });
    device = {
      canvas,
      gl,
      quad,
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uTexture: gl.getUniformLocation(program, "uTexture"),
    };
    return device;
  }

  function drawTexturedQuad(gl, dev, texture, width, height, over = false) {
    gl.viewport(0, 0, width, height);
    if (over) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(dev.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, dev.quad);
    gl.enableVertexAttribArray(dev.aPos);
    gl.vertexAttribPointer(dev.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(dev.uTexture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (over) {
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  function ensureExport(gl, nodeId, width, height) {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    let slot = published.get(nodeId);
    if (slot && !slot.ref && slot.width === w && slot.height === h && slot.texture) return slot;
    if (slot && !slot.ref) {
      if (slot.framebuffer) gl.deleteFramebuffer(slot.framebuffer);
      if (slot.texture) gl.deleteTexture(slot.texture);
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!ok) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      published.delete(nodeId);
      return null;
    }
    slot = { texture, framebuffer, width: w, height: h };
    published.set(nodeId, slot);
    return slot;
  }

  /**
   * Publish a finished picture for the node's ?? out.
   * options.byReference (VG-5): the texture itself becomes the output, no
   * copy. Only for RGBA8 LINEAR textures the producer never draws into while
   * they are published (ping-pong read side, or a texture rebuilt from scratch
   * before each publish). Other producers (NEAREST grids, float accumulators
   * that the RGBA8 copy clamps) keep the copy so consumers see the same look.
   */
  function nodeGraphPicturePublish(nodeId, texture, width, height, options = null) {
    const id = String(nodeId || "").trim();
    if (!id || !texture) return false;
    // VG-2: no cable reads this picture, so skip the copy.
    if (!nodeGraphPictureHasReader(id)) return false;
    const dev = nodeGraphPictureDevice();
    if (!dev?.gl) return false;
    const gl = dev.gl;
    if (options?.byReference) {
      const old = published.get(id);
      if (old && !old.ref) {
        if (old.framebuffer) gl.deleteFramebuffer(old.framebuffer);
        if (old.texture) gl.deleteTexture(old.texture);
      }
      published.set(id, { texture, width: Math.max(1, width | 0), height: Math.max(1, height | 0), ref: true });
      publishStats.refs += 1;
      return true;
    }
    publishStats.copies += 1;
    const slot = ensureExport(gl, id, width, height);
    if (!slot) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, slot.framebuffer);
    gl.scissor(0, 0, slot.width, slot.height);
    gl.enable(gl.SCISSOR_TEST);
    drawTexturedQuad(gl, dev, texture, slot.width, slot.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }

  function connectionEnd(connection, end) {
    if (end === "from") {
      return {
        node: String(connection?.sourceNode || connection?.fromNode || ""),
        port: String(connection?.sourcePort || connection?.fromPort || ""),
      };
    }
    return {
      node: String(connection?.destinationNode || connection?.toNode || ""),
      port: String(connection?.destinationPort || connection?.toPort || ""),
    };
  }

  function isTvPort(port) {
    const name = String(port || "");
    return name === "rgba" || name === "📺";
  }

  // VG-1: ?? edge table. Built once from the patch's connection list and
  // reused until the list changes (new array or new length: every patch edit
  // commits a fresh array). Reads and consumer checks never walk the list.
  // nodeGraphPictureEdgesInvalidate() forces a rebuild after an in-place edit.
  const edges = { list: null, length: -1, nodes: null, nodesLength: -1, inlets: new Map(), upstream: new Map(), sources: new Set(), tvSources: new Set(), rebuilds: 0, lookups: 0 };
  // upstream: dest node -> source nodes over any picture cable (??, and the
  // RGB Picture R/G/B/rgba inlets). The video graph walks it for culling.
  // RGB Picture also takes a source's picture over its R/G/B (and rgba) cables
  // (any cable type); those are inlets too, read with nodeGraphPictureRead.
  // sources: every node read over any picture inlet (a video producer's own
  // output publishes for these). tvSources: only nodes with a 📺 / rgba cable
  // leaving them. Module faces (gl-line-renderer, PublishCanvas) publish only
  // for tvSources: an audio cable into Scan Grid R/G/B must not turn the
  // source's face (e.g. SinCos4) into the picture Scan Grid shows.
  // Inlets that take a source's picture over a non-📺 cable. Scan Grid's
  // R / G / B are audio: X / Y / Z (or any signal) cabled there is scanned into
  // pixels, never swapped for the source module's picture. A picture reaches
  // Scan Grid only over a cable that leaves a 📺 out.
  const PICTURE_GET_INLETS = { rasterRgb: new Set(["rgba"]) };

  function patchConnections() {
    return nodeGraphMvp?.patch?.connections || nodeGraphMvp?.connections || null;
  }

  function nodeGraphPictureEdges() {
    const list = patchConnections();
    const length = Array.isArray(list) ? list.length : 0;
    const nodes = nodeGraphMvp?.patch?.nodes || null;
    const nodesLength = Array.isArray(nodes) ? nodes.length : 0;
    if (list === edges.list && length === edges.length && nodes === edges.nodes && nodesLength === edges.nodesLength) return edges;
    edges.list = list;
    edges.length = length;
    edges.nodes = nodes;
    edges.nodesLength = nodesLength;
    const typeOf = new Map();
    for (let i = 0; i < nodesLength; i += 1) typeOf.set(String(nodes[i]?.id || ""), String(nodes[i]?.type || ""));
    edges.inlets = new Map();
    edges.upstream = new Map();
    edges.sources = new Set();
    edges.tvSources = new Set();
    const up = (dest, src) => {
      const list = edges.upstream.get(dest);
      if (!list) edges.upstream.set(dest, [src]);
      else if (!list.includes(src)) list.push(src);
    };
    edges.rebuilds += 1;
    for (let i = 0; i < length; i += 1) {
      const from = connectionEnd(list[i], "from");
      if (!from.node) continue;
      const to = connectionEnd(list[i], "to");
      if (!isTvPort(from.port) && !PICTURE_GET_INLETS[typeOf.get(to.node)]?.has(to.port)) continue;
      // A 📺 cable, or an explicit picture inlet (PICTURE_GET_INLETS), carries
      // the source's picture (read through nodeGraphPictureRead).
      edges.sources.add(from.node);
      if (isTvPort(from.port)) edges.tvSources.add(from.node);
      if (!to.node) continue;
      up(to.node, from.node);
      const key = `${to.node}\u0000${to.port}`;
      const feeds = edges.inlets.get(key);
      if (feeds) feeds.push(from.node);
      else edges.inlets.set(key, [from.node]);
    }
    return edges;
  }

  function nodeGraphPictureEdgesInvalidate() {
    edges.list = null;
    edges.length = -1;
    edges.nodes = null;
  }

  /** Probe/smoke counters: table rebuilds and lookups served from it. */
  function nodeGraphPictureEdgeStats() {
    return { rebuilds: edges.rebuilds, lookups: edges.lookups, inlets: edges.inlets.size, sources: edges.sources.size, tvSources: edges.tvSources.size, copies: publishStats.copies, refs: publishStats.refs };
  }

  /** True when any cable leaves this node's picture out (`rgba` / TV). */
  function nodeGraphPictureHasConsumer(nodeId) {
    const id = String(nodeId || "").trim();
    if (!id) return false;
    const table = nodeGraphPictureEdges();
    table.lookups += 1;
    return table.tvSources.has(id);
  }

  /** True when any picture inlet reads this node (TV cables, Scan Grid R/G/B/rgba). */
  function nodeGraphPictureHasReader(nodeId) {
    const id = String(nodeId || "").trim();
    if (!id) return false;
    const table = nodeGraphPictureEdges();
    table.lookups += 1;
    return table.sources.has(id);
  }

  /**
   * Render target for a node's picture out (gl-line-renderer draws straight
   * into it). Same stable texture nodeGraphPictureRead hands to consumers.
   * Wire convention: premultiplied RGBA; opaque sources are unaffected.
   */
  function nodeGraphPictureExportTarget(nodeId, width, height) {
    const id = String(nodeId || "").trim();
    const dev = nodeGraphPictureDevice();
    if (!id || !dev?.gl) return null;
    return ensureExport(dev.gl, id, width, height);
  }

  /**
   * A face's GPU picture into the node's picture texture (only when a cable
   * is connected). GPU-to-GPU blit from the face texture; no canvas upload.
   */
  function nodeGraphPicturePublishCanvas(nodeId, canvas) {
    const id = String(nodeId || "").trim();
    if (!id || !canvas || !(canvas.width > 0) || !(canvas.height > 0)) return false;
    if (!nodeGraphPictureHasConsumer(id)) return false;
    const dev = nodeGraphPictureDevice();
    if (!dev?.gl) return false;
    const gl = dev.gl;
    const slot = ensureExport(gl, id, canvas.width, canvas.height);
    if (!slot) return false;
    const face = nodeGraphSharedGlFaceTexture(canvas);
    if (face && slot.framebuffer) {
      // Face texture is top-down; pictures are FBO-style (row 0 = bottom): flip.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, face.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, slot.framebuffer);
      gl.blitFramebuffer(0, 0, face.w, face.h, 0, face.h, face.w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      return true;
    }
    // GPU faces only: a face that has not painted yet has no picture to
    // publish. Never upload its 2D canvas (all-GPU display rule).
    return false;
  }

  /** Latest published picture for a node id (no cable walk). */
  function nodeGraphPictureGet(nodeId) {
    const id = String(nodeId || "").trim();
    if (!id) return null;
    const slot = published.get(id);
    if (!slot?.texture) return null;
    return { texture: slot.texture, width: slot.width, height: slot.height, nodeId: id };
  }

  /** Latest published texture feeding this inlet, or null. */
  function nodeGraphPictureRead(nodeId, portName) {
    const id = String(nodeId || "").trim();
    if (!id) return null;
    const table = nodeGraphPictureEdges();
    table.lookups += 1;
    const feeds = table.inlets.get(`${id}\u0000${String(portName || "rgba")}`);
    if (!feeds) return null;
    for (let i = 0; i < feeds.length; i += 1) {
      const slot = published.get(feeds[i]);
      if (slot?.texture) {
        return { texture: slot.texture, width: slot.width, height: slot.height, nodeId: feeds[i] };
      }
    }
    return null;
  }

  /**
   * Show a device texture on a face box (its face texture) or a real canvas.
   * The 📺 wire does not use this blit.
   */
  function nodeGraphPicturePresent(texture, srcW, srcH, destCanvas, destW, destH) {
    const dev = nodeGraphPictureDevice();
    if (!dev?.gl || !texture || !destCanvas) return false;
    const gl = dev.gl;
    const rw = Math.max(1, Math.min(MAX_DIM, srcW | 0));
    const rh = Math.max(1, Math.min(MAX_DIM, srcH | 0));
    const dw = Math.max(1, destW | 0);
    const dh = Math.max(1, destH | 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, rw, rh);
    gl.scissor(0, 0, rw, rh);
    gl.enable(gl.SCISSOR_TEST);
    // Premultiplied picture over an opaque black plate (respects alpha).
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawTexturedQuad(gl, dev, texture, rw, rh, true);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const ctx = nodeGraphSharedGlPresentTarget(destCanvas);
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const srcY = Math.max(0, dev.canvas.height - rh);
    return nodeGraphSharedGlCopyToContext(ctx, 0, srcY, rw, rh, 0, 0, dw, dh, rw !== dw || rh !== dh);
  }

  /** Shared WebGL for every display (P0a). Never resize this canvas (P0c). */
  function nodeGraphSharedGlDevice() {
    return nodeGraphPictureDevice();
  }

  function nodeGraphSharedGlBindPresent(gl, width, height) {
    if (!gl) return null;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, w, h);
    gl.viewport(0, 0, w, h);
    return { w, h };
  }

  function nodeGraphSharedGlEndPresent(gl) {
    if (!gl) return;
    gl.disable(gl.SCISSOR_TEST);
  }

  // ---- Face textures (ZP-2, docs/ZOOM_PERF_PLAN.md; layering Stage 4b) -----
  // A display face is a face box (display-canvas.js): a zoom-1 layout record
  // that carries its backing size (width / height) but has no <canvas> and no
  // 2D bitmap. Its picture lives only in a per-face texture. A face renders
  // into the bottom-left of this 4096 canvas, then a GPU-to-GPU copy lands it
  // in that texture at the face's backing size, only when the face paints.
  // The GL graph, Canvas tiles, screen solo, Mini Canvas, the magnifier and
  // snapshots sample that texture (gl-line-renderer drawImages), so no face is
  // read back to the CPU (no readPixels) and nothing uploads a 2D canvas.
  //
  // Textures are keyed by face identity, node id + face slot
  // (nodeGraphDisplayFaceKey), not by element: a face box rebuilt with its
  // module keeps its picture. Every helper below takes a face box, a face key
  // or a face texture entry.
  //
  // Storage is top-down: texture row 0 = the face's top row, the same as a
  // texImage2D upload with UNPACK_FLIP_Y false. Framebuffer rows are
  // bottom-up, so the copy flips v once here and every consumer draws upright.
  //
  // A real <canvas> a GPU pass reads (a workspace layer the Screen Space
  // Shader host samples, data-screen-fx-source) is texture-only too. Any other
  // real canvas (an on-screen 2D plate, e.g. the colour widget) gets the
  // browser's 2D drawImage and no texture.
  const faceTextures = new Map(); // face key -> entry
  // face key -> "WxH" whose face texture FBO failed: not retried every frame.
  const faceFailed = new Map();
  const FACE_SWEEP_MS = 5000;
  let faceSweepAt = 0;
  let faceKit = null;

  const FACE_VS = `
    attribute vec2 aPos;
    uniform vec4 uDst;
    uniform vec2 uSize;
    uniform vec2 uUvMax;
    varying vec2 vUv;
    void main() {
      vec2 px = uDst.xy + aPos * uDst.zw;
      gl_Position = vec4(px / uSize * 2.0 - 1.0, 0.0, 1.0);
      vUv = vec2(aPos.x, 1.0 - aPos.y) * uUvMax;
    }
  `;
  const FACE_FS = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float uAlpha;
    void main() {
      vec4 c = texture2D(uTexture, vUv);
      gl_FragColor = vec4(c.rgb, c.a * uAlpha);
    }
  `;

  function nodeGraphSharedGlFaceKit(gl) {
    if (faceKit && faceKit.gl === gl) return faceKit.ok ? faceKit : null;
    const program = link(gl, FACE_VS, FACE_FS);
    if (!program) {
      faceKit = { gl, ok: false };
      if (typeof global.nodeGraphDisplayGlFailed === "function") {
        global.nodeGraphDisplayGlFailed(null, "face texture: GL program link failed");
      }
      return null;
    }
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    faceKit = {
      gl,
      ok: true,
      program,
      vao,
      buf,
      uDst: gl.getUniformLocation(program, "uDst"),
      uSize: gl.getUniformLocation(program, "uSize"),
      uUvMax: gl.getUniformLocation(program, "uUvMax"),
      uTexture: gl.getUniformLocation(program, "uTexture"),
      uAlpha: gl.getUniformLocation(program, "uAlpha"),
      scratch: null,
      scratchW: 0,
      scratchH: 0,
    };
    return faceKit;
  }

  function faceTexParams(gl, filter) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * True when this element's picture lives only in its face texture: a face
   * box, or a workspace layer canvas the Screen Space Shader host reads
   * (data-screen-fx-source).
   */
  function nodeGraphSharedGlFaceTextureOnly(el) {
    if (!el || typeof el !== "object") return false;
    if (el.dataset?.screenFxSource === "1") return true;
    return Boolean(el.classList?.contains(global.NODE_GRAPH_DISPLAY_FACE_CLASS || "node-display-face"));
  }

  function faceKeyOf(face) {
    if (typeof face === "string") return face;
    return typeof global.nodeGraphDisplayFaceKey === "function" ? global.nodeGraphDisplayFaceKey(face) : "";
  }

  /** The texture entry for a face box, face key or entry (any size). */
  function faceEntryOf(face) {
    if (!face) return null;
    if (face.glFaceTexture === true) return face;
    const key = faceKeyOf(face);
    return key ? faceTextures.get(key) || null : null;
  }

  function faceDelete(gl, entry) {
    if (!entry) return;
    if (entry.fbo) gl.deleteFramebuffer(entry.fbo);
    if (entry.texture) gl.deleteTexture(entry.texture);
    entry.fbo = null;
    entry.texture = null;
  }

  /** Drop a face's texture (its module's display went away or repaints from scratch). */
  function nodeGraphSharedGlFaceForget(face) {
    const entry = faceEntryOf(face);
    if (!entry) return;
    const gl = nodeGraphPictureDevice()?.gl;
    if (gl && !gl.isContextLost()) faceDelete(gl, entry);
    faceTextures.delete(entry.key);
    faceFailed.delete(entry.key);
  }

  // A texture whose last face box left the document and has no connected
  // successor (same key) belongs to a deleted display: free it.
  function faceSweep(gl) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now < faceSweepAt) return;
    faceSweepAt = now + FACE_SWEEP_MS;
    const doc = global.document;
    for (const [key, entry] of faceTextures) {
      if (entry.owner?.isConnected) continue;
      const next = doc?.querySelector?.(`[data-face-key="${global.CSS?.escape ? global.CSS.escape(key) : key}"]`);
      if (next?.isConnected) {
        entry.owner = next;
        continue;
      }
      faceDelete(gl, entry);
      faceTextures.delete(key);
    }
  }

  function faceEnsure(gl, face) {
    const key = faceKeyOf(face);
    const cw = face.width | 0;
    const ch = face.height | 0;
    if (!key || !(cw > 0) || !(ch > 0) || cw > MAX_DIM || ch > MAX_DIM) return null;
    let entry = faceTextures.get(key);
    if (entry && entry.gl === gl && entry.w === cw && entry.h === ch && entry.texture) {
      if (entry.owner !== face) entry.owner = face;
      return entry;
    }
    if (faceFailed.get(key) === `${cw}x${ch}`) return null;
    faceSweep(gl);
    if (entry) faceDelete(gl, entry);
    // A face has no 2D bitmap: a new texture starts transparent (no upload).
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    faceTexParams(gl, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
      faceTextures.delete(key);
      faceFailed.set(key, `${cw}x${ch}`);
      return null;
    }
    faceFailed.delete(key);
    entry = { gl, key, owner: face, texture, fbo, w: cw, h: ch, gen: 0, glFaceTexture: true };
    faceTextures.set(key, entry);
    return entry;
  }

  /**
   * Current GPU picture of a face (face box, face key or entry):
   * { texture, w, h, gen, key } (top-down), or null when it has none or a
   * face box was resized since its last copy.
   */
  function nodeGraphSharedGlFaceTexture(face) {
    const entry = faceEntryOf(face);
    if (!entry?.texture) return null;
    if (typeof face === "object" && face !== entry
      && (entry.w !== (face.width | 0) || entry.h !== (face.height | 0))) {
      return null;
    }
    return entry;
  }

  /**
   * Fill a face's texture with one straight-alpha colour (the GL failure
   * policy's black plate). Returns false when the face has no backing size.
   */
  function nodeGraphSharedGlFaceFill(face, rgba = [0, 0, 0, 1]) {
    const gl = nodeGraphPictureDevice()?.gl;
    if (!gl || gl.isContextLost() || !face || typeof face !== "object") return false;
    const entry = faceEnsure(gl, face);
    if (!entry) return false;
    const prevScissor = gl.isEnabled(gl.SCISSOR_TEST);
    const prevClear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(rgba[0], rgba[1], rgba[2], rgba.length > 3 ? rgba[3] : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(prevClear[0], prevClear[1], prevClear[2], prevClear[3]);
    if (prevScissor) gl.enable(gl.SCISSOR_TEST);
    entry.gen += 1;
    return true;
  }

  /**
   * Where a picture is presented: a face box (or screen-fx layer) gets a
   * present target that lands copies in its face texture; a real on-screen
   * canvas gets its own 2D context. A present target carries only the state a
   * copy reads (globalAlpha, globalCompositeOperation, smoothing) and
   * save / restore / setTransform; copies are in face pixels, so a
   * transform never applies. Nothing draws 2D into a face.
   */
  function nodeGraphSharedGlPresentTarget(el) {
    if (!el || typeof el !== "object") return null;
    if (!nodeGraphSharedGlFaceTextureOnly(el)) {
      return typeof el.getContext === "function" ? el.getContext("2d") : null;
    }
    if (el._glPresentTarget?.canvas === el) return el._glPresentTarget;
    const target = {
      facePresentTarget: true,
      canvas: el,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      filter: "none",
      stack: [],
      save() {
        this.stack.push([this.globalAlpha, this.globalCompositeOperation, this.imageSmoothingEnabled, this.filter]);
      },
      restore() {
        const top = this.stack.pop();
        if (top) [this.globalAlpha, this.globalCompositeOperation, this.imageSmoothingEnabled, this.filter] = top;
      },
      setTransform() {},
    };
    el._glPresentTarget = target;
    return target;
  }

  function faceBlendFor(gl, op, replace) {
    if (replace || op === "copy") {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    // The shared canvas is premultipliedAlpha:false, so drawImage treated its
    // pixels as straight alpha. Same here, for an unchanged look.
    if (op === "lighter") gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Land a rectangle of the shared canvas (sx, sy, sw, sh in canvas pixels,
   * top-down, like drawImage) at dx, dy, dw, dh of a present target
   * (nodeGraphSharedGlPresentTarget): GPU-to-GPU into the face texture, or
   * the 2D drawImage for a real on-screen canvas. options.replace: the
   * destination rect is replaced, not blended (a transparent batch).
   */
  function nodeGraphSharedGlCopyToContext(destCtx, sx, sy, sw, sh, dx, dy, dw, dh, smooth, options = null) {
    const pic = nodeGraphPictureDevice();
    const gl = pic?.gl;
    const srcCanvas = pic?.canvas;
    const canvas = destCtx?.canvas;
    if (!gl || gl.isContextLost() || !srcCanvas || !canvas) return false;
    const w = Math.max(1, sw | 0);
    const h = Math.max(1, sh | 0);
    const destW = Number(dw);
    const destH = Number(dh);
    if (!(Math.abs(destW) > 0) || !(Math.abs(destH) > 0)) return false;
    const glX = sx | 0;
    const glY = srcCanvas.height - ((sy | 0) + h);
    if (glX < 0 || glY < 0 || glX + w > srcCanvas.width || glY + h > srcCanvas.height) return false;
    if (!nodeGraphSharedGlFaceTextureOnly(canvas)) {
      // On-screen 2D canvas: the browser's canvas blit (HEAD path, upright).
      destCtx.imageSmoothingEnabled = Boolean(smooth);
      if ("imageSmoothingQuality" in destCtx) destCtx.imageSmoothingQuality = smooth ? "medium" : "low";
      destCtx.drawImage(srcCanvas, glX, sy | 0, w, h, dx, dy, destW, destH);
      return true;
    }
    const kit = nodeGraphSharedGlFaceKit(gl);
    const entry = kit ? faceEnsure(gl, canvas) : null;
    if (!entry) {
      if (typeof global.nodeGraphDisplayGlFailed === "function") {
        global.nodeGraphDisplayGlFailed(canvas, "face texture: GL copy failed");
      }
      return false;
    }
    // Save the bits of state a caller may still rely on after its blit.
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
    const prevViewport = gl.getParameter(gl.VIEWPORT);
    const prevScissor = gl.isEnabled(gl.SCISSOR_TEST);
    const prevBlend = gl.isEnabled(gl.BLEND);
    // 1. Source rect -> scratch texture (framebuffer rows, bottom-up).
    gl.activeTexture(gl.TEXTURE0);
    if (!kit.scratch || kit.scratchW < w || kit.scratchH < h) {
      if (kit.scratch) gl.deleteTexture(kit.scratch);
      kit.scratchW = Math.max(w, kit.scratchW);
      kit.scratchH = Math.max(h, kit.scratchH);
      kit.scratch = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, kit.scratch);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, kit.scratchW, kit.scratchH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, kit.scratch);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, glX, glY, w, h);
    faceTexParams(gl, smooth ? gl.LINEAR : gl.NEAREST);
    // 2. Scratch -> face texture at the destination rect, v flipped to top-down.
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
    gl.viewport(0, 0, entry.w, entry.h);
    gl.disable(gl.SCISSOR_TEST);
    faceBlendFor(gl, destCtx.globalCompositeOperation, options?.replace === true);
    gl.useProgram(kit.program);
    gl.uniform4f(kit.uDst, Number(dx) || 0, Number(dy) || 0, destW, destH);
    gl.uniform2f(kit.uSize, entry.w, entry.h);
    gl.uniform2f(kit.uUvMax, w / kit.scratchW, h / kit.scratchH);
    gl.uniform1i(kit.uTexture, 0);
    const ga = Number(destCtx.globalAlpha);
    gl.uniform1f(kit.uAlpha, Number.isFinite(ga) ? Math.max(0, Math.min(1, ga)) : 1);
    gl.bindVertexArray(kit.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(prevVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(prevActive);
    gl.useProgram(prevProgram);
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    if (prevScissor) gl.enable(gl.SCISSOR_TEST);
    if (prevBlend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    entry.gen += 1;
    return true;
  }

  /** A new texture holding a copy of a face's picture (top-down), or null. */
  function nodeGraphSharedGlFaceCopyTexture(face) {
    const entry = nodeGraphSharedGlFaceTexture(face);
    const gl = entry?.gl;
    if (!entry || !gl || gl.isContextLost()) return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    faceTexParams(gl, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, entry.w, entry.h, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, width: entry.w, height: entry.h };
  }

  /**
   * Test / debug only (never per frame): a face's pixels, top-down RGBA.
   * Faces have no 2D bitmap, so smokes read this (face box, key or entry).
   */
  function nodeGraphSharedGlFacePixels(face) {
    const entry = nodeGraphSharedGlFaceTexture(face);
    const gl = entry?.gl;
    if (!entry || !gl || gl.isContextLost()) return null;
    const data = new Uint8Array(entry.w * entry.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
    gl.readPixels(0, 0, entry.w, entry.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: entry.w, height: entry.h, data };
  }

  /** The device's bottom-left width x height lands at 0, 0 of a present target. */
  function nodeGraphSharedGlPresent(destCtx, width, height, options = null) {
    const pic = nodeGraphPictureDevice();
    if (!pic?.canvas || !destCtx) return false;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    const srcY = Math.max(0, pic.canvas.height - h);
    return nodeGraphSharedGlCopyToContext(destCtx, 0, srcY, w, h, 0, 0, w, h, false, options);
  }

  global.nodeGraphPictureDevice = nodeGraphPictureDevice;
  global.nodeGraphPicturePublish = nodeGraphPicturePublish;
  global.nodeGraphSharedGlDevice = nodeGraphSharedGlDevice;
  global.nodeGraphSharedGlBindPresent = nodeGraphSharedGlBindPresent;
  global.nodeGraphSharedGlEndPresent = nodeGraphSharedGlEndPresent;
  global.nodeGraphSharedGlPresent = nodeGraphSharedGlPresent;
  global.nodeGraphSharedGlPresentTarget = nodeGraphSharedGlPresentTarget;
  global.nodeGraphSharedGlCopyToContext = nodeGraphSharedGlCopyToContext;
  global.nodeGraphSharedGlFaceTexture = nodeGraphSharedGlFaceTexture;
  global.nodeGraphSharedGlFaceTextureOnly = nodeGraphSharedGlFaceTextureOnly;
  global.nodeGraphSharedGlFaceForget = nodeGraphSharedGlFaceForget;
  global.nodeGraphSharedGlFaceFill = nodeGraphSharedGlFaceFill;
  global.nodeGraphSharedGlFaceCopyTexture = nodeGraphSharedGlFaceCopyTexture;
  global.nodeGraphSharedGlFacePixels = nodeGraphSharedGlFacePixels;
  global.nodeGraphPictureGet = nodeGraphPictureGet;
  global.nodeGraphPictureRead = nodeGraphPictureRead;
  global.nodeGraphPicturePresent = nodeGraphPicturePresent;
  global.nodeGraphPictureHasConsumer = nodeGraphPictureHasConsumer;
  global.nodeGraphPictureHasReader = nodeGraphPictureHasReader;
  global.nodeGraphPictureEdges = nodeGraphPictureEdges;
  global.nodeGraphPictureEdgesInvalidate = nodeGraphPictureEdgesInvalidate;
  global.nodeGraphPictureEdgeStats = nodeGraphPictureEdgeStats;
  global.nodeGraphPictureExportTarget = nodeGraphPictureExportTarget;
  global.nodeGraphPicturePublishCanvas = nodeGraphPicturePublishCanvas;
})(typeof globalThis !== "undefined" ? globalThis : window);
