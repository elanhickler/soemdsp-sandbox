// Shared drum voice parts (docs/DRUM_PACK_PLAN.md Q1, Argi 2026-10-19: approved
// for the Electro drum pack). Header-only, freestanding, opt-in (not pulled in
// by soemdsp.hpp). Used by Electro Snare / Hat / Tom / Kick.
//   Ring2       2-pole pinged resonator: y = 2 r cos(w) y1 - r^2 y2 + ping sin(w)
//   HashNoise   counter-indexed hash white noise (one counter, seed per channel)
//   BlepSquare  PolyBLEP band-limited pulse/square oscillator
//   t60_coeff / planck_snap / one_pole_lp_tick / tri_wave / phase_advance
// All state is Planck-snapped where it decays, so voices rest at exact 0.
#pragma once

#include <soemdsp/soemdsp.hpp>

namespace soemdsp::drum {

static const double kLn1000 = 6.907755278982137;
// Per-channel seed: channel 0 keeps the base seed, channel 1 = seed ^ golden.
static const unsigned int kStereoSeedXor = 0x9e3779b9u;

// Exact 0 below kPlanck.
static inline double planck_snap(double x) { return soemdsp_maths::silent_planck(x) ? 0.0 : x; }

// Per-sample multiplier that falls 60 dB in t60 seconds (t60 floored at 0.1 ms).
static inline double t60_coeff(double t60, double sr) {
  return soemdsp_maths::dsp_exp(-kLn1000 / (soemdsp_maths::maxd(t60, 1.0e-4) * sr));
}

// --- Ring2: 2-pole pinged resonator. A ping x = v sin(w) rings as a sine of
// amplitude ~v. hz is clamped to 0.49 sr; rr = per-sample radius (t60_coeff).
struct Ring2 {
  double y1, y2;
};
static inline void ring2_reset(Ring2& r) { r.y1 = r.y2 = 0.0; }
static inline bool ring2_resting(const Ring2& r) { return r.y1 == 0.0 && r.y2 == 0.0; }
static inline double ring2_tick(Ring2& r, double hz, double rr, double ping, double sr) {
  const double turns = soemdsp_maths::clamp(hz / sr, 0.0, 0.49);
  const double x = ping != 0.0 ? ping * soemdsp_maths::dsp_sin_turns_lut(turns) : 0.0;
  const double y = 2.0 * rr * soemdsp_maths::dsp_cos_turns_lut(turns) * r.y1 - rr * rr * r.y2 + x;
  r.y2 = planck_snap(r.y1);
  r.y1 = planck_snap(y);
  return r.y1;
}

// --- HashNoise: white noise in [-1, 1] = hash_bipolar(counter, seed). One
// counter per voice (advance once per sample); each channel reads its own
// seed, so L/R are decorrelated and a counter reset restarts both exactly.
struct HashNoise {
  unsigned int n;
};
static inline void hash_noise_reset(HashNoise& s) { s.n = 0u; }
static inline unsigned int hash_noise_seed(unsigned int baseSeed, int channel) {
  return channel == 0 ? baseSeed : (baseSeed ^ kStereoSeedXor);
}
static inline double hash_noise_at(const HashNoise& s, unsigned int seed) {
  return soemdsp_maths::hash_bipolar(s.n, seed);
}
static inline void hash_noise_advance(HashNoise& s) { s.n++; }

// One-pole lowpass toward x at hz (capped 0.45 sr), Planck-snapped state.
static inline double one_pole_lp_tick(double& z, double x, double hz, double sr) {
  z += soemdsp::math::one_pole_coeff_hz(soemdsp_maths::mind(hz, 0.45 * sr), sr) * (x - z);
  z = planck_snap(z);
  return z;
}

// Triangle: 0 at phase 0, +1 at 0.25, -1 at 0.75.
static inline double tri_wave(double ph) {
  const double x = ph - (double)(int)ph;
  return x < 0.25 ? 4.0 * x : (x < 0.75 ? 2.0 - 4.0 * x : 4.0 * x - 4.0);
}

// Phase in turns advanced by hz / sr, wrapped to [0, 1) (hz >= 0).
static inline double phase_advance(double ph, double hz, double sr) {
  double x = ph + hz / sr;
  x -= (double)(int)x;
  return x;
}

// --- BlepSquare: band-limited pulse, +1 for phase < duty, -1 after; PolyBLEP
// residuals at both edges. duty in (0, 1); hz in [0, 0.49 sr].
struct BlepSquare {
  double ph;
};
static inline void blep_square_reset(BlepSquare& o, double phase) { o.ph = phase - (double)(int)phase; }
static inline double blep_square_tick(BlepSquare& o, double hz, double duty, double sr) {
  const double dt = soemdsp_maths::clamp(hz / sr, 0.0, 0.49);
  const double ph = o.ph;
  double fall = ph - duty;
  if (fall < 0.0) fall += 1.0;
  const double y = (ph < duty ? 1.0 : -1.0)
    + soemdsp::math::poly_blep(ph, dt) - soemdsp::math::poly_blep(fall, dt);
  double nx = ph + dt;
  if (nx >= 1.0) nx -= 1.0;
  o.ph = nx;
  return y;
}

}  // namespace soemdsp::drum
