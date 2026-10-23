// soemdsp-native-module: pulse_explosion
// soemdsp-native-label: Pulse Explosion
// soemdsp-native-target: pulseExplosion
// soemdsp-native-kind: generator
//
// On a Trigger hit (gate_hit), schedules a burst of XY sparks over
// [startTime, endTime], concentrated around centerTime (same tent density
// as before). Each spark is a point on a disk of radius `spread` around
// pivot (x0, y0). While a spark is held, Left/Right sit on that point so a
// 2D oscilloscope burns a dot; between sparks (and while idle) the beam
// parks at the pivot, which draws the firework rays. Mono = (L+R)/2.
//
// timeSpread (0..1) maps to density skew: 0 piles sparks at centerTime, 1
// fills the window. Spatial spread 0 collapses every spark onto the pivot.
// Hold is seconds at each spark (0 still occupies one sample).
//
// seed: saved Seed (0..16777215). RNG re-seeds from seed_mix(Seed, kSeedBurst)
// at every burst. Trigger height (0..1) scales that burst's radius.

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/seed.h>
#include <soemdsp/trigger/trigger.h>
using soemdsp_maths::clamp;
using soemdsp_maths::rational_curve01;
using soemdsp_maths::gate_hit;
using soemdsp_maths::kPi;
using soemdsp_maths::kTwoPi;
using soemdsp_maths::kHalfPi;
using soemdsp_maths::seed_mix;
using soemdsp_maths::seed_param_u32;
using soemdsp_maths::seed_to_rng_state;

namespace {

enum : unsigned int {
  kSeedBurst = 1u,
};

static const int kMaxInstances = 16;
static const int kMaxPulses = 128;
static const int kMaxRejectionAttempts = 200;

struct ScheduledPulse {
  double time;
  double x;
  double y;
};

struct PulseExplosionState {
  bool active;
  double lastTrigger;
  bool exploding;
  double elapsed;
  int pulseCount;
  int nextPulseIndex;
  double holdRemaining;
  double sparkX;
  double sparkY;
  double lastLeft;
  double lastRight;
  ScheduledPulse pulses[kMaxPulses];
  unsigned int rngState;
};

static PulseExplosionState gPool[kMaxInstances];

static inline double nextUniform01(unsigned int* state) {
  unsigned int x = *state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  *state = x;
  return (double)x / 4294967295.0;
}

static double dsp_sin_0_halfpi(double x) {
  const double x2 = x * x;
  return x * (1.0 + x2 * (-1.6666666666666667e-1 + x2 * (8.3333333333333329e-3 + x2 * (-1.9841269841269841e-4))));
}

static double dsp_sin(double x) {
  double xi = (double)(long long)(x / kTwoPi);
  if (x / kTwoPi < xi) xi -= 1.0;
  double wrapped = x - kTwoPi * xi;
  double sign = 1.0;
  if (wrapped >= kPi) {
    wrapped -= kPi;
    sign = -1.0;
  }
  if (wrapped > kHalfPi) wrapped = kPi - wrapped;
  return sign * dsp_sin_0_halfpi(wrapped);
}

static inline double dsp_cos(double x) {
  return dsp_sin(x + kHalfPi);
}

static double raisedCosineEase(double x, double x1, double x2) {
  double span = x2 - x1;
  if (span > -1e-12 && span < 1e-12) return 0.5;
  double p = (x - x1) / span;
  p = clamp(p, 0.0, 1.0);
  return 1.0 - (0.5 + 0.5 * dsp_sin((p - 0.5) * kPi));
}

static double pulseDensity(double t, double startTime, double centerTime, double endTime, double skew) {
  if (t <= startTime || t >= endTime) return 0.0;
  double ease = (t < centerTime)
    ? raisedCosineEase(t, centerTime, startTime)
    : raisedCosineEase(t, centerTime, endTime);
  return clamp(rational_curve01(ease, skew), 0.0, 1.0);
}

static inline unsigned int burstRngState(double seed) {
  return seed_to_rng_state(seed_mix(seed_param_u32(seed), kSeedBurst));
}

static void insertSorted(ScheduledPulse* pulses, int count, ScheduledPulse toInsert) {
  int i = count;
  while (i > 0 && pulses[i - 1].time > toInsert.time) {
    pulses[i] = pulses[i - 1];
    i--;
  }
  pulses[i] = toInsert;
}

static int buildSchedule(
  ScheduledPulse* pulses, unsigned int* rng,
  double safeStart, double safeCenter, double safeEnd, double skew,
  int safeCount, double spread, double x0, double y0
) {
  int count = 0;
  const double safeSpread = spread < 0.0 ? 0.0 : spread;
  for (int i = 0; i < safeCount; i++) {
    double chosenTime = safeCenter;
    for (int attempt = 0; attempt < kMaxRejectionAttempts; attempt++) {
      double candidate = safeStart + (safeEnd - safeStart) * nextUniform01(rng);
      double roll = nextUniform01(rng);
      if (roll < pulseDensity(candidate, safeStart, safeCenter, safeEnd, skew)) {
        chosenTime = candidate;
        break;
      }
    }
    const double theta = kTwoPi * nextUniform01(rng);
    const double u = nextUniform01(rng);
    const double r = safeSpread * __builtin_sqrt(u);
    ScheduledPulse pulse;
    pulse.time = chosenTime;
    pulse.x = x0 + r * dsp_cos(theta);
    pulse.y = y0 + r * dsp_sin(theta);
    insertSorted(pulses, count, pulse);
    count++;
  }
  return count;
}

static ScheduledPulse gPreview[kMaxPulses];
static int gPreviewCount = 0;

static void windowParams(double startTime, double centerTime, double endTime,
  double* safeStart, double* safeCenter, double* safeEnd) {
  *safeStart = startTime < 0.0 ? 0.0 : startTime;
  *safeEnd = endTime > *safeStart ? endTime : *safeStart + 0.001;
  *safeCenter = clamp(centerTime, *safeStart, *safeEnd);
  if (*safeCenter <= *safeStart) *safeCenter = *safeStart + 1e-6;
  if (*safeCenter >= *safeEnd) *safeCenter = *safeEnd - 1e-6;
}

}  // namespace

