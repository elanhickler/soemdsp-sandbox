// Headless: ƒ input on filters (absolute Hz cable replaces Frequency/Cutoff per sample,
// resolve_osc_hz) + filter faces follow the native effective Hz while ƒ is wired.
// Per module: ƒ = F with the knob parked at 100 Hz must equal the knob set to F
// (unwired); it must differ from the knob-at-100 run; soemdsp_graph_node_effective_hz
// reports F while wired and -1 unwired. UI: nodeGraphFilterCurveLiveParam returns the
// data-bus EffectiveHz for the module's ƒ key, so the curve / marker draws at ƒ.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const gC = must("soemdsp_graph_create"), gD = must("soemdsp_graph_destroy"), add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect"), setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
const proc = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");
const effHz = must("soemdsp_graph_node_effective_hz"), nativeHandle = must("soemdsp_graph_node_native_handle");
if ((must("soemdsp_graph_version")() | 0) < 171) throw new Error("graph version < 171");
const SR = 48000, PORT_MONO = 0, PORT_F = 16, P_FREQ = 10, P_WAVE = 11, P_AMP = 12, P_ATT_OFFSET = 71;
const KNOB = 100, BLOCKS = 60;
const MODULES = {
  ladderFilter: 2, tb303Filter: 60, modeResonator: 67, cookbookFilter: 173, butterworth: 52,
  linkwitzRiley: 53, bessel: 54, chebyshev: 55, elliptic: 56, papoulisFilter: 133,
  bandpass: 137, allpass: 138, lowpass: 176, highpass: 177, eqFilter: 57, combResonator: 66,
  flowerChildFilterRev3: 235,
};

function run(type, knobHz, fHz) {
  const g = gC() | 0; setSr(g, SR);
  const hO = 0xf101, hB = 0xf102, hF = 0xf103, hOut = 0xf104;
  for (const [h, t] of [[hO, 1], [hF, type], [hOut, 6]]) if (add(g, h, t) | 0) throw new Error(`add ${t}`);
  setParam(g, hO, P_FREQ, 997); setParam(g, hO, P_WAVE, 5); setParam(g, hO, P_AMP, 0.5);
  connect(g, hO, PORT_MONO, hF, PORT_MONO); connect(g, hF, PORT_MONO, hOut, PORT_MONO);
  setParam(g, hF, P_FREQ, knobHz);
  if (fHz !== null) {
    if (add(g, hB, 12) | 0) throw new Error("add bias");
    setParam(g, hB, P_ATT_OFFSET, fHz);
    if (connect(g, hB, PORT_MONO, hF, PORT_F) | 0) throw new Error("connect f");
  }
  if (compile(g) | 0) throw new Error("compile"); snap(g);
  const y = [];
  for (let b = 0; b < BLOCKS; b++) { proc(g, 128); y.push(...new Float64Array(e.memory.buffer, portPtr(g, hF, PORT_MONO) | 0, 128)); }
  const hz = Number(effHz(g, hF));
  const handle = nativeHandle(g, hF) | 0;
  gD(g);
  return { y, hz, handle };
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

const rows = [];
for (const [name, type] of Object.entries(MODULES)) {
  for (const F of [300, 2000, 6000]) {
    const wired = run(type, KNOB, F), knobAtF = run(type, F, null), knobOnly = run(type, KNOB, null);
    const scale = Math.max(1e-9, peak(knobAtF.y));
    const dTrack = maxDiff(wired.y, knobAtF.y) / scale;
    const dKnob = maxDiff(wired.y, knobOnly.y) / scale;
    if (!(dTrack < 1e-6)) throw new Error(`${name} ƒ ${F}: wired != knob at ${F} (rel ${dTrack})`);
    if (!(dKnob > 1e-3)) throw new Error(`${name} ƒ ${F}: wired output ~ knob ${KNOB} (ƒ ignored, rel ${dKnob})`);
    if (wired.hz !== F) throw new Error(`${name} ƒ ${F}: effective_hz ${wired.hz}`);
    if (knobOnly.hz !== -1) throw new Error(`${name}: unwired effective_hz ${knobOnly.hz} (want -1)`);
  }
  rows.push(name);
}
console.log(`ok ƒ tracks on ${rows.length} modules (300/2000/6000 Hz, knob ${KNOB}): output == knob at ƒ, != knob; effective_hz = ƒ, -1 unwired`);

// Softpop Filter face reads native fEff (display_info[1]) — must equal ƒ when wired.
{
  const info = must("soemdsp_softpop_filter_display_info");
  for (const F of [300, 2000]) {
    const r = run(214, KNOB, F);
    // run() destroyed the graph; re-run keeping the handle alive for the info read.
    const g = gC() | 0; setSr(g, SR);
    add(g, 0xf201, 1); add(g, 0xf202, 214); add(g, 0xf203, 6); add(g, 0xf204, 12);
    setParam(g, 0xf201, P_WAVE, 5); setParam(g, 0xf201, P_FREQ, 997); setParam(g, 0xf204, P_ATT_OFFSET, F);
    connect(g, 0xf201, PORT_MONO, 0xf202, PORT_MONO); connect(g, 0xf202, PORT_MONO, 0xf203, PORT_MONO);
    connect(g, 0xf204, PORT_MONO, 0xf202, PORT_F);
    compile(g); snap(g); for (let b = 0; b < 20; b++) proc(g, 128);
    const fEff = Number(info(nativeHandle(g, 0xf202) | 0, 1));
    gD(g);
    if (Math.abs(fEff - F) > 1e-6 * F) throw new Error(`softpopFilter face fEff ${fEff} != ƒ ${F}`);
    void r;
  }
  console.log("ok softpopFilter face fEff (native display_info) = ƒ");
}

// UI: filter-curve face reads EffectiveHz from the data bus for the ƒ key.
{
  const src = fs.readFileSync(path.join(root, "public", "node-graph-cookbook-filter.js"), "utf8");
  const base = { console, Object, Array, Math, Number, String, JSON, Set, Map, Symbol, RegExp, Error, Boolean, Infinity, NaN, parseFloat, parseInt };
  const stubs = new Set(); let ctx;
  for (let a = 0; ; a++) {
    ctx = vm.createContext({ ...base }); for (const s of stubs) ctx[s] = () => ({});
    try { vm.runInContext(src, ctx); break; } catch (err) { const m = /(\w+) is not defined/.exec(err.message); if (!m || a > 200) throw err; stubs.add(m[1]); }
  }
  vm.runInContext(`var nodeGraphDataBus = new Map(); function nodeGraphDataBusKey(n, p) { return n + "." + p; }`, ctx);
  const live = ctx.nodeGraphFilterCurveLiveParam;
  for (const [type, key] of [["eqFilter", "frequency"], ["tb303Filter", "cutoff"], ["papoulisFilter", "cutoff"], ["ladderFilter", "frequency"], ["lowpass", "frequency"]]) {
    ctx.nodeGraphDataBus.set("n1.EffectiveHz", 4321);
    const v = live({ id: "n1", type, params: { [key]: 100 } }, key, 100);
    if (v !== 4321) throw new Error(`UI ${type}.${key}: face ${v}, want ƒ 4321`);
    ctx.nodeGraphDataBus.set("n1.EffectiveHz", -1);
    if (ctx.nodeGraphFilterCurveWiredHz({ id: "n1", type }, key) !== null) throw new Error(`UI ${type}: unwired should follow knob`);
  }
  console.log("ok filter-curve face uses native EffectiveHz while ƒ is wired, knob when -1");
}
console.log("filter ƒ smoke ok");
