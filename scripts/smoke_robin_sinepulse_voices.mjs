// Headless: Robin Sinepulse Voices + Fade Time (robin_sinepulse v8).
// Uses the standalone robin_sinepulse.wasm (no imports).
// Voices is a click-helper fade stack: one live kick. A retrigger always steals
// it. Fade Time is linear gain 1 -> 0 in ms (Decay does not scale it).
// 1) Voices 1, Fade 0 = old hard-reset behaviour: after a retrigger the output
//    equals a fresh instance hit at the same sample.
// 2) Fade > 0: the stolen voice plays on as old * (1 - k/F) next to the new hit
//    (exact), and the step at the retrigger is about the normal tail step.
// 3) Voices 8 + Decay 100 s: two spaced hits still steal; after Fade Time only
//    the new kick is live (not two full decays).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasm = fs.readFileSync(path.join(root, "native_modules", "robin_sinepulse", "robin_sinepulse.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, {});
const e = instance.exports;
const ver = e.soemdsp_robin_sinepulse_version();
if (ver < 8) throw new Error(`robin_sinepulse version ${ver} < 8`);
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

// 3) Voices 8, Decay 100 s: a retrigger still steals (one live kick). After
//    Fade Time the old hit is gone; Decay does not stretch the fade.
{
  const fadeMs = 2, F = fadeMs * 0.001 * SR;
  const p8 = { ...BASE, voices: 8, fade: fadeMs, decay: 100 };
  const n2 = Math.round(0.5 * SR);
  const two = render(p8, [[0, 1], [n2, 1]], N);
  const old = render(p8, [[0, 1]], N);
  const neu = shift(render(p8, [[0, 1]], N), n2, N);
  const ref = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const g = i < n2 ? 1 : Math.max(0, 1 - (i - n2) / F);
    ref[i] = old[i] * g + neu[i];
  }
  const d3 = maxAbsDiff(two, ref);
  if (d3 > 1e-12) throw new Error(`Voices 8 Decay 100s steal differs from new + faded old by ${d3}`);
  const after = Math.ceil(n2 + F + 2);
  const dLive = maxAbsDiff(two.subarray(after), neu.subarray(after));
  if (dLive > 1e-12) throw new Error(`Voices 8 Decay 100s: old kick still live after fade (${dLive})`);
  lines.push(`Voices 8 Decay 100s: steal err ${d3.toExponential(1)}, after-fade leftover ${dLive.toExponential(1)}`);
}
// 4) Voices 1 vs 2 on hits closer than Fade Time: Voices 1 drops the oldest fade.
{
  const fadeMs = 5, F = fadeMs * 0.001 * SR;
  const t1 = 40, t2 = 80;
  const p1 = { ...BASE, voices: 1, fade: fadeMs, decay: 1 };
  const p2 = { ...BASE, voices: 2, fade: fadeMs, decay: 1 };
  const hits = [[0, 1], [t1, 1], [t2, 1]];
  const y1 = render(p1, hits, N);
  const y2 = render(p2, hits, N);
  const a = render(p1, [[0, 1]], N);
  const b = shift(render(p1, [[0, 1]], N), t1, N);
  const c = shift(render(p1, [[0, 1]], N), t2, N);
  const ref1 = new Float64Array(N), ref2 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const gA1 = i < t1 ? 1 : Math.max(0, 1 - (i - t1) / F);
    const gB1 = i < t2 ? 1 : Math.max(0, 1 - (i - t2) / F);
    // Voices 1: A fades at t1, then is dropped at t2 (only B's fade remains).
    const a1 = i < t2 ? a[i] * gA1 : 0;
    ref1[i] = a1 + b[i] * (i < t2 ? 1 : gB1) + c[i];
    // Voices 2: A keeps fading through t2, B starts fading at t2, C is live.
    const gA2 = i < t1 ? 1 : Math.max(0, 1 - (i - t1) / F);
    ref2[i] = a[i] * gA2 + b[i] * (i < t2 ? 1 : gB1) + c[i];
  }
  const d1 = maxAbsDiff(y1, ref1);
  const d2 = maxAbsDiff(y2, ref2);
  if (d1 > 1e-12) throw new Error(`Voices 1 fast stack differs by ${d1}`);
  if (d2 > 1e-12) throw new Error(`Voices 2 fast stack differs by ${d2}`);
  lines.push(`Voices 1/2 fast stack err ${d1.toExponential(1)} / ${d2.toExponential(1)}`);
}
for (const l of lines) console.log("ok   " + l);
console.log(`smoke_robin_sinepulse_voices ok: version=${ver}`);
