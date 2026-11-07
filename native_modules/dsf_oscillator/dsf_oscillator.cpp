// soemdsp-native-module: dsf_oscillator
// soemdsp-native-label: DSF Oscillator
// soemdsp-native-target: dsfOscillator
// soemdsp-native-kind: oscillator
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp/blob/main/include/soemdsp/oscillator/DSFOscillator.hpp
//
// DSF Oscillator (type 46): harmonic SineSaw kit.
//   n      = fade of min(floor(Nyquist/f - 1), Partials, kMaxPartials)
//   k      = (1 - morph^0.14) * 4        // morph 0 = sine, 1 = saw
//   leak   = 2*pi*|increment| / 20                (v36: per phase, no floor)
//   acc    = acc * (1 - leak) + DSF() * increment
//   corr   = corr * (1 - leak) + leak * acc     (v36)
//   saw    = acc + corr                         (v36)
//   out    = acc * map(bright, 3.15, 2.7)
// The per-cycle drift correction tried in v34 introduced strong aliasing at
// high frequencies. The tracked leak is the stable DC blocker again.
// v36: the leak is per unit of phase travelled (2 pi / 20 per turn), with no
// floor. v35 clamped it to 0.0005 per sample, a 3.8 Hz high-pass at 48 kHz that
// flattened every saw below ~76 Hz. Per phase, the filter is the same at every
// pitch and under any FM, and a stalled phase (0 Hz) holds its state instead of
// decaying off the wave. Each saw chain also adds corr, its own leaky integral
// times the leak, which cancels the first-order bend of the leak: the response
// becomes 1 - (leak / (s + leak))^2, so the fundamental is off by 0.25 %
// instead of 5 %. Both are fixed linear filters in phase (nothing measured per
// cycle), so they add no aliasing. The chains start on the ideal wave.
// A Phase jump (> 0.05 turn in one sample) shifts every chain by the ideal
// wave's difference across the jump, so the slower leak does not leave the
// jump's offset ringing; smooth phase modulation is untouched.
// Phase step is increment * 0.9999 (keeps render off the exact wrap sample);
// the kernel itself is O(1) near the removable pole (stable den / Dirichlet).
// Params: Bright = the geometric tilt above (shape slot), Morph = Trimorph peak /
// PWM width (width slot), Blend = SquSaw saw-to-square (mix slot).
// Square = saw(t) - saw(t - Morph); SquSaw = saw crossfaded with a half-cycle square.
// v23: the t - Morph saw is its own chain, integrated by its own phase step, so
// moving Morph never leaves an integrator holding a stale shape. Trimorph = the
// second integrals of both chains subtracted (the saw integrated over the Morph
// window), level 1.3 / (Morph * (1 - Morph)), then a DC blocker. No peak follower.
// Stable under standard modulation; very fast Bright / Morph / deep audio-rate
// FM may still bump or clip (scripts/smoke_dsf_oscillator_stability.mjs).
//
// DSF Morphing Osc (type 232): one band-limited object.
//   Morph     geometric |a| (sine â†’ bright)
//   Symmetry  mix of +a and âˆ’a (saw â†’ alternating pulse)
//   Width     all harmonics â†’ odd-only square-to-sine DSF
//   Rotate    common phase on every partial
//   Slice     start partial (compositional brick / formant)
//   Spacing   Moorer ratio: partial k at f*(1+(k-1)*Spacing); 1 = harmonic
//   Odd/Even  0 = all partials of that series, 1 = drop even-numbered terms
// One leaky integrator. No PWM. Type 46 never applies Spacing / Odd/Even.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

double dsfPow(double base, double exponent) {
  if (!(base > 0.0)) return 0.0;
  return dsp_exp(exponent * dsp_ln(base));
}

double polySinHi(double x) {
  const double x2 = x * x;
  double s = -1.0 / 121645100408832000.0;
  s = 1.0 / 355687428096000.0 + x2 * s;
  s = -1.0 / 1307674368000.0 + x2 * s;
  s = 1.0 / 6227020800.0 + x2 * s;
  s = -1.0 / 39916800.0 + x2 * s;
  s = 1.0 / 362880.0 + x2 * s;
  s = -1.0 / 5040.0 + x2 * s;
  s = 1.0 / 120.0 + x2 * s;
  s = -1.0 / 6.0 + x2 * s;
  s = 1.0 + x2 * s;
  return x * s;
}

void kernelSinCosTurns(double turns, double* sOut, double* cOut) {
  double p = turns - dsp_floor(turns);
  int q = static_cast<int>(p * 4.0);
  if (q > 3) q = 3;
  const double r = p - 0.25 * static_cast<double>(q);
  const double sx = polySinHi(r * kTwoPi);
  const double sy = polySinHi((0.25 - r) * kTwoPi);
  switch (q) {
    case 0:  *sOut =  sx; *cOut =  sy; break;
    case 1:  *sOut =  sy; *cOut = -sx; break;
    case 2:  *sOut = -sx; *cOut = -sy; break;
    default: *sOut = -sy; *cOut =  sx; break;
  }
}

// Soft ceiling only: keeps int casts finite at near-zero Hz.
// At 48 kHz this still tracks Nyquist all the way down through ~0.023 Hz
// (1 Hz â†’ ~23999 partials). Not an audible-spectrum limiter.
constexpr double kMaxPartials = 1048576.0;
double sawPartials(double nyquist, double freq) {
  double n = nyquist / freq - 1.0;
  if (n < 1.0) n = 1.0;
  if (n > kMaxPartials) n = kMaxPartials;
  return n;
}

struct DsfKernelCoeffs {
  double morph;
  double n;
  double k42;
  double eightK2;
  double decay;
  double twoK2;
  double denCos;
  double ampAdjust;
  int ready;
};

void prepareSawCoeffs(DsfKernelCoeffs& c, double morph, double n) {
  if (c.ready && c.morph == morph && c.n == n) return;
  const double m = clamp(morph, 0.0, 1.0);
  const double k = (1.0 - dsfPow(m, 0.14)) * 4.0;
  const double k2 = k * k;
  c.morph = morph;
  c.n = n;
  c.k42 = dsp_exp2(2.0 * k2);
  c.eightK2 = dsp_exp2(3.0 * k2);
  c.decay = dsp_exp2(-k2 * (n + 1.0));
  c.twoK2 = dsp_exp2(k2);
  c.denCos = dsp_exp2(1.0 + k2);
  c.ampAdjust = m * (2.7 - 3.15) + 3.15;
  c.ready = 1;
}

