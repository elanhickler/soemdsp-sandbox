// soemdsp-native-module: clock
// soemdsp-native-label: Clock
// soemdsp-native-target: clock
// soemdsp-native-kind: utility
//
// Free-running phasor. Rising Reset (edge only): emit Pulse as if a cycle just
// finished, then restart phase and keep advancing (do not freeze while Reset
// stays high — that stretched the first Digital gate).
// Amplitude is latched, never read mid-pulse: Digital at its gate rise, Analog
// at each cycle start (tick / Reset), T at its tick. A moving slider shows on
// the next pulse and never adds a rising edge inside a held gate.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 32;

struct ClockState {
  bool active;
  bool hasStarted;
  bool resetWasHigh;
  double phase;
  double lastAnalog;
  double lastDigital;
  double lastPulse;
  double lastPhase;
  bool levelInit;     // first sample latches every level
  bool cycleLatch;    // T fired last sample: latch the Analog level now
  bool digitalWasHigh;
  double digitalLevel;  // latched at the Digital gate rise
  double cycleLevel;    // latched at the cycle start (Analog)
  bool smoothWasHigh;
  double smoothLevel;   // latched at the smooth gate's rise
  double blit[4];       // Analog Out: BLIT taps still to play (edge impulses)
  int blitHead;
  double blitGate;      // running integral of the taps = the band-limited gate
  double blitLevel;     // height latched at the rise; the fall removes the same
};

static ClockState gPool[kMaxInstances];

static double pow_nonneg(double base, double exponent) {
  if (base <= 0.0) return 0.0;
  return dsp_exp(exponent * dsp_ln(base));
}

// Cubic B-spline, support [-2, 2], sums to 1 over integer shifts, peak 2/3.
static double clock_bspline3(double x) {
  const double a = x < 0.0 ? -x : x;
  if (a >= 2.0) return 0.0;
  if (a >= 1.0) { const double t = 2.0 - a; return t * t * t / 6.0; }
  return (4.0 - 6.0 * a * a + 3.0 * a * a * a) / 6.0;
}

// Add a band-limited impulse of total area `area` that happened `ago` samples
// before this one (0 <= ago < 1), centered 2 samples ahead (fixed 2-sample
// latency) so every tap is still in the future. Integrated, an impulse of
// area A is a band-limited step of height A (a BLEP).
static void clock_blit_add(ClockState& s, double ago, double area) {
  for (int k = 0; k < 4; k++) {
    s.blit[(s.blitHead + k) & 3] += area * clock_bspline3((double)k - 2.0 + ago);
  }
}

// Did this sample's phase step cross `edge`? Returns how long ago, in samples
// (0..1), or -1. Forward: the step (phase - inc, phase]; backwards mirrored.
static double clock_crossed(double phase, double inc, double edge) {
  if (inc > 0.0) {
    const double past = wrap01(phase - edge);
    return past < inc ? past / inc : -1.0;
  }
  if (inc < 0.0) {
    const double past = wrap01(edge - phase);
    return (past > 0.0 && past <= -inc) ? past / -inc : -1.0;
  }
  return -1.0;
}

}  // namespace

