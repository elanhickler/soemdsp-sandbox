const NODE_GRAPH_VIDEO_DELAY_GL_REV = 1;
const NODE_GRAPH_VIDEO_DELAY_MAX = 512;

(function initNodeGraphVideoDelayGl(global) {
  const KEY = "_videoDelayGl";
  let sharedDevice = null;

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uPrev;
    uniform sampler2D uPic;
    uniform float uDecay;
    uniform float uMix;
    uniform float uZoom;
    uniform float uTwist;
    uniform float uPanX;
    uniform float uPanY;
    uniform float uHasPic;
    uniform float uAspect;

    vec2 vdRot(vec2 p, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }

    vec2 vdCenter(vec2 uv) {
      vec2 c = uv - 0.5;
      c.x *= max(uAspect, 0.0001);
      return c;
    }

    vec2 vdUncenter(vec2 c) {
      c.x /= max(uAspect, 0.0001);
      return c + 0.5;
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = vdCenter(uv);
      float z = 1.04 + uZoom * 0.28;
      vec2 look = vdRot(c * z, uTwist * 3.14159265);
      look -= vec2(uPanX, uPanY) * 0.42;
      vec2 pRaw = vdUncenter(look);
      float inBounds = step(0.0, pRaw.x) * step(pRaw.x, 1.0) * step(0.0, pRaw.y) * step(pRaw.y, 1.0);
      vec2 p = clamp(pRaw, 0.0, 1.0);
      vec3 col = texture2D(uPrev, p).rgb * inBounds;
      col *= mix(0.88, 0.998, clamp(uDecay, 0.0, 1.0));
      if (uHasPic > 0.5) {
        vec4 live = texture2D(uPic, uv);
        float luma = max(col.r, max(col.g, col.b));
        float seed = (1.0 - smoothstep(0.015, 0.12, luma)) * live.a * clamp(uMix, 0.0, 1.0);
        // Wire pictures are premultiplied RGBA: unpremultiply, alpha already in seed.
        vec3 liveRgb = live.a > 1e-4 ? live.rgb / live.a : vec3(0.0);
        col = mix(col, liveRgb, seed);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "video-delay-gl.js");
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
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_VIDEO_DELAY_GL_REV) {
      return sharedDevice;
    }
    sharedDevice = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const { gl } = picture;
    const program = link(gl, VERT, FRAG);
    if (!program) return null;
    const quad = SoemGl.quad(gl);
    sharedDevice = {
      rev: NODE_GRAPH_VIDEO_DELAY_GL_REV,
      gl,
      quad,
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPrev: gl.getUniformLocation(program, "uPrev"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uDecay: gl.getUniformLocation(program, "uDecay"),
      uMix: gl.getUniformLocation(program, "uMix"),
      uZoom: gl.getUniformLocation(program, "uZoom"),
      uTwist: gl.getUniformLocation(program, "uTwist"),
      uPanX: gl.getUniformLocation(program, "uPanX"),
      uPanY: gl.getUniformLocation(program, "uPanY"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uAspect: gl.getUniformLocation(program, "uAspect"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!device?.gl || !host) return null;
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_VIDEO_DELAY_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_VIDEO_DELAY_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_VIDEO_DELAY_GL_REV) {
      renderer.device = device;
      renderer.gl = gl;
      return renderer;
    }
    disposeRenderer(host);
    const read = createSurface(gl, w, h);
    const write = createSurface(gl, w, h);
    if (!read || !write) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, read.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const blackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blackTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    renderer = {
      alive: true,
      rev: NODE_GRAPH_VIDEO_DELAY_GL_REV,
      gl,
      device,
      read,
      write,
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
      destroySurface(gl, renderer.read);
      destroySurface(gl, renderer.write);
      if (renderer.blackTex) gl.deleteTexture(renderer.blackTex);
    }
    host[KEY] = null;
  }

  function wipeRenderer(host) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return;
    const gl = renderer.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.read.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.write.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function step(host, options) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return false;
    const { gl, device } = renderer;
    const picTex = options.picture?.texture || renderer.blackTex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.write.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.disable(gl.BLEND);
    gl.useProgram(device.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPos);
    gl.vertexAttribPointer(device.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.read.texture);
    gl.uniform1i(device.uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, picTex);
    gl.uniform1i(device.uPic, 1);
    gl.uniform1f(device.uDecay, Math.max(0, Math.min(1, Number(options.decay) || 0)));
    gl.uniform1f(device.uMix, Math.max(0, Math.min(1, Number(options.mix) || 0)));
    gl.uniform1f(device.uZoom, Math.max(0, Math.min(1, Number(options.zoom) || 0)));
    gl.uniform1f(device.uTwist, Math.max(-1, Math.min(1, Number(options.twist) || 0)));
    gl.uniform1f(device.uPanX, Math.max(-1, Math.min(1, Number(options.panX) || 0)));
    gl.uniform1f(device.uPanY, Math.max(-1, Math.min(1, Number(options.panY) || 0)));
    gl.uniform1f(device.uHasPic, options.picture?.texture ? 1 : 0);
    gl.uniform1f(device.uAspect, renderer.height > 0 ? renderer.width / renderer.height : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const tmp = renderer.read;
    renderer.read = renderer.write;
    renderer.write = tmp;
    if (options.nodeId && typeof nodeGraphPicturePublish === "function") {
      // VG-5: the ping-pong read side is the output (RGBA8 LINEAR, next step writes the other side).
      nodeGraphPicturePublish(options.nodeId, renderer.read.texture, renderer.width, renderer.height, { byReference: true });
    }
    return true;
  }

  function presentTo(host, destCtx, width, height) {
    const renderer = host?.[KEY];
    if (!renderer?.alive || !destCtx) return false;
    if (typeof nodeGraphPicturePresent === "function") {
      const destCanvas = destCtx?.canvas || destCtx;
      return nodeGraphPicturePresent(
        renderer.read.texture,
        renderer.width,
        renderer.height,
        destCanvas,
        width,
        height,
      );
    }
    return false;
  }

  global.nodeGraphVideoDelayGlEnsure = ensureRenderer;
  global.nodeGraphVideoDelayGlDispose = disposeRenderer;
  global.nodeGraphVideoDelayGlWipe = wipeRenderer;
  global.nodeGraphVideoDelayGlStep = step;
  global.nodeGraphVideoDelayGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
