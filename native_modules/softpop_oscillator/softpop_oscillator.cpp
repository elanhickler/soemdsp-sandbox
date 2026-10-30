// soemdsp-native-module: softpop_oscillator
// soemdsp-native-label: Softpop Oscillator
// soemdsp-native-target: softpopOscillator
// soemdsp-native-kind: oscillator
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp-sandbox/blob/master/docs/SOFTPOP_PLAN.md
//
// Softpop Oscillator: a phase oscillator with full-band Color-noise Pitch Mod.
// Shared Softpop parts (noise, Pitch Mod, display):
// softpop_core.h. The noise-driven bandpass voice is Softpop Filter
// (native_modules/softpop_filter).
//
// Per channel, per sample:
//   fInst = fEff * exp(e)            (softpop_core.h noise_step at Pitch Mod, mean-corrected;
//                                     Color Average 2-tap averages the pitch noise)
//   phi  += clamp(fInst, +-fs/2) / fs   (polyBlep increment)
//   x     = source(phi, Morph)
//   y     = x * (sqrt(1 - AmpMod) + sqrt(AmpMod) n_amp) * Amplitude   (constant level)
//
// Oscillator Source (choiceIds):
//   0 Sine          sin(2 pi phi). Morph unused.
//   1 Dithered Sine sin(2 pi (phi + Morph * d)), d = Robin Schmidt +-1-sample
//                   cycle-length dither (soemdsp_ellipsoid_robin_dither_cycles,
//                   picked once per cycle; no stuck-oscillation FM tricks).
//                   Morph = dither amount (0 = plain sine, 1 = full Robin).
//   2 Dithered Trisaw  Robin Schmidt's dithering oscillator in its trisaw form:
//                   a module-local port of native_modules/robin_oscillator
//                   (calcCycleDistribution, updateCycleLength, beginCycle,
//                   placePhaseInCycle, warpRemainingCycle = its Update option 1
//                   "Warp remaining") driving naive_trisaw_center (soemdsp library,
//                   Robin Oscillator's "Trisaw Center"). Every cycle lasts a whole
//                   number of samples L in {Lmid-1, Lmid, Lmid+1} picked at the wrap
//                   (mean sr/|f|, variance 0.25); phase steps 1/L per sample.
//                   Warp remaining re-aims the rest of the cycle every sample the
//                   increment changes, so Pitch Mod noise and Frequency modulation
//                   act per sample. Morph = trisaw center morph (0.5 triangle,
//                   0 / 1 opposing-peak saws). Own phasor; ch.phase keeps running.
//   3 Soft Square   soundemote.dev /softsquare SquareToSine (hyperbolic soft clip
//                   of a sine): S = sin(2 pi phi), y = S sqrt(1+k) / sqrt(S^2 + k),
//                   Morph -> c = sqrt(cos(pi Morph / 2)), k = c^2 / (1 - c^2)
//                   (Morph 0 = c 1, pure sine; Morph 1 = c 0, hard square, held
//                   back only by the AA floor). The old k = 10^(4 - 8 Morph) was a
//                   sine up to ~0.3 and already square past ~0.75; this law steps H3
//                   evenly (220 Hz: sine, -40, -27.5, -19, -9.6 dB at 0/.25/.5/.75/1).
//                   With c = sqrt(k / (1 + k)) this is exactly soemdsp Ellipsoid
//                   getSineToSquare on the sine phase: S / sqrt((1 - c^2) S^2 + c^2),
//                   so it renders through soemdsp_ellipsoid_sine_to_square_aa
//                   (native_modules/ellipsoid, AA = Limit) at shape = 1 - c, phase - 1/4.
//   4 Soft Tri      soundemote.dev /softtriangle "Ellipsoid Sym" (odibo, KVR
//                   p=9310708; public/experiments/soft-triangle/math.js
//                   stEllipsoidSymY): c = cos(2 pi phi + pi/2), ca = 1 - c, cb = 1 + c,
//                   par1 = ca / sqrt(ca + B^2 cb), par2 = cb / sqrt(cb + B^2 ca),
//                   corr(p) = p + C (p - p^2), C = 0.225 (site constant),
//                   y = (corr(par1) - corr(par2)) sqrt(1/2) / (1 + C (1 - sqrt 2)).
//                   The last factor is a fixed gain only: the peak (c = -1) is
//                   1 + C (1 - sqrt 2) for every B, so this makes the peak exactly 1.
//                   B = sqrt(Morph) (Morph 0 = triangle, Morph 1 = B 1, a pure sine).
//                   Not the site's log slider 10^(-4 + 4 u): the shape does not
//                   move until B ~0.2 (H3 -18 dB for every B < 0.2), so that law
//                   left Morph 0..0.75 silent. sqrt spreads H3 evenly in dB
//                   (220 Hz: -18, -25, -32.5, -42, sine at 0, .25, .5, .75, 1).
//   5 PolyBLEP Trisaw  Antialiased Trisaw Center on the plain phase: the PolyBLEP
//                   module's waveform 9 (native_modules/polyblep, naive_trisaw_center
//                   + poly_blamp at both peaks) via soemdsp_polyblep_trisaw_center.
//                   Morph = center morph as Dithered Trisaw (0.5 triangle, 0 / 1 saws).
//
// Antialiasing = the existing Ellipsoid sharpness limit (native_modules/ellipsoid/
// ellipsoid.cpp ellipseCMin, AA "Limit": the ellipse axis ratio is floored at
// omega = clamp(2 pi |f| / sr, 0, 1), "edge slope >= 1 sample"), per sample from
// the instantaneous |f| the phase steps with (Frequency + Pitch Mod noise, after
// the Nyquist clamp):
//   Soft Square: c = max(sqrt(k / (1 + k)), omega), i.e. k >= omega^2 / (1 - omega^2),
//                applied inside sine_to_square_aa itself (same code path).
//   Soft Tri:    B is the same kind of axis ratio (ca + B^2 cb is an ellipse
//                radius), so B = max(B, omega) with the identical rule.
// Why it works: both shapes' nearest complex singularity sits at imaginary phase
// distance a ~ c (square, a = atanh c) or a = 2 atanh B (tri), and harmonic n
// falls like exp(-a n); flooring the ratio at omega puts the Nyquist harmonic
// (n = sr / 2|f|) at exp(-pi) (square) / exp(-2 pi) (tri) of the smooth decay.
// This is a floor on the shape's own ratio inside the DSP; the Morph parameter
// value is never clamped or rewritten, and low notes keep the full Morph range.
// Outputs: Mono = the L channel render, Left, Right, Noise L/R = the
// audio noise stream N_audio (Color-shaped, unit RMS), ♯/♭ L/R = the
// pitch the oscillator actually steps with, as a MIDI note (A4 = 440).

