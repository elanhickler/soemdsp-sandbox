// Headless: EQ Filter ZDF (type 57) ƒ input. Wired ƒ = absolute Hz that replaces the
// Frequency knob every sample (resolve_osc_hz, same as Comb Resonator).
// - Lowpass, knob parked at 100 Hz, ƒ wired to 300/1000/3000/8000 Hz: a sine AT ƒ
//   comes out at the -3 dB point (|H| = 0.707 at Q 0.707), i.e. cutoff follows ƒ.
// - Graph output is bit-identical to the native EQ run directly at freq = ƒ.
// - ƒ unwired: knob (100 Hz) rules again (sine at 3000 Hz strongly cut).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const gC = must("soemdsp_graph_create"), gD = must("soemdsp_graph_destroy"), add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect"), setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
const proc = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");
const eqCreate = must("soemdsp_eq_filter_create"), eqSample = must("soemdsp_eq_filter_sample"), eqDestroy = must("soemdsp_eq_filter_destroy");
if ((must("soemdsp_graph_version")() | 0) < 170) throw new Error("graph version < 170");
const SR = 48000, TYPE_OSC = 1, TYPE_BIAS = 12, TYPE_EQ = 57, TYPE_OUT = 6;
const PORT_MONO = 0, PORT_F = 16;
const P_FREQ = 10, P_WAVE = 11, P_AMP = 12, P_MODE = 21, P_ATT_OFFSET = 71;
const KNOB = 100, BLOCKS = 200;

function run(sineHz, fHz) {
  const g = gC() | 0; setSr(g, SR);
  const hO = 0xe0f1, hB = 0xe0f2, hE = 0xe0f3, hOut = 0xe0f4;
  for (const [h, t] of [[hO, TYPE_OSC], [hE, TYPE_EQ], [hOut, TYPE_OUT]]) if (add(g, h, t) | 0) throw new Error("add");
  setParam(g, hO, P_FREQ, sineHz); setParam(g, hO, P_WAVE, 5); setParam(g, hO, P_AMP, 1);
  connect(g, hO, PORT_MONO, hE, PORT_MONO); connect(g, hE, PORT_MONO, hOut, PORT_MONO);
  setParam(g, hE, P_MODE, 1); // Lowpass
  setParam(g, hE, P_FREQ, KNOB);
  if (fHz !== null) {
    if (add(g, hB, TYPE_BIAS) | 0) throw new Error("add bias");
    setParam(g, hB, P_ATT_OFFSET, fHz);
    if (connect(g, hB, PORT_MONO, hE, PORT_F) | 0) throw new Error("connect f");
  }
  if (compile(g) | 0) throw new Error("compile"); snap(g);
  const x = [], y = [], fv = [];
  for (let b = 0; b < BLOCKS; b++) {
    proc(g, 128);
    x.push(...new Float64Array(e.memory.buffer, portPtr(g, hO, PORT_MONO) | 0, 128));
    y.push(...new Float64Array(e.memory.buffer, portPtr(g, hE, PORT_MONO) | 0, 128));
    if (fHz !== null) fv.push(...new Float64Array(e.memory.buffer, portPtr(g, hB, PORT_MONO) | 0, 128));
  }
  gD(g);
  return { x, y, fv };
}
const rms = (a, from) => { let s = 0; for (let i = from; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - from)); };

for (const F of [300, 1000, 3000, 8000]) {
  const r = run(F, F);
  if (!r.fv.every((v) => v === F)) throw new Error(`ƒ source not constant ${F}`);
  const tail = r.y.length / 2;
  const gain = rms(r.y, tail) / rms(r.x, tail);
  if (Math.abs(gain - Math.SQRT1_2) > 0.03) throw new Error(`ƒ ${F}: gain at ƒ ${gain.toFixed(4)} (want 0.707): cutoff did not follow ƒ`);
  // Bit-exact vs the native EQ at freq = ƒ every sample.
  const h = eqCreate() | 0;
  for (let i = 0; i < r.x.length; i++) {
    const ref = eqSample(h, r.x[i], 2, r.fv[i], 0.707, 0, SR, 1);
    if (!Object.is(ref, r.y[i])) { eqDestroy(h); throw new Error(`ƒ ${F}: sample ${i} graph ${r.y[i]} != native ${ref}`); }
  }
  eqDestroy(h);
  console.log(`ok ƒ ${F} Hz (knob ${KNOB}): gain at ƒ ${gain.toFixed(4)}, bit-identical to native at freq=ƒ`);
}
{
  const r = run(3000, null), tail = r.y.length / 2;
  const gain = rms(r.y, tail) / rms(r.x, tail);
  if (!(gain < 0.01)) throw new Error(`unwired: knob 100 Hz should cut 3 kHz, gain ${gain}`);
  console.log(`ok ƒ unwired: knob ${KNOB} Hz rules (3 kHz gain ${gain.toExponential(2)})`);
}
console.log("eq filter ƒ smoke ok");
