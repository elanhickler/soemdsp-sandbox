// Host I/O jacks 3–8: extra Output destinations mix into outAux, not L/R.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")),
  { env: { emo_process_block: () => 0 } },
);
const e = instance.exports;
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
const nodePort = must("soemdsp_graph_node_port_ptr");
const chPtr = must("soemdsp_graph_block_output_channel_ptr");
const destroy = must("soemdsp_graph_destroy");
if ((must("soemdsp_graph_version")() | 0) < 288) {
  throw new Error(`graph version ${e.soemdsp_graph_version()} < 288`);
}

const TYPE_IN = 132;
const TYPE_OUT = 6;
const FRAMES = 64;
const PARAM_VOLUME_DB = 0;
const peak = (p) => {
  const v = new Float64Array(e.memory.buffer, p | 0, FRAMES);
  let a = 0;
  for (const x of v) a = Math.max(a, Math.abs(x));
  return a;
};

const g = create();
if (g <= 0) throw new Error("create failed");
setSr(g, 48000);
const IN = 0x8101;
const OUT = 0x8102;
if (add(g, IN, TYPE_IN) !== 0) throw new Error("add input");
if (add(g, OUT, TYPE_OUT) !== 0) throw new Error("add output");
if (connect(g, IN, 1, OUT, 1) !== 0) throw new Error("connect L");
if (connect(g, IN, 3, OUT, 3) !== 0) throw new Error("connect 3");
if (compile(g) !== 0) throw new Error("compile");
setParam(g, OUT, PARAM_VOLUME_DB, 0);
snap(g);

const pL = nodePort(g, IN, 1);
const p3 = nodePort(g, IN, 3);
if (!pL || !p3) throw new Error("input port ptr");
const inL = new Float64Array(e.memory.buffer, pL | 0, FRAMES);
const in3 = new Float64Array(e.memory.buffer, p3 | 0, FRAMES);
inL.fill(0.25);
in3.fill(0.5);
if ((process(g, FRAMES) | 0) !== FRAMES) throw new Error("process");

const out0 = peak(chPtr(g, 0));
const out1 = peak(chPtr(g, 1));
const out2 = peak(chPtr(g, 2));
const out3 = peak(chPtr(g, 3));
destroy(g);

if (!(out0 > 0.2 && out0 < 0.3)) throw new Error(`host ch0 (L) peak ${out0}`);
if (out1 > 1e-9) throw new Error(`host ch1 (R) leaked ${out1}`);
if (!(out2 > 0.45 && out2 < 0.55)) throw new Error(`host ch2 (jack 3) peak ${out2}`);
if (out3 > 1e-9) throw new Error(`host ch3 (jack 4) leaked ${out3}`);
console.log(`smoke_graph_host_io8 ok L=${out0.toFixed(4)} R=${out1} aux3=${out2.toFixed(4)} aux4=${out3}`);
