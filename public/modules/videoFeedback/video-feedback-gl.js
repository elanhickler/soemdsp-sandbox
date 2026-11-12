// Spectrum Circle plate: ping-pong on the shared picture device (Sim FPS, not
// audio rate). Each step fades the previous plate by Decay (Twist turns it a
// little) and keeps the brighter of it and this frame's rays.

const NODE_GRAPH_VIDEO_FEEDBACK_GL_REV = 10;
// Longest plate side; the other side scales with it so the circle stays round.
const NODE_GRAPH_VIDEO_FEEDBACK_MAX = 1024;
// Spectrum texels: one per band, or one per slot when Continuous.
const NODE_GRAPH_VIDEO_FEEDBACK_WAVE = 512;

(function initNodeGraphVideoFeedbackGl(global) {
  const KEY = "_videoFeedbackGl";
  let sharedDevice = null;

  // VG-8 failure policy: a failed link (per GL context) or FBO (per face and
  // size) is reported once through nodeGraphDisplayGlFailed and never retried
  // every frame; the face stays black and nothing is published downstream.
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

  const FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 vUv;
    uniform sampler2D uPrev;
    uniform sampler2D uWave;
    uniform sampler2D uLut;
    uniform float uDecay;
    uniform float uTwist;
    uniform float uSpin;
    uniform float uBright;
    uniform float uSmooth;
    uniform float uSize;
    uniform float uInner;
    uniform float uBands;
    uniform float uCount;
    uniform float uRayWidth;
    uniform float uColorByRadius;
    uniform float uPx;
    uniform vec2 uFit;

    const float PI = 3.14159265;
    const float WAVE = ${NODE_GRAPH_VIDEO_FEEDBACK_WAVE}.0;

    vec2 vfRot(vec2 p, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }

    float vfWave(float texel) {
      return texture2D(uWave, vec2((texel + 0.5) / WAVE, 0.5)).r;
    }

    // Level at slot position t (0 = bass at the bottom, 1 = top).
    float vfLevel(float t) {
      if (uBands > 0.5) {
        return vfWave(min(floor(t * uBands), uBands - 1.0));
      }
      float x = clamp(t * uCount - 0.5, 0.0, uCount - 1.0);
      float x0 = floor(x);
      float m = mix(vfWave(x0), vfWave(min(x0 + 1.0, uCount - 1.0)), x - x0);
      // Smooth also blends a few neighbours on the Continuous ring.
      float d = 1.0 + 6.0 * uSmooth;
      float lo = vfWave(max(x0 - d, 0.0));
      float hi = vfWave(min(x0 + d, uCount - 1.0));
      return mix(m, (lo + 2.0 * m + hi) * 0.25, uSmooth);
    }

    void main() {
      // Centred, short side spans -0.5..0.5 (contain-fit: the circle stays round).
      vec2 c = (vUv - 0.5) * uFit;
      vec2 p = clamp(vfRot(c, uTwist * 0.15) / uFit + 0.5, 0.0, 1.0);
      vec3 col = texture2D(uPrev, p).rgb * uDecay;
      vec2 sc = vfRot(c, uTwist * 1.2 + uSpin * 1.4);
      // r = 1 at the edge of the short side.
      float r = length(sc) * 2.0;
      float t = clamp(atan(sc.y, abs(sc.x)) / PI + 0.5, 0.0, 1.0);
      float m = vfLevel(t);
      float r0 = uSize * uInner;
      float tip = r0 + (uSize - r0) * m;
      float radial = smoothstep(r0 - uPx, r0, r) * (1.0 - smoothstep(tip - uPx, tip, r));
      float across = 1.0;
      if (uBands > 0.5) {
        // 0 at a ray's centre line, 1 at the edge of its slot; one pixel of
        // arc in those units keeps thin rays antialiased at every radius.
        float d = abs(fract(t * uBands) - 0.5) * 2.0;
        float px = 2.0 * uPx * uBands / (PI * max(r, uPx));
        across = 1.0 - smoothstep(uRayWidth - px, uRayWidth + px, d);
      }
      float pos = uColorByRadius > 0.5 ? clamp((r - r0) / max(uSize - r0, 1e-4), 0.0, 1.0) : m;
      vec3 ink = texture2D(uLut, vec2(pos * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
      col = max(col, ink * (radial * across * uBright));
      gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
    }
  `;

  const UNIFORMS = [
    "uPrev", "uWave", "uLut", "uDecay", "uTwist", "uSpin", "uBright", "uSmooth", "uSize", "uInner",
    "uBands", "uCount", "uRayWidth", "uColorByRadius", "uPx", "uFit",
  ];

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

  function createDataTexture(gl, width, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  function getSharedDevice() {
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_VIDEO_FEEDBACK_GL_REV) {
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
      rev: NODE_GRAPH_VIDEO_FEEDBACK_GL_REV,
      gl,
      quad: SoemGl.quad(gl),
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
    };
    for (const name of UNIFORMS) sharedDevice[name] = gl.getUniformLocation(program, name);
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Spectrum Circle: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const fw = Math.max(8, width | 0);
    const fh = Math.max(8, height | 0);
    const scale = Math.min(1, NODE_GRAPH_VIDEO_FEEDBACK_MAX / Math.max(fw, fh));
    const w = Math.max(8, Math.round(fw * scale));
    const h = Math.max(8, Math.round(fh * scale));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_VIDEO_FEEDBACK_GL_REV) {
      renderer.device = device;
      renderer.gl = gl;
      return renderer;
    }
    const size = `${w}x${h}`;
    if (host[KEY + "Failed"] === size) return null;
    disposeRenderer(host);
    const read = createSurface(gl, w, h);
    const write = createSurface(gl, w, h);
    if (!read || !write) {
      destroySurface(gl, read);
      destroySurface(gl, write);
      host[KEY + "Failed"] = size;
      reportFailure(host, "Spectrum Circle: framebuffer incomplete");
      return null;
    }
    host[KEY + "Failed"] = "";
    gl.bindFramebuffer(gl.FRAMEBUFFER, read.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    renderer = {
      alive: true,
      rev: NODE_GRAPH_VIDEO_FEEDBACK_GL_REV,
      gl,
      device,
      read,
      write,
      width: w,
      height: h,
      waveTex: createDataTexture(gl, NODE_GRAPH_VIDEO_FEEDBACK_WAVE, gl.NEAREST),
      waveBytes: new Uint8Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE * 4),
      lutTex: createDataTexture(gl, 256, gl.LINEAR),
      lutBytes: new Uint8Array(256 * 4),
      lutRgb: null,
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
      if (renderer.lutTex) gl.deleteTexture(renderer.lutTex);
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

  function uploadRow(gl, tex, width, bytes) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function uploadLevels(renderer, levels, count) {
    const bytes = renderer.waveBytes;
    for (let i = 0; i < NODE_GRAPH_VIDEO_FEEDBACK_WAVE; i += 1) {
      const v = i < count ? Math.max(0, Math.min(1, Number(levels[i]) || 0)) : 0;
      const o = i * 4;
      bytes[o] = Math.round(v * 255);
      bytes[o + 3] = 255;
    }
    uploadRow(renderer.gl, renderer.waveTex, NODE_GRAPH_VIDEO_FEEDBACK_WAVE, bytes);
  }

  function uploadLut(renderer, lutRgb) {
    if (renderer.lutRgb === lutRgb) return;
    const bytes = renderer.lutBytes;
    for (let i = 0; i < 256; i += 1) {
      bytes[i * 4] = lutRgb[i * 3];
      bytes[i * 4 + 1] = lutRgb[i * 3 + 1];
      bytes[i * 4 + 2] = lutRgb[i * 3 + 2];
      bytes[i * 4 + 3] = 255;
    }
    uploadRow(renderer.gl, renderer.lutTex, 256, bytes);
    renderer.lutRgb = lutRgb;
  }

  function bindTexture(gl, unit, tex, location) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(location, unit);
  }

  function step(host, options) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return false;
    const { gl, device } = renderer;
    const count = Math.max(1, Math.min(NODE_GRAPH_VIDEO_FEEDBACK_WAVE, options.count | 0));
    uploadLevels(renderer, options.levels, count);
    uploadLut(renderer, options.lutRgb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.write.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.disable(gl.BLEND);
    gl.useProgram(device.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPos);
    gl.vertexAttribPointer(device.aPos, 2, gl.FLOAT, false, 0, 0);
    bindTexture(gl, 0, renderer.read.texture, device.uPrev);
    bindTexture(gl, 1, renderer.waveTex, device.uWave);
    bindTexture(gl, 2, renderer.lutTex, device.uLut);
    const aspect = renderer.width / renderer.height;
    gl.uniform2f(device.uFit, Math.max(aspect, 1), Math.max(1 / aspect, 1));
    gl.uniform1f(device.uPx, 2 / Math.min(renderer.width, renderer.height));
    gl.uniform1f(device.uDecay, Number(options.decay) || 0);
    gl.uniform1f(device.uTwist, Number(options.twist) || 0);
    gl.uniform1f(device.uSpin, Number(options.spin) || 0);
    gl.uniform1f(device.uBright, Number(options.bright) || 0);
    gl.uniform1f(device.uSmooth, Number(options.smooth) || 0);
    gl.uniform1f(device.uSize, Number(options.size) || 0);
    gl.uniform1f(device.uInner, Number(options.inner) || 0);
    gl.uniform1f(device.uBands, Math.max(0, options.bands | 0));
    gl.uniform1f(device.uCount, count);
    gl.uniform1f(device.uRayWidth, Number(options.rayWidth) || 0);
    gl.uniform1f(device.uColorByRadius, options.colorByRadius ? 1 : 0);
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

  global.nodeGraphVideoFeedbackGlEnsure = ensureRenderer;
  global.nodeGraphVideoFeedbackGlDispose = disposeRenderer;
  global.nodeGraphVideoFeedbackGlWipe = wipeRenderer;
  global.nodeGraphVideoFeedbackGlStep = step;
  global.nodeGraphVideoFeedbackGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);