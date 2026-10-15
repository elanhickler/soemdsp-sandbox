// Mean-square detector + hard-knee gain computer shared by Pump Limiter and
// Sidechain. Freestanding (no libm). Callers sanitise their own parameters
// (defaults / floors differ per module); these helpers are the shared maths.
//
//   coeff   attack: attMs <= 0 -> 1 (snap), else 1 - exp(-1 / max(1, ms*sr/1000))
//           release: 1 - exp(-1 / max(1, ms*sr/1000))
//   detect  power = peak^2; meanSquare chases it with attack coeff when rising,
//           release coeff when falling; < 1e-30 snaps to 0. Level = sqrt(ms).
//   gain    level > thresh ? (thresh/level)^((ratio-1)/ratio) : 1, in [0, 1];
//           non-finite -> 0.
#pragma once

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/exp_log.h>

namespace soemdsp_maths {

/** Attack one-pole coefficient from ms (attMs <= 0 snaps: returns 1). */
static inline double ms_detector_attack_coeff(double attMs, double sampleRate) {
  return attMs <= 0.0 ? 1.0 : 1.0 - dsp_exp(-1.0 / maxd(1.0, attMs * 0.001 * sampleRate));
}

/** Release one-pole coefficient from ms. */
static inline double ms_detector_release_coeff(double relMs, double sampleRate) {
  return 1.0 - dsp_exp(-1.0 / maxd(1.0, relMs * 0.001 * sampleRate));
}

/**
 * One mean-square detector step. Updates meanSquare in place and returns the
 * RMS level sqrt(meanSquare).
 */
static inline double ms_detector_step(double& meanSquare, double peak, double attCoeff, double relCoeff) {
  const double instantPower = peak * peak;
  if (instantPower > meanSquare) {
    meanSquare += attCoeff * (instantPower - meanSquare);
  } else {
    meanSquare += relCoeff * (instantPower - meanSquare);
  }
  if (meanSquare < 1e-30) meanSquare = 0.0;
  return meanSquare > 0.0 ? dsp_exp(0.5 * dsp_ln(meanSquare)) : 0.0;
}

/** Hard-knee target gain in [0, 1] for a level against a linear threshold. */
static inline double hard_knee_target_gain(double level, double thresh, double ratio) {
  double targetGain = 1.0;
  if (level > thresh) {
    const double grExp = (ratio - 1.0) / ratio;
    const double ratioLin = thresh / level;
    targetGain = ratioLin > 0.0 ? dsp_exp(grExp * dsp_ln(ratioLin)) : 0.0;
  }
  if (!(targetGain * 0.0 == 0.0) || targetGain < 0.0) targetGain = 0.0;
  if (targetGain > 1.0) targetGain = 1.0;
  return targetGain;
}

} // namespace soemdsp_maths
