import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bytes = readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url));
const graph = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
  env: { emo_process_block: () => {} },
}).exports;

const handle = graph.soemdsp_graph_create();
assert.ok(handle);
for (const [id, type] of [[1, 12], [2, 239], [3, 6]]) {
  assert.equal(graph.soemdsp_graph_add_node(handle, id, type), 0);
}
assert.equal(graph.soemdsp_graph_connect(handle, 1, 0, 2, 16), 0);
assert.equal(graph.soemdsp_graph_connect(handle, 2, 0, 3, 1), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 22, 5), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 30, 4000), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 10, 220), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 21, 0), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 57, 60), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 1, 71, 220), 0);
assert.equal(graph.soemdsp_graph_compile(handle), 0);

function idealRegisterAt(hz) {
  assert.equal(graph.soemdsp_graph_set_param(handle, 1, 71, hz), 0);
  for (let i = 0; i < 100; i++) {
    assert.equal(graph.soemdsp_graph_process_block(handle, 128), 128);
  }
  const ptr = graph.soemdsp_graph_node_port_ptr(handle, 2, 6);
  const targetPtr = graph.soemdsp_graph_node_port_ptr(handle, 2, 7);
  const playedPtr = graph.soemdsp_graph_node_port_ptr(handle, 2, 8);
  const target = new Float64Array(graph.memory.buffer, targetPtr, 1)[0];
  const played = new Float64Array(graph.memory.buffer, playedPtr, 1)[0];
  assert.ok(Math.abs(target - hz) < 1e-6, `target tap must follow f: ${target}`);
  assert.ok(Number.isFinite(played) && played > 0, `played pitch tap: ${played}`);
  return new Float64Array(graph.memory.buffer, ptr, 1)[0];
}

const at220 = idealRegisterAt(220);
const at440 = idealRegisterAt(440);
const expected = (hz) => (4000 / hz - 1) / 31;
assert.ok(Math.abs(at220 - expected(220)) < 1e-6, `f=220: ${at220}`);
assert.ok(Math.abs(at440 - expected(440)) < 1e-6, `f=440: ${at440}`);
assert.ok(Math.abs(at220 - at440) > 0.25, "f must change the Step Register target");
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 30, 116789.16353239963), 0);
const belowGrid = idealRegisterAt(97.99885899543733);
assert.equal(belowGrid, 1, "the reported keyboard note clamps to the last register");

function renderMono(sampleCount) {
  const samples = new Float64Array(sampleCount);
  for (let offset = 0; offset < sampleCount;) {
    const frames = Math.min(128, sampleCount - offset);
    assert.equal(graph.soemdsp_graph_process_block(handle, frames), frames);
    const ptr = graph.soemdsp_graph_node_port_ptr(handle, 2, 0);
    samples.set(new Float64Array(graph.memory.buffer, ptr, frames), offset);
    offset += frames;
  }
  return samples;
}

function binMagnitude(samples, hz) {
  let real = 0;
  let imaginary = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const phase = 2 * Math.PI * hz * i / 44100;
    real += samples[i] * Math.cos(phase);
    imaginary += samples[i] * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) / samples.length;
}

for (const [id, value] of [
  [22, 6], // Bits
  [30, 8000], // Grid Clock
  [57, 0], // Reg Rate: update on cycle wrap
  [21, 0], // Dither
  [11, 0], // Square
  [20, 16], // Amp Bits
  [13, 0], // Antialias Off
]) assert.equal(graph.soemdsp_graph_set_param(handle, 2, id, value), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 1, 71, 8000), 0);
renderMono(4096);
const rawSquare = renderMono(44100);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 13, 1), 0);
renderMono(4096);
const aaSquare = renderMono(44100);
const rawFoldback = binMagnitude(rawSquare, 20100);
const aaFoldback = binMagnitude(aaSquare, 20100);
assert.ok(rawFoldback > 0.05, `raw square alias should be measurable: ${rawFoldback}`);
assert.ok(aaFoldback < rawFoldback * 0.65,
  `antialias should reduce square-wave foldback: raw=${rawFoldback}, aa=${aaFoldback}`);

assert.equal(graph.soemdsp_graph_set_param(handle, 2, 11, 4), 0); // Noise
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 30, 4000), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 1, 71, 4000), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 13, 0), 0);
renderMono(4096);
const rawNoise = renderMono(4096);
assert.ok(rawNoise.every((value) => Math.abs(value) === 1), "raw LFSR should remain two-level");
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 13, 1), 0);
renderMono(4096);
const aaNoise = renderMono(4096);
assert.ok(aaNoise.some((value) => Math.abs(value) > 0.05 && Math.abs(value) < 0.95),
  "antialiased LFSR should soften transitions between bit levels");
