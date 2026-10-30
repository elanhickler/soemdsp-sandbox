// Softpop Oscillator / Softpop Filter: an audio-rate source into Amplitude
// (ParamModEdge) must scale the output per sample, not once per 128-sample
// quantum. Gain = modded / unmodded render (same seed, same noise), which must
// track the mod source sample for sample with no 128-sample plateaus.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing ${n}`); return e[n]; };
const create = must("soemdsp_graph_create");
const destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const clearMods = must("soemdsp_graph_clear_param_mod_edges");
const addMod = must("soemdsp_graph_add_param_mod_edge");
const compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");

const TYPE = { polyBlep: 1, out: 6, bias: 12, expAdsr: 70, softpopOscillator: 207, softpopFilter: 214 };
const PARAM = { frequency: 10, amplitude: 12, attOffset: 71 };
const PORT = { mono: 0, saw: 3 };
const FRAMES = 128;
const QUANTA = 60;

function render(type, source, withMod) {
  const g = create() | 0;
  setSr(g, 48000);
  const sp = 0x5f01, src = 0x5f02, gate = 0x5f03, out = 0x5f04;
  if (add(g, sp, type)) throw new Error(`add ${type}`);
  if (add(g, out, TYPE.out)) throw new Error("add out");
  connect(g, sp, PORT.mono, out, PORT.mono);
  let srcPort = PORT.mono;
  if (source === "ramp") {
    // 3 Hz PolyBLEP saw at 0.5: a per-sample ramp.
    add(g, src, TYPE.polyBlep);
    setParam(g, src, PARAM.frequency, 3);
    setParam(g, src, PARAM.amplitude, 0.5);
    srcPort = PORT.saw;
  } else {
    add(g, src, TYPE.expAdsr);
    add(g, gate, TYPE.bias);
    setParam(g, gate, PARAM.attOffset, 1);
    connect(g, gate, PORT.mono, src, PORT.mono);
  }
  setParam(g, sp, PARAM.frequency, 440);
  setParam(g, sp, PARAM.amplitude, withMod ? 0 : 1);
  clearMods(g);
  if (withMod && addMod(g, src, srcPort, sp, PARAM.amplitude)) throw new Error("mod edge");
  if (compile(g)) throw new Error("compile");
  snap(g);
  const y = [], m = [];
  for (let q = 0; q < QUANTA; q++) {
    processBlock(g, FRAMES);
    y.push(...new Float64Array(e.memory.buffer, portPtr(g, sp, PORT.mono) | 0, FRAMES));
    m.push(...new Float64Array(e.memory.buffer, portPtr(g, src, srcPort) | 0, FRAMES));
  }
  destroy(g);
  return { y, m };
}

let failures = 0;
for (const [label, type] of [["Softpop Oscillator", TYPE.softpopOscillator], ["Softpop Filter", TYPE.softpopFilter]]) {
  for (const source of ["ramp", "envelope"]) {
    const ref = render(type, source, false);
    const mod = render(type, source, true);
    let pts = 0, maxErr = 0, run = 0, maxRun = 0, prevGain = null, srcMoves = 0;
    for (let i = FRAMES; i < ref.y.length; i++) {
      if (Math.abs(ref.y[i]) < 0.25) { prevGain = null; run = 0; continue; }
      const gain = mod.y[i] / ref.y[i];
      // Mod source runs before Softpop in the same quantum, so gain == source.
      maxErr = Math.max(maxErr, Math.abs(gain - mod.m[i]));
      pts += 1;
      if (i > 0 && mod.m[i] !== mod.m[i - 1]) srcMoves += 1;
      if (prevGain !== null && Math.abs(gain - prevGain) < 1e-12 && mod.m[i] !== mod.m[i - 1]) {
        run += 1;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 0;
      }
      prevGain = gain;
    }
    const ok = pts > 1000 && srcMoves > 1000 && maxErr < 1e-9 && maxRun < 8;
    console.log({ module: label, source, pts, srcMoves, maxErr, maxHeldRun: maxRun, ok });
    if (!ok) failures += 1;
  }
}
if (failures) throw new Error(`Softpop Amplitude MOD is not per-sample (${failures} case(s))`);
console.log("smoke_softpop_amp_mod_per_sample ok");
