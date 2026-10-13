// Stereo-route filters (Flower Child 61, Superlove 63, Superlove Rev2 172,
// VCV Super Love 183): routing table from soemdsp/routing/stereo_route.h.
// Crosstalk, single-source stereo, Mono out = average, unused cores not run.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const e = instance.exports;
const mem = e.memory;

const T_POLY = 1, T_OUT = 6;
const P = { freq: 10, amp: 12, shape: 13, phase: 14, reso: 20, mode: 21, width: 31, mix: 40, seed: 48, gain: 90 };
const M = 0, L = 1, R = 2;
const N = 128, Q = 40;

// zero: every per-lane difference source off. vary: per-lane difference on.
const MODS = [
  { name: "flowerChild", type: 61, base: { freq: 0.5, reso: 0.35, mode: 0 }, zero: { shape: 0 }, vary: { shape: 0.6 } },
  { name: "superlove", type: 63, base: { freq: 0.5, reso: 0.35, mode: 0 }, zero: { shape: 0 }, vary: { shape: 0.5 } },
  { name: "superloveRev2", type: 172, base: { freq: 0.5, reso: 0.35, mode: 0, shape: 0.75 }, zero: { mix: 0 }, vary: { mix: 0.5 } },
  { name: "vcvrackSuperlove", type: 183, base: { freq: 0.5, reso: 0.35, mode: 1, gain: 0.5 }, zero: { mix: 0, width: 0 }, vary: { mix: 0, width: 0.8 } },
];

const HA = 0x8101, HB = 0x8102, HZ = 0x8103, HF = 0x8104, HO = 0x8105;

function build(mod, params, ins, outs) {
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, 48000);
  for (const [h, t] of [[HA, T_POLY], [HB, T_POLY], [HZ, T_POLY], [HF, mod.type], [HO, T_OUT]]) {
    if ((e.soemdsp_graph_add_node(g, h, t) | 0) !== 0) throw new Error(`${mod.name}: add ${t}`);
  }
  e.soemdsp_graph_set_param(g, HA, P.freq, 110); e.soemdsp_graph_set_param(g, HA, P.amp, 0.4);
  e.soemdsp_graph_set_param(g, HB, P.freq, 330); e.soemdsp_graph_set_param(g, HB, P.amp, 0.4);
  e.soemdsp_graph_set_param(g, HZ, P.freq, 220); e.soemdsp_graph_set_param(g, HZ, P.amp, 0);
  for (const [k, v] of Object.entries(params)) e.soemdsp_graph_set_param(g, HF, P[k], v);
  wire(g, ins, outs);
  e.soemdsp_graph_snap_controls(g);
  return g;
}
function wire(g, ins, outs) {
  for (const [src, port] of ins) e.soemdsp_graph_connect(g, src, M, HF, port);
  for (const port of outs) e.soemdsp_graph_connect(g, HF, port, HO, port);
  if ((e.soemdsp_graph_compile(g) | 0) !== 0) throw new Error("compile");
}
function block(g) {
  e.soemdsp_graph_process_block(g, N);
  const v = (p) => Float64Array.from(new Float64Array(mem.buffer, e.soemdsp_graph_node_port_ptr(g, HF, p) | 0, N));
  return { m: v(M), l: v(L), r: v(R) };
}
const peak = (a) => a.reduce((x, y) => Math.max(x, Math.abs(y)), 0);
const same = (a, b) => a.every((x, i) => x === b[i]);
const db = (x, ref) => (x <= 0 ? -Infinity : 20 * Math.log10(x / ref));

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error(`FAIL ${msg}`); } }

