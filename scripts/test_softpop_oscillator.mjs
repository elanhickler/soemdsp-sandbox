// Softpop Oscillator native tests (docs/SOFTPOP_PLAN.md Â§9 oscillator checks,
// Oscillator Source / Morph). Builds
// native_modules/softpop_oscillator/softpop_oscillator.cpp (+ ellipsoid.cpp for
// the Robin dither) with scripts/softpop_test_probe.cpp (harness:
// scripts/softpop_test_common.mjs) and runs offline at 48 kHz.
//
// Usage: node scripts/test_softpop_oscillator.mjs
import { SR, COLORS, CH, Qof, dB, buildProbe, makeHarness, bitEqual, welch, sineFit } from "./softpop_test_common.mjs";

const SRC = { SINE: 0, DSINE: 1, TRISAW: 2, SQUARE: 3, TRI: 4, PBTRI: 5 };
const SRC_NAMES = ["Sine", "Dithered Sine", "Dithered Trisaw", "Soft Square", "Soft Tri", "PolyBLEP Trisaw"];
// Ellipsoid sharpness limit (ellipsoid.cpp ellipseCMin): axis ratio >= omega = min(2 pi |f| / fs, 1).
const cMin = (f) => Math.min(2 * Math.PI * Math.abs(f) / SR, 1);
// soundemote.dev /softsquare SquareToSine, k floored by the Ellipsoid limit:
// c = sqrt(k / (1 + k)) >= omega (identical to Ellipsoid getSineToSquare on sin).
const softSquareRef = (t, m, f, floor = true) => {
  const c = Math.max(Math.sqrt(Math.max(Math.cos(Math.PI * m / 2), 0)), floor ? cMin(f) : 0), sn = Math.sin(2 * Math.PI * t);
  return sn / Math.sqrt((1 - c * c) * sn * sn + c * c);
};
// soundemote.dev /softtriangle Ellipsoid Sym (stEllipsoidSymY, C = 0.225), peak-normalised,
// B = sqrt(Morph) with the same Ellipsoid floor B >= omega.
const ELL_C = 0.225;
const ellipsoidSymRef = (t, m, f, floor = true) => {
  const B = Math.max(Math.sqrt(m), floor ? cMin(f) : 0), bb = B * B;
  const c = Math.cos(2 * Math.PI * t + Math.PI * 0.5), ca = 1 - c, cb = 1 + c;
  const d1 = Math.sqrt(ca + bb * cb), d2 = Math.sqrt(cb + bb * ca);
  const p1 = d1 > 1e-18 ? ca / d1 : 0, p2 = d2 > 1e-18 ? cb / d2 : 0;
  const corr = (p) => p + ELL_C * (p - p * p);
  return (corr(p1) - corr(p2)) * Math.SQRT1_2 / (1 + ELL_C * (1 - Math.SQRT2));
};
const t0 = Date.now();
const H = makeHarness(buildProbe("oscillator"), { source: SRC.SINE });
const { gate, render, renderAll, withInstance, setParams, noiseLevel, x } = H;

// Amp Mod level-preserving (Sine), long runs in the pool.
const amPromises = [];
for (const color of [0, 1, 2, 3, 4]) for (const a of [0, 0.25, 0.5, 0.75, 1]) {
  amPromises.push(noiseLevel({ freq: 1000, color, ampMod: a }, 240).then((r) => ({ color, a, ...r })));
}

