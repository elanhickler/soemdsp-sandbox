// Logistic Map Clock + Trigger. Native: x[n+1] = R x (1-x); one iteration per
// Clock rising edge (prev <= 0 < now) when wired, Frequency phase clock when not.
// Graph: Clock jack -> kPortTrigger, Trigger out on Right, Out on Mono/Left.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmBytes = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
// Stub every host import (e.g. env.emo_process_block); this smoke never calls them.
const imports = {};
for (const imp of WebAssembly.Module.imports(new WebAssembly.Module(wasmBytes))) {
  if (imp.kind === "function") (imports[imp.module] ||= {})[imp.name] = () => 0;
}
const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing ${n}`); return e[n]; };
const create = must("soemdsp_logistic_map_create"), destroy = must("soemdsp_logistic_map_destroy");
const sample = must("soemdsp_logistic_map_sample"), trig = must("soemdsp_logistic_map_trigger");
if ((must("soemdsp_logistic_map_version")() | 0) < 4) throw new Error("logistic_map version < 4");
const SR = 48000, R = 3.7;

// 1) Native, wired: iterate exactly on edge samples, value = R x (1-x) of the previous.
{
  const h = create();
  let x = (sample(h, 0, 0, R, 5, 0, 1, SR, 0, 1) + 1) / 2; // first call seeds x0, no edge
  if (trig(h) !== 0) throw new Error("trigger on seed sample");
  const clock = []; for (let i = 0; i < 2000; i++) clock.push(i % 37 === 3 || i % 37 === 4 ? 1 : (i % 101 === 50 ? 0.5 : -0.2));
  let prev = -0.2, edges = 0;
  for (let i = 0; i < clock.length; i++) {
    const edge = prev <= 0 && clock[i] > 0; prev = clock[i];
    const y = sample(h, 0, 12345 /* ignored */, R, 5, 0, 1, SR, clock[i], 1);
    if (edge) { x = Math.min(1, Math.max(0, R * x * (1 - x))); edges++; }
    if (trig(h) !== (edge ? 1 : 0)) throw new Error(`trigger mismatch at ${i}`);
    if (Math.abs((y + 1) / 2 - x) > 1e-12) throw new Error(`value mismatch at ${i}: ${(y + 1) / 2} vs ${x}`);
  }
  destroy(h);
  console.log(`ok wired Clock: ${edges} edges = ${edges} iterations, each on its edge sample, value = R x (1-x), Frequency ignored`);
}
// 2) Native, unwired: Frequency F iterations per second.
for (const F of [10, 440, 3000]) {
  const h = create(); let n = 0;
  sample(h, 0, F, R, 1, 0, 1, SR, 0, 0);
  for (let i = 0; i < SR; i++) { sample(h, 0, F, R, 1, 0, 1, SR, 0, 0); n += trig(h); }
  destroy(h);
  if (Math.abs(n - F) > 1) throw new Error(`unwired F ${F}: ${n} iterations/s`);
}
console.log("ok unwired: Frequency 10/440/3000 Hz = that many iterations (trigger samples) per second");

// 3) Graph: sine clock into the Clock jack, Trigger on Right.
{
  const g = e.soemdsp_graph_create() | 0; e.soemdsp_graph_set_sample_rate(g, SR);
  const S = (h, i, v) => e.soemdsp_graph_set_param(g, h, i, v);
  e.soemdsp_graph_add_node(g, 1, 79); e.soemdsp_graph_add_node(g, 2, 1);
  S(2, 10, 100); S(2, 11, 4); S(2, 12, 1); S(1, 10, 7); S(1, 13, R);
  if (e.soemdsp_graph_connect(g, 2, 0, 1, 20) | 0) throw new Error("connect clock");
  e.soemdsp_graph_compile(g); e.soemdsp_graph_snap_controls(g);
  let n = 0, changes = 0, last = null;
  for (let b = 0; b < SR / 128; b++) {
    e.soemdsp_graph_process_block(g, 128);
    const tr = new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, 1, 2) | 0, 128).slice();
    const out = new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, 1, 0) | 0, 128).slice();
    for (let i = 0; i < 128; i++) { n += tr[i]; if (last !== null && out[i] !== last) { changes++; if (tr[i] !== 1) throw new Error("Out changed without Trigger"); } last = out[i]; }
  }
  e.soemdsp_graph_destroy(g);
  if (Math.abs(n - 100) > 1) throw new Error(`graph: ${n} triggers for a 100 Hz clock (Frequency 7 must be ignored)`);
  console.log(`ok graph: 100 Hz clock -> ${n} triggers on Right, Out changes only on trigger samples (${changes})`);
}
console.log("logistic map clock smoke ok");
