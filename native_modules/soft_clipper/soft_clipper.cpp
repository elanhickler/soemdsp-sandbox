// soemdsp-native-module: soft_clipper
// soemdsp-native-label: Soft Clipper
// soemdsp-native-target: softClipper
// soemdsp-native-kind: dynamics
// soemdsp-native-lib: https://github.com/soundemote/soemdsp/blob/main/include/soemdsp/dynamics/SoftClipper.hpp
//
// Memoryless saturating soft-knee. Params (linear, no dB):
//   Drive - input push into the curve
//   Threshold - 0...1 amplitude where limiting starts (dry below)
//   Knee - 0...1 how gradual the thr->ceiling transition is
//   Amplitude - 0...1 output scale after shaping
// Shape uses soemdsp::math::soft_clip_coeffs / soft_clip_apply / tanh_approx.
// AA switch: Off, ADAA1, ADAA2. ADAA state is per channel on the instance.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 32;
static const int kChannels = 3; // 0 mono, 1 left, 2 right
static const int kMaxBlockFrames = 128;
static const double kKneeEps = 1.0e-4;

struct State {
  bool active;
  bool coeffsValid;
  double lastThreshold;
  double lastKnee;
  double scaleX;
  double shiftX;
  double scaleY;
  double shiftY;
  double span;
  double liveDrive;
  double liveThreshold;
  double liveKnee;
  double liveAmplitude;
  double blockIn[kChannels][kMaxBlockFrames];
  double blockOut[kChannels][kMaxBlockFrames];
  double aaX1[kChannels];
  double aaX2[kChannels];
};

static State gPool[kMaxInstances];

// Remap Threshold/Knee -> soft_clip_coeffs width, then rescale so ceiling stays
// at thr + (1-thr) = 1 (when thr < 1). Knee->0 is hard clip at threshold.
static void sync_knee_coeffs(State& s, double threshold, double knee) {
  if (s.coeffsValid && threshold == s.lastThreshold && knee == s.lastKnee) return;
  double thr = threshold;
  if (!(thr * 0.0 == 0.0) || thr < 0.0) thr = 0.0;
  if (thr > 1.0) thr = 1.0;
  double kn = knee;
  if (!(kn * 0.0 == 0.0) || kn < 0.0) kn = 0.0;
  if (kn > 1.0) kn = 1.0;
  const double headroom = 1.0 - thr;
  const double span = headroom > 1.0e-6 ? headroom : 1.0e-6;
  const double knSafe = kn < kKneeEps ? kKneeEps : kn;
  const double width = 2.0 * span * knSafe;
  soft_clip_coeffs(0.0, width, &s.scaleX, &s.shiftX, &s.scaleY, &s.shiftY);
  s.span = span;
  s.lastThreshold = thr;
  s.lastKnee = kn;
  s.coeffsValid = true;
}

static double shape_one(State& s, double input) {
  double drive = s.liveDrive;
  if (!(drive * 0.0 == 0.0) || drive < 0.0) drive = 0.0;
  double thr = s.liveThreshold;
  if (!(thr * 0.0 == 0.0) || thr < 0.0) thr = 0.0;
  if (thr > 1.0) thr = 1.0;
  double kn = s.liveKnee;
  if (!(kn * 0.0 == 0.0) || kn < 0.0) kn = 0.0;
  if (kn > 1.0) kn = 1.0;
  double amp = s.liveAmplitude;
  if (!(amp * 0.0 == 0.0) || amp < 0.0) amp = 0.0;
  if (amp > 1.0) amp = 1.0;

  const double x = safe(input) * drive;
  const double ax = dsp_fabs(x);
  const double sign = x < 0.0 ? -1.0 : 1.0;

  if (ax <= thr) {
    return amp * x;
  }
  if (kn <= kKneeEps) {
    return amp * sign * thr;
  }

  sync_knee_coeffs(s, thr, kn);
  const double excess = ax - thr;
  const double y = soft_clip_apply(excess, s.scaleX, s.shiftX, s.scaleY, s.shiftY);
  const double sy = s.scaleY;
  const double shaped = (sy > 1.0e-12) ? (y * (s.span / sy)) : 0.0;
  return amp * sign * (thr + shaped);
}

