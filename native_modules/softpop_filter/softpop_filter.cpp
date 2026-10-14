// soemdsp-native-module: softpop_filter
// soemdsp-native-label: Softpop Filter
// soemdsp-native-target: softpopFilter
// soemdsp-native-kind: filter
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp-sandbox/blob/master/docs/SOFTPOP_PLAN.md
//
// Softpop Filter: noise (or external audio) through a constant-peak TPT SVF
// bandpass whose centre is |fInst| (Frequency + mean-corrected Pitch Mod) and
// whose Q comes from Width. Shared Softpop parts (noise, Pitch Mod, Width -> Q,
// display): native_modules/softpop_oscillator/softpop_core.h.
//
// Source per channel: the internal Color noise N_audio, or, when any audio
// input is wired (useInput), the routed external input instead (replace, not
// add). Input routing is soemdsp/routing/stereo_route.h, resolved by
// graph_engine: Mono alone / a lone Left / a lone Right -> m = M + L + R into
// both channels; Left and Right both wired -> L + M and R + M.
// Level: noise is trimmed so the Filter RMS matches the Oscillator's sine
// (below); external input gets the plain constant-peak BP (0 dB at the centre).
// Outputs: Mono = the L channel render, Left, Right, Left/Right Noise =
// N_audio (Color-shaped, unit RMS, always the internal noise), Left/Right CV =
// log2(fInst / fEff) in octaves.
//
// Noise level: constant-peak BP band power on a source of PSD S(f) is
// S(fc) * w/(2Q_d) with the decramped Q_d = Q sin(w)/w, w = 2 pi fc / fs
// (analog noise bandwidth pi fc/(Q fs) at every fc). sqrt(Q) cancels Width; T_color(fc) =
// (1000/fc)^(alpha/2) * sqrt(sin w1k/w1k) flattens the keyboard
// (alpha = +1 white, 0 pink, -0.95 brown (measured); fc clamped to 20 Hz .. 0.45 fs);
// k_color sets the 1 kHz Filter RMS to the Sine RMS (1/sqrt 2).

#include "../softpop_oscillator/softpop_core.h"

