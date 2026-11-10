// soemdsp-native-module: tilt_filter
// soemdsp-native-label: Tilt Filter
// soemdsp-native-target: tiltFilter
// soemdsp-native-kind: filter
//
// Constant-slope spectral tilt around a pivot (shared spectral_tilt header).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/spectral_tilt.h>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 256;

struct TiltState {
  bool active;
  spectral_tilt::State filter;
  spectral_tilt::Channel channel;
};

static TiltState gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"tilt_filter\","
    "\"label\":\"Tilt Filter\","
    "\"targetType\":\"tiltFilter\","
    "\"kind\":\"filter\""
  "}";

}  // namespace

extern "C" int soemdsp_tilt_filter_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      TiltState& s = gPool[i];
      spectral_tilt::clear(&s.filter);
      spectral_tilt::clear_channel(&s.channel);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_tilt_filter_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_tilt_filter_sample(
  int handle,
  double input,
  double pivotHz,
  double slopeDbOct,
  double sampleRate,
  double levelMode
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  TiltState& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  spectral_tilt::update(
    &s.filter,
    pivotHz,
    slopeDbOct,
    sampleRate,
    spectral_tilt::kStylePivot,
    (int)(levelMode + (levelMode >= 0.0 ? 0.5 : -0.5))
  );
  return spectral_tilt::process(&s.filter, &s.channel, safe(input));
}

extern "C" int soemdsp_tilt_filter_version() { return 1; }
extern "C" const char* soemdsp_tilt_filter_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_tilt_filter_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