// Stable O(1) Re/Im of Σ_{k=0}^{n-1} a^k exp(i (k+1) x)
//   = exp(i x) (1 - (a exp(i x))^n) / (1 - a exp(i x)), x = 2π turns.
// Denominator: (1-a)^2 + 4 a sin^2(x/2). When a≈1 use Dirichlet
// sin(n x/2)/sin(x/2) (same removable-pole limit BLIT uses). No O(N) loop.
void dsfGeoSumUnitCS(double turns, double a, double nCount, double& C, double& S) {
  double n = nCount;
  if (n < 0.0) n = 0.0;
  if (n > kMaxPartials) n = kMaxPartials;
  if (n < 1.0e-12) {
    C = 0.0;
    S = 0.0;
    return;
  }
  if (a < 0.0) a = 0.0;

  double sinx = 0.0, cosx = 0.0;
  kernelSinCosTurns(turns, &sinx, &cosx);
  double sinHalf = 0.0, cosHalf = 0.0;
  kernelSinCosTurns(0.5 * turns, &sinHalf, &cosHalf);
  const double den2 = (1.0 - a) * (1.0 - a) + 4.0 * a * sinHalf * sinHalf;

  if (den2 < 1.0e-30) {
    C = n;
    S = 0.0;
    return;
  }

  // a≈1: Dirichlet kernel (exact at a=1).
  if (a > 1.0 - 1.0e-12) {
    if (sinHalf > -1.0e-15 && sinHalf < 1.0e-15) {
      C = n;
      S = 0.0;
      return;
    }
    double sn = 0.0, cn = 0.0;
    kernelSinCosTurns(0.5 * n * turns, &sn, &cn);
    double sa = 0.0, ca = 0.0;
    kernelSinCosTurns(0.5 * (n + 1.0) * turns, &sa, &ca);
    const double scale = sn / sinHalf;
    C = scale * ca;
    S = scale * sa;
    return;
  }

  // General a with stable |1 - a e^{ix}|^2.
  const double zr = a * cosx;
  const double zi = a * sinx;
  const double rn = dsfPow(a, n);
  double pr = 0.0, pi = 0.0;
  kernelSinCosTurns(n * turns, &pi, &pr);  // sin=pi out, cos=pr out → e^{i n x}
  // kernelSinCosTurns writes sin then cos into (&s,&c) — we passed (&pi, &pr)
  // so pi=sin(n x), pr=cos(n x). Good.
  const double zn_r = rn * pr;
  const double zn_i = rn * pi;
  const double num_r = 1.0 - zn_r;
  const double num_i = -zn_i;
  const double den_r = 1.0 - zr;
  const double den_i = -zi;
  const double inv = 1.0 / den2;
  const double qr = (num_r * den_r + num_i * den_i) * inv;
  const double qi = (num_i * den_r - num_r * den_i) * inv;
  C = cosx * qr - sinx * qi;
  S = cosx * qi + sinx * qr;
}

double sineSawKernel(double turns, const DsfKernelCoeffs& c) {
  const double a = c.twoK2 > 0.0 ? 1.0 / c.twoK2 : 1.0;
  double C = 0.0, S = 0.0;
  dsfGeoSumUnitCS(turns, a, c.n, C, S);
  return C;
}

int seriesCount(double start, double step, double end) {
  const double absStep = step < 0.0 ? -step : step;
  if (absStep < 1.0e-12) return 0;
  double n = (end - start) / absStep + 1.0;
  if (n < 1.0) return 0;
  if (n > kMaxPartials) n = kMaxPartials;
  return static_cast<int>(dsp_floor(n + 1.0e-12));
}

// Geometric sum_{k=0}^{count-1} r^k exp(i 2Ï€ (start + kÂ·step) turns + i 2Ï€ rot)
// Geometric sum_{k=0}^{count-1} r^k exp(i 2π (start + k·step) turns + i 2π rot)
// = A (1 - z^count)/(1 - z), z = r exp(i φ), φ = 2π step turns, A = exp(i 2π (start turns+rot)).
// O(1) always: stable |1-z|^2 = (1-r)^2 + 4 r sin^2(φ/2); Dirichlet when r≈1.
void geoSeriesCS(
  double r,
  double start,
  double step,
  int count,
  double turns,
  double rotTurns,
  double& C,
  double& S
) {
  if (count < 1) {
    C = 0.0;
    S = 0.0;
    return;
  }
  double sinA = 0.0, cosA = 0.0;
  kernelSinCosTurns(turns * start + rotTurns, &sinA, &cosA);
  if (count == 1) {
    C = cosA;
    S = sinA;
    return;
  }
  double sinZ = 0.0, cosZ = 0.0;
  kernelSinCosTurns(turns * step, &sinZ, &cosZ);

  // Stable |1 - r e^{iφ}|^2, φ = 2π step·turns. Identity holds for negative r.
  double sinHalf = 0.0, cosHalf = 0.0;
  kernelSinCosTurns(0.5 * turns * step, &sinHalf, &cosHalf);
  double den2 = (1.0 - r) * (1.0 - r) + 4.0 * r * sinHalf * sinHalf;
  if (den2 < 0.0) den2 = 0.0;

  if (den2 < 1.0e-30) {
    C = static_cast<double>(count) * cosA;
    S = static_cast<double>(count) * sinA;
    return;
  }

  // r≈+1: Dirichlet A * e^{i (count-1)φ/2} * sin(count φ/2) / sin(φ/2)
  if (r > 1.0 - 1.0e-12 && r < 1.0 + 1.0e-12) {
    if (sinHalf > -1.0e-15 && sinHalf < 1.0e-15) {
      C = static_cast<double>(count) * cosA;
      S = static_cast<double>(count) * sinA;
      return;
    }
    const double n = static_cast<double>(count);
    double sn = 0.0, cn = 0.0;
    kernelSinCosTurns(0.5 * n * turns * step, &sn, &cn);
    double ci = 0.0, cr = 0.0;
    kernelSinCosTurns(0.5 * (n - 1.0) * turns * step, &ci, &cr);
    const double scale = sn / sinHalf;
    C = scale * (cosA * cr - sinA * ci);
    S = scale * (cosA * ci + sinA * cr);
    return;
  }

  const double zr = r * cosZ;
  const double zi = r * sinZ;
  const double denr = 1.0 - zr;
  const double deni = -zi;
  const double mag = r < 0.0 ? -r : r;
  double rm = dsfPow(mag, static_cast<double>(count));
  if (r < 0.0 && (count & 1)) rm = -rm;
  double sinM = 0.0, cosM = 0.0;
  kernelSinCosTurns(turns * step * static_cast<double>(count), &sinM, &cosM);
  const double zmr = rm * cosM;
  const double zmi = rm * sinM;
  const double numr = 1.0 - zmr;
  const double numi = -zmi;
  const double inv = 1.0 / den2;
  const double qr = (numr * denr + numi * deni) * inv;
  const double qi = (numi * denr - numr * deni) * inv;
  C = cosA * qr - sinA * qi;
  S = cosA * qi + sinA * qr;
}

