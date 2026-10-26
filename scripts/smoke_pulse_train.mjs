// Pulse Train: schedule t_i = End * E_k(u_i) (E_k(u) = (e^(k u) - 1) / (e^k - 1),
// k = 0 linear), first pulse 0, last pulse == End (no cap past 12 s), gaps grow for
// Curve > 0 (even at 0, shrink below 0), amplitude curve, preview == played
// sample-exact (velocity scales), End out, retrigger restarts, graph path == direct.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Graph Pulse Train is Frequency (timeDenominator) + Duty (timeNumerator):
// Time = Duty/ƒ/(Fwd-Rev?2:1), End Delay = (1-Duty)/ƒ (graph 255). ptFD maps an
// old Time / End Delay pair to the same schedule.
const spanScale = (m) => (m <= 0.5 ? 1 + 2 * m : 3 - 2 * m);
const ptFD = (T, D, m) => { const k = spanScale(m); const c = k * T + D; const f = 1 / c; const duty = (k * T) / c; const P = 1 / f; return { f, duty, T: duty * P / k, D: (1 - duty) * P }; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const S = await load(path.join(root, "native_modules", "pulse_train", "pulse_train.wasm"));
const SR = 48000;
const E = (k, u) => (Math.abs(k) <= 1e-6 ? u : (Math.exp(k * u) - 1) / (Math.exp(k) - 1));
// count, end, curve, ampStart, ampEnd, ampCurve, amplitude
const SETS = [
  [12, 3, 3, 1, 0.2, 0, 1],
  [40, 12, 6, 1, 0, 2, 0.8],
  [7, 0.5, 0, 0.3, 0.9, -3, 1.7],
  [128, 12, 10, 1, 0.1, 5, 1],
  [16, 2, -4, 1, 1, 0, 1],
  [1, 4, 3, 0.6, 0.1, 0, 1],
  [5, 20, 2, 1, 0.5, 0, 3],
];
function preview(E2, set) {
  const n = E2.soemdsp_pulse_train_preview(...set);
  const t = [], a = [];
  for (let i = 0; i < n; i++) { t.push(E2.soemdsp_pulse_train_preview_time(i)); a.push(E2.soemdsp_pulse_train_preview_amplitude(i)); }
  return { t, a };
}
// 1) Schedule formulas
for (const [k, set] of SETS.entries()) {
  const [count, end0, curve, aS, aE, aC, amp] = set;
  const end = Math.max(0, end0);
  const { t, a } = preview(N, set);
  const s2 = preview(S, set);
  if (JSON.stringify(s2) !== JSON.stringify({ t, a })) throw new Error(`set ${k}: standalone preview != combined`);
  if (t.length !== count) throw new Error(`set ${k}: count ${t.length}`);
  if (t[0] !== 0) throw new Error(`set ${k}: first pulse ${t[0]}`);
  if (count > 1 && t[count - 1] !== end) throw new Error(`set ${k}: last ${t[count - 1]} != End ${end}`);
  let worst = 0, worstA = 0;
  for (let i = 0; i < count; i++) {
    const u = count > 1 ? i / (count - 1) : 0;
    worst = Math.max(worst, Math.abs(t[i] - end * E(curve, u)));
    worstA = Math.max(worstA, Math.abs(a[i] - (aS + (aE - aS) * E(aC, u)) * amp));
  }
  if (worst > 1e-6 * Math.max(1, end)) throw new Error(`set ${k}: time formula off ${worst}`);
  if (worstA > 1e-6) throw new Error(`set ${k}: amp formula off ${worstA}`);
  for (let i = 2; i < count; i++) {
    const g0 = t[i - 1] - t[i - 2], g1 = t[i] - t[i - 1];
    const ok = curve > 0 ? g1 > g0 : curve < 0 ? g1 < g0 : Math.abs(g1 - g0) < 1e-9;
    if (!ok) throw new Error(`set ${k}: gap ${i} ${g0} -> ${g1} (curve ${curve})`);
  }
}
console.log(`ok pulseTrain schedule: ${SETS.length} sets, t_i = End*E_k(u_i), first 0, last == End (End 20 plays at 20 s, no hidden cap), gaps grow / even / shrink by Curve sign, amp curve, standalone == combined`);
{
  const n = 12, end = 3;
  const lin = preview(N, [n, end, 0, 1, 0.2, 0, 1]);
  const harm0 = preview(N, [n, end, 0, 1, 0.2, 0, 1, 0, 0, 0, 0, 1]);
  const rat0 = preview(N, [n, end, 0, 1, 0.2, 0, 1, 0, 0, 0, 0, 2]);
  for (let i = 0; i < n; i++) {
    if (Math.abs(harm0.t[i] - lin.t[i]) > 1e-12) throw new Error(`harmonic curve 0 != linear at ${i}`);
    if (Math.abs(rat0.t[i] - lin.t[i]) > 1e-12) throw new Error(`rational curve 0 != linear at ${i}`);
  }
  const harm = preview(N, [n, end, 10, 1, 0.2, 0, 1, 0, 0, 0, 0, 1]);
  const sHarm = preview(S, [n, end, 10, 1, 0.2, 0, 1, 0, 0, 0, 0, 1]);
  if (JSON.stringify(harm) !== JSON.stringify(sHarm)) throw new Error("harmonic standalone != combined");
  if (harm.t[0] !== 0) throw new Error("harmonic first");
  if (harm.t[n - 1] !== end) throw new Error("harmonic last");
  for (let i = 0; i < n; i++) {
    const want = end * (i * (i + 1)) / ((n - 1) * n);
    if (Math.abs(harm.t[i] - want) > 1e-9 * end) throw new Error(`harmonic t[${i}] ${harm.t[i]} != ${want}`);
  }
  for (let i = 2; i < n; i++) {
    const g0 = harm.t[i - 1] - harm.t[i - 2], g1 = harm.t[i] - harm.t[i - 1];
    if (!(g1 > g0)) throw new Error(`harmonic gaps not growing ${g0} -> ${g1}`);
  }
  const rat = preview(N, [n, end, 10, 1, 0.2, 0, 1, 0, 0, 0, 0, 2]);
  if (rat.t[0] !== 0 || rat.t[n - 1] !== end) throw new Error("rational ends");
  const s = 0.99;
  for (let i = 1; i < n - 1; i++) {
    const u = i / (n - 1);
    const want = end * ((1 + s) * u) / (1 - s + 2 * s * u);
    if (Math.abs(rat.t[i] - want) > 1e-9 * end) throw new Error(`rational t[${i}]`);
  }
  console.log("ok pulseTrain spacing: Expo omitted, Harmonic multiples, Rational, Curve 0 = linear");
}
// 2) Playback == preview sample-exact, velocity scales, End out, elapsed.
function play(E2, set, trigFn, n) {
  const h = E2.soemdsp_pulse_train_create();
  const out = new Float64Array(n), endo = new Float64Array(n), el = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = E2.soemdsp_pulse_train_sample(h, trigFn(i), ...set, SR, 0, 0, 0, 0); // mode One shot, Recalc Off, Dual Off, End Delay 0
    endo[i] = E2.soemdsp_pulse_train_end(h);
    el[i] = E2.soemdsp_pulse_train_elapsed(h);
  }
  E2.soemdsp_pulse_train_destroy(h);
  return { out, endo, el };
}
function expected(set, vel, at, n) {
  const { t, a } = preview(N, set);
  const y = new Float64Array(n);
  let j = 0, last = -1;
  for (let s = at; s < n && j < t.length; s++) {
    const e = (s - at) / SR;
    while (j < t.length && t[j] <= e) { y[s] += a[j] * vel; j++; last = s; }
  }
  return { y, last };
}
for (const [k, set] of SETS.entries()) {
  for (const vel of [1, 0.5]) {
    const at = 37, n = at + Math.ceil((Math.max(12, set[1]) + 0.01) * SR);
    const r = play(N, set, (i) => (i >= at ? vel : 0), n);
    const { y, last } = expected(set, vel, at, n);
    for (let i = 0; i < n; i++) if (Math.abs(r.out[i] - y[i]) > 1e-12) throw new Error(`set ${k} vel ${vel}: sample ${i} out ${r.out[i]} expected ${y[i]}`);
    for (let i = 0; i < n; i++) if (r.endo[i] !== (i === last ? 1 : 0)) throw new Error(`set ${k}: End at ${i} = ${r.endo[i]} (last pulse ${last})`);
    if (r.el[at - 1] !== -1 || r.el[at] !== 0 || r.el[last + 1] !== -1) throw new Error(`set ${k}: elapsed ${r.el[at - 1]} ${r.el[at]} ${r.el[last + 1]}`);
  }
}
console.log(`ok pulseTrain playback == preview sample-exact (${SETS.length} sets x velocity 1 / 0.5), End = 1 on the last pulse sample only, __Elapsed -1 idle / 0 at trigger`);
// 3) A Trigger hit mid-train restarts it (no Reset input since v4).
{
  const set = SETS[0];
  const re = play(N, set, (i) => (i < 10 ? 0 : i < 2 * SR ? 1 : i < 2 * SR + 5 ? 0 : 1), 6 * SR);
  const second = expected(set, 1, 2 * SR + 5, 6 * SR).y;
  for (let i = 2 * SR + 5; i < 6 * SR; i++) if (Math.abs(re.out[i] - second[i]) > 1e-12) throw new Error(`retrigger: ${i}`);
  if (re.el[2 * SR + 5] !== 0) throw new Error("retrigger: elapsed not reset");
}
console.log("ok pulseTrain a new Trigger hit mid-train restarts it (single Trigger input)");
// 3b) Count 16384 (formula DSP, no 128 buffer): last pulse == End, playback sample-exact on a short Time.
{
  const set = [16384, 0.02, 3, 1, 0.1, 2, 1];
  const { t, a } = preview(N, set);
  const s2 = preview(S, set);
  if (JSON.stringify(s2) !== JSON.stringify({ t, a })) throw new Error("16384: standalone preview != combined");
  if (t.length !== 16384) throw new Error(`16384: count ${t.length}`);
  if (t[0] !== 0) throw new Error(`16384: first pulse ${t[0]}`);
  if (t[16383] !== 0.02) throw new Error(`16384: last ${t[16383]} != 0.02`);
  const at = 5, n = at + Math.ceil(0.03 * SR);
  const r = play(N, set, (i) => (i >= at ? 1 : 0), n);
  const { y, last } = expected(set, 1, at, n);
  for (let i = 0; i < n; i++) if (Math.abs(r.out[i] - y[i]) > 1e-12) throw new Error(`16384: sample ${i} out ${r.out[i]} expected ${y[i]}`);
  if (r.endo[last] !== 1) throw new Error(`16384: End not on last pulse sample ${last}`);
  let hits = 0;
  for (let i = 0; i < n; i++) if (r.out[i] !== 0) hits++;
  if (hits < 1) throw new Error("16384: no pulses played");
  console.log(`ok pulseTrain Count 16384: t_0 = 0, t_last = End, standalone == combined, playback sample-exact (${hits} occupied samples in 20 ms)`);
}
// 4) Graph path: Clock -> Trigger; engine Out / End / __Elapsed == direct module on the same trigger.
{
  const TYPE_CLOCK = 28, TYPE_PT = 231, PORT_MONO = 0, PORT_LEFT = 1, PORT_PHASE01 = 10, PORT_TRIGGER = 20;
  const PR = { RATE: 10, AMP: 12, SHAPE: 13, STAGES: 22, WIDTH: 31, TDEN: 53, TMODE: 54, IN_LOW: 80, IN_HIGH: 81, LFO_STYLE: 56, OVERSAMPLE: 32 };
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7301, hP = 0x7302;
  if (N.soemdsp_graph_add_node(g, hC, TYPE_CLOCK) | 0) throw new Error("clock add");
  if (N.soemdsp_graph_add_node(g, hP, TYPE_PT) | 0) throw new Error("pulse train add");
  if (N.soemdsp_graph_connect(g, hC, PORT_MONO, hP, PORT_TRIGGER) | 0) throw new Error("connect");
  N.soemdsp_graph_set_param(g, hC, PR.RATE, 0.4);
  N.soemdsp_graph_set_param(g, hC, PR.AMP, 0.8);
  const set = [20, 2, 4, 1, 0.1, 1, 1.5];
  const keys = [PR.STAGES, PR.TDEN, PR.SHAPE, PR.IN_LOW, PR.IN_HIGH, PR.WIDTH, PR.AMP];
  keys.forEach((p, i) => N.soemdsp_graph_set_param(g, hP, p, set[i]));
  { const fd = ptFD(set[1], 0, 0); N.soemdsp_graph_set_param(g, hP, 53, fd.f); N.soemdsp_graph_set_param(g, hP, 52, fd.duty); set[1] = fd.T; }
  N.soemdsp_graph_set_param(g, hP, PR.LFO_STYLE, 0); // Pulse Mode Forward
  N.soemdsp_graph_set_param(g, hP, PR.TMODE, 0); // One shot
  N.soemdsp_graph_set_param(g, hP, PR.OVERSAMPLE, 0); // Trigger (impulse Shape)
  if (N.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  N.soemdsp_graph_snap_controls(g);
  const trig = [], out = [], endo = [], el = [];
  for (let q = 0; q < Math.ceil(6 * SR / 128); q++) {
    N.soemdsp_graph_process_block(g, 128);
    const rd = (h, port) => new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, h, port) | 0, 128);
    trig.push(...rd(hC, PORT_MONO)); out.push(...rd(hP, PORT_MONO)); endo.push(...rd(hP, PORT_LEFT)); el.push(...rd(hP, PORT_PHASE01));
  }
  N.soemdsp_graph_destroy(g);
  const d = play(N, set, (i) => trig[i], trig.length);
  let pulses = 0, peak = 0;
  for (let i = 0; i < trig.length; i++) {
    if (out[i] !== d.out[i] || endo[i] !== d.endo[i] || el[i] !== d.el[i]) throw new Error(`graph != direct at ${i}: ${out[i]} vs ${d.out[i]}`);
    if (out[i] !== 0) { pulses++; peak = Math.max(peak, out[i]); }
  }
  if (pulses < 20) throw new Error(`graph: only ${pulses} pulses`);
  if (Math.abs(peak - 1.5 * 0.8) > 1e-9) throw new Error(`graph: peak ${peak}, expected Amplitude 1.5 x velocity 0.8 (no clamp)`);
  console.log(`ok pulseTrain graph (type 231, Clock -> Trigger) == direct: Out / End / __Elapsed max diff 0, ${pulses} pulses, peak ${peak.toFixed(3)} = Amplitude 1.5 x velocity 0.8`);
}
// 4b) Graph Forward-Reverse + End Delay 0 == direct Pulse Mode 1.
{
  const TYPE_CLOCK = 28, TYPE_PT = 231, PORT_MONO = 0, PORT_LEFT = 1, PORT_PHASE01 = 10, PORT_TRIGGER = 20;
  const PR = { RATE: 10, AMP: 12, SHAPE: 13, STAGES: 22, WIDTH: 31, TNUM: 52, TDEN: 53, TMODE: 54, IN_LOW: 80, IN_HIGH: 81, LFO_STYLE: 56, OVERSAMPLE: 32 };
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7311, hP = 0x7312;
  if (N.soemdsp_graph_add_node(g, hC, TYPE_CLOCK) | 0) throw new Error("dual graph clock add");
  if (N.soemdsp_graph_add_node(g, hP, TYPE_PT) | 0) throw new Error("dual graph pt add");
  if (N.soemdsp_graph_connect(g, hC, PORT_MONO, hP, PORT_TRIGGER) | 0) throw new Error("dual graph connect");
  N.soemdsp_graph_set_param(g, hC, PR.RATE, 0.5);
  N.soemdsp_graph_set_param(g, hC, PR.AMP, 1);
  const set = [6, 0.15, 4, 1, 0.2, 0, 1];
  const keys = [PR.STAGES, PR.TDEN, PR.SHAPE, PR.IN_LOW, PR.IN_HIGH, PR.WIDTH, PR.AMP];
  keys.forEach((p, i) => N.soemdsp_graph_set_param(g, hP, p, set[i]));
  { const fd = ptFD(set[1], 0, 0.5); N.soemdsp_graph_set_param(g, hP, 53, fd.f); N.soemdsp_graph_set_param(g, hP, 52, fd.duty); set[1] = fd.T; }
  N.soemdsp_graph_set_param(g, hP, PR.LFO_STYLE, 0.5);
  N.soemdsp_graph_set_param(g, hP, PR.TMODE, 0);
  N.soemdsp_graph_set_param(g, hP, PR.OVERSAMPLE, 0);
  if (N.soemdsp_graph_compile(g) | 0) throw new Error("dual graph compile");
  N.soemdsp_graph_snap_controls(g);
  const trig = [], out = [], endo = [], el = [];
  for (let q = 0; q < Math.ceil(1.2 * SR / 128); q++) {
    N.soemdsp_graph_process_block(g, 128);
    const rd = (h, port) => new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, h, port) | 0, 128);
    trig.push(...rd(hC, PORT_MONO)); out.push(...rd(hP, PORT_MONO)); endo.push(...rd(hP, PORT_LEFT)); el.push(...rd(hP, PORT_PHASE01));
  }
  N.soemdsp_graph_destroy(g);
  const h = N.soemdsp_pulse_train_create();
  const dOut = new Float64Array(trig.length), dEnd = new Float64Array(trig.length), dEl = new Float64Array(trig.length);
  for (let i = 0; i < trig.length; i++) {
    dOut[i] = N.soemdsp_pulse_train_sample(h, trig[i], ...set, SR, 0, 1, 0.5, 0);
    dEnd[i] = N.soemdsp_pulse_train_end(h);
    dEl[i] = N.soemdsp_pulse_train_elapsed(h);
  }
  N.soemdsp_pulse_train_destroy(h);
  let pulses = 0;
  for (let i = 0; i < trig.length; i++) {
    if (out[i] !== dOut[i] || endo[i] !== dEnd[i] || el[i] !== dEl[i]) throw new Error(`dual graph != direct at ${i}: ${out[i]} vs ${dOut[i]}`);
    if (out[i] !== 0) pulses++;
  }
  if (pulses < 10) throw new Error(`dual graph: only ${pulses} occupied samples`);
  console.log(`ok pulseTrain graph Forward-Reverse == direct (${pulses} occupied samples)`);
}
// 5) Fwd-Rev 0.5 + polarity: reverse-then-forward, amplitude peak at Time, last at 2T.
{
  const set = [8, 0.2, 3, 1, 0.2, 0, 1];
  const fwd = preview(N, set);
  const dual = preview(N, [...set, 0, 0.5, 0]);
  const s2 = preview(S, [...set, 0, 0.5, 0]);
  if (JSON.stringify(s2) !== JSON.stringify(dual)) throw new Error("dual: standalone preview != combined");
  const Nf = set[0], T = set[1];
  if (dual.t.length !== 2 * Nf - 1) throw new Error(`dual: count ${dual.t.length} want ${2 * Nf - 1}`);
  const peakI = dual.a.indexOf(Math.max(...dual.a));
  if (Math.abs(dual.t[peakI] - T) > 1e-12) throw new Error(`dual: peak t ${dual.t[peakI]} != Time`);
  if (dual.t[dual.t.length - 1] !== 2 * T) throw new Error(`dual: last ${dual.t[dual.t.length - 1]} != 2*Time`);
  if (dual.t[0] !== 0) throw new Error("dual: attack should start at t=0");
  if (!(dual.a[0] < dual.a[peakI] - 1e-9)) throw new Error("dual: first pulse should be the attack (quieter than the peak)");
  const eFwd = fwd.a.reduce((s, v) => s + v, 0);
  const eDual = dual.a.reduce((s, v) => s + v, 0);
  if (Math.abs(eDual - (2 * eFwd - fwd.a[0])) > 1e-9) throw new Error(`dual: energy ${eDual} vs ${2 * eFwd - fwd.a[0]}`);
  const at = 4, n = at + Math.ceil(0.42 * SR);
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0.5, 0);
  N.soemdsp_pulse_train_destroy(h);
  const y = new Float64Array(n);
  let j = 0, last = -1;
  for (let s = at; s < n && j < dual.t.length; s++) {
    const e = (s - at) / SR;
    while (j < dual.t.length && dual.t[j] <= e) { y[s] += dual.a[j]; j++; last = s; }
  }
  for (let i = 0; i < n; i++) if (Math.abs(out[i] - y[i]) > 1e-12) throw new Error(`dual play: sample ${i} ${out[i]} vs ${y[i]}`);
  const loopP = preview(N, [...set, 1, 0.5, 0]);
  if (loopP.t.length !== 2 * Nf - 1) throw new Error(`dual loop: count ${loopP.t.length}`);
  if (loopP.t[0] !== 0) throw new Error("dual loop: attack should start at t=0");
  const loopLast = T + T * E(set[2], (Nf - 1) / Nf);
  if (Math.abs(loopP.t[loopP.t.length - 1] - loopLast) > 1e-6) throw new Error(`dual loop last ${loopP.t[loopP.t.length - 1]} want ${loopLast}`);
  const cap = preview(N, [16384, 0.01, 0, 1, 1, 0, 1, 0, 0.5, 0]);
  if (cap.t.length !== 16383) throw new Error(`dual cap: count ${cap.t.length} want 16383 (nFwd 8192, 2N-1)`);
  console.log(`ok pulseTrain Fwd-Rev 0.5: reverse-then-forward peak at Time, last=2T, Loop 2N-1, playback sample-exact, last pulse sample ${last}`);
}
// 5b) + polarity: 0.25 grows an attack prefix (peak walks right). 1.0 is one-way reverse (peak at Time).
//     - polarity: same times, each amp flips around (A Start + A End)/2.
{
  const set = [8, 0.2, 3, 1, 0.2, 0, 1];
  const Nf = set[0], T = set[1];
  const grow = preview(N, [...set, 0, 0.25, 0]);
  const sGrow = preview(S, [...set, 0, 0.25, 0]);
  if (JSON.stringify(sGrow) !== JSON.stringify(grow)) throw new Error("fwdrev 0.25: standalone preview != combined");
  if (grow.t.length !== 2 * Nf - 1) throw new Error(`fwdrev 0.25: count ${grow.t.length} want ${2 * Nf - 1}`);
  const gPeak = grow.a.indexOf(Math.max(...grow.a));
  if (grow.t[0] !== 0) throw new Error("fwdrev 0.25: attack should start at t=0");
  if (Math.abs(grow.t[gPeak] - 0.5 * T) > 1e-12) throw new Error(`fwdrev 0.25: peak ${grow.t[gPeak]} != 0.5*Time`);
  if (Math.abs(grow.t[grow.t.length - 1] - 1.5 * T) > 1e-12) throw new Error(`fwdrev 0.25: last ${grow.t[grow.t.length - 1]} != 1.5*Time`);
  if (!(grow.a[0] < grow.a[gPeak] - 1e-9)) throw new Error("fwdrev 0.25: first pulse should be the attack");
  const rf = preview(N, [...set, 0, 1, 0]);
  if (rf.t.length !== Nf) throw new Error(`fwdrev 1.0: count ${rf.t.length} want ${Nf}`);
  const rPeak = rf.a.indexOf(Math.max(...rf.a));
  if (Math.abs(rf.t[rPeak] - T) > 1e-12) throw new Error(`fwdrev 1.0: peak ${rf.t[rPeak]} != Time`);
  if (rf.t[0] !== 0) throw new Error("fwdrev 1.0: first should be at t=0");
  if (!(rf.a[0] < rf.a[rPeak] - 1e-9)) throw new Error("fwdrev 1.0: start should be quieter than the peak");
  for (let j = 1; j < rf.t.length; j++) {
    if (!(rf.t[j] >= rf.t[j - 1] - 1e-12)) throw new Error(`fwdrev 1.0 times not ordered at ${j}`);
  }
  const alias = preview(N, [...set, 0, 3, 0]);
  if (JSON.stringify(alias) !== JSON.stringify(rf)) throw new Error("old integer 3 does not alias to Fwd-Rev 1.0");
  const inv = preview(N, [...set, 0, 0.25, 0, 1]);
  const invS = preview(S, [...set, 0, 0.25, 0, 1]);
  if (JSON.stringify(invS) !== JSON.stringify(inv)) throw new Error("polarity -: standalone != combined");
  if (inv.t.length !== 2 * Nf - 1) throw new Error(`polarity - 0.25: count ${inv.t.length}`);
  if (JSON.stringify(inv.t) !== JSON.stringify(grow.t)) throw new Error("polarity -: times must match + (vertical invert)");
  const midA = set[3] + set[4];
  for (let j = 0; j < grow.a.length; j++) {
    if (Math.abs(grow.a[j] + inv.a[j] - midA) > 1e-12) throw new Error(`polarity -: amp ${inv.a[j]} + ${grow.a[j]} != ${midA} at ${j}`);
  }
  const troughI = inv.a.indexOf(Math.min(...inv.a));
  if (Math.abs(inv.t[troughI] - 0.5 * T) > 1e-12) throw new Error(`polarity - 0.25: trough ${inv.t[troughI]} != 0.5*Time`);
  if (!(inv.a[0] > inv.a[troughI] + 1e-9)) throw new Error("polarity - 0.25: start should be louder than the trough");
  if (Math.abs(inv.t[inv.t.length - 1] - 1.5 * T) > 1e-12) throw new Error("polarity - 0.25: last != 1.5*Time");
  const mid = preview(N, [...set, 0, 0.5, 0]);
  const midInv = preview(N, [...set, 0, 0.5, 0, 1]);
  const midPeak = mid.a.indexOf(Math.max(...mid.a));
  const midTrough = midInv.a.indexOf(Math.min(...midInv.a));
  if (Math.abs(mid.t[midPeak] - T) > 1e-12) throw new Error("0.5 +: peak not at Time");
  if (Math.abs(midInv.t[midTrough] - T) > 1e-12) throw new Error("0.5 -: trough not at Time (center stays)");
  if (JSON.stringify(mid.t) !== JSON.stringify(midInv.t)) throw new Error("0.5 -: times must match +");
  const bent = [8, 0.2, 3, 1, 0.2, 4, 1];
  const bPlus = preview(N, [...bent, 0, 0.5, 0]);
  const bInv = preview(N, [...bent, 0, 0.5, 0, 1]);
  if (JSON.stringify(bPlus.t) !== JSON.stringify(bInv.t)) throw new Error("ampCurve invert: times moved");
  for (let j = 0; j < bPlus.a.length; j++) {
    if (Math.abs(bPlus.a[j] + bInv.a[j] - 1.2) > 1e-9) throw new Error(`ampCurve invert not vertical at ${j}`);
  }
  console.log("ok pulseTrain Fwd-Rev 0.25 peak walks right; 1.0 is reverse over Time; polarity - is a vertical invert");
}
// 6) End Delay: One-shot End after last pulse + delay. Count 1 last pulse is t=0.
{
  const set = [5, 0.1, 0, 1, 1, 0, 1];
  const delay = 0.05;
  const { t } = preview(N, [...set, 0, 0, delay]);
  if (t.length !== 5) throw new Error(`delay preview count ${t.length}`);
  const at = 3, n = at + Math.ceil(0.2 * SR);
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(n), endo = new Float64Array(n), el = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, delay);
    endo[i] = N.soemdsp_pulse_train_end(h);
    el[i] = N.soemdsp_pulse_train_elapsed(h);
  }
  N.soemdsp_pulse_train_destroy(h);
  const lastT = t[t.length - 1];
  let nEnd = 0;
  while (nEnd / SR < lastT + delay) nEnd += 1;
  const endAt = at + nEnd;
  let lastPulse = -1, endHits = 0, endIdx = -1;
  for (let i = 0; i < n; i++) {
    if (out[i] !== 0) lastPulse = i;
    if (endo[i] === 1) { endHits++; endIdx = i; }
  }
  if (endHits !== 1) throw new Error(`delay: End hits ${endHits}`);
  if (endIdx !== endAt) throw new Error(`delay: End at ${endIdx} want ${endAt} (lastT ${lastT} + ${delay})`);
  if (!(lastPulse < endIdx)) throw new Error(`delay: last pulse ${lastPulse} not before End ${endIdx}`);
  if (el[endIdx] < 0 || el[endIdx + 1] !== -1) throw new Error(`delay: elapsed after End ${el[endIdx]} ${el[endIdx + 1]}`);
  // Count 1: End at Delay, not Time+Delay.
  const h1 = N.soemdsp_pulse_train_create();
  const n1 = Math.ceil(0.08 * SR);
  let end1 = -1;
  for (let i = 0; i < n1; i++) {
    N.soemdsp_pulse_train_sample(h1, i >= 0 ? 1 : 0, 1, 3, 0, 1, 1, 0, 1, SR, 0, 0, 0, 0.04);
    if (N.soemdsp_pulse_train_end(h1) === 1) end1 = i;
  }
  N.soemdsp_pulse_train_destroy(h1);
  let want1 = 0;
  while (want1 / SR < 0.04) want1 += 1;
  if (end1 !== want1) throw new Error(`delay Count1: End at ${end1} want ${want1} (last pulse t=0 + delay, not Time)`);
  // Loop: cycle = Time + delay; End still on last pulse.
  const loopSet = [4, 0.05, 0, 1, 1, 0, 1];
  const hL = N.soemdsp_pulse_train_create();
  const nL = Math.ceil(0.2 * SR);
  const ends = [];
  for (let i = 0; i < nL; i++) {
    N.soemdsp_pulse_train_sample(hL, 0, ...loopSet, SR, 1, 1, 0, 0.03);
    if (N.soemdsp_pulse_train_end(hL) === 1) ends.push(i);
  }
  N.soemdsp_pulse_train_destroy(hL);
  const cycle = Math.ceil((0.05 + 0.03) * SR);
  if (ends.length < 2) throw new Error(`delay loop: End hits ${ends.length}`);
  if (Math.abs((ends[1] - ends[0]) - cycle) > 1) throw new Error(`delay loop: End spacing ${ends[1] - ends[0]} want ~${cycle}`);
  console.log(`ok pulseTrain End Delay: one-shot End at lastPulse+delay (Count 1 uses t=0), Loop cycle Time+delay End on last pulse`);
}
// 6b) End Delay negative: drop the tail, End at lastPulse+delay (not before 0).
{
  const set = [5, 0.1, 0, 1, 1, 0, 1];
  const delay = -0.03;
  const { t, a } = preview(N, [...set, 0, 0, delay]);
  if (t.length !== 5) throw new Error(`neg delay preview count ${t.length}`);
  const lastT = t[t.length - 1];
  const cutoff = lastT + delay;
  const kept = t.map((ti, i) => ti <= cutoff ? a[i] : 0);
  const at = 3, n = at + Math.ceil(0.15 * SR);
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(n), endo = new Float64Array(n), el = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, delay);
    endo[i] = N.soemdsp_pulse_train_end(h);
    el[i] = N.soemdsp_pulse_train_elapsed(h);
  }
  N.soemdsp_pulse_train_destroy(h);
  const y = new Float64Array(n);
  let j = 0, lastKept = -1;
  for (let s = at; s < n && j < t.length; s++) {
    const e = (s - at) / SR;
    while (j < t.length && t[j] <= e) {
      if (t[j] <= cutoff) { y[s] += a[j]; lastKept = s; }
      j++;
    }
  }
  for (let i = 0; i < n; i++) if (Math.abs(out[i] - y[i]) > 1e-12) throw new Error(`neg delay play: sample ${i} ${out[i]} vs ${y[i]}`);
  const endAt = at + ceilLand(cutoff, SR);
  let endHits = 0, endIdx = -1;
  for (let i = 0; i < n; i++) if (endo[i] === 1) { endHits++; endIdx = i; }
  if (endHits !== 1) throw new Error(`neg delay: End hits ${endHits}`);
  if (endIdx !== endAt) throw new Error(`neg delay: End at ${endIdx} want ${endAt} (cutoff ${cutoff})`);
  if (lastKept > endIdx) throw new Error(`neg delay: last kept ${lastKept} after End ${endIdx}`);
  if (el[endIdx] < 0 || el[endIdx + 1] !== -1) throw new Error(`neg delay: elapsed after End ${el[endIdx]} ${el[endIdx + 1]}`);
  if (kept.filter((v) => v !== 0).length !== 3) throw new Error(`neg delay: expected 3 kept pulses`);
  const h1 = N.soemdsp_pulse_train_create();
  let end1 = -1, hits1 = 0;
  const n1 = Math.ceil(0.05 * SR);
  for (let i = 0; i < n1; i++) {
    const v = N.soemdsp_pulse_train_sample(h1, i >= 0 ? 1 : 0, 1, 3, 0, 1, 1, 0, 1, SR, 0, 0, 0, -0.04);
    if (v !== 0) hits1++;
    if (N.soemdsp_pulse_train_end(h1) === 1) end1 = i;
  }
  N.soemdsp_pulse_train_destroy(h1);
  if (hits1 !== 1) throw new Error(`neg delay Count1: hits ${hits1}`);
  if (end1 !== 0) throw new Error(`neg delay Count1: End at ${end1} want 0 (clamp lastPulse+delay to 0)`);
  const loopSet = [4, 0.05, 0, 1, 1, 0, 1];
  const hL = N.soemdsp_pulse_train_create();
  const nL = Math.ceil(0.2 * SR);
  const ends = [];
  for (let i = 0; i < nL; i++) {
    N.soemdsp_pulse_train_sample(hL, 0, ...loopSet, SR, 1, 1, 0, -0.02);
    if (N.soemdsp_pulse_train_end(hL) === 1) ends.push(i);
  }
  N.soemdsp_pulse_train_destroy(hL);
  const cycle = Math.ceil((0.05 - 0.02) * SR);
  if (ends.length < 2) throw new Error(`neg delay loop: End hits ${ends.length}`);
  if (Math.abs((ends[1] - ends[0]) - cycle) > 1) throw new Error(`neg delay loop: End spacing ${ends[1] - ends[0]} want ~${cycle}`);
  console.log(`ok pulseTrain End Delay negative: one-shot drops tail End at lastPulse+delay, Count 1 clamps to 0, Loop cycle Time+delay`);
}
// 7) Antialiasing: 0 Off, 1 Random (seed-locked stack 0/+1), 2 Dither (Robin1 ±1).
// Isolated pulses stay on the Off grid for Random. Dither ±1 moves them.
// Leftover numeric 3 is still Robin1; 4 is still Robin2.
function seedAvalanche(x) {
  x >>>= 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x85EBCA6B) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 0xC2B2AE35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
