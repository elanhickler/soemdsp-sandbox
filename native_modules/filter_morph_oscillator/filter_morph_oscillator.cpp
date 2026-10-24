// soemdsp-native-module: filter_morph_oscillator
// soemdsp-native-label: Filter Morph Osc
// soemdsp-native-target: filterMorphOscillator
// soemdsp-native-kind: oscillator
//
// PolyBLEP on jumps / PolyBLAMP on corners (one-sample latency, events on the
// true phase incl. Phase offset, v8). Locked phasor (no period dither, no FM).
// Dither mixes a pitch-tracked noise band: 2-pole HP at ƒ and 2-pole LP at 4ƒ,
// wet from Start to Full (Amount). Grain-free; nothing injected below ƒ.
// Then pitch-tracking Passive-style one-pole cascade (Poles 1…4) + makeup.
// Morph 0 = dark (fc ≈ 0.5×f0). Morph 1 = open (fc ≈ 100×f0, Nyquist clamp).
// Asym Sine is 2× per wrap so the phasor runs at ƒ/2; filter/makeup use user ƒ.
// Knee Tri is the triangle with a parabolic knee within w = 0.121/4 turns of each
// peak (C1), peak scaled to 1. Its 4 curvature steps per cycle get a 2-sample
// BLEP-integrated-twice residual (d^4/24, -a^4/24) plus the kernel's c/12 offset
// inside the knees, so the corrected signal is the B1-smoothed shape.
// Sine is sin(2πφ) at user ƒ (no BLEP; continuous).

#include <stdint.h>

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

constexpr int kMaxInstances = 64;
constexpr int kMaxPoles = 4;
constexpr int kNoiseHpPoles = 2;
constexpr int kNoiseLpPoles = 2;
constexpr double kROpen = 100.0;
constexpr double kRDark = 0.5;
constexpr double kDitherStartHz = 2000.0;
constexpr double kDitherFullHz = 7000.0;
constexpr double kNoiseHiRatio = 4.0;  // LP at 4ƒ, clamped to 0.45 sr

// One stereo lane. L and R share knobs; R is +1/4 turn and its own dither.
struct FilterMorphVoice {
  double phase;
  double lpY[kMaxPoles];
  unsigned int rng;
  double noiseHpZ[kNoiseHpPoles];
  double noiseLpZ[kNoiseLpPoles];
  double lastQ;       // previous effective phase (wrapped)
  double lastOff;     // previous Phase offset
  double held;        // sample n-1 awaiting its BLEP/BLAMP share
  int primed;
};

struct FilterMorphState {
  bool active;
  double lastReset;
  unsigned int seed;  // module Seed (seed_param_u32)
  FilterMorphVoice L;
  FilterMorphVoice R;
};

static FilterMorphState gPool[kMaxInstances];

// Fixed seed components (never reorder; append new parts at the end).
enum : unsigned int {
  kSeedDitherL = 1u,  // pitch-tracked noise-band stream (Wave L)
  kSeedDitherR = 2u,  // Wave R
};

constexpr double kStereoPhase = 0.25;  // R = L + 90°

// Dither stream from the module Seed only (create, Reset, Seed change).
static unsigned int dither_rng_from_seed(unsigned int seed, unsigned int lane) {
  return seed_to_rng_state(seed_mix(seed, lane));
}

static double wrap01_phase(double x) {
  return wrap01(x);
}

static double next_white(FilterMorphVoice& s) {
  unsigned int state = s.rng;
  if (state == 0u) state = 1u;
  state = xorshift32(state);
  s.rng = state;
  const double u = (double)(state >> 8) * (1.0 / 16777216.0);
  return u * 2.0 - 1.0;
}

static void clear_noise(FilterMorphVoice& s) {
  for (int i = 0; i < kNoiseHpPoles; i++) s.noiseHpZ[i] = 0.0;
  for (int i = 0; i < kNoiseLpPoles; i++) s.noiseLpZ[i] = 0.0;
}

static double one_pole_lp(double& y, double x, double freqHz, double rate);

// White → 2-pole HP at loHz → 2-pole LP at hiHz. Band sits on ƒ…4ƒ.
static double noise_band(FilterMorphVoice& s, double loHz, double hiHz, double rate) {
  double n = next_white(s);
  for (int i = 0; i < kNoiseHpPoles; i++) {
    const double lp = one_pole_lp(s.noiseHpZ[i], n, loHz, rate);
    n = n - lp;
  }
  for (int i = 0; i < kNoiseLpPoles; i++) {
    n = one_pole_lp(s.noiseLpZ[i], n, hiHz, rate);
  }
  return n;
}

