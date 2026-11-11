// soemdsp-native-module: formant_filter
// soemdsp-native-label: Formant Voice
// soemdsp-native-target: formantFilter
// soemdsp-native-kind: oscillator
//
// Formant Filter (graph type 244): a source-filter voice. Source = an internal
// BLIT oscillator (shared blit_saw.h, the BLIT Oscillator saw; Wave picks Saw
// or Square, the square being two saws PW of a cycle apart) at Frequency, plus
// a Sub one or two octaves down (Sub Wave: Sine, Saw or Square, the same BLIT
// maths; Sub Oct), or Ext In when a cable is wired, plus band-limited white
// noise at its own level for breath / whisper. Sub Direct sends that share of
// the Sub around the formant bank (straight into Drive). The noise runs
// through a 4-pole Butterworth lowpass at Noise Tone x 2^Shift (so it follows
// the formant bank) and through its own copy of the bank, added after Drive
// so saturation never crackles on noise peaks. The
// source runs through a parallel bank of five constant-peak TPT SVF bandpasses
// (shared tpt_svf.h, the EQ Filter bandpass) tuned to vowel formants. Sweep picks a vowel path; Vowel
// walks it with log-frequency interpolation (0..1 = the path; outside it the
// end segments extrapolate). Shift moves every formant in octaves. No knob is
// range-clamped here: the parameter definitions' min / max (editable in
// parameter settings) are the only range. Only stability guards remain
// (non-finite -> safe value, Q > 0, SVF tuning under Nyquist, BLIT saw under
// 0.45 x sr, Body cutoff, output +-8). Each band fades out as it
// nears Nyquist (0.8 -> 1.0 x Nyquist) or drops under 40 -> 20 Hz, and is
// skipped (state cleared) once fully out, so the bank keeps climbing and
// bands leave one by one. Resonance scales each band's Q. Body adds the input back
// through a 2-pole lowpass that tracks F1, so the fundamental and low end
// stay heavy; Body takes the voiced source only (saw / sub / Ext In, never
// the noise), so a whisper has no noisy low end. Drive is an asymmetric
// (tube-like, even harmonics) tanh blend on the voiced bank + Body + direct
// Sub, first-order antiderivative anti-aliased (ADAA), DC blocked (0 = clean).
// Band targets (log Hz, log Q, gain) are smoothed with an ~8 ms one-pole.
//
// The display reads soemdsp_formant_filter_eval_response: the same band
// maths (sweep, shift, edge fade, Q, gains, Body cutoff, makeup) as the audio, as the
// exact transfer function of the bilinear (TPT) filters.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/tpt_svf.h>
#include <soemdsp/math/noise_colors.h>
#include <soemdsp/oscillator/blit_saw.h>

// v9 (Formant Voice): nasals M / N (an anti-resonance, the nasal zero, on the
// voiced bank, per vowel), W and AE vowels, sweeps M A / N O / N A U / W AE;
// Glottal wave (LF-like flow derivative: a smooth open-phase hump and an
// alias-free BLIT closing spike, PW = open quotient, return-phase lowpass);
// Jitter / Shimmer (random cycle-to-cycle pitch / amplitude); Breath (noise
// bank in / out: shift, Q, tone, level); plosives on the Trigger input
// (P T K B D G: closure, burst, aspiration, voicing onset, formant
// transitions from the place's locus); fricatives (S Sh F Th H) at Fric level.