namespace {

using namespace soemdsp_maths;
using namespace softpop;

static const int kMaxInstances = 64;
static const double kRefSampleRate = 48000.0;

// k_color: 1 kHz Filter RMS = 1/sqrt 2 (the Sine RMS) at 48 kHz, W = 0.3.
// White and pink: exact digital band power of the BP on the source PSD (flat;
// Kellet taps), confirmed by simulation to 0.013 / 0.004 dB. Brown: measured
// (node scripts/test_softpop_filter.mjs --calibrate, 3000 s); the clamped
// walk sits 0.2 dB under the pure-integrator estimate 7.3484.
static const double kFilterGain[3] = {2.7684485757734305, 1.721692744960082, 7.51834};
// Tilt exponent alpha (T = (1000/fc)^(alpha/2)). Brown is measured (residual
// slope +0.143 dB/oct over 50 Hz..10 kHz, i.e. alpha -1 + 0.048).
static const double kTiltAlpha[3] = {1.0, 0.0, -0.95};

struct Chan {
  Noise noise;
  TptSvfState svf;
  double instHz;
  double out;
};

struct State {
  bool active;
  Chan ch[2];
  unsigned int seed;
  bool seeded;
  // Width-derived (recomputed when Width / Color / fs change).
  double lastWidth, lastSr;
  int lastColor;
  double q, sqrtQ;
  double widthGain;  // Pink broad-Q correction (1 for white / brown)
  double warpRef;    // sin(w1k) / w1k at lastSr
  double tiltSr;     // lastSr / 48 kHz
  Display disp;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"softpop_filter\","
    "\"label\":\"Softpop Filter\","
    "\"targetType\":\"softpopFilter\","
    "\"kind\":\"filter\""
  "}";

// atan(t) for t >= 0: three half-angle reductions, then the odd series to
// t^15 (error < 1e-13). Only used on Width changes.
static double atan_pos(double t) {
  for (int i = 0; i < 3; i += 1) t = t / (1.0 + __builtin_sqrt(1.0 + t * t));
  const double t2 = t * t;
  double sum = 0.0;
  for (int k = 15; k >= 1; k -= 2) sum = sum * t2 + ((((k - 1) / 2) & 1) ? -1.0 : 1.0) / (double)k;
  return 8.0 * t * sum;
}

// Pink Width correction: constant-peak BP band power on a 1/f source is
// I(Q) = 2 x acos(x) / sqrt(1 - x^2) (x = 1/(2Q)), not the narrowband pi x.
static double pink_width_gain(double q) {
  double x = 0.5 / q;
  if (x > 1.0) x = 1.0;
  const double acosx = 2.0 * atan_pos(sqrt_pos((1.0 - x) / (1.0 + x)));
  if (acosx < 1.0e-9) return __builtin_sqrt(0.5 * kPI);
  return sqrt_pos(kPI * sqrt_pos(1.0 - x * x) / (2.0 * acosx));
}

static void update_width(State& s, double width, int color, double sr) {
  if (width == s.lastWidth && color == s.lastColor && sr == s.lastSr) return;
  s.lastWidth = width;
  s.lastColor = color;
  s.lastSr = sr;
  s.q = width_to_q(width);
  s.sqrtQ = sqrt_pos(s.q);
  s.widthGain = color == kColorPink ? pink_width_gain(s.q) : 1.0;
  const double w1k = kTwoPi * 1000.0 / sr;
  s.warpRef = dsp_sin(w1k) / w1k;
  s.tiltSr = sr / kRefSampleRate;
}

static void reseed(State& s) {
  for (int c = 0; c < 2; c += 1) {
    Chan& ch = s.ch[c];
    noise_reset(ch.noise, s.seed, (unsigned int)c);
    tpt_svf_reset(ch.svf);
    ch.instHz = 0.0;
    ch.out = 0.0;
  }
  s.seeded = true;
}

// T_color(fc) times the bilinear-warp term, normalised at 1 kHz.
static double tilt_warp(const State& s, double fc, int color, double sr) {
  const double lo = 20.0;
  const double hi = 0.45 * sr;
  const double f = fc < lo ? lo : (fc > hi ? hi : fc);
  const double warp = sqrt_pos(s.warpRef);
  const double alpha = kTiltAlpha[color];
  if (alpha == 0.0) return warp;
  return warp * pow_pos_d((1000.0 / f) * s.tiltSr, 0.5 * alpha);
}

static double render_chan(State& s, Chan& ch, int color, double fEff, double pitchCents,
                          double ampMod, double amp, double sr, bool useInput, double in) {
  const double fInst = noise_step(ch.noise, color, fEff, pitchCents);
  // Centre |fInst|, clamped to 0.49 fs (the SVF needs w < pi).
  double fc = fInst < 0.0 ? -fInst : fInst;
  const double fcMax = 0.49 * sr;
  if (fc > fcMax) fc = fcMax;
  TptSvfCoeffs k;
  // Decramp: Q * sin(w)/w makes the digital -3 dB width w/Q, the analog fc/Q in Hz.
  const double wc = kTwoPi * fc / sr;
  const double r = 1.0 / (wc > 1.0e-9 ? s.q * dsp_sin(wc) / wc : s.q);
  // Trims scale the input of a plain BP (yB tap), so a fast Width / centre
  // move never rescales energy the SVF stored under the old setting.
  tpt_svf_setup(k, wc, r, 0.0, 1.0, 0.0, 1.0);
  const double x = useInput
    ? tpt_svf_tick(ch.svf, k, in * r)
    : tpt_svf_tick(ch.svf, k, ch.noise.audio * (r * kFilterGain[color] * s.sqrtQ * s.widthGain * tilt_warp(s, fc, color, sr)));
  ch.instHz = fInst < 0.0 ? -fc : fc;
  ch.out = safety_limit(x * amp_mod_gain(ampMod, ch.noise.na) * amp);
  return ch.out;
}

static State* live(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return nullptr;
  return &gPool[handle - 1];
}

}  // namespace

extern "C" int soemdsp_softpop_filter_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s = State{};
      s.lastWidth = 0.0 / 0.0;
      s.lastSr = 0.0 / 0.0;
      s.lastColor = -1;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_softpop_filter_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Reset edge: reseed every generator from Seed and clear the SVFs.
extern "C" void soemdsp_softpop_filter_reset(int handle) {
  if (State* s = live(handle)) reseed(*s);
}

// One frame. freqHz = fEff (graph_engine resolve_osc_hz). inL / inR = the
// routed external input per channel (stereo_route.h); useInput != 0 filters
// them instead of the internal noise. color: choiceId 0 white / 1 pink / 2 brown.
// Returns Mono (= the L channel render).
extern "C" double soemdsp_softpop_filter_sample(
  int handle,
  double freqHz,
  double inL,
  double inR,
  double useInput,
  double width,
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
  const int c = color_index(color);
  update_width(s, safe(width), c, sr);
  const double fEff = safe(freqHz);
  double cents = safe(pitchModCents);
  if (cents < 0.0) cents = 0.0;
  const double am = clamp(safe(ampMod), 0.0, 1.0);
  const double amp = safe(amplitude);
  const bool use = safe(useInput) > 0.5;
  const double l = render_chan(s, s.ch[0], c, fEff, cents, am, amp, sr, use, safe(inL));
  display_note(s.disp, 0, fEff, s.q, cents, sr, s.ch[0].instHz);
  render_chan(s, s.ch[1], c, fEff, cents, am, amp, sr, use, safe(inR));
  return l;
}

extern "C" double soemdsp_softpop_filter_left(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[0].out;
}

extern "C" double soemdsp_softpop_filter_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[1].out;
}

