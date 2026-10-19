// One hidden WebGL2 context (4096²) for every display that shares GPU work.
// Faces are ordinary 2D canvases; present scissors then blits. A 📺 cable
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
    if (!nodeGraphPictureHasConsumer(id)) return false;
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
  const edges = { list: null, length: -1, nodes: null, nodesLength: -1, inlets: new Map(), upstream: new Map(), sources: new Set(), rebuilds: 0, lookups: 0 };
  // upstream: dest node -> source nodes over any picture cable (??, and the
  // RGB Picture R/G/B/rgba inlets). The video graph walks it for culling.
  // RGB Picture also takes a source's picture over its R/G/B (and rgba) cables
  // through nodeGraphPictureGet, so those sources count as consumed too.
  const PICTURE_GET_INLETS = { rasterRgb: new Set(["R", "G", "B", "rgba"]) };

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
      if (!isTvPort(from.port)) {
        if (PICTURE_GET_INLETS[typeOf.get(to.node)]?.has(to.port)) {
          edges.sources.add(from.node);
          up(to.node, from.node);
        }
        continue;
      }
      edges.sources.add(from.node);
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
    return { rebuilds: edges.rebuilds, lookups: edges.lookups, inlets: edges.inlets.size, sources: edges.sources.size, copies: publishStats.copies, refs: publishStats.refs };
  }

  /** True when any cable leaves this node's picture out (`rgba` / TV). */
  function nodeGraphPictureHasConsumer(nodeId) {
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
   * Show a device texture on a face canvas (2D plate).
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
    const ctx = destCanvas.getContext("2d");
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

  // ---- Face textures (ZP-2, docs/ZOOM_PERF_PLAN.md) -----------------------
  // A face renders into the bottom-left of this 4096 canvas, then lands on its
  // display canvas. That landing is a GPU-to-GPU copy into a per-face texture
  // at the face canvas size (zoom-1 backing), made only when the face paints.
  // The GL graph, the mini view, the magnifier and snapshots sample that
  // texture (gl-line-renderer drawImages), so no face is read back to the CPU
  // (no readPixels) and nothing re-uploads a 2D canvas per frame.
  //
  // Storage is top-down: texture row 0 = the canvas's top row, the same as a
  // texImage2D(canvas) upload with UNPACK_FLIP_Y false. Framebuffer rows are
  // bottom-up, so the copy flips v once here and every consumer draws upright.
  //
  // A face canvas the GL graph composites (`.node-display-canvas` inside the
  // live workspace with gl-graph-on; CSS hides those bitmaps) gets the texture
  // only. Any other destination is on screen as a 2D canvas, so it also gets
  // the HEAD-style drawImage from this canvas.
  const faceTextures = new WeakMap();
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

  /** True when the GL graph composites this canvas and CSS hides its bitmap. */
  function nodeGraphSharedGlFaceTextureOnly(canvas) {
    return Boolean(canvas?.classList?.contains("node-display-canvas")
      && canvas.closest?.("#nodeGraphWorkspace.gl-graph-on"));
  }

  function faceDelete(gl, entry) {
    if (!entry) return;
    if (entry.fbo) gl.deleteFramebuffer(entry.fbo);
    if (entry.texture) gl.deleteTexture(entry.texture);
    entry.fbo = null;
    entry.texture = null;
  }

  /** Drop a face's texture (its 2D canvas was repainted, e.g. the black failure plate). */
  function nodeGraphSharedGlFaceForget(canvas) {
    const entry = canvas ? faceTextures.get(canvas) : null;
    if (!entry) return;
    const gl = nodeGraphPictureDevice()?.gl;
    if (gl && !gl.isContextLost()) faceDelete(gl, entry);
    faceTextures.delete(canvas);
  }

  function faceEnsure(gl, canvas) {
    const cw = canvas.width | 0;
    const ch = canvas.height | 0;
    if (!(cw > 0) || !(ch > 0) || cw > MAX_DIM || ch > MAX_DIM) return null;
    let entry = faceTextures.get(canvas);
    if (entry && entry.gl === gl && entry.w === cw && entry.h === ch && entry.texture) return entry;
    if (entry) faceDelete(gl, entry);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    faceTexParams(gl, gl.NEAREST);
    // Seed from the canvas once, so a partial first copy keeps what the 2D
    // canvas already showed (plate, earlier frame) - the drawImage semantics.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
      faceTextures.delete(canvas);
      return null;
    }
    entry = { gl, texture, fbo, w: cw, h: ch, gen: 0, glFaceTexture: true };
    faceTextures.set(canvas, entry);
    return entry;
  }

  /**
   * Current GPU picture of a face canvas: { texture, w, h, gen } (top-down),
   * or null when the canvas has none or was resized since its last copy.
   */
  function nodeGraphSharedGlFaceTexture(canvas) {
    const entry = canvas ? faceTextures.get(canvas) : null;
    if (!entry?.texture) return null;
    if (entry.w !== (canvas.width | 0) || entry.h !== (canvas.height | 0)) return null;
    return entry;
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
   * top-down, like drawImage) on destCtx's canvas at dx, dy, dw, dh.
   * GPU-to-GPU into the face texture; plus the 2D drawImage for on-screen 2D
   * canvases. options.replace: the destination rect is replaced, not blended
   * (a transparent batch that cleared its canvas first).
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
    const textureOnly = nodeGraphSharedGlFaceTextureOnly(canvas);
    const wantsTexture = canvas.classList?.contains("node-display-canvas");
    if (!textureOnly) {
      // On-screen 2D canvas: the browser's canvas blit (HEAD path, upright).
      destCtx.imageSmoothingEnabled = Boolean(smooth);
      if ("imageSmoothingQuality" in destCtx) destCtx.imageSmoothingQuality = smooth ? "medium" : "low";
      destCtx.drawImage(srcCanvas, glX, sy | 0, w, h, dx, dy, destW, destH);
      if (!wantsTexture) return true;
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
  function nodeGraphSharedGlFaceCopyTexture(canvas) {
    const entry = nodeGraphSharedGlFaceTexture(canvas);
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
   * Faces the GL graph composites have no 2D bitmap, so smokes read this.
   */
  function nodeGraphSharedGlFacePixels(canvas) {
    const entry = nodeGraphSharedGlFaceTexture(canvas);
    const gl = entry?.gl;
    if (!entry || !gl || gl.isContextLost()) return null;
    const data = new Uint8Array(entry.w * entry.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
    gl.readPixels(0, 0, entry.w, entry.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: entry.w, height: entry.h, data };
  }

  function nodeGraphSharedGlBlitTo2D(destCtx, width, height, options = null) {
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
  global.nodeGraphSharedGlBlitTo2D = nodeGraphSharedGlBlitTo2D;
  global.nodeGraphSharedGlCopyToContext = nodeGraphSharedGlCopyToContext;
  global.nodeGraphSharedGlFaceTexture = nodeGraphSharedGlFaceTexture;
  global.nodeGraphSharedGlFaceTextureOnly = nodeGraphSharedGlFaceTextureOnly;
  global.nodeGraphSharedGlFaceForget = nodeGraphSharedGlFaceForget;
  global.nodeGraphSharedGlFaceCopyTexture = nodeGraphSharedGlFaceCopyTexture;
  global.nodeGraphSharedGlFacePixels = nodeGraphSharedGlFacePixels;
  global.nodeGraphPictureGet = nodeGraphPictureGet;
  global.nodeGraphPictureRead = nodeGraphPictureRead;
  global.nodeGraphPicturePresent = nodeGraphPicturePresent;
  global.nodeGraphPictureHasConsumer = nodeGraphPictureHasConsumer;
  global.nodeGraphPictureEdges = nodeGraphPictureEdges;
  global.nodeGraphPictureEdgesInvalidate = nodeGraphPictureEdgesInvalidate;
  global.nodeGraphPictureEdgeStats = nodeGraphPictureEdgeStats;
  global.nodeGraphPictureExportTarget = nodeGraphPictureExportTarget;
  global.nodeGraphPicturePublishCanvas = nodeGraphPicturePublishCanvas;
})(typeof globalThis !== "undefined" ? globalThis : window);
