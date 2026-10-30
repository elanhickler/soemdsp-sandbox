// Headless: Time Quantizer (native time_quantizer + graph type 218).
// Grid = project tempo (Circuit::hostTempoBpm via soemdsp_graph_set_host_transport)
// x Division (1/1..1/32) x Timing (Normal/Dotted/Triplet), aligned to the master
// playhead. Changes of In only land on grid lines, on the exact edge sample.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm")), { env: { emo_process_block: () => 0 } });
const e = instance.exports;
const must = (n) => { if (typeof e[n] !== "function") throw new Error(`missing export ${n}`); return e[n]; };
const create = must("soemdsp_time_quantizer_create"), destroy = must("soemdsp_time_quantizer_destroy");
const sample = must("soemdsp_time_quantizer_sample"), trig = must("soemdsp_time_quantizer_trigger");
if ((must("soemdsp_time_quantizer_version")() | 0) < 1) throw new Error("time_quantizer version < 1");
const SR = 48000, TH = 1e-6;
const fail = (m) => { throw new Error(m); };

// run(inFn, n, {div, timing, bpmAt, th, masterAt}) -> {out, trg}
function run(inFn, n, o = {}) {
  const { div = 4, timing = 0, bpmAt = () => 120, th = TH, masterAt = (i) => i } = o;
  const h = create() | 0;
  const out = new Float64Array(n), trg = new Float64Array(n);
  for (let i = 0; i < n; i++) { out[i] = sample(h, inFn(i), th, div, timing, bpmAt(i), SR, masterAt(i)); trg[i] = trig(h); }
  destroy(h);
  return { out, trg };
}
const trigAt = (trg) => { const r = []; trg.forEach((v, i) => { if (v !== 0) { if (v !== 1) fail(`trigger ${v} at ${i}`); r.push(i); } }); return r; };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

// 1. No change -> no trigger on any edge (In 0 == initial Out 0).
{ const r = run(() => 0, 60000); eq(trigAt(r.trg), [], "constant 0"); }
{ const r = run(() => 0.5, 60000); eq(trigAt(r.trg), [0], "constant 0.5 (one change at first line, then none)"); if (r.out[59999] !== 0.5) fail("hold 0.5"); }
console.log("ok no trigger on edges without a change");

// 2. Mid-period change lands exactly on the next edge (1/16 @ 120 = 6000 samples).
{
  const r = run((i) => (i >= 1000 ? 0.7 : 0), 20000);
  for (let i = 0; i < 6000; i++) if (r.out[i] !== 0) fail(`early change at ${i}`);
  for (let i = 6000; i < 20000; i++) if (r.out[i] !== 0.7) fail(`not held at ${i}`);
  eq(trigAt(r.trg), [6000], "mid-period change");
}
// Change arriving on the edge sample itself is applied at that edge.
{ const r = run((i) => (i >= 6000 ? 0.3 : 0), 13000); eq(trigAt(r.trg), [6000], "change on edge sample"); }
console.log("ok mid-period change appears exactly at the next edge");

// 3. Several changes in one period -> only the latest; change-and-revert -> nothing.
{
  const inFn = (i) => (i < 1000 ? 0 : i < 2000 ? 0.1 : i < 5999 ? 0.2 : i < 7000 ? 0.3 : i < 8000 ? 0.9 : 0.3);
  const r = run(inFn, 20000);
  eq(trigAt(r.trg), [6000], "several changes");
  if (r.out[6000] !== 0.3 || r.out[19999] !== 0.3) fail("latest value not used / revert leaked");
}
console.log("ok several changes in one period -> last value only; reverted change -> no trigger");

// 4. Gate: rising and falling edges both quantized.
{
  const r = run((i) => (i >= 1000 && i < 8500 ? 1 : 0), 20000);
  eq(trigAt(r.trg), [6000, 12000], "gate edges");
  for (let i = 0; i < 20000; i++) if (r.out[i] !== (i >= 6000 && i < 12000 ? 1 : 0)) fail(`gate out wrong at ${i}`);
}
console.log("ok gate rising and falling edges land on 6000 / 12000");

// 5. Divisions x Timing at 120 BPM (ramp In always differs -> trigger on every line).
{
  const names = ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32"], tn = ["Normal", "Dotted", "Triplet"], tm = [1, 1.5, 2 / 3];
  for (let d = 0; d < 6; d++) for (let t = 0; t < 3; t++) {
    const period = 2 * SR * Math.pow(2, -d) * tm[t]; // 240/120 s * fraction * mult * SR
    const n = Math.round(period * 4) + 1;
    const r = run((i) => i + 1, n, { div: d, timing: t });
    eq(trigAt(r.trg), [0, 1, 2, 3, 4].map((k) => Math.round(k * period)), `division ${names[d]} ${tn[t]}`);
  }
}
console.log("ok all 6 divisions x Normal/Dotted/Triplet: lines at exact k*period");

