// soemdsp-native-module: edge_detector
// soemdsp-native-label: Edge Detector
// soemdsp-native-target: edgeDetector
// soemdsp-native-kind: analysis

// A scope-style Schmitt trigger and interval tracker. This intentionally
// measures edge repetition, not the fundamental of arbitrary/polyphonic audio.
#include <soemdsp/soemdsp.hpp>

namespace {
constexpr int kMaxInstances = 32;
constexpr int kIntervals = 7;

struct EdgeState {
  bool active;
  bool armed;
  double sampleRate;
  double clock;
  double previous;
  double low;
  double high;
  double lastEdge;
  double intervals[kIntervals];
  int intervalCount;
  int intervalWrite;
  double period;
  double frequency;
  double confidence;
  double edge;

  void reset(double sr) {
    active = true;
    armed = false;
    sampleRate = sr > 0.0 ? sr : 44100.0;
    clock = 0.0;
    previous = low = high = lastEdge = 0.0;
    intervalCount = intervalWrite = 0;
    period = frequency = confidence = edge = 0.0;
    for (int i = 0; i < kIntervals; ++i) intervals[i] = 0.0;
  }
};

EdgeState pool[kMaxInstances] = {};

EdgeState* state(int handle) {
  if (handle < 1 || handle > kMaxInstances) return nullptr;
  EdgeState* s = &pool[handle - 1];
  return s->active ? s : nullptr;
}

double median(const EdgeState& s) {
  double sorted[kIntervals];
  for (int i = 0; i < s.intervalCount; ++i) sorted[i] = s.intervals[i];
  for (int i = 1; i < s.intervalCount; ++i) {
    const double value = sorted[i];
    int j = i;
    while (j > 0 && sorted[j - 1] > value) {
      sorted[j] = sorted[j - 1];
      --j;
    }
    sorted[j] = value;
  }
  return s.intervalCount ? sorted[s.intervalCount / 2] : 0.0;
}
}

extern "C" int soemdsp_edge_detector_version() { return 1; }

extern "C" int soemdsp_edge_detector_create(double sampleRate) {
  for (int i = 0; i < kMaxInstances; ++i) {
    if (!pool[i].active) {
      pool[i].reset(sampleRate);
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_edge_detector_destroy(int handle) {
  EdgeState* s = state(handle);
  if (s) s->active = false;
}

extern "C" void soemdsp_edge_detector_process(int handle, double input) {
  EdgeState* s = state(handle);
  if (!s) return;
  s->edge = 0.0;
  if (!(input == input) || input < -1.0e12 || input > 1.0e12) input = 0.0;
  const double relax = 1.0 / (s->sampleRate * 0.05);
  s->low += (input - s->low) * relax;
  s->high += (input - s->high) * relax;
  if (input < s->low) s->low = input;
  if (input > s->high) s->high = input;
  const double span = s->high - s->low;
  const double level = (s->high + s->low) * 0.5;
  const double hyst = span * 0.04;
  if (span < 1.0e-4) {
    s->armed = false;
    s->frequency = s->confidence = 0.0;
  } else {
    if (input <= level - hyst) s->armed = true;
    if (s->armed && s->previous <= level && input > level) {
      s->armed = false;
      s->edge = 1.0;
      const double delta = input - s->previous;
      const double crossing = s->clock - 1.0 + (delta > 0.0 ? (level - s->previous) / delta : 1.0);
      const double interval = crossing - s->lastEdge;
      if (s->lastEdge > 0.0 && interval >= 2.0 && interval <= s->sampleRate / 20.0) {
        s->intervals[s->intervalWrite] = interval;
        s->intervalWrite = (s->intervalWrite + 1) % kIntervals;
        if (s->intervalCount < kIntervals) ++s->intervalCount;
        const double measured = median(*s);
        if (!(s->period > 0.0) ||
            measured > s->period * 1.03 || measured < s->period * 0.97) {
          s->period = measured;
        } else {
          s->period += (measured - s->period) * 0.15;
        }
        double deviation = 0.0;
        for (int i = 0; i < s->intervalCount; ++i) {
          const double d = s->intervals[i] - measured;
          deviation += d < 0.0 ? -d : d;
        }
        const double relative = deviation / (s->intervalCount * measured);
        s->confidence = relative >= 0.25 ? 0.0 : 1.0 - relative * 4.0;
        s->frequency = s->sampleRate / s->period;
      }
      s->lastEdge = crossing;
    }
    if (s->period > 0.0 && s->clock - s->lastEdge > s->period * 2.5) {
      s->frequency = s->confidence = 0.0;
    }
  }
  s->previous = input;
  s->clock += 1.0;
}

extern "C" double soemdsp_edge_detector_frequency(int handle) {
  const EdgeState* s = state(handle);
  return s ? s->frequency : 0.0;
}
extern "C" double soemdsp_edge_detector_confidence(int handle) {
  const EdgeState* s = state(handle);
  return s ? s->confidence : 0.0;
}
extern "C" double soemdsp_edge_detector_edge(int handle) {
  const EdgeState* s = state(handle);
  return s ? s->edge : 0.0;
}
