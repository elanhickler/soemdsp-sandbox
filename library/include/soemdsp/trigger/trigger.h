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

// App-wide Gate/Trigger (docs/GATES_TRIGGERS.md section 3, original law):
// on = x > 0. Hit = first sample > 0 after a sample <= 0 (armed by <= 0).
// Height (velocity) is `now`. Negative is rest and re-arms. Updates *prev.
static inline bool gate_on(double x) {
  return soemdsp::debug::safe(x) > 0.0;
}

static inline bool gate_hit(double now, double* prev) {
  if (!prev) return false;
  const double x = soemdsp::debug::safe(now);
  const double p = soemdsp::debug::safe(*prev);
  const bool hit = !(p > 0.0) && x > 0.0;
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
}  // namespace soemdsp_maths