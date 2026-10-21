// PolyBLEP Cycle switch (timingMode): Free run is bit-identical to the
// previous build (optional old wasm as argv[2]); Single trigger plays exactly
// one cycle per Reset hit, silent before the first hit and after the cycle;
// a Reset mid-cycle restarts it.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000, TYPE_CLOCK = 28, TYPE_OUT = 6, TYPE_BLEP = 1;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RESET = 19;
const WAVES = ["Trisaw", "Saw", "Ramp", "Square", "Triangle", "Sine", "Center Square", "Pulse", "Analog Square", "Trisaw Center"];
function run(E, { wave, hz, clockHz = 0, cycle, blocks = 375, phase = 0, morph = 0.5, retune }) {
  const g = E.soemdsp_graph_create() | 0;
  E.soemdsp_graph_set_sample_rate(g, SR);
  const hC = 0x7101, hB = 0x7102, hO = 0x7103;
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
  if (E.soemdsp_graph_compile(g) | 0) throw new Error("compile");
  E.soemdsp_graph_snap_controls(g);
  const out = [];
  for (let q = 0; q < blocks; q++) {
    if (retune && q === retune.block) E.soemdsp_graph_set_param(g, hB, 10, retune.hz);
    E.soemdsp_graph_process_block(g, 128);
    const b = new Float64Array(E.memory.buffer, E.soemdsp_graph_node_port_ptr(g, hB, PORT_MONO) | 0, 128);
    for (let i = 0; i < 128; i++) out.push(b[i]);
  }
  E.soemdsp_graph_destroy(g);
  return out;
}
const md = (a, b) => a.reduce((m, v, i) => Math.max(m, v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
// 1) Free run == old build (block path and per-sample Reset path); cycle param omitted == 0.
let freeWorst = 0, freeCases = 0;
for (let w = 0; w < WAVES.length; w++) for (const clockHz of [0, 3]) for (const hz of [110, 1234.5]) for (const phase of [0, 0.3]) {
  const a = run(N, { wave: w, hz, clockHz, cycle: 0, phase, blocks: 200 });
  const b = run(N, { wave: w, hz, clockHz, phase, blocks: 200 });
  freeWorst = Math.max(freeWorst, md(a, b));
  if (O) freeWorst = Math.max(freeWorst, md(a, run(O, { wave: w, hz, clockHz, phase, blocks: 200 })));
  freeCases++;
}
if (freeWorst !== 0) throw new Error(`Free run differs (${freeWorst})`);
console.log(`ok polyBlep Free run bit-identical${O ? " to the previous build" : ""}: ${freeCases} cases, max diff 0`);
// 2) Single trigger.
const rows = [];
for (let w = 0; w < WAVES.length; w++) {
  const unwired = run(N, { wave: w, hz: 100, cycle: 1, blocks: 100 });
  if (!unwired.every((v) => v === 0)) throw new Error(`${WAVES[w]}: Single trigger without Reset should be silent`);
  // Clock 2 Hz: Reset hits at 0 / 24000 / 48000 ...; 100 Hz = 480 samples per cycle.
  const y = run(N, { wave: w, hz: 100, clockHz: 2, cycle: 1, blocks: 750 });
  const free = run(N, { wave: w, hz: 100, clockHz: 2, cycle: 0, blocks: 750 });
  let first = -1;
  for (let i = 0; i < y.length; i++) if (y[i] !== 0) { first = i; break; }
  // find hit positions from the free-run reference (segment starts identical)
  const hits = [];
  for (let i = 0; i < y.length; i += 24000) hits.push(i);
  let lens = [];
  for (const h of hits) {
    // the cycle starts at the Reset hit sample h0 (search near h)
    const h0 = h; // Clock hits land on 0, 24000, 48000 ...
    let last = h0;
    for (let i = h0; i < Math.min(y.length, h0 + 2000); i++) if (y[i] !== 0) last = i;
    lens.push(last - h0 + 1);
    // inside the cycle Single == Free run after the same Reset (per-sample vs block pitch path: fp-rounding only)
    const seg = md(y.slice(h0, h0 + 480), free.slice(h0, h0 + 480));
    if (seg > 1e-9) throw new Error(`${WAVES[w]}: cycle differs from free run (${seg})`);
    if (!y.slice(h0 + 480, h0 + 23000).every((v) => v === 0)) throw new Error(`${WAVES[w]}: not silent after the cycle`);
  }
  if (first > 1 || lens.length < 3 || lens.some((l) => l > 480 || l < 479)) throw new Error(`${WAVES[w]}: cycle lengths ${lens}`);
  const startJump = y[0], endVal = y[479], nextFree = free[480];
  rows.push({ wave: WAVES[w], firstHit: first, cycleLens: [...new Set(lens)].join(","), start: +startJump.toFixed(4), lastSample: +endVal.toFixed(4), freeRunNext: +nextFree.toFixed(4) });
}
console.table(rows);
// 3) Retrigger mid-cycle: 1 Hz osc (48000-sample cycle), clock 3 Hz: each hit restarts.
{
  const y = run(N, { wave: 1, hz: 1, clockHz: 3, cycle: 1, blocks: 750 });
  const starts = [];
  for (let i = 1; i < y.length; i++) if (Math.abs(y[i] - y[i - 1]) > 0.5) starts.push(i);
  if (starts.length < 3) throw new Error(`retrigger: expected restarts, got ${starts.length}`);
  const L = 15000;
  const d = md(y.slice(starts[0], starts[0] + L), y.slice(starts[1], starts[1] + L));
  if (d !== 0) throw new Error(`retrigger segments differ (${d})`);
  console.log(`ok polyBlep Single trigger retrigger mid-cycle restarts (${starts.length} restarts, segments identical)`);
}
console.log("ok polyBlep Single trigger: silent before Reset and after one cycle, the cycle equals free run");
