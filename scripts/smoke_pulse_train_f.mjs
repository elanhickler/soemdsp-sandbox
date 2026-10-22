// Pulse Train ƒ input (kPortF, absolute Hz, Clock's convention): unwired is
// bit-identical to the previous build (old combined wasm as argv[2]); wired and
// > 0, End Time = 1/ƒ s latched at the trigger (last pulse at 1/ƒ); ƒ <= 0 uses
// the End Time knob. __End (kPortRamp) carries the effective End Time.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000, TYPE_CLOCK = 28, TYPE_HOST_BPM = 192, TYPE_PT = 231;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RAMP = 4, PORT_PHASE01 = 10, PORT_F = 16, PORT_TRIGGER = 20;
const PR = { RATE: 10, AMP: 12, SHAPE: 13, STAGES: 22, WIDTH: 31, TDEN: 53, IN_LOW: 80, IN_HIGH: 81 };
function run(E, { fHz = null, end = 3, count = 10, curve = 3, rate = 0.3, seconds = 7 } = {}) {
  const g = E.soemdsp_graph_create() | 0;
  E.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7401, hP = 0x7402, hF = 0x7403;
  if (E.soemdsp_graph_add_node(g, hC, TYPE_CLOCK) | 0) throw new Error("clock add");
  if (E.soemdsp_graph_add_node(g, hP, TYPE_PT) | 0) throw new Error("pt add");
  if (E.soemdsp_graph_connect(g, hC, PORT_MONO, hP, PORT_TRIGGER) | 0) throw new Error("trig");
  if (fHz !== null) {
    if (E.soemdsp_graph_add_node(g, hF, TYPE_HOST_BPM) | 0) throw new Error("bpm add");
    if (E.soemdsp_graph_connect(g, hF, PORT_MONO, hP, PORT_F) | 0) throw new Error("bpm->f");
    E.soemdsp_graph_set_host_transport(g, fHz, 0, 0);
  }
  E.soemdsp_graph_set_param(g, hC, PR.RATE, rate);
  const vals = [[PR.STAGES, count], [PR.TDEN, end], [PR.SHAPE, curve], [PR.IN_LOW, 1], [PR.IN_HIGH, 0.3], [PR.WIDTH, 1], [PR.AMP, 1]];
  for (const [p, v] of vals) E.soemdsp_graph_set_param(g, hP, p, v);
  if (E.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  E.soemdsp_graph_snap_controls(g);
  const r = { trig: [], out: [], end: [], el: [], ramp: [] };
  for (let q = 0; q < Math.ceil(seconds * SR / 128); q++) {
    E.soemdsp_graph_process_block(g, 128);
    const rd = (h, port) => new Float64Array(E.memory.buffer, E.soemdsp_graph_node_port_ptr(g, h, port) | 0, 128);
    r.trig.push(...rd(hC, PORT_MONO)); r.out.push(...rd(hP, PORT_MONO)); r.end.push(...rd(hP, PORT_LEFT)); r.el.push(...rd(hP, PORT_PHASE01)); r.ramp.push(...rd(hP, PORT_RAMP));
  }
  E.soemdsp_graph_destroy(g);
  return r;
}
const md = (a, b) => a.reduce((m, v, i) => Math.max(m, v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
// 1) Unwired == previous build (Out / End / __Elapsed).
if (O) {
  let worst = 0, cases = 0;
  for (const end of [0.5, 3, 12]) for (const count of [1, 10, 128]) for (const curve of [-4, 0, 3]) {
    const a = run(N, { end, count, curve, seconds: 4 }), b = run(O, { end, count, curve, seconds: 4 });
    worst = Math.max(worst, md(a.out, b.out), md(a.end, b.end), md(a.el, b.el));
    cases++;
  }
  if (worst !== 0) throw new Error(`Pulse Train unwired differs from the previous build (${worst})`);
  console.log(`ok pulseTrain ƒ unwired bit-identical to the previous build: ${cases} cases, Out / End / __Elapsed max diff 0`);
}
// 2) Wired ƒ: last pulse (End out) at 1/ƒ after each trigger; End Time knob ignored.
function lastPulseDelays(r) {
  const d = [];
  let t0 = -1;
  for (let i = 0; i < r.el.length; i++) {
    if (r.el[i] === 0) t0 = i;
    if (r.end[i] === 1 && t0 >= 0) { d.push((i - t0) / SR); t0 = -1; }
  }
  return d;
}
for (const fHz of [2, 4, 1.5, 8]) {
  const r = run(N, { fHz, end: 3 });
  const d = lastPulseDelays(r);
  if (d.length < 2) throw new Error(`ƒ ${fHz}: ${d.length} trains`);
  for (const x of d) if (Math.abs(x - 1 / fHz) > 1 / SR) throw new Error(`ƒ ${fHz}: last pulse at ${x} s, expected ${1 / fHz}`);
  if (Math.abs(r.ramp[r.ramp.length - 1] - 1 / fHz) > 1e-12) throw new Error(`ƒ ${fHz}: __End ${r.ramp[r.ramp.length - 1]}`);
  // Schedule == preview for End = 1/ƒ.
  const n = N.soemdsp_pulse_train_preview(10, 1 / fHz, 3, 1, 0.3, 1, 1);
  let t0 = r.el.indexOf(0);
  for (let i = 0; i < n; i++) {
    const s = t0 + Math.ceil(N.soemdsp_pulse_train_preview_time(i) * SR - 1e-9);
    if (r.out[s] === 0) throw new Error(`ƒ ${fHz}: pulse ${i} missing at sample ${s}`);
  }
  console.log(`ok pulseTrain ƒ ${fHz} Hz: last pulse ${d.map((x) => x.toFixed(5)).join(", ")} s after each trigger (1/ƒ = ${(1 / fHz).toFixed(5)}), schedule == preview(End 1/ƒ), __End = 1/ƒ`);
}
// 3) ƒ <= 0 (Host BPM at tempo <= 1 outputs 0): End Time knob is used.
{
  const r = run(N, { fHz: 1, end: 0.8 });
  const d = lastPulseDelays(r);
  if (!d.length || d.some((x) => Math.abs(x - 0.8) > 1 / SR)) throw new Error(`ƒ 0: delays ${d}`);
  if (r.ramp[r.ramp.length - 1] !== 0.8) throw new Error(`ƒ 0: __End ${r.ramp[r.ramp.length - 1]}`);
  console.log(`ok pulseTrain ƒ 0: End Time knob (0.8 s) used, last pulse ${d[0].toFixed(5)} s`);
}
// 4) Latched at the trigger: a schedule keeps its End even if ƒ changes mid-train.
{
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7501, hP = 0x7502, hF = 0x7503;
  N.soemdsp_graph_add_node(g, hC, TYPE_CLOCK); N.soemdsp_graph_add_node(g, hP, TYPE_PT); N.soemdsp_graph_add_node(g, hF, TYPE_HOST_BPM);
  N.soemdsp_graph_connect(g, hC, PORT_MONO, hP, PORT_TRIGGER); N.soemdsp_graph_connect(g, hF, PORT_MONO, hP, PORT_F);
  N.soemdsp_graph_set_param(g, hC, PR.RATE, 0.1);
  N.soemdsp_graph_set_host_transport(g, 2, 0, 0);
  if (N.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  N.soemdsp_graph_snap_controls(g);
  let endAt = -1;
  for (let q = 0; q < Math.ceil(1.5 * SR / 128); q++) {
    if (q === 40) N.soemdsp_graph_set_host_transport(g, 5, 0, 0); // ~0.107 s in: ƒ -> 5 Hz
    N.soemdsp_graph_process_block(g, 128);
    const e = new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, hP, PORT_LEFT) | 0, 128);
    for (let i = 0; i < 128; i++) if (e[i] === 1 && endAt < 0) endAt = q * 128 + i;
  }
  N.soemdsp_graph_destroy(g);
  if (Math.abs(endAt / SR - 0.5) > 2 / SR) throw new Error(`latch: End at ${endAt / SR} s, expected 0.5 (ƒ 2 at trigger)`);
  console.log(`ok pulseTrain ƒ latched at trigger: ƒ 2 -> 5 Hz mid-train, last pulse still at ${(endAt / SR).toFixed(5)} s`);
}