for (const wave of [1, 2, 3, 5]) {
  assert.equal(graph.soemdsp_graph_set_param(handle, 2, 11, wave), 0);
  const samples = renderMono(2048);
  assert.ok(samples.every(Number.isFinite), `antialiased waveform ${wave} must stay finite`);
  assert.ok(samples.some((value) => Math.abs(value) > 0.01),
    `antialiased waveform ${wave} must still produce audio`);
}

for (const [id, value] of [
  [54, 2], [50, 1], [460, 0], [21, 0], [71, 0],
  [30, 4410], [53, 7], [20, 16], [13, 0], [57, 0],
]) assert.equal(graph.soemdsp_graph_set_param(handle, 2, id, value), 0);
function captureCycleBits(wave) {
  assert.equal(graph.soemdsp_graph_set_param(handle, 2, 11, wave), 0);
  renderMono(4096);
  const samples = renderMono(2000);
  return Array.from({ length: 200 }, (_, cycle) => samples[cycle * 10 + 5]);
}
function repeatsAfter(values, cycles) {
  return values.every((value, index) => index + cycles >= values.length
    || value === values[index + cycles]);
}
const longNoiseBits = captureCycleBits(4);
const shortPolyBits = captureCycleBits(5);
assert.ok(repeatsAfter(longNoiseBits, 127) && !repeatsAfter(longNoiseBits, 15),
  "7-bit Noise must retain its 127-step pattern");
assert.ok(repeatsAfter(shortPolyBits, 15) && !repeatsAfter(shortPolyBits, 127),
  "Poly4 must have a distinct 15-step pattern, not a shifted copy of Noise");

assert.equal(graph.soemdsp_graph_set_param(handle, 2, 11, 4), 0); // Noise
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 54, 2), 0); // Drawn source
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 50, 1), 0); // One step
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 460, 0), 0); // First register
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 13, 1), 0); // Antialias On
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 30, 30000), 0);
renderMono(4096);
const highNoise = renderMono(512);
const highPeak = Math.max(...highNoise.map(Math.abs));
const playedPtr = graph.soemdsp_graph_node_port_ptr(handle, 2, 8);
const highPlayed = new Float64Array(graph.memory.buffer, playedPtr, 1)[0];
assert.ok(highPlayed > 22050, `drawn register should play above Nyquist: ${highPlayed}`);
assert.ok(highPeak < 1e-9,
  `unrepresentable pitches above Nyquist must be silent with antialias on: peak=${highPeak}, played=${highPlayed}`);

for (const [id, value] of [
  [54, 0], [11, 5], [21, 0], [71, 0], [40, 0], [52, 1], [57, 0],
  [30, 57172.34362306573], [22, 3], [53, 7], [20, 8], [12, 1],
]) assert.equal(graph.soemdsp_graph_set_param(handle, 2, id, value), 0);
assert.equal(graph.soemdsp_graph_set_param(handle, 1, 71, 991.5576278877098), 0);
renderMono(4096);
const threeBitPlayed = new Float64Array(graph.memory.buffer,
  graph.soemdsp_graph_node_port_ptr(handle, 2, 8), 1)[0];
assert.ok(Math.abs(threeBitPlayed - 57172.34362306573 / 8) < 0.01,
  `3 Bits must clamp targets below the eighth Divide register: ${threeBitPlayed}`);
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 22, 8), 0);
renderMono(4096);
const eightBitPlayed = new Float64Array(graph.memory.buffer,
  graph.soemdsp_graph_node_port_ptr(handle, 2, 8), 1)[0];
assert.ok(eightBitPlayed > 900 && eightBitPlayed < 1100,
  `8 Bits must reach the same target without changing the Poly noise algorithm: ${eightBitPlayed}`);

assert.equal(graph.soemdsp_graph_set_param(handle, 2, 71, -1), 0); // Grid Offset
assert.equal(graph.soemdsp_graph_set_param(handle, 2, 30, 4000), 0);
for (const grid of [0, 1, 2]) {
  assert.equal(graph.soemdsp_graph_set_param(handle, 2, 21, grid), 0);
  const output = renderMono(512);
  const played = new Float64Array(graph.memory.buffer,
    graph.soemdsp_graph_node_port_ptr(handle, 2, 8), 1)[0];
  assert.ok(output.every(Number.isFinite) && Number.isFinite(played) && played > 0,
    `Grid Offset -1 must keep grid ${grid} finite: played=${played}`);
}
graph.soemdsp_graph_destroy(handle);

console.log("step register native smoke: f routing, antialiasing, pitch range, and distinct Poly4 passed");
