// Math-cycle plot: pure band-limited saw via Si closed form (AA Gibbs verified).
// y = (2/π) Σ_{k=1..N} sin(k·θ)/k , θ = 2π u, u ∈ (-0.5, 0.5]
// No leaky integrator. N tracks engine Nyquist count.

const NODE_GRAPH_DSF_MAX_PARTIALS = 1048576;
const _MATH_PI = Math.PI;
const _MATH_TWO_PI = Math.PI * 2;

function nodeGraphDsfPartialsNf(sr, f, spacing = 1) {
  const freq = Math.max(1e-9, Math.abs(Number(f) || 0));
  const nyquist = Math.max(1, Number(sr) || 48000) * 0.5;
  let absS = Math.abs(Number(spacing));
  if (!(absS > 1e-9)) absS = 1;
  let nf;
  if (absS > 0.999999 && absS < 1.000001) nf = nyquist / freq - 1;
  else nf = (nyquist / freq - 2) / absS + 1;
  if (!(nf > 1)) nf = 1;
  if (nf > NODE_GRAPH_DSF_MAX_PARTIALS) nf = NODE_GRAPH_DSF_MAX_PARTIALS;
  return nf;
}

/** Harmonic count for flat Σsin/k saw: floor(Nyquist/f), ≥1. */
function nodeGraphMathSawHarmonics(sr, f) {
  const nyquist = Math.max(1, Number(sr) || 48000) * 0.5;
  const freq = Math.max(1e-9, Math.abs(Number(f) || 0));
  return Math.max(1, Math.min(NODE_GRAPH_DSF_MAX_PARTIALS, Math.floor(nyquist / freq)));
}

function nodeGraphMathSineIntegral(x) {
  const ax = Math.abs(x);
  let s;
  if (ax < 1e-12) s = ax;
  else if (ax < 20) {
    s = 0;
    let term = ax;
    for (let n = 0; n < 200; n += 1) {
      s += term / (2 * n + 1);
      term *= -ax * ax / ((2 * n + 2) * (2 * n + 3));
      if (Math.abs(term) < 1e-18 * (1 + Math.abs(s))) break;
    }
  } else {
    let f = 0;
    let g = 0;
    let term = 1 / ax;
    for (let k = 0; k < 80; k += 1) {
      f += term;
      g += term * (2 * k + 1) / ax;
      const termNext = term * -(2 * k + 2) * (2 * k + 1) / (ax * ax);
      if (k >= 3 && Math.abs(termNext) > Math.abs(term)) break;
      term = termNext;
      if (Math.abs(term) < 1e-20) break;
    }
    s = _MATH_PI / 2 - Math.cos(ax) * f - Math.sin(ax) * g;
  }
  return x < 0 ? -s : s;
}

const _MATH_B2N = [1 / 6, -1 / 30, 1 / 42, -1 / 30, 5 / 66, -691 / 2730, 7 / 6, -3617 / 510];
function _mathFact(n) {
  let r = 1;
  for (let i = 2; i <= n; i += 1) r *= i;
  return r;
}
const _MATH_WSIN_C = (() => {
  const c = [1];
  for (let n = 1; n <= 8; n += 1) {
    c.push(((n % 2 === 1) ? 1 : -1) * (4 ** n - 2) * _MATH_B2N[n - 1] / _mathFact(2 * n));
  }
  return c;
})();

function _mathIntPowSin(a, theta, p) {
  if (Math.abs(a) < 1e-18) return 0;
  function evalF(t) {
    let sumRe = 0;
    let sumIm = 0;
    let fall = 1;
    for (let k = 0; k <= p; k += 1) {
      const signed = (k % 2 === 0 ? 1 : -1) * fall;
      const n = k + 1;
      const invA = 1 / Math.pow(a, n);
      const m = n & 3;
      let r;
      let imv;
      if (m === 1) { r = 0; imv = -invA; }
      else if (m === 2) { r = -invA; imv = 0; }
      else if (m === 3) { r = 0; imv = invA; }
      else { r = invA; imv = 0; }
      const tp = Math.pow(t, p - k);
      sumRe += signed * tp * r;
      sumIm += signed * tp * imv;
      fall *= (p - k);
    }
    const eaRe = Math.cos(a * t);
    const eaIm = Math.sin(a * t);
    return [eaRe * sumRe - eaIm * sumIm, eaRe * sumIm + eaIm * sumRe];
  }
  const A = evalF(0);
  const B = evalF(theta);
  return B[1] - A[1];
}

