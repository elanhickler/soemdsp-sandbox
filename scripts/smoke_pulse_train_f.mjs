// Pulse Train ƒ input (kPortF, absolute Hz): unwired is bit-identical to the
// previous build (old combined wasm as argv[2]). Wired and > 0, the whole
// Count→End Delay sequence is one oscillator cycle scaled into 1/ƒ (pitch,
// live every sample). Pulses are not dropped at 1/ƒ. ƒ <= 0 uses Time+Delay wrap.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Graph Pulse Train is Frequency (timeDenominator) + Duty (timeNumerator):
// Time = Duty/ƒ/(Fwd-Rev?2:1), End Delay = (1-Duty)/ƒ (graph 255). ptFD maps an
// old Time / End Delay pair to the same schedule.
const dualAmt = (m) => (m <= 0 ? 0 : m >= 0.5 ? 1 : m * 2);
const ptFD = (T, D, m) => { const k = 1 + dualAmt(m); const c = k * T + D; const f = 1 / c; const duty = (k * T) / c; const P = 1 / f; return { f, duty, T: duty * P / k, D: (1 - duty) * P }; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000, TYPE_CLOCK = 28, TYPE_HOST_BPM = 192, TYPE_PT = 231;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RAMP = 4, PORT_PHASE01 = 10, PORT_F = 16, PORT_TRIGGER = 20;
const PR = { RATE: 10, AMP: 12, SHAPE: 13, STAGES: 22, WIDTH: 31, TDEN: 53, TMODE: 54, IN_LOW: 80, IN_HIGH: 81, LFO_STYLE: 56, OVERSAMPLE: 32 };
function run(E, { fHz = null, end = 3, count = 10, curve = 3, rate = 0.3, seconds = 7, mode = 0, delay = 0, pulseMode = 0, wave = 0 } = {}) {
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
  const fd = ptFD(end, delay, pulseMode);
  const vals = [[PR.STAGES, count], [PR.TDEN, fd.f], [PR.SHAPE, curve], [PR.IN_LOW, 1], [PR.IN_HIGH, 0.3], [PR.WIDTH, 1], [PR.AMP, 1]];
  for (const [p, v] of vals) E.soemdsp_graph_set_param(g, hP, p, v);
  E.soemdsp_graph_set_param(g, hP, PR.LFO_STYLE, pulseMode);
  E.soemdsp_graph_set_param(g, hP, PR.TMODE, mode);
  E.soemdsp_graph_set_param(g, hP, 52, fd.duty);
  E.soemdsp_graph_set_param(g, hP, PR.OVERSAMPLE, wave);
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
  const fd = ptFD(end, delay, pulseMode);
  const vals = [[PR.STAGES, count], [PR.TDEN, fd.f], [PR.SHAPE, curve], [PR.IN_LOW, 1], [PR.IN_HIGH, 1], [PR.WIDTH, 0], [PR.AMP, 1], [PR.TMODE, 1], [PR.LFO_STYLE, pulseMode], [52, fd.duty], [PR.OVERSAMPLE, 0]];
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
function lastImpulseInWindow(out, t0, n) {
  let last = -1;
  for (let i = t0; i < t0 + n && i < out.length; i++) if (out[i] !== 0) last = i;
  return last;
}
// 2) Wired ƒ: full schedule scaled into 1/ƒ; every pulse plays; End / wrap at 1/ƒ.
for (const fHz of [2, 4, 1.5, 8]) {
  const time = 3;
  const r = run(N, { fHz, end: time });
  const d = lastPulseDelays(r);
  if (d.length < 2) throw new Error(`ƒ ${fHz}: ${d.length} trains`);
  for (const x of d) if (Math.abs(x - 1 / fHz) > 1 / SR) throw new Error(`ƒ ${fHz}: End at ${x} s, expected period ${1 / fHz}`);
  if (Math.abs(r.ramp[r.ramp.length - 1] - 1 / fHz) > 1e-12) throw new Error(`ƒ ${fHz}: __End ${r.ramp[r.ramp.length - 1]} (Duty 1: Time = 1/ƒ)`);
  const times = previewTimes(10, time, 3);
  const period = 1 / fHz;
  const scale = period / time;
  let t0 = r.el.indexOf(0);
  for (let i = 0; i < times.length; i++) {
    const s = t0 + Math.ceil(times[i] * scale * SR - 1e-9);
    if (r.out[s] === 0) throw new Error(`ƒ ${fHz}: pulse ${i} missing at sample ${s} (scaled t=${times[i] * scale})`);
  }
  console.log(`ok pulseTrain ƒ ${fHz} Hz: End ${d.map((x) => x.toFixed(5)).join(", ")} s (period 1/ƒ), all ${times.length} pulses scaled into 1/ƒ, __End = Duty/ƒ`);
}
// Delay 0 + ƒ: Time cancels (linear curve fills the period). Delay pads silence.
{
  const fHz = 2, period = 0.5, count = 8;
  const a = run(N, { fHz, end: 0.2, count, curve: 0, seconds: 2, delay: 0 });
  const b = run(N, { fHz, end: 3, count, curve: 0, seconds: 2, delay: 0 });
  const t0a = a.el.indexOf(0), t0b = b.el.indexOf(0);
  const nWin = Math.ceil(period * SR) + 2;
  const hitsA = a.out.slice(t0a, t0a + nWin).filter((v) => v !== 0).length;
  const hitsB = b.out.slice(t0b, t0b + nWin).filter((v) => v !== 0).length;
  if (hitsA !== count || hitsB !== count) throw new Error(`delay 0: Time 0.2 → ${hitsA} pulses, Time 3 → ${hitsB} (want ${count})`);
  const pad = run(N, { fHz, end: 0.2, count, curve: 0, seconds: 2, delay: 0.2 });
  const t0p = pad.el.indexOf(0);
  const lastFill = (lastImpulseInWindow(a.out, t0a, nWin) - t0a) / SR;
  const lastPad = (lastImpulseInWindow(pad.out, t0p, nWin) - t0p) / SR;
  if (Math.abs(lastFill - period) > 2 / SR) throw new Error(`delay 0 last pulse ${lastFill} s, want period ${period}`);
  if (!(lastPad < lastFill - 0.1)) throw new Error(`delay 0.2 last pulse ${lastPad} s should be earlier than delay 0 (${lastFill})`);
  console.log(`ok pulseTrain ƒ 2 Hz scale: delay 0 Time 0.2/3 both ${count} pulses fill the period; delay 0.2 last pulse ${lastPad.toFixed(5)} s`);
}
// 3) ƒ <= 0 (Host BPM at tempo <= 1 outputs 0): Time knob is used.
{
  const r = run(N, { fHz: 1, end: 0.8 });
  const d = lastPulseDelays(r);
  if (!d.length || d.some((x) => Math.abs(x - 0.8) > 1 / SR)) throw new Error(`ƒ 0: delays ${d}`);
  if (Math.abs(r.ramp[r.ramp.length - 1] - 0.8) > 1e-12) throw new Error(`ƒ 0: __End ${r.ramp[r.ramp.length - 1]}`);
  console.log(`ok pulseTrain ƒ 0: Frequency knob (1/0.8 Hz) used, last pulse ${d[0].toFixed(5)} s`);
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
  N.soemdsp_graph_set_param(g, hP, PR.TMODE, 0);
  N.soemdsp_graph_set_param(g, hP, PR.OVERSAMPLE, 0);
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
    ["Fwd-Rev Time 1", 0.5, 1, 0],
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
// 7) New graph node defaults: Shape Saw (oversample 2).
{
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const hP = 0x7701;
  if (N.soemdsp_graph_add_node(g, hP, TYPE_PT) | 0) throw new Error("default add");
  if (N.soemdsp_graph_compile(g) | 0) throw new Error("default compile");
  N.soemdsp_graph_snap_controls(g);
  N.soemdsp_graph_process_block(g, 128);
  const out = new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, hP, PORT_MONO) | 0, 128);
  const nonzero = [...out].filter((v) => v !== 0).length;
  N.soemdsp_graph_destroy(g);
  if (nonzero < 64) throw new Error(`default Shape Saw: only ${nonzero} nonzero samples in first block (Loop saw grain)`);
  console.log(`ok pulseTrain default Shape Saw: ${nonzero} nonzero samples in first Loop block`);
}
if ((N.soemdsp_graph_version() | 0) < 252) throw new Error(`graph version ${N.soemdsp_graph_version()}`);
if ((N.soemdsp_pulse_train_version() | 0) < 18) throw new Error(`pulse_train v${N.soemdsp_pulse_train_version()}`);
console.log("ok pulseTrain ƒ scales Count→End Delay into 1/ƒ");
