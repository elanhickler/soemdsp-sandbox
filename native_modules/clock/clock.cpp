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
};

static ClockState gPool[kMaxInstances];

static double pow_nonneg(double base, double exponent) {
  if (base <= 0.0) return 0.0;
  return dsp_exp(exponent * dsp_ln(base));
}

// Window measure in [0, x) for x in [0, 1]: how much of the phase circle up
// to x lies inside the gate window [start, end) (end < start wraps).
static double clock_window_cdf01(double x, double start, double end) {
  if (end >= start) return clamp(x, start, end) - start;
  return mind(x, end) + maxd(0.0, x - start);
}

// Same, on the unwrapped phase line: whole cycles add the window width.
static double clock_window_cdf(double x, double start, double end) {
  const double width = end >= start ? end - start : (1.0 - start) + end;
  const double k = dsp_floor(x);
  return k * width + clock_window_cdf01(x - k, start, end);
}

// Smooth (box-filtered) gate: the fraction of this sample's phase step
// [phase, phase + inc) that lies inside the window. Edges land at their true
// sub-sample time (0.7 = on for 70% of the sample), so a continuous receiver
// (Vactrol Light) responds identically on every cycle, with no repeating
// sample-grid pattern. Rate 0: the plain in-window test.
static double clock_smooth_gate(double phase, double inc, double start, double end) {
  if (inc == 0.0) {
    const bool in = end >= start ? (phase >= start && phase < end) : (phase >= start || phase < end);
    return in ? 1.0 : 0.0;
  }
  const double a = inc > 0.0 ? phase : phase + inc;
  const double len = inc > 0.0 ? inc : -inc;
  const double cover = clock_window_cdf(a + len, start, end) - clock_window_cdf(a, start, end);
  return clamp(cover / len, 0.0, 1.0);
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
  // Analog Out (v11) = the smooth gate: box-filtered edges at their true
  // sub-sample time, for analog receivers. Digital Out / T stay hard, since
  // any rise in level re-triggers event inputs (gate_hit).
  const double smooth = clock_smooth_gate(phase, inc, safeStart, safeEnd);
  const bool smoothHigh = smooth > 0.0;
  if (smoothHigh && !s.smoothWasHigh) s.smoothLevel = safeLevel;
  s.smoothWasHigh = smoothHigh;
  const double analog = smooth * s.smoothLevel;

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
  return 11; // 11: Analog Out is the smooth (box-filtered, sub-sample) gate; the whip is gone. 10: never 100% low: a gate window narrower than one sample (or Start == End) still sends one sample per cycle. 9: negative Rate runs backwards (T on the 0 crossing). 8: Rate 0 pauses (gate / Analog hold, no forced 0). 7: gate compared in fractional phase (Start 0 / End 1 never drops at fractional periods). 6: Amplitude latched per pulse (Digital at gate rise, Analog at cycle start, T at tick). 5: Pulse Start / Pulse End replace duty; phase published. 4: T pulse follows Phase offset
}
