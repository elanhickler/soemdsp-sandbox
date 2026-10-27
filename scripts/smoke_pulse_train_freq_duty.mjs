// Pulse Train Frequency + Duty (graph 255): Frequency (timeDenominator, Hz) is
// the cycle rate, Duty (timeNumerator) is the pulsing fraction of each cycle.
// Time = Duty/ƒ (Fwd-Rev: per leg /2), End Delay = (1-Duty)/ƒ, cycle = 1/ƒ.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const N = (await WebAssembly.instantiate(fs.readFileSync(process.env.PT_COMBINED || path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), { env: { emo_process_block: () => 0 } })).instance.exports;
const SR = 48000, TYPE_PT = 231;
const P = { AMP: 12, SHAPE: 13, STAGES: 22, TNUM: 52, TDEN: 53, TIMING: 54, OFFSET: 55, MODE: 21, LFO_STYLE: 56, OVERSAMPLE: 32, WIDTH: 31, IN_LOW: 80, IN_HIGH: 81 };
const PORT = { MONO: 0, LEFT: 1, SAW: 3, RAMP: 4, PHASE: 10, IDLE: 11 };
function run({ freq, duty, stretch = 0, count = 4, wave = 0, pulseMode = 0, loop = 1, rec = 0, seconds = 0.5, onBlock = null }) {
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const h = 0x7a01;
  if (N.soemdsp_graph_add_node(g, h, TYPE_PT) | 0) throw new Error("add");
  for (const [p, v] of [[P.STAGES, count], [P.TDEN, freq], [P.TNUM, duty], [P.OFFSET, stretch], [P.SHAPE, 0], [P.IN_LOW, 1], [P.IN_HIGH, 1], [P.WIDTH, 0], [P.AMP, 1], [P.TIMING, loop], [P.MODE, rec], [P.LFO_STYLE, pulseMode], [P.OVERSAMPLE, wave]]) N.soemdsp_graph_set_param(g, h, p, v);
  if (N.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  N.soemdsp_graph_snap_controls(g);
  const r = { out: [], end: [], el: [], saw: [], ramp: [], idle: [] };
  for (let q = 0; q < Math.ceil(seconds * SR / 128); q++) {
    if (onBlock) onBlock(q, (p, v) => { N.soemdsp_graph_set_param(g, h, p, v); N.soemdsp_graph_snap_controls(g); });
    N.soemdsp_graph_process_block(g, 128);
    const rd = (port) => new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, h, port) | 0, 128);
    r.out.push(...rd(PORT.MONO)); r.end.push(...rd(PORT.LEFT)); r.el.push(...rd(PORT.PHASE));
    r.saw.push(...rd(PORT.SAW)); r.ramp.push(...rd(PORT.RAMP)); r.idle.push(...rd(PORT.IDLE));
  }
  N.soemdsp_graph_destroy(g);
  return r;
}
const check = (ok, msg) => { if (!ok) throw new Error(msg); console.log(`ok pulseTrain ${msg}`); };
const wraps = (r) => r.el.map((v, i) => (i > 0 && v === 0 && r.el[i - 1] > 0 ? i : -1)).filter((i) => i >= 0);
// 1) Cycle = 1/Frequency for every Duty.
for (const duty of [0, 0.01, 0.25, 0.5, 1]) {
  const r = run({ freq: 10, duty });
  const w = wraps(r);
  const gaps = w.slice(1).map((x, i) => x - w[i]);
  check(gaps.length >= 3 && gaps.every((x) => Math.abs(x - SR / 10) <= 1), `Frequency 10 Hz Duty ${duty}: cycle ${gaps[0]} samples (= sr/10)`);
}
// 2) Duty squeezes the pulses: Count 4 linear, Duty 0.25 -> pulses at 0, 1/4, 2/4, 3/4 of 0.025 s.
{
  const r = run({ freq: 10, duty: 0.25 });
  const t0 = wraps(r)[0];
  const hits = []; for (let i = t0; i < t0 + SR / 10; i++) if (r.out[i] !== 0) hits.push(i - t0);
  const want = [0, 0.25, 0.5, 0.75].map((u) => Math.ceil(u * 0.025 * SR - 1e-9));
  check(hits.length === 4 && hits.every((x, i) => Math.abs(x - want[i]) <= 1), `Duty 0.25: 4 pulses inside the first quarter of the cycle at ${hits}`);
  const r0 = run({ freq: 10, duty: 0 });
  const z0 = wraps(r0)[0];
  const h0 = []; for (let i = z0; i < z0 + SR / 10; i++) if (r0.out[i] !== 0) h0.push(i - z0);
  check(h0.length === 1 && h0[0] === 0 && Math.abs(r0.out[z0] - 4) < 1e-12, `Duty 0: every pulse stacked on sample 0 of the cycle (sum ${r0.out[z0]})`);
  const r1 = run({ freq: 10, duty: 1 });
  const z1 = wraps(r1)[0];
  const h1 = []; for (let i = z1; i < z1 + SR / 10; i++) if (r1.out[i] !== 0) h1.push(i - z1);
  check(h1.length === 4 && h1.every((x, i) => Math.abs(x - 1200 * i) <= 1), `Duty 1: pulses spread over the whole cycle at ${h1}`);
}
// Stretch s (graph 296): span multiplier m = Count^s above 0. Count 4,
// s = 0.5 -> m = 2: keeps the 1/f window and drops pulses past it.
{
  const r = run({ freq: 10, duty: 1, stretch: 0.5, count: 4 });
  const w = wraps(r);
  check(w.length >= 2 && Math.abs(w[1] - w[0] - SR / 10) <= 1, `Stretch 0.5 (m 2) Duty 1: cycle still ${w[1] - w[0]} samples (= sr/10)`);
  const t0 = w[0];
  const hits = []; for (let i = t0; i < w[1]; i++) if (r.out[i] !== 0) hits.push(i - t0);
  check(hits.length === 2 && Math.abs(hits[0]) <= 1 && Math.abs(hits[1] - SR / 20) <= 1, `Stretch 0.5 (m 2) Duty 1 Count 4 Loop: only the first half of the train plays at ${hits}`);
  const idle = r.idle[r.idle.length - 1];
  check(Math.abs(idle - (-0.1)) < 1e-9, `Stretch 0.5 (m 2) Duty 1 at 10 Hz: __Delay ${idle} s (= (1-2)/f)`);
}
// Stretch -1: every pulse on one sample (summed), no NaN.
{
  const r = run({ freq: 10, duty: 1, stretch: -1, count: 4 });
  const w = wraps(r);
  check(r.out.every((v) => Number.isFinite(v)), "Stretch -1: no NaN / inf");
  const hits = []; for (let i = w[0]; i < w[1]; i++) if (r.out[i] !== 0) hits.push(i - w[0]);
  check(hits.length === 1 && hits[0] === 0 && Math.abs(r.out[w[0]] - 4) < 1e-12, `Stretch -1: all 4 pulses on sample 0 of the cycle (sum ${r.out[w[0]]})`);
}
// Stretch +1, Count 8: m = Count, exactly one pulse per 1/f window.
{
  const r = run({ freq: 10, duty: 1, stretch: 1, count: 8 });
  const w = wraps(r);
  for (let c = 0; c + 1 < w.length; c++) {
    const hits = []; for (let i = w[c]; i < w[c + 1]; i++) if (r.out[i] !== 0) hits.push(i - w[c]);
    if (hits.length !== 1 || hits[0] !== 0) throw new Error(`Stretch +1 Count 8 cycle ${c}: ${hits.length} pulses at ${hits}`);
  }
  check(w.length >= 3, `Stretch +1 Count 8: one pulse per window over ${w.length - 1} cycles`);
}
// Stretch sweep -1 -> +1 (Free): finite throughout, the train keeps playing.
{
  const seconds = 1;
  const r = run({ freq: 20, duty: 1, count: 8, seconds, onBlock: (q, set) => { set(P.OFFSET, -1 + 2 * (q * 128 / SR) / seconds); } });
  check(r.out.every((v) => Number.isFinite(v)) && r.el.every((v) => Number.isFinite(v)), "Stretch sweep -1..+1: no NaN / inf");
  let pulses = 0; for (const v of r.out) if (v !== 0) pulses++;
  check(pulses > 20, `Stretch sweep -1..+1: train keeps playing (${pulses} pulse samples)`);
}
// 3) Count 1, Duty 1, Saw: the one grain fills the whole cycle (no silence).
{
  const r = run({ freq: 10, duty: 1, count: 1, wave: 2 });
  const w = wraps(r);
  let zeros = 0; for (let i = w[0] + 1; i < w[1]; i++) if (r.out[i] === 0) zeros++;
  // The saw crosses 0 once mid-grain; nothing else is silent.
  check(zeros <= 1 && r.out[w[1] - 1] !== 0, `Count 1 Duty 1 Saw: one grain spans the full cycle (${w[1] - w[0]} samples, ${zeros} zero crossing)`);
  const h = run({ freq: 10, duty: 0.5, count: 1, wave: 2 });
  const hw = wraps(h);
  let silent = 0; for (let i = hw[0]; i < hw[1]; i++) if (h.out[i] === 0) silent++;
  check(Math.abs(silent - SR / 20) <= 3, `Count 1 Duty 0.5 Saw: second half of the cycle silent (${silent} samples)`);
}
// 4) Forward-Reverse: Duty is the whole out-and-back, cycle still 1/ƒ.
{
  const r2 = run({ freq: 10, duty: 0.5, pulseMode: 0.5 });
  const w = wraps(r2);
  check(w.length >= 2 && Math.abs(w[1] - w[0] - SR / 10) <= 1, `Forward-Reverse Duty 0.5: cycle ${w[1] - w[0]} samples`);
  const ramp = r2.ramp[r2.ramp.length - 1];
  check(Math.abs(ramp - 0.025) < 1e-12, `Forward-Reverse Duty 0.5 at 10 Hz: Time per leg ${ramp} s (= Duty/ƒ/2)`);
}
// 5) Face ports: __Count = count + 0.5*p, __Delay = (1-Duty)/ƒ.
{
  const r = run({ freq: 4, duty: 0.75, count: 6, pulseMode: 0.5 });
  const c = r.saw[r.saw.length - 1], d = r.idle[r.idle.length - 1];
  check(c === 6.25 && Math.abs(d - 0.0625) < 1e-12, `face __Count ${c} (6 + 0.5*0.5), __Delay ${d} s (= 0.25/4)`);
}
// 6) Recalculate On latches Frequency + Duty at the cycle start; Off remaps
// elapsed into the new period so Frequency stays phase-continuous.
for (const rec of [1, 0]) {
  const at = 10; // block 10 = 1280 samples into a 0.5 s cycle
  const r = run({ freq: 2, duty: 1, rec, seconds: 1.2, onBlock: (q, set) => { if (q === at) set(P.TDEN, 4); } });
  const w = wraps(r);
  const first = w[0];
  if (rec) {
    check(Math.abs(first - SR / 2) <= 1, `Recalculate On: Frequency 2 -> 4 Hz mid-cycle, first wrap at ${first} samples (latched 0.5 s)`);
  } else {
    const atSamp = at * 128;
    const phase = atSamp / (SR / 2);
    const nRemap = Math.floor(phase * (SR / 4));
    const want = atSamp + (SR / 4 - nRemap);
    check(Math.abs(first - want) <= 1, `Recalculate Off: Frequency 2 -> 4 Hz mid-cycle, first wrap at ${first} samples (phase-continuous, want ${want})`);
  }
}
// 7) Frequency <= 0 (divide-by-zero guard): silent, no NaN.
{
  const r = run({ freq: 0, duty: 0.5, seconds: 0.05 });
  check(r.out.every((v) => v === 0), "Frequency 0: silent (no period), no NaN");
}
// 8) Defaults: Frequency 1 Hz, Duty 0.5 -> cycle 1 s.
{
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  N.soemdsp_graph_add_node(g, 0x7a09, TYPE_PT);
  N.soemdsp_graph_compile(g); N.soemdsp_graph_snap_controls(g);
  const el = [];
  for (let q = 0; q < Math.ceil(1.1 * SR / 128); q++) { N.soemdsp_graph_process_block(g, 128); el.push(...new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, 0x7a09, PORT.PHASE) | 0, 128)); }
  N.soemdsp_graph_destroy(g);
  const w = el.findIndex((v, i) => i > 0 && v === 0 && el[i - 1] > 0);
  check(Math.abs(w - SR) <= 1, `defaults Frequency 1 Hz / Duty 0.5: wrap at ${w} samples`);
}
// 9) Free + Loop: sweeping Frequency keeps phase. Elapsed must not snap to 0
// mid-cycle (that was the train restarting on every ƒ change).
for (const wave of [0, 2]) {
  const seconds = 0.4;
  const r = run({
    freq: 2, duty: 1, rec: 0, wave, count: 8, seconds,
    onBlock: (q, set) => { set(P.TDEN, 2 + (q * 128 / SR) / seconds * 38); },
  });
  let falseRestarts = 0, realWraps = 0;
  for (let i = 1; i < r.el.length; i++) {
    if (!(r.el[i] === 0 && r.el[i - 1] > 0)) continue;
    const period = r.ramp[i] > 0 ? r.ramp[i] : 0;
    const prev = r.el[i - 1];
    if (period > 0 && prev + 4 / SR >= period * 0.85) realWraps += 1;
    else falseRestarts += 1;
  }
  check(falseRestarts === 0, `Free Frequency sweep Shape ${wave}: no mid-cycle restart (${falseRestarts} false, ${realWraps} wraps)`);
  check(realWraps >= 1, `Free Frequency sweep Shape ${wave}: wrapped ${realWraps} times`);
  let energy = 0;
  for (let i = 0; i < r.out.length; i++) energy += r.out[i] * r.out[i];
  check(energy > 1, `Free Frequency sweep Shape ${wave}: train stays alive (energy ${energy.toFixed(3)})`);
}
check((N.soemdsp_pulse_train_version() | 0) >= 25, `pulse_train v${N.soemdsp_pulse_train_version()}`);
check((N.soemdsp_graph_version() | 0) >= 255, `graph version ${N.soemdsp_graph_version()}`);

