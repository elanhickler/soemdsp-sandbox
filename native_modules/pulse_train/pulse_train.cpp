// soemdsp-native-module: pulse_train
// soemdsp-native-label: Pulse Train
// soemdsp-native-target: pulseTrain
// soemdsp-native-kind: generator
//
// Pulse Train: a trigger starts a train of single-sample pulses whose gaps
// follow a time curve, like a thing slowing down over time (gaps grow).
// The schedule is a closed form (no per-pulse buffer):
//   C = Count, continuous (v37; DSP 0..16384, Forward-Reverse one-way max
//   8192 so 2N-1 fits). N = ceil(C) pulses (at least 1). Positions use C, so
//   they move continuously as Count turns: Loop u_i = i / C, One shot
//   u_i = min(1, i / (C - 1)) with the last pulse pinned at Time. Forward
//   pulse N-1 (the extra one when C is fractional) plays at f = C - (N-1),
//   fading in from 0 just above an integer to full at the next one; C < 1
//   fades the single pulse (C = 0 silent). Integer C: f = 1 and every formula
//   is the old integer one (bit-identical). Reverse / Fwd-Rev legs reuse the
//   forward schedule, so the faded pulse is forward pulse N-1 there too.
//   Slider domain is Parameter Settings max (1280, mid-skew). Type above the slider for denser trains.
//   u_i = i / (N - 1) (N = 1: u = 0), i = 0..N-1  (integer C)
//   Spacing (time family; Amp Curve stays Expo):
//     0 Expo (default): E_k(u) = (e^(k u) - 1) / (e^k - 1)  (k = 0: E(u) = u)
//     1 Harmonic: mix even u with triangular multiples of a base τ
//       (gaps 1τ, 2τ, 3τ, …). Curve 0 = linear; + = that mix; − = reverse
//       (gaps Nτ, (N-1)τ, …). |Curve|/10 is the mix amount (10 = full).
//     2 Rational: rational_curve01(u, Curve/10)  (0 = linear)
//   t_i = Time * warp(u_i)                 seconds after the trigger
//   a_i = (Start + (End Amp - Start) * E_ampCurve(u_i)) * Amplitude * velocity
// Curve > 0: gaps grow (fast first, stretching out); 0: even; < 0: gaps
// shrink (a real bouncing ball settling speeds up). First pulse at t = 0,
// last one-way pulse at exactly Time (Time 0..12 s). Pulse Mode is a
// continuous Fwd-Rev bias p in [0, 1] that walks the loud/fast peak:
//   0   one-way forward over Time (high+fast first, low+slow last)
//   0.5 reverse then forward, span 2*Time, peak in the middle
//   1   one-way reverse over Time (opposite of 0: low+slow first, peak at Time)
// (0, 0.5) grows the reverse attack in front; (0.5, 1) shrinks the forward
// tail. Span is Time*(1+2p) until 0.5, then Time*(3-2p) back to Time.
// Curve polarity − is a vertical invert of the same picture: pulse times
// stay put, each amplitude reflects around (Amp Start + Amp End)/2 so a
// peak becomes a trough and a palindrome’s time-center stays. One-shot dual last pulse at span. Loop dual skips a
// wrap duplicate at the join. End Delay is
// bipolar seconds after the last pulse: positive is silence after, negative
// ends early (drop pulses with t > lastPulse+Delay). One-shot End fires at
// max(0, lastPulse+Delay) (Count 1 last pulse is t=0). Loop cycle is
// Time*(Fwd-Rev?2:1)+Delay; pulses with t >= cycle are skipped.
// ƒ (freqHz, live even with Recalculate On): when > 0, the whole sequence
// (Time, Pulse Mode span, End Delay) is one oscillator cycle scaled into
// 1/ƒ. Pitch is ƒ; Time/Delay/Count/Curve are the waveshape. ƒ <= 0 /
// omitted: wrap is the schedule cycle as above. Never ƒ × Time.
// Mode (append-only ids): 0 One shot: u_i = i/(N-1), last one-way
// pulse exactly at Time. 1 Loop (default): free-runs from module start with no trigger;
// u_i = i / N so the one-way schedule spans [0, Time) and the last one-way
// pulse never lands on Time. Trigger hits restart the cycle at 0 (Trigger
// velocity is kept for later cycles; free-run velocity is 1).
// Time 0: every pulse on sample 0 of the cycle (allAmp cached); Delay still
// stretches or shortens the cycle. sampleRate < 1 -> 44100.
// Pulse j plays on the first sample n with n / sampleRate >= t_j (Antialiasing
// Off), after ƒ-scale when tracking. Fixed: stacked pulses pick a seed-locked
// 0 or +1 sample delay. Dither: the same 0/+1 stack, re-rolled on Trigger /
// Loop. Robin1: Schmidt ±1 around round(t_j*sr). Robin2: that pick, then a
// second ±1 around the integer (range ±2), same mean. Shape (live, default Saw
// on new nodes; append-only ids): 0 Trigger (impulses), 1 Gate 50%, 2 Saw, 3 Ramp,
// 4 TriSaw (was Tri), 5 Sine, 6 Pulse Left, 7 Pulse Center, 8 Pulse Right,
// 9 Rect Sine (v22). Morph (v22, default 0.5; omitted / NaN wasm arg = 0.5):
// TriSaw peak position (0 = falling saw, 0.5 = the old Tri bit-identical, 1 =
// rising saw; the grain still starts on the upward 0 crossing). Pulse Left /
// Center / Right: bipolar -1/+1, Morph = high fraction (width) of the grain,
// high part at the start / centred / at the end; 0.5 = 50% square. Rect Sine:
// soemdsp_maths::rect_sine_hump01 (math/rect_sine.h, the shared bipolar
// zero-mean |sin| hump), one hump per grain; Morph ignored, as by Trigger /
// Gate / Saw / Ramp / Sine. Morph outside 0..1 is not clamped (TriSaw
// extrapolates, only a divide by zero is guarded). Recalculate On latches
// Morph at each Trigger / Loop cycle start; Off: live.
// Omitted wasm waveShape is 0 Trigger. Non-trigger shapes are one naive cycle
// from pulse j to j+1
// (Loop last grain runs to the end of the pulse span, then End Delay is silent
// (v19; Delay <= 0: to the wrap); One-shot last grain to lastPulse+Delay).
// Sine/Tri start and end at 0. Preview Off.
// Shape out (sample()): the selected grain. Trigger out
// (soemdsp_pulse_train_trigger): always the impulse train. End out: 1 on the
// sample the last pulse plays (Loop), or after End Delay (One shot). No Reset
// input (v4). Amplitude is not clamped.
// soemdsp_pulse_train_preview() builds the same schedule for displays.
// Recalculate On Trigger (recalc > 0.5, default Off): schedule params (Count,
// Time, Curve, Spacing, Amp Start / End / Curve, Amplitude, Pulse Mode, Curve polarity,
// End Delay) latch at each Trigger / Loop cycle start. Free: live every sample. Loop
// Free remaps elapsed into the new period and retargets the pulse index so
// Frequency stays phase-continuous (raising ƒ does not wrap-reset). Mode,
// Antialiasing, Seed, and Shape are always live. ƒ period is always live.
// soemdsp_pulse_train_effective i: 0 Count (one-way), 1 Time, 2 Curve,
// 3 Amp Start, 4 Amp End, 5 Amp Curve, 6 Amplitude * velocity, 7 Pulse Mode,
// 8 End Delay, 9 wrap (1/ƒ when tracking, else schedule cycle).

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/trigger/trigger.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/math/seed.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/rect_sine.h>
using soemdsp_maths::gate_hit;
using soemdsp_maths::gate_hit_velocity;

