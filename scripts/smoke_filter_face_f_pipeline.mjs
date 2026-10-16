// End-to-end ƒ → filter face: real native graph (combined wasm) → real worklet
// syncNativeEffectiveHzPublish + postModuleScopeSnapshot (dataPorts) → real
// main-thread writeNodeGraphDataOutput (data bus) → real face inputs
// nodeGraphFilterCurveView (what drawNodeGraphFilterCurveDisplayInner paints +
// signs) and nodeGraphFilterCurveCutoffFrequencies (markers), for every ƒ filter.
// Also: every ƒ type is in the worklet publish set, and the cache-bust tokens for
// the wasm / worklet / face scripts are not the pre-ƒ ones (stale cache = no publish).
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), {});
const e = instance.exports;

// --- worklet side (real prototype methods) ---
const W = vm.createContext({ console, Math, Number, String, Object, Array, Map, Set, JSON, Float32Array, Float64Array, Uint8Array, Int32Array, Error, Symbol, Boolean, RegExp, Infinity, NaN, sampleRate: 48000 });
vm.runInContext("var NodeLiveAudioProcessor = function NodeLiveAudioProcessor() {}; function nodeGraphFiniteNumber(v, fb = 0) { const n = Number(v); return Number.isFinite(n) ? n : fb; }", W);
for (const f of ["node-live-audio-worklet-native-graph.js", "node-live-audio-worklet-scope-snapshot.js"]) {
  const stubs = new Set();
  for (let a = 0; ; a++) {
    try { vm.runInContext(pub(f), W, { filename: f }); break; } catch (err) {
      const m = /(\w+) is not defined/.exec(err.message); if (!m || a > 200) throw err;
      if (stubs.has(m[1])) throw err; stubs.add(m[1]); W[m[1]] = function () { return {}; };
    }
  }
}
const P = W.NodeLiveAudioProcessor;
const types = P.NATIVE_GRAPH_EFFECTIVE_HZ_TYPES, typeIds = P.NATIVE_GRAPH_TYPE_IDS || null;

// --- main thread side (real data bus + real face code) ---
const M = vm.createContext({ console, Math, Number, String, Object, Array, Map, Set, JSON, Error, Symbol, Boolean, RegExp, Infinity, NaN, parseFloat, parseInt });
for (const f of ["node-graph-data-bus.js", "modules/eqFilter/eq-filter-math.js", "modules/activeFilter/active-filter-math.js", "node-graph-cookbook-filter.js"]) {
  const p = path.join(root, "public", f); if (!fs.existsSync(p)) continue;
  const stubs = new Set();
  for (let a = 0; ; a++) {
    try { vm.runInContext(fs.readFileSync(p, "utf8"), M, { filename: f }); break; } catch (err) {
      const m = /(\w+) is not defined/.exec(err.message); if (!m || a > 200) throw err;
      if (stubs.has(m[1])) throw err; stubs.add(m[1]); M[m[1]] = function () { return {}; };
    }
  }
}
if (typeof M.writeNodeGraphDataOutput !== "function") throw new Error("data bus not loaded");
M.nodeGraphFiniteNumber = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

