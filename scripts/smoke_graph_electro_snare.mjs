// Headless: Electro Snare (electroSnare, type 222), docs/SNARE_PLAN.md.
// 1) Direct export, every algorithm: silent before Trigger (Reset too), a hit
//    sounds, Env peaks at v and reaches exact 0, no dead knobs, Reset mid-hit
//    restarts bit-exact, no NaN / sub-Planck values.
//    Stereo: Snare L / Snare R. Noise (and Modal / FM noise-like parts) differ
//    L/R; Snappy 0 + Tone 0 is bit-identical L/R; Reset bit-exact on both;
//    equal level per channel.
// 2) Graph: clock -> Trigger (and Reset) -> Snare L on Left, Snare R on Right,
//    Env on Mono.
// 3) Algorithm choice persists by name and resolves to the native choiceId.
// 4) Live path: the real efficient worklet + combined wasm, Snare L / R wired
//    to the output's Left / Right.
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
const kCreate = must("soemdsp_electro_snare_create");
const kDestroy = must("soemdsp_electro_snare_destroy");
const kSample = must("soemdsp_electro_snare_sample");
const kEnv = must("soemdsp_electro_snare_env");
const kRight = must("soemdsp_electro_snare_right");
const SR = 48000;
const ALGS = ["tr808", "tr909", "simmons", null, "fm"];  // id 3 (Modal) moved to Modal Snare
const DEF = { tune: 180, tone: 0.5, snappy: 0.5, bodyDecay: 0.25, snapDecay: 0.2, bend: 0, amplitude: 1 };
const KNOB = { tune: 300, tone: 0.9, snappy: 0.1, bodyDecay: 0.6, snapDecay: 0.05, bend: 1, amplitude: 0.5 };
const PLANCK = 1e-7;

