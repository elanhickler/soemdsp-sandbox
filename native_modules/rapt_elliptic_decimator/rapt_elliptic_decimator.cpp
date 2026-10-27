// soemdsp-native-module: rapt_elliptic_decimator
// soemdsp-native-label: Rapt Elliptic Decimator
// soemdsp-native-target: raptEllipticDecimator
// soemdsp-native-kind: utility
//
// Worklet oversampling downsample (graph-level OS x1 / x2 / x4). Each factor
// runs ONE 12th-order elliptic lowpass (6 SOS, DF2 transpose) at the engine
// rate and keeps every Nth sample. The cutoff is set relative to the rate the
// filter runs at, so each factor needs its own design:
//
//   x4: kSosQuarter, the Rapt elliptic quarter-band (same coeffs as the retired
//       JS processRaptEllipticDecimatorSample). -3 dB at 0.1135 x engine rate
//       = 0.454 x host rate (21.8 kHz at 48k), stopband (-77 dB) by the host
//       Nyquist. One pass at 4x is the whole job.
//   x2: kSosHalf, half-band: scipy ellip(12, 0.1 dB, 96 dB, 0.452). Passband
//       to 0.226 x engine rate = 0.452 x host rate (flat to ~21.7 kHz at 48k),
//       -98 dB at the host Nyquist.
//
// v2 ran the quarter-band filter for x2 and cascaded it twice for x4, which
// put the cutoff at ~0.227 x host rate (about 10.9 kHz at 48k): oversampling
// removed the top octave instead of opening it.

#include <stdint.h>

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 8;
static const int kSosCount = 6;
static const int kMaxHostFrames = 1024;
static const int kMaxEngineFrames = kMaxHostFrames * 4;

// [b0, b1, b2, a0 unused, a1, a2]; a0 is 1.
static const double kSosQuarter[kSosCount][6] = {
  { 1.3515101236634053e-04,  1.8481719657676747e-04, 1.3515101236634053e-04, 1.0, -1.5863119326809123, 0.6428204816292211 },
  { 1.0, -0.3714014551732318, 0.9999999999999998, 1.0, -1.5620959364626055, 0.7161571320953768 },
  { 1.0, -1.0298229723362611, 1.0, 1.0, -1.5310702081483014, 0.8130950789236201 },
  { 1.0, -1.2676395426322578, 1.0000000000000002, 1.0, -1.50809401930334, 0.8931580864862605 },
  { 1.0, -1.3628788519102755, 1.0000000000000002, 1.0, -1.4983265140498274, 0.9475287279522546 },
  { 1.0, -1.3980241837651683, 1.0, 1.0, -1.5032624176850438, 0.9843747059042128 },
};

static const double kSosHalf[kSosCount][6] = {
  { 0.002127202393970988, 0.003969826523269095, 0.0021272023939709877, 1.0, -1.123947995442327, 0.3598922558306775 },
  { 1.0, 1.1539617372458708, 1.0, 1.0, -0.8982545031234372, 0.5134864918866506 },
  { 1.0, 0.5391680542810605, 0.9999999999999999, 1.0, -0.631144538195623, 0.6968585761131654 },
  { 1.0, 0.19543533242923034, 0.9999999999999999, 1.0, -0.43779269407651, 0.8337532775556458 },
  { 1.0, 0.028016607451569406, 1.0000000000000002, 1.0, -0.32877532894349193, 0.9202115172487586 },
  { 1.0, -0.03911585389053439, 1.0, 1.0, -0.28387863035151367, 0.976406688577319 },
};

struct State {
  bool active;
  double z1[kSosCount];
  double z2[kSosCount];
  float src[kMaxEngineFrames];
  float dest[kMaxHostFrames];
};

static State gPool[kMaxInstances];

static void clear_state(State& s) {
  for (int k = 0; k < kSosCount; k++) {
    s.z1[k] = 0.0;
    s.z2[k] = 0.0;
  }
}

static double sos_sample(const double (*sos)[6], double* z1, double* z2, double x) {
  double y = (x * 0.0 == 0.0) ? x : 0.0;
  for (int i = 0; i < kSosCount; i++) {
    const double b0 = sos[i][0];
    const double b1 = sos[i][1];
    const double b2 = sos[i][2];
    const double a1 = sos[i][4];
    const double a2 = sos[i][5];
    const double z1s = z1[i];
    const double z2s = z2[i];
    const double out = b0 * y + z1s;
    z1[i] = b1 * y - a1 * out + z2s;
    z2[i] = b2 * y - a2 * out;
    y = out;
  }
  return (y * 0.0 == 0.0) ? y : 0.0;
}

}  // namespace

extern "C" int soemdsp_rapt_elliptic_decimator_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      clear_state(s);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_rapt_elliptic_decimator_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_rapt_elliptic_decimator_reset(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (!s.active) return;
  clear_state(s);
}

extern "C" int soemdsp_rapt_elliptic_decimator_src_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return (int)(uintptr_t)(void*)gPool[handle - 1].src;
}

extern "C" int soemdsp_rapt_elliptic_decimator_dest_ptr(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0;
  return (int)(uintptr_t)(void*)gPool[handle - 1].dest;
}

extern "C" int soemdsp_rapt_elliptic_decimator_max_src() {
  return kMaxEngineFrames;
}

extern "C" int soemdsp_rapt_elliptic_decimator_max_dest() {
  return kMaxHostFrames;
}

extern "C" void soemdsp_rapt_elliptic_decimator_process(
  int handle,
  int srcCount,
  int destCount,
  int factor
) {
  if (handle < 1 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (!s.active) return;
  int srcN = srcCount;
  int destN = destCount;
  if (srcN < 0) srcN = 0;
  if (destN < 0) destN = 0;
  if (srcN > kMaxEngineFrames) srcN = kMaxEngineFrames;
  if (destN > kMaxHostFrames) destN = kMaxHostFrames;
  int ratio = factor;
  if (ratio != 2 && ratio != 4) ratio = 1;
  if (ratio <= 1) {
    const int n = srcN < destN ? srcN : destN;
    for (int i = 0; i < n; i++) s.dest[i] = s.src[i];
    for (int i = n; i < destN; i++) s.dest[i] = 0.0f;
    return;
  }
  const double (*sos)[6] = ratio == 4 ? kSosQuarter : kSosHalf;
  for (int frame = 0; frame < destN; frame++) {
    double last = 0.0;
    for (int sub = 0; sub < ratio; sub++) {
      const int idx = frame * ratio + sub;
      const double in = idx < srcN ? (double)s.src[idx] : 0.0;
      last = sos_sample(sos, s.z1, s.z2, in);
    }
    s.dest[frame] = (float)last;
  }
}

extern "C" int soemdsp_rapt_elliptic_decimator_version() {
  return 3;
}
