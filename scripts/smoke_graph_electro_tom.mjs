// Headless: Electro Tom (electroTom, type 224), docs/DRUM_PACK_PLAN.md.
// 1) Direct export, every algorithm: silent before a hit (Reset too), a hit
//    sounds on L and R, Env peaks at v and reaches exact 0, no dead knobs,
//    Reset mid-hit restarts bit-exact on L and R, Reset + hit on one sample =
//    hit height, Amplitude 0 = exact silence while Env moves, Planck-clean at
//    range extremes, stereo law (noise decorrelated, tonal-only L == R).
// 2) Graph: clock -> Trigger -> Tom L (Left) / Tom R (Right) / Env (Mono);
//    Reset jack re-strikes; block sizes 1 / 64 / 128 give identical output.
// 3) Algorithm choice persists by name and resolves to the native choiceId.
// 4) Live path: the real efficient worklet + combined wasm.
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const e = instance.exports;
const mem = e.memory;
function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}
const M = "electro_tom";
const kCreate = must(`soemdsp_${M}_create`);
const kDestroy = must(`soemdsp_${M}_destroy`);
const kSample = must(`soemdsp_${M}_sample`);
const kEnv = must(`soemdsp_${M}_env`);
const kRight = must(`soemdsp_${M}_right`);
const SR = 48000;
const KEY = "electroTom";
const NAME = "Tom";
const TYPE = 224;
const ALGS = ["tr808", "tr909", "simmons"];
const INPUTS = ["trigger", "reset"];           // native input order
const PARAMS = ["tune", "bend", "tone", "bodyDecay", "noise", "amplitude"];           // native param order (after algorithm)
const DEF = {"tune": 135, "bend": 0.25, "tone": 0.5, "bodyDecay": 0.2, "noise": 0.2, "amplitude": 1};
const KNOB = {"tune": 220, "bend": 1, "tone": 0.9, "bodyDecay": 0.5, "noise": 0.6, "amplitude": 0.5};
const KNOB_INPUT = {};    // per knob: which input strikes for the dead-knob test
const MIN = {"tune": 40, "bend": 0, "tone": 0, "bodyDecay": 0.02, "noise": 0, "amplitude": 0};
const MAX = {"tune": 400, "bend": 4, "tone": 1, "bodyDecay": 3, "noise": 1, "amplitude": 1};
const SLOTS = {"tune": "FREQUENCY", "bend": "CENTER", "tone": "SHAPE", "bodyDecay": "TIME_NUMERATOR", "noise": "WIDTH", "amplitude": "AMPLITUDE"};             // graph param id per key
const NOISY = {"noise": 0.5};             // params where L != R is expected (all algorithms)
const TONAL = {"noise": 0};             // params where L == R bit-exact is expected
const TONAL_ALGS = [0, 1, 2];
const PLANCK = 1e-7;

