// soemdsp-native-module: robin_sinepulse
// soemdsp-native-label: Robin Sinepulse
// soemdsp-native-target: robinSinepulse
// soemdsp-native-kind: drum
// soemdsp-native-lib: https://github.com/RobinSchmidt/RS-MET/blob/work/Libraries/RobsJuceModules/rosic/unfinished/rosic_MiscUnfinished.h
// soemdsp-native-upstream-license: RS-MET (permission)
// soemdsp-native-upstream-license-url: https://github.com/elanhickler/soemdsp-sandbox/blob/master/docs/THIRD_PARTY.md#rs-met
//
// Robin Sinepulse: port of rosic::rsSweepKicker / rsFreqSweeper (Robin Schmidt,
// RS-MET), used with Robin's permission (2026-10-06, see docs/KICK_PLAN.md).
// Original: originalcode/.
//
// One oscillator whose frequency sweeps down from High Freq along Robin's
// rational sweep law (rsFreqSweeper::getInstFreq / updateCoeffs, refFreq 50 Hz):
//   p = 2^((chirp + shape)/2), q = 2^((chirp - shape)/2)
//   a = fHi, c = ((a/50)^(1/q) - 1) / sweepTime^p, b = fLo * c^q
//   f(t) = (a + b*t^(p*q)) / (1 + c*t^p)^q,  t = n / fs
// Phase: trapezoidal integration of f, wrapped once per sample
// (rsFreqSweeper::getSampleFrameStereo). Waves: SawSine, TriSine, SawTri.
// Morph 1 = high-frequency end, 0 = low-frequency end (unipolar).
//
// Sandbox additions (docs/KICK_PLAN.md, Argi 2026-10-06; Reset removed 2026-10-06):
//   - Decay: one-multiply T60 amplitude envelope e per voice (scales Kick; not a jack).
//     No floor on Decay (the param sets the range); Decay <= 0 = instant silence.
//   - 0-1 jack: log sweep position of the newest hit: u = ln(f/L)/ln(H/L),
//     L = max(Low, 20 Hz), clamped 0..1. High is 1.
//   - Trigger only (gate_hit abs-rise rule, height = velocity, shared by all
//     voices): starts a new voice that latches High/Low/Sweep, starts at phase 0
//     (Robin's hard-reset noteOn), restarts the sweep, and sets e = |height|.
//   - Voices (1..8): click-helper fade stack, not polyphony. Only one kick is
//     live. A retrigger always steals it: the previous hit plays on as a fading
//     copy over Fade Time (ms, linear gain 1 -> 0, independent of Decay), so
//     the cut is not a click. Voices is how many of those fading copies can
//     pile up on fast retriggers; extra oldest fades are dropped. Fade Time 0
//     = hard cut (pre-Voices behaviour).
//   - fHi clamped to [50 Hz, fs/2] (fHi < 50 Hz makes c < 0: upward sweep and
//     a singularity), fLo to [0, fs/2]. TriSaw guard at P = +1.
//   - No key / velocity frequency tracking, no FadeOut / PassThrough / stereo.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;
static const int kMaxVoices = 8;    // Voices choice 1..8
static const int kSlots = 16;       // voices + fading copies of stolen voices
static const double kRefFreq = 50.0;              // rsFreqSweeper::refFreq
static const double kLn2 = 0.6931471805599453;
static const double kLn1000 = 6.907755278982137;  // T60: e falls by 1000 in `decay` s
static const double kMinSweepTime = 1.0e-3;       // guard: sweepTime^p must stay > 0
static const double kUnitFloorHz = 20.0;          // 0-1 jack log floor: L = max(Low, 20 Hz)

enum { kWaveSawSine = 0, kWaveTriSine = 1, kWaveSawTri = 2 };

