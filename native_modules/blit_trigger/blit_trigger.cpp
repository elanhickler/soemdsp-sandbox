// soemdsp-native-module: blit_trigger
// soemdsp-native-label: BLIT Trigger
// soemdsp-native-target: blitTrigger
// soemdsp-native-kind: utility
//
// BLIT Trigger: a free-running pulse whose gate edges are band-limited steps
// (integrated band-limited impulses), placed at their true sub-sample time.
// Width is in internal samples, and that tiny range is the instrument:
//   Width 0      off
//   Width < ~4   the rise and fall overlap, so each pulse's height and shape
//                depend on where it lands between samples: a pattern that
//                repeats with the beat between Rate and the sample grid
//   Width >= ~4  every pulse reaches full Amp: a steady, constant trigger
// Internal sample rate is fixed (48 kHz x Speed) and read out by linear
// interpolation at the host rate, so a pattern stays (mostly) the same at
// 44.1, 48 or 96 kHz. Speed scales the internal grid and Rate together: the
// pattern is kept and only runs faster or slower (Rate is the pulse rate at
// Speed 1). When the internal grid outruns the host rate the read-out no
// longer keeps the pattern exactly; at low Speed it holds over a wide range.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 32;
static const double kInternalRate = 48000.0;

struct BlitTriggerState {
  bool active;
  bool resetWasHigh;
  double phase;       // 0..1, advanced at the internal rate
  double blit[4];     // band-limited impulse taps still to play
  int head;
  double gate;        // running integral of the taps = the band-limited gate
  double level;       // height latched at the rise; the fall removes the same
  bool on;            // committed gate state
  double clock;       // internal samples owed to the host (0..1)
  double prev;        // the two newest internal samples, for the read-out
  double cur;
  bool resetPending;
  bool fired;         // an internal step opened a pulse since the last host sample
  double firedLevel;
  double lastTrigger; // the hard trigger output for this host sample
};

static BlitTriggerState gPool[kMaxInstances];

// Cubic B-spline, support [-2, 2], sums to 1 over integer shifts.
static double bspline3(double x) {
  const double a = x < 0.0 ? -x : x;
  if (a >= 2.0) return 0.0;
  if (a >= 1.0) { const double t = 2.0 - a; return t * t * t / 6.0; }
  return (4.0 - 6.0 * a * a + 3.0 * a * a * a) / 6.0;
}

// Impulse of `area` that happened `ago` internal samples before this one
// (0..1), centered 2 samples ahead (fixed latency) so every tap is future.
static void blit_add(BlitTriggerState& s, double ago, double area) {
  for (int k = 0; k < 4; k++) {
    s.blit[(s.head + k) & 3] += area * bspline3((double)k - 2.0 + ago);
  }
}

// How long ago (0..1 internal samples) this step crossed `edge`, or -1.
static double crossed(double phase, double inc, double edge) {
  if (!(inc > 0.0)) return -1.0;
  const double past = wrap01(phase - edge);
  return past < inc ? past / inc : -1.0;
}

