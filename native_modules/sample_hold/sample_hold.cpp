// soemdsp-native-module: sample_hold
// soemdsp-native-label: Sample & Hold
// soemdsp-native-target: sampleHold
// soemdsp-native-kind: utility
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp/blob/main/include/soemdsp/timer/SampleAndHold.hpp
//
// Latches its input whenever the Clock input crosses above threshold
// (rising edge), or on every internal-clock tick if sampleFrequency > 0.
// When hasInConnected==0, the latch samples seeded LCG bipolar noise
// (same LCG as noise_generator). Graph engine runs three handles per node:
// Ext (external hold), Left + Right (independent internal noise).
// phaseOffset (cycles, mod 1) desyncs that lane's Sample Freq / Clock fires
// vs offset 0: 0 and 1 fire together, 0.5 is halfway.
// Interpolate 0..5 = Linear / Smoothstep / Quadratic Out / Quadratic In /
// Cosine / Hold (shared curves, soemdsp/math/two_point_curves.h). Hold jumps
// on the latch sample whatever Smoothing is.
// Smoothing = glide duration as a factor of clock period (unclamped):
//   <=0 -> 1 sample (instant); 1 -> one clock period; 2 -> slower than clock.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 192;

struct SampleHoldState {
  bool active;
  double clockPhase;
  double held;
  double from;
  double out;
  double samplesInSegment;
  double segmentSamples;
  double lastIntervalSamples;
  double samplesSinceFire;
  double lastTrigger;
  double fired;            // 1.0 on the sample a new value latched, else 0.0
  double samplesSinceEdge;  // samples since the last Clock rising edge
  double lastEdgeInterval;  // Clock edge-to-edge interval (0 = unknown yet)
  int pendingFireSamples; // Clock-edge delay for phaseOffset (>0 counting down)
  unsigned int noiseSeed;
  int currentSeed;
};

static SampleHoldState gPool[kMaxInstances];

static unsigned int lcg_next(unsigned int& seed) {
  seed = 1664525U * seed + 1013904223U;
  return seed;
}

static double next_bipolar(unsigned int& seed) {
  return (double)lcg_next(seed) / (double)0xffffffffU * 2.0 - 1.0;
}

static const int kInterpHold = 5;

static double apply_interpolate(int interp, double t) {
  // 0 Linear, 1 Smoothstep, 2 Quadratic Out, 3 Quadratic In, 4 Cosine (5 Hold = instant)
  if (interp == 1) return curve_smoothstep01(t);
  if (interp == 2) return curve_quad_out01(t);
  if (interp == 3) return curve_quad_in01(t);
  if (interp == 4) return curve_cosine01(t);
  return curve_linear01(t);
}

}  // namespace

