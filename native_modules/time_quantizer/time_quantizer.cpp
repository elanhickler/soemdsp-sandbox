// soemdsp-native-module: time_quantizer
// soemdsp-native-label: Time Quantizer
// soemdsp-native-target: timeQuantizer
// soemdsp-native-kind: utility
//
// Time Quantizer: holds Out and only lets changes of In through on the
// project-tempo grid (Circuit::hostTempoBpm, master playhead masterSamples).
// Grid: one line per Division (1/1 .. 1/32 of a whole note) x Timing
// (Normal / Dotted 1.5 / Triplet 2/3). Same sync anchoring as Metronome Sync:
// lines start at master sample 0; a tempo / division change re-anchors at the
// current sample so the line count stays continuous; a rewind re-grids at 0.
// On the exact sample a grid line is crossed: if |In - Out| > Change Threshold,
// Out = In (the latest value) and Trigger = 1 for that sample. No change since
// the last line: the line does nothing. Gates: rising and falling edges are
// both changes, so both land on grid lines.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;

struct State {
  bool active;
  bool anchored;
  double anchorSample;
  double anchorLines;
  double anchorPeriod;   // samples per grid line at the anchor
  long long lastLine;
  double out;
  double trigger;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"time_quantizer\","
    "\"label\":\"Time Quantizer\","
    "\"targetType\":\"timeQuantizer\","
    "\"kind\":\"utility\","
    "\"inputs\":[\"In\"],"
    "\"outputs\":[\"Out\",\"Trigger\"]"
  "}";

// Division choiceIds 0..5 = 1/1, 1/2, 1/4, 1/8, 1/16, 1/32 of a whole note.
static double division_whole_notes(double division) {
  int d = (int)(safe(division) + 0.5);
  if (d < 0) d = 0;      // index guard (unknown choice -> nearest), not a param clamp
  if (d > 5) d = 5;
  return 1.0 / (double)(1 << d);
}

static double timing_multiplier(double timing) {
  const int t = (int)(safe(timing) + 0.5);
  if (t == 1) return 1.5;        // Dotted
  if (t == 2) return 2.0 / 3.0;  // Triplet
  return 1.0;                    // Normal
}

}  // namespace

extern "C" int soemdsp_time_quantizer_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s = State{};
      s.lastLine = -1;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_time_quantizer_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// One sample. tempoBpm = project tempo (<= 1 -> 120). masterSample = playhead.
extern "C" double soemdsp_time_quantizer_sample(
  int handle,
  double in,
  double changeThreshold,
  double division,
  double timing,
  double tempoBpm,
  double sampleRate,
  double masterSample
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double rate = sampleRate > 1.0 ? sampleRate : 44100.0;
  const double bpm = tempoBpm > 1.0 ? tempoBpm : 120.0;
  // samples per line = (240 / bpm) s per whole note * fraction * timing * rate
  const double period = (240.0 / bpm) * division_whole_notes(division) * timing_multiplier(timing) * rate;
  const double master = masterSample > 0.0 ? masterSample : 0.0;

  if (!s.anchored || master < s.anchorSample) {
    s.anchored = true;
    s.anchorSample = 0.0;
    s.anchorLines = 0.0;
    s.anchorPeriod = period;
    s.lastLine = -1;
  }
  if (period != s.anchorPeriod) {
    s.anchorLines += (master - s.anchorSample) / s.anchorPeriod;
    s.anchorSample = master;
    s.anchorPeriod = period;
  }
  const double lines = s.anchorLines + (master - s.anchorSample) / s.anchorPeriod;
  const long long line = (long long)dsp_floor(lines);

  s.trigger = 0.0;
  const double x = safe(in);
  if (line != s.lastLine) {
    s.lastLine = line;
    const double th = safe(changeThreshold);
    const double d = x - s.out;
    if ((d < 0.0 ? -d : d) > th) {
      s.out = x;
      s.trigger = 1.0;
    }
  }
  return s.out;
}

extern "C" double soemdsp_time_quantizer_trigger(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].trigger;
}

extern "C" int soemdsp_time_quantizer_version() { return 1; }
extern "C" const char* soemdsp_time_quantizer_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_time_quantizer_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