namespace {

static const int kMaxInstances = 32;
static const int kMaxPulses = 16384;
static const int kMaxFwdDual = 8192; // 2*8192-1 = 16383

struct PulseTrainState {
  bool active;
  bool running;
  double prevTrig;
  long long n;  // samples since trigger
  int nFwd;     // one-way pulses = ceil(countF), at least 1
  double countF; // continuous one-way Count C (positions)
  double fade;   // amplitude of forward pulse nFwd-1: C - (nFwd-1), 1 at integer C
  int count;    // pulses this cycle (Forward-Reverse: 2*nFwd-1 or 2*nFwd-2)
  int next;
  double endOut;
  double trigOut;
  double elapsed;
  double cycle;      // span + delay (schedule cutoff)
  double wrapCycle;  // Loop wrap: 1/ƒ when tracking, else cycle
  double periodLock; // 1/ƒ when ƒ > 0, else 0
  double timeSpan;   // one-way Time
  double velocity;
  bool endFired;
  double eff[9];    // 0..6 schedule, 7 Pulse Mode, 8 End Delay
  double effVel;
  bool loopSched;
  double pulseMode; // Fwd-Rev bias 0..1
  double polarity;  // 0 + peak, 1 - trough (invert curves around center)
  int spacing;      // 0 Expo / 1 Harmonic / 2 Rational
  bool allAtZero;
  double allAmp;
  double spill[5]; // AA impulse energy delayed 1..4 samples
  unsigned int ditherEpoch;
  long long cycleN; // Loop wrap sample index this cycle (Dither/Robin)
  double morphEff;  // Morph latched at Trigger / Loop start (Recalculate On)
  // Cycle start sits phaseOff s before sample 0 (v33: every AA mode). A Free
  // live period change remaps the cycle position as a 0..1 fraction and keeps
  // the sub-sample remainder here, so the train never stalls or restarts.
  // Every Trigger / Loop cycle start resets it to 0 (whole-sample cycle, v34).
  double phaseOff;
  // Highest pulse index fired this cycle: a Free remap can move n back onto
  // a landing that already played; it must not fire again (v33).
  int firedMax;
  // Schedule layout (one-way pulses, pulses this cycle, 0 Forward / 1 Reverse
  // / 2 Fwd-Rev order) and the sample n it last changed on (-1: since the
  // cycle start). Pulse indexes only mean the same pulse while it holds, so a
  // retarget trusts firedMax+1 as "the next pulse" only then (v37).
  int layoutNFwd;
  int layoutTotal;
  int layoutOrder;
  long long layoutAt;
};

struct PreviewSched {
  int nFwd;
  double countF;
  double fade;
  int count;
  bool loop;
  double pulseMode;
  double polarity;
  double end;
  double delay;
  double curve;
  int spacing;
  double ampStart;
  double ampEnd;
  double ampCurve;
  double amplitude;
};

static PulseTrainState gPool[kMaxInstances];
static PreviewSched gPreview = {};

// Pulse Mode p in [0, 1]: 0 Forward; 0.5 out-and-back peak at Time; 1 reverse.
// Values > 1 (old integer Reverse / Rev-Fwd) clamp to 1.
// polarity > 0.5 is − (same times, amp inverted around start/end center); else + (peak).
static inline double pulseBiasOf(double v) {
  if (!(v == v) || v <= 0.0) return 0.0;
  if (v >= 1.0) return 1.0;
  return v;
}

static inline bool polarityNeg(double v) { return v > 0.5; }

static inline double preAmtOf(double p) {
  p = pulseBiasOf(p);
  if (!(p > 0.0)) return 0.0;
  if (p >= 0.5) return 1.0;
  return p * 2.0;
}

static inline double postAmtOf(double p) {
  p = pulseBiasOf(p);
  if (p >= 1.0) return 0.0;
  if (!(p > 0.5)) return 1.0;
  return (1.0 - p) * 2.0;
}

static inline double spanScaleOf(double p) {
  return preAmtOf(p) + postAmtOf(p);
}

static inline bool isDual(double p) { return preAmtOf(p) > 0.0 && postAmtOf(p) > 0.0; }

static inline bool isRevOnly(double p) { return preAmtOf(p) > 0.0 && !(postAmtOf(p) > 0.0); }

// Count -> continuous one-way C (v37). NaN reads as 1; <= 0 is 0 (one silent
// pulse); the DSP domain tops out at 16384 (Fwd-Rev 8192).
static inline double countContOf(double count, double pulseBias) {
  if (!(count == count)) return 1.0;
  if (!(count > 0.0)) return 0.0;
  const double cap = isDual(pulseBias) ? (double)kMaxFwdDual : (double)kMaxPulses;
  return count >= cap ? cap : count;
}

// Pulses for C: ceil(C), at least 1.
static inline int pulsesOf(double c) {
  int n = (int)c;
  if ((double)n < c) n += 1;
  return n < 1 ? 1 : n;
}

// Amplitude of forward pulse nFwd-1: C - (nFwd-1) in [0, 1]; exactly 1 at integer C.
static inline double fadeOf(double c, int nFwd) {
  const double f = c - (double)(nFwd - 1);
  if (!(f < 1.0)) return 1.0;
  return f > 0.0 ? f : 0.0;
}

static inline int totalCount(int nFwd, double pulseBias, bool loop, double polarity) {
  (void)loop;
  (void)polarity;
  if (!isDual(pulseBias) || nFwd <= 1) return nFwd;
  return 2 * nFwd - 1;
}

static inline int fwdRevIndex(int j, int nFwd) {
  if (j < nFwd) return j;
  return 2 * nFwd - 1 - j;
}

static inline double curveShape(double k, double u) {
  if (!(k > 1e-6 || k < -1e-6)) return u;
  return (soemdsp_maths::dsp_exp(k * u) - 1.0) / (soemdsp_maths::dsp_exp(k) - 1.0);
}

enum {
  kSpacingExpo = 0,
  kSpacingHarmonic = 1,
  kSpacingRational = 2,
};

static int gTimeSpacing = 0;
// Continuous Count of the schedule being evaluated (instance or preview), set
// next to gTimeSpacing. Integer C keeps every formula bit-identical.
static double gCountF = 1.0;
static double gFade = 1.0;

static inline int spacingOf(double v) {
  if (!(v == v) || v < 0.5) return kSpacingExpo;
  int n = (int)(v + 0.5);
  if (n > kSpacingRational) n = kSpacingRational;
  return n;
}

// u from the continuous Count C (= n at integer C). One shot: the extra pulse
// would land past 1, so u stops at 1 (that pulse is pinned at Time anyway).
static inline double pulseU(int i, int n, bool loop) {
  const double c = gCountF;
  if (loop) return c > 0.0 ? (double)i / c : 0.0;
  if (n <= 1) return 0.0;
  const double u = (double)i / (c - 1.0);
  return u < 1.0 ? u : 1.0;
}

// Time warp. Curve 0 is even (linear) in every family.
static inline double timeWarp(double k, double u, int i, int nFwd, bool loop) {
  if (!(u >= 0.0)) u = 0.0;
  if (u > 1.0) u = 1.0;
  const int fam = gTimeSpacing;
  if (fam == kSpacingHarmonic) {
    const double n = gCountF; // continuous Count (== nFwd at integer C)
    const double ii = (double)i;
    double h;
    if (loop) h = n > 0.0 ? (ii * (ii + 1.0)) / (n * (n + 1.0)) : 0.0;
    else h = nFwd > 1 ? (ii * (ii + 1.0)) / ((n - 1.0) * n) : 0.0;
    double w = k < 0.0 ? -k : k;
    w *= 0.1;
    if (w > 1.0) w = 1.0;
    if (!(k < 0.0)) return u + w * (h - u);
    double hr;
    if (loop) hr = n > 0.0 ? (ii * (2.0 * n - ii + 1.0)) / (n * (n + 1.0)) : 0.0;
    else hr = nFwd > 1 ? (ii * (2.0 * n - ii - 1.0)) / ((n - 1.0) * n) : 0.0;
    return u + w * (hr - u);
  }
  if (fam == kSpacingRational) {
    double s = k * 0.1;
    if (s > 0.99) s = 0.99;
    if (s < -0.99) s = -0.99;
    return soemdsp_maths::rational_curve01(u, s);
  }
  return curveShape(k, u);
}

static inline double oneWayTime(int i, int nFwd, double end, double curve, bool loop, double polarity) {
  (void)polarity;
  const double k = curve;
  if (!loop && i == nFwd - 1 && nFwd > 1) return end;
  double t = end * timeWarp(k, pulseU(i, nFwd, loop), i, nFwd, loop);
  if (!(t >= 0.0)) t = 0.0;
  if (t > end) t = end;
  return t;
}

// Reverse physical k (>= nFwd) then forward. Reverse attack is scaled by preAmt;
// forward tail by postAmt. Join is at preAmt*Time.
static inline double fwdRevTime(int j, int nFwd, double end, double curve, bool loop, double pulseBias, double polarity) {
  const double p = pulseBiasOf(pulseBias);
  const int i = fwdRevIndex(j, nFwd);
  const bool rev = j >= nFwd;
  const double tf = oneWayTime(i, nFwd, end, curve, rev ? false : loop, polarity);
  const double pre = preAmtOf(p);
  const double post = postAmtOf(p);
  if (rev) {
    double t = pre * (end - tf);
    if (!(t >= 0.0)) t = 0.0;
    return t;
  }
  double t = pre * end + post * tf;
  if (!(t >= 0.0)) t = 0.0;
  return t;
}

// Time-order index j -> physical k. Reverse pulses first (attack / trough walk).
static inline int timeOrderK(int j, int nFwd, int total) {
  const int nRev = total - nFwd;
  if (j < nRev) return nFwd + j;
  return j - nRev;
}

static inline int origK(int j, int nFwd, int total) {
  return timeOrderK(j, nFwd, total);
}

static inline double pulseTime(int j, int nFwd, double end, double curve, bool loop, double pulseBias, double polarity) {
  const double p = pulseBiasOf(pulseBias);
  if (nFwd <= 1) return oneWayTime(0, nFwd, end, curve, loop, polarity);
  if (isRevOnly(p)) {
    const int i = nFwd - 1 - j;
    double tf = oneWayTime(i, nFwd, end, curve, false, polarity);
    double t = end - tf;
    if (!(t >= 0.0)) t = 0.0;
    if (t > end) t = end;
    // Loop last pulse must sit before Time so it is not dropped at the wrap.
    if (loop && nFwd > 1) t *= (gCountF - 1.0) / gCountF;
    return t;
  }
  if (!isDual(p)) return oneWayTime(j, nFwd, end, curve, loop, polarity);
  const int total = totalCount(nFwd, p, loop, polarity);
  const int k = origK(j, nFwd, total);
  return fwdRevTime(k, nFwd, end, curve, loop, p, polarity);
}

static inline double pulseAmp(
  int j, int nFwd, double end, double curve,
  double ampStart, double ampEnd, double ampCurve,
  double amplitude, double velocity, bool loop, double pulseBias, double polarity
) {
  const double p = pulseBiasOf(pulseBias);
  double a0 = ampStart, a1 = ampEnd, ac = ampCurve;
  if (polarityNeg(polarity)) {
    a0 = ampEnd;
    a1 = ampStart;
  }
  int i = j;
  bool uLoop = loop;
  if (nFwd > 1 && isRevOnly(p)) {
    i = nFwd - 1 - j;
    uLoop = false;
  } else if (isDual(p) && nFwd > 1) {
    const int total = totalCount(nFwd, p, loop, polarity);
    const int k = origK(j, nFwd, total);
    i = fwdRevIndex(k, nFwd);
    uLoop = k >= nFwd ? false : loop;
  }
  const double a = (a0 + (a1 - a0) * curveShape(ac, pulseU(i, nFwd, uLoop))) * amplitude * velocity;
  // Fractional Count: forward pulse nFwd-1 fades (every leg that plays it).
  if (i == nFwd - 1 && gFade < 1.0) return a * gFade;
  return a;
}

static inline bool paramsEqual(const double a[9], const double b[9]) {
  for (int k = 0; k < 9; k++) if (!(a[k] == b[k])) return false;
  return true;
}

static inline double clampDelay(double d) {
  if (!(d == d)) return 0.0;
  return d;
}

static inline double oneShotEndTime(
  int count, int nFwd, double end, double curve, bool loop, double pulseMode, double delay, double polarity
) {
  const double lastT = count <= 0 ? 0.0
    : pulseTime(count - 1, nFwd, end, curve, loop, pulseMode, polarity);
  double tE = lastT + delay;
  if (!(tE >= 0.0)) tE = 0.0;
  return tE;
}

static inline double trackPeriodOf(double freqHz, double sr) {
  if (!(freqHz > 0.0)) return 0.0;
  double p = 1.0 / freqHz;
  const double minP = sr > 0.0 ? 1.0 / sr : 0.0;
  if (minP > 0.0 && p < minP) p = minP;
  return p;
}

// Loop: skip t >= schedCycle (Time*(Fwd-Rev?2:1)+Delay). One-shot: skip t > tE.
// Wired ƒ scales that whole cycle into 1/ƒ (cutoff stays in unscaled Time).
static inline bool pulseAfterCutoff(double t, bool loop, double cycle, double tE) {
  if (loop) return cycle > 0.0 ? t >= cycle : t > 0.0;
  return t > tE;
}

static inline double playT(double t, double scale) {
  return t * scale;
}

// Edge Fade (v38): when the schedule runs past its cutoff E (Loop: the cycle,
// e.g. Stretch > 0; One shot: a negative End Delay), the last pulse k still
// inside plays at (E - t_k) / (t_k+1 - t_k): 0 when the edge just reached it,
// full when the edge reaches the next pulse, which then enters at 0. Pulses
// slide in and out of the edge instead of popping. 1 when nothing is cut.
static inline double edgeFadeOf(
  int j, int total, int nFwd, double endT, double curve, bool loop, double pulseMode,
  double polarity, double cycle, double tE
) {
  if (j + 1 >= total) return 1.0;
  if (loop && !(cycle > 0.0)) return 1.0;
  const double tn = pulseTime(j + 1, nFwd, endT, curve, loop, pulseMode, polarity);
  if (!pulseAfterCutoff(tn, loop, cycle, tE)) return 1.0;
  const double tj = pulseTime(j, nFwd, endT, curve, loop, pulseMode, polarity);
  const double gap = tn - tj;
  if (!(gap > 0.0)) return 1.0;
  const double f = ((loop ? cycle : tE) - tj) / gap;
  if (!(f > 0.0)) return 0.0;
  return f < 1.0 ? f : 1.0;
}

static const unsigned int kSeedAa = 1u;
static const unsigned int kSeedEpoch = 2u;
static const unsigned int kSeedAa2 = 3u;

enum {
  kShapeTrigger = 0,
  kShapeGate = 1,
  kShapeSaw = 2,
  kShapeRamp = 3,
  kShapeTriSaw = 4, // was Tri (Morph 0.5 = old Tri, bit-identical)
  kShapeSine = 5,
  kShapePulseLeft = 6,
  kShapePulseCenter = 7,
  kShapePulseRight = 8,
  kShapeRectSine = 9
};

// Antialiasing (v34), stored value = choice: 0 Quant (default), 1 Rand,
// 2 Dither. Quant (aaMode 0) = the old Off: pulses land on the first sample at
// or after their time, the Loop cycle is whole samples. Rand = seed-locked
// stack 0/+1 (native 1). Dither = Robin1 ±1 (native 3). The patch loader
// rewrites retired v32/v33 values 3 None / 4 PolyBLEP to 0 Quant.
static inline int aaModeOf(double antialiasing) {
  if (antialiasing >= 1.5) return 3; // Dither = Robin1 ±1
  if (antialiasing >= 0.5) return 1; // Rand
  return 0; // Quant
}

static inline int shapeOf(double wave) {
  int s = (int)(wave + (wave >= 0.0 ? 0.5 : -0.5));
  if (s < 0) s = 0;
  if (s > kShapeRectSine) s = kShapeRectSine;
  return s;
}

static inline unsigned int aaStream(unsigned int seed, unsigned int epoch, int aaMode) {
  if (aaMode >= 2) return soemdsp_maths::seed_mix(seed, kSeedEpoch, epoch);
  return seed;
}

static double gPhaseOff = 0.0; // this instance's phaseOff (cycle start before sample 0)

static inline long long ceilLand(double t, double sr) {
  t -= gPhaseOff;
  if (!(t > 0.0) || !(sr > 0.0)) return 0;
  const double x = t * sr;
  const long long fl = (long long)x;
  const double frac = x - (double)fl;
  return frac > 0.0 ? fl + 1 : fl;
}

// Off / isolated: first n with n >= t*sr. Fixed + stacked: seed-stable 0 or +1
// sample from that ceil (never early). Stacked = this pulse's ceil equals a neighbor's.
static inline long long pulseLand(
  int j, int total, double t, double tPrev, double tNext, double sr, unsigned int seed, bool aa
) {
  const long long c = ceilLand(t, sr);
  if (!aa) return c;
  bool stacked = false;
  if (j > 0 && ceilLand(tPrev, sr) == c) stacked = true;
  if (j + 1 < total && ceilLand(tNext, sr) == c) stacked = true;
  if (!stacked) return c;
  const double u = (double)(soemdsp_maths::seed_mix(seed, kSeedAa, (unsigned int)j) >> 8) / 16777216.0;
  return u < 0.5 ? c + 1 : c;
}

// Robin Schmidt short/mid/long ±1 around round(c), mean c, variance 0.25.
static inline long long robinPick3(double c, unsigned int seed, unsigned int j, unsigned int component) {
  if (!(c > 0.0)) c = 0.0;
  const double ci = soemdsp_maths::dsp_floor(c);
  const double cf = c - ci;
  double c2 = ci;
  if (cf >= 0.5) c2 += 1.0;
  const double c1 = c2 - 1.0;
  const double c3 = c2 + 1.0;
  const double e1 = c1 - c, e2 = c2 - c, e3 = c3 - c;
  const double v = 0.25;
  const double v1 = e1 * e1, v2 = e2 * e2, v3 = e3 * e3;
  const double d1 = v - v1, d2 = v - v2, d3 = v - v3;
  const double denom = e3 * (v1 - v2) - e2 * (v1 - v3) + e1 * (v2 - v3);
  double lenNow = c2;
  if (denom == denom && denom != 0.0) {
    const double s = 1.0 / denom;
    const double probShort = (d2 * e3 - d3 * e2) * s;
    const double probMid = (d3 * e1 - d1 * e3) * s;
    const double r = (double)(soemdsp_maths::seed_mix(seed, component, j) >> 8) / 16777216.0;
    if (r < probShort) lenNow = c2 - 1.0;
    else if (r >= probShort + probMid) lenNow = c2 + 1.0;
  }
  if (lenNow < 0.0) lenNow = 0.0;
  return (long long)lenNow;
}

static inline long long robinLand(double t, double sr, unsigned int seed, unsigned int j) {
  if (!(sr > 0.0)) return 0;
  return robinPick3((t - gPhaseOff) * sr, seed, j, kSeedAa);
}

// Robin2: ±1 pick, then a second independent ±1 around that integer (range ±2).
static inline long long robinLand2(double t, double sr, unsigned int seed, unsigned int j) {
  const long long a = robinLand(t, sr, seed, j);
  return robinPick3((double)a, seed, j, kSeedAa2);
}

static inline long long robinRound(double t, double sr) {
  if (!(sr > 0.0)) return 0;
  double c = (t - gPhaseOff) * sr;
  if (!(c > 0.0)) c = 0.0;
  const double ci = soemdsp_maths::dsp_floor(c);
  double c2 = ci;
  if (c - ci >= 0.5) c2 += 1.0;
  return (long long)c2;
}

static inline long long robinEarliest(double t, double sr, int radius) {
  long long e = robinRound(t, sr) - (radius < 1 ? 1 : radius);
  return e < 0 ? 0 : e;
}

static inline long long robinLatest(double t, double sr, int radius) {
  return robinRound(t, sr) + (radius < 1 ? 1 : radius);
}

static inline long long eventLand(
  double t, double sr, unsigned int seed, unsigned int j, int aaMode, bool stacked
) {
  if (aaMode >= 4) return robinLand2(t, sr, seed, j);
  if (aaMode >= 3) return robinLand(t, sr, seed, j);
  const long long c = ceilLand(t, sr);
  if (aaMode >= 1 && stacked) {
    const double u = (double)(soemdsp_maths::seed_mix(seed, kSeedAa, j) >> 8) / 16777216.0;
    return u < 0.5 ? c + 1 : c;
  }
  return c;
}

static inline double grainWave(int shape, double u, double morph) {
  if (u < 0.0) u = 0.0;
  if (u > 1.0) u = 1.0;
  if (shape == kShapeGate) return u < 0.5 ? 1.0 : 0.0;
  if (shape == kShapeSaw) return 2.0 * u - 1.0;
  if (shape == kShapeRamp) return 1.0 - 2.0 * u;
  if (shape == kShapeTriSaw) {
    // Peak at u = m/2 (+1), trough at 1 - m/2 (-1), start / end at 0. At m =
    // 0.5 every op is the old Tri's times an exact power of two (bit-identical).
    const double m = morph;
    const double h = 0.5 * m;
    if (u < h) return 2.0 * u / m;
    if (u < 1.0 - h || !(m > 0.0)) {
      const double d = 1.0 - m;
      return d > 0.0 || d < 0.0 ? (1.0 - 2.0 * u) / d : -1.0;
    }
    return (2.0 * u - 2.0) / m;
  }
  if (shape == kShapeSine) return soemdsp_maths::dsp_sin_turns(u);
  if (shape == kShapePulseLeft) return u < morph ? 1.0 : -1.0;
  if (shape == kShapePulseCenter) {
    const double hw = 0.5 * morph;
    return (u >= 0.5 - hw && u < 0.5 + hw) ? 1.0 : -1.0;
  }
  if (shape == kShapePulseRight) return u >= 1.0 - morph ? 1.0 : -1.0;
  if (shape == kShapeRectSine) return soemdsp_maths::rect_sine_hump01(u);
  return 0.0;
}

static void clearSpill(PulseTrainState& s) {
  s.spill[0] = s.spill[1] = s.spill[2] = s.spill[3] = s.spill[4] = 0.0;
}

static double takeSpill(PulseTrainState& s) {
  const double y = s.spill[0];
  s.spill[0] = s.spill[1];
  s.spill[1] = s.spill[2];
  s.spill[2] = s.spill[3];
  s.spill[3] = s.spill[4];
  s.spill[4] = 0.0;
  return y;
}

static bool spillPending(const PulseTrainState& s) {
  return s.spill[0] > 0.0 || s.spill[1] > 0.0 || s.spill[2] > 0.0
    || s.spill[3] > 0.0 || s.spill[4] > 0.0;
}

static void addAt(PulseTrainState& s, long long land, long long n, double amp, double* out) {
  if (land <= n) {
    *out += amp;
    return;
  }
  long long d = land - n;
  if (d < 1) d = 1;
  if (d > 4) d = 4;
  s.spill[d - 1] += amp;
}

static void applySchedule(PulseTrainState& s, const double live[9], double v, bool loop, double polarity, int spacing) {
  s.pulseMode = pulseBiasOf(live[7]);
  s.polarity = polarityNeg(polarity) ? 1.0 : 0.0;
  s.spacing = spacing;
  gTimeSpacing = spacing;
  s.countF = countContOf(live[0], s.pulseMode);
  s.nFwd = pulsesOf(s.countF);
  s.fade = fadeOf(s.countF, s.nFwd);
  gCountF = s.countF;
  gFade = s.fade;
  s.count = totalCount(s.nFwd, s.pulseMode, loop, s.polarity);
  const int order = s.nFwd > 1 && isDual(s.pulseMode) ? 2 : (s.nFwd > 1 && isRevOnly(s.pulseMode) ? 1 : 0);
  if (s.layoutNFwd != s.nFwd || s.layoutTotal != s.count || s.layoutOrder != order) {
    // Reverse-first orders (Reverse, Fwd-Rev) number pulses from the faded
    // forward pulse nFwd-1 at the front, so a live Count step of d shifts every
    // pulse index by d: shift firedMax with them so a pulse that already played
    // is not played again (or a pending one skipped). A single pulse fits any
    // order. Forward <-> reverse-first switches cannot be mapped (left as is).
    const int oldN = s.layoutNFwd;
    if (s.firedMax >= 0 && oldN > 0) {
      const bool oldRevOk = oldN <= 1 || s.layoutOrder != 0;
      const bool newRevOk = s.nFwd <= 1 || order != 0;
      const bool anyRev = (oldN > 1 && s.layoutOrder != 0) || (s.nFwd > 1 && order != 0);
      if (oldRevOk && newRevOk && anyRev) {
        s.firedMax += s.nFwd - oldN;
        if (s.firedMax < -1) s.firedMax = -1;
      }
    }
    s.layoutNFwd = s.nFwd;
    s.layoutTotal = s.count;
    s.layoutOrder = order;
    s.layoutAt = s.n;
  }
  for (int k = 0; k < 9; k++) s.eff[k] = live[k];
  s.effVel = v;
  s.timeSpan = live[1] > 0.0 ? live[1] : 0.0;
  const double delay = clampDelay(live[8]);
  const double span = spanScaleOf(s.pulseMode) * s.timeSpan;
  s.cycle = span + delay;
  if (!(s.cycle == s.cycle)) s.cycle = 0.0;
  s.loopSched = loop;
  s.allAtZero = !(s.timeSpan > 0.0);
  if (s.allAtZero) {
    double sum = 0.0;
    for (int i = 0; i < s.count; i++) {
      sum += pulseAmp(i, s.nFwd, s.timeSpan, live[2], live[3], live[4], live[5], live[6], v, loop, s.pulseMode, s.polarity);
    }
    s.allAmp = sum;
  } else {
    s.allAmp = 0.0;
  }
}

static inline long long landPulse(
  int j, int total, int nFwd, double end, double curve, bool loop, double pulseMode,
  double sr, unsigned int seed, int aaMode, double scale, double polarity
) {
  const double tU = pulseTime(j, nFwd, end, curve, loop, pulseMode, polarity);
  const double t = playT(tU, scale);
  if (aaMode >= 4) return robinLand2(t, sr, seed, (unsigned int)j);
  if (aaMode >= 3) return robinLand(t, sr, seed, (unsigned int)j);
  if (aaMode >= 1) {
    const double tPrev = playT(j > 0 ? pulseTime(j - 1, nFwd, end, curve, loop, pulseMode, polarity) : 0.0, scale);
    const double tNext = playT(j + 1 < total ? pulseTime(j + 1, nFwd, end, curve, loop, pulseMode, polarity) : tU, scale);
    return pulseLand(j, total, t, tPrev, tNext, sr, seed, true);
  }
  return ceilLand(t, sr);
}

static int firstPulseAfter(
  long long nPrev, int nFwd, int total, double end, double curve, bool loop, double pulseMode, double sr, int aaMode,
  double scale, double polarity
) {
  if (total <= 0) return 0;
  if (!(end > 0.0)) return nPrev >= 0 ? total : 0;
  int lo = 0;
  int hi = total;
  while (lo < hi) {
    const int mid = lo + ((hi - lo) >> 1);
    const double t = playT(pulseTime(mid, nFwd, end, curve, loop, pulseMode, polarity), scale);
    const int rad = aaMode >= 4 ? 2 : 1;
    const long long latest = aaMode >= 3 ? robinLatest(t, sr, rad) : ceilLand(t, sr);
    if (latest <= nPrev) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The layout held on the previous sample and this one, so pulse firedMax+1
// is the same pulse that was not yet due one sample ago.
static inline bool sameLayout(const PulseTrainState& s) {
  return s.firedMax >= 0 && s.layoutAt < s.n - 1;
}

// Loop + Free: the pulse index that belongs at sample n after a live period
// change. Trigger: first land at or after n (do not refire). Grain: the grain
// that contains n (k-1), so a Frequency sweep does not skip-to-end then wrap.
// rescue (v37): the pulse after the last one fired, when the schedule layout
// (pulses per leg) has not changed since that fire, else -1. A live Count /
// Time turn moves landings continuously, so that pulse can slide back across
// the sample boundary on the very sample the playhead reaches it; it then
// plays one sample late instead of being skipped.
static inline int pulseIndexAt(
  long long n, int nFwd, int total, double end, double curve, bool loop, double pulseMode,
  double sr, int aaMode, double scale, int shape, double polarity, int rescue
) {
  const long long nPrev = n > 0 ? n - 1 : -1;
  const int k = firstPulseAfter(nPrev, nFwd, total, end, curve, loop, pulseMode, sr, aaMode, scale, polarity);
  if (shape != kShapeTrigger && k > 0) return k - 1;
  if (rescue >= 0 && k == rescue + 1 && rescue < total && n > 0) {
    const double t = playT(pulseTime(rescue, nFwd, end, curve, loop, pulseMode, polarity), scale);
    const int rad = aaMode >= 4 ? 2 : 1;
    const long long latest = aaMode >= 3 ? robinLatest(t, sr, rad) : ceilLand(t, sr);
    if (latest == n - 1) return rescue;
  }
  return k;
}

}  // namespace

extern "C" int soemdsp_pulse_train_version() { return 38; } // v38: Edge Fade (last pulse before the cutoff fades); was v37 continuous Count

extern "C" int soemdsp_pulse_train_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      PulseTrainState& s = gPool[i];
      s.running = false;
      s.prevTrig = 0.0;
      s.n = 0;
      s.nFwd = 0;
      s.countF = 1.0;
      s.fade = 1.0;
      s.count = 0;
      s.next = 0;
      s.endOut = 0.0;
      s.trigOut = 0.0;
      s.elapsed = -1.0;
      s.cycle = 0.0;
      s.wrapCycle = 0.0;
      s.periodLock = 0.0;
      s.timeSpan = 0.0;
      s.velocity = 1.0;
      s.endFired = false;
      for (int k = 0; k < 9; k++) s.eff[k] = 0.0;
      s.effVel = 1.0;
      s.loopSched = false;
      s.pulseMode = 0.0;
      s.polarity = 0.0;
      s.spacing = kSpacingExpo;
      s.allAtZero = false;
      s.allAmp = 0.0;
      s.spill[0] = s.spill[1] = s.spill[2] = s.spill[3] = s.spill[4] = 0.0;
      s.ditherEpoch = 0;
      s.cycleN = 0;
      s.phaseOff = 0.0;
      s.firedMax = -1;
      s.layoutNFwd = 0;
      s.layoutTotal = 0;
      s.layoutOrder = 0;
      s.layoutAt = -1;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_pulse_train_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_pulse_train_sample(
  int handle, double trigger, double count, double endTime, double curve,
  double ampStart, double ampEnd, double ampCurve, double amplitude, double sampleRate, double mode,
  double recalc, double pulseMode, double endDelay, double antialiasing, double seed, double waveShape,
  double freqHz, double morph, double curvePolarity, double spacing, double edgeFade
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  const double morphLive = morph == morph ? morph : 0.5; // omitted wasm arg (NaN) = 0.5
  const bool edgeOn = edgeFade > 0.5; // omitted wasm arg (NaN) = Off (v37 output)
  const double polarityLive = polarityNeg(curvePolarity) ? 1.0 : 0.0;
  const int spacingLive = spacingOf(spacing); // omitted wasm arg (NaN/0) = Expo
  const bool loop = mode > 0.5;
  const bool latch = recalc > 0.5;
  const int aaMode = aaModeOf(antialiasing);
  const int shape = shapeOf(waveShape);
  const unsigned int seedU = soemdsp_maths::seed_param_u32(seed);
  PulseTrainState& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  gPhaseOff = s.phaseOff;
  const double pulseModeLive = pulseBiasOf(pulseMode);
  const double live[9] = {
    count, endTime, curve, ampStart, ampEnd, ampCurve, amplitude,
    pulseModeLive, clampDelay(endDelay)
  };
  s.endOut = 0.0;
  s.trigOut = 0.0;
  const bool trigHit = gate_hit(trigger, &s.prevTrig);
  if (trigHit) s.velocity = gate_hit_velocity();
  const bool runningLatch = latch && s.running;
  const double pol = runningLatch ? s.polarity : polarityLive;
  const int spacingNow = runningLatch ? s.spacing : spacingLive;
  gTimeSpacing = spacingNow;
  gCountF = s.countF;
  gFade = s.fade;
  const double modeNow = runningLatch ? s.pulseMode : pulseModeLive;
  const double timeNow = runningLatch ? s.timeSpan : (endTime > 0.0 ? endTime : 0.0);
  const double delayNow = runningLatch ? clampDelay(s.eff[8]) : live[8];
  double schedNow = runningLatch ? s.cycle : (spanScaleOf(modeNow) * timeNow + delayNow);
  if (!(schedNow == schedNow)) schedNow = 0.0;
  const double periodLock = trackPeriodOf(freqHz, sr);
  const double scale = (periodLock > 0.0 && schedNow > 0.0) ? (periodLock / schedNow) : 1.0;
  const double wrapNow = periodLock > 0.0 ? periodLock : (schedNow > 0.0 ? schedNow : (1.0 / sr));
  const double prevWrap = s.wrapCycle;
  // Free + Loop: wrap against the previous period, then remap n into the new
  // period so a live Frequency jump keeps phase. Latch uses wrapNow (the
  // latched cycle) and does not remap.
  bool naturalWrap = false;
  if (s.running && s.n > 0) {
    if (aaMode >= 2 && (latch || prevWrap <= 0.0 || wrapNow == prevWrap)) {
      naturalWrap = s.n >= (s.cycleN > 0 ? s.cycleN : 1);
    } else {
      const double gate = (!latch && prevWrap > 0.0) ? prevWrap : wrapNow;
      naturalWrap = ((double)s.n / sr + s.phaseOff) >= gate;
    }
  }
  const bool remapLive = !latch && loop && s.running && !trigHit && !naturalWrap
    && prevWrap > 0.0 && wrapNow > 0.0
    && !(wrapNow == prevWrap);
  if (remapLive) {
    double phase = ((double)s.n / sr + s.phaseOff) / prevWrap;
    if (!(phase >= 0.0)) phase = 0.0;
    if (phase > 1.0) phase = 1.0;
    s.n = (long long)(phase * wrapNow * sr);
    // Keep the sub-sample remainder (truncating it stalled n at 0 while a
    // rising Frequency was smoothing: the train refired / restarted, v33).
    s.phaseOff = phase * wrapNow - (double)s.n / sr;
    gPhaseOff = s.phaseOff;
  }
  s.periodLock = periodLock;
  s.wrapCycle = wrapNow;
  if (s.running && periodLock > 0.0) {
    const unsigned int streamW = aaStream(seedU, s.ditherEpoch, aaMode);
    s.cycleN = eventLand(wrapNow, sr, streamW, (unsigned int)s.count + 1u, aaMode, aaMode == 2);
  } else if (remapLive && aaMode >= 2) {
    const unsigned int streamW = aaStream(seedU, s.ditherEpoch, aaMode);
    s.cycleN = eventLand(wrapNow, sr, streamW, (unsigned int)s.count + 1u, aaMode, aaMode == 2);
  }
  const bool loopStart = loop && (!s.running || trigHit || naturalWrap);
  bool retargeted = false; // pulseIndexAt ran this sample (live Free change / ƒ lock)
  if (trigHit || loopStart) {
    const double v = trigHit ? gate_hit_velocity() : s.velocity;
    const bool needBuild = !s.running || trigHit || !paramsEqual(s.eff, live)
      || !(s.effVel == v) || s.loopSched != loop || s.polarity != polarityLive
      || s.spacing != spacingLive;
    if (needBuild) applySchedule(s, live, v, loop, polarityLive, spacingLive);
    s.morphEff = morphLive;
    // Cycle starts on a whole sample (Quant = old Off sample grid, v34).
    s.phaseOff = 0.0;
    gPhaseOff = 0.0;
    s.next = 0;
    s.n = 0;
    s.firedMax = -1;
    s.layoutAt = -1;
    s.endFired = false;
    s.running = true;
    clearSpill(s);
    if (aaMode >= 2) s.ditherEpoch += 1u;
    const unsigned int stream0 = aaStream(seedU, s.ditherEpoch, aaMode);
    s.cycleN = eventLand(wrapNow, sr, stream0, (unsigned int)s.count + 1u, aaMode, aaMode == 2);
  } else if (s.running && !latch) {
    const bool liveChange = !paramsEqual(s.eff, live) || s.polarity != polarityLive
      || s.spacing != spacingLive;
    if (liveChange) {
      applySchedule(s, live, s.effVel, loop, polarityLive, spacingLive);
      // Keep the spill: it holds pulses already fired this cycle (Dither lands
      // up to 1 sample early). Clearing it on every smoothed Frequency step
      // dropped them for good, so Free Dither went silent while Frequency
      // moved (v34).
      const unsigned int streamLive = aaStream(seedU, s.ditherEpoch, aaMode);
      s.cycleN = eventLand(wrapNow, sr, streamLive, (unsigned int)s.count + 1u, aaMode, aaMode == 2);
    }
    if (liveChange || remapLive) {
      retargeted = true;
      const int k = pulseIndexAt(
        s.n, s.nFwd, s.count, s.timeSpan, s.eff[2], s.loopSched, s.pulseMode, sr, aaMode, scale, shape, pol,
        sameLayout(s) ? s.firedMax + 1 : -1
      );
      if (loop) s.next = k;
      else if (k > s.next) s.next = k;
      if (s.next > s.count) s.next = s.count;
    }
  }
  if (s.running && periodLock > 0.0 && !trigHit && !loopStart) {
    retargeted = true;
    const int k = pulseIndexAt(
      s.n, s.nFwd, s.count, s.timeSpan, s.eff[2], s.loopSched, s.pulseMode, sr, aaMode, scale, shape, pol,
      sameLayout(s) ? s.firedMax + 1 : -1
    );
    s.next = k;
    if (s.next > s.count) s.next = s.count;
  }
  if (!s.running) {
    for (int k = 0; k < 9; k++) s.eff[k] = live[k];
    s.effVel = 1.0;
    s.polarity = polarityLive;
    s.spacing = spacingLive;
    s.morphEff = morphLive;
    s.elapsed = -1.0;
    return 0.0;
  }
  const double e = (double)s.n / sr + s.phaseOff;
  s.elapsed = e;
  double out = 0.0;
  double trig = 0.0;
  const unsigned int stream = aaStream(seedU, s.ditherEpoch, aaMode);
  const double endT = s.timeSpan;
  const double kCurve = s.eff[2];
  const bool lp = s.loopSched;
  const double du = s.pulseMode;
  const int total = s.count;
  const int nFwd = s.nFwd;
  const double delay = clampDelay(s.eff[8]);
  double tE = oneShotEndTime(total, nFwd, endT, kCurve, lp, du, delay, pol);
  const double tEPlay = playT(tE, scale);
  // Pulse amplitude, times the Edge Fade when the switch is On (v38).
  const double cycleCut = s.cycle;
  auto ampOf = [&](int j) {
    const double a = pulseAmp(j, nFwd, endT, kCurve, s.eff[3], s.eff[4], s.eff[5], s.eff[6], s.effVel, lp, du, pol);
    if (!edgeOn) return a;
    return a * edgeFadeOf(j, total, nFwd, endT, kCurve, lp, du, pol, cycleCut, tE);
  };
  if (shape == kShapeTrigger) {
    out = takeSpill(s);
    if (s.allAtZero) {
      if (s.next == 0) {
        out += s.allAmp;
        s.next = s.count;
      }
    } else {
      const int rad = aaMode >= 4 ? 2 : 1;
      while (s.next < total) {
        const double tU = pulseTime(s.next, nFwd, endT, kCurve, lp, du, pol);
        if (pulseAfterCutoff(tU, lp, s.cycle, tE)) {
          s.next = total;
          break;
        }
        if (s.next <= s.firedMax) {
          s.next++;
          continue;
        }
        const double t = playT(tU, scale);
        if (aaMode >= 3) {
          if (robinEarliest(t, sr, rad) > s.n) break;
          const long long land = aaMode >= 4
            ? robinLand2(t, sr, stream, (unsigned int)s.next)
            : robinLand(t, sr, stream, (unsigned int)s.next);
          const double amp = ampOf(s.next);
          addAt(s, land, s.n, amp, &out);
        } else {
          const long long c = ceilLand(t, sr);
          if (c > s.n) break;
          const double amp = ampOf(s.next);
          if (aaMode >= 1) {
            const double tPrev = playT(s.next > 0 ? pulseTime(s.next - 1, nFwd, endT, kCurve, lp, du, pol) : 0.0, scale);
            const double tNext = playT(s.next + 1 < total ? pulseTime(s.next + 1, nFwd, endT, kCurve, lp, du, pol) : tU, scale);
            const long long land = pulseLand(s.next, total, t, tPrev, tNext, sr, stream, true);
            addAt(s, land, s.n, amp, &out);
          } else {
            out += amp;
          }
        }
        s.firedMax = s.next;
        s.next++;
      }
    }
    trig = out;
  } else if (!s.allAtZero && total > 0) {
    while (s.next < total) {
      const double t0 = pulseTime(s.next, nFwd, endT, kCurve, lp, du, pol);
      if (pulseAfterCutoff(t0, lp, s.cycle, tE)) {
        s.next = total;
        break;
      }
      const long long n0 = landPulse(s.next, total, nFwd, endT, kCurve, lp, du, sr, stream, aaMode, scale, pol);
      long long n1;
      if (s.next + 1 < total) {
        const double tNext = pulseTime(s.next + 1, nFwd, endT, kCurve, lp, du, pol);
        if (pulseAfterCutoff(tNext, lp, s.cycle, tE)) {
          n1 = lp
            ? (s.cycleN > 0 ? s.cycleN : ceilLand(s.wrapCycle > 0.0 ? s.wrapCycle : 1.0 / sr, sr))
            : eventLand(tEPlay, sr, stream, (unsigned int)total, aaMode, false);
        } else {
          n1 = landPulse(s.next + 1, total, nFwd, endT, kCurve, lp, du, sr, stream, aaMode, scale, pol);
        }
      } else if (lp) {
        // Loop last grain: ends where the pulse region ends (span = Time, or
        // 2*Time Forward-Reverse) so a positive End Delay (graph: 1-span of
        // the cycle) is silent. Delay <= 0: runs to the wrap as before.
        const long long nWrap = s.cycleN > 0 ? s.cycleN : ceilLand(s.wrapCycle > 0.0 ? s.wrapCycle : 1.0 / sr, sr);
        if (delay > 0.0) {
          const double spanT = spanScaleOf(du) * endT;
          const long long nSpan = eventLand(playT(spanT, scale), sr, stream, (unsigned int)total, aaMode, false);
          n1 = nSpan < nWrap ? nSpan : nWrap;
        } else {
          n1 = nWrap;
        }
      } else {
        const double lastT = playT(pulseTime(total - 1, nFwd, endT, kCurve, lp, du, pol), scale);
        n1 = eventLand(tEPlay, sr, stream, (unsigned int)total, aaMode, delay > 0.0 && ceilLand(tEPlay, sr) == ceilLand(lastT, sr));
      }
      if (n1 <= n0) {
        // One-shot delay 0: last pulse is the end of the previous grain, not a
        // new 1-sample stub. End fires on that sample (same as Trigger).
        if (!lp && s.next + 1 >= total) {
          trig += ampOf(s.next);
          s.next = total;
          break;
        }
        n1 = n0 + 1;
      }
      if (s.n < n0) break;
      if (s.n < n1) {
        const double u = (double)(s.n - n0) / (double)(n1 - n0);
        const double amp = ampOf(s.next);
        const double mo = latch ? s.morphEff : morphLive;
        out = grainWave(shape, u, mo) * amp;
        // Trigger out on the grain's first sample; one sample late when a live
        // retarget this sample found its landing slid back across the boundary
        // (v37, see pulseIndexAt).
        if ((s.n == n0 || (retargeted && s.n == n0 + 1 && s.next == s.firedMax + 1 && sameLayout(s)))
            && s.next > s.firedMax) {
          trig += amp;
          s.firedMax = s.next;
        }
        break;
      }
      s.next++;
    }
  } else if (s.allAtZero && s.next == 0) {
    out = s.allAmp;
    trig = s.allAmp;
    s.next = s.count;
  }
  s.trigOut = trig;
  if (!loop) {
    if (s.next >= s.count) {
      const double lastT = s.allAtZero || s.count <= 0 ? 0.0
        : pulseTime(s.count - 1, s.nFwd, s.timeSpan, s.eff[2], s.loopSched, s.pulseMode, pol);
      const double lastPlay = playT(lastT, scale);
      bool fireEnd = false;
      if (!(delay > 0.0) && !(delay < 0.0)) {
        fireEnd = shape == kShapeTrigger ? !spillPending(s) : true;
      } else {
        const bool stackedEnd = delay > 0.0 && ceilLand(tEPlay, sr) == ceilLand(lastPlay, sr);
        const long long eLand = eventLand(tEPlay, sr, stream, (unsigned int)s.count, aaMode, stackedEnd);
        fireEnd = (shape == kShapeTrigger ? !spillPending(s) : true) && s.n >= eLand;
      }
      if (fireEnd) {
        s.endOut = 1.0;
        s.running = false;
      }
    }
  } else if (shape == kShapeTrigger) {
    if (s.next >= s.count && !s.endFired) {
      s.endOut = 1.0;
      s.endFired = true;
    }
  } else if (!s.endFired && s.count > 0) {
    bool lastKept = s.next >= s.count - 1;
    if (!lastKept && s.next >= 0 && s.next + 1 < s.count) {
      const double tNext = pulseTime(s.next + 1, nFwd, endT, kCurve, lp, du, pol);
      lastKept = pulseAfterCutoff(tNext, true, s.cycle, tE);
    }
    if (lastKept) {
      s.endOut = 1.0;
      s.endFired = true;
    }
  }
  s.n++;
  return out;
}

extern "C" double soemdsp_pulse_train_effective(int handle, int i) {
  if (handle < 1 || handle > kMaxInstances || i < 0 || i > 9) return 0.0;
  const PulseTrainState& s = gPool[handle - 1];
  if (i == 9) return s.wrapCycle;
  return i == 6 ? s.eff[6] * s.effVel : s.eff[i];
}

extern "C" double soemdsp_pulse_train_end(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].endOut;
}

extern "C" double soemdsp_pulse_train_trigger(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].trigOut;
}

