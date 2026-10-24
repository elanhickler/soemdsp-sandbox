// Pulse Train Recalculate On Trigger. On (1, default): every schedule param is
// latched at the trigger / Loop cycle start, so mid-train knob moves do not
// change the output. Off (0): the schedule follows the knobs live (already
// played pulses never replay, pulses now behind the playhead are skipped).
// Static params: On == Off bit-identical. soemdsp_pulse_train_effective
// reports the params in effect (face): latched while running On, live Off /
// idle. Graph: mode slot (21) carries the switch, Saw..CenterSquare the
// params in effect.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const N = (await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), imp)).instance.exports;
const SR = 48000;
function play(setFn, trigFn, n, mode, recalc) {
  const h = N.soemdsp_pulse_train_create();
  const out = new Float64Array(n), endo = new Float64Array(n), el = new Float64Array(n), eff = [];
  for (let i = 0; i < n; i++) {
    out[i] = N.soemdsp_pulse_train_sample(h, trigFn(i), ...setFn(i), SR, mode, recalc);
    endo[i] = N.soemdsp_pulse_train_end(h);
    el[i] = N.soemdsp_pulse_train_elapsed(h);
    if (i % 1000 === 0) eff.push([i, ...[0, 1, 2, 3, 4, 5, 6].map((k) => N.soemdsp_pulse_train_effective(h, k))]);
  }
  N.soemdsp_pulse_train_destroy(h);
  return { out, endo, el, eff };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const trig = (i) => (i >= 10 ? 1 : 0);
const A = [12, 3, 3, 1, 0.2, 0, 1];
const B = [12, 1.5, -2, 0.5, 0.9, 2, 0.6]; // every param moved
const at = Math.round(0.4 * SR);
const moved = (i) => (i < at ? A : B);
let checks = 0;
// 1) Static params: On == Off, One shot and Loop.
for (const mode of [0, 1]) for (const set of [A, B, [128, 0.7, 8, 1, 0, -4, 2]]) {
  const n = Math.ceil(3.5 * SR);
  const on = play(() => set, trig, n, mode, 1), off = play(() => set, trig, n, mode, 0);
  if (!same(on.out, off.out) || !same(on.endo, off.endo) || !same(on.el, off.el)) throw new Error(`static mode ${mode} ${set}: On != Off`);
  checks++;
}
console.log(`ok pulseTrain static params: Recalculate On == Off bit-identical (Out / End / __Elapsed), ${checks} cases, One shot + Loop`);
// 2) One shot, all params moved at 0.4 s mid-train.
{
  const n = Math.ceil(3.5 * SR);
  const ref = play(() => A, trig, n, 0, 1);
  const on = play(moved, trig, n, 0, 1);
  if (!same(on.out, ref.out) || !same(on.endo, ref.endo)) throw new Error("On: mid-train knob moves changed the output");
  const off = play(moved, trig, n, 0, 0);
  if (same(off.out, ref.out)) throw new Error("Off: mid-train knob moves did not change the output");
  // Before the move Off == On; after it, pulses follow schedule B (index-forward, skipping passed ones).
  for (let i = 0; i < at; i++) if (off.out[i] !== ref.out[i]) throw new Error(`Off differs before the move at ${i}`);
  const pc = N.soemdsp_pulse_train_preview(...B, 0);
  const pt = [], pa = [];
  for (let k = 0; k < pc; k++) { pt.push(N.soemdsp_pulse_train_preview_time(k)); pa.push(N.soemdsp_pulse_train_preview_amplitude(k)); }
  const played = Array.from(ref.out.slice(0, at)).filter((v) => v !== 0).length; // pulses before the move (A)
  let next = played; const ePrev = (at - 1 - 10) / SR;
  let k = 0; while (k < pc && pt[k] <= ePrev) k++; if (k > next) next = k;
  const exp = new Float64Array(n); exp.set(ref.out.slice(0, at));
  let lastAt = -1;
  for (let i = at; i < n && next < pc; i++) { const e = (i - 10) / SR; while (next < pc && pt[next] <= e) { exp[i] += pa[next]; next++; lastAt = i; } }
  for (let i = 0; i < n; i++) if (Math.abs(exp[i] - off.out[i]) > 1e-12) throw new Error(`Off: sample ${i} ${off.out[i]} expected ${exp[i]}`);
  if (off.endo.indexOf(1) !== lastAt) throw new Error(`Off: End at ${off.endo.indexOf(1)} expected ${lastAt}`);
  console.log(`ok pulseTrain One shot: On ignores mid-train moves of all 7 params (== unmoved); Off follows them live (== schedule B from the playhead, ${played} pulses before the move, End at ${(lastAt - 10) / SR} s instead of 3 s)`);
  // Time cut below the elapsed time ends the train (Off).
  const cut = play((i) => (i < at ? A : [12, 0.1, 3, 1, 0.2, 0, 1]), trig, n, 0, 0);
  if (cut.endo.indexOf(1) !== at) throw new Error(`Off: Time cut below elapsed should End at ${at}, got ${cut.endo.indexOf(1)}`);
  console.log("ok pulseTrain Off: Time cut below the elapsed time ends the train on that sample (End fires, nothing replays)");
  // Face params in effect: On latched while running, Off live, idle live.
  const row = (r, i) => r.eff.find((x) => x[0] === i).slice(1);
  const i1 = 30000;
  if (JSON.stringify(row(on, i1)) !== JSON.stringify(A)) throw new Error(`On effective ${row(on, i1)}`);
  if (JSON.stringify(row(off, i1)) !== JSON.stringify(B)) throw new Error(`Off effective ${row(off, i1)}`);
  if (JSON.stringify(row(on, 0)) !== JSON.stringify(A)) throw new Error(`idle effective ${row(on, 0)}`);
  const idleAfter = row(on, Math.floor((n - 1000) / 1000) * 1000);
  if (JSON.stringify(idleAfter) !== JSON.stringify(B)) throw new Error(`On after the train (idle) should show the live knobs: ${idleAfter}`);
  console.log("ok pulseTrain effective params (face): On = latched while running, Off = live, idle = live (what the next trigger latches)");
}
// 3) Loop, Time moved mid-cycle: On waits for the next cycle, Off keeps phase.
{
  const n = Math.ceil(2 * SR);
  const at = 10000;
  const set = (i) => [6, i < at ? 0.5 : 0.3, 0, 1, 1, 0, 1];
  const on = play(set, () => 0, n, 1, 1), off = play(set, () => 0, n, 1, 0);
  const wrapOn = Array.from(on.el).findIndex((v, i) => i > 0 && v === 0);
  const wrapOff = Array.from(off.el).findIndex((v, i) => i > 0 && v === 0);
  const phase = at / (0.5 * SR);
  const nRemap = Math.floor(phase * 0.3 * SR);
  const wantOff = at + (0.3 * SR - nRemap);
  if (wrapOn !== 0.5 * SR) throw new Error(`Loop wrap On ${wrapOn} want ${0.5 * SR}`);
  if (wrapOff !== wantOff) throw new Error(`Loop wrap Off ${wrapOff} want ${wantOff} (phase-continuous)`);
  console.log(`ok pulseTrain Loop: Time 0.5 -> 0.3 mid-cycle, On wraps at 0.5 s, Off keeps phase and wraps at ${wantOff / SR} s`);
  // Raising Frequency so the new period is shorter than elapsed must not restart.
  const atCut = Math.round(0.3 * SR);
  const cut = play((i) => [6, i < atCut ? 0.5 : 0.1, 0, 1, 1, 0, 1], () => 0, Math.ceil(1 * SR), 1, 0);
  if (cut.el[atCut] === 0) throw new Error("Off: Time shorter than elapsed restarted the cycle");
  const pCut = (atCut / SR) / 0.5;
  const wantEl = Math.floor(pCut * 0.1 * SR) / SR;
  if (Math.abs(cut.el[atCut] - wantEl) > 1.5 / SR) {
    throw new Error(`Off: elapsed ${cut.el[atCut]} want ~${wantEl} after Time 0.5 -> 0.1`);
  }
  console.log("ok pulseTrain Loop Off: Time 0.5 -> 0.1 below elapsed keeps phase (no wrap-reset)");
}
// 4) Graph: mode slot 21 switch + face params in effect on Saw/Ramp/Square/Tri/Sine/Trisaw/CenterSquare.
{
  const PR = { STAGES: 22, TDEN: 53, TIMING: 54, MODE: 21 };
  const PORTS = [3, 4, 5, 6, 7, 8, 9];
  for (const rec of [1, 0]) {
    const g = N.soemdsp_graph_create() | 0;
    N.soemdsp_graph_set_sample_rate(g, SR);
    const hP = 0x7701;
    N.soemdsp_graph_add_node(g, hP, 231);
    for (const [p, v] of [[PR.STAGES, 6], [PR.TDEN, 1], [52, 1], [PR.TIMING, 1], [PR.MODE, rec]]) N.soemdsp_graph_set_param(g, hP, p, v);
    if (N.soemdsp_graph_compile(g) | 0) throw new Error("compile");
    N.soemdsp_graph_snap_controls(g);
    const read = () => PORTS.map((p) => new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, hP, p) | 0, 128)[127]);
    for (let q = 0; q < 100; q++) N.soemdsp_graph_process_block(g, 128);
    N.soemdsp_graph_set_param(g, hP, PR.TDEN, 0.5); // Frequency 1 -> 0.5 Hz, Duty 1: Time 1 -> 2 s
    N.soemdsp_graph_snap_controls(g);
    for (let q = 0; q < 20; q++) N.soemdsp_graph_process_block(g, 128);
    const mid = read();
    N.soemdsp_graph_destroy(g);
    const want = rec ? 1 : 2;
    if (mid[0] !== 6 || mid[1] !== want) throw new Error(`graph recalc ${rec}: __Count ${mid[0]} __End ${mid[1]} want ${want}`);
    console.log(`ok pulseTrain graph Recalculate ${rec ? "On" : "Off"}: Time 1 -> 2 mid-cycle, face __End = ${mid[1]} (${rec ? "latched until the next cycle" : "live"}), __Count ${mid[0]}`);
  }
}
const v = N.soemdsp_graph_version() | 0;
if (v < 228) throw new Error(`graph version ${v}`);
console.log(`ok graph version ${v}, pulse_train v${N.soemdsp_pulse_train_version()}`);
