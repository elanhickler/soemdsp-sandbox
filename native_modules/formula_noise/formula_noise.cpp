// soemdsp-native-module: formula_noise
// soemdsp-native-label: Formula Noise
// soemdsp-native-target: formulaNoise
// soemdsp-native-kind: noise
//
// Stepped / quantized noise: one value per step at Speed steps/s, from a
// chosen Source, then smoothed. Values live in "digit units" 0..9:
// Unipolar v/9 (0..1), Bipolar v/9*2-1 (-1..+1).
//
// Sources (period N = 2,097,152 steps for every source):
//   Stored tables (expensive to compute -> 1 MiB each, 2 BCD digits per
//   byte, high nibble first, leading digit included, embedded with #embed;
//   generated with mpmath and cross-checked digit-for-digit against MPFR,
//   sqrt 2 and phi also against exact integer square roots):
//   0 Pi       pi_digits_bcd.bin    3.14159...  sha256 ece07484297ede8f8d0be1d87eeee8df69d6b1a5a509bb9c7004508639d29a40
//   1 e        e_digits_bcd.bin     2.71828...  sha256 6e8fd8219ea00dfefcd8ca18509aba98c98dd9761a0092f4e4611bf0d932f0eb
//   2 Sqrt 2   sqrt2_digits_bcd.bin 1.41421...  sha256 b3fbfc360417538d88e330d734208ae7733c0b0c92b9016e9ab318818f9f33ac
//   3 Phi      phi_digits_bcd.bin   1.61803...  sha256 58e2436b983fb0d18ee283bbade16aba4404916bfaf43518e1067a8ce5652161
//   4 Ln 2     ln2_digits_bcd.bin   0.69314...  sha256 2b75b4c885ffdfbe6f35110502ead60f50e039f13a4717e25b1d067f080b691a
//   Live (cheap, seeded, random-access per step so look-ahead, Start,
//   Ping-Pong all work; see soemdsp/math/indexed_noise.h):
//   5 Random Digits  uniform integers 0..9
//   6 White          uniform continuous 0..9
//   7 Gaussian       Irwin-Hall (4 uniforms), bell around 4.5
//   8 Random Walk    +/-1 level per step, reflecting at 0 and 9
//   9 Logistic Map   r = 3.99, restarted from a seeded x0 every 256 steps
//  10 Fibonacci     F(n) mod 10 (repeats every 60 steps; Seed = offset)
//
// Position is a 64-bit fixed-point accumulator (32.32) in "step" space:
//   Wrap       step k plays position k mod N
//   Ping-Pong  period 2N; steps N..2N-1 play backwards (each end plays twice).
// Interpolators read neighbouring steps through the same mapping.
//
// Smoothing (between step k and k+1, t = fractional position):
//   0 Hold  1 Linear  2 1-Pole (cutoff Speed/2)  3 2-Pole  4 Cosine
//   5 Smoothstep (3t^2-2t^3)  6 Cubic (Catmull-Rom)  7 B-Spline (cubic)
//   8 Quintic B-Spline  9 Gaussian (sigma 1.5 steps over 16)
// Quantize On snaps the smoothed value to the nearest of the 10 levels.
// Trigger: 1 for one sample whenever the step index changed (also first
// sample and after Reset / Start jumps). Index: position / (N - 1).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/math/interpolation.h>
#include <soemdsp/math/indexed_noise.h>

