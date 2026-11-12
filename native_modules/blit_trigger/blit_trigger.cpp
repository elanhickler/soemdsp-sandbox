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
// Loop Shift (0..1): each time the loop wraps, Rotate moves by this much
// (wrapped to 0..1), so loop n plays Rotate + n * Loop Shift: a 2D Sturmian
// walk (Spacing = the step along the loop, Loop Shift = the step between
// loops). 0 = the loop repeats exactly. Reset puts it back to loop 0.
//
// Two ways to step:
//   Internal clock (Advance unwired): steps fall every Spacing internal
//   samples. Rate is steps per second: the internal grid runs at Rate x Spacing
//   internal samples per second and is read out
//   linearly at the host rate, so a pattern is the same at any sample rate;
//   Rate runs the same pattern faster or slower; Spacing only picks the pattern.
//   Advance (a trigger in, e.g. Metronome or Clock Divider on the beat): each
//   rise plays the next step now, offset by that step's own remainder, so the
//   accent pattern stays and the timing follows the beat.
//
// Exaggerate Difference (0..1): accents sit in a narrow band (about 0.8 to
// 0.92 at Gate 2). Each accent is mapped toward the loop's full range,
// (a - min) / (max - min), mixed with the raw accent by this amount, and that
// scales the step's BLIT height, its hard trigger and its Velocity alike.
//
// Outs: BLIT gate, hard trigger (one host sample per step), Velocity (the
// step's peak height, held), Step (index in the loop, held).

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 32;
static const int kMaxEvents = 128;
static const double kLatency = 2.0;  // internal samples (B-spline half width)

