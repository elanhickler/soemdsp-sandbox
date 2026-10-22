// 1D Onset honours Ink: fill fills under the outline, stroke draws the line, both does both.
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

const wfSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-scope-waterfall.js"), "utf8");
gate(/nodeGraphGlLinesPolyline\(batch, flat, half, 1, rgba\)/.test(wfSrc) && !/nodeGraphOnsetGlStrokePolyline\(canvas, runs/.test(wfSrc), "1D Onset strokes with the shared antialiased GL line drawer");

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
vm.runInContext(wfSrc, ctx);

// Shared GL line drawer stub: each DrawInto hands back the batch.
const glCalls = { draws: [], scissor: null };
const flatPts = (flat) => { const out = []; for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] }); return out; };
ctx.nodeGraphGlLinesBegin = (c) => ({ w: c.width, h: c.height, strokes: [], hairlines: [], fills: [] });
ctx.nodeGraphGlLinesPolyline = (b, flat, half, feather, rgba) => (feather === 1 ? b.strokes : b.hairlines).push({ pts: flatPts(flat), half, rgba });
ctx.nodeGraphGlLinesDot = (b, x, y, r, _f, rgba) => b.strokes.push({ pts: [{ x, y }], half: r, rgba });
ctx.nodeGraphGlLinesFillUnder = (b, flat, base, rgba) => b.fills.push({ pts: flatPts(flat), base, rgba });
ctx.nodeGraphGlLinesDrawInto = (b) => { b.clip = glCalls.scissor; glCalls.draws.push(b); return true; };
ctx.nodeGraphWaterfallGlFlush = () => {};
const stubGl = {
  FRAMEBUFFER: 1, SCISSOR_TEST: 2,
  bindFramebuffer() {}, viewport() {}, enable() {},
  disable(k) { if (k === 2) glCalls.scissor = null; },
  scissor(x) { glCalls.scissor = x; },
};
const glSession = (w, h) => ({ smooth: true, gl: stubGl, read: { fbo: {} }, w, h });
let resets = 0;
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
const canvas = { width, height, _wfGlSession: glSession(width, height) };
const settings = { scale: 1, historySeconds: n / 1000, polarity: "bipolar", barInk: "fill" };
const spec = { canvas, settings, buffer: samples, slot: { type: "onset", nodeId: "onset-test" }, bg: "#000000" };
const run = (ink) => {
  canvas._onset = null; glCalls.draws = [];
  settings.barInk = ink; settings.scale = 1;
  ctx.nodeGraphWaterfallPaint(spec);
  const all = (k) => glCalls.draws.flatMap((d) => d[k]);
  return { fills: all("fills"), strokes: all("strokes"), hairlines: all("hairlines") };
};
const fill = run("fill");
gate(fill.fills.length > 0 && fill.strokes.length === 0, `Ink fill fills under the outline, no stroke (${fill.fills.length} fills, ${fill.strokes.length} strokes)`);
gate(fill.fills.every((f) => f.pts.some((p) => Math.abs(p.y - f.base) > 1)), "fill has height (outline away from the zero line)");
gate(fill.hairlines.length === fill.fills.length, "fill alone gets an antialiased hairline edge");
const both = run("both");
gate(both.fills.length > 0 && both.strokes.length > 0, `Ink both fills and strokes (${both.fills.length}, ${both.strokes.length})`);
gate(JSON.stringify(both.fills.map((f) => f.pts)) === JSON.stringify(both.strokes.map((s) => s.pts)), "the fill follows the stroke outline exactly");
const stroke = run("stroke");
gate(stroke.fills.length === 0 && stroke.strokes.length > 0, `Ink stroke draws only the line (${stroke.fills.length}, ${stroke.strokes.length})`);
settings.autoRange = true;
const auto = run("fill");
gate(auto.fills.length > 0, `Auto Range still fills (${auto.fills.length})`);
settings.autoRange = false;
settings.polarity = "bottomFill";
const bottom = run("fill");
gate(bottom.fills.every((f) => f.base === height), "Bottom fill fills to the bottom edge");
console.log(failures ? `FAILED ${failures}` : "smoke_onset_fill ok");
process.exit(failures ? 1 : 0);