namespace {

using namespace soemdsp_maths;

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wc23-extensions"
static const unsigned char kPiBcd[] = {
#embed "pi_digits_bcd.bin"
};
static const unsigned char kEBcd[] = {
#embed "e_digits_bcd.bin"
};
static const unsigned char kSqrt2Bcd[] = {
#embed "sqrt2_digits_bcd.bin"
};
static const unsigned char kPhiBcd[] = {
#embed "phi_digits_bcd.bin"
};
static const unsigned char kLn2Bcd[] = {
#embed "ln2_digits_bcd.bin"
};
#pragma clang diagnostic pop

static_assert(sizeof(kEBcd) == sizeof(kPiBcd), "table size");
static_assert(sizeof(kSqrt2Bcd) == sizeof(kPiBcd), "table size");
static_assert(sizeof(kPhiBcd) == sizeof(kPiBcd), "table size");
static_assert(sizeof(kLn2Bcd) == sizeof(kPiBcd), "table size");

static const unsigned char* const kTables[5] = { kPiBcd, kEBcd, kSqrt2Bcd, kPhiBcd, kLn2Bcd };

typedef unsigned long long u64;

enum Source {
  kSrcPi = 0, kSrcE, kSrcSqrt2, kSrcPhi, kSrcLn2,
  kSrcRandomDigits, kSrcWhite, kSrcGaussian, kSrcRandomWalk, kSrcLogistic, kSrcFibonacci,
  kSourceCount
};

// Fixed seed part IDs (never renumber).
enum SeedPart : unsigned int {
  kPartDigits = 1, kPartWhite = 2, kPartGauss = 3 /* ..6 */, kPartWalk = 7,
  kPartWalkStart = 8, kPartLogistic = 9, kPartFibonacci = 10
};

static const long long kDigitCount = (long long)(sizeof(kPiBcd) * 2);
static const double kFixOne = 4294967296.0;  // 2^32
static const double kPoleCutoffPerSpeed = 0.5;
static const double kLogisticR = 3.99;
static const int kLogBlock = 256;
static const int kLogSlots = 4;
static const int kRing = 32;  // >= 16 Gaussian taps + headroom; power of 2

static const char kMetadataJson[] =
  "{"
    "\"module\":\"formula_noise\","
    "\"label\":\"Formula Noise\","
    "\"targetType\":\"formulaNoise\","
    "\"kind\":\"noise\","
    "\"inputs\":[\"Reset\"],"
    "\"outputs\":[\"Bipolar\",\"Unipolar\",\"Trigger\",\"Index\"],"
    "\"parameters\":["
      "{\"key\":\"source\",\"label\":\"Source\",\"defaultValue\":0,\"choices\":[\"Pi\",\"e\",\"Sqrt 2\",\"Phi\",\"Ln 2\",\"Random Digits\",\"White\",\"Gaussian\",\"Random Walk\",\"Logistic Map\",\"Fibonacci\"],\"min\":0,\"max\":10,\"step\":1},"
      "{\"key\":\"speed\",\"label\":\"Speed\",\"defaultValue\":44100,\"min\":0.01,\"mid\":20,\"max\":96000,\"step\":\"any\"},"
      "{\"key\":\"interpolation\",\"label\":\"Smoothing\",\"defaultValue\":0,\"choices\":[\"Hold\",\"Linear\",\"1-Pole\",\"2-Pole\",\"Cosine\",\"Smoothstep\",\"Cubic\",\"B-Spline\",\"Quintic B-Spline\",\"Gaussian\"],\"min\":0,\"max\":9,\"step\":1},"
      "{\"key\":\"start\",\"label\":\"Start\",\"defaultValue\":0,\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"loop\",\"label\":\"Loop\",\"defaultValue\":0,\"choices\":[\"Wrap\",\"Ping-Pong\"],\"min\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"quantize\",\"label\":\"Quantize\",\"defaultValue\":0,\"choices\":[\"Off\",\"On\"],\"min\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"seed\",\"label\":\"Seed\",\"kind\":\"seed\",\"defaultValue\":1,\"min\":0,\"max\":16777215,\"step\":1}"
    "]"
  "}";

static const int kMaxInstances = 16;

struct FormulaNoiseState {
  bool active;
  bool fresh;        // next sample fires Trigger (create / reset / start jump)
  u64 phase;         // 32.32 fixed point step position, in [0, period)
  long long startDigit;
  double lastStart;
  long long lastStep;
  double prevReset;
  double lp1, lp2;   // 1-Pole / 2-Pole stages, in digit units (0..9)
  double coeffSpeed, coeffSr, coeff;
  double bipolar, unipolar, trigger, index;
  int source;
  unsigned int seed;
  WalkCursor walk;
  long long ringPos[kRing];   // live-source step cache, tag = table position
  double ringVal[kRing];
  long long logBlockId[kLogSlots];
  int logNext;
  double logVal[kLogSlots][kLogBlock];
};

static FormulaNoiseState gPool[kMaxInstances];

static inline int table_digit(const unsigned char* tab, long long i) {
  const unsigned char b = tab[i >> 1];
  return (i & 1) ? (b & 15) : (b >> 4);
}

static double logistic_at(FormulaNoiseState& s, long long pos) {
  const long long b = pos / kLogBlock;
  int slot = -1;
  for (int i = 0; i < kLogSlots; i += 1) {
    if (s.logBlockId[i] == b) { slot = i; break; }
  }
  if (slot < 0) {
    slot = s.logNext;
    s.logNext = (s.logNext + 1) % kLogSlots;
    logistic_block(s.seed, kPartLogistic, b, kLogisticR, s.logVal[slot], kLogBlock);
    s.logBlockId[slot] = b;
  }
  return s.logVal[slot][pos - b * kLogBlock];
}

// Value (digit units) of the active source at table position pos in [0, N).
static inline double source_value(FormulaNoiseState& s, long long pos) {
  switch (s.source) {
    case kSrcRandomDigits: return (double)indexed_digit(s.seed, kPartDigits, (u64)pos);
    case kSrcWhite: return indexed_white(s.seed, kPartWhite, (u64)pos);
    case kSrcGaussian: return indexed_gauss(s.seed, kPartGauss, (u64)pos);
    case kSrcRandomWalk: {
      const long long p0 = indexed_digit(s.seed, kPartWalkStart, 0);
      return (double)fold_reflect_0_9(p0 + indexed_walk_sum(s.walk, s.seed, kPartWalk, pos));
    }
    case kSrcLogistic: return logistic_at(s, pos);
    case kSrcFibonacci:
      return (double)fibonacci_mod10(pos + (long long)(seed_mix(s.seed, kPartFibonacci) % 60u));
    default: return (double)table_digit(kTables[s.source], pos);
  }
}

// Step k (any integer) -> table position under the loop mode.
static inline long long step_pos(long long k, bool pingPong) {
  const long long period = pingPong ? kDigitCount * 2 : kDigitCount;
  long long r = k % period;
  if (r < 0) r += period;
  if (r >= kDigitCount) r = kDigitCount * 2 - 1 - r;
  return r;
}

// Live sources go through a small position-tagged cache, so multi-point
// smoothing computes ~one new value per step instead of every tap each sample.
static inline double step_value(FormulaNoiseState& s, long long k, bool pingPong) {
  const long long pos = step_pos(k, pingPong);
  if (s.source < kSrcRandomDigits) return source_value(s, pos);
  const int slot = (int)(pos & (kRing - 1));
  if (s.ringPos[slot] != pos) {
    s.ringPos[slot] = pos;
    s.ringVal[slot] = source_value(s, pos);
  }
  return s.ringVal[slot];
}

static void jump_to_start(FormulaNoiseState& s) {
  s.phase = (u64)s.startDigit << 32;
  const double d = source_value(s, s.startDigit);
  s.lp1 = d;
  s.lp2 = d;
  s.fresh = true;
}

static void clear_caches(FormulaNoiseState& s) {
  s.walk.valid = false;
  for (int i = 0; i < kRing; i += 1) s.ringPos[i] = -1;
  for (int i = 0; i < kLogSlots; i += 1) s.logBlockId[i] = -1;
  s.logNext = 0;
}

static void init_state(FormulaNoiseState& s) {
  s.startDigit = 0;
  s.lastStart = 0.0;
  s.lastStep = -1;
  s.prevReset = 0.0;
  s.coeffSpeed = -1.0;
  s.coeffSr = -1.0;
  s.coeff = 1.0;
  s.bipolar = 0.0;
  s.unipolar = 0.0;
  s.trigger = 0.0;
  s.index = 0.0;
  s.source = kSrcPi;
  s.seed = 1u;
  clear_caches(s);
  jump_to_start(s);
}

static inline FormulaNoiseState* get(int handle) {
  if (handle < 1 || handle > kMaxInstances) return nullptr;
  FormulaNoiseState& s = gPool[handle - 1];
  return s.active ? &s : nullptr;
}

}  // namespace

