// Softpop Filter native tests (docs/SOFTPOP_PLAN.md §9 Filter checks + the
// external audio inputs). Builds native_modules/softpop_filter/softpop_filter.cpp
// with scripts/softpop_test_probe.cpp (harness: scripts/softpop_test_common.mjs)
// and runs offline at 48 kHz. Graph-level input routing (Mono / Left / Right
// per stereo_route.h): scripts/smoke_graph_softpop_filter.mjs.
//
// Usage:
//   node scripts/test_softpop_filter.mjs              (all tests)
//   node scripts/test_softpop_filter.mjs --calibrate  (k_color: 1 kHz, W 0.3, 3000 s per Color)
import { SR, COLORS, CH, Qof, dB, buildProbe, makeHarness, bitEqual, welch, smooth, lorentzFit, halfPower, sineFit } from "./softpop_test_common.mjs";

const t0 = Date.now();
const H = makeHarness(buildProbe("filter"));
const { x, gate, render, renderAll, withInstance, setParams, noiseLevel } = H;

if (process.argv.includes("--calibrate")) {
  for (const color of [0, 1, 2, 3, 4]) {
    const r = await noiseLevel({ freq: 1000, width: 0.3, color }, 3000);
    console.log(`calibrate ${COLORS[color]}: 1 kHz W=0.3 Filter level ${r.rmsDb.toFixed(4)} dB re 1/sqrt2 (${r.seconds.toFixed(0)} s) -> k *= ${Math.pow(10, -r.rmsDb / 20).toFixed(6)}`);
  }
  H.stopWorkers();
  process.exit(0);
}

// Noise bandwidth B = pi fc / (2Q); stereo L+R doubles the samples.
const levelSeconds = (fc, w) => Math.max(20, 500 / (Math.PI * Math.min(fc, 0.45 * SR) / (2 * Qof(w))));
const fcs = [50, 100, 200, 400, 800, 1600, 3200, 6400, 10000];
const levelPromises = [];
for (const color of [0, 1, 2, 3, 4]) {
  for (const w of [0, 0.2, 0.3, 0.4, 0.6, 0.8, 1]) {
    levelPromises.push(noiseLevel({ freq: 1000, width: w, color }, levelSeconds(1000, w)).then((r) => ({ kind: "width", color, w, ...r })));
  }
  for (const w of [0.3, 0, 0.9, 1]) for (const fc of fcs) {
    levelPromises.push(noiseLevel({ freq: fc, width: w, color }, levelSeconds(fc, w)).then((r) => ({ kind: "keys", color, w, fc, ...r })));
  }
  for (const a of [0, 0.25, 0.5, 0.75, 1]) {
    levelPromises.push(noiseLevel({ freq: 1000, width: 0.6, color, ampMod: a }, 240).then((r) => ({ kind: "am", color, a, ...r })));
  }
}

// ---------- 1. Decorrelation ----------
{
  const names = ["npL", "npR", "naL", "naR", "NaudL", "NaudR", "outL", "outR"];
  const chans = [CH.NP_L, CH.NP_R, CH.NA_L, CH.NA_R, CH.NAUD_L, CH.NAUD_R, CH.L, CH.R];
  const pairs = [[0, 2], [0, 4], [2, 4], [1, 3], [1, 5], [3, 5], [0, 1], [2, 3], [4, 5], [6, 7]];
  let worst = 0, worstName = "";
  for (const seed of [1, 2, 777, 16777215]) {
    const n = 60 * SR;
    const S = new Float64Array(8), SS = new Float64Array(8), SX = new Float64Array(pairs.length);
    withInstance({ freq: 1000, width: 1, seed }, (h) => {
      render(h, n, chans, (a) => {
        for (let i = 0; i < a[0].length; i++) {
          for (let c = 0; c < 8; c++) { const v = a[c][i]; S[c] += v; SS[c] += v * v; }
          for (let k = 0; k < pairs.length; k++) SX[k] += a[pairs[k][0]][i] * a[pairs[k][1]][i];
        }
      });
    });
    for (let k = 0; k < pairs.length; k++) {
      const [i, j] = pairs[k];
      const cov = SX[k] / n - (S[i] / n) * (S[j] / n);
      const r = cov / Math.sqrt((SS[i] / n - (S[i] / n) ** 2) * (SS[j] / n - (S[j] / n) ** 2));
      if (Math.abs(r) > worst) { worst = Math.abs(r); worstName = `${names[i]}~${names[j]} seed ${seed}`; }
    }
  }
  gate(worst < 0.01, `1 decorrelation: max |r| = ${worst.toFixed(4)} (${worstName}) < 0.01 over 4 seeds x ${pairs.length} pairs`);
}

