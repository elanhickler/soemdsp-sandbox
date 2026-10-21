// Resonant Compressor (type 230): Gain at Depth 1 / Mix 1 / Makeup 1 equals
// Resonant Envelope's SC fed the same audio at Trigger (mono: raw In L x
// Sensitivity; stereo: max(|L|, |R|) x Sensitivity; Sidechain replaces it).
// Drum hits come out quieter than they went in.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const cC = must("soemdsp_resonant_compressor_create"), cD = must("soemdsp_resonant_compressor_destroy");
const cS = must("soemdsp_resonant_compressor_sample"), cR = must("soemdsp_resonant_compressor_right");
const cG = must("soemdsp_resonant_compressor_gain"), cE = must("soemdsp_resonant_compressor_env");
const eC = must("soemdsp_resonant_envelope_create"), eD = must("soemdsp_resonant_envelope_destroy");
const eS = must("soemdsp_resonant_envelope_sample"), eSc = must("soemdsp_resonant_envelope_sc");
const ver = must("soemdsp_graph_version")() | 0;
if (ver < 212) throw new Error(`graph version ${ver} < 212`);

const SR = 48000;
let seed = 3;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 * 2 - 1; };
const drumL = [], drumR = [], key = [];
for (let i = 0; i < SR * 2; i++) {
  const t = (i % 24000) / SR, t2 = ((i + 12000) % 24000) / SR;
  const kick = Math.exp(-t * 12) * Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-t * 30)) * t);
  const sn = Math.exp(-t2 * 25) * (0.6 * rnd() + 0.4 * Math.sin(2 * Math.PI * 190 * t2));
  drumL.push(0.5 * kick + 0.5 * sn);
  drumR.push(0.5 * kick + 0.3 * sn);
  key.push(Math.exp(-((i % 6000) / SR) * 40) * Math.sin(i * 0.2));
}
const base = { hz: 440, tracking: 0, res: 0, att: 0.01, dec: 0.3, imp: 0, sens: 8, depth: 1, mix: 1, makeup: 1, det: 5, hold: 0 };
function runComp(o, stereo, sc) {
  const h = cC() | 0; if (!(h > 0)) throw new Error("create");
  const r = { L: [], R: [], G: [], E: [] };
  for (let i = 0; i < drumL.length; i++) {
    r.L.push(cS(h, drumL[i], stereo ? drumR[i] : drumL[i], sc ? key[i] : 0, stereo ? 1 : 0, sc ? 1 : 0,
      o.hz, o.tracking, o.res, o.att, o.dec, o.imp, o.sens, o.depth, o.mix, o.makeup, o.det, o.hold, SR));
    r.R.push(cR(h)); r.G.push(cG(h)); r.E.push(cE(h));
  }
  cD(h);
  return r;
}
function runEnv(o, src) {
  const h = eC() | 0; const sc = [], out = [];
  for (let i = 0; i < src.length; i++) {
    out.push(eS(h, src[i] * o.sens, o.hz, o.att, o.dec, o.res, o.imp, o.tracking, 1, 0, 1, SR, 0, o.det, 0, o.hold));
    sc.push(eSc(h));
  }
  eD(h);
  return { sc, out };
}
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, v === b[i] ? 0 : Math.abs(v - b[i]) || Infinity), 0);
let worst = 0, cases = 0;
const variants = [base];
for (const det of [0, 4, 5]) for (const res of [0, 0.7]) for (const imp of [0, 0.5]) for (const sens of [1, 4, 16]) for (const hold of [0, 1])
  variants.push({ ...base, det, res, imp, sens, hold, tracking: res ? 0.5 : 0, hz: res ? 1200 : 440, att: imp ? 0.002 : 0.01, dec: imp ? 0.1 : 0.3 });
for (const o of variants) {
  const mono = runComp(o, false, false), em = runEnv(o, drumL);
  const st = runComp(o, true, false), es = runEnv(o, drumL.map((v, i) => Math.max(Math.abs(v), Math.abs(drumR[i]))));
  const sc = runComp(o, true, true), ek = runEnv(o, key);
  worst = Math.max(worst, maxDiff(mono.G, em.sc), maxDiff(mono.E, em.out), maxDiff(st.G, es.sc), maxDiff(sc.G, ek.sc));
  cases += 3;
}
if (worst !== 0) throw new Error(`Gain != Resonant Envelope SC (max diff ${worst})`);
console.log(`ok resonant compressor Gain == Resonant Envelope SC: ${cases} cases x ${drumL.length} samples, max diff 0`);

