// soemdsp-native-module: pulse_train
// soemdsp-native-label: Pulse Train
// soemdsp-native-target: pulseTrain
// soemdsp-native-kind: generator
//
// Pulse Train: a trigger starts a train of single-sample pulses whose gaps
// follow a time curve, like a thing slowing down over time (gaps grow).
// The schedule is a closed form (no per-pulse buffer):
//   N = Count (1..16384; Forward-Reverse: one-way max 8192 so 2N-1 fits),
//   u_i = i / (N - 1) (N = 1: u = 0), i = 0..N-1
//   E_k(u) = (e^(k u) - 1) / (e^k - 1)   (k = 0: E(u) = u, linear)
//   t_i = Time * E_curve(u_i)             seconds after the trigger
//   a_i = (Start + (End Amp - Start) * E_ampCurve(u_i)) * Amplitude * velocity
// Curve > 0: gaps grow (fast first, stretching out); 0: even; < 0: gaps
// shrink (a real bouncing ball settling speeds up). First pulse at t = 0,
// last one-way pulse at exactly Time (Time 0..12 s). Pulse Mode: Forward
// (one-way), Forward-Reverse (one-way then time-mirror 2*Time - t_i, peak
// once), Reverse (the return trip alone: Time - t_{N-1-j}; Loop v20: gaps\n// reversed from 0, amps Amp End -> Amp Start, so the t=0 pulse is the quiet\n// one, not a stray Amp Start spike). One-shot
// Forward-Reverse last pulse at 2*Time. Loop Forward-Reverse skips that
// return so it does not stack on the next cycle's first pulse. End Delay is
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
// Center / Right: bipolar -1/+1, Morph = high fraction (duty) of the grain,
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
// Time, Curve, Amp Start / End / Curve, Amplitude, Pulse Mode, End Delay)
// latch at each Trigger / Loop cycle start. Off: live every sample; next
// index only moves forward. Loop Off remaps elapsed into the new period so
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
  int nFwd;     // one-way Count
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
  int pulseMode;
  bool allAtZero;
  double allAmp;
  double spill[5]; // AA impulse energy delayed 1..4 samples
  unsigned int ditherEpoch;
  long long cycleN; // Loop wrap sample index this cycle (Dither/Robin)
  double morphEff;  // Morph latched at Trigger / Loop start (Recalculate On)
};

struct PreviewSched {
  int nFwd;
  int count;
  bool loop;
  int pulseMode;
  double end;
  double delay;
  double curve;
  double ampStart;
  double ampEnd;
  double ampCurve;
  double amplitude;
};

static PulseTrainState gPool[kMaxInstances];
static PreviewSched gPreview = {};

enum {
  kPulseForward = 0,
  kPulseFwdRev = 1,
  kPulseReverse = 2,
  kPulseRevFwd = 3
};

// Two-leg modes (out-and-back): Forward-Reverse and Reverse-Forward share the
// 2N-1 / 2N-2 count, the 8192 one-way cap and the 2*Time span.
static inline bool isDual(int m) { return m == kPulseFwdRev || m == kPulseRevFwd; }

// Reverse-Forward = Forward-Reverse rotated by half a trip: pulse j plays
// Forward-Reverse pulse k (the turnaround first, then the return leg, then the
// out leg), so it reuses the forward one-way functions with no new schedule
// math. One shot: j<N -> k=j+N-1, else k=j-N+1. Loop: k=(j+N-1) mod (2N-2).
static inline int revFwdK(int j, int nFwd, bool loop, bool* wrapped) {
  if (loop) {
    const int L = 2 * nFwd - 2;
    int k = j + nFwd - 1;
    *wrapped = k >= L;
    return *wrapped ? k - L : k;
  }
  *wrapped = j >= nFwd;
  return *wrapped ? j - nFwd + 1 : j + nFwd - 1;
}

static inline int pulseModeOf(double v) {
  int m = (int)(v + (v >= 0.0 ? 0.5 : -0.5));
  if (m < 0) m = 0;
  if (m > 3) m = 3;
  return m;
}