// One hit: Robin's rsFreqSweeper state plus its Decay envelope.
struct Voice {
  bool on;        // sounding (env > 0 and not fully faded)
  bool fading;    // stolen: gain falls to 0 over Fade Time, then the slot frees
  double gain;    // fade gain (1 while not fading)
  double gainStep;
  double age;     // hit order (larger = newer)
  double fHi, fLo, sweepTime;
  double a, b, c, p, q;
  double coeffChirp, coeffShape;
  bool dirty, powFree;
  double sampleCount, instPhase, instFreq;
  double env;
  double decayLatched;
  double decayCached, srCached, r;
};

struct State {
  Voice v[kSlots];
  double hitCount;
  int newest;      // slot of the last hit (drives f / 0-1 / env outs), -1 none
  double velocity;
  double fHi, fLo; // of the newest hit (0-1 jack)
  double lastFreq; // newest voice's sweep Hz (kept after it ends)
  double envOut, unitOut, freqOut;
  bool swept;
  double lastTrigger;
  double sr;
  double elapsedHold;
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"robin_sinepulse\","
    "\"label\":\"Robin Sinepulse\","
    "\"targetType\":\"robinSinepulse\","
    "\"kind\":\"drum\""
  "}";

static void init_voice(Voice& v) {
  v.on = false;
  v.fading = false;
  v.gain = 1.0;
  v.gainStep = 0.0;
  v.age = 0.0;
  v.fHi = 10000.0; v.fLo = 0.0; v.sweepTime = 0.2;
  v.a = v.b = v.c = 0.0; v.p = v.q = 1.0;
  v.coeffChirp = v.coeffShape = 0.0;
  v.dirty = true; v.powFree = true;
  v.sampleCount = 0.0; v.instPhase = 0.0; v.instFreq = v.fHi;
  v.env = 0.0;
  v.decayLatched = 0.5;
  v.decayCached = -1.0; v.srCached = -1.0; v.r = 0.0;
}

static void init_state(State& s) {
  for (int i = 0; i < kSlots; i++) init_voice(s.v[i]);
  s.hitCount = 0.0;
  s.newest = -1;
  s.velocity = 0.0;
  s.fHi = 10000.0;
  s.fLo = 0.0;
  s.lastFreq = 0.0;
  s.envOut = 0.0;
  s.unitOut = 0.0;
  s.freqOut = 0.0;
  s.swept = false;
  s.lastTrigger = 0.0;
  s.sr = 44100.0;
  s.elapsedHold = -1.0;
}

// rsFreqSweeper::updateCoeffs (rosic_MiscUnfinished.cpp).
static void update_coeffs(Voice& s, double chirp, double shape) {
  s.coeffChirp = chirp;
  s.coeffShape = shape;
  s.dirty = false;
  s.a = s.fHi;
  if (chirp == 0.0 && shape == 0.0) {
    // p = q = 1: every pow() in Robin's formula is the identity.
    s.powFree = true;
    s.p = 1.0;
    s.q = 1.0;
    s.c = (s.a / kRefFreq - 1.0) / s.sweepTime;
    s.b = s.fLo * s.c;
    return;
  }
  s.powFree = false;
  const double ep = 0.5 * (chirp + shape);
  const double eq = 0.5 * (chirp - shape);
  s.p = dsp_exp(ep * kLn2);  // pow(2, ep)
  s.q = dsp_exp(eq * kLn2);  // pow(2, eq)
  s.c = (pow_pos(s.a / kRefFreq, 1.0 / s.q) - 1.0) / pow_pos(s.sweepTime, s.p);
  s.b = (s.c > 0.0) ? s.fLo * pow_pos(s.c, s.q) : 0.0;
}

// rsFreqSweeper::getInstFreq: (a + b*t^(p*q)) / (1 + c*t^p)^q.
static double inst_freq(const Voice& s, double t) {
  if (s.powFree) return (s.a + s.b * t) / (1.0 + s.c * t);
  if (!(t > 0.0)) return s.a;
  const double lnT = dsp_ln(t);  // one ln(t) shared by t^p and t^(p*q)
  const double tp = dsp_exp(s.p * lnT);
  const double tpq = dsp_exp(s.p * s.q * lnT);
  return (s.a + s.b * tpq) / pow_pos(1.0 + s.c * tp, s.q);
}

// RAPT::rsTriSaw with the phase already in cycles. r2 = rise length.
static double tri_saw(double pos01, double m) {
  const double x = wrap01(pos01);  // rsWrapAround(x, 1)
  const double r2 = 0.25 * (m + 1.0);
  if (x < r2) return x / r2;
  if (x > 1.0 - r2) return (x - 1.0) / r2;
  const double d = 1.0 - 2.0 * r2;
  if (!(d > 0.0)) return 1.0;  // guard: P = +1 at x = 0.5 (Robin's 0/0), left limit
  return 2.0 * (r2 - x) / d + 1.0;
}

// Morph 0..1 → tri_saw m 0..1 (triangle → rising saw). Rational 0.60.
static double tri_saw_param_map(double raw) {
  return rational_curve01(clamp(raw, 0.0, 1.0), 0.60);
}

// Diroxe hyperbolic tent. k→0 linear tent; large k rounds toward sine.
// k is floored so the peak rounding is at least ~2 samples at `freq`.
static double tent_k(double morph, double freq, double sr) {
  const double m = clamp(morph, 0.0, 1.0);
  const double lnSharp = -13.815510557964274; // ln(1e-6)
  double k = dsp_exp(m * lnSharp);
  const double fs = sr > 1.0 ? sr : 44100.0;
  const double f = freq > 1.0 ? freq : 1.0;
  const double twoOverN = 2.0 * f / fs;
  const double kMin = twoOverN * twoOverN;
  if (k < kMin) k = kMin;
  return k;
}

static double hyperbolic_tent(double pos, double k) {
  const double u = wrap01(pos);
  const double kk = k > 0.0 ? k : 0.0;
  const double r = __builtin_sqrt(0.25 + kk);
  const double g = 4.0 * (r + __builtin_sqrt(kk));
  const double half = u < 0.5;
  const double x = half ? u * 2.0 : (u - 0.5) * 2.0;
  const double b = x - 0.5;
  const double y = g * (r - __builtin_sqrt(b * b + kk));
  return half ? y : -y;
}

static double wave_value(int wave, double pos, double waveShape, double freq, double sr) {
  const double m = clamp(waveShape, 0.0, 1.0);
  if (wave == kWaveTriSine) return hyperbolic_tent(pos, tent_k(m, freq, sr));
  const double tri = tri_saw(pos, tri_saw_param_map(m));
  if (wave == kWaveSawSine) return dsp_sin_turns_lut(0.25 * tri);
  return tri;
}

static double wave_value(int wave, double pos, double waveShape) {
  return wave_value(wave, pos, waveShape, 100.0, 48000.0);
}

// Live control in: NaN/inf -> 0, |x| < kPlanck -> exact 0 (keeps subnormal
// modulation values out of the wave position and the output product).
static double clean_control(double x) {
  const double v = safe(x);
  return silent_planck(v) ? 0.0 : v;
}

// 0-1 jack: log position of freq between the latched floor and High.
// u = ln(f/L) / ln(H/L), L = max(Low, 20 Hz). High is 1, L and below are 0.
static double sweep_unit(double freq, double fHi, double fLo) {
  const double lo = maxd(fLo, kUnitFloorHz);
  if (!(fHi > lo) || !(freq > lo)) return 0.0;
  double u = dsp_ln(freq / lo) / dsp_ln(fHi / lo);
  if (u < 0.0) u = 0.0;
  if (u > 1.0) u = 1.0;
  return u;
}

// Voice allocation on a hit. One live kick; a retrigger always steals it
// (fade 1 -> 0 over Fade Time, or hard cut). `fadeSlots` is how many stolen
// copies may keep fading (fast retriggers). Decay does not scale Fade Time.
static int start_voice(State& s, int fadeSlots, double fadeSamples) {
  if (fadeSlots < 1) fadeSlots = 1;
  if (fadeSlots > kMaxVoices) fadeSlots = kMaxVoices;
  for (int i = 0; i < kSlots; i++) {
    Voice& o = s.v[i];
    if (!o.on || o.fading) continue;
    if (fadeSamples > 0.0) {
      o.fading = true;
      o.gainStep = 1.0 / fadeSamples;
    } else {
      o.on = false;
    }
  }
  for (;;) {
    int fading = 0, oldest = -1;
    for (int i = 0; i < kSlots; i++) {
      const Voice& v = s.v[i];
      if (!v.on || !v.fading) continue;
      fading++;
      if (oldest < 0 || v.age < s.v[oldest].age) oldest = i;
    }
    if (fading <= fadeSlots || oldest < 0) break;
    s.v[oldest].on = false;
  }
  int slot = -1;
  for (int i = 0; i < kSlots; i++) if (!s.v[i].on) { slot = i; break; }
  if (slot < 0) {
    slot = 0;
    for (int i = 1; i < kSlots; i++) if (s.v[i].gain < s.v[slot].gain) slot = i;
  }
  return slot;
}

// One voice, one sample: Robin's output-before-update order. Returns the
// faded voice output (without Amplitude).
static double run_voice(Voice& v, int w, double phase, double waveShape,
                        double ch, double sh, double decay, double sr) {
  const double y = wave_value(w, v.instPhase + phase, waveShape, v.instFreq, sr);
  const double out = v.env * v.gain * y;

  // State update (rsFreqSweeper::getSampleFrameStereo order).
  if (v.dirty || ch != v.coeffChirp || sh != v.coeffShape) update_coeffs(v, ch, sh);
  v.sampleCount += 1.0;
  const double newFreq = inst_freq(v, v.sampleCount / sr);
  v.instPhase += (0.5 / sr) * (v.instFreq + newFreq);  // trapezoidal integration
  if (v.instPhase >= 1.0) v.instPhase -= 1.0;
  v.instFreq = newFreq;

  // Decay envelope: e *= r, r = exp(-ln(1000) / (decay * fs)). No floor: the
  // Decay param sets the range. Guard only: decay <= 0 (or NaN) would divide
  // by zero / make e grow, so it means instant silence (r = 0).
  if (decay != v.decayCached || sr != v.srCached) {
    v.decayCached = decay;
    v.srCached = sr;
    v.r = (decay > 0.0) ? dsp_exp(-kLn1000 / (decay * sr)) : 0.0;
  }
  v.env *= v.r;
  if (v.env < kPlanck) { v.env = 0.0; v.on = false; }
  if (v.fading) {
    v.gain -= v.gainStep;
    if (!(v.gain > 0.0)) { v.gain = 0.0; v.on = false; }
  }
  return out;
}

}  // namespace

