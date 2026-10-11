// soemdsp-native-module: ellipsoid_decay
// soemdsp-native-label: EllipsoidDecay
// soemdsp-native-target: ellipsoidDecay
// soemdsp-native-kind: envelope
//
// soundemote.dev Decay Envelopes #ellipsoiddecay (RoundShape sine→square).
// Bottom-left Bi Y quarter: phase 0.5→0.75, progress = −Bi Y.
// Trigger hit restarts t = 0 and latches height.
//   x = t / duration
//   phase = 0.5 + 0.25·x
//   c = 1 − morph
//   biY = cos(2π(phase−0.25)) / sqrt(cos² + (sin·c)²)
//   env = height + (0.001 − height) · (−biY)
//   Out = env * Amplitude. Idle after t >= duration.
// Morph 0 = circle, 1 = square (earlier drop).

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;
static const double kEng = 0.001;

struct State {
  double t;
  double height;
  double lastIn;
  bool running;
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"ellipsoid_decay\","
    "\"label\":\"EllipsoidDecay\","
    "\"targetType\":\"ellipsoidDecay\","
    "\"kind\":\"envelope\""
  "}";

// Same law as RoundShape / soemdsp_ellipsoid_sine_to_square (AA Off).
static double sine_to_square(double phaseCycles, double morph) {
  double s = 0.0, cph = 0.0;
  dsp_sin_cos_turns(phaseCycles, &s, &cph);
  const double c = 1.0 - clamp(morph, 0.0, 1.0);
  const double xx = (cph * cph) + (s * c) * (s * c);
  if (xx <= 1.0e-24) {
    if (cph > 0.0) return 1.0;
    if (cph < 0.0) return -1.0;
    return 0.0;
  }
  const double out = cph / __builtin_sqrt(xx);
  if (!(out * 0.0 == 0.0)) return 0.0;
  return out;
}

}  // namespace

extern "C" int soemdsp_ellipsoid_decay_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.t = 0.0;
      s.height = 0.0;
      s.lastIn = 0.0;
      s.running = false;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_ellipsoid_decay_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_ellipsoid_decay_sample(
  int handle,
  double trigger,
  double duration,
  double morph,
  double amplitude,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];

  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double in = safe(trigger);
  if (gate_hit(in, &s.lastIn)) {
    s.t = 0.0;
    s.height = in;
    s.running = true;
  }
  if (!s.running) return 0.0;

  const double dur = maxd(1.0e-6, safe(duration));
  const double x = s.t / dur;
  if (x >= 1.0) {
    s.running = false;
    return 0.0;
  }
  s.t += 1.0 / sr;

  const double start = maxd(1.0e-6, s.height);
  const double phase = 0.5 + 0.25 * x;
  const double biY = sine_to_square(phase - 0.25, safe(morph));
  const double progress = -biY;
  const double env = start + (kEng - start) * progress;
  const double out = env * safe(amplitude);
  return (out * 0.0 == 0.0) ? out : 0.0;
}

extern "C" int soemdsp_ellipsoid_decay_is_idle(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 1;
  const State& s = gPool[handle - 1];
  return (!s.active || !s.running) ? 1 : 0;
}

extern "C" int soemdsp_ellipsoid_decay_version() { return 1; }
extern "C" const char* soemdsp_ellipsoid_decay_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_ellipsoid_decay_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