extern "C" int soemdsp_formula_noise_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      init_state(gPool[i]);
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_formula_noise_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Start 0..1 across the period (0 = first step). A changed value jumps there.
extern "C" void soemdsp_formula_noise_set_start(int handle, double start) {
  FormulaNoiseState* p = get(handle);
  if (!p) return;
  const double st = clamp01(safe(start));
  if (st == p->lastStart) return;
  p->lastStart = st;
  p->startDigit = (long long)(st * (double)(kDigitCount - 1) + 0.5);
  jump_to_start(*p);
}

// Source choice 0..10 (see header) and Seed (any value; 0 valid). Changing
// either keeps the play position; the smoothing filters glide to the new values.
extern "C" void soemdsp_formula_noise_set_source(int handle, double source, double seed) {
  FormulaNoiseState* p = get(handle);
  if (!p) return;
  const int src = clamp_int((int)(safe(source) + 0.5), 0, kSourceCount - 1);
  const unsigned int sd = seed_param_u32(seed);
  if (src == p->source && sd == p->seed) return;
  p->source = src;
  p->seed = sd;
  clear_caches(*p);
}

// One output sample. speed = steps per second (0 = frozen), interpolation
// 0..9 (see header), loop 0 Wrap / 1 Ping-Pong, quantize 0/1, reset = gate
// (rising edge through 0 jumps to Start). Returns Bipolar.
extern "C" double soemdsp_formula_noise_sample(
  int handle, double speed, double sampleRate, double interpolation,
  double loop, double quantize, double reset
) {
  FormulaNoiseState* p = get(handle);
  if (!p) return 0.0;
  FormulaNoiseState& s = *p;
  const bool pingPong = safe(loop) >= 0.5;
  const int mode = clamp_int((int)(safe(interpolation) + 0.5), 0, 9);
  const double sr = safe(sampleRate) > 0.0 ? sampleRate : 44100.0;
  const double spd = speed;

  const double rs = safe(reset);
  if (rs > 0.0 && !(s.prevReset > 0.0)) jump_to_start(s);
  s.prevReset = rs;

  const u64 period = (u64)(pingPong ? kDigitCount * 2 : kDigitCount) << 32;
  if (s.phase >= period) s.phase %= period;

  const long long k = (long long)(s.phase >> 32);
  const double t = (double)(s.phase & 0xFFFFFFFFull) * (1.0 / kFixOne);
  const double d1 = step_value(s, k, pingPong);

  double v = d1;
  if (mode == 1) {
    v = lerp(d1, step_value(s, k + 1, pingPong), t);
  } else if (mode == 4) {
    v = interp_cosine(d1, step_value(s, k + 1, pingPong), t);
  } else if (mode == 5) {
    v = interp_smoothstep(d1, step_value(s, k + 1, pingPong), t);
  } else if (mode == 6 || mode == 7) {
    const double d0 = step_value(s, k - 1, pingPong);
    const double d2 = step_value(s, k + 1, pingPong);
    const double d3 = step_value(s, k + 2, pingPong);
    v = mode == 6 ? interp_catmull_rom(d0, d1, d2, d3, t) : interp_bspline3(d0, d1, d2, d3, t);
  } else if (mode == 8) {
    v = interp_bspline5(
      step_value(s, k - 2, pingPong), step_value(s, k - 1, pingPong), d1,
      step_value(s, k + 1, pingPong), step_value(s, k + 2, pingPong), step_value(s, k + 3, pingPong), t
    );
  } else if (mode == 9) {
    double y[16];
    for (int j = 0; j < 16; j += 1) y[j] = step_value(s, k + j - 7, pingPong);
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
    s.lp1 = d1;  // keep pole state primed for a later switch to 1-/2-Pole
    s.lp2 = d1;
  }
  if (safe(quantize) >= 0.5) v = clamp(dsp_floor(v + 0.5), 0.0, 9.0);

  s.unipolar = v * (1.0 / 9.0);
  s.bipolar = s.unipolar * 2.0 - 1.0;
  s.trigger = (s.fresh || k != s.lastStep) ? 1.0 : 0.0;
  s.fresh = false;
  s.lastStep = k;
  s.index = (double)step_pos(k, pingPong) / (double)(kDigitCount - 1);

  const u64 inc = (u64)(spd / sr * kFixOne + 0.5);
  s.phase += inc;
  if (s.phase >= period) s.phase %= period;
  return s.bipolar;
}