#include "softpop_core.h"
#include <soemdsp/math/robin_dither.h>

// Robin cycle-length dither pick: one copy, in native_modules/ellipsoid
// (resolved in the combined link; standalone builds allow it undefined).
extern "C" double soemdsp_ellipsoid_robin_dither_cycles(unsigned int* rng, double cycleSamples);
// Ellipsoid getSineToSquare with the existing AA Limit (antialias 1).
extern "C" double soemdsp_ellipsoid_sine_to_square_aa(double phaseCycles, double shape, double frequencyHz,
                                                      double sampleRate, int antialias);
// polyblep Trisaw Center (PolyBLAMP at both peaks), waveform 9 of the PolyBLEP module.
extern "C" double soemdsp_polyblep_trisaw_center(double phaseCycle, double incrementAbs, double morph);

namespace {

using namespace soemdsp_maths;
using namespace softpop;

static const int kMaxInstances = 64;

enum { kSrcSine = 0, kSrcDitherSine = 1, kSrcTrisaw = 2, kSrcSoftSquare = 3, kSrcSoftTri = 4, kSrcPolyBlepTri = 5 };

// Ellipsoid Sym correction constant (soundemote.dev ST_ELL_C) and peak gain.
static const double kEllC = 0.225;
static const double kEllNorm = 1.0 / (1.0 + kEllC * (1.0 - 1.4142135623730951));

// ---- Robin Schmidt dithering oscillator (port of native_modules/robin_oscillator) ----
struct Robin {
  bool primed;
  double sampleCount, lenNow, lenMid, probShort, probMid, phaseSlope, phase, currentInc, ditherOffset;
};

static inline double robin_random_unit(unsigned int& state) {
  return (double)(xorshift32(state) >> 8) * (1.0 / 16777216.0);
}

// Schmidt cycle distribution: shared single source (math/robin_dither.h).
static void robin_calc_cycle_distribution(double c, double* lenMid, double* probShort, double* probMid) {
  robin_cycle_distribution(c, lenMid, probShort, probMid);
}

static double robin_mean_cycle_samples(double inc) {
  const double a = dsp_fabs(inc);
  if (!(a > 1.0e-15)) return 1.0e9;
  double mean = 1.0 / a;
  if (!(mean == mean) || mean > 1.0e9) return 1.0e9;
  if (mean < 2.0) return 2.0;
  return mean;
}

static void robin_update_cycle_length(Robin& v, unsigned int& rng) {
  const double r = robin_random_unit(rng);
  if (r < v.probShort) v.lenNow = v.lenMid - 1.0;
  else if (r < v.probShort + v.probMid) v.lenNow = v.lenMid;
  else v.lenNow = v.lenMid + 1.0;
  if (!(v.lenNow > 1.0)) v.lenNow = 2.0;
  v.ditherOffset = v.lenNow - robin_mean_cycle_samples(v.currentInc);
  if (!(dsp_fabs(v.currentInc) > 1.0e-15)) { v.phaseSlope = 0.0; return; }
  // Phase steps 1/L so the cycle lasts exactly L samples (robin_oscillator
  // steps 1/(L-1) and wraps on phase >= 1 one sample early, which plays sharp).
  double slope = 1.0 / v.lenNow;
  if (v.currentInc < 0.0) slope = -slope;
  v.phaseSlope = slope;
}

static void robin_bake(Robin& v, double inc) {
  robin_calc_cycle_distribution(robin_mean_cycle_samples(inc), &v.lenMid, &v.probShort, &v.probMid);
}

static double robin_cycles_until_wrap(double phi, double inc) {
  if (inc < 0.0) return phi > 0.0 ? phi : 1.0;
  const double left = 1.0 - phi;
  return left > 0.0 ? left : 1.0;
}

static void robin_place_phase(Robin& v, double phaseInto) {
  v.phase = wrap01(phaseInto);
  const double slope = v.phaseSlope;
  if (slope > 1.0e-15) v.sampleCount = v.phase / slope;
  else if (slope < -1.0e-15) v.sampleCount = (1.0 - v.phase) / (-slope);
  else v.sampleCount = 0.0;
  if (!(v.sampleCount >= 0.0) || !(v.sampleCount < v.lenNow)) v.sampleCount = 0.0;
}

// Reset / start phase (prime, partial Reset): land on a whole sample of the
// current cycle (math/robin_dither.h reset rule) so the next wrap stays on the grid.
static void robin_reset_grid(Robin& v, double target) {
  const double steps = v.lenNow >= 1.0 ? v.lenNow : 1.0;
  if (v.phaseSlope < -1.0e-15) {
    const double count = robin_grid_count(1.0 - target, steps);
    v.sampleCount = count;
    v.phase = wrap01(1.0 - count / steps);
  } else if (v.phaseSlope > 1.0e-15) {
    const double count = robin_grid_count(target, steps);
    v.sampleCount = count;
    v.phase = count / steps;
  } else {
    v.phase = wrap01(target);
    v.sampleCount = 0.0;
  }
}

static void robin_begin_cycle(Robin& v, unsigned int& rng, double phaseInto) {
  robin_bake(v, v.currentInc);
  robin_update_cycle_length(v, rng);
  robin_place_phase(v, phaseInto);
}

// Robin Update option 1 (Warp remaining): re-aim the rest of this cycle at the
// new increment, keep the wrap's dither residual, roll nothing mid-cycle.
static void robin_warp_remaining(Robin& v, unsigned int& rng, double newInc) {
  double phi = v.phase;
  if (!(phi == phi) || phi < 0.0) phi = 0.0;
  if (phi >= 1.0) phi = 0.0;
  v.currentInc = newInc;
  robin_bake(v, newInc);
  const double cyclesLeft = robin_cycles_until_wrap(phi, newInc);
  const double a = dsp_fabs(newInc);
  const double idealRemaining = (a > 1.0e-15) ? (cyclesLeft / a) : 1.0e9;
  double remaining = idealRemaining + v.ditherOffset;
  if (!(remaining > 1.0e-9) || remaining > 1.0e9) {
    if (!(remaining > 1.0e-9)) {
      robin_begin_cycle(v, rng, (newInc < 0.0) ? (phi - cyclesLeft) : (phi + cyclesLeft));
      return;
    }
    remaining = 1.0e9;
  }
  v.lenNow = v.sampleCount + remaining;
  if (!(v.lenNow > v.sampleCount)) {
    robin_begin_cycle(v, rng, (newInc < 0.0) ? (phi - cyclesLeft) : (phi + cyclesLeft));
    return;
  }
  const double mag = cyclesLeft / remaining;
  v.phaseSlope = (newInc < 0.0) ? -mag : mag;
}

// One Robin sample: apply this sample's increment (warp remaining), return the
// phase to read, then advance (robin_oscillator process loop).
static double robin_step(Robin& v, unsigned int& rng, double inc, double startPhase) {
  if (!v.primed) {
    v.currentInc = inc;
    v.ditherOffset = 0.0;
    robin_bake(v, inc);
    robin_update_cycle_length(v, rng);
    robin_reset_grid(v, startPhase);
    v.primed = true;
  } else {
    const double prev = v.currentInc;
    const double scale = dsp_fabs(prev);
    const double rel = (scale > 1.0e-15) ? (dsp_fabs(inc - prev) / scale) : (dsp_fabs(inc) > 1.0e-15 ? 1.0 : 0.0);
    if (rel > 1.0e-9) {
      if (!(dsp_fabs(inc) > 1.0e-15)) {
        v.currentInc = 0.0;
        robin_bake(v, 0.0);
        v.phaseSlope = 0.0;
      } else {
        robin_warp_remaining(v, rng, inc);
      }
    } else {
      v.currentInc = inc;
      if (!(dsp_fabs(inc) > 1.0e-15)) v.phaseSlope = 0.0;
    }
  }
  const double p = v.phase;
  if (dsp_fabs(v.currentInc) > 1.0e-15) {
    v.sampleCount += 1.0;
    v.phase += v.phaseSlope;
    if (v.sampleCount >= v.lenNow || v.phase >= 1.0 || v.phase < 0.0) robin_begin_cycle(v, rng, v.phase);
  }
  return p;
}

// Ellipsoid sharpness limit (ellipsoid.cpp ellipseCMin): omega = clamp(2 pi |f| / sr, 0, 1),
// here from the cycles/sample increment (2 pi |inc|).
static inline double ellipse_c_min(double absInc) {
  const double w = 6.283185307179586 * absInc;
  return w < 1.0 ? w : 1.0;
}

struct Chan {
  Noise noise;
  double phase;
  unsigned int ditherRng;
  double ditherOffset;
  bool ditherOn;
  Robin robin;    // Dithered Trisaw phasor (unprimed while another source plays)
  double instHz;  // last phase-increment Hz
  double pitch;   // last ♯/♭ pitch of instHz: MIDI note, 69 + 12 log2(|instHz| / 440)
  double env;     // last |Amplitude * Amp Mod gain| (display line brightness)
  double out;
};

struct State {
  bool active;
  Chan ch[2];
  unsigned int seed;
  bool seeded;
  // Morph-derived shape constants (recomputed when Morph changes).
  double lastMorph;
  double sqShape;           // Soft Square as Ellipsoid sine-to-square shape = 1 - sqrt(k / (1 + k))
  double ellB;              // Soft Tri (Ellipsoid Sym) B from Morph, before the AA floor
  Display disp;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"softpop_oscillator\","
    "\"label\":\"Softpop Oscillator\","
    "\"targetType\":\"softpopOscillator\","
    "\"kind\":\"oscillator\""
  "}";

static void reseed(State& s) {
  for (int c = 0; c < 2; c += 1) {
    Chan& ch = s.ch[c];
    noise_reset(ch.noise, s.seed, (unsigned int)c);
    ch.phase = 0.0;
    ch.ditherRng = seed_to_rng_state(seed_mix(s.seed, kSeedDither, (unsigned int)c));
    ch.ditherOffset = 0.0;
    ch.ditherOn = false;
    ch.robin = Robin{};
    ch.instHz = 0.0;
    ch.pitch = 0.0;
    ch.out = 0.0;
    ch.env = 0.0;
  }
  s.seeded = true;
}

static void update_morph(State& s, double morph) {
  if (morph == s.lastMorph) return;
  s.lastMorph = morph;
  const double m = morph;
  {
    const double mc = m > 0.0 ? (m < 1.0 ? m : 1.0) : 0.0;
    const double cs = dsp_cos(1.5707963267948966 * mc);
    s.sqShape = 1.0 - __builtin_sqrt(cs > 0.0 ? cs : 0.0);
  }
  s.ellB = m > 0.0 ? __builtin_sqrt(m < 1.0 ? m : 1.0) : 0.0;
}

// Ellipsoid Sym (soundemote.dev stEllipsoidSymY), B already floored.
static inline double ellipsoid_sym(double t, double B) {
  const double bb = B * B;
  const double c = -dsp_sin_turns(t);  // cos(2 pi t + pi/2)
  const double ca = 1.0 - c;
  const double cb = 1.0 + c;
  const double d1 = __builtin_sqrt(ca + bb * cb);
  const double d2 = __builtin_sqrt(cb + bb * ca);
  const double par1 = d1 > 1.0e-18 ? ca / d1 : 0.0;
  const double par2 = d2 > 1.0e-18 ? cb / d2 : 0.0;
  const double c1 = par1 + kEllC * (par1 - par1 * par1);
  const double c2 = par2 + kEllC * (par2 - par2 * par2);
  return (c1 - c2) * 0.7071067811865476 * kEllNorm;
}

static double render_chan(State& s, Chan& ch, int src, double morph, int color, double fEff,
                          double pitchCents, double ampMod, double amp, double sr) {
  const double fInst = noise_step(ch.noise, color, fEff, pitchCents);
  const double nyq = 0.5 * sr;
  double f = fInst;
  if (f > nyq) f = nyq;
  if (f < -nyq) f = -nyq;
  const double ph = ch.phase;
  const double inc = f / sr;
  const double next = ph + inc;
  const double wrapped = next - dsp_floor(next);
  const bool wrap = wrapped != next;
  ch.phase = wrapped;
  ch.instHz = f;
  {
    // ♯/♭ out: the exact Hz the oscillator steps with (after the Nyquist
    // clamp), as a MIDI note at A4 = 440 (graph pitch cable law). Through-
    // zero / negative Hz report |f|; |f| below 1e-9 Hz reports 1e-9 Hz.
    const double af = f < 0.0 ? -f : f;
    ch.pitch = 69.0 + 12.0 * (dsp_ln((af > 1.0e-9 ? af : 1.0e-9) / 440.0) * 1.4426950408889634);
  }

  const bool dither = src == kSrcDitherSine;
  if (src != kSrcTrisaw) ch.robin.primed = false;
  if (dither) {
    const double absInc = inc < 0.0 ? -inc : inc;
    if (!(absInc > 1.0e-15)) {
      ch.ditherOffset = 0.0;
      ch.ditherOn = false;
    } else if (!ch.ditherOn || wrap) {
      ch.ditherOffset = soemdsp_ellipsoid_robin_dither_cycles(&ch.ditherRng, 1.0 / absInc);
      ch.ditherOn = true;
    }
  } else {
    ch.ditherOn = false;
    ch.ditherOffset = 0.0;
  }

  double x;
  switch (src) {
    case kSrcDitherSine: x = dsp_sin_turns(wrap01(ph + morph * ch.ditherOffset)); break;
    case kSrcTrisaw: x = naive_trisaw_center(robin_step(ch.robin, ch.ditherRng, inc, ph), morph); break;
    case kSrcSoftSquare:
      // Same Ellipsoid code path and AA Limit; phase - 1/4 turns its cos into sin.
      x = soemdsp_ellipsoid_sine_to_square_aa(ph - 0.25, s.sqShape, f < 0.0 ? -f : f, sr, 1);
      break;
    case kSrcPolyBlepTri:
      x = soemdsp_polyblep_trisaw_center(ph, inc < 0.0 ? -inc : inc, morph);
      break;
    case kSrcSoftTri: {
      const double bMin = ellipse_c_min(inc < 0.0 ? -inc : inc);
      x = ellipsoid_sym(ph, s.ellB > bMin ? s.ellB : bMin);
      break;
    }
    default: x = dsp_sin_turns(ph); break;
  }
  const double env = amp_mod_gain(ampMod, ch.noise.na) * amp;
  ch.env = env < 0.0 ? -env : env;
  ch.out = safety_limit(x * env);
  return ch.out;
}

static State* live(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return nullptr;
  return &gPool[handle - 1];
}

}  // namespace

extern "C" int soemdsp_softpop_oscillator_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s = State{};
      s.lastMorph = 0.0 / 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_softpop_oscillator_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Reset edge: reseed every generator (noise + dither) from Seed, zero phase.
extern "C" void soemdsp_softpop_oscillator_reset(int handle) {
  if (State* s = live(handle)) reseed(*s);
}

// One frame. freqHz = fEff (graph_engine resolve_osc_hz). source: choiceId
// 0 Sine / 1 Dithered Sine / 2 Dithered Trisaw / 3 Soft Square / 4 Soft Tri / 5 PolyBLEP Trisaw.
// color: 0 White / 1 Gaussian / 2 Average / 3 Pink / 4 Brown. Returns Mono (= the L channel render).
extern "C" double soemdsp_softpop_oscillator_sample(
  int handle,
  double freqHz,
  double source,
  double morph,
  double pitchModCents,
  double ampMod,
  double amplitude,
  double color,
  double seedValue,
  double sampleRate
) {
  State* sp = live(handle);
  if (!sp) return 0.0;
  State& s = *sp;
  const double sr = sampleRate > 1.0 ? sampleRate : 44100.0;
  const unsigned int seed = seed_param_u32(seedValue);
  if (!s.seeded || seed != s.seed) {
    s.seed = seed;
    reseed(s);
  }
  int src = (int)(safe(source) + 0.5);
  if (src < kSrcSine || src > kSrcPolyBlepTri) src = kSrcSine;
  const double m = safe(morph);
  update_morph(s, m);
  const int c = color_index(color);
  const double fEff = safe(freqHz);
  double cents = safe(pitchModCents);
  const double am = safe(ampMod);
  const double amp = safe(amplitude);
  const double l = render_chan(s, s.ch[0], src, m, c, fEff, cents, am, amp, sr);
  // Display in pitch: fEff * exp(np s), the symmetric log-pitch offset around
  // the note. Not the audio's mean-corrected Hz (its -s^2/2 would sit the
  // pitch median below the note) and not Nyquist-clamped.
  const double dispHz = s.disp.armed > 0.0 && cents != 0.0
    ? fEff * dsp_exp(s.ch[0].noise.np * cents * (kLn2 / 1200.0)) : fEff;
  display_note(s.disp, 1, fEff, 0.0, cents, sr, dispHz, s.ch[0].env < 1.0 ? s.ch[0].env : 1.0);
  render_chan(s, s.ch[1], src, m, c, fEff, cents, am, amp, sr);
  return l;
}

extern "C" double soemdsp_softpop_oscillator_left(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[0].out;
}

extern "C" double soemdsp_softpop_oscillator_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[1].out;
}

