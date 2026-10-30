// Headless: Vactrol Retrigger + Recalc On Trig (native vactrol_envelope + graph type 156).
// On:  knob changes are ignored until a rising Retrigger edge, then take effect.
// Off: knob changes are live on the very next sample.
// Retrigger never resets the level. Graph: unconnected Retrigger = live knobs.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const vCreate = must("soemdsp_vactrol_envelope_create");
const vDestroy = must("soemdsp_vactrol_envelope_destroy");
const vSample = must("soemdsp_vactrol_envelope_sample");
if ((must("soemdsp_vactrol_envelope_version")() | 0) < 4) throw new Error("vactrol version < 4");
const SR = 48000;
const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));

// Light = 1 constant; attack 0.05 s. At n=1000 Sensitivity drops 1 -> 0.3 and Attack -> 0.
// Retrigger rising edge at n=3000 (one-sample pulse).
const RT = 3000, CH = 1000, N = 3000 + SR; // 1 s (10 release time constants) after Retrigger
function run(recalc, change) {
  const h = vCreate() | 0;
  const out = [];
  for (let n = 0; n < N; n++) {
    const after = change && n >= CH;
    const sens = after ? 0.3 : 1;
    const atk = after ? 0 : 0.05;
    const rt = n === RT ? 1 : 0;
    out.push(vSample(h, 1, rt, atk, 0.1, 1, sens, 0, recalc, SR));
  }
  vDestroy(h);
  return out;
}
// On
const onBase = run(1, false), onChg = run(1, true);
if (!same(onBase.slice(0, RT), onChg.slice(0, RT))) throw new Error("On: knob change leaked before Retrigger");
if (Object.is(onBase[RT], onChg[RT])) throw new Error("On: Retrigger did not latch new knobs");
if (!(Math.abs(onChg[N - 1] - 0.3) < 1e-3)) throw new Error(`On: should settle to new target 0.3, got ${onChg[N - 1]}`);
if (!(onChg[RT - 1] > 0.3)) throw new Error("On: level before Retrigger should be above new target");
console.log(`ok On: identical for ${RT} samples after knob change; Retrigger latched (pre=${onChg[RT - 1].toFixed(4)} post=${onChg[RT].toFixed(4)})`);
// Off
const offBase = run(0, false), offChg = run(0, true);
if (!same(offBase.slice(0, CH), offChg.slice(0, CH))) throw new Error("Off: differs before knob change");
if (Object.is(offBase[CH], offChg[CH])) throw new Error("Off: knob change not live on the same sample");
console.log(`ok Off: knob change live at sample ${CH}`);
// Retrigger never resets level: same knobs, edge mid-attack -> identical to no edge.
{
  const a = vCreate() | 0, b = vCreate() | 0;
  for (let n = 0; n < 2000; n++) {
    const ya = vSample(a, 1, 0, 0.05, 0.1, 1, 1, 0, 1, SR);
    const yb = vSample(b, 1, n === 500 ? 1 : 0, 0.05, 0.1, 1, 1, 0, 1, SR);
    if (!Object.is(ya, yb)) throw new Error(`Retrigger changed level at n=${n}`);
  }
  vDestroy(a); vDestroy(b);
  console.log("ok Retrigger does not reset the level");
}
// Model is latched too.
{
  const h = vCreate() | 0, r = vCreate() | 0;
  for (let n = 0; n < 200; n++) { vSample(h, 1, 0, 0, 0.1, 1, 1, 0, 1, SR); vSample(r, 1, 0, 0, 0.1, 1, 1, 0, 1, SR); }
  for (let n = 0; n < 2000; n++) {
    const yh = vSample(h, 0, 0, 0, 0.1, 1, 1, 1, 1, SR); // Model knob -> B, not retriggered
    const yr = vSample(r, 0, 0, 0, 0.1, 1, 1, 0, 1, SR);
    if (!Object.is(yh, yr)) throw new Error(`On: Model change leaked at n=${n}`);
  }
  vDestroy(h); vDestroy(r);
  console.log("ok On: Model latched");
}

// ---- graph ----
const create = must("soemdsp_graph_create"), destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node"), connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");
if ((must("soemdsp_graph_version")() | 0) < 165) throw new Error("graph version < 165");
const PARAM_MODE = 21, PARAM_WIDTH = 31, PORT_TRIGGER = 20;
function graphRun({ retrig, mode, change }) {
  const g = create() | 0;
  setSr(g, 48000);
  const hClk = 0x7b01 >>> 0, hV = 0x7b02 >>> 0, hOut = 0x7b03 >>> 0;
  if ((add(g, hClk, 28) | 0) !== 0) throw new Error("clock add");
  if ((add(g, hV, 156) | 0) !== 0) throw new Error("vactrol add");
  if ((add(g, hOut, 6) | 0) !== 0) throw new Error("out add");
  connect(g, hClk, 0, hV, 0);
  if (retrig) connect(g, hClk, 0, hV, PORT_TRIGGER);
  connect(g, hV, 0, hOut, 0);
  setParam(g, hClk, 10, 4); // 4 Hz gate: rising edges every 12000 samples
  if (mode !== null) setParam(g, hV, PARAM_MODE, mode);
  if ((compile(g) | 0) !== 0) throw new Error("compile");
  snap(g);
  const out = [];
  for (let q = 0; q < 300; q++) {
    if (change && q === 20) { setParam(g, hV, PARAM_WIDTH, 0.4); snap(g); }
    processBlock(g, 128);
    const buf = new Float64Array(e.memory.buffer, portPtr(g, hV, 0) | 0, 128);
    for (let i = 0; i < 128; i++) out.push(buf[i]);
  }
  destroy(g);
  return out;
}
const firstDiff = (x, y) => x.findIndex((v, i) => !Object.is(v, y[i]));
{
  const a = graphRun({ retrig: true, mode: null, change: false });
  const b = graphRun({ retrig: true, mode: null, change: true });
  const d = firstDiff(a, b);
  if (!(d >= 12000)) throw new Error(`graph On (default): change leaked at ${d} before next Retrigger edge`);
  console.log(`ok graph On (default): knob change at 2560 ignored until Retrigger edge (first diff ${d})`);
}
{
  const a = graphRun({ retrig: true, mode: 0, change: false });
  const b = graphRun({ retrig: true, mode: 0, change: true });
  const d = firstDiff(a, b);
  if (d < 0 || d >= 12000) throw new Error(`graph Off: change not live (first diff ${d})`);
  console.log(`ok graph Off: knob change live (first diff ${d})`);
}
{
  const a = graphRun({ retrig: false, mode: null, change: false });
  const b = graphRun({ retrig: false, mode: null, change: true });
  const d = firstDiff(a, b);
  if (d < 0 || d >= 12000) throw new Error(`graph unconnected Retrigger: knobs should be live (first diff ${d})`);
  console.log(`ok graph unconnected Retrigger: knobs live (first diff ${d})`);
}
console.log("vactrol retrigger smoke ok");


