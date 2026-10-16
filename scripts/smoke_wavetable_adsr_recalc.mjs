// Headless: Wavetable ADSR Recalc On Trig (native wavetable_adsr + graph type 168).
// On:  Shape/Attack/Decay/Sustain/Release/Level latched on rising Gate, held
//      through the whole note including release; next rising Gate picks up new knobs.
// Off: knob changes live on the next sample. Shape 3 (Log) reachable.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const create = must("soemdsp_wavetable_adsr_create");
const destroy = must("soemdsp_wavetable_adsr_destroy");
const sample = must("soemdsp_wavetable_adsr_sample");
if ((must("soemdsp_wavetable_adsr_version")() | 0) < 2) throw new Error("wavetable_adsr version < 2");
const SR = 48000;
const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
const firstDiff = (x, y) => x.findIndex((v, i) => !Object.is(v, y[i]));

// Note 1: gate 0..ON1, release until G2, note 2 from G2. Knobs change at CH (mid sustain).
const ON1 = 24000, CH = 12000, G2 = 48000, N = 72000;
const base = { shape: 1, a: 0.01, d: 0.05, s: 0.7, r: 0.3, l: 1 };
const alt  = { shape: 3, a: 0.02, d: 0.10, s: 0.3, r: 0.05, l: 0.6 };
function run(recalc, change) {
  const h = create() | 0;
  const out = [];
  for (let n = 0; n < N; n++) {
    const k = change && n >= CH ? alt : base;
    const gate = (n < ON1 || n >= G2) ? 1 : 0;
    out.push(sample(h, gate, 0, k.shape, k.a, k.d, k.s, k.r, k.l, recalc, SR));
  }
  destroy(h);
  return out;
}
{
  const b = run(1, false), c = run(1, true);
  const d = firstDiff(b, c);
  if (d !== G2) throw new Error(`On: first difference at ${d}, expected exactly at next rising Gate ${G2}`);
  // after note 2 settles into sustain: alt Sustain * alt Level
  const tail = c[G2 + 20000];
  if (Math.abs(tail - alt.s * alt.l) > 1e-9) throw new Error(`On: note 2 sustain ${tail} != ${alt.s * alt.l}`);
  console.log(`ok On: knobs held through sustain + release (identical until ${d}); note 2 uses new knobs (sustain ${tail.toFixed(3)})`);
}
{
  const b = run(0, false), c = run(0, true);
  const d = firstDiff(b, c);
  if (d !== CH) throw new Error(`Off: first difference at ${d}, expected ${CH}`);
  console.log(`ok Off: knob change live at sample ${d}`);
}
// Shape 3 (Log) differs from Linear.
{
  const h1 = create() | 0, h3 = create() | 0;
  let differs = false;
  for (let n = 0; n < 2000; n++) {
    const y1 = sample(h1, 1, 0, 1, 0.02, 0.05, 0.7, 0.3, 1, 0, SR);
    const y3 = sample(h3, 1, 0, 3, 0.02, 0.05, 0.7, 0.3, 1, 0, SR);
    if (!Object.is(y1, y3)) differs = true;
  }
  destroy(h1); destroy(h3);
  if (!differs) throw new Error("Shape 3 (Log) not distinct from Linear");
  console.log("ok Shape 3 (Log) active");
}

// ---- graph ----
const gCreate = must("soemdsp_graph_create"), gDestroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node"), connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");
if ((must("soemdsp_graph_version")() | 0) < 166) throw new Error("graph version < 166");
const PARAM_TIMING_MODE = 54, PARAM_RELEASE = 55;
function graphRun(mode, change) {
  const g = gCreate() | 0;
  setSr(g, 48000);
  const hClk = 0x7c01 >>> 0, hA = 0x7c02 >>> 0, hOut = 0x7c03 >>> 0;
  if ((add(g, hClk, 28) | 0) !== 0) throw new Error("clock add");
  if ((add(g, hA, 168) | 0) !== 0) throw new Error("adsr add");
  if ((add(g, hOut, 6) | 0) !== 0) throw new Error("out add");
  connect(g, hClk, 0, hA, 0);
  connect(g, hA, 0, hOut, 0);
  setParam(g, hClk, 10, 4); // 4 Hz gate: rising edges every 12000 samples
  if (mode !== null) setParam(g, hA, PARAM_TIMING_MODE, mode);
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);
  const out = [];
  for (let q = 0; q < 300; q++) {
    if (change && q === 20) { setParam(g, hA, PARAM_RELEASE, 0.05); snap(g); } // Release at sample 2560 (gate still high)
    processBlock(g, 128);
    const buf = new Float64Array(e.memory.buffer, portPtr(g, hA, 0) | 0, 128);
    for (let i = 0; i < 128; i++) out.push(buf[i]);
  }
  gDestroy(g);
  return out;
}
{
  const d = firstDiff(graphRun(1, false), graphRun(1, true));
  if (!(d >= 12000)) throw new Error(`graph On: Release change leaked at ${d}`);
  console.log(`ok graph On: Release change at 2560 held through this note's release until next Gate (first diff ${d})`);
}
{
  const d = firstDiff(graphRun(null, false), graphRun(null, true));
  if (d < 0 || d >= 12000) throw new Error(`graph default (Off): Release change not live (first diff ${d})`);
  console.log(`ok graph default Off: Release change live (at gate fall) (first diff ${d})`);
}
console.log("wavetable adsr recalc smoke ok");

