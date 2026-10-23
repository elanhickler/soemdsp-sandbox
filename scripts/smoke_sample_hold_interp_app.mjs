// Sample & Hold Interpolate/Smoothing through the real efficient worklet (file list
// from node-graph-live-runtime.js, incl. controller-efficient-sidecar.js) + combined wasm.
// Every Interpolate curve x Smoothing, internal Sample Freq and external Clock, Left and
// Right (Phase Offset 0.5) lanes: exact curve, latch timing, no overshoot/NaN/block steps.
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


const CURVES = {
  0: ["Linear", (t) => t],
  1: ["Smoothstep", (t) => t * t * (3 - 2 * t)],
  2: ["Quadratic Out", (t) => 1 - (1 - t) * (1 - t)],
  3: ["Quadratic In", (t) => t * t],
  4: ["Cosine", (t) => (1 - Math.cos(Math.PI * t)) / 2],
  5: ["Hold", () => 1], // jumps on the latch sample, Smoothing ignored
};
const PERIOD = 100; // 480 Hz @ 48k
const QUANTA = 60;

function run({ interpolate, smoothing, external }) {
  const sh = { id: "sh", type: "sampleHold", params: { sampleFrequency: external ? 0 : 480, interpolate, smoothing, phaseOffset: 0.5 } };
  const nodes = [sh, { id: "output", type: "output", params: {} }];
  const connections = [{ sourceNode: "sh", sourcePort: "Left", destinationNode: "output", destinationPort: "Mono" }];
  if (external) {
    // Uni: Trigger level = latched value (>= 0), so every pulse clears Clock Thresh 0.
    nodes.push({ id: "clk", type: "sampleHold", params: { sampleFrequency: 480, polarity: 1 } });
    connections.push({ sourceNode: "clk", sourcePort: "Trigger", destinationNode: "sh", destinationPort: "Clock" });
  }
  p.setPlan({ nodes, connections, modulations: [], outputNode: "output" },
    { efficientProduct: true, sampleRate: 48000, planSerial: ++serial, sessionId: 1 });
  if (!p.nativeGraphCompiled) throw new Error("native graph did not compile");
  const ng = p.nativeGraph;
  const h = p.fnv1aHash32("sh");
  const L = [], R = [], T = [];
  for (let q = 0; q < QUANTA; q += 1) {
    ctx.currentFrame = q * 128;
    p.process([[]], [[new Float32Array(128), new Float32Array(128)]], {});
    const rd = (port) => new Float64Array(ng.memory.buffer, ng.soemdsp_graph_node_port_ptr(p.nativeGraphHandle, h, port) | 0, 128);
    L.push(...rd(3)); R.push(...rd(4)); T.push(...rd(5));
  }
  return { L, R, T };
}
let serial = 1;

function badNumbers(arr) { return arr.filter((v) => !Number.isFinite(v)).length; }

// Glide segments: with Smoothing 0.5 each latch glides for 50 samples then holds 50.
function checkCurve(arr, curve, seg, starts, label) {
  let maxErr = 0, over = 0, segs = 0, notReached = 0;
  for (const i of starts) {
    if (i < 3 * PERIOD || i + PERIOD > arr.length) continue; // skip warm-up (first interval unknown)
    const from = arr[i - 1];
    const to = arr[i + seg - 1];
    if (Math.abs(to - from) < 1e-3) continue;
    segs += 1;
    const lo = Math.min(from, to) - 1e-12, hi = Math.max(from, to) + 1e-12;
    for (let j = 0; j < seg; j += 1) {
      const v = arr[i + j];
      const want = from + (to - from) * curve((j + 1) / seg);
      maxErr = Math.max(maxErr, Math.abs(v - want));
      if (v < lo || v > hi) over += 1;
    }
    for (let j = seg; j < PERIOD - 2; j += 1) if (arr[i + j] !== to) notReached += 1;
  }
  check(segs >= 15 && maxErr < 1e-9 && !over && !notReached,
    `${label}: curve exact over ${seg} samples, reaches & holds target (segs=${segs} maxErr=${maxErr.toExponential(2)} overshoot=${over} heldMiss=${notReached})`);
}
// Glide starts = first moving sample after a flat run.
function glideStarts(arr) {
  const s = [];
  for (let i = 2; i < arr.length; i += 1) if (arr[i] !== arr[i - 1] && arr[i - 1] === arr[i - 2]) s.push(i);
  return s;
}
const trigIdx = (T) => T.flatMap((v, i) => (v !== 0 ? [i] : []));

