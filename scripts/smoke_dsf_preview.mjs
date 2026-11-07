import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules/dsf_oscillator/dsf_oscillator.wasm");
const sourcePath = path.join(root, "public/node-graph-dsf-oscillator.js");
const wasm = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasmPath)), {}).exports;
const context = vm.createContext({
  wasm,
  WebAssembly,
  Float64Array,
  Math,
  Number,
  fetch: undefined,
  nodeGraphFiniteNumber: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
  nodeGraphDsfSampleRate: () => 48000,
});
vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context);
vm.runInContext("nodeGraphDsfOscillatorWasm.exports = wasm", context);

for (const frequency of [110, 440, 5000, 10000]) {
  context.frequency = frequency;
  const params = "{frequency, waveform:1, morph:1, pulseWidth:0.5, blend:0, partials:64}";
  const cycle = vm.runInContext(`nodeGraphDsfOscillatorPreviewCycle(${params}, 2048)`, context);
  const silentAmplitude = vm.runInContext(`nodeGraphDsfOscillatorPreviewCycle({...${params}, amplitude:0}, 2048)`, context);
  const peak = Math.max(...cycle.map(Math.abs));
  const seam = Math.abs(cycle[0] - cycle.at(-1));
  assert.ok(peak > 0.25, `${frequency} Hz preview is blank`);
  assert.ok(seam < 0.01, `${frequency} Hz preview has a phase seam: ${seam}`);
  assert.deepEqual(Array.from(silentAmplitude), Array.from(cycle), "Amplitude changed the face preview");
  console.log(`${frequency} Hz: peak ${peak.toFixed(3)}, seam ${seam.toFixed(5)}`);
}
