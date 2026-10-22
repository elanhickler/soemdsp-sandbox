// soemdsp-native-module: pulse_train
// soemdsp-native-label: Pulse Train
// soemdsp-native-target: pulseTrain
// soemdsp-native-kind: generator
//
// Pulse Train: a trigger starts a train of single-sample pulses whose gaps
// follow a time curve, like a thing slowing down over time (gaps grow).
// The schedule is fixed at the trigger from the params at that moment:
//   N = Count (1..128), u_i = i / (N - 1) (N = 1: u = 0), i = 0..N-1
//   E_k(u) = (e^(k u) - 1) / (e^k - 1)   (k = 0: E(u) = u, linear)
//   t_i = End * E_curve(u_i)             seconds after the trigger
//   a_i = (Start + (End Amp - Start) * E_ampCurve(u_i)) * Amplitude * velocity
// Curve > 0: gaps grow (fast first, stretching out); 0: even; < 0: gaps
// shrink (a real bouncing ball settling speeds up). First pulse at t = 0,
// last pulse at exactly End (End 0..12 s). E_k is the Early Reflections tap
// spacing family (k = 3 there).
// Mode (append-only ids): 0 One shot (default): as above, u_i = i/(N-1), last
// pulse exactly at Time. 1 Loop: free-runs from module start with no trigger;
// the cycle is Time seconds and repeats, params re-latched at each cycle
// start; u_i = i / N so the schedule spans [0, Time) and the last pulse
// (Time * E(u_{N-1})) never lands on the next cycle's first pulse at 0.
// Trigger hits restart the cycle at 0 (Trigger velocity is kept for
// later cycles; free-run velocity is 1). End fires on each cycle's last pulse.
// Time 0 in Loop: a 1-sample cycle (all pulses every sample).
// Kept guards (everything else is limited only by the param definitions):
// Count 1..128 (pulse buffer size; NaN -> 1), Time < 0 / NaN -> 0 (no pulses
// before the trigger), t_i kept in [0, Time] (dsp_exp overflow at extreme
// Curve gives NaN; rounding), sampleRate < 1 -> 44100 (divide by zero). Velocity = shared gate_hit velocity of the
// Trigger hit. Pulse i plays on the first sample n (counted from the trigger
// sample, n = 0) with n / sampleRate >= t_i; pulses landing on one sample add.
// End output: 1 on the sample the last pulse plays. A Trigger hit (shared
// abs-rise rule) mid-train restarts it; there is no Reset input (v4). Amplitude is not clamped.
// soemdsp_pulse_train_preview() builds the same schedule for displays.
// Recalculate On Trigger (recalc > 0.5, default On = the behavior above): all
// schedule params (Count, Time, Curve, Amp Start / End / Curve, Amplitude) are
// latched at each Trigger hit and Loop cycle start. Off: the schedule
// follows the live params every sample (rebuilt when any changes); pulses
// already played are never replayed (the next index only moves forward), and
// pulses whose new time is already behind the playhead are skipped, so a Time
// cut below the elapsed time ends the train (One shot: End fires). Loop Off:
// the cycle length is the live Time. Mode itself is always live.
// soemdsp_pulse_train_effective(handle, i) exposes the params in effect (the
// latched ones while running with Recalculate On; otherwise the live ones) so
// the face shows exactly what plays. i: 0 Count, 1 Time, 2 Curve, 3 Amp Start,
// 4 Amp End, 5 Amp Curve, 6 Amplitude * velocity.

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/trigger/trigger.h>
#include <soemdsp/math/exp_log.h>
using soemdsp_maths::gate_hit;
using soemdsp_maths::gate_hit_velocity;

namespace {

static const int kMaxInstances = 32;
static const int kMaxPulses = 128;

struct PulseTrainState {
  bool active;
  bool running;
  double prevTrig;
  long long n;  // samples since trigger
  int count;
  int next;
  double times[kMaxPulses];
  double amps[kMaxPulses];
  double endOut;
  double elapsed;
  double cycle;     // Loop: latched Time of this cycle (s)
  double velocity;  // Loop: velocity of the last Trigger hit (1 free-run)
  bool endFired;    // Loop: End already sent this cycle
  double eff[7];    // params in effect (schedule built from these)
  double effVel;    // velocity the schedule was built with
};

static PulseTrainState gPool[kMaxInstances];
static double gPreviewTimes[kMaxPulses];
static double gPreviewAmps[kMaxPulses];
static int gPreviewCount = 0;

static inline double curveShape(double k, double u) {
  if (!(k > 1e-6 || k < -1e-6)) return u;  // k = 0 (or NaN): linear
  return (soemdsp_maths::dsp_exp(k * u) - 1.0) / (soemdsp_maths::dsp_exp(k) - 1.0);
}

static int buildSchedule(
  double* times, double* amps, double count, double endTime, double curve,
  double ampStart, double ampEnd, double ampCurve, double amplitude, double velocity, bool loop
) {
  int n = 1;
  if (count >= 1.0) n = count >= (double)kMaxPulses ? kMaxPulses : (int)(count + 0.5);
  const double end = endTime > 0.0 ? endTime : 0.0;  // NaN / negative -> 0
  for (int i = 0; i < n; i++) {
    const double u = loop ? (double)i / (double)n : (n > 1 ? (double)i / (double)(n - 1) : 0.0);
    double t = !loop && i == n - 1 && n > 1 ? end : end * curveShape(curve, u);
    if (!(t >= 0.0)) t = 0.0;
    if (t > end) t = end;
    times[i] = t;
    amps[i] = (ampStart + (ampEnd - ampStart) * curveShape(ampCurve, u)) * amplitude * velocity;
  }
  return n;
}

}  // namespace

