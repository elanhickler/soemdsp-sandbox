// soemdsp-native-module: softpop2
// soemdsp-native-label: Softpop 2
// soemdsp-native-target: softpop2
// soemdsp-native-kind: oscillator
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp-sandbox/blob/master/docs/SOFTPOP2_PLAN.md
//
// Softpop 2: a sine dispersing into band-limited Color noise centred on its
// own pitch. Crossfade fades sine → noise. Bandwidth over Crossfade scales
// how far the band opens (Softpop Filter Width curve on b·c). Amp over
// Crossfade squares a fade-to-silence on top. Pitch Mod over Crossfade
// wobbles only the sine with White noise (0…2400 cents); Color is the band.
// Shared: softpop_core.h, tpt_svf.h, noise_colors.h, softpop_band.h, seed.h.

#include "../softpop_oscillator/softpop_core.h"
#include <soemdsp/filter/softpop_band.h>

namespace {

using namespace soemdsp_maths;
using namespace softpop;

static const int kMaxInstances = 64;
static const unsigned int kSeedNoise = kSeedAudio;
static const double kPitchModCents = 2400.0;

struct Chan {
  NoiseColorChannel noise;
  NoiseColorExt ext;
  TptSvfState svf;
  double out;
};

struct State {
  bool active;
  Chan ch[2];
  Noise pitch;   // L sine Pitch Mod (channel 0 stream)
  Noise pitchR;  // R sine Pitch Mod (channel 1 stream)
  double phase;
  double phaseR;
  unsigned int seed;
  bool seeded;
  double lastWidth, lastSr;
  int lastColor;
  double q, sqrtQ, widthGain;
  SoftpopTilt tilt;
  Display disp;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"softpop2\","
    "\"label\":\"Softpop 2\","
    "\"targetType\":\"softpop2\","
    "\"kind\":\"oscillator\""
  "}";

static void reseed(State& s) {
  for (int c = 0; c < 2; c += 1) {
    Chan& ch = s.ch[c];
    noise_color_reset(ch.noise, seed_to_rng_state(seed_mix(s.seed, kSeedNoise, (unsigned int)c)));
    noise_color_ext_reset(ch.ext);
    tpt_svf_reset(ch.svf);
    ch.out = 0.0;
  }
  noise_reset(s.pitch, s.seed, 0);
  noise_reset(s.pitchR, s.seed, 1);
  s.phase = 0.0;
  s.phaseR = 0.0;
  s.seeded = true;
}

static void update_band(State& s, double width, int color, double sr) {
  if (width == s.lastWidth && color == s.lastColor && sr == s.lastSr) return;
  s.lastWidth = width;
  s.lastColor = color;
  s.lastSr = sr;
  s.q = width_to_q(clamp(width, 0.0, 1.0));
  s.sqrtQ = sqrt_pos(s.q);
  s.widthGain = softpop_width_gain(color, s.q);
  softpop_tilt_prepare(s.tilt, sr);
}

static double noise_band(State& s, Chan& ch, int color, double fc, double sr) {
  const double n = color_sample(ch.noise, ch.ext, color);
  TptSvfCoeffs k;
  const double wc = kTwoPi * fc / sr;
  const double r = 1.0 / softpop_q_decramp(s.q, wc);
  tpt_svf_setup(k, wc, r, 0.0, 1.0, 0.0, 1.0);
  const double g = r * softpop_filter_gain(color) * s.sqrtQ * s.widthGain
    * softpop_tilt_warp(s.tilt, fc, color, sr);
  return tpt_svf_tick(ch.svf, k, n * g);
}

static State* live(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return nullptr;
  return &gPool[handle - 1];
}

}  // namespace

extern "C" int soemdsp_softpop2_create() {
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

extern "C" void soemdsp_softpop2_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_softpop2_reset(int handle) {
  if (State* s = live(handle)) reseed(*s);
}

// One frame. freqHz = fEff (graph_engine resolve_osc_hz). crossfade 0 = sine,
// 1 = full noise. bandwidthOver 0 = band stays tight, 1 = Width curve opens
// with Crossfade (Q = 2000·(0.5/2000)^(b·c)). ampOver 0 = constant loudness,
// 1 = silence at Crossfade 1. pitchOver: White-noise cents on the sine only,
// cents = p·c·2400 (none at Crossfade 0, full at 1). Color is the band.
extern "C" double soemdsp_softpop2_sample(
  int handle,
  double freqHz,
  double crossfade,
  double ampOver,
  double bandwidthOver,
  double pitchOver,
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
  double xf = clamp(safe(crossfade), 0.0, 1.0);
  double ao = clamp(safe(ampOver), 0.0, 1.0);
  double bw = clamp(safe(bandwidthOver), 0.0, 1.0);
  double po = clamp(safe(pitchOver), 0.0, 1.0);
  const double amp = safe(amplitude);
  update_band(s, xf * bw, c, sr);

  double f = safe(freqHz);
  const double nyq = 0.5 * sr;
  if (f > nyq) f = nyq;
  if (f < -nyq) f = -nyq;
  double fc = f < 0.0 ? -f : f;
  if (fc < 1.0) fc = 1.0;
  const double fcMax = 0.49 * sr;
  if (fc > fcMax) fc = fcMax;

  const double cents = po * xf * kPitchModCents;
  double fSine = noise_step(s.pitch, kColorWhite, f, cents);
  if (fSine > nyq) fSine = nyq;
  if (fSine < -nyq) fSine = -nyq;
  const double ph = s.phase;
  const double inc = fSine / sr;
  const double next = ph + inc;
  s.phase = next - dsp_floor(next);
  const double sine = dsp_sin_turns(ph);
  // R: same Frequency, its own Pitch Mod stream and phasor (identical to L at Pitch Mod 0).
  double fSineR = noise_step(s.pitchR, kColorWhite, f, cents);
  if (fSineR > nyq) fSineR = nyq;
  if (fSineR < -nyq) fSineR = -nyq;
  const double phR = s.phaseR;
  const double nextR = phR + fSineR / sr;
  s.phaseR = nextR - dsp_floor(nextR);
  const double sineR = dsp_sin_turns(phR);

  const double nL = noise_band(s, s.ch[0], c, fc, sr);
  const double nR = noise_band(s, s.ch[1], c, fc, sr);
  const double cw = dsp_cos(kPIz2 * xf);
  const double sw = dsp_sin(kPIz2 * xf);
  const double fade = 1.0 - ao * xf;
  const double env = amp * fade * fade;
  s.ch[0].out = safety_limit((cw * sine + sw * nL) * env);
  s.ch[1].out = safety_limit((cw * sineR + sw * nR) * env);

  const double envAbs = env < 0.0 ? -env : env;
  const double dispHz = s.disp.armed > 0.0 && cents != 0.0
    ? f * dsp_exp(s.pitch.np * cents * (kLn2 / 1200.0)) : f;
  display_note(s.disp, 1, f, 0.0, cents, sr, dispHz, envAbs < 1.0 ? envAbs : 1.0);
  return s.ch[0].out;
}

extern "C" double soemdsp_softpop2_left(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[0].out;
}

extern "C" double soemdsp_softpop2_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[1].out;
}

extern "C" int soemdsp_softpop2_display_bin_count() { return kDisplayBins; }

extern "C" double soemdsp_softpop2_display_bin(int handle, int index) {
  if (handle < 1 || handle > kMaxInstances || index < 0 || index >= kDisplayBins) return 0.0;
  return gPool[handle - 1].disp.bins[index];
}

extern "C" double soemdsp_softpop2_display_take(int handle) {
  State* s = live(handle);
  return s ? display_take(s->disp) : 0.0;
}

extern "C" double soemdsp_softpop2_display_info(int handle, int which) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return display_info(gPool[handle - 1].disp, which);
}

extern "C" int soemdsp_softpop2_version() { return 7; }
extern "C" const char* soemdsp_softpop2_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_softpop2_metadata_json_size() { return sizeof(kMetadataJson) - 1; }

// Reset trigger below full height: move the phase |h| of the way to where a
// full Reset puts it (h < 0 the long way round); nothing else is cleared.
// Full-height hits (|h| = 1) use the full reset above.
extern "C" void soemdsp_softpop2_partial_reset(int handle, double h) {
  if (State* s = live(handle)) {
    s->phase = soemdsp::math::partial_reset_phase(s->phase, 0.0, h);
    s->phaseR = soemdsp::math::partial_reset_phase(s->phaseR, 0.0, h);
  }
}