// 0 below Start, 1 at/above Full, log-Hz in between so an octave is an octave.
static double sizzle_gate(double freqHz, double startHz, double fullHz) {
  double f = freqHz < 0.0 ? -freqHz : freqHz;
  double a = startHz;
  double b = fullHz;
  if (!(a == a) || a <= 0.0) a = kDitherStartHz;
  if (!(b == b) || b <= 0.0) b = kDitherFullHz;
  if (a < 1.0) a = 1.0;
  if (b < 1.0) b = 1.0;
  if (b < a) {
    const double t = a;
    a = b;
    b = t;
  }
  if (f <= a) return 0.0;
  if (f >= b) return 1.0;
  const double la = dsp_ln(a);
  const double lb = dsp_ln(b);
  const double den = lb - la;
  if (!(den > 1.0e-12)) return 1.0;
  return (dsp_ln(f) - la) / den;
}

static double naive_saw(double t) {
  return 1.0 - wrap01_phase(t) * 2.0;
}

static double naive_ramp(double t) {
  return -1.0 + wrap01_phase(t) * 2.0;
}

static double naive_triangle(double t) {
  const double p = wrap01_phase(t);
  const double d = p < 0.5 ? (0.5 - p) : (p - 0.5);
  return 1.0 - 4.0 * d;
}

// Knee Tri constants (Knee 0.121): w, peak A = 1 - 2w, parabola 2/w, scale 1/(1-2w).
constexpr double kKneeW = 0.121 * 0.25;
constexpr double kKneeA = 1.0 - 2.0 * kKneeW;
constexpr double kKneeB = 2.0 / kKneeW;
constexpr double kKneeS = 1.0 / (1.0 - 2.0 * kKneeW);
constexpr double kKneeCurv = 2.0 * kKneeB * kKneeS;  // |d2y/dphase2| inside a knee

static double naive_knee_triangle(double t) {
  const double x = naive_triangle(t);
  const double ax = x < 0.0 ? -x : x;
  const double d = 0.25 * (1.0 - ax);
  const double v = (d < kKneeW ? kKneeA - kKneeB * d * d : 1.0 - 4.0 * d) * kKneeS;
  return x < 0.0 ? -v : v;
}

// Knee Tri curvature (output per turn^2) at phase p: -K in the peak knee, +K in the trough knee.
static double knee_curvature(double t) {
  const double p = wrap01_phase(t);
  if (p < kKneeW || p > 1.0 - kKneeW) return kKneeCurv;
  if (p > 0.5 - kKneeW && p < 0.5 + kKneeW) return -kKneeCurv;
  return 0.0;
}

static double naive_pulse(double t, double morph) {
  const double pw = morph_width01(morph);
  return (wrap01_phase(t) < pw) ? (2.0 - 2.0 * pw) : (-2.0 * pw);
}

static double naive_center_square(double t, double morph) {
  double w = morph;
  if (!(w == w)) w = 0.5;
  if (w < 0.0) w = 0.0;
  if (w > 1.0) w = 1.0;
  if (w <= 0.0) return -1.0;
  if (w >= 1.0) return 1.0;
  const double shift = 0.5 * (1.0 - w);
  const double t0 = wrap01_phase(t - shift);
  return (t0 < w) ? 1.0 : -1.0;
}

static double naive_asym_sine(double t) {
  double sabs = dsp_sin_turns_lut(wrap01_phase(t));
  if (sabs < 0.0) sabs = -sabs;
  return sabs * 2.0 - 1.0;
}

static double naive_sine(double t) {
  return dsp_sin_turns_lut(wrap01_phase(t));
}

static double one_pole_lp(double& y, double x, double freqHz, double rate) {
  const double maxW = kTAU * 0.45;
  double f = freqHz;
  if (!(f == f) || f < 0.0) f = 0.0;
  if (f > 20000.0) f = 20000.0;
  double w = f * kTAU / rate;
  if (w > maxW) w = maxW;
  const double a1 = dsp_exp_squaring(-w);
  const double b0 = 1.0 - a1;
  y = b0 * x + a1 * y;
  return y;
}

