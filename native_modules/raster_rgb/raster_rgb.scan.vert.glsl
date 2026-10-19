#version 300 es
// Scan Grid beam: one point per pixel write (stamp) into the persistent grid.
// Pair: raster_rgb.scan.frag.glsl. Driven by raster-rgb-gl.js scanDraw().
//
// Stamp k of this chunk belongs to sample i = the i with
//   floor(c0 + i*s) <= k < floor(c0 + (i+1)*s)        (s = Scan Speed)
// which is exactly the old JS credit loop (credit += s; stamps = floor).
// Its position is pos0 + k:
//   x = floor((pos0 + k) mod W), line = floor((pos0 + k) / W), y = floor(line mod H)
// with fractional W / H. The chunk start comes split as rem0 = pos0 mod W and
// lineRem0 = floor(pos0 / W) mod H, so the float maths stays small and exact
// for whole and binary-fraction sizes. Chunks are at most 4096 stamps.
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uR;      // R32F, this frame's samples, row-major uTexW wide
uniform sampler2D uG;
uniform sampler2D uB;
uniform int uTexW;
uniform ivec3 uSkip;       // per channel: take - available samples (leading zeros)
uniform vec3 uHas;         // 1 = channel wired
uniform int uSample0;      // first sample of this chunk (index into the frame)
uniform float uCredit0;    // Scan Speed credit at the chunk start, [0, 1)
uniform float uSpeed;      // pixels per sample
uniform float uRem0;       // pos0 mod W
uniform float uLineRem0;   // floor(pos0 / W) mod H
uniform vec2 uLogical;     // W, H (fractional)
uniform vec2 uGrid;        // storage width, height (ceil of W, H)

out vec3 vColor;

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
  float k = float(gl_VertexID);
  // Closed form, then nudged so float rounding can never pick a neighbour.
  int i = int(ceil((k + 1.0 - uCredit0) / uSpeed)) - 1;
  if (i < 0) i = 0;
  if (floor(uCredit0 + float(i + 1) * uSpeed) <= k) i += 1;
  if (i > 0 && floor(uCredit0 + float(i) * uSpeed) > k) i -= 1;
  int s = uSample0 + i;
  vec3 v = vec3(
    sampleAt(uR, s - uSkip.x),
    sampleAt(uG, s - uSkip.y),
    sampleAt(uB, s - uSkip.z));
  vColor = vec3(level(v.r), level(v.g), level(v.b)) * uHas;

  float p = uRem0 + k;
  float dl = floor(p / uLogical.x);
  float col = p - dl * uLogical.x;
  if (col < 0.0) { dl -= 1.0; col += uLogical.x; }
  if (col >= uLogical.x) { dl += 1.0; col -= uLogical.x; }
  float line = uLineRem0 + dl;
  float row = line - floor(line / uLogical.y) * uLogical.y;
  if (row < 0.0) row += uLogical.y;
  if (row >= uLogical.y) row -= uLogical.y;
  float x = min(uGrid.x - 1.0, floor(col));
  float y = min(uGrid.y - 1.0, floor(row));
  // Grid texel (x, y), row 0 = top of the picture = texture row 0.
  gl_Position = vec4((x + 0.5) / uGrid.x * 2.0 - 1.0, (y + 0.5) / uGrid.y * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
