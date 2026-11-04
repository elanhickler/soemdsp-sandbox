// Shared DSF Sawmorph must be live and finite in every requested voice bank.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const must = (name) => {
  if (typeof e[name] !== "function") throw new Error(`missing ${name}`);
  return e[name];
};
const f64 = () => new Float64Array(e.memory.buffer);

function stats(samples) {
  let peak = 0;
  let sum = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error("non-finite Sawmorph sample");
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
    sum += sample * sample;
  }
  return { peak, rms: Math.sqrt(sum / samples.length) };
}

function differs(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function captureHyperpluck(morph) {
  const create = must("soemdsp_hyperpluck_create");
  const destroy = must("soemdsp_hyperpluck_destroy");
  const process = must("soemdsp_hyperpluck_process_block");
  const ptr = must("soemdsp_hyperpluck_block_output_left_ptr");
  const handle = create() | 0;
  if (!handle) throw new Error("Hyperpluck create failed");
  process(handle, 220, 44100, 0, 1, 1, 0, 0, 6, 20000, 1, 0, 0, morph, 2048);
  process(handle, 220, 44100, 0, 1, 1, 0, 0, 6, 20000, 0, 0, 0, morph, 2048);
  const offset = ptr(handle) >> 3;
  const samples = Array.from(f64().subarray(offset, offset + 2048));
  destroy(handle);
  return samples;
}

function captureHypersaw(morph) {
  const create = must("soemdsp_hypersaw2_create");
  const destroy = must("soemdsp_hypersaw2_destroy");
  const sample = must("soemdsp_hypersaw2_sample");
  const left = must("soemdsp_hypersaw2_left");
  const handle = create() | 0;
  if (!handle) throw new Error("Hypersaw create failed");
  const samples = [];
  for (let i = 0; i < 4096; i += 1) {
    sample(handle, 220, 44100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 1, 0, 7, morph, 1, 0, 0);
    if (i >= 2048) samples.push(left(handle));
  }
  destroy(handle);
  return samples;
}

function captureRobin(morph) {
  const create = must("soemdsp_robin_supersaw_create");
  const destroy = must("soemdsp_robin_supersaw_destroy");
  const process = must("soemdsp_robin_supersaw_process_block");
  const ptr = must("soemdsp_robin_supersaw_block_output_left_ptr");
  const handle = create() | 0;
  if (!handle) throw new Error("Robin Supersaw create failed");
  process(handle, 220, 44100, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0, 20000, 1, 0, 7, morph, 0, 2048);
  process(handle, 220, 44100, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0, 20000, 0, 0, 7, morph, 0, 2048);
  const offset = ptr(handle) >> 3;
  const samples = Array.from(f64().subarray(offset, offset + 2048));
  destroy(handle);
  return samples;
}

const families = [
  ["Hyperpluck", captureHyperpluck],
  ["Hypersaw", captureHypersaw],
  ["Robin Supersaw", captureRobin],
];
for (const [name, capture] of families) {
  const sine = capture(0);
  const middle = capture(0.5);
  const saw = capture(1);
  const sineStats = stats(sine);
  const middleStats = stats(middle);
  const sawStats = stats(saw);
  if (!(sineStats.peak > 0.01 && middleStats.peak > 0.01 && sawStats.peak > 0.01)) {
    throw new Error(`${name} Sawmorph is silent at one or more Morph values`);
  }
  const endpointDifference = differs(sine, saw);
  const midpointDifference = differs(sine, middle);
  if (!(endpointDifference > 0.02 && midpointDifference > 0.002)) {
    throw new Error(
      `${name} Sawmorph endpoints or midpoint do not differ: ${endpointDifference}, ${midpointDifference}`
    );
  }
  console.log(`${name} Sawmorph OK`, { sine: sineStats, middle: middleStats, saw: sawStats });
}