extern "C" double soemdsp_pulse_train_elapsed(int handle) {
  if (handle < 1 || handle > kMaxInstances) return -1.0;
  return gPool[handle - 1].elapsed;
}

extern "C" int soemdsp_pulse_train_preview(
  double count, double endTime, double curve, double ampStart, double ampEnd,
  double ampCurve, double amplitude, double mode, double pulseMode, double endDelay,
  double curvePolarity, double spacing
) {
  gPreview.pulseMode = pulseBiasOf(pulseMode);
  gPreview.polarity = polarityNeg(curvePolarity) ? 1.0 : 0.0;
  gPreview.spacing = spacingOf(spacing);
  gTimeSpacing = gPreview.spacing;
  gPreview.countF = countContOf(count, gPreview.pulseMode);
  gPreview.nFwd = pulsesOf(gPreview.countF);
  gPreview.fade = fadeOf(gPreview.countF, gPreview.nFwd);
  gCountF = gPreview.countF;
  gFade = gPreview.fade;
  gPreview.loop = mode > 0.5;
  gPreview.count = totalCount(gPreview.nFwd, gPreview.pulseMode, gPreview.loop, gPreview.polarity);
  gPreview.end = endTime > 0.0 ? endTime : 0.0;
  gPreview.delay = clampDelay(endDelay);
  gPreview.curve = curve;
  gPreview.ampStart = ampStart;
  gPreview.ampEnd = ampEnd;
  gPreview.ampCurve = ampCurve;
  gPreview.amplitude = amplitude;
  return gPreview.count;
}

extern "C" double soemdsp_pulse_train_preview_time(int i) {
  if (i < 0 || i >= gPreview.count) return 0.0;
  gTimeSpacing = gPreview.spacing;
  gCountF = gPreview.countF;
  gFade = gPreview.fade;
  return pulseTime(i, gPreview.nFwd, gPreview.end, gPreview.curve, gPreview.loop, gPreview.pulseMode, gPreview.polarity);
}

extern "C" double soemdsp_pulse_train_preview_amplitude(int i) {
  if (i < 0 || i >= gPreview.count) return 0.0;
  gTimeSpacing = gPreview.spacing;
  gCountF = gPreview.countF;
  gFade = gPreview.fade;
  return pulseAmp(
    i, gPreview.nFwd, gPreview.end, gPreview.curve, gPreview.ampStart, gPreview.ampEnd, gPreview.ampCurve,
    gPreview.amplitude, 1.0, gPreview.loop, gPreview.pulseMode, gPreview.polarity
  );
}
