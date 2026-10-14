// soemdsp-native-module: vcvrack_superlove_filter
// soemdsp-native-label: VCVRack Superlove Filter
// soemdsp-native-target: vcvrackSuperloveFilter
// soemdsp-native-kind: filter
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp/blob/main/include/soemdsp/filter/Superlove.hpp
//
// Superlove Rev2 (native_modules/superlove_rev2) with the VCV Rack panel's
// limits. No Morph or Phase knobs. LP18/LP24 use the breadboard constants.
// HP/BP trisaw shape is the chaos-at-0 value 0.63. Noise 0…1 injects 0…0.25.
// Drive 0…4 multiplies the input. Panel order is LP18, LP24, BP, HP.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/cold_start.h>

using namespace soemdsp_maths;

namespace {

static const int kMaxInstances = 256;
static const double kTrisawZeroCrossing = 0.75;
static const double kLp18ModMin = -0.1;
static const double kLp18ModMax = -6.0;
static const double kLp24ModMin = -0.1;
static const double kLp24ModMax = -3.0;
static const double kLp18Morph = 0.75;
static const double kLp18Phase = 0.25725;
static const double kLp24Morph = 0.834;
static const double kLp24Phase = 0.85;
// Chaos face 0 → trisaw shape 0.63. No Phase knob, so the offset is 0
// (Rev2 still adds the trisaw zero-crossing of +0.75).
static const double kHpBpMorph = 0.63;
static const double kLpInputScale = 0.25;
static const double kLpOutputScale = 8.0;
static const double kHpBpInputScale = 0.08 / 0.5;
static const double kHpBpOutputScale = (0.5 / 0.08) * 0.5;
static const double kMasterOutScale = 0.5;
static const double kBpExtraOutScale = 0.5;
static const double kLp18FinalBoost = 3.0;
static const double kLp24FinalBoost = 2.0;
static const double kHpFinalBoost = 2.0;
static const double kNoiseMax = 0.25;

struct GraphNode {
  double x, y, skew;
  int shape;
};

static double evalGraph(const GraphNode* nodes, int count, double x) {
  Graph g;
  for (int i = 0; i < count; i++) {
    g.addNode(nodes[i].x, nodes[i].y, nodes[i].skew, (Graph::Shape)nodes[i].shape);
  }
  return g.getValue(x);
}

// VCV Rack Softwave Tri. Morph is m^4, then scaled into 0.15…1.
// Not peak-normalized: LP24 morph 0.834 stays near ±0.38, so a wide-open
// cutoff plus full resonance does not slam a full-scale edge through the ladder.
static double morph_factor(double morph) {
  const double m = clamp(morph, 0.0, 1.0);
  const double m2 = m * m;
  const double m4 = m2 * m2;
  return m4 * 0.999 + 0.001;
}

static double soft_tanh(double v) {
  if (v > 5.0) return 1.0;
  if (v < -5.0) return -1.0;
  const double e2 = dsp_exp(2.0 * v);
  return (e2 - 1.0) / (e2 + 1.0);
}

static double freq_to_pitch(double frequencyHz) {
  const double f = frequencyHz > 1.0e-12 ? frequencyHz : 1.0e-12;
  return 69.0 + 12.0 * (dsp_ln(f / 440.0) / 0.6931471805599453);
}

static double softwaveTri(double phaseCycles, double morph) {
  const double p = wrap01(phaseCycles);
  const double mf = morph_factor(morph);
  const double t = clamp(mf, 0.0, 1.0);
  const double adjusted = 0.15 + (1.0 - 0.15) * t;
  // processSample passes 0 Hz, so the tanh rail saturates and scaling is 1.
  const double scaling = soft_tanh((1.0 - (freq_to_pitch(0.0) / 127.0)) * 9.0);
  return soft_acos(clamp(dsp_sin(p * kTwoPi) * adjusted * scaling, -1.0, 1.0))
    / kPi * 2.0 - 1.0;
}

static double waveTrisaw(double phaseCycles, double morph) {
  double phaseRad = phaseCycles * kTwoPi;
  phaseRad = phaseRad - kTwoPi * dsp_floor(phaseRad / kTwoPi);
  double morphRad = morph * kTwoPi;
  double sourceMin, sourceMax, targetMin, targetRange;
  if (phaseRad > morphRad) {
    sourceMin = morphRad; sourceMax = kTwoPi; targetMin = 1.0; targetRange = -1.0;
  } else {
    sourceMin = 0.0; sourceMax = morphRad; targetMin = 0.0; targetRange = 1.0;
  }
  double sourceRange = sourceMax - sourceMin;
  double uni;
  if (sourceMin == sourceMax) uni = sourceMin;
  else uni = targetMin + (targetRange * (phaseRad - sourceMin)) / sourceRange;
  return 2.0 * uni - 1.0;
}

static double ladderTapStep(double y[5], double input, double a, int mode, int stages) {
  double c[5] = {0, 0, 0, 0, 0};
  if (mode == 1) {
    c[stages] = 1.0;
  } else if (mode == 2) {
    static const double hp[4][5] = {
      {1.0, -1.0, 0.0, 0.0, 0.0},
      {1.0, -2.0, 1.0, 0.0, 0.0},
      {1.0, -3.0, 3.0, -1.0, 0.0},
      {1.0, -4.0, 6.0, -4.0, 1.0},
    };
    for (int i = 0; i <= stages; i++) c[i] = hp[stages - 1][i];
  } else if (mode == 3) {
    static const double bp[4][5] = {
      {0.0, 2.0, -2.0, 0.0, 0.0},
      {0.0, 2.0, -2.0, 0.0, 0.0},
      {0.0, 0.0, 3.0, -3.0, 0.0},
      {0.0, 0.0, 4.0, -8.0, 4.0},
    };
    for (int i = 0; i < 5; i++) c[i] = bp[stages - 1][i];
  }
  double y0 = soft_clip_rational(input);
  y[1] = y0 + a * (y0 - y[1]);
  y[2] = y[1] + a * (y[1] - y[2]);
  y[3] = y[2] + a * (y[2] - y[3]);
  y[4] = y[3] + a * (y[3] - y[4]);
  y[0] = y0;
  return c[0] * y[0] + c[1] * y[1] + c[2] * y[2] + c[3] * y[3] + c[4] * y[4];
}

static inline double ladderCoefficient(double cutoffHz, double sampleRate) {
  double rawWc = kTwoPi * cutoffHz / sampleRate;
  double wc = clamp(rawWc, 1e-9, kPi * 0.98);
  double s = dsp_sin_0_pi(wc);
  double c = dsp_cos_0_pi(wc);
  double t = dsp_tan_neg_halfquarter(0.25 * (wc - kPi));
  double denom = s - c * t;
  if (denom > -1e-12 && denom < 1e-12) denom = (denom >= 0.0) ? 1e-12 : -1e-12;
  return t / denom;
}

static inline double nextNoiseBipolar(unsigned int* state) {
  unsigned int x = *state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  *state = x;
  return ((double)x / 4294967295.0) * 2.0 - 1.0;
}

struct State {
  bool active;
  double feedbackSignal;
  double filterY[5];
  double dcY[5];
  unsigned int rngState;
  ColdStart cold;
};

static State gPool[kMaxInstances];

enum : unsigned int { kSeedNoise = 1u };

// Panel index: 0 LP18, 1 LP24, 2 BP, 3 HP. Rev2 order is LP18, LP24, HP, BP.
static int rev2ModeFromPanel(int panel) {
  if (panel <= 0) return 0;
  if (panel == 1) return 1;
  if (panel == 2) return 3;
  return 2;
}

static const char kMetadataJson[] =
  "{"
    "\"module\":\"vcvrack_superlove_filter\","
    "\"label\":\"VCVRack Superlove Filter\","
    "\"targetType\":\"vcvrackSuperloveFilter\","
    "\"kind\":\"filter\""
  "}";

extern "C" int soemdsp_vcvrack_superlove_filter_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.feedbackSignal = 0.0;
      for (int j = 0; j < 5; j++) { s.filterY[j] = 0.0; s.dcY[j] = 0.0; }
      s.rngState = seed_to_rng_state(seed_mix(0u, kSeedNoise, 0u));
      cold_start_arm(&s.cold);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_vcvrack_superlove_filter_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_vcvrack_superlove_filter_set_seed(int handle, double seed, int lane) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].rngState = seed_to_rng_state(
    seed_mix(seed_param_u32(seed), kSeedNoise, (unsigned int)(lane < 0 ? 0 : lane))
  );
}

