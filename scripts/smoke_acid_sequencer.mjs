// Headless Acid Sequencer: transport-locked 16ths, gate/tie/accent/slide/semitone.
import fs from "fs";
import path from "path";
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

const create = must("soemdsp_graph_create");
const destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const rewind = must("soemdsp_graph_rewind_master");

const TYPE_OUT = 6;
const TYPE_ACID = 199;
const PORT_GATE = 0;
const PORT_TRIG = 1;
const PORT_PITCH = 2;
const PORT_F = 3;
const PORT_RAMP = 4; // inc removed: always 0
const PORT_CV = 5;   // accent CV (Low / High Accent while Gate is high)
const PORT_STEP = 10;
const PARAM_AMP = 12;
const PARAM_STAGES = 22;
const PARAM_CENTER = 30;
const PARAM_LEVEL = 51;
const PARAM_SLIDE = 52;
const PARAM_BPM = 61;
const PARAM_STEP0 = 420;

function pack(pitch, gate, accent, slide, oct) {
  const octCode = oct === 1 ? 1 : oct === -1 ? 2 : 0;
  return (pitch & 15) | ((gate & 3) << 4) | (accent ? 64 : 0) | (slide ? 128 : 0) | (octCode << 8);
}

function view(ptr, n) {
  return new Float64Array(mem.buffer, ptr, n);
}

const sr = 48000;
const step = 6000; // 120 BPM sixteenth

const g = create() | 0;
setSr(g, sr);
const h = 0xA1D01;
const hOut = 0xA1D02;
if ((add(g, h, TYPE_ACID) | 0) !== 0) throw new Error("add acid");
if ((add(g, hOut, TYPE_OUT) | 0) !== 0) throw new Error("add out");
if ((connect(g, h, PORT_GATE, hOut, PORT_GATE) | 0) !== 0) throw new Error("connect");
setParam(g, h, PARAM_BPM, 120);
setParam(g, h, PARAM_STAGES, 16);
setParam(g, h, PARAM_AMP, 1);
setParam(g, h, PARAM_LEVEL, 1);
setParam(g, h, PARAM_SLIDE, 0.1);
setParam(g, h, PARAM_CENTER, 0);
// 0 on C, 1 accent D, 2 rest, 3 tie E, 4 slide toward high C on step 5
const pattern = [
  pack(0, 1, 0, 0, 0),
  pack(2, 1, 1, 0, 0),
  pack(7, 0, 1, 0, 0),
  pack(4, 2, 0, 0, 0),
  pack(0, 1, 0, 1, 0),
  pack(12, 1, 0, 0, 0),
];
for (let i = 0; i < 32; i += 1) setParam(g, h, PARAM_STEP0 + i, pattern[i] || 0);
if ((compile(g) | 0) !== 0) throw new Error("compile");
snap(g);
rewind(g);

let done = 0;
function at(abs) {
  while (done <= abs) {
    processBlock(g, 128);
    done += 128;
  }
  const local = abs - (done - 128);
  const read = (port) => view(portPtr(g, h, port) | 0, 128)[local];
  return {
    gate: read(PORT_GATE),
    trig: read(PORT_TRIG),
    pitch: read(PORT_PITCH),
    f: read(PORT_F),
    ramp: read(PORT_RAMP),
    cv: read(PORT_CV),
    step: read(PORT_STEP),
  };
}

function near(a, b, eps, label) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${label}: ${a} != ${b}`);
}

const s0 = at(0);
near(s0.step, 0, 0, "step0");
near(s0.gate, 1, 1e-9, "gate0");
// Trigger is a note trigger: fires at Gate height on every non-tie sounding step
// and on the first step after rewind, independent of Accent (Accent is on CV).
near(s0.trig, 1, 1e-6, "trig0 note trigger without Accent");
near(s0.pitch, 36, 1e-6, "pitch0");
near(s0.ramp, 0, 0, "ramp0 (inc removed)");
near(s0.cv, 0, 1e-9, "cv0 low accent");

const s1 = at(step);
near(s1.step, 1, 0, "step1");
near(s1.gate, 1, 1e-9, "gate1");
near(s1.trig, 1, 1e-6, "trig1");
near(s1.pitch, 38, 1e-6, "pitch1");
near(s1.cv, 1, 1e-9, "cv1 high accent");
const s1end = at(step + 48);
near(s1end.trig, 0, 1e-9, "trig1 end");

const rest = at(step * 2);
near(rest.step, 2, 0, "step2");
near(rest.gate, 0, 1e-9, "gate rest");
near(rest.trig, 0, 1e-9, "trig rest");
near(rest.cv, 0, 1e-9, "cv rest");
near(rest.pitch, 38, 1e-6, "pitch hold");

const beforeTie = at(step * 3 - 1);
const tie = at(step * 3);
near(beforeTie.gate, 0, 1e-9, "pre tie low after rest");
near(tie.gate, 1, 1e-9, "tie gate");
near(tie.pitch, 40, 1e-6, "tie pitch");
near(tie.trig, 0, 1e-9, "tie does not retrigger");
const tieHold = at(step * 3 + 10);
near(tieHold.trig, 0, 1e-9, "tie no pulse later in step");
near(tieHold.gate, 1, 1e-9, "tie stays high");

const slide0 = at(step * 4);
near(slide0.pitch, 40, 0.02, "slide start from tie E");
near(slide0.trig, 1, 1e-6, "trig4 non-accent note after tie");
near(slide0.cv, 0, 1e-9, "cv4 low accent");
const slideMid = at(step * 4 + 2400);
near(slideMid.pitch, 44, 0.05, "slide halfway 40->48");

setParam(g, h, PARAM_CENTER, 1);
snap(g);
rewind(g);
done = 0;
const shifted = at(0);
near(shifted.pitch, 37, 1e-6, "semitone +1");
near(shifted.step, 0, 0, "rewind step");
near(shifted.gate, 1, 1e-9, "rewind gate");
near(shifted.trig, 1, 1e-6, "rewind retrigger without Accent");
setParam(g, h, PARAM_STEP0, pack(0, 1, 1, 0, 0));
rewind(g);
done = 0;
const retrig = at(0);
near(retrig.trig, 1, 1e-6, "rewind retrigger with Accent");
near(retrig.cv, 1, 1e-9, "rewind accent cv high");
near(retrig.step, 0, 0, "rewind still step 0");

// Accented tie still does not retrigger (Accent only affects CV).
setParam(g, h, PARAM_STEP0 + 3, pack(4, 2, 1, 0, 0));
rewind(g);
done = 0;
const accTie = at(step * 3);
near(accTie.gate, 1, 1e-9, "accent tie gate");
near(accTie.trig, 0, 1e-9, "accent tie does not retrigger");
near(accTie.cv, 1, 1e-9, "accent tie cv high");

console.log("acid sequencer ok", JSON.stringify({
  s0, s1pitch: s1.pitch, rest: rest.pitch, tie: tie.pitch, slideMid: slideMid.pitch, shifted: shifted.pitch,
}));
destroy(g);
