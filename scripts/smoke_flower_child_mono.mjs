// Flower Child: mono In→Out must use one core (L/R fan identical to Mono).
// Stereo L/R inputs must stay independent (chaos cores diverge).
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
const nativeHandle = must("soemdsp_graph_node_native_handle");
const version = must("soemdsp_graph_version");

const TYPE_POLY = 1;
const TYPE_FLOWER = 61;
const TYPE_OUT = 6;
const PORT_MONO = 0;
const PORT_LEFT = 1;
const PORT_RIGHT = 2;
const PARAM_FREQUENCY = 10;
const PARAM_AMPLITUDE = 12;
const PARAM_RESONANCE = 20;
const PARAM_MODE = 21;
const PARAM_SHAPE = 13; // Chaos: worklet push("chaos", NATIVE_GRAPH_PARAM_SHAPE) -> node.shape

function view(ptr, n) {
  return new Float64Array(mem.buffer, ptr, n);
}

function identical(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const ver = version() | 0;
if (ver < 150) throw new Error(`graph version ${ver} expected >= 150`);

// --- mono: single core, L/R fan from Mono ---
{
  const g = create() | 0;
  setSr(g, 48000);
  const hOsc = 0x6101 >>> 0;
  const hFilt = 0x6102 >>> 0;
  const hOut = 0x6103 >>> 0;
  if ((add(g, hOsc, TYPE_POLY) | 0) !== 0) throw new Error("mono add osc");
  if ((add(g, hFilt, TYPE_FLOWER) | 0) !== 0) throw new Error("mono add flower");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("mono add out");
  if ((connect(g, hOsc, PORT_MONO, hFilt, PORT_MONO) | 0) !== 0) throw new Error("mono in");
  if ((connect(g, hFilt, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error("mono out");
  setParam(g, hOsc, PARAM_FREQUENCY, 220);
  setParam(g, hOsc, PARAM_AMPLITUDE, 0.35);
  setParam(g, hFilt, PARAM_FREQUENCY, 0.5);
  setParam(g, hFilt, PARAM_RESONANCE, 0.35);
  setParam(g, hFilt, PARAM_MODE, 0);
  setParam(g, hFilt, PARAM_SHAPE, 0.55); // chaos on — dual-sum would beat/chorus
  if ((compile(g) | 0) !== 0) throw new Error("mono compile");
  snap(g);

  const hMono = nativeHandle(g, hFilt) | 0;
  if (!(hMono > 0)) throw new Error(`flower nativeHandle=${hMono}`);

  let peak = 0;
  let averagedAway = false;
  for (let q = 0; q < 40; q++) {
    process(g, 128);
    const m = view(portPtr(g, hFilt, PORT_MONO) | 0, 128);
    const L = view(portPtr(g, hFilt, PORT_LEFT) | 0, 128);
    const R = view(portPtr(g, hFilt, PORT_RIGHT) | 0, 128);
    if (!identical(m, L) || !identical(m, R)) {
      // Dual-sum chorus would make Mono != L and/or L != R under chaos.
      throw new Error(`mono flower: L/R must fan from single mono core (q=${q})`);
    }
    for (let i = 0; i < 128; i++) {
      peak = Math.max(peak, Math.abs(m[i]));
      // If mono were (L+R)/2 of independent chaos, m would still equal L
      // only when L===R; identity already asserts that. Track energy.
    }
  }
  if (!(peak > 0.01 && peak < 16)) throw new Error(`mono flower peak=${peak}`);
  console.log(`mono flower ok peak=${peak.toFixed(4)} nativeHandle=${hMono}`);
  destroy(g);
}

// --- stereo: two polyBleps → flower L/R must diverge under chaos ---
{
  const g = create() | 0;
  setSr(g, 48000);
  const hA = 0x6201 >>> 0;
  const hB = 0x6202 >>> 0;
  const hFilt = 0x6203 >>> 0;
  const hOut = 0x6204 >>> 0;
  if ((add(g, hA, TYPE_POLY) | 0) !== 0) throw new Error("st add A");
  if ((add(g, hB, TYPE_POLY) | 0) !== 0) throw new Error("st add B");
  if ((add(g, hFilt, TYPE_FLOWER) | 0) !== 0) throw new Error("st add flower");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("st add out");
  if ((connect(g, hA, PORT_MONO, hFilt, PORT_LEFT) | 0) !== 0) throw new Error("st L");
  if ((connect(g, hB, PORT_MONO, hFilt, PORT_RIGHT) | 0) !== 0) throw new Error("st R");
  if ((connect(g, hFilt, PORT_LEFT, hOut, PORT_LEFT) | 0) !== 0) throw new Error("st outL");
  if ((connect(g, hFilt, PORT_RIGHT, hOut, PORT_RIGHT) | 0) !== 0) throw new Error("st outR");
  setParam(g, hA, PARAM_FREQUENCY, 110);
  setParam(g, hA, PARAM_AMPLITUDE, 0.35);
  setParam(g, hB, PARAM_FREQUENCY, 330);
  setParam(g, hB, PARAM_AMPLITUDE, 0.35);
  setParam(g, hFilt, PARAM_FREQUENCY, 0.5);
  setParam(g, hFilt, PARAM_RESONANCE, 0.4);
  setParam(g, hFilt, PARAM_MODE, 0);
  setParam(g, hFilt, PARAM_SHAPE, 0.7);
  if ((compile(g) | 0) !== 0) throw new Error("st compile");
  snap(g);

  let maxDiff = 0;
  let peakL = 0;
  let peakR = 0;
  for (let q = 0; q < 50; q++) {
    process(g, 128);
    const L = view(portPtr(g, hFilt, PORT_LEFT) | 0, 128);
    const R = view(portPtr(g, hFilt, PORT_RIGHT) | 0, 128);
    if (q > 8 && identical(L, R)) {
      throw new Error("stereo flower: L identical to R (expected independent cores)");
    }
    for (let i = 0; i < 128; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(L[i] - R[i]));
      peakL = Math.max(peakL, Math.abs(L[i]));
      peakR = Math.max(peakR, Math.abs(R[i]));
    }
  }
  if (!(peakL > 0.01 && peakR > 0.01 && maxDiff > 1e-4)) {
    throw new Error(`stereo flower peakL=${peakL} peakR=${peakR} maxDiff=${maxDiff}`);
  }
  console.log(
    `stereo flower ok peakL=${peakL.toFixed(4)} peakR=${peakR.toFixed(4)} maxDiff=${maxDiff.toFixed(5)}`
  );
  destroy(g);
}

// --- Chaos is exercised: mono source -> In, outs Left+Right ---
// Chaos > 0 must change the output vs Chaos = 0, and per-lane chaos noise
// must split L/R (stereo_route single source); Chaos = 0 keeps L === R.
function chaosRun(chaos) {
  const g = create() | 0;
  setSr(g, 48000);
  const hOsc = 0x6301 >>> 0;
  const hFilt = 0x6302 >>> 0;
  const hOut = 0x6303 >>> 0;
  if ((add(g, hOsc, TYPE_POLY) | 0) !== 0) throw new Error("chaos add osc");
  if ((add(g, hFilt, TYPE_FLOWER) | 0) !== 0) throw new Error("chaos add flower");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("chaos add out");
  if ((connect(g, hOsc, PORT_MONO, hFilt, PORT_MONO) | 0) !== 0) throw new Error("chaos in");
  if ((connect(g, hFilt, PORT_LEFT, hOut, PORT_LEFT) | 0) !== 0) throw new Error("chaos outL");
  if ((connect(g, hFilt, PORT_RIGHT, hOut, PORT_RIGHT) | 0) !== 0) throw new Error("chaos outR");
  setParam(g, hOsc, PARAM_FREQUENCY, 220);
  setParam(g, hOsc, PARAM_AMPLITUDE, 0.35);
  setParam(g, hFilt, PARAM_FREQUENCY, 0.5);
  setParam(g, hFilt, PARAM_RESONANCE, 0.35);
  setParam(g, hFilt, PARAM_MODE, 0);
  setParam(g, hFilt, PARAM_SHAPE, chaos);
  if ((compile(g) | 0) !== 0) throw new Error("chaos compile");
  snap(g);
  const L = [];
  const R = [];
  for (let q = 0; q < 40; q++) {
    process(g, 128);
    L.push(...view(portPtr(g, hFilt, PORT_LEFT) | 0, 128));
    R.push(...view(portPtr(g, hFilt, PORT_RIGHT) | 0, 128));
  }
  destroy(g);
  return { L, R };
}
{
  const off = chaosRun(0);
  const on = chaosRun(0.6);
  let onVsOff = 0;
  let lrOn = 0;
  let lrOff = 0;
  for (let i = 0; i < off.L.length; i++) {
    onVsOff = Math.max(onVsOff, Math.abs(on.L[i] - off.L[i]));
    lrOn = Math.max(lrOn, Math.abs(on.L[i] - on.R[i]));
    lrOff = Math.max(lrOff, Math.abs(off.L[i] - off.R[i]));
  }
  if (!(onVsOff > 1e-3)) throw new Error(`chaos not exercised: Chaos 0.6 vs 0 maxDiff=${onVsOff}`);
  if (!(lrOn > 1e-3)) throw new Error(`chaos on: mono source L/R should split, maxDiff=${lrOn}`);
  if (lrOff !== 0) throw new Error(`chaos off: mono source L/R should be identical, maxDiff=${lrOff}`);
  console.log(
    `chaos flower ok on-vs-off=${onVsOff.toFixed(5)} L/R chaos on=${lrOn.toFixed(5)} off=${lrOff}`
  );
}

console.log(`smoke_flower_child_mono ok: version=${ver}`);