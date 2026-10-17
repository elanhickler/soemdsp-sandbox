// Softpop band-level helpers: Color tilt, level gains, and sin(w)/w Q decramp.
// Moved from native_modules/softpop_filter/softpop_filter.cpp (APP_POLICY §19,
// docs/SOFTPOP2_PLAN.md). Softpop Filter colors 0–4 stay byte-identical:
// scripts/test_softpop_filter_library_regression.mjs.
#pragma once

#include <soemdsp/constant/constant.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/math/scalar_helpers.h>

namespace soemdsp_maths {

enum {
  kSoftpopColorWhite = 0,
  kSoftpopColorGaussian = 1,
  kSoftpopColorAverage = 2,
  kSoftpopColorPink = 3,
  kSoftpopColorBrown = 4,
  kSoftpopColorBlue = 5,
  kSoftpopColorViolet = 6,
  kSoftpopColorCount = 7
};

static const double kSoftpopRefSampleRate = 48000.0;

// k_color: 1 kHz Filter RMS = 1/sqrt 2 (the Sine RMS) at 48 kHz, W = 0.3.
// White / Gaussian / Average / Pink / Brown copied verbatim from
// softpop_filter.cpp. Blue / Violet appended (calibrated the same way).
static const double kSoftpopFilterGain[kSoftpopColorCount] = {
  2.7684485757734305,
  2.7684485757734305,
  2.7684485757734305,
  1.721692744960082,
  7.51834,
  3.218,               // Blue: Crossfade 1 / W=1 at 1 kHz → sine RMS
  3.403                // Violet
};

// Tilt exponent alpha (T = (1000/fc)^(alpha/2)). Brown is measured.
// Blue +3 dB/oct → alpha 2; Violet +6 dB/oct → alpha 3 (theoretical).
static const double kSoftpopTiltAlpha[kSoftpopColorCount] = {
  1.0, 1.0, 1.0, 0.0, -0.95, 2.0, 3.0
};

static inline double softpop_sqrt_pos(double x) { return x > 0.0 ? __builtin_sqrt(x) : 0.0; }

// atan(t) for t >= 0: three half-angle reductions, then the odd series to
// t^15 (error < 1e-13). Only used on Width changes.
static inline double softpop_atan_pos(double t) {
  for (int i = 0; i < 3; i += 1) t = t / (1.0 + __builtin_sqrt(1.0 + t * t));
  const double t2 = t * t;
  double sum = 0.0;
  for (int k = 15; k >= 1; k -= 2) sum = sum * t2 + ((((k - 1) / 2) & 1) ? -1.0 : 1.0) / (double)k;
  return 8.0 * t * sum;
}

// Pink Width correction: constant-peak BP band power on a 1/f source is
// I(Q) = 2 x acos(x) / sqrt(1 - x^2) (x = 1/(2Q)), not the narrowband pi x.
static inline double softpop_pink_width_gain(double q) {
  double x = 0.5 / q;
  if (x > 1.0) x = 1.0;
  const double acosx = 2.0 * softpop_atan_pos(softpop_sqrt_pos((1.0 - x) / (1.0 + x)));
  if (acosx < 1.0e-9) return __builtin_sqrt(0.5 * kPI);
  return softpop_sqrt_pos(kPI * softpop_sqrt_pos(1.0 - x * x) / (2.0 * acosx));
}

static inline double softpop_width_gain(int color, double q) {
  if (color == kSoftpopColorPink) return softpop_pink_width_gain(q);
  if (color == kSoftpopColorBlue || color == kSoftpopColorViolet) {
    const double p = softpop_pink_width_gain(q);
    // Blue / Violet put more energy at HF than the narrowband 1/Q law;
    // raise the pink wide-Q factor (α = −1) toward α = +1 / +2.
    if (color == kSoftpopColorBlue) return p * p;
    return p * p * p * p;
  }
  return 1.0;
}

// sin(w)/w Q decramp: digital -3 dB width w/Q, the analog fc/Q in Hz.
static inline double softpop_q_decramp(double q, double omega) {
  return omega > 1.0e-9 ? q * dsp_sin(omega) / omega : q;
}

struct SoftpopTilt {
  double warpRef;  // sin(w1k) / w1k
  double tiltSr;   // sr / 48 kHz
};

static inline void softpop_tilt_prepare(SoftpopTilt& t, double sr) {
  const double w1k = kTwoPi * 1000.0 / sr;
  t.warpRef = dsp_sin(w1k) / w1k;
  t.tiltSr = sr / kSoftpopRefSampleRate;
}

// T_color(fc) times the bilinear-warp term, normalised at 1 kHz.
static inline double softpop_tilt_warp(const SoftpopTilt& t, double fc, int color, double sr) {
  const double lo = 20.0;
  const double hi = 0.45 * sr;
  const double f = fc < lo ? lo : (fc > hi ? hi : fc);
  const double warp = softpop_sqrt_pos(t.warpRef);
  const double alpha = (color >= 0 && color < kSoftpopColorCount) ? kSoftpopTiltAlpha[color] : 1.0;
  if (alpha == 0.0) return warp;
  return warp * dsp_exp(0.5 * alpha * dsp_ln((1000.0 / f) * t.tiltSr));
}

static inline double softpop_filter_gain(int color) {
  if (color < 0) color = 0;
  if (color >= kSoftpopColorCount) color = kSoftpopColorCount - 1;
  return kSoftpopFilterGain[color];
}

}  // namespace soemdsp_maths
