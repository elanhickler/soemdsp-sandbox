// Pulse Train v22 shapes + Morph: old shapes bit-identical at Morph 0.5 (and
// omitted), TriSaw peak sweep, Pulse Left / Center / Right, Rect Sine is the
// shared math/rect_sine.h hump (bipolar, zero-mean), preview (face) unchanged,
// Recalculate On latches Morph. Optional: PT_OLD_WASM = pre-v22 pulse_train.wasm.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), { env: { emo_process_block: () => 0 } })).instance.exports;
const S = await load(path.join(root, "native_modules", "pulse_train", "pulse_train.wasm"));
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const OLD = process.env.PT_OLD_WASM ? await load(process.env.PT_OLD_WASM) : null;
const SR = 48000;
const fail = (m) => { console.error("FAIL " + m); process.exit(1); };
// count, end, curve, ampStart, ampEnd, ampCurve, amplitude
const SET = [4, 0.1, 0, 1, 1, 0, 1];
function run(E, shape, morph, { n = 7000, recalc = 0, mode = 0, morphFn = null, trigFn = (i) => (i >= 10 ? 1 : 0), set = SET } = {}) {
  const h = E.soemdsp_pulse_train_create();
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = morphFn ? morphFn(i) : morph;
    out[i] = m === undefined
      ? E.soemdsp_pulse_train_sample(h, trigFn(i), ...set, SR, mode, recalc, 0, 0, 0, 0, shape, 0)
      : E.soemdsp_pulse_train_sample(h, trigFn(i), ...set, SR, mode, recalc, 0, 0, 0, 0, shape, 0, m);
  }
  E.soemdsp_pulse_train_destroy(h);
  return out;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
// 1) old shapes 0..5: omitted Morph == Morph 0.5, and == pre-v22 wasm when given
const SETS = [SET, [12, 0.07, 3, 1, 0.2, 2, 0.8], [7, 0.05, -4, 0.3, 0.9, -3, 1.7]];
for (const set of SETS) for (let shape = 0; shape <= 5; shape++) for (const mode of [0, 1]) {
  const a = run(S, shape, 0.5, { set, mode }), b = run(S, shape, undefined, { set, mode }), c = run(N, shape, 0.5, { set, mode });
  if (!same(a, b)) fail(`shape ${shape} Morph 0.5 != omitted`);
  if (!same(a, c)) fail(`shape ${shape} standalone != combined`);
  if (OLD && !same(a, run(OLD, shape, undefined, { set, mode }))) fail(`shape ${shape} mode ${mode} not bit-identical to pre-v22`);
}
// grain 0 of SET: pulses at 0, T/3, 2T/3, T -> first grain is samples 10 .. 10+1600
const g0 = (o) => Array.from(o.slice(10, 10 + 1600));
// 2) TriSaw sweep: 0 falling saw, 0.5 triangle, 1 rising saw; starts at 0, peak at m/2
for (const m of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
  const g = g0(run(S, 4, m));
  let pk = 0; g.forEach((v, i) => { if (v > g[pk]) pk = i; });
  const want = Math.round((m / 2) * 1600);
  if (Math.abs(pk - want) > 1) fail(`TriSaw m=${m} peak at ${pk} want ${want}`);
  if (m > 0 && Math.abs(g[0]) > 1e-12) fail(`TriSaw m=${m} start ${g[0]}`);
  if (Math.max(...g) > 1 + 1e-12 || Math.min(...g) < -1 - 1e-12) fail(`TriSaw m=${m} range`);
}
{ const g = g0(run(S, 4, 0)); if (!(g[0] === 1 && g[1599] < -0.99)) fail("TriSaw 0 not falling saw"); }
{ const g = g0(run(S, 4, 1)); if (!(g[0] === 0 && g[799] > 0.99 && g[800] === -1)) fail("TriSaw 1 not rising saw"); }
// 3) Pulse Left / Center / Right: -1/+1, duty = Morph, placement left / centre / right
for (const d of [0.1, 0.25, 0.5, 0.8]) {
  const L = g0(run(S, 6, d)), C = g0(run(S, 7, d)), R = g0(run(S, 8, d));
  for (const [nm, g] of [["L", L], ["C", C], ["R", R]]) {
    if (!g.every((v) => v === 1 || v === -1)) fail(`Pulse ${nm} not bipolar +-1`);
    const hi = g.filter((v) => v === 1).length / 1600;
    if (Math.abs(hi - d) > 1 / 1600) fail(`Pulse ${nm} duty ${hi} want ${d}`);
  }
  if (L[0] !== 1 || R[1599] !== 1 || C[0] !== -1 || C[800] !== 1 || C[1599] !== -1) fail(`Pulse placement d=${d}`);
}
{ const L = g0(run(S, 6, 0.5)), R = g0(run(S, 8, 0.5)); if (!L.every((v, i) => v === -R[i])) fail("Left/Right 0.5 not mirror squares"); }
// 4) Rect Sine: 2*sin(pi*u) - 4/pi per grain, bipolar, zero-mean, Morph ignored
{
  const o = run(S, 9, 0.5), g = g0(o);
  let mean = 0;
  g.forEach((v, i) => { const want = 2 * Math.sin(Math.PI * i / 1600) - 4 / Math.PI; if (Math.abs(v - want) > 1e-8) fail(`Rect Sine ${i}: ${v} vs ${want}`); mean += v; });
  mean /= g.length;
  if (Math.abs(mean) > 2e-3) fail(`Rect Sine mean ${mean}`);
  if (!(Math.min(...g) < -0.27 && Math.max(...g) > 0.72)) fail("Rect Sine not bipolar");
  if (!same(o, run(S, 9, 0.1))) fail("Rect Sine depends on Morph");
}
// 5) face: preview schedule does not depend on Shape / Morph (same exports, same answers)
{
  const n = S.soemdsp_pulse_train_preview(...SET, 0, 0, 0);
  if (n !== 4) fail("preview count");
}
// 6) Recalculate On latches Morph at the trigger; Off follows it live
{
  const mf = (i) => (i < 400 ? 0.5 : 0.1);
  const on = run(S, 6, 0, { recalc: 1, morphFn: mf }), off = run(S, 6, 0, { recalc: 0, morphFn: mf });
  if (on[10 + 600] !== 1) fail("Recalc On did not latch Morph 0.5");
  if (off[10 + 600] !== -1) fail("Recalc Off did not follow Morph 0.1");
}
console.log("ok pulseTrain v22 shapes: old 0..5 bit-identical at Morph 0.5" + (OLD ? " (vs pre-v22 wasm)" : "") + ", TriSaw sweep, Pulse L/C/R, Rect Sine shared hump, Morph latch");