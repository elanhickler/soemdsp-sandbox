// 1D Onset Sync, synthetic In / Reset rings at 88.2 kHz.
// Fast Resets (~1 ms, down to tens of samples), several per paint: the face
// holds exactly the latest complete pass, Reset edge N to N+1, aligned to
// the edge sample, one impulse at its exact offset. One new edge per paint
// (slow Resets): a fresh live trace from that exact sample, History % of the
// previous gap long, drawn progressively; no earlier pass shows through.
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

const notedFrames = () => {
  const pts = [];
  for (const tr of Object.values(canvas._onset.traces || {})) {
    for (const col of tr.columns || []) {
      if (!col?.first) continue;
      for (const p of [col.first, col.min, col.max, col.last]) pts.push(p.frame);
    }
  }
  return [...new Set(pts)];
};
// Paint in steps; expect per paint: >= 2 new edges -> latest complete pass,
// 1 new edge -> live trace from it (length = previous gap), 0 -> unchanged.
const runSteps = (steps, label) => {
  canvas._onset = null;
  let abs = 0;
  let prevAbs = 0;
  const checked = { complete: 0, live: 0, hold: 0 };
  let bad = 0;
  let last = null;
  const wipes0 = wipes;
  let arms = 0;
  for (let k = 0; abs < total; k += 1) {
    prevAbs = abs;
    abs = Math.min(total, abs + steps[k % steps.length]);
    inBuf.abs = abs;
    resetBuf.abs = abs;
    ctx.nodeGraphWaterfallPaint(spec);
    const fresh = resets.filter((r) => r >= prevAbs && r < abs);
    const done = resets.filter((r) => r < abs);
    const o = canvas._onset;
    let want;
    if (fresh.length >= 2) {
      const b = done[done.length - 1]; const a = done[done.length - 2];
      want = { origin: a, len: b - a, kind: "complete" };
    } else if (fresh.length === 1 && done.length >= 2) {
      const b = done[done.length - 1]; const a = done[done.length - 2];
      want = { origin: b, len: b - a, kind: "live" };
    } else if (fresh.length === 0 && last) {
      want = { ...last, kind: "hold" };
    } else continue;
    if (want.kind !== "hold") arms += 1;
    const frames = notedFrames();
    const end = Math.min(abs, want.origin + want.len);
    const hits = frames.filter((f) => inBuf[f] === 1);
    const expectHit = want.origin + OFFSET < end;
    const ok = o.origin === want.origin && o.latchedSamples === want.len
      && frames.every((f) => f >= want.origin && f < end)
      && (expectHit ? hits.length === 1 && hits[0] - want.origin === OFFSET : hits.length === 0)
      && (end <= want.origin || Math.max(...frames) === end - 1);
    if (!ok && bad < 4) console.log("  ", label, want, { abs, origin: o.origin, len: o.latchedSamples, min: Math.min(...frames), max: Math.max(...frames), hits: hits.map((h) => h - want.origin) });
    if (!ok) bad += 1;
    checked[want.kind] += 1;
    last = { origin: want.origin, len: want.len };
  }
  return { checked, bad, wipes: wipes - wipes0, arms };
};
const fast = runSteps([37, 512, 23, 1500, 90, 333, 2048, 61], "fast");
gate(fast.checked.complete > 10 && fast.bad === 0, `fast Resets: several per paint -> exactly the latest complete pass [edge N, N+1), one impulse at +${OFFSET} (${JSON.stringify(fast.checked)}, ${fast.bad} bad)`);
gate(fast.wipes >= fast.arms, `every new pass starts on a clean face (${fast.wipes} wipes / ${fast.arms} arms)`);
const slow = runSteps([7, 11, 5, 13], "slow");
gate(slow.checked.live > 50 && slow.checked.complete === 0 && slow.bad === 0, `slow Resets: each edge starts a live trace at its exact sample, previous-gap long, every new sample drawn (${JSON.stringify(slow.checked)}, ${slow.bad} bad)`);
gate(slow.wipes >= slow.arms, `each live trace starts on a clean face (${slow.wipes} wipes / ${slow.arms} arms)`);

// History 50 %: the pass still starts on its edge and shows its first half.
settings.historyPercent = 50;
canvas._onset = null;
inBuf.abs = resetBuf.abs = total;
ctx.nodeGraphWaterfallPaint(spec);
const lastPair = [resets[resets.length - 2], resets[resets.length - 1]];
gate(canvas._onset.origin === lastPair[0] && canvas._onset.latchedSamples === Math.round((lastPair[1] - lastPair[0]) * 0.5), "History % scales the Reset gap");

// First Reset only (no gap yet): live trace of History seconds from the edge.
settings.historyPercent = 100;
canvas._onset = null;
inBuf.abs = resetBuf.abs = resets[0] + 40;
ctx.nodeGraphWaterfallPaint(spec);
gate(canvas._onset.origin === resets[0] && canvas._onset.latchedSamples === Math.round(SR * 0.25), "first Reset: live trace, History seconds long");

// Sync off: Reset arms a pass of History seconds (unchanged behavior).
settings.resetSync = false;
settings.historyPercent = 100;
canvas._onset = null;
inBuf.abs = resetBuf.abs = 1000;
ctx.nodeGraphWaterfallPaint(spec);
gate(canvas._onset.latchedSamples === Math.round(SR * 0.25), "Sync off: History seconds sets the pass");

console.log(failures ? `FAILED ${failures}` : "smoke_onset_sync_passes ok");
process.exit(failures ? 1 : 0);