extern "C" double soemdsp_softpop_filter_noise(int handle, int ch) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[ch & 1].noise.audio;
}

extern "C" double soemdsp_softpop_filter_cv(int handle, int ch) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[ch & 1].noise.cv;
}

// Test probe: 0/1 n_pitch L/R, 2/3 n_amp L/R, 4/5 N_audio L/R, 6/7 fInst
// (centre) L/R Hz, 8 Q, 9/10 CV L/R.
extern "C" double soemdsp_softpop_filter_probe(int handle, int which) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  const State& s = gPool[handle - 1];
  const Chan& ch = s.ch[which & 1];
  switch (which) {
    case 0: case 1: return ch.noise.np;
    case 2: case 3: return ch.noise.na;
    case 4: case 5: return ch.noise.audio;
    case 6: case 7: return ch.instHz;
    case 8: return s.q;
    case 9: return s.ch[0].noise.cv;
    case 10: return s.ch[1].noise.cv;
    default: return 0.0;
  }
}

extern "C" int soemdsp_softpop_filter_display_bin_count() { return kDisplayBins; }

extern "C" double soemdsp_softpop_filter_display_bin(int handle, int index) {
  if (handle < 1 || handle > kMaxInstances || index < 0 || index >= kDisplayBins) return 0.0;
  return gPool[handle - 1].disp.bins[index];
}

extern "C" double soemdsp_softpop_filter_display_take(int handle) {
  State* s = live(handle);
  return s ? display_take(s->disp) : 0.0;
}

extern "C" double soemdsp_softpop_filter_display_info(int handle, int which) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return display_info(gPool[handle - 1].disp, which);
}

extern "C" int soemdsp_softpop_filter_version() { return 1; }
extern "C" const char* soemdsp_softpop_filter_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_softpop_filter_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
