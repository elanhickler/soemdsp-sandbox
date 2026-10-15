// Feedback plate: ping-pong on the shared picture device (Sim FPS, not audio rate).

const NODE_GRAPH_VIDEO_FEEDBACK_GL_REV = 9;
const NODE_GRAPH_VIDEO_FEEDBACK_MAX = 512;
const NODE_GRAPH_VIDEO_FEEDBACK_WAVE = 512;

(function initNodeGraphVideoFeedbackGl(global) {
  const KEY = "_videoFeedbackGl";
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
    uniform sampler2D uWave;
    uniform float uDecay;
    uniform float uMix;
    uniform float uMode;
    uniform float uA;
    uniform float uB;
    uniform float uZoom;
    uniform float uTwist;
    uniform float uBright;
    uniform float uTime;
    uniform float uHasPic;
    uniform float uSmooth;
    uniform float uAspect;
    uniform vec3 uInk;

    vec2 vfRot(vec2 p, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }

    vec2 vfCenter(vec2 uv) {
      vec2 c = uv - 0.5;
      c.x *= max(uAspect, 0.0001);
      return c;
    }

    vec2 vfUncenter(vec2 c) {
      c.x /= max(uAspect, 0.0001);
      return c + 0.5;
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = vfCenter(uv);
      vec2 pc = vfRot(c, uTwist * 0.15);
      vec2 p = clamp(vfUncenter(pc), 0.003, 0.997);
      vec3 col = texture2D(uPrev, p).rgb * uDecay;
      vec2 sc = vfRot(c, uTwist * 1.2 + uB * 1.4);
      float rad = length(sc);
      float t = clamp(atan(sc.y, abs(sc.x)) / 3.14159265 + 0.5, 0.0, 1.0);
      float dt = 0.012 + 0.04 * uSmooth;
      float mag = (
        texture2D(uWave, vec2(clamp(t - dt, 0.0, 1.0), 0.5)).r
        + texture2D(uWave, vec2(t, 0.5)).r * 2.0
        + texture2D(uWave, vec2(clamp(t + dt, 0.0, 1.0), 0.5)).r
      ) * 0.25;
      float inner = 0.12 + 0.28 * uZoom;
      float thick = 0.035 + mag * (0.2 + 0.28 * uBright);
      float d = abs(rad - inner);
      float edge = thick + 0.02 + 0.04 * uSmooth;
      float line = 1.0 - smoothstep(thick, edge, d);
      line += mag * exp(-d * (10.0 + 18.0 * (1.0 - uSmooth))) * 0.55;
      col = min(col + uInk * line * uBright, vec3(1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "video-feedback-gl.js");
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
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_VIDEO_FEEDBACK_GL_REV) {
      return sharedDevice;
    }
    sharedDevice = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const { gl } = picture;
    const program = link(gl, VERT, FRAG);
    if (!program) {
      console.error("[video-feedback-gl] program failed to link");
      return null;
    }
    const quad = SoemGl.quad(gl);
    sharedDevice = {
      rev: NODE_GRAPH_VIDEO_FEEDBACK_GL_REV,
      gl,
      quad,
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPrev: gl.getUniformLocation(program, "uPrev"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uWave: gl.getUniformLocation(program, "uWave"),
      uDecay: gl.getUniformLocation(program, "uDecay"),
      uMix: gl.getUniformLocation(program, "uMix"),
      uMode: gl.getUniformLocation(program, "uMode"),
      uA: gl.getUniformLocation(program, "uA"),
      uB: gl.getUniformLocation(program, "uB"),
      uZoom: gl.getUniformLocation(program, "uZoom"),
      uTwist: gl.getUniformLocation(program, "uTwist"),
      uBright: gl.getUniformLocation(program, "uBright"),
      uTime: gl.getUniformLocation(program, "uTime"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uSmooth: gl.getUniformLocation(program, "uSmooth"),
      uAspect: gl.getUniformLocation(program, "uAspect"),
      uInk: gl.getUniformLocation(program, "uInk"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!device?.gl || !host) return null;
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_VIDEO_FEEDBACK_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_VIDEO_FEEDBACK_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_VIDEO_FEEDBACK_GL_REV) {
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
    const waveTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, waveTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NODE_GRAPH_VIDEO_FEEDBACK_WAVE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
      rev: NODE_GRAPH_VIDEO_FEEDBACK_GL_REV,
      gl,
      device,
      read,
      write,
      width: w,
      height: h,
      waveTex,
      blackTex,
      waveBytes: new Uint8Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE * 4),
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
      if (renderer.waveTex) gl.deleteTexture(renderer.waveTex);
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

  function uploadWave(renderer, samples, asMagnitude) {
    const gl = renderer.gl;
    const bytes = renderer.waveBytes;
    const n = NODE_GRAPH_VIDEO_FEEDBACK_WAVE;
    const src = samples && samples.length ? samples : null;
    const len = src ? src.length : 0;
    for (let i = 0; i < n; i += 1) {
      let v = asMagnitude ? 0 : 0.5;
      if (len > 0) {
        const s = Number(src[Math.min(len - 1, Math.floor(i * len / n))]) || 0;
        v = asMagnitude
          ? Math.max(0, Math.min(1, s))
          : Math.max(0, Math.min(1, 0.5 + 0.5 * s));
      }
      const b = Math.round(v * 255);
      const o = i * 4;
      bytes[o] = b;
      bytes[o + 1] = b;
      bytes[o + 2] = b;
      bytes[o + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, renderer.waveTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      n,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function step(host, options) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return false;
    const { gl, device } = renderer;
    const decay = Math.max(0, Math.min(0.98, Number(options.decay)));
    uploadWave(renderer, options.waveSamples, Boolean(options.waveIsMagnitude));
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
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, renderer.waveTex);
    gl.uniform1i(device.uWave, 2);
    gl.uniform1f(device.uDecay, Number.isFinite(decay) ? decay : 0.88);
    gl.uniform1f(device.uMix, Math.max(0, Math.min(1, Number(options.mix) || 0)));
    gl.uniform1f(device.uMode, Number(options.mode) || 0);
    gl.uniform1f(device.uA, Number(options.a) || 0);
    gl.uniform1f(device.uB, Number(options.b) || 0);
    gl.uniform1f(device.uZoom, Number(options.zoom) || 0);
    gl.uniform1f(device.uTwist, Number(options.twist) || 0);
    gl.uniform1f(device.uBright, Math.max(0, Math.min(1, Number(options.bright) || 0)));
    gl.uniform1f(device.uTime, Number(options.time) || 0);
    gl.uniform1f(device.uHasPic, options.picture?.texture ? 1 : 0);
    gl.uniform1f(device.uSmooth, Math.max(0, Math.min(1, Number(options.smooth) || 0)));
    gl.uniform1f(device.uAspect, renderer.height > 0 ? renderer.width / renderer.height : 1);
    const ink = Array.isArray(options.ink) ? options.ink : [0.55, 0.82, 1];
    gl.uniform3f(
      device.uInk,
      Number(ink[0]) || 0,
      Number(ink[1]) || 0,
      Number(ink[2]) || 0,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const tmp = renderer.read;
    renderer.read = renderer.write;
    renderer.write = tmp;
    if (options.nodeId && typeof nodeGraphPicturePublish === "function") {
      nodeGraphPicturePublish(options.nodeId, renderer.read.texture, renderer.width, renderer.height);
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

  global.nodeGraphVideoFeedbackGlEnsure = ensureRenderer;
  global.nodeGraphVideoFeedbackGlDispose = disposeRenderer;
  global.nodeGraphVideoFeedbackGlWipe = wipeRenderer;
  global.nodeGraphVideoFeedbackGlStep = step;
  global.nodeGraphVideoFeedbackGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
