// Offline / Render Sample host for dsfOscillator — same native core as worklet.
// APP_POLICY §2/§5: no JS DSF twin. Silence until dsf_oscillator.wasm is ready.

const nodeGraphDsfOscillatorWasm = { promise: null, exports: null, failed: false };

function nodeGraphDsfOscillatorLoadWasm() {
  if (nodeGraphDsfOscillatorWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return;
  }
  nodeGraphDsfOscillatorWasm.promise = fetch("/native_modules/dsf_oscillator/dsf_oscillator.wasm?v=dsf-formant-removed-1")
    .then((response) => {
      if (!response.ok) throw new Error(`dsf_oscillator wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((result) => {
      nodeGraphDsfOscillatorWasm.exports = result.instance.exports;
    })
    .catch(() => {
      nodeGraphDsfOscillatorWasm.failed = true;
    });
}

function createNodeGraphDsfOscillatorState() {
  return { nativeHandle: 0 };
}

function destroyNodeGraphDsfOscillatorNativeState(state) {
  const wasm = nodeGraphDsfOscillatorWasm.exports;
  if (state?.nativeHandle && wasm?.soemdsp_dsf_oscillator_destroy) {
    wasm.soemdsp_dsf_oscillator_destroy(state.nativeHandle);
    state.nativeHandle = 0;
  }
}

// options: { frequencyHz, sampleRate, waveform, morph, pulseWidth, blend, phase, level, partials }
// morphing: { morphing, symmetry, width, rotate, slice, spacing, oddEven }
function nodeGraphDsfOscillatorSample(state, options = {}) {
  nodeGraphDsfOscillatorLoadWasm();
  const wasm = nodeGraphDsfOscillatorWasm.exports;
  if (!wasm?.soemdsp_dsf_oscillator_create || !wasm?.soemdsp_dsf_oscillator_sample) {
    return { Out: 0 };
  }
  if (!state.nativeHandle) {
    state.nativeHandle = wasm.soemdsp_dsf_oscillator_create();
  }
  if (!state.nativeHandle) {
    return { Out: 0 };
  }
  const sr = Number(options.sampleRate) > 1 ? Number(options.sampleRate) : 48000;
  if (options.morphing && typeof wasm.soemdsp_dsf_oscillator_sample_morph === "function") {
    wasm.soemdsp_dsf_oscillator_sample_morph(
      state.nativeHandle,
      nodeGraphFiniteNumber(options.frequencyHz),
      sr,
      nodeGraphFiniteNumber(options.morph),
      nodeGraphFiniteNumber(options.symmetry),
      nodeGraphFiniteNumber(options.width),
      nodeGraphFiniteNumber(options.rotate),
      nodeGraphFiniteNumber(options.slice),
      nodeGraphFiniteNumber(options.phase),
      nodeGraphFiniteNumber(options.level),
      nodeGraphFiniteNumber(options.spacing, 1),
      nodeGraphFiniteNumber(options.oddEven),
    );
  } else {
    wasm.soemdsp_dsf_oscillator_sample(
      state.nativeHandle,
      nodeGraphFiniteNumber(options.frequencyHz),
      sr,
      Math.round(nodeGraphFiniteNumber(options.waveform)),
      nodeGraphFiniteNumber(options.morph),
      Number(options.pulseWidth) ?? 0.5,
      Number(options.blend) ?? 0.5,
      nodeGraphFiniteNumber(options.phase),
      nodeGraphFiniteNumber(options.level),
      nodeGraphFiniteNumber(options.partials, 20000),
    );
  }
  return { Out: nodeGraphFiniteNumber(wasm.soemdsp_dsf_oscillator_out(state.nativeHandle)) };
}

// DSF Oscillator face: the settled cycle, computed per partial (display only;
// the audio is always the wasm). Every stage of dsf_oscillator.cpp v36 is
// linear in phase, so each partial h's settled amplitude and phase is a
// closed form, with w = 2 pi h and the leak alpha = 2 pi / 20 per turn:
//   kernel term       a^(h-1) cos(w t)  (top partial times the fractional fade)
//   saw               1 / (iw + alpha) + alpha / (iw + alpha)^2   (leak + v36 correction)
//   Square            saw times (1 - e^(-iw Morph))
//   SquSaw            saw times (1 - Blend e^(-iw / 2))
//   Trimorph          1 / (iw + alpha)^2 times (1 - e^(-iw Morph)), the 1.3 /
//                     (Morph (1 - Morph)) level, then the DC blocker iw / (iw + alpha)
// One inverse FFT builds the cycle. A short simulation cannot show this: the
// Trimorph chains settle over many cycles, which 1 / (Morph (1 - Morph))
// magnifies ~50x at extreme Morph.
const NODE_GRAPH_DSF_FACE_FFT = 8192;
const NODE_GRAPH_DSF_LEAK_PER_TURN = 2 * Math.PI / 20;

function nodeGraphDsfFaceFft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len; // inverse transform (+i)
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let start = 0; start < n; start += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = start + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Settled DSF Oscillator cycle, output[i] at phase i / (count - 1) (both ends = phase 0). */
function nodeGraphDsfAnalyticCycle(params, count, sampleRate) {
  const output = new Float64Array(Math.max(16, Math.min(8192, count | 0)));
  const waveform = Math.round(nodeGraphFiniteNumber(params.waveform, 1));
  if (waveform <= 0) {
    for (let i = 0; i < output.length; i += 1) output[i] = Math.sin(2 * Math.PI * i / (output.length - 1));
    return output;
  }
  const M = NODE_GRAPH_DSF_FACE_FFT;
  const bright = Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.morph, 1)));
  const k = (1 - Math.pow(bright, 0.14)) * 4;
  const a = Math.pow(2, -k * k);
  const ampAdjust = bright * (2.7 - 3.15) + 3.15;
  const nf = nodeGraphDsfPreviewPartials(params, sampleRate);
  const nLo = Math.max(1, Math.floor(nf));
  const frac = nf - nLo;
  const top = frac > 0 && nLo + 1 < M / 2 ? nLo + 1 : nLo;
  const pw = Math.max(0.01, Math.min(0.99, nodeGraphFiniteNumber(params.pulseWidth, 0.5)));
  const blend = Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.blend, 0.5)));
  const alpha = NODE_GRAPH_DSF_LEAK_PER_TURN;
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  let weight = 1;
  for (let h = 1; h <= top; h += 1) {
    const amp = weight * (h > nLo ? frac : 1);
    weight *= a;
    const w = 2 * Math.PI * h;
    // 1 / (iw + alpha) = (alpha - iw) / D
    const d = alpha * alpha + w * w;
    const l1r = alpha / d;
    const l1i = -w / d;
    // 1 / (iw + alpha)^2
    const l2r = l1r * l1r - l1i * l1i;
    const l2i = 2 * l1r * l1i;
    let cr;
    let ci;
    if (waveform === 3) {
      cr = l2r;
      ci = l2i;
    } else {
      cr = l1r + alpha * l2r;
      ci = l1i + alpha * l2i;
    }
    if (waveform === 2 || waveform === 3) {
      // times (1 - e^(-iw pw))
      const er = 1 - Math.cos(w * pw);
      const ei = Math.sin(w * pw);
      const nr = cr * er - ci * ei;
      ci = cr * ei + ci * er;
      cr = nr;
    } else if (waveform === 4) {
      // times (1 - blend e^(-i pi h)) = 1 - blend (-1)^h
      const f = 1 - blend * (h % 2 ? -1 : 1);
      cr *= f;
      ci *= f;
    }
    let g = ampAdjust;
    if (waveform === 3) {
      g = ampAdjust * 1.3 / (pw * (1 - pw));
      // DC blocker: iw / (iw + alpha) = iw (alpha - iw) / D = (w^2 + i w alpha) / D
      const br = (w * w) / d;
      const bi = (w * alpha) / d;
      const nr = cr * br - ci * bi;
      ci = cr * bi + ci * br;
      cr = nr;
    }
    // Kernel term amp * cos(w t) = Re(amp e^{iwt}); the chain response C turns
    // it into Re(amp C e^{iwt}).
    re[h] = amp * g * cr;
    im[h] = amp * g * ci;
  }
  nodeGraphDsfFaceFft(re, im);
  // re[n] = Re(sum C_h e^{i 2 pi h n / M}) = the cycle at phase n / M.
  const last = output.length - 1;
  for (let i = 0; i <= last; i += 1) {
    const x = (i / last) * M;
    const i0 = Math.floor(x) % M;
    const fr = x - Math.floor(x);
    const v = re[i0] + (re[(i0 + 1) % M] - re[i0]) * fr;
    output[i] = Math.max(-1.5, Math.min(1.5, v));
  }
  return output;
}

// DSF Morphing Osc face, the same way (dsf_oscillator.cpp morphImpulse /
// spacedKernel, one leaky chain + the v36 correction, times ampAdjust):
//   Spacing 1 (harmonic): partials start..n, n = Nyquist / f - 1 at the real
//     pitch (start = Slice of n), amplitude r^(h - start) for r = a and -a
//     (Symmetry mixes them), odd offsets times (1 - Odd/Even), Width mixes in
//     the odd-partial series, Rotate adds a phase to every partial; the top
//     partial fades as the engine's lo / hi kernels. One inverse FFT.
//   Other Spacing (inharmonic, no repeating cycle): partial j at
//     f (1 + j Spacing), amplitude a^j (Odd/Even on odd j), drawn over one
//     fundamental period by direct sum. Rotate there is a time shift.
const NODE_GRAPH_DSF_MORPH_MAX_PARTIALS = 1048576;
const NODE_GRAPH_DSF_INHARMONIC_POINTS = 2048;

/** Leaky integrator + v36 correction at angular rate w (per turn): 1/(iw+alpha) + alpha/(iw+alpha)^2. */
function nodeGraphDsfSawResponse(w) {
  const alpha = NODE_GRAPH_DSF_LEAK_PER_TURN;
  const d = alpha * alpha + w * w;
  const l1r = alpha / d;
  const l1i = -w / d;
  const l2r = l1r * l1r - l1i * l1i;
  const l2i = 2 * l1r * l1i;
  return [l1r + alpha * l2r, l1i + alpha * l2i];
}

function nodeGraphDsfMorphShape(params) {
  const morph = Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.morph, 1)));
  const k = (1 - Math.pow(morph, 0.14)) * 4;
  return {
    a: Math.pow(0.5, k * k),
    ampAdjust: morph * (2.7 - 3.15) + 3.15,
    symmetry: Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.symmetry, 0))),
    width: Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.width, 0))),
    oddEven: Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.oddEven, 0))),
    rotate: nodeGraphFiniteNumber(params.rotate, 0),
    slice: Math.max(0, Math.min(1, nodeGraphFiniteNumber(params.slice, 0))),
  };
}

/**
 * The engine's Rotate level (dsf_oscillator.cpp rotateGain): peak(0) /
 * peak(Rotate) of the all-partials rotated series, the partial count n as
 * a <= 1 - 0.5615 / n, Gibbs 1 + 0.179 a^n on the unrotated term.
 */
function nodeGraphDsfMorphRotateGain(a, n, rotate) {
  let r = rotate - Math.floor(rotate);
  if (r > 0.5) r -= 1;
  if (Math.abs(r) < 1e-9) return 1;
  const aEff = Math.min(a, 1 - 0.5615 / Math.max(1, n));
  if (aEff < 1e-6) return 1;
  const gibbs = 1 + 0.179 * Math.pow(a, n);
  const peak = (cosR, sinR) => {
    let p = 0;
    const f = (x) => {
      const q = Math.max(1e-300, 1 - 2 * aEff * Math.cos(x) + aEff * aEff);
      const v = cosR * gibbs * Math.atan2(aEff * Math.sin(x), 1 - aEff * Math.cos(x)) - sinR * 0.5 * Math.log(q);
      p = Math.max(p, Math.abs(v));
    };
    const e = 1 - aEff;
    for (let k = -8; k < 80; k += 1) {
      const x = e * 2 ** (k / 2);
      if (x > Math.PI) break;
      f(x);
      f(-x);
    }
    f(0);
    f(Math.PI);
    return p;
  };
  const pr = peak(Math.cos(2 * Math.PI * r), Math.sin(2 * Math.PI * r));
  return pr > 1e-12 ? peak(1, 0) / pr : 1;
}

/** Real partial count of the Morphing Osc at this pitch (preparePartials, no Partials cap). */
function nodeGraphDsfMorphPartialCount(params, sampleRate) {
  const absFrequency = Math.abs(nodeGraphFiniteNumber(params.frequency));
  const sp = Math.abs(nodeGraphFiniteNumber(params.spacing, 1)) || 1;
  const harmonic = Math.abs(sp - 1) < 1e-6;
  if (!(absFrequency > 0)) return NODE_GRAPH_DSF_MORPH_MAX_PARTIALS;
  const nyquist = sampleRate * 0.5;
  const nf = harmonic ? nyquist / absFrequency - 1 : (nyquist / absFrequency - 2) / sp + 1;
  return Math.max(1, Math.min(NODE_GRAPH_DSF_MORPH_MAX_PARTIALS, nf));
}

function nodeGraphDsfMorphSliceStart(slice, n) {
  let start = Math.floor(1 + slice * (n - 1) + 1e-12);
  if (start < 1) start = 1;
  const nI = Math.floor(n);
  if (start > nI) start = nI < 1 ? 1 : nI;
  return start;
}

/** Add one engine kernel (partials start..end, weight) into amp[h] (real amplitudes, h < amp.length). */
function nodeGraphDsfMorphAddKernel(amp, shape, start, end, weight) {
  const H = amp.length - 1;
  const { a, symmetry, width, oddEven } = shape;
  const parts = [];
  if (symmetry < 1) parts.push([a, 1 - symmetry]);
  if (symmetry > 0) parts.push([-a, symmetry]);
  for (const [r, rw] of parts) {
    const wgt = weight * rw;
    if (width < 1) {
      let rk = 1;
      for (let h = start; h <= end && h <= H; h += 1) {
        const odd = (h - start) % 2 === 1;
        amp[h] += wgt * (1 - width) * rk * (odd ? 1 - oddEven : 1);
        rk *= r;
        if (Math.abs(rk) < 1e-14) break;
      }
    }
    if (width > 0) {
      let oddStart = start;
      if (oddStart % 2 === 0) oddStart += 1;
      let rk = 1;
      for (let h = oddStart; h <= end && h <= H; h += 2) {
        amp[h] += wgt * width * rk;
        rk *= r;
        if (Math.abs(rk) < 1e-14) break;
      }
    }
  }
}

/** Settled DSF Morphing Osc cycle, output[i] at phase i / (count - 1). */
function nodeGraphDsfMorphAnalyticCycle(params, count, sampleRate) {
  const output = new Float64Array(Math.max(16, Math.min(8192, count | 0)));
  const shape = nodeGraphDsfMorphShape(params);
  const sp = nodeGraphFiniteNumber(params.spacing, 1) || 1;
  const harmonic = Math.abs(sp - 1) < 1e-6;
  const nf = nodeGraphDsfMorphPartialCount(params, sampleRate);
  const nLo = Math.max(1, Math.floor(nf));
  const frac = nLo < NODE_GRAPH_DSF_MORPH_MAX_PARTIALS ? nf - nLo : 0;
  const last = output.length - 1;
  if (harmonic) {
    const M = NODE_GRAPH_DSF_FACE_FFT;
    const amp = new Float64Array(M / 2);
    nodeGraphDsfMorphAddKernel(amp, shape, nodeGraphDsfMorphSliceStart(shape.slice, nLo), nLo, 1 - frac);
    if (frac > 0) {
      nodeGraphDsfMorphAddKernel(amp, shape, nodeGraphDsfMorphSliceStart(shape.slice, nLo + 1), nLo + 1, frac);
    }
    const re = new Float64Array(M);
    const im = new Float64Array(M);
    const rot = 2 * Math.PI * shape.rotate;
    const rotLevel = nodeGraphDsfMorphRotateGain(shape.a, nLo, shape.rotate);
    const cr0 = Math.cos(rot) * rotLevel;
    const ci0 = Math.sin(rot) * rotLevel;
    for (let h = 1; h < amp.length; h += 1) {
      if (!amp[h]) continue;
      const [rr, ri] = nodeGraphDsfSawResponse(2 * Math.PI * h);
      const g = amp[h] * shape.ampAdjust;
      re[h] = g * (cr0 * rr - ci0 * ri);
      im[h] = g * (cr0 * ri + ci0 * rr);
    }
    nodeGraphDsfFaceFft(re, im);
    for (let i = 0; i <= last; i += 1) {
      const x = (i / last) * M;
      const i0 = Math.floor(x) % M;
      const fr = x - Math.floor(x);
      const v = re[i0] + (re[(i0 + 1) % M] - re[i0]) * fr;
      output[i] = Math.max(-1.5, Math.min(1.5, v));
    }
    return output;
  }
  // Inharmonic: direct sum over one fundamental period, partials the display
  // can resolve (rate 1 + j |Spacing| below half its points).
  const P = NODE_GRAPH_DSF_INHARMONIC_POINTS;
  const jMax = Math.min(nLo, Math.floor((P / 2 - 1) / Math.abs(sp)) + 1);
  const curve = new Float64Array(P + 1);
  let w0 = 1;
  for (let j = 0; j < jMax; j += 1) {
    // Stop when the series itself is negligible (Odd/Even 1 zeroes odd j only).
    if (Math.abs(w0) < 1e-14) break;
    const amp = w0 * (j % 2 === 1 ? 1 - shape.oddEven : 1);
    w0 *= shape.a;
    if (!amp) continue;
    const rate = 1 + j * sp;
    const w = 2 * Math.PI * rate;
    const [rr, ri] = nodeGraphDsfSawResponse(w);
    // Rotate shifts time here: phase 2 pi rotate (1 + j Spacing).
    const ph = 2 * Math.PI * shape.rotate * rate;
    const g = amp * shape.ampAdjust;
    let cr = g * (Math.cos(ph) * rr - Math.sin(ph) * ri);
    let ci = g * (Math.cos(ph) * ri + Math.sin(ph) * rr);
    const sr = Math.cos(w / P);
    const si = Math.sin(w / P);
    for (let n = 0; n <= P; n += 1) {
      curve[n] += cr;
      const nr = cr * sr - ci * si;
      ci = cr * si + ci * sr;
      cr = nr;
    }
  }
  if (frac > 0 && nLo < jMax) {
    // The next partial fades in with the fractional count.
    const j = nLo;
    const amp = frac * Math.pow(shape.a, j) * (j % 2 === 1 ? 1 - shape.oddEven : 1);
    const rate = 1 + j * sp;
    const w = 2 * Math.PI * rate;
    const [rr, ri] = nodeGraphDsfSawResponse(w);
    const ph = 2 * Math.PI * shape.rotate * rate;
    const g = amp * shape.ampAdjust;
    for (let n = 0; n <= P; n += 1) {
      const t = (n / P) * w + ph;
      curve[n] += g * (Math.cos(t) * rr - Math.sin(t) * ri);
    }
  }
  for (let i = 0; i <= last; i += 1) {
    const x = (i / last) * P;
    const i0 = Math.min(P - 1, Math.floor(x));
    const v = curve[i0] + (curve[i0 + 1] - curve[i0]) * (x - i0);
    output[i] = Math.max(-1.5, Math.min(1.5, v));
  }
  return output;
}

// Face resolution: partials above half of this are not drawn (the face has
// NODE_GRAPH_DSF_FACE_FFT points per cycle).
const NODE_GRAPH_DSF_PREVIEW_POINTS = NODE_GRAPH_DSF_FACE_FFT;

/**
 * Partials the preview draws: what the real pitch allows (Nyquist / f - 1),
 * capped by the Partials param and by the preview's own Nyquist.
 */
function nodeGraphDsfPreviewPartials(params, sampleRate) {
  const absFrequency = Math.abs(nodeGraphFiniteNumber(params.frequency));
  const cap = absFrequency > 0 ? sampleRate * 0.5 / absFrequency - 1 : Infinity;
  const param = params.morphing === true ? Infinity : nodeGraphFiniteNumber(params.partials, 1048576);
  return Math.max(1, Math.min(param, cap, NODE_GRAPH_DSF_PREVIEW_POINTS * 0.5 - 1));
}

/**
 * What the preview cycle depends on, for the face cache. Since v36 the shape
 * depends on the pitch only through the partial count (the leak is per
 * phase), so modulating the pitch does not recompute the face every frame.
 */
function nodeGraphDsfPreviewPitchKey(params, sampleRate) {
  if (params.morphing === true) {
    // Slice picks its start from the real partial count; otherwise only the
    // partials the face can draw matter.
    const nf = nodeGraphDsfMorphPartialCount(params, sampleRate);
    const slice = nodeGraphFiniteNumber(params.slice, 0);
    return `m${(slice > 0 ? nf : Math.min(nf, NODE_GRAPH_DSF_FACE_FFT * 0.5)).toPrecision(5)}`;
  }
  return `n${nodeGraphDsfPreviewPartials(params, sampleRate).toPrecision(4)}`;
}

function nodeGraphDsfOscillatorPreviewCycle(params, count) {
  // The face is computed per partial (display only, no simulation): see
  // nodeGraphDsfAnalyticCycle / nodeGraphDsfMorphAnalyticCycle.
  const sampleRate = nodeGraphDsfSampleRate();
  return params.morphing === true
    ? nodeGraphDsfMorphAnalyticCycle(params, count, sampleRate)
    : nodeGraphDsfAnalyticCycle(params, count, sampleRate);
}
