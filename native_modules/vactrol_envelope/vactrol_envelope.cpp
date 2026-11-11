// soemdsp-native-module: vactrol_envelope
// soemdsp-native-label: Vactrol
// soemdsp-native-target: vactrol
// soemdsp-native-kind: envelope
//
// Optical-lag envelope (soemdsp::modulator::Vactrol style):
// Light → attack/release one-pole → gamma → Out / Tone.
//
// Always the former Model B law (exact pow, level-dependent tau, memory):
//     target      = clamp(light * bright, 0, 1)
//                   bright = 1 + memoryBright * m
//     rise:  scale_atk   = span <= 1 ? 1 : pow(span, 0.25 * (target - 0.25))
//            raw += (target - raw) * (1 - exp(-1 / ((attack / scale_atk) * sr)))
//     fall:  scale       = span <= 1 ? 1 : pow(span, (raw - 0.25))
//            release_eff = release * (1 + memoryDepth * m)
//            raw += (target - raw) * (1 - exp(-1 / ((release_eff / scale) * sr)))
//     memory: m += (raw - m) * (1 - exp(-1 / (tau * sr)))
//             tau = memoryCharge up / memoryDischarge down
//     out  = pow(raw, curve)        // Amp Env, Amp Curve only
//     tone = pow(raw, fltCurve)     // Flt Env, independent Flt Curve
//     raw snapped to 0 below kSnapFloor when dark.
//
// Tail Span 0 (or <= 1) is constant tau, including attack. Mem Depth 0 and
// Warm Gain 0 leave the one-pole unmodulated (old Model A timing).
//
// Defaults: memoryDepth 2, memoryCharge 1 s, memoryDischarge 3 s,
// releaseSpan 100, memoryBright 0, fltCurve 2.
//
// Retrigger + Recalc On Trig: Latch freezes knobs on a rising Retrigger;
// Free = knobs live. Retrigger never resets the level. Unconnected Retrigger
// is treated as Free by the graph. A gate into Light is the strike: gate
// length is the width, gate height is the level.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const char kMetadataJson[] =
  "{"
    "\"module\":\"vactrol_envelope\","
    "\"label\":\"Vactrol\","
    "\"targetType\":\"vactrol\","
    "\"kind\":\"envelope\","
    "\"inputs\":[\"Light\",\"Retrigger\"],"
    "\"outputs\":[\"Tone\",\"Out\"],"
    "\"parameters\":["
      "{"
        "\"key\":\"attack\","
        "\"label\":\"Attack\","
        "\"kind\":\"time\","
        "\"defaultValue\":0,"
        "\"min\":0,"
        "\"mid\":0.01,"
        "\"max\":2,"
        "\"unit\":\"s\""
      "},"
      "{"
        "\"key\":\"release\","
        "\"label\":\"Release\","
        "\"kind\":\"time\","
        "\"defaultValue\":0.1,"
        "\"min\":0,"
        "\"mid\":0.1,"
        "\"max\":5,"
        "\"unit\":\"s\""
      "},"
      "{"
        "\"key\":\"curve\","
        "\"label\":\"Amp Curve\","
        "\"defaultValue\":1,"
        "\"min\":0.001,"
        "\"mid\":1,"
        "\"max\":8"
      "},"
      "{"
        "\"key\":\"memoryDepth\","
        "\"label\":\"Mem Depth\","
        "\"defaultValue\":2,"
        "\"min\":0,"
        "\"mid\":2,"
        "\"max\":8"
      "},"
      "{"
        "\"key\":\"memoryCharge\","
        "\"label\":\"Charge\","
        "\"kind\":\"time\","
        "\"defaultValue\":1,"
        "\"min\":0,"
        "\"mid\":1,"
        "\"max\":10,"
        "\"unit\":\"s\""
      "},"
      "{"
        "\"key\":\"memoryDischarge\","
        "\"label\":\"Discharge\","
        "\"kind\":\"time\","
        "\"defaultValue\":3,"
        "\"min\":0,"
        "\"mid\":3,"
        "\"max\":20,"
        "\"unit\":\"s\""
      "},"
      "{"
        "\"key\":\"releaseSpan\","
        "\"label\":\"Tail Span\","
        "\"defaultValue\":100,"
        "\"min\":0,"
        "\"mid\":100,"
        "\"max\":1000"
      "},"
      "{"
        "\"key\":\"memoryBright\","
        "\"label\":\"Warm Gain\","
        "\"defaultValue\":0,"
        "\"min\":0,"
        "\"mid\":0.25,"
        "\"max\":2"
      "},"
      "{"
        "\"key\":\"fltCurve\","
        "\"label\":\"Flt Curve\","
        "\"defaultValue\":2,"
        "\"min\":0.001,"
        "\"mid\":1,"
        "\"max\":8"
      "},"
      "{"
        "\"key\":\"recalculateOnTrigger\","
        "\"label\":\"Free / Latch\","
        "\"kind\":\"choice\","
        "\"choices\":[\"Free\",\"Latch\"],"
        "\"defaultValue\":1"
      "}"
    "]"
  "}";

