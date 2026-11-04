// DSF Oscillator (dsf v33) stays level under "standard" modulation:
//   - Trimorph level is steady at any Morph / Bright / pitch (no peak follower)
//   - Bright LFO, Morph LFO, pitch sweeps and vibrato never push any waveform
//     to the 1.5 clamp, and leave no DC
// Very fast abuse (audio-rate Bright steps, deep audio-rate FM) may still bump
// or clip; that is allowed and not tested here.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(path.join(root, "native_modules", "dsf_oscillator", "dsf_oscillator.wasm")), { env: {} });
const E = instance.exports;
const SR = 48000;
const WAVES = ["Sine", "Saw", "Square", "Trimorph", "SquSaw"];
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail !== "" ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};
check(E.soemdsp_dsf_oscillator_version() === 33, "dsf version 33", E.soemdsp_dsf_oscillator_version());

function run(wave, {
  f = () => 220,
  bright = () => 1,
  morph = () => 0.5,
  partials = 20000,
  seconds = 1.5,
} = {}) {
  const h = E.soemdsp_dsf_oscillator_create();
  let peak = 0;
  let sum = 0;
  let count = 0;
  const n = Math.round(SR * seconds);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    E.soemdsp_dsf_oscillator_sample(
      h, f(t), SR, wave, bright(t), morph(t), 0.5, 0, 1, partials,
    );
    const y = E.soemdsp_dsf_oscillator_out(h);
    if (t > 0.25) {
      peak = Math.max(peak, Math.abs(y));
      sum += y;
      count += 1;
    }
  }
  E.soemdsp_dsf_oscillator_destroy(h);
  return { peak, dc: sum / count };
}

// 1) Trimorph level: steady across Morph / Bright / pitch.
{
  let lo = Infinity;
  let hi = -Infinity;
  for (const bright of [1, 0.3, 0.05]) {
    for (const f of [55, 220, 1760]) {
      for (const w of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const { peak } = run(3, { f: () => f, bright: () => bright, morph: () => w, seconds: 0.75 });
        lo = Math.min(lo, peak);
        hi = Math.max(hi, peak);
      }
    }
  }
  check(lo > 0.6 && hi < 1.15, "Trimorph level steady at any Morph / Bright / pitch", `${lo.toFixed(2)}..${hi.toFixed(2)}`);
}

// 2) Standard modulation: no waveform reaches the clamp or keeps DC.
const standard = {
  "Bright LFO 2 Hz": { bright: (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t) },
  "Morph LFO 2 Hz (.1..9)": { morph: (t) => 0.5 + 0.4 * Math.sin(2 * Math.PI * 2 * t) },
  "pitch sweep 50..5k at 1 Hz": { f: (t) => 50 * Math.pow(100, 0.5 + 0.5 * Math.sin(2 * Math.PI * t)) },
  "vibrato 220 Â± 20 at 5 Hz": { f: (t) => 220 + 20 * Math.sin(2 * Math.PI * 5 * t) },
  "slow deep FM 220 Â± 200 at 3 Hz": { f: (t) => 220 + 200 * Math.sin(2 * Math.PI * 3 * t) },
};
for (const [label, opts] of Object.entries(standard)) {
  for (let w = 0; w < WAVES.length; w += 1) {
    const { peak, dc } = run(w, opts);
    check(peak < 1.49 && Math.abs(dc) < 0.02, `${WAVES[w]}: ${label}`, `peak ${peak.toFixed(2)}, DC ${dc.toFixed(3)}`);
  }
}

console.log(failed ? `${failed} FAILED` : "ok dsf oscillator stability");

// Partials: at 1 Hz with cap 4, energy above ~6 Hz should be tiny vs unlimited.
{
  function periodAmp(y, k) {
    const N = y.length;
    let re = 0, im = 0;
    const w = 2 * Math.PI * k / N;
    for (let n = 0; n < N; n++) {
      re += y[n] * Math.cos(w * n);
      im -= y[n] * Math.sin(w * n);
    }
    return Math.hypot(re, im) * 2 / N;
  }
  function renderCap(cap) {
    const h = E.soemdsp_dsf_oscillator_create();
    E.soemdsp_dsf_oscillator_reset(h);
    const N = SR; // 1 Hz → one period
    const y = new Float64Array(N);
    // settle 2 periods then capture 1
    for (let i = 0; i < N * 3; i++) {
      E.soemdsp_dsf_oscillator_sample(h, 1, SR, 1, 1, 0.5, 0.5, 0, 1, cap);
      if (i >= N * 2) y[i - N * 2] = E.soemdsp_dsf_oscillator_out(h);
    }
    E.soemdsp_dsf_oscillator_destroy(h);
    return y;
  }
  const y4 = renderCap(4);
  const yUnlim = renderCap(1048576);
  const h4 = periodAmp(y4, 4);
  const h8cap = periodAmp(y4, 8);
  const h8full = periodAmp(yUnlim, 8);
  check(h8cap < h4 * 0.15, "Partials 4: h8 << h4", `h4=${h4.toExponential(2)} h8=${h8cap.toExponential(2)}`);
  check(h8full > h8cap * 5, "Partials unlimited keeps h8", `capped=${h8cap.toExponential(2)} unlim=${h8full.toExponential(2)}`);
}

process.exit(failed ? 1 : 0);