function render(alg, p, n, events) {
  const h = kCreate() | 0;
  if (!(h > 0)) throw new Error("create");
  const out = new Float64Array(n), outR = new Float64Array(n), env = new Float64Array(n);
  const args = PARAMS.map((k) => p[k]);
  for (let i = 0; i < n; i++) {
    const ev = events[i] || {};
    const ins = INPUTS.map((k) => ev[k] || 0);
    out[i] = kSample(h, ...ins, alg, ...args, SR);
    outR[i] = kRight(h);
    env[i] = kEnv(h);
  }
  kDestroy(h);
  return { out, outR, env };
}
function clean(name, a) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (!Number.isFinite(x)) throw new Error(`${name}: non-finite at ${i}`);
    if (x !== 0 && Math.abs(x) < PLANCK) throw new Error(`${name}: sub-Planck ${x} at ${i}`);
  }
}
function hit(at, v, inp = INPUTS[0]) { const ev = {}; ev[at] = { [inp]: v }; ev[at + 1] = { [inp]: 0 }; return ev; }
const RESET = INPUTS[INPUTS.length - 1];
const rows = [];
for (let alg = 0; alg < ALGS.length; alg++) {
  const name = ALGS[alg];
  const V = 0.7;
  {
    const ev = {}; ev[200] = { [RESET]: 1 }; ev[201] = { [RESET]: 0 };
    const s = render(alg, DEF, 2000, ev);
    for (let i = 0; i < 2000; i++) if (s.out[i] !== 0 || s.outR[i] !== 0 || s.env[i] !== 0) throw new Error(`${name}: not silent before a hit (${i})`);
  }
  const N = 8 * SR;
  const ev = hit(100, V);
  const a = render(alg, DEF, N, ev);
  clean(`${name} out`, a.out); clean(`${name} outR`, a.outR); clean(`${name} env`, a.env);
  for (let i = 0; i < 100; i++) if (a.out[i] !== 0 || a.outR[i] !== 0 || a.env[i] !== 0) throw new Error(`${name}: sound before hit`);
  if (Math.abs(a.env[100] - V) > 1e-12) throw new Error(`${name}: Env at hit ${a.env[100]} != v`);
  if (a.out[100] === 0 && a.out[101] === 0) throw new Error(`${name}: no output at the hit sample`);
  let peakEnv = 0, peakOut = 0, peakR = 0, zeroAt = -1;
  for (let i = 0; i < N; i++) {
    peakEnv = Math.max(peakEnv, a.env[i]);
    peakOut = Math.max(peakOut, Math.abs(a.out[i]));
    peakR = Math.max(peakR, Math.abs(a.outR[i]));
    if (i > 100 && zeroAt < 0 && a.env[i] === 0) zeroAt = i;
    if (zeroAt > 0 && (a.env[i] !== 0 || a.out[i] !== 0 || a.outR[i] !== 0)) throw new Error(`${name}: not exact 0 after rest (${i})`);
  }
  if (Math.abs(peakEnv - V) > 1e-12) throw new Error(`${name}: Env peak ${peakEnv} != v`);
  if (!(zeroAt > 0)) throw new Error(`${name}: Env never reached exact 0`);
  if (!(peakOut > 0.05) || !(peakR > 0.05)) throw new Error(`${name}: hit too quiet L ${peakOut} R ${peakR}`);
  if (peakOut > 1.0 || peakR > 1.0) throw new Error(`${name}: peak over 1 (L ${peakOut} R ${peakR}) at v ${V}`);
  // No dead knobs.
  const L = Math.round(0.4 * SR);
  const knobs = {};
  for (const k of Object.keys(KNOB)) {
    const evk = hit(100, V, KNOB_INPUT[k] || INPUTS[0]);
    const base = render(alg, DEF, L, evk);
    const b = render(alg, { ...DEF, [k]: KNOB[k] }, L, evk);
    let d = 0;
    for (let i = 0; i < L; i++) d = Math.max(d, Math.abs(b.out[i] - base.out[i]));
    knobs[k] = d;
    if (!(d > 1e-4)) throw new Error(`${name}: dead knob ${k} (max diff ${d})`);
  }
  // Reset mid-hit restarts bit-exact on both channels.
  {
    const R0 = 100 + 3000;
    const ev2 = hit(100, V); ev2[R0] = { [RESET]: 1 }; ev2[R0 + 1] = { [RESET]: 0 };
    const b = render(alg, DEF, R0 + L, ev2);
    if (Math.abs(b.env[R0] - V) > 1e-12) throw new Error(`${name}: Env after Reset ${b.env[R0]} != v`);
    for (let i = 0; i < L - 200; i++) {
      if (b.out[R0 + i] !== a.out[100 + i] || b.outR[R0 + i] !== a.outR[100 + i]) throw new Error(`${name}: Reset hit differs at +${i}`);
    }
  }
  // Reset + hit on one sample: hit height wins.
  {
    const ev3 = hit(100, 0.3); ev3[2000] = { [RESET]: 1, [INPUTS[0]]: 0.9 }; ev3[2001] = {};
    const b = render(alg, DEF, 3000, ev3);
    if (Math.abs(b.env[2000] - 0.9) > 1e-12) throw new Error(`${name}: Reset+hit Env ${b.env[2000]} != 0.9`);
  }
  // Amplitude 0: exact silence, Env still moves.
  {
    const b = render(alg, { ...DEF, amplitude: 0 }, L, ev);
    for (let i = 0; i < L; i++) if (b.out[i] !== 0 || b.outR[i] !== 0) throw new Error(`${name}: Amplitude 0 not silent at ${i}`);
    if (Math.abs(b.env[100] - V) > 1e-12) throw new Error(`${name}: Amplitude 0 Env ${b.env[100]}`);
  }
  // Range extremes: Planck-clean, finite.
  for (const P of [MIN, MAX]) {
    const b = render(alg, P, SR, hit(100, 1));
    clean(`${name} extreme out`, b.out); clean(`${name} extreme outR`, b.outR); clean(`${name} extreme env`, b.env);
  }
  // Stereo law.
  {
    const nz = render(alg, { ...DEF, ...NOISY }, L, ev);
    let d = 0; for (let i = 0; i < L; i++) d = Math.max(d, Math.abs(nz.out[i] - nz.outR[i]));
    const expectStereo = true;
    if (expectStereo && !(d > 1e-3)) throw new Error(`${name}: noise not decorrelated L/R (${d})`);
    if (TONAL_ALGS.includes(alg)) {
      const t = render(alg, { ...DEF, ...TONAL }, L, ev);
      for (let i = 0; i < L; i++) if (t.out[i] !== t.outR[i]) throw new Error(`${name}: tonal-only L != R at ${i}`);
    }
    rows.push(`${name}: peak L ${peakOut.toFixed(3)} R ${peakR.toFixed(3)} rest ${(zeroAt / SR).toFixed(2)}s noisy L/R diff ${d.toFixed(3)}`);
  }
  // Bend 0: constant pitch (zero-crossing periods steady after the attack).
  {
    const b = render(alg, { ...DEF, bend: 0, noise: 0 }, Math.round(0.15 * SR), ev);
    const zc = [];
    for (let i = 200; i < b.out.length; i++) if (b.out[i - 1] < 0 && b.out[i] >= 0) zc.push(i - 1 + (-b.out[i - 1]) / (b.out[i] - b.out[i - 1]));
    const per = []; for (let i = 1; i < zc.length; i++) per.push(zc[i] - zc[i - 1]);
    if (per.length < 6) throw new Error(`${name}: too few cycles`);
    const ref = per.slice(-4).reduce((x, y) => x + y) / 4;
    const tail = per.slice(1);
    for (const q of tail) if (Math.abs(q - ref) > 0.02 * ref + 0.2) throw new Error(`${name}: Bend 0 period drifts ${q} vs ${ref}`);
  }

}
for (const r of rows) console.log(`ok ${r}`);
console.log(`ok ${KEY} direct: silent before a hit, Env peaks at v and rests at exact 0, no dead knobs, Reset bit-exact L and R, Reset+hit, Amplitude 0, Planck-clean extremes, stereo law`);

