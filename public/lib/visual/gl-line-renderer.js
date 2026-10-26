// Shared WebGL line / fill / image / text renderer for module faces (the one
// drawing interface; docs/WEBGL_DISPLAY_PLAN.md).
//
// Draws on the shared picture device (public/lib/visual/picture-device.js,
// one hidden WebGL2 context) and blits the result into the face's own 2D
// canvas. The face canvas keeps the shared sizing path (backing = layout css
// x devicePixelRatio, never x workspace zoom) and the node-display-canvas
// marker class (display-canvas.js), so the one styles.css
// .pixelated-canvas-zoom .node-display-canvas rule pixelates it above 2.5x zoom.
//
// Coordinates are device px unless begin() got { scale }: then x/y, halfPx,
// feather and text px are CSS px and multiplied by scale (pass the face
// pixelRatio).
//
// Lines are shader-expanded quads (capsules): each vertex carries its local
// position along/across the segment, the fragment shader takes the distance
// to the segment and fades it over `feather` px past `halfPx` with Perlin
// smootherstep (docs/APP_POLICY.md):
//   a = 1 - smootherstep(halfPx, halfPx + feather, dist)
// so thickness never depends on fractional pixel position. Fills are the
// same quads with an infinite halfPx (solid). A zero-length segment is a
// round dot of radius halfPx. Phosphor beams keep gaussian/erf. Jack
// rings keep a 1px AA skirt.
//
// Draw order per frame: images (under), quads, text (over).
//
// Text: nodeGraphGlLinesText draws from one shared glyph atlas per font
// (white coverage baked once at 64 px with a 2D canvas inside this shared lib,
// uploaded as an RGBA texture with mipmaps; tinted in the shader). Cells are
// separated by a TEXT_GUTTER so mip levels never sample a neighbour glyph.
//
// Color emoji: a text run that contains emoji grapheme clusters
// (Extended_Pictographic, ZWJ sequences, flags, keycaps, VS16) draws each
// emoji from a shared colour atlas, inline with the coverage glyphs, with the
// browser's advance and the same baseline. Each emoji is rasterized ONCE at
// its base size: the drawn size in face-backing device px (font px x
// pixelRatio; the backing is never x workspace zoom), cached by
// emoji + base px, uploaded premultiplied with NEAREST filtering. Zoom never
// re-bakes: zooming scales those pixels and the display pixelation rule
// applies (no sharpening). Steady state allocates nothing and bakes nothing.
//
// RGBA picture out: when the face's module has a cable on its `rgba` / TV out
// (picture-device nodeGraphPictureHasConsumer), end() renders the batch into
// that node's picture texture (transparent clear, premultiplied alpha), then
// shows the face from that texture over the plate colour. Picture textures on
// the wire are premultiplied RGBA (opaque sources are unchanged by this).
//
// No WebGL2 (no device, context lost, shader failure): begin() returns null and
// the caller shows a plain black square (nodeGraphGlLinesFillBlack). No 2D drawing.
// Context loss: picture-device drops the device; the next begin() sees a new
// gl and rebuilds the programs and atlases.

(function initNodeGraphGlLineRenderer(global) {
  const MAX_DIM = 4096;
  const FLOATS = 12; // pos2, local2, len1, half1, feather1, caps1, rgba4
  const PULSE_TRAIN_MAX = 16384;
  // Perlin quintic. Same one-SDF cost as Hermite smoothstep; C2 at the
  // skirt ends.
  const COVERAGE_GLSL = `
float coverageSmoother(float halfPx, float feather, float dist) {
  float w = max(feather, 1e-4);
  float t = clamp((dist - halfPx) / w, 0.0, 1.0);
  return 1.0 - t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
`;
  const VS = `
attribute vec2 position;
attribute vec2 local;
attribute float segLen;
attribute float halfPx;
attribute float feather;
attribute float caps;
attribute vec4 colour;
uniform float uPixel;
uniform vec3 uCam;
uniform vec2 uVp;
uniform float uDevice;
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying float vCaps;
varying vec4 vColour;
void main() {
  vec2 pos = position;
  float capsOut = caps;
  vec2 localOut = local;
  float halfOut = halfPx;
  float lenOut = segLen;
  // Analytic ring (caps 10): local = offset from the centre, segLen = radius.
  // Camera: radius / half are zoom-1 world px, feather is screen px (as dots).
  if (uPixel > 0.5 && caps > 9.75) {
    float z = max(uCam.z, 0.0001);
    localOut = local * z;
    halfOut = halfPx * z;
    lenOut = segLen * z;
  } else
  // Camera: halfPx is zoom-1 world px, feather is screen px. Reach uses the
  // live zoom so a retained mesh does not pulse when the camera changes.
  if (uPixel > 0.5 && caps > 5.5 && caps < 9.5) {
    float z = max(uCam.z, 0.0001);
    float aaWorld = 1.5 / z;
    float reach = halfPx + aaWorld;
    float alongSign = ((caps > 6.5 && caps < 7.5) || caps > 8.5) ? 1.0 : -1.0;
    float acrossSign = caps > 7.5 ? 1.0 : -1.0;
    vec2 tangent = local;
    float tl = length(tangent);
    if (tl > 0.0001) tangent /= tl;
    vec2 normal = vec2(-tangent.y, tangent.x);
    pos = position + (tangent * alongSign + normal * acrossSign) * reach;
    // segLen = arc at the end + alongSign * halfPx. Add the AA pad on top.
    localOut = vec2(segLen + alongSign * aaWorld, acrossSign * reach);
    capsOut = 6.0;
  } else if (uPixel > 0.5 && caps > 3.75) {
    float z = max(uCam.z, 0.0001);
    float reach = halfPx * z + feather;
    pos = position + local * (reach / z);
    localOut = local * reach;
    halfOut = halfPx * z;
    capsOut = 0.0;
  } else if (uPixel > 0.5 && caps > 2.5) {
    float side = caps > 3.25 ? -1.0 : 1.0;
    vec2 n = local;
    float nl = length(n);
    if (nl > 0.0001) n /= nl;
    float z = max(uCam.z, 0.0001);
    float reach = halfPx * z + feather;
    pos = position + n * side * (reach / z);
    localOut = vec2(0.0, side * reach);
    halfOut = halfPx * z;
    capsOut = 1.0;
  }
  if (uPixel > 0.5) {
    vec2 css = (pos - uCam.xy) * max(uCam.z, 0.0001);
    vec2 dev = css * uDevice;
    gl_Position = vec4(dev.x / uVp.x * 2.0 - 1.0, 1.0 - dev.y / uVp.y * 2.0, 0.0, 1.0);
  } else {
    gl_Position = vec4(position, 0.0, 1.0);
  }
  vLocal = localOut;
  vLen = lenOut;
  vHalf = halfOut;
  vFeather = feather;
  vCaps = capsOut;
  vColour = colour;
}
`;
  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying float vCaps;
varying vec4 vColour;
uniform float uCoverage;
uniform vec3 uCam;
uniform vec2 uDash;
${COVERAGE_GLSL}
void main() {
  float u = vLocal.x;
  float across = abs(vLocal.y);
  float a;
  if (vCaps > 9.75) {
    // Analytic ring: distance to the circle of radius vLen, same solid core +
    // shared feather smootherstep as the capsule / dot primitives.
    float d = abs(length(vLocal) - vLen);
    a = coverageSmoother(vHalf, vFeather, d);
  } else if (vCaps > 5.5 && vCaps < 6.5) {
    // One stadium per dash. Arc length is zoom-1 px, so the pattern stays
    // put while the camera moves. Caps and the body share this coverage.
    float z = max(uCam.z, 0.0001);
    float arc = vLocal.x;
    float gap = abs(vLocal.y);
    float total = max(vFeather, 0.0);
    float on = max(uDash.x, 0.5);
    float period = max(on + max(uDash.y, 0.0), 1e-3);
    float k = floor(arc / period);
    float best = 1e4;
    for (int s = -1; s <= 1; s += 1) {
      float dash0 = (k + float(s)) * period;
      float dash1 = dash0 + on;
      float c0 = max(dash0, 0.0);
      float c1 = min(dash1, total);
      if (c1 > c0) {
        float along = arc < c0 ? c0 - arc : (arc > c1 ? arc - c1 : 0.0);
        best = min(best, along);
      }
    }
    float dScreen = length(vec2(best, gap)) * z;
    float halfScreen = max(vHalf, 0.0) * z;
    float fw = max(fwidth(dScreen), 0.6);
    a = coverageSmoother(halfScreen, fw, dScreen);
  } else if (vCaps > 1.5) {
    // Phosphor beam. erf integrates the gaussian along the segment so
    // overlapping ends add to one continuous brightness.
    float sigma = max(vHalf, 1e-3);
    float inv = 0.70710678 / sigma;
    float x = vLocal.x * inv;
    float s = sign(x);
    float ax = abs(x);
    float p = 1.0 + (0.278393 + (0.230389 + 0.078108 * ax * ax) * ax) * ax;
    p *= p;
    float e0 = s - s / (p * p);
    x = (vLocal.x - vLen) * inv;
    s = sign(x);
    ax = abs(x);
    p = 1.0 + (0.278393 + (0.230389 + 0.078108 * ax * ax) * ax) * ax;
    p *= p;
    float e1 = s - s / (p * p);
    float along = clamp(0.5 * (e0 - e1), 0.0, 1.0);
    float y = vLocal.y;
    float acrossGlow = exp(-y * y / (2.0 * sigma * sigma));
    a = along * acrossGlow;
  } else {
    float d;
    if (vCaps > 0.5) {
      float outside = u < 0.0 ? -u : (u > vLen ? u - vLen : 0.0);
      d = outside > 0.0 ? vHalf + vFeather + outside : across;
    } else {
      d = u < 0.0 ? length(vLocal) : (u > vLen ? length(vec2(u - vLen, vLocal.y)) : across);
    }
    a = coverageSmoother(vHalf, vFeather, d);
  }
  float cov = vColour.a * a;
  // Coverage pass stores straight alpha. Zero-coverage corners must be
  // (0,0,0,0) or MAX would paint the quad's bounding box. The cut tests
  // geometric coverage only, never colour alpha: no brightness threshold.
  gl_FragColor = (uCoverage > 0.5 && a < 0.004) ? vec4(0.0) : vec4(vColour.rgb, cov);
}
`;
  // Textured quads: images (mode 0), tinted glyph coverage (mode 1),
  // premultiplied picture present (mode 2).
  const IMG_VS = `
attribute vec2 position;
attribute vec2 uv;
attribute vec4 vtint;
uniform float uPixel;
uniform vec3 uCam;
uniform vec2 uVp;
uniform float uDevice;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  if (uPixel > 0.5) {
    vec2 css = (position - uCam.xy) * max(uCam.z, 0.0001);
    vec2 dev = css * uDevice;
    gl_Position = vec4(dev.x / uVp.x * 2.0 - 1.0, 1.0 - dev.y / uVp.y * 2.0, 0.0, 1.0);
  } else {
    gl_Position = vec4(position, 0.0, 1.0);
  }
  vUv = uv;
  vTint = vtint;
}
`;
  const IMG_FS = `
precision mediump float;
uniform sampler2D tex;
uniform float alpha;
uniform vec4 tint;
uniform float mode;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 c = texture2D(tex, vUv);
  if (mode > 2.5) {
    // Premultiplied colour emoji x tint alpha.
    gl_FragColor = c * vTint.a;
  } else if (mode > 1.5) {
    gl_FragColor = c;
  } else if (mode > 0.5) {
    // Per-vertex tint (batched glyphs / tinted sprites) x coverage.
    gl_FragColor = vec4(vTint.rgb, vTint.a * c.a);
  } else {
    gl_FragColor = vec4(c.rgb, c.a * alpha);
  }
}
`;
  const TEXT_BAKE_PX = 64;
  // Raised when the caller wants glyphs baked closer to the size they are drawn.
  // Capped so one cell still fits the sheet. Unset callers keep 64.
  let glyphBakePx = TEXT_BAKE_PX;
  const TEXT_WHITE = Object.freeze([1, 1, 1, 1]);
  const TEXT_PAD = 6;
  // Empty texels between atlas cells: 64 px bake at 1/8 draw (mip 3) still
  // keeps 4 empty texels between glyphs, so no neighbour bleed.
  const TEXT_GUTTER = 32;
  // Colour emoji atlas.
  const EMOJI_SHEET = 1024;
  const EMOJI_PAD = 2;
  const EMOJI_MAX_PAGES = 4;
  const EMOJI_FAMILY = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
  // Cheap gate (no allocation): only text that may hold an emoji is segmented.
  const EMOJI_HINT = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{200D}\u{FE0F}\u{20E3}\u{00A9}\u{00AE}\u{203C}\u{2049}\u{2122}\u{2139}\u{2194}-\u{21AA}\u{231A}-\u{23FF}\u{24C2}\u{25AA}-\u{25FE}]/u;
  const EMOJI_CLUSTER = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}|\u{200D}/u;
  const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|\u{FE0F}|\u{20E3}|\u{200D}|\p{Regional_Indicator}/u;
  const SEGMENT_CACHE_MAX = 512;
  const segmentCache = new Map();
  const emojiStats = { bakes: 0, uploads: 0, segmentMisses: 0, pages: 0, entries: 0, dropped: 0 };
  const TEXT_ASCENT = 0.8;   // of px, baseline from em top
  const TEXT_DEFAULT_FAMILY = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
  const TEXT_BASE_CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~—–°·×±µƒ♯♭";
  let state = null;
  let failedGl = null;

  function compile(gl, type, source, label) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "compile failed";
      gl.deleteShader(shader);
      throw new Error(label ? label + " compile: " + log : log);
    }
    return shader;
  }

  const VEIL_FS = `
precision mediump float;
varying vec2 vPx;
uniform vec4 uRect;
uniform float uPeriod;
void main() {
  if (vPx.x < uRect.x || vPx.y < uRect.y || vPx.x > uRect.x + uRect.z || vPx.y > uRect.y + uRect.w) discard;
  float period = max(uPeriod, 1.0);
  float band = mod(vPx.x + vPx.y, period);
  if (band < 0.0) band += period;
  if (band > period * 0.5) discard;
  gl_FragColor = vec4(0.886, 0.659, 0.427, 0.34);
}
`;
  const OUT_VS = `
