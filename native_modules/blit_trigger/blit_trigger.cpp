// soemdsp-native-module: blit_trigger
// soemdsp-native-label: Rounding Error Sequencer
// soemdsp-native-target: blitTrigger
// soemdsp-native-kind: utility
//
// Rounding Error Sequencer: a step sequencer whose accents come from the
// sample grid itself. Step k sits at Rotate + k * Spacing internal samples;
// its fractional remainder decides where it lands between two grid samples.
// Each step is a band-limited gate (integrated cubic B-spline edges) of Gate
// samples, so that remainder becomes the step's height and shape:
//   Gate 0       off
//   Gate < ~4    rise and fall overlap: accents follow the remainders
//   Gate >= ~4   every step reaches full Level (a steady trigger)
// Length N: the loop restarts after N steps on a whole internal sample, so
// the pattern repeats exactly. 0 = free (most Spacings never repeat).
//
// Two ways to step:
//   Internal clock (Advance unwired): steps fall every Spacing internal
//   samples. The internal grid runs at 48 kHz x Clock Speed and is read out
//   linearly at the host rate, so a pattern is the same at any sample rate;
//   Clock Speed runs the same pattern faster or slower.
//   Advance (a trigger in, e.g. Metronome or Clock Divider on the beat): each
//   rise plays the next step now, offset by that step's own remainder, so the
//   accent pattern stays and the timing follows the beat.
//
// Outs: BLIT gate, hard trigger (one host sample per step), Velocity (the
// step's peak height, held), Step (index in the loop, held).

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 32;
static const int kMaxEvents = 32;
static const double kInternalRate = 48000.0;
static const double kLatency = 2.0;  // internal samples (B-spline half width)

struct SeqState {
  bool active;
  bool resetWasHigh;
  bool advanceWasHigh;
  double m;              // internal sample count since start
  double loopStart;      // internal time the current loop started
  long long nextStep;    // next step index to schedule (within the loop)
  long long advanceStep; // Advance mode: the step the next rise plays
  double evStart[kMaxEvents];
  double evGate[kMaxEvents];
  double evLevel[kMaxEvents];
  int evCount;
  double clock;          // internal samples owed to the host (0..1)
  double prev;
  double cur;
  double trigger;
  double velocity;
  double step;
};

static SeqState gPool[kMaxInstances];

// Integral of the cubic B-spline: a band-limited unit step centered at 0.
static double bspline3_cdf(double x) {
  if (x <= -2.0) return 0.0;
  if (x >= 2.0) return 1.0;
  if (x <= -1.0) { const double t = x + 2.0; return t * t * t * t / 24.0; }
  if (x <= 0.0) {
    const double x2 = x * x;
    return 1.0 / 24.0 + (4.0 * x - 2.0 * x2 * x - 0.75 * x2 * x2 + 2.75) / 6.0;
  }
  return 1.0 - bspline3_cdf(-x);
}

// A band-limited gate of height 1 from t0 to t0 + w, read at time x.
static double gate_at(double x, double t0, double w) {
  return bspline3_cdf(x - kLatency - t0) - bspline3_cdf(x - kLatency - t0 - w);
}

// Peak of one step on the grid (its velocity): the remainder decides it.
static double step_peak(double t0, double w) {
  const double a = dsp_floor(t0 + kLatency - 2.0);
  double best = 0.0;
  const int n = 8 + (int)w;
  for (int i = 0; i < n; i++) {
    const double g = gate_at(a + (double)i, t0, w);
    if (g > best) best = g;
  }
  return best;
}

static double frac01(double x) { return x - dsp_floor(x); }

static void add_event(SeqState& s, double t0, double gate, double level, long long k) {
  if (s.evCount >= kMaxEvents) {
    for (int i = 1; i < kMaxEvents; i++) {
      s.evStart[i - 1] = s.evStart[i]; s.evGate[i - 1] = s.evGate[i]; s.evLevel[i - 1] = s.evLevel[i];
    }
    s.evCount = kMaxEvents - 1;
  }
  s.evStart[s.evCount] = t0;
  s.evGate[s.evCount] = gate;
  s.evLevel[s.evCount] = level;
  s.evCount++;
  s.trigger = level;
  s.velocity = level * step_peak(t0, gate);
  s.step = (double)k;
}

}  // namespace