extern "C" int soemdsp_pulse_explosion_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      PulseExplosionState& s = gPool[i];
      s.lastTrigger = 0.0;
      s.exploding = false;
      s.elapsed = 0.0;
      s.pulseCount = 0;
      s.nextPulseIndex = 0;
      s.holdRemaining = 0.0;
      s.sparkX = 0.0;
      s.sparkY = 0.0;
      s.lastLeft = 0.0;
      s.lastRight = 0.0;
      s.rngState = burstRngState(0.0);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_pulse_explosion_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_pulse_explosion_sample(
  int handle,
  double trigger,
  double startTime,
  double centerTime,
  double endTime,
  double timeSpread,
  int numberOfPulses,
  double spread,
  double x0,
  double y0,
  double hold,
  double seed,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  PulseExplosionState& s = gPool[handle - 1];

  const double safeRate = sampleRate < 1.0 ? 44100.0 : sampleRate;
  double safeStart, safeCenter, safeEnd;
  windowParams(startTime, centerTime, endTime, &safeStart, &safeCenter, &safeEnd);
  const double skew = -0.99 + 1.98 * clamp(timeSpread, 0.0, 1.0);
  const int safeCount = numberOfPulses < 1 ? 1 : (numberOfPulses > kMaxPulses ? kMaxPulses : numberOfPulses);
  const double safeHold = hold < 0.0 ? 0.0 : hold;
  const double holdSamples = safeHold * safeRate;
  const double trig = trigger;

  if (gate_hit(trig, &s.lastTrigger)) {
    const double vel = clamp(trig < 0.0 ? -trig : trig, 0.0, 1.0);
    s.pulseCount = 0;
    s.nextPulseIndex = 0;
    s.elapsed = 0.0;
    s.exploding = true;
    s.holdRemaining = 0.0;
    s.rngState = burstRngState(seed);
    s.pulseCount = buildSchedule(s.pulses, &s.rngState,
      safeStart, safeCenter, safeEnd, skew, safeCount, spread * vel, x0, y0);
  }

  double outX = x0;
  double outY = y0;
  if (s.exploding) {
    while (s.nextPulseIndex < s.pulseCount && s.elapsed >= s.pulses[s.nextPulseIndex].time) {
      s.sparkX = s.pulses[s.nextPulseIndex].x;
      s.sparkY = s.pulses[s.nextPulseIndex].y;
      s.holdRemaining = holdSamples < 1.0 ? 1.0 : holdSamples;
      s.nextPulseIndex++;
    }
    if (s.holdRemaining > 0.0) {
      outX = s.sparkX;
      outY = s.sparkY;
      s.holdRemaining -= 1.0;
    }
    s.elapsed += 1.0 / safeRate;
    if (s.nextPulseIndex >= s.pulseCount && s.elapsed > safeEnd && s.holdRemaining <= 0.0) {
      s.exploding = false;
    }
  }

  s.lastLeft = outX;
  s.lastRight = outY;
  return 0.5 * (outX + outY);
}

extern "C" double soemdsp_pulse_explosion_left(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastLeft;
}

extern "C" double soemdsp_pulse_explosion_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastRight;
}

extern "C" double soemdsp_pulse_explosion_elapsed(int handle) {
  if (handle < 1 || handle > kMaxInstances) return -1.0;
  const PulseExplosionState& s = gPool[handle - 1];
  return s.exploding ? s.elapsed : -1.0;
}

extern "C" int soemdsp_pulse_explosion_preview(
  double startTime, double centerTime, double endTime, double timeSpread,
  int numberOfPulses, double spread, double x0, double y0, double seed
) {
  double safeStart, safeCenter, safeEnd;
  windowParams(startTime, centerTime, endTime, &safeStart, &safeCenter, &safeEnd);
  const double skew = -0.99 + 1.98 * clamp(timeSpread, 0.0, 1.0);
  const int safeCount = numberOfPulses < 1 ? 1 : (numberOfPulses > kMaxPulses ? kMaxPulses : numberOfPulses);
  unsigned int rng = burstRngState(seed);
  gPreviewCount = buildSchedule(gPreview, &rng, safeStart, safeCenter, safeEnd, skew, safeCount, spread, x0, y0);
  return gPreviewCount;
}

extern "C" double soemdsp_pulse_explosion_preview_time(int i) {
  return (i >= 0 && i < gPreviewCount) ? gPreview[i].time : 0.0;
}

extern "C" double soemdsp_pulse_explosion_preview_x(int i) {
  return (i >= 0 && i < gPreviewCount) ? gPreview[i].x : 0.0;
}

extern "C" double soemdsp_pulse_explosion_preview_y(int i) {
  return (i >= 0 && i < gPreviewCount) ? gPreview[i].y : 0.0;
}

extern "C" int soemdsp_pulse_explosion_version() {
  return 5;  // 5: stereo XY fireworks (spread around x0/y0, hold, gate_hit, Mono=(L+R)/2). was 4: Timing removed.
}
