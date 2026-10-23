// Filter Morph Osc v8: PolyBLEP/BLAMP + pitch-tracked ƒ…4ƒ noise band (Start/Full/Amount).
import fs from "node:fs";
const wasm = fs.readFileSync(new URL("../native_modules/filter_morph_oscillator/filter_morph_oscillator.wasm", import.meta.url));
const stub = new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) });
const { instance } = await WebAssembly.instantiate(wasm, stub);
const e = instance.exports;
const fail = (m) => { console.error("FAIL " + m); process.exit(1); };
if ((e.soemdsp_filter_morph_oscillator_version() | 0) < 8) fail("version < 8");
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
for (const wave of [0, 1, 2, 3, 4, 5, 6]) for (const d of [0, 1]) for (const f of [110, 5000, 9700]) {
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