static double one_pole_mag_at_f0(double fcHz, double f0Hz, double rate) {
  const double maxW = kTAU * 0.45;
  double fc = fcHz;
  if (!(fc == fc) || fc < 0.0) fc = 0.0;
  if (fc > 20000.0) fc = 20000.0;
  double w = fc * kTAU / rate;
  if (w > maxW) w = maxW;
  const double a1 = dsp_exp_squaring(-w);
  const double b0 = 1.0 - a1;
  double f0 = f0Hz < 0.0 ? -f0Hz : f0Hz;
  if (!(f0 > 1.0e-12)) f0 = 1.0e-12;
  double w0 = f0 * kTAU / rate;
  if (w0 > maxW) w0 = maxW;
  const double c = dsp_cos(w0);
  const double den2 = 1.0 - 2.0 * a1 * c + a1 * a1;
  const double den = den2 > 0.0 ? (double)__builtin_sqrt((float)den2) : 0.0;
  if (!(den > 1.0e-18)) return 1.0;
  return b0 / den;
}

static double morph_to_ratio(double morph) {
  double m = morph;
  if (!(m == m) || m < 0.0) m = 0.0;
  if (m > 1.0) m = 1.0;
  const double logDark = dsp_ln(kRDark);
  const double logOpen = dsp_ln(kROpen);
  return dsp_exp(logDark + m * (logOpen - logDark));
}

static int clamp_poles(double poles) {
  int n = (int)(poles + (poles >= 0.0 ? 0.5 : -0.5));
  if (n < 1) n = 1;
  if (n > kMaxPoles) n = kMaxPoles;
  return n;
}

static int clamp_wave(double waveform) {
  int w = (int)(waveform + (waveform >= 0.0 ? 0.5 : -0.5));
  if (w < 0) w = 0;
  if (w > 7) w = 7;
  return w;
}

static void clear_lp(FilterMorphVoice& s) {
  for (int i = 0; i < kMaxPoles; i++) s.lpY[i] = 0.0;
}

static double source_wave(double ph, int wave) {
  switch (wave) {
    case 1: return naive_ramp(ph);
    case 2: return naive_trisaw(ph, 0.5);
    case 3: return naive_knee_triangle(ph);
    case 4: return naive_center_square(ph, 0.5);
    case 5: return naive_pulse(ph, 0.5);
    case 6: return naive_asym_sine(ph);
    case 7: return naive_sine(ph);
    default: return naive_saw(ph);
  }
}

// Discontinuities per waveform in its own phase (turns): location, value jump
// (after - before), slope change in output units per turn, and curvature change
// in output units per turn^2.
struct Edge { double at, jump, kink, curv; };

static int wave_edges(int wave, Edge* e) {
  const double k8pi = 8.0 * 3.14159265358979323846;
  switch (wave) {
    case 1: e[0] = {0.0, -2.0, 0.0}; return 1;                         // Ramp
    case 2: e[0] = {0.25, 0.0, -8.0}; e[1] = {0.75, 0.0, 8.0}; return 2; // Trisaw (0.5)
    case 3:                                                            // Knee Tri
      e[0] = {kKneeW, 0.0, 0.0, -kKneeCurv};
      e[1] = {0.5 - kKneeW, 0.0, 0.0, -kKneeCurv};
      e[2] = {0.5 + kKneeW, 0.0, 0.0, kKneeCurv};
      e[3] = {1.0 - kKneeW, 0.0, 0.0, kKneeCurv};
      return 4;
    case 4: e[0] = {0.25, 2.0, 0.0}; e[1] = {0.75, -2.0, 0.0}; return 2; // Center Square
    case 5: {
      const double pw = morph_width01(0.5);
      e[0] = {0.0, 2.0, 0.0}; e[1] = {pw, -2.0, 0.0}; return 2;         // Pulse
    }
    case 6: e[0] = {0.0, 0.0, k8pi}; e[1] = {0.5, 0.0, k8pi}; return 2; // Asym Sine
    case 7: return 0;                                                  // Sine
    default: e[0] = {0.0, 2.0, 0.0}; return 1;                          // Saw
  }
}

static void init_voice(FilterMorphVoice& v, unsigned int seed, unsigned int lane) {
  v.phase = 0.0;
  clear_lp(v);
  clear_noise(v);
  v.rng = dither_rng_from_seed(seed, lane);
  v.lastQ = 0.0;
  v.lastOff = 0.0;
  v.held = 0.0;
  v.primed = 0;
}