extern "C" int soemdsp_robin_sinepulse_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      init_state(gPool[i]);
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_robin_sinepulse_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Kick (sum of all voices). soemdsp_robin_sinepulse_env() is the
// newest hit's T60 envelope; soemdsp_robin_sinepulse_unit() its 0-1 sweep jack.
extern "C" double soemdsp_robin_sinepulse_sample(
  int handle,
  double trigger,
  double highFreq,
  double lowFreq,
  double sweepTime,
  double chirp,
  double chirpShape,
  double wave,
  double waveShape,
  double phase,
  double decay,
  double amplitude,
  double sampleRate,
  double recalculateOnTrigger,  // 0 Off (live) / 1 On: decay latched on each hit
  double voices,                // 1..8 fading copies (one live kick)
  double fadeMs                 // stolen-voice fade, ms (0 = hard cut)
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  s.sr = sr;

  // Shared abs-rise Trigger rule (gate_hit) and velocity for every voice.
  const double trig = safe(trigger);
  if (gate_hit(trig, &s.lastTrigger)) {
    // Voices is fade-stack depth (1..8), not how many kicks ring together.
    int fadeSlots = (int)(safe(voices) + 0.5);
    fadeSlots = fadeSlots < 1 ? 1 : (fadeSlots > kMaxVoices ? kMaxVoices : fadeSlots);
    const double fadeSamples = safe(fadeMs) * 0.001 * sr;  // <= 0: hard cut
    const int slot = start_voice(s, fadeSlots, fadeSamples);
    Voice& v = s.v[slot];
    init_voice(v);
    // rsSweepKicker::noteOn latching, no key / velocity tracking.
    const double nyquist = 0.5 * sr;
    v.fHi = maxd(mind(safe(highFreq), nyquist), kRefFreq);
    v.fLo = clamp(safe(lowFreq), 0.0, nyquist);
    v.sweepTime = maxd(safe(sweepTime), kMinSweepTime);
    v.instFreq = v.fHi;
    v.instPhase = 0.0;  // Robin's hard-reset noteOn
    s.velocity = gate_hit_velocity();
    v.env = s.velocity;
    v.decayLatched = decay;
    v.on = v.env >= kPlanck;
    s.hitCount += 1.0;
    v.age = s.hitCount;
    s.newest = slot;
    s.fHi = v.fHi;
    s.fLo = v.fLo;
    s.lastFreq = v.instFreq;
    s.swept = true;
    s.elapsedHold = 0.0;
  }

  const bool latch = safe(recalculateOnTrigger) >= 0.5;
  int w = (int)(safe(wave) + 0.5);
  w = w < kWaveSawSine ? kWaveSawSine : (w > kWaveSawTri ? kWaveSawTri : w);
  const double ph = clean_control(phase);
  const double ws = clamp(clean_control(waveShape), 0.0, 1.0);
  const double ch = clamp(safe(chirp), -1.0, 1.0);
  const double sh = clamp(safe(chirpShape), -1.0, 1.0);
  const double liveDecay = safe(decay);

  double sum = 0.0;
  s.envOut = 0.0;
  for (int i = 0; i < kSlots; i++) {
    Voice& v = s.v[i];
    if (!v.on) continue;
    if (i == s.newest) { s.envOut = v.env; s.lastFreq = v.instFreq; }
    sum += run_voice(v, w, ph, ws, ch, sh, latch ? v.decayLatched : liveDecay, sr);
    if (i == s.newest) {
      s.elapsedHold = v.sampleCount / sr;
      if (!v.on) s.lastFreq = v.instFreq;  // rest: f stays where the sweep landed
    }
  }

  if (!s.swept) {
    s.freqOut = clamp(safe(lowFreq), 0.0, 0.5 * sr);
    s.unitOut = 0.0;
  } else {
    s.freqOut = s.lastFreq;
    s.unitOut = sweep_unit(s.freqOut, s.fHi, s.fLo);
  }
  const double out = clean_control(amplitude) * sum;
  return (out * 0.0 == 0.0) ? out : 0.0;
}