static double shape_stateless(double input, double drive, double threshold, double knee, double amplitude) {
  State tmp;
  tmp.coeffsValid = false;
  tmp.lastThreshold = -1.0;
  tmp.lastKnee = -1.0;
  tmp.liveDrive = drive;
  tmp.liveThreshold = threshold;
  tmp.liveKnee = knee;
  tmp.liveAmplitude = amplitude;
  return shape_one(tmp, input);
}

// Antiderivatives of the odd shaper s(v), v = drive * input, before Amplitude.
// S is even and S(0) = 0. P is odd and P(0) = 0.
static void shaper_integrals(double v, double thr, double knee, double span,
                              double* sOut, double* SOut, double* POut) {
  const double av = dsp_fabs(v);
  const double sign = v < 0.0 ? -1.0 : 1.0;
  double sPos, SPos, PPos;
  const double w = span * knee;
  if (av <= thr) {
    sPos = av;
    SPos = 0.5 * av * av;
    PPos = av * av * av / 6.0;
  } else if (knee <= kKneeEps || w < 1.0e-8) {
    sPos = thr;
    SPos = thr * av - 0.5 * thr * thr;
    PPos = 0.5 * thr * av * av - 0.5 * thr * thr * av + thr * thr * thr / 6.0;
  } else {
    const double d = av - thr;
    const double z = d / w;
    const double h = soemdsp::math::hypot1(z);
    const double G = 0.5 * (z * h + dsp_ln(z + h));
    sPos = thr + span * (z / h);
    SPos = thr * d + 0.5 * thr * thr + span * w * (h - 1.0);
    PPos = 0.5 * thr * d * d
         + 0.5 * thr * thr * av
         + span * w * w * G
         - span * w * d
         - thr * thr * thr / 3.0;
  }
  *sOut = sign * sPos;
  *SOut = SPos;
  *POut = sign * PPos;
}

static void clip_levels(const State& s, double* drive, double* thr, double* knee, double* amp) {
  double d = s.liveDrive;
  if (!(d * 0.0 == 0.0) || d < 0.0) d = 0.0;
  double t = s.liveThreshold;
  if (!(t * 0.0 == 0.0) || t < 0.0) t = 0.0;
  if (t > 1.0) t = 1.0;
  double k = s.liveKnee;
  if (!(k * 0.0 == 0.0) || k < 0.0) k = 0.0;
  if (k > 1.0) k = 1.0;
  double a = s.liveAmplitude;
  if (!(a * 0.0 == 0.0) || a < 0.0) a = 0.0;
  if (a > 1.0) a = 1.0;
  *drive = d;
  *thr = t;
  *knee = k;
  *amp = a;
}

// g, first antiderivative, second antiderivative, in the raw-input coordinate.
static void clip_antideriv(State& s, double u, double* g, double* G1, double* G2) {
  double drive, thr, knee, amp;
  clip_levels(s, &drive, &thr, &knee, &amp);
  const double headroom = 1.0 - thr;
  const double span = headroom > 1.0e-6 ? headroom : 1.0e-6;
  double sv, Sv, Pv;
  shaper_integrals(drive * u, thr, knee, span, &sv, &Sv, &Pv);
  *g = amp * sv;
  if (drive < 1.0e-8) {
    *G1 = 0.0;
    *G2 = 0.0;
    return;
  }
  *G1 = (amp / drive) * Sv;
  *G2 = (amp / (drive * drive)) * Pv;
}

static const double kAaTol = 1.0e-5;

static double adaa1_from(State& s, double x, double x1) {
  double g, G1, G2, g1, G11, G21;
  clip_antideriv(s, x, &g, &G1, &G2);
  const double d = x - x1;
  if (dsp_fabs(d) < kAaTol) return g;
  clip_antideriv(s, x1, &g1, &G11, &G21);
  return (G1 - G11) / d;
}