static inline int clampFwd(double count, int pulseMode) {
  if (!(count >= 1.0)) return 1;
  const int cap = isDual(pulseMode) ? kMaxFwdDual : kMaxPulses;
  if (count >= (double)cap) return cap;
  return (int)(count + 0.5);
}

static inline int totalCount(int nFwd, int pulseMode, bool loop) {
  if (!isDual(pulseMode) || nFwd <= 1) return nFwd;
  return loop ? (2 * nFwd - 2) : (2 * nFwd - 1);
}

static inline int fwdIndex(int j, int nFwd, int pulseMode, bool loop) {
  if (pulseMode == kPulseRevFwd) {
    if (nFwd <= 1) return 0;
    bool w;
    return fwdIndex(revFwdK(j, nFwd, loop, &w), nFwd, kPulseFwdRev, loop);
  }
  if (pulseMode == kPulseFwdRev) {
    if (j < nFwd) return j;
    return 2 * nFwd - 2 - j;
  }
  if (pulseMode == kPulseReverse) {
    if (nFwd <= 1) return 0;
    return nFwd - 1 - j;
  }
  return j;
}

static inline double curveShape(double k, double u) {
  if (!(k > 1e-6 || k < -1e-6)) return u;
  return (soemdsp_maths::dsp_exp(k * u) - 1.0) / (soemdsp_maths::dsp_exp(k) - 1.0);
}

static inline double pulseU(int i, int n, bool loop) {
  if (loop) return (double)i / (double)n;
  return n > 1 ? (double)i / (double)(n - 1) : 0.0;
}

static inline double oneWayTime(int i, int nFwd, double end, double curve, bool loop) {
  if (!loop && i == nFwd - 1 && nFwd > 1) return end;
  double t = end * curveShape(curve, pulseU(i, nFwd, loop));
  if (!(t >= 0.0)) t = 0.0;
  if (t > end) t = end;
  return t;
}

static inline double pulseTime(int j, int nFwd, double end, double curve, bool loop, int pulseMode) {
  if (pulseMode == kPulseRevFwd) {
    if (nFwd <= 1) return pulseTime(j, nFwd, end, curve, loop, kPulseFwdRev);
    // Shift so the turnaround (Forward-Reverse pulse N-1) lands on t = 0;
    // pulses before it in Forward-Reverse order move one cycle (2*Time) later.
    bool w;
    const int k = revFwdK(j, nFwd, loop, &w);
    const double shift = oneWayTime(nFwd - 1, nFwd, end, curve, loop);
    double t = pulseTime(k, nFwd, end, curve, loop, kPulseFwdRev) - shift + (w ? 2.0 * end : 0.0);
    if (!(t >= 0.0)) t = 0.0;
    return t;
  }
  if (pulseMode == kPulseReverse && nFwd > 1 && loop) {
    // Loop Reverse: forward gaps in reverse order, first pulse at 0, exactly
    // nFwd pulses inside [0, end) (none at end, so nothing doubles at the wrap).
    if (j == 0) return 0.0;
    double t = end - oneWayTime(nFwd - j, nFwd, end, curve, loop);
    if (!(t >= 0.0)) t = 0.0;
    return t;
  }
  const int i = fwdIndex(j, nFwd, pulseMode, loop);
  const double tf = oneWayTime(i, nFwd, end, curve, loop);
  if (pulseMode == kPulseFwdRev && j >= nFwd) {
    double t = 2.0 * end - tf;
    if (!(t >= 0.0)) t = 0.0;
    return t;
  }
  if (pulseMode == kPulseReverse && nFwd > 1) {
    double t = end - tf;
    if (!(t >= 0.0)) t = 0.0;
    return t;
  }
  return tf;
}

