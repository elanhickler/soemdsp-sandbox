// Filter Morph Osc Wave L / Wave R: jacks map to native Left/Right, same voice as Wave.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
const b0 = defs.indexOf("\n  filterMorphOscillator: {\n");
if (b0 < 0) throw new Error("filterMorphOscillator def missing");
const next = /\n  [A-Za-z0-9_]+: \{\n/g;
next.lastIndex = b0 + 2;
const b1 = next.exec(defs).index;
const d = vm.runInNewContext("(" + defs.slice(b0 + "\n  filterMorphOscillator: ".length, defs.lastIndexOf("}", b1) + 1) + ")", {});

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures += 1; console.log(`FAIL ${msg}`); }
};

check(JSON.stringify(d.outputs) === JSON.stringify(["Wave", "Wave L", "Wave R"]), "outputs Wave + Wave L + Wave R");
check(d.outputChannels["Wave L"] === "red" && d.outputChannels["Wave R"] === "blue", "Wave L red / Wave R blue");
check(d.outputAliases.Left === "Wave L" && d.outputAliases.Right === "Wave R", "Left/Right alias to Wave L/R");

const rt = fs.readFileSync(path.join(root, "public", "node-graph-live-runtime.js"), "utf8");
const block = rt.slice(
  rt.indexOf("const nodeGraphLiveWorkletSourceFilesEfficient"),
  rt.indexOf("const nodeGraphLiveWorkletSourceFilesLegacy"),
);
const files = [...block.matchAll(/"\.\/(public\/[^"?]+)/g)].map((m) => m[1]);
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));

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

check(p.mapNativeGraphSrcPortId("Wave", "filterMorphOscillator") === 0, "Wave → Mono bus 0");
check(p.mapNativeGraphSrcPortId("Wave L", "filterMorphOscillator") === 1, "Wave L → Left bus 1");
check(p.mapNativeGraphSrcPortId("Wave R", "filterMorphOscillator") === 2, "Wave R → Right bus 2");
check(
  JSON.stringify(p.nativeGraphPortNames("filterMorphOscillator", 1)) === JSON.stringify(["Wave L"])
  && JSON.stringify(p.nativeGraphPortNames("filterMorphOscillator", 2)) === JSON.stringify(["Wave R"]),
  "nativeGraphPortNames Wave L / Wave R",
);

p.setPlan({
  nodes: [
    { id: "osc", type: "filterMorphOscillator", params: { frequency: 220, dither: 0 } },
    { id: "output", type: "output", params: {} },
  ],
  connections: [
    { sourceNode: "osc", sourcePort: "Wave L", destinationNode: "output", destinationPort: "Left" },
    { sourceNode: "osc", sourcePort: "Wave R", destinationNode: "output", destinationPort: "Right" },
  ],
  modulations: [],
  outputNode: "output",
}, { efficientProduct: true, sampleRate: 48000, planSerial: 1, sessionId: 1 });
check(Boolean(p.nativeGraphCompiled), "native graph compiled");
const ng = p.nativeGraph;
const h = p.fnv1aHash32("osc");
ctx.currentFrame = 0;
p.process([[]], [[new Float32Array(128), new Float32Array(128)]], {});
const rd = (port) => new Float64Array(ng.memory.buffer, ng.soemdsp_graph_node_port_ptr(p.nativeGraphHandle, h, port) | 0, 128);
const W = rd(0), L = rd(1), R = rd(2);
let same = true, peak = 0;
for (let i = 0; i < 128; i += 1) {
  if (W[i] !== L[i] || W[i] !== R[i]) same = false;
  const a = Math.abs(W[i]);
  if (a > peak) peak = a;
}
check(same && peak > 0.1, `Wave L/R match Wave and make sound (peak=${peak.toFixed(3)})`);

console.log(failures ? `FAILED ${failures}` : "smoke_filter_morph_stereo ok");
process.exit(failures ? 1 : 0);
