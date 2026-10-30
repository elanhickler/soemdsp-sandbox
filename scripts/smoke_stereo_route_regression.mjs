// Regression: filters that still use process_norm_chaos_filter / their own
// MLR routing must stay byte-identical after the stereo-route change.
// Usage: node scripts/smoke_stereo_route_regression.mjs [--capture]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const goldenPath = path.join(__dirname, "goldens", "stereo_route_regression.json");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const mem = e.memory;

const T = { poly: 1, ladder: 2, out: 6, tb303: 60, yellowjacket: 62, human: 64, resonator: 65 };
const P = { freq: 10, amp: 12, shape: 13, reso: 20, mode: 21 };
const PORT = { M: 0, L: 1, R: 2 };

function hashRun(type, wiring, params) {
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, 48000);
  const hA = 0x7101, hB = 0x7102, hF = 0x7103, hO = 0x7104;
  e.soemdsp_graph_add_node(g, hA, T.poly);
  e.soemdsp_graph_add_node(g, hB, T.poly);
  e.soemdsp_graph_add_node(g, hF, type);
  e.soemdsp_graph_add_node(g, hO, T.out);
  e.soemdsp_graph_set_param(g, hA, P.freq, 110); e.soemdsp_graph_set_param(g, hA, P.amp, 0.4);
  e.soemdsp_graph_set_param(g, hB, P.freq, 330); e.soemdsp_graph_set_param(g, hB, P.amp, 0.4);
  for (const [k, v] of Object.entries(params)) e.soemdsp_graph_set_param(g, hF, P[k], v);
  if (wiring === "mono") {
    e.soemdsp_graph_connect(g, hA, PORT.M, hF, PORT.M);
    e.soemdsp_graph_connect(g, hF, PORT.M, hO, PORT.M);
  } else if (wiring === "stereo") {
    e.soemdsp_graph_connect(g, hA, PORT.M, hF, PORT.L);
    e.soemdsp_graph_connect(g, hB, PORT.M, hF, PORT.R);
    e.soemdsp_graph_connect(g, hF, PORT.L, hO, PORT.L);
    e.soemdsp_graph_connect(g, hF, PORT.R, hO, PORT.R);
  } else {
    e.soemdsp_graph_connect(g, hA, PORT.M, hF, PORT.L);
    e.soemdsp_graph_connect(g, hF, PORT.L, hO, PORT.L);
    e.soemdsp_graph_connect(g, hF, PORT.M, hO, PORT.M);
  }
  e.soemdsp_graph_compile(g);
  e.soemdsp_graph_snap_controls(g);
  let h = 0x811c9dc5 >>> 0;
  const tmp = new Float64Array(1);
  const u8 = new Uint8Array(tmp.buffer);
  for (let q = 0; q < 40; q++) {
    e.soemdsp_graph_process_block(g, 128);
    for (const p of [PORT.M, PORT.L, PORT.R]) {
      const v = new Float64Array(mem.buffer, e.soemdsp_graph_node_port_ptr(g, hF, p) | 0, 128);
      for (let i = 0; i < 128; i++) {
        tmp[0] = v[i];
        for (let b = 0; b < 8; b++) h = Math.imul(h ^ u8[b], 16777619) >>> 0;
      }
    }
  }
  e.soemdsp_graph_destroy(g);
  return h.toString(16);
}

const cases = {};
const defs = {
  ladder: [T.ladder, { freq: 900, reso: 0.4 }],
  tb303: [T.tb303, { freq: 1200, reso: 30, mode: 4 }],
  yellowjacket: [T.yellowjacket, { freq: 0.5, reso: 0.4, shape: 0.6 }],
  human: [T.human, { freq: 0.5, reso: 0.4, shape: 0.5 }],
  resonator: [T.resonator, { freq: 0.5, reso: 0.4 }],
};
for (const [name, [type, params]] of Object.entries(defs)) {
  for (const w of ["mono", "stereo", "leftonly"]) cases[`${name}/${w}`] = hashRun(type, w, params);
}

if (process.argv.includes("--capture")) {
  fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
  fs.writeFileSync(goldenPath, JSON.stringify(cases, null, 2) + "\n");
  console.log(`captured ${Object.keys(cases).length} goldens`);
} else {
  const gold = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  let bad = 0;
  for (const [k, v] of Object.entries(gold)) {
    if (cases[k] !== v) { bad++; console.error(`MISMATCH ${k}: ${cases[k]} != ${v}`); }
  }
  if (bad) throw new Error(`${bad} regression mismatches`);
  console.log(`smoke_stereo_route_regression ok: ${Object.keys(gold).length} cases byte-identical`);
}