double morphImpulse(
  double turns,
  double a,
  int start,
  int end,
  double rotTurns,
  double width,
  double symmetry,
  double spacing,
  double oddEven
) {
  if (end < start) return 0.0;
  const double w = clamp(width, 0.0, 1.0);
  const double sym = clamp(symmetry, 0.0, 1.0);
  const double oe = clamp(oddEven, 0.0, 1.0);
  double sp = spacing;
  if (!(sp > 1.0e-9) && !(sp < -1.0e-9)) sp = 1.0;
  const double startD = static_cast<double>(start);
  const double endD = static_cast<double>(end);
  auto kernelR = [&](double r) {
    double Call = 0.0, Sall = 0.0, Codd = 0.0, Sodd = 0.0, Ceven = 0.0, Seven = 0.0;
    if (w < 1.0) {
      geoSeriesCS(r, startD, sp, seriesCount(startD, sp, endD), turns, rotTurns, Call, Sall);
      if (oe > 0.0) {
        const double evenStart = startD + sp;
        const int nEven = seriesCount(evenStart, 2.0 * sp, endD);
        if (nEven > 0) {
          geoSeriesCS(r * r, evenStart, 2.0 * sp, nEven, turns, rotTurns, Ceven, Seven);
          Call -= oe * r * Ceven;
        }
      }
    }
    if (w > 0.0) {
      int oddStart = start;
      if ((oddStart & 1) == 0) oddStart += 1;
      if (oddStart <= end) {
        const double oddStartD = static_cast<double>(oddStart);
        geoSeriesCS(r, oddStartD, 2.0, seriesCount(oddStartD, 2.0, endD), turns, rotTurns, Codd, Sodd);
      }
    }
    return Call * (1.0 - w) + Codd * w;
  };
  if (sym <= 0.0) return kernelR(a);
  if (sym >= 1.0) return kernelR(-a);
  return kernelR(a) * (1.0 - sym) + kernelR(-a) * sym;
}

constexpr int kMaxInstances = 16;

void prepareSawCoeffsMul(DsfKernelCoeffs& c, double morph, double n, double mult) {
  if (c.ready && c.morph == morph && c.n == n) return;
  const double m = clamp(morph, 0.0, 1.0);
  const double k = (1.0 - dsfPow(m, 0.14)) * 4.0;
  const double k2 = k * k * mult;
  c.morph = morph;
  c.n = n;
  c.k42 = dsp_exp2(2.0 * k2);
  c.eightK2 = dsp_exp2(3.0 * k2);
  c.decay = dsp_exp2(-k2 * (n + 1.0));
  c.twoK2 = dsp_exp2(k2);
  c.denCos = dsp_exp2(1.0 + k2);
  c.ampAdjust = m * (2.7 - 3.15) + 3.15;
  c.ready = 1;
}

void sineSawKernelCS(double turns, const DsfKernelCoeffs& c, double& C, double& S) {
  const double a = c.twoK2 > 0.0 ? 1.0 / c.twoK2 : 1.0;
  dsfGeoSumUnitCS(turns, a, c.n, C, S);
}

