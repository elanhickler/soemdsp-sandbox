// 1D Onset sweep, synthetic In / Reset rings at 88.2 kHz, Sync on.
// Each Reset restarts the write cursor at x = 0 on its exact sample and
// overwrites column by column; old ink stays ahead of the cursor, nothing is
// cleared at a Reset. Fast Resets (several per paint) and slow ones must both
// match a sample-accurate sweep after every paint, and every Reset-aligned
// impulse lands at the same x (History seconds is the one fixed scale).
// Zoomed in the stroke is a smooth sub-pixel curve; zoomed out an envelope.
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
const FACE = 300; // History in samples: some Reset gaps are longer, some much shorter
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
let peaks = [];
let peakY = Infinity;
const notePeaks = () => {
  for (const d of glCalls.draws) for (const st of d.strokes) for (const p of st.pts) {
    if (p.y < peakY - 1e-9) { peakY = p.y; peaks = []; }
    if (Math.abs(p.y - peakY) < 1e-9) peaks.push(p.x);
  }
  glCalls.draws = [];
};
ctx.nodeGraphWaterfallGlReset = () => { wipes += 1; return true; };
ctx.nodeGraphWaterfallGlEnsure = () => true;
ctx.nodeGraphWaterfallGlClearColumn = () => true;
ctx.nodeGraphWaterfallGlPresent = () => true;
ctx.nodeGraphWaterfallGlStampBar = () => true;
ctx.nodeGraphDisplayGlFailed = () => {};

const canvas = { width: 64, height: 100, _wfGlSession: glSession(64, 100) };
const settings = { scale: 1, polarity: "bipolar", barInk: "both", resetSync: true, autoRange: false, historySeconds: FACE / SR };
const spec = { canvas, settings, buffer: inBuf, slot: { type: "onset", nodeId: "onset-test" }, bg: "#000000" };


const W = canvas.width;
const colOf = (rel) => Math.min(W - 1, Math.floor((rel / FACE) * W));
// Sample-accurate reference: every sample, in order, written into its pass's
// column; a Reset restarts at column 0 and overwrites only what it reaches.
const reference = (abs) => {
  const cols = new Array(W).fill(null);
  let r = -1;
  for (let f = 0; f < abs; f += 1) {
    if (resetBuf[f] === 1) r = f;
    if (r < 0 || f - r >= FACE) continue;
    const c = colOf(f - r);
    if (!cols[c] || cols[c].origin !== r) cols[c] = { origin: r, frames: [] };
    cols[c].frames.push(f);
  }
  return cols;
};
const runSteps = (steps, label) => {
  canvas._onset = null;
  const wipes0 = wipes;
  let abs = 0;
  let bad = 0;
  let paints = 0;
  let multi = 0;
  let aheadOld = 0;
  const impulseX = new Set();
  peaks = []; peakY = Infinity; glCalls.draws = [];
  for (let k = 0; abs < total; k += 1) {
    const prev = abs;
    abs = Math.min(total, abs + steps[k % steps.length]);
    inBuf.abs = abs;
    resetBuf.abs = abs;
    ctx.nodeGraphWaterfallPaint(spec);
    notePeaks();
    paints += 1;
    if (resets.filter((r) => r >= prev && r < abs).length >= 2) multi += 1;
    const ref = reference(abs);
    const cols = canvas._onset.traces ? Object.values(canvas._onset.traces)[0].columns : [];
    for (let c = 0; c < W; c += 1) {
      const got = cols[c]?.first ? cols[c] : null;
      const want = ref[c];
      let ok = !got === !want;
      if (ok && want) {
        const fr = want.frames;
        let mn = fr[0]; let mx = fr[0];
        for (const f of fr) { if (inBuf[f] < inBuf[mn]) mn = f; if (inBuf[f] > inBuf[mx]) mx = f; }
        ok = got.origin === want.origin && got.first.frame === fr[0] && got.last.frame === fr[fr.length - 1]
          && inBuf[got.min.frame] === inBuf[mn] && inBuf[got.max.frame] === inBuf[mx];
      }
      if (!ok) { if (bad < 4) console.log("  ", label, { abs, c, got: got && { o: got.origin, f: got.first.frame }, want: want && { o: want.origin, f: want.frames[0] } }); bad += 1; }
      if (got && inBuf[got.max.frame] === 1) impulseX.add(`${c}:${got.max.frame - got.origin}`);
    }
    // Old ink ahead of the cursor: a column right of the write cursor still
    // holds an earlier pass.
    const o = canvas._onset.origin;
    const cursor = colOf(Math.min(FACE - 1, abs - 1 - o));
    if (cols.some((col, c) => c > cursor && col?.first && col.origin < o)) aheadOld += 1;
  }
  return { bad, paints, multi, aheadOld, wipes: wipes - wipes0, impulseX: [...impulseX], peakX: [...new Set(peaks.map((x) => x.toFixed(6)))] };
};
const wantX = `${colOf(OFFSET)}:${OFFSET}`;
const peakWant = ((OFFSET / FACE) * W).toFixed(6);
for (const [label, steps] of [["fast", [37, 512, 23, 1500, 90, 333, 2048, 61]], ["slow", [7, 11, 5, 13]]]) {
  const r = runSteps(steps, label);
  gate(r.bad === 0, `${label} Resets: after every paint the face equals a sample-accurate sweep (${r.paints} paints, ${r.multi} with several Resets, ${r.bad} bad columns)`);
  gate(r.wipes === 0, `${label} Resets: a Reset never clears the face (${r.wipes} full clears)`);
  gate(r.aheadOld > 0, `${label} Resets: old ink stays ahead of the cursor (${r.aheadOld} paints)`);
  gate(r.impulseX.length === 1 && r.impulseX[0] === wantX, `${label} Resets: every impulse in the same column, ${OFFSET} samples after its Reset (${r.impulseX.join(" ")})`);
  gate(r.peakX.length === 1 && r.peakX[0] === peakWant, `${label} Resets: every drawn impulse peak at the same x (${r.peakX.join(" ")})`);
}

