// 1D Onset honours Ink: fill stamps min..max columns, stroke draws the line, both does both.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures += 1;
};

const glSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall-gl.js"), "utf8");
gate(glSrc.includes("vHalf + 0.5 - dist"), "onset line uses the filled-edge 1px box filter");

const ctx = {
  console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Infinity, NaN,
};
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
ctx.nodeGraphModuleDefinitions = { onset: { onsetPark: true } };
ctx.nodeGraphScopeBufferAbsoluteFrame = (buf) => buf.nodeGraphScopeAbsoluteFrame || buf.length || 0;
ctx.nodeGraphScopeAvailableSampleCount = (buf) => buf.length || 0;
ctx.nodeGraphScopeBufferSampleAtAbsoluteFrame = (buf, frame) => {
  if (buf.nodeGraphScopeDropped) return null;
  const i = Math.floor(frame);
  if (i < 0 || i >= buf.length) return null;
  return buf[i];
};
ctx.nodeGraphScopeSampleRate = () => 1000;
ctx.nodeGraphModuleScopeState = { buffers: new Map() };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall.js"), "utf8"), ctx);

const lines = [];
let resets = 0;
ctx.nodeGraphOnsetGlStrokePolyline = (_canvas, pts) => {
  lines.push(pts.map((p) => ({ x: p.x, y: p.y })));
  return true;
};
ctx.nodeGraphWaterfallGlReset = () => { resets += 1; return true; };
ctx.nodeGraphWaterfallGlEnsure = () => true;
ctx.nodeGraphWaterfallGlClearColumn = () => true;
ctx.nodeGraphWaterfallGlPresent = () => true;
ctx.nodeGraphDisplayGlFailed = () => {};

const width = 8;
const height = 100;
const n = 64;
const samples = new Float32Array(n);
for (let i = 0; i < n; i += 1) samples[i] = 0.25 + 0.25 * (i / (n - 1));
samples.nodeGraphScopeAbsoluteFrame = n;
const canvas = { width, height, _wfGlSession: { smooth: true } };
const settings = { scale: 1, historySeconds: n / 1000, polarity: "bipolar", barInk: "fill" };
const spec = {
  canvas,
  settings,
  buffer: samples,
  slot: { type: "onset", nodeId: "onset-test" },
  bg: "#000000",
};

//let bars = [];
let bars = [];
ctx.nodeGraphWaterfallGlStampBar = (_c, x, _w, ys) => { bars.push({ x, y0: ys.y0, y1: ys.y1 }); };
const paint = () => ctx.nodeGraphWaterfallPaint(spec);
const run = (ink) => {
  canvas._onset = null; lines.length = 0; bars = [];
  samples.nodeGraphScopeDropped = false; samples.nodeGraphScopeAbsoluteFrame = n;
  settings.barInk = ink; settings.scale = 1;
  paint();
  return { lines: lines.length, bars: bars.length };
};
const fill = run("fill");
gate(fill.bars >= width && fill.lines === 0, `Ink fill stamps filled columns, no line (${fill.bars} bars, ${fill.lines} lines)`);
gate(bars.every((b) => b.y1 > b.y0), "filled columns have height");
const both = run("both");
gate(both.bars >= width && both.lines > 0, `Ink both stamps fill and line (${both.bars}, ${both.lines})`);
const stroke = run("stroke");
gate(stroke.bars === 0 && stroke.lines > 0, `Ink stroke draws only the line (${stroke.bars}, ${stroke.lines})`);
settings.autoRange = true;
const auto = run("fill");
gate(auto.bars >= width, `Auto Range still fills (${auto.bars})`);
console.log(failures ? `FAILED ${failures}` : "smoke_onset_fill ok");
process.exit(failures ? 1 : 0);