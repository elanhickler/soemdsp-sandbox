// Pulse Explosion Timing (timingMode slot 54): Random (0, default) is
// bit-identical to the previous build (optional old wasm as argv[2]);
// Exp / Log / Lin place pulses at the documented formulas; the preview export
// returns exactly the schedule a trigger plays, in every mode.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000;
// start, center, end, spread, count, lo, hi, seed
const SETS = [
  [0, 0.5, 1, 0.3, 20, 0.3, 1, 0],
  [0.1, 0.2, 0.9, 0.05, 64, 0, 1, 12345],
  [0, 0.05, 0.3, 1, 128, 0.5, 0.6, 777],
  [0.25, 0.25, 0.25, 0.5, 1, 1, 1, 9],
];
function play(E, set, timing, n, trigEvery = 30000) {
  const h = E.soemdsp_pulse_explosion_create();
  const out = [];
  for (let i = 0; i < n; i++) {
    const trig = i % trigEvery < 3 ? 1 : 0;
    const args = [h, trig, ...set, SR];
    if (timing !== undefined) args.push(timing);
    out.push(E.soemdsp_pulse_explosion_sample(...args), E.soemdsp_pulse_explosion_curve(h));
  }
  E.soemdsp_pulse_explosion_destroy(h);
  return out;
}
const md = (a, b) => a.reduce((m, v, i) => Math.max(m, v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
// 1) Random default
for (const [k, set] of SETS.entries()) {
  const n = SR * 2;
  const a = play(N, set, 0, n), u = play(N, set, undefined, n);
  if (md(a, u) !== 0) throw new Error(`set ${k}: Timing 0 differs from unset`);
  if (O && md(a, play(O, set, undefined, n)) !== 0) throw new Error(`set ${k}: Random differs from the previous build`);
}
console.log(`ok pulseExplosion Random (default) == ${O ? "previous build" : "unset"}: ${SETS.length} sets, 2 s each, Out + Curve max diff 0`);
// 2) Preview == played, and Exp/Log/Lin match the formulas.
const E3 = Math.exp(3) - 1;
const shape = (m, u) => (m === 1 ? (Math.exp(3 * u) - 1) / E3 : m === 2 ? 1 - (Math.exp(3 * (1 - u)) - 1) / E3 : u);
for (const [k, set] of SETS.entries()) {
  for (const m of [0, 1, 2, 3]) {
    const cnt = N.soemdsp_pulse_explosion_preview(...set, m);
    const times = [], amps = [];
    for (let i = 0; i < cnt; i++) { times.push(N.soemdsp_pulse_explosion_preview_time(i)); amps.push(N.soemdsp_pulse_explosion_preview_amplitude(i)); }
    // engine timeline: pulse j fires on the first sample whose elapsed >= time (one per sample)
    const expect = new Map();
    let e = 0, j = 0;
    for (let i = 0; i < SR * 12 && j < cnt; i++) { if (e >= times[j]) { expect.set(i, amps[j]); j++; } e += 1 / SR; }
    const y = play(N, set, m, SR * 12, 1e9);
    for (let i = 0; i < SR * 12; i++) { const v = y[2 * i]; const w = expect.get(i) || 0; if (v !== w) throw new Error(`set ${k} timing ${m}: sample ${i} out ${v}, preview ${w}`); }
    if (m > 0) {
      const [start, center, end] = set;
      const s0 = Math.max(0, start), e0 = end > s0 ? end : s0 + 0.001;
      let c0 = Math.min(Math.max(center, s0), e0); if (c0 <= s0) c0 = s0 + 1e-6; if (c0 >= e0) c0 = e0 - 1e-6;
      let worst = 0;
      for (let i = 0; i < cnt; i++) {
        const t = cnt === 1 ? c0 : s0 + (e0 - s0) * shape(m, i / (cnt - 1));
        worst = Math.max(worst, Math.abs(t - times[i]));
      }
      // 1e-6 s: the engine uses dsp_exp (~2e-7 relative vs Math.exp); one sample is 2e-5 s.
      if (worst > 1e-6) throw new Error(`set ${k} timing ${m}: formula off by ${worst}`);
      if (cnt > 2) {
        const g0 = times[1] - times[0], g1 = times[cnt - 1] - times[cnt - 2];
        const ok = m === 1 ? g0 < g1 : m === 2 ? g0 > g1 : Math.abs(g0 - g1) < 1e-9;
        if (!ok) throw new Error(`set ${k} timing ${m}: spacing first ${g0} last ${g1}`);
      }
    }
  }
}
console.log("ok pulseExplosion Timing: preview == played schedule (all modes), Exp dense at Start, Log dense at End, Lin even, formulas within 1e-6 s");
