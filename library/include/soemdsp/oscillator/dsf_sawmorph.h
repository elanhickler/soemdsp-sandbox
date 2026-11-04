// Shared band-limited DSF saw-to-sine waveform.
//
// Morph 0 is the fundamental sine; morph 1 is a Nyquist-limited saw. The
// kernel is the same harmonic DSF law used by DSF Oscillator. A caller owns
// one accumulator per voice; coefficients are deliberately stack-local so a
// large pooled voice bank does not inflate the fixed combined-WASM memory.
#pragma once

#include <soemdsp/soemdsp.hpp>

namespace soemdsp::oscillator {

using namespace soemdsp_maths;

struct DsfSawmorphCoeffs {
  double morph = -1.0;
  double partials = -1.0;
  double k42 = 0.0;
  double eightK2 = 0.0;
  double decay = 0.0;
  double twoK2 = 0.0;
  double denCos = 0.0;
  double ampAdjust = 1.0;
};

inline double dsf_sawmorph_pow(double base, double exponent) {
  return base > 0.0 ? dsp_exp(exponent * dsp_ln(base)) : 0.0;
}

inline void dsf_sawmorph_prepare(DsfSawmorphCoeffs& c, double morph, double partials) {
  if (c.morph == morph && c.partials == partials) return;
  const double m = clamp(morph, 0.0, 1.0);
  const double k = (1.0 - dsf_sawmorph_pow(m, 0.14)) * 4.0;
  const double k2 = k * k;
  c.morph = morph;
  c.partials = partials;
  c.k42 = dsp_exp2(2.0 * k2);
  c.eightK2 = dsp_exp2(3.0 * k2);
  c.decay = dsp_exp2(-k2 * (partials + 1.0));
  c.twoK2 = dsp_exp2(k2);
  c.denCos = dsp_exp2(1.0 + k2);
  c.ampAdjust = m * (2.7 - 3.15) + 3.15;
}

// Stable O(1) Re(Σ a^k e^{i(k+1)x}): den = (1-a)^2 + 4a sin^2(x/2);
// a≈1 → Dirichlet sin(N x/2)/sin(x/2). Same math as dsf_oscillator (no O(N)).
inline double dsf_sawmorph_kernel(double turns, const DsfSawmorphCoeffs& c) {
  const double a = c.twoK2 > 0.0 ? 1.0 / c.twoK2 : 1.0;
  double n = c.partials;
  if (n < 0.0) n = 0.0;
  if (n < 1.0e-12) return 0.0;

  double sinx = 0.0, cosx = 0.0;
  dsp_sin_cos_turns(turns, &sinx, &cosx);
  double sinHalf = 0.0, cosHalf = 0.0;
  dsp_sin_cos_turns(0.5 * turns, &sinHalf, &cosHalf);
  const double den2 = (1.0 - a) * (1.0 - a) + 4.0 * a * sinHalf * sinHalf;
  if (den2 < 1.0e-30) return n;

  if (a > 1.0 - 1.0e-12) {
    if (sinHalf > -1.0e-15 && sinHalf < 1.0e-15) return n;
    double sn = 0.0, cn = 0.0;
    dsp_sin_cos_turns(0.5 * n * turns, &sn, &cn);
    double sa = 0.0, ca = 0.0;
    dsp_sin_cos_turns(0.5 * (n + 1.0) * turns, &sa, &ca);
    return (sn / sinHalf) * ca;
  }

  const double zr = a * cosx;
  const double zi = a * sinx;
  const double rn = dsf_sawmorph_pow(a, n);
  double pr = 0.0, pi = 0.0;
  dsp_sin_cos_turns(n * turns, &pi, &pr);
  const double zn_r = rn * pr;
  const double zn_i = rn * pi;
  const double num_r = 1.0 - zn_r;
  const double num_i = -zn_i;
  const double den_r = 1.0 - zr;
  const double den_i = -zi;
  const double inv = 1.0 / den2;
  const double qr = (num_r * den_r + num_i * den_i) * inv;
  const double qi = (num_i * den_r - num_r * den_i) * inv;
  return cosx * qr - sinx * qi;
}

inline double dsf_sawmorph_sample(
  double& accumulator,
  double turns,
  double phaseStep,
  double frequencyHz,
  double sampleRate,
  double morph,
  double partials = 20000.0
) {
  const double sr = sampleRate > 1.0 ? sampleRate : 48000.0;
  const double absHz = frequencyHz < 0.0 ? -frequencyHz : frequencyHz;
  const double safeHz = absHz > 1.0e-6 ? absHz : 1.0e-6;
  // Soft ceiling only (same as dsf_oscillator): audible Nyquist tracking intact
  // through ~0.023 Hz at 48 kHz. Not a brightness limiter.
  constexpr double kMaxPartials = 1048576.0;
  double exactPartials = (sr * 0.5) / safeHz - 1.0;
  if (exactPartials < 1.0) exactPartials = 1.0;
  if (exactPartials > kMaxPartials) exactPartials = kMaxPartials;
  {
    double cap = partials < 1.0 ? 1.0 : partials;
    if (cap > kMaxPartials) cap = kMaxPartials;
    if (exactPartials > cap) exactPartials = cap;
  }
  double loPartials = dsp_floor(exactPartials);
  if (loPartials < 1.0) loPartials = 1.0;
  const double hiPartials = loPartials < kMaxPartials ? loPartials + 1.0 : loPartials;
  const double fraction = hiPartials > loPartials ? exactPartials - loPartials : 0.0;

  DsfSawmorphCoeffs lo;
  DsfSawmorphCoeffs hi;
  dsf_sawmorph_prepare(lo, morph, loPartials);
  if (fraction > 0.0) dsf_sawmorph_prepare(hi, morph, hiPartials);
  const double rawLo = dsf_sawmorph_kernel(wrap01(turns), lo);
  const double raw = fraction > 0.0
    ? rawLo + (dsf_sawmorph_kernel(wrap01(turns), hi) - rawLo) * fraction
    : rawLo;

  const double leak = maxd(0.0005, kTwoPi * safeHz / (20.0 * sr));
  accumulator = accumulator * (1.0 - leak) + raw * phaseStep;
  double out = accumulator * lo.ampAdjust;
  if (!(out == out) || out < -1.0e6 || out > 1.0e6) {
    accumulator = 0.0;
    out = 0.0;
  }
  return out;
}

}  // namespace soemdsp::oscillator