extern "C" double soemdsp_robin_sinepulse_freq(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].freqOut;
}

extern "C" double soemdsp_robin_sinepulse_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

extern "C" double soemdsp_robin_sinepulse_unit(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].unitOut;
}

extern "C" int soemdsp_robin_sinepulse_is_idle(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 1;
  const State& s = gPool[handle - 1];
  if (!s.active) return 1;
  for (int i = 0; i < kSlots; i++) if (s.v[i].on) return 0;
  return 1;
}

// Seconds since the newest hit, or -1 before the first Trigger.
extern "C" double soemdsp_robin_sinepulse_elapsed(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return -1.0;
  return gPool[handle - 1].elapsedHold;
}

// Face preview: one designed hit (velocity 1), cropped to the kick body.
// Per column: min/max of every sample in that column's time slice, widened
// to include the previous column's last sample so adjacent bands connect.
static const int kPreviewMaxCols = 512;
static const int kPreviewMaxSamples = 48000;
static float gPreviewMin[kPreviewMaxCols];
static float gPreviewMax[kPreviewMaxCols];
static int gPreviewCount = 0;
static double gPreviewWindow = 0.0;

// Time until ƒ has fallen to Low+50 Hz (Sweep Time's landing), stretched by Chirp.
static double preview_sweep_land_time(const Voice& v) {
  const double fLand = v.fLo + kRefFreq;
  if (!(v.fHi > fLand)) return 0.0;
  double tHi = v.sweepTime * 8.0;
  if (tHi < 0.05) tHi = 0.05;
  if (tHi > 2.0) tHi = 2.0;
  if (inst_freq(v, tHi) > fLand) return tHi;
  double lo = 0.0, hi = tHi;
  for (int i = 0; i < 24; i++) {
    const double mid = 0.5 * (lo + hi);
    if (inst_freq(v, mid) > fLand) lo = mid;
    else hi = mid;
  }
  return hi;
}

