// Pulse Train ƒ input (kPortF, absolute Hz): unwired is bit-identical to the
// previous build (old combined wasm as argv[2]). Wired and > 0, Loop wrap /
// one-shot cutoff = 1/ƒ (pitch, live every sample). Time stays the E_k grain
// window; pulses with t >= 1/ƒ are dropped. ƒ <= 0 uses the Time knob for wrap.
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
const PR = { RATE: 10, AMP: 12, SHAPE: 13, STAGES: 22, WIDTH: 31, TDEN: 53, TMODE: 54, IN_LOW: 80, IN_HIGH: 81, LFO_STYLE: 56 };
function run(E, { fHz = null, end = 3, count = 10, curve = 3, rate = 0.3, seconds = 7, mode = 0, delay = 0, pulseMode = 0 } = {}) {
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
  E.soemdsp_graph_set_param(g, hP, PR.LFO_STYLE, pulseMode);
  E.soemdsp_graph_set_param(g, hP, PR.TMODE, mode);
  E.soemdsp_graph_set_param(g, hP, 52, delay); // timeNumerator End Delay
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
function runLoop(E, { fHz, end = 3, count = 10, curve = 0, seconds = 1.2, delay = 0, pulseMode = 0 } = {}) {
  const g = E.soemdsp_graph_create() | 0;
  E.soemdsp_graph_set_sample_rate(g, SR);
  const hP = 0x7602, hF = 0x7603;
  if (E.soemdsp_graph_add_node(g, hP, TYPE_PT) | 0) throw new Error("pt add");
  if (E.soemdsp_graph_add_node(g, hF, TYPE_HOST_BPM) | 0) throw new Error("bpm add");
  if (E.soemdsp_graph_connect(g, hF, PORT_MONO, hP, PORT_F) | 0) throw new Error("bpm->f");
  E.soemdsp_graph_set_host_transport(g, fHz, 0, 0);
  const vals = [[PR.STAGES, count], [PR.TDEN, end], [PR.SHAPE, curve], [PR.IN_LOW, 1], [PR.IN_HIGH, 1], [PR.WIDTH, 0], [PR.AMP, 1], [PR.TMODE, 1], [PR.LFO_STYLE, pulseMode], [52, delay]];
  for (const [p, v] of vals) E.soemdsp_graph_set_param(g, hP, p, v);
  if (E.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  E.soemdsp_graph_snap_controls(g);
  const r = { out: [], end: [], el: [] };
  for (let q = 0; q < Math.ceil(seconds * SR / 128); q++) {
    E.soemdsp_graph_process_block(g, 128);
    const rd = (h, port) => new Float64Array(E.memory.buffer, E.soemdsp_graph_node_port_ptr(g, h, port) | 0, 128);
    r.out.push(...rd(hP, PORT_MONO)); r.end.push(...rd(hP, PORT_LEFT)); r.el.push(...rd(hP, PORT_PHASE01));
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
function lastPulseDelays(r) {
  const d = [];
  let t0 = -1;
  for (let i = 0; i < r.el.length; i++) {
    if (r.el[i] === 0) t0 = i;
    if (r.end[i] === 1 && t0 >= 0) { d.push((i - t0) / SR); t0 = -1; }
  }
  return d;
}
function previewTimes(count, time, curve) {
  const n = N.soemdsp_pulse_train_preview(count, time, curve, 1, 0.3, 1, 1);
  const t = [];
  for (let i = 0; i < n; i++) t.push(N.soemdsp_pulse_train_preview_time(i));
  return t;
}
// 2) Wired ƒ: Time knob is the schedule; End / wrap at 1/ƒ; pulses with t >= 1/ƒ dropped.
for (const fHz of [2, 4, 1.5, 8]) {
  const time = 3;
  const r = run(N, { fHz, end: time });
  const d = lastPulseDelays(r);
  if (d.length < 2) throw new Error(`ƒ ${fHz}: ${d.length} trains`);
  for (const x of d) if (Math.abs(x - 1 / fHz) > 1 / SR) throw new Error(`ƒ ${fHz}: End at ${x} s, expected period ${1 / fHz}`);
  if (Math.abs(r.ramp[r.ramp.length - 1] - time) > 1e-12) throw new Error(`ƒ ${fHz}: __End ${r.ramp[r.ramp.length - 1]} (Time knob, not 1/ƒ)`);
  const times = previewTimes(10, time, 3);
  const period = 1 / fHz;
  let t0 = r.el.indexOf(0);
  for (let i = 0; i < times.length; i++) {
    const s = t0 + Math.ceil(times[i] * SR - 1e-9);
    if (times[i] >= period) {
      if (s < r.out.length && r.out[s] !== 0 && Math.abs((s - t0) / SR - times[i]) < 2 / SR) {
        throw new Error(`ƒ ${fHz}: pulse ${i} at t=${times[i]} should be dropped (>= period ${period})`);
      }
    } else if (r.out[s] === 0) {
      throw new Error(`ƒ ${fHz}: pulse ${i} missing at sample ${s} (t=${times[i]} < period ${period})`);
    }
  }
  console.log(`ok pulseTrain ƒ ${fHz} Hz: End ${d.map((x) => x.toFixed(5)).join(", ")} s (period 1/ƒ), Time window ${time} s, __End = Time`);
}
// Time still changes density inside a fixed period.
{
  const fHz = 2, period = 0.5;
  const sparse = run(N, { fHz, end: 0.2, count: 8, curve: 0, seconds: 2 });
  const dense = run(N, { fHz, end: 3, count: 8, curve: 0, seconds: 2 });
  const t0s = sparse.el.indexOf(0), t0d = dense.el.indexOf(0);
  const nSparse = sparse.out.slice(t0s, t0s + Math.ceil(period * SR)).filter((v) => v !== 0).length;
  const nDense = dense.out.slice(t0d, t0d + Math.ceil(period * SR)).filter((v) => v !== 0).length;
  if (!(nSparse > nDense)) throw new Error(`Time window: Time 0.2 → ${nSparse} pulses, Time 3 → ${nDense} (shorter Time packs more of Count into 1/ƒ)`);
  console.log(`ok pulseTrain ƒ 2 Hz Time window: Time 0.2 → ${nSparse} pulses/period, Time 3 → ${nDense} pulses/period`);
}
// 3) ƒ <= 0 (Host BPM at tempo <= 1 outputs 0): Time knob is used.
{
  const r = run(N, { fHz: 1, end: 0.8 });
  const d = lastPulseDelays(r);
  if (!d.length || d.some((x) => Math.abs(x - 0.8) > 1 / SR)) throw new Error(`ƒ 0: delays ${d}`);
  if (r.ramp[r.ramp.length - 1] !== 0.8) throw new Error(`ƒ 0: __End ${r.ramp[r.ramp.length - 1]}`);
  console.log(`ok pulseTrain ƒ 0: Time knob (0.8 s) used, last pulse ${d[0].toFixed(5)} s`);
}
// 4) ƒ is live (even Recalculate On): 2 → 5 Hz mid-train, End tracks 1/5.
{
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7501, hP = 0x7502, hF = 0x7503;
  N.soemdsp_graph_add_node(g, hC, TYPE_CLOCK); N.soemdsp_graph_add_node(g, hP, TYPE_PT); N.soemdsp_graph_add_node(g, hF, TYPE_HOST_BPM);
  N.soemdsp_graph_connect(g, hC, PORT_MONO, hP, PORT_TRIGGER); N.soemdsp_graph_connect(g, hF, PORT_MONO, hP, PORT_F);
  N.soemdsp_graph_set_param(g, hC, PR.RATE, 0.1);
  N.soemdsp_graph_set_param(g, hP, PR.LFO_STYLE, 0);
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
  if (Math.abs(endAt / SR - 0.2) > 2 / SR) throw new Error(`live ƒ: End at ${endAt / SR} s, expected 0.2 (ƒ 5 after glide)`);
  console.log(`ok pulseTrain ƒ live mid-train: ƒ 2 -> 5 Hz, End at ${(endAt / SR).toFixed(5)} s (1/5)`);
}
// 5) Loop wrap = 1/ƒ at any Time; Fwd-Rev does not 2× the period; End Delay does not detune.
{
  const fHz = 4, period = 0.25;
  for (const [label, pulseMode, end, delay] of [
    ["Forward Time 1", 0, 1, 0],
    ["Forward Time 0.05", 0, 0.05, 0],
    ["Fwd-Rev Time 1", 1, 1, 0],
    ["Forward delay +0.1", 0, 0.05, 0.1],
  ]) {
    const r = runLoop(N, { fHz, end, count: 8, curve: 0, seconds: 1.05, delay, pulseMode });
    const wraps = [];
    for (let i = 1; i < r.el.length; i++) if (r.el[i] === 0 && r.el[i - 1] > 0) wraps.push(i);
    if (wraps.length < 3) throw new Error(`loop ${label}: ${wraps.length} wraps`);
    const gaps = [];
    for (let i = 1; i < wraps.length; i++) gaps.push((wraps[i] - wraps[i - 1]) / SR);
    for (const g of gaps) if (Math.abs(g - period) > 2 / SR) throw new Error(`loop ${label}: wrap ${g} s, expected ${period}`);
    console.log(`ok pulseTrain Loop ƒ ${fHz} Hz ${label}: wrap ${gaps[0].toFixed(5)} s`);
  }
}
// 6) Direct sample: omitted freqHz == 0 is Time wrap (bit-identical to passing 0).
{
  const set = [8, 0.4, 0, 1, 1, 0, 1];
  const n = Math.ceil(0.5 * SR);
  const h0 = N.soemdsp_pulse_train_create(), h1 = N.soemdsp_pulse_train_create();
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const a = N.soemdsp_pulse_train_sample(h0, i === 0 ? 1 : 0, ...set, SR, 0, 0, 0, 0);
    const b = N.soemdsp_pulse_train_sample(h1, i === 0 ? 1 : 0, ...set, SR, 0, 0, 0, 0, 0, 0, 0, 0);
    worst = Math.max(worst, Math.abs(a - b));
  }
  N.soemdsp_pulse_train_destroy(h0); N.soemdsp_pulse_train_destroy(h1);
  if (worst !== 0) throw new Error(`omitted freqHz differs from 0 (${worst})`);
  console.log("ok pulseTrain omitted freqHz == 0: Time wrap, max diff 0");
}
console.log("ok pulseTrain ƒ is period lock, Time is grain window");
