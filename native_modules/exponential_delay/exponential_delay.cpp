// soemdsp-native-module: exponential_delay
// soemdsp-native-label: Early Reflections
// soemdsp-native-target: earlyReflections
// soemdsp-native-kind: delay
//
// Stereo early reflections from one mono In. Tap times follow supersaw
// Exponential spacing (k=3) on u in (0,1]: denser at the short end,
// stretched toward Time.
//
// Stereo Mode 0 = Dual: two rings (L, R), each with its own full set of N
//   taps and its own delay line. Left taps use u = i/N (last tap = Time);
//   right taps sit halfway between them, u = (i - 0.5)/N, so the two sides
//   always differ. Each side has its own seeded Random Offset and its own
//   FBM drift seeds. Wet per side = side sum / N.
// Stereo Mode 1 = Split: one ring, N taps. Odd taps (1st, 3rd, ...) go to
//   Left, even taps to Right. Wet per side = side sum / that side's tap
//   count. With N = 1 the single tap feeds both sides. Write = In (no
//   feedback).
// Stereo Mode 2 = Mono: the original single-ring layout. One ring, N taps
//   at u = i/N, wet = sum / N, the same signal on Mix L and Mix R.
// Random Offset: each tap gets a seeded random in [0,1] * Random Offset
// seconds added (static). Drift: per-tap FBM, +-Drift Amp on that tap's
// delay, walking at Drift Speed Hz. Mix L/R = dry * (1 - Mix) + wet side * Mix. Min read 1 sample.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 8;
static const int kMaxTaps = 16;
static const double kMaxDelaySeconds = 4.0;
static const int kMaxDelaySamples = 768000;
static const double kExpK = 3.0;

struct ExponentialDelayState {
  bool active;
  float buffer[2][kMaxDelaySamples];
  int writeIndex;
  double fbmTime[2][kMaxTaps];
  unsigned int fbmSeed[2][kMaxTaps];
  double outRight;
};

static ExponentialDelayState gPool[kMaxInstances];

static void clear_buffer(ExponentialDelayState& s) {
  for (int side = 0; side < 2; side++) {
    for (int i = 0; i < kMaxDelaySamples; i++) {
      s.buffer[side][i] = 0.0f;
    }
    for (int t = 0; t < kMaxTaps; t++) {
      s.fbmTime[side][t] = 0.0;
      const unsigned int slot = (unsigned int)(side * kMaxTaps + t + 1);
      s.fbmSeed[side][t] = 0x9E3779B9u + slot * 2654435761u;
      if (!s.fbmSeed[side][t]) s.fbmSeed[side][t] = 1u;
    }
  }
  s.writeIndex = 0;
  s.outRight = 0.0;
}

static double read_tap(const float* buf, int write, double delaySamples) {
  if (!(delaySamples >= 1.0)) delaySamples = 1.0;
  if (delaySamples > (double)(kMaxDelaySamples - 2)) {
    delaySamples = (double)(kMaxDelaySamples - 2);
  }
  const double readPos = (double)write - delaySamples;
  int i0 = (int)dsp_floor(readPos);
  const double frac = readPos - (double)i0;
  i0 %= kMaxDelaySamples;
  if (i0 < 0) i0 += kMaxDelaySamples;
  int i1 = i0 + 1;
  if (i1 >= kMaxDelaySamples) i1 = 0;
  const double a = (double)buf[i0];
  const double b = (double)buf[i1];
  return a + (b - a) * frac;
}

// One tap's delay in samples. side/t pick the random + FBM slot.
static double tap_delay(
  ExponentialDelayState& s, int side, int t, double u,
  double maxDelaySamples, double offsetSamples, double amount,
  unsigned int seedU, double fbmInc
) {
  const double shape = (dsp_exp(kExpK * u) - 1.0) / (dsp_exp(kExpK) - 1.0);
  double delaySamples = maxDelaySamples * shape;
  s.fbmTime[side][t] += fbmInc;
  if (offsetSamples > 0.0) {
    const unsigned int slot = (unsigned int)(side * kMaxTaps + t + 1);
    const double rand01 = hash_bipolar(slot, seedU) * 0.5 + 0.5;
    delaySamples += rand01 * offsetSamples;
  }
  if (amount > 0.0) {
    const double y = fbm1d(
      s.fbmTime[side][t] + (double)(side * kMaxTaps + t) * 8.0, 4, 0.5, 1.0,
      s.fbmSeed[side][t]
    ) * 2.0 - 1.0;
    delaySamples *= (1.0 + amount * y);
  }
  return delaySamples;
}

}  // namespace