static inline double pulseAmp(
  int j, int nFwd, double ampStart, double ampEnd, double ampCurve,
  double amplitude, double velocity, bool loop, int pulseMode
) {
  const int i = fwdIndex(j, nFwd, pulseMode, loop);
  return (ampStart + (ampEnd - ampStart) * curveShape(ampCurve, pulseU(i, nFwd, loop))) * amplitude * velocity;
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
  int count, int nFwd, double end, double curve, bool loop, int pulseMode, double delay
) {
  const double lastT = count <= 0 ? 0.0
    : pulseTime(count - 1, nFwd, end, curve, loop, pulseMode);
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

static inline int aaModeOf(double antialiasing) {
  if (antialiasing >= 3.5) return 4; // Robin2 ±2
  if (antialiasing >= 2.5) return 3; // Robin1 ±1
  if (antialiasing >= 1.5) return 2; // Dither (stack 0/+1, re-roll)
  if (antialiasing >= 0.5) return 1; // Fixed
  return 0; // Off
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

static inline long long ceilLand(double t, double sr) {
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
  return robinPick3(t * sr, seed, j, kSeedAa);
}

// Robin2: ±1 pick, then a second independent ±1 around that integer (range ±2).
static inline long long robinLand2(double t, double sr, unsigned int seed, unsigned int j) {
  const long long a = robinLand(t, sr, seed, j);
  return robinPick3((double)a, seed, j, kSeedAa2);
}

static inline long long robinRound(double t, double sr) {
  if (!(sr > 0.0)) return 0;
  double c = t * sr;
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

static void applySchedule(PulseTrainState& s, const double live[9], double v, bool loop) {
  s.pulseMode = pulseModeOf(live[7]);
  s.nFwd = clampFwd(live[0], s.pulseMode);
  s.count = totalCount(s.nFwd, s.pulseMode, loop);
  for (int k = 0; k < 9; k++) s.eff[k] = live[k];
  s.effVel = v;
  s.timeSpan = live[1] > 0.0 ? live[1] : 0.0;
  const double delay = clampDelay(live[8]);
  const double span = (isDual(s.pulseMode) ? 2.0 : 1.0) * s.timeSpan;
  s.cycle = span + delay;
  if (!(s.cycle == s.cycle)) s.cycle = 0.0;
  s.loopSched = loop;
  s.allAtZero = !(s.timeSpan > 0.0);
  if (s.allAtZero) {
    double sum = 0.0;
    for (int i = 0; i < s.count; i++) {
      sum += pulseAmp(i, s.nFwd, live[3], live[4], live[5], live[6], v, loop, s.pulseMode);
    }
    s.allAmp = sum;
  } else {
    s.allAmp = 0.0;
  }
}

static inline long long landPulse(
  int j, int total, int nFwd, double end, double curve, bool loop, int pulseMode,
  double sr, unsigned int seed, int aaMode, double scale
) {
  const double tU = pulseTime(j, nFwd, end, curve, loop, pulseMode);
  const double t = playT(tU, scale);
  if (aaMode >= 4) return robinLand2(t, sr, seed, (unsigned int)j);
  if (aaMode >= 3) return robinLand(t, sr, seed, (unsigned int)j);
  if (aaMode >= 1) {
    const double tPrev = playT(j > 0 ? pulseTime(j - 1, nFwd, end, curve, loop, pulseMode) : 0.0, scale);
    const double tNext = playT(j + 1 < total ? pulseTime(j + 1, nFwd, end, curve, loop, pulseMode) : tU, scale);
    return pulseLand(j, total, t, tPrev, tNext, sr, seed, true);
  }
  return ceilLand(t, sr);
}

static int firstPulseAfter(
  long long nPrev, int nFwd, int total, double end, double curve, bool loop, int pulseMode, double sr, int aaMode,
  double scale
) {
  if (total <= 0) return 0;
  if (!(end > 0.0)) return nPrev >= 0 ? total : 0;
  int lo = 0;
  int hi = total;
  while (lo < hi) {
    const int mid = lo + ((hi - lo) >> 1);
    const double t = playT(pulseTime(mid, nFwd, end, curve, loop, pulseMode), scale);
    const int rad = aaMode >= 4 ? 2 : 1;
    const long long latest = aaMode >= 3 ? robinLatest(t, sr, rad) : ceilLand(t, sr);
    if (latest <= nPrev) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

}  // namespace

extern "C" int soemdsp_pulse_train_version() { return 23; }

extern "C" int soemdsp_pulse_train_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      PulseTrainState& s = gPool[i];
      s.running = false;
      s.prevTrig = 0.0;
      s.n = 0;
      s.nFwd = 0;
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
      s.pulseMode = kPulseForward;
      s.allAtZero = false;
      s.allAmp = 0.0;
      s.spill[0] = s.spill[1] = s.spill[2] = s.spill[3] = s.spill[4] = 0.0;
      s.ditherEpoch = 0;
      s.cycleN = 0;
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
  double freqHz, double morph
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  const double morphLive = morph == morph ? morph : 0.5; // omitted wasm arg (NaN) = 0.5
  const bool loop = mode > 0.5;
  const bool latch = recalc > 0.5;
  const int aaMode = aaModeOf(antialiasing);
  const int shape = shapeOf(waveShape);
  const unsigned int seedU = soemdsp_maths::seed_param_u32(seed);
  PulseTrainState& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const int pulseModeLive = pulseModeOf(pulseMode);
  const double live[9] = {
    count, endTime, curve, ampStart, ampEnd, ampCurve, amplitude,
    (double)pulseModeLive, clampDelay(endDelay)
  };
  s.endOut = 0.0;
  s.trigOut = 0.0;
  const bool trigHit = gate_hit(trigger, &s.prevTrig);
  if (trigHit) s.velocity = gate_hit_velocity();
  const bool runningLatch = latch && s.running;
  const int modeNow = runningLatch ? s.pulseMode : pulseModeLive;
  const double timeNow = runningLatch ? s.timeSpan : (endTime > 0.0 ? endTime : 0.0);
  const double delayNow = runningLatch ? clampDelay(s.eff[8]) : live[8];
  double schedNow = runningLatch ? s.cycle : ((isDual(modeNow) ? 2.0 : 1.0) * timeNow + delayNow);
  if (!(schedNow == schedNow)) schedNow = 0.0;
  const double periodLock = trackPeriodOf(freqHz, sr);
  const double scale = (periodLock > 0.0 && schedNow > 0.0) ? (periodLock / schedNow) : 1.0;
  const double wrapNow = periodLock > 0.0 ? periodLock : (schedNow > 0.0 ? schedNow : (1.0 / sr));
  const double prevWrap = s.wrapCycle;
  // Recalc Off + Loop: wrap against the previous period, then remap n into the
  // new period so a live Frequency jump keeps phase. Recalc On uses wrapNow
  // (the latched cycle) and does not remap.
  bool naturalWrap = false;
  if (s.running && s.n > 0) {
    if (aaMode >= 2) {
      naturalWrap = s.n >= (s.cycleN > 0 ? s.cycleN : 1);
    } else {
      const double gate = (!latch && prevWrap > 0.0) ? prevWrap : wrapNow;
      naturalWrap = ((double)s.n / sr) >= gate;
    }
  }
  const bool remapLive = !latch && loop && s.running && !trigHit && !naturalWrap
    && prevWrap > 0.0 && wrapNow > 0.0
    && !(wrapNow == prevWrap);
  if (remapLive) {
    double phase = ((double)s.n / sr) / prevWrap;
    if (!(phase >= 0.0)) phase = 0.0;
    if (phase > 1.0) phase = 1.0;
    s.n = (long long)(phase * wrapNow * sr);
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
  if (trigHit || loopStart) {
    const double v = trigHit ? gate_hit_velocity() : s.velocity;
    const bool needBuild = !s.running || trigHit || !paramsEqual(s.eff, live)
      || !(s.effVel == v) || s.loopSched != loop;
    if (needBuild) applySchedule(s, live, v, loop);
    s.morphEff = morphLive;
    s.next = 0;
    s.n = 0;
    s.endFired = false;
    s.running = true;
    clearSpill(s);
    if (aaMode >= 2) s.ditherEpoch += 1u;
    const unsigned int stream0 = aaStream(seedU, s.ditherEpoch, aaMode);
    s.cycleN = eventLand(wrapNow, sr, stream0, (unsigned int)s.count + 1u, aaMode, aaMode == 2);
  } else if (s.running && !latch) {
    if (!paramsEqual(s.eff, live)) {
      applySchedule(s, live, s.effVel, loop);
      clearSpill(s);
      const unsigned int streamLive = aaStream(seedU, s.ditherEpoch, aaMode);
      s.cycleN = eventLand(wrapNow, sr, streamLive, (unsigned int)s.count + 1u, aaMode, aaMode == 2);
      const long long nPrev = s.n > 0 ? s.n - 1 : -1;
      const int k = firstPulseAfter(
        nPrev, s.nFwd, s.count, s.timeSpan, s.eff[2], s.loopSched, s.pulseMode, sr, aaMode, scale
      );
      if (k > s.next) s.next = k;
      if (s.next > s.count) s.next = s.count;
    }
  }
  if (s.running && periodLock > 0.0 && !trigHit && !loopStart) {
    const long long nPrev = s.n > 0 ? s.n - 1 : -1;
    const int k = firstPulseAfter(
      nPrev, s.nFwd, s.count, s.timeSpan, s.eff[2], s.loopSched, s.pulseMode, sr, aaMode, scale
    );
    s.next = k;
    if (s.next > s.count) s.next = s.count;
  }
  if (!s.running) {
    for (int k = 0; k < 9; k++) s.eff[k] = live[k];
    s.effVel = 1.0;
    s.morphEff = morphLive;
    s.elapsed = -1.0;
    return 0.0;
  }
  const double e = (double)s.n / sr;
  s.elapsed = e;
  double out = 0.0;
  double trig = 0.0;
  const unsigned int stream = aaStream(seedU, s.ditherEpoch, aaMode);
  const double endT = s.timeSpan;
  const double kCurve = s.eff[2];
  const bool lp = s.loopSched;
  const int du = s.pulseMode;
  const int total = s.count;
  const int nFwd = s.nFwd;
  const double delay = clampDelay(s.eff[8]);
  double tE = oneShotEndTime(total, nFwd, endT, kCurve, lp, du, delay);
  const double tEPlay = playT(tE, scale);
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
        const double tU = pulseTime(s.next, nFwd, endT, kCurve, lp, du);
        if (pulseAfterCutoff(tU, lp, s.cycle, tE)) {
          s.next = total;
          break;
        }
        const double t = playT(tU, scale);
        if (aaMode >= 3) {
          if (robinEarliest(t, sr, rad) > s.n) break;
          const long long land = aaMode >= 4
            ? robinLand2(t, sr, stream, (unsigned int)s.next)
            : robinLand(t, sr, stream, (unsigned int)s.next);
          const double amp = pulseAmp(s.next, nFwd, s.eff[3], s.eff[4], s.eff[5], s.eff[6], s.effVel, lp, du);
          addAt(s, land, s.n, amp, &out);
        } else {
          const long long c = ceilLand(t, sr);
          if (c > s.n) break;
          const double amp = pulseAmp(s.next, nFwd, s.eff[3], s.eff[4], s.eff[5], s.eff[6], s.effVel, lp, du);
          if (aaMode >= 1) {
            const double tPrev = playT(s.next > 0 ? pulseTime(s.next - 1, nFwd, endT, kCurve, lp, du) : 0.0, scale);
            const double tNext = playT(s.next + 1 < total ? pulseTime(s.next + 1, nFwd, endT, kCurve, lp, du) : tU, scale);
            const long long land = pulseLand(s.next, total, t, tPrev, tNext, sr, stream, true);
            addAt(s, land, s.n, amp, &out);
          } else {
            out += amp;
          }
        }
        s.next++;
      }
    }
    trig = out;
  } else if (!s.allAtZero && total > 0) {
    while (s.next < total) {
      const double t0 = pulseTime(s.next, nFwd, endT, kCurve, lp, du);
      if (pulseAfterCutoff(t0, lp, s.cycle, tE)) {
        s.next = total;
        break;
      }
      const long long n0 = landPulse(s.next, total, nFwd, endT, kCurve, lp, du, sr, stream, aaMode, scale);
      long long n1;
      if (s.next + 1 < total) {
        const double tNext = pulseTime(s.next + 1, nFwd, endT, kCurve, lp, du);
        if (pulseAfterCutoff(tNext, lp, s.cycle, tE)) {
          n1 = lp
            ? (s.cycleN > 0 ? s.cycleN : ceilLand(s.wrapCycle > 0.0 ? s.wrapCycle : 1.0 / sr, sr))
            : eventLand(tEPlay, sr, stream, (unsigned int)total, aaMode, false);
        } else {
          n1 = landPulse(s.next + 1, total, nFwd, endT, kCurve, lp, du, sr, stream, aaMode, scale);
        }
      } else if (lp) {
        // Loop last grain: ends where the pulse region ends (span = Time, or
        // 2*Time Forward-Reverse) so a positive End Delay (graph: 1-Duty of
        // the cycle) is silent. Delay <= 0: runs to the wrap as before.
        const long long nWrap = s.cycleN > 0 ? s.cycleN : ceilLand(s.wrapCycle > 0.0 ? s.wrapCycle : 1.0 / sr, sr);
        if (delay > 0.0) {
          const double spanT = (isDual(du) ? 2.0 : 1.0) * endT;
          const long long nSpan = eventLand(playT(spanT, scale), sr, stream, (unsigned int)total, aaMode, false);
          n1 = nSpan < nWrap ? nSpan : nWrap;
        } else {
          n1 = nWrap;
        }
      } else {
        const double lastT = playT(pulseTime(total - 1, nFwd, endT, kCurve, lp, du), scale);
        n1 = eventLand(tEPlay, sr, stream, (unsigned int)total, aaMode, delay > 0.0 && ceilLand(tEPlay, sr) == ceilLand(lastT, sr));
      }
      if (n1 <= n0) {
        // One-shot delay 0: last pulse is the end of the previous grain, not a
        // new 1-sample stub. End fires on that sample (same as Trigger).
        if (!lp && s.next + 1 >= total) {
          trig += pulseAmp(s.next, nFwd, s.eff[3], s.eff[4], s.eff[5], s.eff[6], s.effVel, lp, du);
          s.next = total;
          break;
        }
        n1 = n0 + 1;
      }
      if (s.n < n0) break;
      if (s.n < n1) {
        const double u = (double)(s.n - n0) / (double)(n1 - n0);
        const double amp = pulseAmp(s.next, nFwd, s.eff[3], s.eff[4], s.eff[5], s.eff[6], s.effVel, lp, du);
        out = grainWave(shape, u, latch ? s.morphEff : morphLive) * amp;
        if (s.n == n0) trig += amp;
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
        : pulseTime(s.count - 1, s.nFwd, s.timeSpan, s.eff[2], s.loopSched, s.pulseMode);
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
      const double tNext = pulseTime(s.next + 1, nFwd, endT, kCurve, lp, du);
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
  double ampCurve, double amplitude, double mode, double pulseMode, double endDelay
) {
  gPreview.pulseMode = pulseModeOf(pulseMode);
  gPreview.nFwd = clampFwd(count, gPreview.pulseMode);
  gPreview.loop = mode > 0.5;
  gPreview.count = totalCount(gPreview.nFwd, gPreview.pulseMode, gPreview.loop);
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
  return pulseTime(i, gPreview.nFwd, gPreview.end, gPreview.curve, gPreview.loop, gPreview.pulseMode);
}

extern "C" double soemdsp_pulse_train_preview_amplitude(int i) {
  if (i < 0 || i >= gPreview.count) return 0.0;
  return pulseAmp(
    i, gPreview.nFwd, gPreview.ampStart, gPreview.ampEnd, gPreview.ampCurve,
    gPreview.amplitude, 1.0, gPreview.loop, gPreview.pulseMode
  );
}