// (F2(a) - F2(b)) / (a - b). Midpoint F1 when a and b sit together.
static double adaa2_span(State& s, double a, double b) {
  const double d = a - b;
  double ga, G1a, G2a, gb, G1b, G2b;
  if (dsp_fabs(d) < kAaTol) {
    clip_antideriv(s, 0.5 * (a + b), &ga, &G1a, &G2a);
    return G1a;
  }
  clip_antideriv(s, a, &ga, &G1a, &G2a);
  clip_antideriv(s, b, &gb, &G1b, &G2b);
  return (G2a - G2b) / d;
}

// Current sample sits on the previous one. Compare it with the sample before that.
static double adaa2_fallback(State& s, double x, double x2) {
  const double xBar = 0.5 * (x + x2);
  const double delta = xBar - x;
  double g, G1, G2, gBar, G1Bar, G2Bar;
  if (dsp_fabs(delta) < kAaTol) {
    clip_antideriv(s, 0.5 * (xBar + x), &g, &G1, &G2);
    return g;
  }
  clip_antideriv(s, x, &g, &G1, &G2);
  clip_antideriv(s, xBar, &gBar, &G1Bar, &G2Bar);
  return (2.0 / delta) * (G1Bar + (G2 - G2Bar) / delta);
}

static double adaa2_from(State& s, double x, double x1, double x2) {
  const double d1 = x - x1;
  if (dsp_fabs(d1) < kAaTol) return adaa2_fallback(s, x, x2);
  const double dSpan = x - x2;
  if (dsp_fabs(dSpan) < kAaTol) return adaa1_from(s, x, x1);
  return (2.0 / dSpan) * (adaa2_span(s, x, x1) - adaa2_span(s, x1, x2));
}

static double shape_aa(State& s, int channel, double input, int mode) {
  int ch = channel;
  if (ch < 0) ch = 0;
  if (ch > 2) ch = 2;
  const double x = safe(input);
  double y;
  if (mode <= 0) y = shape_one(s, x);
  else if (mode == 1) y = adaa1_from(s, x, s.aaX1[ch]);
  else y = adaa2_from(s, x, s.aaX1[ch], s.aaX2[ch]);
  s.aaX2[ch] = s.aaX1[ch];
  s.aaX1[ch] = x;
  return y;
}

static const char kMetadataJson[] =
  "{"
    "\"module\":\"soft_clipper\","
    "\"label\":\"Soft Clipper\","
    "\"targetType\":\"softClipper\","
    "\"kind\":\"dynamics\","
    "\"inputs\":[\"Mono\",\"Left\",\"Right\"],"
    "\"outputs\":[\"Mono\",\"Left\",\"Right\"],"
    "\"parameters\":["
      "{"
        "\"key\":\"drive\","
        "\"label\":\"Drive\","
        "\"defaultValue\":0.5,"
        "\"min\":0,\"mid\":1,\"max\":8,\"step\":\"any\","
        "\"tooltip\":\"Input push into the soft-knee curve.\""
      "},"
      "{"
        "\"key\":\"threshold\","
        "\"label\":\"Threshold\","
        "\"defaultValue\":0,"
        "\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\","
        "\"tooltip\":\"Amplitude (0...1) where limiting starts. Below this the driven signal is unchanged.\""
      "},"
      "{"
        "\"key\":\"knee\","
        "\"label\":\"Knee\","
        "\"defaultValue\":1,"
        "\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\","
        "\"tooltip\":\"How gradual the transition from Threshold toward full scale is. 0 = hard at Threshold.\""
      "},"
      "{"
        "\"key\":\"amplitude\","
        "\"label\":\"Amplitude\","
        "\"defaultValue\":1,"
        "\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\","
        "\"tooltip\":\"Output scale after shaping.\""
      "}"
    "]"
  "}";

}  // namespace

