// Headless: dsfOscillator → output (440 Hz saw).
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
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const version = must("soemdsp_graph_version");

const TYPE_DSF = 46;
const TYPE_OUT = 6;
const PORT_MONO = 0;
const PARAM_FREQUENCY = 10;
const PARAM_WAVEFORM = 11;
const PARAM_AMPLITUDE = 12;
const PARAM_SHAPE = 13; // morph

function view(ptr, n) {
  return new Float64Array(mem.buffer, ptr, n);
}

{
  const g = create() | 0;
  setSr(g, 48000);
  const hOsc = 0xc601 >>> 0;
  const hOut = 0xc602 >>> 0;
  if ((add(g, hOsc, TYPE_DSF) | 0) !== 0) throw new Error("dsfOscillator add");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("out add");
  if ((connect(g, hOsc, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error("conn");
  setParam(g, hOsc, PARAM_FREQUENCY, 440);
  setParam(g, hOsc, PARAM_WAVEFORM, 1); // saw
  setParam(g, hOsc, PARAM_SHAPE, 1);
  setParam(g, hOsc, PARAM_AMPLITUDE, 1);
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);

  let peak = 0;
  let sumSq = 0;
  let n = 0;
  // DSF leaky integrators need settle time.
  for (let q = 0; q < 120; q++) {
    process(g, 128);
    const buf = view(portPtr(g, hOsc, PORT_MONO) | 0, 128);
    for (let i = 0; i < 128; i++) {
      const y = buf[i];
      const a = Math.abs(y);
      if (a > peak) peak = a;
      sumSq += y * y;
      n += 1;
    }
  }
  const rms = Math.sqrt(sumSq / n);
  if (!(peak > 0.05 && peak <= 1.6)) throw new Error(`dsfOscillator peak=${peak}`);
  if (!(rms > 0.01)) throw new Error(`dsfOscillator rms=${rms}`);
  console.log(`dsfOscillator ok peak=${peak.toFixed(4)} rms=${rms.toFixed(4)}`);
}

// Morph 0 is a sine (original SineSaw); morph 1 is a saw (has even partials).
{
  const SR = 48000, N = 8192;
  async function renderMorph(morph) {
    const g = create() | 0;
    setSr(g, SR);
    const hOsc = 0xc611 >>> 0, hOut = 0xc612 >>> 0;
    if ((add(g, hOsc, TYPE_DSF) | 0) !== 0) throw new Error("dsf morph add");
    if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("dsf morph out");
    if ((connect(g, hOsc, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error("dsf morph conn");
    setParam(g, hOsc, PARAM_FREQUENCY, 375);
    setParam(g, hOsc, PARAM_WAVEFORM, 1);
    setParam(g, hOsc, PARAM_SHAPE, morph);
    setParam(g, hOsc, PARAM_AMPLITUDE, 1);
    if ((compile(g) | 0) !== 0) throw new Error("dsf morph compile");
    snap(g);
    for (let q = 0; q < 80; q++) process(g, 128);
    const y = new Float64Array(N);
    for (let o = 0; o < N; o += 128) {
      process(g, 128);
      y.set(view(portPtr(g, hOsc, PORT_MONO) | 0, 128), o);
    }
    return y;
  }
  function corrSine(y) {
    const f = 375, w = 2 * Math.PI * f / SR;
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < y.length; i++) {
      const s = Math.sin(w * i);
      xy += y[i] * s; xx += s * s; yy += y[i] * y[i];
    }
    return xy / Math.sqrt(xx * yy);
  }
  const y0 = await renderMorph(0);
  const y1 = await renderMorph(1);
  const c0 = corrSine(y0);
  const c1 = corrSine(y1);
  if (!(Math.abs(c0) > 0.97)) throw new Error(`dsf morph 0 should be sine, corr=${c0}`);
  if (!(Math.abs(c1) < 0.85)) throw new Error(`dsf morph 1 should not be sine, corr=${c1}`);
  console.log(`dsf sine-saw morph ok: morph0 corr=${c0.toFixed(4)} morph1 corr=${c1.toFixed(4)}`);
}

// Top partial fades with pitch: flux in the last 1 kHz before Nyquist stays
// smooth (max/median). Absolute top-band energy is high on a bright saw —
// that band is supposed to have the last harmonic. A step-click spikes the ratio.
{
  const { dsfClickMetric } = await import("./measure_dsf_click.mjs");
  for (const [name, w] of [["Saw", 1], ["Square", 2]]) {
    const m = await dsfClickMetric(wasmPath, w);
    if (!(m.ratio < 8.0)) throw new Error(`dsf ${name} sweep click: top-band flux max/median ${m.ratio}`);
    console.log(`dsf ${name} sweep ok: flux max/median=${m.ratio.toFixed(2)} peakEnergy=${m.peakEnergy.toFixed(3)}`);
  }
}

{
  const TYPE_DSF_MORPH = 232;
  const g = create() | 0;
  setSr(g, 48000);
  const hOsc = 0xc621 >>> 0;
  const hOut = 0xc622 >>> 0;
  if ((add(g, hOsc, TYPE_DSF_MORPH) | 0) !== 0) throw new Error("dsfMorphingOsc add");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("dsfMorphingOsc out");
  if ((connect(g, hOsc, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error("dsfMorphingOsc conn");
  setParam(g, hOsc, PARAM_FREQUENCY, 440);
  setParam(g, hOsc, PARAM_WAVEFORM, 1);
  setParam(g, hOsc, PARAM_SHAPE, 1);
  setParam(g, hOsc, PARAM_AMPLITUDE, 1);
  if ((compile(g) | 0) !== 0) throw new Error("dsfMorphingOsc compile");
  snap(g);
  let peak = 0;
  for (let q = 0; q < 40; q++) {
    process(g, 128);
    const buf = view(portPtr(g, hOsc, PORT_MONO) | 0, 128);
    for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(buf[i]));
  }
  if (!(peak > 0.05 && peak <= 1.6)) throw new Error(`dsfMorphingOsc peak=${peak}`);
  console.log(`dsfMorphingOsc ok peak=${peak.toFixed(4)}`);
}

{
  const TYPE_DSF_MORPH = 232;
  const SR = 48000, N = 8192, f = 375;
  const { instance: inst2 } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } });
  const e2 = inst2.exports;
  const g = e2.soemdsp_graph_create() | 0;
  e2.soemdsp_graph_set_sample_rate(g, SR);
  const hOsc = 0xc631 >>> 0, hOut = 0xc632 >>> 0;
  if ((e2.soemdsp_graph_add_node(g, hOsc, TYPE_DSF_MORPH) | 0) !== 0) throw new Error("dsfMorphingOsc sine add");
  if ((e2.soemdsp_graph_add_node(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("dsfMorphingOsc sine out");
  if ((e2.soemdsp_graph_connect(g, hOsc, PORT_MONO, hOut, PORT_MONO) | 0) !== 0) throw new Error("dsfMorphingOsc sine conn");
  e2.soemdsp_graph_set_param(g, hOsc, PARAM_FREQUENCY, f);
  e2.soemdsp_graph_set_param(g, hOsc, PARAM_SHAPE, 0);
  e2.soemdsp_graph_set_param(g, hOsc, PARAM_AMPLITUDE, 1);
  if ((e2.soemdsp_graph_compile(g) | 0) !== 0) throw new Error("dsfMorphingOsc sine compile");
  e2.soemdsp_graph_snap_controls(g);
  for (let q = 0; q < 80; q++) e2.soemdsp_graph_process_block(g, 128);
  const y = new Float64Array(N);
  for (let o = 0; o < N; o += 128) {
    e2.soemdsp_graph_process_block(g, 128);
    y.set(new Float64Array(e2.memory.buffer, e2.soemdsp_graph_node_port_ptr(g, hOsc, PORT_MONO) | 0, 128), o);
  }
  const w = 2 * Math.PI * f / SR;
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < y.length; i++) {
    const s = Math.sin(w * i);
    xy += y[i] * s; xx += s * s; yy += y[i] * y[i];
  }
  const c0 = xy / Math.sqrt(xx * yy);
  if (!(Math.abs(c0) > 0.97)) throw new Error(`dsfMorphingOsc morph 0 should be sine, corr=${c0}`);
  console.log(`dsfMorphingOsc morph 0 sine corr=${c0.toFixed(4)}`);
}

if ((version() | 0) < 248) throw new Error(`graph version ${version()} expected >= 248`);
console.log(`smoke_graph_dsf_oscillator ok: version=${version() | 0}`);
