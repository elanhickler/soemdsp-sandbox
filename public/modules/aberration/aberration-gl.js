const NODE_GRAPH_ABERRATION_GL_REV = 1;
const NODE_GRAPH_ABERRATION_MAX = 512;

(function initNodeGraphAberrationGl(global) {
  const KEY = "_aberrationGl";
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

  const FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform float uHasPic;
    uniform float uMode;
    uniform float uHue;
    uniform float uCh;
    uniform float uBright;
    uniform float uBlur;
    uniform float uGain;
    uniform float uOver;
    uniform vec2 uOff;
    uniform vec2 uTexel;

    vec3 aberHue(vec3 c, float turns) {
      float a = turns * 6.28318530718;
      float cs = cos(a);
      float sn = sin(a);
      vec3 k = vec3(0.57735026919);
      return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
    }

    vec3 aberSample(vec2 uv) {
      if (uHasPic < 0.5) return vec3(0.0);
      vec2 p = clamp(uv, 0.0, 1.0);
      vec4 t = texture2D(uPic, p);
      vec3 rgb = t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
      return aberHue(rgb, uHue);
    }

    vec3 aberBlur(vec2 uv, float blur01) {
      float sigma = max(blur01, 0.0) * 6.0;
      if (sigma < 0.25) return aberSample(uv);
      vec2 s = uTexel * sigma;
      float e = exp(-0.5);
      float d = exp(-1.0);
      vec3 acc = aberSample(uv);
      acc += (aberSample(uv + vec2(s.x, 0.0)) + aberSample(uv + vec2(-s.x, 0.0))
        + aberSample(uv + vec2(0.0, s.y)) + aberSample(uv + vec2(0.0, -s.y))) * e;
      acc += (aberSample(uv + vec2(s.x, s.y)) + aberSample(uv + vec2(-s.x, s.y))
        + aberSample(uv + vec2(s.x, -s.y)) + aberSample(uv + vec2(-s.x, -s.y))) * d;
      return acc / (1.0 + 4.0 * e + 4.0 * d);
    }

    vec3 aberPlate(vec3 rgb, float ch, float mode) {
      if (mode < 0.5) {
        if (ch < 0.5) return vec3(rgb.r, 0.0, 0.0);
        if (ch < 1.5) return vec3(0.0, rgb.g, 0.0);
        return vec3(0.0, 0.0, rgb.b);
      }
      if (ch < 0.5) return vec3(0.0, rgb.g, rgb.b);
      if (ch < 1.5) return vec3(rgb.r, 0.0, rgb.b);
      return vec3(rgb.r, rgb.g, 0.0);
    }

    void main() {
      vec3 plate = aberPlate(aberBlur(vUv + uOff, uBlur), uCh, uMode) * uGain;
      if (uOver > 0.5) {
        gl_FragColor = vec4(plate, clamp(uBright, 0.0, 1.0));
      } else {
        gl_FragColor = vec4(plate * clamp(uBright, 0.0, 1.0), 1.0);
      }
    }
  `;

  const RESOLVE = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uSrc;
    void main() {
      gl_FragColor = vec4(texture2D(uSrc, vUv).rgb, 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "aberration-gl.js");
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
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_ABERRATION_GL_REV) {
      return sharedDevice;
    }
    sharedDevice = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const { gl } = picture;
    if (linkFailedGl === gl && !gl.isContextLost()) return null;
    const program = link(gl, VERT, FRAG);
    const resolve = link(gl, VERT, RESOLVE);
    if (!program || !resolve) {
      linkFailedGl = gl;
      return null;
    }
    const quad = SoemGl.quad(gl);
    sharedDevice = {
      rev: NODE_GRAPH_ABERRATION_GL_REV,
      gl,
      quad,
      program,
      resolve,
      aPos: gl.getAttribLocation(program, "aPos"),
      aPosResolve: gl.getAttribLocation(resolve, "aPos"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uMode: gl.getUniformLocation(program, "uMode"),
      uHue: gl.getUniformLocation(program, "uHue"),
      uCh: gl.getUniformLocation(program, "uCh"),
      uBright: gl.getUniformLocation(program, "uBright"),
      uBlur: gl.getUniformLocation(program, "uBlur"),
      uGain: gl.getUniformLocation(program, "uGain"),
      uOver: gl.getUniformLocation(program, "uOver"),
      uOff: gl.getUniformLocation(program, "uOff"),
      uTexel: gl.getUniformLocation(program, "uTexel"),
      uSrc: gl.getUniformLocation(resolve, "uSrc"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Aberration: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_ABERRATION_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_ABERRATION_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_ABERRATION_GL_REV) {
      renderer.device = device;
      renderer.gl = gl;
      return renderer;
    }
    const size = `${w}x${h}`;
    if (host[KEY + "Failed"] === size) return null;
    disposeRenderer(host);
    const plates = createSurface(gl, w, h);
    const shown = createSurface(gl, w, h);
    const spare = createSurface(gl, w, h);
    if (!plates || !shown || !spare) {
      destroySurface(gl, plates);
      destroySurface(gl, shown);
      destroySurface(gl, spare);
      host[KEY + "Failed"] = size;
      reportFailure(host, "Aberration: framebuffer incomplete");
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, plates.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shown.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, spare.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    renderer = {
      alive: true,
      rev: NODE_GRAPH_ABERRATION_GL_REV,
      gl,
      device,
      plates,
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
      destroySurface(gl, renderer.plates);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.plates.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.shown.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.spare.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function drawPlate(gl, device, renderer, ch, plate, over, gain) {
    gl.uniform1f(device.uCh, ch);
    gl.uniform1f(device.uBright, plate.bright);
    gl.uniform1f(device.uBlur, plate.blur);
    gl.uniform1f(device.uGain, gain);
    gl.uniform1f(device.uOver, over);
    gl.uniform2f(device.uOff, plate.x, plate.y);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function step(host, options) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return false;
    const { gl, device } = renderer;
    const over = options.blend ? 1 : 0;
    const mode = options.mode ? 1 : 0;
    const gain = mode === 1 && over === 0 ? 0.5 : 1;
    const picTex = options.picture?.texture || renderer.blackTex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.plates.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, over ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (over) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(device.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPos);
    gl.vertexAttribPointer(device.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, picTex);
    gl.uniform1i(device.uPic, 0);
    gl.uniform1f(device.uHasPic, options.picture?.texture ? 1 : 0);
    gl.uniform1f(device.uMode, mode);
    gl.uniform1f(device.uHue, Number(options.hue) || 0);
    gl.uniform2f(device.uTexel, 1 / renderer.width, 1 / renderer.height);
    drawPlate(gl, device, renderer, 0, options.ch1, over, gain);
    drawPlate(gl, device, renderer, 1, options.ch2, over, gain);
    drawPlate(gl, device, renderer, 2, options.ch3, over, gain);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.spare.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.useProgram(device.resolve);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPosResolve);
    gl.vertexAttribPointer(device.aPosResolve, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.plates.texture);
    gl.uniform1i(device.uSrc, 0);
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
    if (typeof nodeGraphPicturePresent === "function") {
      const destCanvas = destCtx?.canvas || destCtx;
      return nodeGraphPicturePresent(
        renderer.shown.texture,
        renderer.width,
        renderer.height,
        destCanvas,
        width,
        height,
      );
    }
    return false;
  }

  global.nodeGraphAberrationGlEnsure = ensureRenderer;
  global.nodeGraphAberrationGlDispose = disposeRenderer;
  global.nodeGraphAberrationGlWipe = wipeRenderer;
  global.nodeGraphAberrationGlStep = step;
  global.nodeGraphAberrationGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
