import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bytes = readFileSync(new URL("../native_modules/edge_detector/edge_detector.wasm", import.meta.url));
const dsp = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
const sampleRate = 44100;
const handle = dsp.soemdsp_edge_detector_create(sampleRate);
assert.ok(handle, "Edge Detector should allocate a native state");

let lastEdge = -2;
let edges = 0;
for (let i = 0; i < sampleRate / 2; ++i) {
  dsp.soemdsp_edge_detector_process(handle, Math.sin(2 * Math.PI * 220 * i / sampleRate));
  const edge = dsp.soemdsp_edge_detector_edge(handle);
  if (edge) {
    assert.ok(i > lastEdge + 1, "Edge must be a one-sample pulse");
    lastEdge = i;
    ++edges;
  }
}
const hz = dsp.soemdsp_edge_detector_frequency(handle);
const confidence = dsp.soemdsp_edge_detector_confidence(handle);
assert.ok(Math.abs(hz - 220) < 3, `220 Hz sine should track near 220 Hz, got ${hz}`);
assert.ok(confidence > 0.8, `clean sine confidence should be high, got ${confidence}`);
assert.ok(edges > 90 && edges < 120, `expected roughly one edge per cycle, got ${edges}`);

for (let i = 0; i < sampleRate / 2; ++i) {
  dsp.soemdsp_edge_detector_process(handle, 0);
}
assert.equal(dsp.soemdsp_edge_detector_frequency(handle), 0, "silence should unlock");
assert.equal(dsp.soemdsp_edge_detector_confidence(handle), 0, "silence should have no confidence");
dsp.soemdsp_edge_detector_destroy(handle);

const combinedBytes = readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url));
const graph = new WebAssembly.Instance(new WebAssembly.Module(combinedBytes), {
  env: { emo_process_block: () => {} },
}).exports;
const circuit = graph.soemdsp_graph_create();
assert.ok(circuit);
assert.equal(graph.soemdsp_graph_add_node(circuit, 1, 40), 0); // Sine Wavetable
assert.equal(graph.soemdsp_graph_add_node(circuit, 2, 240), 0); // Edge Detector
assert.equal(graph.soemdsp_graph_connect(circuit, 1, 0, 2, 0), 0);
assert.equal(graph.soemdsp_graph_set_param(circuit, 1, 10, 220), 0);
assert.equal(graph.soemdsp_graph_compile(circuit), 0);
for (let i = 0; i < 170; ++i) {
  assert.equal(graph.soemdsp_graph_process_block(circuit, 128), 128);
}
const freqPtr = graph.soemdsp_graph_node_port_ptr(circuit, 2, 1);
const confidencePtr = graph.soemdsp_graph_node_port_ptr(circuit, 2, 2);
assert.ok(freqPtr > 0 && confidencePtr > 0, "native graph should expose detector ports");
const graphHz = new Float64Array(graph.memory.buffer, freqPtr, 128)[127];
const graphConfidence = new Float64Array(graph.memory.buffer, confidencePtr, 128)[127];
assert.ok(Math.abs(graphHz - 220) < 3, `graph detector should track its sine input: ${graphHz}`);
assert.ok(graphConfidence > 0.8, `graph confidence should be high: ${graphConfidence}`);
graph.soemdsp_graph_destroy(circuit);
console.log("Edge Detector native smoke passed");
