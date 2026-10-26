// Pulse Train Shape → Output Mono (bugs/pusle train not producing output.json).
// Loop / Saw / 1 Hz / Duty 0.5 / Count 12 must put energy on the speaker bus
// with no Trigger cable. One shot with no Trigger stays silent.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {
  env: { emo_process_block: () => 0 },
});
const e = instance.exports;

const TYPE_PT = 231;
const TYPE_OUT = 6;
const P = {
  volumeDb: 0,
  pan: 1,
  amp: 12,
  shape: 13,
  mode: 21,
  stages: 22,
  width: 31,
  oversample: 32,
  mix: 40,
  seed: 48,
  tnum: 52,
  tden: 53,
  timing: 54,
  lfoStyle: 56,
  waveform: 11,
  inLow: 80,
  inHigh: 81,
};
const PORT = { mono: 0, left: 1, right: 2 };

const fnv = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

function peakAt(ptr, n) {
  const view = new Float64Array(e.memory.buffer, ptr, n);
  let p = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(view[i] || 0);
    if (v > p) p = v;
    if (v > 1e-12) nz += 1;
  }
  return { p, nz };
}

function run({ sr, loop, seconds = 1.2, connectShape = true, volumeDb = 0 }) {
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, sr);
  const hPt = fnv("pulseTrain-1");
  const hOut = fnv("output");
  if (e.soemdsp_graph_add_node(g, hPt, TYPE_PT)) throw new Error("add pulseTrain");
  if (e.soemdsp_graph_add_node(g, hOut, TYPE_OUT)) throw new Error("add output");
  const vals = [
    [P.stages, 12],
    [P.tden, 1],
    [P.tnum, 0.5],
    [P.shape, 3],
    [P.inLow, 1],
    [P.inHigh, 0.2],
    [P.width, 0],
    [P.amp, 1],
    [P.timing, loop],
    [P.mode, 0],
    [P.lfoStyle, 0],
    [P.waveform, 0],
    [P.seed, 7410985],
    [P.oversample, 2],
    [P.mix, 0.5],
    [P.volumeDb, volumeDb],
    [P.pan, 0],
  ];
  for (const [id, v] of vals) e.soemdsp_graph_set_param(g, id === P.volumeDb || id === P.pan ? hOut : hPt, id, v);
  if (connectShape) {
    const rc = e.soemdsp_graph_connect(g, hPt, PORT.mono, hOut, PORT.mono) | 0;
    if (rc) throw new Error(`connect Shape→Mono ${rc}`);
  }
  if (e.soemdsp_graph_compile(g)) throw new Error("compile");
  e.soemdsp_graph_snap_controls(g);
  let pt = { p: 0, nz: 0 };
  let busL = { p: 0, nz: 0 };
  let busR = { p: 0, nz: 0 };
  const frames = 128;
  const blocks = Math.ceil((seconds * sr) / frames);
  for (let q = 0; q < blocks; q++) {
    const n = e.soemdsp_graph_process_block(g, frames) | 0;
    if (n < 1) throw new Error(`process_block ${n}`);
    const a = peakAt(e.soemdsp_graph_node_port_ptr(g, hPt, PORT.mono) | 0, n);
    const l = peakAt(e.soemdsp_graph_block_output_left_ptr(g) | 0, n);
    const r = peakAt(e.soemdsp_graph_block_output_right_ptr(g) | 0, n);
    pt = { p: Math.max(pt.p, a.p), nz: pt.nz + a.nz };
    busL = { p: Math.max(busL.p, l.p), nz: busL.nz + l.nz };
    busR = { p: Math.max(busR.p, r.p), nz: busR.nz + r.nz };
  }
  e.soemdsp_graph_destroy(g);
  return { pt, busL, busR };
}

const check = (ok, msg) => {
  if (!ok) throw new Error(msg);
  console.log(`ok pulseTrain output ${msg}`);
};

for (const sr of [48000, 88200]) {
  const loop = run({ sr, loop: 1 });
  check(loop.pt.p > 0.1 && loop.pt.nz > 1000, `Loop Saw 1 Hz @ ${sr}: Shape peak ${loop.pt.p} nz ${loop.pt.nz}`);
  check(
    loop.busL.p > 0.1 && loop.busR.p > 0.1 && loop.busL.nz > 1000,
    `Loop Saw 1 Hz @ ${sr}: Output L/R peak ${loop.busL.p}/${loop.busR.p} nz ${loop.busL.nz}`,
  );
  const one = run({ sr, loop: 0, seconds: 0.5 });
  check(one.pt.p === 0 && one.busL.p === 0, `One shot no Trigger @ ${sr}: silent (peak ${one.pt.p})`);
}

{
  const mutedCable = run({ sr: 48000, loop: 1, connectShape: false });
  check(mutedCable.pt.p > 0.1, `unwired Output: Pulse Train still runs (peak ${mutedCable.pt.p})`);
  check(mutedCable.busL.p === 0 && mutedCable.busR.p === 0, "unwired Output: speaker bus silent");
}

{
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const i = defs.indexOf("\n  pulseTrain: {");
  check(i >= 0, "pulseTrain definition present");
  const slice = defs.slice(i, i + 800);
  check(/planRole:\s*"source"/.test(slice), "pulseTrain planRole source (Loop free-runs without Trigger)");
  check(/planFreeRun:\s*true/.test(slice), "pulseTrain planFreeRun");
  const map = fs.readFileSync(path.join(root, "public", "node-live-audio-worklet-native-graph.js"), "utf8");
  const m = map.indexOf('if (t === "pulseTrain")');
  check(m >= 0, "mapNativeGraphParamId pulseTrain");
  const block = map.slice(m, m + 900);
  check(/frequency.*TIME_DENOMINATOR/.test(block), "Frequency → Time Denominator (cycle Hz)");
  check(/duty.*TIME_NUMERATOR/.test(block), "Duty → Time Numerator");
  check(/stretch.*OFFSET_MS/.test(block), "Stretch → Offset Ms");
  check(/mode.*TIMING_MODE/.test(block), "Mode → Timing Mode (Loop), not Recalc MODE");
}

console.log(`ok pulseTrain Shape→Output Loop/Saw/1Hz (graph ${e.soemdsp_graph_version()})`);
