// Graph block output buffers: Right must be silent when nothing feeds the
// Out node's Right side, and the block is capped at max_block_frames (128).
// Reading past that runs into engine state (busEarGain = 1.0 at R[129]).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const N = e.soemdsp_graph_max_block_frames() | 0;
if (N !== 128) throw new Error(`max_block_frames=${N}, expected 128`);
const peak = (p) => { const v = new Float64Array(e.memory.buffer, p | 0, N); let a = 0; for (const x of v) a = Math.max(a, Math.abs(x)); return a; };
function run(label, wire, expectL, expectR) {
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, 48000);
  const O = 0x5001, P = 0x5002;
  e.soemdsp_graph_add_node(g, O, 6);
  e.soemdsp_graph_add_node(g, P, 1);
  e.soemdsp_graph_set_param(g, P, 10, 220);
  e.soemdsp_graph_set_param(g, P, 12, 0.5);
  if (wire) wire(g, P, O);
  if ((e.soemdsp_graph_compile(g) | 0) !== 0) throw new Error("compile");
  e.soemdsp_graph_snap_controls(g);
  let rc = 0;
  for (let i = 0; i < 20; i++) rc = e.soemdsp_graph_process_block(g, 256) | 0;
  if (rc !== N) throw new Error(`${label}: process_block(256) returned ${rc}, expected clamp to ${N}`);
  const l = peak(e.soemdsp_graph_block_output_left_ptr(g));
  const r = peak(e.soemdsp_graph_block_output_right_ptr(g));
  e.soemdsp_graph_destroy(g);
  const ok = (p, want) => want ? p > 0.01 && p < 2 : p < 1e-12;
  if (!ok(l, expectL) || !ok(r, expectR)) throw new Error(`${label}: L=${l} R=${r}`);
  console.log(`${label} ok L=${l.toFixed(4)} R=${r.toFixed(4)}`);
}
run("nothing connected", null, false, false);
run("Left only", (g, P, O) => e.soemdsp_graph_connect(g, P, 0, O, 1), true, false);
run("Right only", (g, P, O) => e.soemdsp_graph_connect(g, P, 0, O, 2), false, true);
console.log("smoke_graph_block_output_right ok");
