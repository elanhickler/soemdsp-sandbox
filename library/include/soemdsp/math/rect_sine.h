// Rect Sine: the single source of truth for the bipolar "rectified sine" shape.
//
//   rect_sine(t) = 2*|sin(pi*t)| - 4/pi        (t in turns, one hump per turn)
//
// The |sin| hump (full-wave rectified sine) with its DC removed: zero-mean, so
// bipolar in signal. -4/pi = -0.2732 at the cusp (t = 0, 1), 2 - 4/pi = +0.7268
// at the top (t = 0.5), continuous, one slope corner (the cusp) per turn. It is
// the shape, not a literal rectifier. Antialiased callers add their own
// PolyBLAMP at the cusp (math/poly_blep.h: kTwoPi * dt * poly_blamp(t, dt)).
//
// Users: Pulse Train Shape "Rect Sine" (one hump per grain), Hypersaw2 RectSin
// and Sine Warp (both shift phase by +0.25 turn, then call rect_sine_hump01).
// rect_sine_hump01(t) is the fast path for t already in [0, 1) (sin(pi*t) >= 0
// there, so no abs) and is bit-identical to the old inline copies
// `2.0 * dsp_sin(kPi * t1) - k4zPI`.
#pragma once

#include <soemdsp/constant/constant.h>
#include <soemdsp/math/analog_filter_trig.h>

namespace soemdsp_maths {

// t in [0, 1): one zero-mean hump, cusp at 0.
static inline double rect_sine_hump01(double t) {
  return 2.0 * dsp_sin(kPi * t) - k4zPI;
}

// Any t (turns): wrapped to [0, 1) first.
static inline double rect_sine(double t) {
  return rect_sine_hump01(t - dsp_floor(t));
}

}  // namespace soemdsp_maths