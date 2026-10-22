// DSF Spacing + Odd/Even (dsf v16): defaults identical to the previous build,
// Odd/Even 1 removes even partials, non-integer Spacing puts partials at
// f*(1+(k-1)*Spacing), nothing above Nyquist.
// Optional: node scripts/smoke_graph_dsf_spectrum.mjs <previous combined wasm>
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const SR = 48000;
const imp = { env: { emo_process_block: () => 0 } };
async function render(file, params, frames) {
  const e = (await WebAssembly.instantiate(fs.readFileSync(file), imp)).instance.exports;
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, SR);
  e.soemdsp_graph_add_node(g, 1, 46); e.soemdsp_graph_add_node(g, 2, 6);
  e.soemdsp_graph_connect(g, 1, 0, 2, 0);
  for (const [k, v] of Object.entries(params)) e.soemdsp_graph_set_param(g, 1, Number(k), v);
  e.soemdsp_graph_compile(g); e.soemdsp_graph_snap_controls(g);
  const y = new Float64Array(frames);
  for (let o = 0; o < frames; o += 128) {
    e.soemdsp_graph_process_block(g, 128);
    y.set(new Float64Array(e.memory.buffer, e.soemdsp_graph_node_port_ptr(g, 1, 0) | 0, 128).subarray(0, Math.min(128, frames - o)), o);
  }
  return y;
}
function spectrum(y, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  const off = y.length - N;
  for (let i = 0; i < N; i++) re[i] = y[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k);
      const ur = re[i + k], ui = im[i + k];
      const vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
    }
  }
  const m = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]);
  return m;
}
const N = 16384, binHz = SR / N;
const peakNear = (m, hz) => { const b = Math.round(hz / binHz); let p = 0; for (let k = b - 2; k <= b + 2; k++) if (k > 0 && k < m.length) p = Math.max(p, m[k]); return p; };
const dB = (x) => 20 * Math.log10(x + 1e-30);
const P = { FREQ: 10, WAVE: 11, AMP: 12, MORPH: 13, ODD: 20, SPACING: 30 };

// 1. Defaults bit-identical to the previous build (all waveforms).
const prev = process.argv[2];
if (prev && fs.existsSync(prev)) {
  for (const w of [1, 2, 3, 4]) for (const f of [110, 440, 3000]) {
    const p = { [P.FREQ]: f, [P.WAVE]: w, [P.AMP]: 1, [P.MORPH]: 1 };
    const a = await render(wasmPath, p, 9600), b = await render(prev, p, 9600);
    let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    if (d !== 0) throw new Error(`defaults differ from previous build: waveform ${w} ${f} Hz maxdiff ${d}`);
  }
  console.log("defaults bit-identical to previous build (Saw/Square/Trimorph/SquSaw, 110/440/3000 Hz)");
}

// 2. Odd/Even 1 suppresses even partials (Saw 200 Hz, Morph 0.6).
{
  const f = 187.5;
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.WAVE]: 1, [P.AMP]: 1, [P.MORPH]: 0.6, [P.ODD]: 1 }, 48000), N);
  const m0 = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.WAVE]: 1, [P.AMP]: 1, [P.MORPH]: 0.6, [P.ODD]: 0 }, 48000), N);
  let worst = -999;
  for (let k = 2; k <= 20; k += 2) worst = Math.max(worst, dB(peakNear(m, k * f)) - dB(peakNear(m0, k * f)));
  const odd3 = dB(peakNear(m, 3 * f)) - dB(peakNear(m0, 3 * f));
  if (!(worst < -40)) throw new Error(`Odd/Even 1: even partials only ${worst.toFixed(1)} dB down`);
  if (!(Math.abs(odd3) < 1)) throw new Error(`Odd/Even 1: 3rd partial moved ${odd3.toFixed(2)} dB`);
  console.log(`Odd/Even 1: even partials ${worst.toFixed(1)} dB down (worst of 2..20), odd 3rd ${odd3.toFixed(2)} dB`);
}

// 3. Spacing 1.5: partials at f*(1+(k-1)*1.5) = 187.5, 468.75, 750, ...; none at 2f.
{
  const f = 187.5, sp = 1.5;
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.WAVE]: 1, [P.AMP]: 1, [P.MORPH]: 0.6, [P.SPACING]: sp }, 48000), N);
  const ref = Math.max(...m);
  let minHit = 999;
  for (let k = 1; k <= 6; k++) minHit = Math.min(minHit, dB(peakNear(m, f * (1 + (k - 1) * sp))) - dB(ref));
  const miss = dB(peakNear(m, 2 * f)) - dB(ref);
  if (!(minHit > -40)) throw new Error(`Spacing 1.5: expected partial missing (${minHit.toFixed(1)} dB)`);
  if (!(miss < -60)) throw new Error(`Spacing 1.5: energy at 2f ${miss.toFixed(1)} dB`);
  console.log(`Spacing 1.5: partials 1..6 at expected Hz (weakest ${minHit.toFixed(1)} dB), 2f ${miss.toFixed(1)} dB`);
}

// 4. No aliasing: every strong bin above 150 Hz sits on an expected partial
// under Nyquist (below that is the leaky integrators' settling, not aliasing).
for (const [f, sp, odd] of [[1500, 2.7, 0], [2500, 0.37, 0.5], [900, 3.3, 1]]) {
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.WAVE]: 1, [P.AMP]: 1, [P.MORPH]: 1, [P.SPACING]: sp, [P.ODD]: odd }, 48000), N);
  const ref = Math.max(...m);
  const expected = [];
  for (let k = 1; f * (1 + (k - 1) * sp) <= SR / 2; k++) expected.push(f * (1 + (k - 1) * sp));
  let worst = -999, worstHz = 0;
  for (let b = Math.ceil(150 / binHz); b < m.length; b++) {
    const hz = b * binHz;
    if (expected.some((e) => Math.abs(e - hz) < 6 * binHz)) continue;
    const v = dB(m[b]) - dB(ref);
    if (v > worst) { worst = v; worstHz = hz; }
  }
  if (!(worst < -60)) throw new Error(`alias/stray energy f=${f} spacing=${sp}: ${worst.toFixed(1)} dB at ${worstHz.toFixed(0)} Hz`);
  console.log(`no aliasing f=${f} Spacing=${sp} Odd/Even=${odd}: worst off-partial bin ${worst.toFixed(1)} dB`);
}
// 5. Near-harmonic Spacing at Morph 1 does not drift (closed-form pole).
for (const f of [30, 440, 1500]) {
  const y = await render(wasmPath, { [P.FREQ]: f, [P.WAVE]: 1, [P.AMP]: 1, [P.MORPH]: 1, [P.SPACING]: 1.0001 }, 96000);
  let mean = 0, pk = 0; for (let i = 48000; i < 96000; i++) { mean += y[i]; pk = Math.max(pk, Math.abs(y[i])); }
  mean /= 48000;
  if (!(Math.abs(mean) < 0.01 && pk < 1.0)) throw new Error(`Spacing 1.0001 drift at ${f} Hz: mean ${mean} peak ${pk}`);
}
console.log("Spacing 1.0001 Morph 1: no drift (30/440/1500 Hz)");
console.log("smoke_graph_dsf_spectrum ok");
