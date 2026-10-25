// soemdsp-native-module: fluv_noise
// soemdsp-native-label: Fluv Noise
// soemdsp-native-target: fluvNoise
// soemdsp-native-kind: noise
//
// Filter Morph noise band, as a generator. White xorshift32 → N-pole HP at ƒ
// → M-pole LP at ƒ×Spread. Mix is log-Hz from Start to Full × Amount.
// Grain-free: nothing injected at/below Start. Independent L/R when Stereo On.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

constexpr int kMaxInstances = 64;
constexpr int kMaxNoisePoles = 4;
constexpr double kDefaultStartHz = 2000.0;
constexpr double kDefaultFullHz = 7000.0;
constexpr double kDefaultSpread = 4.0;

enum : unsigned int {
  kSeedFluvL = 1u,
  kSeedFluvR = 2u,
};

struct FluvLane {
  unsigned int rng;
  double noiseHpZ[kMaxNoisePoles];
  double noiseLpZ[kMaxNoisePoles];
};

struct FluvNoiseState {
  bool active;
  unsigned int seed;
  FluvLane L;
  FluvLane R;
  double lastLeft;
  double lastRight;
};

static FluvNoiseState gPool[kMaxInstances];

static unsigned int fluv_rng_from_seed(unsigned int seed, unsigned int lane) {
  return seed_to_rng_state(seed_mix(seed, lane));
}

static double next_white(FluvLane& s) {
  unsigned int state = s.rng;
  if (state == 0u) state = 1u;
  state = xorshift32(state);
  s.rng = state;
  const double u = (double)(state >> 8) * (1.0 / 16777216.0);
  return u * 2.0 - 1.0;
}

static void clear_noise(FluvLane& s) {
  for (int i = 0; i < kMaxNoisePoles; i++) {
    s.noiseHpZ[i] = 0.0;
    s.noiseLpZ[i] = 0.0;
  }
}

static void init_lane(FluvLane& s, unsigned int seed, unsigned int lane) {
  clear_noise(s);
  s.rng = fluv_rng_from_seed(seed, lane);
}

static double one_pole_lp(double& y, double x, double freqHz, double rate) {
  const double maxW = kTAU * 0.45;
  double f = freqHz;
  if (!(f == f) || f < 0.0) f = 0.0;
  if (f > 20000.0) f = 20000.0;
  double w = f * kTAU / rate;
  if (w > maxW) w = maxW;
  const double a1 = dsp_exp_squaring(-w);
  const double b0 = 1.0 - a1;
  y = b0 * x + a1 * y;
  return y;
}

static int clamp_poles(double poles) {
  int n = (int)(poles + (poles >= 0.0 ? 0.5 : -0.5));
  if (n < 1) n = 1;
  if (n > kMaxNoisePoles) n = kMaxNoisePoles;
  return n;
}

static double noise_band(FluvLane& s, double loHz, double hiHz, double rate, int hpPoles, int lpPoles) {
  double n = next_white(s);
  for (int i = 0; i < hpPoles; i++) {
    const double lp = one_pole_lp(s.noiseHpZ[i], n, loHz, rate);
    n = n - lp;
  }
  for (int i = hpPoles; i < kMaxNoisePoles; i++) s.noiseHpZ[i] = 0.0;
  for (int i = 0; i < lpPoles; i++) {
    n = one_pole_lp(s.noiseLpZ[i], n, hiHz, rate);
  }
  for (int i = lpPoles; i < kMaxNoisePoles; i++) s.noiseLpZ[i] = 0.0;
  return n;
}

static double sizzle_gate(double freqHz, double startHz, double fullHz) {
  double f = freqHz < 0.0 ? -freqHz : freqHz;
  double a = startHz;
  double b = fullHz;
  if (!(a == a) || a <= 0.0) a = kDefaultStartHz;
  if (!(b == b) || b <= 0.0) b = kDefaultFullHz;
  if (a < 1.0) a = 1.0;
  if (b < 1.0) b = 1.0;
  if (b < a) {
    const double t = a;
    a = b;
    b = t;
  }
  if (f <= a) return 0.0;
  if (f >= b) return 1.0;
  const double la = dsp_ln(a);
  const double lb = dsp_ln(b);
  const double den = lb - la;
  if (!(den > 1.0e-12)) return 1.0;
  return (dsp_ln(f) - la) / den;
}

}  // namespace

extern "C" int soemdsp_fluv_noise_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      FluvNoiseState& s = gPool[i];
      s.seed = 0u;
      init_lane(s.L, 0u, kSeedFluvL);
      init_lane(s.R, 0u, kSeedFluvR);
      s.lastLeft = 0.0;
      s.lastRight = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_fluv_noise_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_fluv_noise_set_seed(int handle, double seed) {
  if (handle < 1 || handle > kMaxInstances) return;
  FluvNoiseState& s = gPool[handle - 1];
  if (!s.active) return;
  s.seed = seed_param_u32(seed);
  s.L.rng = fluv_rng_from_seed(s.seed, kSeedFluvL);
  s.R.rng = fluv_rng_from_seed(s.seed, kSeedFluvR);
  clear_noise(s.L);
  clear_noise(s.R);
}

extern "C" void soemdsp_fluv_noise_sample_stereo(
  int handle,
  double freqHz,
  double sampleRate,
  double startHz,
  double fullHz,
  double amount,
  double spread,
  double hpPoles,
  double lpPoles,
  double stereoOn,
  double amplitude,
  double* outLeft,
  double* outRight
) {
  if (handle < 1 || handle > kMaxInstances) {
    if (outLeft) *outLeft = 0.0;
    if (outRight) *outRight = 0.0;
    return;
  }
  FluvNoiseState& s = gPool[handle - 1];
  if (!s.active) {
    if (outLeft) *outLeft = 0.0;
    if (outRight) *outRight = 0.0;
    return;
  }
  double rate = sampleRate;
  if (!(rate > 1.0)) rate = 44100.0;
  double f = freqHz;
  if (!(f == f)) f = 0.0;
  if (f < 0.0) f = -f;
  double amt = amount;
  if (!(amt == amt) || amt < 0.0) amt = 0.0;
  if (amt > 1.0) amt = 1.0;
  double spr = spread;
  if (!(spr == spr) || spr < 1.0) spr = kDefaultSpread;
  if (spr > 32.0) spr = 32.0;
  double amp = amplitude;
  if (!(amp == amp) || amp < 0.0) amp = 0.0;
  const int hp = clamp_poles(hpPoles);
  const int lp = clamp_poles(lpPoles);
  const double gate = sizzle_gate(f, startHz, fullHz) * amt;
  const double ny = rate * 0.45;
  double lo = f;
  if (lo < 1.0) lo = 1.0;
  if (lo > ny) lo = ny;
  double hi = lo * spr;
  if (hi > ny) hi = ny;
  if (hi < lo) hi = lo;
  const double yL = noise_band(s.L, lo, hi, rate, hp, lp) * gate * amp;
  double yR = yL;
  if (stereoOn >= 0.5) {
    yR = noise_band(s.R, lo, hi, rate, hp, lp) * gate * amp;
  }
  s.lastLeft = yL;
  s.lastRight = yR;
  if (outLeft) *outLeft = yL;
  if (outRight) *outRight = yR;
}

extern "C" double soemdsp_fluv_noise_left(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastLeft;
}

extern "C" double soemdsp_fluv_noise_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastRight;
}

extern "C" int soemdsp_fluv_noise_version() {
  return 1;
}