extern "C" double soemdsp_formula_noise_bipolar(int handle) {
  const FormulaNoiseState* p = get(handle);
  return p ? p->bipolar : 0.0;
}

extern "C" double soemdsp_formula_noise_unipolar(int handle) {
  const FormulaNoiseState* p = get(handle);
  return p ? p->unipolar : 0.0;
}

extern "C" double soemdsp_formula_noise_trigger(int handle) {
  const FormulaNoiseState* p = get(handle);
  return p ? p->trigger : 0.0;
}

extern "C" double soemdsp_formula_noise_index(int handle) {
  const FormulaNoiseState* p = get(handle);
  return p ? p->index : 0.0;
}

extern "C" int soemdsp_formula_noise_digit_count() {
  return (int)kDigitCount;
}

// Stored pi digit i (kept for tests / tools).
extern "C" int soemdsp_formula_noise_digit_at(int i) {
  if (i < 0 || (long long)i >= kDigitCount) return -1;
  return table_digit(kPiBcd, i);
}

// Raw value (digit units 0..9) of the instance's current source at position i.
extern "C" double soemdsp_formula_noise_value_at(int handle, int i) {
  FormulaNoiseState* p = get(handle);
  if (!p || i < 0 || (long long)i >= kDigitCount) return -1.0;
  return source_value(*p, i);
}

extern "C" int soemdsp_formula_noise_source_count() {
  return kSourceCount;
}

extern "C" int soemdsp_formula_noise_version() {
  return 9;
}

extern "C" const char* soemdsp_formula_noise_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_formula_noise_metadata_json_size() {
  return sizeof(kMetadataJson) - 1;
}
