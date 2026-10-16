// Colour picker saturation/value plane — HSL/HSV from UV + hue uniform on the
// shared picture device. Canvas2D putImageData kept as fallback.

(function initColorWidgetPlaneGl(global) {
  const REV = 2;
  let shared = null;

  const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

  // modes: 0 = HSV plane (planeRgb), 1 = HSL lamp (hueBrightness), 2 = BW
  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uResolution;
uniform float uHue;
uniform float uMode;

${SoemGl.GLSL_HSL}
vec3 hueUnit(float hueDeg) {
  return soemHueUnit(hueDeg);
}

// Match planeRgb(h, u, v): HSV sat x value square (chroma * hue unit + m).
vec3 planeRgb(float hueDeg, float u, float v) {
  float s = clamp(u, 0.0, 1.0);
  float value = clamp(v, 0.0, 1.0);
  float c = value * s;
  float m = value - c;
  return c * soemHueUnit(hueDeg) + vec3(m);
}

float easeHermite(float t) {
  float x = clamp(t, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

// Port of nodeGraphHueBrightnessRgb01(hue, brightness, saturation).
vec3 hueBrightness(float hueDeg, float bright, float sat) {
  vec3 hue = hueUnit(hueDeg);
  float t = clamp(bright, 0.0, 1.0);
  vec3 lin = pow(max(hue, vec3(0.0)), vec3(2.2));
  vec3 outc;
  if (t <= 0.5) {
    float e = easeHermite(t / 0.5);
    outc = pow(lin * e, vec3(1.0 / 2.2));
  } else {
    float e = easeHermite((t - 0.5) / 0.5);
    outc = pow(lin * (1.0 - e) + e, vec3(1.0 / 2.2));
  }
  float s = clamp(sat, 0.0, 1.0);
  if (s < 1.0 - 1e-6) {
    float y = 0.2126 * outc.r + 0.7152 * outc.g + 0.0722 * outc.b;
    outc = outc * s + vec3(y) * (1.0 - s);
  }
  return clamp(outc, 0.0, 1.0);
}

void main() {
  // Pixel centres in the current viewport (left→right, bottom→top).
  // Match Canvas2D: u = x/(w-1), v = 1 - y_top/(h-1).
  vec2 den = max(uResolution - 1.0, vec2(1.0));
  float u = clamp(gl_FragCoord.x - 0.5, 0.0, den.x) / den.x;
  float v = clamp(gl_FragCoord.y - 0.5, 0.0, den.y) / den.y;
  float mode = floor(uMode + 0.5);
  vec3 rgb;
  if (mode < 0.5) {
    rgb = planeRgb(uHue, u, v);
  } else if (mode < 1.5) {
    rgb = hueBrightness(uHue, v, u);
  } else {
    float g = clamp(v, 0.0, 1.0);
    rgb = vec3(g);
  }
  gl_FragColor = vec4(rgb, 1.0);
}
`;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "color-widget-plane-gl.js");
  }

  function getShared() {
    if (shared?.gl && !shared.gl.isContextLost() && shared.rev === REV) return shared;
    shared = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const gl = picture.gl;
    const program = link(gl, VERT, FRAG);
    if (!program) return null;
    shared = {
      rev: REV,
      gl,
      canvas: picture.canvas,
      quad: picture.quad,
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uHue: gl.getUniformLocation(program, "uHue"),
      uMode: gl.getUniformLocation(program, "uMode"),
      uResolution: gl.getUniformLocation(program, "uResolution"),
    };
    return shared;
  }

  /**
   * Paint colour plane into destCanvas (2D backing). channels: full|hsl|bw.
   * @returns {boolean}
   */
  function paint(destCanvas, width, height, hueDeg, channels) {
    const device = getShared();
    if (!device || !destCanvas) return false;
    const w = Math.max(2, Math.round(width) | 0);
    const h = Math.max(2, Math.round(height) | 0);
    if (w > device.canvas.width || h > device.canvas.height) return false;

    let mode = 0;
    const ch = String(channels || "full");
    if (ch === "hsl" || ch === "hbs") mode = 1;
    else if (ch === "bw") mode = 2;

    const gl = device.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.scissor(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(device.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPos);
    gl.vertexAttribPointer(device.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(device.uHue, SoemMath.finiteOr(hueDeg, 0));
    gl.uniform1f(device.uMode, mode);
    gl.uniform2f(device.uResolution, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.SCISSOR_TEST);

    if (destCanvas.width !== w) destCanvas.width = w;
    if (destCanvas.height !== h) destCanvas.height = h;
    // Same-frame copy from the shared device (rows bottom-up) to the plane canvas.
    const ctx = nodeGraphDisplayCanvasPresentContext(destCanvas);
    const ok = Boolean(ctx) && nodeGraphDisplayCanvasBlit(
      ctx, device.canvas, 0, Math.max(0, device.canvas.height - h), w, h, 0, 0, w, h, false,
    );
    gl.viewport(0, 0, device.canvas.width, device.canvas.height);
    if (!ok) {
      nodeGraphDisplayGlFailed(destCanvas, "color plane: GL present failed");
    }
    return ok;
  }

  global.ColorWidgetPlaneGl = {
    paint,
    available: () => Boolean(getShared()),
    rev: REV,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
