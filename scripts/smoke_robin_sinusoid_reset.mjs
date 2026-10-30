// Robin Sinusoid Reset: full-height poke primes to Start Phase; half-height
// moves the phasor partway (partial_reset_phase).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const mem = e.memory;
if (!mem) throw new Error("wasm memory export missing");

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

const create = must("soemdsp_graph_create");
const destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const poke = must("soemdsp_graph_poke_input");
const version = must("soemdsp_graph_version");
must("soemdsp_robin_sinusoid_partial_reset");
if ((must("soemdsp_robin_sinusoid_version")() | 0) < 2) {
  throw new Error("robin_sinusoid version < 2");
}
if ((version() | 0) < 274) throw new Error(`graph version ${version()} expected >= 274`);

const TYPE_ROBIN = 15;
const TYPE_OUT = 6;
const PORT_MONO = 0;
const PORT_RESET = 19;
const PARAM_FREQUENCY = 10;
const PARAM_AMPLITUDE = 12;

function view(ptr, n) {
  return new Float64Array(mem.buffer, ptr, n);
}

function firstAfterPoke(amp) {
  const g = create() | 0;
  setSr(g, 48000);
  const hOsc = 0xd401 >>> 0;
  const hOut = 0xd402 >>> 0;
  if ((add(g, hOsc, TYPE_ROBIN) | 0) !== 0) throw new Error("add osc");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("add out");
  if ((connect(g, hOsc, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error("conn");
  setParam(g, hOsc, PARAM_FREQUENCY, 440);
  setParam(g, hOsc, PARAM_AMPLITUDE, 1);
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);
  for (let q = 0; q < 20; q++) process(g, 128);
  const pre = view(portPtr(g, hOsc, PORT_MONO) | 0, 128);
  if (!Number.isFinite(pre[0]) || Math.abs(pre[127]) < 1e-6) {
    throw new Error(`pre-reset silent/NaN ${pre[0]} ${pre[127]}`);
  }
  if ((poke(g, hOsc, PORT_RESET, amp) | 0) !== 0) throw new Error("poke");
  process(g, 128);
  const post = view(portPtr(g, hOsc, PORT_MONO) | 0, 128);
  const first = post[0];
  destroy(g);
  if (!Number.isFinite(first)) throw new Error(`reset ${amp} NaN`);
  return first;
}

const omega = 2 * Math.PI * 440 / 48000;
const full = firstAfterPoke(1);
const half = firstAfterPoke(0.5);
// Full reset primes to phase 0 then rotates once → ≈ sin(ω).
if (Math.abs(full - Math.sin(omega)) > 0.02) {
  throw new Error(`full reset first=${full} want ~${Math.sin(omega)}`);
}
if (!(Math.abs(full - half) > 1e-4)) {
  throw new Error(`half-height reset matched full (${full})`);
}
console.log(`smoke_robin_sinusoid_reset ok full=${full.toFixed(5)} half=${half.toFixed(5)} version=${version() | 0}`);