attribute vec2 position;
attribute vec2 pixel;
uniform float uPixel;
uniform vec3 uCam;
uniform vec2 uVp;
uniform float uDevice;
uniform vec4 uPlate;
varying vec2 vPx;
void main() {
  vec2 pos = position;
  // Keep the 1px screen stroke inside the quad at any zoom. Veil draws leave
  // uPlate at zero, so they stay put.
  if (uPixel > 0.5 && uPlate.z > 0.5 && uPlate.w > 0.5) {
    vec2 center = uPlate.xy + uPlate.zw * 0.5;
    vec2 dir = pos - center;
    float len = length(dir);
    if (len > 0.001) {
      float z = max(uCam.z, 0.0001);
      float devScale = max(uDevice, 0.0001);
      pos += (dir / len) * (2.0 / (z * devScale));
    }
  }
  if (uPixel > 0.5) {
    vec2 css = (pos - uCam.xy) * max(uCam.z, 0.0001);
    vec2 dev = css * uDevice;
    gl_Position = vec4(dev.x / uVp.x * 2.0 - 1.0, 1.0 - dev.y / uVp.y * 2.0, 0.0, 1.0);
  } else {
    gl_Position = vec4(position, 0.0, 1.0);
  }
  // vPx moves with the grown quad. Interpolating the unmoved corner pixel
  // over the grown quad skewed the shader's pixel grid against the window,
  // so the plate border sat up to a device px off every quad drawn beside it.
  vPx = pixel + (pos - position);
}
`;
  const OUT_FS = `
