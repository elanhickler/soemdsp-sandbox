// soemdsp-native-module: bradley_2a
// soemdsp-native-label: Bradley 2A Jitter/Hit Synth
// soemdsp-native-target: bradley2a
// soemdsp-native-kind: oscillator
//
// Naive digitization of the Bradley Telcom Jitter and Hit Synthesizer
// (with Frequency Translation and Harmonic Distortion Module). A test
// tone that gets impaired: phase jitter, amplitude jitter, frequency
// translation, harmonic distortion, single-frequency interference, and
// periodic "hits" (gain hit / dropout / phase hit / impulse). Ideal
// blocks, no antialiasing -- it aliases by design. First-pass behavioral
// model; character first, band-limiting later.
//
// One sample = one closed-form expression:
//   out = (1 + (g-1)H) * D[ (1 + Ja*sin(ampLfo)) * sin(car + phaseJit + shift + Ph*H) + Ai*sin(interf) ] + Ii*noise*H
// with H = hit gate, D[x] = x + h2 x^2 + h3 x^3.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const char kMetadataJson[] =
  "{"
    "\"module\":\"bradley_2a\","
    "\"label\":\"Bradley 2A Jitter/Hit Synth\","
    "\"targetType\":\"bradley2a\","
    "\"kind\":\"oscillator\","
    "\"outputs\":[\"Out L\",\"Out R\"],"
    "\"parameters\":["
      "{\"key\":\"carrierFreq\",\"label\":\"Carrier\",\"kind\":\"frequency\",\"defaultValue\":1004,\"min\":0,\"mid\":1000,\"max\":20000,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"freqOffset\",\"label\":\"Freq Translate\",\"kind\":\"frequency\",\"defaultValue\":0,\"min\":-500,\"mid\":0,\"max\":500,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"jitterDepth\",\"label\":\"Phase Jitter\",\"defaultValue\":0,\"min\":0,\"mid\":0.25,\"max\":3.141592653589793,\"step\":\"any\"},"
      "{\"key\":\"jitterRate\",\"label\":\"Jitter Rate\",\"kind\":\"frequency\",\"defaultValue\":60,\"min\":0,\"mid\":100,\"max\":300,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"ampDepth\",\"label\":\"Amp Jitter\",\"defaultValue\":0,\"min\":0,\"mid\":0.25,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"ampRate\",\"label\":\"Amp Rate\",\"kind\":\"frequency\",\"defaultValue\":40,\"min\":0,\"mid\":50,\"max\":300,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"interfLevel\",\"label\":\"Interference\",\"defaultValue\":0,\"min\":0,\"mid\":0.25,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"interfFreq\",\"label\":\"Interf Freq\",\"kind\":\"frequency\",\"defaultValue\":2600,\"min\":0,\"mid\":1000,\"max\":20000,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"harm2\",\"label\":\"2nd Harm\",\"defaultValue\":0,\"min\":0,\"mid\":0.25,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"harm3\",\"label\":\"3rd Harm\",\"defaultValue\":0,\"min\":0,\"mid\":0.25,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"hitRate\",\"label\":\"Hit Rate\",\"defaultValue\":1,\"min\":0,\"mid\":2,\"max\":20,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"hitDuration\",\"label\":\"Hit Time\",\"defaultValue\":0.005,\"min\":0,\"mid\":0.02,\"max\":0.2,\"step\":\"any\",\"unit\":\"s\"},"
      "{\"key\":\"hitGain\",\"label\":\"Gain Hit\",\"defaultValue\":1,\"min\":0,\"mid\":1,\"max\":4,\"step\":\"any\"},"
      "{\"key\":\"hitPhase\",\"label\":\"Phase Hit\",\"defaultValue\":0,\"min\":-3.141592653589793,\"mid\":0,\"max\":3.141592653589793,\"step\":\"any\"},"
      "{\"key\":\"impulseLevel\",\"label\":\"Impulse\",\"defaultValue\":0,\"min\":0,\"mid\":0.25,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"level\",\"label\":\"Level\",\"defaultValue\":1,\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\"}"
    "]"
  "}";

static const int kMaxInstances = 32;
static double wrap_two_pi(double p) {
  return p - kTwoPi * dsp_floor(p / kTwoPi);
}

// Per-channel impairments. L (c = 0) is the original single channel; R
// starts its jitter / amp / interference LFOs a quarter turn later, its hit
// clock half a period later, and draws impulse noise from its own stream.
struct Bradley2AChan {
  double jitterLfoPhase;
  double ampLfoPhase;
  double interfPhase;
  double hitClock;
  int    hitSamplesLeft;
  unsigned int noiseSeed;
  double out;
};

struct Bradley2AState {
  double carrierPhase;  // shared tonal core
  double shiftPhase;    // shared frequency translation
  Bradley2AChan ch[2];
  bool   active;
};

static Bradley2AState gPool[kMaxInstances];

// Fixed seed components (never reorder; append new parts at the end).
enum : unsigned int {
  kSeedImpulseNoise = 1u,   // L hit / impulse noise LCG
  kSeedImpulseNoiseR = 2u,  // R hit / impulse noise LCG
};

static const double kQuarterTurn = 1.5707963267948966;

// deterministic LCG noise in [-1, 1] (swap for pi-noise later)
static double next_noise(Bradley2AChan& c) {
  c.noiseSeed = (unsigned int)(1664525u * c.noiseSeed + 1013904223u);
  return ((double)c.noiseSeed / 4294967295.0) * 2.0 - 1.0;
}

