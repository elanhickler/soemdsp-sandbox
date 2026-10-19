// SinCos (153) / SinCos4 (40) Polarity smoke (headless, combined wasm).
// Polarity rides Control center (param 30): 0 Bipolar (default), 1 Unipolar.
// Two identical graphs run side by side; per sample, on every active out:
//   unipolar == 0.5 * (bipolar + amp)   (= 0.5*amp*(v+1): 0..amp, amp 0 -> 0)
// Unused SinCos4 taps stay exactly 0 in both modes; no center set == Bipolar.
// Usage: node scripts/smoke_graph_sincos_polarity.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, {});
const e = instance.exports;
const ver = e.soemdsp_graph_version() | 0;
if (ver < 182) throw new Error(`graph version ${ver} < 182 (no SinCos Polarity in this WASM)`);

const TYPE_SIN_COS = 153, TYPE_SINE_WT = 40, TYPE_OUT = 6;
const P_FREQ = 10, P_AMP = 12, P_SHAPE = 13, P_MODE = 21, P_CENTER = 30;
const ACTIVE = [1, 1, 2, 2, 3, 4]; // SinCos4 modes sine..4-phase
let hSeq = 0xd100;

function render(typeId, { mode, amp, method, polarity }) {
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, 48000);
  const hOsc = hSeq++, hOut = hSeq++;
  if ((e.soemdsp_graph_add_node(g, hOsc, typeId) | 0) !== 0) throw new Error("add osc");
  if ((e.soemdsp_graph_add_node(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("add out");
  e.soemdsp_graph_connect(g, hOsc, 0, hOut, 0);
  e.soemdsp_graph_set_param(g, hOsc, P_FREQ, 437);
  e.soemdsp_graph_set_param(g, hOsc, P_AMP, amp);
  e.soemdsp_graph_set_param(g, hOsc, P_SHAPE, method);
  if (mode != null) e.soemdsp_graph_set_param(g, hOsc, P_MODE, mode);
  if (polarity != null) e.soemdsp_graph_set_param(g, hOsc, P_CENTER, polarity);
  if ((e.soemdsp_graph_compile(g) | 0) !== 0) throw new Error("compile");
  e.soemdsp_graph_snap_controls(g);
  const ports = typeId === TYPE_SIN_COS ? 2 : 4;
  const out = Array.from({ length: ports }, () => []);
  for (let q = 0; q < 12; q++) {
    e.soemdsp_graph_process_block(g, 128);
    for (let p = 0; p < ports; p++) {
      const v = new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, hOsc, p) | 0, 128);
      out[p].push(...v);
    }
  }
  e.soemdsp_graph_destroy(g);
  return out;
}

let checks = 0;
function check(label, typeId, mode, amp, method) {
  const bi = render(typeId, { mode, amp, method, polarity: 0 });
  const dflt = render(typeId, { mode, amp, method, polarity: null });
  const uni = render(typeId, { mode, amp, method, polarity: 1 });
  const active = typeId === TYPE_SIN_COS ? 2 : ACTIVE[mode];
  let lo = Infinity, hi = -Infinity;
  for (let p = 0; p < bi.length; p++) {
    for (let i = 0; i < bi[p].length; i++) {
      if (dflt[p][i] !== bi[p][i]) throw new Error(`${label} port ${p} [${i}] default ${dflt[p][i]} != bipolar ${bi[p][i]}`);
      const want = p < active ? 0.5 * (bi[p][i] + amp) : 0;
      if (p >= active && bi[p][i] !== 0) throw new Error(`${label} unused port ${p} bipolar ${bi[p][i]}`);
      if (Math.abs(uni[p][i] - want) > 1e-12) throw new Error(`${label} port ${p} [${i}] unipolar ${uni[p][i]} want ${want}`);
      if (p < active) { lo = Math.min(lo, uni[p][i]); hi = Math.max(hi, uni[p][i]); }
      checks++;
    }
  }
  // 1e-6: the Polynomial method itself peaks ~7e-10 past +-1.
  if (lo < -1e-6 || hi > amp + 1e-6) throw new Error(`${label} unipolar range ${lo}..${hi} outside 0..${amp}`);
  if (amp > 0 && (lo > 0.02 * amp || hi < 0.98 * amp)) throw new Error(`${label} unipolar range ${lo}..${hi} not spanning 0..${amp}`);
  console.log(`${label} ok unipolar ${lo.toFixed(4)}..${hi.toFixed(4)}`);
}

for (const amp of [1, 0.5, 0]) {
  for (const method of [0, 1]) {
    check(`sinCos amp=${amp} method=${method}`, TYPE_SIN_COS, null, amp, method);
    for (let mode = 0; mode <= 5; mode++) {
      check(`sinCos4 mode=${mode} amp=${amp} method=${method}`, TYPE_SINE_WT, mode, amp, method);
    }
  }
}
console.log(`smoke_graph_sincos_polarity ok: version=${ver}, ${checks} samples checked`);
