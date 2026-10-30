// Flower Child Filter Rev3: native exports, self-osc energy, dithered phasor.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const imp = { env: { emo_process_block: () => 0 } };
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), imp);
const e = instance.exports;

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

const create = must("soemdsp_flower_child_filter_rev3_create");
const destroy = must("soemdsp_flower_child_filter_rev3_destroy");
const sample = must("soemdsp_flower_child_filter_rev3_sample");
const setSeed = must("soemdsp_flower_child_filter_rev3_set_seed");
const version = must("soemdsp_flower_child_filter_rev3_version");
must("soemdsp_graph_version");

if ((version() | 0) < 3) throw new Error(`rev3 version ${version()}`);

const sr = 48000;
const h = create() | 0;
if (!h) throw new Error("create failed");
setSeed(h, 1, 0);

function run(n, freq, reso, mode, excite = 0) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const inn = i < excite ? 1.0 : 0.0;
    out[i] = sample(h, inn, freq, reso, 0, mode, sr, 1, 2000, 7000, 1);
  }
  return out;
}

function peak(buf) {
  let m = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const a = Math.abs(buf[i]);
    if (a > m) m = a;
  }
  return m;
}

function zeroCrossHz(buf, skip, rate) {
  let last = buf[skip];
  let crosses = 0;
  for (let i = skip + 1; i < buf.length; i += 1) {
    const y = buf[i];
    if ((last <= 0 && y > 0) || (last >= 0 && y < 0)) crosses += 1;
    last = y;
  }
  const seconds = (buf.length - skip) / rate;
  return (crosses * 0.5) / seconds;
}

// Kick the loop, then measure Clean self-osc at Resonance 0.8, 440 Hz knob.
run(64, 440, 0.8, 0, 64);
const clean = run(sr, 440, 0.8, 0);
const cleanPeak = peak(clean);
if (!(cleanPeak > 0.05)) {
  throw new Error(`Clean self-osc silent, peak ${cleanPeak} tail=${Array.from(clean.slice(-8))}`);
}
const heard = zeroCrossHz(clean, Math.floor(sr * 0.25), sr);
console.log(`fcf-rev3 Clean res0.8 knob440 heardHz=${heard.toFixed(2)} peak=${cleanPeak.toFixed(4)}`);
if (heard < 350 || heard > 550) {
  throw new Error(`Clean res0.8 pitch ref missed 440 Hz, heard ${heard}`);
}

run(64, 440, 0.8, 1, 64);
const dirtyPeak = peak(run(8192, 440, 0.8, 1));
if (!(dirtyPeak > 0.01)) throw new Error(`Dirty silent, peak ${dirtyPeak}`);

run(64, 440, 0.8, 2, 64);
const hardPeak = peak(run(8192, 440, 0.8, 2));
if (!(hardPeak > 0.001)) throw new Error(`Hard silent, peak ${hardPeak}`);

run(64, 440, 0.8, 3, 64);
const dsPeak = peak(run(8192, 440, 0.8, 3));
if (!(dsPeak > 0.01)) throw new Error(`Downsampled silent, peak ${dsPeak}`);

// Two seeds must differ (dither + chaos streams).
const h2 = create() | 0;
setSeed(h2, 2, 0);
const a = [];
const b = [];
for (let i = 0; i < 512; i += 1) {
  a.push(sample(h, 0, 8000, 0.8, 0, 0, sr, 1, 2000, 7000, 1));
  b.push(sample(h2, 0, 8000, 0.8, 0, 0, sr, 1, 2000, 7000, 1));
}
let same = 0;
for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
if (same === a.length) throw new Error("different seeds produced identical HF dither streams");

// At 8 kHz (above Full) dither On replaces the inner osc with the noise band.
const hOff = create() | 0;
const hOn = create() | 0;
setSeed(hOff, 1, 0);
setSeed(hOn, 1, 0);
const quiet = [];
const sizz = [];
for (let i = 0; i < 1024; i += 1) {
  quiet.push(sample(hOff, 0, 8000, 0.2, 0, 0, sr, 0, 2000, 7000, 1));
  sizz.push(sample(hOn, 0, 8000, 0.2, 0, 0, sr, 1, 2000, 7000, 1));
}
destroy(hOff);
destroy(hOn);
const ps = sizz.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
if (!(ps > 1e-4)) throw new Error(`dither On silent at 8 kHz, peak ${ps}`);
if (quiet.every((v, i) => v === sizz[i])) {
  throw new Error("dither Off and On produced identical 8 kHz output");
}

