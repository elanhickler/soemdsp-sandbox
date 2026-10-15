// soemdsp-native-module: pi_spigot_noise
// soemdsp-native-label: Pi Spigot Noise
// soemdsp-native-target: piSpigotNoise
// soemdsp-native-kind: noise
//
// Stored-digit playback, restored from the first Pi Spigot design
// (git d7c1d310, 2026-07-10): real decimal digits of pi, grouped 3 digits
// per sample starting at the leading "3" (314, 159, 265, ...), each group
// mapped to bipolar audio exactly as the original int16 table did:
//   sample = round((group / 999 * 2 - 1) * 32767) / 32767
// No computation beyond an array index.
//
// Digit table: pi_digits_bcd.bin, 1 MiB, two digits per byte (high nibble
// first) = 2,097,152 digits including the leading 3 = 699,050 samples
// (~15.85 s at 44.1 kHz) before the loop. Embedded in the wasm with #embed.
// Generated deterministically (mpmath Chudnovsky, cross-checked against
// MPFR const_pi and the original 1,000,000 pi.delivery digits);
// sha256 ece07484297ede8f8d0be1d87eeee8df69d6b1a5a509bb9c7004508639d29a40.
//
// Outputs (port keys kept so saved patches load):
//   Left   playback from Start
//   Right  same table, read half a table later (independent stereo side)
//   Hex    first decimal digit of the current Left group (0..9 as 0..1)
//   N      read position through the table (0..1)
//   T      pulse when the Left read position loops
//   B3..B0 BCD bits of that digit (8, 4, 2, 1)
// Color / Smoothing / Level post-process both sides (White + 0 = original).
// soemdsp_pi_spigot_noise_compute_bipolar keeps the BBP hex-digit extractor.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wc23-extensions"
static const unsigned char kPiBcd[] = {
#embed "pi_digits_bcd.bin"
};
#pragma clang diagnostic pop

static const int kDigitCount = (int)(sizeof(kPiBcd) * 2);
static const int kGroupCount = kDigitCount / 3;  // samples before the loop

static const char kMetadataJson[] =
  "{"
    "\"module\":\"pi_spigot_noise\","
    "\"label\":\"Pi Spigot Noise\","
    "\"targetType\":\"piSpigotNoise\","
    "\"kind\":\"noise\","
    "\"outputs\":[\"Left\",\"Right\",\"Hex\",\"N\",\"T\",\"B3\",\"B2\",\"B1\",\"B0\"],"
    "\"parameters\":["
      "{\"key\":\"start\",\"label\":\"Start\",\"defaultValue\":0,\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"stride\",\"label\":\"Stride\",\"defaultValue\":1,\"min\":1,\"mid\":4,\"max\":16,\"step\":1},"
      "{\"key\":\"color\",\"label\":\"Color\",\"defaultValue\":0,\"choices\":[\"White\",\"Pink\",\"Brown\",\"Blue\",\"Violet\"],\"displayChoices\":true,\"divideChoicesVisibly\":true,\"min\":0,\"mid\":2,\"max\":4,\"step\":1},"
      "{\"key\":\"smoothing\",\"label\":\"Smoothing\",\"defaultValue\":0,\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"level\",\"label\":\"Level\",\"defaultValue\":1,\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\"}"
    "]"
  "}";

static const int kMaxInstances = 16;
static const int kTail = 16;

struct PiSpigotNoiseChannel {
  double pink[7];
  double brown;
  double prevWhite1;
  double prevWhite2;
  double smoothLp[4];
  double lastOut;
};

struct PiSpigotNoiseState {
  bool active;
  int start;      // first sample (group index)
  int stride;     // samples advanced per output sample (1 = original)
  int readIndex;  // offset from start
  int digit;      // first digit of the current Left group
  int pulse;
  PiSpigotNoiseChannel leftCh;
  PiSpigotNoiseChannel rightCh;
};

static PiSpigotNoiseState gPool[kMaxInstances];

static inline int clampi(int x, int lo, int hi) { return x < lo ? lo : (x > hi ? hi : x); }

static inline int pi_digit(int i) {
  const unsigned char b = kPiBcd[i >> 1];
  return (i & 1) ? (b & 15) : (b >> 4);
}

