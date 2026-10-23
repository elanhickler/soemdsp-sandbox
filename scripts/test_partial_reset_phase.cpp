// Native probe for scripts/test_partial_reset_phase.mjs: exports the shared
// oscillator Reset-trigger helpers from soemdsp/trigger/trigger.h to wasm.
#include <soemdsp/trigger/trigger.h>

extern "C" double prp(double phase, double target, double h, double period) {
  return soemdsp::math::partial_reset_phase(phase, target, h, period);
}

// gate_hit from prev -> now; returns the signed trigger height (NaN if no hit).
extern "C" double hit_height(double prev, double now) {
  if (!soemdsp::math::gate_hit(now, &prev)) return __builtin_nan("");
  return soemdsp::math::gate_hit_height(now);
}