extern "C" int soemdsp_exponential_delay_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      ExponentialDelayState& s = gPool[i];
      clear_buffer(s);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_exponential_delay_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Mix L; Mix R is read with soemdsp_exponential_delay_right().
extern "C" double soemdsp_exponential_delay_sample(
  int handle,
  double input,
  double timeSeconds,
  double delayCount,
  double mix,
  double driftSpeed,
  double driftAmp,
  double seed,
  double randomOffset,
  double stereoMode,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  ExponentialDelayState& s = gPool[handle - 1];

  const double rate = maxd(1.0, safe(sampleRate));
  const double raw = safe(input);
  double timeSec = safe(timeSeconds);
  if (!(timeSec >= 0.0)) timeSec = 0.0;
  if (timeSec > kMaxDelaySeconds) timeSec = kMaxDelaySeconds;

  int n = (int)(delayCount + (delayCount >= 0.0 ? 0.5 : -0.5));
  if (n < 1) n = 1;
  if (n > kMaxTaps) n = kMaxTaps;

  double mx = safe(mix);
  if (!(mx >= 0.0)) mx = 0.0;
  if (mx > 1.0) mx = 1.0;
  const double amount = driftAmp;
  double offsetSec = safe(randomOffset);
  if (!(offsetSec >= 0.0)) offsetSec = 0.0;
  if (offsetSec > kMaxDelaySeconds) offsetSec = kMaxDelaySeconds;
  const unsigned int seedU = (unsigned int)safe(seed);
  const double modeValue = safe(stereoMode);
  const bool mono = modeValue >= 1.5;
  const bool split = !mono && modeValue >= 0.5;

  const int write = s.writeIndex;
  const double maxDelaySamples = timeSec * rate;
  const double offsetSamples = offsetSec * rate;
  const double fbmInc = driftSpeed / rate;
  double wetL = 0.0;
  double wetR = 0.0;

  if (mono) {
    double sum = 0.0;
    for (int i = 1; i <= n; i++) {
      const int t = i - 1;
      const double d = tap_delay(
        s, 0, t, (double)i / (double)n, maxDelaySamples, offsetSamples,
        amount, seedU, fbmInc
      );
      sum += read_tap(s.buffer[0], write, d);
    }
    wetL = sum / (double)n;
    wetR = wetL;
    s.buffer[0][write] = (float)raw;
  } else if (split) {
    double sumL = 0.0;
    double sumR = 0.0;
    int countL = 0;
    int countR = 0;
    for (int i = 1; i <= n; i++) {
      const int t = i - 1;
      const double d = tap_delay(
        s, 0, t, (double)i / (double)n, maxDelaySamples, offsetSamples,
        amount, seedU, fbmInc
      );
      const double v = read_tap(s.buffer[0], write, d);
      if ((t & 1) == 0) { sumL += v; countL++; }
      else { sumR += v; countR++; }
    }
    wetL = sumL / (double)countL;
    wetR = countR > 0 ? sumR / (double)countR : wetL;
    s.buffer[0][write] = (float)raw;
  } else {
    double sumL = 0.0;
    double sumR = 0.0;
    for (int i = 1; i <= n; i++) {
      const int t = i - 1;
      const double dL = tap_delay(
        s, 0, t, (double)i / (double)n, maxDelaySamples, offsetSamples,
        amount, seedU, fbmInc
      );
      const double dR = tap_delay(
        s, 1, t, ((double)i - 0.5) / (double)n, maxDelaySamples,
        offsetSamples, amount, seedU, fbmInc
      );
      sumL += read_tap(s.buffer[0], write, dL);
      sumR += read_tap(s.buffer[1], write, dR);
    }
    wetL = sumL / (double)n;
    wetR = sumR / (double)n;
    s.buffer[0][write] = (float)raw;
    s.buffer[1][write] = (float)raw;
  }

  s.writeIndex = write + 1;
  if (s.writeIndex >= kMaxDelaySamples) {
    s.writeIndex = 0;
  }
  s.outRight = safe(raw * (1.0 - mx) + wetR * mx);
  return safe(raw * (1.0 - mx) + wetL * mx);
}

extern "C" double soemdsp_exponential_delay_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].outRight;
}

extern "C" int soemdsp_exponential_delay_max_samples() {
  return kMaxDelaySamples;
}

extern "C" double soemdsp_exponential_delay_max_seconds() {
  return kMaxDelaySeconds;
}

extern "C" int soemdsp_exponential_delay_version() {
  return 6;
}