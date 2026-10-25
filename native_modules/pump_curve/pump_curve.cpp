// soemdsp-native-module: pump_curve
// soemdsp-native-label: Pump Curve
// soemdsp-native-target: pumpCurve
// soemdsp-native-kind: dynamics
//
// Triggered ideal compressor GR envelope. A Trigger is a perfect step
// `Depth` dB above threshold; Ratio / Knee / Law shape the dip. Attack /
// Hold / Release time the envelope. Out = In × gain (with Makeup / Mix).
// Gain jack is the GR multiplier (1 at rest). Env jack is 1 − gain.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/dynamics/ms_gain_computer.h>

namespace {

using namespace soemdsp_maths;

constexpr int kMaxInstances = 64;
constexpr int kLawLin = 0;
constexpr int kLawDb = 1;
constexpr int kLawOpto = 2;
constexpr int kLawFet = 3;
constexpr int kStageRest = 0;
constexpr int kStageAttack = 1;
constexpr int kStageHold = 2;
constexpr int kStageRelease = 3;

struct PumpCurveState {
  bool active;
  int stage;
  double gain;
  double dipTarget;
  double holdLeft;
  double lastTrig;
  double lastLeft;
  double lastRight;
  double lastGain;
  double lastEnv;
};

static PumpCurveState gPool[kMaxInstances];

static int clamp_law(double law) {
  int n = (int)(law + (law >= 0.0 ? 0.5 : -0.5));
  if (n < 0) n = 0;
  if (n > 3) n = 3;
  return n;
}

static double clamp_mix01(double x) {
  if (!(x == x) || x < 0.0) return 0.0;
  if (x > 1.0) return 1.0;
  return x;
}

static double static_target(double depthDb, double ratio, double knee) {
  double d = depthDb;
  if (!(d == d) || d < 0.0) d = 0.0;
  if (d > 48.0) d = 48.0;
  double k = knee;
  if (!(k == k) || k < 0.0) k = 0.0;
  if (k > 1.0) k = 1.0;
  const double tDb = d * (1.0 - k);
  if (!(tDb > 0.0)) return 1.0;
  double r = ratio;
  if (!(r == r) || r < 1.0) r = 1.0;
  if (r <= 1.0) return 1.0;
  if (r >= 20.0) return soemdsp::math::db_to_amp(-tDb);
  const double grDb = tDb * (1.0 / r - 1.0);
  return soemdsp::math::db_to_amp(grDb);
}

static double one_pole_toward(double y, double t, double coeff) {
  if (coeff >= 1.0) return t;
  if (!(coeff > 0.0)) return y;
  return y + coeff * (t - y);
}

static double step_gain(
  double gain,
  double target,
  double dipTarget,
  double attMs,
  double relMs,
  double sr,
  int law,
  bool attacking
) {
  double aMs = attMs;
  double rMs = relMs;
  if (!(aMs == aMs) || aMs < 0.0) aMs = 0.0;
  if (!(rMs == rMs) || rMs < 0.0) rMs = 0.0;
  if (law == kLawFet) aMs = 0.1;
  else if (law == kLawOpto) aMs = aMs * 0.35;
  double c = attacking
    ? ms_detector_attack_coeff(aMs, sr)
    : ms_detector_release_coeff(rMs, sr);
  if (!attacking && law == kLawOpto) {
    const double den = 1.0 - dipTarget;
    double remaining = den > 1.0e-12 ? (1.0 - gain) / den : 0.0;
    if (remaining < 0.0) remaining = 0.0;
    if (remaining > 1.0) remaining = 1.0;
    c *= (0.15 + 0.85 * remaining);
  }
  if (law == kLawDb) {
    const double gDb = soemdsp::math::amp_to_db(gain < 1.0e-12 ? 1.0e-12 : gain);
    const double tDb = soemdsp::math::amp_to_db(target < 1.0e-12 ? 1.0e-12 : target);
    double next = soemdsp::math::db_to_amp(one_pole_toward(gDb, tDb, c));
    if (next < 0.0) next = 0.0;
    if (next > 1.0) next = 1.0;
    return next;
  }
  double next = one_pole_toward(gain, target, c);
  if (next < 0.0) next = 0.0;
  if (next > 1.0) next = 1.0;
  return next;
}

}  // namespace