// --- 2) graph ---
const create = must("soemdsp_graph_create");
const destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const version = must("soemdsp_graph_version");
const TYPE_CLOCK = 28, TYPE_OUT = 6;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RIGHT = 2, PORT_RESET = 19, PORT_TRIGGER = 20;
const P = { FREQUENCY: 10, WAVEFORM: 11, AMPLITUDE: 12, SHAPE: 13, CENTER: 30, WIDTH: 31, TIME_NUMERATOR: 52, TIME_DENOMINATOR: 53 };
const ver = version() | 0;
if (ver < 188) throw new Error(`graph version ${ver} < 188 (electro drum pack)`);
function runGraph(alg, { reset = false, block = 128, trigPort = PORT_TRIGGER } = {}) {
  const g = create() | 0;
  setSr(g, SR);
  const hClk = 0x5b01 >>> 0, hD = 0x5b02 >>> 0, hOut = 0x5b03 >>> 0, hClk2 = 0x5b04 >>> 0;
  if ((add(g, hClk, TYPE_CLOCK) | 0) !== 0) throw new Error("clock add");
  if ((add(g, hD, TYPE) | 0) !== 0) throw new Error(`${KEY} add`);
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("out add");
  if ((connect(g, hClk, PORT_MONO, hD, trigPort) | 0) !== 0) throw new Error("clk->hit");
  if (reset) {
    if ((add(g, hClk2, TYPE_CLOCK) | 0) !== 0) throw new Error("clock2 add");
    if ((connect(g, hClk2, PORT_MONO, hD, PORT_RESET) | 0) !== 0) throw new Error("clk2->Reset");
    setParam(g, hClk2, P.FREQUENCY, 7);
  }
  connect(g, hD, PORT_LEFT, hOut, PORT_LEFT);
  connect(g, hD, PORT_RIGHT, hOut, PORT_RIGHT);
  setParam(g, hClk, P.FREQUENCY, 3);
  setParam(g, hD, P.WAVEFORM, alg);
  for (const k of PARAMS) setParam(g, hD, P[SLOTS[k]], DEF[k]);
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);
  const sig = [], sigR = [], env = [];
  const total = 96000;
  for (let q = 0; q < total / block; q++) {
    process(g, block);
    const sb = new Float64Array(mem.buffer, portPtr(g, hD, PORT_LEFT) | 0, block);
    const rb = new Float64Array(mem.buffer, portPtr(g, hD, PORT_RIGHT) | 0, block);
    const eb = new Float64Array(mem.buffer, portPtr(g, hD, PORT_MONO) | 0, block);
    for (let i = 0; i < block; i++) { sig.push(sb[i]); sigR.push(rb[i]); env.push(eb[i]); }
  }
  destroy(g);
  let hits = 0;
  for (let n = 1; n < env.length; n++) if (env[n] > 0.999 && env[n - 1] < 0.999) hits += 1;
  return { sig, sigR, env, hits };
}
for (let alg = 0; alg < ALGS.length; alg++) {
  const r = runGraph(alg);
  let pk = 0, pkR = 0, pe = 0;
  for (let n = 0; n < r.sig.length; n++) {
    if (!Number.isFinite(r.sig[n]) || !Number.isFinite(r.sigR[n]) || !Number.isFinite(r.env[n])) throw new Error("non-finite graph output");
    pk = Math.max(pk, Math.abs(r.sig[n])); pkR = Math.max(pkR, Math.abs(r.sigR[n])); pe = Math.max(pe, r.env[n]);
  }
  if (r.hits < 4) throw new Error(`graph ${ALGS[alg]}: only ${r.hits} hits`);
  if (!(pk > 0.05) || !(pkR > 0.05) || !(Math.abs(pe - 1) < 1e-9)) throw new Error(`graph ${ALGS[alg]}: peak ${pk} R ${pkR} env ${pe}`);
  const rr = runGraph(alg, { reset: true });
  if (!(rr.hits > r.hits)) throw new Error(`graph ${ALGS[alg]}: Reset jack did not re-strike (${rr.hits} vs ${r.hits})`);
  for (const bs of [1, 64]) {
    const b = runGraph(alg, { block: bs });
    for (let n = 0; n < r.sig.length; n++) if (b.sig[n] !== r.sig[n] || b.sigR[n] !== r.sigR[n]) throw new Error(`graph ${ALGS[alg]}: block ${bs} differs at ${n}`);
  }

}
console.log(`ok ${KEY} graph type=${TYPE} version=${ver}: hits -> ${NAME} L (Left) / ${NAME} R (Right) / Env (Mono), Reset re-strikes, block sizes 1/64/128 identical, every algorithm`);