extern "C" int soemdsp_blit_trigger_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      SeqState& s = gPool[i];
      s.resetWasHigh = false;
      s.advanceWasHigh = false;
      s.m = 0.0;
      s.loopStart = 0.0;
      s.nextStep = 0;
      s.advanceStep = 0;
      s.evCount = 0;
      s.clock = 0.0;
      s.prev = 0.0;
      s.cur = 0.0;
      s.trigger = 0.0;
      s.velocity = 0.0;
      s.step = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_blit_trigger_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// One host sample. Returns the BLIT gate; trigger / velocity / step via getters.
extern "C" double soemdsp_blit_trigger_sample(
  int    handle,
  double reset,
  double advance,
  int    hasAdvance,
  double spacing,
  double gate,
  double level,
  double clockSpeed,
  double length,
  double rotate,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  SeqState& s = gPool[handle - 1];
  const double hostRate = maxd(1.0, safe(sampleRate));
  const double lvl = safe(level);
  const double sp = clamp(safe(spacing), 1.0, 1.0e6);
  const double rot = clamp(safe(rotate), 0.0, 1.0);
  const double w = clamp(safe(gate), 0.0, 64.0);
  const int nLen = (int)(clamp(safe(length), 0.0, 4096.0) + 0.5);
  s.trigger = 0.0;

  if (rising_edge_bool(safe(reset) > 0.0, &s.resetWasHigh)) {
    s.loopStart = s.m;
    s.nextStep = 0;
    s.advanceStep = 0;
  }
  // Advance: play the next step now, at its own remainder (sub-sample offset).
  const bool adv = rising_edge_bool(safe(advance) > 0.0, &s.advanceWasHigh);
  if (hasAdvance && adv && w > 0.0) {
    const long long k = s.advanceStep;
    const double t0 = s.m + frac01(rot + (double)k * sp);
    add_event(s, t0, w, lvl, k);
    s.advanceStep = nLen > 0 ? (k + 1) % nLen : k + 1;
  }

  s.clock += kInternalRate * clamp(safe(clockSpeed), 0.0, 64.0) / hostRate;
  if (s.clock > 64.0) s.clock = 64.0;
  while (s.clock >= 1.0) {
    s.clock -= 1.0;
    if (!hasAdvance) {
      // Internal clock: schedule every step starting at or before this sample.
      for (int guard = 0; guard < 64; guard++) {
        if (nLen > 0 && s.nextStep >= nLen) {
          // Loop restart on a whole internal sample: the alignment repeats.
          const double loopLen = maxd(1.0, dsp_ceil((double)nLen * sp + rot));
          if (s.m - s.loopStart < loopLen) break;
          s.loopStart += loopLen;
          s.nextStep = 0;
        }
        const double t0 = s.loopStart + rot + (double)s.nextStep * sp;
        if (t0 > s.m) break;
        if (w > 0.0) add_event(s, t0, w, lvl, s.nextStep);
        s.nextStep++;
      }
      // Free run: keep loopStart near now so times stay precise.
      if (nLen == 0 && s.nextStep > 1000000) {
        s.loopStart += (double)s.nextStep * sp;
        s.nextStep = 0;
      }
    }
    // Sum the live events, drop finished ones.
    double v = 0.0;
    int keep = 0;
    for (int i = 0; i < s.evCount; i++) {
      if (s.m > s.evStart[i] + s.evGate[i] + kLatency + 2.0) continue;
      v += s.evLevel[i] * gate_at(s.m, s.evStart[i], s.evGate[i]);
      s.evStart[keep] = s.evStart[i]; s.evGate[keep] = s.evGate[i]; s.evLevel[keep] = s.evLevel[i];
      keep++;
    }
    s.evCount = keep;
    s.prev = s.cur;
    s.cur = v;
    s.m += 1.0;
  }
  return s.prev + (s.cur - s.prev) * s.clock;
}

extern "C" double soemdsp_blit_trigger_pulse(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].trigger;
}

extern "C" double soemdsp_blit_trigger_velocity(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].velocity;
}

extern "C" double soemdsp_blit_trigger_step(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].step;
}

extern "C" int soemdsp_blit_trigger_version() {
  return 4; // 4: Rounding Error Sequencer: Spacing / Rotate / Length loop / Gate / Clock Speed, Advance trigger in, Velocity + Step outs. 3: hard trigger out. 2: Speed. 1: BLIT gate at a fixed 48 kHz.
}
