// LED / LCD Dot / RGB Shape — SDF evaluated per pixel in GLSL on the shared
// picture device. Live frames do not bake JS sprites (JS bake kept as fallback).
// Source:
//   public/lib/trace/trace-dot-sprite.vert.glsl
//   public/lib/trace/trace-dot-sprite.frag.glsl

(function initTraceDotSpriteGl(global) {
  const REV = 3;
  const GLSL_REV = "1";
  let shared = null;
  const glsl = { vs: "", fs: "", promise: null, failed: false };

  function glslUrls(fileName) {
    let embedBase = "";
    try {
      const path = String(window.location.pathname || "");
      const idx = path.indexOf("/soemdsp-sandbox");
      if (idx >= 0) embedBase = `${path.slice(0, idx)}/soemdsp-sandbox/`;
    } catch (_error) {
      embedBase = "";
    }
    const rel = `public/lib/trace/${fileName}?v=dot-glsl-${GLSL_REV}`;
    return [
      embedBase ? `${embedBase}${rel}` : "",
      `./${rel}`,
      `/${rel}`,
      `/soemdsp-sandbox/${rel}`,
    ].filter(Boolean);
  }

  async function fetchGlsl(fileName) {
    const urls = glslUrls(fileName);
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const res = await fetch(urls[i], { cache: "no-cache" });
        if (!res.ok) continue;
        const text = await res.text();
        if (text && text.indexOf("void main()") >= 0) return text;
      } catch (_error) {
        // next candidate
      }
    }
    return "";
  }

  function loadGlsl() {
    if (glsl.promise) return glsl.promise;
    glsl.promise = (async () => {
      const vs = await fetchGlsl("trace-dot-sprite.vert.glsl");
      const fs = await fetchGlsl("trace-dot-sprite.frag.glsl");
      if (!vs || !fs) {
        glsl.failed = true;
        console.warn("[trace-dot-sprite-gl] missing public/lib/trace/trace-dot-sprite.*.glsl");
        return null;
      }
      glsl.vs = vs;
      glsl.fs = fs;
      return glsl;
    })();
    return glsl.promise;
  }

  loadGlsl();

  const SHAPE_IDS = {
    circle: 0, oval: 0, pill: 1, squircle: 2, ngon: 3, star: 4, heart: 5,
    trapezoid: 6, diamond: 7, cross: 8, ring: 9, teardrop: 10, flower: 11,
  };

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "trace-dot-sprite-gl.js");
  }

  function getShared() {
    if (shared?.gl && !shared.gl.isContextLost() && shared.rev === REV) return shared;
    shared = null;
    if (glsl.failed) return null;
    if (!glsl.vs || !glsl.fs) {
      loadGlsl();
      return null;
    }
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const gl = picture.gl;
    const program = link(gl, glsl.vs, glsl.fs);
    if (!program) return null;
    const lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const blank = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i += 1) {
      blank[i * 4] = 255;
      blank[i * 4 + 1] = 255;
      blank[i * 4 + 2] = 255;
      blank[i * 4 + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);
    shared = {
      rev: REV,
      gl,
      canvas: picture.canvas,
      quad: picture.quad,
      program,
      lutTex,
      lutKey: "",
      aPos: gl.getAttribLocation(program, "aPos"),
      u: {
        uResolution: gl.getUniformLocation(program, "uResolution"),
        uCenter: gl.getUniformLocation(program, "uCenter"),
        uHalf: gl.getUniformLocation(program, "uHalf"),
        uBlur: gl.getUniformLocation(program, "uBlur"),
        uShape: gl.getUniformLocation(program, "uShape"),
        uParam: gl.getUniformLocation(program, "uParam"),
        uAmount: gl.getUniformLocation(program, "uAmount"),
        uLut: gl.getUniformLocation(program, "uLut"),
        uFlat: gl.getUniformLocation(program, "uFlat"),
        uFlatColor: gl.getUniformLocation(program, "uFlatColor"),
      },
    };
    return shared;
  }

  function parseCssColor(css) {
    const c = globalThis.SoemColor.parse(css);
    return c ? [c[0] / 255, c[1] / 255, c[2] / 255, c[3]] : [1, 1, 1, 1];
  }

  function uploadLut(device, colorAt) {
    const gl = device.gl;
    const data = new Uint8Array(256 * 4);
    let key = "";
    for (let i = 0; i < 256; i += 1) {
      const b = i / 255;
      const css = colorAt(b);
      const rgba = parseCssColor(css);
      const o = i * 4;
      data[o] = Math.round(rgba[0] * 255);
      data[o + 1] = Math.round(rgba[1] * 255);
      data[o + 2] = Math.round(rgba[2] * 255);
      data[o + 3] = Math.round(rgba[3] * 255);
      if (i === 0 || i === 128 || i === 255) key += css + ";";
    }
    if (device.lutKey === key) return;
    device.lutKey = key;
    gl.bindTexture(gl.TEXTURE_2D, device.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  function drawToTarget(fbo, tw, th, cx, cy, rx, ry, blur01, shapeName, shapeParam, amount, colorAt, flat, flatCss, alpha01, additive) {
    const device = getShared();
    if (!device) return false;
    const gl = device.gl;
    const charR = Math.min(rx, ry);
    const b = SoemMath.clamp01(blur01);
    const b2 = b * b;
    const outer = charR * (1 + b2 * 1.65) + Math.max(1, 1.1 - b2);
    const extra = Math.max(0, outer - charR);
    const halfW = Math.ceil(rx + extra + 1.5);
    const halfH = Math.ceil(ry + extra + 1.5);
    const x0 = Math.max(0, Math.floor(cx - halfW));
    const y0 = Math.max(0, Math.floor(cy - halfH));
    const x1 = Math.min(tw, Math.ceil(cx + halfW));
    const y1 = Math.min(th, Math.ceil(cy + halfH));
    if (x1 <= x0 || y1 <= y0) return true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, tw, th);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, y0, x1 - x0, y1 - y0);
    gl.enable(gl.BLEND);
    if (additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(device.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPos);
    gl.vertexAttribPointer(device.aPos, 2, gl.FLOAT, false, 0, 0);
    const shapeId = SHAPE_IDS[String(shapeName || "circle").toLowerCase()] ?? 0;
    gl.uniform2f(device.u.uResolution, tw, th);
    gl.uniform2f(device.u.uCenter, cx, cy);
    gl.uniform2f(device.u.uHalf, Math.max(0.5, rx), Math.max(0.5, ry));
    gl.uniform1f(device.u.uBlur, b);
    gl.uniform1f(device.u.uShape, shapeId);
    gl.uniform1f(device.u.uParam, SoemMath.clamp01(shapeParam));
    const amt = SoemMath.clamp01(amount);
    gl.uniform1f(device.u.uAmount, Number.isFinite(amt) ? amt : 1);
    const a = SoemMath.clamp01(alpha01);
    const alpha = Number.isFinite(a) ? a : 1;
    if (flat) {
      const rgba = parseCssColor(flatCss);
      gl.uniform1f(device.u.uFlat, 1);
      gl.uniform4f(device.u.uFlatColor, rgba[0], rgba[1], rgba[2], rgba[3] * alpha);
    } else {
      gl.uniform1f(device.u.uFlat, 0);
      uploadLut(device, colorAt || (() => "#ffffff"));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, device.lutTex);
      gl.uniform1i(device.u.uLut, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  global.TraceDotSpriteGl = {
    drawToTarget,
    failed: () => Boolean(glsl.failed),
    available: () => Boolean(getShared()),
    shapeId: (name) => SHAPE_IDS[String(name || "circle").toLowerCase()] ?? 0,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