struct SeqState {
  bool active;
  bool resetWasHigh;
  bool advanceWasHigh;
  double time;           // grid time since start (grid samples, continuous)
  double loopStart;      // internal time the current loop started
  long long nextStep;    // next step index to schedule (within the loop)
  long long advanceStep; // Advance mode: the step the next rise plays
  // Live steps: start (grid time), duration (grid), edge unit (grid), height
  // scale, peak time, the step's accent / index (fired at the peak).
  double evStart[kMaxEvents];
  double evDur[kMaxEvents];
  double evUnit[kMaxEvents];
  double evAmp[kMaxEvents];
  double evPeak[kMaxEvents];
  double evAccent[kMaxEvents];
  double evIndex[kMaxEvents];
  bool evFired[kMaxEvents];
  int evCount;
  double trigger;
  double velocity;
  double step;
  double shiftAcc;       // Loop Shift accumulated over the loops so far (0..1)
  // Accent range of the current pattern (for Exaggerate Difference), cached
  // until Spacing / Rotate / Gate / Length change.
  double statSpacing, statRotate, statGate;
  int statLength;
  double accMin, accMax;
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

// A band-limited gate of height 1 from t0 to t0 + w, read at grid time x.
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

// Min / max accent over the loop (free run: the first 64 steps).
static void update_stats(SeqState& s, double sp, double rot, double w, int nLen) {
  if (sp == s.statSpacing && rot == s.statRotate && w == s.statGate && nLen == s.statLength) return;
  s.statSpacing = sp; s.statRotate = rot; s.statGate = w; s.statLength = nLen;
  const int count = nLen > 0 ? (nLen < 256 ? nLen : 256) : 64;
  double lo = 1.0e9, hi = -1.0e9;
  for (int k = 0; k < count; k++) {
    const double a = step_peak(rot + (double)k * sp, w);
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  s.accMin = lo; s.accMax = hi;
}

// Accent after Exaggerate Difference (amount 0..1).
static double exaggerate(const SeqState& s, double a, double amount) {
  const double range = s.accMax - s.accMin;
  if (!(amount > 0.0) || !(range > 1.0e-9)) return a;
  const double norm = clamp((a - s.accMin) / range, 0.0, 1.0);
  return a + (norm - a) * clamp(amount, 0.0, 1.0);
}

// Peak of a unit-edge gate of width w (edges one unit wide): normalizes a
// step so its peak lands exactly on its accent at any Sharpness.
static double shape_peak(double w) {
  return 2.0 * bspline3_cdf(0.5 * w) - 1.0;
}

// Schedule step k at grid time t0. Its accent (height) comes from the grid
// (step_peak, then Exaggerate); its shape is rendered in host time with edges
// `unit` grid samples wide: 1 at Sharpness 0 (a soft, Rate-proportional
// bump), down to one host sample at Sharpness 1 (a crisp spike).
static void add_event(SeqState& s, double t0, double gate, double level, long long k,
                      double amount, double unit) {
  const double a = step_peak(t0, gate);
  const double accent = level * exaggerate(s, a, amount);
  const double peak = shape_peak(gate);
  if (s.evCount >= kMaxEvents) {
    for (int i = 1; i < kMaxEvents; i++) {
      s.evStart[i - 1] = s.evStart[i]; s.evDur[i - 1] = s.evDur[i]; s.evUnit[i - 1] = s.evUnit[i];
      s.evAmp[i - 1] = s.evAmp[i]; s.evPeak[i - 1] = s.evPeak[i]; s.evAccent[i - 1] = s.evAccent[i];
      s.evIndex[i - 1] = s.evIndex[i]; s.evFired[i - 1] = s.evFired[i];
    }
    s.evCount = kMaxEvents - 1;
  }
  const int i = s.evCount++;
  s.evStart[i] = t0;
  s.evDur[i] = gate * unit;
  s.evUnit[i] = unit;
  s.evAmp[i] = peak > 1.0e-12 ? accent / peak : 0.0;
  s.evPeak[i] = t0 + kLatency * unit + 0.5 * gate * unit;
  s.evAccent[i] = accent;
  s.evIndex[i] = (double)k;
  s.evFired[i] = false;
}

// One step's height at grid time x.
static double event_value(const SeqState& s, int i, double x) {
  const double u = s.evUnit[i];
  const double c = x - s.evStart[i] - kLatency * u;
  return s.evAmp[i] * (bspline3_cdf(c / u) - bspline3_cdf((c - s.evDur[i]) / u));
}

}  // namespace

extern "C" int soemdsp_blit_trigger_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      SeqState& s = gPool[i];
      s.resetWasHigh = false;
      s.advanceWasHigh = false;
      s.time = 0.0;
      s.loopStart = 0.0;
      s.nextStep = 0;
      s.advanceStep = 0;
      s.evCount = 0;
      s.trigger = 0.0;
      s.velocity = 0.0;
      s.step = 0.0;
      s.shiftAcc = 0.0;
      s.statSpacing = -1.0; s.statRotate = -1.0; s.statGate = -1.0; s.statLength = -1;
      s.accMin = 0.0; s.accMax = 1.0;
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
  double rate,
  double length,
  double rotate,
  double exaggerateAmount,
  double sharpness,
  double sampleRate,
  double loopShift
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  SeqState& s = gPool[handle - 1];
  const double hostRate = maxd(1.0, safe(sampleRate));
  const double lvl = safe(level);
  const double sp = clamp(safe(spacing), 1.0, 1.0e6);
  // Loop Shift moves Rotate by this much at every loop wrap (Length > 0).
  const double shift = frac01(clamp(safe(loopShift), 0.0, 1.0));
  if (!(shift > 0.0)) s.shiftAcc = 0.0;
  const double rotKnob = clamp(safe(rotate), 0.0, 1.0);
  const double rot = rotKnob + s.shiftAcc;
  // Gate 0 is the limit of a tiny gate, not "off": the steps keep their
  // relative accents (Exaggerate, Velocity, trigger, Step). Level is the off.
  const double w = clamp(safe(gate), 1.0e-6, 64.0);
  const int nLen = (int)(clamp(safe(length), 0.0, 4096.0) + 0.5);
  s.trigger = 0.0;
  const double exAmt = clamp(safe(exaggerateAmount), 0.0, 1.0);
  if (exAmt > 0.0) update_stats(s, sp, rot, w, nLen);

  // Rate is steps per second: grid samples per host sample = Rate x Spacing /
  // host rate. Spacing picks the pattern, Rate alone sets speed.
  const double perHost = clamp(maxd(0.0, safe(rate)) * sp / hostRate, 0.0, 64.0);
  // Edge unit (grid samples): Sharpness 0 = one grid sample (soft bump at slow
  // Rates), 1 = one host sample (crisp spike), log in between. Never under
  // one host sample, so the shape is band-limited for the host (anti-alias).
  const double sharp = clamp(safe(sharpness), 0.0, 1.0);
  const double unit = perHost >= 1.0 ? perHost : maxd(perHost, dsp_exp(sharp * dsp_ln(maxd(perHost, 1.0e-9))));