// Crop: min(sweep land, env −24 dB), at least 3 body periods, 8 ms .. 2 s, +12% pad.
static double preview_window_sec(const Voice& v, double decay) {
  const double tSweep = preview_sweep_land_time(v);
  const double tEnv = (decay > 0.0) ? decay * (24.0 / 60.0) : 0.0;
  double t = tSweep;
  if (tEnv > 0.0 && (t <= 0.0 || tEnv < t)) t = tEnv;
  double fBody = v.fLo > kUnitFloorHz ? v.fLo : inst_freq(v, t > 0.0 ? t : v.sweepTime);
  if (!(fBody > kUnitFloorHz)) fBody = kUnitFloorHz;
  const double tFloor = 3.0 / fBody;
  if (t < tFloor) t = tFloor;
  t *= 1.12;
  if (t < 0.008) t = 0.008;
  if (t > 2.0) t = 2.0;
  return t;
}

extern "C" int soemdsp_robin_sinepulse_preview(
  double highFreq, double lowFreq, double sweepTime,
  double chirp, double chirpShape, double wave, double waveShape,
  double phase, double decay, double amplitude, double sampleRate,
  int columns
) {
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double nyquist = 0.5 * sr;
  Voice v;
  init_voice(v);
  v.fHi = maxd(mind(safe(highFreq), nyquist), kRefFreq);
  v.fLo = clamp(safe(lowFreq), 0.0, nyquist);
  v.sweepTime = maxd(safe(sweepTime), kMinSweepTime);
  v.instFreq = v.fHi;
  v.instPhase = 0.0;
  v.env = 1.0;
  v.on = true;
  const double ch = clamp(safe(chirp), -1.0, 1.0);
  const double sh = clamp(safe(chirpShape), -1.0, 1.0);
  update_coeffs(v, ch, sh);
  const double dec = safe(decay);
  gPreviewWindow = preview_window_sec(v, dec);
  int cols = columns < 2 ? 2 : (columns > kPreviewMaxCols ? kPreviewMaxCols : columns);
  int nSamples = (int)(gPreviewWindow * sr + 0.5);
  if (nSamples < cols) nSamples = cols;
  if (nSamples > kPreviewMaxSamples) nSamples = kPreviewMaxSamples;
  for (int i = 0; i < cols; i++) {
    gPreviewMin[i] = 1.0e9f;
    gPreviewMax[i] = -1.0e9f;
  }
  int w = (int)(safe(wave) + 0.5);
  w = w < kWaveSawSine ? kWaveSawSine : (w > kWaveSawTri ? kWaveSawTri : w);
  const double ph = clean_control(phase);
  const double ws = clamp(clean_control(waveShape), 0.0, 1.0);
  const double amp = clean_control(amplitude);
  int prevCol = -1;
  float prevY = 0.0f;
  for (int n = 0; n < nSamples; n++) {
    const double y = amp * run_voice(v, w, ph, ws, ch, sh, dec, sr);
    int col = (int)((double)n * (double)cols / (double)nSamples);
    if (col >= cols) col = cols - 1;
    const float f = (float)y;
    if (col != prevCol && prevCol >= 0) {
      gPreviewMin[col] = prevY;
      gPreviewMax[col] = prevY;
    }
    prevCol = col;
    prevY = f;
    if (f < gPreviewMin[col]) gPreviewMin[col] = f;
    if (f > gPreviewMax[col]) gPreviewMax[col] = f;
    if (!v.on) {
      for (int c = col + 1; c < cols; c++) {
        gPreviewMin[c] = 0.0f;
        gPreviewMax[c] = 0.0f;
      }
      break;
    }
  }
  for (int i = 0; i < cols; i++) {
    if (gPreviewMin[i] > gPreviewMax[i]) {
      gPreviewMin[i] = 0.0f;
      gPreviewMax[i] = 0.0f;
    }
  }
  gPreviewCount = cols;
  return cols;
}