static void reset_chan(Bradley2AChan& c, int ch, unsigned int seed) {
  const double lfo0 = ch == 0 ? 0.0 : kQuarterTurn;
  c.jitterLfoPhase = lfo0;
  c.ampLfoPhase = lfo0;
  c.interfPhase = lfo0;
  c.hitClock = ch == 0 ? 0.0 : 0.5;
  c.hitSamplesLeft = 0;
  c.noiseSeed = seed_mix(seed, ch == 0 ? kSeedImpulseNoise : kSeedImpulseNoiseR);
  c.out = 0.0;
}

// One channel: everything after the shared carrier / translation phases.
static double render_chan(
  Bradley2AChan& c, double carrierPhase, double shiftPhase, double rate,
  double jitterDepth, double jitterRate, double ampDepth, double ampRate,
  double interfLevel, double interfFreq, double harm2, double harm3,
  double hitRate, double hitDuration, double hitGain, double hitPhase,
  double impulseLevel, double level
) {
  // --- hit clock (sawtooth): trigger a hit when it wraps ---
  c.hitClock += maxd(0.0, safe(hitRate)) / rate;
  if (c.hitClock >= 1.0) {
    c.hitClock -= 1.0;
    c.hitSamplesLeft = (int)maxd(0.0, safe(hitDuration) * rate);
  }
  const bool hitActive = c.hitSamplesLeft > 0;
  if (hitActive) c.hitSamplesLeft--;

  // --- jitter lfos (slow sines) ---
  c.jitterLfoPhase = wrap_two_pi(c.jitterLfoPhase + kTwoPi * safe(jitterRate) / rate);
  const double phaseJitter = safe(jitterDepth) * dsp_sin(c.jitterLfoPhase);

  c.ampLfoPhase = wrap_two_pi(c.ampLfoPhase + kTwoPi * safe(ampRate) / rate);
  const double ampMod = 1.0 + safe(ampDepth) * dsp_sin(c.ampLfoPhase);

  // --- impaired carrier ---
  const double phaseHit = hitActive ? safe(hitPhase) : 0.0;
  double sig = dsp_sin(carrierPhase + phaseJitter + shiftPhase + phaseHit) * ampMod;

  // --- single frequency interference ---
  c.interfPhase = wrap_two_pi(c.interfPhase + kTwoPi * safe(interfFreq) / rate);
  sig += safe(interfLevel) * dsp_sin(c.interfPhase);

  // --- harmonic distortion (naive, aliases by design) ---
  sig = sig + safe(harm2) * sig * sig + safe(harm3) * sig * sig * sig;

  // --- hits: gain / dropout / impulse ---
  if (hitActive) {
    sig *= safe(hitGain);
    sig += next_noise(c) * safe(impulseLevel);
  }

  c.out = clamp11(sig * safe(level));
  return c.out;
}

}  // namespace

extern "C" int soemdsp_bradley_2a_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      Bradley2AState& s = gPool[i];
      s.carrierPhase = 0.0;
      s.shiftPhase = 0.0;
      reset_chan(s.ch[0], 0, 0u);  // host Seed via _set_seed
      reset_chan(s.ch[1], 1, 0u);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

// Impulse-noise LCG state from the module Seed only (any u32 is a valid LCG state).
extern "C" void soemdsp_bradley_2a_set_seed(int handle, double seed) {
  if (handle < 1 || handle > kMaxInstances) return;
  const unsigned int u = seed_param_u32(seed);
  gPool[handle - 1].ch[0].noiseSeed = seed_mix(u, kSeedImpulseNoise);
  gPool[handle - 1].ch[1].noiseSeed = seed_mix(u, kSeedImpulseNoiseR);
}

extern "C" void soemdsp_bradley_2a_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_bradley_2a_sample(
  int    handle,
  double carrierFreq,
  double freqOffset,
  double jitterDepth,
  double jitterRate,
  double ampDepth,
  double ampRate,
  double interfLevel,
  double interfFreq,
  double harm2,
  double harm3,
  double hitRate,
  double hitDuration,
  double hitGain,
  double hitPhase,
  double impulseLevel,
  double level,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  Bradley2AState& s = gPool[handle - 1];

  const double rate = sampleRate < 1.0 ? 1.0 : sampleRate;

  // --- shared frequency translation (phase ramp) + carrier ---
  s.shiftPhase = wrap_two_pi(s.shiftPhase + kTwoPi * safe(freqOffset) / rate);
  s.carrierPhase = wrap_two_pi(s.carrierPhase + kTwoPi * safe(carrierFreq) / rate);

  for (int c = 1; c >= 0; c--) {
    render_chan(
      s.ch[c], s.carrierPhase, s.shiftPhase, rate, jitterDepth, jitterRate,
      ampDepth, ampRate, interfLevel, interfFreq, harm2, harm3, hitRate,
      hitDuration, hitGain, hitPhase, impulseLevel, level
    );
  }
  return s.ch[0].out;
}

// Out R of the last _sample call (Out L is its return value).
extern "C" double soemdsp_bradley_2a_right(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ch[1].out;
}

extern "C" int soemdsp_bradley_2a_version() {
  return 2;
}

extern "C" const char* soemdsp_bradley_2a_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_bradley_2a_metadata_json_size() {
  return sizeof(kMetadataJson) - 1;
}