static inline int pi_group(int g) {
  const int i = g * 3;
  return pi_digit(i) * 100 + pi_digit(i + 1) * 10 + pi_digit(i + 2);
}

// Same value the original int16 table held: round((d/999*2-1)*32767)/32767.
static inline double group_sample(int d) {
  const double x = ((double)d / 999.0 * 2.0 - 1.0) * 32767.0;
  const double r = x < 0.0 ? -dsp_floor(-x + 0.5) : dsp_floor(x + 0.5);
  return r / 32767.0;
}

static double pow_mod(double a, double b, double m) {
  if (m <= 0.0) return 0.0;
  double result = 1.0;
  double base = a - m * dsp_floor(a / m);
  if (base < 0.0) base += m;
  double expn = b;
  if (expn < 0.0) expn = 0.0;
  while (expn > 0.5) {
    double half = expn * 0.5;
    bool odd = (double)(long long)half * 2.0 != expn;
    if (odd) {
      double p = result * base;
      result = p - m * dsp_floor(p / m);
      if (result < 0.0) result += m;
    }
    expn = dsp_floor(half);
    double sq = base * base;
    base = sq - m * dsp_floor(sq / m);
    if (base < 0.0) base += m;
  }
  return result;
}

static double series_term(int m, int k, int n) {
  const double ak = 8.0 * (double)k + (double)m;
  if (ak <= 0.0) return 0.0;
  if (k <= n) {
    return pow_mod(16.0, (double)(n - k), ak) / ak;
  }
  double t = 1.0;
  const int e = k - n;
  for (int i = 0; i < e; i += 1) t *= 0.0625;
  return t / ak;
}

static void resetColor(PiSpigotNoiseChannel& c) {
  for (int i = 0; i < 7; i += 1) c.pink[i] = 0.0;
  c.brown = 0.0;
  c.prevWhite1 = 0.0;
  c.prevWhite2 = 0.0;
  for (int i = 0; i < 4; i += 1) c.smoothLp[i] = 0.0;
  c.lastOut = 0.0;
}

static double applyColor(PiSpigotNoiseChannel& c, double white, int color) {
  if (color == 1) {
    c.pink[0] = 0.99886 * c.pink[0] + white * 0.0555179;
    c.pink[1] = 0.99332 * c.pink[1] + white * 0.0750759;
    c.pink[2] = 0.969 * c.pink[2] + white * 0.153852;
    c.pink[3] = 0.8665 * c.pink[3] + white * 0.3104856;
    c.pink[4] = 0.55 * c.pink[4] + white * 0.5329522;
    c.pink[5] = -0.7616 * c.pink[5] - white * 0.016898;
    const double out = (c.pink[0] + c.pink[1] + c.pink[2] +
      c.pink[3] + c.pink[4] + c.pink[5] + c.pink[6] + white * 0.5362) * 0.11;
    c.pink[6] = white * 0.115926;
    return out;
  }
  if (color == 2) {
    c.brown = clamp11(c.brown + white * 0.05);
    return c.brown;
  }
  if (color == 3) {
    const double out = (white - c.prevWhite1) * 0.5;
    c.prevWhite1 = white;
    return out;
  }
  if (color == 4) {
    const double out = (white - 2.0 * c.prevWhite1 + c.prevWhite2) * 0.25;
    c.prevWhite2 = c.prevWhite1;
    c.prevWhite1 = white;
    return out;
  }
  return white;
}

static const double kLnSmoothMinG = -3.912023005428146;

static double applySmoothing(PiSpigotNoiseChannel& c, double x, double smoothing) {
  const double s = clamp(smoothing, 0.0, 1.0);
  if (s <= 0.0) return x;
  const double g = dsp_exp(s * kLnSmoothMinG);
  double y = x;
  for (int i = 0; i < 4; i += 1) {
    c.smoothLp[i] += g * (y - c.smoothLp[i]);
    y = c.smoothLp[i];
  }
  return y;
}

static void applyStartStride(PiSpigotNoiseState& s, double start, double stride) {
  const int st = clampi((int)(clamp(start, 0.0, 1.0) * (double)(kGroupCount - 1) + 0.5), 0, kGroupCount - 1);
  const int sd = clampi((int)(safe(stride) + 0.5), 1, 16);
  if (st == s.start && sd == s.stride) return;
  s.start = st;
  s.stride = sd;
  s.readIndex = 0;
  s.digit = 0;
  s.pulse = 0;
  resetColor(s.leftCh);
  resetColor(s.rightCh);
}

}  // namespace