precision mediump float;
// highp: world-space pixel coords near 1000 lose half-pixels in mediump, which
// walked the plate border a device row off the quads drawn beside it.
varying highp vec2 vPx;
// Shared with the vertex shader, whose floats are highp. An unqualified
// float here is mediump and the program fails to link.
uniform highp vec4 uPlate;
uniform vec4 uPlateColor;
uniform vec4 uFill;
uniform float uStroke;
uniform int uCount;
uniform vec4 uJack[24];
uniform vec4 uJackColor[24];
// Border cuts: (y0, y1, side, 0) per rail IO box. No stroke on that wall over
// [y0, y1); the box is drawn through the gap by the rail quads.
uniform int uCutCount;
uniform highp vec4 uCut[16];
uniform highp float uPixel;
uniform highp vec3 uCam;
uniform highp float uDevice;
void main() {
  vec2 plateMin = uPlate.xy;
  vec2 plateMax = uPlate.xy + uPlate.zw;
  vec2 px = vPx;
  float strokeW = max(uStroke, 0.0);
  float z = max(uCam.z, 0.0001);
  float devScale = max(uDevice, 0.0001);
  if (uPixel > 0.5) {
    // Screen pixels. Edges snap to whole pixels so zoom does not walk the
    // border and the body across the pixel grid. Stroke is at least 1 px.
    vec2 origin = uCam.xy;
    px = (vPx - origin) * z * devScale;
    // ceil(v - 0.5): the first pixel a quad edge at v covers (centre >= v),
    // so a half-pixel edge snaps the same way the face / rail quads rasterize.
    plateMin = ceil((uPlate.xy - origin) * z * devScale - 0.5);
    plateMax = ceil((uPlate.xy + uPlate.zw - origin) * z * devScale - 0.5);
    plateMax = max(plateMax, plateMin + vec2(1.0));
    strokeW = max(1.0, floor(max(uStroke, 0.0) * z * devScale + 0.5));
  }
  vec2 c = (plateMin + plateMax) * 0.5;
  vec2 halfSize = (plateMax - plateMin) * 0.5;
  vec2 q = abs(px - c) - halfSize;
  float sdRect = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  // The plate is the rectangle minus the inside half of every jack (a disk,
  // or a square for param jacks, centred on the wall). sd > 0 is outside it.
  // Param and signal jacks take this one path.
  float sd = sdRect;
  vec4 strokeCol = uPlateColor;
  for (int i = 0; i < 24; i++) {
    if (i >= uCount) break;
    vec2 jack = uJack[i].xy;
    float radius = uJack[i].z;
    if (uPixel > 0.5) {
      float signr = radius < 0.0 ? -1.0 : 1.0;
      jack = (jack - uCam.xy) * z * devScale;
      radius = signr * abs(uJack[i].z) * z * devScale;
    }
    float square = radius < 0.0 ? 1.0 : 0.0;
    radius = abs(radius);
    float d = square > 0.5
      ? max(abs(px.x - jack.x), abs(px.y - jack.y)) - radius
      : length(px - jack) - radius;
    if (-d > sd) {
      sd = -d;
      strokeCol = vec4(uJackColor[i].rgb, uPlateColor.a);
    }
  }
  // One stroke for wall and jack: the band 0 < sd <= strokePx outside the
  // shape, where the plate stroke has always sat. A jack meets the wall in a
  // square corner (the max of the two distances), so the strokes join with no
  // gap and no doubled pixel. Camera mode: strokeW is whole screen pixels and
  // the plate edges sit on pixel edges, so walls stay crisp and curves get a
  // one-pixel ramp. Coverage is linear in sd over one pixel (SDF slope 1).
  float strokePx = uPixel > 0.5 ? strokeW : max(1.0, floor(strokeW + 0.5));
  float aa = uPixel > 0.5 ? 1.0 : max(fwidth(sd), 1e-4);
  float inner = clamp(sd / aa + 0.5, 0.0, 1.0);
  float band = inner - clamp((sd - strokePx) / aa + 0.5, 0.0, 1.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uCutCount) break;
    highp vec4 cut = uCut[i];
    highp float cy0 = cut.x;
    highp float cy1 = cut.y;
    if (uPixel > 0.5) {
      cy0 = (cut.x - uCam.y) * z * devScale;
      cy1 = (cut.y - uCam.y) * z * devScale;
    }
    bool wall = cut.z < 0.0 ? px.x < plateMin.x : px.x >= plateMax.x;
    if (wall && px.y >= cy0 && px.y < cy1) band = 0.0;
  }
  // Stroke and fill cover disjoint parts of the pixel, so they add.
  float strokeA = band * strokeCol.a;
  float plateA = (1.0 - inner) * uFill.a;
  float a = strokeA + plateA;
  if (a < 0.004) discard;
  vec3 rgb = (strokeCol.rgb * strokeA + uFill.rgb * plateA) / a;
  gl_FragColor = vec4(rgb, a);
}
`;
  // The shared context is WebGL2, where GLSL 1.00 has no derivatives
  // (OES_standard_derivatives is a WebGL1 extension). Shaders that use fwidth
  // are written in 1.00 style and lifted to 300 es here, where it is built in.
  function es3(source, stage) {
    let out = String(source).replace(/^\s*#extension[^\n]*\n/gm, "");
    out = out.replace(/\battribute\b/g, "in");
    out = out.replace(/\bvarying\b/g, stage === "fs" ? "in" : "out");
    if (stage === "fs") {
      out = out.replace(/\btexture2D\b/g, "texture").replace(/\bgl_FragColor\b/g, "fragColor");
      out = out.replace(/(precision \w+ float;\s*(?:#endif\s*)?)/, "$1out vec4 fragColor;\n");
    }
    return "#version 300 es\n" + out.replace(/^\s+/, "");
  }

  function link(gl, vs, fs, opts) {
    const v3 = !!opts?.es3;
    const v = compile(gl, gl.VERTEX_SHADER, v3 ? es3(vs, "vs") : vs, "vertex");
    const f = compile(gl, gl.FRAGMENT_SHADER, v3 ? es3(fs, "fs") : fs, "fragment");
    const program = gl.createProgram();
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "link failed";
      gl.deleteProgram(program);
      throw new Error("link: " + log);
    }
    return program;
  }

  function ensure() {
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    const gl = dev?.gl || null;
    if (!gl || typeof gl.createShader !== "function" || gl.isContextLost?.()) return null;
    if (state && state.gl === gl) return state;
    if (failedGl === gl) return null;
    try {
      const program = link(gl, VS, FS, { es3: true });
      const imgProgram = link(gl, IMG_VS, IMG_FS);
      const outProgram = link(gl, OUT_VS, OUT_FS, { es3: true });
      const veilProgram = link(gl, OUT_VS, VEIL_FS);
      state = {
        gl,
        dev,
        program,
        outProgram,
        outBuf: gl.createBuffer(),
        outPos: gl.getAttribLocation(outProgram, "position"),
        outPx: gl.getAttribLocation(outProgram, "pixel"),
        outPlate: gl.getUniformLocation(outProgram, "uPlate"),
        outPlateColor: gl.getUniformLocation(outProgram, "uPlateColor"),
        outFill: gl.getUniformLocation(outProgram, "uFill"),
        outStroke: gl.getUniformLocation(outProgram, "uStroke"),
        outCount: gl.getUniformLocation(outProgram, "uCount"),
        outCutCount: gl.getUniformLocation(outProgram, "uCutCount"),
        outCut: gl.getUniformLocation(outProgram, "uCut[0]"),
        outJack: gl.getUniformLocation(outProgram, "uJack[0]"),
        outJackColor: gl.getUniformLocation(outProgram, "uJackColor[0]"),
        outCamPixel: gl.getUniformLocation(outProgram, "uPixel"),
        outCamCam: gl.getUniformLocation(outProgram, "uCam"),
        outCamVp: gl.getUniformLocation(outProgram, "uVp"),
        outCamDevice: gl.getUniformLocation(outProgram, "uDevice"),
        veilProgram,
        veilPos: veilProgram ? gl.getAttribLocation(veilProgram, "position") : -1,
        veilPx: veilProgram ? gl.getAttribLocation(veilProgram, "pixel") : -1,
        veilRect: veilProgram ? gl.getUniformLocation(veilProgram, "uRect") : null,
        veilPeriod: veilProgram ? gl.getUniformLocation(veilProgram, "uPeriod") : null,
        veilCamPixel: veilProgram ? gl.getUniformLocation(veilProgram, "uPixel") : null,
        veilCamCam: veilProgram ? gl.getUniformLocation(veilProgram, "uCam") : null,
        veilCamVp: veilProgram ? gl.getUniformLocation(veilProgram, "uVp") : null,
        veilCamDevice: veilProgram ? gl.getUniformLocation(veilProgram, "uDevice") : null,
        buf: gl.createBuffer(),
        attribs: ["position", "local", "segLen", "halfPx", "feather", "caps", "colour"].map((n) => gl.getAttribLocation(program, n)),
        coverage: gl.getUniformLocation(program, "uCoverage"),
        camPixel: gl.getUniformLocation(program, "uPixel"),
        camCam: gl.getUniformLocation(program, "uCam"),
        camVp: gl.getUniformLocation(program, "uVp"),
        camDevice: gl.getUniformLocation(program, "uDevice"),
        lineDash: gl.getUniformLocation(program, "uDash"),
        imgProgram,
        imgBuf: gl.createBuffer(),
        imgTex: gl.createTexture(),
        imgAttribs: ["position", "uv", "vtint"].map((n) => gl.getAttribLocation(imgProgram, n)),
        // Cached textures for static image sources ({ cache: true }), keyed by source.
        texCache: new WeakMap(),
        tpool: [],
        imgTexLoc: gl.getUniformLocation(imgProgram, "tex"),
        imgAlphaLoc: gl.getUniformLocation(imgProgram, "alpha"),
        imgTintLoc: gl.getUniformLocation(imgProgram, "tint"),
        imgModeLoc: gl.getUniformLocation(imgProgram, "mode"),
        imgCamPixel: gl.getUniformLocation(imgProgram, "uPixel"),
        imgCamCam: gl.getUniformLocation(imgProgram, "uCam"),
        imgCamVp: gl.getUniformLocation(imgProgram, "uVp"),
        imgCamDevice: gl.getUniformLocation(imgProgram, "uDevice"),
        atlases: new Map(),
        // Colour emoji: pages [{ texture, x, y, rowH }], entries "emoji|px".
        emoji: { pages: [], entries: new Map(), canvas: null, ctx: null },
        pool: [],
      };
      return state;
    } catch (error) {
      failedGl = gl;
      state = null;
      // Error fields are not enumerable; log the info-log text itself.
      console.error("[gl-line-renderer] shader failed; faces show black: " + String(error?.message || error));
      return null;
    }
  }

  /**
   * Start a frame for a face canvas (device px, y down).
   * options: { scale } -> coordinates in CSS px; { publishNodeId } -> force the
   * node id used for the rgba picture out (default: the canvas's .dsp-node).
   * @returns {object|null} batch, or null -> caller fills black.
   */
  function nodeGraphGlLinesBegin(canvas, clearRgba = [0, 0, 0, 1], options = {}) {
    if (!canvas) return null;
    const w = Math.max(1, canvas.width | 0);
    const h = Math.max(1, canvas.height | 0);
    if (w > MAX_DIM || h > MAX_DIM) return null;
    const s = ensure();
    if (!s) return null;
    const scale = Number(options?.scale) > 0 ? Number(options.scale) : 1;
    return {
      s, canvas, w, h, clear: clearRgba, data: s.pool.pop() || new Float32Array(16384), n: 0, images: [], texts: [], blend: "alpha", scale,
      // Glyph quads for every text call: pos2 uv2 rgba4 per vertex, one draw per atlas run.
      tdata: s.tpool.pop() || new Float32Array(4096), tn: 0,
      publishNodeId: options?.publishNodeId,
      outlines: [],
      veils: [],
      // Quads drawn after the plate fill (slider wells, keys) so the fill
      // does not cover them. Text still draws after these.
      over: null,
      on: 0,
      _over: false,
      gdata: null,
      gn: 0,
      _glow: false,
      // transparent: overlay faces; the 2D blit target is cleared first.
      transparent: options?.transparent === true,
      // Blit over the 2D canvas instead of clearing it first.
      keep: options?.keep === true,
      // World-pixel camera. Positions stay in CSS px; the vertex shader applies pan/zoom.
      camera: options?.camera || null,
      // Keep the vertex arrays so a later camera change can redraw without rebuilding them.
      keepMesh: options?.keepMesh === true,
    };
  }

  function bindCam(gl, locs, batch) {
    if (!locs || locs.pixel == null) return;
    const cam = batch?.camera;
    if (!cam) {
      gl.uniform1f(locs.pixel, 0);
      return;
    }
    gl.uniform1f(locs.pixel, 1);
    gl.uniform3f(locs.cam, cam.x || 0, cam.y || 0, cam.zoom > 0 ? cam.zoom : 1);
    gl.uniform2f(locs.vp, batch.w, batch.h);
    gl.uniform1f(locs.device, batch.scale > 0 ? batch.scale : 1);
  }

  function lineCamLocs(s) {
    return { pixel: s.camPixel, cam: s.camCam, vp: s.camVp, device: s.camDevice };
  }

  function push(batch, x, y, lu, lv, len, half, feather, c, caps) {
    // Vertices go straight into a pooled Float32Array (no per-frame JS arrays).
    const glow = batch._glow === true;
    const over = !glow && batch._over === true;
    let d = glow ? batch.gdata : (over ? batch.over : batch.data);
    let i = glow ? batch.gn : (over ? batch.on : batch.n);
    if (!d) d = new Float32Array(4096);
    if (i + FLOATS > d.length) {
      const grown = new Float32Array(d.length * 2);
      grown.set(d);
      d = grown;
    }
    if (batch.camera) {
      d[i] = x; d[i + 1] = y;
    } else {
      d[i] = (x / batch.w) * 2 - 1; d[i + 1] = 1 - (y / batch.h) * 2;
    }
    d[i + 2] = lu; d[i + 3] = lv; d[i + 4] = len; d[i + 5] = half; d[i + 6] = feather;
    d[i + 7] = caps || 0;
    d[i + 8] = c[0]; d[i + 9] = c[1]; d[i + 10] = c[2]; d[i + 11] = c.length > 3 ? c[3] : 1;
    if (glow) {
      batch.gdata = d;
      batch.gn = i + FLOATS;
    } else if (over) {
      batch.over = d;
      batch.on = i + FLOATS;
    } else {
      batch.data = d;
      batch.n = i + FLOATS;
    }
  }

  /** Solid axis-aligned rect. */
  function nodeGraphGlLinesRect(batch, x, y, w, h, rgba) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    if (k !== 1) { x *= k; y *= k; w *= k; h *= k; }
    const big = 1e6;
    const q = [[x, y], [x + w, y], [x, y + h], [x + w, y], [x + w, y + h], [x, y + h]];
    for (const [px, py] of q) push(batch, px, py, 0, 0, 0, big, 0, rgba);
  }

  /** Solid triangle (fills, areas). */
  function nodeGraphGlLinesTriangle(batch, x0, y0, x1, y1, x2, y2, rgba) {
    if (!batch) return;
    const k = batch.scale || 1;
    const big = 1e6;
    push(batch, x0 * k, y0 * k, 0, 0, 0, big, 0, rgba);
    push(batch, x1 * k, y1 * k, 0, 0, 0, big, 0, rgba);
    push(batch, x2 * k, y2 * k, 0, 0, 0, big, 0, rgba);
  }

  /** Solid area between a polyline [x0,y0,x1,y1,...] and the horizontal line y = baseY. */
  function nodeGraphGlLinesFillUnder(batch, points, baseY, rgba) {
    if (!batch || !points || points.length < 4) return;
    for (let i = 2; i < points.length; i += 2) {
      const x0 = points[i - 2]; const y0 = points[i - 1];
      const x1 = points[i]; const y1 = points[i + 1];
      nodeGraphGlLinesTriangle(batch, x0, y0, x1, y1, x0, baseY, rgba);
      nodeGraphGlLinesTriangle(batch, x1, y1, x1, baseY, x0, baseY, rgba);
    }
  }

  // Keep the stroke quad inside the canvas. A zoomed segment whose ends are
  // far offscreen becomes a huge quad, and the GPU drops the whole primitive
  // even when the middle crosses the view.
  function clipLineToRect(x0, y0, x1, y1, minX, minY, maxX, maxY) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let u0 = 0;
    let u1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
    for (let i = 0; i < 4; i += 1) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > u1) return null;
          if (t > u0) u0 = t;
        } else {
          if (t < u0) return null;
          if (t < u1) u1 = t;
        }
      }
    }
    return [x0 + u0 * dx, y0 + u0 * dy, x0 + u1 * dx, y0 + u1 * dy];
  }

  /**
   * Capsule segment (x0,y0)-(x1,y1): solid core halfPx, then `feather` px of
   * smootherstep fade. Round ends/joins.
   */
  function nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba, caps) {
    if (!batch) return;
    const square = caps === "square" || caps === 1;
    if (batch.camera && (square || !(Math.hypot(x1 - x0, y1 - y0) > 1e-4))) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const ux = len > 1e-6 ? dx / len : 1;
      const uy = len > 1e-6 ? dy / len : 0;
      const nx = -uy;
      const ny = ux;
      const half = Math.max(0, halfPx);
      const fade = Math.max(0, feather);
      if (!(len > 1e-4)) {
        const corner = (sx, sy) => [x0, y0, sx, sy];
        const quad = [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        for (let i = 0; i < quad.length; i += 1) {
          const v = quad[i];
          push(batch, v[0], v[1], v[2], v[3], 0, half, fade, rgba, 4);
        }
        return;
      }
      const end = (x, y, side) => push(batch, x, y, nx, ny, 0, half, fade, rgba, side > 0 ? 3 : 3.5);
      end(x0, y0, 1); end(x0, y0, -1); end(x1, y1, 1);
      end(x0, y0, -1); end(x1, y1, -1); end(x1, y1, 1);
      return;
    }
    const k = batch.camera ? 1 : (batch.scale || 1);
    if (k !== 1) { x0 *= k; y0 *= k; x1 *= k; y1 *= k; halfPx *= k; feather *= k; }
    const reach = Math.max(0, halfPx) + Math.max(0, feather) + 4;
    const clipped = clipLineToRect(
      x0, y0, x1, y1,
      -reach, -reach, batch.w + reach, batch.h + reach,
    );
    if (!clipped) return;
    x0 = clipped[0];
    y0 = clipped[1];
    x1 = clipped[2];
    y1 = clipped[3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const ux = len > 1e-6 ? dx / len : 0;
    const uy = len > 1e-6 ? dy / len : 1;
    const nx = -uy;
    const ny = ux;
    const r = Math.max(0, halfPx) + Math.max(0, feather);
    const alongPad = square ? 0 : r;
    const capFlag = square ? 1 : 0;
    const corner = (along, across) => [
      x0 + ux * along + nx * across,
      y0 + uy * along + ny * across,
      along,
      across,
    ];
    const a = corner(-alongPad, -r);
    const b = corner(len + alongPad, -r);
    const c = corner(-alongPad, r);
    const d = corner(len + alongPad, r);
    for (const v of [a, b, c, b, d, c]) push(batch, v[0], v[1], v[2], v[3], len, halfPx, feather, rgba, capFlag);
  }

  /**
   * Analytic ring (distance field, no segments): circle of radius r centred at
   * (x,y), solid core halfPx either side of r, then `feather` px of smootherstep
   * fade - the same edge as nodeGraphGlLinesSegment / nodeGraphGlLinesDot.
   */
  function nodeGraphGlLinesRing(batch, x, y, r, halfPx, feather, rgba) {
    if (!batch) return;
    let R = Math.max(0, r);
    let half = Math.max(0, halfPx);
    let fade = Math.max(0, feather);
    if (!batch.camera) {
      const k = batch.scale || 1;
      if (k !== 1) { x *= k; y *= k; R *= k; half *= k; fade *= k; }
    }
    const e = R + half + fade + 1;
    const corner = (sx, sy) => [x + sx * e, y + sy * e, sx * e, sy * e];
    const quad = [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let i = 0; i < quad.length; i += 1) {
      const v = quad[i];
      push(batch, v[0], v[1], v[2], v[3], R, half, fade, rgba, 10);
    }
  }

  /** Round dot (zero-length capsule) of radius r. */
  function nodeGraphGlLinesDot(batch, x, y, r, feather, rgba) {
    nodeGraphGlLinesSegment(batch, x, y, x, y, r, feather, rgba);
  }

  /**
   * Instanced Pulse Train stems + dots. The vertex shader evaluates the same
   * E_k schedule as pulse_train.cpp (t_i = End * E_curve(u_i)) from
   * gl_InstanceID, so Count can be 16384 without a CPU vertex per pulse.
   * spec: count, duration (Time s), axisEnd (x-axis s), curve, spacing, ampStart,
   * ampEnd, ampCurve, amplitude, loop, x0, x1, base, top, peak, halfPx,
   * feather, dotR, elapsed (NaN idle), fadeTau (s, 0 = hold), line/dot/lit rgba.
   */
  function nodeGraphGlLinesPulseTrain(batch, spec) {
    if (!batch || !spec) return;
    const nFwd = Math.max(0, Math.min(PULSE_TRAIN_MAX, spec.count | 0));
    const total = Math.max(nFwd, Math.min(PULSE_TRAIN_MAX, spec.total | 0 || nFwd));
    const pulseMode = Number(spec.pulseMode);
    const p = !(pulseMode > 0) ? 0 : (pulseMode >= 1 ? 1 : pulseMode);
    const polarity = Number(spec.polarity) > 0.5 ? 1 : 0;
    const n = p > 0 ? total : nFwd;
    if (!(n > 0)) return;
    if (!batch.pulseTrains) batch.pulseTrains = [];
    const k = batch.camera ? 1 : (batch.scale || 1);
    const rgba = (c) => {
      const a = c && c.length > 3 ? c[3] : 1;
      return [c?.[0] || 0, c?.[1] || 0, c?.[2] || 0, Number.isFinite(a) ? a : 1];
    };
    batch.pulseTrains.push({
      count: n,
      nFwd: nFwd,
      pulseMode: p,
      polarity,
      duration: Number(spec.duration) || 0,
      axisEnd: Math.max(1e-6, Number(spec.axisEnd) || 0.001),
      curve: Number(spec.curve) || 0,
      spacing: Number(spec.spacing) || 0,
      ampStart: Number(spec.ampStart) || 0,
      ampEnd: Number(spec.ampEnd) || 0,
      ampCurve: Number(spec.ampCurve) || 0,
      amplitude: Number(spec.amplitude) || 0,
      loop: spec.loop ? 1 : 0,
      x0: (Number(spec.x0) || 0) * k,
      x1: (Number(spec.x1) || 0) * k,
      base: (Number(spec.base) || 0) * k,
      top: (Number(spec.top) || 0) * k,
      peak: Math.max(1e-12, Number(spec.peak) || 1),
      half: Math.max(0, Number(spec.halfPx) || 0) * k,
      feather: Math.max(0, Number(spec.feather) || 0) * k,
      dotR: Math.max(0, Number(spec.dotR) || 0) * k,
      elapsed: Number.isFinite(spec.elapsed) ? spec.elapsed : -1,
      fadeTau: Math.max(0, Number(spec.fadeTau) || 0),
      line: rgba(spec.line),
      dot: rgba(spec.dot),
      lit: rgba(spec.lit),
    });
  }

  /**
   * Polyline: the app-wide antialiased line. Default (round) is one joined
   * strip (nodeGraphGlLinesRibbon), so joints never double-blend; `feather` is
   * the soft edge (pass ~1 device px). caps "butt" ends each segment flat.
   * caps "ortho" is for axis-aligned traces: at each corner the segment runs
   * to the far edge of the crossing stroke, so the corner square is covered
   * by overlap. No diagonal.
   */
  function nodeGraphGlLinesPolyline(batch, points, halfPx, feather, rgba, caps) {
    if (!batch || !points || points.length < 4) return;
    const square = caps === "square" || caps === "butt" || caps === "ortho" || caps === 1;
    const ortho = caps === "ortho";
    if (!square) {
      const joined = [points[0], points[1]];
      for (let i = 2; i < points.length; i += 2) {
        if (points[i] === joined[joined.length - 2] && points[i + 1] === joined[joined.length - 1]) continue;
        joined.push(points[i], points[i + 1]);
      }
      if (joined.length >= 4) nodeGraphGlLinesRibbon(batch, joined, halfPx, feather, rgba);
      return;
    }
    const reachScale = batch.camera ? (batch.camera.zoom > 0 ? batch.camera.zoom : 1) : 1;
    const reach = (Math.max(0, halfPx) + Math.max(0, feather)) / reachScale;
    const segs = [];
    for (let i = 2; i < points.length; i += 2) {
      const x0 = points[i - 2];
      const y0 = points[i - 1];
      const x1 = points[i];
      const y1 = points[i + 1];
      if (x0 === x1 && y0 === y1) continue;
      segs.push({ x0, y0, x1, y1 });
    }
    for (let s = 0; s < segs.length; s += 1) {
      let { x0, y0, x1, y1 } = segs[s];
      if (ortho) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        if (s > 0) { x0 -= ux * reach; y0 -= uy * reach; }
        if (s < segs.length - 1) { x1 += ux * reach; y1 += uy * reach; }
      }
      nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba, square ? 1 : 0);
    }
  }

  // One continuous ribbon. Neighboring pieces share the edge points, so a bend
  // has no end cap and no gap. `across` is the distance from the centerline.
  // Solid rgba. dip > 0: per-vertex darkening of RGB around the middle of the
  // arc length (cosine bell over half-width dipWidth / 2), alpha unchanged.
  function nodeGraphGlLinesRibbon(batch, points, halfPx, feather, rgba, dip = 0, dipWidth = 0.5) {
    if (!batch || !points || points.length < 4) return;
    // Dip: colour is per vertex, so subdivide the polyline (straight
    // splits, shape unchanged) until there are >= ~128 vertices along it,
    // enough for the dip bell to read smooth.
    const hw = dipWidth / 2;
    const dipping = dip > 0 && hw > 0;
    if (dipping && points.length / 2 < 128) {
      const segs = points.length / 2 - 1;
      const sub = Math.ceil(128 / segs);
      const dense = [];
      for (let i = 0; i < segs; i += 1) {
        const ax = points[i * 2]; const ay = points[i * 2 + 1];
        const bx = points[i * 2 + 2]; const by = points[i * 2 + 3];
        for (let j = 0; j < sub; j += 1) {
          const f = j / sub;
          dense.push(ax + (bx - ax) * f, ay + (by - ay) * f);
        }
      }
      dense.push(points[points.length - 2], points[points.length - 1]);
      points = dense;
    }
    const k = batch.camera ? 1 : (batch.scale || 1);
    const r = Math.max(0, halfPx) + Math.max(0, feather);
    const count = points.length / 2;
    const dirX = new Float32Array(count);
    const dirY = new Float32Array(count);
    for (let i = 0; i < count - 1; i += 1) {
      let dx = points[(i + 1) * 2] - points[i * 2];
      let dy = points[(i + 1) * 2 + 1] - points[i * 2 + 1];
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) { dirX[i] = 1; dirY[i] = 0; continue; }
      dirX[i] = dx / len;
      dirY[i] = dy / len;
    }
    dirX[count - 1] = dirX[count - 2] || 1;
    dirY[count - 1] = dirY[count - 2] || 0;
    const miter = (index) => {
      const ax = index === 0 ? dirX[0] : dirX[index - 1];
      const ay = index === 0 ? dirY[0] : dirY[index - 1];
      const bx = dirX[Math.min(index, count - 2)];
      const by = dirY[Math.min(index, count - 2)];
      const n0x = -ay;
      const n0y = ax;
      const n1x = -by;
      const n1y = bx;
      let nx = n0x + n1x;
      let ny = n0y + n1y;
      const nl = Math.hypot(nx, ny);
      if (!(nl > 1e-4)) return [n0x, n0y];
      nx /= nl;
      ny /= nl;
      const dot = nx * n0x + ny * n0y;
      const scale = dot > 0.35 ? 1 / dot : 1 / 0.35;
      return [nx * scale, ny * scale];
    };
    const edge = [];
    for (let i = 0; i < count; i += 1) edge.push(miter(i));
    let ink = null;
    if (dipping) {
      const arc = new Float32Array(count);
      for (let i = 1; i < count; i += 1) {
        arc[i] = arc[i - 1] + Math.hypot(points[i * 2] - points[(i - 1) * 2], points[i * 2 + 1] - points[(i - 1) * 2 + 1]);
      }
      const total = arc[count - 1] > 0 ? arc[count - 1] : 1;
      ink = [];
      for (let i = 0; i < count; i += 1) {
        const d = Math.abs(arc[i] / total - 0.5) / hw;
        const m = d < 1 ? 1 - dip * (0.5 + 0.5 * Math.cos(Math.PI * d)) : 1;
        ink.push([(rgba[0] ?? 1) * m, (rgba[1] ?? 1) * m, (rgba[2] ?? 1) * m, rgba[3] ?? 1]);
      }
    }
    for (let i = 0; i < count - 1; i += 1) {
      const x0 = points[i * 2] * k;
      const y0 = points[i * 2 + 1] * k;
      const x1 = points[(i + 1) * 2] * k;
      const y1 = points[(i + 1) * 2 + 1] * k;
      if (x0 === x1 && y0 === y1) continue;
      const n0 = edge[i];
      const n1 = edge[i + 1];
      const half = Math.max(0, halfPx) * (batch.camera ? 1 : k);
      const fade = Math.max(0, feather) * (batch.camera ? 1 : k);
      if (batch.camera) {
        const c0 = ink ? ink[i] : rgba;
        const c1 = ink ? ink[i + 1] : rgba;
        const end = (x, y, n, side, c) => push(batch, x, y, n[0], n[1], 0, half, fade, c, side > 0 ? 3 : 3.5);
        end(x0, y0, n0, 1, c0); end(x0, y0, n0, -1, c0); end(x1, y1, n1, 1, c1);
        end(x0, y0, n0, -1, c0); end(x1, y1, n1, -1, c1); end(x1, y1, n1, 1, c1);
        continue;
      }
      const rk = r * k;
      const quad = [
        [x0 + n0[0] * rk, y0 + n0[1] * rk, rk],
        [x0 - n0[0] * rk, y0 - n0[1] * rk, -rk],
        [x1 + n1[0] * rk, y1 + n1[1] * rk, rk],
        [x1 - n1[0] * rk, y1 - n1[1] * rk, -rk],
      ];
      const tri = [0, 1, 2, 1, 3, 2];
      for (let t = 0; t < tri.length; t += 1) {
        const v = quad[tri[t]];
        push(batch, v[0], v[1], 0, v[2], 0, half, fade, ink ? ink[tri[t] < 2 ? i : i + 1] : rgba, 1);
      }
    }
  }

  // Dashed round stroke. One quad per segment; the fragment shader cuts the
  // dashes and their round caps from arc length. halfWorld is zoom-1 px.
  // on/off are zoom-1 px along the curve. Zoom only changes uCam.
  function nodeGraphGlLinesDash(batch, points, halfWorld, on, off, rgba) {
    if (!batch || !points || points.length < 4) return;
    const half = Math.max(0.25, Number(halfWorld) || 0);
    const count = points.length / 2;
    const arc = new Float32Array(count);
    const dirX = new Float32Array(Math.max(1, count - 1));
    const dirY = new Float32Array(Math.max(1, count - 1));
    for (let i = 0; i < count - 1; i += 1) {
      const dx = points[(i + 1) * 2] - points[i * 2];
      const dy = points[(i + 1) * 2 + 1] - points[i * 2 + 1];
      const len = Math.hypot(dx, dy);
      arc[i + 1] = arc[i] + (len > 0 ? len : 0);
      if (len > 1e-6) {
        dirX[i] = dx / len;
        dirY[i] = dy / len;
      } else {
        dirX[i] = i > 0 ? dirX[i - 1] : 1;
        dirY[i] = i > 0 ? dirY[i - 1] : 0;
      }
    }
    const total = arc[count - 1];
    if (!(total > 0)) return;
    batch.dashOn = Math.max(0.5, Number(on) || 0);
    batch.dashOff = Math.max(0, Number(off) || 0);
    for (let i = 0; i < count - 1; i += 1) {
      if (!(arc[i + 1] > arc[i])) continue;
      const x0 = points[i * 2];
      const y0 = points[i * 2 + 1];
      const x1 = points[(i + 1) * 2];
      const y1 = points[(i + 1) * 2 + 1];
      const tx = dirX[i];
      const ty = dirY[i];
      const s0 = arc[i] - half;
      const s1 = arc[i + 1] + half;
      const vert = (x, y, arcBase, capsId) => push(batch, x, y, tx, ty, arcBase, half, total, rgba, capsId);
      vert(x0, y0, s0, 6);
      vert(x0, y0, s0, 8);
      vert(x1, y1, s1, 7);
      vert(x0, y0, s0, 8);
      vert(x1, y1, s1, 9);
      vert(x1, y1, s1, 7);
    }
  }

  // Woscope-style beam. Each segment is its own rectangle and the glow overlaps
  // on purpose. Drawn into the additive glow pass.
  function nodeGraphGlLinesPhosphor(batch, points, sigma, rgba) {
    if (!batch || !points || points.length < 4 || !(sigma > 0)) return;
    const prev = batch._glow;
    batch._glow = true;
    const k = batch.scale || 1;
    const sig = sigma * k;
    const reach = sig * 4;
    for (let i = 2; i < points.length; i += 2) {
      let x0 = points[i - 2] * k;
      let y0 = points[i - 1] * k;
      let x1 = points[i] * k;
      let y1 = points[i + 1] * k;
      let dx = x1 - x0;
      let dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const corner = (along, across) => [
        x0 + ux * along + nx * across,
        y0 + uy * along + ny * across,
        along,
        across,
      ];
      const a = corner(-reach, -reach);
      const b = corner(len + reach, -reach);
      const c = corner(-reach, reach);
      const d = corner(len + reach, reach);
      for (const v of [a, b, c, b, d, c]) {
        push(batch, v[0], v[1], v[2], v[3], len, sig, 0, rgba, 2);
      }
    }
    batch._glow = prev;
  }

  /**
   * Textured quad (image blit). source: { data: Uint8Array RGBA, width, height }
   * or any TexImageSource. options: { nearest = true, alpha = 1, additive = false }. Drawn under
   * the line/rect quads, in call order.
   */
  function nodeGraphGlLinesImage(batch, source, x, y, w, h, options = {}) {
    if (!batch || !source || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    batch.images.push({
      source,
      x: x * k, y: y * k, w: w * k, h: h * k,
      nearest: options.nearest !== false,
      alpha: Number.isFinite(options.alpha) ? options.alpha : 1,
      // tint [r,g,b,a]: draw the source's alpha as coverage of this colour
      // (white masks, e.g. TraceDotSprite shape sprites).
      tint: Array.isArray(options.tint) ? options.tint : null,
      // cache: upload once per source object (static pictures / baked sprites).
      cache: options.cache === true,
      additive: options.additive === true,
    });
  }

  /**
   * Upload a source (e.g. a face canvas about to be resized) to a GL texture
   * NOW, so a later batch can draw the old pixels. Pass the result to
   * nodeGraphGlLinesImage; the texture is deleted after that batch draws it,
   * unless { keep: true } (then free it with nodeGraphGlLinesReleaseSnapshot).
   */
  function nodeGraphGlLinesSnapshot(source, options = {}) {
    const s = ensure();
    if (!s || !source) return null;
    const sw = source.naturalWidth || source.width || 0;
    const sh = source.naturalHeight || source.height || 0;
    if (!(sw > 0) || !(sh > 0)) return null;
    const gl = s.gl;
    // A face that lives on the GPU has no current 2D bitmap: copy its texture.
    const faceCopy = typeof global.nodeGraphSharedGlFaceCopyTexture === "function" && source.getContext
      ? global.nodeGraphSharedGlFaceCopyTexture(source)
      : null;
    if (faceCopy) {
      return { glSnapshot: true, keep: options?.keep === true, texture: faceCopy.texture, width: faceCopy.width, height: faceCopy.height };
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (_error) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteTexture(texture);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { glSnapshot: true, keep: options?.keep === true, texture, width: sw, height: sh };
  }

  function nodeGraphGlLinesReleaseSnapshot(snapshot) {
    if (!snapshot?.glSnapshot || !snapshot.texture) return;
    const s = ensure();
    if (s) s.gl.deleteTexture(snapshot.texture);
    snapshot.texture = null;
  }

  // ---- text atlas ---------------------------------------------------------
  function atlasKey(family, weight) {
    return `${weight}|${family}`;
  }

  function bakeAtlas(s, family, weight, chars) {
    const doc = global.document;
    if (!doc?.createElement) return null;
    const cv = doc.createElement("canvas");
    const cx = cv.getContext?.("2d");
    if (!cx || typeof cx.measureText !== "function") return null;
    const list = [...new Set([...chars])];
    const maxTex = s.gl.getParameter(s.gl.MAX_TEXTURE_SIZE) || 4096;
    const sheetW = Math.min(1024, maxTex);
    let bakePx = glyphBakePx;
    let glyphs = new Map();
    let sheetH = 0;
    let cellH = 0;
    let head = 0;
    while (bakePx >= 16) {
      const fontTry = `${weight} ${bakePx}px ${family}`;
      cx.font = fontTry;
      // Room above the em ascent for fonts whose glyphs rise higher (DSEG7 digits).
      head = 0;
      for (const ch of list) head = Math.max(head, Math.ceil((cx.measureText(ch).actualBoundingBoxAscent || 0) - bakePx * TEXT_ASCENT));
      cellH = Math.ceil(bakePx * 1.25) + head + TEXT_PAD * 2;
      glyphs = new Map();
      let x = 0;
      let y = 0;
      let fits = cellH <= maxTex;
      for (const ch of list) {
        const adv = Math.max(1, cx.measureText(ch).width || bakePx * 0.6);
        const gw = Math.ceil(adv) + TEXT_PAD * 2;
        if (gw > sheetW || y + cellH > maxTex) { fits = false; break; }
        if (x + gw > sheetW) {
          x = 0;
          y += cellH + TEXT_GUTTER;
          if (y + cellH > maxTex) { fits = false; break; }
        }
        glyphs.set(ch, { x, y, w: gw, h: cellH, adv });
        x += gw + TEXT_GUTTER;
      }
      sheetH = y + cellH;
      if (fits && sheetH <= maxTex && glyphs.size === list.length) break;
      bakePx = Math.floor(bakePx * 0.9);
    }
    if (bakePx < 16 || glyphs.size !== list.length) return null;
    if (bakePx !== glyphBakePx) glyphBakePx = bakePx;
    const font = `${weight} ${bakePx}px ${family}`;
    cv.width = sheetW;
    cv.height = sheetH;
    cx.font = font;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    cx.fillStyle = "#fff";
    cx.clearRect(0, 0, sheetW, sheetH);
    for (const [ch, g] of glyphs) {
      cx.fillText(ch, g.x + TEXT_PAD, g.y + TEXT_PAD + head + bakePx * TEXT_ASCENT);
    }
    const gl = s.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, glyphs, sheetW, sheetH, head: head / bakePx, chars: list.join("") };
  }

  /** Shared glyph atlas for a font (grows when new characters show up). */
  function nodeGraphGlLinesTextAtlas(family = TEXT_DEFAULT_FAMILY, weight = 600, text = "") {
    const s = ensure();
    if (!s) return null;
    const key = atlasKey(family, weight);
    let atlas = s.atlases.get(key);
    const missing = [...String(text)].filter((ch) => !atlas?.glyphs.has(ch));
    if (!atlas || missing.length) {
      const next = bakeAtlas(s, family, weight, (atlas?.chars || TEXT_BASE_CHARS) + missing.join(""));
      if (!next) return null;
      // This frame's text runs already stored the old texture. Delete it
      // after drawTexts, not while those runs are still queued.
      if (atlas?.texture) {
        if (!s.deadTextures) s.deadTextures = [];
        s.deadTextures.push(atlas.texture);
      }
      atlas = next;
      s.atlases.set(key, atlas);
    }
    return atlas;
  }

  // ---- colour emoji ---------------------------------------------------------
  /**
   * Grapheme segments of `text`: frozen [{ text, emoji }]. Cached per string,
   * so a steady face re-uses the same array (no per-frame allocation).
   */
  function nodeGraphGlLinesTextSegments(text) {
    const str = String(text ?? "");
    let segs = segmentCache.get(str);
    if (segs) return segs;
    emojiStats.segmentMisses += 1;
    const out = [];
    const Seg = global.Intl?.Segmenter;
    const clusters = Seg
      ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(str), (x) => x.segment)
      : (str.match(/\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|[#*0-9])(?:\u{FE0F}|\u{20E3}|\p{Emoji_Modifier})*(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})*)*|[\s\S]/gu) || []);
    let plain = "";
    for (const c of clusters) {
      // Emoji presentation only: default-text symbols (©, ™, ↔, bare ❤, digits)
      // stay coverage glyphs unless a VS16 / keycap / ZWJ / flag asks for colour.
      const isEmoji = EMOJI_CLUSTER.test(c) && EMOJI_PRESENTATION.test(c);
      if (isEmoji) {
        if (plain) { out.push(Object.freeze({ text: plain, emoji: false })); plain = ""; }
        out.push(Object.freeze({ text: c, emoji: true }));
      } else {
        plain += c;
      }
    }
    if (plain) out.push(Object.freeze({ text: plain, emoji: false }));
    segs = Object.freeze(out);
    if (segmentCache.size >= SEGMENT_CACHE_MAX) segmentCache.clear();
    segmentCache.set(str, segs);
    return segs;
  }

  function emojiRaster(s) {
    const e = s.emoji;
    if (e.ctx) return e.ctx;
    const doc = global.document;
    const cv = doc?.createElement?.("canvas");
    const cx = cv?.getContext?.("2d", { willReadFrequently: false });
    if (!cx) return null;
    e.canvas = cv;
    e.ctx = cx;
    return cx;
  }

  function emojiPage(s, w, h) {
    if (!(w > 0) || !(h > 0) || w > EMOJI_SHEET || h > EMOJI_SHEET) return null;
    const e = s.emoji;
    const gl = s.gl;
    let page = e.pages[e.pages.length - 1];
    if (page) {
      if (page.x + w > EMOJI_SHEET) { page.x = 0; page.y += page.rowH; page.rowH = 0; }
      if (page.x + w <= EMOJI_SHEET && page.y + h <= EMOJI_SHEET) return page;
    }
    if (e.pages.length >= EMOJI_MAX_PAGES || w > EMOJI_SHEET || h > EMOJI_SHEET) return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, EMOJI_SHEET, EMOJI_SHEET, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // Exact-size bake drawn 1:1; zoom pixelates (display policy), never smooths.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    page = { texture, x: 0, y: 0, rowH: 0 };
    e.pages.push(page);
    emojiStats.pages = e.pages.length;
    return page;
  }

  /**
   * Colour atlas entry for one emoji at base size `px` (integer device px).
   * Baked once; the same key is never rasterized again.
   */
  function emojiEntry(s, emoji, px) {
    const e = s.emoji;
    // Two-level lookup (emoji -> base px) so a cache hit builds no key string.
    let bySize = e.entries.get(emoji);
    let entry = bySize?.get(px);
    if (entry !== undefined) return entry;
    if (!bySize) { bySize = new Map(); e.entries.set(emoji, bySize); }
    if (px < 4) {
      // Unlaid-out / sub-legible box: advance only, never a texture bake.
      entry = Object.freeze({ page: null, adv: px, px, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
      bySize.set(px, entry);
      return entry;
    }
    const cx = emojiRaster(s);
    if (!cx) return null;
    cx.font = `${px}px ${EMOJI_FAMILY}`;
    const adv = Math.max(1, cx.measureText(emoji).width || px);
    const w = Math.ceil(adv) + EMOJI_PAD * 2;
    // Extra headroom: colour emoji draw above the em box and were clipped.
    const head = Math.ceil(px * 0.45);
    const h = Math.ceil(px * 1.25) + EMOJI_PAD * 2 + head;
    const page = emojiPage(s, w, h);
    if (!page) {
      // Atlas full: keep the advance, draw nothing (cached, so no retry loop).
      emojiStats.dropped += 1;
      entry = Object.freeze({ page: null, adv, px, w, h, u0: 0, v0: 0, u1: 0, v1: 0 });
      bySize.set(px, entry);
      return entry;
    }
    const cv = e.canvas;
    if (cv.width < w || cv.height < h) {
      cv.width = Math.max(cv.width, w);
      cv.height = Math.max(cv.height, h);
    }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.font = `${px}px ${EMOJI_FAMILY}`;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    cx.fillStyle = "#000";
    cx.fillText(emoji, EMOJI_PAD, EMOJI_PAD + head + px * TEXT_ASCENT);
    const gl = s.gl;
    const pixels = cx.getImageData(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, page.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, page.x, page.y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    emojiStats.bakes += 1;
    emojiStats.uploads += 1;
    entry = Object.freeze({
      page, adv, px, w, h,
      u0: page.x / EMOJI_SHEET, v0: page.y / EMOJI_SHEET,
      u1: (page.x + w) / EMOJI_SHEET, v1: (page.y + h) / EMOJI_SHEET,
    });
    page.x += w;
    page.rowH = Math.max(page.rowH, h);
    bySize.set(px, entry);
    emojiStats.entries += 1;
    return entry;
  }

  /** Base bake size: drawn px in face-backing device px, rounded. */
  function emojiBasePx(devicePx) {
    return Math.max(1, Math.round(devicePx));
  }

  /** Counters for smokes / GPU checks (bakes never move at steady state or on zoom). */
  function nodeGraphGlLinesEmojiStats() {
    const keys = [];
    if (state) for (const [emoji, bySize] of state.emoji.entries) for (const px of bySize.keys()) keys.push(`${emoji}|${px}`);
    return { ...emojiStats, keys };
  }

  /** Width of `text` at `px` (same units as the batch coordinates). */
  function nodeGraphGlLinesMeasureText(text, px, family = TEXT_DEFAULT_FAMILY, weight = 600) {
    const str = String(text ?? "");
    const atlas = nodeGraphGlLinesTextAtlas(family, weight, str);
    if (!atlas) return str.length * px * 0.6;
    const g = px / glyphBakePx;
    if (!EMOJI_HINT.test(str)) {
      let adv = 0;
      for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
      return adv * g;
    }
    let width = 0;
    for (const seg of nodeGraphGlLinesTextSegments(str)) {
      if (seg.emoji) {
        const entry = emojiEntry(state, seg.text, emojiBasePx(px));
        width += entry ? entry.adv * (px / entry.px) : px;
      } else {
        for (const ch of seg.text) width += (atlas.glyphs.get(ch)?.adv || 0) * g;
      }
    }
    return width;
  }

  /**
   * Text at (x, y). options: { px = 12, rgba = white, align = "center"
   * (left|center|right), baseline = "middle" (top|middle|alphabetic|bottom),
   * maxWidth (squeeze horizontally like canvas fillText), family, weight }.
   * Drawn over the quads.
   */
  function nodeGraphGlLinesText(batch, text, x, y, options = {}) {
    const str = String(text ?? "");
    if (!batch || !str) return;
    const family = options.family || TEXT_DEFAULT_FAMILY;
    const weight = options.weight || 600;
    const atlas = nodeGraphGlLinesTextAtlas(family, weight, str);
    if (!atlas) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    const px = Math.max(1, Math.round((Number(options.px) || 12) * k));
    const g = px / glyphBakePx;
    const segs = EMOJI_HINT.test(str) ? nodeGraphGlLinesTextSegments(str) : null;
    let hasEmoji = false;
    if (segs) for (let i = 0; i < segs.length; i += 1) if (segs[i].emoji) { hasEmoji = true; break; }
    const emojiPx = options.emojiPx != null ? emojiBasePx(options.emojiPx) : emojiBasePx(px);
    const emojiScale = options.emojiPx != null ? px / Math.max(1, emojiPx) : 1;
    let width = 0;
    if (hasEmoji) {
      for (const seg of segs) {
        if (seg.emoji) width += (emojiEntry(batch.s, seg.text, emojiPx)?.adv || 0) * emojiScale;
        else for (const ch of seg.text) width += (atlas.glyphs.get(ch)?.adv || 0) * g;
      }
    } else {
      let adv = 0;
      for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
      width = adv * g;
    }
    let squeeze = 1;
    const maxW = Number(options.maxWidth) * k;
    // Too wide for maxWidth: shrink the whole run uniformly (x and y), never
    // squeeze glyphs horizontally — controls keep their proportions.
    if (maxW > 0 && width > maxW) { squeeze = maxW / width; width = maxW; }
    const gy = g * squeeze;
    const pxRun = px * squeeze;
    const align = options.align || "center";
    const base = options.baseline || "middle";
    let pen = Math.round(x * k - (align === "center" ? width * 0.5 : (align === "right" ? width : 0)));
    let baseline = Math.round(y * k);
    if (base === "middle") baseline += pxRun * (TEXT_ASCENT - 0.5);
    else if (base === "top") baseline += pxRun * TEXT_ASCENT;
    else if (base === "bottom") baseline -= pxRun * (1 - TEXT_ASCENT);
    const sx = g * squeeze;
    const c = options.rgba || TEXT_WHITE;
    const cr = c[0]; const cg = c[1]; const cb = c[2]; const ca = c.length > 3 ? c[3] : 1;
    if (!hasEmoji) {
      pen = pushGlyphs(batch, atlas, str, pen, baseline, gy, sx, cr, cg, cb, ca);
      return;
    }
    for (const seg of segs) {
      if (!seg.emoji) {
        pen = pushGlyphs(batch, atlas, seg.text, pen, baseline, gy, sx, cr, cg, cb, ca);
        continue;
      }
      const entry = emojiEntry(batch.s, seg.text, emojiPx);
      if (!entry) continue;
      if (entry.page) {
        // 1:1 device px (squeezed only by maxWidth); colour is the bake, tint alpha only.
        const run = textRun(batch, entry.page.texture, true);
        // Whole device px so NEAREST samples the bake texel-for-pixel.
        const x0 = Math.round(pen - EMOJI_PAD * squeeze * emojiScale);
        const y0 = Math.round(baseline - (EMOJI_PAD + Math.ceil(entry.px * 0.45) + entry.px * TEXT_ASCENT) * squeeze * emojiScale);
        pushTextQuad(batch, x0, y0, x0 + entry.w * squeeze * emojiScale, y0 + entry.h * squeeze * emojiScale,
          entry.u0, entry.v0, entry.u1, entry.v1, 1, 1, 1, ca);
        run.end = batch.tn;
      }
      pen += entry.adv * squeeze * emojiScale;
    }
  }

  /** Current run for a texture (consecutive same-texture quads share one draw). */
  function textRun(batch, texture, color) {
    let run = batch.texts.length ? batch.texts[batch.texts.length - 1] : null;
    if (!run || run.texture !== texture) {
      run = { texture, color, start: batch.tn, end: batch.tn };
      batch.texts.push(run);
    }
    return run;
  }

  // Glyph aspect watch (smoke_text_aspect.mjs): x scale / y scale of every glyph quad.
  const textAspect = { quads: 0, minRatio: 1, maxRatio: 1 };
  function nodeGraphGlLinesTextAspectStats(reset = false) {
    const out = { ...textAspect };
    if (reset) { textAspect.quads = 0; textAspect.minRatio = 1; textAspect.maxRatio = 1; }
    return out;
  }

  function pushGlyphs(batch, atlas, str, pen, baseline, g, sx, cr, cg, cb, ca) {
    const ratio = sx / Math.max(1e-9, g);
    textAspect.quads += 1;
    if (ratio < textAspect.minRatio) textAspect.minRatio = ratio;
    if (ratio > textAspect.maxRatio) textAspect.maxRatio = ratio;
    const run = textRun(batch, atlas.texture, false);
    for (const ch of str) {
      const gl = atlas.glyphs.get(ch);
      if (!gl) continue;
      const x0 = Math.round(pen - TEXT_PAD * sx);
      const y0 = Math.round(baseline - (TEXT_PAD + glyphBakePx * ((atlas.head || 0) + TEXT_ASCENT)) * g);
      const x1 = Math.round(x0 + gl.w * sx);
      const y1 = Math.round(y0 + gl.h * g);
      const u0 = gl.x / atlas.sheetW; const u1 = (gl.x + gl.w) / atlas.sheetW;
      const v0 = gl.y / atlas.sheetH; const v1 = (gl.y + gl.h) / atlas.sheetH;
      pushTextQuad(batch, x0, y0, x1, y1, u0, v0, u1, v1, cr, cg, cb, ca);
      pen += gl.adv * sx;
    }
    run.end = batch.tn;
    return pen;
  }

  function pushTextVertex(d, i, x, y, u, v, r, g, b, a) {
    d[i] = x; d[i + 1] = y; d[i + 2] = u; d[i + 3] = v;
    d[i + 4] = r; d[i + 5] = g; d[i + 6] = b; d[i + 7] = a;
  }

  function pushTextQuad(batch, x0, y0, x1, y1, u0, v0, u1, v1, r, g, b, a) {
    let d = batch.tdata;
    const i = batch.tn;
    if (i + 48 > d.length) {
      const grown = new Float32Array(d.length * 2);
      grown.set(d);
      batch.tdata = d = grown;
    }
    pushTextVertex(d, i, x0, y0, u0, v0, r, g, b, a);
    pushTextVertex(d, i + 8, x1, y0, u1, v0, r, g, b, a);
    pushTextVertex(d, i + 16, x0, y1, u0, v1, r, g, b, a);
    pushTextVertex(d, i + 24, x1, y0, u1, v0, r, g, b, a);
    pushTextVertex(d, i + 32, x1, y1, u1, v1, r, g, b, a);
    pushTextVertex(d, i + 40, x0, y1, u0, v1, r, g, b, a);
    batch.tn = i + 48;
  }

  // ---- textured quad drawing ---------------------------------------------
  /** Growable per-state Float32Array (power-of-two growth; never shrinks). */
  function scratch(s, key, n) {
    let a = s[key];
    if (!a || a.length < n) {
      let cap = 1024;
      while (cap < n) cap *= 2;
      a = new Float32Array(cap);
      s[key] = a;
    }
    return a;
  }

  function drawTextured(s, w, h, verts, mode) {
    const gl = s.gl;
    const n = verts.length / 4;
    const out = scratch(s, "imgScratch", verts.length);
    const pix = s._drawBatch && s._drawBatch.camera;
    bindCam(gl, { pixel: s.imgCamPixel, cam: s.imgCamCam, vp: s.imgCamVp, device: s.imgCamDevice }, s._drawBatch);
    for (let i = 0; i < n; i += 1) {
      out[i * 4] = pix ? verts[i * 4] : (verts[i * 4] / w) * 2 - 1;
      out[i * 4 + 1] = pix ? verts[i * 4 + 1] : 1 - (verts[i * 4 + 1] / h) * 2;
      out[i * 4 + 2] = verts[i * 4 + 2];
      out[i * 4 + 3] = verts[i * 4 + 3];
    }
    gl.uniform1f(s.imgModeLoc, mode);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.imgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, verts.length), gl.STREAM_DRAW);
    const [pl, ul, tl] = s.imgAttribs;
    if (pl >= 0) { gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 16, 0); }
    if (ul >= 0) { gl.enableVertexAttribArray(ul); gl.vertexAttribPointer(ul, 2, gl.FLOAT, false, 16, 8); }
    if (tl >= 0) gl.vertexAttrib4f(tl, 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    if (pl >= 0) gl.disableVertexAttribArray(pl);
    if (ul >= 0) gl.disableVertexAttribArray(ul);
  }

  /** Tinted textured triangles: data = pos2 uv2 rgba4 per vertex (device px). */
  function drawTexturedTinted(s, w, h, data, start, end, mode = 1) {
    const gl = s.gl;
    const len = end - start;
    if (len <= 0) return;
    const out = scratch(s, "tintScratch", len);
    const pix = s._drawBatch && s._drawBatch.camera;
    bindCam(gl, { pixel: s.imgCamPixel, cam: s.imgCamCam, vp: s.imgCamVp, device: s.imgCamDevice }, s._drawBatch);
    for (let i = 0; i < len; i += 8) {
      const j = start + i;
      out[i] = pix ? data[j] : (data[j] / w) * 2 - 1;
      out[i + 1] = pix ? data[j + 1] : 1 - (data[j + 1] / h) * 2;
      out[i + 2] = data[j + 2]; out[i + 3] = data[j + 3];
      out[i + 4] = data[j + 4]; out[i + 5] = data[j + 5]; out[i + 6] = data[j + 6]; out[i + 7] = data[j + 7];
    }
    gl.uniform1f(s.imgModeLoc, mode);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.imgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, len), gl.STREAM_DRAW);
    const [pl, ul, tl] = s.imgAttribs;
    if (pl >= 0) { gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 32, 0); }
    if (ul >= 0) { gl.enableVertexAttribArray(ul); gl.vertexAttribPointer(ul, 2, gl.FLOAT, false, 32, 8); }
    if (tl >= 0) { gl.enableVertexAttribArray(tl); gl.vertexAttribPointer(tl, 4, gl.FLOAT, false, 32, 16); }
    gl.drawArrays(gl.TRIANGLES, 0, len / 8);
    if (pl >= 0) gl.disableVertexAttribArray(pl);
    if (ul >= 0) gl.disableVertexAttribArray(ul);
    if (tl >= 0) gl.disableVertexAttribArray(tl);
  }

  function useTexturedProgram(s) {
    const gl = s.gl;
    gl.useProgram(s.imgProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(s.imgTexLoc, 0);
  }

  function drawImages(batch, alphaDst) {
    const { s, w, h } = batch;
    const gl = s.gl;
    useTexturedProgram(s);
    gl.bindTexture(gl.TEXTURE_2D, s.imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const faceTexture = typeof global.nodeGraphSharedGlFaceTexture === "function"
      ? global.nodeGraphSharedGlFaceTexture
      : null;
    for (const im of batch.images) {
      const src = im.source;
      // A face canvas that renders on this device: sample its GPU copy
      // (top-down, same orientation as a canvas upload). No upload (ZP-2).
      const face = !src.glSnapshot && faceTexture && src.getContext ? faceTexture(src) : null;
      if (src.glSnapshot) {
        gl.bindTexture(gl.TEXTURE_2D, src.texture);
      } else if (face) {
        gl.bindTexture(gl.TEXTURE_2D, face.texture);
      } else {
        let cached = im.cache ? s.texCache.get(src) : null;
        const sw = src.naturalWidth || src.width || 0;
        const sh = src.naturalHeight || src.height || 0;
        if (cached && (cached.w !== sw || cached.h !== sh || cached.src !== (src.currentSrc || src.src || ""))) {
          gl.deleteTexture(cached.texture);
          s.texCache.delete(src);
          cached = null;
        }
        if (im.cache && !cached) {
          cached = { texture: gl.createTexture(), w: sw, h: sh, src: src.currentSrc || src.src || "", fresh: true };
          s.texCache.set(src, cached);
        }
        gl.bindTexture(gl.TEXTURE_2D, cached ? cached.texture : s.imgTex);
        if (!cached || cached.fresh) {
          if (src.data && src.width > 0 && src.height > 0) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          }
          if (cached) cached.fresh = false;
        }
      }
      // Per-image blend: normal over, or additive ({ additive: true }).
      gl.blendFuncSeparate(gl.SRC_ALPHA, im.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      const f = im.nearest ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1f(s.imgAlphaLoc, im.alpha);
      const x0 = im.x; const x1 = im.x + im.w; const y0 = im.y; const y1 = im.y + im.h;
      if (im.tint) {
        const t = im.tint;
        const q = scratch(s, "quadScratch", 48);
        const a = (t.length > 3 ? t[3] : 1) * im.alpha;
        pushTextVertex(q, 0, x0, y0, 0, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 8, x1, y0, 1, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 16, x0, y1, 0, 1, t[0], t[1], t[2], a);
        pushTextVertex(q, 24, x1, y0, 1, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 32, x1, y1, 1, 1, t[0], t[1], t[2], a);
        pushTextVertex(q, 40, x0, y1, 0, 1, t[0], t[1], t[2], a);
        drawTexturedTinted(s, w, h, q, 0, 48);
      } else {
        drawTextured(s, w, h, [x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y0, 1, 0, x1, y1, 1, 1, x0, y1, 0, 1], 0);
      }
      if (src.glSnapshot && src.texture && !src.keep) {
        gl.deleteTexture(src.texture);
        src.texture = null;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function drawTexts(batch, alphaDst) {
    const { s, w, h } = batch;
    const gl = s.gl;
    useTexturedProgram(s);
    // One draw call per texture run (glyph atlas or colour emoji page).
    for (const t of batch.texts) {
      if (t.end <= t.start || !t.texture) continue;
      // A retired atlas is marked at delete. gl.isTexture is a synchronous GPU
      // round trip per run; on replayed meshes it cost ~4 ms a frame.
      if (t.texture.__glDeleted) continue;
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      // Workspace zoom above 2.5 samples the 64px glyph bake nearest, same
      // policy as .pixelated-canvas-zoom. Emoji pages stay NEAREST always.
      if (!t.color) {
        const pixel = batch.textPixelated === true;
        const mag = pixel ? gl.NEAREST : gl.LINEAR;
        const min = pixel ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
      }
      if (t.color) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      drawTexturedTinted(s, w, h, batch.tdata, t.start, t.end, t.color ? 3 : 1);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    const dead = s.deadTextures;
    if (dead && dead.length) {
      for (let i = 0; i < dead.length; i += 1) {
        dead[i].__glDeleted = true;
        gl.deleteTexture(dead[i]);
      }
      dead.length = 0;
    }
  }

  // Pulse Train forest: one instance per pulse. Stem is a vertical capsule,
  // dot is the same disc recolored when lit (no extra halo circle).
  const PT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform vec2 uVp;
uniform float uCount;
uniform float uDuration;
uniform float uAxis;
uniform float uCurve;
uniform float uSpacing;
uniform float uAmpStart;
uniform float uAmpEnd;
uniform float uAmpCurve;
uniform float uAmp;
uniform float uLoop;
uniform float uPulseMode;
uniform float uPolarity;
uniform float uX0;
uniform float uX1;
uniform float uBase;
uniform float uTop;
uniform float uPeak;
uniform float uElapsed;
uniform float uFadeTau;
uniform float uHalf;
uniform float uFeather;
uniform float uDotR;
uniform float uMode;
uniform vec4 uLine;
uniform vec4 uDotCol;
uniform vec4 uLit;
out vec2 vLocal;
out float vLen;
out float vHalf;
out float vFeather;
out float vMode;
out vec4 vColour;
float curveShape(float k, float u) {
  if (!(abs(k) > 1e-6)) return u;
  float den = exp(k) - 1.0;
  if (abs(den) < 1e-12) return u;
  return (exp(k * u) - 1.0) / den;
}
float timeWarp(float k, float u, int i, float n, bool iLoop) {
  if (!(u >= 0.0)) u = 0.0;
  if (u > 1.0) u = 1.0;
  float fam = uSpacing;
  if (fam >= 0.5 && fam < 1.5) {
    float ii = float(i);
    float h = iLoop
      ? (n > 0.0 ? (ii * (ii + 1.0)) / (n * (n + 1.0)) : 0.0)
      : (n > 1.0 ? (ii * (ii + 1.0)) / ((n - 1.0) * n) : 0.0);
    float w = clamp(abs(k) * 0.1, 0.0, 1.0);
    if (!(k < 0.0)) return u + w * (h - u);
    float hr = iLoop
      ? (n > 0.0 ? (ii * (2.0 * n - ii + 1.0)) / (n * (n + 1.0)) : 0.0)
      : (n > 1.0 ? (ii * (2.0 * n - ii - 1.0)) / ((n - 1.0) * n) : 0.0);
    return u + w * (hr - u);
  }
  if (fam >= 1.5) {
    float s = clamp(k * 0.1, -0.99, 0.99);
    float den = 1.0 - s + 2.0 * s * u;
    if (abs(den) < 1e-12) return u;
    return ((1.0 + s) * u) / den;
  }
  return curveShape(k, u);
}
void main() {
  int id = gl_InstanceID;
  float n = max(uCount, 1.0);
  int ni = int(n + 0.5);
  float p = uPulseMode;
  if (!(p > 0.0)) p = 0.0;
  if (p > 1.0) p = 1.0;
  float preAmt = p <= 0.0 ? 0.0 : (p >= 0.5 ? 1.0 : p * 2.0);
  float postAmt = p >= 1.0 ? 0.0 : (p <= 0.5 ? 1.0 : (1.0 - p) * 2.0);
  bool revOnly = preAmt > 0.0 && !(postAmt > 0.0);
  bool dual = preAmt > 0.0 && postAmt > 0.0;
  bool rev = revOnly || (dual && id >= ni);
  int i = id < ni ? id : (2 * ni - 1 - id);
  if (revOnly) i = id;
  float kT = uCurve;
  bool iLoop = uLoop > 0.5 && !rev;
  float uu = iLoop ? float(i) / n : (n > 1.0 ? float(i) / (n - 1.0) : 0.0);
  float tf;
  if (!iLoop && i == ni - 1 && n > 1.0) tf = uDuration;
  else tf = uDuration * timeWarp(kT, uu, i, n, iLoop);
  if (!(tf >= 0.0)) tf = 0.0;
  if (tf > uDuration) tf = uDuration;
  float t;
  if (rev) {
    t = preAmt * (uDuration - tf);
  } else {
    t = preAmt * uDuration + postAmt * tf;
  }
  if (revOnly && uLoop > 0.5 && n > 1.0) t *= (n - 1.0) / n;
  if (!(t >= 0.0)) t = 0.0;
  if (t > uAxis) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vLocal = vec2(0.0);
    vLen = 0.0;
    vHalf = 0.0;
    vColour = vec4(0.0);
    return;
  }
  float a0 = uPolarity > 0.5 ? uAmpEnd : uAmpStart;
  float a1 = uPolarity > 0.5 ? uAmpStart : uAmpEnd;
  float kA = uAmpCurve;
  float amp = abs((a0 + (a1 - a0) * curveShape(kA, uu)) * uAmp);
  float x = mix(uX0, uX1, clamp(t / uAxis, 0.0, 1.0));
  float y = uBase - (amp / uPeak) * (uBase - uTop);
  bool fired = uElapsed >= 0.0 && t <= uElapsed;
  float age = fired ? uElapsed - t : 1e9;
  // PhosphorResidual.energyAfterSeconds: exp(-age / tau). tau 0 = hold.
  float litAmt = 0.0;
  if (fired) litAmt = uFadeTau > 0.0 ? exp(-age / uFadeTau) : 1.0;
  vMode = uMode;
  vFeather = max(uFeather, 1e-4);
  vec2 pos;
  if (uMode < 0.5) {
    float len = max(0.0, uBase - y);
    if (len <= 0.5) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vLocal = vec2(0.0);
      vLen = 0.0;
      vHalf = 0.0;
      vColour = vec4(0.0);
      return;
    }
    float r = uHalf + vFeather;
    float along = -r + aCorner.x * (len + 2.0 * r);
    float across = mix(-r, r, aCorner.y);
    pos = vec2(x + across, uBase - along);
    vLocal = vec2(along, across);
    vLen = len;
    vHalf = uHalf;
    vColour = mix(uLine, uLit, litAmt);
  } else {
    float rad = max(uDotR, 0.0);
    float r = rad + vFeather;
    if (r <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vLocal = vec2(0.0);
      vLen = 0.0;
      vHalf = 0.0;
      vColour = vec4(0.0);
      return;
    }
    vec2 off = (aCorner * 2.0 - 1.0) * r;
    pos = vec2(x, y) + off;
    vLocal = off;
    vLen = 0.0;
    vHalf = rad;
    vColour = mix(uDotCol, uLit, litAmt);
  }
  gl_Position = vec4(pos.x / uVp.x * 2.0 - 1.0, 1.0 - pos.y / uVp.y * 2.0, 0.0, 1.0);
}
`;
  const PT_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
