// Stilson & Smith BLIT saw (one band-limited impulse train, leaky-integrated),
// shared by BLIT Oscillator and Formant Filter. Moved verbatim from
// native_modules/blit/blit.cpp v6 (see its header for the algorithm notes);
// BLIT Oscillator output is byte-identical to before the move.
#pragma once

#include <soemdsp/math/scalar_helpers.h>

namespace soemdsp_blit {

using soemdsp_maths::wrap_radians;
using soemdsp_maths::kPi;
using soemdsp_maths::kTwoPi;
using soemdsp_maths::kHalfPi;

constexpr double kBlitLeakDivisor = 20.0;  // integrator DC blocker at f / 20

// Taylor series through x^17, Horner-evaluated (~2e-8 worst-case error).
static inline double sinApprox(double value) {
  const double x = wrap_radians(value);
  const double x2 = x * x;
  double acc = 1.0 / 355687428096000.0;       // 1/17!
  acc = -1.0 / 1307674368000.0 + x2 * acc;    // -1/15!
  acc = 1.0 / 6227020800.0 + x2 * acc;        // 1/13!
  acc = -1.0 / 39916800.0 + x2 * acc;         // -1/11!
  acc = 1.0 / 362880.0 + x2 * acc;            // 1/9!
  acc = -1.0 / 5040.0 + x2 * acc;             // -1/7!
  acc = 1.0 / 120.0 + x2 * acc;               // 1/5!
  acc = -1.0 / 6.0 + x2 * acc;                // -1/3!
  return x * (1.0 + x2 * acc);
}

static inline double cosApprox(double value) { return sinApprox(value + kHalfPi); }

// One Stilson/Smith BLIT-saw oscillator: integer odd harmonic count m,
// closed-form impulse train, DC removed by its known average (1/p), leaky-
// integrated with a fixed fast leak. Runs its own phase 0..pi (this
// algorithm's native convention, half the usual 0..2pi audio phase) so a
// second instance can be offset by half a cycle for Square.
// Kernel with M harmonics: sin((2M+1)x) / (p sin x), x in [0, pi).
static inline double blitKernel(double phase, double denom, double harmonics, double p) {
  const double m = 2.0 * harmonics + 1.0;
  if (denom > -1.0e-9 && denom < 1.0e-9) return m / p;  // limit at phase 0
  return sinApprox(m * phase) / (p * denom);
}

struct BlitSaw {
  double phase;
  double phaseOffset;  // in this oscillator's own pi-periodic units
  double state;

  void init(double phaseOffsetCycles) {
    phaseOffset = phaseOffsetCycles * kPi;
    phase = phaseOffset;
    state = 0.0;
  }

  // periodSamples = 1/|dt|; direction +1 forward, −1 through-zero reverse.
  double update(double periodSamples, double direction = 1.0) {
    const double p = periodSamples > 1.0e-6 ? periodSamples : 1.0e-6;
    // Continuous harmonic count, top partial one harmonic below Nyquist.
    double harmonics = 0.5 * p - 1.0;
    if (harmonics < 1.0) harmonics = 1.0;
    const double lo = __builtin_floor(harmonics);
    const double frac = harmonics - lo;
    const double c2 = 1.0 / p;

    const double denom = sinApprox(phase);
    double tmp = blitKernel(phase, denom, lo, p);
    if (frac > 0.0) tmp += (blitKernel(phase, denom, lo + 1.0, p) - tmp) * frac;
    tmp += state - c2;
    // DC blocker at f/20: the same leak per period at every pitch.
    const double leak = 1.0 - (kTwoPi / kBlitLeakDivisor) / p;
    state = tmp * (leak > 0.0 ? leak : 0.0);

    const double dir = direction < 0.0 ? -1.0 : 1.0;
    phase += dir * (kPi / p);
    phase = wrap_radians(phase, kPi);

    return tmp;
  }
};

}  // namespace soemdsp_blit
