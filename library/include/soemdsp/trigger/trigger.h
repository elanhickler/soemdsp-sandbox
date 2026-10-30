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
// Plus an upward zero crossing (x[n-1] <= 0 < x[n]) is always a hit with
// velocity x[n], so a bipolar square (-1 -> +1, |x| unchanged) still fires
// once per cycle on its rising edge at full height. -0.2 -> 0.5 hits with 0.5.
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
  const bool crossUp = p <= 0.0 && x > 0.0;
  const bool hit = crossUp || ax > ap;
  gate_hit_velocity_slot() = crossUp ? x : (hit ? ax - ap : 0.0);
  *prev = x;
  return hit;
}

// Trigger-height partial reset (oscillator Reset trigger inputs).
// Signed height of the gate_hit just reported for `now`: sign(now) * velocity,
// clamped to -1..1. A 0 -> 1 gate is 1 (full reset), 0 -> 0.5 is 0.5,
// 0 -> -1 is -1.
static inline double gate_hit_height(double now) {
  const double x = soemdsp::debug::safe(now);
  double h = gate_hit_velocity_slot();
  if (x < 0.0) h = -h;
  if (h > 1.0) h = 1.0;
  if (h < -1.0) h = -1.0;
  return h;
}

// Move `phase` toward `target` by fraction |h| of the way. h > 0 takes the
// shortest wrapped path, h < 0 the long way around (the complementary path).
// |h| = 1 lands exactly on target (hard reset), h = 0 leaves phase alone.
// `period` is the phase cycle (1 for cycles, 2*pi for radians); the result is
// wrapped into [0, period).
static inline double partial_reset_phase(double phase, double target, double h, double period = 1.0) {
  if (!(h == h) || !(period > 0.0)) return phase;
  if (h > 1.0) h = 1.0;
  if (h < -1.0) h = -1.0;
  if (h == 0.0) return phase;
  auto wrap = [period](double p) {
    p /= period;
    p -= __builtin_floor(p);
    return p * period;
  };
  if (h == 1.0 || h == -1.0) return wrap(target);
  double d = (target - phase) / period;
  d -= __builtin_floor(d + 0.5);  // shortest signed distance, [-0.5, 0.5)
  if (h < 0.0) {
    d = (d >= 0.0) ? d - 1.0 : d + 1.0;  // long way around
    h = -h;
  }
  return wrap(phase + h * d * period);
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
using soemdsp::math::gate_hit_height;
using soemdsp::math::partial_reset_phase;
}  // namespace soemdsp_maths