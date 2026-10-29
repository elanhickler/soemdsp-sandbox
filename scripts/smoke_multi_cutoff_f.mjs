// Headless: multi-cutoff ƒ on Passive Filter + Dual Ladder (apply_multi_cutoff_f).
// Wired ƒ = F moves the center to F and scales HPF and LPF by F / center, so their
// octave spacing is kept. Center: HP+LP = sqrt(HPF*LPF); LP-only = LPF; HP-only = HPF.
// Checks per module/mode: published cuts (effective_hz = LPF, effective_lo_hz = HPF)
// match the math, ratio preserved, output == unwired knobs set to those cuts, output
// != knob-only run, -1 unwired, ƒ <= 0 = 0 Hz. UI: face reads EffectiveHz/EffectiveLoHz.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), {});
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const gC = must("soemdsp_graph_create"), gD = must("soemdsp_graph_destroy"), add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect"), setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
const proc = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");
const effHz = must("soemdsp_graph_node_effective_hz"), effLo = must("soemdsp_graph_node_effective_lo_hz");
if ((must("soemdsp_graph_version")() | 0) < 172) throw new Error("graph version < 172");
const SR = 48000, PORT_MONO = 0, PORT_F = 16, P_FREQ = 10, P_WAVE = 11, P_AMP = 12, P_SHAPE = 13;
const P_MODE = 21, P_STAGES = 22, P_TIMING = 54, P_LPF = 59, P_HPF = 60, P_ATT_OFFSET = 71;
const HPF = 200, LPF = 1000, BLOCKS = 40;

const CASES = [
  // [label, type, setup, useLo, useHi]
  ["activeFilter BP", 58, (g, h) => { setParam(g, h, P_WAVE, 4); setParam(g, h, P_SHAPE, 4); setParam(g, h, P_STAGES, 0); setParam(g, h, P_TIMING, 1); }, true, true],
  ["activeFilter LP-only", 58, (g, h) => { setParam(g, h, P_WAVE, 0); setParam(g, h, P_SHAPE, 4); setParam(g, h, P_STAGES, 0); }, false, true],
  ["activeFilter HP-only", 58, (g, h) => { setParam(g, h, P_WAVE, 4); setParam(g, h, P_SHAPE, 0); setParam(g, h, P_STAGES, 0); }, true, false],
  ["passiveFilter BP", 59, (g, h) => { setParam(g, h, P_MODE, 2); setParam(g, h, P_STAGES, 3); }, true, true],
  ["passiveFilter LP", 59, (g, h) => { setParam(g, h, P_MODE, 1); setParam(g, h, P_STAGES, 3); }, false, true],
  ["passiveFilter HP", 59, (g, h) => { setParam(g, h, P_MODE, 3); setParam(g, h, P_STAGES, 3); }, true, false],
];

