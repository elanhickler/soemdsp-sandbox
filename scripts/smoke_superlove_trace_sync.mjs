// VCV Superlove trace: Sync follows the first wired input (Mono, Left, Right);
// the trace stays the output. No input wired: no input sync (output self-sync).
// Runs the real nodeGraphModuleTraceInputSyncBuffer in a vm.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function slice(file, startSig, endSig) {
  const src = fs.readFileSync(path.join(root, "public", file), "utf8");
  const a = src.indexOf(startSig);
  const b = src.indexOf(endSig, a + 1);
  assert(a >= 0 && b > a, `${startSig} not found in ${file}`);
  return src.slice(a, b);
}

const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
const at = defs.indexOf("  vcvrackSuperloveFilter: {");
const block = defs.slice(at, defs.indexOf("\n  },", at));
assert(/syncTraceFromInputs:\s*\{\s*mono:\s*"In",\s*left:\s*"Left",\s*right:\s*"Right",\s*firstWired:\s*true\s*\}/.test(block),
  "vcvrackSuperloveFilter must sync to first wired input");
assert(/source:\s*\{\s*value:\s*"Out"\s*\}/.test(block), "trace must stay the output");

const query = slice("node-graph-module-scope-graph-query.js",
  "function nodeGraphModuleScopeConnectedSourceBuffer(", "function nodeGraphModuleScopeLatestOutputValue(");
const capture = slice("node-graph-module-scope-capture.js",
  "function captureNodeGraphLiveModuleScopeInputSync(", "function captureNodeGraphLiveModuleScopeOutput(");

const MONO = [1, 1], LEFT = [2, 2], RIGHT = [3, 3];
let wired = {};
const ctx = {
  nodeGraphModuleDefinitions: {
    sl: { syncTraceFromInputs: { mono: "In", left: "Left", right: "Right", firstWired: true } },
    fc: { syncTraceFromInputs: { mono: "In", left: "Left", right: "Right" } },
  },
  nodeGraphModuleScopeState: { buffers: new Map([["srcM:Out", MONO], ["srcL:Out", LEFT], ["srcR:Out", RIGHT]]) },
  nodeGraphModuleScopeConnectionsTo: (_id, port) =>
    wired[port] ? [{ sourceNode: wired[port], sourcePort: "Out" }] : [],
  nodeGraphTraceDisplayMonoSyncBuffer: () => "avg",
};
vm.createContext(ctx);
vm.runInContext(`${query}\nthis.q = nodeGraphModuleTraceInputSyncBuffer;`, ctx);

const cases = [
  [{ In: "srcM", Left: "srcL", Right: "srcR" }, MONO, "all wired -> Mono"],
  [{ Left: "srcL", Right: "srcR" }, LEFT, "L+R -> Left"],
  [{ Right: "srcR" }, RIGHT, "Right only -> Right"],
  [{ In: "srcM", Right: "srcR" }, MONO, "Mono+Right -> Mono"],
  [{}, null, "nothing wired -> null (output self-sync)"],
];
for (const [w, want, label] of cases) {
  wired = w;
  assert(ctx.q("node1", "sl") === want, `graph-query ${label}`);
}
wired = { Left: "srcL", Right: "srcR" };
assert(ctx.q("node1", "fc") === "avg", "Flower Child keeps L+R average sync");

// JS-runtime capture path writes __inSync from the same rule.
vm.runInContext(`${capture}\nthis.cap = captureNodeGraphLiveModuleScopeInputSync;`, ctx);
ctx.nodeGraphModuleScopeScalarValue = (v) => v;
ctx.captureNodeGraphLiveModuleScopeInputMix = (_rt, _id, port) => ({ In: 1, Left: 2, Right: 3 }[port] ?? null);
const runtime = { nodes: new Map([["n", { type: "sl" }]]), scopeBuffers: new Map() };
ctx.cap(runtime, "n");
assert(runtime.scopeBuffers.get("n:__inSync")?.[0] === 1, "capture firstWired -> Mono sample");
ctx.captureNodeGraphLiveModuleScopeInputMix = (_rt, _id, port) => ({ Left: 2, Right: 3 }[port] ?? null);
const rt2 = { nodes: new Map([["n", { type: "sl" }]]), scopeBuffers: new Map() };
ctx.cap(rt2, "n");
assert(rt2.scopeBuffers.get("n:__inSync")?.[0] === 2, "capture firstWired L+R -> Left sample");

console.log("smoke_superlove_trace_sync ok: Mono > Left > Right, output trace, no-input fallback, Flower Child unchanged");
