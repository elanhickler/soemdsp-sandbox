// soemdsp-native-module: flower_child_filter_rev3
// soemdsp-native-label: Flower Child Filter Rev3
// soemdsp-native-target: flowerChildFilterRev3
// soemdsp-native-kind: filter
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp-sandbox/blob/master/native_modules/flower_child_filter/originalcode/FlowerChildFilterCore.h
//
// Experiment: Flower Child (Clean / Dirty / Hard / Downsampled) with a Hz
// Frequency knob. Dither is Filter Morph's pitch-tracked noise band: 2-pole HP
// at ƒ, 2-pole LP at 4ƒ, mixed Start→Full (Amount). Heard-pitch scale is
// referenced at Resonance 0.8 (Clean self-osc).

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 256;

// Heard / internal-carrier at Resonance 0.8, 48 kHz, after a short impulse.
// Clean/Dirty track together (~0.248). Hard and Downsampled are their own loops.
static const double kRes08HeardOverInternal = 0.245;
static const double kRes08HeardOverInternalHard = 10.92;
static const double kRes08HeardOverInternalDownsampled = 0.70;

static inline double jmapGeneral(double v, double srcMin, double srcMax, double dstMin, double dstMax) {
  return dstMin + (dstMax - dstMin) * (v - srcMin) / (srcMax - srcMin);
}

static inline double onePoleIitCoefficient(double cutoffHz, double sampleRate) {
  double w = clamp(kTwoPi * cutoffHz / sampleRate, 1e-9, kPi * 0.98);
  return dsp_exp_narrow(-w);
}

static inline double onePoleIitStep(double* y1, double input, double a1) {
  double b0 = 1.0 - a1;
  *y1 = b0 * input + a1 * (*y1);
  return *y1;
}

static inline double sampleAndHoldStep(double* dsPhase, double* held, double incoming, double samplingFreq, double sampleRate) {
  *dsPhase += samplingFreq / sampleRate;
  if (*dsPhase >= 1.0) {
    *dsPhase -= dsp_floor(*dsPhase);
    *held = incoming;
  }
  return *held;
}

static inline double curveShape(double v, double tension) {
  double t = tension;
  double denom = 2.0 * t * v - t - 1.0;
  if (denom == 0.0) return v;
  return (t * v - v) / denom;
}

static inline double evalResonanceGraph(double x, double n0y, double breakpoint, double n2y, double skew) {
  Graph g;
  g.addNode(0.0, n0y, 0.0, Graph::Shape::LINEAR);
  g.addNode(breakpoint, n0y, 0.0, Graph::Shape::LINEAR);
  g.addNode(1.0, n2y, skew, Graph::Shape::RATIONAL);
  return g.getValue(x);
}

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

static inline double waveSine(double phase) {
  return dsp_sin(phase * kTwoPi);
}

static inline double waveEllipse(double phase, double ellipseC) {
  double sinX = dsp_sin(phase * kTwoPi);
  double cosX = dsp_cos(phase * kTwoPi);
  double sqrtVal = sqrt_newton(cosX * cosX + (ellipseC * sinX) * (ellipseC * sinX));
  if (sqrtVal < 1e-12) sqrtVal = 1e-12;
  return cosX / sqrtVal;
}

static inline double nextNoiseBipolar(unsigned int* state) {
  unsigned int x = *state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  *state = x;
  return ((double)x / 4294967295.0) * 2.0 - 1.0;
}

struct OnePoleStage {
  double y1;
};

static inline double onePoleCoefficient(double cutoffHz, double sampleRate) {
  double rawWc = kTwoPi * cutoffHz / sampleRate;
  double wc = clamp(rawWc, 1e-9, kPi * 0.98);
  double s = dsp_sin_0_pi(wc);
  double c = dsp_cos_0_pi(wc);
  double t = dsp_tan_neg_halfquarter(0.25 * (wc - kPi));
  double denom = s - c * t;
  if (denom > -1e-12 && denom < 1e-12) denom = (denom >= 0.0) ? 1e-12 : -1e-12;
  return t / denom;
}

static inline double onePoleStep(OnePoleStage* stage, double input, double a) {
  double y0 = input;
  y0 = soft_clip_rational(y0);
  stage->y1 = y0 + a * (y0 - stage->y1);
  return stage->y1;
}

constexpr int kNoiseHpPoles = 2;
constexpr int kNoiseLpPoles = 2;
constexpr double kDitherStartHz = 2000.0;
constexpr double kDitherFullHz = 7000.0;
constexpr double kNoiseHiRatio = 4.0;