// Moorer: partial k at f*(1+(k-1)*spacing). Odd/Even subtracts the even series.
double spacedKernel(double ct, double mt, const DsfKernelCoeffs& c,
                    const DsfKernelCoeffs& ce, double oddEven) {
  double sind = 0.0, cosd = 0.0;
  kernelSinCosTurns(wrap01(ct - mt), &sind, &cosd);
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

// Trimorph level: (saw integral over the Morph window) / (Morph * (1 - Morph)),
// scaled to sit with Saw (measured 0.53..0.77 before this gain at any Morph /
// Bright / pitch, so about 0.7..1.0 after).
constexpr double kTrimorphGain = 1.3;
constexpr double kDsfLeakDivisor = 20.0;
// A Phase change bigger than this in one sample is a jump (v36), shifted at
// most once per kDsfPhaseJumpHold samples (bounds the cost under extreme PM).
constexpr double kDsfPhaseJump = 0.05;
constexpr int kDsfPhaseJumpHold = 32;

// Leak per turn of phase travelled (cutoff f / 20).
constexpr double kDsfLeakPerTurn = kTwoPi / kDsfLeakDivisor;

// Per-sample leak: 2 pi / 20 per turn of phase travelled (cutoff f / 20).
inline double dsfLeakTarget(double absFrequency, double sampleRate) {
  return kTwoPi * absFrequency / (kDsfLeakDivisor * sampleRate);
}

struct DsfOscillatorRotateCache {
  bool ready;
  // Control rate: the gain is recomputed every kDsfRotateGainBlock samples
  // and glides linearly in between (a moving Rotate cost ~5x the oscillator
  // when recomputed every sample).
  bool running;
  double lastRot;
  int countdown;
  double level;
  double step;
  double aEff;
  double n;
  double rot;
  double peak0;
  double gain;
};

struct DsfOscillatorState {
  bool active;
  double t;
  double leak;
  double sawAcc;
  double blendSqAcc;
  // Square (PWM) / Trimorph: chain B is the saw kernel at phase t - Morph,
  // integrated by its own phase step, so it tracks the shifted saw while Morph
  // moves (no integrator holds a stale Morph). Square = A - B. Trimorph = the
  // second integrals of A and B, subtracted.
  double sawB;
  double triA;
  double triB;
  // v36 leak compensation: leak * each saw chain's own leaky integral.
  double sawJ;
  double blendSqJ;
  double sawBJ;
  bool primed;
  // Phase input last sample, and samples since the last jump shift (v36).
  double prevOffset;
  int jumpHold;
  // DSF Morphing Osc: Rotate last sample (a Rotate jump is shifted too).
  double prevRot;
  // DSF Morphing Osc Rotate level compensation (v36).
  DsfOscillatorRotateCache rotGain;
  double prevPw;
  bool chainB;
  // Trimorph output DC blocker.
  double triDcIn;
  double triDcOut;
  // The blocker starts settled on the first Trimorph sample (v36): the chains
  // start zero-mean, so starting it at 0 only left a slow vertical offset.
  bool triDcPrime;
  double out;
  double renderPhase;
  DsfKernelCoeffs kernelLo;
  DsfKernelCoeffs kernelHi;
  DsfKernelCoeffs evenLo;
  DsfKernelCoeffs evenHi;
  double frac;
  double tm;
  double oddEven;
};

// Start values for a chain: the ideal integral I(t) = sum a^j sin(2 pi h
// t) / (2 pi h) and second integral J(t) = -sum a^j cos(2 pi h t) / (2 pi h)^2,
// h = j + 1, from the first kDsfInitTerms partials (J converges like 1/h^2).
// Used once when
// Square / Trimorph's chain B starts (note start, Reset, waveform change), so
// the chains begin on the wave instead of at 0.
constexpr int kDsfInitTerms = 256;

void idealIntegrals(double turns, const DsfKernelCoeffs& c, double& I, double& J) {
  const double a = c.twoK2 > 0.0 ? 1.0 / c.twoK2 : 1.0;
  int n = static_cast<int>(c.n);
  if (n > kDsfInitTerms) n = kDsfInitTerms;
  I = 0.0;
  J = 0.0;
  double w = 1.0;
  for (int j = 0; j < n; j++) {
    const double h = static_cast<double>(j + 1);
    double sn = 0.0, cs = 0.0;
    kernelSinCosTurns(wrap01(h * turns), &sn, &cs);
    const double inv = 1.0 / (kTwoPi * h);
    I += w * sn * inv;
    J -= w * cs * inv * inv;
    w *= a;
  }
}

// The leaky chain's steady state (v36): per partial h, the leaky integral of
// cos(2 pi h t) with leak alpha per turn is (w sin + alpha cos) / D,
// w = 2 pi h, D = w^2 + alpha^2, and corr = alpha * the leaky integral of that
// = alpha (2 w alpha sin + (alpha^2 - w^2) cos) / D^2. alpha < 0 when the phase
// runs backwards. Starting (and Phase-jump shifting) the chains here leaves
// no start-up transient.
void leakyIntegrals(double turns, const DsfKernelCoeffs& c, double alpha, double& I, double& Q) {
  const double a = c.twoK2 > 0.0 ? 1.0 / c.twoK2 : 1.0;
  int n = static_cast<int>(c.n);
  if (n > kDsfInitTerms) n = kDsfInitTerms;
  I = 0.0;
  Q = 0.0;
  double amp = 1.0;
  const double a2 = alpha * alpha;
  for (int j = 0; j < n; j++) {
    const double w = kTwoPi * static_cast<double>(j + 1);
    double sn = 0.0, cs = 0.0;
    kernelSinCosTurns(wrap01(static_cast<double>(j + 1) * turns), &sn, &cs);
    const double d = w * w + a2;
    I += amp * (w * sn + alpha * cs) / d;
    Q += amp * alpha * (2.0 * w * alpha * sn + (a2 - w * w) * cs) / (d * d);
    amp *= a;
  }
}

// DSF Morphing Osc Rotate level (v36). Rotate keeps the energy but moves the
// peak: the integrated series rotated by phi is
//   f(x) = cos(phi) atan2(a sin x, 1 - a cos x) - sin(phi) ln(1 - 2 a cos x + a^2) / 2
// (all partials; the partial count n enters as a <= 1 - 0.5615 / n, which
// gives the harmonic sum ln n + 0.577 at a = 1). Its peaks crowd around x = 0
// as a -> 1, so x is searched on points spaced geometrically from 1 - a. A
// cut-off series overshoots its jump (Gibbs, 17.9 %) by as much as its top
// partial still sounds, so the unrotated term is scaled by 1 + 0.179 a^n.
// Measured against exact finite sums: within -11 % / +6 % of the Rotate 0 level.
// The output is scaled by peak(phi = 0) / peak(phi): Rotate no longer clips,
// and Rotate 0 is unchanged.
double dsfAtan2(double y, double x) {
  const double ax = x < 0.0 ? -x : x;
  const double ay = y < 0.0 ? -y : y;
  if (ax < 1.0e-300 && ay < 1.0e-300) return 0.0;
  const bool swap = ay > ax;
  const double t = swap ? ax / ay : ay / ax;
  double z = t;
  double base = 0.0;
  if (t > 0.41421356237) {
    z = (t - 1.0) / (t + 1.0);
    base = 0.25 * kTwoPi * 0.5;
  }
  const double z2 = z * z;
  const double p = z * (1.0 + z2 * (-1.0 / 3.0 + z2 * (1.0 / 5.0 + z2 * (-1.0 / 7.0
    + z2 * (1.0 / 9.0 + z2 * (-1.0 / 11.0 + z2 * (1.0 / 13.0 + z2 * (-1.0 / 15.0))))))));
  double r = base + p;
  if (swap) r = 0.25 * kTwoPi - r;
  if (x < 0.0) r = 0.5 * kTwoPi - r;
  return y < 0.0 ? -r : r;
}

double rotatedPeak(double a, double gibbs, double cosR, double sinR) {
  double peak = 0.0;
  auto at = [&](double turns) {
    double sn = 0.0, cs = 0.0;
    kernelSinCosTurns(wrap01(turns), &sn, &cs);
    const double q = 1.0 - 2.0 * a * cs + a * a;
    const double f = cosR * gibbs * dsfAtan2(a * sn, 1.0 - a * cs) - sinR * 0.5 * dsp_ln(q > 1.0e-300 ? q : 1.0e-300);
    const double m = f < 0.0 ? -f : f;
    if (m > peak) peak = m;
  };
  const double e = (1.0 - a) / kTwoPi;  // turns
  for (int k = -8; k < 80; k++) {
    const double x = e * dsp_exp2(0.5 * static_cast<double>(k));
    if (x > 0.5) break;
    at(x);
    at(-x);
  }
  at(0.0);
  at(0.5);
  return peak;
}

double rotateGain(DsfOscillatorRotateCache& c, double a, double n, double rotTurns) {
  double aEff = a;
  const double cap = 1.0 - 0.5615 / (n > 1.0 ? n : 1.0);
  if (aEff > cap) aEff = cap;
  if (aEff < 1.0e-6) return 1.0;
  double r = wrap01(rotTurns);
  if (r > 0.5) r -= 1.0;
  if (r > -1.0e-9 && r < 1.0e-9) return 1.0;
  if (c.ready && c.aEff == aEff && c.n == n && c.rot == r) return c.gain;
  const double gibbs = 1.0 + 0.179 * dsfPow(a, n);
  if (!c.ready || c.aEff != aEff || c.n != n) {
    c.peak0 = rotatedPeak(aEff, gibbs, 1.0, 0.0);
    c.aEff = aEff;
    c.n = n;
  }
  double sn = 0.0, cs = 0.0;
  kernelSinCosTurns(wrap01(r), &sn, &cs);
  const double pr = rotatedPeak(aEff, gibbs, cs, sn);
  c.rot = r;
  c.gain = pr > 1.0e-12 ? c.peak0 / pr : 1.0;
  c.ready = true;
  return c.gain;
}

constexpr int kDsfRotateGainBlock = 32;

// Per-sample Rotate level: control-rate rotateGain with a linear glide.
double rotateLevel(DsfOscillatorRotateCache& c, double a, double n, double rotTurns) {
  double jump = rotTurns - c.lastRot;
  jump -= dsp_floor(jump + 0.5);
  c.lastRot = rotTurns;
  // A Rotate jump snaps the level (a glide would let the unscaled peak through).
  if (!c.running || jump > kDsfPhaseJump || jump < -kDsfPhaseJump) {
    c.level = rotateGain(c, a, n, rotTurns);
    c.step = 0.0;
    c.countdown = kDsfRotateGainBlock;
    c.running = true;
    return c.level;
  }
  if (--c.countdown <= 0) {
    const double target = rotateGain(c, a, n, rotTurns);
    c.step = (target - c.level) / static_cast<double>(kDsfRotateGainBlock);
    c.countdown = kDsfRotateGainBlock;
  }
  c.level += c.step;
  return c.level;
}

// DSF Morphing Osc steady state (v36), the same per-partial closed form:
// a term amp * cos(2 pi phase) at rate partials-per-turn adds its leaky
// integral to I and its correction (leak * leaky integral of that) to Q.
inline void addLeakyTerm(double amp, double phaseTurns, double rate, double alpha, double& I, double& Q) {
  const double w = kTwoPi * rate;
  double sn = 0.0, cs = 0.0;
  kernelSinCosTurns(wrap01(phaseTurns), &sn, &cs);
  const double a2 = alpha * alpha;
  const double d = w * w + a2;
  I += amp * (alpha * cs + w * sn) / d;
  Q += amp * alpha * (cs * (a2 - w * w) + sn * 2.0 * alpha * w) / (d * d);
}

// Harmonic Morphing kernel (morphImpulse, Spacing 1): partials start..end,
// amplitude r^(h - start) for r = a and -a (Symmetry), odd offsets times
// (1 - Odd/Even), Width mixes in the odd-partial series, Rotate adds a phase.
void morphHarmonicLeaky(double at, double a, int start, int end, double rotTurns, double width,
                        double symmetry, double oddEven, double alpha, double weight, double& I, double& Q) {
  const double w = clamp(width, 0.0, 1.0);
  const double sym = clamp(symmetry, 0.0, 1.0);
  const double oe = clamp(oddEven, 0.0, 1.0);
  const double rs[2] = {a, -a};
  const double rw[2] = {1.0 - sym, sym};
  for (int side = 0; side < 2; side++) {
    if (rw[side] <= 0.0) continue;
    const double r = rs[side];
    const double g = weight * rw[side];
    if (w < 1.0) {
      double rk = 1.0;
      for (int h = start, i = 0; h <= end && i < kDsfInitTerms; h++, i++) {
        const double amp = g * (1.0 - w) * rk * (((h - start) & 1) ? 1.0 - oe : 1.0);
        if (amp != 0.0) addLeakyTerm(amp, static_cast<double>(h) * at + rotTurns, static_cast<double>(h), alpha, I, Q);
        rk *= r;
        if (rk < 1.0e-14 && rk > -1.0e-14) break;
      }
    }
    if (w > 0.0) {
      int oddStart = start;
      if ((oddStart & 1) == 0) oddStart += 1;
      double rk = 1.0;
      for (int h = oddStart, i = 0; h <= end && i < kDsfInitTerms; h += 2, i++) {
        addLeakyTerm(g * w * rk, static_cast<double>(h) * at + rotTurns, static_cast<double>(h), alpha, I, Q);
        rk *= r;
        if (rk < 1.0e-14 && rk > -1.0e-14) break;
      }
    }
  }
}

// Inharmonic Morphing kernel (spacedKernel): partial j at rate 1 + j Spacing,
// phase ct + j mt, amplitude a^j (odd j times 1 - Odd/Even).
void morphSpacedLeaky(double ct, double mt, double a, int count, double spacing, double oddEven,
                      double alpha, double weight, double& I, double& Q) {
  const double oe = clamp(oddEven, 0.0, 1.0);
  double aj = 1.0;
  for (int j = 0; j < count && j < kDsfInitTerms; j++) {
    const double amp = weight * aj * ((j & 1) ? 1.0 - oe : 1.0);
    if (amp != 0.0) addLeakyTerm(amp, ct + static_cast<double>(j) * mt, 1.0 + static_cast<double>(j) * spacing, alpha, I, Q);
    aj *= a;
    if (aj < 1.0e-14) break;
  }
}

double fadedKernel(double turns, const DsfOscillatorState& s) {
  const double lo = sineSawKernel(turns, s.kernelLo);
  if (s.frac <= 0.0) return lo;
  const double hi = sineSawKernel(turns, s.kernelHi);
  return lo + (hi - lo) * s.frac;
}

double fadedMorph(
  double turns,
  const DsfOscillatorState& s,
  double a,
  int startLo,
  int startHi,
  double rotTurns,
  double width,
  double symmetry,
  double spacing,
  double oddEven
) {
  const int endLo = static_cast<int>(s.kernelLo.n);
  const double lo = morphImpulse(turns, a, startLo, endLo, rotTurns, width, symmetry, spacing, oddEven);
  if (s.frac <= 0.0) return lo;
  const int endHi = static_cast<int>(s.kernelHi.n);
  const double hi = morphImpulse(turns, a, startHi, endHi, rotTurns, width, symmetry, spacing, oddEven);
  return lo + (hi - lo) * s.frac;
}

static DsfOscillatorState gPool[kMaxInstances];

void preparePartials(
  DsfOscillatorState& s,
  double morph,
  double nyquist,
  double freq,
  double spacing = 1.0,
  double partials = kMaxPartials
) {
  double nf;
  double absS = spacing < 0.0 ? -spacing : spacing;
  if (absS < 1.0e-9 || (absS > 0.999999 && absS < 1.000001)) {
    nf = sawPartials(nyquist, freq);
  } else {
    nf = (nyquist / freq - 2.0) / absS + 1.0;
    if (nf < 1.0) nf = 1.0;
    if (nf > kMaxPartials) nf = kMaxPartials;
  }
  // Partials user cap. No sentinel: max == kMaxPartials is effectively unlimited.
  // Existing nLo/nHi fade crossfades the top partial when the cap is fractional.
  {
    double cap = partials;
    if (cap < 1.0) cap = 1.0;
    if (cap > kMaxPartials) cap = kMaxPartials;
    if (nf > cap) nf = cap;
  }
  double nLo = dsp_floor(nf);
  if (nLo < 1.0) nLo = 1.0;
  const double nHi = nLo < kMaxPartials ? nLo + 1.0 : nLo;
  s.frac = (nHi > nLo) ? (nf - nLo) : 0.0;
  prepareSawCoeffs(s.kernelLo, morph, nLo);
  if (s.frac > 0.0) prepareSawCoeffs(s.kernelHi, morph, nHi);
}

int sliceStart(double slice, double n) {
  double a = 1.0 + clamp(slice, 0.0, 1.0) * (n - 1.0);
  int start = static_cast<int>(dsp_floor(a + 1.0e-12));
  if (start < 1) start = 1;
  const int nI = static_cast<int>(n);
  if (start > nI) start = nI < 1 ? 1 : nI;
  return start;
}

}  // namespace