static double process_one(
  FilterMorphVoice& s,
  double frequencyHz,
  double sampleRate,
  double morph,
  double poles,
  double waveform,
  double phaseOffset,
  double amplitude,
  double dither,
  double startHz,
  double fullHz,
  double amount,
  double resetH
) {
  const double rate = sampleRate > 1.0 ? sampleRate : 44100.0;
  const double f = (frequencyHz * 0.0 == 0.0) ? frequencyHz : 0.0;
  const int wave = clamp_wave(waveform);
  double increment = f / rate;
  if (wave == 6) increment *= 0.5;
  const double po = wrap01_phase(phaseOffset);
  const int nPoles = clamp_poles(poles);
  const bool ditherOn = dither >= 0.5;

  // Reset trigger height resetH (-1..1, 0 = no hit): |h| = 1 hard reset,
  // otherwise the phasor moves |h| of the way to 0 (h < 0 the long way).
  const bool doReset = resetH >= 1.0 || resetH <= -1.0;
  if (doReset) {
    s.phase = 0.0;
    clear_noise(s);
    clear_lp(s);
  } else if (resetH != 0.0) {
    s.phase = soemdsp::math::partial_reset_phase(s.phase, 0.0, resetH);
  }

  const double absInc = increment < 0.0 ? -increment : increment;
  s.phase = wrap01_phase(s.phase + increment);

  // Effective phase actually played this sample, and the true distance it
  // moved since the last one (increment + Phase offset step).
  const double off = po;
  const double ph = wrap01_phase(s.phase + off);
  double y = source_wave(ph, wave);
  // Knee Tri: B1 kernel lifts a parabola by c*dt^2/12 (dt = phase step per sample).
  if (wave == 3) {
    double dq0 = increment;
    y += knee_curvature(ph) * dq0 * dq0 * (1.0 / 12.0);
  }

  if (!s.primed || doReset) {
    s.primed = 1;
    s.held = y;
  } else {
    double dOff = off - s.lastOff;
    dOff -= dsp_floor(dOff + 0.5);
    const double dq = increment + dOff;
    const double adq = dq < 0.0 ? -dq : dq;
    if (adq > 1.0e-12) {
      Edge e[4];
      const int ne = wave_edges(wave, e);
      const double q0 = s.lastQ;
      for (int i = 0; i < ne; i++) {
        // Crossings of e[i].at between q0 and q0 + dq (either direction).
        double c = dq > 0.0 ? wrap01_phase(e[i].at - q0) : wrap01_phase(q0 - e[i].at);
        if (c <= 0.0) c = 1.0;
        for (; c <= adq; c += 1.0) {
          const double d = (adq - c) / adq;  // fraction of this sample since the edge
          const double h = dq > 0.0 ? e[i].jump : -e[i].jump;
          const double m = e[i].kink * adq;
          const double a = 1.0 - d;
          const double cv = e[i].curv * adq * adq;
          const double d4 = d * d * d * d, a4 = a * a * a * a;
          s.held += h * (d * d * 0.5) + m * (d * d * d) * (1.0 / 6.0) + cv * d4 * (1.0 / 24.0);
          y += -h * (a * a * 0.5) + m * (a * a * a) * (1.0 / 6.0) - cv * a4 * (1.0 / 24.0);
        }
      }
    }
    const double out = s.held;
    s.held = y;
    y = out;
  }
  s.lastQ = ph;
  s.lastOff = off;

  double amt = amount;
  if (!(amt == amt) || amt < 0.0) amt = 0.0;
  if (amt > 1.0) amt = 1.0;
  const double gate = (ditherOn && absInc > 1.0e-15) ? (sizzle_gate(f, startHz, fullHz) * amt) : 0.0;
  double f0 = f < 0.0 ? -f : f;
  if (!(f0 > 1.0e-9)) f0 = 1.0e-9;
  if (gate > 1.0e-6) {
    const double ny = rate * 0.45;
    double hi = kNoiseHiRatio * f0;
    if (hi < f0) hi = f0;
    if (hi > ny) hi = ny;
    const double n = noise_band(s, f0, hi, rate);
    y = y * (1.0 - gate) + n * gate;
  } else {
    clear_noise(s);
  }

  double m = morph;
  if (!(m == m) || m < 0.0) m = 0.0;
  if (m > 1.0) m = 1.0;

  double fc = morph_to_ratio(m) * f0;
  const double ny = rate * 0.45;
  if (fc < 1.0) fc = 1.0;
  if (fc > ny) fc = ny;
  for (int i = 0; i < nPoles; i++) {
    y = one_pole_lp(s.lpY[i], y, fc, rate);
  }
  for (int i = nPoles; i < kMaxPoles; i++) {
    s.lpY[i] = y;
  }
  const double mag1 = one_pole_mag_at_f0(fc, f0, rate);
  double magN = 1.0;
  for (int i = 0; i < nPoles; i++) magN *= mag1;
  if (magN > 1.0e-12) {
    double makeup = 1.0 / magN;
    if (makeup > 8.0) makeup = 8.0;
    y *= makeup;
  }

  double gain = (amplitude * 0.0 == 0.0) ? amplitude : 1.0;
  if (gain < 0.0) gain = 0.0;
  return y * gain;
}

}  // namespace