extern "C" double soemdsp_robin_sinepulse_preview_min(int i) {
  return (i >= 0 && i < gPreviewCount) ? (double)gPreviewMin[i] : 0.0;
}

extern "C" double soemdsp_robin_sinepulse_preview_max(int i) {
  return (i >= 0 && i < gPreviewCount) ? (double)gPreviewMax[i] : 0.0;
}

extern "C" double soemdsp_robin_sinepulse_preview_window() {
  return gPreviewWindow;
}

// Face-field pack (indices 0–10): a, b, c, p, q, powFree, decay, amp, fHi, fLo, window.
// Window is T60-to-1e-6 * 1.12, floor 8 ms. Face GLSL evaluates f(t) from this pack.
static double gFieldPack[11];

extern "C" double soemdsp_robin_sinepulse_preview_field(
  double highFreq, double lowFreq, double sweepTime,
  double chirp, double chirpShape, double decay, double amplitude, double sampleRate
) {
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double nyquist = 0.5 * sr;
  Voice v;
  init_voice(v);
  v.fHi = maxd(mind(safe(highFreq), nyquist), kRefFreq);
  v.fLo = clamp(safe(lowFreq), 0.0, nyquist);
  v.sweepTime = maxd(safe(sweepTime), kMinSweepTime);
  v.instFreq = v.fHi;
  const double ch = clamp(safe(chirp), -1.0, 1.0);
  const double sh = clamp(safe(chirpShape), -1.0, 1.0);
  update_coeffs(v, ch, sh);
  const double dec = safe(decay);
  const double amp = maxd(safe(amplitude), 0.0);
  double win = 0.008;
  if (dec > 0.0) {
    win = dec * (dsp_ln(maxd(amp, 1.0e-6) / 1.0e-6) / kLn1000) * 1.12;
    if (win < 0.008) win = 0.008;
  }
  gFieldPack[0] = v.a;
  gFieldPack[1] = v.b;
  gFieldPack[2] = v.c;
  gFieldPack[3] = v.p;
  gFieldPack[4] = v.q;
  gFieldPack[5] = v.powFree ? 1.0 : 0.0;
  gFieldPack[6] = dec;
  gFieldPack[7] = amp;
  gFieldPack[8] = v.fHi;
  gFieldPack[9] = v.fLo;
  gFieldPack[10] = win;
  return win;
}

extern "C" double soemdsp_robin_sinepulse_preview_field_at(int i) {
  return (i >= 0 && i < 11) ? gFieldPack[i] : 0.0;
}

extern "C" int soemdsp_robin_sinepulse_version() { return 15; }  // 15: SawSine/TriSine/SawTri, morph 1→0, tent k pitch floor. 14: preview_field T60-to-1e-6 window. 13: field pack. 11: preview = connected min/max band per column (preview_y removed). 10: connected preview_y polyline. 9: face preview + elapsed. 8: Voices = fading copies (one live kick; Decay does not scale Fade Time). 7: Voices (1..8) + Fade Time (stolen voice fades out; 0 = hard cut). 6: no Decay floor (was 0.1 ms). 5: Recalculate On Trigger (decay latched on hit)
extern "C" const char* soemdsp_robin_sinepulse_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_robin_sinepulse_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