extern "C" int soemdsp_dsf_oscillator_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      gPool[i] = DsfOscillatorState{};
      gPool[i].active = true;
      gPool[i].leak = 1.0;
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
  s.leak = 1.0;
  s.sawAcc = 0.0;
  s.blendSqAcc = 0.0;
  s.sawB = 0.0;
  s.triA = 0.0;
  s.triB = 0.0;
  s.sawJ = 0.0;
  s.blendSqJ = 0.0;
  s.sawBJ = 0.0;
  s.primed = false;
  s.rotGain = DsfOscillatorRotateCache{};
  s.chainB = false;
  s.triDcIn = 0.0;
  s.triDcOut = 0.0;
}

extern "C" void soemdsp_dsf_oscillator_set_spectrum(int handle, double, double) {
  (void)handle;
}

extern "C" void soemdsp_dsf_oscillator_sample(
  int handle,
  double frequencyHz,
  double sampleRate,
  int waveform,
  double morph,
  double pulseWidth,
  double blend,
  double phase,
  double level,
  double partials
) {
  if (handle < 1 || handle > kMaxInstances) return;
  DsfOscillatorState& s = gPool[handle - 1];

  const double safeSampleRate = sampleRate > 1.0 ? sampleRate : 48000.0;
  const double absFrequency = frequencyHz < 0.0 ? -frequencyHz : frequencyHz;
  const double safeAbsFrequency = absFrequency > 1.0e-6 ? absFrequency : 1.0e-6;
  const double dt = clamp(frequencyHz / safeSampleRate, -0.5, 0.5);
  const double phaseOffset = wrap01(phase);

  double sample;
  if (waveform == 0) {
    s.t = wrap01(s.t + dt);
    s.renderPhase = wrap01(s.t + phaseOffset);
    s.chainB = false;
    s.primed = false;
    double sinx = 0.0, cosx = 0.0;
    dsp_sin_cos_turns(s.renderPhase, &sinx, &cosx);
    sample = sinx;
  } else {
    const double nyquist = safeSampleRate * 0.5;
    preparePartials(s, morph, nyquist, safeAbsFrequency, 1.0, partials);

    const double step = dt * 0.9999;
    s.t = wrap01(s.t + step);
    const double renderT = wrap01(s.t + phaseOffset);
    // Two midpoint sub-steps per sample (v34): the kernel is sampled at the
    // middles of the two half steps behind this sample. Centred, so the
    // integral sits on the sample's own phase (a plain running sum leads by
    // half a sample, which moved every jump); two of them keep the sampled
    // integral's high-harmonic lift x/sin(x) to < +0.6 dB at 20 kHz (one
    // sample per step lifted 20 kHz by +2.6 dB).
    const double q1 = 0.25 * step;
    const double q3 = 0.75 * step;
    auto kern = [&](double back) {
      const double at = renderT - back;
      return 0.5 * (fadedKernel(wrap01(at - q1), s) + fadedKernel(wrap01(at - q3), s));
    };
    s.renderPhase = renderT;

    // The DC-blocking leak follows the phase step exactly (v36).
    const double leakTarget = dsfLeakTarget(safeAbsFrequency, safeSampleRate);
    if (!s.primed) {
      // Start on the wave (v36): the chains hold the ideal integrals of the
      // phase one step back, and the leak starts at its target.
      const double back = wrap01(renderT - step);
      const double alpha = dt < 0.0 ? -kDsfLeakPerTurn : kDsfLeakPerTurn;
      double i0 = 0.0, q0 = 0.0, iH = 0.0, qH = 0.0;
      leakyIntegrals(back, s.kernelLo, alpha, i0, q0);
      leakyIntegrals(wrap01(back - 0.5), s.kernelLo, alpha, iH, qH);
      s.sawAcc = i0;
      s.blendSqAcc = i0 - iH;
      s.sawJ = q0;
      s.blendSqJ = q0 - qH;
      s.leak = leakTarget;
      s.primed = true;
      s.prevOffset = phaseOffset;
      s.jumpHold = 0;
    }
    {
      double jump = phaseOffset - s.prevOffset;
      jump -= dsp_floor(jump + 0.5);
      s.prevOffset = phaseOffset;
      if (s.jumpHold > 0) s.jumpHold -= 1;
      if ((jump > kDsfPhaseJump || jump < -kDsfPhaseJump) && s.jumpHold == 0) {
        // The chains hold the wave one step back: shift each by the ideal
        // integrals' difference between the old and the new phase there.
        s.jumpHold = kDsfPhaseJumpHold;
        const double x1 = wrap01(renderT - step);
        const double x0 = wrap01(x1 - jump);
        const double alpha = dt < 0.0 ? -kDsfLeakPerTurn : kDsfLeakPerTurn;
        double i0, q0, i1, q1;
        leakyIntegrals(x0, s.kernelLo, alpha, i0, q0);
        leakyIntegrals(x1, s.kernelLo, alpha, i1, q1);
        s.sawAcc += i1 - i0;
        s.sawJ += q1 - q0;
        double h0, r0, h1, r1;
        leakyIntegrals(wrap01(x0 - 0.5), s.kernelLo, alpha, h0, r0);
        leakyIntegrals(wrap01(x1 - 0.5), s.kernelLo, alpha, h1, r1);
        s.blendSqAcc += (i1 - i0) - (h1 - h0);
        s.blendSqJ += (q1 - q0) - (r1 - r0);
        if (s.chainB) {
          const double pwNow = clamp(pulseWidth, 0.01, 0.99);
          double b0, c0, b1, c1;
          leakyIntegrals(wrap01(x0 - pwNow), s.kernelLo, alpha, b0, c0);
          leakyIntegrals(wrap01(x1 - pwNow), s.kernelLo, alpha, b1, c1);
          s.sawB += b1 - b0;
          s.sawBJ += c1 - c0;
          // Trimorph chains (corr / alpha): their steady difference across the jump.
          s.triA += (q1 - q0) / alpha;
          s.triB += (c1 - c0) / alpha;
        }
      }
    }
    s.leak = leakTarget;
    const double retention = 1.0 - s.leak;
    const double rawSaw = kern(0.0);
    const double prevSawAcc = s.sawAcc;
    s.sawAcc = s.sawAcc * retention + rawSaw * dt;
    s.sawJ = s.sawJ * retention + s.leak * s.sawAcc;
    const double sawOut = s.sawAcc + s.sawJ;
    const double ampAdjust = s.kernelLo.ampAdjust;

    if (waveform != 2 && waveform != 3) s.chainB = false;
    if (waveform == 1) {
      sample = sawOut * ampAdjust;
    } else if (waveform == 4) {
      const double rawBlendSquare = rawSaw - kern(0.5);
      s.blendSqAcc = s.blendSqAcc * retention + rawBlendSquare * dt;
      s.blendSqJ = s.blendSqJ * retention + s.leak * s.blendSqAcc;
      const double blendOut = s.blendSqAcc + s.blendSqJ;
      const double b = clamp(blend, 0.0, 1.0);
      sample = (sawOut * (1.0 - b) + blendOut * b) * ampAdjust;
    } else {
      const double pw = clamp(pulseWidth, 0.01, 0.99);
      // Chain B's phase step: the oscillator step minus how far Morph moved.
      if (!s.chainB) {
        s.chainB = true;
        s.prevPw = pw;
        // Start chain B and the second integrals on the wave (v34). Chain A is
        // already at this sample's phase; chain B and the second integrals
        // are updated below, so they start one step back (v36), chain B on
        // the leaky steady state (as chain A).
        const double back = wrap01(renderT - step);
        const double alpha = dt < 0.0 ? -kDsfLeakPerTurn : kDsfLeakPerTurn;
        double la, qa, lb, qb;
        leakyIntegrals(renderT, s.kernelLo, alpha, la, qa);
        leakyIntegrals(wrap01(back - pw), s.kernelLo, alpha, lb, qb);
        s.sawB = s.sawAcc - (la - lb);
        s.sawBJ = s.sawJ - (qa - qb);
        // Trimorph chains: the leaky integral of the leaky saw, = corr / alpha
        // (the ideal J here left a start error that 1 / (Morph (1 - Morph))
        // magnified ~50x at extreme Morph).
        double lBack, qBack;
        leakyIntegrals(back, s.kernelLo, alpha, lBack, qBack);
        s.triA = qBack / alpha;
        s.triB = qb / alpha;
        s.triDcIn = 0.0;
        s.triDcOut = 0.0;
        s.triDcPrime = true;
      }
      const double dtB = dt - (pw - s.prevPw);
      s.prevPw = pw;
      const double prevSawB = s.sawB;
      s.sawB = s.sawB * retention + kern(pw) * dtB;
      s.sawBJ = s.sawBJ * retention + s.leak * s.sawB;

      if (waveform == 2) {
        sample = (sawOut - (s.sawB + s.sawBJ)) * ampAdjust;
      } else {
        // Trimorph: integral of the saw over the window [t - Morph, t] =
        // (second integral at t) - (second integral at t - Morph). Peak to peak is
        // Morph * (1 - Morph) times the saw's, so that factor sets the level.
        // Trapezoid rule (v34): no half-sample lead in the second integral.
        s.triA = s.triA * retention + 0.5 * (s.sawAcc + prevSawAcc) * dt;
        s.triB = s.triB * retention + 0.5 * (s.sawB + prevSawB) * dtB;
        const double tri = (s.triA - s.triB) * ampAdjust * kTrimorphGain / (pw * (1.0 - pw));
        if (s.triDcPrime) {
          s.triDcPrime = false;
          s.triDcIn = tri;
          s.triDcOut = tri;
        }
        s.triDcOut = tri - s.triDcIn + retention * s.triDcOut;
        s.triDcIn = tri;
        sample = s.triDcOut;
      }
    }
  }

  const bool finite = sample * 0.0 == 0.0;
  if (!finite) sample = 0.0;
  s.out = clamp(sample, -1.5, 1.5) * level;
}