/** Σ_{k=1..N} sin(k θ)/k — Si · x/sin x closed form. */
function nodeGraphMathSumSinOverK(N, theta) {
  if (theta < 0) return -nodeGraphMathSumSinOverK(N, -theta);
  if (theta < 1e-15) return 0;
  if (theta > Math.PI) theta = Math.PI - (theta - Math.PI);
  const a = N + 0.5;
  let s = _MATH_WSIN_C[0] * nodeGraphMathSineIntegral(a * theta);
  for (let n = 1; n < 8; n += 1) {
    s += _MATH_WSIN_C[n] / (4 ** n) * _mathIntPowSin(a, theta, 2 * n - 1);
  }
  return s - 0.5 * theta;
}

/** Band-limited saw at phase t∈ℝ (one cycle = 1). Range ≈ ±1. */
function nodeGraphMathGibbsSaw(t, N) {
  const u = t - Math.floor(t + 0.5);
  return (2 / _MATH_PI) * nodeGraphMathSumSinOverK(N, _MATH_TWO_PI * u);
}

/** Band-limited bipolar square ≈ saw(t) − saw(t−0.5). */
function nodeGraphMathGibbsSquare(t, N) {
  return nodeGraphMathGibbsSaw(t, N) - nodeGraphMathGibbsSaw(t - 0.5, N);
}

/** Σ_{k=1..N} r^k sin(kθ)/k — continuous Bright tilt. r=1 → Si saw. */
function nodeGraphMathSumRSinOverK(N, r, theta) {
  const n = Math.max(1, Number(N) || 1);
  let rr = Number(r);
  if (!(rr > 0)) rr = 0;
  if (rr > 1) rr = 1;
  if (theta < 0) return -nodeGraphMathSumRSinOverK(n, rr, -theta);
  if (theta < 1e-15) return 0;
  if (rr > 1 - 1e-12) return nodeGraphMathSumSinOverK(n, theta);
  // Infinite closed form when the truncated tail is negligible.
  if (n >= 48 && Math.pow(rr, n) < 1e-8) {
    return Math.atan2(rr * Math.sin(theta), 1 - rr * Math.cos(theta));
  }
  let s = 0;
  let rk = rr;
  for (let k = 1; k <= n; k += 1) {
    s += rk * Math.sin(k * theta) / k;
    rk *= rr;
  }
  return s;
}

/** Band-limited saw with geometric tilt r=2^{-k^2} from Bright/Morph. */
function nodeGraphMathTiltedSaw(t, N, bright) {
  const m = Math.max(0, Math.min(1, Number(bright) || 0));
  const kk = (1 - (m > 0 ? Math.pow(m, 0.14) : 0)) * 4;
  const r = Math.pow(2, -(kk * kk));
  const u = t - Math.floor(t + 0.5);
  return (2 / _MATH_PI) * nodeGraphMathSumRSinOverK(N, r, _MATH_TWO_PI * u);
}

function nodeGraphMathTiltedSawCycle(N, count, bright) {
  const n = Math.max(16, count | 0);
  const harm = Math.max(1, Number(N) || 1);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = nodeGraphMathTiltedSaw(i / (n - 1), harm, bright);
  }
  return out;
}


function nodeGraphMathCycleSampleCount(cssW, harmonics) {
  const w = Math.max(8, Math.floor(Number(cssW) || 8));
  const nHarm = Math.max(1, Number(harmonics) || 1);
  const want = Math.ceil(Math.max(w * 8, Math.min(nHarm, w * 0.5) * 24 + w * 2));
  return Math.max(w * 2, Math.min(120000, want));
}

/**
 * Dense then arc-length adaptive samples of eval01(phase01) over [0,1].
 * Returns { t, y } Float64Arrays.
 */
function nodeGraphMathCycleAdapt(eval01, outCount) {
  const nOut = Math.max(8, outCount | 0);
  const pre = Math.min(65536, Math.max(nOut * 3, nOut + 64));
  const tDense = new Float64Array(pre);
  const yDense = new Float64Array(pre);
  for (let i = 0; i < pre; i += 1) {
    const ti = i / (pre - 1);
    tDense[i] = ti;
    yDense[i] = eval01(ti);
  }
  const dist = new Float64Array(pre);
  dist[0] = 0;
  for (let i = 1; i < pre; i += 1) {
    dist[i] = dist[i - 1] + Math.hypot(
      tDense[i] - tDense[i - 1],
      yDense[i] - yDense[i - 1],
    );
  }
  const total = dist[pre - 1] || 1;
  const t = new Float64Array(nOut);
  const y = new Float64Array(nOut);
  let j = 0;
  for (let i = 0; i < nOut; i += 1) {
    const target = total * (i / (nOut - 1));
    while (j < pre - 2 && dist[j + 1] < target) j += 1;
    const d0 = dist[j];
    const d1 = dist[j + 1];
    const a = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    t[i] = tDense[j] + (tDense[j + 1] - tDense[j]) * a;
    y[i] = yDense[j] + (yDense[j + 1] - yDense[j]) * a;
  }
  return { t, y };
}