extern "C" int soemdsp_pi_spigot_noise_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      PiSpigotNoiseState& s = gPool[i];
      s.start = 0;
      s.stride = 1;
      s.readIndex = 0;
      s.digit = 0;
      s.pulse = 0;
      resetColor(s.leftCh);
      resetColor(s.rightCh);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_pi_spigot_noise_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_pi_spigot_noise_reset_seed(int handle, double start, double stride) {
  if (handle < 1 || handle > kMaxInstances) return;
  applyStartStride(gPool[handle - 1], start, stride);
}

extern "C" void soemdsp_pi_spigot_noise_sample(int handle, double color, double smoothing, double level) {
  if (handle < 1 || handle > kMaxInstances) return;
  PiSpigotNoiseState& s = gPool[handle - 1];
  if (!s.active) return;
  const int gl = (s.start + s.readIndex) % kGroupCount;
  const int gr = (gl + kGroupCount / 2) % kGroupCount;
  const int dl = pi_group(gl);
  s.digit = dl / 100;
  const int next = s.readIndex + s.stride;
  s.pulse = next >= kGroupCount ? 1 : 0;
  s.readIndex = next % kGroupCount;
  const int safeColor = clampi((int)(safe(color) + 0.5), 0, 4);
  const double amp = safe(level);
  s.leftCh.lastOut = applySmoothing(s.leftCh, applyColor(s.leftCh, group_sample(dl), safeColor), smoothing) * amp;
  s.rightCh.lastOut = applySmoothing(s.rightCh, applyColor(s.rightCh, group_sample(pi_group(gr)), safeColor), smoothing) * amp;
}

extern "C" double soemdsp_pi_spigot_noise_left(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].leftCh.lastOut;
}

extern "C" double soemdsp_pi_spigot_noise_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].rightCh.lastOut;
}

extern "C" double soemdsp_pi_spigot_noise_hex(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return (double)gPool[handle - 1].digit / 9.0;
}

extern "C" double soemdsp_pi_spigot_noise_n(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  const PiSpigotNoiseState& s = gPool[handle - 1];
  return (double)((s.start + s.readIndex) % kGroupCount) / (double)(kGroupCount - 1);
}

extern "C" double soemdsp_pi_spigot_noise_t(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].pulse ? 1.0 : 0.0;
}

extern "C" double soemdsp_pi_spigot_noise_b3(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return (gPool[handle - 1].digit & 8) ? 1.0 : 0.0;
}

extern "C" double soemdsp_pi_spigot_noise_b2(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return (gPool[handle - 1].digit & 4) ? 1.0 : 0.0;
}

extern "C" double soemdsp_pi_spigot_noise_b1(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return (gPool[handle - 1].digit & 2) ? 1.0 : 0.0;
}

extern "C" double soemdsp_pi_spigot_noise_b0(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return (gPool[handle - 1].digit & 1) ? 1.0 : 0.0;
}

// BBP hex-digit extractor at position n, bipolar. Not used by playback.
extern "C" double soemdsp_pi_spigot_noise_compute_bipolar(int n) {
  int safeN = n < 0 ? 0 : n;
  double x = 0.0;
  const int mlist[4] = {1, 4, 5, 6};
  const double clist[4] = {4.0, -2.0, -1.0, -1.0};
  for (int k = 0; k <= safeN + kTail; k += 1) {
    for (int p = 0; p < 4; p += 1) {
      x += clist[p] * series_term(mlist[p], k, safeN);
      x = x - dsp_floor(x);
      if (x < 0.0) x += 1.0;
    }
  }
  return x * 2.0 - 1.0;
}

extern "C" int soemdsp_pi_spigot_noise_sample_count() {
  return kGroupCount;
}

extern "C" int soemdsp_pi_spigot_noise_version() {
  return 7;
}

extern "C" const char* soemdsp_pi_spigot_noise_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_pi_spigot_noise_metadata_json_size() {
  return sizeof(kMetadataJson) - 1;
}
