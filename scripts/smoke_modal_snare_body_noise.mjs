// Modal Snare Body / Noise (bodyNoise, graph mix slot 40): 0 / unset is
// bit-identical to the previous build (optional old wasm as argv[2]);
// -1 = body only (no wires, no click), +1 = noise (wires + click) only,
// and body-only + noise-only = the default mix (linear balance).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = { env: { emo_process_block: () => 0 } };
const load = async (p) => (await WebAssembly.instantiate(fs.readFileSync(p), imp)).instance.exports;
const N = await load(path.join(root, "native_modules", "combined", "soemdsp_combined.wasm"));
const O = process.argv[2] ? await load(process.argv[2]) : null;
const SR = 48000;
// tune, tone, snappy, bodyDecay, snapDecay, bend, amplitude, noiseFreq, noiseQ, click, clickDecay, noiseTilt
const SETS = [
  [180, 0.5, 0.5, 0.25, 0.2, 0, 1, 3000, 1, 0.3, 2, 0],
  [180, 0, 0.21776, 0.48553, 0.40651, 1.72608, 1, 1208.6, 2.848, 0.55474, 7.08, -0.219],
  [240, 0.8, 1, 0.1, 0.6, 0.5, 0.7, 5000, 4, 0, 1, 0.6],
  [90, 0.3, 0, 0.9, 0.1, 0, 1.3, 800, 0.5, 1, 20, -1],
];
function hits(E, set, bn, n = SR, extra = {}) {
  const h = E.soemdsp_modal_snare_create();
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = set.slice();
    if (extra.snappy !== undefined) a[2] = extra.snappy;
    if (extra.click !== undefined) a[9] = extra.click;
    if (extra.amp !== undefined) a[6] = extra.amp;
    const trig = i % 12000 < 4 ? 0.8 : 0;
    const args = [h, trig, 0, ...a, SR, 0];
    if (bn !== undefined) args.push(bn);
    out.push(E.soemdsp_modal_snare_sample(...args), E.soemdsp_modal_snare_right(h), E.soemdsp_modal_snare_env(h));
  }
  E.soemdsp_modal_snare_destroy(h);
  return out;
}
const md = (a, b, stride = 1, off = 0) => { let m = 0; for (let i = off; i < a.length; i += stride) { const d = a[i] === b[i] ? 0 : Math.abs(a[i] - b[i]); m = Math.max(m, Number.isFinite(d) ? d : Infinity); } return m; };
const rms = (a, stride, off) => { let s = 0, n = 0; for (let i = off; i < a.length; i += stride) { s += a[i] * a[i]; n++; } return Math.sqrt(s / n); };
for (const [k, set] of SETS.entries()) {
  const d0 = hits(N, set, 0), dU = hits(N, set);
  if (md(d0, dU) !== 0) throw new Error(`set ${k}: Body / Noise 0 differs from unset`);
  if (O) { const dO = hits(O, set); const m = md(d0, dO); if (m !== 0) throw new Error(`set ${k}: default differs from the previous build (${m})`); }
  const b = hits(N, set, -1), z = hits(N, set, 1);
  // body only + noise only = default (L and R)
  let sum = 0;
  for (let i = 0; i < d0.length; i += 3) for (const o of [0, 1]) sum = Math.max(sum, Math.abs(b[i + o] + z[i + o] - d0[i + o]));
  // 1e-6: each output is Planck-snapped (tiny tails go to exact 0 on one side only).
  if (sum > 1e-6) throw new Error(`set ${k}: body + noise != default (${sum})`);
  // body only == Snappy 0, Click 0 at the same output trim (1 / (1 + 0.6 snappy))
  const ref = hits(N, set, 0, SR, { snappy: 0, click: 0, amp: set[6] / (1 + 0.6 * set[2]) });
  let bd = 0;
  for (let i = 0; i < b.length; i += 3) for (const o of [0, 1]) bd = Math.max(bd, Math.abs(b[i + o] - ref[i + o]));
  if (bd > 1e-6) throw new Error(`set ${k}: body only still has noise (${bd})`);
  console.log(`ok modalSnare set ${k}: Body / Noise 0 == ${O ? "previous build" : "unset"} (max diff 0); -1 rms L ${rms(b, 3, 0).toExponential(2)} (no noise, diff ${bd.toExponential(1)}), +1 rms L ${rms(z, 3, 0).toExponential(2)}, body + noise - default ${sum.toExponential(1)}`);
}
// Graph: param 40 (mix slot) reaches the module; default slot value = 0.
{
  const run = (val) => {
    const g = N.soemdsp_graph_create(); N.soemdsp_graph_set_sample_rate(g, SR);
    N.soemdsp_graph_add_node(g, 1, 28); N.soemdsp_graph_add_node(g, 2, 228);
    N.soemdsp_graph_connect(g, 1, 0, 2, 20 /* Trigger */);
    N.soemdsp_graph_set_param(g, 1, 10, 4);
    if (val !== undefined) N.soemdsp_graph_set_param(g, 2, 40, val);
    N.soemdsp_graph_compile(g); N.soemdsp_graph_snap_controls(g);
    const out = [];
    for (let q = 0; q < 400; q++) { N.soemdsp_graph_process_block(g, 128); out.push(...new Float64Array(N.memory.buffer, N.soemdsp_graph_node_port_ptr(g, 2, 1), 128)); }
    N.soemdsp_graph_destroy(g); return out;
  };
  const u = run(), z = run(0), b = run(-1);
  if (md(u, z) !== 0) throw new Error("graph: unset != Body / Noise 0");
  if (!(md(u, b) > 1e-4)) throw new Error("graph: Body / Noise -1 had no effect");
  console.log("ok modalSnare graph: mix slot default 0 == unset, -1 changes the output");
}
