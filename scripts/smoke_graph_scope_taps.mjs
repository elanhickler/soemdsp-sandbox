// Scope taps: a PolyBLEP shape out read only by a scope (1D Plot on Saw) has
// no native Conn, so the tap mask left it silent. soemdsp_graph_set_node_scope_taps
// marks the watched ports; the shape must then be computed, and clearing the
// mark must silence it again (unused taps stay off).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")),
  { env: { emo_process_block: () => 0 } },
);
const E = instance.exports;
const SR = 48000, TYPE_BLEP = 1, TYPE_OUT = 6;
const PORT = { MONO: 0, LEFT: 1, SAW: 3, TRI: 6, SINE: 7 };
const fail = (m) => { throw new Error(m); };
if (typeof E.soemdsp_graph_set_node_scope_taps !== "function") fail("soemdsp_graph_set_node_scope_taps not exported");
const g = E.soemdsp_graph_create() | 0;
E.soemdsp_graph_set_sample_rate(g, SR);
const hB = 0x7201, hO = 0x7202;
if (E.soemdsp_graph_add_node(g, hB, TYPE_BLEP) | 0) fail("blep add");
if (E.soemdsp_graph_add_node(g, hO, TYPE_OUT) | 0) fail("out add");
// Only Sine is a real cable; Saw / Tri are scope-only.
if (E.soemdsp_graph_connect(g, hB, PORT.SINE, hO, PORT.LEFT) | 0) fail("sine->out");
E.soemdsp_graph_set_param(g, hB, 10, 220);
if (E.soemdsp_graph_compile(g) | 0) fail("compile");
E.soemdsp_graph_snap_controls(g);
const peak = (port) => {
  let m = 0;
  for (let q = 0; q < 40; q++) {
    E.soemdsp_graph_process_block(g, 128);
    const b = new Float64Array(E.memory.buffer, E.soemdsp_graph_node_port_ptr(g, hB, port) | 0, 128);
    for (let i = 0; i < 128; i++) m = Math.max(m, Math.abs(b[i]));
  }
  return m;
};
if (!(peak(PORT.SINE) > 0.5)) fail("Sine (real cable) silent");
if (peak(PORT.SAW) !== 0) fail("Saw computed with no cable and no scope tap (mask should keep it off)");
E.soemdsp_graph_set_node_scope_taps(g, hB, (1 << PORT.SAW) | (1 << PORT.TRI));
const saw = peak(PORT.SAW);
const tri = peak(PORT.TRI);
if (!(saw > 0.5)) fail(`scope-tapped Saw silent (peak ${saw})`);
if (!(tri > 0.5)) fail(`scope-tapped Tri silent (peak ${tri})`);
console.log(`ok scope-tapped Saw peak ${saw.toFixed(3)}, Tri peak ${tri.toFixed(3)}`);
E.soemdsp_graph_set_node_scope_taps(g, hB, 0);
peak(PORT.SAW); // buffers hold the last computed block until the next
const after = peak(PORT.SAW);
if (after !== 0) fail(`Saw still computed after scope tap cleared (peak ${after})`);
console.log("ok clearing the scope tap turns Saw back off");
E.soemdsp_graph_destroy(g);
console.log("ok scope taps");