namespace {

using namespace soemdsp_maths;

constexpr int kBands = 5;
constexpr int kMaxInstances = 256;
constexpr double kLn2 = 0.69314718055994531;
constexpr double kBankMakeup = 2.5;   // bank sum trim (constant-peak bands pass ~1 harmonic each)
constexpr double kBodyCutoffRatio = 0.7; // Body lowpass Hz = ratio * F1
constexpr double kBodyQ = 0.7071067811865476;
constexpr double kSmoothSeconds = 0.008;
constexpr double kSawGain = 1.47;      // BLIT Oscillator saw gain (raw peak <= 0.665 -> under 0.98)
constexpr double kSquareGain = 1.44;   // BLIT Oscillator square gain (raw peak <= 0.679 -> under 0.98)
constexpr double kPulseGain = 1.44;    // bipolar BLIT pulse (main Square) gain at PW 0.5
constexpr double kNoiseGain = 1.4;     // noise trim: a whisper lands near the voiced level
constexpr double kNoiseCutHz = 8000.0;  // Noise Tone default / fallback (moves with Shift)
constexpr double kNoiseCutMinHz = 500.0;
constexpr double kNoiseCutMaxNyq = 0.85; // x Nyquist: the noise never reaches the top of the band
constexpr double kNoiseQ1 = 0.5411961001461970; // 4-pole Butterworth stage Qs
constexpr double kNoiseQ2 = 1.3065629648763766;
constexpr double kFadeHiStart = 0.8;     // x Nyquist: band gain starts fading
constexpr double kFadeLoEndHz = 20.0;    // band fully gone at / under this
constexpr double kFadeLoStartHz = 40.0;  // band starts fading under this
constexpr double kHzFloor = 10.0;        // target Hz bounds (keeps the smoother near the edges)
constexpr double kTuneMaxNyq = 0.999;    // SVF tuning cap (x Nyquist); gain is ~0 there
constexpr double kQFloor = 1.0e-3;       // stability: SVF damping 1/Q stays finite (Resonance <= 0 lands here)
constexpr double kResFloor = 1.0e-6;     // stability: makeup takes ln(Resonance)
constexpr double kZeroQ = 2.5;           // nasal anti-resonance Q (notch depth = Nasal amount)
constexpr double kGlottalGain = 2.4;     // Glottal: closing peak after the return-phase lowpass (~bank level of the saw)
constexpr double kGlottalTiltHz = 700.0; // return phase (LF Ta ~ 0.23 ms): one-pole lowpass on the flow derivative
constexpr double kJitterMax = 0.06;      // Jitter 1: per-cycle pitch spread +-6 % (about a semitone)
constexpr double kShimmerMax = 0.6;      // Shimmer 1: per-cycle amplitude spread +-60 %
constexpr double kShimmerSmoothSec = 0.001;
constexpr double kBurstGain = 1.6;       // plosive burst trim
constexpr double kFricGain = 1.2;        // fricative trim
constexpr double kVoiceGateSec = 0.002;  // plosive voicing gate smoothing

struct FormantFilterState {
  bool active = false;
  bool smoothInit = false;
  double lnF[kBands] = {0, 0, 0, 0, 0};
  double lnQ[kBands] = {0, 0, 0, 0, 0};
  double gain[kBands] = {0, 0, 0, 0, 0};
  TptSvfState band[kBands] = {};
  TptSvfState body = {};
  soemdsp_blit::BlitSaw saw = {};
  double pulsePhase = 0.0;  // bipolar BLIT pulse: cycles, + impulse at 0, - impulse at PW
  double pulseState = 0.0;
  soemdsp_blit::BlitSaw subA = {};
  soemdsp_blit::BlitSaw subB = {};
  double subPhase = 0.0;
  NoiseColorChannel noise = {};
  TptSvfState noiseLp1 = {};
  TptSvfState noiseLp2 = {};
  TptSvfState noiseBand[kBands] = {}; // the bank again, noise only (added after Drive)
  bool noiseBankLive = false;
  double lastDirect = 0.0; // direct Sub from the last source() call (stereo path)
  double driveX1 = 0.0;    // ADAA: previous Drive input
  double dcX1 = 0.0, dcY1 = 0.0; // DC blocker on the shaped part
  // v9. Every member is zero-initialised here (the static pool then needs no
  // data segment); the non-zero starts are set by initVoiceState().
  double nasal = 0.0, lnZero = 0.0;  // smoothed nasal amount / zero (ln Hz)
  TptSvfState zeroBp = {};
  double glotPhase = 0.0, glotLp = 0.0;
  double jPhase = 0.0, jFactor = 0.0, shTarget = 0.0, shGain = 0.0;
  unsigned int rng = 0u;
  double lastTrig = 0.0;
  double plT = 0.0;         // samples since the plosive trigger (-1 idle)
  int plType = 0;
  double plHeight = 0.0;
  double voiceGate = 0.0;   // smoothed voicing gain (plosive closure)
  TptSvfState burstBp = {};
  TptSvfState fricBp = {};
  bool fricLive = false;
};

void initVoiceState(FormantFilterState& s) {
  s.jFactor = 1.0;
  s.shTarget = s.shGain = 1.0;
  s.plT = -1.0;
  s.plHeight = 1.0;
  s.voiceGate = 1.0;
}

double rand11(FormantFilterState& s) {
  unsigned int x = s.rng;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  s.rng = x ? x : 1u;
  return static_cast<double>(s.rng) / 2147483648.0 - 1.0;
}

void initOscillators(FormantFilterState& s) {
  s.glotPhase = 0.0;
  s.jPhase = 0.0;
  s.saw.init(0.0);
  s.pulsePhase = 0.0;
  s.pulseState = 0.0;
  s.subA.init(0.0);
  s.subB.init(0.5);
  s.subPhase = 0.0;
}

int waveIndex(double v, int n) {
  if (is_bad(v)) return 0; // also an argument a caller left out (NaN)
  int i = static_cast<int>(dsp_floor(v + 0.5));
  if (i < 0) i = 0;
  if (i > n - 1) i = n - 1;
  return i;
}

static FormantFilterState gPool[kMaxInstances];

// Male averages (Peterson & Barney) F1..F3, a typical F4, and a soft F5.
// 0=A  1=E  2=I  3=O  4=U  5=R (American "rrr" as in run / "er": the low F3
// right above F2 is what makes it an R; male averages, Hillenbrand-ish)
// 6=M  7=N (nasal murmurs: strong low F1, weak upper formants, plus the
// nasal zero below)  8=W (the glide: very low F1 / F2)  9=AE ("whack", "cat")
constexpr int kVowels = 10;
static const double kVowelF[kVowels][kBands] = {
  {730.0, 1090.0, 2440.0, 3400.0, 4500.0},
  {530.0, 1840.0, 2480.0, 3500.0, 4500.0},
  {270.0, 2290.0, 3010.0, 3500.0, 4600.0},
  {570.0,  840.0, 2410.0, 3400.0, 4400.0},
  {300.0,  870.0, 2240.0, 3300.0, 4300.0},
  {420.0, 1150.0, 1580.0, 3300.0, 4300.0},
  {250.0, 1100.0, 2200.0, 3300.0, 4300.0},
  {250.0, 1500.0, 2500.0, 3400.0, 4400.0},
  {290.0,  610.0, 2150.0, 3300.0, 4300.0},
  {660.0, 1720.0, 2410.0, 3400.0, 4500.0},
};
static const double kVowelW[kVowels][kBands] = {
  {90.0, 110.0, 170.0, 250.0, 300.0},
  {80.0, 120.0, 170.0, 250.0, 300.0},
  {70.0, 130.0, 180.0, 250.0, 300.0},
  {85.0, 100.0, 165.0, 240.0, 300.0},
  {70.0, 100.0, 160.0, 230.0, 300.0},
  {80.0, 100.0, 110.0, 250.0, 300.0},
  {60.0, 150.0, 200.0, 250.0, 300.0},
  {60.0, 150.0, 200.0, 250.0, 300.0},
  {60.0,  80.0, 160.0, 230.0, 300.0},
  {90.0, 120.0, 170.0, 250.0, 300.0},
};
static const double kVowelG[kVowels][kBands] = {
  {1.00, 0.70, 0.45, 0.25, 0.12},
  {0.90, 0.85, 0.45, 0.25, 0.12},
  {0.75, 0.95, 0.50, 0.25, 0.12},
  {0.95, 0.55, 0.40, 0.22, 0.10},
  {0.80, 0.50, 0.35, 0.20, 0.10},
  {0.85, 0.80, 0.70, 0.20, 0.10},
  {1.00, 0.25, 0.18, 0.10, 0.05},
  {1.00, 0.25, 0.20, 0.10, 0.05},
  {0.90, 0.60, 0.25, 0.15, 0.08},
  {1.00, 0.80, 0.45, 0.25, 0.12},
};
// Nasal amount (anti-resonance depth) and the zero's Hz, per vowel.
static const double kVowelNasal[kVowels] = {0, 0, 0, 0, 0, 0, 1, 1, 0, 0};
static const double kVowelZeroHz[kVowels] = {1000, 1000, 1000, 1000, 1000, 1000, 1000, 1600, 1000, 1000};

// Sweep labels (JS): "E A O U", "I E", "A E I", "O E I", "Y U", "R A E", "M A", "N O", "N A U", "W AE"
struct SweepSpec {
  int n;
  int v[4];
};
constexpr int kSweepCount = 10;
static const SweepSpec kSweeps[kSweepCount] = {
  {4, {2, 0, 3, 4}}, // I -> A -> O -> U  (saved index 0)
  {2, {2, 1, 0, 0}}, // I -> E
  {3, {0, 1, 2, 0}}, // A -> E -> I
  {3, {3, 1, 2, 0}}, // O -> E -> I
  {2, {2, 4, 0, 0}}, // I -> U  ("Y U")
  {3, {5, 0, 2, 0}}, // R -> A -> I  ("R A E": rrr, ahh as in obvious, ee as in sleepy)
  {2, {6, 0, 0, 0}}, // M -> A  ("M A": mom)
  {2, {7, 3, 0, 0}}, // N -> O  ("N O": no)
  {3, {7, 0, 4, 0}}, // N -> A -> U  ("N A U": now)
  {2, {8, 9, 0, 0}}, // W -> AE  ("W AE": wow, the a of whack)
};

static const char kMetadataJson[] =
  "{"
    "\"module\":\"formant_filter\","
    "\"label\":\"Formant Voice\","
    "\"targetType\":\"formantFilter\","
    "\"kind\":\"oscillator\""
  "}";

void monotoneWaypoints(double* pts, int n) {
  if (n < 2) return;
  if (pts[n - 1] < pts[0]) {
    for (int i = 1; i < n; ++i) if (pts[i] > pts[i - 1]) pts[i] = pts[i - 1];
  } else if (pts[n - 1] > pts[0]) {
    for (int i = 1; i < n; ++i) if (pts[i] < pts[i - 1]) pts[i] = pts[i - 1];
  } else {
    for (int i = 1; i < n; ++i) pts[i] = pts[0];
  }
}

// Sweep path at pos 0..1: band Hz (log interpolated), width Hz, table gain.
void evalSweep(
  double sweep, double pos, double outF[kBands], double outW[kBands], double outG[kBands],
  double* outNasal, double* outZeroHz
) {
  int si = static_cast<int>(dsp_floor(safe(sweep) + 0.5));
  if (si < 0) si = 0;
  if (si > kSweepCount - 1) si = kSweepCount - 1;
  pos = safe(pos); // no 0..1 clamp: the Vowel parameter range decides
  const SweepSpec& sp = kSweeps[si];
  const int n = sp.n;
  for (int b = 0; b < kBands; ++b) {
    double f[4], w[4], g[4];
    for (int i = 0; i < n; ++i) {
      f[i] = kVowelF[sp.v[i]][b];
      w[i] = kVowelW[sp.v[i]][b];
      g[i] = kVowelG[sp.v[i]][b];
    }
    // E A O U F1 is the intended 270-730-570-300 rise-then-fall; R A E and
    // every later path keep their real path on every band (F1 420-730-270:
    // the ahh in the middle is the point; the bands never cross).
    if (!(si == 0 && b == 0) && si < 5) monotoneWaypoints(f, n);
    monotoneWaypoints(w, n);
    monotoneWaypoints(g, n);
    double x = pos * static_cast<double>(n - 1);
    if (is_bad(x)) x = 0.0; // overflow guard only
    int i0 = static_cast<int>(dsp_floor(x));
    if (i0 < 0) i0 = 0;
    if (i0 > n - 2) i0 = n - 2;
    const double frac = x - static_cast<double>(i0);
    const double l0 = dsp_ln(f[i0] > 1.0 ? f[i0] : 1.0);
    const double l1 = dsp_ln(f[i0 + 1] > 1.0 ? f[i0 + 1] : 1.0);
    outF[b] = dsp_exp(l0 + (l1 - l0) * frac);
    outW[b] = w[i0] + (w[i0 + 1] - w[i0]) * frac;
    outG[b] = g[i0] + (g[i0 + 1] - g[i0]) * frac;
  }
  {
    double x = pos * static_cast<double>(n - 1);
    if (is_bad(x)) x = 0.0;
    int i0 = static_cast<int>(dsp_floor(x));
    if (i0 < 0) i0 = 0;
    if (i0 > n - 2) i0 = n - 2;
    double frac = x - static_cast<double>(i0);
    if (frac < 0.0) frac = 0.0; // the nasal amount does not extrapolate past the path
    if (frac > 1.0) frac = 1.0;
    const double n0 = kVowelNasal[sp.v[i0]], n1 = kVowelNasal[sp.v[i0 + 1]];
    const double z0 = dsp_ln(kVowelZeroHz[sp.v[i0]]), z1 = dsp_ln(kVowelZeroHz[sp.v[i0 + 1]]);
    *outNasal = n0 + (n1 - n0) * frac;
    *outZeroHz = dsp_exp(z0 + (z1 - z0) * frac);
  }
}

struct BandTargets {
  double lnF[kBands];
  double lnQ[kBands];
  double gain[kBands];
  double makeup; // bank trim; eased down below Resonance 1 so broad bands do not stack
  double nasal;  // anti-resonance depth 0..1
  double lnZero; // anti-resonance Hz (ln), after Shift
};

// Targets after Shift (octaves), Resonance (Q scale), per-band Gain / On.
// Shared by the audio path and the display eval so they cannot drift.
void bandTargets(
  double sampleRate, double vowel, double sweep, double shiftOct, double resonance,
  const double knobG[kBands], const double knobOn[kBands], BandTargets& t
) {
  double tf[kBands], tw[kBands], tg[kBands], nasal = 0.0, zeroHz = 1000.0;
  evalSweep(sweep, vowel, tf, tw, tg, &nasal, &zeroHz);
  const double shift = safe(shiftOct); // no range clamp: the Shift parameter range decides
  {
    double zh = zeroHz * dsp_exp(shift * kLn2);
    const double zMax = sampleRate * 0.45;
    if (!(zh >= kHzFloor)) zh = kHzFloor;
    if (zh > zMax) zh = zMax;
    t.nasal = safe(nasal);
    t.lnZero = dsp_ln(zh);
  }
  double res = safe(resonance);
  if (!(res > kResFloor)) res = kResFloor; // stability floor, not a range
  t.makeup = res < 1.0 ? kBankMakeup * dsp_exp(0.75 * dsp_ln(res)) : kBankMakeup;
  const double hzMax = sampleRate * 0.51; // bounds only, just past Nyquist so the smoothed Hz reaches fade 0 (band skipped)
  for (int b = 0; b < kBands; ++b) {
    // dsp_exp saturates (no inf); the bounds sit outside the fade window so they
    // never limit what is heard, they only keep the smoother finite.
    double hz = tf[b] * dsp_exp(shift * kLn2);
    if (!(hz >= kHzFloor)) hz = kHzFloor; // also catches NaN
    if (hz > hzMax) hz = hzMax;
    const double w = tw[b] >= 1.0 ? tw[b] : 1.0; // also catches NaN
    double q = (tf[b] / w) * res;
    if (!(q >= kQFloor)) q = kQFloor;
    if (is_bad(q)) q = 1.0e300;
    t.lnF[b] = dsp_ln(hz);
    t.lnQ[b] = dsp_ln(q);
    const double g = knobOn[b] >= 0.5 ? tg[b] * safe(knobG[b]) : 0.0;
    t.gain[b] = safe(g);
  }
}

// Edge fade for one band at hz: 1 inside, smoothstep to 0 from 0.8 x Nyquist
// up to Nyquist, and from 40 Hz down to 20 Hz. 0 = band skipped.
double bandEdgeFade(double hz, double sampleRate) {
  const double nyq = 0.5 * sampleRate;
  double hi = (nyq - hz) / ((1.0 - kFadeHiStart) * nyq);
  double lo = (hz - kFadeLoEndHz) / (kFadeLoStartHz - kFadeLoEndHz);
  hi = clamp(hi, 0.0, 1.0);
  lo = clamp(lo, 0.0, 1.0);
  const double u = hi < lo ? hi : lo;
  return u * u * (3.0 - 2.0 * u);
}

double bandTuneHz(double hz, double sampleRate) {
  const double cap = 0.5 * sampleRate * kTuneMaxNyq;
  return hz > cap ? cap : hz;
}

double bodyCutoffHz(double lnF1, double sampleRate) {
  double hz = dsp_exp(lnF1) * kBodyCutoffRatio;
  if (hz < 60.0) hz = 60.0;
  const double hzMax = sampleRate * 0.45;
  if (hz > hzMax) hz = hzMax;
  return hz;
}

double fastTanh(double x) {
  if (x > 20.0) return 1.0;
  if (x < -20.0) return -1.0;
  const double e = dsp_exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

// ln(cosh(z)) without overflow.
double lnCosh(double z) {
  const double a = z < 0.0 ? -z : z;
  return a + dsp_ln(1.0 + dsp_exp(-2.0 * a)) - kLn2;
}

// Tube-like drive: f(x) = (tanh(g x + a) - tanh(a)) / k, a = 0.3 d (asymmetry,
// even harmonics, grows with Drive), k = the mean of the two rails' swing
// (tanh(g + a) - tanh(a - g)) / 2, so the level matches the old symmetric
// drive and neither side overshoots. First-order ADAA:
// y = (F(x) - F(x1)) / (x - x1), F the antiderivative, so the shaped part
// aliases far less on bright formants. The shaped part is DC blocked (the
// asymmetry makes DC) and blended: (1 - d) x + d f. 0 = clean (exact).
double driveShape(FormantFilterState& s, double x, double drive, double sr) {
  const double d = safe(drive); // no 0..1 clamp: the Drive parameter range decides
  const double x1 = s.driveX1;
  s.driveX1 = x;
  const double g = 1.0 + 7.0 * d;
  const double a = 0.3 * d;
  const double ta = fastTanh(a);
  const double k = 0.5 * (fastTanh(g + a) - fastTanh(a - g));
  double sat = 0.0;
  if (d != 0.0 && g != 0.0 && k != 0.0 && !is_bad(k)) {
    const double dx = x - x1;
    if (dx > 1.0e-5 || dx < -1.0e-5) {
      const double F0 = lnCosh(g * x1 + a) / g - ta * x1;
      const double F1 = lnCosh(g * x + a) / g - ta * x;
      sat = (F1 - F0) / (dx * k);
    } else {
      sat = (fastTanh(g * 0.5 * (x + x1) + a) - ta) / k;
    }
    if (is_bad(sat)) sat = 0.0;
  }
  // DC blocker (~5 Hz) on the shaped part; keeps running so Drive moves smoothly.
  const double r = 1.0 - 2.0 * kPi * 5.0 / sr;
  const double hp = sat - s.dcX1 + r * s.dcY1;
  s.dcX1 = sat;
  s.dcY1 = is_bad(hp) ? 0.0 : hp;
  if (d == 0.0) return x;
  return (1.0 - d) * x + d * s.dcY1;
}

// One BLIT voice at period samples: Saw (a alone) or Square (a - b, b half a
// cycle on; the Sub). Both saws always tick so switching never jumps phase.
double blitWave(soemdsp_blit::BlitSaw& a, soemdsp_blit::BlitSaw& b, double period, bool square) {
  const double halfW = kPi / period;
  const double comp = soemdsp_blit::sinApprox(halfW) / halfW;
  const double ya = a.update(period) * comp;
  const double yb = b.update(period) * comp;
  return square ? clamp((ya - yb) * kSquareGain, -1.0, 1.0) : clamp(ya * kSawGain, -1.0, 1.0);
}

// Band-limited impulse (Stilson & Smith kernel, continuous harmonic count
// as BlitSaw::update) at x = pi * cycles: one unit-area impulse per cycle.
double blitImpulse(double x, double p, double lo, double frac) {
  const double denom = soemdsp_blit::sinApprox(x);
  double k = soemdsp_blit::blitKernel(x, denom, lo, p);
  if (frac > 0.0) k += (soemdsp_blit::blitKernel(x, denom, lo + 1.0, p) - k) * frac;
  return k;
}

// Main Square with live PW: the bipolar BLIT pulse. One integrator takes a
// + impulse at phase 0 and a - impulse at phase PW, so the level is 1 for
// PW of the cycle and 0 for the rest, and PW can move any time with nothing
// to re-sync (no ramp in the state). Its mean is exactly PW, subtracted
// directly, and the leak pulls the state toward that mean (drift guard), so
// sweeping PW never wanders in DC. Scaled by 0.5 / max(PW, 1 - PW) so narrow
// pulses stay inside the clamp; PW 0.5 has the BLIT square's level.
double blitPulse(FormantFilterState& s, double period, double w) {
  const double p = period > 1.0e-6 ? period : 1.0e-6;
  double harmonics = 0.5 * p - 1.0;
  if (harmonics < 1.0) harmonics = 1.0;
  const double lo = dsp_floor(harmonics);
  const double frac = harmonics - lo;
  const double c = s.pulsePhase;
  s.pulseState += blitImpulse(kPi * c, p, lo, frac) - blitImpulse(kPi * (c - w), p, lo, frac);
  const double y = s.pulseState - w;
  const double leak = 1.0 - (kTwoPi / soemdsp_blit::kBlitLeakDivisor) / p;
  s.pulseState = w + y * (leak > 0.0 ? leak : 0.0);
  if (is_bad(s.pulseState)) s.pulseState = w;
  s.pulsePhase += 1.0 / p;
  if (s.pulsePhase >= 1.0) s.pulsePhase -= dsp_floor(s.pulsePhase);
  double wide = w > 0.5 ? w : 1.0 - w;
  if (!(wide > 0.0)) wide = 1.0;
  const double halfW = kPi / p;
  const double comp = soemdsp_blit::sinApprox(halfW) / halfW;
  return clamp(y * comp * kPulseGain * (0.5 / wide), -1.0, 1.0);
}

// Glottal wave: the glottal flow derivative (LF-like). Open phase (OQ = PW of
// the cycle): a smooth positive half-sine hump; at closure an alias-free BLIT
// negative spike of the same area (zero mean, no integrator to drift); then a
// one-pole lowpass for the return phase. PW sweeps freely (no state to fix).
double glottalWave(FormantFilterState& s, double period, double oq, double sr) {
  const double p = period > 1.0e-6 ? period : 1.0e-6;
  double harmonics = 0.5 * p - 1.0;
  if (harmonics < 1.0) harmonics = 1.0;
  const double lo = dsp_floor(harmonics);
  const double frac = harmonics - lo;
  if (!(oq > 1.0e-3)) oq = 1.0e-3; // stability: hump height divides by OQ
  if (oq > 0.999) oq = 0.999;
  const double c = s.glotPhase;
  const double hump = c < oq ? (kPi / (2.0 * oq * p)) * soemdsp_blit::sinApprox(kPi * c / oq) : 0.0;
  const double y = hump - blitImpulse(kPi * (c - oq), p, lo, frac);
  const double a = 1.0 - dsp_exp(-2.0 * kPi * kGlottalTiltHz / sr);
  s.glotLp += a * (y - s.glotLp);
  if (is_bad(s.glotLp)) s.glotLp = 0.0;
  s.glotPhase += 1.0 / p;
  if (s.glotPhase >= 1.0) s.glotPhase -= dsp_floor(s.glotPhase);
  // Normalised by the lowpass gain a (a spike's peak after it is ~a) so the
  // closing peak sits near kGlottalGain at any sample rate. A pulse train
  // has a high crest factor: peaks near 2.5 give the bank the saw's level,
  // so the guard is +-3 (never reached by the measured wave).
  return clamp(s.glotLp * (kGlottalGain / a), -3.0, 3.0);
}

struct Voiced {
  double bank;   // into the formant bank and Body
  double direct; // Sub Direct share: around the bank, into Drive
};

// Wave: 0 Saw, 1 Square (PW = high fraction), 2 Glottal (PW = open
// quotient). Sub Wave: 0 Sine, 1 Saw, 2 Square. Sub Oct: 0 = one octave
// down, 1 = two. Sub Direct: 0 = all of the Sub through the bank (as before),
// 1 = all of it straight to Drive. Jitter / Shimmer: a new random pitch /
// amplitude offset every cycle (0 = exact, bit-identical to before).
Voiced voicedSource(
  FormantFilterState& s, double frequencyHz, double sawLevel, double subLevel,
  double wave, double subWave, double pw, double subOct, double subDirect, double sr,
  double jitter, double shimmer
) {
  double main = 0.0, subSig = 0.0;
  double hz = safe(frequencyHz);
  if (hz < 0.0) hz = -hz;
  {
    // Cycle clock at the jittered rate: each wrap draws the next cycle's offsets.
    s.jPhase += hz * s.jFactor / sr;
    if (s.jPhase >= 1.0) {
      s.jPhase -= dsp_floor(s.jPhase);
      const double rj = 0.5 * (rand11(s) + rand11(s)); // triangular, -1..1
      const double rs = 0.5 * (rand11(s) + rand11(s));
      const double j = safe(jitter), sh = safe(shimmer);
      s.jFactor = j != 0.0 ? 1.0 + j * kJitterMax * rj : 1.0;
      if (s.jFactor < 0.01) s.jFactor = 0.01;
      s.shTarget = sh != 0.0 ? 1.0 + sh * kShimmerMax * rs : 1.0;
      if (s.shTarget < 0.0) s.shTarget = 0.0;
    }
    hz *= s.jFactor;
    if (s.shGain != s.shTarget) {
      s.shGain += (1.0 - dsp_exp(-1.0 / (kShimmerSmoothSec * sr))) * (s.shTarget - s.shGain);
      if (s.shGain > s.shTarget - 1.0e-9 && s.shGain < s.shTarget + 1.0e-9) s.shGain = s.shTarget;
    }
  }
  if (hz > sr * 0.45) hz = sr * 0.45;
  const double inc = hz / sr;
  const double sub = safe(subLevel);
  const int sw = waveIndex(subWave, 3);
  const double subDiv = waveIndex(subOct, 2) == 1 ? 4.0 : 2.0;
  // Pulse width (cyclic: PW mod 1; 0 / 1 = no pulse).
  double w = pw;
  if (is_bad(w)) w = 0.5;
  w -= dsp_floor(w);
  if (hz >= 1.0) {
    const double period = 1.0 / inc;
    // Saw and pulse both tick (same phase) so switching Wave never jumps.
    const double halfW = kPi / period;
    const double sawOut = clamp(s.saw.update(period) * (soemdsp_blit::sinApprox(halfW) / halfW) * kSawGain, -1.0, 1.0);
    const double pulseOut = blitPulse(s, period, w);
    const double glotOut = glottalWave(s, period, w, sr);
    const int wv = waveIndex(wave, 3);
    main = safe(sawLevel) * (wv == 2 ? glotOut : (wv == 1 ? pulseOut : sawOut)) * s.shGain;
    const double subOsc = blitWave(s.subA, s.subB, subDiv * period, sw == 2);
    if (sw != 0) subSig = sub * subOsc;
  }
  s.subPhase += inc / subDiv;
  if (s.subPhase >= 1.0) s.subPhase -= dsp_floor(s.subPhase);
  if (sw == 0 && sub != 0.0) subSig = sub * soemdsp_blit::sinApprox(2.0 * kPi * s.subPhase);
  subSig *= s.shGain;
  const double dir = safe(subDirect); // no 0..1 clamp: the Sub Direct range decides
  return { main + (1.0 - dir) * subSig, dir * subSig };
}

// Plosives: 1 P  2 T  3 K (voiceless)  4 B  5 D  6 G (voiced). Timeline from
// the trigger, ms: closure (voicing gated off; voiced stops keep a faint
// voice bar), burst (noise through the place's bandpass), aspiration (noise
// through the formants, VOT), voicing ramps back in, and the formants glide
// from the place's locus (F1 always rises from half).
struct PlosiveSpec {
  double closureMs, burstMs, votMs, rampMs, transMs;
  double voiceBar, burstLevel, aspLevel;
  double burstHz, burstQ;
  int place; // 0 labial, 1 alveolar, 2 velar
};
static const PlosiveSpec kPlosives[7] = {
  {0, 0, 0, 0, 0, 0, 0, 0, 1000, 1, 0},
  {55, 8, 55, 8, 45, 0.0, 1.0, 0.6, 900, 0.6, 0},   // P
  {55, 8, 60, 8, 45, 0.0, 1.0, 0.6, 4500, 1.2, 1},  // T
  {55, 10, 65, 8, 50, 0.0, 1.0, 0.6, 2400, 2.5, 2}, // K
  {40, 6, 10, 6, 40, 0.12, 0.5, 0.1, 900, 0.6, 0},  // B
  {40, 6, 12, 6, 40, 0.12, 0.5, 0.1, 4500, 1.2, 1}, // D
  {40, 8, 15, 6, 45, 0.12, 0.5, 0.1, 2400, 2.5, 2}, // G
};
// Fricatives: 1 S  2 Sh  3 F  4 Th  (bandpassed noise, added after Drive),
// 5 H (aspiration: noise through the formants).
struct FricSpec { double hz, q, gain; };
static const FricSpec kFrics[6] = {
  {1000, 1, 0}, {6500, 2.0, 1.0}, {3200, 1.6, 1.0}, {6000, 0.35, 0.45}, {7000, 0.4, 0.35}, {1000, 1, 0},
};

struct PlosiveNow {
  double voice;   // voicing gain target
  double burst;   // burst level
  double asp;     // aspiration level (into the noise bank)
  double trans;   // formant transition amount 1..0
};

PlosiveNow plosiveTick(FormantFilterState& s, double sr) {
  PlosiveNow r = {1.0, 0.0, 0.0, 0.0};
  if (s.plT < 0.0 || s.plType < 1 || s.plType > 6) return r;
  const PlosiveSpec& p = kPlosives[s.plType];
  const double t = s.plT * 1000.0 / sr;
  const double h = s.plHeight;
  const double rel = p.closureMs;                 // release
  const double von = p.closureMs + p.votMs;       // voicing onset
  if (t < von) r.voice = p.voiceBar;
  else if (t < von + p.rampMs) r.voice = p.voiceBar + (1.0 - p.voiceBar) * (t - von) / p.rampMs;
  if (t >= rel && t < rel + p.burstMs) r.burst = h * p.burstLevel * dsp_exp(-3.0 * (t - rel) / p.burstMs);
  if (t >= rel + 0.5 * p.burstMs && t < von) {
    const double u = (t - rel) / (von - rel);
    r.asp = h * p.aspLevel * (u < 0.7 ? 1.0 : (1.0 - u) / 0.3);
  }
  if (t < von) r.trans = 1.0;
  else if (t < von + p.transMs) r.trans = 1.0 - (t - von) / p.transMs;
  s.plT += 1.0;
  if (t > von + p.rampMs + p.transMs) s.plT = -1.0; // done
  return r;
}

// ln-Hz offset of band b at transition amount 1 for a place (locus pull).
double plosiveOffset(int place, int b, double lnF, double shiftLn) {
  if (b == 0) return dsp_ln(0.5); // F1 rises from half after every stop
  if (place == 0) return (b == 1 || b == 2) ? dsp_ln(0.75) : 0.0; // labial: everything low
  if (place == 1) {
    if (b == 1) return 0.6 * (dsp_ln(1800.0) + shiftLn - lnF);
    if (b == 2) return 0.4 * (dsp_ln(2700.0) + shiftLn - lnF);
    return 0.0;
  }
  if (b == 1) return 0.6 * (dsp_ln(2300.0) + shiftLn - lnF); // velar pinch: F2 and F3 meet
  if (b == 2) return 0.5 * (dsp_ln(2500.0) + shiftLn - lnF);
  return 0.0;
}

}  // namespace

extern "C" int soemdsp_formant_filter_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      gPool[i] = FormantFilterState{};
      initVoiceState(gPool[i]);
      initOscillators(gPool[i]);
      noise_color_reset(gPool[i].noise, 0x9E3779B9u ^ (unsigned int)(i * 2654435761u + 1u));
      gPool[i].rng = 0x6C8E9CF5u ^ (unsigned int)(i * 2246822519u + 7u);
      if (gPool[i].rng == 0u) gPool[i].rng = 1u;
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_formant_filter_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_formant_filter_reset(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  FormantFilterState& s = gPool[handle - 1];
  for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.band[b]);
  tpt_svf_reset(s.body);
  tpt_svf_reset(s.noiseLp1);
  tpt_svf_reset(s.noiseLp2);
  for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.noiseBand[b]);
  s.smoothInit = false;
  s.driveX1 = s.dcX1 = s.dcY1 = 0.0;
  tpt_svf_reset(s.zeroBp);
  tpt_svf_reset(s.burstBp);
  tpt_svf_reset(s.fricBp);
  s.glotLp = 0.0;
  initVoiceState(s);
  initOscillators(s);
}

