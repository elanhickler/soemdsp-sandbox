#version 300 es
// Scan Grid beam: one point per pixel write (stamp) into the persistent grid.
// Pair: raster_rgb.scan.frag.glsl. Driven by raster-rgb-gl.js nodeGraphRasterRgbGlScan().
//
// Raster timing (Line Rate): a line lasts D = sampleRate / Line Rate samples,
// a frame F = Height x D (Width and Height are whole numbers). Every line
// restarts at column 0, every frame at row 0. Cell (row r, column c) of a
// frame is stamped by the sample current when the beam leaves it (the old
// Scan Speed convention):
//   exit = lineStart(r) + (c + 1) * D / Width
//   sample = ceil(exit - kTie) - 1
// kTie makes exact ties (Line Rate locked to the source) resolve the same way
// in every draw.
//
// Stamp v of this draw is grid cell (r0, c0) + v in row-major order (wrapping
// into following rows / frames). Times come relative to sample uBase so the
// float maths stays small; positions are integers (exact).
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uR;      // R32F, this frame's samples, row-major uTexW wide
uniform sampler2D uG;
uniform sampler2D uB;
uniform int uTexW;
uniform ivec3 uSkip;       // per channel: take - available samples (leading zeros)
uniform vec3 uHas;         // 1 = channel wired
uniform int uBase;         // sample index (into this take) the times are relative to
uniform int uLast;         // last sample index this draw may use
uniform ivec2 uCell0;      // first stamp: (column, row)
uniform ivec2 uCells;      // Width, Height = storage size
uniform float uLine0;      // start time of row uCell0.y (relative to uBase)
uniform float uFrameEnd;   // start time of the next frame (relative to uBase)
uniform vec3 uTiming;      // D (samples / line), D / Width (samples / column), F (samples / frame)
out vec3 vColor;
const float kTie = 1e-3;
float sampleAt(sampler2D t, int i) {
  if (i < 0) return 0.0;
  return texelFetch(t, ivec2(i % uTexW, i / uTexW), 0).r;
}
// Unipolar, rectified: brightness = clamp(|v|, 0, 1). Continuous through 0.
// Quantised here (round(u * 255)) so the RGBA8 write is the same byte the old
// CPU grid stored, whatever rounding the GPU's float-to-unorm step uses.
float level(float v) {
  if (isnan(v) || isinf(v)) return 0.0;
  return floor(clamp(abs(v), 0.0, 1.0) * 255.0 + 0.5) / 255.0;
}
void main() {
  int q = uCell0.x + gl_VertexID;
  int c = q % uCells.x;
  int rAbs = uCell0.y + q / uCells.x;
  int df = rAbs / uCells.y;
  int r = rAbs - df * uCells.y;
  float D = uTiming.x;
  float lineStart = df == 0
    ? uLine0 + float(r - uCell0.y) * D
    : uFrameEnd + float(df - 1) * uTiming.z + float(r) * D;
  float exit = lineStart + float(c + 1) * uTiming.y;
  int s = clamp(uBase + int(ceil(exit - kTie)) - 1, 0, uLast);
  vec3 v = vec3(
    sampleAt(uR, s - uSkip.x),
    sampleAt(uG, s - uSkip.y),
    sampleAt(uB, s - uSkip.z));
  vColor = vec3(level(v.r), level(v.g), level(v.b)) * uHas;
  // Grid texel (c, r), row 0 = top of the picture = texture row 0.
  vec2 grid = vec2(uCells);
  gl_Position = vec4((float(c) + 0.5) / grid.x * 2.0 - 1.0, (float(r) + 0.5) / grid.y * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
