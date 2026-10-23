// Pulse Train Frequency + Duty (graph 255): Frequency (timeDenominator, Hz) is
// the cycle rate, Duty (timeNumerator) is the pulsing fraction of each cycle.
// Time = Duty/ƒ (Fwd-Rev: per leg /2), End Delay = (1-Duty)/ƒ, cycle = 1/ƒ.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const N = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), { env: { emo_process_block: () => 0 } })).instance.exports;
const SR = 48000, TYPE_PT = 231;
const P = { AMP: 12, SHAPE: 13, STAGES: 22, TNUM: 52, TDEN: 53, TIMING: 54, MODE: 21, LFO_STYLE: 56, OVERSAMPLE: 32, WIDTH: 31, IN_LOW: 80, IN_HIGH: 81 };
const PORT = { MONO: 0, LEFT: 1, SAW: 3, RAMP: 4, PHASE: 10, IDLE: 11 };
function run({ freq, duty, count = 4, wave = 0, pulseMode = 0, loop = 1, rec = 0, seconds = 0.5, onBlock = null }) {
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const h = 0x7a01;
  if (N.soemdsp_graph_add_node(g, h, TYPE_PT) | 0) throw new Error("add");
  for (const [p, v] of [[P.STAGES, count], [P.TDEN, freq], [P.TNUM, duty], [P.SHAPE, 0], [P.IN_LOW, 1], [P.IN_HIGH, 1], [P.WIDTH, 0], [P.AMP, 1], [P.TIMING, loop], [P.MODE, rec], [P.LFO_STYLE, pulseMode], [P.OVERSAMPLE, wave]]) N.soemdsp_graph_set_param(g, h, p, v);
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
  const r2 = run({ freq: 10, duty: 0.5, pulseMode: 1 });
  const w = wraps(r2);
  check(w.length >= 2 && Math.abs(w[1] - w[0] - SR / 10) <= 1, `Forward-Reverse Duty 0.5: cycle ${w[1] - w[0]} samples`);
  const ramp = r2.ramp[r2.ramp.length - 1];
  check(Math.abs(ramp - 0.025) < 1e-12, `Forward-Reverse Duty 0.5 at 10 Hz: Time per leg ${ramp} s (= Duty/ƒ/2)`);
}
// 5) Face ports: __Count = count + Pulse Mode/4, __Delay = (1-Duty)/ƒ.
{
  const r = run({ freq: 4, duty: 0.75, count: 6, pulseMode: 2 });
  const c = r.saw[r.saw.length - 1], d = r.idle[r.idle.length - 1];
  check(c === 6.5 && Math.abs(d - 0.0625) < 1e-12, `face __Count ${c} (6 + Reverse/4), __Delay ${d} s (= 0.25/4)`);
}
// 6) Recalculate On latches Frequency + Duty at the cycle start; Off follows live.
for (const rec of [1, 0]) {
  const at = 10; // ~27 ms into a 0.5 s cycle
  const r = run({ freq: 2, duty: 1, rec, seconds: 1.2, onBlock: (q, set) => { if (q === at) set(P.TDEN, 4); } });
  const w = wraps(r);
  const first = w[0];
  check(rec ? Math.abs(first - SR / 2) <= 1 : Math.abs(first - SR / 4) <= 1, `Recalculate ${rec ? "On" : "Off"}: Frequency 2 -> 4 Hz mid-cycle, first wrap at ${first} samples (${rec ? "latched 0.5 s" : "live 0.25 s"})`);
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
check((N.soemdsp_graph_version() | 0) >= 255, `graph version ${N.soemdsp_graph_version()}`);

// 5) Loop: exactly Count pulses per cycle in every Pulse Mode, no doubled pulse at the
// wrap, and Reverse amplitudes run Amp End -> Amp Start (no Amp Start spike at t = 0).
for (const pulseMode of [0, 1, 2]) for (const count of [1, 2, 3, 4, 7]) for (const duty of [0.3, 0.5, 1]) {
  const r = run({ freq: 10, duty, count, pulseMode, seconds: 0.6 });
  const w = wraps(r);
  const want = pulseMode === 1 && count > 1 ? 2 * count - 2 : count;
  for (let c = 0; c + 1 < w.length; c++) {
    const hits = []; for (let i = w[c]; i < w[c + 1]; i++) if (r.out[i] !== 0) hits.push(i - w[c]);
    if (hits.length !== want) throw new Error(`pulseMode ${pulseMode} Count ${count} Duty ${duty} cycle ${c}: ${hits.length} pulses (want ${want}) at ${hits}`);
    if (pulseMode === 2 && count > 1) {
      const a = hits.map((x) => r.out[w[c] + x]);
      if (!a.every((v, k) => k === 0 || v >= a[k - 1] - 1e-12)) throw new Error(`Reverse Count ${count} Duty ${duty}: amps not rising ${a}`);
    }
  }
}
console.log("ok pulseTrain Loop: exactly Count pulses per cycle in Forward / Forward-Reverse (2N-2) / Reverse, no wrap double; Reverse amps rise");
