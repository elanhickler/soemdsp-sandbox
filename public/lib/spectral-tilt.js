// Shared spectral tilt (Oustaloup pole/zero cascade). Keep in lockstep with
// library/include/soemdsp/filter/spectral_tilt.h
const SOEMDSP_TILT_SECTIONS = 8;
const SOEMDSP_TILT_SMOOTH_S = 0.008;
const SOEMDSP_TILT_SCAN_S = 0.001;
const SOEMDSP_TILT_MAX_MAKEUP = 7.943282347242816;
const SOEMDSP_TILT_STYLE_PIVOT = 0;
const SOEMDSP_TILT_STYLE_KNEE = 1;
const SOEMDSP_TILT_LEVEL_TILT = 0;
const SOEMDSP_TILT_LEVEL_CUT = 1;
const SOEMDSP_TILT_LEVEL_MATCHED = 2;

function soemdspTiltCreateChannel() {
  return {
    x1: new Float64Array(SOEMDSP_TILT_SECTIONS),
    y1: new Float64Array(SOEMDSP_TILT_SECTIONS),
  };
}

function soemdspTiltCreateState() {
  return {
    b0: new Float64Array(SOEMDSP_TILT_SECTIONS).fill(1),
    b1: new Float64Array(SOEMDSP_TILT_SECTIONS),
    a1: new Float64Array(SOEMDSP_TILT_SECTIONS),
    smoothHz: 0,
    smoothSlope: 0,
    smoothGain: 1,
    lastTargetGain: 1,
    scanAge: 0,
    ready: false,
  };
}

function soemdspTiltClearChannel(ch) {
  if (!ch) return soemdspTiltCreateChannel();
  if (!ch.x1 || ch.x1.length !== SOEMDSP_TILT_SECTIONS) {
    ch.x1 = new Float64Array(SOEMDSP_TILT_SECTIONS);
    ch.y1 = new Float64Array(SOEMDSP_TILT_SECTIONS);
    return ch;
  }
  ch.x1.fill(0);
  ch.y1.fill(0);
  return ch;
}

function soemdspTiltClear(st) {
  if (!st) return soemdspTiltCreateState();
  st.b0 = new Float64Array(SOEMDSP_TILT_SECTIONS).fill(1);
  st.b1 = new Float64Array(SOEMDSP_TILT_SECTIONS);
  st.a1 = new Float64Array(SOEMDSP_TILT_SECTIONS);
  st.smoothHz = 0;
  st.smoothSlope = 0;
  st.smoothGain = 1;
  st.lastTargetGain = 1;
  st.scanAge = 0;
  st.ready = false;
  return st;
}

function soemdspTiltTanWp(f, sr) {
  let w = Math.PI * f / sr;
  if (w < 1e-12) w = 1e-12;
  if (w > 1.5) w = 1.5;
  const s = Math.sin(w);
  const c = Math.cos(w);
  return c === 0 ? 1e6 : s / c;
}

function soemdspTiltCascadeMag(st, f, sr) {
  const th = 2 * Math.PI * f / sr;
  const c = Math.cos(th);
  const s = Math.sin(th);
  let re = 1;
  let im = 0;
  for (let k = 0; k < SOEMDSP_TILT_SECTIONS; k += 1) {
    const nre = st.b0[k] + st.b1[k] * c;
    const nim = -st.b1[k] * s;
    const dre = 1 + st.a1[k] * c;
    const dim = -st.a1[k] * s;
    const d2 = dre * dre + dim * dim;
    const qre = (nre * dre + nim * dim) / d2;
    const qim = (nim * dre - nre * dim) / d2;
    const nre2 = re * qre - im * qim;
    const nim2 = re * qim + im * qre;
    re = nre2;
    im = nim2;
  }
  return Math.hypot(re, im);
}

function soemdspTiltScanSpectrum(st, sr, bandLo, bandHi) {
  const n = 48;
  let f0 = Number(bandLo);
  if (!(f0 > 0)) f0 = 20;
  if (f0 < 1) f0 = 1;
  let f1 = Number(bandHi);
  if (!(f1 > 0)) f1 = 20000;
  if (f1 > 0.45 * sr) f1 = 0.45 * sr;
  if (f1 < f0 * 1.01) f1 = f0 * 1.01;
  const ln0 = Math.log(f0);
  const ln1 = Math.log(f1);
  let maxMag = 0;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const u = i / (n - 1);
    const f = Math.exp(ln0 + u * (ln1 - ln0));
    const m = soemdspTiltCascadeMag(st, f, sr);
    if (m > maxMag) maxMag = m;
    acc += m * m;
  }
  return { maxMag, pinkMs: acc / n };
}