// --- 3) choice by name ---
const defsSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
const def = (() => {
  const i = defsSrc.indexOf(`\n  ${KEY}: {`);
  if (i < 0) throw new Error(`${KEY} definition not found`);
  let depth = 0, start = -1;
  for (let p = i + 1; p < defsSrc.length; p++) {
    const ch = defsSrc[p];
    if (ch === "{") { if (depth === 0) start = p; depth += 1; }
    else if (ch === "}") { depth -= 1; if (depth === 0) return vm.runInNewContext(`(${defsSrc.slice(start, p + 1)})`); }
  }
  throw new Error("unterminated definition");
})();
{
  if (JSON.stringify(def.inputs) !== JSON.stringify(["Trigger", "Reset"])) throw new Error(`inputs ${JSON.stringify(def.inputs)}`);
  if (JSON.stringify(def.outputs) !== JSON.stringify([`${NAME} L`, `${NAME} R`, "Env"])) throw new Error(`outputs ${JSON.stringify(def.outputs)}`);
  const keys = def.parameters.map((x) => x.key);
  if (JSON.stringify(keys) !== JSON.stringify(["algorithm", ...["tune", "bend", "tone", "bodyDecay", "noise", "amplitude"]])) throw new Error(`params ${keys}`);
  for (const prm of def.parameters.slice(1)) {
    if (String(DEF[prm.key]) !== prm.defaultValue) throw new Error(`default ${prm.key} ${prm.defaultValue} != smoke ${DEF[prm.key]}`);
    if (String(MIN[prm.key]) !== prm.min || String(MAX[prm.key]) !== prm.max) throw new Error(`range ${prm.key}`);
  }
  const ampP = def.parameters.find((x) => x.key === "amplitude");
  if (ampP.min !== "0" || ampP.max !== "1" || ampP.defaultValue !== "1") throw new Error("Amplitude must be 0-1, default 1");
  const metaSrc = fs.readFileSync(path.join(root, "public", "node-graph-slider-metadata.js"), "utf8");
  const a = metaSrc.indexOf("function nodeGraphParameterByKey");
  const z = metaSrc.indexOf("function nodeGraphChoiceSliderValueForKey");
  const ctx = { nodeGraphModuleDefinitions: { [KEY]: def } };
  vm.runInNewContext(`${metaSrc.slice(a, z)}\nthis.idFor = nodeGraphChoiceIdForKey;`, ctx);
  if (def.parameters[0].defaultValue !== "tr808") throw new Error("algorithm default must be 'tr808'");
  ALGS.forEach((nm, id) => {
    const saved = JSON.parse(JSON.stringify({ type: KEY, params: { algorithm: nm } }));
    const got = ctx.idFor(KEY, "algorithm", saved.params.algorithm);
    if (got !== id) throw new Error(`algorithm ${nm} -> ${got}, expected ${id}`);
  });
  console.log(`ok ${KEY} Algorithm persists by name (${ALGS.join(" ")}); inputs ${JSON.stringify(def.inputs)}, outputs [${NAME} L, ${NAME} R, Env]; defaults/ranges match`);
}