const d = runComp(base, true, false);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const minG = Math.min(...d.G);
const pIn = peak(drumL), pOut = peak(d.L), rIn = rms(drumL), rOut = rms(d.L);
if (!(minG < 0.8)) throw new Error(`drum gain reduction too small (min gain ${minG})`);
if (!(pOut <= pIn && rOut < rIn * 0.97)) throw new Error(`drums not quieter (peak ${pIn}->${pOut}, rms ${rIn}->${rOut})`);
if (!d.G.every((g, i) => d.L[i] === drumL[i] * g && d.R[i] === drumR[i] * g)) throw new Error("Out != In x Gain at Depth 1 / Mix 1 / Makeup 1");
const db = (x) => (20 * Math.log10(x)).toFixed(2);
console.log(`ok resonant compressor drums: min gain ${minG.toFixed(3)} (${db(minG)} dB), peak ${pIn.toFixed(3)} -> ${pOut.toFixed(3)} (${db(pOut / pIn)} dB), rms ${rIn.toFixed(4)} -> ${rOut.toFixed(4)} (${db(rOut / rIn)} dB)`);

const o2 = { ...base, depth: 0.5, mix: 0.25, makeup: 2.5 };
const d2 = runComp(o2, false, false), e2 = runEnv(o2, drumL);
for (let i = 0; i < drumL.length; i++) {
  const g = e2.sc[i] * 0.5 + 0.5;
  const want = (drumL[i] * 0.75 + drumL[i] * g * 0.25) * 2.5;
  if (d2.G[i] !== g || Math.abs(d2.L[i] - want) > 1e-15) throw new Error(`Depth / Mix / Makeup formula at ${i}`);
}
const off = runComp({ ...base, depth: 0 }, false, false);
if (!off.L.every((v, i) => v === drumL[i])) throw new Error("Depth 0 should pass the input through");
console.log(`ok resonant compressor Depth / Mix / Makeup (Makeup 2.5 peak ${peak(d2.L).toFixed(3)}, not clamped), version=${ver}`);

// Graph: Clock -> Resonant Compressor In L and -> Resonant Envelope Trigger;
// Gain (Saw port) == SC (Saw port) sample for sample; Out R follows In L when In R is unwired.
{
  const mem = e.memory;
  const g = must("soemdsp_graph_create")() | 0;
  const add = must("soemdsp_graph_add_node"), connect = must("soemdsp_graph_connect");
  const setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
  const processBlock = must("soemdsp_graph_process_block"), portPtr = must("soemdsp_graph_node_port_ptr");
  must("soemdsp_graph_set_sample_rate")(g, SR);
  const TYPE_CLOCK = 28, TYPE_ENV = 221, TYPE_COMP = 230;
  const PORT_MONO = 0, PORT_RIGHT = 2, PORT_SAW = 3, PORT_SQUARE = 5;
  const hClk = 0x6c01, hEnv = 0x6c02, hComp = 0x6c03;
  if ((add(g, hClk, TYPE_CLOCK) | 0) !== 0) throw new Error("clock add");
  if ((add(g, hEnv, TYPE_ENV) | 0) !== 0) throw new Error("env add");
  if ((add(g, hComp, TYPE_COMP) | 0) !== 0) throw new Error("compressor add");
  if ((connect(g, hClk, PORT_MONO, hEnv, PORT_MONO) | 0) !== 0) throw new Error("clk->env");
  if ((connect(g, hClk, PORT_MONO, hComp, PORT_MONO) | 0) !== 0) throw new Error("clk->comp");
  setParam(g, hClk, 10, 5);
  setParam(g, hEnv, 56, 5);    // Trigger Detect Abs rise
  setParam(g, hComp, 51, 1);   // Sensitivity 1
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  must("soemdsp_graph_snap_controls")(g);
  let diff = 0, minG = 1, rDiff = 0;
  for (let q = 0; q < 750; q++) {
    processBlock(g, 128);
    const sc = new Float64Array(mem.buffer, portPtr(g, hEnv, PORT_SAW) | 0, 128).slice();
    const gn = new Float64Array(mem.buffer, portPtr(g, hComp, PORT_SAW) | 0, 128).slice();
    const oL = new Float64Array(mem.buffer, portPtr(g, hComp, PORT_MONO) | 0, 128).slice();
    const oR = new Float64Array(mem.buffer, portPtr(g, hComp, PORT_RIGHT) | 0, 128).slice();
    const en = new Float64Array(mem.buffer, portPtr(g, hComp, PORT_SQUARE) | 0, 128).slice();
    for (let i = 0; i < 128; i++) {
      diff = Math.max(diff, Math.abs(sc[i] - gn[i]));
      rDiff = Math.max(rDiff, Math.abs(oL[i] - oR[i]));
      minG = Math.min(minG, gn[i]);
      if (!Number.isFinite(en[i])) throw new Error("Env non-finite");
    }
  }
  must("soemdsp_graph_destroy")(g);
  if (diff !== 0) throw new Error(`graph Gain != Resonant Envelope SC (${diff})`);
  if (rDiff !== 0) throw new Error(`mono Out R != Out L (${rDiff})`);
  if (!(minG < 0.5)) throw new Error(`graph gain never dropped (${minG})`);
  console.log(`ok resonant compressor graph: Gain == Resonant Envelope SC (max diff 0), min gain ${minG.toFixed(3)}`);
}