in float vHalf;
in float vFeather;
in float vMode;
in vec4 vColour;
out vec4 fragColor;
float coverageSmoother(float halfPx, float feather, float dist) {
  float w = max(feather, 1e-4);
  float t = clamp((dist - halfPx) / w, 0.0, 1.0);
  return 1.0 - t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
void main() {
  float a;
  if (vMode < 0.5) {
    float u = vLocal.x;
    float across = abs(vLocal.y);
    float outside = u < 0.0 ? -u : (u > vLen ? u - vLen : 0.0);
    float d = outside > 0.0 ? length(vec2(outside, vLocal.y)) : across;
    a = coverageSmoother(vHalf, vFeather, d);
  } else {
    float d = length(vLocal);
    a = coverageSmoother(vHalf, vFeather, d);
  }
  if (a < 0.004) discard;
  fragColor = vec4(vColour.rgb, vColour.a * a);
}
`;

  function ensurePulseTrain(s) {
    if (!s || s.pulseTrainFailed) return null;
    if (s.pulseTrain) return s.pulseTrain;
    const gl = s.gl;
    if (!gl || typeof gl.drawArraysInstanced !== "function") {
      s.pulseTrainFailed = true;
      return null;
    }
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, PT_VS, "pulseTrain vertex");
      const fs = compile(gl, gl.FRAGMENT_SHADER, PT_FS, "pulseTrain fragment");
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.bindAttribLocation(program, 0, "aCorner");
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || "link failed";
        gl.deleteProgram(program);
        throw new Error(log);
      }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 0, 1,
        1, 0, 1, 1, 0, 1,
      ]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const u = (name) => gl.getUniformLocation(program, name);
      s.pulseTrain = {
        program,
        buf,
        uVp: u("uVp"),
        uCount: u("uCount"),
        uDuration: u("uDuration"),
        uAxis: u("uAxis"),
        uCurve: u("uCurve"),
        uSpacing: u("uSpacing"),
        uAmpStart: u("uAmpStart"),
        uAmpEnd: u("uAmpEnd"),
        uAmpCurve: u("uAmpCurve"),
        uAmp: u("uAmp"),
        uLoop: u("uLoop"),
        uPulseMode: u("uPulseMode"),
        uPolarity: u("uPolarity"),
        uX0: u("uX0"),
        uX1: u("uX1"),
        uBase: u("uBase"),
        uTop: u("uTop"),
        uPeak: u("uPeak"),
        uElapsed: u("uElapsed"),
        uFadeTau: u("uFadeTau"),
        uHalf: u("uHalf"),
        uFeather: u("uFeather"),
        uDotR: u("uDotR"),
        uMode: u("uMode"),
        uLine: u("uLine"),
        uDotCol: u("uDotCol"),
        uLit: u("uLit"),
      };
      return s.pulseTrain;
    } catch (error) {
      s.pulseTrainFailed = true;
      console.error("[gl-line-renderer] pulse train shader failed: " + String(error?.message || error));
      return null;
    }
  }

  function drawPulseTrains(batch) {
    const pt = ensurePulseTrain(batch.s);
    if (!pt || !batch.pulseTrains?.length) return;
    const gl = batch.s.gl;
    const { w, h } = batch;
    gl.useProgram(pt.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, pt.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.uniform2f(pt.uVp, w, h);
    for (const spec of batch.pulseTrains) {
      gl.uniform1f(pt.uCount, spec.nFwd || spec.count);
      gl.uniform1f(pt.uPulseMode, spec.pulseMode || 0);
      gl.uniform1f(pt.uPolarity, spec.polarity || 0);
      gl.uniform1f(pt.uDuration, spec.duration);
      gl.uniform1f(pt.uAxis, spec.axisEnd);
      gl.uniform1f(pt.uCurve, spec.curve);
      gl.uniform1f(pt.uSpacing, spec.spacing || 0);
      gl.uniform1f(pt.uAmpStart, spec.ampStart);
      gl.uniform1f(pt.uAmpEnd, spec.ampEnd);
      gl.uniform1f(pt.uAmpCurve, spec.ampCurve);
      gl.uniform1f(pt.uAmp, spec.amplitude);
      gl.uniform1f(pt.uLoop, spec.loop);
      gl.uniform1f(pt.uX0, spec.x0);
      gl.uniform1f(pt.uX1, spec.x1);
      gl.uniform1f(pt.uBase, spec.base);
      gl.uniform1f(pt.uTop, spec.top);
      gl.uniform1f(pt.uPeak, spec.peak);
      gl.uniform1f(pt.uElapsed, spec.elapsed);
      gl.uniform1f(pt.uFadeTau, spec.fadeTau);
      gl.uniform1f(pt.uHalf, spec.half);
      gl.uniform1f(pt.uFeather, spec.feather);
      gl.uniform1f(pt.uDotR, spec.dotR);
      gl.uniform4f(pt.uLine, spec.line[0], spec.line[1], spec.line[2], spec.line[3]);
      gl.uniform4f(pt.uDotCol, spec.dot[0], spec.dot[1], spec.dot[2], spec.dot[3]);
      gl.uniform4f(pt.uLit, spec.lit[0], spec.lit[1], spec.lit[2], spec.lit[3]);
      gl.uniform1f(pt.uMode, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, spec.count);
      if (spec.dotR > 0) {
        gl.uniform1f(pt.uMode, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, spec.count);
      }
    }
    gl.disableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Draw images, quads, text into the bound framebuffer with the given blend funcs. */
  function drawContent(batch, blend, alphaDst) {
    const { s } = batch;
    const gl = s.gl;
    s._drawBatch = batch;
    const colourDst = blend === "add" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA;
    gl.enable(gl.BLEND);
    if (batch.images.length) {
      drawImages(batch, alphaDst);
    }
    const drawQuads = (data, n) => {
      const count = n / FLOATS;
      if (!(count > 0) || !data) return;
      // "max": straight coverage. The dot canvas is premultipliedAlpha:false,
      // so a normal SRC_ALPHA write gets multiplied again when it crosses the
      // wire and leaves a dark ring. MAX unions same-colour coverage.
      const max = blend === "max";
      if (max) gl.blendEquation(gl.MAX);
      gl.blendFuncSeparate(max ? gl.ONE : gl.SRC_ALPHA, max ? gl.ONE : colourDst, gl.ONE, max ? gl.ONE : alphaDst);
      gl.useProgram(s.program);
      bindCam(gl, lineCamLocs(s), batch);
      if (s.lineDash) gl.uniform2f(s.lineDash, batch.dashOn || 0, batch.dashOff || 0);
      if (s.coverage) gl.uniform1f(s.coverage, max ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n), gl.STREAM_DRAW);
      const sizes = [2, 2, 1, 1, 1, 1, 4];
      let off = 0;
      for (let i = 0; i < sizes.length; i += 1) {
        const loc = s.attribs[i];
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, FLOATS * 4, off * 4);
        }
        off += sizes[i];
      }
      gl.drawArrays(gl.TRIANGLES, 0, count);
      for (const loc of s.attribs) if (loc >= 0) gl.disableVertexAttribArray(loc);
      if (max) gl.blendEquation(gl.FUNC_ADD);
    };
    if (batch.gn > 0) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      drawQuads(batch.gdata, batch.gn);
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
    }
    drawQuads(batch.data, batch.n);
    if (batch.pulseTrains?.length) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
      drawPulseTrains(batch);
    }
    if (batch.outlines?.length) drawOutlines(batch);
    drawQuads(batch.over, batch.on);
    if (batch.texts.length) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      drawTexts(batch, alphaDst);
    }
    if (batch.veils?.length) drawVeils(batch);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function publishNodeIdFor(batch) {
    if (batch.publishNodeId !== undefined) return String(batch.publishNodeId || "");
    const host = batch.canvas?.closest?.(".dsp-node, [data-node]");
    return String(host?.dataset?.node || "");
  }

  /**
   * Draw the batch and blit it into the face's 2D canvas.
   * blend "add" = GL_SRC_ALPHA, GL_ONE (Sabrina plugin); "alpha" = normal over.
   * @returns {boolean} false -> caller fills black.
   */
  function nodeGraphGlLinesEnd(batch, blend = "alpha") {
    if (!batch) return false;
    try {
      return endBatch(batch, blend);
    } finally {
      releaseBatch(batch);
    }
  }

  function releaseBatch(batch) {
    if (batch.keepMesh) return;
    // Hand the vertex array back for the next face (pool stays tiny).
    if (batch.data && batch.s.pool.length < 8) batch.s.pool.push(batch.data);
    if (batch.tdata && batch.s.tpool.length < 8) batch.s.tpool.push(batch.tdata);
    batch.data = null;
    batch.tdata = null;
    batch.n = 0;
    batch.tn = 0;
  }

  /**
   * Draw the batch into the framebuffer the caller has bound (its viewport
   * covers batch.w x batch.h, y down like Begin). No clear, no picture out, no
   * copy to a face canvas: for faces that own their GPU picture and layer
   * marks on it in the same pass (waterfall ink: pause / protect / RMS dB
   * guides go straight into the waterfall present or its history texture).
   * @returns {boolean} false -> caller calls nodeGraphDisplayGlFailed.
   */
  function nodeGraphGlLinesDrawInto(batch, blend = "alpha") {
    if (!batch) return false;
    try {
      const gl = batch.s.gl;
      if (gl.isContextLost()) return false;
      if (gl.bindVertexArray) gl.bindVertexArray(null);
      // The caller's quads may leave arrays enabled on the default VAO; a
      // constant attribute (text tint) must not read a stale buffer.
      for (let i = 0; i < 8; i += 1) gl.disableVertexAttribArray(i);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      // Opaque target: colour over, alpha stays 1.
      drawContent(batch, blend, gl.ONE);
      gl.disable(gl.BLEND);
      return !gl.isContextLost();
    } finally {
      releaseBatch(batch);
    }
  }

  function endBatch(batch, blend) {
    const { s, w, h } = batch;
    const gl = s.gl;
    if (gl.isContextLost()) return false;
    const ctx = batch.canvas.getContext("2d");
    if (!ctx) return false;
    if (gl.bindVertexArray) gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const cl = batch.clear || [0, 0, 0, 1];

    // RGBA picture out: only when something is cabled to this node's TV out.
    const nodeId = publishNodeIdFor(batch);
    const target = nodeId
      && typeof global.nodeGraphPictureHasConsumer === "function"
      && global.nodeGraphPictureHasConsumer(nodeId)
      && typeof global.nodeGraphPictureExportTarget === "function"
      ? global.nodeGraphPictureExportTarget(nodeId, w, h)
      : null;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Premultiplied result: rgb = sum(c * a), alpha = over-composited coverage.
      drawContent(batch, blend, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    if (typeof global.nodeGraphSharedGlBindPresent === "function") {
      global.nodeGraphSharedGlBindPresent(gl, w, h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
    }
    gl.clearColor(cl[0], cl[1], cl[2], cl.length > 3 ? cl[3] : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (target) {
      // Face = plate + the published picture (premultiplied over).
      useTexturedProgram(s);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      // FBO row 0 is the bottom: flip v.
      drawTextured(s, w, h, [0, 0, 0, 1, w, 0, 1, 1, 0, h, 0, 0, w, 0, 1, 1, w, h, 1, 0, 0, h, 0, 0], 2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // Colour additive / over; alpha always accumulates to opaque.
      drawContent(batch, blend, gl.ONE);
    }
    if (typeof global.nodeGraphSharedGlEndPresent === "function") global.nodeGraphSharedGlEndPresent(gl);
    if (gl.isContextLost()) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    const replace = batch.transparent && batch.keep !== true;
    if (replace) ctx.clearRect(0, 0, w, h);
    if (typeof global.nodeGraphSharedGlBlitTo2D === "function") {
      // replace: the face texture gets this rect as is (the 2D clear above).
      return global.nodeGraphSharedGlBlitTo2D(ctx, w, h, { replace }) !== false;
    }
    ctx.drawImage(s.dev.canvas, 0, Math.max(0, s.dev.canvas.height - h), w, h, 0, 0, w, h);
    return true;
  }

  /** GL unavailable: plain black square (no 2D drawing fallback). */
  function nodeGraphGlLinesFillBlack(canvas) {
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The black plate is the picture now; drop any GPU copy of the face.
    if (typeof global.nodeGraphSharedGlFaceForget === "function") global.nodeGraphSharedGlFaceForget(canvas);
  }

  /** "#rgb" / "#rrggbb" / "rgb(a)(...)" / "hsl(a)(...)" -> [r,g,b,a] 0..1. */
  function nodeGraphGlLinesCss(css, alpha = 1) {
    const s = String(css || "").trim().toLowerCase();
    let m = /^#([0-9a-f]{3})$/.exec(s);
    if (m) return [...m[1]].map((c) => parseInt(c + c, 16) / 255).concat(alpha);
    m = /^#([0-9a-f]{6})$/.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
    }
    m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
    if (m) {
      const parts = m[2].split(/[\s,/]+/).filter(Boolean);
      const num = (v) => parseFloat(v);
      const a = parts.length > 3 ? (parts[3].endsWith("%") ? num(parts[3]) / 100 : num(parts[3])) : 1;
      if (m[1].startsWith("rgb")) {
        const ch = (v) => (v.endsWith("%") ? num(v) / 100 : num(v) / 255);
        return [ch(parts[0]), ch(parts[1]), ch(parts[2]), a * alpha];
      }
      return nodeGraphGlLinesHsl(num(parts[0]), num(parts[1]) / 100, num(parts[2]) / 100, a * alpha);
    }
    return [0, 0, 0, alpha];
  }

  /** HSL (hue degrees, s/l 0..1) -> [r,g,b,a] 0..1. */
  function nodeGraphGlLinesHsl(hDeg, s, l, alpha = 1) {
    const h = ((((Number(hDeg) || 0) % 360) + 360) % 360) / 360;
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4), alpha];
  }

  const OUT_MAX = 24;
  const CUT_MAX = 16;
  function nodeGraphGlLinesVeil(batch, x, y, w, h, period) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    if (period > 0) batch.veilPeriod = period * k;
    batch.veils.push({ x: x * k, y: y * k, w: w * k, h: h * k });
  }

  function drawVeils(batch) {
    const { s, gl } = { s: batch.s, gl: batch.s.gl };
    if (!s.veilProgram) return;
    gl.useProgram(s.veilProgram);
    bindCam(gl, { pixel: s.veilCamPixel, cam: s.veilCamCam, vp: s.veilCamVp, device: s.veilCamDevice }, batch);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
    gl.enableVertexAttribArray(s.veilPos);
    gl.enableVertexAttribArray(s.veilPx);
    gl.vertexAttribPointer(s.veilPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(s.veilPx, 2, gl.FLOAT, false, 16, 8);
    // Straight colour. A SRC_ALPHA write gets premultiplied again when the
    // canvas is stacked on the module body, so the stripe vanished there
    // and only survived on top of the display in this same buffer.
    gl.disable(gl.BLEND);
    if (s.veilPeriod) gl.uniform1f(s.veilPeriod, batch.veilPeriod > 0 ? batch.veilPeriod : 18);
    for (let n = 0; n < batch.veils.length; n += 1) {
      const shape = batch.veils[n];
      const x0 = shape.x;
      const y0 = shape.y;
      const x1 = shape.x + shape.w;
      const y1 = shape.y + shape.h;
      const pix = Boolean(batch.camera);
      const clip = pix
        ? (px, py) => [px, py]
        : (px, py) => [(px / batch.w) * 2 - 1, 1 - (py / batch.h) * 2];
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y0], [x1, y1], [x0, y1]];
      const data = new Float32Array(6 * 4);
      for (let i = 0; i < corners.length; i += 1) {
        const xy = clip(corners[i][0], corners[i][1]);
        data[i * 4] = xy[0];
        data[i * 4 + 1] = xy[1];
        data[i * 4 + 2] = corners[i][0];
        data[i * 4 + 3] = corners[i][1];
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.uniform4f(s.veilRect, shape.x, shape.y, shape.w, shape.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(s.veilPos);
    gl.disableVertexAttribArray(s.veilPx);
    gl.enable(gl.BLEND);
  }

  function nodeGraphGlLinesModuleOutline(batch, x, y, w, h, stroke, rgba, jacks, fill, cuts) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    const sx = x * k;
    const sy = y * k;
    const sw = w * k;
    const sh = h * k;
    const ss = Math.max(0.5, stroke * k);
    const list = [];
    const src = Array.isArray(jacks) ? jacks : [];
    for (let i = 0; i < src.length && list.length < OUT_MAX; i += 1) {
      const jack = src[i];
      const r = Math.max(0, Number(jack.r) || 0) * k;
      if (!(r > 0)) continue;
      const jx = (Number(jack.x) || 0) * k;
      const jy = (Number(jack.y) || 0) * k;
      const color = jack.rgba || rgba;
      list.push({ x: jx, y: jy, r: jack.square ? -r : r, rgba: color, inlet: jack.inlet === true });
    }
    batch.outlines.push({
      x: sx, y: sy, w: sw, h: sh, stroke: ss, rgba,
      fill: fill || [0.09, 0.1, 0.12, 1],
      jacks: list,
      cuts: (Array.isArray(cuts) ? cuts : []).slice(0, CUT_MAX).map((c) => [c.y0 * k, c.y1 * k, c.side < 0 ? -1 : 1, 0]),
    });
  }

  function drawOutlines(batch) {
    const s = batch.s;
    const gl = s.gl;
    if (!s.outProgram) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(s.outProgram);
    bindCam(gl, { pixel: s.outCamPixel, cam: s.outCamCam, vp: s.outCamVp, device: s.outCamDevice }, batch);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.outBuf);
    gl.enableVertexAttribArray(s.outPos);
    gl.enableVertexAttribArray(s.outPx);
    gl.vertexAttribPointer(s.outPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(s.outPx, 2, gl.FLOAT, false, 16, 8);
    const jackData = new Float32Array(OUT_MAX * 4);
    const colorData = new Float32Array(OUT_MAX * 4);
    for (let n = 0; n < batch.outlines.length; n += 1) {
      const shape = batch.outlines[n];
      const pad = shape.stroke + 6;
      const x0 = shape.x - pad;
      const y0 = shape.y - pad;
      const x1 = shape.x + shape.w + pad;
      const y1 = shape.y + shape.h + pad;
      const pix = Boolean(batch.camera);
      const clip = pix
        ? (px, py) => [px, py]
        : (px, py) => [(px / batch.w) * 2 - 1, 1 - (py / batch.h) * 2];
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y0], [x1, y1], [x0, y1]];
      const data = new Float32Array(6 * 4);
      for (let i = 0; i < corners.length; i += 1) {
        const xy = clip(corners[i][0], corners[i][1]);
        data[i * 4] = xy[0];
        data[i * 4 + 1] = xy[1];
        data[i * 4 + 2] = corners[i][0];
        data[i * 4 + 3] = corners[i][1];
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.uniform4f(s.outPlate, shape.x, shape.y, shape.w, shape.h);
      const col = shape.rgba || [1, 1, 1, 1];
      gl.uniform4f(s.outPlateColor, col[0], col[1], col[2], col.length > 3 ? col[3] : 1);
      const fill = shape.fill || [0, 0, 0, 0];
      if (s.outFill) gl.uniform4f(s.outFill, fill[0], fill[1], fill[2], fill.length > 3 ? fill[3] : 1);
      gl.uniform1f(s.outStroke, shape.stroke);
      jackData.fill(0);
      colorData.fill(0);
      const count = Math.min(OUT_MAX, shape.jacks.length);
      for (let i = 0; i < count; i += 1) {
        const jack = shape.jacks[i];
        jackData[i * 4] = jack.x;
        jackData[i * 4 + 1] = jack.y;
        jackData[i * 4 + 2] = jack.r;
        jackData[i * 4 + 3] = jack.inlet ? 1 : 0;
        const jc = jack.rgba || col;
        colorData[i * 4] = jc[0];
        colorData[i * 4 + 1] = jc[1];
        colorData[i * 4 + 2] = jc[2];
        colorData[i * 4 + 3] = jc.length > 3 ? jc[3] : 1;
      }
      gl.uniform1i(s.outCount, count);
      const cuts = shape.cuts || [];
      if (s.outCutCount) gl.uniform1i(s.outCutCount, cuts.length);
      if (cuts.length && s.outCut) {
        const cutData = new Float32Array(CUT_MAX * 4);
        cuts.forEach((c, i) => cutData.set(c, i * 4));
        gl.uniform4fv(s.outCut, cutData);
      }
      if (s.outJack) gl.uniform4fv(s.outJack, jackData);
      if (s.outJackColor) gl.uniform4fv(s.outJackColor, colorData);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(s.outPos);
    gl.disableVertexAttribArray(s.outPx);
  }

  function nodeGraphGlLinesSetGlyphBakePx(px) {
    const next = Math.max(16, Math.min(384, Math.round(Number(px) || TEXT_BAKE_PX)));
    if (next === glyphBakePx) return false;
    glyphBakePx = next;
    const s = ensure();
    if (s?.atlases) {
      if (!s.deadTextures) s.deadTextures = [];
      for (const atlas of s.atlases.values()) {
        if (atlas?.texture) s.deadTextures.push(atlas.texture);
      }
      s.atlases.clear();
    }
    return true;
  }

  // User fragment quad (emo script display {}). One program per source, an 8-frame
  // ring for delayFrame(ago), and prev = the newest stored frame. Pictures are
  // premultiplied RGBA, same as the 📺 wire.
  const USER_SHADER_DELAY = 8;
  const USER_SHADER_MAX = 512;
  const userShaderReserved = new Set([
    "uv", "time", "resolution", "prev", "rgbaIn", "rgbaLive", "out_color", "delayFrame", "delayFrameAt", "emoDelaySample", "vUv", "gl_FragColor",
  ]);
  for (let i = 0; i < USER_SHADER_DELAY; i += 1) userShaderReserved.add(`delay${i}`);
  const userShaderNodes = new Map();
  let userShaderCompiles = 0;
  /** Smokes: user shader compiles so far (a failed source must not recompile per frame). */
  function nodeGraphGlLinesUserShaderStats() {
    return { compiles: userShaderCompiles, nodes: userShaderNodes.size };
  }
  let userShaderBlack = null;
  let userShaderQuad = null;

  function userShaderSurface(gl, w, h) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const internal = gl.RGBA8 !== undefined ? gl.RGBA8 : gl.RGBA;
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

  function userShaderDropSurface(gl, surface) {
    if (!surface) return;
    gl.deleteFramebuffer(surface.framebuffer);
    gl.deleteTexture(surface.texture);
  }

  function userShaderBlackTex(gl) {
    if (userShaderBlack) return userShaderBlack;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    userShaderBlack = texture;
    return texture;
  }

  function userShaderSource(userBody, floatNames) {
    const names = [];
    const seen = new Set();
    for (const raw of floatNames || []) {
      const name = String(raw || "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || userShaderReserved.has(name) || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    const header = [
      "#version 300 es",
      "precision highp float;",
      "in vec2 vUv;",
      "uniform vec2 resolution;",
      "uniform float time;",
      "uniform sampler2D prev;",
      "uniform sampler2D rgbaIn;",
      "uniform float rgbaLive;",
    ];
    for (let i = 0; i < USER_SHADER_DELAY; i += 1) header.push(`uniform sampler2D delay${i};`);
    for (const name of names) header.push(`uniform float ${name};`);
    header.push(
      "out vec4 out_color;",
      "vec4 emoDelaySample(int i, vec2 p) {",
      "  if (i <= 0) return texture(delay0, p);",
      "  if (i == 1) return texture(delay1, p);",
      "  if (i == 2) return texture(delay2, p);",
      "  if (i == 3) return texture(delay3, p);",
      "  if (i == 4) return texture(delay4, p);",
      "  if (i == 5) return texture(delay5, p);",
      "  if (i == 6) return texture(delay6, p);",
      "  return texture(delay7, p);",
      "}",
      "vec4 delayFrameAt(float ago, vec2 p) {",
      "  float x = clamp(ago, 0.0, 7.0);",
      "  int i = int(floor(x));",
      "  vec4 a = emoDelaySample(i, p);",
      "  vec4 b = emoDelaySample(min(i + 1, 7), p);",
      "  return mix(a, b, fract(x));",
      "}",
      "vec4 delayFrame(float ago) {",
      "  return delayFrameAt(ago, vUv);",
      "}",
      "void main() {",
      "  vec2 uv = vUv;",
      "  out_color = vec4(0.0, 0.0, 0.0, 1.0);",
    );
    const body = String(userBody || "");
    const source = `${header.join("\n")}\n${body}\n}\n`;
    return { source, names, headerLines: header.length };
  }

  function userShaderShiftLog(log, headerLines) {
    return String(log || "").replace(/:(\d+):/g, (all, num) => {
      const line = Number(num) - headerLines;
      return line > 0 ? `:${line}:` : all;
    });
  }

  /**
   * Draw one user fragment into the face and the 📺 picture.
   * userBody is the inside of main(): uv, time, resolution, prev, rgbaIn,
   * rgbaLive, delayFrame(ago), and one float uniform per name in floatNames.
   * advance stores this frame in the 8-frame ring (ago 0 = prev).
   * @returns {{ok:boolean, error:string}}
   */
  function nodeGraphGlLinesUserShader(spec) {
    const canvas = spec?.canvas;
    const key = String(spec?.key || "");
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    const gl = dev?.gl;
    if (!canvas || !gl || gl.isContextLost()) {
      if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
      return { ok: false, error: "WebGL2 picture device missing" };
    }
    const w = Math.max(1, Math.min(USER_SHADER_MAX, canvas.width | 0));
    const h = Math.max(1, Math.min(USER_SHADER_MAX, canvas.height | 0));
    let node = userShaderNodes.get(key);
    if (!node || node.w !== w || node.h !== h || node.gl !== gl) {
      if (node) {
        for (const surface of node.ring) userShaderDropSurface(gl, surface);
        userShaderDropSurface(gl, node.scratch);
        if (node.program) gl.deleteProgram(node.program);
      }
      const ring = [];
      for (let i = 0; i < USER_SHADER_DELAY; i += 1) {
        const surface = userShaderSurface(gl, w, h);
        if (!surface) {
          if (typeof global.nodeGraphDisplayGlFailed === "function") {
            global.nodeGraphDisplayGlFailed(canvas, "emo shader surface");
          }
          return { ok: false, error: "shader surface failed" };
        }
        ring.push(surface);
      }
      const scratch = userShaderSurface(gl, w, h);
      if (!scratch) return { ok: false, error: "shader surface failed" };
      node = { gl, w, h, ring, scratch, head: -1, program: null, source: "", locs: null, names: [], failedSource: "", failedError: "", failedSize: "" };
      userShaderNodes.set(key, node);
    }
    const built = userShaderSource(spec.userBody, spec.floatNames);
    // A source that failed to compile stays failed until it changes: no
    // per-frame recompile, no repeated log, the face stays the black plate.
    // The error text is returned every frame for the Code page.
    if (node.failedSource && node.failedSource === built.source) {
      const size = `${canvas.width | 0}x${canvas.height | 0}`;
      const cached = node.failedSize === size;
      if (!cached) {
        // The canvas was resized (cleared): black plate again, once.
        node.failedSize = size;
        nodeGraphGlLinesFillBlack(canvas);
      }
      return { ok: false, error: node.failedError || "shader failed", cached: true };
    }
    if (node.source !== built.source) {
      userShaderCompiles += 1;
      let program = null;
      let error = "";
      try {
        const vs = compile(gl, gl.VERTEX_SHADER, `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`);
        const fs = compile(gl, gl.FRAGMENT_SHADER, built.source);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          error = userShaderShiftLog(gl.getProgramInfoLog(program) || "link failed", built.headerLines);
          gl.deleteProgram(program);
          program = null;
        }
      } catch (err) {
        error = userShaderShiftLog(err?.message || String(err), built.headerLines);
      }
      if (!program) {
        node.failedSource = built.source;
        node.failedError = error || "shader failed";
        node.failedSize = `${canvas.width | 0}x${canvas.height | 0}`;
        if (typeof global.nodeGraphDisplayGlFailed === "function") {
          global.nodeGraphDisplayGlFailed(canvas, "emo shader", new Error(node.failedError));
        } else {
          nodeGraphGlLinesFillBlack(canvas);
        }
        return { ok: false, error: node.failedError, cached: true };
      }
      node.failedSource = "";
      node.failedError = "";
      if (node.program) gl.deleteProgram(node.program);
      const locs = {
        aPos: gl.getAttribLocation(program, "aPos"),
        resolution: gl.getUniformLocation(program, "resolution"),
        time: gl.getUniformLocation(program, "time"),
        rgbaLive: gl.getUniformLocation(program, "rgbaLive"),
        prev: gl.getUniformLocation(program, "prev"),
        rgbaIn: gl.getUniformLocation(program, "rgbaIn"),
        delay: [],
        floats: {},
      };
      for (let i = 0; i < USER_SHADER_DELAY; i += 1) locs.delay.push(gl.getUniformLocation(program, `delay${i}`));
      for (const name of built.names) locs.floats[name] = gl.getUniformLocation(program, name);
      node.program = program;
      node.locs = locs;
      node.names = built.names;
      node.source = built.source;
    }
    if (!userShaderQuad) {
      userShaderQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, userShaderQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    const black = userShaderBlackTex(gl);
    const head = node.head;
    const prevTex = head < 0 ? black : node.ring[head].texture;
    const picture = spec.picture?.texture || black;
    gl.bindFramebuffer(gl.FRAMEBUFFER, node.scratch.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(node.program);
    gl.uniform2f(node.locs.resolution, w, h);
    gl.uniform1f(node.locs.time, Number(spec.time) || 0);
    gl.uniform1f(node.locs.rgbaLive, spec.picture?.texture ? 1 : 0);
    const floats = spec.floats || {};
    for (const name of node.names) {
      const value = Number(floats[name]);
      gl.uniform1f(node.locs.floats[name], Number.isFinite(value) ? value : 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.uniform1i(node.locs.prev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, picture);
    gl.uniform1i(node.locs.rgbaIn, 1);
    for (let i = 0; i < USER_SHADER_DELAY; i += 1) {
      const slot = head < 0 ? black : node.ring[(head - i + USER_SHADER_DELAY) % USER_SHADER_DELAY].texture;
      gl.activeTexture(gl.TEXTURE2 + i);
      gl.bindTexture(gl.TEXTURE_2D, slot);
      gl.uniform1i(node.locs.delay[i], 2 + i);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, userShaderQuad);
    gl.enableVertexAttribArray(node.locs.aPos);
    gl.vertexAttribPointer(node.locs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(node.locs.aPos);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (spec.advance !== false) {
      const next = (head + 1 + USER_SHADER_DELAY) % USER_SHADER_DELAY;
      const stored = node.ring[next];
      node.ring[next] = node.scratch;
      node.scratch = stored;
      node.head = next;
    }
    const shown = node.head < 0 ? node.scratch.texture : node.ring[node.head].texture;
    if (spec.publishNodeId && typeof global.nodeGraphPicturePublish === "function") {
      global.nodeGraphPicturePublish(spec.publishNodeId, shown, w, h);
    }
    if (typeof global.nodeGraphPicturePresent === "function") {
      global.nodeGraphPicturePresent(shown, w, h, canvas, canvas.width, canvas.height);
    }
    return { ok: true, error: "" };
  }

  const api = {
    nodeGraphGlLinesFillBlack,
    nodeGraphGlLinesBegin,
    nodeGraphGlLinesRect,
    nodeGraphGlLinesModuleOutline,
    nodeGraphGlLinesVeil,
    nodeGraphGlLinesTriangle,
    nodeGraphGlLinesFillUnder,
    nodeGraphGlLinesSegment,
    nodeGraphGlLinesDot,
    nodeGraphGlLinesPulseTrain,
    nodeGraphGlLinesRing,
    nodeGraphGlLinesPolyline,
    nodeGraphGlLinesRibbon,
    nodeGraphGlLinesDash,
    nodeGraphGlLinesPhosphor,
    nodeGraphGlLinesImage,
    nodeGraphGlLinesSnapshot,
    nodeGraphGlLinesReleaseSnapshot,
    nodeGraphGlLinesText,
    nodeGraphGlLinesSetGlyphBakePx,
    nodeGraphGlLinesMeasureText,
    nodeGraphGlLinesTextAtlas,
    nodeGraphGlLinesTextSegments,
    nodeGraphGlLinesEmojiStats,
    nodeGraphGlLinesTextAspectStats,
    nodeGraphGlLinesCss,
    nodeGraphGlLinesHsl,
    nodeGraphGlLinesEnd,
    nodeGraphGlLinesDrawInto,
    nodeGraphGlLinesUserShader,
    nodeGraphGlLinesUserShaderStats,
  };
  Object.assign(global, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