extern "C" int soemdsp_sample_hold_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      SampleHoldState& s = gPool[i];
      s.clockPhase = 0.0;
      s.held = 0.0;
      s.from = 0.0;
      s.out = 0.0;
      s.samplesInSegment = 0.0;
      s.segmentSamples = 1.0;
      s.lastIntervalSamples = 0.0;
      s.samplesSinceFire = 0.0;
      s.lastTrigger = 0.0;
      s.pendingFireSamples = 0;
      s.fired = 0.0;
      s.samplesSinceEdge = 0.0;
      s.lastEdgeInterval = 0.0;
      s.noiseSeed = 1U;
      s.currentSeed = 0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_sample_hold_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_sample_hold_sample(
  int    handle,
  double input,
  double trigger,
  double threshold,
  double sampleFrequency,
  double sampleRate,
  int    hasInConnected,
  int    seed,
  double amplitude,
  double polarityMode,
  double interpolateMode,
  double phaseOffset,
  double smoothingFactor
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  SampleHoldState& s = gPool[handle - 1];

  if (seed != s.currentSeed) {
    s.currentSeed = seed;
    s.noiseSeed = (unsigned int)seed;
    if (s.noiseSeed == 0U) s.noiseSeed = 1U;
  }

  const double safeInput = hasInConnected != 0 ? safe(input) : next_bipolar(s.noiseSeed);
  const double safeTrigger = safe(trigger);
  const double safeThreshold = safe(threshold);
  const double safeFreq = maxd(0.0, safe(sampleFrequency));
  const double safeRate = maxd(1.0, safe(sampleRate));
  const double amp = safe(amplitude);
  const bool unipolar = polarityMode >= 0.5;
  int interp = (int)(safe(interpolateMode) + (safe(interpolateMode) >= 0.0 ? 0.5 : -0.5));
  if (interp < 0) interp = 0;
  if (interp > 5) interp = 5;
  const double offset = wrap01(safe(phaseOffset));
  // Factor of clock period; <=0 -> one sample (instant). Unclamped above 0.
  const double smooth = safe(smoothingFactor);
  const bool instant = !(smooth > 0.0) || interp == kInterpHold;

  bool internalFire = false;
  if (safeFreq > 0.0) {
    const double prev = s.clockPhase;
    s.clockPhase += safeFreq / safeRate;
    bool wrapped = false;
    if (s.clockPhase >= 1.0) {
      s.clockPhase -= dsp_floor(s.clockPhase);
      wrapped = true;
    }
    // Fire when free-running phase crosses `offset` (0/1 == wrap).
    if (offset <= 1.0e-12 || offset >= 1.0 - 1.0e-12) {
      internalFire = wrapped;
    } else if (wrapped) {
      internalFire = (prev < offset) || (s.clockPhase >= offset);
    } else {
      internalFire = (prev < offset && s.clockPhase >= offset);
    }
  }

  const bool risingEdge = rising_edge(safeTrigger, &s.lastTrigger, safeThreshold);
  bool fire = internalFire;

  // Clock period for the phase-offset delay is measured edge-to-edge, independent
  // of this lane's own latches (a delayed lane used to wait for its own interval,
  // which never existed, so the fallback delay was re-armed by every edge and the
  // offset lane never latched on an external Clock).
  s.samplesSinceEdge = safe(s.samplesSinceEdge) + 1.0;
  if (risingEdge) {
    // An offset latch still pending from the previous edge fires now rather than being dropped.
    if (s.pendingFireSamples > 0) {
      fire = true;
      s.pendingFireSamples = 0;
    }
  }

  if (risingEdge) {
    // Ext/Left (offset~0) fire with Clock; Right delays by offset*period.
    if (offset <= 1.0e-12 || offset >= 1.0 - 1.0e-12) {
      fire = true;
      s.pendingFireSamples = 0;
    } else {
      // Internal clock: its period. External Clock: last edge-to-edge interval;
      // on the very first edge (interval unknown) latch immediately.
      const double edgePeriod = s.lastEdgeInterval;
      const double period = safeFreq > 0.0 ? (safeRate / safeFreq) : edgePeriod;
      int delay = period > 0.0 ? (int)(offset * period + 0.5) : 0;
      if (delay < 1) {
        fire = true;
        s.pendingFireSamples = 0;
      } else {
        s.pendingFireSamples = delay;
      }
    }
  }

  if (risingEdge) {
    s.lastEdgeInterval = s.samplesSinceEdge;
    s.samplesSinceEdge = 0.0;
  }

  // Not on the scheduling edge itself, so the offset latch lands exactly delay samples later.
  if (s.pendingFireSamples > 0 && !risingEdge) {
    s.pendingFireSamples -= 1;
    if (s.pendingFireSamples <= 0) {
      s.pendingFireSamples = 0;
      fire = true;
    }
  }

  s.samplesSinceFire = safe(s.samplesSinceFire) + 1.0;
  s.fired = fire ? 1.0 : 0.0;

  if (fire) {
    const double interval = maxd(1.0, safe(s.samplesSinceFire));
    s.lastIntervalSamples = interval;
    s.samplesSinceFire = 0.0;
    const double period = safeFreq > 0.0
      ? maxd(1.0, safeRate / safeFreq)
      : maxd(1.0, safe(s.lastIntervalSamples));
    // segmentSamples = period * smoothing; <=0 -> 1 sample (instant).
    double seg = instant ? 1.0 : (period * smooth);
    if (seg < 1.0) seg = 1.0;
    s.segmentSamples = seg;
    s.samplesInSegment = 0.0;
    s.from = safe(s.out);
    s.held = safeInput;
    if (instant) {
      s.out = safeInput;
      s.from = safeInput;
    }
  }

  double out;
  if (instant) {
    s.out = safe(s.held);
    out = s.out;
  } else {
    s.samplesInSegment = safe(s.samplesInSegment) + 1.0;
    const double seg = maxd(1.0, safe(s.segmentSamples));
    double t = s.samplesInSegment / seg;
    if (t > 1.0) t = 1.0;
    t = apply_interpolate(interp, t);
    out = lerp(safe(s.from), safe(s.held), t);
    s.out = out;
  }

  if (unipolar) out = (out + 1.0) * 0.5;
  return safe(out * amp);
}

// 1.0 on the exact sample the last soemdsp_sample_hold_sample() call latched.
extern "C" double soemdsp_sample_hold_fired(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].fired;
}

// Bipolar target value latched by the most recent fire (the hold's peak:
// the value the output reaches/glides to), before polarity/amplitude.
extern "C" double soemdsp_sample_hold_held(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].held;
}

extern "C" int soemdsp_sample_hold_version() {
  return 7; // held() export for signed Trigger level. was 6: // Interpolate + Cosine, Hold (shared two_point_curves.h). was 5: external-Clock phase offset uses edge interval (offset lane latches)
}
