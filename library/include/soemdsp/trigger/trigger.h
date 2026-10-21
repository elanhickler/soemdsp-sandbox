// Sandbox Native Module Maths -- edge detectors for clocks / S&H / sequencers.
// Nested soemdsp::math; soemdsp_maths mirror.
#pragma once

#include <soemdsp/math/scalar_helpers.h>

namespace soemdsp::math {

// Rising edge: was <= threshold, now > threshold. Updates *prev to `now`.
static inline bool rising_edge(double now, double* prev, double threshold = 0.0) {
  if (!prev) return false;
  const double x = soemdsp::debug::safe(now);
  const double p = soemdsp::debug::safe(*prev);
  const bool edge = (p <= threshold && x > threshold);
  *prev = x;
  return edge;
}

// Falling edge: was > threshold, now <= threshold.
static inline bool falling_edge(double now, double* prev, double threshold = 0.0) {
  if (!prev) return false;
  const double x = soemdsp::debug::safe(now);
  const double p = soemdsp::debug::safe(*prev);
  const bool edge = (p > threshold && x <= threshold);
  *prev = x;
  return edge;
}

// Any crossing of threshold (up or down).
static inline bool change_edge(double now, double* prev, double threshold = 0.0) {
  if (!prev) return false;
  const double x = soemdsp::debug::safe(now);
  const double p = soemdsp::debug::safe(*prev);
  const bool was = p > threshold;
  const bool is = x > threshold;
  *prev = x;
  return was != is;
}

// Bool rising edge: was false, now true. Updates *wasHigh to `high`.
static inline bool rising_edge_bool(bool high, bool* wasHigh) {
  if (!wasHigh) return false;
  const bool edge = high && !*wasHigh;
  *wasHigh = high;
  return edge;
}

// EXPERIMENT (revert the EXPERIMENT commit to restore the original law:
// hit = first sample > 0 after <= 0, height = now).
// App-wide Gate/Trigger, "every absolute positive change":
// hit on any sample where |x[n]| > |x[n-1]|; velocity = |x[n]| - |x[n-1]|
// (read with gate_hit_velocity() right after gate_hit). Examples:
// 0.1 -> 0.2 hits with 0.1; -0.1 -> 0 no hit; -0.1 -> -0.2 hits with 0.1.
// on (held / step parts) stays x > 0. Updates *prev.
static inline bool gate_on(double x) {
  return soemdsp::debug::safe(x) > 0.0;
}

// Velocity of the latest gate_hit in this translation unit (one module).
static inline double& gate_hit_velocity_slot() {
  static double v = 0.0;
  return v;
}

static inline double gate_hit_velocity() {
  return gate_hit_velocity_slot();
}

static inline bool gate_hit(double now, double* prev) {
  if (!prev) return false;
  const double x = soemdsp::debug::safe(now);
  const double p = soemdsp::debug::safe(*prev);
  const double ax = x < 0.0 ? -x : x;
  const double ap = p < 0.0 ? -p : p;
  const bool hit = ax > ap;
  gate_hit_velocity_slot() = hit ? ax - ap : 0.0;
  *prev = x;
  return hit;
}

}  // namespace soemdsp::math

namespace soemdsp_maths {
// using-declaration drops default args — keep threshold default for modules.
static inline bool rising_edge(double now, double* prev, double threshold = 0.0) {
  return soemdsp::math::rising_edge(now, prev, threshold);
}
static inline bool falling_edge(double now, double* prev, double threshold = 0.0) {
  return soemdsp::math::falling_edge(now, prev, threshold);
}
static inline bool change_edge(double now, double* prev, double threshold = 0.0) {
  return soemdsp::math::change_edge(now, prev, threshold);
}
using soemdsp::math::rising_edge_bool;
using soemdsp::math::gate_on;
using soemdsp::math::gate_hit;
using soemdsp::math::gate_hit_velocity;
}  // namespace soemdsp_maths