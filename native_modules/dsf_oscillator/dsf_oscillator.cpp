// soemdsp-native-module: dsf_oscillator
// soemdsp-native-label: DSF Oscillator
// soemdsp-native-target: dsfOscillator
// soemdsp-native-kind: oscillator
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp/blob/main/include/soemdsp/oscillator/DSFOscillator.hpp

// The "DSF starter kit" -- a Discrete Summation Formula oscillator, the
// other alias-free technique studied for the aliasing-wars mission (see
// README.md), distinct from Surge Oscillator's PolyBLEP approach.
//
// This is a direct transcription of pureSawEng() and its exact usage
// pattern from "Extended DSF Oscillators.cxx" (Walter H. Hackett), one of
// the reference files provided directly:
//
//   double pureSawEng(double t, int n) {
//       return 2.0*(((sin(PI*4*t*(floor(n)*2+1)/4))/sin(t/4*4*PI)-1)/2);
//   }
//   // simplifies to: sin(PI*t*(2N+1)) / sin(PI*t) - 1
//
//   note.t += note.dt * 0.9999;
//   note.t  = note.t - floor(note.t);
//   note.value = note.value*0.999 + pureSawEng(note.t, note.n) * note.dt;
//
// The formula is NOT divided by 2N -- an earlier rewrite added that
// normalization on its own, not part of the real reference; the raw form
// run through the leaky integrator above is what produces the correct
// sawtooth. n = floor(Nyquist/frequency) is auto-derived every sample --
// alias-free by construction. Harmonics (0..1) crossfades n from 1 (a
// single harmonic, an exact sine) up to that Nyquist-safe maximum.
//
// SEVENTH REWRITE: adds Square (PWM), Trimorph, and a SquSaw on
// top of the verified base Saw, rather than reintroducing the earlier
// unverified Formant/Fractal-Stack designs from scratch.
//
// Square (PWM): a classic bandlimited-pulse construction --
// square(t) = saw(t) - saw(t - pulseWidth). Subtracting a phase-shifted
// copy of an already-verified, alias-free Saw is itself alias-free (no
// new closed form, no new singularity to chase), and pulseWidth (0..1)
// controls duty cycle the way PWM traditionally does. Verified
// numerically (Python) that this stays bounded across frequency x
// Harmonics x pulseWidth before shipping.
//
// Trimorph: a second leaky integration on top of the (already-integrated,
// bounded) Square output -- same idea used elsewhere in this project for
// deriving a triangle from a square. Verified numerically that, unlike
// Square, this second integration stage does NOT stay bounded on its own
// across the full frequency range (it grows with the per-sample step
// size, which scales with frequency) -- an adaptive leaky peak-follower
// normalizer is added on top specifically to fix that, verified to keep
// it bounded everywhere Square already was.
//
// SquSaw: a plain crossfade between the (already correct, independently
// verified) Saw and Square outputs -- no new synthesis math needed.
//
// EIGHTH REWRITE: two real bugs reported live, both fixed by re-examining
// actual signal shapes rather than just bounds/NaN checks:
// 1. Trimorph sounded like a square wave. Its second-stage leaky
//    integrator used a fixed retention (0.995, ~200-sample memory) far
//    shorter than the oscillation period at low/mid frequencies (e.g.
//    960 samples at 50 Hz), so the accumulator saturated to a flat
//    plateau mid-ramp instead of completing a linear ramp -- literally a
//    rounded square shape, not a triangle. Same root cause as bug 2.
// 2. SquSaw and Saw/Square showed real DC asymmetry and shape distortion
//    at some frequencies ("all over the place"). Root cause: every
//    accumulator (Saw, Square, SquSaw) used a fixed retention (0.999,
//    ~1000-sample memory), also too short relative to the period at low
//    frequencies (2400+ samples at 20 Hz) -- confirmed in plain Python
//    that the distortion persists even after full settling, so it's a
//    structural bug, not a startup transient.
// Fix: every accumulator's retention now scales with the oscillation
// period (~20 periods of memory, decayed to ~1%), instead of a fixed
// per-sample constant. Verified numerically (Python) that this keeps
// every waveform's shape and DC symmetry consistent from 20 Hz to
// 18 kHz, where the fixed-retention version was measurably distorted.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/math/analog_filter_trig.h>

