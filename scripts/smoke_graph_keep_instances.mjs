// Live edits must keep other modules' native handles and leave the circuit compiled.
// Disconnect, add, and remove do not require a follow-up compile before process_block.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")),
  { env: { emo_process_block: () => 0 } },
);
const e = instance.exports;
const must = (name) => {
  if (typeof e[name] !== "function") throw new Error(`missing export ${name}`);
  return e[name];
};

const create = must("soemdsp_graph_create");
const destroy = must("soemdsp_graph_destroy");
const add = must("soemdsp_graph_add_node");
const connect = must("soemdsp_graph_connect");
const disconnect = must("soemdsp_graph_disconnect");
const remove = must("soemdsp_graph_remove_node");
const compile = must("soemdsp_graph_compile");
const processBlock = must("soemdsp_graph_process_block");
const setSr = must("soemdsp_graph_set_sample_rate");
const handleOf = must("soemdsp_graph_node_native_handle");
const version = must("soemdsp_graph_version");
if ((version() | 0) < 174) throw new Error(`graph version ${version()} expected >= 174`);

const TYPE_OSC = 1;
const TYPE_OUT = 6;
const PORT_MONO = 0;
const A = 0xa11;
const B = 0xb11;
const OUT = 0x011;

const g = create() | 0;
if (!g) throw new Error("create");
setSr(g, 48000);
if ((add(g, A, TYPE_OSC) | 0) !== 0) throw new Error("add A");
if ((add(g, OUT, TYPE_OUT) | 0) !== 0) throw new Error("add out");
if ((connect(g, A, PORT_MONO, OUT, PORT_MONO) | 0) !== 0) throw new Error("connect");
if ((compile(g) | 0) !== 0) throw new Error("compile");
const hA = handleOf(g, A) | 0;
if (!(hA > 0)) throw new Error(`osc handle ${hA}`);
if ((processBlock(g, 128) | 0) < 1) throw new Error("process before disconnect");

if ((disconnect(g, A, PORT_MONO, OUT, PORT_MONO) | 0) !== 0) throw new Error("disconnect");
if ((processBlock(g, 128) | 0) < 1) throw new Error("process after disconnect without compile");
if ((handleOf(g, A) | 0) !== hA) throw new Error("disconnect replaced osc handle");

if ((add(g, B, TYPE_OSC) | 0) !== 0) throw new Error("add B");
if ((processBlock(g, 128) | 0) < 1) throw new Error("process after add without compile");
if ((handleOf(g, A) | 0) !== hA) throw new Error("add replaced osc handle");
const hB = handleOf(g, B) | 0;
if (!(hB > 0)) throw new Error(`B handle ${hB}`);
if (hB === hA) throw new Error("B stole A's handle");

if ((remove(g, B) | 0) !== 0) throw new Error("remove B");
if ((processBlock(g, 128) | 0) < 1) throw new Error("process after remove without compile");
if ((handleOf(g, A) | 0) !== hA) throw new Error("remove replaced osc handle");
if ((handleOf(g, B) | 0) !== 0) throw new Error("B still present");

destroy(g);
console.log("smoke_graph_keep_instances OK");
