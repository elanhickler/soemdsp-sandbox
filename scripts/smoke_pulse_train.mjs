// Pulse Train: schedule t_i = End * E_k(u_i) (E_k(u) = (e^(k u) - 1) / (e^k - 1),
// k = 0 linear), first pulse 0, last pulse == End <= 12 s, gaps grow for
// Curve > 0 (even at 0, shrink below 0), amplitude curve, preview == played
// sample-exact (velocity scales), End out, Reset stops, graph path == direct.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
  const end = Math.min(12, Math.max(0, end0));
  const { t, a } = preview(N, set);
  const s2 = preview(S, set);
  if (JSON.stringify(s2) !== JSON.stringify({ t, a })) throw new Error(`set ${k}: standalone preview != combined`);
  if (t.length !== count) throw new Error(`set ${k}: count ${t.length}`);
  if (t[0] !== 0) throw new Error(`set ${k}: first pulse ${t[0]}`);
  if (count > 1 && t[count - 1] !== end) throw new Error(`set ${k}: last ${t[count - 1]} != End ${end}`);
  if (t[count - 1] > 12) throw new Error(`set ${k}: past 12 s`);
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
console.log(`ok pulseTrain schedule: ${SETS.length} sets, t_i = End*E_k(u_i), first 0, last == End (End 20 -> 12), gaps grow / even / shrink by Curve sign, amp curve, standalone == combined`);
// 2) Playback == preview sample-exact, velocity scales, End out, elapsed.
function play(E2, set, trigFn, resetFn, n) {
  const h = E2.soemdsp_pulse_train_create();
  const out = new Float64Array(n), endo = new Float64Array(n), el = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = E2.soemdsp_pulse_train_sample(h, trigFn(i), resetFn(i), ...set, SR);
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
    const at = 37, n = at + Math.ceil(12.01 * SR);
    const r = play(N, set, (i) => (i >= at ? vel : 0), () => 0, n);
    const { y, last } = expected(set, vel, at, n);
    for (let i = 0; i < n; i++) if (Math.abs(r.out[i] - y[i]) > 1e-12) throw new Error(`set ${k} vel ${vel}: sample ${i} out ${r.out[i]} expected ${y[i]}`);
    for (let i = 0; i < n; i++) if (r.endo[i] !== (i === last ? 1 : 0)) throw new Error(`set ${k}: End at ${i} = ${r.endo[i]} (last pulse ${last})`);
    if (r.el[at - 1] !== -1 || r.el[at] !== 0 || r.el[last + 1] !== -1) throw new Error(`set ${k}: elapsed ${r.el[at - 1]} ${r.el[at]} ${r.el[last + 1]}`);
  }
}
console.log(`ok pulseTrain playback == preview sample-exact (${SETS.length} sets x velocity 1 / 0.5), End = 1 on the last pulse sample only, __Elapsed -1 idle / 0 at trigger`);
// 3) Reset stops (no End); retrigger restarts.
{
  const set = SETS[0], n = 4 * SR, rs = SR;
  const r = play(N, set, (i) => (i >= 10 ? 1 : 0), (i) => (i >= rs ? 1 : 0), n);
  for (let i = rs; i < n; i++) if (r.out[i] !== 0 || r.endo[i] !== 0) throw new Error(`reset: sound at ${i}`);
  if (r.el[rs] !== -1) throw new Error("reset: still running");
  const re = play(N, set, (i) => (i < 10 ? 0 : i < 2 * SR ? 1 : i < 2 * SR + 5 ? 0 : 1), () => 0, 6 * SR);
  const second = expected(set, 1, 2 * SR + 5, 6 * SR).y;
  for (let i = 2 * SR + 5; i < 6 * SR; i++) if (Math.abs(re.out[i] - second[i]) > 1e-12) throw new Error(`retrigger: ${i}`);
}
console.log("ok pulseTrain Reset stops the train (no End), a new Trigger restarts it");
// 4) Graph path: Clock -> Trigger; engine Out / End / __Elapsed == direct module on the same trigger.
{
  const TYPE_CLOCK = 28, TYPE_PT = 231, PORT_MONO = 0, PORT_LEFT = 1, PORT_PHASE01 = 10, PORT_TRIGGER = 20;
  const PR = { RATE: 10, AMP: 12, SHAPE: 13, STAGES: 22, WIDTH: 31, TDEN: 53, IN_LOW: 80, IN_HIGH: 81 };
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
  if (N.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  N.soemdsp_graph_snap_controls(g);
  const trig = [], out = [], endo = [], el = [];
  for (let q = 0; q < Math.ceil(6 * SR / 128); q++) {
    N.soemdsp_graph_process_block(g, 128);
    const rd = (h, port) => new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, h, port) | 0, 128);
    trig.push(...rd(hC, PORT_MONO)); out.push(...rd(hP, PORT_MONO)); endo.push(...rd(hP, PORT_LEFT)); el.push(...rd(hP, PORT_PHASE01));
  }
  N.soemdsp_graph_destroy(g);
  const d = play(N, set, (i) => trig[i], () => 0, trig.length);
  let pulses = 0, peak = 0;
  for (let i = 0; i < trig.length; i++) {
    if (out[i] !== d.out[i] || endo[i] !== d.endo[i] || el[i] !== d.el[i]) throw new Error(`graph != direct at ${i}: ${out[i]} vs ${d.out[i]}`);
    if (out[i] !== 0) { pulses++; peak = Math.max(peak, out[i]); }
  }
  if (pulses < 20) throw new Error(`graph: only ${pulses} pulses`);
  if (Math.abs(peak - 1.5 * 0.8) > 1e-9) throw new Error(`graph: peak ${peak}, expected Amplitude 1.5 x velocity 0.8 (no clamp)`);
  console.log(`ok pulseTrain graph (type 231, Clock -> Trigger) == direct: Out / End / __Elapsed max diff 0, ${pulses} pulses, peak ${peak.toFixed(3)} = Amplitude 1.5 x velocity 0.8`);
}
if ((N.soemdsp_graph_version() | 0) < 222) throw new Error(`graph version ${N.soemdsp_graph_version()}`);
console.log(`ok graph version ${N.soemdsp_graph_version()}, pulse_train v${N.soemdsp_pulse_train_version()}`);
