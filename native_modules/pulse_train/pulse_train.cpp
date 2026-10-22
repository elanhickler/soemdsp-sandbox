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
// spacing family (k = 3 there). Velocity = shared gate_hit velocity of the
// Trigger hit. Pulse i plays on the first sample n (counted from the trigger
// sample, n = 0) with n / sampleRate >= t_i; pulses landing on one sample add.
// End output: 1 on the sample the last pulse plays. Reset hit: stops the
// train (no End). A new Trigger hit restarts it. Amplitude is not clamped.
// soemdsp_pulse_train_preview() builds the same schedule for displays.

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/trigger/trigger.h>
#include <soemdsp/math/exp_log.h>
using soemdsp_maths::gate_hit;
using soemdsp_maths::gate_hit_velocity;

namespace {

static const int kMaxInstances = 32;
static const int kMaxPulses = 128;
static const double kMaxEnd = 12.0;

struct PulseTrainState {
  bool active;
  bool running;
  double prevTrig;
  double prevReset;
  long long n;  // samples since trigger
  int count;
  int next;
  double times[kMaxPulses];
  double amps[kMaxPulses];
  double endOut;
  double elapsed;
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
  double ampStart, double ampEnd, double ampCurve, double amplitude, double velocity
) {
  int n = 1;
  if (count >= 1.0) n = count >= (double)kMaxPulses ? kMaxPulses : (int)(count + 0.5);
  double end = endTime > 0.0 ? endTime : 0.0;  // NaN -> 0
  if (end > kMaxEnd) end = kMaxEnd;
  for (int i = 0; i < n; i++) {
    const double u = n > 1 ? (double)i / (double)(n - 1) : 0.0;
    double t = i == n - 1 && n > 1 ? end : end * curveShape(curve, u);
    if (t < 0.0) t = 0.0;
    if (t > end) t = end;
    times[i] = t;
    amps[i] = (ampStart + (ampEnd - ampStart) * curveShape(ampCurve, u)) * amplitude * velocity;
  }
  return n;
}

}  // namespace

extern "C" int soemdsp_pulse_train_version() { return 1; }

extern "C" int soemdsp_pulse_train_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      PulseTrainState& s = gPool[i];
      s.running = false;
      s.prevTrig = 0.0;
      s.prevReset = 0.0;
      s.n = 0;
      s.count = 0;
      s.next = 0;
      s.endOut = 0.0;
      s.elapsed = -1.0;
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
  int handle, double trigger, double reset, double count, double endTime, double curve,
  double ampStart, double ampEnd, double ampCurve, double amplitude, double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  PulseTrainState& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  s.endOut = 0.0;
  if (gate_hit(reset, &s.prevReset)) s.running = false;
  if (gate_hit(trigger, &s.prevTrig)) {
    const double v = gate_hit_velocity();
    s.count = buildSchedule(s.times, s.amps, count, endTime, curve, ampStart, ampEnd, ampCurve, amplitude, v);
    s.next = 0;
    s.n = 0;
    s.running = true;
  }
  if (!s.running) {
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
  if (s.next >= s.count) {
    s.endOut = 1.0;
    s.running = false;
  }
  s.n++;
  return out;
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
  double ampCurve, double amplitude
) {
  gPreviewCount = buildSchedule(gPreviewTimes, gPreviewAmps, count, endTime, curve,
    ampStart, ampEnd, ampCurve, amplitude, 1.0);
  return gPreviewCount;
}

extern "C" double soemdsp_pulse_train_preview_time(int i) {
  return i >= 0 && i < gPreviewCount ? gPreviewTimes[i] : 0.0;
}

extern "C" double soemdsp_pulse_train_preview_amplitude(int i) {
  return i >= 0 && i < gPreviewCount ? gPreviewAmps[i] : 0.0;
}