for (const external of [false, true]) {
  const clk = external ? "external Clock" : "internal Sample Freq";
  // Smoothing 0: classic hold, steps exactly at the latch sample, flat otherwise.
  for (const m of [0, 1, 2, 3, 4, 5]) {
    const { L, R, T } = run({ interpolate: m, smoothing: 0, external });
    const tr = new Set(trigIdx(T));
    let offLatch = 0;
    for (let i = 1; i < L.length; i += 1) if (L[i] !== L[i - 1] && !tr.has(i)) offLatch += 1;
    const rSteps = glideStarts(R).filter((i) => i > 3 * PERIOD);
    const rGaps = rSteps.slice(1).map((v, k) => v - rSteps[k]);
    check(!badNumbers(L) && !badNumbers(R) && offLatch === 0 && tr.size >= 25,
      `${clk} ${CURVES[m][0]} Smoothing 0: Left steps only on latch samples (latches=${tr.size}, off-latch moves=${offLatch})`);
    // Right latches half a period after Left (Phase Offset 0.5).
    const lt = [...tr].filter((i) => i > 3 * PERIOD);
    const offs = rSteps.map((i) => { const prev = lt.filter((x) => x <= i).pop(); return prev === undefined ? null : i - prev; }).filter((x) => x !== null);
    check(offs.length >= 20 && rGaps.every((g) => g % PERIOD === 0) && offs.every((o) => o === 50),
      `${clk} ${CURVES[m][0]} Smoothing 0: Right steps every period, 50 samples after Left (offsets ${[...new Set(offs)].join(",")})`);
  }
  // Each curve with Smoothing 0.5 (glide 50 samples, then hold).
  const outs = [];
  for (const m of [0, 1, 2, 3, 4, 5]) {
    const { L, R, T } = run({ interpolate: m, smoothing: 0.5, external });
    outs.push(L);
    check(!badNumbers(L) && !badNumbers(R), `${clk} ${CURVES[m][0]}: no NaN/Inf`);
    const tStarts = trigIdx(T);
    const lStarts = glideStarts(L).filter((i) => i > 3 * PERIOD);
    check(lStarts.every((i) => tStarts.includes(i)), `${clk} ${CURVES[m][0]}: Left glide starts on the latch sample`);
    checkCurve(L, CURVES[m][1], 50, tStarts, `${clk} ${CURVES[m][0]} Left`);
    checkCurve(R, CURVES[m][1], 50, glideStarts(R), `${clk} ${CURVES[m][0]} Right (Phase Offset 0.5)`);
  }
  // Choice reaches native: every pair of curves differs.
  let same = 0;
  for (let a = 0; a < 6; a += 1) for (let b = a + 1; b < 6; b += 1) if (outs[a].every((v, i) => v === outs[b][i])) same += 1;
  check(same === 0, `${clk}: changing Interpolate changes the output (identical pairs=${same})`);
  // Smoothing 1: glide fills the whole period, continuous, reaches target on the sample before the next latch.
  const { L, T } = run({ interpolate: 0, smoothing: 1, external });
  const ts = trigIdx(T).filter((i) => i > 3 * PERIOD);
  let miss = 0, held = 0;
  for (let k = 0; k + 1 < ts.length; k += 1) {
    const a = ts[k], b = ts[k + 1];
    for (let i = a + 1; i < b - 1; i += 1) if (L[i] === L[i - 1] && L[a - 1] !== L[b - 1]) held += 1;
    if (b - a !== PERIOD) miss += 1;
  }
  check(ts.length > 20 && held === 0 && miss === 0, `${clk} Linear Smoothing 1: glides every sample across the full period (held samples=${held}, odd periods=${miss})`);
}
console.log(failures ? `\n${failures} FAILED` : "\nsmoke_sample_hold_interp_app ok");
process.exit(failures ? 1 : 0);