namespace {

using namespace soemdsp_maths;

// A truncated-at-x^12 Taylor series (7 terms) has ~2e-5 absolute error
// near x=pi. That was fine for the previous fixed-retention (0.999,
// ~1000-sample memory, gain ~1000) integrator, but the new frequency-
// adaptive retention (see adaptiveRetention() below) needs retention
// values much closer to 1 at low frequencies -- e.g. ~0.9999 at 20 Hz,
// gain ~10000+ -- and at that gain, the same ~2e-5 sin error amplified
// into visible DC drift and hard clipping. Reproduced this exactly in
// plain Python (approximate sin vs. exact math.sin, otherwise identical
// code) before touching this file, confirming it wasn't a WASM-only
// artifact. Extended to a 10-term series (error ~5e-10) to give enough
// headroom for the higher gain the adaptive retention now requires.
double sinApprox(double value) {
  const double x = wrap_radians(value);
  const double x2 = x * x;
  double result = -1.0 / 121645100408832000.0;
  result = 1.0 / 355687428096000.0 + x2 * result;
  result = -1.0 / 1307674368000.0 + x2 * result;
  result = 1.0 / 6227020800.0 + x2 * result;
  result = -1.0 / 39916800.0 + x2 * result;
  result = 1.0 / 362880.0 + x2 * result;
  result = -1.0 / 5040.0 + x2 * result;
  result = 1.0 / 120.0 + x2 * result;
  result = -1.0 / 6.0 + x2 * result;
  result = 1.0 + x2 * result;
  return x * result;
}

double dsfPow(double base, double exponent) {
  if (!(base > 0.0)) return 0.0;
  return dsp_exp(exponent * dsp_ln(base));
}

// SineSaw.cxx. The closed form contains cos(x*(n+1)), so n+1 must sit at
// or under Nyquist. floor(Nyquist/f) leaves that partial one step over.
// Continuous count: the integer part picks the kernels, the fraction fades
// the top partial in and out so pitch moves never switch it in one sample.
double sawPartials(double nyquist, double freq) {
  double n = nyquist / freq - 1.0;
  if (n < 1.0) n = 1.0;
  // Below a few hertz the uncapped count makes n*phase lose its fraction.
  if (n > 4096.0) n = 4096.0;
  return n;
}

// Coefficients depend only on morph and n. Steady pitch reuses them.
struct DsfKernelCoeffs {
  double morph;
  double n;
  double k42;
  double eightK2;
  double decay;
  double twoK2;
  double denCos;
  int ready;
};

void prepareSawCoeffs(DsfKernelCoeffs& c, double morph, double n) {
  if (c.ready && c.morph == morph && c.n == n) return;
  const double m = clamp(morph, 0.0, 1.0);
  double k = (1.0 - dsfPow(m, 0.14)) * 4.0;
  if (k < 1.0e-6) k = 1.0e-6;
  const double k2 = k * k;
  c.morph = morph;
  c.n = n;
  c.k42 = dsp_exp2(2.0 * k2);
  c.eightK2 = dsfPow(8.0, k2);
  c.decay = dsp_exp2(-k2 * (n + 1.0));
  c.twoK2 = dsp_exp2(k2);
  c.denCos = dsp_exp2(1.0 + k2);
  c.ready = 1;
}

// Geometric sine-to-saw from SineSaw.cxx. turns is 0..1. Morph 0 is a sine
// (k = 4) and morph 1 is the brightest saw the partial cap allows.
// sin(n·x) is the same wavetable read at turns*n.
double sineSawKernel(double turns, const DsfKernelCoeffs& c) {
  const double nTurns = turns * c.n;
  double sinx = 0.0;
  double cosx = 0.0;
  double sinxn = 0.0;
  double cosxn = 0.0;
  dsp_sin_cos_turns_lut(turns, &sinx, &cosx);
  dsp_sin_cos_turns_lut(nTurns, &sinxn, &cosxn);
  const double num = (c.k42 * cosxn - c.eightK2 * (cosxn * cosx - sinxn * sinx)) * c.decay
    + cosx * c.k42 - c.twoK2;
  const double den = 1.0 - c.denCos * cosx + c.k42;
  if (den > -1.0e-12 && den < 1.0e-12) return 0.0;
  return num / den;
}

// Same coefficients with k2 scaled: mult 2 squares A = 2^k2 (even series).
void prepareSawCoeffsMul(DsfKernelCoeffs& c, double morph, double n, double mult) {
  if (c.ready && c.morph == morph && c.n == n) return;
  const double m = clamp(morph, 0.0, 1.0);
  double k = (1.0 - dsfPow(m, 0.14)) * 4.0;
  if (k < 1.0e-6) k = 1.0e-6;
  const double k2 = k * k * mult;
  c.morph = morph;
  c.n = n;
  c.k42 = dsp_exp2(2.0 * k2);
  c.eightK2 = dsfPow(8.0, k2);
  c.decay = dsp_exp2(-k2 * (n + 1.0));
  c.twoK2 = dsp_exp2(k2);
  c.denCos = dsp_exp2(1.0 + k2);
  c.ready = 1;
}

// The kernel is sum_{k=1..n} A^(1-k) cos(k x), A = 2^k2. Cos and sine parts
// of that sum (the sine part has the same closed form with sin in place of cos).
// Polynomial sin/cos (not the LUT): at Morph 1 the pole sits on the unit
// circle and trig error near it, integrated, became low-frequency drift.
void sineSawKernelCS(double turns, const DsfKernelCoeffs& c, double& C, double& S) {
  double sinx = 0.0, cosx = 0.0, sinxn = 0.0, cosxn = 0.0;
  dsp_sin_cos_turns(turns, &sinx, &cosx);
  dsp_sin_cos_turns(turns * c.n, &sinxn, &cosxn);
  const double cos1 = cosxn * cosx - sinxn * sinx;
  const double sin1 = sinxn * cosx + cosxn * sinx;
  const double den = 1.0 - c.denCos * cosx + c.k42;
  if (den < 1.0e-2) {
    // Near the pole (all partials in phase) the closed form is 0/0 and its
    // rounding error, rotated by the carrier and integrated, drifts the
    // output. Sum the partials directly there (a small arc of each cycle).
    const double r = 1.0 / c.twoK2;
    double tr = cosx, ti = sinx, sr = 0.0, si = 0.0;
    const int n = static_cast<int>(c.n);
    for (int k = 0; k < n; k++) {
      sr += tr;
      si += ti;
      const double nr = (tr * cosx - ti * sinx) * r;
      ti = (tr * sinx + ti * cosx) * r;
      tr = nr;
    }
    C = sr;
    S = si;
    return;
  }
  C = ((c.k42 * cosxn - c.eightK2 * cos1) * c.decay + cosx * c.k42 - c.twoK2) / den;
  S = ((c.k42 * sinxn - c.eightK2 * sin1) * c.decay + sinx * c.k42) / den;
}

// Moorer general form: partial k (1..n) at carrier + (k-1)*modulator, weight
// A^(1-k). Spacing s puts partial k at f*(1 + (k-1)*s); s = 1 is harmonic.
// Odd/Even subtracts oddEven times the even-numbered partials (k = 2, 4, ..),
// which are the same series at twice the spacing with A squared.
double spacedKernel(double ct, double mt, const DsfKernelCoeffs& c,
                    const DsfKernelCoeffs& ce, double oddEven) {
  double sind = 0.0, cosd = 0.0;
  dsp_sin_cos_turns(wrap01(ct - mt), &sind, &cosd);
  double C = 0.0, S = 0.0;
  sineSawKernelCS(mt, c, C, S);
  double y = cosd * C - sind * S;
  if (oddEven != 0.0 && ce.n >= 1.0) {
    double Ce = 0.0, Se = 0.0;
    sineSawKernelCS(wrap01(2.0 * mt), ce, Ce, Se);
    y -= oddEven * (cosd * Ce - sind * Se) / c.twoK2;
  }
  return y;
}

// exp(x) for small negative x (here always in roughly [-0.12, 0], since
// dt = frequency/sampleRate is bounded and scaled down before use) -- a
// short Taylor series around 0 is accurate to ~4e-9 over that range, no
// range reduction needed. Freestanding WASM has no libm exp().
double expSmallApprox(double x) {
  return 1.0 + x * (1.0 + x * (0.5 + x * (1.0 / 6.0 + x * (1.0 / 24.0 + x * (1.0 / 120.0)))));
}

// Every leaky-integrator accumulator below needs its retention scaled to
// the oscillation period, not a fixed per-sample constant. A fixed
// retention of 0.999 (~1000-sample memory) is far shorter than the
// period at low frequencies (2400+ samples at 20 Hz), so the accumulator
// forgets mid-ramp and produces a distorted, asymmetric shape instead of
// a clean waveform -- verified numerically (Python) as the real cause of
// reported low-frequency distortion, not a WASM-only artifact. This gives
// ~20 periods of memory (decayed to ~1%) at any frequency, keeping every
// waveform's shape and DC symmetry consistent across the audible range.
double adaptiveRetention(double dt) {
  const double step = dt < 0.0 ? -dt : dt;
  return expSmallApprox(-0.23026 * step);
}

constexpr int kMaxInstances = 16;

struct DsfOscillatorState {
  bool active;
  double t;            // phase, 0..1
  double sawAcc;       // Saw's leaky-integrator accumulator
  double sqAcc;        // Square (PWM)'s leaky-integrator accumulator
  double blendSqAcc;   // Blend's own fixed-50%-duty square accumulator --
                        // decoupled from PWM's pulseWidth on purpose (see
                        // sample() comment).
  double triAcc;       // Trimorph's second-stage leaky-integrator accumulator
  double triPeak;      // Trimorph's adaptive peak-follower
  double out;
  double renderPhase;  // face playhead: free-running t + Phase offset, 0..1
  DsfKernelCoeffs kernelLo;  // n0 - 1 partials (top partial faded out)
  DsfKernelCoeffs kernelHi;  // n0 partials (top partial fully in)
  double frac;               // fade of the top partial, 0..1
  double tm;                 // modulator phase (Spacing x frequency), 0..1
  double spacing;            // partial ratio, 1 = harmonic
  double oddEven;            // 0 all partials, 1 odd only
  DsfKernelCoeffs evenLo;    // even-only series matching kernelLo
  DsfKernelCoeffs evenHi;    // even-only series matching kernelHi
};

double spacedFaded(double ct, double mt, const DsfOscillatorState& s) {
  const double lo = spacedKernel(ct, mt, s.kernelLo, s.evenLo, s.oddEven);
  if (s.frac <= 0.0) return lo;
  const double hi = spacedKernel(ct, mt, s.kernelHi, s.evenHi, s.oddEven);
  return lo + (hi - lo) * s.frac;
}

// Crossfade of the two integer-count kernels. Both stay under Nyquist.
double fadedKernel(double turns, const DsfOscillatorState& s) {
  const double lo = sineSawKernel(turns, s.kernelLo);
  if (s.frac <= 0.0) return lo;
  const double hi = sineSawKernel(turns, s.kernelHi);
  return lo + (hi - lo) * s.frac;
}

static DsfOscillatorState gPool[kMaxInstances];

}  // namespace