// Reset jack: restart the saw (and Sub) cycle; the filters keep ringing.
extern "C" void soemdsp_formant_filter_reset_osc(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  FormantFilterState& s = gPool[handle - 1];
  initOscillators(s);
}

// Stereo internal source: tick only this handle's saw + Sub and return it.
// The graph feeds the one shared saw into the L and R handles (useExt = 1);
// each of those adds its own independently seeded noise through its own
// bank, so L / R differ with Noise up while the voiced part stays identical.
extern "C" double soemdsp_formant_filter_source(
  int handle, double frequencyHz, double sawLevel, double subLevel, double sampleRate,
  double wave, double subWave, double pw, double subOct, double subDirect,
  double jitter, double shimmer
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  FormantFilterState& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  const double sr = sampleRate > 1.0 ? sampleRate : 48000.0;
  const Voiced v = voicedSource(s, frequencyHz, sawLevel, subLevel, wave, subWave, pw, subOct, subDirect, sr, jitter, shimmer);
  s.lastDirect = v.direct;
  return v.bank;
}

// The direct Sub from this handle's last soemdsp_formant_filter_source call
// (the stereo path passes it to the L / R banks as directIn).
extern "C" double soemdsp_formant_filter_source_direct(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastDirect;
}

extern "C" double soemdsp_formant_filter_sample(
  int handle,
  double input,
  double useExt,
  double frequencyHz,
  double sawLevel,
  double subLevel,
  double noiseLevel,
  double sampleRate,
  double vowel,
  double sweep,
  double shiftOct,
  double resonance,
  double body,
  double drive,
  double level,
  double g1, double g2, double g3, double g4, double g5,
  double on1, double on2, double on3, double on4, double on5,
  double wave, double subWave, double pw, double subOct, double subDirect,
  double noiseTone, double directIn,
  double jitter, double shimmer, double breath,
  double plosive, double trig, double fricative, double fricLevel
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  FormantFilterState& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  const double sr = sampleRate > 1.0 ? sampleRate : 48000.0;
  const double knobG[kBands] = {g1, g2, g3, g4, g5};
  const double knobOn[kBands] = {on1, on2, on3, on4, on5};
  BandTargets t;
  bandTargets(sr, vowel, sweep, shiftOct, resonance, knobG, knobOn, t);
  if (!s.smoothInit) {
    for (int b = 0; b < kBands; ++b) {
      s.lnF[b] = t.lnF[b];
      s.lnQ[b] = t.lnQ[b];
      s.gain[b] = t.gain[b];
    }
    s.nasal = t.nasal;
    s.lnZero = t.lnZero;
    s.smoothInit = true;
  } else {
    const double k = 1.0 - dsp_exp(-1.0 / (kSmoothSeconds * sr));
    for (int b = 0; b < kBands; ++b) {
      s.lnF[b] += k * (t.lnF[b] - s.lnF[b]);
      s.lnQ[b] += k * (t.lnQ[b] - s.lnQ[b]);
      s.gain[b] += k * (t.gain[b] - s.gain[b]);
      // A non-finite smoother would stay stuck: snap to the target instead.
      if (is_bad(s.lnF[b])) s.lnF[b] = t.lnF[b];
      if (is_bad(s.lnQ[b])) s.lnQ[b] = t.lnQ[b];
      if (is_bad(s.gain[b])) s.gain[b] = t.gain[b];
    }
    s.nasal += k * (t.nasal - s.nasal);
    s.lnZero += k * (t.lnZero - s.lnZero);
    if (is_bad(s.nasal)) s.nasal = t.nasal;
    if (is_bad(s.lnZero)) s.lnZero = t.lnZero;
  }
  // Plosive trigger (gate_hit law: first sample > 0 after <= 0; height = velocity).
  {
    const double tr = safe(trig);
    if (tr > 0.0 && s.lastTrig <= 0.0) {
      const int pt = waveIndex(plosive, 7);
      if (pt > 0) {
        s.plType = pt;
        s.plT = 0.0;
        s.plHeight = tr < 1.0 ? tr : 1.0;
      }
    }
    s.lastTrig = tr;
  }
  const PlosiveNow pl = plosiveTick(s, sr);
  s.voiceGate += (1.0 - dsp_exp(-1.0 / (kVoiceGateSec * sr))) * (pl.voice - s.voiceGate);
  // Voiced: useExt = the graph's shared source (osc + Sub + inputs, already
  // summed for stereo) with its direct Sub in directIn; else the internal BLIT
  // osc + Sub with input ADDED (Osc / Sub at 0 = input only).
  double voiced, direct;
  if (useExt >= 0.5) {
    voiced = safe(input);
    direct = safe(directIn);
  } else {
    const Voiced v = voicedSource(s, frequencyHz, sawLevel, subLevel, wave, subWave, pw, subOct, subDirect, sr, jitter, shimmer);
    voiced = v.bank + safe(input);
    direct = v.direct;
  }
  if (s.voiceGate != 1.0) {
    voiced *= s.voiceGate;
    direct *= s.voiceGate;
  }
  // Breath: -1 in (thin, bright, higher, wider, quieter) .. +1 out (fuller,
  // darker, more resonant); 0 = the noise bank matches the voiced bank.
  double bShift = 0.0, bQ = 1.0, bTone = 1.0, bGain = 1.0;
  {
    const double br = safe(breath);
    if (br < 0.0) {
      const double u = -br;
      bShift = 0.5 * u; bQ = 1.0 - 0.6 * u; bTone = 1.0 + u; bGain = 1.0 - 0.4 * u;
    } else if (br > 0.0) {
      const double u = br;
      bShift = -0.1 * u; bQ = 1.0 + 0.5 * u; bTone = 1.0 - 0.4 * u; bGain = 1.0 + 0.2 * u;
    }
    if (!(bQ > 0.05)) bQ = 0.05;
    if (!(bTone > 0.05)) bTone = 0.05;
  }
  const int fricType = waveIndex(fricative, 6);
  const double fricLvl = safe(fricLevel);
  // Unvoiced source: white noise through a 4-pole Butterworth lowpass at
  // Noise Tone that moves with Shift (its own bank, not Body, not Drive).
  const double nz = safe(noiseLevel);
  double unvoiced = 0.0;
  {
    double tone = noiseTone;
    if (!(tone > 0.0) || is_bad(tone)) tone = kNoiseCutHz;
    double cut = tone * bTone * dsp_exp(safe(shiftOct) * kLn2);
    const double cutMax = 0.5 * sr * kNoiseCutMaxNyq;
    if (!(cut >= kNoiseCutMinHz)) cut = kNoiseCutMinHz;
    if (cut > cutMax) cut = cutMax;
    const double w = cut * 2.0 * kPi / sr;
    TptSvfCoeffs c1, c2;
    tpt_svf_setup(c1, w, 1.0 / kNoiseQ1, 1.0, 0.0, 0.0, 1.0);
    tpt_svf_setup(c2, w, 1.0 / kNoiseQ2, 1.0, 0.0, 0.0, 1.0);
    const double white = noise_color_bipolar(s.noise);
    const double lp = tpt_svf_tick(s.noiseLp2, c2, tpt_svf_tick(s.noiseLp1, c1, white));
    // Noise + plosive aspiration + fricative H all ride the noise bank.
    const double aspAll = nz + pl.asp + (fricType == 5 ? fricLvl : 0.0);
    if (aspAll != 0.0) unvoiced = aspAll * kNoiseGain * lp;
  }
  // Burst and fricative (S Sh F Th): their own bandpassed noise, after Drive.
  double extraOut = 0.0;
  const double shiftLn = safe(shiftOct) * kLn2;
  if (pl.burst != 0.0) {
    const PlosiveSpec& ps = kPlosives[s.plType];
    double bh = ps.burstHz * dsp_exp(shiftLn);
    if (bh > sr * 0.45) bh = sr * 0.45;
    if (!(bh >= 20.0)) bh = 20.0;
    TptSvfCoeffs cb;
    tpt_svf_setup_bandpass_const_peak(cb, bh * 2.0 * kPi / sr, ps.burstQ);
    extraOut += pl.burst * kBurstGain * tpt_svf_tick(s.burstBp, cb, noise_color_bipolar(s.noise));
  } else if (s.plT < 0.0) {
    tpt_svf_reset(s.burstBp);
  }
  if (fricType >= 1 && fricType <= 4 && fricLvl != 0.0) {
    const FricSpec& fs = kFrics[fricType];
    double fh = fs.hz;
    if (fh > sr * 0.45) fh = sr * 0.45;
    TptSvfCoeffs cf;
    tpt_svf_setup_bandpass_const_peak(cf, fh * 2.0 * kPi / sr, fs.q);
    extraOut += fricLvl * fs.gain * kFricGain * tpt_svf_tick(s.fricBp, cf, noise_color_bipolar(s.noise));
    s.fricLive = true;
  } else if (s.fricLive) {
    tpt_svf_reset(s.fricBp);
    s.fricLive = false;
  }
  const double twoPiOverSr = 2.0 * kPi / sr;
  const bool noiseOn = unvoiced != 0.0;
  if (!noiseOn && s.noiseBankLive) {
    for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.noiseBand[b]);
  }
  s.noiseBankLive = noiseOn;
  const bool breathFlat = bShift == 0.0 && bQ == 1.0;
  const int place = s.plType >= 1 && s.plType <= 6 ? kPlosives[s.plType].place : 0;
  double bank = 0.0, noiseBank = 0.0;
  for (int b = 0; b < kBands; ++b) {
    double lnFb = s.lnF[b];
    if (pl.trans > 0.0) lnFb += pl.trans * plosiveOffset(place, b, lnFb, shiftLn);
    const double hz = dsp_exp(lnFb);
    const double fade = bandEdgeFade(hz, sr); // from the smoothed Hz: no zipper while sweeping Shift
    if (fade <= 0.0) {
      tpt_svf_reset(s.band[b]); // out of range: skipped, re-enters from silence
    } else {
      TptSvfCoeffs c;
      tpt_svf_setup_bandpass_const_peak(c, bandTuneHz(hz, sr) * twoPiOverSr, dsp_exp(s.lnQ[b]));
      const double gf = s.gain[b] * fade;
      bank += gf * tpt_svf_tick(s.band[b], c, voiced);
      if (noiseOn && breathFlat) noiseBank += gf * tpt_svf_tick(s.noiseBand[b], c, unvoiced);
    }
    if (noiseOn && !breathFlat) {
      const double hzN = hz * dsp_exp(bShift * kLn2);
      const double fadeN = bandEdgeFade(hzN, sr);
      if (fadeN <= 0.0) {
        tpt_svf_reset(s.noiseBand[b]);
      } else {
        TptSvfCoeffs cn;
        tpt_svf_setup_bandpass_const_peak(cn, bandTuneHz(hzN, sr) * twoPiOverSr, dsp_exp(s.lnQ[b]) * bQ);
        noiseBank += s.gain[b] * fadeN * tpt_svf_tick(s.noiseBand[b], cn, unvoiced);
      }
    } else if (fade <= 0.0) {
      tpt_svf_reset(s.noiseBand[b]);
    }
  }
  bank *= t.makeup;
  noiseBank *= t.makeup * bGain;
  // Nasal anti-resonance: the zero notches the voiced bank by the Nasal amount.
  if (s.nasal != 0.0) {
    TptSvfCoeffs cz;
    tpt_svf_setup_bandpass_const_peak(cz, dsp_exp(s.lnZero) * twoPiOverSr, kZeroQ);
    bank -= s.nasal * tpt_svf_tick(s.zeroBp, cz, bank);
  } else {
    tpt_svf_reset(s.zeroBp);
  }
  const double bodyAmt = safe(body); // no 0..1 clamp: the Body parameter range decides
  TptSvfCoeffs lp;
  tpt_svf_setup(lp, bodyCutoffHz(s.lnF[0], sr) * twoPiOverSr, 1.0 / kBodyQ, 1.0, 0.0, 0.0, 1.0);
  const double low = tpt_svf_tick(s.body, lp, voiced);
  double y = (driveShape(s, bank + bodyAmt * low + direct, drive, sr) + noiseBank + extraOut) * safe(level);
  if (!(y * 0.0 == 0.0)) {
    y = 0.0;
    for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.band[b]);
    tpt_svf_reset(s.body);
    tpt_svf_reset(s.noiseLp1);
    tpt_svf_reset(s.noiseLp2);
    for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.noiseBand[b]);
    s.driveX1 = s.dcX1 = s.dcY1 = 0.0;
    tpt_svf_reset(s.zeroBp);
    tpt_svf_reset(s.burstBp);
    tpt_svf_reset(s.fricBp);
  }
  return clamp(y, -8.0, 8.0);
}