struct FlowerChildRev3State {
  bool active;
  double phase;
  OnePoleStage stage1;
  OnePoleStage stage2;
  double selfMod;
  unsigned int noiseRng;
  unsigned int ditherRng;
  double noiseHpZ[kNoiseHpPoles];
  double noiseLpZ[kNoiseLpPoles];
  double hardFeedback;
  double hardLpf1Y1, hardLpf2Y1;
  double dsPhase, dsHeld;
};

static inline double next_white(FlowerChildRev3State& s) {
  unsigned int state = s.ditherRng;
  if (state == 0u) state = 1u;
  state = xorshift32(state);
  s.ditherRng = state;
  const double u = (double)(state >> 8) * (1.0 / 16777216.0);
  return u * 2.0 - 1.0;
}

static void clear_noise(FlowerChildRev3State& s) {
  for (int i = 0; i < kNoiseHpPoles; i++) s.noiseHpZ[i] = 0.0;
  for (int i = 0; i < kNoiseLpPoles; i++) s.noiseLpZ[i] = 0.0;
}

static double one_pole_lp_hz(double& y, double x, double freqHz, double rate) {
  const double maxW = kTwoPi * 0.45;
  double f = freqHz;
  if (!(f == f) || f < 0.0) f = 0.0;
  if (f > 20000.0) f = 20000.0;
  double w = f * kTwoPi / rate;
  if (w > maxW) w = maxW;
  const double a1 = dsp_exp_squaring(-w);
  const double b0 = 1.0 - a1;
  y = b0 * x + a1 * y;
  return y;
}

static double noise_band(FlowerChildRev3State& s, double loHz, double hiHz, double rate) {
  double n = next_white(s);
  for (int i = 0; i < kNoiseHpPoles; i++) {
    const double lp = one_pole_lp_hz(s.noiseHpZ[i], n, loHz, rate);
    n = n - lp;
  }
  for (int i = 0; i < kNoiseLpPoles; i++) {
    n = one_pole_lp_hz(s.noiseLpZ[i], n, hiHz, rate);
  }
  return n;
}

static double sizzle_gate(double freqHz, double startHz, double fullHz) {
  double f = freqHz < 0.0 ? -freqHz : freqHz;
  double a = startHz;
  double b = fullHz;
  if (!(a == a) || a <= 0.0) a = kDitherStartHz;
  if (!(b == b) || b <= 0.0) b = kDitherFullHz;
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

static double mix_noise_dither(
  FlowerChildRev3State& s,
  double osc,
  double oscScale,
  double freqHz,
  double rate,
  double dither,
  double startHz,
  double fullHz,
  double amount
) {
  const bool ditherOn = dither >= 0.5;
  double amt = amount;
  if (!(amt == amt) || amt < 0.0) amt = 0.0;
  if (amt > 1.0) amt = 1.0;
  const double absF = freqHz < 0.0 ? -freqHz : freqHz;
  const double gate = (ditherOn && absF > 1.0e-15) ? (sizzle_gate(freqHz, startHz, fullHz) * amt) : 0.0;
  if (!(gate > 1.0e-6)) {
    clear_noise(s);
    return osc;
  }
  double f0 = absF;
  if (!(f0 > 1.0e-9)) f0 = 1.0e-9;
  const double ny = rate * 0.45;
  double hi = kNoiseHiRatio * f0;
  if (hi < f0) hi = f0;
  if (hi > ny) hi = ny;
  const double n = noise_band(s, f0, hi, rate) * oscScale;
  return osc * (1.0 - gate) + n * gate;
}

static inline double wrap_phase(double p) {
  return p - dsp_floor(p);
}

static FlowerChildRev3State gPool[kMaxInstances];

enum : unsigned int {
  kSeedNoise = 1u,
  kSeedDither = 2u,
};

static void applySeed(FlowerChildRev3State& s, unsigned int seed, unsigned int lane) {
  s.noiseRng = seed_to_rng_state(seed_mix(seed, kSeedNoise, lane));
  s.ditherRng = seed_to_rng_state(seed_mix(seed, kSeedDither, lane));
}

static inline double internalFromKnob(double knobHz, double scale) {
  if (!(knobHz == knobHz) || knobHz < 0.0) knobHz = 0.0;
  const double s = (scale > 1.0e-12) ? scale : 1.0;
  return knobHz / s;
}

}  // namespace

extern "C" int soemdsp_flower_child_filter_rev3_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      FlowerChildRev3State& s = gPool[i];
      s.phase = 0.0;
      s.stage1.y1 = 0.0;
      s.stage2.y1 = 0.0;
      s.selfMod = 0.0;
      s.hardFeedback = 0.0;
      s.hardLpf1Y1 = 0.0;
      s.hardLpf2Y1 = 0.0;
      s.dsPhase = 0.0;
      s.dsHeld = 0.0;
      clear_noise(s);
      applySeed(s, 0u, 0u);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_flower_child_filter_rev3_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_flower_child_filter_rev3_set_seed(int handle, double seed, int lane) {
  if (handle < 1 || handle > kMaxInstances) return;
  applySeed(
    gPool[handle - 1],
    seed_param_u32(seed),
    (unsigned int)(lane < 0 ? 0 : lane)
  );
}

