// Argi's chain: Keyboard Gate -> Up/Down Slew In -> Slew Out MOD into the
// Amplitude slider of Softpop Oscillator / Softpop Filter, run through the real
// efficient worklet (blob file list from node-graph-live-runtime.js) and the
// combined wasm. Gate, Slew Out and the Softpop gain must be per-sample:
//  - the Keyboard Gate feeder is a per-sample block (not a per-quantum Bias),
//  - Slew starts at the exact event sample, then moves every sample (no
//    128-sample holds while it ramps),
//  - Softpop output = (unmodulated render) * Slew Out, sample for sample.
// Regression: controller-efficient-sidecar.js used to redefine
// efficientModSourceIsSampleBlock / readEfficientModSourceBlock, replacing
// the keyboard per-sample version, so Gate reached Slew as a block-rate step.
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
const wasm = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures += 1; console.log(`FAIL ${msg}`); }
};

async function makeProcessor() {
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
  return { p, ctx };
}

const QUANTA = 48;
const ON = 8 * 128 + 37;
const OFF = 30 * 128 + 90;

async function run(type, withChain) {
  const { p, ctx } = await makeProcessor();
  const nodes = [
    { id: "kb", type: "keyboard", params: {} },
    { id: "slew", type: "slewLimiter", params: { upTime: 0.05, downTime: 0.05 } },
    { id: "sp", type, params: { frequency: 440, amplitude: withChain ? 0 : 1 } },
    { id: "output", type: "output", params: {} },
  ];
  const plan = {
    nodes,
    connections: [
      { sourceNode: "kb", sourcePort: "Gate", destinationNode: "slew", destinationPort: "In" },
      { sourceNode: "sp", sourcePort: "Mono", destinationNode: "output", destinationPort: "Mono" },
    ],
    modulations: withChain
      ? [{ sourceNode: "slew", sourcePort: "Out", destinationNode: "sp", destinationParam: "amplitude" }]
      : [],
    outputNode: "output",
  };
  p.setPlan(plan, { efficientProduct: true, sampleRate: 48000, planSerial: 1, sessionId: 1 });
  if (!p.nativeGraphCompiled) throw new Error(`${type}: native graph did not compile`);
  const ng = p.nativeGraph;
  const slewHash = p.fnv1aHash32("slew");
  const spHash = p.fnv1aHash32("sp");
  const slew = [], y = [];
  for (let q = 0; q < QUANTA; q += 1) {
    ctx.currentFrame = q * 128;
    if (q === Math.floor(ON / 128)) p.setKeyboardModuleSignal("kb", { gate: 1, velocity: 1, rawMidi: 60, gatePulse: 1 }, ON);
    if (q === Math.floor(OFF / 128)) p.setKeyboardModuleSignal("kb", { gate: 0, velocity: 1, rawMidi: 60 }, OFF);
    const out = [[new Float32Array(128), new Float32Array(128)]];
    p.process([[]], out, {});
    slew.push(...new Float64Array(ng.memory.buffer, ng.soemdsp_graph_node_port_ptr(p.nativeGraphHandle, slewHash, 0) | 0, 128));
    y.push(...new Float64Array(ng.memory.buffer, ng.soemdsp_graph_node_port_ptr(p.nativeGraphHandle, spHash, 0) | 0, 128));
  }
  const feed = (p._nativeHostCvFeeders || []).find((f) => f.sourceNode === "kb" && f.sourcePort === "Gate");
  return { slew, y, sampleBlock: Boolean(feed?.sampleBlock) };
}

for (const [label, type] of [["Softpop Oscillator", "softpopOscillator"], ["Softpop Filter", "softpopFilter"]]) {
  const ref = await run(type, false);
  const mod = await run(type, true);
  const s = mod.slew;
  check(mod.sampleBlock, `${label}: Keyboard Gate -> Slew feeder is a per-sample block`);
  check(s[ON - 1] === 0 && s[ON] > 0, `${label}: Slew starts rising at the Gate event sample ${ON}`);
  let maxHeldRise = 0, run_ = 0;
  for (let i = ON + 1; i < ON + 2000; i += 1) {
    if (s[i] === s[i - 1]) { run_ += 1; maxHeldRise = Math.max(maxHeldRise, run_); } else run_ = 0;
  }
  check(maxHeldRise === 0, `${label}: Slew Out moves every sample while rising (max hold ${maxHeldRise})`);
  check(s[OFF - 1] > s[OFF] || s[OFF] > s[OFF + 1], `${label}: Slew starts falling at the release sample ${OFF}`);
  let maxErr = 0, pts = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (Math.abs(ref.y[i]) < 0.25) continue;
    pts += 1;
    maxErr = Math.max(maxErr, Math.abs(mod.y[i] - ref.y[i] * s[i]));
  }
  check(pts > 2000 && maxErr < 1e-9, `${label}: output = render * Slew Out per sample (max err ${maxErr.toExponential(2)}, ${pts} pts)`);
}
console.log(failures ? `\n${failures} FAILED` : "\nsmoke_softpop_keyboard_slew_amp ok");
process.exit(failures ? 1 : 0);
