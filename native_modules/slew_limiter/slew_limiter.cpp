// soemdsp-native-module: slew_limiter
// soemdsp-native-label: Slew Limiter
// soemdsp-native-target: slewLimiter
// soemdsp-native-kind: utility
//
// Mono rate limiter: one handle = one channel. Stereo patches use separate
// handles (or graph folds M/L/R). Up/Down times are seconds to reach the
// current target (amplitude-independent — not “per unit of 1”). Separate
// Up/Down Shape: 0 Lin / 1 Log / 2 Exp / 3 Smooth. Bias added before slew.
// First sample snaps to target.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 96;
static const int kMaxBlockFrames = 128;
static const double kCurveK = 3.5;
static const int kShapeLin = 0;
static const int kShapeLog = 1;
static const int kShapeExp = 2;
static const int kShapeSmooth = 3;

struct SlewLimiterState {
  bool active;
  bool initialized;
  bool slewActive;
  bool rising;
  double from;
  double out;
  double target;
  double progress;
  double blockIn[kMaxBlockFrames];
  double blockOut[kMaxBlockFrames];
};

static SlewLimiterState gPool[kMaxInstances];

static int normShape(double shape) {
  int n = (int)(safe(shape) + (safe(shape) >= 0.0 ? 0.5 : -0.5));
  if (n < kShapeLin) n = kShapeLin;
  if (n > kShapeSmooth) n = kShapeSmooth;
  return n;
}

static double powPos(double base, double expv) {
  if (base <= 0.0) return 0.0;
  return dsp_exp(expv * dsp_ln(base));
}

static double applyShape(double t, int shape) {
  const double x = t <= 0.0 ? 0.0 : (t >= 1.0 ? 1.0 : t);
  if (shape == kShapeLog) return 1.0 - powPos(1.0 - x, kCurveK);
  if (shape == kShapeExp) return powPos(x, kCurveK);
  if (shape == kShapeSmooth) return 0.5 - 0.5 * dsp_cos(kPi * x);
  return x;
}

static double chanSample(
  SlewLimiterState& s,
  double input,
  double upTime,
  double downTime,
  double sampleRate,
  int upShape,
  int downShape
) {
  const double rate = maxd(1.0, safe(sampleRate));
  const double target = safe(input);
  if (!s.initialized) {
    s.initialized = true;
    s.slewActive = false;
    s.from = target;
    s.out = target;
    s.target = target;
    s.progress = 1.0;
    s.rising = true;
    return target;
  }

  const double upSeconds = maxd(0.0, safe(upTime));
  const double downSeconds = maxd(0.0, safe(downTime));
  const double delta = target - s.out;
  if (dsp_fabs(delta) <= 1e-9) {
    s.slewActive = false;
    s.from = target;
    s.out = target;
    s.target = target;
    s.progress = 1.0;
    return target;
  }
  const bool rising = delta >= 0.0;
  const double seconds = rising ? upSeconds : downSeconds;
  if (seconds <= 0.0) {
    s.slewActive = false;
    s.from = target;
    s.out = target;
    s.target = target;
    s.progress = 1.0;
    s.rising = rising;
    return target;
  }

  const int shape = rising ? upShape : downShape;
  const bool targetMoved = dsp_fabs(target - s.target) > 1e-9;
  if (!s.slewActive || rising != s.rising || targetMoved) {
    s.from = s.out;
    s.target = target;
    s.rising = rising;
    s.slewActive = true;
    s.progress = 0.0;
  }
  const double span = s.target - s.from;
  if (!(span * 0.0 == 0.0) || dsp_fabs(span) < 1e-12) {
    s.slewActive = false;
    s.from = target;
    s.out = target;
    s.target = target;
    s.progress = 1.0;
    return target;
  }

  // Lin + curves share fixed glide time (seconds to target, any amplitude).
  // Track time directly. Reconstructing it from the shaped output stalls near
  // the flat ends of Exp/Smooth when adjacent samples round to one value.
  const double dt = 1.0 / maxd(1.0, seconds * rate);
  s.progress += dt;
  if (s.progress >= 1.0) {
    s.slewActive = false;
    s.from = s.target;
    s.out = s.target;
    s.progress = 1.0;
    return s.target;
  }
  const double shaped = clamp(applyShape(s.progress, shape), 0.0, 1.0);
  s.out = s.from + span * shaped;
  return s.out;
}

}  // namespace

extern "C" int soemdsp_slew_limiter_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      SlewLimiterState& s = gPool[i];
      s = SlewLimiterState{};
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_slew_limiter_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_slew_limiter_sample(
  int handle,
  double input,
  double upTime,
  double downTime,
  double sampleRate,
  double upShape,
  double downShape,
  double bias
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return chanSample(
    gPool[handle - 1],
    input + safe(bias),
    upTime,
    downTime,
    sampleRate,
    normShape(upShape),
    normShape(downShape)
  );
}

extern "C" void soemdsp_slew_limiter_process_block(
  int handle,
  double upTime,
  double downTime,
  double upShape,
  double downShape,
  double bias,
  double sampleRate,
  int frameCount
) {
  if (handle < 1 || handle > kMaxInstances) return;
  SlewLimiterState& s = gPool[handle - 1];
  const int n = frameCount < 1 ? 1 : (frameCount > kMaxBlockFrames ? kMaxBlockFrames : frameCount);
  const int upMode = normShape(upShape);
  const int downMode = normShape(downShape);
  const double off = safe(bias);
  for (int f = 0; f < n; f++) {
    s.blockOut[f] = chanSample(s, s.blockIn[f] + off, upTime, downTime, sampleRate, upMode, downMode);
  }
}

extern "C" int soemdsp_slew_limiter_block_input_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return reinterpret_cast<int>(gPool[handle - 1].blockIn);
}

extern "C" int soemdsp_slew_limiter_block_output_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return reinterpret_cast<int>(gPool[handle - 1].blockOut);
}

extern "C" int soemdsp_slew_limiter_max_block_frames() {
  return kMaxBlockFrames;
}

extern "C" int soemdsp_slew_limiter_version() {
  return 6; // explicit progress prevents Exp/Smooth endpoint stalls
}
