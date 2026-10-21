// soemdsp-native-module: rms_meter
// soemdsp-native-label: RMS Meter
// soemdsp-native-target: rmsMeter
// soemdsp-native-kind: utility
//
// Running mean square with a one-pole smoother; RMS = sqrt(ms).
//   ms += (x^2 - ms) * (1 - exp(-1 / (tau * sr)))
// tau = Attack (ms) while x^2 > ms, Release (ms) otherwise (Attack == Release
// is a plain single-time-constant RMS). One tau = 63% of a level step in ms.
// Outs: RMS (linear, 0..), dB = 20*log10(rms) floored at -120 (rms <= 1e-6,
// same as Amp <-> dB), Env Inverted = clamp(1 - rms * Amplitude, 0, 1).

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;
static const double kDbFloor = -120.0;
static const double kLn10 = 2.302585092994046;

struct State {
  double ms;
  double rms;
  double db;
  double inv;
  double cAttackMs, cReleaseMs, cSr, kAtt, kRel;
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"rms_meter\","
    "\"label\":\"RMS Meter\","
    "\"targetType\":\"rmsMeter\","
    "\"kind\":\"utility\""
  "}";

static double time_ms(double v) {
  double x = safe(v);
  if (!(x * 0.0 == 0.0)) x = 300.0;
  if (x < 0.01) x = 0.01;
  if (x > 60000.0) x = 60000.0;
  return x;
}

static double coef(double ms, double sr) {
  const double k = 1.0 - dsp_exp(-1000.0 / (ms * sr));
  return (k * 0.0 == 0.0 && k > 0.0) ? (k > 1.0 ? 1.0 : k) : 1.0;
}

}  // namespace

extern "C" int soemdsp_rms_meter_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.ms = 0.0;
      s.rms = 0.0;
      s.db = kDbFloor;
      s.inv = 1.0;
      s.cAttackMs = -1.0;
      s.cReleaseMs = -1.0;
      s.cSr = -1.0;
      s.kAtt = 1.0;
      s.kRel = 1.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_rms_meter_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns RMS; dB and Env Inverted via the getters below (same sample).
extern "C" double soemdsp_rms_meter_sample(
  int handle,
  double input,
  double attackMs,
  double releaseMs,
  double amplitude,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double sr = (sampleRate >= 1.0 && sampleRate * 0.0 == 0.0) ? sampleRate : 44100.0;
  const double a = time_ms(attackMs);
  const double r = time_ms(releaseMs);
  if (a != s.cAttackMs || sr != s.cSr) { s.kAtt = coef(a, sr); s.cAttackMs = a; }
  if (r != s.cReleaseMs || sr != s.cSr) { s.kRel = coef(r, sr); s.cReleaseMs = r; }
  s.cSr = sr;
  double x = safe(input);
  if (!(x * 0.0 == 0.0)) x = 0.0;
  const double x2 = x * x;
  s.ms += (x2 - s.ms) * (x2 > s.ms ? s.kAtt : s.kRel);
  if (!(s.ms * 0.0 == 0.0) || s.ms < 1e-30) s.ms = 0.0;
  s.rms = s.ms > 0.0 ? sqrt_newton(s.ms) : 0.0;
  s.db = s.rms > 1e-6 ? (20.0 / kLn10) * dsp_ln(s.rms) : kDbFloor;
  if (s.db < kDbFloor) s.db = kDbFloor;
  double amp = safe(amplitude);
  if (!(amp * 0.0 == 0.0)) amp = 1.0;
  const double inv = 1.0 - s.rms * amp;
  s.inv = inv < 0.0 ? 0.0 : (inv > 1.0 ? 1.0 : inv);
  return s.rms;
}

extern "C" double soemdsp_rms_meter_db(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return kDbFloor;
  return gPool[handle - 1].db;
}

extern "C" double soemdsp_rms_meter_inverted(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 1.0;
  return gPool[handle - 1].inv;
}

extern "C" int soemdsp_rms_meter_version() { return 1; }
extern "C" const char* soemdsp_rms_meter_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_rms_meter_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
