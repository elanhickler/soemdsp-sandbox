// soemdsp-native-module: fibonacci_noise
// soemdsp-native-label: Fibonacci Noise
// soemdsp-native-target: fibonacciNoise
// soemdsp-native-kind: noise
//
// Stepped noise from a lagged Fibonacci generator (soemdsp/math/
// lagged_fibonacci.h): x_n = (x_{n-J} OP x_{n-K}) mod 2^32, one output per
// step at Speed steps/s, then smoothed. Values in "digit units" 0..9:
//   Output Digits      v = floor(x * 10 / 2^32)  (integers 0..9)
//   Output Continuous  v = x / 2^32 * 9          (0 .. <9)
// Unipolar v/9 (0..1), Bipolar v/9*2-1 (-1..+1).
//
// Lags (J, K) choices are primitive-trinomial pairs: 24/55, 5/17, 31/63,
// 97/127, 273/607, 418/1279. Operation: Add, Subtract, Multiply, XOR.
// Seed (0 valid) fills the K seed words via seed_mix. Changing Lags,
// Operation or Seed, or a Reset rising edge, restarts the sequence.
//
// The generator is sequential; step s plays generator output s + 8, and
// outputs are generated ahead into a 32-entry ring so the multi-point
// smoothers can read steps k-7 .. k+8 with no delay.
//
// Smoothing: 0 Hold 1 Linear 2 1-Pole (cutoff Speed/2) 3 2-Pole 4 Cosine
// 5 Smoothstep 6 Cubic (Catmull-Rom) 7 B-Spline 8 Quintic B-Spline
// 9 Gaussian (sigma 1.5 steps over 16). Quantize On snaps to 10 levels.
// Trigger: 1 for one sample whenever the step changes (also first sample
// and after a restart).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/math/interpolation.h>
#include <soemdsp/math/lagged_fibonacci.h>

namespace {

using namespace soemdsp_maths;

static const unsigned int kPartLfg = 1;  // fixed seed part id
static const int kRing = 32;             // power of 2, >= 16 taps + headroom
static const long long kLead = 8;        // step s = generator output s + kLead
static const double kPoleCutoffPerSpeed = 0.5;

static const char kMetadataJson[] =
  "{"
    "\"module\":\"fibonacci_noise\","
    "\"label\":\"Fibonacci Noise\","
    "\"targetType\":\"fibonacciNoise\","
    "\"kind\":\"noise\","
    "\"inputs\":[\"Reset\"],"
    "\"outputs\":[\"Bipolar\",\"Unipolar\",\"Trigger\"],"
    "\"parameters\":["
      "{\"key\":\"lags\",\"label\":\"Lags\",\"defaultValue\":0,\"choices\":[\"24 / 55\",\"5 / 17\",\"31 / 63\",\"97 / 127\",\"273 / 607\",\"418 / 1279\"],\"min\":0,\"max\":5,\"step\":1},"
      "{\"key\":\"operation\",\"label\":\"Operation\",\"defaultValue\":0,\"choices\":[\"Add\",\"Subtract\",\"Multiply\",\"XOR\"],\"min\":0,\"max\":3,\"step\":1},"
      "{\"key\":\"output\",\"label\":\"Output\",\"defaultValue\":0,\"choices\":[\"Digits\",\"Continuous\"],\"min\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"speed\",\"label\":\"Speed\",\"defaultValue\":44100,\"min\":0.01,\"mid\":20,\"max\":96000,\"step\":\"any\"},"
      "{\"key\":\"interpolation\",\"label\":\"Smoothing\",\"defaultValue\":0,\"choices\":[\"Hold\",\"Linear\",\"1-Pole\",\"2-Pole\",\"Cosine\",\"Smoothstep\",\"Cubic\",\"B-Spline\",\"Quintic B-Spline\",\"Gaussian\"],\"min\":0,\"max\":9,\"step\":1},"
      "{\"key\":\"quantize\",\"label\":\"Quantize\",\"defaultValue\":0,\"choices\":[\"Off\",\"On\"],\"min\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"seed\",\"label\":\"Seed\",\"kind\":\"seed\",\"defaultValue\":1,\"min\":0,\"max\":16777215,\"step\":1}"
    "]"
  "}";

static const int kMaxInstances = 16;

struct FibNoiseState {
  bool active;
  bool fresh;
  LaggedFibonacci gen;
  double ring[kRing];     // value of generator output o at ring[o & 31]
  long long produced;     // generator outputs stored so far
  long long step;         // current step
  double frac;            // position inside the step, [0, 1)
  long long lastStep;
  int lags, op, outMode;
  unsigned int seed;
  double prevReset;
  double lp1, lp2, coeffSpeed, coeffSr, coeff;
  double bipolar, unipolar, trigger;
};

static FibNoiseState gPool[kMaxInstances];

static inline double to_digit_units(unsigned int x, int outMode) {
  if (outMode == 1) return (double)x * (9.0 / 4294967296.0);
  return (double)(int)(((unsigned long long)x * 10ull) >> 32);
}

static inline void produce_through(FibNoiseState& s, long long output) {
  while (s.produced <= output) {
    s.ring[s.produced & (kRing - 1)] = to_digit_units(lagged_fib_next(s.gen), s.outMode);
    s.produced += 1;
  }
}

// Step value; steps k-7 .. k+8 around the current step are always available.
static inline double step_value(FibNoiseState& s, long long st) {
  const long long o = st + kLead;
  produce_through(s, o);
  return s.ring[o & (kRing - 1)];
}

static void restart(FibNoiseState& s) {
  const LaggedFibPair pr = kLaggedFibPairs[s.lags];
  lagged_fib_init(s.gen, s.seed, kPartLfg, pr.j, pr.k, s.op);
  s.produced = 0;
  s.step = 0;
  s.frac = 0.0;
  const double d = step_value(s, 0);
  s.lp1 = d;
  s.lp2 = d;
  s.fresh = true;
}

static inline FibNoiseState* get(int handle) {
  if (handle < 1 || handle > kMaxInstances) return nullptr;
  FibNoiseState& s = gPool[handle - 1];
  return s.active ? &s : nullptr;
}

}  // namespace

