const NODE_GRAPH_SCREEN_BEND_GL_REV = 1;
const NODE_GRAPH_SCREEN_BEND_MAX = 512;

(function initNodeGraphScreenBendGl(global) {
  const KEY = "_screenBendGl";
  let sharedDevice = null;
  let linkFailedGl = null;

  function reportFailure(host, reason) {
    if (host && typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(host, reason);
  }

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  // Width bows the sides (x grows with y²). Height bows the top and bottom.
  // Positive is outer, like a CRT glass. Negative pinches inward.
  // Full knob throw is 0.42, strong without folding the picture over itself.
  const FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform float uHasPic;
    uniform float uWidth;
    uniform float uHeight;

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec2 q = p;
      q.x *= 1.0 + uWidth * 0.42 * p.y * p.y;
      q.y *= 1.0 + uHeight * 0.42 * p.x * p.x;
      vec2 uv = q * 0.5 + 0.5;
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      vec3 col = vec3(0.0);
      if (uHasPic > 0.5 && inside > 0.5) {
        vec4 t = texture2D(uPic, uv);
        col = t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "screen-bend-gl.js");
  }

  function createSurface(gl, w, h) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const internal = (gl.RGBA8 !== undefined) ? gl.RGBA8 : gl.RGBA;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!ok) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }
    return { texture, framebuffer, width: w, height: h };
  }

  function destroySurface(gl, surface) {
    if (!surface || !gl) return;
    if (surface.framebuffer) gl.deleteFramebuffer(surface.framebuffer);
    if (surface.texture) gl.deleteTexture(surface.texture);
  }

  function getSharedDevice() {
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_SCREEN_BEND_GL_REV) {
      return sharedDevice;
    }
    sharedDevice = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const { gl } = picture;
    if (linkFailedGl === gl && !gl.isContextLost()) return null;
    const program = link(gl, VERT, FRAG);
    if (!program) {
      linkFailedGl = gl;
      return null;
    }
    sharedDevice = {
      rev: NODE_GRAPH_SCREEN_BEND_GL_REV,
      gl,
      quad: SoemGl.quad(gl),
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uWidth: gl.getUniformLocation(program, "uWidth"),
      uHeight: gl.getUniformLocation(program, "uHeight"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Screen Bend: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_SCREEN_BEND_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_SCREEN_BEND_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_SCREEN_BEND_GL_REV) {
      renderer.device = device;
      renderer.gl = gl;
      return renderer;
    }
    const size = `${w}x${h}`;
    if (host[KEY + "Failed"] === size) return null;
    disposeRenderer(host);
    const shown = createSurface(gl, w, h);
    const spare = createSurface(gl, w, h);
    if (!shown || !spare) {
      destroySurface(gl, shown);
      destroySurface(gl, spare);
      host[KEY + "Failed"] = size;
      reportFailure(host, "Screen Bend: framebuffer incomplete");
      return null;
    }
    host[KEY + "Failed"] = "";
    const blackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blackTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    renderer = {
      alive: true,
      rev: NODE_GRAPH_SCREEN_BEND_GL_REV,
      gl,
      device,
      shown,
      spare,
      width: w,
      height: h,
      blackTex,
    };
    host[KEY] = renderer;
    return renderer;
  }

  function disposeRenderer(host) {
    const renderer = host?.[KEY];
    if (!renderer) return;
    renderer.alive = false;
    const gl = renderer.gl;
    if (gl && !gl.isContextLost()) {
      destroySurface(gl, renderer.shown);
      destroySurface(gl, renderer.spare);
      if (renderer.blackTex) gl.deleteTexture(renderer.blackTex);
    }
    host[KEY] = null;
  }

  function wipeRenderer(host) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return;
    const gl = renderer.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.shown.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.spare.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function step(host, options) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return false;
    const { gl, device } = renderer;
    const picTex = options.picture?.texture || renderer.blackTex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.spare.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(device.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPos);
    gl.vertexAttribPointer(device.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, picTex);
    gl.uniform1i(device.uPic, 0);
    gl.uniform1f(device.uHasPic, options.picture?.texture ? 1 : 0);
    gl.uniform1f(device.uWidth, Number(options.width) || 0);
    gl.uniform1f(device.uHeight, Number(options.height) || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const finished = renderer.spare;
    renderer.spare = renderer.shown;
    renderer.shown = finished;
    if (options.nodeId && typeof nodeGraphPicturePublish === "function") {
      nodeGraphPicturePublish(options.nodeId, renderer.shown.texture, renderer.width, renderer.height, { byReference: true });
    }
    return true;
  }

  function presentTo(host, destCtx, width, height) {
    const renderer = host?.[KEY];
    if (!renderer?.alive || !destCtx) return false;
    if (typeof nodeGraphPicturePresent !== "function") return false;
    return nodeGraphPicturePresent(
      renderer.shown.texture,
      renderer.width,
      renderer.height,
      destCtx?.canvas || destCtx,
      width,
      height,
    );
  }

  global.nodeGraphScreenBendGlEnsure = ensureRenderer;
  global.nodeGraphScreenBendGlDispose = disposeRenderer;
  global.nodeGraphScreenBendGlWipe = wipeRenderer;
  global.nodeGraphScreenBendGlStep = step;
  global.nodeGraphScreenBendGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