extern "C" double soemdsp_softpop_oscillator_noise(int handle, int ch) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[ch & 1].noise.audio;
}

extern "C" double soemdsp_softpop_oscillator_pitch(int handle, int ch) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[ch & 1].pitch;
}

// Test probe: 0/1 n_pitch L/R, 2/3 n_amp L/R, 4/5 N_audio L/R, 6/7 phase-
// increment Hz L/R, 9/10 CV L/R (octaves), 11/12 ♯/♭ pitch L/R (MIDI).
extern "C" double soemdsp_softpop_oscillator_probe(int handle, int which) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  const State& s = gPool[handle - 1];
  const Chan& ch = s.ch[which & 1];
  switch (which) {
    case 0: case 1: return ch.noise.np;
    case 2: case 3: return ch.noise.na;
    case 4: case 5: return ch.noise.audio;
    case 6: case 7: return ch.instHz;
    case 9: return s.ch[0].noise.cv;
    case 10: return s.ch[1].noise.cv;
    case 11: return s.ch[0].pitch;
    case 12: return s.ch[1].pitch;
    default: return 0.0;
  }
}

extern "C" int soemdsp_softpop_oscillator_display_bin_count() { return kDisplayBins; }

extern "C" double soemdsp_softpop_oscillator_display_bin(int handle, int index) {
  if (handle < 1 || handle > kMaxInstances || index < 0 || index >= kDisplayBins) return 0.0;
  return gPool[handle - 1].disp.bins[index];
}