// --- 4) live path (real efficient worklet + combined wasm) ---
{
  const rt = fs.readFileSync(path.join(root, "public", "node-graph-live-runtime.js"), "utf8");
  const block = rt.slice(rt.indexOf("const nodeGraphLiveWorkletSourceFilesEfficient"), rt.indexOf("const nodeGraphLiveWorkletSourceFilesLegacy"));
  const files = [...block.matchAll(/"\.\/(public\/[^"?]+)/g)].map((m) => m[1]);
  if (!files.length) throw new Error("live: worklet file list not found");
  const wasm = fs.readFileSync(wasmPath);
  let Proc = null;
  const ctx = { console, sampleRate: SR, currentFrame: 0, currentTime: 0, WebAssembly, performance: { now: () => 0 }, setTimeout, queueMicrotask,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {}, onmessage: null }; } },
    registerProcessor: (_n, c) => { Proc = c; } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + "\n;\nregisterProcessor('node-live', NodeLiveAudioProcessor);\n";
  vm.runInContext("globalThis.NODE_GRAPH_APP_FONTS = [];\n" + src, ctx, { filename: "worklet-efficient.js" });
  const rows4 = [];
  for (const jack of ["Trigger"]) {
    for (let alg = 0; alg < ALGS.length; alg++) {
      const p = new Proc({ processorOptions: {} });
      const bytes = vm.runInContext(`new ArrayBuffer(${wasm.length})`, ctx);
      new Uint8Array(bytes).set(wasm);
      await p.setNativeModuleWasm({ name: "combined", bytes, modules: [{ name: "graph_engine", targetType: "graphEngine" }] });
      p.speedMultiplier = 1;
      p.setPlan({
        nodes: [
          { id: "clk", type: "clock", params: { rate: 4 } },
          { id: "dr", type: KEY, params: { ...DEF, ...{"noise": 0.5}, algorithm: alg } },
          { id: "output", type: "output", params: {} },
        ],
        connections: [
          { sourceNode: "clk", sourcePort: "T", destinationNode: "dr", destinationPort: jack },
          { sourceNode: "dr", sourcePort: `${NAME} L`, destinationNode: "output", destinationPort: "Left" },
          { sourceNode: "dr", sourcePort: `${NAME} R`, destinationNode: "output", destinationPort: "Right" },
        ],
        modulations: [], outputNode: "output",
      }, { efficientProduct: true, sampleRate: SR, planSerial: 1, sessionId: 1 });
      if (!p.nativeGraphCompiled) throw new Error("live: native graph not compiled");
      const lp = p.mapNativeGraphSrcPortId(`${NAME} L`, KEY);
      const rp = p.mapNativeGraphSrcPortId(`${NAME} R`, KEY);
      const ep = p.mapNativeGraphSrcPortId("Env", KEY);
      if (lp !== PORT_LEFT || rp !== PORT_RIGHT || ep !== PORT_MONO) throw new Error(`live: ports L ${lp} R ${rp} Env ${ep}`);
      const ng = p.nativeGraph;
      const h = p.fnv1aHash32("dr");
      let pkL = 0, pkR = 0, dLR = 0, pe = 0, bad = 0;
      for (let q = 0; q < 375; q++) {
        ctx.currentFrame = q * 128;
        const outs = [[new Float32Array(128), new Float32Array(128)]];
        p.process([[]], outs, {});
        const env = new Float64Array(ng.memory.buffer, ng.soemdsp_graph_node_port_ptr(p.nativeGraphHandle, h, ep) | 0, 128);
        for (let i = 0; i < 128; i++) {
          const l = outs[0][0][i], r = outs[0][1][i];
          if (!Number.isFinite(l) || !Number.isFinite(r)) bad += 1;
          pkL = Math.max(pkL, Math.abs(l)); pkR = Math.max(pkR, Math.abs(r));
          dLR = Math.max(dLR, Math.abs(l - r)); pe = Math.max(pe, env[i]);
        }
      }
      if (bad || !(pkL > 0.05) || !(pkR > 0.05) || !(Math.abs(pe - 1) < 1e-9) || (true && !(dLR > 1e-3))) {
        throw new Error(`live ${jack} ${ALGS[alg]}: L ${pkL} R ${pkR} diff ${dLR} env ${pe} nonfinite ${bad}`);
      }
      rows4.push(`${jack}/${ALGS[alg]} L ${pkL.toFixed(3)} R ${pkR.toFixed(3)}`);
    }
  }
  console.log(`ok ${KEY} live worklet: ${NAME} L -> Left, ${NAME} R -> Right, Env peak 1 (${rows4.join(", ")})`);
}
