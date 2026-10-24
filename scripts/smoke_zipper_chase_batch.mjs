// B-043: Attenuverter / Range / Slew / Sabrina Mix / Pump / Noise Gate /
// Lookahead continuous knobs must chase per sample (no block zipper).
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

const TYPE_REVERB = 4;
const TYPE_OUT = 6;
const TYPE_ATT = 7;
const TYPE_RANGE = 8;
const TYPE_BIAS = 12;
const TYPE_SLEW = 17;
const TYPE_LOOKAHEAD = 35;
const TYPE_PUMP = 109;
const TYPE_GATE = 234;
const PORT_MONO = 0;
const PARAM_AMP = 12;
const PARAM_MIX = 40;
const PARAM_TIME_NUM = 52;
const PARAM_TIME_DEN = 53;
const PARAM_ATT_AMP = 70;
const PARAM_ATT_OFF = 71;
const PARAM_OUT_LOW = 82;
const PARAM_GAIN_DB = 90;
const PARAM_MODE = 21;
const PARAM_ATTACK = 55;
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

function assertChase(label, peaks, { falling = false } = {}) {
  const first = peaks.find((p) => p > 1e-9) ?? peaks[0] ?? 0;
  const last = peaks[peaks.length - 1] ?? 0;
  const maxFlat = maxFlatRun(peaks);
  console.log({
    label,
    probes: peaks.length,
    first,
    last,
    maxFlatRun: maxFlat,
    mid: peaks[Math.floor(peaks.length / 2)],
  });
  if (falling) {
    if (!(first > last * 1.15)) {
      throw new Error(`${label}: expected falling envelope, first=${first} last=${last}`);
    }
  } else if (!(last > first * 2)) {
    throw new Error(`${label}: expected rising envelope, first=${first} last=${last}`);
  }
  if (maxFlat >= 6) {
    throw new Error(`${label}: zipper suspected: maxFlatRun=${maxFlat}`);
  }
}

function runCase(label, build, chaseHash, paramId, from, to, opts = {}) {
  const h = create();
  if (h <= 0) throw new Error(`${label}: create failed`);
  setSr(h, SR);
  build(h);
  if (compile(h) !== 0) throw new Error(`${label}: compile`);
  const smoothSamples = Math.round(0.0333 * SR);
  setSmoothMode(h, chaseHash, paramId, 0);
  setSmoothType(h, chaseHash, paramId, 0);
  setSmoothTime(h, chaseHash, paramId, smoothSamples);
  setParam(h, chaseHash, paramId, from);
  snap(h);
  const warmup = opts.warmupBlocks ?? 4;
  for (let i = 0; i < warmup; i++) process(h, FRAMES);
  setParam(h, chaseHash, paramId, to);
  const peaks = [];
  for (let b = 0; b < 20; b++) {
    process(h, FRAMES);
    const ptr = outL(h) >>> 0;
    const view = new Float64Array(mem.buffer, ptr, FRAMES);
    for (let i = 0; i < FRAMES; i += PROBE) peaks.push(Math.abs(view[i]));
  }
  destroy(h);
  assertChase(label, peaks, opts);
}

{
  const att = fnv("att");
  const out = fnv("out");
  runCase("attenuverter-offset", (h) => {
    if (add(h, att, TYPE_ATT) !== 0) throw new Error("add att");
    if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
    if (connect(h, att, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
    setParam(h, att, PARAM_ATT_AMP, 0);
  }, att, PARAM_ATT_OFF, 0, 1);
}

{
  const range = fnv("range");
  const out = fnv("out");
  runCase("range-outLow", (h) => {
    if (add(h, range, TYPE_RANGE) !== 0) throw new Error("add range");
    if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
    if (connect(h, range, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
    setParam(h, range, 80, 0); // inLow
    setParam(h, range, 81, 1); // inHigh
  }, range, PARAM_OUT_LOW, 0, 1);
}

{
  const slew = fnv("slew");
  const out = fnv("out");
  runCase("slew-bias", (h) => {
    if (add(h, slew, TYPE_SLEW) !== 0) throw new Error("add slew");
    if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
    if (connect(h, slew, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
    setParam(h, slew, PARAM_TIME_NUM, 0);
    setParam(h, slew, PARAM_TIME_DEN, 0);
  }, slew, PARAM_ATT_OFF, 0, 1);
}

{
  const bias = fnv("bias");
  const rev = fnv("rev");
  const out = fnv("out");
  runCase("sabrina-mix", (h) => {
    if (add(h, bias, TYPE_BIAS) !== 0) throw new Error("add bias");
    if (add(h, rev, TYPE_REVERB) !== 0) throw new Error("add rev");
    if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
    if (connect(h, bias, PORT_MONO, rev, PORT_MONO) !== 0) throw new Error("connect");
    if (connect(h, rev, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
    setParam(h, bias, PARAM_ATT_OFF, 1);
    setParam(h, rev, PARAM_AMP, 1);
  }, rev, PARAM_MIX, 0, 1, { falling: true });
}

{
  const bias = fnv("bias");
  const pump = fnv("pump");
  const out = fnv("out");
  runCase("pump-amplitude", (h) => {
    if (add(h, bias, TYPE_BIAS) !== 0) throw new Error("add bias");
    if (add(h, pump, TYPE_PUMP) !== 0) throw new Error("add pump");
    if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
    if (connect(h, bias, PORT_MONO, pump, PORT_MONO) !== 0) throw new Error("connect");
    if (connect(h, pump, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
    setParam(h, bias, PARAM_ATT_OFF, 1);
    setParam(h, pump, PARAM_MODE, 0);
  }, pump, PARAM_AMP, 0, 1);
}

{
  const bias = fnv("bias");
  const gate = fnv("gate");
  const out = fnv("out");
  runCase("noise-gate-amplitude", (h) => {
    if (add(h, bias, TYPE_BIAS) !== 0) throw new Error("add bias");
    if (add(h, gate, TYPE_GATE) !== 0) throw new Error("add gate");
    if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
    if (connect(h, bias, PORT_MONO, gate, PORT_MONO) !== 0) throw new Error("connect");
    if (connect(h, gate, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
    setParam(h, bias, PARAM_ATT_OFF, 1);
  }, gate, PARAM_AMP, 0, 1, { warmupBlocks: 20 });
}

{
  const bias = fnv("bias");
  const lim = fnv("lim");
  const out = fnv("out");
  runCase("lookahead-ceiling", (h) => {
    if (add(h, bias, TYPE_BIAS) !== 0) throw new Error("add bias");
    if (add(h, lim, TYPE_LOOKAHEAD) !== 0) throw new Error("add lim");
    if (add(h, out, TYPE_OUT) !== 0) throw new Error("add out");
    if (connect(h, bias, PORT_MONO, lim, PORT_MONO) !== 0) throw new Error("connect");
    if (connect(h, lim, PORT_MONO, out, PORT_MONO) !== 0) throw new Error("connect");
    setParam(h, bias, PARAM_ATT_OFF, 1);
    setParam(h, lim, PARAM_MODE, 0);
    setParam(h, lim, PARAM_ATTACK, 0);
  }, lim, PARAM_GAIN_DB, 0, -24, { falling: true });
}

console.log("zipper chase batch smoke OK");