extern "C" int soemdsp_pulse_train_version() { return 4; }

extern "C" int soemdsp_pulse_train_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      PulseTrainState& s = gPool[i];
      s.running = false;
      s.prevTrig = 0.0;
      s.n = 0;
      s.count = 0;
      s.next = 0;
      s.endOut = 0.0;
      s.elapsed = -1.0;
      s.cycle = 0.0;
      s.velocity = 1.0;
      s.endFired = false;
      for (int k = 0; k < 7; k++) s.eff[k] = 0.0;
      s.effVel = 1.0;
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
  double recalc
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  const bool loop = mode > 0.5;
  const bool latch = recalc > 0.5;
  PulseTrainState& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double live[7] = { count, endTime, curve, ampStart, ampEnd, ampCurve, amplitude };
  s.endOut = 0.0;
  const bool trigHit = gate_hit(trigger, &s.prevTrig);
  if (trigHit) s.velocity = gate_hit_velocity();
  // Loop: start (free-run), restart on Trigger, or wrap at the cycle end.
  const double cycleNow = latch ? s.cycle : (endTime > 0.0 ? endTime : 0.0);
  const bool loopStart = loop && (!s.running || trigHit
    || (s.n > 0 && (double)s.n / sr >= cycleNow));
  if (trigHit || loopStart) {
    const double v = trigHit ? gate_hit_velocity() : s.velocity;
    s.count = buildSchedule(s.times, s.amps, count, endTime, curve, ampStart, ampEnd, ampCurve, amplitude, v, loop);
    for (int k = 0; k < 7; k++) s.eff[k] = live[k];
    s.effVel = v;
    s.cycle = endTime > 0.0 ? endTime : 0.0;
    s.next = 0;
    s.n = 0;
    s.endFired = false;
    s.running = true;
  } else if (s.running && !latch) {
    // Recalculate Off: follow the live params mid-train.
    bool changed = false;
    for (int k = 0; k < 7; k++) {
      if (!(s.eff[k] == live[k])) { changed = true; break; }
    }
    if (changed) {
      s.count = buildSchedule(s.times, s.amps, count, endTime, curve, ampStart, ampEnd, ampCurve, amplitude, s.effVel, loop);
      for (int k = 0; k < 7; k++) s.eff[k] = live[k];
      s.cycle = endTime > 0.0 ? endTime : 0.0;
      // Skip pulses now behind the playhead (already-played indices never replay).
      const double ePrev = s.n > 0 ? (double)(s.n - 1) / sr : -1.0;
      int k = 0;
      while (k < s.count && s.times[k] <= ePrev) k++;
      if (k > s.next) s.next = k;
      if (s.next > s.count) s.next = s.count;
    }
  }
  if (!s.running) {
    // Idle: the face shows what the next trigger latches (the live params).
    for (int k = 0; k < 7; k++) s.eff[k] = live[k];
    s.effVel = 1.0;
    s.elapsed = -1.0;
    return 0.0;
  }
  const double e = (double)s.n / sr;
  s.elapsed = e;
  double out = 0.0;
  while (s.next < s.count && s.times[s.next] <= e) {
    out += s.amps[s.next];
    s.next++;
  }
  if (!loop) {
    if (s.next >= s.count) {
      s.endOut = 1.0;
      s.running = false;
    }
  } else if (s.next >= s.count && !s.endFired) {
    // Loop: End once per cycle, on the sample the last pulse plays.
    s.endOut = 1.0;
    s.endFired = true;
  }
  s.n++;
  return out;
}

// Params in effect (see header): 0 Count .. 5 Amp Curve, 6 Amplitude * velocity.
extern "C" double soemdsp_pulse_train_effective(int handle, int i) {
  if (handle < 1 || handle > kMaxInstances || i < 0 || i > 6) return 0.0;
  const PulseTrainState& s = gPool[handle - 1];
  return i == 6 ? s.eff[6] * s.effVel : s.eff[i];
}

extern "C" double soemdsp_pulse_train_end(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].endOut;
}

// Seconds since the trigger for the current sample, -1 when idle.
extern "C" double soemdsp_pulse_train_elapsed(int handle) {
  if (handle < 1 || handle > kMaxInstances) return -1.0;
  return gPool[handle - 1].elapsed;
}

extern "C" int soemdsp_pulse_train_preview(
  double count, double endTime, double curve, double ampStart, double ampEnd,
  double ampCurve, double amplitude, double mode
) {
  gPreviewCount = buildSchedule(gPreviewTimes, gPreviewAmps, count, endTime, curve,
    ampStart, ampEnd, ampCurve, amplitude, 1.0, mode > 0.5);
  return gPreviewCount;
}

extern "C" double soemdsp_pulse_train_preview_time(int i) {
  return i >= 0 && i < gPreviewCount ? gPreviewTimes[i] : 0.0;
}

extern "C" double soemdsp_pulse_train_preview_amplitude(int i) {
  return i >= 0 && i < gPreviewCount ? gPreviewAmps[i] : 0.0;
}
