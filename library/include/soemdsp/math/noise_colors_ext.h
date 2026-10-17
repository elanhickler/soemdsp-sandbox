// Blue (+3 dB/oct) and Violet (+6 dB/oct) on top of noise_colors.h.
// Kept out of noise_colors.h so EQ Filter's TU (which includes soemdsp.hpp)
// stays bit-identical: scripts/test_tpt_svf_noise_colors_regression.mjs.
#pragma once

#include <soemdsp/math/noise_colors.h>

namespace soemdsp_maths {

struct NoiseColorExt {
  double prevWhite;
  double prevPink;
};

static inline void noise_color_ext_reset(NoiseColorExt& ext) {
  ext.prevWhite = 0.0;
  ext.prevPink = 0.0;
}

// mode 5 Blue: first difference of Kellet pink. mode 6 Violet: first
// difference of white. Other modes ignore ext (Pink still writes pink taps).
static inline double noise_color_sample_ext(NoiseColorChannel& chan, NoiseColorExt& ext, int mode, double mean, double deviation, double shape) {
  if (mode == 5) {
    const double pink = noise_color_sample(chan, 3, 0.0, 1.0, 0.0);
    const double blue = pink - ext.prevPink;
    ext.prevPink = pink;
    return mean + blue * deviation;
  }
  if (mode == 6) {
    const double white = noise_color_bipolar(chan);
    const double violet = white - ext.prevWhite;
    ext.prevWhite = white;
    return mean + violet * deviation;
  }
  return noise_color_sample(chan, mode, mean, deviation, shape);
}

}  // namespace soemdsp_maths
