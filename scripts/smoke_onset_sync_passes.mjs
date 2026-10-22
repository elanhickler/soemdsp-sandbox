// 1D Onset Sync with very fast Resets (~1 ms, down to tens of samples): the
// face holds exactly the latest complete pass, the samples from Reset edge N
// to N+1, aligned to the edge sample. One impulse per pass at its exact
// offset; earlier passes never show through or merge, however many passes
// close between paints. Synthetic In / Reset rings at 88.2 kHz.
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

const SR = 88200;
const OFFSET = 17; // impulse sample after each Reset edge
// Gaps like the runaway-triggers patch: a growing run restarted short, plus very short passes.
const gaps = [];
for (let r = 0; r < 6; r += 1) {
  for (let g = 81; g < 400; g = Math.round(g * 1.06)) gaps.push(g);
  gaps.push(30, 24, 45);
}
const resets = [];
let t = 200;
for (const g of gaps) { resets.push(t); t += g; }
const total = t + 50;
const inBuf = new Float32Array(total);
const resetBuf = new Float32Array(total);
for (let i = 0; i < total; i += 1) inBuf[i] = 0.05 * Math.sin(i * 0.3); // quiet bed, never silent
for (const r of resets) { resetBuf[r] = 1; inBuf[r + OFFSET] = 1; }

const ctx = { console, Math, Number, Float32Array, Object, String, Array, JSON, Boolean, Infinity, NaN, Set };
ctx.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
ctx.nodeGraphModuleDefinitions = { onset: { onsetPark: true } };
ctx.nodeGraphScopeBufferAbsoluteFrame = (buf) => buf.abs;
ctx.nodeGraphScopeAvailableSampleCount = (buf) => buf.abs;
ctx.nodeGraphScopeBufferSampleAtAbsoluteFrame = (buf, frame) => (frame >= 0 && frame < buf.abs ? buf[frame] : null);
ctx.nodeGraphScopeSampleRate = () => SR;
ctx.nodeGraphModuleScopeState = { buffers: new Map([["onset-test:Reset", resetBuf]]) };
ctx.nodeGraphModuleScopeNodeForSlot = () => ({ id: "onset-test", type: "onset", params: { position: 0 } });
ctx.nodeGraphModuleScopeNodeParam = () => 0;
vm.createContext(ctx);
for (const f of ["node-graph-module-scope-normalize.js", "node-graph-module-scope-waterfall.js"]) {
  try { vm.runInContext(fs.readFileSync(path.join(root, "public", f), "utf8"), ctx); } catch (e) { if (f.includes("waterfall")) throw e; }
}
let wipes = 0;
ctx.nodeGraphOnsetGlStrokePolyline = () => true;
ctx.nodeGraphWaterfallGlReset = () => { wipes += 1; return true; };
ctx.nodeGraphWaterfallGlEnsure = () => true;
ctx.nodeGraphWaterfallGlClearColumn = () => true;
ctx.nodeGraphWaterfallGlPresent = () => true;
ctx.nodeGraphWaterfallGlStampBar = () => true;
ctx.nodeGraphDisplayGlFailed = () => {};

const canvas = { width: 64, height: 100, _wfGlSession: { smooth: true } };
const settings = { scale: 1, historySeconds: 0.25, polarity: "bipolar", barInk: "both", resetSync: true, historyPercent: 100, autoRange: false };
const spec = { canvas, settings, buffer: inBuf, slot: { type: "onset", nodeId: "onset-test" }, bg: "#000000" };

const steps = [37, 512, 23, 1500, 90, 333, 2048, 61];
let abs = 0;
let checked = 0;
let bad = 0;
const shown = new Set();
for (let k = 0; abs < total; k += 1) {
  abs = Math.min(total, abs + steps[k % steps.length]);
  inBuf.abs = abs;
  resetBuf.abs = abs;
  ctx.nodeGraphWaterfallPaint(spec);
  const done = resets.filter((r) => r < abs);
  if (done.length < 2) continue;
  // Latest complete pass [a, b): b is the newest Reset edge already in the ring.
  const b = done[done.length - 1];
  const a = done[done.length - 2];
  const o = canvas._onset;
  const pts = [];
  for (const tr of Object.values(o.traces || {})) {
    for (const col of tr.columns || []) {
      if (!col?.first) continue;
      for (const p of [col.first, col.min, col.max, col.last]) pts.push(p.frame);
    }
  }
  const frames = [...new Set(pts)];
  const hits = frames.filter((f) => inBuf[f] === 1);
  const ok = o.origin === a && o.latchedSamples === b - a
    && frames.every((f) => f >= a && f < b)
    && hits.length === 1 && hits[0] - a === OFFSET;
  if (!ok && bad < 4) console.log("  pass", { abs, a, b, origin: o.origin, len: o.latchedSamples, min: Math.min(...frames), max: Math.max(...frames), hits: hits.map((h) => h - a) });
  if (!ok) bad += 1;
  checked += 1;
  shown.add(a);
}
gate(checked > 20 && bad === 0, `each paint shows exactly the latest complete pass [edge N, edge N+1), one impulse at +${OFFSET} samples (${checked} paints, ${bad} bad)`);
gate(shown.size > 10 && shown.size < resets.length, `passes closed between paints are skipped, not merged (${shown.size} of ${resets.length} shown)`);
gate(wipes >= shown.size, `every new pass starts on a clean face (${wipes} wipes for ${shown.size} passes)`);

// History 50 %: the pass still starts on its edge and shows its first half.
settings.historyPercent = 50;
canvas._onset = null;
inBuf.abs = resetBuf.abs = total;
ctx.nodeGraphWaterfallPaint(spec);
const last = [resets[resets.length - 2], resets[resets.length - 1]];
gate(canvas._onset.origin === last[0] && canvas._onset.latchedSamples === Math.round((last[1] - last[0]) * 0.5), "History % scales the pass's own sample gap");

// Sync off: Reset arms a pass of History seconds (unchanged behavior).
settings.resetSync = false;
settings.historyPercent = 100;
canvas._onset = null;
inBuf.abs = resetBuf.abs = 1000;
ctx.nodeGraphWaterfallPaint(spec);
gate(canvas._onset.latchedSamples === Math.round(SR * 0.25), "Sync off: History seconds sets the pass");

console.log(failures ? `FAILED ${failures}` : "smoke_onset_sync_passes ok");
process.exit(failures ? 1 : 0);