extern "C" double soemdsp_softpop_oscillator_display_take(int handle) {
  State* s = live(handle);
  return s ? display_take(s->disp) : 0.0;
}

extern "C" double soemdsp_softpop_oscillator_display_info(int handle, int which) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return display_info(gPool[handle - 1].disp, which);
}

extern "C" int soemdsp_softpop_oscillator_version() { return 6; } // 6: Dithered Trisaw resets land on the sample grid (math/robin_dither.h). was 5: PolyBLEP Trisaw (source 5); Dithered Trisaw renamed Dithered Trisaw
extern "C" const char* soemdsp_softpop_oscillator_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_softpop_oscillator_metadata_json_size() { return sizeof(kMetadataJson) - 1; }

// Reset trigger below full height: move the phase |h| of the way to where a
// full Reset puts it (h < 0 the long way round); nothing else is cleared.
// Full-height hits (|h| = 1) use the full reset above.
extern "C" void soemdsp_softpop_oscillator_partial_reset(int handle, double h) {
  if (State* s = live(handle)) {
    for (int c = 0; c < 2; c += 1) {
      Chan& ch = s->ch[c];
      ch.phase = soemdsp::math::partial_reset_phase(ch.phase, 0.0, h);
      // Dithered Trisaw: its Robin phasor moves too, onto the sample grid.
      if (ch.robin.primed) robin_reset_grid(ch.robin, soemdsp::math::partial_reset_phase(ch.robin.phase, 0.0, h));
    }
  }
}