extern "C" int soemdsp_pump_curve_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      PumpCurveState& s = gPool[i];
      s.stage = kStageRest;
      s.gain = 1.0;
      s.dipTarget = 1.0;
      s.holdLeft = 0.0;
      s.lastTrig = 0.0;
      s.lastLeft = 0.0;
      s.lastRight = 0.0;
      s.lastGain = 1.0;
      s.lastEnv = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_pump_curve_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_pump_curve_sample(
  int handle,
  double inL,
  double inR,
  double trigger,
  double sampleRate,
  double law,
  double ratio,
  double depthDb,
  double attackMs,
  double holdMs,
  double releaseMs,
  double knee,
  double makeupDb,
  double mix,
  double trigMode
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  PumpCurveState& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  double sr = sampleRate;
  if (!(sr > 1.0)) sr = 44100.0;
  const int lawI = clamp_law(law);
  const bool gateMode = trigMode >= 0.5;
  const double target = static_target(depthDb, ratio, knee);
  double hMs = holdMs;
  if (!(hMs == hMs) || hMs < 0.0) hMs = 0.0;
  const double holdSamples = hMs * 0.001 * sr;
  const bool hit = gate_hit(trigger, &s.lastTrig);
  const bool high = gate_on(trigger);

  if (gateMode) {
    if (high) {
      if (s.stage == kStageRest || s.stage == kStageRelease) {
        s.stage = kStageAttack;
        s.dipTarget = target;
      }
    } else if (s.stage == kStageAttack || s.stage == kStageHold) {
      if (holdSamples > 0.0) {
        s.stage = kStageHold;
        s.holdLeft = holdSamples;
      } else {
        s.stage = kStageRelease;
      }
    }
  } else if (hit) {
    s.stage = kStageAttack;
    s.dipTarget = target;
    s.holdLeft = holdSamples;
  }

  if (s.stage == kStageAttack) {
    s.dipTarget = target;
    s.gain = step_gain(s.gain, target, s.dipTarget, attackMs, releaseMs, sr, lawI, true);
    const bool arrived = s.gain <= target + 1.0e-4;
    if (arrived) {
      s.gain = target;
      if (gateMode && high) {
        s.stage = kStageHold;
      } else if (holdSamples > 0.0) {
        s.stage = kStageHold;
        s.holdLeft = holdSamples;
      } else {
        s.stage = kStageRelease;
      }
    }
  } else if (s.stage == kStageHold) {
    s.gain = s.dipTarget;
    if (gateMode && high) {
      s.holdLeft = holdSamples;
    } else {
      s.holdLeft -= 1.0;
      if (s.holdLeft <= 0.0) s.stage = kStageRelease;
    }
  } else if (s.stage == kStageRelease) {
    s.gain = step_gain(s.gain, 1.0, s.dipTarget, attackMs, releaseMs, sr, lawI, false);
    if (s.gain >= 1.0 - 1.0e-4) {
      s.gain = 1.0;
      s.stage = kStageRest;
    }
  } else {
    s.gain = 1.0;
  }

  const double makeupLin = soemdsp::math::db_to_amp(makeupDb);
  const double m = clamp_mix01(mix);
  const double wet = s.gain * makeupLin;
  const double scale = (1.0 - m) + m * wet;
  const double yL = inL * scale;
  const double yR = inR * scale;
  s.lastLeft = yL;
  s.lastRight = yR;
  s.lastGain = s.gain;
  double env = 1.0 - s.gain;
  if (env < 0.0) env = 0.0;
  if (env > 1.0) env = 1.0;
  s.lastEnv = env;
  return yL;
}

extern "C" double soemdsp_pump_curve_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastRight;
}

extern "C" double soemdsp_pump_curve_gain(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 1.0;
  return gPool[handle - 1].lastGain;
}

extern "C" double soemdsp_pump_curve_env(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastEnv;
}

extern "C" int soemdsp_pump_curve_version() {
  return 1;
}
