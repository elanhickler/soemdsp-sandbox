// soemdsp-native-module: amp_curve
// soemdsp-native-label: Amp Curve
// soemdsp-native-target: ampCurve
// soemdsp-native-kind: dynamics
//
// Map a unipolar envelope through the shared Step Graph segment curves
// (library/include/soemdsp/math/segment_curves.h). Env is clamped 0..1.
//
//   Out = segment_curve01(clamp01(Env), shape, skew)
//
// Shapes share Step Graph ids: Linear=0, Rational=1, Exponential=2, Log=3,
// Smoothstep=4, Smootherstep=5. Amp Curve offers those six (Hold stays in
// the shared library / Step Graph only). Skew is -1..+1; 0 is identity for
// Linear / Rational / Exponential / Log, the standard S-curve for
// Smoothstep / Smootherstep.
//
// Default Exponential + kClassicVcaSkew reproduces the old Exp VCA law
// 10^(5*(x-1)) within ~1e-5 (the old -100 dB floor vs exact 0).

#include <stdint.h>

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/math/segment_curves.h>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;
static const int kMaxBlockFrames = 128;
// mag = 5*ln(10) through 1.2 + 6.8*(a/(1-0.85 a)) → a.
static const double kClassicVcaSkew = -0.6625295074459036;

struct State {
  bool active;
  double shape; // segment_shape id
  double skew;  // -1..+1
  double blockIn[kMaxBlockFrames];
  double blockOut[kMaxBlockFrames];
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"amp_curve\","
    "\"label\":\"Amp Curve\","
    "\"targetType\":\"ampCurve\","
    "\"kind\":\"dynamics\","
    "\"inputs\":[\"Env\"],"
    "\"outputs\":[\"Curve\"],"
    "\"parameters\":["
      "{"
        "\"key\":\"shape\","
        "\"label\":\"Shape\","
        "\"kind\":\"choice\","
        "\"choices\":[\"Linear\",\"Rational\",\"Exponential\",\"Log\",\"Smoothstep\",\"Smootherstep\"],"
        "\"choiceIds\":[0,1,2,3,4,5],"
        "\"defaultValue\":\"Exponential\""
      "},"
      "{"
        "\"key\":\"skew\","
        "\"label\":\"Skew\","
        "\"defaultValue\":-0.6625295074459036,"
        "\"min\":-1,"
        "\"mid\":0,"
        "\"max\":1"
      "}"
    "]"
  "}";

static double map_curve(double input, double shape, double skew) {
  return segment_curve01(safe(input), segment_shape_normalize(shape), safe(skew));
}

}  // namespace

extern "C" int soemdsp_amp_curve_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.active = true;
      s.shape = (double)kSegmentExponential;
      s.skew = kClassicVcaSkew;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_amp_curve_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_amp_curve_set_params(int handle, double shape, double skew) {
  if (handle < 1 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (!s.active) return;
  s.shape = safe(shape);
  s.skew = safe(skew);
}

extern "C" double soemdsp_amp_curve_sample(double input, double shape, double skew) {
  return map_curve(input, shape, skew);
}

extern "C" void soemdsp_amp_curve_process_block(int handle, int frameCount) {
  if (handle < 1 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (!s.active) return;
  const int n = frameCount < 1 ? 1 : (frameCount > kMaxBlockFrames ? kMaxBlockFrames : frameCount);
  const int shapeId = segment_shape_normalize(s.shape);
  const double skew = safe(s.skew);
  for (int i = 0; i < n; i++) {
    s.blockOut[i] = segment_curve01(safe(s.blockIn[i]), shapeId, skew);
  }
}

extern "C" intptr_t soemdsp_amp_curve_block_input_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return reinterpret_cast<intptr_t>(gPool[handle - 1].blockIn);
}

extern "C" intptr_t soemdsp_amp_curve_block_output_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return reinterpret_cast<intptr_t>(gPool[handle - 1].blockOut);
}

extern "C" int soemdsp_amp_curve_max_block_frames() {
  return kMaxBlockFrames;
}

extern "C" int soemdsp_amp_curve_version() {
  return 5; // 5: Shape list drops Hold (ids 0–5 unchanged). 4: Step Graph shapes + Skew. 3: Env→Curve gold CV jacks (Mode only)
}

extern "C" const char* soemdsp_amp_curve_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_amp_curve_metadata_json_size() {
  return sizeof(kMetadataJson) - 1;
}