function render(alg, p, n, events) {
  const h = kCreate() | 0;
  if (!(h > 0)) throw new Error("create");
  const out = new Float64Array(n);
  const outR = new Float64Array(n);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ev = events[i] || {};
    out[i] = kSample(h, ev.t || 0, ev.r || 0, alg, p.tune, p.tone, p.snappy, p.bodyDecay, p.snapDecay, p.bend, p.amplitude, SR);
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
const rows = [];
const stereo = [];
for (let alg = 0; alg < ALGS.length; alg++) {
  if (!ALGS[alg]) continue;
  const name = ALGS[alg];
  const V = 0.7;
  // Silent before Trigger, Reset alone is silent.
  {
    const ev = {}; ev[200] = { r: 1 }; ev[201] = { r: 0 };
    const s = render(alg, DEF, 2000, ev);
    for (let i = 0; i < 2000; i++) if (s.out[i] !== 0 || s.outR[i] !== 0 || s.env[i] !== 0) throw new Error(`${name}: not silent before Trigger (${i})`);
  }
  // One hit at sample 100.
  const N = 10 * SR;
  const ev = {}; ev[100] = { t: V }; ev[101] = { t: 0 };
  const a = render(alg, DEF, N, ev);
  clean(`${name} out`, a.out); clean(`${name} outR`, a.outR); clean(`${name} env`, a.env);
  for (let i = 0; i < 100; i++) if (a.out[i] !== 0 || a.outR[i] !== 0 || a.env[i] !== 0) throw new Error(`${name}: sound before Trigger`);
  if (Math.abs(a.env[100] - V) > 1e-12) throw new Error(`${name}: Env at hit ${a.env[100]} != v ${V}`);
  let peakEnv = 0, peakOut = 0, zeroAt = -1;
  for (let i = 0; i < N; i++) {
    peakEnv = Math.max(peakEnv, a.env[i]);
    peakOut = Math.max(peakOut, Math.abs(a.out[i]));
    if (i > 100 && zeroAt < 0 && a.env[i] === 0) zeroAt = i;
    if (zeroAt > 0 && (a.env[i] !== 0 || a.out[i] !== 0 || a.outR[i] !== 0)) throw new Error(`${name}: not exact 0 after rest (${i})`);
  }
  if (Math.abs(peakEnv - V) > 1e-12) throw new Error(`${name}: Env peak ${peakEnv} != v`);
  if (!(zeroAt > 0)) throw new Error(`${name}: Env never reached exact 0`);
  if (!(peakOut > 0.05)) throw new Error(`${name}: hit too quiet ${peakOut}`);
  // No dead knobs.
  const L = Math.round(0.4 * SR);
  const base = render(alg, DEF, L, ev);
  const knobs = {};
  for (const k of Object.keys(KNOB)) {
    const p = { ...DEF, [k]: KNOB[k] };
    const b = render(alg, p, L, ev);
    let d = 0;
    for (let i = 0; i < L; i++) d = Math.max(d, Math.abs(b.out[i] - base.out[i]));
    knobs[k] = d;
    if (!(d > 1e-3)) throw new Error(`${name}: dead knob ${k} (max diff ${d})`);
  }
  // Reset mid-hit restarts bit-exact (noise reseeded) and Env returns to v.
  {
    const R0 = 100 + 3000;
    const ev2 = {}; ev2[100] = { t: V }; ev2[101] = { t: 0 }; ev2[R0] = { r: 1 }; ev2[R0 + 1] = { r: 0 };
    const b = render(alg, DEF, R0 + L, ev2);
    if (Math.abs(b.env[R0] - V) > 1e-12) throw new Error(`${name}: Env after Reset ${b.env[R0]} != v`);
    for (let i = 0; i < L - 200; i++) {
      if (b.out[R0 + i] !== a.out[100 + i]) throw new Error(`${name}: Reset hit differs at +${i} (${b.out[R0 + i]} vs ${a.out[100 + i]})`);
      if (b.outR[R0 + i] !== a.outR[100 + i]) throw new Error(`${name}: Reset hit R differs at +${i} (${b.outR[R0 + i]} vs ${a.outR[100 + i]})`);
    }
  }
  // Stereo: noise differs L/R, equal level per channel.
  let dLR = 0, eL = 0, eR = 0;
  for (let i = 0; i < L; i++) { dLR = Math.max(dLR, Math.abs(a.out[i] - a.outR[i])); eL += a.out[i] * a.out[i]; eR += a.outR[i] * a.outR[i]; }
  const dB = 10 * Math.log10(eR / eL);
  if (!(dLR > 1e-3)) throw new Error(`${name}: L == R with Snappy 0.5 (max diff ${dLR})`);
  if (!(Math.abs(dB) < 1.5)) throw new Error(`${name}: R level ${dB.toFixed(2)} dB vs L`);
  // Tonal only (Snappy 0, Tone 0): L == R bit-exact.
  const tonal = render(alg, { ...DEF, snappy: 0, tone: 0 }, L, ev);
  for (let i = 0; i < L; i++) if (tonal.out[i] !== tonal.outR[i]) throw new Error(`${name}: tonal-only L != R at ${i} (${tonal.out[i]} vs ${tonal.outR[i]})`);
  // Snappy 0, Tone 0.9: Modal / FM noise-like parts still stereo; others identical.
  const hiTone = render(alg, { ...DEF, snappy: 0, tone: 0.9 }, L, ev);
  let dTone = 0;
  for (let i = 0; i < L; i++) dTone = Math.max(dTone, Math.abs(hiTone.out[i] - hiTone.outR[i]));
  if ((alg === 3 || alg === 4) ? !(dTone > 1e-3) : dTone !== 0) throw new Error(`${name}: Snappy 0 Tone 0.9 L/R diff ${dTone}`);
  stereo.push(`${name} L/R diff ${dLR.toFixed(3)} R/L ${dB.toFixed(2)} dB tone0.9 diff ${dTone.toFixed(3)}`);
  rows.push(`${name}: peak ${peakOut.toFixed(3)} restAt ${(zeroAt / SR).toFixed(2)}s knobs ${Object.entries(knobs).map(([k, d]) => `${k}=${d.toFixed(3)}`).join(" ")}`);
}
for (const r of rows) console.log(`ok ${r}`);
for (const r of stereo) console.log(`ok stereo ${r}`);
console.log("ok electroSnare direct: silent before Trigger, Env peaks at v and rests at exact 0, no dead knobs, Reset bit-exact L and R, Planck-clean, noise stereo, tonal-only L == R");

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
const TYPE_CLOCK = 28, TYPE_OUT = 6, TYPE_SNARE = 222;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RIGHT = 2, PORT_RESET = 19, PORT_TRIGGER = 20;
const P = { FREQUENCY: 10, WAVEFORM: 11, AMPLITUDE: 12, SHAPE: 13, CENTER: 30, WIDTH: 31, TIME_NUMERATOR: 52, TIME_DENOMINATOR: 53 };
const ver = version() | 0;
if (ver < 186) throw new Error(`graph version ${ver} < 186 (electroSnare stereo)`);
function runGraph(alg, { reset = false } = {}) {
  const g = create() | 0;
  setSr(g, SR);
  const hClk = 0x5a01 >>> 0, hSn = 0x5a02 >>> 0, hOut = 0x5a03 >>> 0, hClk2 = 0x5a04 >>> 0;
  if ((add(g, hClk, TYPE_CLOCK) | 0) !== 0) throw new Error("clock add");
  if ((add(g, hSn, TYPE_SNARE) | 0) !== 0) throw new Error("electroSnare add");
  if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("out add");
  if ((connect(g, hClk, PORT_MONO, hSn, PORT_TRIGGER) | 0) !== 0) throw new Error("clk->Trigger");
  if (reset) {
    if ((add(g, hClk2, TYPE_CLOCK) | 0) !== 0) throw new Error("clock2 add");
    if ((connect(g, hClk2, PORT_MONO, hSn, PORT_RESET) | 0) !== 0) throw new Error("clk2->Reset");
    setParam(g, hClk2, P.FREQUENCY, 7);
  }
  if ((connect(g, hSn, PORT_LEFT, hOut, PORT_LEFT) | 0) !== 0) throw new Error("snare L->out");
  if ((connect(g, hSn, PORT_RIGHT, hOut, PORT_RIGHT) | 0) !== 0) throw new Error("snare R->out");
  setParam(g, hClk, P.FREQUENCY, 3);
  setParam(g, hSn, P.WAVEFORM, alg);
  setParam(g, hSn, P.FREQUENCY, 180);
  setParam(g, hSn, P.SHAPE, 0.5);
  setParam(g, hSn, P.WIDTH, 0.5);
  setParam(g, hSn, P.TIME_NUMERATOR, 0.25);
  setParam(g, hSn, P.TIME_DENOMINATOR, 0.2);
  setParam(g, hSn, P.CENTER, 0);
  setParam(g, hSn, P.AMPLITUDE, 1);
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);
  const sig = [], sigR = [], env = [];
  for (let q = 0; q < 750; q++) {
    process(g, 128);
    const sb = new Float64Array(mem.buffer, portPtr(g, hSn, PORT_LEFT) | 0, 128);
    const rb = new Float64Array(mem.buffer, portPtr(g, hSn, PORT_RIGHT) | 0, 128);
    const eb = new Float64Array(mem.buffer, portPtr(g, hSn, PORT_MONO) | 0, 128);
    for (let i = 0; i < 128; i++) { sig.push(sb[i]); sigR.push(rb[i]); env.push(eb[i]); }
  }
  destroy(g);
  let hits = 0;
  for (let n = 1; n < env.length; n++) if (env[n] > 0.999 && env[n - 1] < 0.999) hits += 1;
  return { sig, sigR, env, hits };
}
for (let alg = 0; alg < ALGS.length; alg++) {
  if (!ALGS[alg]) continue;
  const r = runGraph(alg);
  let pk = 0, pkR = 0, pe = 0, dLR = 0;
  for (let n = 0; n < r.sig.length; n++) {
    if (!Number.isFinite(r.sig[n]) || !Number.isFinite(r.sigR[n]) || !Number.isFinite(r.env[n])) throw new Error("non-finite graph output");
    pk = Math.max(pk, Math.abs(r.sig[n]));
    pkR = Math.max(pkR, Math.abs(r.sigR[n]));
    dLR = Math.max(dLR, Math.abs(r.sig[n] - r.sigR[n]));
    pe = Math.max(pe, r.env[n]);
  }
  if (!(pkR > 0.05) || !(dLR > 1e-3)) throw new Error(`graph ${ALGS[alg]}: Snare R peak ${pkR}, L/R diff ${dLR}`);
  if (r.hits < 4) throw new Error(`graph ${ALGS[alg]}: only ${r.hits} hits`);
  if (!(pk > 0.05) || !(Math.abs(pe - 1) < 1e-9)) throw new Error(`graph ${ALGS[alg]}: peak ${pk} env ${pe}`);
  const rr = runGraph(alg, { reset: true });
  if (!(rr.hits > r.hits)) throw new Error(`graph ${ALGS[alg]}: Reset jack did not re-strike (${rr.hits} vs ${r.hits})`);
}
console.log(`ok electroSnare graph type=${TYPE_SNARE} version=${ver}: Trigger + Reset -> Snare L (Left) / Snare R (Right) / Env (Mono), every algorithm`);

