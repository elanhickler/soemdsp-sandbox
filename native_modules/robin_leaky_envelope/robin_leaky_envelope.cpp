// soemdsp-native-module: robin_leaky_envelope
// soemdsp-native-label: Robin Leaky Envelope
// soemdsp-native-target: robinLeakyEnvelope
// soemdsp-native-kind: envelope
//
// Robin Schmidt's leaky envelope (KVR "ADSRs alternatives" thread;
// RS-MET-Research testVaryCoefFilter): a leaky integrator with no input whose
// coefficient is itself smoothed by a second leaky integrator. The decay
// starts fast and slows down into a slow decay, or into a hold.
// Parameterized by time, as his ToDo suggests:
//   c(T) = exp(ln(0.001) / (T * sr))        (T = T60 decay time, s)
//   b    = exp(-1 / (Transition * sr))      (Transition 0: c jumps to End)
// Trigger hit: y = height (abs-rise velocity), c = c(Start Decay).
// Each sample:
//   Out = y * Amplitude
//   c   = cEnd + b * (c - cEnd)             (coefficient glides to End Decay)
//   y   = c * y
// End Decay at its max (kHoldSeconds) is c = 1: the envelope settles into a
// hold at the level it reached. Idle once y falls below -140 dB.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;
static const double kLn60dB = -6.907755278982137; // ln(0.001)
static const double kHoldSeconds = 1000.0;
static const double kIdleLevel = 1.0e-7;

struct State {
  double y;
  double c;
  double lastIn;
  // Cached coefficient math (recomputed only when its inputs change).
  double endKey;
  double endCoeff;
  double transKey;
  double transCoeff;
  double srKey;
  bool running;
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"robin_leaky_envelope\","
    "\"label\":\"Robin Leaky Envelope\","
    "\"targetType\":\"robinLeakyEnvelope\","
    "\"kind\":\"envelope\""
  "}";

// Per-sample multiplier that reaches -60 dB after t60 seconds.
static double decayCoeff(double t60, double sr) {
  if (t60 >= kHoldSeconds) return 1.0;
  const double t = maxd(1.0e-6, t60);
  return dsp_exp(kLn60dB / (t * sr));
}

static double glideCoeff(double seconds, double sr) {
  if (!(seconds > 0.0)) return 0.0;
  return dsp_exp(-1.0 / (seconds * sr));
}

}  // namespace

extern "C" int soemdsp_robin_leaky_envelope_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.y = 0.0;
      s.c = 0.0;
      s.lastIn = 0.0;
      s.endKey = -1.0;
      s.endCoeff = 0.0;
      s.transKey = -1.0;
      s.transCoeff = 0.0;
      s.srKey = 0.0;
      s.running = false;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_robin_leaky_envelope_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_robin_leaky_envelope_sample(
  int handle,
  double trigger,
  double startDecay,
  double endDecay,
  double transition,
  double amplitude,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];

  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double endT = safe(endDecay);
  const double transT = safe(transition);
  if (sr != s.srKey || endT != s.endKey) {
    s.endCoeff = decayCoeff(endT, sr);
    s.endKey = endT;
  }
  if (sr != s.srKey || transT != s.transKey) {
    s.transCoeff = glideCoeff(transT, sr);
    s.transKey = transT;
  }
  s.srKey = sr;

  const double in = safe(trigger);
  if (gate_hit(in, &s.lastIn)) {
    s.y = gate_hit_velocity();
    s.c = decayCoeff(safe(startDecay), sr);
    s.running = true;
  }
  if (!s.running) return 0.0;

  const double out = s.y * safe(amplitude);
  s.c = s.endCoeff + s.transCoeff * (s.c - s.endCoeff);
  s.y *= s.c;
  if (!(s.y * 0.0 == 0.0)) s.y = 0.0;
  if (s.y < kIdleLevel && s.y > -kIdleLevel) {
    s.y = 0.0;
    s.running = false;
  }
  return (out * 0.0 == 0.0) ? out : 0.0;
}

extern "C" int soemdsp_robin_leaky_envelope_is_idle(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 1;
  const State& s = gPool[handle - 1];
  return (!s.active || !s.running) ? 1 : 0;
}

extern "C" int soemdsp_robin_leaky_envelope_version() { return 1; }
extern "C" const char* soemdsp_robin_leaky_envelope_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_robin_leaky_envelope_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
