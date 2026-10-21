// Clock ƒ input (kPortF, absolute Hz): unwired is bit-identical to the
// previous build (optional old wasm as argv[2]); wired, the clock ticks at ƒ
// and the Rate knob is ignored. ƒ source: Host BPM node (constant = tempo value).
// Amplitude is latched per pulse: a slider sweep inside a held gate adds no
// rising edge and shows on the next tick.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000, TYPE_CLOCK = 28, TYPE_HOST_BPM = 192;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RIGHT = 2, PORT_F = 16, PORT_RESET = 19;
const P = { RATE: 10, AMP: 12, PULSE_END: 13, PHASE: 14, PULSE_START: 30 };
function run(E, { rate = 2, fHz = null, phase = 0, start = 0, end = 0.5, amp = 1, blocks = 3750, resetHz = 0, ampAt = null }) {
  const g = E.soemdsp_graph_create() | 0;
  E.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7201, hF = 0x7202, hR = 0x7203;
  if (E.soemdsp_graph_add_node(g, hC, TYPE_CLOCK) | 0) throw new Error("clock add");
  if (fHz !== null) {
    if (E.soemdsp_graph_add_node(g, hF, TYPE_HOST_BPM) | 0) throw new Error("bpm add");
    if (E.soemdsp_graph_connect(g, hF, PORT_MONO, hC, PORT_F) | 0) throw new Error("bpm->f");
    E.soemdsp_graph_set_host_transport(g, fHz, 0, 0);
  }
  if (resetHz > 0) {
    if (E.soemdsp_graph_add_node(g, hR, TYPE_CLOCK) | 0) throw new Error("reset clock add");
    if (E.soemdsp_graph_connect(g, hR, PORT_MONO, hC, PORT_RESET) | 0) throw new Error("reset conn");
    E.soemdsp_graph_set_param(g, hR, P.RATE, resetHz);
  }
  E.soemdsp_graph_set_param(g, hC, P.RATE, rate);
  E.soemdsp_graph_set_param(g, hC, P.PHASE, phase);
  E.soemdsp_graph_set_param(g, hC, P.PULSE_START, start);
  E.soemdsp_graph_set_param(g, hC, P.PULSE_END, end);
  E.soemdsp_graph_set_param(g, hC, P.AMP, amp);
  if (E.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  E.soemdsp_graph_snap_controls(g);
  const out = { dig: [], ana: [], t: [] };
  for (let q = 0; q < blocks; q++) {
    if (ampAt) { const a = ampAt(q); if (a !== null) E.soemdsp_graph_set_param(g, hC, P.AMP, a); }
    E.soemdsp_graph_process_block(g, 128);
    const rd = (port) => new Float64Array(E.memory.buffer, E.soemdsp_graph_node_port_ptr(g, hC, port) | 0, 128);
    const d = rd(PORT_MONO), a = rd(PORT_LEFT), t = rd(PORT_RIGHT);
    for (let i = 0; i < 128; i++) { out.dig.push(d[i]); out.ana.push(a[i]); out.t.push(t[i]); }
  }
  E.soemdsp_graph_destroy(g);
  return out;
}
const md = (a, b) => a.reduce((m, v, i) => Math.max(m, v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
const all = (r) => [...r.dig, ...r.ana, ...r.t];
// 1) Unwired: old build == new build.
if (O) {
  let worst = 0, cases = 0;
  for (const rate of [0, 2, 48.98, 100]) for (const phase of [0, 0.79]) for (const [start, end] of [[0, 0.5], [0.39, 0.82]]) for (const resetHz of [0, 3]) {
    worst = Math.max(worst, md(all(run(N, { rate, phase, start, end, resetHz, blocks: 800 })), all(run(O, { rate, phase, start, end, resetHz, blocks: 800 }))));
    cases++;
  }
  if (worst !== 0) throw new Error(`Clock unwired differs from the previous build (${worst})`);
  console.log(`ok clock unwired bit-identical to the previous build: ${cases} cases, max diff 0`);
}
// 2) Wired: ticks at ƒ (rising edges of Digital Out over 10 s), Rate ignored.
const rises = (x) => { let n = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] <= 0 && x[i] > 0) n++; return n; };
for (const fHz of [1.5, 2, 37.5, 100, 441]  /* Host BPM outputs 0 at tempo <= 1 */) {
  const r = run(N, { rate: 7, fHz });
  const secs = r.dig.length / SR;
  const n = rises(r.dig);
  if (Math.abs(n - fHz * secs) > 1.01) throw new Error(`ƒ ${fHz} Hz: ${n} ticks in ${secs} s`);
  const same = md(all(r), all(run(N, { rate: 55, fHz })));
  if (same !== 0) throw new Error(`ƒ ${fHz} Hz: Rate knob still changes the output (${same})`);
  console.log(`ok clock ƒ ${fHz} Hz: ${n} ticks in ${secs} s (Rate 7 / 55 ignored)`);
}
{
  const r = run(N, { rate: 7, fHz: 0, blocks: 400 });
  console.log(`ok clock ƒ 0 Hz: ${rises(r.dig)} ticks (stopped, as Rate 0)`);
  const k = md(all(run(N, { rate: 0, blocks: 400 })), all(r));
  if (k !== 0) throw new Error(`ƒ 0 should equal Rate 0 (${k})`);
}
// 3) Amplitude latch: 1 Hz, gate 0..0.5; sweep Amplitude 0.2 -> 1 (and a dip) while the gate is held.
{
  const blocksPerSec = SR / 128;
  const sweep = (q) => (q < blocksPerSec * 0.45 ? 0.2 + 0.8 * (q / (blocksPerSec * 0.45)) * (q % 20 < 10 ? 1 : 0.5) : 1);
  const r = run(N, { rate: 1, amp: 0.2, blocks: Math.round(blocksPerSec * 2.2), ampAt: sweep });
  const abs = (x) => { let n = 0; for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[i - 1])) n++; return n; };
  const gate1 = r.dig.slice(0, SR / 2), gate2 = r.dig.slice(SR, SR + SR / 2);
  if (!gate1.every((v) => v === 0.2)) throw new Error(`held gate changed level: ${[...new Set(gate1)].slice(0, 5)}`);
  if (!gate2.every((v) => v === 1)) throw new Error(`next gate not at the new level: ${[...new Set(gate2)].slice(0, 5)}`);
  const digRises = abs(r.dig.slice(0, SR + 10)), tRises = abs(r.t.slice(0, SR + 10));
  if (digRises !== 1) throw new Error(`Digital |x| rises in 1 s + next tick: ${digRises} (want 1: high from sample 0, then the next gate rise)`);
  if (tRises !== 1) throw new Error(`T rises through the first tick: ${tRises} (want 1)`);
  // Analog: first cycle scaled by 0.2 throughout, second by 1 (same shape).
  let k = 0;
  for (let i = 0; i < SR - 2; i++) k = Math.max(k, Math.abs(r.ana[SR + i] * 0.2 - r.ana[i]));
  // 1e-6: phase rounding differs a hair between cycles; an unlatched level would differ by ~0.1..0.8.
  if (k > 1e-6) throw new Error(`Analog first cycle not latched (${k})`);
  console.log(`ok clock Amplitude latch: sweep inside the held gate -> gate stays 0.2 (no extra rise), next tick 1.0; Analog cycle scaled by its start level; T one rise per tick`);
}
