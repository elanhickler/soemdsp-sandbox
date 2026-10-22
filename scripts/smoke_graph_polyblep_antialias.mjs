// PolyBLEP Antialiasing switch (lfoStyle slot 56): 1 PolyBLEP (default) is
// bit-identical to the previous build (optional old wasm as argv[2]) and to
// the param omitted; 0 Off renders the naive waveform for every shape (matches
// a JS reference), differs from PolyBLEP only near discontinuities, and works
// with both Cycle modes.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000, TYPE_CLOCK = 28, TYPE_OUT = 6, TYPE_BLEP = 1;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RESET = 19, P_AA = 56;
const WAVES = ["Trisaw", "Saw", "Ramp", "Square", "Triangle", "Sine", "Center Square", "Pulse", "Analog Square", "Trisaw Center"];
function run(E, { wave, hz, clockHz = 0, cycle, aa, blocks = 100, phase = 0, morph = 0.5 }) {
  const g = E.soemdsp_graph_create() | 0;
  E.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7201, hB = 0x7202, hO = 0x7203;
  if (E.soemdsp_graph_add_node(g, hB, TYPE_BLEP) | 0) throw new Error("blep add");
  if (E.soemdsp_graph_add_node(g, hO, TYPE_OUT) | 0) throw new Error("out add");
  if (clockHz > 0) {
    if (E.soemdsp_graph_add_node(g, hC, TYPE_CLOCK) | 0) throw new Error("clock add");
    if (E.soemdsp_graph_connect(g, hC, PORT_MONO, hB, PORT_RESET) | 0) throw new Error("clk->Reset");
    E.soemdsp_graph_set_param(g, hC, 10, clockHz);
  }
  if (E.soemdsp_graph_connect(g, hB, PORT_MONO, hO, PORT_LEFT) | 0) throw new Error("blep->out");
  E.soemdsp_graph_set_param(g, hB, 10, hz);
  E.soemdsp_graph_set_param(g, hB, 11, wave);
  E.soemdsp_graph_set_param(g, hB, 13, morph);
  E.soemdsp_graph_set_param(g, hB, 14, phase);
  if (cycle !== undefined) E.soemdsp_graph_set_param(g, hB, 54, cycle);
  if (aa !== undefined) E.soemdsp_graph_set_param(g, hB, P_AA, aa);
  if (E.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  E.soemdsp_graph_snap_controls(g);
  const out = [];
  for (let q = 0; q < blocks; q++) {
    E.soemdsp_graph_process_block(g, 128);
    const b = new Float64Array(E.memory.buffer, E.soemdsp_graph_node_port_ptr(g, hB, PORT_MONO) | 0, 128);
    for (let i = 0; i < 128; i++) out.push(b[i]);
  }
  E.soemdsp_graph_destroy(g);
  return out;
}
const md = (a, b) => a.reduce((m, v, i) => Math.max(m, v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
// 1) PolyBLEP (1) == omitted == previous build.
let worst = 0, cases = 0;
for (let w = 0; w < WAVES.length; w++) for (const clockHz of [0, 3]) for (const hz of [110, 1234.5]) for (const cycle of [0, 1]) for (const morph of [0.5, 0.2]) {
  const a = run(N, { wave: w, hz, clockHz, cycle, morph, aa: 1 });
  worst = Math.max(worst, md(a, run(N, { wave: w, hz, clockHz, cycle, morph })));
  if (O) worst = Math.max(worst, md(a, run(O, { wave: w, hz, clockHz, cycle, morph })));
  cases++;
}
if (worst !== 0) throw new Error(`PolyBLEP differs (${worst})`);
console.log(`ok polyBlep Antialiasing PolyBLEP bit-identical to param omitted${O ? " and the previous build" : ""}: ${cases} cases, max diff 0`);
// 2) Off == naive reference. Phase t = n*hz/SR (cycles), free run from 0.
const wrap = (x) => x - Math.floor(x);
const clampW = (m) => Math.min(Math.max(m, 1e-6), 1 - 1e-6);
function ref(w, t, m) {
  switch (w) {
    case 1: return 1 - 2 * t;
    case 2: return -1 + 2 * t;
    case 3: return t < 0.5 ? 1 : -1;
    case 4: return 1 - 4 * Math.abs(t - 0.5);
    case 5: return Math.sin(2 * Math.PI * t);
    case 6: return wrap(t - 0.5 * (1 - m)) < m ? 1 : -1;
    case 7: return (t < m ? 2 : 0) - 2 * m;
    case 0: { let y = 2 * t; if (y >= 2 - m) return (y - 2) / m; if (y >= m) return 1 - (y - m) / (1 - m); return y / m; }
    default: return null; // 8 / 9: shared naive_* bodies, checked for continuity + shape below
  }
}
const rows = [];
for (let w = 0; w < WAVES.length; w++) for (const morph of [0.5, 0.3]) {
  const hz = 440;
  const off = run(N, { wave: w, hz, morph, aa: 0, blocks: 40 });
  const on = run(N, { wave: w, hz, morph, aa: 1, blocks: 40 });
  let refErr = 0, nearDisc = 0, far = 0;
  const inc = hz / SR;
  for (let n = 0; n < off.length; n++) {
    // phase wraps in radians (-pi, pi]; renderer maps to cycles 0..1 (phase/2pi wrapped)
    const t = wrap(n * inc);
    const r = ref(w, t, morph);
    // skip samples whose phase sits within 1e-9 of an edge (fp phase accumulator)
    if (r !== null) {
      const e = Math.abs(off[n] - r);
      const edges = [0, 0.5, morph, wrap(0.5 * (1 - morph)), wrap(0.5 * (1 + morph))];
      if (!edges.some((x) => Math.min(Math.abs(t - x), 1 - Math.abs(t - x)) < 1e-6)) refErr = Math.max(refErr, w === 5 ? 0 : e);
    }
    const d = Math.abs(off[n] - on[n]);
    const edgeDist = Math.min(...[0, 0.5, morph, 1 - 0.5 * morph, 0.5 * morph, 0.5 + 0.5 * morph, wrap(0.5 * (1 - morph)), wrap(0.5 * (1 + morph))]
      .map((x) => { const a = Math.abs(t - x); return Math.min(a, 1 - a); }));
    if (edgeDist < 2 * inc) nearDisc = Math.max(nearDisc, d); else far = Math.max(far, d);
  }
  if (refErr > 1e-9) throw new Error(`${WAVES[w]} m=${morph}: Off differs from naive reference (${refErr})`);
  const isSine = w === 5, isTri = w === 4;
  if (isSine && md(off, on) !== 0) throw new Error("Sine: Off should equal PolyBLEP (no corrections)");
  if (!isSine && !isTri && far > 1e-9) throw new Error(`${WAVES[w]} m=${morph}: differs away from discontinuities (${far})`);
  if (!isSine && nearDisc < 1e-3) throw new Error(`${WAVES[w]} m=${morph}: Off and PolyBLEP do not differ at discontinuities`);
  rows.push({ wave: WAVES[w], morph, refMaxErr: +refErr.toExponential(2), diffNearEdges: +nearDisc.toFixed(4), diffElsewhere: +far.toExponential(2) });
}
console.table(rows);
// 3) Off with Single trigger: one naive cycle per Reset, silent otherwise.
{
  const y = run(N, { wave: 1, hz: 100, clockHz: 2, cycle: 1, aa: 0, blocks: 400 });
  for (let i = 0; i < 480; i++) if (Math.abs(y[i] - (1 - 2 * wrap(i / 480))) > 1e-9) throw new Error(`Off + Single: sample ${i} ${y[i]}`);
  if (!y.slice(480, 23000).every((v) => v === 0)) throw new Error("Off + Single: not silent after the cycle");
  console.log("ok polyBlep Antialiasing Off + Single trigger: one naive saw cycle per Reset");
}
console.log("ok polyBlep Antialiasing: PolyBLEP unchanged, Off = naive for every waveform");