// ---------- 2. Mono / Noise / CV / Seed / Reset ----------
{
  const base = { freq: 700, width: 0.5, pitch: 600, ampMod: 0.5 };
  let monoIsL = true, lrDiffer = true, noiseOk = true, cvErr = 0, cvErrW = 0;
  for (const color of [0, 1, 2, 3, 4]) {
    const [m, l, r, nl, nr, npl, npr, cl, cr] = withInstance({ ...base, color },
      (h) => renderAll(h, SR, [CH.MONO, CH.L, CH.R, CH.NAUD_L, CH.NAUD_R, CH.NP_L, CH.NP_R, CH.CV_L, CH.CV_R]));
    if (!bitEqual(m, l)) monoIsL = false;
    if (bitEqual(l, r)) lrDiffer = false;
    let pn = 0;
    for (let i = 0; i < nl.length; i++) pn += nl[i] * nl[i];
    if (Math.abs(dB(pn / nl.length)) > 0.5 || bitEqual(nl, nr)) noiseOk = false;
    const s = base.pitch * Math.LN2 / 1200, a = Math.sqrt(3) * s;
    const corr = color === 0 ? Math.log(Math.sinh(a) / a) : 0.5 * s * s;  // White: uniform +-sqrt3
    for (let i = 0; i < cl.length; i++) {
      const err = Math.max(Math.abs(cl[i] - (npl[i] * s - corr) / Math.LN2), Math.abs(cr[i] - (npr[i] * s - corr) / Math.LN2));
      if (color === 0) cvErrW = Math.max(cvErrW, err); else cvErr = Math.max(cvErr, err);
    }
  }
  gate(monoIsL, "2 Mono output: bit-identical to Left (5 colors, 1 s)");
  gate(lrDiffer, "2 Left and Right are independent renders");
  gate(noiseOk, "2 Noise L/R: unit RMS (+-0.5 dB), L != R");
  gate(cvErr < 1e-9 && cvErrW < 2e-6, `2 CV L/R: log2(fInst/fEff) per channel (max err ${cvErr.toExponential(1)} oct; White ${cvErrW.toExponential(1)} oct, dsp_ln/dsp_exp mean correction)`);
  const [c0] = withInstance({ ...base, pitch: 0 }, (h) => renderAll(h, SR / 10, [CH.CV_L]));
  gate(c0.every((v) => v === 0), "2 CV is exactly 0 with Pitch Mod 0");
  const o = { ...base, color: 3, seed: 4242 };
  const [a] = withInstance(o, (h) => renderAll(h, SR, [CH.MONO]));
  const [b] = withInstance(o, (h) => renderAll(h, SR, [CH.MONO]));
  gate(bitEqual(a, b), "2 Seed: same Seed -> bit-identical output");
  gate(withInstance(o, (h) => {
    const [first] = renderAll(h, SR, [CH.MONO]);
    x.tp_reset(h);
    const [again] = renderAll(h, SR, [CH.MONO]);
    return bitEqual(first, a) && bitEqual(again, a);
  }), "2 Reset: a Reset edge reproduces the output from the start");
  gate(withInstance(o, (h) => {
    renderAll(h, SR / 2, [CH.MONO]);
    setParams({ ...o, seed: 99 });
    const [after] = renderAll(h, SR, [CH.MONO]);
    const [fresh] = withInstance({ ...o, seed: 99 }, (h2) => renderAll(h2, SR, [CH.MONO]));
    return bitEqual(after, fresh) && !bitEqual(after, a);
  }), "2 Seed change restarts (== fresh instance with the new Seed)");
}

