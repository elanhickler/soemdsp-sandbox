// soemdsp-native-module: amp_db
// soemdsp-native-label: Amp ↔ dB
// soemdsp-native-target: ampDb
// soemdsp-native-kind: utility
//
// Amplitude (linear voltage gain) ↔ decibels. 20·log10 law.
// 0 dB = 1. Floor matches exp_log.h (≤ −140 dB → 0; non-positive lin → −120 dB).
// Mode 0: dB→Amp. Mode 1: Amp→dB.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const char kMetadataJson[] =
  "{"
    "\"module\":\"amp_db\","
    "\"label\":\"Amp \\u2194 dB\","
    "\"targetType\":\"ampDb\","
    "\"kind\":\"utility\","
    "\"inputs\":[\"In\"],"
    "\"outputs\":[\"Out\"]"
  "}";

}  // namespace

extern "C" double soemdsp_amp_db_sample(double input, double mode) {
  const double in = safe(input);
  // Amp->dB reads |amp| so bipolar audio gives its level, not the -120 floor.
  // Silence floor: |amp| <= 1e-6 (-120 dB) -> -120, same as amp_to_db(0).
  if (safe(mode) >= 0.5) {
    const double mag = in < 0.0 ? -in : in;
    return mag <= 1e-6 ? -120.0 : amp_to_db(mag);
  }
  return db_to_amp(in);
}

extern "C" int soemdsp_amp_db_version() {
  return 2;
}

extern "C" const char* soemdsp_amp_db_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_amp_db_metadata_json_size() {
  return (int)(sizeof(kMetadataJson) - 1);
}