// First Reset: the same x scale as every later pass (no fallback window).
canvas._onset = null;
inBuf.abs = resetBuf.abs = resets[0] + 40;
ctx.nodeGraphWaterfallPaint(spec);
gate(canvas._onset.origin === resets[0] && canvas._onset.latchedSamples === FACE, "first Reset: same History window, cursor at the Reset sample");

// History changed: the one full clear, then the pass replays on the new scale.
const w0 = wipes;
settings.historySeconds = (FACE / 2) / SR;
inBuf.abs = resetBuf.abs = resets[0] + 60;
ctx.nodeGraphWaterfallPaint(spec);
gate(wipes - w0 === 1 && canvas._onset.latchedSamples === FACE / 2, "History change: one clear, new scale");
settings.historySeconds = FACE / SR;

// Sync off: History seconds sets the pass; a Reset still starts it.
settings.resetSync = false;
canvas._onset = null;
inBuf.abs = resetBuf.abs = resets[3] + 5;
ctx.nodeGraphWaterfallPaint(spec);
gate(canvas._onset.latchedSamples === FACE && canvas._onset.origin === resets[3], "Sync off: History seconds sets the pass");

// Zoomed in (a sample every ~9 px): the stroke is a smooth curve through the
// samples at sub-pixel x, stepped at most a pixel, never a stair (no flat run
// then a jump). The fill outline is the same curve.
{
  const SPAN = 64;
  const sine = new Float32Array(SPAN + 2000);
  const rs = new Float32Array(SPAN + 2000);
  for (let i = 0; i < sine.length; i += 1) sine[i] = 0.8 * Math.sin((i - 100) * 0.7);
  rs[100] = 1;
  sine.abs = rs.abs = 100 + 8;
  ctx.nodeGraphModuleScopeState.buffers.set("onset-test:Reset", rs);
  const s2 = { scale: 1, polarity: "bipolar", barInk: "both", resetSync: true, autoRange: false, historySeconds: 7 / SR };
  const c2 = { width: 64, height: 100, _wfGlSession: glSession(64, 100) };
  const sp2 = { canvas: c2, settings: s2, buffer: sine, slot: spec.slot, bg: "#000000" };
  glCalls.draws = [];
  for (let k = 0; k < 8; k += 1) { ctx.nodeGraphWaterfallPaint(sp2); sine.abs += 1; rs.abs += 1; }
  const strokes = glCalls.draws.flatMap((d) => d.strokes.map((st) => ({ pts: st.pts, clip: d.clip })));
  const fills = glCalls.draws.flatMap((d) => d.fills.map((f) => f.pts));
  let steps = 0; let wide = 0; let back = 0; let stairs = 0; let kinks = 0;
  for (const { pts } of strokes) {
    for (let i = 1; i < pts.length; i += 1) {
      const dx = pts[i].x - pts[i - 1].x;
      steps += 1;
      if (dx > 1 + 1e-9) wide += 1;
      if (dx <= 1e-9) back += 1;
      // A stair: a flat step next to a step at least 4x steeper.
      if (i > 1) {
        const s0 = (pts[i - 1].y - pts[i - 2].y) / (pts[i - 1].x - pts[i - 2].x);
        const s1 = (pts[i].y - pts[i - 1].y) / dx;
        if ((Math.abs(s0) < 1e-3 && Math.abs(s1) > 2) || (Math.abs(s1) < 1e-3 && Math.abs(s0) > 2)) stairs += 1;
        if (Math.abs(s1 - s0) > 3) kinks += 1;
      }
    }
  }
  const xs = strokes.flatMap((st) => st.pts.map((p) => p.x));
  const subPx = xs.filter((x) => Math.abs(x - Math.round(x)) > 1e-3).length;
  gate(steps > 40 && wide === 0 && back === 0, `zoomed in: stroke steps right by at most 1 px, never back (${steps} steps, ${wide} wide, ${back} back)`);
  gate(stairs === 0 && kinks === 0, `zoomed in: no stair steps or kinks along the curve (${stairs} stairs, ${kinks} kinks)`);
  gate(subPx > 0, `zoomed in: points sit at sub-pixel x (${subPx} of ${xs.length})`);
  gate(JSON.stringify(fills) === JSON.stringify(strokes.map((st) => st.pts)), "zoomed in: the fill outline is the stroke curve");
  // Every sample is on the curve (interpolated, not approximated away).
  const W2 = 64;
  let missed = 0;
  for (let f = 100; f < 107; f += 1) {
    const x = ((f - 100) / 7) * W2;
    const y = ctx.nodeGraphOnsetTraceY(sine[f], sine, spec.slot, s2, 100, ctx.nodeGraphOnsetStrokeCanvasPx(c2, s2), null);
    if (!strokes.some((st) => st.pts.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6))) missed += 1;
  }
  gate(missed === 0, `zoomed in: the curve passes through every sample (${missed} missed)`);
  // Zoomed out: one impulse among 20000 samples per face still reaches its peak.
  const big = new Float32Array(30000);
  const rb = new Float32Array(30000);
  rb[50] = 1; big[50 + 9001] = 1;
  big.abs = rb.abs = 30000;
  ctx.nodeGraphModuleScopeState.buffers.set("onset-test:Reset", rb);
  s2.historySeconds = 20000 / SR;
  c2._onset = null;
  glCalls.draws = [];
  ctx.nodeGraphWaterfallPaint({ ...sp2, buffer: big });
  const peakYWant = ctx.nodeGraphOnsetTraceY(1, big, spec.slot, s2, 100, ctx.nodeGraphOnsetStrokeCanvasPx(c2, s2), null);
  const hit = glCalls.draws.flatMap((d) => d.strokes).some((st) => st.pts.some((p) => Math.abs(p.y - peakYWant) < 1e-6));
  gate(hit, "zoomed out: the min / max envelope keeps a one-sample peak");
  ctx.nodeGraphModuleScopeState.buffers.set("onset-test:Reset", resetBuf);
}

if (failures) {
  console.error(`smoke_onset_sync_passes: ${failures} failure(s)`);
  process.exit(1);
}
console.log("smoke_onset_sync_passes ok");
