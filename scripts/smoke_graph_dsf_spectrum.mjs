// DSF Morphing Osc (type 232) Morph / Symmetry / Width / Rotate / Slice (dsf v21).
// DSF Oscillator (type 46) is the harmonic SineSaw kit (no morphing knobs).
// Width 1 is odd-only square-to-sine DSF. Slice raises the start partial.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const SR = 48000;
const imp = { env: { emo_process_block: () => 0 } };
const TYPE_DSF = 46;
const TYPE_DSF_MORPH = 232;
async function render(file, params, frames, typeId = TYPE_DSF_MORPH) {
  const e = (await WebAssembly.instantiate(fs.readFileSync(file), imp)).instance.exports;
  const g = e.soemdsp_graph_create() | 0;
  e.soemdsp_graph_set_sample_rate(g, SR);
  e.soemdsp_graph_add_node(g, 1, typeId); e.soemdsp_graph_add_node(g, 2, 6);
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
const P = { FREQ: 10, WAVE: 11, AMP: 12, MORPH: 13, ROTATE: 20, SLICE: 30, WIDTH: 31, SYMMETRY: 40 };

// 0. DSF Oscillator (type 46) ignores morphing slots (harmonic-only).
{
  const f = 187.5;
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.WAVE]: 1, [P.AMP]: 1, [P.MORPH]: 0.6, [P.WIDTH]: 1, [P.SLICE]: 0.8 }, 48000, TYPE_DSF), N);
  const m0 = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.WAVE]: 1, [P.AMP]: 1, [P.MORPH]: 0.6, [P.WIDTH]: 0, [P.SLICE]: 0 }, 48000, TYPE_DSF), N);
  const even2 = dB(peakNear(m, 2 * f)) - dB(peakNear(m0, 2 * f));
  if (!(even2 > -6)) throw new Error(`DSF Oscillator type 46 still applies Width (${even2.toFixed(1)} dB at 2f)`);
  console.log(`DSF Oscillator (46) ignores Width/Slice: 2f delta ${even2.toFixed(1)} dB`);
}

// 1. Width 1 suppresses even partials (Morph 0.6).
{
  const f = 187.5;
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.AMP]: 1, [P.MORPH]: 0.6, [P.WIDTH]: 1 }, 48000), N);
  const m0 = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.AMP]: 1, [P.MORPH]: 0.6, [P.WIDTH]: 0 }, 48000), N);
  let worst = -999;
  for (let k = 2; k <= 20; k += 2) worst = Math.max(worst, dB(peakNear(m, k * f)) - dB(peakNear(m0, k * f)));
  const odd3 = dB(peakNear(m, 3 * f)) - dB(peakNear(m0, 3 * f));
  if (!(worst < -40)) throw new Error(`Width 1: even partials only ${worst.toFixed(1)} dB down`);
  if (!(odd3 > -8)) throw new Error(`Width 1: 3rd partial dropped ${odd3.toFixed(2)} dB`);
  console.log(`Width 1: even partials ${worst.toFixed(1)} dB down (worst of 2..20), odd 3rd ${odd3.toFixed(2)} dB`);
}

// 2. Slice ~0.15 at 187.5 Hz (n≈127) starts around harmonic 20: fundamental gone, 20f present.
{
  const f = 187.5;
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.AMP]: 1, [P.MORPH]: 1, [P.SLICE]: 0.15 }, 48000), N);
  const fund = dB(peakNear(m, f)) - dB(Math.max(...m));
  const hi = dB(peakNear(m, 20 * f)) - dB(Math.max(...m));
  if (!(fund < -25)) throw new Error(`Slice 0.15: fundamental still ${fund.toFixed(1)} dB`);
  if (!(hi > -20)) throw new Error(`Slice 0.15: start brick missing (${hi.toFixed(1)} dB at 20f)`);
  console.log(`Slice 0.15: fundamental ${fund.toFixed(1)} dB, 20f ${hi.toFixed(1)} dB`);
}

// 3. Rotate does not grow extra partials (same bins as rotate 0).
{
  const f = 187.5;
  const m0 = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.AMP]: 1, [P.MORPH]: 1, [P.ROTATE]: 0 }, 48000), N);
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.AMP]: 1, [P.MORPH]: 1, [P.ROTATE]: 0.37 }, 48000), N);
  const ref = Math.max(...m0);
  let worst = -999, worstHz = 0;
  for (let b = Math.ceil(150 / binHz); b < m.length; b++) {
    const hz = b * binHz;
    const k = hz / f;
    const near = Math.abs(k - Math.round(k)) * f < 6 * binHz && Math.round(k) >= 1;
    if (near) continue;
    const v = dB(m[b]) - dB(ref);
    if (v > worst) { worst = v; worstHz = hz; }
  }
  if (!(worst < -50)) throw new Error(`Rotate grew a partial: ${worst.toFixed(1)} dB at ${worstHz.toFixed(0)} Hz`);
  console.log(`Rotate 0.37: worst off-partial bin ${worst.toFixed(1)} dB`);
}

// 4. No aliasing under Width / Symmetry / Slice.
for (const [f, width, sym, slice] of [[1500, 1, 0, 0], [900, 0, 1, 0], [2500, 0.5, 0.5, 0.2]]) {
  const m = spectrum(await render(wasmPath, { [P.FREQ]: f, [P.AMP]: 1, [P.MORPH]: 1, [P.WIDTH]: width, [P.SYMMETRY]: sym, [P.SLICE]: slice }, 48000), N);
  const ref = Math.max(...m);
  let worst = -999, worstHz = 0;
  for (let b = Math.ceil(150 / binHz); b < m.length; b++) {
    const hz = b * binHz;
    const k = Math.round(hz / f);
    if (k >= 1 && Math.abs(hz - k * f) < 6 * binHz) continue;
    const v = dB(m[b]) - dB(ref);
    if (v > worst) { worst = v; worstHz = hz; }
  }
  if (!(worst < -50)) throw new Error(`alias/stray energy f=${f}: ${worst.toFixed(1)} dB at ${worstHz.toFixed(0)} Hz`);
  console.log(`no aliasing f=${f} Width=${width} Sym=${sym} Slice=${slice}: worst off-partial ${worst.toFixed(1)} dB`);
}

// 5. Morph 1 does not drift (closed-form pole).
for (const f of [30, 440, 1500]) {
  const y = await render(wasmPath, { [P.FREQ]: f, [P.AMP]: 1, [P.MORPH]: 1 }, 96000);
  let mean = 0, pk = 0; for (let i = 48000; i < 96000; i++) { mean += y[i]; pk = Math.max(pk, Math.abs(y[i])); }
  mean /= 48000;
  if (!(Math.abs(mean) < 0.01 && pk <= 1.5)) throw new Error(`Morph 1 drift at ${f} Hz: mean ${mean} peak ${pk}`);
}
console.log("Morph 1: no drift (30/440/1500 Hz)");
console.log("smoke_graph_dsf_spectrum ok");