// ---------- 3. Bandpass shape + decramp (white noise, mods 0) ----------
{
  for (const [w, L, secs] of [[0.3, 131072, 600], [0.6, 16384, 120], [0.8, 16384, 60]]) {
    let fcEst = 0, bw = 0, how = "";
    withInstance({ freq: 1000, width: w }, (h) => {
      const [y] = renderAll(h, secs * SR, [CH.L]);
      const { psd, df } = welch(y, L);
      if (w < 0.7) { ({ fc: fcEst, bw } = lorentzFit(psd, df)); how = "Lorentz fit"; }
      else { const hp = halfPower(smooth(psd, 2), df); fcEst = Math.sqrt(hp.f1 * hp.f2); bw = hp.f2 - hp.f1; how = "crossings"; }
    });
    const bwExp = 1000 / Qof(w);
    gate(Math.abs(fcEst / 1000 - 1) < 0.005 && Math.abs(bw / bwExp - 1) < 0.1,
      `3 W=${w} (${secs} s, ${how}): centre ${fcEst.toFixed(2)} Hz (fEff 1000), -3 dB width ${bw.toFixed(2)} Hz vs fEff/Q ${bwExp.toFixed(2)} (${((bw / bwExp - 1) * 100).toFixed(1)} %)`);
  }
  for (const fc of [12000, 16000]) {
    let fcEst = 0, bw = 0;
    withInstance({ freq: fc, width: 0.3 }, (h) => {
      const [y] = renderAll(h, 300 * SR, [CH.L]);
      ({ fc: fcEst, bw } = lorentzFit(welch(y, 131072).psd, SR / 131072));
    });
    const bwExp = fc / Qof(0.3);
    gate(Math.abs(fcEst / fc - 1) < 0.005 && Math.abs(bw / bwExp - 1) < 0.05,
      `3 decramp fc=${fc} W=0.3: centre ${fcEst.toFixed(1)} Hz, -3 dB width ${bw.toFixed(2)} Hz vs analog ${bwExp.toFixed(2)} (${((bw / bwExp - 1) * 100).toFixed(1)} %)`);
  }
}

// ---------- 5. Pitch Mod (centre) symmetric in cents; near Nyquist ----------
{
  let worst = { mean: 0, skew: 0, sd: 1 };
  for (const color of [0, 1, 2, 3, 4]) for (const cents of [100, 1200]) {
    let n = 0, s1 = 0, s2 = 0, s3 = 0;
    for (const seed of [1, 2, 3, 4]) {
      withInstance({ freq: 1000, width: 0.6, pitch: cents, color, seed }, (h) => {
        render(h, 30 * SR, [CH.FI_L, CH.FI_R], (a) => {
          for (const arr of a) for (let i = 0; i < arr.length; i++) {
            const c = 1200 * Math.log2(arr[i] / 1000) / cents + 0.5 * cents * Math.LN2 / 1200;
            n++; s1 += c; s2 += c * c; s3 += c * c * c;
          }
        });
      });
    }
    const mean = s1 / n, varc = s2 / n - mean * mean, sd = Math.sqrt(varc);
    const skew = (s3 / n - 3 * mean * varc - mean ** 3) / (sd ** 3);
    if (Math.abs(mean) > Math.abs(worst.mean)) worst.mean = mean;
    if (Math.abs(skew) > Math.abs(worst.skew)) worst.skew = skew;
    if (Math.abs(sd - 1) > Math.abs(worst.sd - 1)) worst.sd = sd;
  }
  gate(Math.abs(worst.mean) < 0.1 && Math.abs(worst.skew) < 0.15 && Math.abs(worst.sd - 1) < 0.05,
    `5 Pitch Mod: worst mean ${worst.mean.toFixed(3)}σ (<0.1), skew ${worst.skew.toFixed(3)} (<0.15), sd ${worst.sd.toFixed(3)} (1 ± 5 %)`);
  let finite = true, maxHz = 0;
  for (const color of [0, 1, 2, 3, 4]) {
    withInstance({ freq: 23000, width: 1, pitch: 2400, ampMod: 1, color }, (h) => {
      render(h, 4 * SR, [CH.L, CH.R, CH.FI_L], (a) => {
        for (let i = 0; i < a[0].length; i++) {
          if (!Number.isFinite(a[0][i]) || !Number.isFinite(a[1][i]) || !Number.isFinite(a[2][i])) finite = false;
          maxHz = Math.max(maxHz, Math.abs(a[2][i]));
        }
      });
    });
  }
  gate(finite && maxHz <= SR / 2, `5 near Nyquist (fEff 23 kHz, 2400 c, W 1): finite, max |centre| ${maxHz.toFixed(1)} Hz <= fs/2`);
}