extern "C" int soemdsp_clock_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      ClockState& s = gPool[i];
      s.hasStarted = false;
      s.resetWasHigh = false;
      s.phase = 0.0;
      s.lastAnalog = 0.0;
      s.lastDigital = 0.0;
      s.lastPulse = 0.0;
      s.lastPhase = 0.0;
      s.levelInit = false;
      s.cycleLatch = false;
      s.digitalWasHigh = false;
      s.digitalLevel = 0.0;
      s.cycleLevel = 0.0;
      s.smoothWasHigh = false;
      s.smoothLevel = 0.0;
      for (int k = 0; k < 4; k++) s.blit[k] = 0.0;
      s.blitHead = 0;
      s.blitGate = 0.0;
      s.blitLevel = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_clock_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_clock_sample(
  int    handle,
  double reset,
  double phaseOffset,
  double rate,
  double pulseStart,
  double pulseEnd,
  double level,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  ClockState& s = gPool[handle - 1];

  const double safeReset = safe(reset);
  const double safePhaseOffset = wrap01(safe(phaseOffset));
  // Signed: negative Rate runs the clock backwards (v9), 0 pauses. Not clamped to 0.
  const double safeRate = safe(rate);
  const double safeStart = clamp(safe(pulseStart), 0.0, 1.0);
  const double safeEnd = clamp(safe(pulseEnd), 0.0, 1.0);
  const double safeLevel = safe(level);
  const double rateHz = maxd(1.0, safe(sampleRate));

  const bool resetHigh = safeReset > 0.0;
  const bool resetRise = rising_edge_bool(resetHigh, &s.resetWasHigh);

  // Rising Reset only (edge): treat as end-of-cycle Pulse, then restart.
  // Do NOT hold phase at 0 while Reset stays high — that freezes Digital in the
  // duty-high region and makes the first gate longer than subsequent ones
  // (Keyboard Trigger can stay high for many samples).
  if (resetRise) {
    s.phase = 0.0;
    s.hasStarted = true;
  }
  if (!s.levelInit || resetRise || s.cycleLatch) {
    s.cycleLevel = safeLevel;
    if (!s.levelInit) s.digitalLevel = safeLevel;
    s.levelInit = true;
  }
  s.cycleLatch = false;

  const double rawPhase = wrap01(s.phase);
  const double phase = wrap01(rawPhase + safePhaseOffset);
  // High while the phase is in [Pulse Start, Pulse End); End before Start
  // wraps through the cycle end. Compared in fractional phase, not rounded
  // samples: the period is fractional (48000 / 74.2 = 646.9), and rounding
  // End * period could land below the last sample's phase, so a full-width
  // gate (Start 0, End 1) dropped low for a sample each cycle. Phase is in
  // [0, 1), so Start 0 / End 1 is high on every sample (never re-triggers).
  // Rate 0 is not a special case (v8): the phase stops, so the clock pauses
  // with its gate and Analog where they are (no forced 0, no T tick).
  const bool inWindow = safeEnd >= safeStart
    ? (phase >= safeStart && phase < safeEnd)
    : (phase >= safeStart || phase < safeEnd);
  // Never 100% low (v10): every cycle sends at least one sample of gate. A
  // window narrower than one sample step (narrow pulse, high Rate) can fall
  // entirely between two samples, and Start == End is an empty window; then
  // the first sample past it goes high for that one sample. 100% high
  // (Start 0, End 1) stays high on every sample; Rate 0 still pauses.
  const double inc = safeRate / rateHz;
  bool missed = false;
  if (!inWindow && inc != 0.0) {
    const double width = wrap01(safeEnd - safeStart);  // Start == End -> 0 (a point)
    if (inc > 0.0) {
      // The step that ended here crossed Start: phase is less than one step past it.
      const double past = wrap01(phase - safeStart);
      missed = past < inc && past >= width;
    } else {
      // Backwards: the window is entered at End; the step crossed it going down.
      const double past = wrap01(safeEnd - phase);
      missed = past > 0.0 && past <= -inc && wrap01(phase - safeStart) >= width;
    }
  }
  const bool high = inWindow || missed;
  if (high && !s.digitalWasHigh) s.digitalLevel = safeLevel;
  s.digitalWasHigh = high;
  const double digital = high ? s.digitalLevel : 0.0;
  // Analog Out (v13) = BLIT gate: the running integral of band-limited
  // impulses, +Amp at each rise and -Amp at each fall, each at its true
  // sub-sample time (cubic B-spline over 4 samples, 2-sample latency). The
  // gate's edges are band-limited steps; no sample-grid timing pattern.
  // Never 100% low: a window narrower than one phase step is widened to one
  // step. 100% high (Start 0 / End 1): a steady Amp, no edges.
  double analog;
  const double width = wrap01(safeEnd - safeStart);
  const bool fullOn = safeEnd >= 1.0 && safeStart <= 0.0;
  const double absInc = inc < 0.0 ? -inc : inc;
  if (fullOn) {
    for (int k = 0; k < 4; k++) s.blit[k] = 0.0;
    s.blitGate = safeLevel;
    s.blitLevel = safeLevel;
    analog = safeLevel;
  } else {
    const double end = width < absInc ? wrap01(safeStart + absInc) : safeEnd;
    // Forward the window opens at Start and closes at End; backwards reversed.
    const double openEdge = inc >= 0.0 ? safeStart : end;
    const double closeEdge = inc >= 0.0 ? end : safeStart;
    if (resetRise) {
      // Reset jumps the phase: no crossing to follow. Step the gate (after
      // the edges already in flight) straight to the window state now.
      const bool inNow = end >= safeStart ? (phase >= safeStart && phase < end) : (phase >= safeStart || phase < end);
      double pending = s.blitGate;
      for (int k = 0; k < 4; k++) pending += s.blit[k];
      if (inNow) s.blitLevel = safeLevel;
      const double target = inNow ? s.blitLevel : 0.0;
      if (target != pending) clock_blit_add(s, 0.0, target - pending);
    } else if (s.hasStarted) {
      const double agoOpen = clock_crossed(phase, inc, openEdge);
      const double agoClose = clock_crossed(phase, inc, closeEdge);
      // Both can land in one step (a pulse shorter than a sample, or a close
      // and the next open); the impulses simply add.
      if (agoClose >= 0.0) clock_blit_add(s, agoClose, -s.blitLevel);
      if (agoOpen >= 0.0) {
        s.blitLevel = safeLevel;
        clock_blit_add(s, agoOpen, s.blitLevel);
      }
    }
    s.blitGate += s.blit[s.blitHead];
    s.blit[s.blitHead] = 0.0;
    s.blitHead = (s.blitHead + 1) & 3;
    // Float drift guard: with no edge in flight the gate is exactly 0 or Amp.
    if (s.blit[0] == 0.0 && s.blit[1] == 0.0 && s.blit[2] == 0.0 && s.blit[3] == 0.0) {
      const double g = s.blitGate < 0.0 ? -s.blitGate : s.blitGate;
      const double l = s.blitLevel < 0.0 ? -s.blitLevel : s.blitLevel;
      s.blitGate = g > 0.5 * l ? s.blitLevel : 0.0;
    }
    analog = s.blitGate;
  }

  const double nextRawPhase = wrap01(rawPhase + inc);
  // T follows the offset phase. Two clocks at one rate with Phase 0 and 0.5
  // must tick half a cycle apart. Wrapping the raw phase made every T simultaneous.
  // Forward ticks when the offset phase passes 1, backwards when it passes 0.
  const bool wrapped = s.hasStarted && (inc > 0.0 ? (phase + inc) >= 1.0 : (inc < 0.0 && (phase + inc) < 0.0));
  const double pulse = (resetRise || wrapped) ? safeLevel : 0.0;  // one sample: the tick's level
  if (wrapped) s.cycleLatch = true;

  s.phase = nextRawPhase;
  s.hasStarted = true;

  s.lastAnalog = analog;
  s.lastDigital = digital;
  s.lastPulse = pulse;
  s.lastPhase = phase;
  return digital;
}

extern "C" double soemdsp_clock_analog_out(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastAnalog;
}

extern "C" double soemdsp_clock_pulse(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastPulse;
}

extern "C" double soemdsp_clock_phase(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastPhase;
}

extern "C" int soemdsp_clock_version() {
  return 13; // 13: Analog Out is a BLIT gate (integrated band-limited impulses: band-limited rise and fall at true sub-sample times, 2-sample latency). 12: Analog Out is a BLIT trigger (band-limited impulse at each gate rise, sub-sample placed, 2-sample latency) - test. 11: Analog Out is the smooth (box-filtered, sub-sample) gate; the whip is gone. 10: never 100% low: a gate window narrower than one sample (or Start == End) still sends one sample per cycle. 9: negative Rate runs backwards (T on the 0 crossing). 8: Rate 0 pauses (gate / Analog hold, no forced 0). 7: gate compared in fractional phase (Start 0 / End 1 never drops at fractional periods). 6: Amplitude latched per pulse (Digital at gate rise, Analog at cycle start, T at tick). 5: Pulse Start / Pulse End replace duty; phase published. 4: T pulse follows Phase offset
}