extern "C" int soemdsp_fibonacci_noise_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    FibNoiseState& s = gPool[i];
    if (!s.active) {
      s.lags = 0; s.op = 0; s.outMode = 0; s.seed = 1u;
      s.prevReset = 0.0; s.lastStep = -1;
      s.coeffSpeed = -1.0; s.coeffSr = -1.0; s.coeff = 1.0;
      s.bipolar = 0.0; s.unipolar = 0.0; s.trigger = 0.0;
      restart(s);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_fibonacci_noise_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// lags 0..5 (pair choice), operation 0..3, output 0 Digits / 1 Continuous,
// seed any (0 valid). Any change restarts the sequence.
extern "C" void soemdsp_fibonacci_noise_set_config(
  int handle, double lags, double operation, double output, double seed
) {
  FibNoiseState* p = get(handle);
  if (!p) return;
  const int lg = clamp_int((int)(safe(lags) + 0.5), 0, kLaggedFibPairCount - 1);
  const int op = clamp_int((int)(safe(operation) + 0.5), 0, 3);
  const int om = safe(output) >= 0.5 ? 1 : 0;
  const unsigned int sd = seed_param_u32(seed);
  if (lg == p->lags && op == p->op && om == p->outMode && sd == p->seed) return;
  p->lags = lg; p->op = op; p->outMode = om; p->seed = sd;
  restart(*p);
}

// One output sample. Returns Bipolar.
extern "C" double soemdsp_fibonacci_noise_sample(
  int handle, double speed, double sampleRate, double interpolation,
  double quantize, double reset
) {
  FibNoiseState* p = get(handle);
  if (!p) return 0.0;
  FibNoiseState& s = *p;
  const int mode = clamp_int((int)(safe(interpolation) + 0.5), 0, 9);
  const double sr = safe(sampleRate) > 0.0 ? sampleRate : 44100.0;
  const double spd = speed;

  const double rs = safe(reset);
  if (rs > 0.0 && !(s.prevReset > 0.0)) restart(s);
  s.prevReset = rs;

  const long long k = s.step;
  const double t = s.frac;
  const double d1 = step_value(s, k);
  double v = d1;
  if (mode == 1) {
    v = lerp(d1, step_value(s, k + 1), t);
  } else if (mode == 4) {
    v = interp_cosine(d1, step_value(s, k + 1), t);
  } else if (mode == 5) {
    v = interp_smoothstep(d1, step_value(s, k + 1), t);
  } else if (mode == 6 || mode == 7) {
    const double d3 = step_value(s, k + 2);  // generate furthest first
    const double d2 = step_value(s, k + 1);
    const double d0 = step_value(s, k - 1);
    v = mode == 6 ? interp_catmull_rom(d0, d1, d2, d3, t) : interp_bspline3(d0, d1, d2, d3, t);
  } else if (mode == 8) {
    const double y5 = step_value(s, k + 3);
    v = interp_bspline5(
      step_value(s, k - 2), step_value(s, k - 1), d1,
      step_value(s, k + 1), step_value(s, k + 2), y5, t
    );
  } else if (mode == 9) {
    double y[16];
    produce_through(s, k + 8 + kLead);
    for (int j = 0; j < 16; j += 1) y[j] = step_value(s, k + j - 7);
    v = interp_gaussian(y, t);
  } else if (mode == 2 || mode == 3) {
    if (spd != s.coeffSpeed || sr != s.coeffSr) {
      s.coeffSpeed = spd;
      s.coeffSr = sr;
      s.coeff = one_pole_coeff_hz(spd * kPoleCutoffPerSpeed, sr);
    }
    s.lp1 = one_pole_step(s.lp1, d1, s.coeff);
    if (mode == 3) {
      s.lp2 = one_pole_step(s.lp2, s.lp1, s.coeff);
      v = s.lp2;
    } else {
      s.lp2 = s.lp1;
      v = s.lp1;
    }
  }
  if (mode != 2 && mode != 3) {
    s.lp1 = d1;
    s.lp2 = d1;
  }
  if (safe(quantize) >= 0.5) v = clamp(dsp_floor(v + 0.5), 0.0, 9.0);

  s.unipolar = v * (1.0 / 9.0);
  s.bipolar = s.unipolar * 2.0 - 1.0;
  s.trigger = (s.fresh || k != s.lastStep) ? 1.0 : 0.0;
  s.fresh = false;
  s.lastStep = k;

  // Advance. Negative / NaN speed does not move (the sequence only runs forward).
  const double inc = spd / sr;
  if (inc > 0.0) {
    s.frac += inc;
    if (s.frac >= 1.0) {
      const double whole = dsp_floor(s.frac);
      s.step += (long long)whole;
      s.frac -= whole;
    }
  }
  return s.bipolar;
}

extern "C" double soemdsp_fibonacci_noise_bipolar(int handle) {
  const FibNoiseState* p = get(handle);
  return p ? p->bipolar : 0.0;
}

extern "C" double soemdsp_fibonacci_noise_unipolar(int handle) {
  const FibNoiseState* p = get(handle);
  return p ? p->unipolar : 0.0;
}

extern "C" double soemdsp_fibonacci_noise_trigger(int handle) {
  const FibNoiseState* p = get(handle);
  return p ? p->trigger : 0.0;
}

// Test hooks: a standalone generator to check the recurrence / period.
namespace {
LaggedFibonacci gTestGen;
}

extern "C" void soemdsp_fibonacci_noise_test_init(double seed, int lags, int operation) {
  const int lg = clamp_int(lags, 0, kLaggedFibPairCount - 1);
  lagged_fib_init(gTestGen, seed_param_u32(seed), kPartLfg,
    kLaggedFibPairs[lg].j, kLaggedFibPairs[lg].k, clamp_int(operation, 0, 3));
}

extern "C" double soemdsp_fibonacci_noise_test_next() {
  return (double)lagged_fib_next(gTestGen);
}

extern "C" int soemdsp_fibonacci_noise_version() {
  return 1;
}

extern "C" const char* soemdsp_fibonacci_noise_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_fibonacci_noise_metadata_json_size() {
  return sizeof(kMetadataJson) - 1;
}