function run(type, setup, lo, hi, fHz) {
  const g = gC() | 0; setSr(g, SR);
  const hO = 0xf301, hB = 0xf302, hF = 0xf303, hOut = 0xf304;
  for (const [h, t] of [[hO, 1], [hF, type], [hOut, 6]]) if (add(g, h, t) | 0) throw new Error(`add ${t}`);
  setParam(g, hO, P_FREQ, 997); setParam(g, hO, P_WAVE, 5); setParam(g, hO, P_AMP, 0.5);
  connect(g, hO, PORT_MONO, hF, PORT_MONO); connect(g, hF, PORT_MONO, hOut, PORT_MONO);
  setup(g, hF); setParam(g, hF, P_HPF, lo); setParam(g, hF, P_LPF, hi);
  if (fHz !== null) {
    if (add(g, hB, 12) | 0) throw new Error("add bias");
    setParam(g, hB, P_ATT_OFFSET, fHz);
    if (connect(g, hB, PORT_MONO, hF, PORT_F) | 0) throw new Error("connect f");
  }
  if (compile(g) | 0) throw new Error("compile"); snap(g);
  const y = [];
  for (let b = 0; b < BLOCKS; b++) { proc(g, 128); y.push(...new Float64Array(e.memory.buffer, portPtr(g, hF, PORT_MONO) | 0, 128)); }
  const out = { y, hi: Number(effHz(g, hF)), lo: Number(effLo(g, hF)) };
  gD(g);
  return out;
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
// 1e-6: engine center uses dsp_exp/dsp_ln (approx sqrt), ~1e-7 rel.
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

for (const [label, type, setup, useLo, useHi] of CASES) {
  const center = useLo && useHi ? Math.sqrt(HPF * LPF) : (useHi ? LPF : HPF);
  for (const F of [300, 3000]) {
    const r = F / center, wantLo = HPF * r, wantHi = LPF * r;
    const wired = run(type, setup, HPF, LPF, F);
    if (!near(wired.lo, wantLo) || !near(wired.hi, wantHi)) throw new Error(`${label} ƒ ${F}: published ${wired.lo}/${wired.hi}, want ${wantLo}/${wantHi}`);
    if (!near(wired.hi / wired.lo, LPF / HPF)) throw new Error(`${label} ƒ ${F}: ratio ${wired.hi / wired.lo} not ${LPF / HPF}`);
    const pubCenter = useLo && useHi ? Math.sqrt(wired.lo * wired.hi) : (useHi ? wired.hi : wired.lo);
    if (!near(pubCenter, F)) throw new Error(`${label} ƒ ${F}: center ${pubCenter} != ƒ`);
    const moved = run(type, setup, wantLo, wantHi, null);
    const knob = run(type, setup, HPF, LPF, null);
    const scale = Math.max(1e-9, peak(moved.y));
    const dTrack = maxDiff(wired.y, moved.y) / scale, dKnob = maxDiff(wired.y, knob.y) / scale;
    if (!(dTrack < 1e-6)) throw new Error(`${label} ƒ ${F}: wired != knobs moved to center (rel ${dTrack})`);
    if (!(dKnob > 1e-3)) throw new Error(`${label} ƒ ${F}: wired ~ unmoved knobs (ƒ ignored, rel ${dKnob})`);
    if (knob.hi !== -1 || knob.lo !== -1) throw new Error(`${label}: unwired published ${knob.lo}/${knob.hi} (want -1)`);
  }
  const zero = run(type, setup, HPF, LPF, 0);
  if (zero.lo !== 0 || zero.hi !== 0) throw new Error(`${label} ƒ 0: published ${zero.lo}/${zero.hi}, want 0 Hz`);
  console.log(`ok ${label}: center ${center.toFixed(2)} → ƒ, cuts × ƒ/center, ratio kept, published = used, unwired = knobs, ƒ 0 = 0 Hz`);
}

// Defs: Sweep gone, ƒ jack present.
{
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  // The whole definition object, matched brace to brace (strings skipped), so its layout (e.g. a face array first) doesn't matter.
  const objectAt = (anchor) => {
    const i = defs.indexOf(anchor); if (i < 0) throw new Error(`${anchor} not found`);
    let depth = 0, quote = null;
    for (let k = defs.indexOf("{", i); k < defs.length; k++) {
      const c = defs[k];
      if (quote) { if (c === "\\") k++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return defs.slice(i, k + 1);
    }
    throw new Error(`${anchor} unterminated`);
  };
  for (const anchor of ["const nodeGraphActiveFilterDefinition = {", "  passiveFilter: {"]) {
    const block = objectAt(anchor);
    if (block.includes('key: "sweep"')) throw new Error(`${anchor} still has Sweep`);
    if (!block.includes('inputs: ["In", "Left", "Right", "f"]') || !block.includes('f: "ƒ"')) throw new Error(`${anchor} missing ƒ jack`);
  }
  console.log("ok defs: Sweep removed, ƒ jack on Passive + Dual Ladder");
}

// UI: face reads both published cuts while ƒ is wired, knobs when -1.
{
  const src = fs.readFileSync(path.join(root, "public", "node-graph-cookbook-filter.js"), "utf8");
  const base = { console, Object, Array, Math, Number, String, JSON, Set, Map, Symbol, RegExp, Error, Boolean, Infinity, NaN, parseFloat, parseInt };
  const stubs = new Set(); let ctx;
  for (let a = 0; ; a++) {
    ctx = vm.createContext({ ...base }); for (const s of stubs) ctx[s] = () => ({});
    try { vm.runInContext(src, ctx); break; } catch (err) { const m = /(\w+) is not defined/.exec(err.message); if (!m || a > 200) throw err; stubs.add(m[1]); }
  }
  vm.runInContext(`var nodeGraphDataBus = new Map(); function nodeGraphDataBusKey(n, p) { return n + "." + p; }`, ctx);
  for (const type of ["passiveFilter", "activeFilter"]) {
    ctx.nodeGraphDataBus.set("n1.EffectiveHz", 3000); ctx.nodeGraphDataBus.set("n1.EffectiveLoHz", 600);
    const node = { id: "n1", type, params: { lowFrequency: 200, highFrequency: 1000 } };
    if (ctx.nodeGraphFilterCurveWiredHz(node, "highFrequency") !== 3000) throw new Error(`UI ${type}: LPF not from EffectiveHz`);
    if (ctx.nodeGraphFilterCurveWiredHz(node, "lowFrequency") !== 600) throw new Error(`UI ${type}: HPF not from EffectiveLoHz`);
    ctx.nodeGraphDataBus.set("n1.EffectiveHz", -1); ctx.nodeGraphDataBus.set("n1.EffectiveLoHz", -1);
    if (ctx.nodeGraphFilterCurveWiredHz(node, "highFrequency") !== null || ctx.nodeGraphFilterCurveWiredHz(node, "lowFrequency") !== null) throw new Error(`UI ${type}: unwired should follow knobs`);
  }
  console.log("ok face: Passive / Dual Ladder cuts follow EffectiveHz + EffectiveLoHz while ƒ wired, knobs when -1");
}
console.log("multi-cutoff ƒ smoke ok");