// ---------- 10. Modulation stress / 11. Edges ----------
{
  let finite = true, mx = 0;
  const sweep = (i) => { const t = (i / SR) % 2; const u = t < 1 ? t : 2 - t; return 20 * Math.pow(18000 / 20, u); };
  for (const color of [0, 1, 2, 3, 4]) for (const w of [1, 0]) {
    withInstance({ width: w, pitch: 2400, ampMod: 1, color }, (h) => {
      render(h, 10 * SR, [CH.L, CH.R], (a) => {
        for (let i = 0; i < a[0].length; i++) {
          if (!Number.isFinite(a[0][i]) || !Number.isFinite(a[1][i])) finite = false;
          mx = Math.max(mx, Math.abs(a[0][i]), Math.abs(a[1][i]));
        }
      }, { hz: sweep });
    });
  }
  gate(finite && mx <= 8, `10 stress (Pitch Mod 2400, W 1 and 0, Amp Mod 1, f 20 Hz<->18 kHz sweep, 10 s): finite, max |y| ${mx.toFixed(3)} (limit 8)`);
  let fin = true, zeroOk = true, cases = 0;
  for (const freq of [0, 20000]) for (const width of [0, 1]) for (const color of [0, 1, 2, 3, 4]) for (const amp of [1, 0]) {
    withInstance({ freq, width, color, amp, pitch: 300, ampMod: 0.5 }, (h) => {
      render(h, 2 * SR, [CH.MONO, CH.L, CH.R], (a) => {
        for (const arr of a) for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) fin = false;
          if (amp === 0 && arr[i] !== 0) zeroOk = false;
        }
      });
    });
    cases++;
  }
  gate(fin && zeroOk, `11 edges: Frequency 0 / 20 kHz x Width 0 / 1 x 5 colors x Amplitude 1 / 0 (${cases} cases): finite, Amplitude 0 is exact silence`);
}

// ---------- 12. Pitch Mod mean centre (lognormal mean correction) ----------
{
  const f0 = 440, n = 60 * SR, s = 600 * Math.LN2 / 1200;
  const mean = (pitch) => withInstance({ freq: f0, pitch, seed: 7 }, (h) => {
    let sf = 0, su = 0;
    render(h, n, [CH.FI_L, CH.NP_L], ([fi, np]) => {
      for (let i = 0; i < fi.length; i++) { sf += Math.abs(fi[i]); su += f0 * Math.exp(np[i] * s); }
    });
    return [sf / n, su / n];
  });
  const [m0] = mean(0), [m600, u600] = mean(600);
  const c = 1200 * Math.log2(m600 / m0), cu = 1200 * Math.log2(u600 / m0);
  gate(Math.abs(c) < 1, `12 mean centre Hz @440: PitchMod 0 ${m0.toFixed(3)} / 600 ${m600.toFixed(3)} (${c >= 0 ? "+" : ""}${c.toFixed(2)} cents, ±1; uncorrected would be +${cu.toFixed(1)} cents)`);
}

// ---------- 13. External audio input ----------
{
  // Wired input replaces the noise: zero input -> exact silence (no noise added).
  const [zl, zr] = withInstance({ freq: 1000, width: 0.3, pitch: 600, ampMod: 0.5 }, (h) =>
    renderAll(h, SR, [CH.L, CH.R], { l: () => 0, r: () => 0 }));
  gate(zl.every((v) => v === 0) && zr.every((v) => v === 0), "13 input wired: silent input -> exact silence (input replaces the noise)");
  // Constant-peak BP on the input: 0 dB at the centre, |H| = 1/sqrt(1 + Q^2 (r - 1/r)^2) off it (decramped).
  const rows = [];
  let worst = 0;
  // Off-centre near Nyquist with a wide Width is the cheap decramp's known squashed skirt: reported, not gated.
  let nyqInfo = "";
  for (const [fc, f, w] of [[1000, 1000, 0.3], [1000, 2000, 0.6], [1000, 500, 0.8], [8000, 8000, 0.3], [12000, 12000, 0.4], [12000, 9000, 0.7]]) {
    const q = Qof(w), r = f / fc;
    const want = 1 / Math.sqrt(1 + q * q * (r - 1 / r) ** 2);
    const settle = Math.ceil(12 * q / (Math.PI * fc) * SR) + SR / 10;
    const n = settle + SR;
    const [yl, yr] = withInstance({ freq: fc, width: w }, (h) => renderAll(h, n, [CH.L, CH.R],
      { l: (i) => Math.sin(2 * Math.PI * f * i / SR), r: (i) => 0.5 * Math.sin(2 * Math.PI * f * i / SR) }));
    const gl = sineFit(yl, f, settle).amp, gr = sineFit(yr, f, settle).amp / 0.5;
    const err = Math.max(Math.abs(dB(gl * gl / (want * want))), Math.abs(dB(gr * gr / (want * want))));
    if (fc === 12000 && f !== fc) nyqInfo = `fc ${fc} f ${f} W ${w}: ${(20 * Math.log10(gl)).toFixed(2)} dB vs analog ${(20 * Math.log10(want)).toFixed(2)} dB`;
    else worst = Math.max(worst, err);
    rows.push(`fc ${fc} f ${f} W ${w}: ${(20 * Math.log10(gl)).toFixed(2)} dB (want ${(20 * Math.log10(want)).toFixed(2)})`);
  }
  console.log(`     input |H|: ${rows.join("; ")}`);
  gate(worst < 0.3, `13 input: constant-peak BP gain, 0 dB at the centre (also 8 / 12 kHz), analog |H| off-centre (worst ${worst.toFixed(3)} dB, ±0.3)`);
  console.log(`info 13 input off-centre near Nyquist (cheap decramp skirt): ${nyqInfo}`);
  // Channels are independent: input only on L -> R silent, L unchanged by R's input.
  const sig = (i) => Math.sin(2 * Math.PI * 1000 * i / SR);
  const [a1, a2] = withInstance({ freq: 1000, width: 0.5 }, (h) => renderAll(h, SR / 2, [CH.L, CH.R], { l: sig, r: () => 0 }));
  const [b1] = withInstance({ freq: 1000, width: 0.5 }, (h) => renderAll(h, SR / 2, [CH.L], { l: sig, r: (i) => Math.sin(2 * Math.PI * 333 * i / SR) }));
  gate(a2.every((v) => v === 0) && bitEqual(a1, b1), "13 input: Left / Right channels filter their own input only");
  // Noise outs stay the internal noise; Pitch Mod / Amp Mod still act on the input.
  const [nIn, lIn] = withInstance({ freq: 1000, width: 0.5, pitch: 300, seed: 3 }, (h) => renderAll(h, SR / 2, [CH.NAUD_L, CH.L], { l: sig, r: sig }));
  const [nNo] = withInstance({ freq: 1000, width: 0.5, pitch: 300, seed: 3 }, (h) => renderAll(h, SR / 2, [CH.NAUD_L]));
  const [lFixed] = withInstance({ freq: 1000, width: 0.5, pitch: 0, seed: 3 }, (h) => renderAll(h, SR / 2, [CH.L], { l: sig, r: sig }));
  gate(bitEqual(nIn, nNo) && !bitEqual(lIn, lFixed), "13 input: Noise outs unchanged by the input; Pitch Mod still moves the centre");
}