/** Normalize samples in-place to fit ≈ ±fit (default 1.15). Returns peak. */
function nodeGraphMathNormalizePeak(samples, fit = 1.15) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (!(peak > 1e-12)) return 0;
  const g = fit / peak;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= g;
  return peak;
}

function nodeGraphMathCycleClinicalGeom(samples, mapX, mapY, cssW, strokeW, color, disc = 0.85) {
  const n = samples.length;
  const polylines = [];
  let seg = [];
  const flush = () => {
    if (seg.length < 4) { seg = []; return; }
    const raw = Float32Array.from(seg);
    // Arc-length respacing at the samples' own density (as AA Blur draws:
    // no thinning, so ripples denser than a pixel keep their points).
    const pts = typeof nodeGraphClinicalLineAdaptPoints === "function"
      ? nodeGraphClinicalLineAdaptPoints(raw, Math.max(32, Math.ceil(cssW * 2), raw.length / 2))
      : raw;
    polylines.push({ points: pts, color, width: strokeW });
    seg = [];
  };
  let prevY = null;
  let prevPhase = 0;
  for (let i = 0; i < n; i += 1) {
    const phase = n <= 1 ? 0 : i / (n - 1);
    const y = Number(samples[i]);
    if (!Number.isFinite(y)) { flush(); prevY = null; continue; }
    if (prevY !== null && Math.abs(y - prevY) > disc) {
      // Connected steep bridge — keep one continuous stroke.
      const steps = Math.max(4, Math.min(64, Math.ceil(Math.abs(y - prevY) / 0.04)));
      for (let s = 1; s < steps; s += 1) {
        const u = s / steps;
        seg.push(
          mapX(prevPhase + (phase - prevPhase) * u),
          mapY(prevY + (y - prevY) * u),
        );
      }
    }
    seg.push(mapX(phase), mapY(y));
    prevY = y;
    prevPhase = phase;
  }
  flush();
  return { polylines };
}

/**
 * One cycle of bandlimited saw (Si closed form).
 * Index i → engine phase i/(count-1). Phase 0 is the wrap/jump: series = 0
 * (jump midpoint). Ramp zero-cross at phase 0.5. Extra samples near the wrap
 * resolve Gibbs without moving phase 0 off the series value.
 */
function nodeGraphMathGibbsSawCycle(N, count) {
  const n = Math.max(16, count | 0);
  const harm = Math.max(1, Number(N) || 1);
  const out = new Float64Array(n);
  const nearWidth = Math.min(0.06, 24 / harm);
  const nearCount = Math.min(4096, Math.max(32, Math.ceil(Math.min(harm, 1500))));
  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    const ph = i / (n - 1);
    pairs.push([ph, nodeGraphMathGibbsSaw(ph, harm)]);
  }
  for (let i = 0; i < nearCount; i += 1) {
    const u = (i + 0.5) / nearCount;
    const phL = u * nearWidth;
    const phR = 1 - u * nearWidth;
    if (phL > 0 && phL < 1) pairs.push([phL, nodeGraphMathGibbsSaw(phL, harm)]);
    if (phR > 0 && phR < 1) pairs.push([phR, nodeGraphMathGibbsSaw(phR, harm)]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const clean = [pairs[0]];
  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i][0] - clean[clean.length - 1][0] > 1e-12) clean.push(pairs[i]);
  }
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    const ph = i / (n - 1);
    while (j < clean.length - 2 && clean[j + 1][0] < ph) j += 1;
    const a = clean[j];
    const b = clean[Math.min(j + 1, clean.length - 1)];
    const span = b[0] - a[0];
    const u = span > 0 ? (ph - a[0]) / span : 0;
    out[i] = a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, u));
  }
  out[0] = nodeGraphMathGibbsSaw(0, harm);
  out[n - 1] = nodeGraphMathGibbsSaw(0, harm);
  return out;
}

function nodeGraphMathGibbsSquareCycle(N, count) {
  const n = Math.max(16, count | 0);
  const harm = Math.max(1, Number(N) || 1);
  const out = new Float64Array(n);
  // Every phase, edges included: the closed form is exact at the jump (its
  // midpoint, 0). A phase clamp here froze the first / last 0.5/N of the
  // cycle, a flat lead-in and lead-out at high pitch (few harmonics).
  for (let i = 0; i < n; i += 1) {
    const ph = i / (n - 1);
    out[i] = nodeGraphMathGibbsSaw(ph, harm) - nodeGraphMathGibbsSaw(ph - 0.5, harm);
  }
  return out;
}