  if (rising_edge_bool(safe(reset) > 0.0, &s.resetWasHigh)) {
    s.loopStart = s.time;
    s.nextStep = 0;
    s.advanceStep = 0;
    s.shiftAcc = 0.0;
  }
  // Advance: play the next step now, at its own remainder (sub-sample offset).
  const bool adv = rising_edge_bool(safe(advance) > 0.0, &s.advanceWasHigh);
  if (hasAdvance && adv) {
    const long long k = s.advanceStep;
    const double t0 = s.time + frac01(rot + (double)k * sp);
    add_event(s, t0, w, lvl, k, exAmt, unit);
    s.advanceStep = nLen > 0 ? (k + 1) % nLen : k + 1;
    if (nLen > 0 && s.advanceStep == 0) s.shiftAcc = frac01(s.shiftAcc + shift);
  }

  s.time += perHost;
  if (!hasAdvance) {
    // Internal clock: schedule every step starting at or before now.
    for (int guard = 0; guard < 256; guard++) {
      const double rotNow = rotKnob + s.shiftAcc;
      if (nLen > 0 && s.nextStep >= nLen) {
        // Loop restart on a whole grid sample: the alignment repeats (or, with
        // Loop Shift, moves on by Loop Shift).
        const double loopLen = maxd(1.0, dsp_ceil((double)nLen * sp + rotNow));
        if (s.time - s.loopStart < loopLen) break;
        s.loopStart += loopLen;
        s.nextStep = 0;
        s.shiftAcc = frac01(s.shiftAcc + shift);
        continue;
      }
      const double t0 = s.loopStart + rotNow + (double)s.nextStep * sp;
      if (t0 > s.time) break;
      add_event(s, t0, w, lvl, s.nextStep, exAmt, unit);
      s.nextStep++;
    }
    // Free run: keep loopStart near now so times stay precise.
    if (nLen == 0 && s.nextStep > 1000000) {
      s.loopStart += (double)s.nextStep * sp;
      s.nextStep = 0;
    }
  }

  // Sum the live steps at this host sample; fire trigger / Velocity / Step at
  // each step's peak, so they line up with the BLIT out at any Rate.
  double v = 0.0;
  int keep = 0;
  for (int i = 0; i < s.evCount; i++) {
    if (!s.evFired[i] && s.time >= s.evPeak[i]) {
      s.evFired[i] = true;
      s.trigger = s.evAccent[i];
      s.velocity = s.evAccent[i];
      s.step = s.evIndex[i];
    }
    if (s.time > s.evStart[i] + s.evDur[i] + (kLatency + 2.0) * s.evUnit[i] && s.evFired[i]) continue;
    v += event_value(s, i, s.time);
    if (keep != i) {
      s.evStart[keep] = s.evStart[i]; s.evDur[keep] = s.evDur[i]; s.evUnit[keep] = s.evUnit[i];
      s.evAmp[keep] = s.evAmp[i]; s.evPeak[keep] = s.evPeak[i]; s.evAccent[keep] = s.evAccent[i];
      s.evIndex[keep] = s.evIndex[i]; s.evFired[keep] = s.evFired[i];
    }
    keep++;
  }
  s.evCount = keep;
  return v;
}

// Rotate in effect for the loop now playing (Rotate + Loop Shift so far), for the face.
extern "C" double soemdsp_blit_trigger_rotation(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].shiftAcc;
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
  return 10; // 10: Loop Shift (Rotate moves by Loop Shift at every loop wrap; Reset returns to loop 0); soemdsp_blit_trigger_rotation = the shift so far. 9: steps rendered in host time with Sharpness (edge width from one grid sample to one host sample); trigger / Velocity / Step fire at the BLIT peak. 8: Rate (Hz, steps per second) replaces Clock Speed; Spacing only picks the pattern. 7: BLIT out anti-aliased above Clock Speed ~1 (edges widened to one host sample). 6: Gate floored at 1e-6 (Gate 0 = the tiny-gate limit, never off). 5: Exaggerate Difference (accent range stretched toward 0..1 over the loop). 4: Rounding Error Sequencer: Spacing / Rotate / Length loop / Gate / Clock Speed, Advance trigger in, Velocity + Step outs. 3: hard trigger out. 2: Speed. 1: BLIT gate at a fixed 48 kHz.
}
