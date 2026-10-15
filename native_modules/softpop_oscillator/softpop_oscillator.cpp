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
//   2 Trisaw        naive_trisaw(phi + d, Morph) (soemdsp library), full dither.
//                   Morph = peak position (0.5 triangle, 0 / 1 saw-like).
//   3 Soft Square   soundemote.dev /softsquare SquareToSine (hyperbolic soft clip
//                   of a sine): S = sin(2 pi phi), y = S sqrt(1+k) / sqrt(S^2 + k),
//                   k = 10^(4 - 8 Morph) (Morph 0 = k 1e4, sine within ~1e-4;
//                   0.5 = site default k 1; 1 = k 1e-4, near-hard square). sin + sqrt per sample.
//   4 Soft Tri      soundemote.dev /softtriangle "Diroxe tri" (KVR p=9310541,
//                   one sqrt per sample): per half cycle x in [0,1), b = x - 0.5,
//                   y = +-g (rr - sqrt(b^2 + k)), rr = sqrt(0.25 + k),
//                   g = 4 (rr + sqrt k), k = 0.16 Morph^4
//                   (Morph 0 = sharp triangle, 0.5 = site default k 0.01, 1 = k 0.16, rounded).
// Outputs: Mono = the L channel render, Left, Right, Noise L/R = the
// audio noise stream N_audio (Color-shaped, unit RMS), ♯/♭ L/R = the
// pitch the oscillator actually steps with, as a MIDI note (A4 = 440).

#include "softpop_core.h"

// Robin cycle-length dither pick: one copy, in native_modules/ellipsoid
// (resolved in the combined link; standalone builds allow it undefined).
extern "C" double soemdsp_ellipsoid_robin_dither_cycles(unsigned int* rng, double cycleSamples);

namespace {

using namespace soemdsp_maths;
using namespace softpop;

static const int kMaxInstances = 64;

enum { kSrcSine = 0, kSrcDitherSine = 1, kSrcTrisaw = 2, kSrcSoftSquare = 3, kSrcSoftTri = 4 };

struct Chan {
  Noise noise;
  double phase;
  unsigned int ditherRng;
  double ditherOffset;
  bool ditherOn;
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
  double sqK, sqNorm;       // Soft Square (SquareToSine) k, sqrt(1 + k)
  double triK, triR, triG;  // Soft Tri k, rr, g
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
  s.sqK = pow_pos_d(10.0, 4.0 - 8.0 * m);
  s.sqNorm = __builtin_sqrt(1.0 + s.sqK);
  s.triK = 0.16 * m * m * m * m;
  s.triR = __builtin_sqrt(0.25 + s.triK);
  s.triG = 4.0 * (s.triR + __builtin_sqrt(s.triK));
}

static inline double soft_tri(const State& s, double t) {
  const double u = wrap01(t);
  const bool first = u < 0.5;
  const double b = (first ? u * 2.0 : u * 2.0 - 1.0) - 0.5;
  const double y = s.triG * (s.triR - __builtin_sqrt(b * b + s.triK));
  return first ? y : -y;
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

  const bool dither = src == kSrcDitherSine || src == kSrcTrisaw;
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
    case kSrcTrisaw: x = naive_trisaw(ph + ch.ditherOffset, morph); break;
    case kSrcSoftSquare: { const double sn = dsp_sin_turns(ph); x = sn * s.sqNorm / __builtin_sqrt(sn * sn + s.sqK); break; }
    case kSrcSoftTri: x = soft_tri(s, ph); break;
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
// 0 Sine / 1 Dithered Sine / 2 Trisaw / 3 Soft Square / 4 Soft Tri.
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
  if (src < kSrcSine || src > kSrcSoftTri) src = kSrcSine;
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

extern "C" int soemdsp_softpop_oscillator_version() { return 3; }
extern "C" const char* soemdsp_softpop_oscillator_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_softpop_oscillator_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
