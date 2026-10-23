// Wavetable ADSR on the shared Gate/Trigger contract (trigger.h gate_hit / gate_on).
// Hit = |x| rose (negative fires too); held gate_on (> 0) sustains; velocity = raw height.
// Graph: Sample & Hold Trigger (Square) -> Wavetable ADSR Gate fires the attack.
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")),
  { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing ${n}`); return e[n]; };
if ((must("soemdsp_wavetable_adsr_version")() | 0) < 3) throw new Error("wavetable_adsr version < 3");
const create = must("soemdsp_wavetable_adsr_create"), destroy = must("soemdsp_wavetable_adsr_destroy");
const sample = must("soemdsp_wavetable_adsr_sample");
const SR = 48000; let fail = 0;
const check = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fail++; };
function run(gateAt) {
  const h = create() | 0; const out = [];
  for (let n = 0; n < 9600; n++) out.push(sample(h, gateAt(n), 0, 1, 0.005, 0.01, 0.5, 0.01, 1, 0, SR));
  destroy(h); return out;
}
// one-sample pulses, +0.8 and -0.8: both start the attack
for (const v of [0.8, -0.8]) {
  const o = run((n) => (n === 10 ? v : 0));
  check(o[10] !== 0 && Math.sign(o[10]) === Math.sign(v), `1-sample ${v} trigger fires (out ${o[10].toExponential(2)})`);
}
// held positive gate: peak = height, sustain = height * Sustain
{ const o = run((n) => (n < 4800 ? 0.6 : 0));
  check(Math.abs(Math.max(...o) - 0.6) < 1e-3, `held 0.6 gate peaks at 0.6`);
  check(Math.abs(o[4000] - 0.3) < 1e-6, `held gate sustains at 0.6*0.5 (${o[4000]})`);
  check(Math.abs(o[9599]) < 1e-3, `release after gate falls`); }
// sub-old-threshold height fires (old code needed > 1e-4 and clamped velocity to [0,1])
{ const o = run((n) => (n < 4800 ? 2 : 0)); check(Math.abs(Math.max(...o) - 2) < 1e-3, `velocity not clamped (peak 2)`); }
// Reset uses gate_hit: negative reset idles
{ const h = create() | 0; let y = 0;
  for (let n = 0; n < 2000; n++) y = sample(h, 1, n === 1999 ? -1 : 0, 1, 0.005, 0.01, 0.5, 0.01, 1, 0, SR);
  check(y === 0, `negative Reset hit forces idle`); destroy(h); }
// graph: S&H Trigger -> Wavetable ADSR Gate
{ const m = (n) => must(`soemdsp_graph_${n}`);
  const g = m("create")() | 0; m("set_sample_rate")(g, 48000);
  m("add_node")(g, 1, 20); m("add_node")(g, 2, 168); m("add_node")(g, 3, 6);
  m("connect")(g, 1, 5, 2, 0); m("connect")(g, 2, 0, 3, 0);
  m("set_param")(g, 1, 10, 20); m("compile")(g); m("snap_controls")(g);
  let hits = 0, fired = 0, prevT = 0;
  for (let q = 0; q < 400; q++) { m("process_block")(g, 128);
    const a = new Float64Array(e.memory.buffer, m("node_port_ptr")(g, 2, 0) | 0, 128);
    const t = new Float64Array(e.memory.buffer, m("node_port_ptr")(g, 1, 5) | 0, 128);
    for (let i = 0; i < 128; i++) { if (Math.abs(t[i]) > Math.abs(prevT)) { hits++; if (a[i] !== 0) fired++; } prevT = t[i]; } }
  m("destroy")(g);
  check(hits > 0 && fired === hits, `graph: S&H Trigger fires Wavetable ADSR on every hit (${fired}/${hits})`); }
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("wavetable adsr gate contract smoke ok");
