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
const leftPort = p.mapNativeGraphSrcPortId("Left", "sampleHold");
const rawPort = p.mapNativeGraphSrcPortId("Left Raw", "sampleHold");
let serial = 1;
function run(params) {
  serial += 1;
  p.setPlan({
    nodes: [
      { id: "sh", type: "sampleHold", params: { sampleFrequency: 480, ...params } },
      { id: "output", type: "output", params: {} },
    ],
    connections: [{ sourceNode: "sh", sourcePort: "Left", destinationNode: "output", destinationPort: "Mono" }],
    modulations: [], outputNode: "output",
  }, { efficientProduct: true, sampleRate: 48000, planSerial: serial, sessionId: 1 });
  const ng = p.nativeGraph;
  const h = p.fnv1aHash32("sh");
  const T = [], L = [], R = [];
  for (let q = 0; q < 40; q += 1) {
    ctx.currentFrame = q * 128;
    p.process([[]], [[new Float32Array(128), new Float32Array(128)]], {});
    const rd = (port) => new Float64Array(ng.memory.buffer, ng.soemdsp_graph_node_port_ptr(p.nativeGraphHandle, h, port) | 0, 128);
    T.push(...rd(5)); L.push(...rd(leftPort)); R.push(...rd(rawPort));
  }
  return { T, L, R };
}
const fires = (R) => { const f = []; for (let i = 1; i < R.length; i += 1) if (R[i] !== R[i - 1]) f.push(i); return f; };
{
  const { T, L, R } = run({ polarity: 0 });
  check(Boolean(p.nativeGraphCompiled), "native graph compiled");
  const f = fires(R);
  const bad = f.filter((i) => T[i] !== L[i]).length;
  const off = T.filter((v, i) => v !== 0 && !f.includes(i)).length;
  check(f.length >= 50 && !bad && !off, `Bi: Trigger level = latched Left value on each of ${f.length} latches, 0 elsewhere (bad=${bad} stray=${off})`);
  check(f.some((i) => T[i] < 0) && f.some((i) => T[i] > 0), "Bi: Trigger levels are signed (both negative and positive)");
}
{
  const { T, L, R } = run({ polarity: 1, amplitude: 0.5 });
  const f = fires(R);
  check(f.length >= 50 && f.every((i) => T[i] >= 0 && T[i] === L[i]), "Uni + Amp 0.5: Trigger level = Left out (all >= 0)");
}
{
  const { T, R } = run({ polarity: 0, interpolate: 0, smoothing: 1 });
  const f = []; T.forEach((v, i) => { if (v !== 0) f.push(i); });
  // Glide: Left Raw only reaches the latched value at segment end; Trigger carries that target at once.
  const bad = f.slice(0, -1).filter((i, k) => Math.abs(T[i] - R[f[k + 1] - 1]) > 1e-9).length;
  check(f.length >= 40 && !bad, `Smoothing 1: Trigger level = glide target (peak), not the in-flight value (bad=${bad})`);
}
// Definitions: sweep default + Interpolate order / legacy remap.
// Evaluate just the sampleHold definition block (the whole file needs the app's globals).
const defSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
const b0 = defSrc.indexOf("\n  sampleHold: {\n");
const next = /\n  [A-Za-z0-9_]+: \{\n/g; next.lastIndex = b0 + 2;
const b1 = next.exec(defSrc).index;
const d = vm.runInNewContext("(" + defSrc.slice(b0 + "\n  sampleHold: ".length, defSrc.lastIndexOf("}", b1) + 1) + ")", {});
const dctx = { console }; dctx.globalThis = dctx; vm.createContext(dctx);
dctx.__sh = d;
vm.runInContext("var nodeGraphModuleDefinitions = { sampleHold: __sh };\n" + fs.readFileSync(path.join(root, "public", "node-graph-patch-core.js"), "utf8"), dctx);
check(d.defaultDisplaySettings.historySeconds === 8, "S&H display sweep (History) defaults to 8 s");
const ip = d.parameters.find((x) => x.key === "interpolate");
check(JSON.stringify(ip.choices) === JSON.stringify(["Hold", "Linear", "Smoothstep", "Quadratic Out", "Quadratic In", "Cosine"]), "Interpolate list: Hold first");
check(JSON.stringify(ip.choiceIds) === "[5,0,1,2,3,4]" && ip.defaultValue === "linear", "native ids unchanged, default Linear");
// Interp overflowed its choice buttons, so the face shows it as a horizontal slider cell (9c19ccb9).
const face = d.face.find((r) => r.kind === "cells" && r.params?.some((cell) => cell[0] === "interpolate"));
check(face?.horizontal === true, "face shows Interp as a horizontal slider cell");
const norm = (v) => vm.runInContext(`normalizeNodeGraphPatchParameter("sampleHold", "interpolate", ${JSON.stringify(v)})`, dctx);
check(norm("5") === "hold" && norm(0) === "linear" && norm("4") === "cosine" && norm("quadIn") === "quadIn", "legacy numeric saves remap to the same curve");
console.log(failures ? `\n${failures} FAILED` : "\nsmoke_sample_hold_trigger_level ok");
process.exit(failures ? 1 : 0);
