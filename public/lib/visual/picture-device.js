// One hidden WebGL2 context (4096²) for every display that shares GPU work.
// Faces are ordinary 2D canvases; present scissors then blits. A 📺 cable
// publishes a texture id on this device — no byte copy between modules.
// Never resize the canvas: a resize wipes every texture on the context.
// WebGL1 is not requested (P0d).

(function initNodeGraphPictureDevice(global) {
  const MAX_DIM = 4096;
  let device = null;
  const published = new Map();

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
    if (slot && slot.width === w && slot.height === h && slot.texture) return slot;
    if (slot?.framebuffer) gl.deleteFramebuffer(slot.framebuffer);
    if (slot?.texture) gl.deleteTexture(slot.texture);
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

  /** Copy a finished picture into a stable texture other modules can bind. */
  function nodeGraphPicturePublish(nodeId, texture, width, height) {
    const id = String(nodeId || "").trim();
    const dev = nodeGraphPictureDevice();
    if (!id || !texture || !dev?.gl) return false;
    const gl = dev.gl;
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

  /** True when any cable leaves this node's picture out (`rgba` / TV). */
  function nodeGraphPictureHasConsumer(nodeId) {
    const id = String(nodeId || "").trim();
    if (!id) return false;
    const list = nodeGraphMvp?.patch?.connections || nodeGraphMvp?.connections || [];
    for (let i = 0; i < list.length; i += 1) {
      const from = connectionEnd(list[i], "from");
      if (from.node === id && isTvPort(from.port)) return true;
    }
    return false;
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
   * Bridge for faces still drawn on a 2D canvas: upload the canvas into the
   * node's picture texture (only when a cable is connected). Opaque.
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
    gl.bindTexture(gl.TEXTURE_2D, slot.texture);
    // FBO-style orientation (row 0 = bottom) to match rendered pictures.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
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
    const port = String(portName || "rgba");
    if (!id) return null;
    const list = nodeGraphMvp?.patch?.connections || nodeGraphMvp?.connections || [];
    for (let i = 0; i < list.length; i += 1) {
      const to = connectionEnd(list[i], "to");
      if (to.node !== id || to.port !== port) continue;
      const from = connectionEnd(list[i], "from");
      if (!isTvPort(from.port)) continue;
      const slot = published.get(from.node);
      if (slot?.texture) {
        return { texture: slot.texture, width: slot.width, height: slot.height, nodeId: from.node };
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
    ctx.imageSmoothingEnabled = rw !== dw || rh !== dh;
    const srcY = Math.max(0, dev.canvas.height - rh);
    ctx.drawImage(dev.canvas, 0, srcY, rw, rh, 0, 0, dw, dh);
    return true;
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

  function nodeGraphSharedGlBlitTo2D(destCtx, width, height) {
    const pic = nodeGraphPictureDevice();
    if (!pic?.canvas || !destCtx) return false;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    const srcY = Math.max(0, pic.canvas.height - h);
    destCtx.drawImage(pic.canvas, 0, srcY, w, h, 0, 0, w, h);
    return true;
  }

  global.nodeGraphPictureDevice = nodeGraphPictureDevice;
  global.nodeGraphPicturePublish = nodeGraphPicturePublish;
  global.nodeGraphSharedGlDevice = nodeGraphSharedGlDevice;
  global.nodeGraphSharedGlBindPresent = nodeGraphSharedGlBindPresent;
  global.nodeGraphSharedGlEndPresent = nodeGraphSharedGlEndPresent;
  global.nodeGraphSharedGlBlitTo2D = nodeGraphSharedGlBlitTo2D;
  global.nodeGraphPictureGet = nodeGraphPictureGet;
  global.nodeGraphPictureRead = nodeGraphPictureRead;
  global.nodeGraphPicturePresent = nodeGraphPicturePresent;
  global.nodeGraphPictureHasConsumer = nodeGraphPictureHasConsumer;
  global.nodeGraphPictureExportTarget = nodeGraphPictureExportTarget;
  global.nodeGraphPicturePublishCanvas = nodeGraphPicturePublishCanvas;
})(typeof globalThis !== "undefined" ? globalThis : window);
