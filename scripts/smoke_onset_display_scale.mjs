// 1D Onset stroke: per-column first / min / max / last at their own sample x,
// and Scale replays that line after the scope ring has dropped the samples.
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
const glSession = (w, h) => ({ gl: stubGl, read: { fbo: {} }, w, h });
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
const settings = { scale: 1, historySeconds: n / 1000, polarity: "bipolar", barInk: "stroke", pauseAtEnd: true };
const spec = { canvas, settings, buffer: samples, slot: { type: "onset", nodeId: "onset-test" }, bg: "#000000" };
const lines = () => glCalls.draws.flatMap((d) => d.strokes).map((s) => s.pts);
const paint = () => ctx.nodeGraphWaterfallPaint(spec);
gate(paint() === true, "first onset pass paints");
gate(canvas._onset && canvas._onset.parked === true, "pass parks after one face");
const first = lines()[0] || [];
gate(lines().length === 1 && first.length > width && first.length <= width * 4, `pixel line is shorter than the buffer (${first.length} points, ${n} samples)`);
gate(first.length > 2 && first[0].y > first[first.length - 1].y + 5, "the line follows the ramp across the face");
gate(first[0] && Math.abs(first[0].y - 37.5) < 0.6, `scale 1 starts near 37.5 (${first[0] && first[0].y.toFixed(2)})`);
gate(first[first.length - 1] && first[first.length - 1].x > first[0].x, "samples march across the face");

glCalls.draws = [];
resets = 0;
samples.nodeGraphScopeDropped = true;
samples.nodeGraphScopeAbsoluteFrame = 100000;
gate(paint() === true, "parked pass still presents after the ring drops the samples");
gate(resets === 0 && lines().length === 0, "same Scale does not redraw the parked line");

settings.scale = 2;
gate(paint() === true, "Scale change replays the stored columns");
gate(resets === 1, "Scale change clears the plate once");
const second = lines()[0] || [];
gate(second.length === first.length, `scale 2 keeps the same pixel line (${second.length})`);
gate(second[0] && second[0].y < 30 && second[0].y > 20, `scale 2 lifts the first sample (${second[0] && second[0].y.toFixed(2)})`);

console.log(failures ? `FAILED ${failures}` : "smoke_onset_display_scale ok");
process.exit(failures ? 1 : 0);
