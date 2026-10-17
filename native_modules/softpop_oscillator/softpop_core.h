// Softpop shared core (module-local, not library): used by
// native_modules/softpop_oscillator/softpop_oscillator.cpp and
// native_modules/softpop_filter/softpop_filter.cpp. One copy of the parts both
// modules run: Color noise streams + calibration, the mean-corrected Pitch Mod,
// Width -> Q, the bandpass magnitude law, Amp Mod, the safety limiter and the
// face-display histogram (public/modules/softpopOscillator/softpop-display.js).
//
// Pitch Mod (per channel, per sample):
//   n_pitch = clamp(N_pitch * cal_color, +-4)   (unit RMS, full band)
//   Average: n_pitch = (w[n] + w[n-1]) / sqrt(2) of the clamped Gaussian w
//   (unit std, null at Nyquist; Pitch Mod only, Amp Mod / Noise stay Gaussian)
//   e = n_pitch * s - c,  s = cents * ln2 / 1200, c = ln E[exp(n_pitch s)] so mean(fInst) = fEff:
//   Gaussian / Average / Pink / Brown: c = s^2 / 2 (lognormal);
//   White (uniform on +-sqrt3): c = ln(sinh(a) / a), a = sqrt3 s (a^2/6 = s^2/2 for tiny a).
//   c is cached per (cents, Color), not computed per sample.
//   fInst = fEff * exp(e), CV = e / ln2 (octaves)
// Width W (0..1): Q = 2000 * (0.5/2000)^W.
// Bandpass law (constant-peak BP, decramped so the analog curve is what plays):
//   |H(f)| = 1 / sqrt(1 + Q^2 (f/fc - fc/f)^2)
// Included inside each module's TU only; everything has internal linkage.
#pragma once

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/math/noise_colors_ext.h>