// One internal sample of the band-limited gate. The window is [0, w) of the
// cycle, w = Width internal samples. State-based: an edge only when on/off
// changes, so fast Rate / Width moves never double or drop an edge.
static double internal_step(BlitTriggerState& s, double rate, double width, double level, bool reset) {
  // inc is per internal step against the nominal 48 kHz grid: Speed changes
  // how often steps happen, never what one step is, so the pattern is kept.
  const double inc = maxd(0.0, rate) / kInternalRate;
  if (reset) s.phase = 0.0;
  const double phase = s.phase;
  const double w = clamp(width * inc, 0.0, 1.0);
  const bool full = w >= 1.0;
  const bool inNow = full || (w > 0.0 && phase < w);
  if (inNow != s.on) {
    if (inNow) {
      double ago = reset ? -1.0 : crossed(phase, inc, 0.0);
      if (ago < 0.0) ago = 0.0;
      s.level = level;
      blit_add(s, ago, s.level);
      s.fired = true;
      s.firedLevel = s.level;
    } else {
      double ago = reset ? -1.0 : crossed(phase, inc, w);
      if (ago < 0.0) ago = 0.0;
      blit_add(s, ago, -s.level);
    }
    s.on = inNow;
  }
  // A pulse shorter than one step can open and close between two samples:
  // the state never sees it, so both edges go in at their true times.
  if (!inNow && w > 0.0 && w < inc && inc > 0.0) {
    const double agoOpen = crossed(phase, inc, 0.0);
    const double agoClose = crossed(phase, inc, w);
    if (agoOpen >= 0.0 && agoClose >= 0.0) {
      blit_add(s, agoOpen, level);
      blit_add(s, agoClose, -level);
      s.fired = true;
      s.firedLevel = level;
    }
  }
  s.gate += s.blit[s.head];
  s.blit[s.head] = 0.0;
  s.head = (s.head + 1) & 3;
  if (s.blit[0] == 0.0 && s.blit[1] == 0.0 && s.blit[2] == 0.0 && s.blit[3] == 0.0) {
    s.gate = s.on ? s.level : 0.0;
  }
  s.phase = wrap01(phase + inc);
  return s.gate;
}

}  // namespace

extern "C" int soemdsp_blit_trigger_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      BlitTriggerState& s = gPool[i];
      s.resetWasHigh = false;
      s.phase = 0.0;
      for (int k = 0; k < 4; k++) s.blit[k] = 0.0;
      s.head = 0;
      s.gate = 0.0;
      s.level = 0.0;
      s.on = false;
      s.clock = 0.0;
      s.prev = 0.0;
      s.cur = 0.0;
      s.resetPending = false;
      s.fired = false;
      s.firedLevel = 0.0;
      s.lastTrigger = 0.0;
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

// One host sample. Runs the internal 48 kHz gate as many steps as this host
// sample covers and reads it out linearly between the two newest steps.
extern "C" double soemdsp_blit_trigger_sample(
  int    handle,
  double reset,
  double rate,
  double width,
  double level,
  double speed,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  BlitTriggerState& s = gPool[handle - 1];
  const double hostRate = maxd(1.0, safe(sampleRate));
  const double safeRate = safe(rate);
  const double safeWidth = maxd(0.0, safe(width));
  const double safeLevel = safe(level);
  if (rising_edge_bool(safe(reset) > 0.0, &s.resetWasHigh)) s.resetPending = true;
  // Internal steps per host sample: 48 kHz x Speed over the host rate.
  // Capped so a huge Speed cannot run away (the pattern is gone there anyway).
  const double safeSpeed = clamp(safe(speed), 0.0, 64.0);
  s.clock += kInternalRate * safeSpeed / hostRate;
  if (s.clock > 64.0) s.clock = 64.0;
  s.fired = false;
  while (s.clock >= 1.0) {
    s.clock -= 1.0;
    s.prev = s.cur;
    s.cur = internal_step(s, safeRate, safeWidth, safeLevel, s.resetPending);
    s.resetPending = false;
  }
  // Hard trigger (white jack): one host sample at Amp for each pulse that
  // opened since the last host sample, on the sample grid, no BLIT.
  s.lastTrigger = s.fired ? s.firedLevel : 0.0;
  return s.prev + (s.cur - s.prev) * s.clock;
}

// The hard trigger for the host sample just computed (call after _sample).
extern "C" double soemdsp_blit_trigger_pulse(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastTrigger;
}

extern "C" int soemdsp_blit_trigger_version() {
  return 3; // 3: hard trigger output (one host sample per pulse) beside the BLIT out. 2: Speed scales the internal grid and Rate together (pattern kept, faster / slower). 1: band-limited gate at a fixed 48 kHz internal rate; Width in internal samples (0 off .. ~4 steady).
}
