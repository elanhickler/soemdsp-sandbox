// Sabrina Reverb delay lines. Pair: sabrina_reverb.vert.glsl
// 1 px core, then 2 px of feather. Overlap is additive in the drawer.

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec4 colour;
uniform float halfPx;
varying float vDist;
void main() {
  float a = 1.0 - smoothstep(halfPx, halfPx + 2.0, abs(vDist));
  gl_FragColor = vec4(colour.rgb, a);
}
