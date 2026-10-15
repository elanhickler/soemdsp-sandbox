// Sandbox Native Module Maths -- segment interpolators between sampled points.
// Freestanding (no libm). Nested soemdsp::math; soemdsp_maths mirror.
//
// All take t in [0, 1] across the segment y1 -> y2 (y0 = point before y1,
// y3 = point after y2). Linear interpolation is lerp() in scalar_helpers.h.
//   interp_cosine       S-curve y1 -> y2 (zero slope at both ends)
//   interp_smoothstep   polynomial S-curve y1 -> y2, weight 3t^2 - 2t^3
//   interp_catmull_rom  cubic Hermite through y1 and y2 (Catmull-Rom tangents)
//   interp_bspline3     uniform cubic B-spline (C2, does not pass through y1/y2)
//   interp_bspline5     uniform quintic B-spline over 6 points (C4, no overshoot)
//   interp_gaussian     Gaussian kernel (sigma 1.5 points) over 16 points
#pragma once

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>

namespace soemdsp::math {

// Cosine interpolation: lerp with t' = (1 - cos(pi t)) / 2. t clamped to [0,1].
static inline double interp_cosine(double y1, double y2, double t) {
  const double x = clamp01(t);
  const double w = 0.5 - 0.5 * soemdsp_maths::dsp_cos_0_pi(x * soemdsp_maths::kPi);
  return y1 + w * (y2 - y1);
}

// Smoothstep interpolation: lerp with t' = t^2 (3 - 2t). t clamped to [0,1].
// Same end slopes as interp_cosine (zero), slightly steeper middle, no trig.
static inline double interp_smoothstep(double y1, double y2, double t) {
  const double x = clamp01(t);
  const double w = x * x * (3.0 - 2.0 * x);
  return y1 + w * (y2 - y1);
}

// Catmull-Rom cubic Hermite: passes through y1 (t=0) and y2 (t=1); slope at
// each point = half the difference of its neighbours. C1 continuous.
static inline double interp_catmull_rom(double y0, double y1, double y2, double y3, double t) {
  const double a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const double b = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const double c = 0.5 * (y2 - y0);
  return ((a * t + b) * t + c) * t + y1;
}

// Uniform cubic B-spline segment: C2 continuous, approximating (at t=0 it is
// (y0 + 4 y1 + y2) / 6, not y1). Always inside the min/max of y0..y3.
static inline double interp_bspline3(double y0, double y1, double y2, double y3, double t) {
  const double t2 = t * t;
  const double t3 = t2 * t;
  const double u = 1.0 - t;
  return (u * u * u * y0
    + (3.0 * t3 - 6.0 * t2 + 4.0) * y1
    + (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) * y2
    + t3 * y3) * (1.0 / 6.0);
}

// Uniform quintic B-spline segment over y0..y5 with t across y2 -> y3. C4
// continuous, approximating (at t=0 it is (y0 + 26 y1 + 66 y2 + 26 y3 + y4)
// / 120). Weights are all >= 0 and sum to 1, so the result never leaves the
// min/max of y0..y5 (no overshoot).
static inline double interp_bspline5(
  double y0, double y1, double y2, double y3, double y4, double y5, double t
) {
  const double t2 = t * t;
  const double t3 = t2 * t;
  const double t4 = t3 * t;
  const double t5 = t4 * t;
  const double u = 1.0 - t;
  const double u2 = u * u;
  return (u2 * u2 * u * y0
    + (26.0 - 50.0 * t + 20.0 * t2 + 20.0 * t3 - 20.0 * t4 + 5.0 * t5) * y1
    + (66.0 - 60.0 * t2 + 30.0 * t4 - 10.0 * t5) * y2
    + (26.0 + 50.0 * t + 20.0 * t2 - 20.0 * t3 - 20.0 * t4 + 10.0 * t5) * y3
    + (1.0 + 5.0 * t + 10.0 * t2 + 10.0 * t3 + 5.0 * t4 - 5.0 * t5) * y4
    + t5 * y5) * (1.0 / 120.0);
}

// Gaussian kernel interpolation. y points to 16 samples at offsets -7..+8
// from the segment start: y[7] is at t=0, y[8] at t=1. Weight of y[j] is
// exp(-(j - 7 - t)^2 / (2 sigma^2)), sigma = 1.5 points, normalised to sum 1
// (DC exact, no overshoot). Weights are precomputed for kGaussianPhases + 1
// phases across t and linearly blended between neighbouring phases; each
// phase row sums to 1, so the blend does too.
static const int kGaussianTaps = 16;
static const int kGaussianPhases = 256;
static const double kGaussianSigma = 1.5;

struct GaussianKernelTable {
  bool ready;
  double w[kGaussianPhases + 1][kGaussianTaps];
};

static inline GaussianKernelTable& gaussian_kernel_table() {
  static GaussianKernelTable table;  // zero-initialised, filled on first use
  if (!table.ready) {
    const double k = -1.0 / (2.0 * kGaussianSigma * kGaussianSigma);
    for (int p = 0; p <= kGaussianPhases; p += 1) {
      const double ph = (double)p / (double)kGaussianPhases;
      double sum = 0.0;
      for (int j = 0; j < kGaussianTaps; j += 1) {
        const double d = (double)(j - 7) - ph;
        table.w[p][j] = soemdsp_maths::dsp_exp(k * d * d);
        sum += table.w[p][j];
      }
      for (int j = 0; j < kGaussianTaps; j += 1) table.w[p][j] /= sum;
    }
    table.ready = true;
  }
  return table;
}

static inline double interp_gaussian(const double* y, double t) {
  const GaussianKernelTable& tab = gaussian_kernel_table();
  const double x = clamp01(t) * (double)kGaussianPhases;
  int p = (int)x;
  if (p >= kGaussianPhases) p = kGaussianPhases - 1;
  const double f = x - (double)p;
  const double* a = tab.w[p];
  const double* b = tab.w[p + 1];
  double sa = 0.0;
  double sb = 0.0;
  for (int j = 0; j < kGaussianTaps; j += 1) {
    sa += a[j] * y[j];
    sb += b[j] * y[j];
  }
  return sa + f * (sb - sa);
}

}  // namespace soemdsp::math

namespace soemdsp_maths {
using soemdsp::math::interp_cosine;
using soemdsp::math::interp_smoothstep;
using soemdsp::math::interp_catmull_rom;
using soemdsp::math::interp_bspline3;
using soemdsp::math::interp_bspline5;
using soemdsp::math::interp_gaussian;
}  // namespace soemdsp_maths
