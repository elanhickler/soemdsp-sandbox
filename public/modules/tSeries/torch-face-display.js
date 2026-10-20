// Torch face for the lone `t` module: four pixel-art frames (torch0, torch1,
// torch2, torch3 .png, unlit -> fully lit). Open (the combined Digital/Analog
// openness the worklet publishes, 0..1) maps linearly across them: 0 = frame 0,
// 1/3 = frame 1, 2/3 = frame 2, 1 = frame 3, and the shader mixes the two
// neighbouring frames linearly. Digital open is Open = 1 (last frame).
// Every frame is one WebGL texture on the shared picture device, uploaded once
// per image load; frames share one pixel grid (the largest frame) and each is
// centred in it, so trimmed and padded frames line up.
// Hue (Display Settings torchHue, 0..1 cycle, clamped) rotates the final colour in HSL;
// 0 skips the rotation so the image is bit-identical, greys stay grey.

(function initNodeGraphTorchFace(global) {
  const IMAGE_TOKEN = "torch-0123-20261019";
  const FRAME_FILES = ["torch0.png", "torch1.png", "torch2.png", "torch3.png"];
  const scriptSrc = (global.document?.currentScript?.src)
    || global.document?.querySelector?.('script[src*="torch-face-display.js"]')?.src
    || "";
  const imageBase = scriptSrc || String(global.location?.href || "");
  const imageUrl = (name) => {
    try {
      return new URL(`../../resources/image/${name}?v=${IMAGE_TOKEN}`, scriptSrc || new URL("./public/modules/tSeries/", imageBase)).href;
    } catch (_e) {
      return `./public/resources/image/${name}?v=${IMAGE_TOKEN}`;
    }
  };

  let images = null;
  function loadImages() {
    if (images || typeof global.Image !== "function") return;
    images = FRAME_FILES.map((name) => {
      const img = new global.Image();
      img.onload = () => {
        if (typeof scheduleNodeGraphModuleScopeDraw === "function") scheduleNodeGraphModuleScopeDraw();
      };
      img.onerror = () => {
        img._torchFailed = true;
      };
      img.src = imageUrl(name);
      return img;
    });
  }
  const imageReady = (img) => Boolean(img && !img._torchFailed && img.complete && img.naturalWidth > 0);

  const FS = `
    precision mediump float;
${SoemGl.GLSL_HSL}
    varying vec2 vUv;
    uniform sampler2D uA;
    uniform sampler2D uB;
    uniform vec4 uBox;   // grid box in face uv: x, y, w, h
    uniform vec2 uGrid;  // grid size in image pixels
    uniform vec2 uSizeA; // frame A size in pixels (centred in the grid)
    uniform vec2 uSizeB;
    uniform float uMix;  // 0 = frame A, 1 = frame B
    uniform float uHue;  // hue rotation, cycles (0 = off)
    vec4 frame(sampler2D tex, vec2 gridPx, vec2 size) {
      vec2 uv = (gridPx - (uGrid - size) * 0.5) / size;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
      return texture2D(tex, uv);
    }
    void main() {
      vec2 g = (vUv - uBox.xy) / uBox.zw;
      if (g.x < 0.0 || g.y < 0.0 || g.x > 1.0 || g.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      vec2 gridPx = g * uGrid;
      vec4 a = frame(uA, gridPx, uSizeA);
      vec4 b = frame(uB, gridPx, uSizeB);
      // Each frame over the black plate, then a linear mix between them.
      vec3 c = mix(a.rgb * a.a, b.rgb * b.a, uMix);
      if (uHue != 0.0) {
        vec3 hsl = soemRgbToHsl(c);
        hsl.x = fract(hsl.x + uHue);
        c = soemHslToRgb(hsl);
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  let kit = null;
  function ensureKit() {
    const dev = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    const gl = dev?.gl;
    if (!gl || gl.isContextLost()) return null;
    if (kit && kit.gl === gl) return kit.ok ? kit : null;
    const program = SoemGl.link(gl, SoemGl.GLSL_FULLSCREEN_VS, FS, "torch-face-display.js");
    if (!program) {
      kit = { gl, ok: false };
      return null;
    }
    const u = (name) => gl.getUniformLocation(program, name);
    kit = {
      gl,
      dev,
      ok: true,
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uA: u("uA"),
      uB: u("uB"),
      uBox: u("uBox"),
      uGrid: u("uGrid"),
      uSizeA: u("uSizeA"),
      uSizeB: u("uSizeB"),
      uMix: u("uMix"),
      uHue: u("uHue"),
      frames: FRAME_FILES.map(() => null),
    };
    return kit;
  }

  /** One-time upload of a loaded frame PNG into its texture. */
  function uploadFrame(k, index) {
    const img = images?.[index];
    const have = k.frames[index];
    if (have && have.img === img) return true;
    if (!imageReady(img)) return false;
    const gl = k.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Pixel art: nearest at any face size.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    let ok = true;
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (_error) {
      ok = false;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!ok) {
      gl.deleteTexture(texture);
      return false;
    }
    if (have?.texture) gl.deleteTexture(have.texture);
    k.frames[index] = { img, texture, w: Math.max(1, img.naturalWidth), h: Math.max(1, img.naturalHeight) };
    return true;
  }

  function inputRing(nodeId, port) {
    const buffer = typeof nodeGraphModuleScopeState !== "undefined"
      ? nodeGraphModuleScopeState?.buffers?.get?.(`${nodeId}:${port}`)
      : null;
    return buffer?.length ? buffer : null;
  }

  /**
   * Open (0..1) from the buffered A/D input rings, once per drawn frame, the
   * Clock Blink way: the window is this frame's new samples
   * (nodeGraphScopeFrameSampleStart) and Open is their peak (max), so fast
   * signals light the torch as brightly as slow ones (a mean dimmed them:
   * a 200 Hz sine averaged to ~1/pi of its crest). Per sample the
   * engine's lone-t law (graph_engine.cpp, process_transistor, lastIndex 0):
   * Digital > 0 opens fully, Analog opens by clamp(A, 0, 1); the larger wins.
   */
  function nodeGraphTorchFaceOpenFromInputs(nodeId, holder) {
    if (!nodeId || typeof nodeGraphModuleScopeConnectionsTo !== "function") return null;
    const hasAnalog = nodeGraphModuleScopeConnectionsTo(nodeId, "Analog").length > 0;
    const hasDigital = nodeGraphModuleScopeConnectionsTo(nodeId, "Digital").length > 0;
    if (!hasAnalog && !hasDigital) return null;
    const a = hasAnalog ? inputRing(nodeId, "Analog") : null;
    const d = hasDigital ? inputRing(nodeId, "Digital") : null;
    const lead = a || d;
    if (!lead) return null;
    const start = nodeGraphScopeFrameSampleStart(lead, holder, "_torchFaceOpenAbs");
    let n = lead.length - start;
    if (a) n = Math.min(n, a.length);
    if (d) n = Math.min(n, d.length);
    let peak = 0;
    let count = 0;
    for (let k = 0; k < n; k += 1) {
      const av = a ? Number(a[a.length - n + k]) : 0;
      const dv = d ? Number(d[d.length - n + k]) : 0;
      if (!Number.isFinite(av) && !Number.isFinite(dv)) continue;
      const analog = Number.isFinite(av) ? Math.max(0, Math.min(1, av)) : 0;
      const digital = dv > 0 ? 1 : 0;
      // Unipolar law (clamp(A, 0, 1)): the peak of the value, not |A|.
      peak = Math.max(peak, analog, digital);
      count += 1;
    }
    return count > 0 ? peak : null;
  }

  /** This frame's Open (0..1) for the face. */
  function nodeGraphTorchFaceOpen(item) {
    const fromInputs = nodeGraphTorchFaceOpenFromInputs(item?.slot?.nodeId, item?.screenElement || item?.slot?.scopeElement);
    if (fromInputs != null) return fromInputs;
    const buffer = item?.buffer;
    let value = null;
    if (buffer?.length) {
      for (let i = buffer.length - 1; i >= 0; i -= 1) {
        const v = Number(buffer[i]);
        if (Number.isFinite(v)) {
          value = v;
          break;
        }
      }
    }
    if (value == null && item?.slot?.nodeId && typeof nodeGraphModuleScopeLatestOutputValue === "function") {
      value = nodeGraphModuleScopeLatestOutputValue(item.slot.nodeId, "Open", 0);
    }
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  /** Display Settings bag for the Torch face: { torchHue: 0..1 cycle }. */
  function normalizeNodeGraphTorchFaceSettings(settings = {}) {
    const n = Number(settings && typeof settings === "object" ? settings.torchHue : Number.NaN);
    return { torchHue: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0 };
  }

  /** Torch hue shift (0..1 cycle) from the node's Display Settings. */
  function nodeGraphTorchFaceHue(item) {
    const node = item?.node
      || (typeof nodeGraphModuleScopeNodeForSlot === "function" ? nodeGraphModuleScopeNodeForSlot(item?.slot) : null);
    return normalizeNodeGraphTorchFaceSettings(node?.traceDisplaySettings).torchHue;
  }

  // Paint into the module's own face canvas (same as the crossfade face): the
  // scope re-appends its persistent face canvas, and the GL graph composites
  // every .node-display-canvas in DOM order, so a second canvas got covered.
  function torchCanvasForFace(face, slot) {
    let canvas = slot?.scopeElement === face && typeof ensureNodeGraphModuleScopeFaceCanvas === "function"
      ? ensureNodeGraphModuleScopeFaceCanvas(slot, { mode: "tape" })
      : null;
    if (canvas) {
      for (const stale of face.querySelectorAll?.(":scope > .node-torch-face-canvas") || []) {
        if (stale !== canvas) stale.remove();
      }
      canvas.classList.add("node-torch-face-canvas");
      return canvas;
    }
    // Detached face (probe screenshots): own canvas.
    canvas = face.querySelector?.(":scope > .node-torch-face-canvas");
    if (!canvas) {
      canvas = nodeGraphDisplayCanvasCreate("node-torch-face-canvas");
      canvas.setAttribute("aria-hidden", "true");
      face.append(canvas);
    }
    return canvas;
  }

  function syncTorchCanvas(canvas, face, pixelRatio) {
    const dpr = Math.max(1, nodeGraphFiniteNumber(pixelRatio, nodeGraphDisplayCanvasPixelRatio()));
    const metrics = typeof ensureFaceMetrics === "function" ? ensureFaceMetrics(face, { observe: true }) : null;
    const cssW = metrics ? metrics.cssW : Math.max(1, face.clientWidth || 1);
    const cssH = metrics ? metrics.cssH : Math.max(1, face.clientHeight || 1);
    nodeGraphDisplayCanvasSetBacking(canvas, Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr)));
    if (face.style && (!face.style.position || face.style.position === "static")) {
      face.style.position = "relative";
    }
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    return canvas.width > 0 && canvas.height > 0;
  }

  function drawNodeGraphTorchFaceItem(renderer, item, pixelRatio) {
    const slot = item?.slot;
    const face = item?.screenElement || slot?.scopeElement;
    if (!slot || !face) return;
    loadImages();
    const canvas = torchCanvasForFace(face, slot);
    if (!syncTorchCanvas(canvas, face, pixelRatio)) return;
    const ctx = nodeGraphDisplayCanvasPresentContext(canvas);
    const k = ensureKit();
    if (!ctx || !k) {
      nodeGraphDisplayGlFailed(canvas, "Torch GL unavailable");
      return;
    }
    let ready = true;
    for (let i = 0; i < FRAME_FILES.length; i += 1) ready = uploadFrame(k, i) && ready;
    if (!ready) {
      // Images still loading: wait (onload repaints). A missing frame is a failure.
      if (images?.some((img) => img._torchFailed)) {
        nodeGraphDisplayGlFailed(canvas, "Torch images failed to load");
      }
      return;
    }
    const gl = k.gl;
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    const open = nodeGraphTorchFaceOpen(item);
    const last = FRAME_FILES.length - 1;
    const pos = open * last;
    const ia = Math.min(last, Math.floor(pos));
    const ib = Math.min(last, ia + 1);
    const fa = k.frames[ia];
    const fb = k.frames[ib];
    // Shared pixel grid = largest frame; contain-fit and centre it in the face.
    let gw = 1;
    let gh = 1;
    for (const f of k.frames) {
      gw = Math.max(gw, f.w);
      gh = Math.max(gh, f.h);
    }
    const scale = Math.min(w / gw, h / gh);
    const rw = (gw * scale) / w;
    const rh = (gh * scale) / h;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.scissor(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(k.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fa.texture);
    gl.uniform1i(k.uA, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fb.texture);
    gl.uniform1i(k.uB, 1);
    gl.uniform4f(k.uBox, (1 - rw) * 0.5, (1 - rh) * 0.5, rw, rh);
    gl.uniform2f(k.uGrid, gw, gh);
    gl.uniform2f(k.uSizeA, fa.w, fa.h);
    gl.uniform2f(k.uSizeB, fb.w, fb.h);
    gl.uniform1f(k.uMix, Math.max(0, Math.min(1, pos - ia)));
    gl.uniform1f(k.uHue, nodeGraphTorchFaceHue(item));
    SoemGl.drawQuad(gl, k.aPos);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.SCISSOR_TEST);

    const srcY = Math.max(0, k.dev.canvas.height - h);
    ctx.save();
    nodeGraphDisplayCanvasBlit(ctx, k.dev.canvas, 0, srcY, w, h, 0, 0, w, h, false);
    ctx.restore();
    face._torchFaceOpen = open;
    if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
      nodeGraphModuleScopeMarkScreenLit(face, 1);
    }
  }

  global.drawNodeGraphTorchFaceItem = drawNodeGraphTorchFaceItem;
  global.nodeGraphTorchFaceOpen = nodeGraphTorchFaceOpen;
  global.nodeGraphTorchFaceHue = nodeGraphTorchFaceHue;
  global.normalizeNodeGraphTorchFaceSettings = normalizeNodeGraphTorchFaceSettings;
  if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
    nodeGraphModuleScopeCustomRenderers.torchFace = drawNodeGraphTorchFaceItem;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
