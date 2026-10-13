// Headless Batch 11: stepSequencer (removed module stays removed).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");

const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const e = instance.exports;
const mem = e.memory;
if (!mem) throw new Error("wasm memory export missing");

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

const create = must("soemdsp_graph_create");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const setParam = must("soemdsp_graph_set_param");
const compile = must("soemdsp_graph_compile");
const process = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const snap = must("soemdsp_graph_snap_controls");
const portPtr = must("soemdsp_graph_node_port_ptr");
const version = must("soemdsp_graph_version");

const TYPE_CLOCK = 28;
const TYPE_SEQ = 36;
const TYPE_OUT = 6;
const PORT_MONO = 0;
const PORT_LEFT = 1;
const PORT_RIGHT = 2;
const PORT_TRIG = 20;
const PARAM_FREQ = 10;
const PARAM_AMP = 12;
const PARAM_STAGES = 22;
const PARAM_CENTER = 30;
const PARAM_LANE_VOL1 = 100;
const PARAM_LANE_VOL2 = 101;
const PARAM_LANE_VOL3 = 102;
const PARAM_LANE_VOL4 = 103;

function view(ptr, n) {
  return new Float64Array(mem.buffer, ptr, n);
}

// stepSequencer was removed (commit c5e23b4f "PRELIMINARY SEQUENCER WORKING"
// deleted step_sequencer.cpp and its graph_engine dispatch). It must stay gone:
// no module definition, no worklet type id, no native dispatch.
{
  const defs = fs.readFileSync(path.join(root, "public", "node-graph-module-definitions.js"), "utf8");
  const worklet = fs.readFileSync(path.join(root, "public", "node-live-audio-worklet-native-graph.js"), "utf8");
  const engine = fs.readFileSync(path.join(root, "native_modules", "graph_engine", "graph_engine.cpp"), "utf8");
  if (/^\s*stepSequencer\s*:/m.test(defs)) throw new Error("stepSequencer module definition is back");
  if (/^\s*stepSequencer\s*:/m.test(worklet)) throw new Error("stepSequencer worklet type id is back");
  if (/node\.typeId == kTypeStepSequencer/.test(engine)) throw new Error("stepSequencer native dispatch is back");
  if (fs.existsSync(path.join(root, "native_modules", "step_sequencer"))) {
    const left = fs.readdirSync(path.join(root, "native_modules", "step_sequencer")).filter((f) => f.endsWith(".cpp"));
    if (left.length) throw new Error(`step_sequencer sources are back: ${left}`);
  }
  console.log("stepSequencer removed ok (no definition, type id, dispatch or source)");
}

console.log(`smoke_graph_stepseq_batch ok: version=${version() | 0}`);
