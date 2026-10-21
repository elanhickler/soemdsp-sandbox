// soemdsp-native-module: resonant_compressor
// soemdsp-native-label: Resonant Compressor
// soemdsp-native-target: resonantCompressor
// soemdsp-native-kind: dynamics
//
// Resonant Compressor (Argi's design): the detector is Resonant Envelope
// itself (native_modules/resonant_envelope), fed audio at its Trigger input.
// Default Trigger Detect is Abs rise: every sample where |x| rises fires with
// velocity = the rise, so the envelope is slope / transient weighted. The
// envelope's SC output clamp(1 - Out / Amplitude, 0, 1) is the gain.
//
// Detector input: Sidechain if wired, else the input. Mono: the In L signal
// (raw, as Argi's patch fed it). Stereo (In R wired): max(|L|, |R|), one
// linked gain for both sides. Times Sensitivity.
// Envelope runs with Amplitude 1, Output Range Fit, Recalculate On Trigger On,
// Mode Envelope, Velocity As detected (Resonant Envelope defaults).
// Gain = SC * Depth + (1 - Depth)  (Depth 1: Gain is SC exactly).
// Out = (dry * (1 - Mix) + dry * Gain * Mix) * Makeup. No output clamp.

#include <soemdsp/soemdsp.hpp>

using namespace soemdsp_maths;

extern "C" int soemdsp_resonant_envelope_create();
extern "C" void soemdsp_resonant_envelope_destroy(int handle);
extern "C" double soemdsp_resonant_envelope_sample(
  int handle, double input, double freqHz, double attackSec, double decaySec,
  double resonance, double impulse, double tracking, double amplitude,
  double outputRange, double recalculateOnTrigger, double sampleRate,
  double mode, double triggerDetect, double velocityMode, double holdMode);
extern "C" double soemdsp_resonant_envelope_sc(int handle);

namespace {

static const int kMaxInstances = 32;

struct State {
  int env;
  double gain;
  double envOut;
  double outR;
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"resonant_compressor\","
    "\"label\":\"Resonant Compressor\","
    "\"targetType\":\"resonantCompressor\","
    "\"kind\":\"dynamics\""
  "}";

static double finite_or(double v, double fallback) {
  const double x = safe(v);
  return (x * 0.0 == 0.0) ? x : fallback;
}

}  // namespace

extern "C" int soemdsp_resonant_compressor_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      const int env = soemdsp_resonant_envelope_create();
      if (env <= 0) return 0;
      State& s = gPool[i];
      s.env = env;
      s.gain = 1.0;
      s.envOut = 0.0;
      s.outR = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_resonant_compressor_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return;
  soemdsp_resonant_envelope_destroy(gPool[handle - 1].env);
  gPool[handle - 1].active = false;
}

// Returns Out L; Out R / Gain / Env via the getters below.
extern "C" double soemdsp_resonant_compressor_sample(
  int handle,
  double inL,
  double inR,
  double sidechain,
  double stereo,
  double sidechainWired,
  double freqHz,
  double tracking,
  double resonance,
  double attackSec,
  double decaySec,
  double impulse,
  double sensitivity,
  double depth,
  double mix,
  double makeup,
  double triggerDetect,
  double holdMode,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double l = finite_or(inL, 0.0);
  const double r = finite_or(inR, 0.0);
  const bool st = safe(stereo) >= 0.5;
  double det;
  if (safe(sidechainWired) >= 0.5) {
    det = finite_or(sidechain, 0.0);
  } else if (st) {
    const double al = dsp_fabs(l);
    const double ar = dsp_fabs(r);
    det = al > ar ? al : ar;
  } else {
    det = l;
  }
  det *= finite_or(sensitivity, 1.0);
  s.envOut = soemdsp_resonant_envelope_sample(
    s.env, det, freqHz, attackSec, decaySec, resonance, impulse, tracking,
    1.0, 0.0, 1.0, sampleRate, 0.0, triggerDetect, 0.0, holdMode);
  const double sc = soemdsp_resonant_envelope_sc(s.env);
  const double d = finite_or(depth, 1.0);
  double g = sc * d + (1.0 - d);
  if (!(g * 0.0 == 0.0)) g = 1.0;
  s.gain = g;
  const double m = finite_or(mix, 1.0);
  const double mk = finite_or(makeup, 1.0);
  const double outL = (l * (1.0 - m) + l * g * m) * mk;
  const double rr = st ? r : l;
  s.outR = (rr * (1.0 - m) + rr * g * m) * mk;
  return outL;
}

extern "C" double soemdsp_resonant_compressor_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].outR;
}

extern "C" double soemdsp_resonant_compressor_gain(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 1.0;
  return gPool[handle - 1].gain;
}

extern "C" double soemdsp_resonant_compressor_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

extern "C" int soemdsp_resonant_compressor_version() {
  return 1; // 1: initial (detector = Resonant Envelope v8 Trigger path, Abs rise default)
}

extern "C" const char* soemdsp_resonant_compressor_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_resonant_compressor_metadata_json_size() {
  return (int)sizeof(kMetadataJson);
}
