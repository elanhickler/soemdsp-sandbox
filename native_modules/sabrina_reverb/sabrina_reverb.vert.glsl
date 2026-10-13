// Sabrina Reverb delay lines. Pair: sabrina_reverb.frag.glsl
// Times stay in sabrina_reverb.cpp (sabrinaFillDelay01). This only draws them.

attribute vec2 position;
attribute float distPx;
varying float vDist;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  vDist = distPx;
}
