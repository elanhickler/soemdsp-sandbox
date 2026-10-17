// Headless: Softpop 2 (type 219) through the combined wasm graph.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };

const create = must("soemdsp_graph_create");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const destroy = must("soemdsp_graph_destroy");
must("soemdsp_softpop2_display_bin_count");
must("soemdsp_softpop2_sample");

const TYPE = 219, TYPE_OUT = 6;
const PARAM = { FREQUENCY: 10, AMPLITUDE: 12, SHAPE: 13, MIX: 40, STAGES: 22, SEED: 48 };
const PORT = { MONO: 0, LEFT: 1, RIGHT: 2 };
const SR = 48000, FRAMES = 128, BLOCKS = 200;
const HASH = 0x50f72001 >>> 0, OUT = 0x50f720ff >>> 0;

let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };

function render(params) {
  const g = create() | 0;
  setSr(g, SR);
  add(g, HASH, TYPE);
  add(g, OUT, TYPE_OUT);
  connect(g, HASH, PORT.MONO, OUT, 0);
  for (const [k, v] of Object.entries(params)) setParam(g, HASH, PARAM[k], v);
  if ((compile(g) | 0) < 0) throw new Error("compile");
  snap(g);
  const l = new Float64Array(BLOCKS * FRAMES);
  const r = new Float64Array(BLOCKS * FRAMES);
  const m = new Float64Array(BLOCKS * FRAMES);
  for (let b = 0; b < BLOCKS; b++) {
    processBlock(g, FRAMES);
    const rd = (p) => new Float64Array(e.memory.buffer, portPtr(g, HASH, p) | 0, FRAMES);
    m.set(rd(PORT.MONO), b * FRAMES);
    l.set(rd(PORT.LEFT), b * FRAMES);
    r.set(rd(PORT.RIGHT), b * FRAMES);
  }
  destroy(g);
  return { l, r, m };
}
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const eq = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const sine = render({ FREQUENCY: 440, MIX: 0, SHAPE: 0, AMPLITUDE: 1, STAGES: 0, SEED: 1 });
gate(eq(sine.m, sine.l), "Mono out == Left");
gate(eq(sine.l, sine.r), "Crossfade 0: L == R");
gate(Math.abs(20 * Math.log10(rms(sine.l) / Math.SQRT1_2)) < 0.2, `Crossfade 0 RMS ${rms(sine.l).toFixed(4)} ~ 1/sqrt2`);

const noise = render({ FREQUENCY: 1000, MIX: 1, SHAPE: 0, AMPLITUDE: 1, STAGES: 1, SEED: 1 });
gate(!eq(noise.l, noise.r), "Crossfade 1: L != R");
gate(Math.abs(20 * Math.log10(rms(noise.l) / Math.SQRT1_2)) < 0.5, `Crossfade 1 RMS ${rms(noise.l).toFixed(4)} within 0.5 dB of sine`);

const silent = render({ FREQUENCY: 440, MIX: 1, SHAPE: 1, AMPLITUDE: 1, STAGES: 0, SEED: 1 });
gate(silent.l.every((v) => v === 0), "Amp over 1 at Crossfade 1 is silent");

if (failures) {
  console.error(`${failures} FAIL`);
  process.exit(1);
}
console.log("smoke_graph_softpop2 ok");
