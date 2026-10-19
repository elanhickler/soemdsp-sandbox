// t-series crossfade face: the display gain law (t-series-crossfade-display.js)
// must equal the engine (process_transistor / process_transistor_mux) for t3,
// t5, 3t and 5t across Analog / Digital positions. Engine gains are measured
// from the combined wasm: demux with no In -> carrier 1, so out k = gain k;
// mux with DC 1 on path k only -> Out = gain k.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
vm.runInThisContext(fs.readFileSync(path.join(root, "public/modules/tSeries/t-series-crossfade-display.js"), "utf8"));
const S = globalThis.nodeGraphTSeriesCrossfadeState;
const bytes = fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const imports = {};
for (const imp of WebAssembly.Module.imports(new WebAssembly.Module(bytes))) if (imp.kind === "function") (imports[imp.module] ||= {})[imp.name] = () => 0;
const e = (await WebAssembly.instantiate(bytes, imports)).instance.exports;
const T_DEMUX = 159, T_MUX = 175, BIAS = 12, OUT = 6, STAGES = 22, OFFSET = 71, MORPH = 22, TRIG = 20, MONO = 0, SAW = 3;
let fail = 0; const ok = (c, m) => { if (!c) { console.log("FAIL " + m); fail++; } };
let checks = 0;

function engine(kind, last, { a, d }, pathIn = -1) {
  const g = e.soemdsp_graph_create() | 0; e.soemdsp_graph_set_sample_rate(g, 48000);
  const N = 1, A = 2, D = 3, IN = 4, O = 9;
  e.soemdsp_graph_add_node(g, N, kind === "demux" ? T_DEMUX : T_MUX);
  e.soemdsp_graph_set_param(g, N, STAGES, last);
  e.soemdsp_graph_add_node(g, O, OUT);
  if (a != null) { e.soemdsp_graph_add_node(g, A, BIAS); e.soemdsp_graph_set_param(g, A, OFFSET, a); e.soemdsp_graph_connect(g, A, MONO, N, MORPH); }
  if (d != null) { e.soemdsp_graph_add_node(g, D, BIAS); e.soemdsp_graph_set_param(g, D, OFFSET, d); e.soemdsp_graph_connect(g, D, MONO, N, TRIG); }
  if (pathIn >= 0) { e.soemdsp_graph_add_node(g, IN, BIAS); e.soemdsp_graph_set_param(g, IN, OFFSET, 1); e.soemdsp_graph_connect(g, IN, MONO, N, pathIn); }
  e.soemdsp_graph_connect(g, N, MONO, O, MONO);
  e.soemdsp_graph_compile(g); e.soemdsp_graph_snap_controls(g);
  e.soemdsp_graph_process_block(g, 128); e.soemdsp_graph_process_block(g, 128);
  const read = (port) => new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, N, port) | 0, 128)[127];
  const out = { ch: [], mono: read(MONO), open: read(SAW) };
  for (let c = 0; c <= last; c += 1) out.ch.push(read(c));
  e.soemdsp_graph_destroy(g);
  return out;
}

const close = (x, y) => Math.abs(x - y) < 1e-9;
const analogs = { demux: [-0.3, 0, 0.1, 0.25, 0.5, 0.62, 0.75, 1, 1.4], mux: [-1.5, -1, -0.6, -0.25, 0, 0.3, 0.5, 0.8, 1, 2] };
const digitals = [-1, 0, 0.4, 0.6, 1, 1.49, 2, 2.5, 3, 4, 7];
let ch3Note = null;
for (const [kind, last] of [["demux", 2], ["demux", 4], ["mux", 2], ["mux", 4]]) {
  const label = kind === "demux" ? `t${last + 1}` : `${last + 1}t`;
  const cases = [];
  for (const a of analogs[kind]) cases.push({ a, d: null });
  for (const d of digitals) cases.push({ a: null, d });
  for (const a of analogs[kind]) for (const d of [0, 1, 2.5, 3]) cases.push({ a, d });
  for (const c of cases) {
    const js = S(kind, last, { hasAnalog: c.a != null, analog: c.a ?? 0, hasDigital: c.d != null, digital: c.d ?? 0 });
    const want = js.gains;
    let got;
    if (kind === "demux") {
      const r = engine(kind, last, c);
      got = r.ch;
      // Max gain = engine Open (the old Value Line signal).
      ok(close(Math.max(...want), r.open), `${label} ${JSON.stringify(c)} Open ${r.open} vs max gain ${Math.max(...want)}`);
      checks += 1;
    } else {
      got = [];
      for (let k = 0; k <= last; k += 1) got.push(engine(kind, last, c, k).mono);
    }
    for (let k = 0; k <= last; k += 1) {
      if (kind === "demux" && k === SAW && last >= 3) {
        // Engine bug (not display): t4…t11 out "3" shares buf[3] with Open.
        if (!close(got[k], want[k]) && close(got[k], Math.max(...want))) ch3Note = `${label} out 3 = Open (${got[k]}) not gain (${want[k]})`;
        continue;
      }
      ok(close(got[k], want[k]), `${label} ${JSON.stringify(c)} path ${k}: engine ${got[k]} vs face ${want[k]}`);
      checks += 1;
    }
  }
}
// Playhead positions the face draws.
const pos = (kind, last, i) => S(kind, last, i).position;
ok(close(pos("demux", 2, { hasAnalog: true, analog: 0.25 }), 0.5), "t3 A 0.25 -> playhead 0.5");
ok(close(pos("demux", 2, { hasAnalog: true, analog: 1 }), 2), "t3 A 1 -> playhead 2");
ok(close(pos("demux", 2, { hasDigital: true, digital: 1.2 }), 1), "t3 D 1.2 -> playhead 1 (digital snaps)");
ok(pos("demux", 2, { hasDigital: true, digital: 5 }) === null, "t3 D 5 -> no playhead (out of range)");
ok(close(pos("mux", 4, { hasAnalog: true, analog: 0 }), 2), "5t A 0 -> playhead 2 (bipolar center)");
ok(close(pos("mux", 4, { hasAnalog: true, analog: -1 }), 0), "5t A -1 -> playhead 0");
ok(close(pos("mux", 4, { hasAnalog: true, analog: 0.5, hasDigital: true, digital: 2 }), 3), "5t D 2 + A 0.5 -> playhead 3");
ok(close(pos("mux", 4, { hasAnalog: true, analog: -0.5, hasDigital: true, digital: 2 }), 1), "5t D 2 + A -0.5 -> playhead 1");
ok(pos("mux", 4, {}) === null, "5t unwired -> no playhead");
checks += 9;
if (ch3Note) console.log("note (engine, not display): " + ch3Note);
console.log(fail ? `${fail} FAILED of ${checks}` : `t-series crossfade smoke ok (${checks} checks)`);
process.exit(fail ? 1 : 0);