destroy(h);
destroy(h2);

{
  const gCreate = must("soemdsp_graph_create");
  const gDestroy = must("soemdsp_graph_destroy");
  const add = must("soemdsp_graph_add_node");
  const connect = must("soemdsp_graph_connect");
  const setParam = must("soemdsp_graph_set_param");
  const compile = must("soemdsp_graph_compile");
  const process = must("soemdsp_graph_process_block");
  const setSr = must("soemdsp_graph_set_sample_rate");
  const snap = must("soemdsp_graph_snap_controls");
  const portPtr = must("soemdsp_graph_node_port_ptr");
  const TYPE_REV3 = 235;
  const TYPE_OUT = 6;
  const PORT_MONO = 0;
  const PORT_LEFT = 1;
  const PORT_RIGHT = 2;
  const PARAM_FREQ = 10;
  const PARAM_RESO = 20;
  const PARAM_LFO_STYLE = 56;
  const PARAM_SEED = 48;
  const mem = e.memory;

  // Shared stereo route (soemdsp/routing/stereo_route.h): Left + Right outs
  // wired run the L and R cores; Mono out alone runs one Mono core.
  function runDither(on, sides = true) {
    const g = gCreate() | 0;
    setSr(g, sr);
    const hF = 0xa101 >>> 0;
    const hOut = 0xa102 >>> 0;
    if ((add(g, hF, TYPE_REV3) | 0) !== 0) throw new Error("rev3 stereo add");
    if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("rev3 stereo out");
    if (sides) {
      if ((connect(g, hF, PORT_LEFT, hOut, PORT_LEFT) | 0) !== 0) throw new Error("rev3 stereo connect L");
      if ((connect(g, hF, PORT_RIGHT, hOut, PORT_RIGHT) | 0) !== 0) throw new Error("rev3 stereo connect R");
    } else if ((connect(g, hF, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error("rev3 mono connect");
    setParam(g, hF, PARAM_FREQ, 8000);
    setParam(g, hF, PARAM_RESO, 0.2);
    setParam(g, hF, PARAM_LFO_STYLE, on ? 1 : 0);
    setParam(g, hF, PARAM_SEED, 1);
    if ((compile(g) | 0) !== 0) throw new Error("rev3 stereo compile");
    snap(g);
    let differ = 0;
    let peakL = 0;
    let peakR = 0;
    for (let q = 0; q < 16; q++) {
      process(g, 128);
      const L = new Float64Array(mem.buffer, portPtr(g, hF, PORT_LEFT) | 0, 128);
      const R = new Float64Array(mem.buffer, portPtr(g, hF, PORT_RIGHT) | 0, 128);
      for (let i = 0; i < 128; i++) {
        if (L[i] !== R[i]) differ += 1;
        peakL = Math.max(peakL, Math.abs(L[i]));
        peakR = Math.max(peakR, Math.abs(R[i]));
      }
    }
    gDestroy(g);
    return { differ, peakL, peakR };
  }

  const off = runDither(false);
  if (off.differ !== 0) {
    throw new Error(`rev3 dither off Left!==Right (${off.differ} diffs)`);
  }
  const on = runDither(true);
  if (!(on.peakL > 1e-4 && on.peakR > 1e-4)) {
    throw new Error(`rev3 stereo dither silent peakL=${on.peakL} peakR=${on.peakR}`);
  }
  if (!(on.differ > 64)) {
    throw new Error(`rev3 dither on Left===Right (${on.differ} diffs, want uncorrelated L/R)`);
  }
  console.log(`ok rev3 stereo dither off identical, on differ=${on.differ}`);
  // Mono in -> Mono out: one core, no L+R average of decorrelated cores (the
  // "stereo summed to mono" bug); the unwired L / R taps mirror it.
  const mono = runDither(true, false);
  if (mono.differ !== 0) {
    throw new Error(`rev3 mono route ran two cores (${mono.differ} L/R diffs, want one Mono core)`);
  }
  console.log("ok rev3 mono in -> Mono out runs one core");
}

console.log("ok flower_child_filter_rev3");