// Display eval: the linear response (Drive excluded) at the targets.
// Layout of the returned buffer:
//   [0..4]   band Hz          [5..9]  band Q        [10..14] band gain (table * knob * On)
//   [15..19] On (0/1)         [20..24] combined |H| at each band Hz (linear, Out units)
//   [25] Body cutoff Hz        [26] P points        [27] Body |H| at 20 Hz  [28] bank makeup
//   [29] nasal amount          [30] nasal zero Hz
//   [32 .. 32+P)    combined |H| at P log-spaced Hz (bank + Body, Amplitude applied)
//   [32+P .. 32+2P) Body-only |H| at the same Hz
constexpr int kEvalHeader = 32;
constexpr int kEvalMaxPoints = 2048;
static double gEval[kEvalHeader + 2 * kEvalMaxPoints];

extern "C" double* soemdsp_formant_filter_eval_buffer() { return gEval; }

namespace {
struct Cx { double re, im; };

// Exact TPT SVF response: analog prototype at s = j tan(w/2) / g.
void svfResponse(double hz, double centerHz, double q, double sr, Cx* bp, Cx* lp) {
  const double g = tpt_svf_tan_half(2.0 * kPi * centerHz / sr);
  const double t = tpt_svf_tan_half(2.0 * kPi * hz / sr);
  const double w = g > 1.0e-15 ? t / g : 1.0e15;
  const double r = 1.0 / q;
  // D = 1 - w^2 + j r w
  const double dr = 1.0 - w * w;
  const double di = r * w;
  const double den = dr * dr + di * di;
  if (lp) {
    lp->re = den > 0.0 ? dr / den : 0.0;
    lp->im = den > 0.0 ? -di / den : 0.0;
  }
  if (bp) {
    // r * j w / D
    const double nr = 0.0, ni = r * w;
    bp->re = den > 0.0 ? (nr * dr + ni * di) / den : 0.0;
    bp->im = den > 0.0 ? (ni * dr - nr * di) / den : 0.0;
  }
}
}  // namespace

