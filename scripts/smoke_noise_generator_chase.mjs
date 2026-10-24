// B-043: Noise Generator Mean / Amplitude chase must be sample-accurate
// (no block zipper). Deviation 0 makes Uniform noise a DC = clamp(mean)*amp.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");

const imp = { env: { emo_process_block: () => 0 } };
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), imp);
const e = instance.exports;
const mem = e.memory;
if (!mem) throw new Error("wasm memory export missing");

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

const create = must("soemdsp_graph_create");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const setSmoothTime = must("soemdsp_graph_set_smooth_time");
const setSmoothMode = must("soemdsp_graph_set_smooth_mode");
const setSmoothType = must("soemdsp_graph_set_smooth_type");
const compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const outL = must("soemdsp_graph_block_output_left_ptr");
const destroy = must("soemdsp_graph_destroy");

const TYPE_NOISE = 14;
const TYPE_OUT = 6;
const PORT_MONO = 0;
const PARAM_AMP = 12;
const PARAM_WIDTH = 31;
const PARAM_MEAN = 71;
const FRAMES = 128;
const SR = 48000;
const PROBE = 16;

const fnv = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

function maxFlatRun(peaks) {
  let flatRuns = 0;
  let maxFlat = 0;
  for (let i = 1; i < peaks.length; i++) {
    if (Math.abs(peaks[i] - peaks[i - 1]) < 1e-9) {
      flatRuns += 1;
      if (flatRuns > maxFlat) maxFlat = flatRuns;
    } else {
      flatRuns = 0;
    }
  }
  return maxFlat;
}

function captureRamp(h, nodeHash, paramId, from, to) {
  setParam(h, nodeHash, paramId, from);
  snap(h);
  for (let i = 0; i < 4; i++) process(h, FRAMES);
  setParam(h, nodeHash, paramId, to);
  const peaks = [];
  const blocks = 20;
  for (let b = 0; b < blocks; b++) {
    process(h, FRAMES);
    const ptr = outL(h) >>> 0;
    const view = new Float64Array(mem.buffer, ptr, FRAMES);
    for (let i = 0; i < FRAMES; i += PROBE) peaks.push(Math.abs(view[i]));
  }
  return peaks;
}

function assertChase(label, peaks) {
  const first = peaks.find((p) => p > 1e-6) ?? 0;
  const last = peaks[peaks.length - 1] ?? 0;
  const maxFlat = maxFlatRun(peaks);
  console.log({
    label,
    probes: peaks.length,
    firstNonZero: first,
    last,
    maxFlatRun: maxFlat,
    mid: peaks[Math.floor(peaks.length / 2)],
  });
  if (!(last > first * 2)) {
    throw new Error(`${label}: expected rising envelope, first=${first} last=${last}`);
  }
  if (maxFlat >= 6) {
    throw new Error(`${label}: zipper suspected: maxFlatRun=${maxFlat}`);
  }
}

const h = create();
if (h <= 0) throw new Error("create failed");
setSr(h, SR);

const noise = fnv("noise");
const out = fnv("out");
if (add(h, noise, TYPE_NOISE) !== 0) throw new Error("add noise");
if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
if (connect(h, noise, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
if (compile(h) !== 0) throw new Error("compile");

setParam(h, noise, PARAM_WIDTH, 0);
setParam(h, noise, PARAM_AMP, 1);

const smoothSamples = Math.round(0.0333 * SR);
setSmoothMode(h, noise, PARAM_MEAN, 0);
setSmoothType(h, noise, PARAM_MEAN, 0);
setSmoothTime(h, noise, PARAM_MEAN, smoothSamples);
setSmoothMode(h, noise, PARAM_AMP, 0);
setSmoothType(h, noise, PARAM_AMP, 0);
setSmoothTime(h, noise, PARAM_AMP, smoothSamples);

assertChase("mean", captureRamp(h, noise, PARAM_MEAN, 0, 1));

setParam(h, noise, PARAM_MEAN, 0.5);
setParam(h, noise, PARAM_AMP, 0);
assertChase("amplitude", captureRamp(h, noise, PARAM_AMP, 0, 1));

destroy(h);
console.log("noise generator chase smoke OK");