function soemdspTiltUpdate(st, hz, slopeDbOct, sampleRate, style, levelMode, matchLoHz, matchHiHz) {
  if (!st) st = soemdspTiltCreateState();
  let sr = Number(sampleRate);
  if (!(sr > 1)) sr = 44100;
  hz = Number(hz);
  if (!Number.isFinite(hz) || hz < 1) hz = 1;
  const maxHz = 0.45 * sr;
  if (hz > maxHz) hz = maxHz;
  slopeDbOct = Number(slopeDbOct);
  if (!Number.isFinite(slopeDbOct)) slopeDbOct = 0;
  if (slopeDbOct > 12) slopeDbOct = 12;
  if (slopeDbOct < -24) slopeDbOct = -24;
  const first = !st.ready || !(st.smoothHz > 0);
  if (first) {
    st.smoothHz = hz;
    st.smoothSlope = slopeDbOct;
    st.ready = true;
  } else {
    const a = 1 - Math.exp(-1 / (SOEMDSP_TILT_SMOOTH_S * sr));
    st.smoothHz = Math.exp(Math.log(st.smoothHz) + a * (Math.log(hz) - Math.log(st.smoothHz)));
    st.smoothSlope += a * (slopeDbOct - st.smoothSlope);
  }
  let fLo = style === SOEMDSP_TILT_STYLE_KNEE ? (st.smoothHz < 1 ? 1 : st.smoothHz) : 10;
  let fHi = 0.45 * sr;
  if (fHi <= fLo * 1.02) fHi = fLo * 1.02;
  const kDbOct = 6.020599913279624;
  let slopeAbs = st.smoothSlope;
  let sign = 1;
  if (slopeAbs < 0) {
    sign = -1;
    slopeAbs = -slopeAbs;
  }
  let nInt = Math.floor(slopeAbs / kDbOct + 1e-9);
  if (nInt > SOEMDSP_TILT_SECTIONS - 2) nInt = SOEMDSP_TILT_SECTIONS - 2;
  if (nInt < 0) nInt = 0;
  const rest = st.smoothSlope - sign * kDbOct * nInt;
  let idx = 0;
  for (let i = 0; i < nInt; i += 1) {
    const fz = sign < 0 ? fHi : fLo;
    const fp = sign < 0 ? fLo : fHi;
    const wz = soemdspTiltTanWp(fz, sr);
    const wp = soemdspTiltTanWp(fp, sr);
    const scale = wp / wz;
    const a0 = 1 + wp;
    st.b0[idx] = scale * (1 + wz) / a0;
    st.b1[idx] = scale * (wz - 1) / a0;
    st.a1[idx] = (wp - 1) / a0;
    idx += 1;
  }
  const nOust = SOEMDSP_TILT_SECTIONS - idx;
  const alpha = rest / kDbOct;
  const lnRatio = Math.log(fHi / fLo);
  for (let k = 0; k < nOust; k += 1) {
    const kz = (k + 0.5 - 0.5 * alpha) / nOust;
    const kp = (k + 0.5 + 0.5 * alpha) / nOust;
    const fz = fLo * Math.exp(lnRatio * kz);
    const fp = fLo * Math.exp(lnRatio * kp);
    const wz = soemdspTiltTanWp(fz, sr);
    const wp = soemdspTiltTanWp(fp, sr);
    const scale = wp / wz;
    const a0 = 1 + wp;
    st.b0[idx] = scale * (1 + wz) / a0;
    st.b1[idx] = scale * (wz - 1) / a0;
    st.a1[idx] = (wp - 1) / a0;
    idx += 1;
  }
  if (style !== SOEMDSP_TILT_STYLE_KNEE) {
    let pivot = st.smoothHz;
    if (pivot < fLo) pivot = fLo;
    if (pivot > 0.45 * sr) pivot = 0.45 * sr;
    const mag = soemdspTiltCascadeMag(st, pivot, sr);
    if (mag > 1e-12) {
      const g = 1 / mag;
      st.b0[0] *= g;
      st.b1[0] *= g;
    }
  } else {
    const dc = soemdspTiltCascadeMag(st, 1, sr);
    if (dc > 1e-12) {
      const g = 1 / dc;
      st.b0[0] *= g;
      st.b1[0] *= g;
    }
  }
  let mode = Math.round(Number(levelMode) || 0);
  if (mode < 0) mode = 0;
  if (mode > 2) mode = 2;
  let targetGain = 1;
  if (mode === SOEMDSP_TILT_LEVEL_CUT || mode === SOEMDSP_TILT_LEVEL_MATCHED) {
    let period = Math.round(SOEMDSP_TILT_SCAN_S * sr);
    if (period < 1) period = 1;
    if (first || !(st.scanAge < period)) {
      const scan = soemdspTiltScanSpectrum(st, sr, matchLoHz, matchHiHz);
      if (mode === SOEMDSP_TILT_LEVEL_CUT) {
        if (scan.maxMag > 1e-12) targetGain = 1 / scan.maxMag;
      } else if (scan.pinkMs > 1e-12) {
        targetGain = 1 / Math.sqrt(scan.pinkMs);
      }
      if (mode === SOEMDSP_TILT_LEVEL_MATCHED && targetGain > SOEMDSP_TILT_MAX_MAKEUP) {
        targetGain = SOEMDSP_TILT_MAX_MAKEUP;
      }
      st.lastTargetGain = targetGain;
      st.scanAge = 0;
    } else {
      st.scanAge += 1;
      targetGain = st.lastTargetGain > 0 ? st.lastTargetGain : 1;
    }
  }
  if (first || !(st.smoothGain > 0)) {
    st.smoothGain = targetGain;
  } else {
    const a = 1 - Math.exp(-1 / (SOEMDSP_TILT_SMOOTH_S * sr));
    st.smoothGain += a * (targetGain - st.smoothGain);
  }
  if (st.smoothGain !== 1) {
    st.b0[0] *= st.smoothGain;
    st.b1[0] *= st.smoothGain;
  }
  return st;
}