extern "C" int soemdsp_formant_filter_eval_response(
  double sampleRate,
  double vowel,
  double sweep,
  double shiftOct,
  double resonance,
  double body,
  double level,
  double g1, double g2, double g3, double g4, double g5,
  double on1, double on2, double on3, double on4, double on5,
  int points,
  double minHz,
  double maxHz
) {
  double* E = gEval;
  for (int i = 0; i < kEvalHeader; ++i) E[i] = 0.0;
  const double sr = sampleRate > 1.0 ? sampleRate : 48000.0;
  if (points < 0) points = 0;
  if (points > kEvalMaxPoints) points = kEvalMaxPoints;
  if (!(minHz > 0.0)) minHz = 20.0;
  if (!(maxHz > minHz)) maxHz = minHz * 2.0;
  const double knobG[kBands] = {g1, g2, g3, g4, g5};
  const double knobOn[kBands] = {on1, on2, on3, on4, on5};
  BandTargets t;
  bandTargets(sr, vowel, sweep, shiftOct, resonance, knobG, knobOn, t);
  double hzB[kBands], qB[kBands];
  for (int b = 0; b < kBands; ++b) {
    hzB[b] = dsp_exp(t.lnF[b]);
    qB[b] = dsp_exp(t.lnQ[b]);
    t.gain[b] *= bandEdgeFade(hzB[b], sr); // same edge fade as the audio (0 = skipped)
    E[b] = hzB[b];
    E[5 + b] = qB[b];
    E[10 + b] = t.gain[b];
    E[15 + b] = knobOn[b] >= 0.5 ? 1.0 : 0.0;
  }
  const double bodyAmt = safe(body); // no 0..1 clamp: the Body parameter range decides
  const double bodyHz = bodyCutoffHz(t.lnF[0], sr);
  const double lvl = safe(level);
  E[25] = bodyHz;
  E[26] = static_cast<double>(points);
  E[28] = t.makeup;
  E[29] = t.nasal;
  E[30] = dsp_exp(t.lnZero);
  const double zeroHzEval = dsp_exp(t.lnZero);
  auto eval = [&](double hz, double* bodyMag) {
    Cx sum = {0.0, 0.0};
    for (int b = 0; b < kBands; ++b) {
      if (t.gain[b] == 0.0) continue;
      Cx bp;
      svfResponse(hz, bandTuneHz(hzB[b], sr), qB[b], sr, &bp, nullptr);
      sum.re += t.makeup * t.gain[b] * bp.re;
      sum.im += t.makeup * t.gain[b] * bp.im;
    }
    if (t.nasal != 0.0) {
      // bank x (1 - nasal x BP_zero)
      Cx z;
      svfResponse(hz, zeroHzEval, kZeroQ, sr, &z, nullptr);
      const double nr = 1.0 - t.nasal * z.re, ni = -t.nasal * z.im;
      const double r0 = sum.re * nr - sum.im * ni, i0 = sum.re * ni + sum.im * nr;
      sum.re = r0;
      sum.im = i0;
    }
    Cx lp;
    svfResponse(hz, bodyHz, kBodyQ, sr, nullptr, &lp);
    sum.re += bodyAmt * lp.re;
    sum.im += bodyAmt * lp.im;
    if (bodyMag) *bodyMag = bodyAmt * __builtin_sqrt(lp.re * lp.re + lp.im * lp.im) * lvl;
    const double m = __builtin_sqrt(sum.re * sum.re + sum.im * sum.im) * lvl;
    return (m * 0.0 == 0.0) ? m : 0.0;
  };
  for (int b = 0; b < kBands; ++b) E[20 + b] = eval(hzB[b], nullptr);
  double b20 = 0.0;
  eval(20.0, &b20);
  E[27] = b20;
  double* resp = E + kEvalHeader;
  double* bodyResp = resp + points;
  const double lnMin = dsp_ln(minHz);
  const double lnSpan = dsp_ln(maxHz) - lnMin;
  for (int i = 0; i < points; ++i) {
    const double u = points > 1 ? static_cast<double>(i) / static_cast<double>(points - 1) : 0.0;
    const double hz = dsp_exp(lnMin + lnSpan * u);
    double bm = 0.0;
    resp[i] = hz < sr * 0.5 ? eval(hz, &bm) : 0.0;
    bodyResp[i] = hz < sr * 0.5 ? ((bm * 0.0 == 0.0) ? bm : 0.0) : 0.0;
  }
  return points;
}

extern "C" int soemdsp_formant_filter_version() { return 9; } // 9: Formant Voice: nasals M / N (zero), W, AE; sweeps M A / N O / N A U / W AE; Glottal wave; Jitter / Shimmer; Breath; plosives (Trigger, P T K B D G); fricatives (S Sh F Th H). 8: R vowel + "R A E" sweep (R -> A -> I). 7: PW (live, continuous), Sub Oct (-1 / -2), Sub Direct (Sub around the bank into Drive), Noise Tone (Hz x 2^Shift); noise through its own bank after Drive (no crackle); Drive asymmetric tube tanh with ADAA + DC block. 6: Wave (Saw / Square) and Sub Wave (Sine / Saw / Square) switches; noise 4-pole lowpass at 8 kHz x 2^Shift. 5: no range clamps on Shift / Vowel / Resonance / Body / Drive (parameter ranges decide; stability guards only). 4: stereo noise source export; Shift bands fade out at Nyquist / 20 Hz instead of clamping. 2: internal BLIT saw / Sub / noise source
extern "C" const char* soemdsp_formant_filter_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_formant_filter_metadata_json_size() { return sizeof(kMetadataJson) - 1; }