for (const mod of MODS) {
  const zero = { ...mod.base, ...mod.zero };
  const vary = { ...mod.base, ...mod.vary };

  // 1. Crosstalk: sine on L, silence on R (both cabled = stereo source).
  {
    const g = build(mod, zero, [[HA, L], [HZ, R]], [L, R]);
    let pl = 0, pr = 0; const rs = [];
    for (let q = 0; q < Q; q++) { const b = block(g); rs.push(b.r); pl = Math.max(pl, peak(b.l)); pr = Math.max(pr, peak(b.r)); }
    e.soemdsp_graph_destroy(g);
    const silentRef = (() => { // the R core alone on silence (its own idle output)
      const g2 = build(mod, zero, [[HZ, L], [HZ, R]], [L, R]);
      let p = 0, err = 0;
      for (let q = 0; q < Q; q++) { const r = block(g2).r; p = Math.max(p, peak(r)); for (let i = 0; i < N; i++) err = Math.max(err, Math.abs(r[i] - rs[q][i])); }
      e.soemdsp_graph_destroy(g2); return { p, err };
    })();
    check(pl > 0.01, `${mod.name} crosstalk: L silent (${pl})`);
    check(silentRef.err === 0, `${mod.name} crosstalk: R differs from idle core by ${silentRef.err}`);
    console.log(`${mod.name} crosstalk: L peak ${pl.toFixed(4)}, R peak ${pr.toExponential(2)} (R vs idle-core max err ${silentRef.err}) -> crosstalk ${db(silentRef.err, pl)} dB`);
  }

  // 2. Single source, Left+Right out: L==R at zero, L!=R with lane differences.
  for (const [label, params, wantSame] of [["zero", zero, true], ["vary", vary, false]]) {
    const g = build(mod, params, [[HA, M]], [L, R]);
    let diff = 0, allSame = true, pl = 0;
    for (let q = 0; q < Q; q++) {
      const b = block(g);
      if (!same(b.l, b.r)) allSame = false;
      if (!same(b.m, b.l.map((x, i) => 0.5 * (x + b.r[i])))) check(false, `${mod.name} single ${label}: Mono != avg`);
      for (let i = 0; i < N; i++) diff = Math.max(diff, Math.abs(b.l[i] - b.r[i]));
      pl = Math.max(pl, peak(b.l));
    }
    e.soemdsp_graph_destroy(g);
    check(pl > 0.01, `${mod.name} single ${label}: silent`);
    check(wantSame ? allSame : diff > 1e-4, `${mod.name} single ${label}: maxDiff ${diff}`);
    console.log(`${mod.name} single-source ${label}: L/R maxDiff ${diff.toExponential(2)} (peak ${pl.toFixed(4)})`);
  }

  // 3. Stereo source, Mono+Left+Right out: Mono = 0.5*(L+R); with Mono In too.
  for (const ins of [[[HA, L], [HB, R]], [[HA, L], [HB, R], [HB, M]]]) {
    const g = build(mod, vary, ins, [M, L, R]);
    let ok = true, pm = 0;
    for (let q = 0; q < Q; q++) {
      const b = block(g);
      for (let i = 0; i < N; i++) if (b.m[i] !== 0.5 * (b.l[i] + b.r[i])) ok = false;
      pm = Math.max(pm, peak(b.m));
    }
    e.soemdsp_graph_destroy(g);
    check(ok && pm > 0.005, `${mod.name} stereo Mono avg (ins=${ins.length}) peak ${pm}`);
    console.log(`${mod.name} stereo${ins.length === 3 ? "+mono" : ""} -> Mono out = 0.5*(L+R) exact, peak ${pm.toFixed(4)}`);
  }
  // Stereo source, Mono out only == average of the L+R-out run.
  {
    const g1 = build(mod, vary, [[HA, L], [HB, R]], [M]);
    const g2 = build(mod, vary, [[HA, L], [HB, R]], [L, R]);
    let ok = true;
    for (let q = 0; q < Q; q++) {
      const a = block(g1), b = block(g2);
      for (let i = 0; i < N; i++) if (a.m[i] !== 0.5 * (b.l[i] + b.r[i])) ok = false;
    }
    e.soemdsp_graph_destroy(g1); e.soemdsp_graph_destroy(g2);
    check(ok, `${mod.name} stereo Mono-only != avg of L/R`);
  }
  // Single source, Mono out only == the Mono core (L/R taps mirror it).
  {
    const g = build(mod, vary, [[HA, M]], [M]);
    let ok = true;
    for (let q = 0; q < Q; q++) { const b = block(g); if (!same(b.m, b.l) || !same(b.m, b.r)) ok = false; }
    e.soemdsp_graph_destroy(g);
    check(ok, `${mod.name} mono-only: L/R taps should mirror Mono`);
  }

  // 4. Unused cores never run: Mono-only for Q blocks, then rewire to Left out
  //    with no input; L must match a fresh core. Control: L wired in phase 1.
  {
    const fresh = (() => { const g = build(mod, zero, [], [L]); const b = block(g); e.soemdsp_graph_destroy(g); return b.l; })();
    const phase = (outs1) => {
      const g = build(mod, zero, [[HA, M]], outs1);
      for (let q = 0; q < Q; q++) block(g);
      e.soemdsp_graph_clear_connections(g);
      wire(g, [], [L]);
      const b = block(g);
      e.soemdsp_graph_destroy(g);
      return b.l;
    };
    const unused = phase([M]);
    const used = phase([L]);
    check(same(unused, fresh), `${mod.name} unused L core ran (differs from fresh)`);
    check(!same(used, fresh), `${mod.name} control: used L core indistinguishable from fresh`);
    console.log(`${mod.name} unused-core: L untouched while Mono-only (matches fresh), control differs`);
  }
}

if (failures) throw new Error(`smoke_stereo_route_filters: ${failures} failures`);
console.log(`smoke_stereo_route_filters ok: ${MODS.length} modules, version=${e.soemdsp_graph_version()}`);