// ---------- 6 / 7 / 8 / 9 level results ----------
const levels = await Promise.all(levelPromises);
gate(levels.reduce((s, r) => s + r.bad, 0) === 0, `level runs: no non-finite samples (${levels.reduce((s, r) => s + r.seconds, 0).toFixed(0)} s rendered)`);
for (const color of [0, 1, 2, 3, 4]) {
  const width = levels.filter((r) => r.kind === "width" && r.color === color);
  const ws = width.map((r) => `W${r.w}:${r.rmsDb >= 0 ? "+" : ""}${r.rmsDb.toFixed(2)}`).join(" ");
  gate(Math.max(...width.map((r) => Math.abs(r.rmsDb))) < 1, `7 ${COLORS[color]} level vs Width @1 kHz (dB re Sine RMS): ${ws}`);
  const at1k = width.find((r) => r.w === 0.3);
  gate(Math.abs(at1k.rmsDb) < 1, `9 ${COLORS[color]} Filter vs Oscillator Sine RMS @1 kHz (W 0.3): ${at1k.rmsDb.toFixed(2)} dB (±1)`);
  for (const w of [0.3, 0, 0.9, 1]) {
    const keys = levels.filter((r) => r.kind === "keys" && r.color === color && r.w === w);
    const row = keys.map((r) => `${r.fc}:${r.rmsDb >= 0 ? "+" : ""}${r.rmsDb.toFixed(2)}`).join(" ");
    const lo = Math.min(...keys.map((r) => r.rmsDb)), hi = Math.max(...keys.map((r) => r.rmsDb));
    if (w === 0.3 || w === 0) gate(Math.max(Math.abs(lo), Math.abs(hi)) < 1, `8 ${COLORS[color]} keyboard W=${w} (dB re Sine RMS, 50 Hz..10 kHz): ${row}`);
    else console.log(`info 8 ${COLORS[color]} keyboard W=${w} (reported, not gated): ${row}`);
  }
  const am = levels.filter((r) => r.kind === "am" && r.color === color).sort((p, q) => p.a - q.a);
  const base = am[0].rmsDb;
  const row = am.map((r) => `A${r.a}:${(r.rmsDb - base) >= 0 ? "+" : ""}${(r.rmsDb - base).toFixed(2)}`).join(" ");
  gate(Math.max(...am.map((r) => Math.abs(r.rmsDb - base))) < 0.5, `6 ${COLORS[color]} Amp Mod 0->1 RMS (dB re A0, W 0.6): ${row}`);
}
H.finish(t0);