extern "C" double soemdsp_flower_child_filter_rev3_sample(
  int handle,
  double input,
  double frequencyHz,  // heard-target Hz at Resonance 0.8
  double resonance,
  double chaosAmount,
  int mode,
  double sampleRate,
  double dither,
  double startHz,
  double fullHz,
  double amount
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  FlowerChildRev3State& s = gPool[handle - 1];

  const double safeRate = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double reso = clamp(resonance, 0.0, 1.0);
  const double chaos = clamp(chaosAmount, 0.0, 1.0);

  if (mode == 2) {
    const double masterFrequency = internalFromKnob(frequencyHz, kRes08HeardOverInternalHard);
    const double masterPitch = hz_to_midi(masterFrequency);
    const double fmAmount = midi_to_hz(-48.377);
    const double lpf1Cutoff = midi_to_hz(jmapGeneral(masterPitch, -120.0, 120.0, 90.0, 180.0));
    const double lpf2Cutoff = midi_to_hz(jmapGeneral(masterPitch, -120.0, 120.0, 80.0, 130.0));
    const double lpf1A = onePoleIitCoefficient(lpf1Cutoff, safeRate);
    const double lpf2A = onePoleIitCoefficient(lpf2Cutoff, safeRate);

    const GraphNode phaseModGraph[4] = {
      {0, 0.0, 0, 0}, {0.5, -0.017446, 0.9, 1}, {0.6, -0.017575, 0.0, 1}, {1.0, -0.0147, 0.6, 1},
    };
    const GraphNode sineAmpGraph[4] = {
      {0, 4.44777, 0, 0}, {0.5, 8.6687, 0.9, 1}, {0.6, 8.6687, 0.0, 1}, {1.0, 2.0, 0.6, 1},
    };
    const GraphNode sineToSquareGraph[4] = {
      {0, 0.6792, 0, 0}, {0.5, 0.9552, 0.9, 1}, {0.6, 0.9552, 0.0, 1}, {1.0, 0.001, 0.6, 1},
    };
    const GraphNode clipLevelGraph[3] = { {0.0, 7.0, 0, 0}, {0.7, 7.0, 0.0, 1}, {1.0, 2.0, 0.6, 1} };
    const GraphNode noiseGraph[3] = { {0.0, 0.0, 0, 0}, {0.8, 0.1, 0, 0}, {1.0, 1.0, 0.0, 1} };

    const double pmAmount = evalGraph(phaseModGraph, 4, reso);
    const double sineAmp = evalGraph(sineAmpGraph, 4, reso);
    const double sineToSquare = evalGraph(sineToSquareGraph, 4, reso);
    const double clipLevelRaw = evalGraph(clipLevelGraph, 3, reso);
    const double clipLevel = sineAmp < clipLevelRaw ? sineAmp : clipLevelRaw;
    const double noiseReduction = evalGraph(noiseGraph, 3, reso);
    const double chaosAmount4x = chaos * 4.0;

    double in = s.hardFeedback + clamp(-1.0 * input, -clipLevel, clipLevel);
    const double f = masterFrequency * in * fmAmount;
    const double noiseTerm = masterFrequency * nextNoiseBipolar(&s.noiseRng) * chaosAmount4x * noiseReduction;

    const double incAmt = (f + noiseTerm) / safeRate;
    s.phase = wrap_phase(s.phase + incAmt);
    const double bipolarPhasor = 2.0 * s.phase - 1.0;
    const double phasorOut = bipolarPhasor + pmAmount * s.hardFeedback;
    double ellipseOut = sineAmp * waveEllipse(phasorOut, sineToSquare);
    ellipseOut = mix_noise_dither(
      s, ellipseOut, sineAmp, frequencyHz, safeRate, dither, startHz, fullHz, amount
    );

    double feedback = onePoleIitStep(&s.hardLpf1Y1, ellipseOut, lpf1A);
    feedback = onePoleIitStep(&s.hardLpf2Y1, feedback, lpf2A);
    s.hardFeedback = feedback;
    return feedback * 0.15;
  }

  if (mode == 3) {
    const double frequencyHz3 = internalFromKnob(frequencyHz, kRes08HeardOverInternalDownsampled);
    const double cutoff1 = frequencyHz3 * 0.4;
    const double a1 = onePoleCoefficient(cutoff1, safeRate);

    double breakpoint, cap;
    if (safeRate <= 44100.0) { breakpoint = 0.732441; cap = 0.649123; }
    else if (safeRate <= 88200.0) { breakpoint = 0.816054; cap = 0.818713; }
    else { breakpoint = 0.879599; cap = 0.807018; }
    const double cappedTarget = reso < cap ? reso : cap;
    const double graphValue = evalResonanceGraph(reso, reso, breakpoint, cappedTarget, -0.38);
    const double selfModAmp = map01(curveShape(graphValue, 0.4), 0.0368, 0.6333);

    double inputSignal = clamp11(-input) * 0.036;
    inputSignal += s.selfMod;

    const double mod = 1.4 * inputSignal;
    const double fm = mod;
    const double incAmt = (frequencyHz3 * fm * 6.0) / safeRate;
    s.phase = wrap_phase(s.phase + incAmt);

    const double dsf0y = 0.0;
    const double dsf1y = 0.025 * safeRate;
    const GraphNode dsf[2] = { {0, dsf0y, 0, 0}, {1, dsf1y, -0.09, 2} };
    const double samplingFreq = frequencyHz3 * 2.0 + evalGraph(dsf, 2, 10.0 * (mod < 0 ? -mod : mod));

    const double downsampledPhase = sampleAndHoldStep(&s.dsPhase, &s.dsHeld, s.phase, samplingFreq, safeRate);
    double current_osc_value = waveSine(downsampledPhase) * 1.3;
    current_osc_value = mix_noise_dither(
      s, current_osc_value, 1.3, frequencyHz, safeRate, dither, startHz, fullHz, amount
    );

    const double filtered = onePoleStep(&s.stage1, current_osc_value, a1);
    s.selfMod = filtered * selfModAmp;
    return filtered * 1.4;
  }

  const bool dirty = mode != 0;
  const double carrierHz = internalFromKnob(frequencyHz, kRes08HeardOverInternal);

  const double cutoff1 = carrierHz * 0.164312;
  const double cutoff2 = carrierHz * 0.366131;
  const double a1 = onePoleCoefficient(cutoff1, safeRate);
  const double a2 = onePoleCoefficient(cutoff2, safeRate);

  double breakpoint, cap;
  if (dirty) {
    if (safeRate <= 44100.0) { breakpoint = 0.816054; cap = 0.602339; }
    else if (safeRate <= 88200.0) { breakpoint = 0.902657; cap = 0.654971; }
    else { breakpoint = 0.977649; cap = 0.760234; }
  } else {
    if (safeRate <= 44100.0) { breakpoint = 0.732441; cap = 0.649123; }
    else if (safeRate <= 88200.0) { breakpoint = 0.816054; cap = 0.818713; }
    else { breakpoint = 0.879599; cap = 0.807018; }
  }
  const double cappedTarget = reso < cap ? reso : cap;

  double selfModAmp = 1.0;
  double ellipseC = -1.0;
  if (!dirty) {
    const double graphValue = evalResonanceGraph(reso, reso, breakpoint, cappedTarget, -0.38);
    selfModAmp = map01(curveShape(graphValue, 0.4), 0.0368, 0.6333);
  } else {
    const double freqNorm = clamp((hz_to_midi(carrierHz) - 3.0) / (161.0 - 3.0), 0.0, 1.0);
    const double graphValue = evalResonanceGraph(freqNorm, reso, breakpoint, cappedTarget, -0.38);
    ellipseC = map01(curveShape(graphValue, -0.6), -1.0, 0.00001);
  }

  const double clampLimit = dirty ? 1.198 : 1.0;
  double inputSignal = clamp(-input, -clampLimit, clampLimit);

  if (chaos > 0.0) {
    inputSignal += nextNoiseBipolar(&s.noiseRng) * chaos;
  }

  inputSignal = s.selfMod + 0.035848699999999845 * inputSignal;
  const double fm = 1.4 * inputSignal;

  const double incAmt = (carrierHz * fm) / safeRate;
  s.phase = wrap_phase(s.phase + incAmt);
  const double unipolarPhase = s.phase;

  const double oscScale = dirty ? 0.1 : 1.3;
  double oscValue = dirty
    ? waveEllipse(unipolarPhase, ellipseC) * oscScale
    : waveSine(unipolarPhase) * oscScale;
  oscValue = mix_noise_dither(
    s, oscValue, oscScale, frequencyHz, safeRate, dither, startHz, fullHz, amount
  );

  double out = onePoleStep(&s.stage1, oscValue, a1);
  out = onePoleStep(&s.stage2, out, a2);

  s.selfMod = dirty ? out * 0.465 : out * selfModAmp;
  return dirty ? out * 5.22 : out * 1.31;
}

extern "C" int soemdsp_flower_child_filter_rev3_version() {
  return 3;
}
