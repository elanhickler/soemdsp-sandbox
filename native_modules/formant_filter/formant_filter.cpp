// soemdsp-native-module: formant_filter
// soemdsp-native-label: BLIT Formant
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
};

void initOscillators(FormantFilterState& s) {
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
// 0=A  1=E  2=I  3=O  4=U
static const double kVowelF[5][kBands] = {
  {730.0, 1090.0, 2440.0, 3400.0, 4500.0},
  {530.0, 1840.0, 2480.0, 3500.0, 4500.0},
  {270.0, 2290.0, 3010.0, 3500.0, 4600.0},
  {570.0,  840.0, 2410.0, 3400.0, 4400.0},
  {300.0,  870.0, 2240.0, 3300.0, 4300.0},
};
static const double kVowelW[5][kBands] = {
  {90.0, 110.0, 170.0, 250.0, 300.0},
  {80.0, 120.0, 170.0, 250.0, 300.0},
  {70.0, 130.0, 180.0, 250.0, 300.0},
  {85.0, 100.0, 165.0, 240.0, 300.0},
  {70.0, 100.0, 160.0, 230.0, 300.0},
};
static const double kVowelG[5][kBands] = {
  {1.00, 0.70, 0.45, 0.25, 0.12},
  {0.90, 0.85, 0.45, 0.25, 0.12},
  {0.75, 0.95, 0.50, 0.25, 0.12},
  {0.95, 0.55, 0.40, 0.22, 0.10},
  {0.80, 0.50, 0.35, 0.20, 0.10},
};

// Sweep labels (JS): "E A O U", "I E", "A E I", "O E I", "Y U"
struct SweepSpec {
  int n;
  int v[4];
};
static const SweepSpec kSweeps[5] = {
  {4, {2, 0, 3, 4}}, // I -> A -> O -> U  (saved index 0)
  {2, {2, 1, 0, 0}}, // I -> E
  {3, {0, 1, 2, 0}}, // A -> E -> I
  {3, {3, 1, 2, 0}}, // O -> E -> I
  {2, {2, 4, 0, 0}}, // I -> U  ("Y U")
};

static const char kMetadataJson[] =
  "{"
    "\"module\":\"formant_filter\","
    "\"label\":\"BLIT Formant\","
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
void evalSweep(double sweep, double pos, double outF[kBands], double outW[kBands], double outG[kBands]) {
  int si = static_cast<int>(dsp_floor(safe(sweep) + 0.5));
  if (si < 0) si = 0;
  if (si > 4) si = 4;
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
    // E A O U F1 is the intended 270-730-570-300 rise-then-fall.
    if (!(si == 0 && b == 0)) monotoneWaypoints(f, n);
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
}

struct BandTargets {
  double lnF[kBands];
  double lnQ[kBands];
  double gain[kBands];
  double makeup; // bank trim; eased down below Resonance 1 so broad bands do not stack
};

// Targets after Shift (octaves), Resonance (Q scale), per-band Gain / On.
// Shared by the audio path and the display eval so they cannot drift.
void bandTargets(
  double sampleRate, double vowel, double sweep, double shiftOct, double resonance,
  const double knobG[kBands], const double knobOn[kBands], BandTargets& t
) {
  double tf[kBands], tw[kBands], tg[kBands];
  evalSweep(sweep, vowel, tf, tw, tg);
  const double shift = safe(shiftOct); // no range clamp: the Shift parameter range decides
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

struct Voiced {
  double bank;   // into the formant bank and Body
  double direct; // Sub Direct share: around the bank, into Drive
};

// Wave: 0 Saw, 1 Square (PW = high fraction). Sub Wave: 0 Sine, 1 Saw,
// 2 Square. Sub Oct: 0 = one octave down, 1 = two. Sub Direct: 0 = all of
// the Sub through the bank (as before), 1 = all of it straight to Drive.
Voiced voicedSource(
  FormantFilterState& s, double frequencyHz, double sawLevel, double subLevel,
  double wave, double subWave, double pw, double subOct, double subDirect, double sr
) {
  double main = 0.0, subSig = 0.0;
  double hz = safe(frequencyHz);
  if (hz < 0.0) hz = -hz;
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
    main = safe(sawLevel) * (waveIndex(wave, 2) == 1 ? pulseOut : sawOut);
    const double subOsc = blitWave(s.subA, s.subB, subDiv * period, sw == 2);
    if (sw != 0) subSig = sub * subOsc;
  }
  s.subPhase += inc / subDiv;
  if (s.subPhase >= 1.0) s.subPhase -= dsp_floor(s.subPhase);
  if (sw == 0 && sub != 0.0) subSig = sub * soemdsp_blit::sinApprox(2.0 * kPi * s.subPhase);
  const double dir = safe(subDirect); // no 0..1 clamp: the Sub Direct range decides
  return { main + (1.0 - dir) * subSig, dir * subSig };
}

}  // namespace

