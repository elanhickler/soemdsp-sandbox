#version 300 es
// Scan Grid beam write. Pair: raster_rgb.scan.vert.glsl
// Opaque overwrite: a pixel keeps its colour until the beam writes it again
// (no decay, no beam spot). Later stamps in a draw win (primitive order).
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor, 1.0);
}