function soemdspTiltProcess(st, ch, x) {
  if (!st || !ch) return x;
  let y = x;
  for (let k = 0; k < SOEMDSP_TILT_SECTIONS; k += 1) {
    const x0 = y;
    y = st.b0[k] * x0 + st.b1[k] * ch.x1[k] - st.a1[k] * ch.y1[k];
    if (!Number.isFinite(y)) y = 0;
    ch.x1[k] = x0;
    ch.y1[k] = y;
  }
  return y;
}

function createNodeGraphStereoTiltFilterState() {
  return {
    state: soemdspTiltCreateState(),
    left: soemdspTiltCreateChannel(),
    right: soemdspTiltCreateChannel(),
  };
}

function nodeGraphStereoTiltFilterProcess(stereo, left, right, pivotHz, slopeDbOct, sampleRate, levelMode) {
  const st = stereo || createNodeGraphStereoTiltFilterState();
  soemdspTiltUpdate(st.state, pivotHz, slopeDbOct, sampleRate, SOEMDSP_TILT_STYLE_PIVOT, levelMode);
  return {
    left: soemdspTiltProcess(st.state, st.left, left),
    right: soemdspTiltProcess(st.state, st.right, right),
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.SOEMDSP_TILT_STYLE_PIVOT = SOEMDSP_TILT_STYLE_PIVOT;
  globalThis.SOEMDSP_TILT_STYLE_KNEE = SOEMDSP_TILT_STYLE_KNEE;
  globalThis.SOEMDSP_TILT_LEVEL_TILT = SOEMDSP_TILT_LEVEL_TILT;
  globalThis.SOEMDSP_TILT_LEVEL_CUT = SOEMDSP_TILT_LEVEL_CUT;
  globalThis.SOEMDSP_TILT_LEVEL_MATCHED = SOEMDSP_TILT_LEVEL_MATCHED;
  globalThis.SOEMDSP_TILT_MAX_MAKEUP = SOEMDSP_TILT_MAX_MAKEUP;
  globalThis.SOEMDSP_TILT_SMOOTH_S = SOEMDSP_TILT_SMOOTH_S;
}