extern "C" int soemdsp_formant_filter_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      gPool[i] = FormantFilterState{};
      initOscillators(gPool[i]);
      noise_color_reset(gPool[i].noise, 0x9E3779B9u ^ (unsigned int)(i * 2654435761u + 1u));
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
  double wave, double subWave, double pw, double subOct, double subDirect
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  FormantFilterState& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  const double sr = sampleRate > 1.0 ? sampleRate : 48000.0;
  const Voiced v = voicedSource(s, frequencyHz, sawLevel, subLevel, wave, subWave, pw, subOct, subDirect, sr);
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
  double noiseTone, double directIn
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
  }
  // Voiced: useExt = the graph's shared source (osc + Sub + inputs, already
  // summed for stereo) with its direct Sub in directIn; else the internal BLIT
  // osc + Sub with input ADDED (Osc / Sub at 0 = input only).
  double voiced, direct;
  if (useExt >= 0.5) {
    voiced = safe(input);
    direct = safe(directIn);
  } else {
    const Voiced v = voicedSource(s, frequencyHz, sawLevel, subLevel, wave, subWave, pw, subOct, subDirect, sr);
    voiced = v.bank + safe(input);
    direct = v.direct;
  }
  // Unvoiced source: white noise through a 4-pole Butterworth lowpass at
  // Noise Tone that moves with Shift (its own bank, not Body, not Drive).
  const double nz = safe(noiseLevel);
  double unvoiced = 0.0;
  {
    double tone = noiseTone;
    if (!(tone > 0.0) || is_bad(tone)) tone = kNoiseCutHz;
    double cut = tone * dsp_exp(safe(shiftOct) * kLn2);
    const double cutMax = 0.5 * sr * kNoiseCutMaxNyq;
    if (!(cut >= kNoiseCutMinHz)) cut = kNoiseCutMinHz;
    if (cut > cutMax) cut = cutMax;
    const double w = cut * 2.0 * kPi / sr;
    TptSvfCoeffs c1, c2;
    tpt_svf_setup(c1, w, 1.0 / kNoiseQ1, 1.0, 0.0, 0.0, 1.0);
    tpt_svf_setup(c2, w, 1.0 / kNoiseQ2, 1.0, 0.0, 0.0, 1.0);
    const double white = noise_color_bipolar(s.noise);
    const double lp = tpt_svf_tick(s.noiseLp2, c2, tpt_svf_tick(s.noiseLp1, c1, white));
    if (nz != 0.0) unvoiced = nz * kNoiseGain * lp;
  }
  const double twoPiOverSr = 2.0 * kPi / sr;
  const bool noiseOn = unvoiced != 0.0;
  if (!noiseOn && s.noiseBankLive) {
    for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.noiseBand[b]);
  }
  s.noiseBankLive = noiseOn;
  double bank = 0.0, noiseBank = 0.0;
  for (int b = 0; b < kBands; ++b) {
    const double hz = dsp_exp(s.lnF[b]);
    const double fade = bandEdgeFade(hz, sr); // from the smoothed Hz: no zipper while sweeping Shift
    if (fade <= 0.0) {
      tpt_svf_reset(s.band[b]); // out of range: skipped, re-enters from silence
      tpt_svf_reset(s.noiseBand[b]);
      continue;
    }
    TptSvfCoeffs c;
    tpt_svf_setup_bandpass_const_peak(c, bandTuneHz(hz, sr) * twoPiOverSr, dsp_exp(s.lnQ[b]));
    const double gf = s.gain[b] * fade;
    bank += gf * tpt_svf_tick(s.band[b], c, voiced);
    if (noiseOn) noiseBank += gf * tpt_svf_tick(s.noiseBand[b], c, unvoiced);
  }
  bank *= t.makeup;
  noiseBank *= t.makeup;
  const double bodyAmt = safe(body); // no 0..1 clamp: the Body parameter range decides
  TptSvfCoeffs lp;
  tpt_svf_setup(lp, bodyCutoffHz(s.lnF[0], sr) * twoPiOverSr, 1.0 / kBodyQ, 1.0, 0.0, 0.0, 1.0);
  const double low = tpt_svf_tick(s.body, lp, voiced);
  double y = (driveShape(s, bank + bodyAmt * low + direct, drive, sr) + noiseBank) * safe(level);
  if (!(y * 0.0 == 0.0)) {
    y = 0.0;
    for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.band[b]);
    tpt_svf_reset(s.body);
    tpt_svf_reset(s.noiseLp1);
    tpt_svf_reset(s.noiseLp2);
    for (int b = 0; b < kBands; ++b) tpt_svf_reset(s.noiseBand[b]);
    s.driveX1 = s.dcX1 = s.dcY1 = 0.0;
  }
  return clamp(y, -8.0, 8.0);
}

// Display eval: the linear response (Drive excluded) at the targets.
// Layout of the returned buffer:
//   [0..4]   band Hz          [5..9]  band Q        [10..14] band gain (table * knob * On)
//   [15..19] On (0/1)         [20..24] combined |H| at each band Hz (linear, Out units)
//   [25] Body cutoff Hz        [26] P points        [27] Body |H| at 20 Hz  [28] bank makeup
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
  auto eval = [&](double hz, double* bodyMag) {
    Cx sum = {0.0, 0.0};
    for (int b = 0; b < kBands; ++b) {
      if (t.gain[b] == 0.0) continue;
      Cx bp;
      svfResponse(hz, bandTuneHz(hzB[b], sr), qB[b], sr, &bp, nullptr);
      sum.re += t.makeup * t.gain[b] * bp.re;
      sum.im += t.makeup * t.gain[b] * bp.im;
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

extern "C" int soemdsp_formant_filter_version() { return 7; } // 7: PW (live, continuous), Sub Oct (-1 / -2), Sub Direct (Sub around the bank into Drive), Noise Tone (Hz x 2^Shift); noise through its own bank after Drive (no crackle); Drive asymmetric tube tanh with ADAA + DC block. 6: Wave (Saw / Square) and Sub Wave (Sine / Saw / Square) switches; noise 4-pole lowpass at 8 kHz x 2^Shift. 5: no range clamps on Shift / Vowel / Resonance / Body / Drive (parameter ranges decide; stability guards only). 4: stereo noise source export; Shift bands fade out at Nyquist / 20 Hz instead of clamping. 2: internal BLIT saw / Sub / noise source
extern "C" const char* soemdsp_formant_filter_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_formant_filter_metadata_json_size() { return sizeof(kMetadataJson) - 1; }