// Smoke: WebGL-only module faces converted from Canvas2D (docs/WEBGL_DISPLAY_PLAN.md).
// Additive Generator / Bubble waveform, Additive Blaster blocks, Additive filter
// curve: real gl-line-renderer.js + display-canvas.js on a fake shared picture
// device. Gates: one GL draw, no 2D drawing; no GL -> plain black square.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

const glLog = { verts: [], draws: 0, clear: null };
const fakeGl = new Proxy({
  isContextLost: () => false,
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getAttribLocation: (_p, n) => ["position", "local", "segLen", "halfPx", "feather", "colour"].indexOf(n),
  clearColor: (r, g, b) => { glLog.clear = [r, g, b].map((v) => Math.round(v * 255)).join(","); },
  bufferData: (_t, d) => { glLog.verts = Array.from(d); },
  drawArrays: () => { glLog.draws += 1; },
}, { get: (t, k) => (k in t ? t[k] : (typeof k === "string" && k === k.toUpperCase() ? 1 : () => ({}))) });
let glOn = true;
const graph = { ratio: [1, 2, 3, 4], amplitude: [1, 0.5, 0.3, 0.2], phase: [0, 0.25, 0.5, 0.75], frequencyHz: 110 };
const ctx = {
  console, Math, Number, Float32Array, Object, String, Array, JSON, parseInt, parseFloat,
  document: { createElement: () => ({ className: "", classList: { add() {} } }) },
  nodeGraphPictureDevice: () => (glOn ? { gl: fakeGl, canvas: { height: 4096 } } : null),
  nodeGraphSharedGlBlitTo2D: () => true,
  nodeGraphFiniteNumber: (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb),
  nodeGraphPatchNode: () => ({ params: { quantization: 4, cutoff: 1000, slope: 12 } }),
  nodeGraphDataBus: { get: () => graph },
  nodeGraphMvp: { sampleRate: 48000, patch: { connections: [] } },
  additiveGraphBakeWaveform: (_g, out) => { for (let i = 0; i < out.length; i += 1) out[i] = Math.sin((i / out.length) * Math.PI * 2); },
  additiveGraphClonePayload: (g) => ({ ...g }),
  additiveGraphBlasterBins: () => [0, 1, 2, 3].map((b) => ({ start: b, end: b + 1, phase: b * 0.25, t0: b / 4, t1: (b + 1) / 4 })),
  additiveGraphFilterResponseCurveLogHz: (_m, _c, _s, _k, _sk, _sr, n) => ({ ys: Array.from({ length: n }, (_, i) => 1 - i / n), cutoffT: 0.5 }),
  faceMinSide: (w, h) => Math.min(w, h), faceFracPx: (f, s) => f * s, faceInkPx: (px) => px,
  nodeGraphInstallDrawingFacePump: () => {},
};
ctx.nodeGraphSizeDisplayCanvas = (_s, canvas) => { canvas.width = 400; canvas.height = 120; return { width: 400, height: 120, cssWidth: 200, cssHeight: 60, pixelRatio: 2 }; };
vm.createContext(ctx);
for (const rel of [
  "lib/visual/display-canvas.js",
  "lib/visual/gl-line-renderer.js",
  "modules/additiveGenerator/additive-waveform-display.js",
  "modules/additiveGrowl/additive-bubble-display.js",
  "modules/additiveBlaster/additive-blaster-display.js",
  "modules/additiveGraph/additive-filter-curve-display.js",
]) vm.runInContext(fs.readFileSync(path.join(root, "public", rel), "utf8"), ctx);

gate(JSON.stringify(ctx.nodeGraphGlLinesCss("#ff8000")) === JSON.stringify([1, 128 / 255, 0, 1]), "css hex -> rgba01");
gate(ctx.nodeGraphGlLinesCss("rgba(255, 0, 0, 0.5)")[3] === 0.5, "css rgba alpha");
const hsl = ctx.nodeGraphGlLinesHsl(120, 1, 0.5);
gate(Math.abs(hsl[0]) < 1e-9 && Math.abs(hsl[1] - 1) < 1e-9 && Math.abs(hsl[2]) < 1e-9, "hsl(120,100%,50%) = green");

function face(draw, label, colour) {
  const fills = [];
  const canvas = { width: 0, height: 0, classList: { add() {} }, getContext: () => ({ setTransform() {}, fillRect(...a) { fills.push([this.fillStyle, ...a]); } }) };
  const section = { dataset: { node: "n1", nodeType: label === "filter" ? "additiveLinearFilter" : "" }, querySelector: () => canvas };
  glOn = true; glLog.draws = 0; glLog.verts = [];
  ctx[draw](section);
  const cols = new Set();
  let maxX = 0;
  for (let i = 0; i < glLog.verts.length; i += 11) {
    cols.add(glLog.verts.slice(i + 7, i + 10).map((v) => Math.round(v * 255)).join(","));
    maxX = Math.max(maxX, glLog.verts[i]);
  }
  gate(glLog.draws >= 1 && fills.length === 0, `${label}: GL draw, no 2D drawing`);
  if (colour) gate(cols.has(colour), `${label}: ink colour ${colour}`);
  gate(maxX <= 1.05 && glLog.verts.length > 0, `${label}: CSS coords scaled by pixelRatio into the device canvas`);
  glOn = false;
  section._curveSig = "";
  section._forceDraw = true;
  ctx[draw](section);
  gate(fills.length === 1 && fills[0][0] === "#000", `${label}: no GL -> plain black square`);
}
face("drawNodeGraphAdditiveWaveformDisplay", "waveform", "255,210,40");
face("drawNodeGraphAdditiveBubbleDisplay", "bubble", "255,210,40");
face("drawNodeGraphAdditiveBlasterDisplay", "blaster", null);
face("drawNodeGraphAdditiveFilterCurveDisplay", "filter", "255,230,0");
console.log(failures ? `FAILED ${failures}` : "smoke_display_gl_batch ok");
if (failures) process.exit(1);
