// Step Graph segment curves — source of truth for progress-in-[0,1]
// plus skew/contour in [-1,+1]. Other modules can call these later so
// bend direction and -1..+1 response stay consistent.
//
// Neutral (0) is identity for rational / exponential / log,
// the standard S-curve for smoothstep / smootherstep, and a late jump
// for hold. Positive skew raises the mid-segment weight. Callers blend
// y = y0 + (y1 - y0) * w so rising and falling segments share the same
// visual bend and a handle drag follows the pointer.
#pragma once

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/exp_log.h>

namespace soemdsp::math {

enum segment_shape : int {
  kSegmentLinear = 0,
  kSegmentRational = 1,
  kSegmentExponential = 2,
  kSegmentLog = 3,
  kSegmentSmoothstep = 4,
  kSegmentSmootherstep = 5,
  kSegmentHold = 6,
};

// Legacy kSegmentLinear (0) normalizes to Rational. IDs 1..6 stay stable.
static inline int segment_shape_normalize(double shapeV) {
  const double v = soemdsp::debug::safe(shapeV);
  int s = (int)(v + (v >= 0.0 ? 0.5 : -0.5));
  if (s < 0) s = 0;
  if (s > kSegmentHold) s = kSegmentHold;
  if (s == kSegmentLinear) return kSegmentRational;
  return s;
}

// offset in -1..+1 = -100%..+100% of remaining room toward that limit.
// 0 leaves c unchanged; +1 maps every c to +1; -1 maps every c to -1.
static inline double segment_apply_skew_percent(double contour, double offset) {
  const double c = clamp11(soemdsp::debug::safe(contour));
  const double o = clamp11(soemdsp::debug::safe(offset));
  if (o >= 0.0) return clamp11(c + o * (1.0 - c));
  return clamp11(c + o * (c + 1.0));
}

static inline double segment_contour_soft_cap(double contour) {
  const double c = clamp11(soemdsp::debug::safe(contour));
  const double softMax = 1.0 - soemdsp::constant::kPlanck;
  if (c > softMax) return softMax;
  if (c < -softMax) return -softMax;
  return c;
}

static inline double segment_rational01(double p, double contour) {
  p = clamp01(p);
  if (p <= 0.0) return 0.0;
  if (p >= 1.0) return 1.0;
  const double c = clamp11(soemdsp::debug::safe(contour));
  if (soemdsp_maths::dsp_fabs(c) < soemdsp::constant::kPlanck) return p;
  return c < 0.0
    ? (p * (1.0 + c)) / (1.0 + c * p)
    : p / (1.0 - c + c * p);
}

static inline double segment_exponential01(double p, double contour) {
  p = clamp01(p);
  const double t = segment_contour_soft_cap(contour);
  const double planck = soemdsp::constant::kPlanck;
  if (soemdsp_maths::dsp_fabs(t) < planck) return p;
  const double a = soemdsp_maths::dsp_fabs(t);
  const double mag = 1.2 + 6.8 * (a / (1.0 - a * 0.85));
  // +contour raises f(0.5), matching Rational / Log (old kernel had the opposite k sign).
  const double k = t < 0.0 ? mag : -mag;
  if (soemdsp_maths::dsp_fabs(k) < 0.05) return p;
  const double denom = soemdsp_maths::dsp_exp(k) - 1.0;
  if (soemdsp_maths::dsp_fabs(denom) < planck) return p;
  return (soemdsp_maths::dsp_exp(k * p) - 1.0) / denom;
}

static inline double segment_logarithmic01(double p, double contour) {
  p = clamp01(p);
  const double t = segment_contour_soft_cap(contour);
  const double planck = soemdsp::constant::kPlanck;
  if (soemdsp_maths::dsp_fabs(t) < planck) return p;
  const double a = soemdsp_maths::dsp_fabs(t);
  const double b = soemdsp_maths::dsp_exp(1.2 + 5.5 * (a / (1.0 - a * 0.85)));
  if (!(b * 0.0 == 0.0) || b <= 1.0 + planck) return p;
  const double denom = soemdsp_maths::dsp_ln(b);
  if (!(denom * 0.0 == 0.0) || soemdsp_maths::dsp_fabs(denom) < planck) return p;
  return t < 0.0
    ? 1.0 - soemdsp_maths::dsp_ln(1.0 + (1.0 - p) * (b - 1.0)) / denom
    : soemdsp_maths::dsp_ln(1.0 + p * (b - 1.0)) / denom;
}

static inline double segment_smoothstep_raw01(double p) {
  p = clamp01(p);
  return p * p * (3.0 - 2.0 * p);
}

static inline double segment_smootherstep_raw01(double p) {
  p = clamp01(p);
  return p * p * p * (p * (p * 6.0 - 15.0) + 10.0);
}

static inline double segment_smoothstep01(double p, double contour) {
  return segment_smoothstep_raw01(segment_rational01(p, contour));
}

static inline double segment_smootherstep01(double p, double contour) {
  return segment_smootherstep_raw01(segment_rational01(p, contour));
}

static inline double segment_hold01(double p, double contour) {
  p = clamp01(p);
  const double c = clamp11(soemdsp::debug::safe(contour));
  return c < 0.0 ? (p > 0.0 ? 1.0 : 0.0) : (p >= 1.0 ? 1.0 : 0.0);
}

static inline double segment_curve01(double p, int shape, double contour) {
  switch (shape) {
    case kSegmentLinear: return segment_rational01(p, contour);
    case kSegmentExponential: return segment_exponential01(p, contour);
    case kSegmentLog: return segment_logarithmic01(p, contour);
    case kSegmentSmoothstep: return segment_smoothstep01(p, contour);
    case kSegmentSmootherstep: return segment_smootherstep01(p, contour);
    case kSegmentHold: return segment_hold01(p, contour);
    case kSegmentRational:
    default: return segment_rational01(p, contour);
  }
}

}  // namespace soemdsp::math

namespace soemdsp_maths {
using soemdsp::math::kSegmentLinear;
using soemdsp::math::kSegmentRational;
using soemdsp::math::kSegmentExponential;
using soemdsp::math::kSegmentLog;
using soemdsp::math::kSegmentSmoothstep;
using soemdsp::math::kSegmentSmootherstep;
using soemdsp::math::kSegmentHold;
using soemdsp::math::segment_shape_normalize;
using soemdsp::math::segment_apply_skew_percent;
using soemdsp::math::segment_contour_soft_cap;
using soemdsp::math::segment_rational01;
using soemdsp::math::segment_exponential01;
using soemdsp::math::segment_logarithmic01;
using soemdsp::math::segment_smoothstep01;
using soemdsp::math::segment_smootherstep01;
using soemdsp::math::segment_hold01;
using soemdsp::math::segment_curve01;
}  // namespace soemdsp_maths