// ---------- 1. Decorrelation ----------
{
  const names = ["npL", "npR", "naL", "naR", "NaudL", "NaudR"];
  const chans = [CH.NP_L, CH.NP_R, CH.NA_L, CH.NA_R, CH.NAUD_L, CH.NAUD_R];
  const pairs = [[0, 2], [0, 4], [2, 4], [1, 3], [1, 5], [3, 5], [0, 1], [2, 3], [4, 5]];
  let worst = 0, worstName = "";
  for (const seed of [1, 2, 777, 16777215]) {
    const n = 60 * SR;
    const S = new Float64Array(6), SS = new Float64Array(6), SX = new Float64Array(pairs.length);
    withInstance({ freq: 1000, seed }, (h) => {
      render(h, n, chans, (a) => {
        for (let i = 0; i < a[0].length; i++) {
          for (let c = 0; c < 6; c++) { const v = a[c][i]; S[c] += v; SS[c] += v * v; }
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
  gate(worst < 0.01, `1 decorrelation (noise streams): max |r| = ${worst.toFixed(4)} (${worstName}) < 0.01`);
}

// ---------- 1b. Pitch Mod noise per Color: std, kurtosis, Average null at Nyquist ----------
{
  const stds = [], kurts = [];
  let nullDb = 0;
  for (const color of [0, 1, 2, 3, 4]) {
    const [np] = withInstance({ freq: 700, pitch: 600, color, seed: 77 }, (h) => renderAll(h, SR * 4, [CH.NP_L]));
    let m = 0, v = 0, q = 0;
    for (const t of np) m += t;
    m /= np.length;
    for (const t of np) { const d = (t - m) ** 2; v += d; q += d * d; }
    v /= np.length; q /= np.length;
    stds.push(Math.sqrt(v)); kurts.push(q / (v * v));
    if (color === 2) {
      // Nyquist bin: sum (-1)^n np[n] over blocks vs the mean full-band power.
      const B = 1024; let pN = 0, pAll = 0;
      for (let b = 0; b + B <= np.length; b += B) {
        let a = 0; for (let i = 0; i < B; i++) { a += (i & 1 ? -1 : 1) * np[b + i]; pAll += np[b + i] ** 2; }
        pN += a * a / B;
      }
      nullDb = dB(pN / pAll);
    }
  }
  gate(stds.slice(0, 3).every((v) => Math.abs(v - 1) < 0.02) && stds.slice(3).every((v) => Math.abs(v - 1) < 0.05),
    `1b Pitch Mod noise std ~1 (White/Gaussian/Average/Pink/Brown): ${stds.map((v) => v.toFixed(3)).join(" / ")}`);
  gate(Math.abs(kurts[0] - 1.8) < 0.05 && Math.abs(kurts[1] - 3) < 0.15,
    `1b kurtosis: White ${kurts[0].toFixed(3)} (flat 1.8), Gaussian ${kurts[1].toFixed(3)} (normal 3; CLT-12 2.9)`);
  gate(nullDb < -60, `1b Average Pitch Mod noise null at Nyquist: ${nullDb.toFixed(1)} dB re mean bin`);
}

// ---------- 2. Mono / Noise / CV / Seed / Reset / Source switch ----------
{
  const base = { freq: 700, pitch: 600, ampMod: 0.5 };
  let monoIsL = true, lrDiffer = true, noiseOk = true, cvErr = 0, cvErrW = 0, hzErr = 0;
  for (const source of [0, 1, 2, 3, 4]) for (const color of [0, 1, 2, 3, 4]) {
    const [m, l, r, nl, nr, npl, npr, cl, cr, fl] = withInstance({ ...base, source, color },
      (h) => renderAll(h, SR, [CH.MONO, CH.L, CH.R, CH.NAUD_L, CH.NAUD_R, CH.NP_L, CH.NP_R, CH.CV_L, CH.CV_R, CH.FI_L]));
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
      hzErr = Math.max(hzErr, Math.abs(fl[i] / (base.freq * Math.pow(2, cl[i])) - 1));
    }
  }
  gate(monoIsL, "2 Mono output: bit-identical to Left (5 sources x 5 colors, 1 s)");
  gate(lrDiffer, "2 Left and Right are independent renders");
  gate(noiseOk, "2 Noise L/R: unit RMS (+-0.5 dB), L != R");
  gate(cvErr < 1e-9 && cvErrW < 2e-6 && hzErr < 1e-6, `2 CV L/R: log2(fInst/fEff) (max err ${cvErr.toExponential(1)} oct; White ${cvErrW.toExponential(1)} oct, dsp_ln/dsp_exp mean correction), Hz = fEff * 2^CV (max rel err ${hzErr.toExponential(1)})`);
  const [c0] = withInstance({ ...base, pitch: 0 }, (h) => renderAll(h, SR / 10, [CH.CV_L]));
  gate(c0.every((v) => v === 0), "2 CV is exactly 0 with Pitch Mod 0");
  // pitch L/R outs (â™¯/â™­ MIDI, A4 = 69 = 440 Hz) = the Hz the oscillator steps with.
  {
    let pErr = 0, pErrCv = 0, sinErr = 0, flat = 0;
    for (const color of [0, 1, 2, 3, 4]) for (const pitch of [0, 600, 2400]) {
      const [pl, pr, fl, fr, cl, l] = withInstance({ freq: 700, pitch, color, source: SRC.SINE, ampMod: 0, seed: 99 },
        (h) => renderAll(h, SR / 2, [CH.PITCH_L, CH.PITCH_R, CH.FI_L, CH.FI_R, CH.CV_L, CH.L]));
      let ph = 0;
      for (let i = 0; i < pl.length; i++) {
        pErr = Math.max(pErr, Math.abs(pl[i] - (69 + 12 * Math.log2(Math.abs(fl[i]) / 440))), Math.abs(pr[i] - (69 + 12 * Math.log2(Math.abs(fr[i]) / 440))));
        // Away from the Nyquist clamp (2400 c reaches it), pitch = Frequency + CV.
        if (Math.abs(fl[i]) < 0.999 * SR / 2) pErrCv = Math.max(pErrCv, Math.abs(pl[i] - (69 + 12 * Math.log2(700 / 440) + 12 * cl[i])));
        // Rebuild the Left sine from the pitch out alone and compare with the Left audio.
        sinErr = Math.max(sinErr, Math.abs(l[i] - Math.sin(2 * Math.PI * ph)));
        ph += 440 * Math.pow(2, (pl[i] - 69) / 12) / SR; ph -= Math.floor(ph);
        if (pitch === 0 && pl[i] !== pl[0]) flat++;
      }
    }
    gate(pErr < 1e-6 && pErrCv < 2e-5, `2 pitch L/R: MIDI of the stepped Hz (max err ${pErr.toExponential(1)} st), = 69 + 12 log2(Frequency/440) + 12 CV below Nyquist (max err ${pErrCv.toExponential(1)} st)`);
    gate(sinErr < 1e-4 && flat === 0, `2 pitch L drives the sine: Left rebuilt from pitch L alone (max err ${sinErr.toExponential(1)}), constant at Pitch Mod 0`);
  }
  for (const source of [SRC.SINE, SRC.DSINE, SRC.TRISAW]) {
    const o = { ...base, source, morph: 0.7, color: 3, seed: 4242 };
    const [a] = withInstance(o, (h) => renderAll(h, SR, [CH.MONO]));
    const [b] = withInstance(o, (h) => renderAll(h, SR, [CH.MONO]));
    const resetOk = withInstance(o, (h) => {
      const [first] = renderAll(h, SR, [CH.MONO]);
      x.tp_reset(h);
      const [again] = renderAll(h, SR, [CH.MONO]);
      return bitEqual(first, a) && bitEqual(again, a);
    });
    const seedOk = withInstance(o, (h) => {
      renderAll(h, SR / 2, [CH.MONO]);
      setParams({ ...o, seed: 99 });
      const [after] = renderAll(h, SR, [CH.MONO]);
      const [fresh] = withInstance({ ...o, seed: 99 }, (h2) => renderAll(h2, SR, [CH.MONO]));
      return bitEqual(after, fresh) && !bitEqual(after, a);
    });
    gate(bitEqual(a, b) && resetOk && seedOk, `2 ${SRC_NAMES[source]}: same Seed bit-identical, Reset reproduces from the start, Seed change == fresh instance`);
  }
  // Noise streams never depend on the source; phase runs through a source switch.
  const streams = [CH.NP_L, CH.NP_R, CH.NA_L, CH.NA_R, CH.NAUD_L, CH.NAUD_R];
  const sw = { ...base, seed: 5 };
  const all = withInstance({ ...sw, source: SRC.SINE }, (h) => renderAll(h, SR, [CH.L, ...streams]));
  const switched = withInstance({ ...sw, source: SRC.SQUARE }, (h) => {
    const first = renderAll(h, SR / 2, [CH.L, ...streams]);
    setParams({ ...sw, source: SRC.SINE });
    const second = renderAll(h, SR / 2, [CH.L, ...streams]);
    return first.map((f, k) => { const z = new Float64Array(SR); z.set(f, 0); z.set(second[k], SR / 2); return z; });
  });
  let streamsOk = true;
  for (let k = 1; k < all.length; k++) if (!bitEqual(all[k], switched[k])) streamsOk = false;
  gate(streamsOk, "2 Source switch: noise streams (L and R) unchanged");
  gate(bitEqual(all[0].subarray(SR / 2), switched[0].subarray(SR / 2)), "2 Source switch: Sine after Soft Square->Sine is bit-identical to Sine all along (phase runs in every source)");
}

// ---------- 3. Sine baseline: pure with Pitch Mod 0 ----------
{
  let worst = -Infinity;
  for (const f of [1000, 997.3]) {
    const [y] = withInstance({ freq: f }, (h) => renderAll(h, SR, [CH.MONO]));
    worst = Math.max(worst, sineFit(y, f).thdDb);
  }
  gate(worst < -100, `3 Sine, mods 0: THD+N worst ${worst.toFixed(1)} dB < -100 dB`);
}

// ---------- 4. f / Hz parity with polyBlep ----------
{
  const n = 4 * SR;
  const hz = (i) => (i % SR < 4000 ? -30000 + 60000 * ((i % 4000) / 4000) : 26000 * Math.sin(2 * Math.PI * i / SR * 1.5) + (i % 997 === 0 ? 1e6 : 0));
  const [y, fi] = withInstance({ freq: 1234 }, (h) => renderAll(h, n, [CH.L, CH.FI_L], { hz }));
  let incOk = true, maxErr = 0, phase = 0, sawNeg = false, sawClamp = false;
  for (let i = 0; i < n; i++) {
    const fc = Math.min(Math.max(hz(i), -SR / 2), SR / 2);
    if (fi[i] !== fc) incOk = false;
    if (fc < 0) sawNeg = true;
    if (Math.abs(fc) === SR / 2) sawClamp = true;
    maxErr = Math.max(maxErr, Math.abs(y[i] - Math.sin(2 * Math.PI * phase)));
    phase += fc / SR;
    phase -= Math.floor(phase);
  }
  gate(incOk && sawNeg && sawClamp, "4 per-sample Hz: fInst == clamp(f, +-Nyquist) exactly (negative Hz and >Nyquist covered), knob ignored");
  gate(maxErr < 1e-9, `4 phase: Sine == sin(2 pi phi), phi += clamp(f)/fs (polyBlep increment), max err ${maxErr.toExponential(2)}`);
}

// ---------- 5. Pitch Mod symmetric in cents; near Nyquist ----------
{
  let worst = { mean: 0, skew: 0, sd: 1 };
  for (const color of [0, 1, 2, 3, 4]) for (const cents of [100, 1200]) {
    let n = 0, s1 = 0, s2 = 0, s3 = 0;
    for (const seed of [1, 2, 3, 4]) {
      withInstance({ freq: 1000, pitch: cents, color, seed }, (h) => {
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
    `5 Pitch Mod: worst mean ${worst.mean.toFixed(3)}Ïƒ (<0.1), skew ${worst.skew.toFixed(3)} (<0.15), sd ${worst.sd.toFixed(3)} (1 Â± 5 %)`);
  let finite = true, maxHz = 0;
  for (const source of [0, 1, 2, 3, 4]) for (const color of [0, 1, 2, 3, 4]) {
    withInstance({ freq: 23000, pitch: 4800, ampMod: 1, color, source }, (h) => {
      render(h, 2 * SR, [CH.L, CH.R, CH.FI_L], (a) => {
        for (let i = 0; i < a[0].length; i++) {
          if (!Number.isFinite(a[0][i]) || !Number.isFinite(a[1][i]) || !Number.isFinite(a[2][i])) finite = false;
          maxHz = Math.max(maxHz, Math.abs(a[2][i]));
        }
      });
    });
  }
  gate(finite && maxHz <= SR / 2, `5 near Nyquist (fEff 23 kHz, 4800 c = Pitch Mod max, 5 sources): finite, max |fInst| ${maxHz.toFixed(1)} Hz <= fs/2`);
}

// ---------- 6. Amp Mod 1: no carrier line ----------
{
  const fc = 4000;
  const lineDb = (ampMod) => {
    const [y] = withInstance({ freq: fc, ampMod }, (h) => renderAll(h, 120 * SR, [CH.L]));
    const { psd, df } = welch(y, 65536);
    const kc = Math.round(fc / df);
    let side = 0;
    for (let d = 3; d <= 10; d++) side += psd[kc - d] + psd[kc + d];
    return dB(psd[kc] / (side / 16));
  };
  const line = lineDb(1), lineRef = lineDb(0.5);
  gate(line < 2 && lineRef > 10, `6 Amp Mod 1: no carrier line (bin/sides ${line.toFixed(2)} dB; Amp Mod 0.5 shows ${lineRef.toFixed(1)} dB)`);
}

// ---------- 14. Oscillator Sources (Pitch Mod 0, exact maths) ----------
{
  const f = 437.3, n = SR;
  const ph = (i) => { const p = (f / SR) * i; return p - Math.floor(p); };  // reference phase (no dither)
  const naiveTri = (t) => { const v = (t + 0.25) - Math.floor(t + 0.25); return v < 0.5 ? 4 * v - 1 : 3 - 4 * v; };
  const softSquare = (t, m) => softSquareRef(t, m, f);
  const softTri = (t, m) => ellipsoidSymRef(t, m, f);
  const maxErr = (src, morph, ref) => withInstance({ freq: f, source: src, morph }, (h) => {
    const [y] = renderAll(h, n, [CH.L]);
    let e = 0, phase = 0;
    for (let i = 0; i < n; i++) { e = Math.max(e, Math.abs(y[i] - ref(phase, morph))); phase += f / SR; phase -= Math.floor(phase); }
    return e;
  });
  for (const m of [0, 0.5, 1]) {
    gate(maxErr(SRC.SQUARE, m, softSquare) < 1e-6, `14 Soft Square Morph ${m}: == soundemote.dev SquareToSine S sqrt(1+k)/sqrt(S^2+k), c = sqrt(k/(1+k)) = max(sqrt(cos(pi Morph / 2)), 2 pi f / fs) (Ellipsoid limit)`);
    gate(maxErr(SRC.TRI, m, softTri) < 1e-6, `14 Soft Tri Morph ${m}: == soundemote.dev Ellipsoid Sym, B = max(sqrt(Morph), 2 pi f / fs) (Ellipsoid limit)`);
  }
  // Dithered sources: the average period stays exact; the dither only moves the per-cycle length.
  const zeroRate = (src, morph) => withInstance({ freq: f, source: src, morph, seed: 9 }, (h) => {
    const [y] = renderAll(h, 20 * SR, [CH.L]);
    let first = -1, last = -1, count = 0;
    for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) { if (first < 0) first = i; last = i; count++; }
    return (count - 1) * SR / (last - first);
  });
  for (const [src, m] of [[SRC.DSINE, 1], [SRC.TRISAW, 0.5], [SRC.TRISAW, 0.1], [SRC.PBTRI, 0.5], [SRC.PBTRI, 0.1]]) {
    const fz = zeroRate(src, m);
    gate(Math.abs(fz / f - 1) < 1e-3, `14 ${SRC_NAMES[src]} Morph ${m}: rising-zero rate ${fz.toFixed(3)} Hz vs ${f} (dither keeps the pitch)`);
  }
  const ds = (morph, seed = 9) => withInstance({ freq: f, source: SRC.DSINE, morph, seed }, (h) => renderAll(h, n, [CH.L, CH.R]));
  const [s0] = withInstance({ freq: f }, (h) => renderAll(h, n, [CH.L]));
  const [d0] = ds(0), [d1l, d1r] = ds(1);
  gate(bitEqual(s0, d0) && !bitEqual(s0, d1l) && !bitEqual(d1l, d1r), "14 Dithered Sine: Morph 0 == Sine exactly; Morph 1 dithers; L and R dither independently");
  let range = true;
  for (const src of [SRC.TRISAW, SRC.SQUARE, SRC.TRI, SRC.PBTRI]) for (const m of [0, 0.25, 0.5, 0.75, 1]) {
    const [y] = withInstance({ freq: f, source: src, morph: m }, (h) => renderAll(h, n, [CH.L]));
    let mx = 0;
    for (const v of y) mx = Math.max(mx, Math.abs(v));
    if (!(mx <= 1 + 1e-12 && mx > 0.97)) range = false;
  }
  gate(range, "14 Dithered Trisaw / Soft Square / Soft Tri / PolyBLEP Trisaw: peak level 1 (within 3 %) at every Morph");
  // Dithered Trisaw = Robin's dithering oscillator: with a steady pitch every cycle
  // (rising zero to rising zero) is a whole number of samples in {Lmid-1, Lmid, Lmid+1}.
  {
    const c = SR / f, lmid = Math.round(c);
    const [y] = withInstance({ freq: f, source: SRC.TRISAW, morph: 0.5, seed: 9 }, (h) => renderAll(h, 4 * SR, [CH.L]));
    const lens = new Set(); let prev = -1, bad = 0, sum = 0, cnt = 0;
    for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) {
      if (prev >= 0) { const L = i - prev; lens.add(L); if (Math.abs(L - lmid) > 1) bad++; sum += L; cnt++; }
      prev = i;
    }
    gate(bad === 0 && lens.size >= 2 && Math.abs(sum / cnt / c - 1) < 1e-3,
      `14 Dithered Trisaw: Robin cycle lengths {${[...lens].sort((a, b) => a - b).join(", ")}} samples around ${c.toFixed(2)}, mean ${(sum / cnt).toFixed(3)}`);
  }
  // Soft Tri Morph 1 (B = 1) is a pure sine at peak 1.
  {
    const fl = 100;
    const [y] = withInstance({ freq: fl, source: SRC.TRI, morph: 1 }, (h) => renderAll(h, SR, [CH.L]));
    const { thdDb } = sineFit(y, fl);
    gate(thdDb < -100, `14 Soft Tri Morph 1 = sine (THD+N ${thdDb.toFixed(1)} dB)`);
  }
}

// ---------- 17. Max-edginess antialiasing (Soft Square / Soft Tri) ----------
{
  // Oversampled reference: the shape's harmonics (DFT of one cycle at 8192
  // points, same k / B as the module would use) summed only below Nyquist,
  // at the module's sample times. Whatever differs from that band-limited
  // ideal is aliasing (folded harmonics). Error power is relative to the
  // reference power. The un-floored shape at the same rate is measured the same
  // way to show how much it would alias without the floor.
  const M = 8192;
  const aliasDb = (fn, m, f0, floor, y) => {
    const H = Math.floor((SR / 2) / f0);
    const an = new Float64Array(H + 1), bn = new Float64Array(H + 1);
    const cyc = new Float64Array(M);
    for (let j = 0; j < M; j++) cyc[j] = fn(j / M, m, f0, floor);
    for (let h = 1; h <= H; h++) {
      let sa = 0, sb = 0;
      for (let j = 0; j < M; j++) { const w = 2 * Math.PI * h * j / M; sa += cyc[j] * Math.cos(w); sb += cyc[j] * Math.sin(w); }
      an[h] = 2 * sa / M; bn[h] = 2 * sb / M;
    }
    let e = 0, r = 0, p = 0;
    for (let i = 0; i < y.length; i++) {
      let v = 0;
      for (let h = 1; h <= H; h++) { const w = 2 * Math.PI * h * p; v += an[h] * Math.cos(w) + bn[h] * Math.sin(w); }
      const yi = y ? y[i] : fn(p, m, f0, floor);
      e += (yi - v) ** 2; r += v * v;
      p += f0 / SR; p -= Math.floor(p);
    }
    return dB(e / r);
  };
  for (const [src, fn, m] of [[SRC.SQUARE, softSquareRef, 1], [SRC.TRI, ellipsoidSymRef, 0]]) for (const f0 of [1234.5, 4321.7, 9876.5]) {
    const [y] = withInstance({ freq: f0, source: src, morph: m }, (h) => renderAll(h, SR / 4, [CH.L]));
    const got = aliasDb(fn, m, f0, true, y);
    const raw = aliasDb(fn, m, f0, false, new Float64Array(SR / 4).map((_, i) => { const p = (f0 / SR) * i; return fn(p - Math.floor(p), m, f0, false); }));
    gate(got < -40 && raw > got + 20, `17 ${SRC_NAMES[src]} Morph ${m} @ ${f0} Hz: alias error vs band-limited reference ${got.toFixed(1)} dB (un-floored shape ${raw.toFixed(1)} dB)`);
  }
  // With Pitch Mod the floor follows the instantaneous frequency every sample.
  {
    const [y, fi] = withInstance({ freq: 3000, source: SRC.SQUARE, morph: 1, pitch: 1200, seed: 5 }, (h) => renderAll(h, SR / 4, [CH.L, CH.FI_L]));
    let err = 0, p = 0;
    for (let i = 0; i < y.length; i++) { err = Math.max(err, Math.abs(y[i] - softSquareRef(p, 1, fi[i]))); p += fi[i] / SR; p -= Math.floor(p); }
    gate(err < 1e-5, `17 Soft Square with Pitch Mod 1200: Ellipsoid limit from the per-sample stepped Hz (max err ${err.toExponential(1)})`);
  }
}

// ---------- 15b. Soft Square / Soft Tri Morph use the whole knob (220 Hz) ----------
{
  const f = 220;
  const h3 = (m, source) => {
    const [y] = withInstance({ freq: f, source, morph: m }, (h) => renderAll(h, 4 * SR, [CH.L]));
    const { psd, df } = welch(y, 16384);
    const harm = (k) => { const c = Math.round(k * f / df); return psd[c - 1] + psd[c] + psd[c + 1]; };
    return dB(harm(3) / harm(1));
  };
  {
    const ms = [0.25, 0.5, 0.75, 1], v = ms.map((m) => h3(m, SRC.SQUARE));
    const steps = v.slice(1).map((x, i) => x - v[i]);
    gate(v[0] < -30 && steps.every((s) => s > 5 && s < 15), `15b Soft Square H3 at Morph ${ms.join("/")}: ${v.map((x) => x.toFixed(1)).join(" / ")} dB (Morph 0 = sine; every quarter raises H3 5..15 dB)`);
  }
  const ms = [0, 0.25, 0.5, 0.75], v = ms.map((m) => h3(m, SRC.TRI));
  const steps = v.slice(1).map((x, i) => v[i] - x);
  gate(steps.every((s) => s > 4 && s < 15), `15b Soft Tri H3 at Morph ${ms.join("/")}: ${v.map((x) => x.toFixed(1)).join(" / ")} dB (every quarter of the knob drops H3 4..15 dB)`);
}

// ---------- 15. Morph ----------
{
  const f = 50;  // low pitch: the AA floor is far from the Morph range here
  const spectrum = (src, morph) => {
    const [y] = withInstance({ freq: f, source: src, morph }, (h) => renderAll(h, 8 * SR, [CH.L]));
    const { psd, df } = welch(y, 16384);
    const harm = (k) => { const c = Math.round(k * f / df); return psd[c - 1] + psd[c] + psd[c + 1]; };
    return { h1: harm(1), h2: harm(2), h3: harm(3) };
  };
  // Dithered Trisaw: Morph 0.5 = triangle (odd harmonics only), 0.1 = saw-like (strong even harmonics).
  const tri = spectrum(SRC.TRISAW, 0.5), saw = spectrum(SRC.TRISAW, 0.1);
  gate(dB(tri.h2 / tri.h1) < -40 && dB(saw.h2 / saw.h1) > -15, `15 Dithered Trisaw Morph: 0.5 triangle (H2 ${dB(tri.h2 / tri.h1).toFixed(1)} dB), 0.1 saw-like (H2 ${dB(saw.h2 / saw.h1).toFixed(1)} dB)`);
  // Soft Square: Morph 0 = pure sine (no H3), Morph 1 = square (H3 -9.5 dB).
  const sq0 = spectrum(SRC.SQUARE, 0), sq1 = spectrum(SRC.SQUARE, 1);
  gate(dB(sq0.h3 / sq0.h1) < -80 && Math.abs(dB(sq1.h3 / sq1.h1) + 9.54) < 1.5,
    `15 Soft Square Morph: 0 = sine (H3 ${dB(sq0.h3 / sq0.h1).toFixed(1)} dB), 1 = square (H3 ${dB(sq1.h3 / sq1.h1).toFixed(1)} dB, ideal -9.5)`);
  // Soft Tri: Morph 0 = triangle (H3 -19.1 dB), 1 rounder (less H3).
  const t0s = spectrum(SRC.TRI, 0), t1s = spectrum(SRC.TRI, 1);
  gate(Math.abs(dB(t0s.h3 / t0s.h1) + 19.08) < 1.5 && dB(t1s.h3 / t1s.h1) < dB(t0s.h3 / t0s.h1) - 3,
    `15 Soft Tri Morph: 0 = triangle (H3 ${dB(t0s.h3 / t0s.h1).toFixed(1)} dB, ideal -19.1), 1 rounder (H3 ${dB(t1s.h3 / t1s.h1).toFixed(1)} dB)`);
  // PolyBLEP Trisaw: Morph 0.5 = triangle (odd only, H3 -19.1 dB), 0.1 = saw-like.
  const pt = spectrum(SRC.PBTRI, 0.5), ps = spectrum(SRC.PBTRI, 0.1);
  gate(dB(pt.h2 / pt.h1) < -60 && Math.abs(dB(pt.h3 / pt.h1) + 19.08) < 0.5 && dB(ps.h2 / ps.h1) > -15,
    `15 PolyBLEP Trisaw Morph: 0.5 triangle (H2 ${dB(pt.h2 / pt.h1).toFixed(1)} dB, H3 ${dB(pt.h3 / pt.h1).toFixed(2)} dB, ideal -19.08), 0.1 saw-like (H2 ${dB(ps.h2 / ps.h1).toFixed(1)} dB)`);
  // Sine ignores Morph.
  const [a] = withInstance({ freq: f, morph: 0, pitch: 300 }, (h) => renderAll(h, SR, [CH.L]));
  const [b] = withInstance({ freq: f, morph: 1, pitch: 300 }, (h) => renderAll(h, SR, [CH.L]));
  gate(bitEqual(a, b), "15 Sine: Morph has no effect");
}

// ---------- 15c. PolyBLEP Trisaw aliasing and pitch ----------
{
  // Alias power = PSD outside +-3 bins of every true harmonic k f (k f < fs/2),
  // relative to total. Reference = the naive Trisaw Center at the same phase (JS).
  const naiveTrisawCenter = (t, m) => {
    const w = Math.min(Math.max(m, 1e-6), 1 - 1e-6);
    const local = t < 0.5 ? t * 2 : (t - 0.5) * 2, sgn = t < 0.5 ? 1 : -1;
    const pk = t < 0.5 ? w : 1 - w;
    return sgn * (local < pk ? local / pk : (1 - local) / (1 - pk));
  };
  const aliasDb = (y, f) => {
    const N = 32768, { psd, df } = welch(y, N);
    const keep = new Uint8Array(psd.length);
    for (let k = 1; k * f < SR / 2; k++) { const c = Math.round(k * f / df); for (let j = c - 3; j <= c + 3; j++) if (j >= 0 && j < keep.length) keep[j] = 1; }
    let tot = 0, al = 0;
    for (let i = 1; i < psd.length; i++) { tot += psd[i]; if (!keep[i]) al += psd[i]; }
    return dB(al / tot);
  };
  // Bin-exact notes (f = whole Welch bins) so window leakage does not count as alias.
  const binHz = SR / 32768;
  for (const [f0, m] of [[2093.0, 0.5], [4186.0, 0.5], [2093.0, 0.1]]) {
    const f = Math.round(f0 / binHz) * binHz;
    const [y] = withInstance({ freq: f, source: SRC.PBTRI, morph: m }, (h) => renderAll(h, 4 * SR, [CH.L]));
    const naive = new Float64Array(y.length);
    let p = 0;
    for (let i = 0; i < y.length; i++) { naive[i] = naiveTrisawCenter(p, m); p += f / SR; p -= Math.floor(p); }
    const a = aliasDb(y, f), b = aliasDb(naive, f);
    gate(a < b - 10, `15c PolyBLEP Trisaw ${f.toFixed(2)} Hz Morph ${m}: alias power ${a.toFixed(1)} dB vs naive ${b.toFixed(1)} dB (>= 10 dB less)`);
  }
  // Pitch: fundamental from sineFit-free zero rate at several notes (no dither, exact).
  let worst = 0;
  for (const f of [55, 440, 1760, 7040]) {
    const [y] = withInstance({ freq: f, source: SRC.PBTRI, morph: 0.5 }, (h) => renderAll(h, 10 * SR, [CH.L]));
    let first = -1, last = -1, count = 0, fl = 0, ll = 0;
    for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) {
      const fr = i - 1 + (-y[i - 1]) / (y[i] - y[i - 1]);
      if (first < 0) fl = fr; ll = fr; count++; first = 1;
    }
    const fz = (count - 1) * SR / (ll - fl);
    worst = Math.max(worst, Math.abs(1200 * Math.log2(fz / f)));
  }
  gate(worst < 0.01, `15c PolyBLEP Trisaw pitch: worst ${worst.toFixed(5)} cents over 55 / 440 / 1760 / 7040 Hz (< 0.01)`);
}

// ---------- 16. Pitch Mod swing at constant level ----------
{
  // sd of log2(fInst/fEff) in cents = Pitch Mod (Gaussian, mean-corrected), mean fInst = fEff.
  let worstSd = 0, worstMean = 0;
  for (const cents of [25, 300, 1200]) {
    const [fl] = withInstance({ freq: 800, pitch: cents, seed: 3 }, (h) => renderAll(h, 10 * SR, [CH.FI_L]));
    let n = 0, s1 = 0, s2 = 0, lin = 0;
    for (const v of fl) { const k = 1200 * Math.log2(v / 800); n++; s1 += k; s2 += k * k; lin += v / 800; }
    const m = s1 / n, sd = Math.sqrt(s2 / n - m * m);
    worstSd = Math.max(worstSd, Math.abs(sd / cents - 1));
    worstMean = Math.max(worstMean, Math.abs(lin / n - 1));
  }
  gate(worstSd < 0.03 && worstMean < 0.01, `16 measured pitch sd = Pitch Mod (worst ${(100 * worstSd).toFixed(2)} %), mean fInst = fEff (worst ${(100 * worstMean).toFixed(3)} %)`);
  // Constant level: output is the plain unit sine on the same phase.
  const [y, fi] = withInstance({ freq: 800, pitch: 900, seed: 2 }, (h) => renderAll(h, SR, [CH.L, CH.FI_L]));
  let err = 0, phase = 0;
  for (let k = 0; k < y.length; k++) { err = Math.max(err, Math.abs(y[k] - Math.sin(2 * Math.PI * phase))); phase += fi[k] / SR; phase -= Math.floor(phase); }
  gate(err < 1e-9, `16 constant level: Sine = sin(2 pi phi) with Pitch Mod 900 (max err ${err.toExponential(1)})`);
}

// ---------- 10. Modulation stress / 11. Edges ----------
{
  let finite = true, mx = 0;
  const sweep = (i) => { const t = (i / SR) % 2; const u = t < 1 ? t : 2 - t; return 20 * Math.pow(18000 / 20, u); };
  for (const source of [0, 1, 2, 3, 4]) for (const w of [1, 0]) {
    withInstance({ pitch: 2400, ampMod: 1, color: source % 3, source, morph: w }, (h) => {
      render(h, 4 * SR, [CH.L, CH.R], (a) => {
        for (let i = 0; i < a[0].length; i++) {
          if (!Number.isFinite(a[0][i]) || !Number.isFinite(a[1][i])) finite = false;
          mx = Math.max(mx, Math.abs(a[0][i]), Math.abs(a[1][i]));
        }
      }, { hz: sweep });
    });
  }
  gate(finite && mx <= 8, `10 stress (5 sources, Pitch Mod 2400, W 1 and 0, Amp Mod 1, f 20 Hz<->18 kHz sweep): finite, max |y| ${mx.toFixed(3)} (limit 8)`);
  let fin = true, zeroOk = true, cases = 0;
  for (const freq of [0, 20000]) for (const source of [0, 1, 2, 3, 4]) for (const morph of [0, 1]) for (const amp of [1, 0]) {
    withInstance({ freq, source, morph, amp, pitch: 300, ampMod: 0.5 }, (h) => {
      render(h, SR / 2, [CH.MONO, CH.L, CH.R], (a) => {
        for (const arr of a) for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) fin = false;
          if (amp === 0 && arr[i] !== 0) zeroOk = false;
        }
      });
    });
    cases++;
  }
  gate(fin && zeroOk, `11 edges: Frequency 0 / 20 kHz x 5 sources x Morph 0 / 1 x Amplitude 1 / 0 (${cases} cases): finite, Amplitude 0 is exact silence`);
}

// ---------- 12. Pitch Mod mean pitch ----------
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
  gate(Math.abs(c) < 1, `12 mean Hz @440: PitchMod 0 ${m0.toFixed(3)} / 600 ${m600.toFixed(3)} (${c >= 0 ? "+" : ""}${c.toFixed(2)} cents, Â±1; uncorrected would be +${cu.toFixed(1)} cents)`);
  // White (uniform +-sqrt3): c = ln(sinh(sqrt3 s) / (sqrt3 s)).
  for (const pitch of [600, 2400]) {
    const sw = pitch * Math.LN2 / 1200;
    const meanW = (p) => withInstance({ freq: f0, pitch: p, color: 0, seed: 7 }, (h) => {
      let sf = 0, sg = 0;
      render(h, n, [CH.FI_L, CH.NP_L], ([fi, np]) => {
        for (let i = 0; i < fi.length; i++) { sf += Math.abs(fi[i]); sg += f0 * Math.exp(np[i] * sw - 0.5 * sw * sw); }
      });
      return [sf / n, sg / n];
    });
    const [w0] = meanW(0), [w, g] = meanW(pitch);
    const cw = 1200 * Math.log2(w / w0), cg = 1200 * Math.log2(g / w0);
    gate(Math.abs(cw) < (pitch > 1200 ? 3 : 1), `12 White mean Hz @440, Pitch Mod ${pitch}: ${w.toFixed(3)} (${cw >= 0 ? "+" : ""}${cw.toFixed(2)} cents, Â±${pitch > 1200 ? 3 : 1} (60 s sampling); Gaussian s^2/2 would be ${cg >= 0 ? "+" : ""}${cg.toFixed(1)} cents)`);
  }
}

const am = await Promise.all(amPromises);
for (const color of [0, 1, 2, 3, 4]) {
  const rows = am.filter((r) => r.color === color).sort((p, q) => p.a - q.a);
  const base = rows[0].rmsDb;
  const row = rows.map((r) => `A${r.a}:${(r.rmsDb - base) >= 0 ? "+" : ""}${(r.rmsDb - base).toFixed(2)}`).join(" ");
  gate(Math.max(...rows.map((r) => Math.abs(r.rmsDb - base))) < 0.5 && rows.every((r) => r.bad === 0), `6 ${COLORS[color]} Sine Amp Mod 0->1 RMS (dB re A0): ${row}`);
}
H.finish(t0);


