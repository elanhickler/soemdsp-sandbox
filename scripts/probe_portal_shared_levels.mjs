import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const hash = (name) => {
  let value = 2166136261 >>> 0;
  for (const char of name) {
    value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  }
  return value >>> 0;
};

function run(volumeDb) {
  const graph = e.soemdsp_graph_create();
  assert.ok(graph, "graph created");
  const inlet = hash("portal-in");
  const outlet = hash("portal-out");
  try {
    e.soemdsp_graph_set_sample_rate(graph, 48000);
    assert.ok(e.soemdsp_graph_add_node(graph, inlet, 131) >= 0);
    assert.ok(e.soemdsp_graph_add_node(graph, outlet, 130) >= 0);
    assert.ok(e.soemdsp_graph_connect(graph, inlet, 1, outlet, 1) >= 0);
    assert.ok(e.soemdsp_graph_compile(graph) >= 0);
    e.soemdsp_graph_set_param(graph, outlet, 0, volumeDb);
    e.soemdsp_graph_snap_controls(graph);
    const input = new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(graph, inlet, 1), 128);
    input.fill(0.5);
    e.soemdsp_graph_process_block(graph, 128);
    const inSample = new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(graph, inlet, 1), 128)[0];
    const thruSample = new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(graph, outlet, 1), 128)[0];
    const speakerSample = new Float64Array(e.memory.buffer, e.soemdsp_graph_block_output_left_ptr(graph), 128)[0];
    return { inSample, thruSample, speakerSample };
  } finally {
    e.soemdsp_graph_destroy(graph);
  }
}

const unity = run(0);
const quiet = run(-6);
assert.ok(Math.abs(unity.inSample - 0.5) < 1e-6, `portal input: ${unity.inSample}`);
assert.ok(Math.abs(unity.thruSample - quiet.thruSample) < 1e-6, "portal thru stays at unity");
assert.ok(quiet.speakerSample > 0, "portal reaches speaker bus");
assert.ok(Math.abs(quiet.speakerSample / unity.speakerSample - 10 ** (-6 / 20)) < 0.01,
  `portal bus responds to shared volume: ${quiet.speakerSample} / ${unity.speakerSample}`);
console.log("portal shared levels ok", { unity, quiet });