static const int kMaxInstances = 64;

static const double kReleaseRefLevel = 0.25;
static const double kSnapFloor = 1.0e-6;
static const double kAttackSpanExp = 0.25; // modest vs release (1.0): ~2.4x faster attack at full light, span=100

struct VactrolState {
  double raw;
  double out;
  double tone;
  double m;
  double lastRetrig;
  double shotAttack;
  double shotRelease;
  double shotCurve;
  double shotMemoryDepth;
  double shotMemoryCharge;
  double shotMemoryDischarge;
  double shotReleaseSpan;
  double shotMemoryBright;
  double shotFltCurve;
  bool   hasShot;
  bool   active;
};

static VactrolState gPool[kMaxInstances];

static double vactrol_coefficient(double seconds, double sampleRate) {
  if (!(seconds > 0.0)) {
    return 1.0;
  }
  double samples = seconds * (sampleRate < 1.0 ? 1.0 : sampleRate);
  if (samples < 1.0) samples = 1.0;
  return 1.0 - dsp_exp_squaring(-1.0 / samples);
}

static inline double vactrol_span_scale(double span, double level, double exponent) {
  if (!(span > 1.0)) return 1.0;
  return pow_pos(span, exponent * (clamp(level, 0.0, 1.0) - kReleaseRefLevel));
}

static void vactrol_shape_outputs(VactrolState& s, double curve, double fltCurve) {
  const double raw01 = clamp(s.raw, 0.0, 1.0);
  s.out = clamp(pow_pos(raw01, curve), 0.0, 1.0);
  s.tone = clamp(pow_pos(raw01, fltCurve), 0.0, 1.0);
}

static double vactrol_step(
  VactrolState& s,
  double target,
  double attack,
  double release,
  double curve,
  double memoryDepth,
  double memoryCharge,
  double memoryDischarge,
  double releaseSpan,
  double fltCurve,
  double sampleRate
) {
  double k;
  if (target > s.raw) {
    const double scaleAtk = vactrol_span_scale(releaseSpan, target, kAttackSpanExp);
    k = vactrol_coefficient(attack / scaleAtk, sampleRate);
  } else {
    const double scale = vactrol_span_scale(releaseSpan, s.raw, 1.0);
    const double depth = memoryDepth > 0.0 ? memoryDepth : 0.0;
    const double releaseEff = release * (1.0 + depth * s.m);
    k = vactrol_coefficient(releaseEff / scale, sampleRate);
  }
  s.raw = safe(s.raw + (target - s.raw) * k);
  if (target < kSnapFloor && s.raw < kSnapFloor) s.raw = 0.0;
  const double tauM = s.raw > s.m
    ? (memoryCharge > 0.0 ? memoryCharge : 0.0)
    : (memoryDischarge > 0.0 ? memoryDischarge : 0.0);
  const double km = vactrol_coefficient(tauM, sampleRate);
  s.m = safe(s.m + (s.raw - s.m) * km);
  vactrol_shape_outputs(s, curve, fltCurve);
  return safe(s.out);
}

}  // namespace