extern "C" double soemdsp_vcvrack_superlove_filter_sample(
  int handle,
  double input,
  double frequency,
  double resonance,
  double noise01,
  double drive,
  int mode,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  State& s = gPool[handle - 1];

  const double safeRate = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double freqNorm = clamp(frequency, 0.0, 1.0);
  const double reso = clamp(resonance, 0.0, 1.0);
  const double driveGain = clamp(drive, 0.0, 4.0);
  const double n01 = clamp((noise01 == noise01) ? noise01 : 0.0, 0.0, 1.0);
  const int safeMode = rev2ModeFromPanel(mode);
  const double cutoffHz = clamp(
    midi_to_hz(map01(freqNorm, -12.0, 135.0)), 0.0, 0.5 * safeRate
  );
  const double noiseAmp = n01 * kNoiseMax;
  const double noiseSample = (noiseAmp > 1.0e-12)
    ? nextNoiseBipolar(&s.rngState) * noiseAmp
    : 0.0;
  const double drivenIn = input * driveGain;

  if (safeMode <= 1) {
    const double morph = (safeMode == 0) ? kLp18Morph : kLp24Morph;
    const double phase = (safeMode == 0) ? kLp18Phase : kLp24Phase;
    const double driven = drivenIn * kLpInputScale + noiseSample;
    const double modMin = (safeMode == 0) ? kLp18ModMin : kLp24ModMin;
    const double modMax = (safeMode == 0) ? kLp18ModMax : kLp24ModMax;
    const double mod = modMin + (modMax - modMin) * reso;
    const double phaseArg = driven + (mod * s.feedbackSignal + phase);
    const double oscValue = softwaveTri(phaseArg, morph);

    const double a = ladderCoefficient(cutoffHz, safeRate);
    const int stages = safeMode == 0 ? 3 : 4;
    s.feedbackSignal = ladderTapStep(s.filterY, oscValue, a, 1, stages);

    const double dcA = ladderCoefficient(5.0, safeRate);
    const double dcOut = ladderTapStep(s.dcY, s.feedbackSignal, dcA, 2, 3);
    const double lpBoost = (safeMode == 0) ? kLp18FinalBoost : kLp24FinalBoost;
    const double out = dcOut * kLpOutputScale * kMasterOutScale * lpBoost;
    return out * cold_start_apply(&s.cold, safeRate);
  }

  const double driven = drivenIn * kHpBpInputScale;
  const GraphNode resonanceGraph[2] = { {0, -0.2, 0, 0}, {1, 1.3, -0.85, 2} };
  const double mod = evalGraph(resonanceGraph, 2, reso);
  s.feedbackSignal = mod * s.feedbackSignal + driven + noiseSample;
  double oscValue = -waveTrisaw(s.feedbackSignal + kTrisawZeroCrossing, kHpBpMorph);

  if (safeMode == 2) {
    const double lpA = ladderCoefficient(safeRate * 0.5, safeRate);
    double fb = ladderTapStep(s.filterY, oscValue * 0.1, lpA, 1, 1);
    const double hpA = ladderCoefficient(cutoffHz, safeRate);
    fb = ladderTapStep(s.dcY, fb, hpA, 2, 1);
    fb *= 10.0;
    s.feedbackSignal = fb;
    const double outHp = (-fb * 0.31) * kHpBpOutputScale * kMasterOutScale * kHpFinalBoost;
    return outHp * cold_start_apply(&s.cold, safeRate);
  }

  const double a = ladderCoefficient(cutoffHz, safeRate);
  double fb = ladderTapStep(s.filterY, oscValue * 0.1, a, 3, 1);
  fb *= 10.0;
  s.feedbackSignal = fb;
  const double outBp = fb * kHpBpOutputScale * kMasterOutScale * kBpExtraOutScale;
  return outBp * cold_start_apply(&s.cold, safeRate);
}

extern "C" int soemdsp_vcvrack_superlove_filter_version() {
  return 11;
}

extern "C" const char* soemdsp_vcvrack_superlove_filter_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_vcvrack_superlove_filter_metadata_json_size() {
  return (int)(sizeof(kMetadataJson) - 1);
}

}  // namespace