// 5) Loop: exactly Count pulses per cycle in every Fwd-Rev bias, no doubled pulse at the wrap.
for (const pulseMode of [0, 0.25, 0.5, 1]) for (const count of [1, 2, 3, 4, 7]) for (const duty of [0.3, 0.5, 1]) {
  const r = run({ freq: 10, duty, count, pulseMode, seconds: 0.6 });
  const w = wraps(r);
  const want = pulseMode > 0 && pulseMode < 1 && count > 1
    ? 2 * count - 1
    : count;
  for (let c = 0; c + 1 < w.length; c++) {
    const hits = []; for (let i = w[c]; i < w[c + 1]; i++) if (r.out[i] !== 0) hits.push(i - w[c]);
    if (hits.length !== want) throw new Error(`pulseMode ${pulseMode} Count ${count} Duty ${duty} cycle ${c}: ${hits.length} pulses (want ${want}) at ${hits}`);
  }
}
console.log("ok pulseTrain Loop: exactly Count pulses per cycle in Forward / dual 2N-1 (0.25 / 0.5) / reverse N (1), no wrap double");

// 6) Fwd-Rev 1.0: one-way reverse over Time (peak at Time). Duty still 1/ƒ.
const PV = (await WebAssembly.instantiate(fs.readFileSync(process.env.PT_SINGLE || path.join(root, "native_modules", "pulse_train", "pulse_train.wasm")), { env: {} })).instance.exports;
const prev = (count, pulseMode, loop, time = 0.05, curve = 3, a0 = 1, a1 = 0.2, ac = 0) => {
  const n = PV.soemdsp_pulse_train_preview(count, time, curve, a0, a1, ac, 1, loop, pulseMode, 0) | 0;
  const t = [], a = [];
  for (let i = 0; i < n; i++) { t.push(PV.soemdsp_pulse_train_preview_time(i)); a.push(PV.soemdsp_pulse_train_preview_amplitude(i)); }
  return { n, t, a };
};
const fnv = (arr) => { let h = 0x811c9dc5; const b = new Uint8Array(Float64Array.from(arr).buffer); for (const x of b) { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
if (!process.env.PT_PRINT_HASH) {
  const E = 0.05;
  for (const curve of [3, 0, -2]) for (const count of [1, 2, 3, 5, 9]) {
    const rf = prev(count, 1, 0, E, curve), N = count;
    const want1 = N;
    if (rf.n !== want1) throw new Error(`Fwd-Rev 1.0 one shot Count ${N}: ${rf.n} pulses (want ${want1})`);
    if (N > 1) {
      const peakI = rf.a.indexOf(Math.max(...rf.a));
      if (Math.abs(rf.t[peakI] - E) > 1e-9) throw new Error(`Fwd-Rev 1.0 one shot Count ${N}: peak t ${rf.t[peakI]} want ${E}`);
      for (let j = 1; j < rf.n; j++) {
        if (!(rf.t[j] >= rf.t[j - 1] - 1e-12)) throw new Error(`Fwd-Rev 1.0 one shot times not ordered at ${j}`);
      }
    }
    const rfL = prev(count, 1, 1, E, curve);
    const wantL = N;
    if (rfL.n !== wantL) throw new Error(`Fwd-Rev 1.0 Loop Count ${N}: ${rfL.n} pulses (want ${wantL})`);
    if (N > 1) {
      const gaps = (t) => t.map((x, i) => (i + 1 < t.length ? t[i + 1] : E) - x);
      const gr = gaps(rfL.t), L = wantL;
      for (let j = 0; j < L; j++) {
        if (!(gr[j] > 0)) throw new Error(`Fwd-Rev 1.0 Loop Count ${N}: zero gap (duplicate) at ${j}`);
      }
      if (!(rfL.t[0] >= 0 && rfL.t[L - 1] <= E + 1e-12)) throw new Error(`Fwd-Rev 1.0 Loop range ${rfL.t}`);
    }
  }
  console.log("ok pulseTrain Fwd-Rev 1.0: One shot N peak at Time / Loop N (no wrap duplicate)");
  const r = run({ freq: 10, duty: 0.5, pulseMode: 1 });
  const w = wraps(r);
  check(w.length >= 2 && Math.abs(w[1] - w[0] - SR / 10) <= 1 && Math.abs(r.ramp[r.ramp.length - 1] - 0.05) < 1e-12, `Fwd-Rev 1.0 Duty 0.5 at 10 Hz: cycle ${w[1] - w[0]} samples, Time 0.05 s`);
  const rc = run({ freq: 4, duty: 0.75, count: 6, pulseMode: 1 });
  check(rc.saw[rc.saw.length - 1] === 6.5, `face __Count ${rc.saw[rc.saw.length - 1]} (6 + 0.5*1)`);
}
// 7) Forward bit-identical to v20. Fwd-Rev 0.5 is prefix attack (v26).
{
  const got = [];
  for (const pulseMode of [0, 0.5]) for (const loop of [0, 1]) for (const count of [1, 2, 5, 9]) { const p = prev(count, pulseMode, loop); got.push(fnv([...p.t, ...p.a])); }
  for (const pulseMode of [0, 0.5]) for (const wave of [0, 2]) got.push(fnv(run({ freq: 7, duty: 0.6, count: 5, pulseMode, wave, seconds: 0.4 }).out));
  if (process.env.PT_PRINT_HASH) console.log(JSON.stringify(got));
  const want = [2613946904,585445218,2660523023,591222594,2613946904,3606255894,692371551,651742738,2613946904,3162934992,3207331138,3035951323,2613946904,84195473,545149962,222061623,2589047096,761726603,4035087320,3400310033];
  if (want) check(got.every((h, i) => h === want[i]), `Forward / prefix Fwd-Rev fingerprints v26 (${got.length} fingerprints)`);
}
