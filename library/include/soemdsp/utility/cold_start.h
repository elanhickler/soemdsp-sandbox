// Opt-in cold start: 0.05 s silence, then 0.05 s linear ramp 0→1.
// Not part of soemdsp.hpp. A module opts in by including this header and
// calling arm/apply. Only vcvrack_superlove_filter does that today.
#pragma once

namespace soemdsp::utility {

static const double kColdStartMuteSeconds = 0.05;
static const double kColdStartRampSeconds = 0.05;

struct ColdStart {
  int active;
  int index;
};

static inline void cold_start_arm(ColdStart* c) {
  if (!c) return;
  c->active = 1;
  c->index = 0;
}

// 0 during mute, 0…1 during ramp, 1 after. Advances one sample.
static inline double cold_start_apply(ColdStart* c, double sampleRate) {
  if (!c || !c->active) return 1.0;
  const double sr = sampleRate > 1.0 ? sampleRate : 48000.0;
  int muteN = (int)(kColdStartMuteSeconds * sr + 0.5);
  int rampN = (int)(kColdStartRampSeconds * sr + 0.5);
  if (muteN < 1) muteN = 1;
  if (rampN < 1) rampN = 1;
  const int i = c->index;
  c->index = i + 1;
  if (i < muteN) return 0.0;
  if (i < muteN + rampN) {
    return (double)(i - muteN) / (double)rampN;
  }
  c->active = 0;
  return 1.0;
}

}  // namespace soemdsp::utility

namespace soemdsp_maths {
using soemdsp::utility::ColdStart;
using soemdsp::utility::cold_start_arm;
using soemdsp::utility::cold_start_apply;
using soemdsp::utility::kColdStartMuteSeconds;
using soemdsp::utility::kColdStartRampSeconds;
}  // namespace soemdsp_maths
