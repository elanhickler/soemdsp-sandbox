// Headless wasm check for soemdsp_graph_push_midi_hr (high-res CC / pressure / bend).
// Run after scripts/build_native_modules.ps1:
//   node scripts/test_midi_highres.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const bytes = readFileSync(wasmPath);
if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
  throw new Error("wasm missing \\0asm magic (possible CRLF corruption)");
}
const graph = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
  env: { emo_process_block: () => {} },
}).exports;

if (typeof graph.soemdsp_graph_push_midi_hr !== "function") {
  throw new Error("soemdsp_graph_push_midi_hr export missing");
}
const version = graph.soemdsp_graph_version();
if (version < 320) {
  throw new Error("graph_engine version " + version + " is older than 320");
}

const kTypeMidiLag = 242;
const kPortMono = 0;
const kParamAmplitude = 12;
const kParamWaveform = 11;
const kParamMode = 21;
const kParamLfoStyle = 56;
const kParamAttOffset = 71;
const kSmoothModeOff = 3;
const kSmoothTypeNone = 3;
const ID_CC = 2;
const BLOCK = 64;

function setup() {
  const handle = graph.soemdsp_graph_create();
  if (!handle) throw new Error("create failed");
  graph.soemdsp_graph_set_sample_rate(handle, 48000);
  if (graph.soemdsp_graph_add_node(handle, ID_CC, kTypeMidiLag) !== 0) throw new Error("add midiCc");
  graph.soemdsp_graph_set_smooth_mode(handle, ID_CC, kParamAttOffset, kSmoothModeOff);
  graph.soemdsp_graph_set_smooth_type(handle, ID_CC, kParamAttOffset, kSmoothTypeNone);
  graph.soemdsp_graph_set_smooth_time(handle, ID_CC, kParamAttOffset, 0);
  graph.soemdsp_graph_set_param(handle, ID_CC, kParamAmplitude, 1);
  graph.soemdsp_graph_set_param(handle, ID_CC, kParamAttOffset, 0);
  graph.soemdsp_graph_set_param(handle, ID_CC, kParamMode, 0); // Any channel
  graph.soemdsp_graph_set_param(handle, ID_CC, kParamWaveform, 1); // CC 1
  graph.soemdsp_graph_set_param(handle, ID_CC, kParamLfoStyle, 0);
  if (graph.soemdsp_graph_compile(handle) !== 0) throw new Error("compile failed");
  return handle;
}

function outNow(handle) {
  const n = graph.soemdsp_graph_process_block(handle, BLOCK);
  if (n !== BLOCK) throw new Error("process_block " + n);
  const ptr = graph.soemdsp_graph_node_port_ptr(handle, ID_CC, kPortMono);
  if (!ptr) throw new Error("null Out ptr");
  return new Float64Array(graph.memory.buffer, ptr, BLOCK)[BLOCK - 1];
}

function close(actual, expected, label, eps = 1e-9) {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${label}: got ${actual}, expected ${expected}`);
  }
}

const highCc = 0x80000000 / 0xFFFFFFFF;
const midVel = 32768 / 65535;

let handle = setup();
graph.soemdsp_graph_push_midi_hr(handle, 0xB0, 1, highCc);
close(outNow(handle), highCc, "32-bit CC 1 at 0x80000000");

graph.soemdsp_graph_push_midi(handle, 0xB0, 1, 64);
close(outNow(handle), 64 / 128, "7-bit CC 1 = 64 still /128");

graph.soemdsp_graph_push_midi_hr(handle, 0xB0, 2, 0.75); // wrong CC, should not change
close(outNow(handle), 64 / 128, "unmatched high-res CC ignored");

graph.soemdsp_graph_destroy(handle);

handle = setup();
graph.soemdsp_graph_set_param(handle, ID_CC, kParamWaveform, 129); // channel pressure
graph.soemdsp_graph_push_midi_hr(handle, 0xD0, 0, midVel);
close(outNow(handle), midVel, "32-bit channel pressure");
graph.soemdsp_graph_destroy(handle);

handle = setup();
graph.soemdsp_graph_set_param(handle, ID_CC, kParamWaveform, 128); // pitch bend
graph.soemdsp_graph_push_midi_hr(handle, 0xE0, 0, 0);
close(outNow(handle), 0, "32-bit pitch bend center");
graph.soemdsp_graph_push_midi_hr(handle, 0xE0, 0, -1);
close(outNow(handle), -1, "32-bit pitch bend min");
graph.soemdsp_graph_push_midi_hr(handle, 0xE0, 0, 0.25);
close(outNow(handle), 0.25, "32-bit pitch bend +0.25");
graph.soemdsp_graph_destroy(handle);

handle = setup();
graph.soemdsp_graph_set_param(handle, ID_CC, kParamLfoStyle, 1); // Learn
graph.soemdsp_graph_push_midi_hr(handle, 0xB5, 74, 0.333);
// After learn, channel=6, cc=74, offset=0.333, learn off; next process should show 0.333
close(outNow(handle), Math.fround(0.333), "Learn from MIDI 2.0 CC", 1e-7);
graph.soemdsp_graph_destroy(handle);

console.log(`ok midi high-res wasm tests (graph_engine v${version})`);
