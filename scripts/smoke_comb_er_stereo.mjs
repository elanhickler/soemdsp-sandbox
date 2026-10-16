// Comb Resonator + Early Reflections stereo smoke (graph level, combined wasm).
// 1) Comb ƒ tracking: Feedforward comb, step into Mono; output steps again at
//    exactly D = fs / f samples, with f from the ƒ jack (overrides the knob).
// 2) Comb stereo: Left and Right lanes are independent combs (Right = 0 when
//    its own input is 0; Right = 0.5 x Left when its input is half); a lone
//    Mono input feeds both lanes identically.
// 3) Early Reflections stereo: Right ring hears only the Right lane, Mono out
//    = (Left + Right) / 2; a lone Mono input gives the old Dual stereo spread.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const create = must("soemdsp_graph_create"), destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node"), connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");

const SR = 48000;
const TYPE_BIAS = 12, TYPE_COMB = 66, TYPE_ER = 203;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RIGHT = 2, PORT_F = 16;
const PARAM_FREQUENCY = 10, PARAM_AMPLITUDE = 12, PARAM_MODE = 21, PARAM_WIDTH = 31;
const PARAM_ATT_OFFSET = 71, PARAM_TIME_NUM = 52, PARAM_STAGES = 22;

// sources: [{ value, dstPort }]; returns { mono, left, right } of `blocks` x 128.
function run(type, setup, sources, blocks = 8) {
  const g = create() | 0;
  setSr(g, SR);
  const hDut = 0x5e0001 >>> 0;
  if ((add(g, hDut, type) | 0) !== 0) throw new Error("add dut");
  setup((p, v) => setParam(g, hDut, p, v));
  sources.forEach((s, i) => {
    const h = (0x5e0100 + i) >>> 0;
    if ((add(g, h, TYPE_BIAS) | 0) !== 0) throw new Error("add bias");
    setParam(g, h, PARAM_ATT_OFFSET, s.value);
    if ((connect(g, h, PORT_MONO, hDut, s.dstPort) | 0) !== 0) throw new Error("connect");
  });
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);
  const out = { mono: [], left: [], right: [] };
  for (let b = 0; b < blocks; b++) {
    process(g, 128);
    for (const [k, port] of [["mono", PORT_MONO], ["left", PORT_LEFT], ["right", PORT_RIGHT]]) {
      out[k].push(...new Float64Array(e.memory.buffer, portPtr(g, hDut, port) | 0, 128));
    }
  }
  destroy(g);
  return out;
}
const maxAbs = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const combFF = (knobHz) => (set) => {
  set(PARAM_MODE, 1);          // Topology: Feedforward
  set(PARAM_WIDTH, 1);         // Depth 1
  set(PARAM_FREQUENCY, knobHz);
  set(PARAM_AMPLITUDE, 1);
};

// 1) ƒ tracking
for (const fHz of [300, 480, 1200]) {
  const { mono } = run(TYPE_COMB, combFF(110), [{ value: 0.5, dstPort: PORT_MONO }, { value: fHz, dstPort: PORT_F }]);
  const D = SR / fHz;
  const at = mono.findIndex((v) => v > 0.75);
  if (Math.abs(mono[0] - 0.5) > 1e-9) throw new Error(`comb step start ${mono[0]}`);
  if (at !== D) throw new Error(`comb ƒ ${fHz} Hz: second step at ${at}, want D = ${D} (knob 110 Hz would be ${SR / 110})`);
  console.log(`comb ƒ ${fHz} Hz ok: delay ${at} samples = fs/f`);
}

// 2) comb stereo independence
{
  const a = run(TYPE_COMB, combFF(300), [{ value: 0.5, dstPort: PORT_LEFT }, { value: 0, dstPort: PORT_RIGHT }]);
  if (!(maxAbs(a.left) > 0.4)) throw new Error("comb Left silent");
  if (maxAbs(a.right) !== 0) throw new Error(`comb Right should be silent with 0 in, got ${maxAbs(a.right)}`);
  const b = run(TYPE_COMB, combFF(300), [{ value: 0.5, dstPort: PORT_LEFT }, { value: 0.25, dstPort: PORT_RIGHT }]);
  const half = b.left.map((v) => 0.5 * v);
  if (maxDiff(b.right, half) > 1e-12) throw new Error("comb Right != 0.5 x Left (lanes not independent)");
  if (maxDiff(b.mono, b.left.map((v, i) => 0.5 * (v + b.right[i]))) > 1e-12) throw new Error("comb Mono != (L+R)/2 in stereo");
  const c = run(TYPE_COMB, combFF(300), [{ value: 0.5, dstPort: PORT_MONO }]);
  if (maxDiff(c.left, c.right) !== 0 || maxDiff(c.left, c.mono) !== 0) throw new Error("comb lone Mono in: L/R/Mono differ");
  console.log("comb stereo ok: lanes independent, lone Mono feeds both");
}

// 3) Early Reflections stereo
{
  const er = (set) => { set(PARAM_TIME_NUM, 0.01); set(PARAM_STAGES, 4); set(PARAM_MODE, 0); set(PARAM_AMPLITUDE, 1); };
  for (const mode of [0, 1, 2]) {
    const erm = (set) => { er(set); set(PARAM_MODE, mode); };
    const a = run(TYPE_ER, erm, [{ value: 0.5, dstPort: PORT_LEFT }, { value: 0, dstPort: PORT_RIGHT }], 12);
    if (!(maxAbs(a.left) > 0.1)) throw new Error(`ER mode ${mode} Left silent`);
    if (maxAbs(a.right) !== 0) throw new Error(`ER mode ${mode} Right hears Left (${maxAbs(a.right)})`);
    if (maxDiff(a.mono, a.left.map((v, i) => 0.5 * (v + a.right[i]))) > 1e-12) throw new Error(`ER mode ${mode} Mono != (L+R)/2`);
    const b = run(TYPE_ER, erm, [{ value: 0, dstPort: PORT_LEFT }, { value: 0.5, dstPort: PORT_RIGHT }], 12);
    if (maxAbs(b.left) !== 0 || !(maxAbs(b.right) > 0.1)) throw new Error(`ER mode ${mode} Left/Right swap not independent`);
  }
  const m = run(TYPE_ER, er, [{ value: 0.5, dstPort: PORT_MONO }], 12);
  if (!(maxDiff(m.left, m.right) > 1e-3)) throw new Error("ER lone Mono in: Dual should still spread L != R");
  console.log("early reflections stereo ok: rings independent per lane, Mono = (L+R)/2, Mono in spreads");
}
console.log("smoke_comb_er_stereo ok");
