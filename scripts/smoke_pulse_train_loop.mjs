// Pulse Train Mode + clamp removal. One shot (0, default) is bit-identical to
// the previous build for Time <= 12 s (old combined wasm as argv[2]); Time
// past 12 s now plays as set (no hidden cap). Loop (1) free-runs with no
// trigger: cycle = Time samples ceil(Time*sr), u_i = i/N so the last pulse
// lands before the cycle end (no seam double), End fires once per cycle,
// params re-latch each cycle, a Trigger hit restarts the cycle (velocity kept;
// single Trigger input since v4, no Reset),
// graph path free-runs with nothing wired and follows Æ’.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000;
const E = (k, u) => (Math.abs(k) <= 1e-6 ? u : (Math.exp(k * u) - 1) / (Math.exp(k) - 1));
// count, time, curve, ampStart, ampEnd, ampCurve, amplitude
const SETS = [[12, 3, 3, 1, 0.2, 0, 1], [40, 12, 6, 1, 0, 2, 0.8], [7, 0.5, 0, 0.3, 0.9, -3, 1], [1, 2, 3, 1, 1, 0, 1], [128, 1, 10, 1, 0.1, 5, 1]];
function play(E2, setFn, trigFn, n, mode) {
  const h = E2.soemdsp_pulse_train_create();
  const out = new Float64Array(n), endo = new Float64Array(n), el = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Old build (argv[2], no mode arg) still has the removed Reset arg: pass 0.
    const args = mode === undefined ? [h, trigFn(i), 0, ...setFn(i), SR] : [h, trigFn(i), ...setFn(i), SR];
    if (mode !== undefined) args.push(mode, 1); // Recalculate On (the latched behavior this smoke covers)
    out[i] = E2.soemdsp_pulse_train_sample(...args);
    endo[i] = E2.soemdsp_pulse_train_end(h);
    el[i] = E2.soemdsp_pulse_train_elapsed(h);
  }
  E2.soemdsp_pulse_train_destroy(h);
  return { out, endo, el };
}
const md = (a, b) => a.reduce((m, v, i) => Math.max(m, v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
// 1) One shot == previous build (Time <= 12 s), and Time 20 s plays at 20 s.
if (O) {
  let worst = 0;
  for (const set of SETS) {
    const n = Math.ceil((set[1] + 0.5) * SR);
    const trig = (i) => (i >= 11 && i < 30000 ? 1 : i >= 40000 ? 0.7 : 0);
    const a = play(N, () => set, trig, n, 0);
    const b = play(O, () => set, trig, n);
    worst = Math.max(worst, md(a.out, b.out), md(a.endo, b.endo), md(a.el, b.el));
  }
  if (worst !== 0) throw new Error(`One shot differs from the previous build (${worst})`);
  console.log(`ok pulseTrain One shot (Mode 0) == previous build: ${SETS.length} sets with trigger / retrigger, Out / End / __Elapsed max diff 0`);
}
{
  const r = play(N, () => [5, 20, 2, 1, 1, 0, 1], (i) => (i >= 1 ? 1 : 0), Math.ceil(20.1 * SR), 0);
  const endAt = r.endo.indexOf(1);
  if (endAt - 1 !== 20 * SR) throw new Error(`Time 20: End at ${(endAt - 1) / SR} s`);
  console.log("ok pulseTrain Time 20 s (past the 12 s slider range): last pulse at 20.00000 s, no hidden cap");
}
// 2) Loop free-run, no trigger: cycles of ceil(Time*sr) samples, preview(mode 1) schedule, no seam double.
for (const [k, set] of SETS.entries()) {
  const [count, T] = set;
  const cyc = Math.ceil(T * SR - 1e-9);
  const cycles = 3, n = cyc * cycles + 5;
  const r = play(N, () => set, () => 0, n, 1);
  const pc = N.soemdsp_pulse_train_preview(...set, 1);
  const pt = [], pa = [];
  for (let i = 0; i < pc; i++) { pt.push(N.soemdsp_pulse_train_preview_time(i)); pa.push(N.soemdsp_pulse_train_preview_amplitude(i)); }
  let worst = 0;
  for (let i = 0; i < pc; i++) worst = Math.max(worst, Math.abs(pt[i] - T * E(set[2], i / count)));
  if (worst > 1e-6 * T) throw new Error(`loop set ${k}: u_i = i/N formula off ${worst}`);
  if (!(pt[pc - 1] < T)) throw new Error(`loop set ${k}: last pulse ${pt[pc - 1]} not before the cycle end ${T}`);
  const y = new Float64Array(n), ends = [];
  for (let c = 0; c * cyc < n; c++) {
    let j = 0;
    for (let s = c * cyc; s < Math.min(n, (c + 1) * cyc) && j < pc; s++) {
      const e = (s - c * cyc) / SR;
      while (j < pc && pt[j] <= e) { y[s] += pa[j]; j++; if (j === pc) ends.push(s); }
    }
  }
  if (md(Array.from(r.out), Array.from(y)) > 1e-12) throw new Error(`loop set ${k}: Out != preview cycles`);
  const gotEnds = []; r.endo.forEach((v, i) => { if (v === 1) gotEnds.push(i); });
  if (JSON.stringify(gotEnds) !== JSON.stringify(ends)) throw new Error(`loop set ${k}: End ${gotEnds} expected ${ends}`);
  // Seam: last pulse of a cycle and first pulse of the next are never on the same sample.
  for (let c = 1; c < cycles; c++) {
    const seam = c * cyc;
    if (pc > 1 && r.out[seam] !== pa[0] + (pt[1] === 0 ? pa[1] : 0) && pt[1] > 0) throw new Error(`loop set ${k}: seam ${seam} out ${r.out[seam]}`);
  }
  if (r.el[cyc - 1] >= T || r.el[cyc] !== 0) throw new Error(`loop set ${k}: elapsed wrap ${r.el[cyc - 1]} -> ${r.el[cyc]}`);
}
console.log(`ok pulseTrain Loop free-run (no trigger): ${SETS.length} sets x 3 cycles, cycle = ceil(Time*sr) samples, t_i = Time*E(i/N) < Time (no seam double), Out == preview per cycle, End once per cycle, __Elapsed wraps to 0`);
// 3) Loop re-latches params each cycle; a Trigger hit restarts the cycle; Trigger velocity kept.
{
  const T = 0.25, cyc = T * SR;
  const r = play(N, (i) => [i < cyc ? 4 : 8, T, 0, 1, 1, 0, 1], () => 0, 2 * cyc, 1);
  const c0 = r.out.slice(0, cyc).filter((v) => v !== 0).length, c1 = r.out.slice(cyc, 2 * cyc).filter((v) => v !== 0).length;
  if (c0 !== 4 || c1 !== 8) throw new Error(`relatch: ${c0} then ${c1} pulses`);
  const at = 5000, rs = 20000;
  const t = play(N, () => [4, T, 0, 1, 1, 0, 1], (i) => (i >= rs ? 0.8 : i >= at ? 0.5 : 0), rs + 2 * cyc, 1);
  if (t.el[at] !== 0 || t.out[at] !== 0.5) throw new Error(`trigger resync: el ${t.el[at]} out ${t.out[at]}`);
  if (t.el[at + cyc] !== 0 || t.out[at + cyc] !== 0.5) throw new Error(`velocity kept: ${t.out[at + cyc]}`);
  if (t.el[rs] !== 0 || Math.abs(t.out[rs] - 0.3) > 1e-12) throw new Error(`retrigger resync (abs-rise 0.5 -> 0.8, velocity 0.3): el ${t.el[rs]} out ${t.out[rs]}`);
  console.log("ok pulseTrain Loop re-latches Count per cycle (4 -> 8), Trigger restarts the cycle (velocity 0.5 kept for later cycles), a second rise 0.5 -> 0.8 restarts it with velocity 0.3");
}
// 4) Graph: Loop free-runs with nothing wired; Æ’ = 2 Hz -> 0.5 s cycles.
{
  const TYPE_PT = 231, TYPE_HOST_BPM = 192, PORT_MONO = 0, PORT_LEFT = 1, PORT_F = 16;
  const PR = { AMP: 12, SHAPE: 13, STAGES: 22, TDEN: 53, MODE: 54, LFO_STYLE: 56 };
  for (const fHz of [null, 2]) {
    const g = N.soemdsp_graph_create() | 0;
    N.soemdsp_graph_set_sample_rate(g, SR);
    const hP = 0x7601, hF = 0x7602;
    if (N.soemdsp_graph_add_node(g, hP, TYPE_PT) | 0) throw new Error("pt add");
    if (fHz) {
      N.soemdsp_graph_add_node(g, hF, TYPE_HOST_BPM);
      N.soemdsp_graph_connect(g, hF, PORT_MONO, hP, PORT_F);
      N.soemdsp_graph_set_host_transport(g, fHz, 0, 0);
    }
    for (const [p, v] of [[PR.STAGES, 6], [PR.TDEN, 0.3], [PR.SHAPE, 3], [PR.MODE, 1], [PR.LFO_STYLE, 0]]) N.soemdsp_graph_set_param(g, hP, p, v);
    if (N.soemdsp_graph_compile(g) | 0) throw new Error("compile");
    N.soemdsp_graph_snap_controls(g);
    const out = [], ends = [];
    for (let q = 0; q < Math.ceil(2 * SR / 128); q++) {
      N.soemdsp_graph_process_block(g, 128);
      const o = new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, hP, PORT_MONO) | 0, 128);
      const e = new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, hP, PORT_LEFT) | 0, 128);
      for (let i = 0; i < 128; i++) { out.push(o[i]); if (e[i] === 1) ends.push(q * 128 + i); }
    }
    N.soemdsp_graph_destroy(g);
    const T = fHz ? 1 / fHz : 0.3;
    const starts = out.map((v, i) => (v !== 0 && i % Math.ceil(T * SR - 1e-9) === 0 ? i : -1)).filter((i) => i >= 0);
    if (starts.length < Math.floor(2 / T)) throw new Error(`graph loop Æ’ ${fHz}: ${starts.length} cycle starts`);
    if (ends.length < Math.floor(2 / T)) throw new Error(`graph loop Æ’ ${fHz}: ${ends.length} Ends`);
    console.log(`ok pulseTrain graph Loop ${fHz ? `Æ’ ${fHz} Hz` : "unwired"}: free-runs with no trigger, cycle ${T} s, ${starts.length} cycles / ${ends.length} End pulses in 2 s`);
  }
}
const v = N.soemdsp_graph_version() | 0;
if (v < 227) throw new Error(`graph version ${v}`);
console.log(`ok graph version ${v}, pulse_train v${N.soemdsp_pulse_train_version()}`);
