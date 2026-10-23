// Filter Morph Osc v8: PolyBLEP/BLAMP + pitch-tracked ƒ…4ƒ noise band (Start/Full/Amount).
import fs from "node:fs";
const wasm = fs.readFileSync(new URL("../native_modules/filter_morph_oscillator/filter_morph_oscillator.wasm", import.meta.url));
const stub = new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) });
const { instance } = await WebAssembly.instantiate(wasm, stub);
const e = instance.exports;
const fail = (m) => { console.error("FAIL " + m); process.exit(1); };
if ((e.soemdsp_filter_morph_oscillator_version() | 0) < 12) fail("version < 12");
const SR = 48000;
const render = (f, wave, dither, n = 8192, start = 2000, full = 7000, amount = 1) => {
  const h = e.soemdsp_filter_morph_oscillator_create();
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = e.soemdsp_filter_morph_oscillator_sample(
      h, f, SR, 1, 1, wave, 0, 1, 0, dither, start, full, amount
    );
  }
  e.soemdsp_filter_morph_oscillator_destroy(h);
  return a;
};
const mag = (a, f) => {
  let re = 0, im = 0;
  for (let i = 1024; i < a.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - 1024)) / (a.length - 1024));
    re += a[i] * w * Math.cos((2 * Math.PI * f * i) / SR);
    im += a[i] * w * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return Math.hypot(re, im);
};
for (const wave of [0, 1, 2, 3, 4, 5, 6, 7]) for (const d of [0, 1]) for (const f of [110, 5000, 9700]) {
  const a = render(f, wave, d);
  if (!a.every(Number.isFinite)) fail(`non-finite wave ${wave} dither ${d} f ${f}`);
  if (Math.max(...a.map(Math.abs)) > 4) fail(`runaway wave ${wave} dither ${d} f ${f}`);
}
// Saw 9700 Hz, Dither Off: 3rd harmonic folds to 48000 - 29100 = 18900 Hz.
const saw = render(9700, 0, 0);
const rel = 20 * Math.log10(mag(saw, 18900) / mag(saw, 9700));
if (!(rel < -18)) fail(`saw 9700 alias at 18900 Hz is ${rel.toFixed(1)} dB (want < -18)`);
// Low pitch Dither Off stays a saw (BLEP only touches the samples at the wrap).
const low = render(110, 0, 0);
if (!(mag(low, 110) > 10 * mag(low, 330) / 3 * 0.5)) fail("110 Hz saw lost its fundamental");
const sine = render(110, 7, 0);
if (!(mag(sine, 110) > 20 * mag(sine, 330))) fail("110 Hz Sine should be almost only fundamental");
// Plain triangle 3rd harmonic is 1/9 of the fundamental (-19.08 dB).
const TRI3_DB = 20 * Math.log10(1 / 9);
// Knee Tri (index 3): odd harmonics only, 3rd below the plain triangle's.
const knee = render(110, 3, 0);
const k3 = 20 * Math.log10(mag(knee, 330) / mag(knee, 110));
if (!(k3 < TRI3_DB - 0.2)) fail(`Knee Tri 3rd ${k3.toFixed(1)} dB not below triangle ${TRI3_DB.toFixed(1)} dB`);
if (!(mag(knee, 220) < 0.01 * mag(knee, 110))) fail("Knee Tri has even harmonics");
// Knee Tri 5 kHz @ 48k: curvature-step BLEP vs the same knee shape uncorrected
// (naive samples through the same Morph 1 one-pole). Aliases of 5k: 3k, 13k, 23k.
const kneeNaive = (f, n = 8192) => {
  const W = 0.121 * 0.25, A = 1 - 2 * W, B = 2 / W, S = 1 / (1 - 2 * W);
  const fc = Math.min(100 * f, 0.45 * SR), a1 = Math.exp(-(fc * 2 * Math.PI) / SR);
  const out = new Float64Array(n);
  let ph = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    ph = (ph + f / SR) % 1;
    const x = 1 - 4 * Math.abs(ph - 0.5);
    const d = 0.25 * (1 - Math.abs(x));
    const v = (d < W ? A - B * d * d : 1 - 4 * d) * S;
    lp = (1 - a1) * (x < 0 ? -v : v) + a1 * lp;
    out[i] = lp;
  }
  return out;
};
const aliasDb = (a, f, al) => 20 * Math.log10(al.reduce((s, h) => s + mag(a, h), 0) / mag(a, f));
const kAl = [3000, 13000, 23000];
const kneeHi = render(5000, 3, 0);
const kneeHiDb = aliasDb(kneeHi, 5000, kAl);
const kneeRawDb = aliasDb(kneeNaive(5000), 5000, kAl);
if (!(kneeHiDb < kneeRawDb - 6)) fail(`Knee Tri 5 kHz alias ${kneeHiDb.toFixed(1)} dB not 6 dB under uncorrected ${kneeRawDb.toFixed(1)} dB`);
console.log(`knee tri 3rd ${k3.toFixed(1)} dB; 5 kHz alias ${kneeHiDb.toFixed(1)} dB vs uncorrected ${kneeRawDb.toFixed(1)} dB`);
const corr = (a, b) => {
  let dot = 0, da = 0, db = 0;
  for (let i = 1024; i < a.length; i++) {
    dot += a[i] * b[i];
    da += a[i] * a[i];
    db += b[i] * b[i];
  }
  return dot / Math.sqrt(da * db);
};
const lowOn = render(110, 0, 1);
const cLow = corr(low, lowOn);
if (!(cLow > 0.995)) fail(`110 Hz dither On should stay locked, corr=${cLow.toFixed(4)}`);
const midOff = render(4000, 0, 0);
const midOn = render(4000, 0, 1);
const rumble = 20 * Math.log10((mag(midOn, 1000) + 1e-12) / (mag(midOn, 4000) + 1e-12));
if (!(rumble < -12)) fail(`4000 Hz noise leaked below ƒ: 1 kHz is ${rumble.toFixed(1)} dB vs fund`);
if (!(mag(midOn, 6000) > 2 * mag(midOff, 6000))) {
  fail(`4000 Hz missing in-band sizzle at 6 kHz (on ${mag(midOn, 6000).toFixed(2)} off ${mag(midOff, 6000).toFixed(2)})`);
}
const hf = (a) => mag(a, 16000) + mag(a, 18000) + mag(a, 20000);
const sawOn = render(9700, 0, 1);
const hfOff = hf(saw);
const hfOn = hf(sawOn);
if (!(hfOn > 1.15 * hfOff)) fail(`9700 Hz dither On sizzle ${hfOn.toFixed(2)} vs Off ${hfOff.toFixed(2)}`);
console.log(`filter morph blep ok (saw 9700 alias ${rel.toFixed(1)} dB, 110 Hz corr ${cLow.toFixed(4)}, 4 kHz rumble ${rumble.toFixed(1)} dB, hf ${hfOn.toFixed(2)}/${hfOff.toFixed(2)})`);
