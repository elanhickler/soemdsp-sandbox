// Shared spectral tilt: cascaded first-order pole/zero sections (Oustaloup)
// approximating a constant dB/octave slope. Used by Tilt Filter and by
// Music Player Tape playback.
//
// Style pivot (0): slope through the spectrum, then a level mode:
//   Tilt (0): 0 dB at the pivot. +slope brighter (HF up, LF down).
//   Cut (1): same shape shifted so the peak is 0 dB (never boosts).
//   Matched (2): pink-weighted (equal log-f bins) equal-power makeup so
//     power stays roughly constant over a band (default 20 Hz-20 kHz).
//   Loudness (3): same equal-power idea, but ITU-R BS.1770 K-weighted
//     (Tape). Mid/high loss is made up so slowed Tape stays as loud as Sinc.
//     Tape's match band is 1 Hz..playback cutoff. Makeup is capped at +24 dB.
//     Gain is rescanned about every 1 ms and smoothed (8 ms).
// Style knee (1): flat below the knee, then the requested slope above it
//   (Music Player Tape). DC gain is 1. Tape uses Loudness over 1 Hz..cutoff.
#pragma once

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>

namespace soemdsp_maths {
namespace spectral_tilt {

static const int kSections = 8;
static const double kSmoothS = 0.008;
static const double kScanS = 0.001;
static const double kMaxMakeup = 15.848931924611133; // +24 dB
static const int kStylePivot = 0;
static const int kStyleKnee = 1;
static const int kLevelTilt = 0;
static const int kLevelCut = 1;
static const int kLevelMatched = 2;
static const int kLevelLoudness = 3;

struct Channel {
  double x1[kSections];
  double y1[kSections];
};

struct State {
  double b0[kSections];
  double b1[kSections];
  double a1[kSections];
  double smoothHz;
  double smoothSlope;
  double smoothGain;
  double lastTargetGain;
  int scanAge;
  int ready;
};

static inline void clear_channel(Channel* ch) {
  if (!ch) return;
  for (int i = 0; i < kSections; i += 1) {
    ch->x1[i] = 0.0;
    ch->y1[i] = 0.0;
  }
}

static inline void clear(State* st) {
  if (!st) return;
  st->smoothHz = 0.0;
  st->smoothSlope = 0.0;
  st->smoothGain = 1.0;
  st->lastTargetGain = 1.0;
  st->scanAge = 0;
  st->ready = 0;
  for (int i = 0; i < kSections; i += 1) {
    st->b0[i] = 1.0;
    st->b1[i] = 0.0;
    st->a1[i] = 0.0;
  }
}

static inline double tan_wp(double f, double sr) {
  double w = 3.14159265358979323846 * f / sr;
  if (w < 1.0e-12) w = 1.0e-12;
  if (w > 1.5) w = 1.5;
  const double s = dsp_sin(w);
  const double c = dsp_cos(w);
  return c == 0.0 ? 1.0e6 : s / c;
}

static inline double hypot2(double x, double y) {
  return dsp_exp(0.5 * dsp_ln(x * x + y * y + 1.0e-30));
}

static inline double cascade_mag(const State* st, double f, double sr) {
  const double th = 6.28318530717958647692 * f / sr;
  const double c = dsp_cos(th);
  const double s = dsp_sin(th);
  double re = 1.0;
  double im = 0.0;
  for (int k = 0; k < kSections; k += 1) {
    const double nre = st->b0[k] + st->b1[k] * c;
    const double nim = -st->b1[k] * s;
    const double dre = 1.0 + st->a1[k] * c;
    const double dim = -st->a1[k] * s;
    const double d2 = dre * dre + dim * dim;
    const double qre = (nre * dre + nim * dim) / d2;
    const double qim = (nim * dre - nre * dim) / d2;
    const double nre2 = re * qre - im * qim;
    const double nim2 = re * qim + im * qre;
    re = nre2;
    im = nim2;
  }
  return hypot2(re, im);
}

static inline void scan_spectrum(
  const State* st, double sr, double* maxMag, double* pinkMs, double bandLo, double bandHi
) {
  const int n = 48;
  double f0 = bandLo;
  if (!(f0 > 0.0)) f0 = 20.0;
  if (f0 < 1.0) f0 = 1.0;
  double f1 = bandHi;
  if (!(f1 > 0.0)) f1 = 20000.0;
  if (f1 > 0.45 * sr) f1 = 0.45 * sr;
  if (f1 < f0 * 1.01) f1 = f0 * 1.01;
  const double ln0 = dsp_ln(f0);
  const double ln1 = dsp_ln(f1);
  double mx = 0.0;
  double acc = 0.0;
  for (int i = 0; i < n; i += 1) {
    const double u = (double)i / (double)(n - 1);
    const double f = dsp_exp(ln0 + u * (ln1 - ln0));
    const double m = cascade_mag(st, f, sr);
    if (m > mx) mx = m;
    acc += m * m;
  }
  if (maxMag) *maxMag = mx;
  if (pinkMs) *pinkMs = acc / (double)n;
}

// Biquad frequency-response magnitude. a0 is already baked into the coeffs.
static inline double biquad_mag(double b0, double b1, double b2, double a1, double a2, double f, double sr) {
  const double th = 6.28318530717958647692 * f / sr;
  const double c = dsp_cos(th);
  const double s = dsp_sin(th);
  const double c2 = c * c - s * s;
  const double s2 = 2.0 * c * s;
  const double nre = b0 + b1 * c + b2 * c2;
  const double nim = -b1 * s - b2 * s2;
  const double dre = 1.0 + a1 * c + a2 * c2;
  const double dim = -a1 * s - a2 * s2;
  const double d2 = dre * dre + dim * dim;
  return hypot2((nre * dre + nim * dim) / d2, (nim * dre - nre * dim) / d2);
}

// ITU-R BS.1770 K-weighting (high shelf + RLB highpass) at any sample rate.
// Returns equal-log-bin makeup 1 / rms(W_k * |H_tilt|).
static inline double loudness_matched_gain(
  const State* st, double sr, double bandLo, double bandHi
) {
  const int n = 48;
  double f0 = bandLo;
  if (!(f0 > 0.0)) f0 = 20.0;
  if (f0 < 1.0) f0 = 1.0;
  double f1 = bandHi;
  if (!(f1 > 0.0)) f1 = 20000.0;
  if (f1 > 0.45 * sr) f1 = 0.45 * sr;
  if (f1 < f0 * 1.01) f1 = f0 * 1.01;
  const double ln0 = dsp_ln(f0);
  const double ln1 = dsp_ln(f1);
  const double kLn10Over20 = 0.1151292546497022842;
  const double fPre = 1681.974450955533;
  const double gPre = 3.999843853973347;
  const double qPre = 0.7071752369554196;
  const double Kpre = tan_wp(fPre, sr);
  const double Vh = dsp_exp(gPre * kLn10Over20);
  const double Vb = dsp_exp(0.4996667741545416 * dsp_ln(Vh));
  double a0 = 1.0 + Kpre / qPre + Kpre * Kpre;
  const double preB0 = (Vh + Vb * Kpre / qPre + Kpre * Kpre) / a0;
  const double preB1 = 2.0 * (Kpre * Kpre - Vh) / a0;
  const double preB2 = (Vh - Vb * Kpre / qPre + Kpre * Kpre) / a0;
  const double preA1 = 2.0 * (Kpre * Kpre - 1.0) / a0;
  const double preA2 = (1.0 - Kpre / qPre + Kpre * Kpre) / a0;
  const double fRlb = 38.13547087602444;
  const double qRlb = 0.5003270373238773;
  const double Krlb = tan_wp(fRlb, sr);
  a0 = 1.0 + Krlb / qRlb + Krlb * Krlb;
  const double rlbB0 = 1.0 / a0;
  const double rlbB1 = -2.0 / a0;
  const double rlbB2 = 1.0 / a0;
  const double rlbA1 = 2.0 * (Krlb * Krlb - 1.0) / a0;
  const double rlbA2 = (1.0 - Krlb / qRlb + Krlb * Krlb) / a0;
  double num = 0.0;
  double den = 0.0;
  for (int i = 0; i < n; i += 1) {
    const double u = (double)i / (double)(n - 1);
    const double f = dsp_exp(ln0 + u * (ln1 - ln0));
    const double m = cascade_mag(st, f, sr);
    const double w =
      biquad_mag(preB0, preB1, preB2, preA1, preA2, f, sr) *
      biquad_mag(rlbB0, rlbB1, rlbB2, rlbA1, rlbA2, f, sr);
    num += w * w;
    den += (w * m) * (w * m);
  }
  if (den <= 1.0e-12) return 1.0;
  return dsp_exp(0.5 * dsp_ln(num / den));
}

static inline void update(
  State* st,
  double hz,
  double slopeDbOct,
  double sampleRate,
  int style,
  int levelMode = 0,
  double matchLoHz = 20.0,
  double matchHiHz = 20000.0
) {
  if (!st) return;
  double sr = sampleRate > 1.0 ? sampleRate : 44100.0;
  if (!(hz * 0.0 == 0.0) || hz < 1.0) hz = 1.0;
  const double maxHz = 0.45 * sr;
  if (hz > maxHz) hz = maxHz;
  if (!(slopeDbOct * 0.0 == 0.0)) slopeDbOct = 0.0;
  if (slopeDbOct > 12.0) slopeDbOct = 12.0;
  if (slopeDbOct < -24.0) slopeDbOct = -24.0;
  const int first = !st->ready || !(st->smoothHz > 0.0);
  if (first) {
    st->smoothHz = hz;
    st->smoothSlope = slopeDbOct;
    st->ready = 1;
  } else {
    const double a = 1.0 - dsp_exp(-1.0 / (kSmoothS * sr));
    const double lk = dsp_ln(st->smoothHz > 1.0e-12 ? st->smoothHz : 1.0e-12);
    const double lt = dsp_ln(hz);
    st->smoothHz = dsp_exp(lk + a * (lt - lk));
    st->smoothSlope += a * (slopeDbOct - st->smoothSlope);
  }
  double fLo;
  double fHi = 0.45 * sr;
  if (style == kStyleKnee) {
    fLo = st->smoothHz < 1.0 ? 1.0 : st->smoothHz;
  } else {
    fLo = 10.0;
  }
  if (fHi <= fLo * 1.02) fHi = fLo * 1.02;
  // |alpha|>1 breaks Oustaloup pole/zero placement, so peel off whole ±6 dB/oct
  // first-order shelves (real pole/zero, no ringing) and approximate the rest.
  const double kDbOct = 6.020599913279624;
  double slopeAbs = st->smoothSlope;
  double sign = 1.0;
  if (slopeAbs < 0.0) {
    sign = -1.0;
    slopeAbs = -slopeAbs;
  }
  int nInt = (int)dsp_floor(slopeAbs / kDbOct + 1.0e-9);
  if (nInt > kSections - 2) nInt = kSections - 2;
  if (nInt < 0) nInt = 0;
  const double rest = st->smoothSlope - sign * kDbOct * (double)nInt;
  int idx = 0;
  for (int i = 0; i < nInt; i += 1) {
    const double fz = sign < 0.0 ? fHi : fLo;
    const double fp = sign < 0.0 ? fLo : fHi;
    const double wz = tan_wp(fz, sr);
    const double wp = tan_wp(fp, sr);
    const double scale = wp / wz;
    const double a0 = 1.0 + wp;
    st->b0[idx] = scale * (1.0 + wz) / a0;
    st->b1[idx] = scale * (wz - 1.0) / a0;
    st->a1[idx] = (wp - 1.0) / a0;
    idx += 1;
  }
  const int nOust = kSections - idx;
  const double alpha = rest / kDbOct;
  const double lnRatio = dsp_ln(fHi / fLo);
  for (int k = 0; k < nOust; k += 1) {
    const double kz = ((double)k + 0.5 - 0.5 * alpha) / (double)nOust;
    const double kp = ((double)k + 0.5 + 0.5 * alpha) / (double)nOust;
    const double fz = fLo * dsp_exp(lnRatio * kz);
    const double fp = fLo * dsp_exp(lnRatio * kp);
    const double wz = tan_wp(fz, sr);
    const double wp = tan_wp(fp, sr);
    const double scale = wp / wz;
    const double a0 = 1.0 + wp;
    st->b0[idx] = scale * (1.0 + wz) / a0;
    st->b1[idx] = scale * (wz - 1.0) / a0;
    st->a1[idx] = (wp - 1.0) / a0;
    idx += 1;
  }
  if (style != kStyleKnee) {
    double pivot = st->smoothHz;
    if (pivot < fLo) pivot = fLo;
    if (pivot > 0.45 * sr) pivot = 0.45 * sr;
    const double mag = cascade_mag(st, pivot, sr);
    if (mag > 1.0e-12) {
      const double g = 1.0 / mag;
      st->b0[0] *= g;
      st->b1[0] *= g;
    }
  } else {
    // Knee style is documented as DC gain 1 (flat below the knee).
    const double dc = cascade_mag(st, 1.0, sr);
    if (dc > 1.0e-12) {
      const double g = 1.0 / dc;
      st->b0[0] *= g;
      st->b1[0] *= g;
    }
  }
  int mode = levelMode;
  if (mode < 0) mode = 0;
  if (mode > 3) mode = 3;
  double targetGain = 1.0;
  if (mode == kLevelCut || mode == kLevelMatched || mode == kLevelLoudness) {
    int period = (int)(kScanS * sr + 0.5);
    if (period < 1) period = 1;
    if (first || st->scanAge >= period) {
      double maxMag = 0.0;
      double pinkMs = 1.0;
      scan_spectrum(st, sr, &maxMag, &pinkMs, matchLoHz, matchHiHz);
      if (mode == kLevelCut) {
        if (maxMag > 1.0e-12) targetGain = 1.0 / maxMag;
      } else if (mode == kLevelLoudness) {
        targetGain = loudness_matched_gain(st, sr, matchLoHz, matchHiHz);
      } else if (pinkMs > 1.0e-12) {
        targetGain = 1.0 / dsp_exp(0.5 * dsp_ln(pinkMs));
      }
      if ((mode == kLevelMatched || mode == kLevelLoudness) && targetGain > kMaxMakeup) {
        targetGain = kMaxMakeup;
      }
      st->lastTargetGain = targetGain;
      st->scanAge = 0;
    } else {
      st->scanAge += 1;
      targetGain = st->lastTargetGain > 0.0 ? st->lastTargetGain : 1.0;
    }
  }
  if (first || !(st->smoothGain > 0.0)) {
    st->smoothGain = targetGain;
  } else {
    const double a = 1.0 - dsp_exp(-1.0 / (kSmoothS * sr));
    st->smoothGain += a * (targetGain - st->smoothGain);
  }
  if (st->smoothGain != 1.0) {
    st->b0[0] *= st->smoothGain;
    st->b1[0] *= st->smoothGain;
  }
}

static inline double process(const State* st, Channel* ch, double x) {
  if (!st || !ch) return x;
  double y = x;
  for (int k = 0; k < kSections; k += 1) {
    const double x0 = y;
    y = st->b0[k] * x0 + st->b1[k] * ch->x1[k] - st->a1[k] * ch->y1[k];
    if (!(y * 0.0 == 0.0)) y = 0.0;
    ch->x1[k] = x0;
    ch->y1[k] = y;
  }
  return y;
}

} // namespace spectral_tilt
} // namespace soemdsp_maths