extern "C" int soemdsp_filter_morph_oscillator_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      FilterMorphState& s = gPool[i];
      s.lastReset = 0.0;
      // Seed 0 until the host's Seed arrives via soemdsp_filter_morph_oscillator_set_seed.
      s.seed = 0u;
      init_voice(s.L, 0u, kSeedDitherL);
      init_voice(s.R, 0u, kSeedDitherR);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_filter_morph_oscillator_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_filter_morph_oscillator_reset(int handle, double phaseOffset) {
  if (handle < 1 || handle > kMaxInstances) return;
  FilterMorphState& s = gPool[handle - 1];
  if (!s.active) return;
  (void)phaseOffset;
  s.L.phase = 0.0;
  s.R.phase = 0.0;
  clear_noise(s.L);
  clear_noise(s.R);
  s.L.rng = dither_rng_from_seed(s.seed, kSeedDitherL);
  s.R.rng = dither_rng_from_seed(s.seed, kSeedDitherR);
  s.L.primed = 0;
  s.R.primed = 0;
  clear_lp(s.L);
  clear_lp(s.R);
}

// Reset trigger below full height: move the phasor |h| of the way to 0 (h < 0
// the long way round); dither, noise and filter state keep running.
extern "C" void soemdsp_filter_morph_oscillator_partial_reset(int handle, double h) {
  if (handle < 1 || handle > kMaxInstances) return;
  FilterMorphState& s = gPool[handle - 1];
  if (!s.active) return;
  s.L.phase = soemdsp::math::partial_reset_phase(s.L.phase, 0.0, h);
  s.R.phase = soemdsp::math::partial_reset_phase(s.R.phase, 0.0, h);
}

// Seed change (or first Seed after create): restart the dither stream from it.
extern "C" void soemdsp_filter_morph_oscillator_set_seed(int handle, double seed) {
  if (handle < 1 || handle > kMaxInstances) return;
  FilterMorphState& s = gPool[handle - 1];
  if (!s.active) return;
  s.seed = seed_param_u32(seed);
  s.L.rng = dither_rng_from_seed(s.seed, kSeedDitherL);
  s.R.rng = dither_rng_from_seed(s.seed, kSeedDitherR);
  clear_noise(s.L);
  clear_noise(s.R);
}

extern "C" void soemdsp_filter_morph_oscillator_sample_stereo(
  int handle,
  double frequencyHz,
  double sampleRate,
  double morph,
  double poles,
  double waveform,
  double phaseOffset,
  double amplitude,
  double reset,
  double dither,
  double startHz,
  double fullHz,
  double amount,
  double* outLeft,
  double* outRight
) {
  if (outLeft) *outLeft = 0.0;
  if (outRight) *outRight = 0.0;
  if (handle < 1 || handle > kMaxInstances) return;
  FilterMorphState& s = gPool[handle - 1];
  if (!s.active) return;
  const double rv = (reset * 0.0 == 0.0) ? reset : 0.0;
  const bool hit = soemdsp::math::gate_hit(rv, &s.lastReset);
  const double resetH = hit ? soemdsp::math::gate_hit_height(rv) : 0.0;
  const double yL = process_one(
    s.L, frequencyHz, sampleRate, morph, poles, waveform, phaseOffset, amplitude, dither,
    startHz, fullHz, amount, resetH
  );
  const double yR = process_one(
    s.R, frequencyHz, sampleRate, morph, poles, waveform, phaseOffset + kStereoPhase, amplitude, dither,
    startHz, fullHz, amount, resetH
  );
  if (outLeft) *outLeft = yL;
  if (outRight) *outRight = yR;
}

extern "C" double soemdsp_filter_morph_oscillator_sample(
  int handle,
  double frequencyHz,
  double sampleRate,
  double morph,
  double poles,
  double waveform,
  double phaseOffset,
  double amplitude,
  double reset,
  double dither,
  double startHz,
  double fullHz,
  double amount
) {
  double left = 0.0;
  double right = 0.0;
  soemdsp_filter_morph_oscillator_sample_stereo(
    handle, frequencyHz, sampleRate, morph, poles, waveform, phaseOffset, amplitude, reset,
    dither, startHz, fullHz, amount, &left, &right
  );
  return left;
}

extern "C" int soemdsp_filter_morph_oscillator_version() {
  return 14; // 14: Wave L / Wave R are two voices (R = L + 90°, own dither). 13: shared gate_hit Reset height
}
