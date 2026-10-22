// Headless: Robin Sinepulse Voices + Fade Time (robin_sinepulse v7).
// Uses the standalone robin_sinepulse.wasm (no imports).
// 1) Voices 1, Fade 0 = old hard-reset behaviour: after a retrigger the output
//    equals a fresh instance hit at the same sample.
// 2) Fade > 0: the stolen voice plays on as old * (1 - k/F) next to the new hit
//    (exact), and the step at the retrigger is about the normal tail step.
// 3) Voices 3: overlapping hits sum exactly to independent single hits.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "robin_sinepulse", "robin_sinepulse.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, {});
const e = instance.exports;
const ver = e.soemdsp_robin_sinepulse_version();
if (ver < 7) throw new Error(`robin_sinepulse version ${ver} < 7`);
const SR = 48000;
const BASE = { hi: 10000, lo: 40, sweep: 0.05, decay: 0.5, phase: 0, wave: 0, voices: 1, fade: 0 };

// hits: array of [sampleIndex, height]; returns Float64Array.
function render(p, hits, n) {
  const h = e.soemdsp_robin_sinepulse_create();
  const out = new Float64Array(n);
  const map = new Map(hits);
  let gate = 0;
  for (let i = 0; i < n; i++) {
    // gate falls to 0 the sample after a hit so every hit is a fresh abs rise
    gate = map.has(i) ? map.get(i) : 0;
    out[i] = e.soemdsp_robin_sinepulse_sample(h, gate, p.hi, p.lo, p.sweep, 0, 0, p.wave, 0, p.phase,
      p.decay, 1, SR, 0, p.voices, p.fade);
  }
  e.soemdsp_robin_sinepulse_destroy(h);
  return out;
}
const maxAbsDiff = (a, b, from = 0) => { let m = 0; for (let i = from; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const shift = (a, k, n) => { const o = new Float64Array(n); for (let i = k; i < n; i++) o[i] = a[i - k]; return o; };
function tailStep(y, n2) { let m = 0; for (let i = n2 - 400; i < n2; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1])); return m; }

const N = 24000;
const cases = [
  { name: "sine High 10k", p: {}, t: 0.1013 },
  { name: "sine High 200", p: { hi: 200 }, t: 0.1013 },
  { name: "sine Phase 0.25", p: { phase: 0.25 }, t: 0.2507 },
  { name: "TriSaw", p: { wave: 2 }, t: 0.1013 },
];
const lines = [];
for (const c of cases) {
  const n2 = Math.round(c.t * SR);
  const p0 = { ...BASE, ...c.p, fade: 0 };
  const hitA = render(p0, [[0, 1]], N);
  const hitB = shift(render(p0, [[0, 1]], N), n2, N);  // fresh hit at n2

  // 1) Fade 0, Voices 1: old behaviour (hard reset) == old hit until n2, fresh hit after.
  const hard = render(p0, [[0, 1], [n2, 1]], N);
  const d1 = Math.max(maxAbsDiff(hard.subarray(0, n2), hitA.subarray(0, n2)), maxAbsDiff(hard.subarray(n2), hitB.subarray(n2)));
  if (d1 > 1e-12) throw new Error(`${c.name}: Fade 0 Voices 1 differs from hard reset by ${d1}`);

  // 2) Fade 2 ms: new hit + stolen voice * linear fade (exact).
  const fadeMs = 2, F = fadeMs * 0.001 * SR;
  const soft = render({ ...p0, fade: fadeMs }, [[0, 1], [n2, 1]], N);
  const ref = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const g = i < n2 ? 1 : Math.max(0, 1 - (i - n2) / F);
    ref[i] = hitA[i] * g + hitB[i];
  }
  const d2 = maxAbsDiff(soft, ref);
  if (d2 > 1e-12) throw new Error(`${c.name}: Fade 2 ms differs from new + faded old by ${d2}`);

  // Retrigger step: |y[n2] - y[n2-1]| minus the new hit's own first sample
  // (a fresh hit from silence has that step too; Phase 0.25 starts at 1).
  const own = Math.abs(hitB[n2]);
  const jumpHard = Math.abs(hard[n2] - hard[n2 - 1]);
  const jumpSoft = Math.abs(soft[n2] - soft[n2 - 1]);
  const normal = tailStep(hitA, n2);
  const excessHard = Math.max(0, jumpHard - own), excessSoft = Math.max(0, Math.abs(jumpSoft - own));
  if (excessSoft > 2 * normal + 1e-9) throw new Error(`${c.name}: Fade 2 ms retrigger step ${jumpSoft} (own ${own}) vs normal ${normal}`);
  lines.push(`${c.name}: step hard ${jumpHard.toFixed(4)} soft ${jumpSoft.toFixed(4)} (new hit's own first sample ${own.toFixed(4)}), normal tail step ${normal.toFixed(4)}`);
}

// 3) Voices 3: three overlapping hits (different heights) sum exactly.
{
  const p3 = { ...BASE, voices: 3, fade: 2, decay: 1 };
  const hits = [[0, 1], [3000, 0.6], [6000, 0.8]];
  const sum = render(p3, hits, N);
  const ref = new Float64Array(N);
  for (const [at, v] of hits) { const one = shift(render(p3, [[0, v]], N), at, N); for (let i = 0; i < N; i++) ref[i] += one[i]; }
  const d3 = maxAbsDiff(sum, ref);
  if (d3 > 1e-12) throw new Error(`Voices 3 overlap differs from summed single hits by ${d3}`);
  // 4th hit steals the oldest (hit at 0) with a fade.
  const hits4 = [...hits, [9000, 1]];
  const s4 = render(p3, hits4, N);
  const F = 0.002 * SR;
  const r4 = new Float64Array(N);
  for (const [at, v] of hits4) {
    const one = shift(render(p3, [[0, v]], N), at, N);
    for (let i = 0; i < N; i++) r4[i] += one[i] * (at === 0 && i >= 9000 ? Math.max(0, 1 - (i - 9000) / F) : 1);
  }
  const d4 = maxAbsDiff(s4, r4);
  if (d4 > 1e-12) throw new Error(`Voices 3 steal differs by ${d4}`);
  lines.push(`Voices 3: overlap sum err ${d3.toExponential(1)}, 4th-hit steal err ${d4.toExponential(1)}`);
}
for (const l of lines) console.log("ok   " + l);
console.log(`smoke_robin_sinepulse_voices ok: version=${ver}`);