extern "C" int soemdsp_vactrol_envelope_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      VactrolState& s = gPool[i];
      s.raw = 0.0;
      s.out = 0.0;
      s.tone = 0.0;
      s.m = 0.0;
      s.lastRetrig = 0.0;
      s.shotAttack = 0.0;
      s.shotRelease = 0.1;
      s.shotCurve = 1.0;
      s.shotMemoryDepth = 2.0;
      s.shotMemoryCharge = 1.0;
      s.shotMemoryDischarge = 3.0;
      s.shotReleaseSpan = 100.0;
      s.shotMemoryBright = 0.0;
      s.shotFltCurve = 2.0;
      s.hasShot = false;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_vactrol_envelope_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_vactrol_envelope_sample(
  int    handle,
  double light,
  double retrigger,
  double attack,
  double release,
  double curve,
  double recalculateOnTrigger,
  double memoryDepth,
  double memoryCharge,
  double memoryDischarge,
  double releaseSpan,
  double memoryBright,
  double fltCurve,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  VactrolState& s = gPool[handle - 1];

  const bool latch = safe(recalculateOnTrigger) >= 0.5;
  const bool retrigHigh = safe(retrigger) > 0.0;
  const bool retrigRise = !(s.lastRetrig > 0.0) && retrigHigh;
  s.lastRetrig = retrigHigh ? 1.0 : 0.0;
  if (!latch || retrigRise || !s.hasShot) {
    s.shotAttack = attack;
    s.shotRelease = release;
    s.shotCurve = curve;
    s.shotMemoryDepth = memoryDepth;
    s.shotMemoryCharge = memoryCharge;
    s.shotMemoryDischarge = memoryDischarge;
    s.shotReleaseSpan = releaseSpan;
    s.shotMemoryBright = memoryBright;
    s.shotFltCurve = fltCurve;
    s.hasShot = true;
  }

  const double rate = sampleRate < 1.0 ? 1.0 : sampleRate;
  const double safeLight = safe(light);
  const double safeAttack = s.shotAttack > 0.0 ? s.shotAttack : 0.0;
  const double safeRelease = s.shotRelease > 0.0 ? s.shotRelease : 0.0;
  const double safeCurve = s.shotCurve > 0.001 ? s.shotCurve : 0.001;
  const double safeFltCurve = s.shotFltCurve > 0.001 ? s.shotFltCurve : 0.001;
  const double bright = s.shotMemoryBright > 0.0 ? s.shotMemoryBright : 0.0;
  const double target = clamp(safeLight * (1.0 + bright * s.m), 0.0, 1.0);
  return vactrol_step(
    s,
    target,
    safeAttack,
    safeRelease,
    safeCurve,
    s.shotMemoryDepth > 0.0 ? s.shotMemoryDepth : 0.0,
    s.shotMemoryCharge > 0.0 ? s.shotMemoryCharge : 0.0,
    s.shotMemoryDischarge > 0.0 ? s.shotMemoryDischarge : 0.0,
    s.shotReleaseSpan > 0.0 ? s.shotReleaseSpan : 0.0,
    safeFltCurve,
    rate
  );
}

extern "C" double soemdsp_vactrol_envelope_tone(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return safe(gPool[handle - 1].tone);
}

extern "C" double soemdsp_vactrol_envelope_memory(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return safe(gPool[handle - 1].m);
}

extern "C" int soemdsp_vactrol_envelope_version() {
  return 9; // 9: dropped Model A/B (always former Model B). 8: Amp Env = raw^curve, Flt Env = raw^fltCurve (independent); memory m display tap. 7: dropped Sens (target = clamp(light * warm, 0, 1)). 6: dropped Ping / Strike / Width (use a gate into Light). 5: ModelB default, memory/span, Tone, warm gain, modest attack scale
}

extern "C" const char* soemdsp_vactrol_envelope_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_vactrol_envelope_metadata_json_size() {
  return sizeof(kMetadataJson) - 1;
}