namespace {
namespace softpop {

using namespace soemdsp_maths;

// seed_mix component ids (fixed, never reordered).
static const unsigned int kSeedPitch = 0x5F01u;
static const unsigned int kSeedAmp = 0x5F02u;
static const unsigned int kSeedAudio = 0x5F03u;
static const unsigned int kSeedDither = 0x5F04u;  // Oscillator dither stream

// Color choices (choiceIds): White = flat U(-1,1) * sqrt 3, Gaussian = CLT-12,
// Average = Gaussian streams + 2-tap averaged Pitch Mod noise, Pink, Brown,
// Blue (+3 dB/oct), Violet (+6 dB/oct). Blue/Violet appended so saved indices stay valid.
enum {
  kColorWhite = 0,
  kColorGaussian = 1,
  kColorAverage = 2,
  kColorPink = 3,
  kColorBrown = 4,
  kColorBlue = 5,
  kColorViolet = 6,
  kColorCount = 7
};

static const double kLn2 = 0.6931471805599453;
static const double kQMax = 2000.0;   // Width 0
static const double kQMin = 0.5;      // Width 1
static const double kModClamp = 4.0;  // n_pitch / n_amp clamp (sigma)

// Unit-RMS calibration per Color. White: U(-1,1) var 1/3 -> sqrt 3.
// Gaussian / Average: CLT-12, already unit.
// Pink: 1 / sqrt(sum of squares of the Kellet impulse response * 1/3)
// (analytic, var 0.0375777). Brown: clamped walk measured variance 0.343276
// (4000 chains x 1.2 M steps; uniform would be 1/3).
// Violet: first difference of U(-1,1), var 2/3 -> sqrt(3/2).
// Blue: measured (differentiated Kellet pink).
static const double kCalColor[kColorCount] = {
  1.7320508075688772,
  1.0,
  1.0,
  5.15863561638852,
  1.7067830316927417,
  8.67555230,          // Blue: 1 / RMS of differentiated Kellet pink
  1.224744871391589    // Violet: sqrt(3/2)
};

// Face display: log 20 Hz .. 20 kHz histogram of the L channel's |fInst|.
static const int kDisplayBins = 256;
static const double kDisplayLoHz = 20.0;
static const double kDisplayHiHz = 20000.0;
static const double kDisplayArmSeconds = 2.0;

static inline double sqrt_pos(double x) { return x > 0.0 ? __builtin_sqrt(x) : 0.0; }
static inline double pow_pos_d(double base, double e) { return dsp_exp(e * dsp_ln(base)); }

static inline int color_index(double color) {
  int c = (int)(safe(color) + 0.5);
  if (c < kColorWhite) c = kColorWhite;
  if (c > kColorViolet) c = kColorViolet;
  return c;
}

static inline double width_to_q(double width) {
  return kQMax * pow_pos_d(kQMin / kQMax, clamp(width, 0.0, 1.0));
}

static inline double color_sample(NoiseColorChannel& n, NoiseColorExt& ext, int color) {
  if (color == kColorPink) return noise_color_sample(n, 3, 0.0, 1.0, 0.0) * kCalColor[kColorPink];
  if (color == kColorBrown) return noise_color_sample(n, 2, 0.0, 1.0, 0.0) * kCalColor[kColorBrown];
  if (color == kColorWhite) return noise_color_sample(n, 0, 0.0, 1.0, 0.0) * kCalColor[kColorWhite];
  if (color == kColorBlue) return noise_color_sample_ext(n, ext, 5, 0.0, 1.0, 0.0) * kCalColor[kColorBlue];
  if (color == kColorViolet) return noise_color_sample_ext(n, ext, 6, 0.0, 1.0, 0.0) * kCalColor[kColorViolet];
  return noise_color_sample(n, 1, 0.0, 1.0, 0.0);
}

// Identity up to |y| = 4, then a smooth rational knee to 8. Safety only.
static inline double safety_limit(double y) {
  const double ay = y < 0.0 ? -y : y;
  if (ay <= 4.0) return y;
  const double u = (ay - 4.0) * 0.25;
  const double lim = 4.0 + 4.0 * u / (1.0 + u);
  return y < 0.0 ? -lim : lim;
}

static inline double amp_mod_gain(double ampMod, double na) {
  return sqrt_pos(1.0 - ampMod) + sqrt_pos(ampMod) * na;
}

// Three noise streams per channel; all advance every sample.
struct Noise {
  NoiseColorChannel nPitch;
  NoiseColorChannel nAmp;
  NoiseColorChannel nAudio;
  NoiseColorExt ePitch;
  NoiseColorExt eAmp;
  NoiseColorExt eAudio;
  double np;     // last n_pitch (clamped, unit RMS)
  double na;     // last n_amp
  double audio;  // last N_audio (unit RMS) = the Noise output
  double e;      // last ln(fInst / fEff)
  double cv;     // last e / ln2 (octaves)
  double npPrev; // previous clamped pitch draw w[n-1] (Average; always tracked)
  double cCents; // cached Pitch Mod cents / Color for s and c
  int cColor;
  double cS, cC; // s, mean correction c
};

static inline void noise_reset(Noise& n, unsigned int seed, unsigned int ch) {
  noise_color_reset(n.nPitch, seed_to_rng_state(seed_mix(seed, kSeedPitch, ch)));
  noise_color_reset(n.nAmp, seed_to_rng_state(seed_mix(seed, kSeedAmp, ch)));
  noise_color_reset(n.nAudio, seed_to_rng_state(seed_mix(seed, kSeedAudio, ch)));
  noise_color_ext_reset(n.ePitch);
  noise_color_ext_reset(n.eAmp);
  noise_color_ext_reset(n.eAudio);
  n.np = n.na = n.audio = n.e = n.cv = n.npPrev = 0.0;
  n.cCents = 0.0;
  n.cColor = -1;
  n.cS = n.cC = 0.0;
}

// One sample of all three streams + the mean-corrected pitch offset.
// Returns fInst = fEff * exp(e) (fEff when Pitch Mod is 0).
static inline double noise_step(Noise& n, int color, double fEff, double pitchCents) {
  const double xp = color_sample(n.nPitch, n.ePitch, color);
  const double xa = color_sample(n.nAmp, n.eAmp, color);
  n.audio = color_sample(n.nAudio, n.eAudio, color);
  const double w = clamp(xp, -kModClamp, kModClamp);
  n.np = color == kColorAverage ? (w + n.npPrev) * 0.7071067811865476 : w;
  n.npPrev = w;
  n.na = clamp(xa, -kModClamp, kModClamp);
  n.e = 0.0;
  n.cv = 0.0;
  if (pitchCents == 0.0) return fEff;
  if (pitchCents != n.cCents || color != n.cColor) {
    n.cCents = pitchCents;
    n.cColor = color;
    n.cS = pitchCents * (kLn2 / 1200.0);
    n.cC = 0.5 * n.cS * n.cS;
    if (color == kColorWhite) {
      const double a = 1.7320508075688772 * (n.cS < 0.0 ? -n.cS : n.cS);
      if (a > 1.0e-4) {
        const double ea = dsp_exp(a);
        n.cC = dsp_ln((ea - 1.0 / ea) / (2.0 * a));
      }
    }
  }
  const double s = n.cS;
  n.e = n.np * s - n.cC;
  n.cv = n.e * (1.0 / kLn2);
  return fEff * dsp_exp(n.e);
}

struct Display {
  double bins[kDisplayBins];
  double count;   // samples binned since the last take
  double armed;   // samples left before binning stops (re-armed by take)
  double feff, q, sr, cents;
  int model;      // 0 = filter curve, 1 = glow line
};

// weight: brightness of this sample's line, 0..1 (Oscillator: |Amplitude * Amp Mod
// gain| clamped to 1; Filter: 1). Bins sum weights; count stays samples.
static inline void display_note(Display& d, int model, double fEff, double q, double cents, double sr, double hz, double weight) {
  d.model = model;
  d.feff = fEff;
  d.q = q;
  d.cents = cents;
  d.sr = sr;
  if (!(d.armed > 0.0)) return;
  d.armed -= 1.0;
  d.count += 1.0;
  const double a = hz < 0.0 ? -hz : hz;
  if (!(a >= kDisplayLoHz) || !(a <= kDisplayHiHz)) return;
  static const double kInvSpan = 1.0 / 6.907755278982137;  // 1 / ln(1000)
  int i = (int)(dsp_ln(a / kDisplayLoHz) * kInvSpan * (double)kDisplayBins);
  if (i < 0) i = 0;
  if (i >= kDisplayBins) i = kDisplayBins - 1;
  d.bins[i] += weight;
}

static inline double display_take(Display& d) {
  const double n = d.count;
  for (int i = 0; i < kDisplayBins; i += 1) d.bins[i] = 0.0;
  d.count = 0.0;
  d.armed = kDisplayArmSeconds * (d.sr > 1.0 ? d.sr : 48000.0);
  return n;
}

// info: 0 model (0 curve / 1 glow), 1 fEff Hz, 2 Q, 3 sample rate,
// 4 Pitch Mod cents, 5 display lo Hz, 6 display hi Hz.
static inline double display_info(const Display& d, int which) {
  switch (which) {
    case 0: return (double)d.model;
    case 1: return d.feff;
    case 2: return d.q;
    case 3: return d.sr;
    case 4: return d.cents;
    case 5: return kDisplayLoHz;
    case 6: return kDisplayHiHz;
    default: return 0.0;
  }
}

}  // namespace softpop
}  // namespace
