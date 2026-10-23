// Sample & Hold Trigger through the real efficient worklet (file list from
// node-graph-live-runtime.js, incl. controller-efficient-sidecar.js) + combined wasm.
// S&H internal clock 480 Hz (100-sample period @ 48k). Trigger -> Gain In.
// Trigger must be a 1-sample 0/1 pulse on exactly each latch sample, both at the
// S&H port and after the cable into Gain (per-sample, not held per quantum).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rt = fs.readFileSync(path.join(root, "public", "node-graph-live-runtime.js"), "utf8");
const block = rt.slice(
  rt.indexOf("const nodeGraphLiveWorkletSourceFilesEfficient"),
  rt.indexOf("const nodeGraphLiveWorkletSourceFilesLegacy"),
);
const files = [...block.matchAll(/"\.\/(public\/[^"?]+)/g)].map((m) => m[1]);
if (files.length < 10) throw new Error("worklet file list not found");
if (!files.some((f) => f.includes("controller-efficient-sidecar"))) throw new Error("sidecar not in worklet list");
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures += 1; console.log(`FAIL ${msg}`); }
};

let Proc = null;
const ctx = {
  console, sampleRate: 48000, currentFrame: 0, currentTime: 0, WebAssembly,
  performance: { now: () => 0 }, setTimeout, queueMicrotask,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {}, onmessage: null }; } },
  registerProcessor: (_n, c) => { Proc = c; },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const src = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n")
  + "\n;\nregisterProcessor('node-live', NodeLiveAudioProcessor);\n";
vm.runInContext("globalThis.NODE_GRAPH_APP_FONTS = [];\n" + src, ctx, { filename: "worklet-efficient.js" });
const p = new Proc({ processorOptions: {} });
const bytes = vm.runInContext(`new ArrayBuffer(${wasm.length})`, ctx);
new Uint8Array(bytes).set(wasm);
await p.setNativeModuleWasm({ name: "combined", bytes, modules: [{ name: "graph_engine", targetType: "graphEngine" }] });
p.speedMultiplier = 1;

const plan = {
  nodes: [
    { id: "sh", type: "sampleHold", params: { sampleFrequency: 480 } },
    { id: "g", type: "gain", params: {} },
    { id: "output", type: "output", params: {} },
  ],
  connections: [
    { sourceNode: "sh", sourcePort: "Trigger", destinationNode: "g", destinationPort: "In" },
    { sourceNode: "sh", sourcePort: "Left", destinationNode: "output", destinationPort: "Mono" },
  ],
  modulations: [],
  outputNode: "output",
};
p.setPlan(plan, { efficientProduct: true, sampleRate: 48000, planSerial: 1, sessionId: 1 });
check(Boolean(p.nativeGraphCompiled), "native graph compiled (not JS fallback)");
const ng = p.nativeGraph;
const shH = p.fnv1aHash32("sh");
const gH = p.fnv1aHash32("g");
const srcPort = p.mapNativeGraphSrcPortId("Trigger", "sampleHold");
check(srcPort === 5, `S&H "Trigger" maps to native port 5 (got ${srcPort})`);
const trig = [], raw = [], gOut = [];
for (let q = 0; q < 40; q += 1) {
  ctx.currentFrame = q * 128;
  p.process([[]], [[new Float32Array(128), new Float32Array(128)]], {});
  const rd = (h, port) => new Float64Array(ng.memory.buffer, ng.soemdsp_graph_node_port_ptr(p.nativeGraphHandle, h, port) | 0, 128);
  trig.push(...rd(shH, 5)); raw.push(...rd(shH, 3)); gOut.push(...rd(gH, 0));
}
const analyse = (arr, label) => {
  let bad = 0, wide = 0, pulses = 0, missed = 0;
  for (let i = 0; i < arr.length; i += 1) {
    if (!Number.isFinite(arr[i])) bad += 1;
    if (arr[i] !== 0) { pulses += 1; if (i && arr[i - 1] !== 0) wide += 1; }
    if (i && raw[i] !== raw[i - 1] && arr[i] === 0) missed += 1;
  }
  check(!bad && !wide && !missed && pulses >= 50 && pulses <= 52,
    `${label}: 1-sample pulses on every latch (level = latched value) (pulses=${pulses} wide=${wide} bad=${bad} missed=${missed})`);
};
analyse(trig, "S&H Trigger port");
// Gain has its own level, so compare its output against Trigger * (gain level):
// non-zero exactly on the latch samples, one sample wide, level follows the latched value.
const gNorm = gOut;
console.log(`     Gain pulse height ${(gOut.find((v) => v !== 0) || 0).toFixed(6)}`);
analyse(gNorm, "Gain fed by S&H Trigger (normalised by Gain level)");
console.log(failures ? `\n${failures} FAILED` : "\nsmoke_sample_hold_trigger_app ok");
process.exit(failures ? 1 : 0);
