// Robin dither: the single source of truth for Robin Schmidt's cycle-length
// dither (RS-MET) and for how a dithered oscillator may reset.
//
// The idea: a dithered cycle always lasts a whole number of samples. Its
// length is picked at each wrap from {c2 - 1, c2, c2 + 1} (c2 = round(c),
// c = samples per cycle) with probabilities that give mean c and variance
// 0.25. Every cycle then starts on the sample grid, so the waveform is sampled
// the same way every cycle: the pitch is exact on average and aliasing turns
// into noise instead of inharmonic tones.
//
// Reset rule: a reset (Reset trigger at any height, a start / phase offset, a
// Loop restart) only ever lands on an integer sample of the cycle. A reset to
// phase p in a cycle of `steps` samples puts the phasor at the whole sample
// round(p * steps) (mod steps), never between samples, so the next wrap is
// again on the grid. Any off-grid reset would bring the inharmonic aliasing
// back for that cycle.
//
// Users: Robin Oscillator, Softpop Oscillator, Ellipsoid Osc (Dither phasor),
// Pulse Train (Rand / Dither Loop wrap). robin_supersaw keeps its own copy of
// the distribution (Reset there already restarts at phase 0).
#pragma once

#include <soemdsp/math/scalar_helpers.h>

namespace soemdsp_maths {

// Schmidt calcCycleDistribution: middle length round(c) and the short (c2 - 1)
// and middle probabilities; long = 1 - short - mid. Returns false only for a
// degenerate distribution (callers then use the middle length).
static inline bool robin_cycle_distribution(double c, double* lenMid, double* probShort, double* probMid) {
  const double ci = dsp_floor(c);
  const double cf = c - ci;
  double c2 = ci;
  if (cf >= 0.5) c2 += 1.0;
  const double c1 = c2 - 1.0;
  const double c3 = c2 + 1.0;
  const double e1 = c1 - c;
  const double e2 = c2 - c;
  const double e3 = c3 - c;
  const double v1 = e1 * e1;
  const double v2 = e2 * e2;
  const double v3 = e3 * e3;
  const double v = 0.25;
  const double d1 = v - v1;
  const double d2 = v - v2;
  const double d3 = v - v3;
  const double denom = e3 * (v1 - v2) - e2 * (v1 - v3) + e1 * (v2 - v3);
  *lenMid = c2;
  if (!(denom == denom) || denom == 0.0) {
    *probShort = 0.0;
    *probMid = 1.0;
    return false;
  }
  const double s = 1.0 / denom;
  *probShort = (d2 * e3 - d3 * e2) * s;
  *probMid = (d3 * e1 - d1 * e3) * s;
  return true;
}

// One whole-sample cycle length for c samples per cycle, from a uniform r in
// [0, 1). Never below minLen.
static inline double robin_cycle_pick(double c, double r, double minLen = 2.0) {
  if (!(c == c) || c < minLen) c = minLen;
  if (c > 1.0e9) c = 1.0e9;
  double mid = 0.0, pShort = 0.0, pMid = 1.0;
  robin_cycle_distribution(c, &mid, &pShort, &pMid);
  double len = mid;
  if (r < pShort) len = mid - 1.0;
  else if (r >= pShort + pMid) len = mid + 1.0;
  if (!(len >= minLen)) len = minLen;
  return len;
}

// Reset rule: the whole sample of a `steps`-sample cycle that phase p (cycles,
// any value) lands on: round(p * steps) mod steps, in [0, steps). steps < 1
// returns 0.
static inline double robin_grid_count(double phase, double steps) {
  if (!(steps >= 1.0) || !(phase == phase)) return 0.0;
  double p = phase - dsp_floor(phase);
  double n = dsp_floor(p * steps + 0.5);
  if (n >= steps) n -= steps;
  if (!(n >= 0.0)) n = 0.0;
  return n;
}

// The on-grid phase (cycles, [0, 1)) a reset to `phase` really plays from.
static inline double robin_grid_phase(double phase, double steps) {
  if (!(steps >= 1.0)) return 0.0;
  return robin_grid_count(phase, steps) / steps;
}

}  // namespace soemdsp_maths