extern "C" void soemdsp_dsf_oscillator_sample_morph(
  int handle,
  double frequencyHz,
  double sampleRate,
  double morph,
  double symmetry,
  double width,
  double rotate,
  double slice,
  double phase,
  double level,
  double spacing,
  double oddEven
) {
  if (handle < 1 || handle > kMaxInstances) return;
  DsfOscillatorState& s = gPool[handle - 1];

  const double safeSampleRate = sampleRate > 1.0 ? sampleRate : 48000.0;
  const double absFrequency = frequencyHz < 0.0 ? -frequencyHz : frequencyHz;
  const double safeAbsFrequency = absFrequency > 1.0e-6 ? absFrequency : 1.0e-6;
  const double dt = clamp(frequencyHz / safeSampleRate, -0.5, 0.5);
  const double phaseOffset = wrap01(phase);
  const double nyquist = safeSampleRate * 0.5;
  double sp = spacing;
  if (!(sp > 1.0e-9) && !(sp < -1.0e-9)) sp = 1.0;
  preparePartials(s, morph, nyquist, safeAbsFrequency, sp);

  const double m = clamp(morph, 0.0, 1.0);
  const double k = (1.0 - dsfPow(m, 0.14)) * 4.0;
  const double a = dsfPow(0.5, k * k);
  const int startLo = sliceStart(slice, s.kernelLo.n);
  const int startHi = s.frac > 0.0 ? sliceStart(slice, s.kernelHi.n) : startLo;
  const double rotTurns = wrap01(rotate);
  const double oe = clamp(oddEven, 0.0, 1.0);
  const bool harmonic = (sp > 0.999999 && sp < 1.000001);

  const double step = dt * 0.9999;
  s.t = wrap01(s.t + step);
  const double renderT = wrap01(s.t + phaseOffset + rotTurns);
  s.renderPhase = wrap01(s.t + phaseOffset);
  double raw;
  if (harmonic) {
    // Two midpoint sub-steps (v34), as the DSF Oscillator: no half-sample
    // lead, < +0.6 dB high-harmonic lift at 20 kHz.
    const double at = s.t + phaseOffset;
    raw = 0.5 * (
      fadedMorph(wrap01(at - 0.25 * step), s, a, startLo, startHi, rotTurns, width, symmetry, 1.0, oe)
      + fadedMorph(wrap01(at - 0.75 * step), s, a, startLo, startHi, rotTurns, width, symmetry, 1.0, oe));
  } else {
    prepareSawCoeffsMul(s.evenLo, morph, dsp_floor(s.kernelLo.n * 0.5), 2.0);
    if (s.frac > 0.0) prepareSawCoeffsMul(s.evenHi, morph, dsp_floor(s.kernelHi.n * 0.5), 2.0);
    s.tm = wrap01(s.tm + dt * sp * 0.9999);
    const double renderM = wrap01(s.tm + (phaseOffset + rotTurns) * sp);
    const double ct = renderT;
    // Two midpoint sub-steps (v36), as the harmonic path: one kernel sample at
    // the end of the step led the integral by half a sample (up to ~90 deg on
    // the top partials at bright settings).
    auto spaced = [&](double back) {
      const double cB = wrap01(ct - back * step);
      const double mB = wrap01(renderM - back * step * sp);
      const double lo = spacedKernel(cB, mB, s.kernelLo, s.evenLo, oe);
      if (s.frac <= 0.0) return lo;
      const double hi = spacedKernel(cB, mB, s.kernelHi, s.evenHi, oe);
      return lo + (hi - lo) * s.frac;
    };
    raw = 0.5 * (spaced(0.25) + spaced(0.75));
  }

  const double leakTarget = dsfLeakTarget(safeAbsFrequency, safeSampleRate);
  // Steady state of the chain for a Phase / Rotate setting, one step back
  // (v36): the start value, and the shift across a Phase / Rotate jump.
  const double alpha = dt < 0.0 ? -kDsfLeakPerTurn : kDsfLeakPerTurn;
  auto steady = [&](double offset, double rot, double& I, double& Q) {
    I = 0.0;
    Q = 0.0;
    if (harmonic) {
      const double at = s.t + offset - step;
      morphHarmonicLeaky(at, a, startLo, static_cast<int>(s.kernelLo.n), rot, width, symmetry, oe, alpha, 1.0 - s.frac, I, Q);
      if (s.frac > 0.0) {
        morphHarmonicLeaky(at, a, startHi, static_cast<int>(s.kernelHi.n), rot, width, symmetry, oe, alpha, s.frac, I, Q);
      }
    } else {
      const double ct = s.t + offset + rot - step;
      const double mt = s.tm + (offset + rot) * sp - step * sp;
      morphSpacedLeaky(ct, mt, a, static_cast<int>(s.kernelLo.n), sp, oe, alpha, 1.0 - s.frac, I, Q);
      if (s.frac > 0.0) morphSpacedLeaky(ct, mt, a, static_cast<int>(s.kernelHi.n), sp, oe, alpha, s.frac, I, Q);
    }
  };
  if (!s.primed) {
    // Start on the steady wave at any Rotate / Symmetry / Slice (v36).
    double I0, Q0;
    steady(phaseOffset, rotTurns, I0, Q0);
    s.sawAcc = I0;
    s.sawJ = Q0;
    s.leak = leakTarget;
    s.prevOffset = phaseOffset;
    s.prevRot = rotTurns;
    s.jumpHold = 0;
    s.primed = true;
  } else {
    double dOff = phaseOffset - s.prevOffset;
    dOff -= dsp_floor(dOff + 0.5);
    double dRot = rotTurns - s.prevRot;
    dRot -= dsp_floor(dRot + 0.5);
    if (s.jumpHold > 0) s.jumpHold -= 1;
    const bool jump = dOff > kDsfPhaseJump || dOff < -kDsfPhaseJump || dRot > kDsfPhaseJump || dRot < -kDsfPhaseJump;
    if (jump && s.jumpHold == 0) {
      // Shift the chain by the steady difference across the jump.
      s.jumpHold = kDsfPhaseJumpHold;
      double I0, Q0, I1, Q1;
      steady(s.prevOffset, s.prevRot, I0, Q0);
      steady(phaseOffset, rotTurns, I1, Q1);
      s.sawAcc += I1 - I0;
      s.sawJ += Q1 - Q0;
    }
    s.prevOffset = phaseOffset;
    s.prevRot = rotTurns;
  }
  s.leak = leakTarget;
  s.sawAcc = s.sawAcc * (1.0 - s.leak) + raw * dt;
  s.sawJ = s.sawJ * (1.0 - s.leak) + s.leak * s.sawAcc;
  // Rotate level (harmonic only; on the inharmonic path Rotate is a time shift).
  const double rotLevel = harmonic ? rotateLevel(s.rotGain, a, s.kernelLo.n, rotTurns) : 1.0;
  double sample = (s.sawAcc + s.sawJ) * s.kernelLo.ampAdjust * rotLevel;

  const bool finite = sample * 0.0 == 0.0;
  if (!finite) sample = 0.0;
  s.out = clamp(sample, -1.5, 1.5) * level;
}

extern "C" double soemdsp_dsf_oscillator_out(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].out;
}

extern "C" double soemdsp_dsf_oscillator_phase(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].renderPhase;
}

extern "C" int soemdsp_dsf_oscillator_version() {
  return 36;
}
