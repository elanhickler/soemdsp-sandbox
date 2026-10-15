// Scan Grid source pass: nearest buffer texel → grade LUT → HSL hue rotate.
// Pair: raster_rgb.vert.glsl

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uRaw;      // bufW × bufH RGBA8, row 0 = top
uniform sampler2D uLut;      // 256 × 1, grade LUT in .r
uniform vec2 uBuf;           // bufW, bufH
uniform vec2 uFace;          // cw, ch
uniform vec4 uDest;          // dx, dy, dw, dh (face px, top-left origin)
uniform float uHue;          // hue shift in cycles, 0 = off
uniform float uFlipY;        // 1 = GL texture (row 0 = bottom)

float wrapHue(float n) {
  return n - floor(n);
}

// Shared HSL maths (SoemGl.GLSL_HSL, public/lib/gl/soem-gl-util.js) is
// spliced in here by raster-rgb-gl.js at load time.
// #include <soem-hsl>

// nodeGraphRasterRgbHueRotate (raster-rgb-math.js).
vec3 hueRotate(vec3 c, float hShift) {
  vec3 hsl = soemRgbToHsl(c);
  hsl.x = wrapHue(hsl.x + hShift);
  return soemHslToRgb(hsl);
}

float lut(float v) {
  float i = floor(v * 255.0 + 0.5);
  return texture2D(uLut, vec2((i + 0.5) / 256.0, 0.5)).r;
}

void main() {
  float x = floor(gl_FragCoord.x);
  float y = uFace.y - 1.0 - floor(gl_FragCoord.y);
  if (x < uDest.x || x >= uDest.x + uDest.z || y < uDest.y || y >= uDest.y + uDest.w) {
    gl_FragColor = vec4(0.0);
    return;
  }
  // drawImage, smoothing off: dest pixel centre → floor(source coordinate).
  // Skia picks the lower texel when the centre lands exactly on a texel
  // edge; the small bias reproduces that.
  vec2 t = floor((vec2(x, y) + 0.5 - uDest.xy) * uBuf / uDest.zw - 1.0 / 1024.0);
  if (uFlipY > 0.5) t.y = uBuf.y - 1.0 - t.y;
  t = clamp(t, vec2(0.0), uBuf - 1.0);
  vec3 raw = texture2D(uRaw, (t + 0.5) / uBuf).rgb;
  vec3 c = vec3(lut(raw.r), lut(raw.g), lut(raw.b));
  if (uHue != 0.0) c = hueRotate(c, uHue);
  gl_FragColor = vec4(c, 1.0);
}