const S = { setSr: e.soemdsp_graph_set_sample_rate, add: e.soemdsp_graph_add_node, connect: e.soemdsp_graph_connect, set: e.soemdsp_graph_set_param };
const P_FREQ = 10, P_CUTOFF = 10, P_WAVE = 11, P_AMP = 12, P_HPF = 60, P_LPF = 59, P_ATT_OFFSET = 71, PORT_F = 16;
// [type, typeId, face key(s), knob setup]
const CASES = [
  ["eqFilter", 57, ["frequency"]], ["ladderFilter", 2, ["frequency"]], ["tb303Filter", 60, ["cutoff"]],
  ["modeResonator", 67, ["frequency"]], ["cookbookFilter", 173, ["frequency"]], ["butterworth", 52, ["frequency"]],
  ["linkwitzRiley", 53, ["frequency"]], ["bessel", 54, ["frequency"]], ["chebyshev", 55, ["frequency"]],
  ["elliptic", 56, ["frequency"]], ["papoulisFilter", 133, ["cutoff"]], ["bandpass", 137, ["frequency"]],
  ["allpass", 138, ["frequency"]], ["lowpass", 176, ["frequency"]], ["highpass", 177, ["frequency"]],
  ["combResonator", 66, ["frequency"]],
  ["passiveFilter", 59, ["lowFrequency", "highFrequency"], { mode: 2 }],
  ["activeFilter", 58, ["lowFrequency", "highFrequency"], { hpSlope: 4, lpSlope: 4 }],
];
const F = 2345, KNOB = 100;
// Load the real public file that defines a missing global on demand (face deps).
import { execFileSync } from "child_process";
const loaded = new Set();
function withDeps(fn) {
  for (let a = 0; ; a++) {
    try { return fn(); } catch (err) {
      const m = /^(\w+) is not defined/.exec(err.message); if (!m || a > 60) throw err;
      let hit = "";
      try { hit = execFileSync("rg", ["-l", "-m1", `^(function ${m[1]}\\b|(const|let|var) ${m[1]}\\b)`, path.join(root, "public"), "--glob", "*.js"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]; } catch (_e) { hit = ""; }
      if (!hit || loaded.has(hit)) throw err;
      loaded.add(hit); vm.runInContext(fs.readFileSync(hit, "utf8"), M, { filename: hit });
    }
  }
}
const fails = [];
for (const [type, typeId, keys, extra] of CASES) {
  if (!types.has(type)) { fails.push(`${type}: not in worklet NATIVE_GRAPH_EFFECTIVE_HZ_TYPES`); continue; }
  const proc = new P();
  Object.assign(proc, {
    efficientProduct: true, nativeGraphCompiled: true, nativeGraph: e, scopeBuffers: new Map(), visualInputBuffers: new Map(),
    videoscopeStates: new Map(), engineSampleRate: 48000, sessionId: 1, patchFingerprint: "x",
  });
  let posted = null; proc.postFrameBatch = (m) => { posted = m; };
  const g = e.soemdsp_graph_create() | 0; proc.nativeGraphHandle = g; S.setSr(g, 48000);
  const id = `${type}-1`, h = proc.fnv1aHash32(id) >>> 0, hB = proc.fnv1aHash32("bias-1") >>> 0, hO = proc.fnv1aHash32("osc-1") >>> 0;
  S.add(g, hO, 1); S.add(g, h, typeId); S.add(g, hB, 12);
  S.set(g, hO, P_FREQ, 997); S.set(g, hO, P_WAVE, 5); S.set(g, hO, P_AMP, 0.5); S.connect(g, hO, 0, h, 0);
  if (keys.length === 2) { S.set(g, h, P_HPF, 200); S.set(g, h, P_LPF, 1000); if (extra?.mode != null) S.set(g, h, 21, extra.mode); if (extra?.hpSlope != null) { S.set(g, h, 11, 4); S.set(g, h, 13, 4); } }
  else S.set(g, h, P_FREQ, KNOB);
  S.set(g, hB, P_ATT_OFFSET, F); S.connect(g, hB, 0, h, PORT_F);
  e.soemdsp_graph_compile(g); e.soemdsp_graph_snap_controls(g);
  for (let b = 0; b < 8; b++) e.soemdsp_graph_process_block(g, 128);
  const params = keys.length === 2 ? { lowFrequency: 200, highFrequency: 1000, ...(extra || {}) } : { [keys[0]]: KNOB, mode: 1 };
  proc.nodes = new Map([[id, { id, type, params }]]);
  proc.postModuleScopeSnapshot();
  e.soemdsp_graph_destroy(g);
  const ports = posted?.dataPorts || [];
  for (const [nid, port, value] of ports) M.writeNodeGraphDataOutput(String(nid), port, value);
  const node = { id, type, params, paramMeta: {} };
  const view = withDeps(() => M.nodeGraphFilterCurveView(node));
  if (keys.length === 1) {
    const got = Number(view?.[keys[0]] ?? view?.frequency);
    if (!(Math.abs(got - F) < 1e-6 * F)) fails.push(`${type}: face view.${keys[0]}=${got}, want ƒ ${F} (dataPorts ${JSON.stringify(ports)})`);
  } else {
    const c = Math.sqrt(view.lowFrequency * view.highFrequency);
    if (!(Math.abs(c - F) < 1e-5 * F) || !(Math.abs(view.highFrequency / view.lowFrequency - 5) < 1e-6)) fails.push(`${type}: face view ${view.lowFrequency}/${view.highFrequency}, want center ${F} ratio 5`);
  }
  if (typeof M.nodeGraphFilterCurveCutoffFrequencies === "function") {
    const cut = withDeps(() => M.nodeGraphFilterCurveCutoffFrequencies(node, view));
    const arr = (Array.isArray(cut) ? cut : []).map(Number);
    if (keys.length === 1 && arr.length && !arr.some((v) => Math.abs(v - F) < 1e-6 * F)) fails.push(`${type}: marker Hz ${JSON.stringify(arr)} lacks ƒ ${F}`);
  }
}
if (fails.length) { console.error(fails.join("\n")); throw new Error(`${fails.length} face pipeline failures`); }
console.log(`ok ƒ → native → worklet dataPorts → data bus → face view/markers on ${CASES.length} filters`);

// Stale-cache guard: these tokens shipped before EffectiveHz existed.
const rt = pub("node-graph-live-runtime.js"), idx = pub("index.html");
for (const [where, re] of [
  ["wasm", /soemdsp_combined\.wasm\?v=sc-stroke-20261014/], ["native-graph worklet", /worklet-native-graph\.js\?v=sc-stroke-20261014/],
  ["scope-snapshot worklet", /worklet-scope-snapshot\.js\?v=perf-20261015/],
]) if (re.test(rt)) throw new Error(`${where} cache-bust token predates EffectiveHz publish`);
if (/node-graph-cookbook-filter\.js\?v=perf-20261015/.test(idx)) throw new Error("face cache-bust token predates EffectiveHz read");
console.log("ok cache-bust tokens bumped past the pre-ƒ-publish builds");
console.log("filter face ƒ pipeline smoke ok");