extern "C" int soemdsp_dsf_oscillator_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      gPool[i] = DsfOscillatorState{};
      gPool[i].active = true;
      gPool[i].triPeak = 1.0;
      gPool[i].spacing = 1.0;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_dsf_oscillator_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_dsf_oscillator_reset(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  DsfOscillatorState& s = gPool[handle - 1];
  s.t = 0.0;
  s.tm = 0.0;
  s.sawAcc = 0.0;
  s.sqAcc = 0.0;
  s.blendSqAcc = 0.0;
  s.triAcc = 0.0;
  s.triPeak = 1.0;
}

// Spacing (partial ratio, 1 harmonic) and Odd/Even (0 all, 1 odd only).
extern "C" void soemdsp_dsf_oscillator_set_spectrum(int handle, double spacing, double oddEven) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].spacing = spacing;
  gPool[handle - 1].oddEven = oddEven;
}

// waveform: 0=Sine, 1=Saw, 2=Square (PWM), 3=Trimorph, 4=SquSaw
// morph: 0..1 (Morph / harmonic richness) -- 0 is an exact sine, 1 is the full
// Nyquist-safe harmonic count.
// pulseWidth: 0..1 -- Square/Trimorph's duty cycle (0.5 = symmetric).
// blend: 0..1 -- Saw/Square crossfade amount for the SquSaw waveform.
// phase: 0..1 cycles -- pure time offset on the free-running phase.
// level: amplitude gain.
extern "C" void soemdsp_dsf_oscillator_sample(
  int handle,
  double frequencyHz,
  double sampleRate,
  int waveform,
  double morph,
  double pulseWidth,
  double blend,
  double phase,
  double level
) {
  if (handle < 1 || handle > kMaxInstances) return;
  DsfOscillatorState& s = gPool[handle - 1];

  const double safeSampleRate = sampleRate > 1.0 ? sampleRate : 48000.0;
  // Through-zero: signed frequency (dt may be negative).
  const double absFrequency = frequencyHz < 0.0 ? -frequencyHz : frequencyHz;
  const double safeAbsFrequency = absFrequency > 1.0e-6 ? absFrequency : 1.0e-6;
  const double dt = clamp(frequencyHz / safeSampleRate, -0.5, 0.5);
  const double phaseOffset = wrap01(phase);

  double sample;
  if (waveform == 0) {
    s.t = wrap01(s.t + dt);
    s.renderPhase = wrap01(s.t + phaseOffset);
    sample = sinApprox(s.renderPhase * kPi * 2.0);
  } else {
    const double nyquist = safeSampleRate * 0.5;
    const bool harmonic = s.spacing == 1.0 && s.oddEven == 0.0;
    double nf;
    if (harmonic) {
      nf = sawPartials(nyquist, safeAbsFrequency);
    } else {
      // Highest partial f*(1 + (n-1)*|s|) stays one f under Nyquist, as in
      // the harmonic count. |s| floor only guards the divide.
      double absS = s.spacing < 0.0 ? -s.spacing : s.spacing;
      if (absS < 1.0e-9) absS = 1.0e-9;
      nf = (nyquist / safeAbsFrequency - 2.0) / absS + 1.0;
      if (nf < 1.0) nf = 1.0;
      if (nf > 4096.0) nf = 4096.0;
    }
    const double n0 = static_cast<double>(static_cast<int>(nf));
    const double nLo = n0 > 1.0 ? n0 - 1.0 : 1.0;
    s.frac = n0 > 1.0 ? nf - n0 : 0.0;
    prepareSawCoeffs(s.kernelLo, morph, nLo);
    prepareSawCoeffs(s.kernelHi, morph, n0);
    if (!harmonic) {
      prepareSawCoeffsMul(s.evenLo, morph, static_cast<double>(static_cast<int>(nLo * 0.5)), 2.0);
      prepareSawCoeffsMul(s.evenHi, morph, static_cast<double>(static_cast<int>(n0 * 0.5)), 2.0);
    }
    // Signed dt runs the phase backward through zero. The 0.9999 is the
    // original guard against the closed form sitting exactly on a sample.
    s.t = wrap01(s.t + dt * 0.9999);
    s.tm = wrap01(s.tm + dt * s.spacing * 0.9999);
    const double renderT = wrap01(s.t + phaseOffset);
    const double renderM = wrap01(s.tm + phaseOffset * s.spacing);
    auto kern = [&](double back) {
      if (harmonic) return fadedKernel(wrap01(renderT - back), s);
      return spacedFaded(wrap01(renderT - back), wrap01(renderM - back * s.spacing), s);
    };
    s.renderPhase = renderT;

    const double retention = adaptiveRetention(dt);
    const double rawSaw = harmonic ? fadedKernel(renderT, s) : kern(0.0);
    s.sawAcc = s.sawAcc * retention + rawSaw * dt;

    if (waveform == 1) {
      sample = s.sawAcc;
    } else if (waveform == 4) {
      // SquSaw: crossfades Saw with a plain, fixed 50%-duty Square, kept
      // deliberately decoupled from the PWM slider -- simpler, and closer
      // to the very first Saw/Square crossfade this module had, which
      // just mixed two cleanly-shaped waveforms rather than inheriting
      // PWM's variable-duty shape.
      const double rawBlendSquare = rawSaw - kern(0.5);
      s.blendSqAcc = s.blendSqAcc * retention + rawBlendSquare * dt;
      const double b = clamp(blend, 0.0, 1.0);
      sample = s.sawAcc * (1.0 - b) + s.blendSqAcc * b;
    } else {
      const double pw = clamp(pulseWidth, 0.01, 0.99);
      const double rawShiftedSaw = kern(pw);
      const double rawSquare = rawSaw - rawShiftedSaw;
      s.sqAcc = s.sqAcc * retention + rawSquare * dt;

      if (waveform == 2) {
        sample = s.sqAcc;
      } else {  // waveform == 3: Trimorph
        s.triAcc = s.triAcc * retention + s.sqAcc * dt * 4.0;
        // Trimorph is a second integration on top of Square, which makes
        // it track mostly the square's fundamental harmonic -- and that
        // fundamental's own amplitude genuinely shrinks toward 0 as
        // pulseWidth approaches 0 or 1 (a real property of PWM pulse
        // trains: fundamental amplitude ~ sin(pi*dutyCycle)), reported
        // live as "gets quieter until silence" at extreme PWM. Square
        // itself doesn't have this problem since its many higher
        // harmonics keep its peak swing roughly constant as duty cycle
        // narrows -- only Trimorph, which discards most of that via its
        // second integration, needs the compensation. Verified
        // numerically (Python) that dividing by sin(pi*pulseWidth)
        // (floor to cap the gain right at the pulseWidth clamp's edges)
        // keeps Trimorph's loudness roughly constant across the full PWM
        // range instead of collapsing to silence at the extremes.
        const double sinPw = sinApprox(kPi * pw);
        const double compensation = 1.0 / clamp(sinPw < 0.0 ? -sinPw : sinPw, 0.05, 1.0);
        const double compensatedTri = s.triAcc * compensation;
        const double absTri = compensatedTri < 0.0 ? -compensatedTri : compensatedTri;
        s.triPeak = s.triPeak * 0.999 + absTri * 0.001;
        if (s.triPeak < 1.0) s.triPeak = 1.0;
        sample = compensatedTri / s.triPeak;
      }
    }
  }

  const bool finite = sample * 0.0 == 0.0;
  if (!finite) sample = 0.0;
  s.out = clamp(sample, -1.5, 1.5) * level;
}

extern "C" double soemdsp_dsf_oscillator_out(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].out;
}

// Face playhead (DSF display phase dot). Includes the Phase offset.
extern "C" double soemdsp_dsf_oscillator_phase(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].renderPhase;
}

extern "C" int soemdsp_dsf_oscillator_version() {
  return 16;
}
