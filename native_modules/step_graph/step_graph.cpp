// soemdsp-native-module: step_graph
// soemdsp-native-label: Step Graph
// soemdsp-native-target: stepGraph
// soemdsp-native-kind: modulator
//
// Per-segment curve evaluator for Step Graph (NOT soemdsp/utility/graph.h).
// Ports graphSegmentValue shapes from node-live-audio-worklet-graph.js.
// Drive (Input/LFO/Phasor) lives in graph_engine process_step_graph.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;
static const int kMaxPoints = 32;

enum SegShape {
  kShapeLinear = soemdsp::math::kSegmentLinear,
  kShapeRational = soemdsp::math::kSegmentRational,
  kShapeExponential = soemdsp::math::kSegmentExponential,
  kShapeLog = soemdsp::math::kSegmentLog,
  kShapeSmoothstep = soemdsp::math::kSegmentSmoothstep,
  kShapeSmootherstep = soemdsp::math::kSegmentSmootherstep,
  kShapeHold = soemdsp::math::kSegmentHold,
};

struct Point {
  float x;
  float y;
  float c;
  float shape; // float-stored enum for SoA upload symmetry
};

struct State {
  bool active;
  Point points[kMaxPoints];
  int count;
};

static State gPool[kMaxInstances];
static float gSoaX[kMaxInstances][kMaxPoints];
static float gSoaY[kMaxInstances][kMaxPoints];
static float gSoaC[kMaxInstances][kMaxPoints];
static float gSoaShape[kMaxInstances][kMaxPoints];

static int normalize_shape(double shapeV) {
  return segment_shape_normalize(shapeV);
}

static void ensure_sorted(State& st) {
  for (int i = 1; i < st.count; i++) {
    Point key = st.points[i];
    int j = i - 1;
    while (j >= 0 && st.points[j].x > key.x) {
      st.points[j + 1] = st.points[j];
      j -= 1;
    }
    st.points[j + 1] = key;
  }
}

static void ensure_default_ramp(State& st) {
  if (st.count >= 2) return;
  st.points[0] = { 0.0f, 0.0f, 0.0f, (float)kShapeLinear };
  st.points[1] = { 1.0f, 1.0f, 0.0f, (float)kShapeLinear };
  st.count = 2;
}

// Segment kernels live in soemdsp/math/segment_curves.h (JS twin:
// public/node-graph-segment-curves.js).

static double segment_value(
  const State& st,
  double x,
  int index,
  int globalShape,
  double curveOffset
) {
  const Point& left = st.points[index];
  const Point& right = st.points[index + 1];
  const double dx = (double)right.x - (double)left.x;
  if (dsp_fabs(dx) < 1.0e-6) return 0.5 * ((double)left.y + (double)right.y);
  const double p = clamp((x - (double)left.x) / dx, 0.0, 1.0);
  const double offset = clamp11(safe(curveOffset));
  const double contour = clamp11(safe((double)right.c) + offset);
  // Global Shape param always wins (matches graphSegmentOptionsForNode).
  const int shape = globalShape;

  const double shaped = segment_curve01(p, shape, contour);
  return (double)left.y + ((double)right.y - (double)left.y) * shaped;
}

static double eval_at(const State& st, double x, int shape, double curveOffset) {
  if (st.count < 1) return 0.0;
  if (x < (double)st.points[0].x) return (double)st.points[0].y;
  if (x > (double)st.points[st.count - 1].x) {
    return (double)st.points[st.count - 1].y;
  }
  for (int i = 0; i < st.count - 1; i++) {
    if (x <= (double)st.points[i + 1].x) {
      return safe(segment_value(st, x, i, shape, curveOffset));
    }
  }
  return (double)st.points[st.count - 1].y;
}

}  // namespace

extern "C" int soemdsp_step_graph_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.count = 0;
      ensure_default_ramp(s);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_step_graph_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" int soemdsp_step_graph_max_points() {
  return kMaxPoints;
}

extern "C" int soemdsp_step_graph_points_x_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return (int)(long long)gSoaX[handle - 1];
}

extern "C" int soemdsp_step_graph_points_y_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return (int)(long long)gSoaY[handle - 1];
}

extern "C" int soemdsp_step_graph_points_c_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return (int)(long long)gSoaC[handle - 1];
}

extern "C" int soemdsp_step_graph_points_shape_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return (int)(long long)gSoaShape[handle - 1];
}

extern "C" int soemdsp_step_graph_set_points(int handle, int count) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  State& s = gPool[handle - 1];
  if (count < 0 || count > kMaxPoints) {
    s.count = 0;
    ensure_default_ramp(s);
    return 0;
  }
  if (count < 2) {
    s.count = 0;
    ensure_default_ramp(s);
    return 1;
  }
  for (int i = 0; i < count; i++) {
    s.points[i].x = gSoaX[handle - 1][i];
    s.points[i].y = gSoaY[handle - 1][i];
    s.points[i].c = gSoaC[handle - 1][i];
    s.points[i].shape = gSoaShape[handle - 1][i];
  }
  s.count = count;
  ensure_sorted(s);
  return 1;
}

extern "C" void soemdsp_step_graph_clear_points(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].count = 0;
  ensure_default_ramp(gPool[handle - 1]);
}

extern "C" double soemdsp_step_graph_sample(
  int handle,
  double x,
  double segmentShape,
  double curveOffset
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  State& s = gPool[handle - 1];
  ensure_default_ramp(s);
  return clamp11(eval_at(s, safe(x), normalize_shape(segmentShape), safe(curveOffset)));
}

extern "C" int soemdsp_step_graph_version() {
  return 2;
}