// 6. Tempo change: 1/4, 120 -> 90 BPM at sample 30000. Lines 0, 24000; at 30000 we are
// 1.25 beats in; 0.75 beat at 90 BPM (32000) -> 54000, then 86000. Beat phase continuous.
{
  const r = run((i) => i + 1, 90000, { div: 2, bpmAt: (i) => (i < 30000 ? 120 : 90) });
  eq(trigAt(r.trg), [0, 24000, 54000, 86000], "tempo change");
  // Unset tempo (0) falls back to 120.
  const z = run((i) => i + 1, 50000, { div: 2, bpmAt: () => 0 });
  eq(trigAt(z.trg), [0, 24000, 48000], "tempo 0 -> 120 fallback");
}
console.log("ok tempo change re-anchors (beat phase continuous); tempo unset -> 120 BPM");

// 7. Transport alignment: grid follows the master position, not the sample count.
{
  const r = run((i) => i + 1, 7000, { masterAt: (i) => i + 5000 }); // playhead starts at 5000
  eq(trigAt(r.trg), [0, 1000], "master offset (first sample + line at master 6000)");
  const w = run((i) => i + 1, 4000, { masterAt: (i) => (i < 2000 ? i + 10000 : i - 2000) }); // rewind
  eq(trigAt(w.trg), [0, 2000], "rewind re-grids at master 0");
}
console.log("ok grid aligned to master position; rewind re-grids");

// 8. Change Threshold.
{
  eq(trigAt(run((i) => (i >= 100 ? 0.05 : 0), 13000, { th: 0.1 }).trg), [], "below threshold");
  eq(trigAt(run((i) => (i >= 100 ? 0.05 : 0), 13000, { th: 0.01 }).trg), [6000], "above threshold");
}
console.log("ok Change Threshold");

// 9. Graph: sine -> Time Quantizer (218) -> Out; project tempo via set_host_transport.
{
  const gC = must("soemdsp_graph_create"), gD = must("soemdsp_graph_destroy"), add = must("soemdsp_graph_add_node");
  const connect = must("soemdsp_graph_connect"), setParam = must("soemdsp_graph_set_param"), compile = must("soemdsp_graph_compile");
  const proc = must("soemdsp_graph_process_block"), setSr = must("soemdsp_graph_set_sample_rate");
  const snap = must("soemdsp_graph_snap_controls"), portPtr = must("soemdsp_graph_node_port_ptr");
  const hostT = must("soemdsp_graph_set_host_transport");
  if ((must("soemdsp_graph_version")() | 0) < 169) fail("graph version < 169");
  const grun = (blocks, params, tempoAtBlock) => {
    const g = gC() | 0; setSr(g, SR);
    const hO = 0xa101, hQ = 0xa102, hOut = 0xa103;
    if (add(g, hO, 1) < 0 || add(g, hQ, 218) < 0 || add(g, hOut, 6) < 0) fail("add_node");
    connect(g, hO, 0, hQ, 0); connect(g, hQ, 0, hOut, 0);
    setParam(g, hO, 10, 3.1); setParam(g, hO, 12, 0.8);
    for (const [k, v] of params) setParam(g, hQ, k, v);
    compile(g); snap(g);
    const x = [], y = [], t = [];
    for (let b = 0; b < blocks; b++) {
      const bpm = tempoAtBlock(b); if (bpm !== null) hostT(g, bpm, 0, 0);
      proc(g, 128);
      x.push(...new Float64Array(e.memory.buffer, portPtr(g, hO, 0) | 0, 128));
      y.push(...new Float64Array(e.memory.buffer, portPtr(g, hQ, 0) | 0, 128));
      t.push(...new Float64Array(e.memory.buffer, portPtr(g, hQ, 2) | 0, 128));
    }
    gD(g); return { x, y, t };
  };
  const check = (r, lines, m) => {
    let prev = 0; const set = new Set(lines);
    for (let i = 0; i < r.y.length; i++) {
      const want = set.has(i) && Math.abs(r.x[i] - prev) > TH ? r.x[i] : prev;
      if (r.y[i] !== want) fail(`${m}: Out ${r.y[i]} want ${want} at ${i}`);
      if (r.t[i] !== (want !== prev ? 1 : 0)) fail(`${m}: Trigger wrong at ${i}`);
      prev = want;
    }
  };
  const B = 400, N = B * 128;
  const mult = (p) => Array.from({ length: Math.floor(N / p) + 1 }, (_, k) => Math.round(k * p)).filter((v) => v < N);
  check(grun(B, [], () => 120), mult(6000), "graph default 1/16 @ 120");
  check(grun(B, [], (b) => (b === 0 ? null : null)), mult(6000), "graph tempo unset -> 120");
  check(grun(B, [[21, 2], [54, 2]], () => 120), mult(16000), "graph 1/4 triplet (params 21/54)");
  // Tempo change at block 100 (sample 12800): 1/16 @ 120 (6000) -> 150 (4800).
  const at = 12800, l0 = at / 6000, lines = mult(6000).filter((v) => v < at);
  for (let k = Math.floor(l0) + 1; ; k++) { const s = Math.ceil(at + (k - l0) * 4800); if (s >= N) break; lines.push(s); }
  check(grun(B, [], (b) => (b < 100 ? 120 : 150)), lines, "graph tempo 120 -> 150");
  console.log("ok graph: Out/Trigger on Mono/Right, project tempo, Division/Timing params, tempo change at block edge");
}
console.log("time quantizer smoke ok");