function seedMix(seed, component, index) {
  let h = seedAvalanche((seed + 0x9E3779B9) >>> 0);
  h = seedAvalanche(h ^ ((Math.imul(component, 0x27D4EB2F) + 0x165667B1) >>> 0));
  h = seedAvalanche(h ^ ((Math.imul(index, 0x85EBCA77) + 0xC2B2AE3D) >>> 0));
  return h;
}
function ceilLand(t, sr) {
  if (!(t > 0)) return 0;
  const x = t * sr;
  const fl = Math.floor(x);
  const frac = x - fl;
  return frac > 0 ? fl + 1 : fl;
}
function ditherLand(seed, j, t, tPrev, tNext, sr, total) {
  const c = ceilLand(t, sr);
  const stacked = (j > 0 && ceilLand(tPrev, sr) === c) || (j + 1 < total && ceilLand(tNext, sr) === c);
  if (!stacked) return c;
  const u = (seedMix(seed, 1, j) >>> 8) / 16777216;
  return u < 0.5 ? c + 1 : c;
}
function robinLand(seed, j, t, sr) {
  let c = t * sr;
  if (!(c > 0)) c = 0;
  const ci = Math.floor(c);
  const cf = c - ci;
  let c2 = ci;
  if (cf >= 0.5) c2 += 1;
  const c1 = c2 - 1, c3 = c2 + 1;
  const e1 = c1 - c, e2 = c2 - c, e3 = c3 - c;
  const v = 0.25;
  const v1 = e1 * e1, v2 = e2 * e2, v3 = e3 * e3;
  const d1 = v - v1, d2 = v - v2, d3 = v - v3;
  const denom = e3 * (v1 - v2) - e2 * (v1 - v3) + e1 * (v2 - v3);
  let lenNow = c2;
  if (denom && denom === denom) {
    const s = 1 / denom;
    const probShort = (d2 * e3 - d3 * e2) * s;
    const probMid = (d3 * e1 - d1 * e3) * s;
    const r = (seedMix(seed, 1, j) >>> 8) / 16777216;
    if (r < probShort) lenNow = c2 - 1;
    else if (r >= probShort + probMid) lenNow = c2 + 1;
  }
  if (lenNow < 0) lenNow = 0;
  return lenNow;
}
{
  const set = [12, 3, 3, 1, 0.2, 0, 1];
  const at = 10, n = at + Math.ceil(3.05 * SR);
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 1, 0);
  N.soemdsp_pulse_train_destroy(h);
  const { y: yOff } = expected(set, 1, at, n);
  for (let i = 0; i < n; i++) if (out[i] !== yOff[i]) throw new Error(`aa Random sparse: sample ${i} out ${out[i]} off ${yOff[i]}`);
  const h2 = N.soemdsp_pulse_train_create();
  const outD = new Float64Array(n);
  for (let i = 0; i < n; i++) outD[i] = N.soemdsp_pulse_train_sample(h2, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 2, 0);
  N.soemdsp_pulse_train_destroy(h2);
  let eD = 0, eOff = 0, dMoved = 0;
  for (let i = 0; i < n; i++) {
    eD += outD[i]; eOff += yOff[i];
    if (outD[i] !== yOff[i]) dMoved++;
  }
  if (Math.abs(eD - eOff) > 1e-9) throw new Error(`aa Dither sparse: energy ${eD} vs ${eOff}`);
  if (dMoved < 1) throw new Error("aa Dither sparse: identical to Off");
  const h3 = N.soemdsp_pulse_train_create();
  const outR = new Float64Array(n);
  for (let i = 0; i < n; i++) outR[i] = N.soemdsp_pulse_train_sample(h3, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 3, 0);
  N.soemdsp_pulse_train_destroy(h3);
  for (let i = 0; i < n; i++) if (outD[i] !== outR[i]) throw new Error(`aa Dither (2) != leftover Robin1 (3) at ${i}`);
  console.log(`ok pulseTrain AA Random sparse == Off; Dither ±1 moves ${dMoved} samples, energy conserved, 2==3`);
}
{
  const set = [16384, 0.02, 3, 1, 0.1, 2, 1];
  const at = 5, n = at + Math.ceil(0.03 * SR);
  const { t, a } = preview(N, set);
  const y = new Float64Array(n);
  for (let j = 0; j < t.length; j++) {
    const tPrev = j > 0 ? t[j - 1] : 0;
    const tNext = j + 1 < t.length ? t[j + 1] : t[j];
    y[at + ditherLand(0, j, t[j], tPrev, tNext, SR, t.length)] += a[j];
  }
  const h = N.soemdsp_pulse_train_create();
  const outOn = new Float64Array(n);
  for (let i = 0; i < n; i++) outOn[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 1, 0);
  N.soemdsp_pulse_train_destroy(h);
  const hOff = N.soemdsp_pulse_train_create();
  const outOff = new Float64Array(n);
  for (let i = 0; i < n; i++) outOff[i] = N.soemdsp_pulse_train_sample(hOff, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 0, 0);
  N.soemdsp_pulse_train_destroy(hOff);
  let eOn = 0, eOff = 0, differ = 0, occOn = 0, occOff = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(outOn[i] - y[i]) > 1e-12) throw new Error(`aa dense hash: sample ${i} out ${outOn[i]} expected ${y[i]}`);
    eOn += outOn[i]; eOff += outOff[i];
    if (outOn[i] !== outOff[i]) differ++;
    if (outOn[i] !== 0) occOn++;
    if (outOff[i] !== 0) occOff++;
  }
  if (Math.abs(eOn - eOff) > 1e-6) throw new Error(`aa dense: energy ${eOn} vs ${eOff}`);
  if (differ < 10) throw new Error(`aa dense: only ${differ} samples differ`);
  console.log(`ok pulseTrain Antialiasing Random Count 16384 / 20 ms: seed_mix(Seed,1,j) stack-gated, energy conserved, ${differ} samples differ, occupied ${occOff} -> ${occOn}`);
}
{
  const set = [16384, 0.02, 3, 1, 0.1, 2, 1];
  const at = 5, n = at + Math.ceil(0.03 * SR);
  const play = (aa, seed) => {
    const h = N.soemdsp_pulse_train_create();
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, aa, seed);
    N.soemdsp_pulse_train_destroy(h);
    return out;
  };
  const a = play(1, 0), b = play(1, 0), c = play(1, 1);
  let same = true, changed = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) same = false;
    if (a[i] !== c[i]) changed++;
  }
  if (!same) throw new Error("aa Random: same Seed retrigger changed offsets");
  if (changed < 1) throw new Error("aa Random: Seed 1 identical to Seed 0");
  console.log(`ok pulseTrain Antialiasing Random: same Seed retrigger is identical, Seed 1 differs on ${changed} samples`);
}
{
  const set = [16384, 0.02, 3, 1, 0.1, 2, 1];
  const gap = Math.ceil(0.05 * SR);
  const nWin = Math.ceil(0.03 * SR);
  const n = 5 + gap + nWin;
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const trig = (i === 5 || i === 5 + gap) ? 1 : 0;
    out[i] = N.soemdsp_pulse_train_sample(h, trig, ...set, SR, 0, 0, 0, 0, 2, 0);
  }
  N.soemdsp_pulse_train_destroy(h);
  let differ = 0;
  for (let i = 0; i < nWin; i++) if (out[5 + i] !== out[5 + gap + i]) differ++;
  if (differ < 10) throw new Error(`aa Dither: retrigger only ${differ} samples differ`);
  const { t, a } = preview(N, set);
  const stream = seedMix(0, 2, 1);
  const y = new Float64Array(nWin);
  for (let j = 0; j < t.length; j++) {
    const k = robinLand(stream, j, t[j], SR);
    if (k < nWin) y[k] += a[j];
  }
  for (let i = 0; i < nWin; i++) {
    if (Math.abs(out[5 + i] - y[i]) > 1e-12) throw new Error(`aa Dither hash: sample ${i} out ${out[5 + i]} expected ${y[i]}`);
  }
  console.log(`ok pulseTrain Antialiasing Dither: Robin1 ±1 retrigger re-rolls (${differ} samples differ)`);
}
{
  const set = [16384, 0.02, 3, 1, 0.1, 2, 1];
  const gap = Math.ceil(0.05 * SR);
  const nWin = Math.ceil(0.03 * SR);
  const n = 5 + gap + nWin;
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const trig = (i === 5 || i === 5 + gap) ? 1 : 0;
    out[i] = N.soemdsp_pulse_train_sample(h, trig, ...set, SR, 0, 0, 0, 0, 3, 0);
  }
  N.soemdsp_pulse_train_destroy(h);
  let differ = 0;
  for (let i = 0; i < nWin; i++) if (out[5 + i] !== out[5 + gap + i]) differ++;
  if (differ < 10) throw new Error(`aa Robin: retrigger only ${differ} samples differ`);
  const { t, a } = preview(N, set);
  const stream = seedMix(0, 2, 1);
  const y = new Float64Array(nWin);
  for (let j = 0; j < t.length; j++) {
    const k = robinLand(stream, j, t[j], SR);
    if (k < nWin) y[k] += a[j];
  }
  for (let i = 0; i < nWin; i++) {
    if (Math.abs(out[5 + i] - y[i]) > 1e-12) throw new Error(`aa Robin hash: sample ${i} out ${out[5 + i]} expected ${y[i]}`);
  }
  console.log(`ok pulseTrain Antialiasing Robin: ±1 retrigger re-rolls (${differ} samples differ), first cycle matches robin pick`);
}
{
  const set = [8, 0.2, 3, 1, 0.2, 0, 1];
  const delay = 0.04, at = 5, n = at + Math.ceil(0.3 * SR);
  const { t } = preview(N, set);
  const lastT = t[t.length - 1];
  const stream = seedMix(0, 2, 1);
  const eLand = robinLand(stream, t.length, lastT + delay, SR);
  const h = N.soemdsp_pulse_train_create();
  let endIdx = -1;
  for (let i = 0; i < n; i++) {
    N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, delay, 3, 0);
    if (N.soemdsp_pulse_train_end(h) === 1) endIdx = i;
  }
  N.soemdsp_pulse_train_destroy(h);
  if (endIdx !== at + eLand) throw new Error(`aa Robin End Delay: End at ${endIdx} want ${at + eLand}`);
  console.log(`ok pulseTrain Antialiasing Robin End Delay: End lands at robin ±1 of lastPulse+delay (sample ${endIdx})`);
}
function robinPick3(c, seed, j, component) {
  if (!(c > 0)) c = 0;
  const ci = Math.floor(c);
  const cf = c - ci;
  let c2 = ci;
  if (cf >= 0.5) c2 += 1;
  const e1 = (c2 - 1) - c, e2 = c2 - c, e3 = (c2 + 1) - c;
  const v = 0.25;
  const v1 = e1 * e1, v2 = e2 * e2, v3 = e3 * e3;
  const d1 = v - v1, d2 = v - v2, d3 = v - v3;
  const denom = e3 * (v1 - v2) - e2 * (v1 - v3) + e1 * (v2 - v3);
  let lenNow = c2;
  if (denom && denom === denom) {
    const s = 1 / denom;
    const probShort = (d2 * e3 - d3 * e2) * s;
    const probMid = (d3 * e1 - d1 * e3) * s;
    const r = (seedMix(seed, component, j) >>> 8) / 16777216;
    if (r < probShort) lenNow = c2 - 1;
    else if (r >= probShort + probMid) lenNow = c2 + 1;
  }
  if (lenNow < 0) lenNow = 0;
  return lenNow;
}
function robinLand2(seed, j, t, sr) {
  return robinPick3(robinLand(seed, j, t, sr), seed, j, 3);
}
{
  const set = [12, 3, 3, 1, 0.2, 0, 1];
  const { t, a } = preview(N, set);
  const at = 10, n = at + Math.ceil(3.05 * SR);
  const playAa = (aa) => {
    const h = N.soemdsp_pulse_train_create();
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, aa, 0);
    N.soemdsp_pulse_train_destroy(h);
    return out;
  };
  const r1 = playAa(3), r2 = playAa(4);
  const stream = seedMix(0, 2, 1);
  let max1 = 0, max2 = 0, hit2 = 0, differ = 0;
  for (let j = 0; j < t.length; j++) {
    const rnd = Math.round(t[j] * SR);
    const k1 = robinLand(stream, j, t[j], SR);
    const k2 = robinLand2(stream, j, t[j], SR);
    max1 = Math.max(max1, Math.abs(k1 - rnd));
    max2 = Math.max(max2, Math.abs(k2 - rnd));
    if (Math.abs(k2 - rnd) === 2) hit2++;
    if (Math.abs(r1[at + k1] - a[j]) > 1e-12) throw new Error(`aa Robin1 land: pulse ${j} sample ${at + k1} ${r1[at + k1]} vs ${a[j]}`);
    if (Math.abs(r2[at + k2] - a[j]) > 1e-12) throw new Error(`aa Robin2 land: pulse ${j} sample ${at + k2} ${r2[at + k2]} vs ${a[j]}`);
  }
  for (let i = 0; i < n; i++) if (r1[i] !== r2[i]) differ++;
  if (max1 > 1) throw new Error(`aa Robin1 radius ${max1}`);
  if (max2 > 2) throw new Error(`aa Robin2 radius ${max2}`);
  if (hit2 < 1) throw new Error("aa Robin2: never landed ±2");
  if (differ < 1) throw new Error("aa Robin2 identical to Robin1");
  console.log(`ok pulseTrain AA Robin1 ±1 / Robin2 ±2 (hit ±2 on ${hit2} pulses, ${differ} samples differ)`);
}
{
  const set = [16384, 0.02, 3, 1, 0.1, 2, 1];
  const at = 5, nWin = Math.ceil(0.03 * SR);
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(nWin);
  for (let i = 0; i < nWin; i++) out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 4, 0);
  N.soemdsp_pulse_train_destroy(h);
  const { t, a } = preview(N, set);
  const stream = seedMix(0, 2, 1);
  const y = new Float64Array(nWin);
  for (let j = 0; j < t.length; j++) {
    const k = robinLand2(stream, j, t[j], SR);
    if (at + k < nWin) y[at + k] += a[j];
  }
  for (let i = 0; i < nWin; i++) {
    if (Math.abs(out[i] - y[i]) > 1e-12) throw new Error(`aa Robin2 hash: sample ${i} out ${out[i]} expected ${y[i]}`);
  }
  console.log("ok pulseTrain Antialiasing Robin2: first cycle matches ±2 pick (second ±1 around Robin1)");
}
function grainWave(shape, u) {
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  if (shape === 1) return u < 0.5 ? 1 : 0;
  if (shape === 2) return 2 * u - 1;
  if (shape === 3) return 1 - 2 * u;
  if (shape === 4) {
    if (u < 0.25) return 4 * u;
    if (u < 0.75) return 2 - 4 * u;
    return 4 * u - 4;
  }
  if (shape === 5) return Math.sin(2 * Math.PI * u);
  return 0;
}
{
  const set = [4, 0.01, 0, 1, 1, 0, 1];
  const { t } = preview(N, set);
  const n0s = t.map((ti) => ceilLand(ti, SR));
  const at = 5, n = at + n0s[n0s.length - 1] + 20;
  const playShape = (shape) => {
    const h = N.soemdsp_pulse_train_create();
    const out = new Float64Array(n), endo = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = N.soemdsp_pulse_train_sample(h, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 0, 0, shape);
      endo[i] = N.soemdsp_pulse_train_end(h);
    }
    N.soemdsp_pulse_train_destroy(h);
    return { out, endo };
  };
  for (const shape of [1, 2, 3, 4, 5]) {
    const { out } = playShape(shape);
    const y = new Float64Array(n);
    for (let j = 0; j < t.length - 1; j++) {
      const n0 = n0s[j], n1 = n0s[j + 1];
      const span = n1 > n0 ? n1 - n0 : 1;
      for (let s = n0; s < n0 + span; s++) y[at + s] = grainWave(shape, (s - n0) / span);
    }
    const tol = shape === 5 ? 2e-4 : 1e-12;
    for (let i = 0; i < n; i++) {
      if (Math.abs(out[i] - y[i]) > tol) throw new Error(`grain shape ${shape} sample ${i} ${out[i]} vs ${y[i]}`);
    }
  }
  const trig = playShape(0);
  let hits = 0, endAt = -1;
  for (let i = 0; i < n; i++) {
    if (trig.out[i] !== 0) hits++;
    if (trig.endo[i] === 1) endAt = i;
  }
  if (hits !== 4) throw new Error(`trigger hits ${hits}`);
  if (endAt !== at + n0s[n0s.length - 1]) throw new Error(`trigger End ${endAt} want last pulse ${at + n0s[n0s.length - 1]}`);
  const sine = playShape(5), tri = playShape(4), saw = playShape(2);
  if (Math.abs(sine.out[at + n0s[0]]) > 1e-9) throw new Error("sine start not 0");
  if (Math.abs(tri.out[at + n0s[0]]) > 1e-12) throw new Error("tri start not 0");
  if (Math.abs(saw.out[at + n0s[0]] + 1) > 1e-12) throw new Error(`saw start ${saw.out[at + n0s[0]]}`);
  if (endAt !== at + n0s[n0s.length - 1]) throw new Error("shape End");
  const sineEnd = playShape(5);
  if (sineEnd.endo[at + n0s[n0s.length - 1]] !== 1) throw new Error("sine one-shot End not on last pulse (delay 0)");
  const hS = S.soemdsp_pulse_train_create();
  for (let i = 0; i < n; i++) {
    const v = S.soemdsp_pulse_train_sample(hS, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 0, 0, 2);
    if (v !== saw.out[i]) throw new Error(`grain saw standalone != combined at ${i}`);
  }
  S.soemdsp_pulse_train_destroy(hS);
  console.log("ok pulseTrain Shape: Gate 50% / Saw / Ramp / Tri / Sine grains pulse-to-pulse; Sine/Tri start at 0; delay 0 End on last pulse; omitted waveShape = Trigger");
}
{
  const TYPE_PT = 231, PORT_MONO = 0;
  const PR = { AMP: 12, SHAPE: 13, STAGES: 22, WIDTH: 31, TDEN: 53, IN_LOW: 80, IN_HIGH: 81, TIMING: 54, OVERSAMPLE: 32 };
  const g = N.soemdsp_graph_create() | 0;
  N.soemdsp_graph_set_sample_rate(g, SR);
  const hP = 0x7321;
  if (N.soemdsp_graph_add_node(g, hP, TYPE_PT) | 0) throw new Error("grain graph add");
  const set = [4, 0.01, 0, 1, 1, 0, 1];
  const keys = [PR.STAGES, PR.TDEN, PR.SHAPE, PR.IN_LOW, PR.IN_HIGH, PR.WIDTH, PR.AMP];
  keys.forEach((p, i) => N.soemdsp_graph_set_param(g, hP, p, set[i]));
  { const fd = ptFD(set[1], 0, 0); N.soemdsp_graph_set_param(g, hP, 53, fd.f); N.soemdsp_graph_set_param(g, hP, 52, fd.duty); set[1] = fd.T; }
  N.soemdsp_graph_set_param(g, hP, PR.TIMING, 1); // Loop
  N.soemdsp_graph_set_param(g, hP, PR.OVERSAMPLE, 2); // Saw
  if (N.soemdsp_graph_compile(g) | 0) throw new Error("grain graph compile");
  N.soemdsp_graph_snap_controls(g);
  const n = Math.ceil(0.03 * SR);
  const out = [], trig = [];
  const PORT_RIGHT = 2;
  for (let q = 0; q < Math.ceil(n / 128); q++) {
    N.soemdsp_graph_process_block(g, 128);
    out.push(...new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, hP, PORT_MONO) | 0, 128));
    trig.push(...new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, hP, PORT_RIGHT) | 0, 128));
  }
  N.soemdsp_graph_destroy(g);
  const h = N.soemdsp_pulse_train_create();
  const hT = N.soemdsp_pulse_train_create();
  for (let i = 0; i < n; i++) {
    const d = N.soemdsp_pulse_train_sample(h, 0, ...set, SR, 1, 1, 0, 0, 0, 0, 2);
    if (out[i] !== d) throw new Error(`grain graph saw != direct at ${i}: ${out[i]} vs ${d}`);
    const tWant = N.soemdsp_pulse_train_sample(hT, 0, ...set, SR, 1, 1, 0, 0, 0, 0, 0);
    const tGot = N.soemdsp_pulse_train_trigger(h);
    if (trig[i] !== tGot) throw new Error(`grain graph Trigger != direct at ${i}: ${trig[i]} vs ${tGot}`);
    if (tGot !== tWant) throw new Error(`Trigger out != impulse Shape at ${i}: ${tGot} vs ${tWant}`);
  }
  N.soemdsp_pulse_train_destroy(h);
  N.soemdsp_pulse_train_destroy(hT);
  console.log("ok pulseTrain graph Shape Saw + Trigger out Loop == direct");
}
{
  const set = [4, 0.01, 0, 1, 1, 0, 1];
  const at = 5, n = at + Math.ceil(0.02 * SR);
  const hS = N.soemdsp_pulse_train_create();
  const hI = N.soemdsp_pulse_train_create();
  let hits = 0, sameShape = 0;
  for (let i = 0; i < n; i++) {
    const shape = N.soemdsp_pulse_train_sample(hS, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 0, 0, 2);
    const trig = N.soemdsp_pulse_train_trigger(hS);
    const impulse = N.soemdsp_pulse_train_sample(hI, i >= at ? 1 : 0, ...set, SR, 0, 0, 0, 0, 0, 0, 0);
    if (trig !== impulse) throw new Error(`Trigger out vs impulse Shape at ${i}: ${trig} vs ${impulse}`);
    if (trig !== 0) hits++;
    if (shape === trig) sameShape++;
  }
  N.soemdsp_pulse_train_destroy(hS);
  N.soemdsp_pulse_train_destroy(hI);
  if (hits !== 4) throw new Error(`Trigger out hits ${hits}`);
  if (sameShape === n) throw new Error("Saw Shape identical to Trigger out");
  console.log(`ok pulseTrain Trigger out always impulses (${hits} hits) while Shape is Saw`);
}
if ((N.soemdsp_graph_version() | 0) < 252) throw new Error(`graph version ${N.soemdsp_graph_version()}`);
if ((N.soemdsp_pulse_train_version() | 0) < 18) throw new Error(`pulse_train v${N.soemdsp_pulse_train_version()}`);
console.log(`ok graph version ${N.soemdsp_graph_version()}, pulse_train v${N.soemdsp_pulse_train_version()}`);