extern "C" double soemdsp_soft_clipper_sample(
  double input,
  double drive,
  double threshold,
  double knee,
  double amplitude
) {
  return shape_stateless(input, drive, threshold, knee, amplitude);
}

// mode: 0 Off, 1 ADAA1, 2 ADAA2. channel: 0 mono, 1 left, 2 right.
extern "C" double soemdsp_soft_clipper_sample_aa(
  int handle,
  int channel,
  double input,
  double drive,
  double threshold,
  double knee,
  double amplitude,
  int mode
) {
  if (handle < 1 || handle > kMaxInstances) {
    return shape_stateless(input, drive, threshold, knee, amplitude);
  }
  State& s = gPool[handle - 1];
  s.liveDrive = drive;
  s.liveThreshold = threshold;
  s.liveKnee = knee;
  s.liveAmplitude = amplitude;
  return shape_aa(s, channel, input, mode);
}

extern "C" int soemdsp_soft_clipper_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.coeffsValid = false;
      s.lastThreshold = -1.0;
      s.lastKnee = -1.0;
      s.liveDrive = 0.5;
      s.liveThreshold = 0.0;
      s.liveKnee = 1.0;
      s.liveAmplitude = 1.0;
      s.span = 1.0;
      s.scaleX = 1.0;
      s.shiftX = 0.0;
      s.scaleY = 1.0;
      s.shiftY = 0.0;
      for (int c = 0; c < kChannels; c++) {
        s.aaX1[c] = 0.0;
        s.aaX2[c] = 0.0;
      }
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_soft_clipper_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_soft_clipper_set_params(
  int handle,
  double drive,
  double threshold,
  double knee,
  double amplitude
) {
  if (handle < 1 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  double d = drive;
  if (!(d * 0.0 == 0.0) || d < 0.0) d = 0.0;
  double thr = threshold;
  if (!(thr * 0.0 == 0.0) || thr < 0.0) thr = 0.0;
  if (thr > 1.0) thr = 1.0;
  double kn = knee;
  if (!(kn * 0.0 == 0.0) || kn < 0.0) kn = 0.0;
  if (kn > 1.0) kn = 1.0;
  double amp = amplitude;
  if (!(amp * 0.0 == 0.0) || amp < 0.0) amp = 0.0;
  if (amp > 1.0) amp = 1.0;
  s.liveDrive = d;
  s.liveThreshold = thr;
  s.liveKnee = kn;
  s.liveAmplitude = amp;
  sync_knee_coeffs(s, thr, kn);
}

extern "C" void soemdsp_soft_clipper_process_block(int handle, int channel, int frameCount) {
  if (handle < 1 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (!s.active) return;
  int ch = channel;
  if (ch < 0) ch = 0;
  if (ch > 2) ch = 2;
  const int n = frameCount < 1 ? 1 : (frameCount > kMaxBlockFrames ? kMaxBlockFrames : frameCount);
  sync_knee_coeffs(s, s.liveThreshold, s.liveKnee);
  for (int i = 0; i < n; i += 1) {
    s.blockOut[ch][i] = shape_one(s, s.blockIn[ch][i]);
  }
}

extern "C" int soemdsp_soft_clipper_block_input_ptr(int handle, int channel) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  int ch = channel < 0 ? 0 : (channel > 2 ? 2 : channel);
  return reinterpret_cast<int>(gPool[handle - 1].blockIn[ch]);
}

extern "C" int soemdsp_soft_clipper_block_output_ptr(int handle, int channel) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  int ch = channel < 0 ? 0 : (channel > 2 ? 2 : channel);
  return reinterpret_cast<int>(gPool[handle - 1].blockOut[ch]);
}

extern "C" int soemdsp_soft_clipper_max_block_frames() {
  return kMaxBlockFrames;
}

extern "C" int soemdsp_soft_clipper_version() { return 5; }
extern "C" const char* soemdsp_soft_clipper_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_soft_clipper_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
