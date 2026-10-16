// Sandbox Native Module Maths -- shared two-point glide curves.
// Freestanding (no libm). Nested soemdsp::math; soemdsp_maths mirror.
//
// Each maps progress t in [0, 1] (clamped) to a blend weight w in [0, 1];
// the caller blends lerp(from, to, w). Used by Sample & Hold (Interpolate)
// and Pi Noise (Smoothing) so both modules share one implementation.
//   curve_linear01       w = t
//   curve_cosine01       w = (1 - cos(pi t)) / 2       zero slope at both ends
//   curve_smoothstep01   w = 3t^2 - 2t^3                zero slope at both ends
//   curve_quad_in01      w = t^2                        starts slow
//   curve_quad_out01     w = 1 - (1 - t)^2              ends slow
// (Hold = no blend, w = 0 inside the step; handled by each caller.)
#pragma once

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/analog_filter_trig.h>

namespace soemdsp::math {

static inline double curve_linear01(double t) {
  return clamp01(t);
}

static inline double curve_cosine01(double t) {
  const double x = clamp01(t);
  return 0.5 - 0.5 * soemdsp_maths::dsp_cos_0_pi(x * soemdsp_maths::kPi);
}

static inline double curve_smoothstep01(double t) {
  const double x = clamp01(t);
  return x * x * (3.0 - 2.0 * x);
}

static inline double curve_quad_in01(double t) {
  const double x = clamp01(t);
  return x * x;
}

static inline double curve_quad_out01(double t) {
  const double x = clamp01(t);
  const double u = 1.0 - x;
  return 1.0 - u * u;
}

}  // namespace soemdsp::math

namespace soemdsp_maths {
using soemdsp::math::curve_linear01;
using soemdsp::math::curve_cosine01;
using soemdsp::math::curve_smoothstep01;
using soemdsp::math::curve_quad_in01;
using soemdsp::math::curve_quad_out01;
}  // namespace soemdsp_maths