// --- 3) choice by name ---
{
  const defsSrc = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const i = defsSrc.indexOf("\n  electroSnare: {");
  if (i < 0) throw new Error("electroSnare definition not found");
  let depth = 0, start = -1, body = "";
  for (let p = i + 1; p < defsSrc.length; p++) {
    const ch = defsSrc[p];
    if (ch === "{") { if (depth === 0) start = p; depth += 1; }
    else if (ch === "}") { depth -= 1; if (depth === 0) { body = defsSrc.slice(start, p + 1); break; } }
  }
  const def = vm.runInNewContext(`(${body})`);
  if (JSON.stringify(def.inputs) !== JSON.stringify(["Trigger", "Reset"])) throw new Error(`inputs ${JSON.stringify(def.inputs)}`);
  if (JSON.stringify(def.outputs) !== JSON.stringify(["Snare L", "Snare R", "Env"])) throw new Error(`outputs ${JSON.stringify(def.outputs)}`);
  const keys = def.parameters.map((x) => x.key);
  if (JSON.stringify(keys) !== JSON.stringify(["algorithm", "tune", "tone", "snappy", "bodyDecay", "snapDecay", "bend", "amplitude"])) throw new Error(`params ${keys}`);
  const metaSrc = fs.readFileSync(path.join(root, "public", "node-graph-slider-metadata.js"), "utf8");
  const a = metaSrc.indexOf("function nodeGraphParameterByKey");
  const z = metaSrc.indexOf("function nodeGraphChoiceSliderValueForKey");
  const ctx = { nodeGraphModuleDefinitions: { electroSnare: def } };
  vm.runInNewContext(`${metaSrc.slice(a, z)}\nthis.idFor = nodeGraphChoiceIdForKey;`, ctx);
  const algP = def.parameters[0];
  if (algP.defaultValue !== "tr808") throw new Error("algorithm default must be 'tr808'");
  ALGS.forEach((nm, id) => {
    if (!nm) return;
    const saved = JSON.parse(JSON.stringify({ type: "electroSnare", params: { algorithm: nm } }));
    const got = ctx.idFor("electroSnare", "algorithm", saved.params.algorithm);
    if (got !== id) throw new Error(`algorithm ${nm} -> ${got}, expected ${id}`);
  });
  console.log("ok electroSnare Algorithm persists by name (tr808 tr909 simmons fm); inputs [Trigger, Reset], outputs [Snare L, Snare R, Env]");
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
  for (let alg = 0; alg < ALGS.length; alg++) {
  if (!ALGS[alg]) continue;
    const p = new Proc({ processorOptions: {} });
    const bytes = vm.runInContext(`new ArrayBuffer(${wasm.length})`, ctx);
    new Uint8Array(bytes).set(wasm);
    await p.setNativeModuleWasm({ name: "combined", bytes, modules: [{ name: "graph_engine", targetType: "graphEngine" }] });
    p.speedMultiplier = 1;
    p.setPlan({
      nodes: [
        { id: "clk", type: "clock", params: { rate: 4 } },
        { id: "sn", type: "electroSnare", params: { algorithm: alg, tune: 180, tone: 0.5, snappy: 0.5, bodyDecay: 0.25, snapDecay: 0.2, bend: 0, amplitude: 1 } },
        { id: "output", type: "output", params: {} },
      ],
      connections: [
        { sourceNode: "clk", sourcePort: "T", destinationNode: "sn", destinationPort: "Trigger" },
        { sourceNode: "sn", sourcePort: "Snare L", destinationNode: "output", destinationPort: "Left" },
        { sourceNode: "sn", sourcePort: "Snare R", destinationNode: "output", destinationPort: "Right" },
      ],
      modulations: [], outputNode: "output",
    }, { efficientProduct: true, sampleRate: SR, planSerial: 1, sessionId: 1 });
    if (!p.nativeGraphCompiled) throw new Error("live: native graph not compiled");
    const lp = p.mapNativeGraphSrcPortId("Snare L", "electroSnare");
    const rp = p.mapNativeGraphSrcPortId("Snare R", "electroSnare");
    const ep = p.mapNativeGraphSrcPortId("Env", "electroSnare");
    if (lp !== PORT_LEFT || rp !== PORT_RIGHT || ep !== PORT_MONO) throw new Error(`live: ports L ${lp} R ${rp} Env ${ep}`);
    const ng = p.nativeGraph;
    const h = p.fnv1aHash32("sn");
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
    if (bad || !(pkL > 0.05) || !(pkR > 0.05) || !(dLR > 1e-3) || !(Math.abs(pe - 1) < 1e-9)) {
      throw new Error(`live ${ALGS[alg]}: L ${pkL} R ${pkR} diff ${dLR} env ${pe} nonfinite ${bad}`);
    }
    rows4.push(`${ALGS[alg]} L ${pkL.toFixed(3)} R ${pkR.toFixed(3)}`);
  }
  console.log(`ok electroSnare live worklet: Snare L -> Left, Snare R -> Right, Env peak 1 (${rows4.join(", ")})`);
}
