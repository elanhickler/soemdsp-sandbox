// DSF top-partial click metric: slow pitch sweep at Morph 1, spectral flux in
// the top band. Usage: node scripts/measure_dsf_click.mjs [wasm]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = process.argv[2] || path.join(__dirname, "..", "native_modules", "combined", "soemdsp_combined.wasm");

export async function dsfClickMetric(wasmFile, waveform) {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmFile), { env: { emo_process_block: () => 0 } });
  const e = instance.exports;
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, 48000);
  const hOsc = 0xc701, hOut = 0xc702;
  e.soemdsp_graph_add_node(g, hOsc, 46);
  e.soemdsp_graph_add_node(g, hOut, 6);
  e.soemdsp_graph_connect(g, hOsc, 0, hOut, 0);
  const f0 = 1000, f1 = 1150;
  e.soemdsp_graph_set_param(g, hOsc, 10, f0);
  e.soemdsp_graph_set_param(g, hOsc, 11, waveform);
  e.soemdsp_graph_set_param(g, hOsc, 12, 1);
  e.soemdsp_graph_set_param(g, hOsc, 13, 1);
  e.soemdsp_graph_compile(g);
  e.soemdsp_graph_snap_controls(g);
  for (let q = 0; q < 200; q++) e.soemdsp_graph_process_block(g, 128);
  const blocks = 750; // 2 s sweep
  const y = new Float64Array(blocks * 128);
  for (let q = 0; q < blocks; q++) {
    e.soemdsp_graph_set_param(g, hOsc, 10, f0 * Math.pow(f1 / f0, q / blocks));
    e.soemdsp_graph_process_block(g, 128);
    const b = new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, hOsc, 0) | 0, 128);
    y.set(b, q * 128);
  }
  // Max |third difference| (top partial step shows as a slope-of-slope jump),
  // normalized by its 99th percentile; plus top-partial band spectral flux.
  const N = 1024, hop = 256, kLo = Math.floor(N * 22900 / 48000), kHi = N / 2;
  let prev = null; const flux = []; const energy = [];
  for (let s = 0; s + N <= y.length; s += hop) {
    const mag = [];
    for (let k = kLo; k < kHi; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N);
        const a = -2 * Math.PI * k * n / N;
        re += y[s + n] * w * Math.cos(a); im += y[s + n] * w * Math.sin(a);
      }
      mag.push(Math.hypot(re, im));
    }
    energy.push(mag.reduce((a, b) => a + b * b, 0));
    if (prev) { let f = 0; for (let i = 0; i < mag.length; i++) f += Math.abs(mag[i] - prev[i]); flux.push(f); }
    prev = mag;
  }
  // Top-band energy track: a partial switching on in one sample is a step.
  const steps = [];
  for (let i = 1; i < energy.length; i++) steps.push(Math.abs(energy[i] - energy[i - 1]));
  const meanE = energy.reduce((a, b) => a + b, 0) / energy.length;
  const maxEnergyStep = Math.max(...steps) / meanE;
  const sorted = [...flux].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
    return { maxFlux: sorted[sorted.length - 1], medFlux: med, ratio: sorted[sorted.length - 1] / med, maxEnergyStep, peakEnergy: Math.max(...energy) };
}

if (process.argv[1] && process.argv[1].endsWith("measure_dsf_click.mjs")) {
  for (const [name, w] of [["Saw", 1], ["Square", 2]]) {
    const m = await dsfClickMetric(wasmPath, w);
    console.log(`${name}: top-partial band flux max=${m.maxFlux.toFixed(3)} median=${m.medFlux.toFixed(3)} max/median=${m.ratio.toFixed(2)} peak 22.9-24 kHz band energy=${m.peakEnergy.toFixed(3)}`);
  }
}
