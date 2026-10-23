// soemdsp-native-module: dsf_oscillator
// soemdsp-native-label: DSF Oscillator
// soemdsp-native-target: dsfOscillator
// soemdsp-native-kind: oscillator
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp/blob/main/include/soemdsp/oscillator/DSFOscillator.hpp
//
// DSF Oscillator (type 46): harmonic SineSaw kit.
//   n      = fade of floor(Nyquist/f - 1)
//   k      = (1 - morph^0.14) * 4        // morph 0 = sine, 1 = saw
//   leak   = leak * 0.99 + 0.000005      // settles at 0.0005
//   acc    = acc * (1 - leak) + DSF() * increment
//   out    = acc * map(morph, 3.15, 2.7)
// Phase step is increment * 0.9999 so the 0/0 pole at t=0 is skipped.
// Square / Trimorph / SquSaw are PWM / extra integration of this saw kernel.
//
// DSF Morphing Osc (type 232): one band-limited object.
//   Morph     geometric |a| (sine → bright)
//   Symmetry  mix of +a and −a (saw → alternating pulse)
//   Width     all harmonics → odd-only square-to-sine DSF
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

double sawPartials(double nyquist, double freq) {
  double n = nyquist / freq - 1.0;
  if (n < 1.0) n = 1.0;
  if (n > 4096.0) n = 4096.0;
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

void sumPartialsCS(double sinx, double cosx, const DsfKernelCoeffs& c, double& C, double& S) {
  const double r = c.twoK2 > 0.0 ? 1.0 / c.twoK2 : 1.0;
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
}

double sineSawKernel(double turns, const DsfKernelCoeffs& c) {
  double sinx = 0.0, cosx = 0.0, sinxn = 0.0, cosxn = 0.0;
  kernelSinCosTurns(turns, &sinx, &cosx);
  kernelSinCosTurns(turns * c.n, &sinxn, &cosxn);
  const double den = 1.0 - c.denCos * cosx + c.k42;
  if (den > -1.0e-2 && den < 1.0e-2) {
    double C = 0.0, S = 0.0;
    sumPartialsCS(sinx, cosx, c, C, S);
    return C;
  }
  const double num = (c.k42 * cosxn - c.eightK2 * (cosxn * cosx - sinxn * sinx)) * c.decay
    + cosx * c.k42 - c.twoK2;
  return num / den;
}

int seriesCount(double start, double step, double end) {
  const double absStep = step < 0.0 ? -step : step;
  if (absStep < 1.0e-12) return 0;
  double n = (end - start) / absStep + 1.0;
  if (n < 1.0) return 0;
  if (n > 4096.0) n = 4096.0;
  return static_cast<int>(dsp_floor(n + 1.0e-12));
}

// Geometric sum_{k=0}^{count-1} r^k exp(i 2π (start + k·step) turns + i 2π rot)
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
  const double zr = r * cosZ;
  const double zi = r * sinZ;
  const double denr = 1.0 - zr;
  const double deni = -zi;
  const double den2 = denr * denr + deni * deni;
  const bool nearPole = den2 < 1.0e-4;
  if (nearPole || count > 4096) {
    double tr = cosA, ti = sinA;
    double sr = 0.0, si = 0.0;
    const int n = count > 4096 ? 4096 : count;
    for (int k = 0; k < n; k++) {
      sr += tr;
      si += ti;
      const double nr = tr * zr - ti * zi;
      ti = tr * zi + ti * zr;
      tr = nr;
    }
    C = sr;
    S = si;
    return;
  }
  const double mag = r < 0.0 ? -r : r;
  double rm = count == 0 ? 1.0 : dsfPow(mag, static_cast<double>(count));
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
  double sinx = 0.0, cosx = 0.0, sinxn = 0.0, cosxn = 0.0;
  kernelSinCosTurns(turns, &sinx, &cosx);
  kernelSinCosTurns(turns * c.n, &sinxn, &cosxn);
  const double den = 1.0 - c.denCos * cosx + c.k42;
  if (den > -1.0e-2 && den < 1.0e-2) {
    sumPartialsCS(sinx, cosx, c, C, S);
    return;
  }
  const double cos1 = cosxn * cosx - sinxn * sinx;
  const double sin1 = sinxn * cosx + cosxn * sinx;
  C = ((c.k42 * cosxn - c.eightK2 * cos1) * c.decay + cosx * c.k42 - c.twoK2) / den;
  S = ((c.k42 * sinxn - c.eightK2 * sin1) * c.decay + sinx * c.k42) / den;
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

struct DsfOscillatorState {
  bool active;
  double t;
  double leak;
  double sawAcc;
  double sqAcc;
  double blendSqAcc;
  double triAcc;
  double triPeak;
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

void preparePartials(DsfOscillatorState& s, double morph, double nyquist, double freq, double spacing = 1.0) {
  double nf;
  double absS = spacing < 0.0 ? -spacing : spacing;
  if (absS < 1.0e-9 || (absS > 0.999999 && absS < 1.000001)) {
    nf = sawPartials(nyquist, freq);
  } else {
    nf = (nyquist / freq - 2.0) / absS + 1.0;
    if (nf < 1.0) nf = 1.0;
    if (nf > 4096.0) nf = 4096.0;
  }
  double nLo = dsp_floor(nf);
  if (nLo < 1.0) nLo = 1.0;
  const double nHi = nLo < 4096.0 ? nLo + 1.0 : nLo;
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
      gPool[i].triPeak = 1.0;
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
  s.sqAcc = 0.0;
  s.blendSqAcc = 0.0;
  s.triAcc = 0.0;
  s.triPeak = 1.0;
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
  double level
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
    double sinx = 0.0, cosx = 0.0;
    dsp_sin_cos_turns(s.renderPhase, &sinx, &cosx);
    sample = sinx;
  } else {
    const double nyquist = safeSampleRate * 0.5;
    preparePartials(s, morph, nyquist, safeAbsFrequency);

    s.t = wrap01(s.t + dt * 0.9999);
    const double renderT = wrap01(s.t + phaseOffset);
    auto kern = [&](double back) {
      return fadedKernel(wrap01(renderT - back), s);
    };
    s.renderPhase = renderT;

    s.leak = s.leak * 0.99 + 0.000005;
    const double retention = 1.0 - s.leak;
    const double rawSaw = kern(0.0);
    s.sawAcc = s.sawAcc * retention + rawSaw * dt;
    const double ampAdjust = s.kernelLo.ampAdjust;

    if (waveform == 1) {
      sample = s.sawAcc * ampAdjust;
    } else if (waveform == 4) {
      const double rawBlendSquare = rawSaw - kern(0.5);
      s.blendSqAcc = s.blendSqAcc * retention + rawBlendSquare * dt;
      const double b = clamp(blend, 0.0, 1.0);
      sample = (s.sawAcc * (1.0 - b) + s.blendSqAcc * b) * ampAdjust;
    } else {
      const double pw = clamp(pulseWidth, 0.01, 0.99);
      const double rawSquare = rawSaw - kern(pw);
      s.sqAcc = s.sqAcc * retention + rawSquare * dt;

      if (waveform == 2) {
        sample = s.sqAcc * ampAdjust;
      } else {
        s.triAcc = s.triAcc * retention + s.sqAcc * dt * 4.0;
        double sinPw = 0.0, cosPw = 0.0;
        dsp_sin_cos_turns(0.5 * pw, &sinPw, &cosPw);
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

  s.t = wrap01(s.t + dt * 0.9999);
  const double renderT = wrap01(s.t + phaseOffset + rotTurns);
  s.renderPhase = wrap01(s.t + phaseOffset);
  double raw;
  if (harmonic) {
    raw = fadedMorph(wrap01(s.t + phaseOffset), s, a, startLo, startHi, rotTurns, width, symmetry, 1.0, oe);
  } else {
    prepareSawCoeffsMul(s.evenLo, morph, dsp_floor(s.kernelLo.n * 0.5), 2.0);
    if (s.frac > 0.0) prepareSawCoeffsMul(s.evenHi, morph, dsp_floor(s.kernelHi.n * 0.5), 2.0);
    s.tm = wrap01(s.tm + dt * sp * 0.9999);
    const double renderM = wrap01(s.tm + (phaseOffset + rotTurns) * sp);
    const double ct = renderT;
    const double lo = spacedKernel(ct, renderM, s.kernelLo, s.evenLo, oe);
    if (s.frac <= 0.0) {
      raw = lo;
    } else {
      const double hi = spacedKernel(ct, renderM, s.kernelHi, s.evenHi, oe);
      raw = lo + (hi - lo) * s.frac;
    }
  }

  s.leak = s.leak * 0.99 + 0.000005;
  const double retention = 1.0 - s.leak;
  s.sawAcc = s.sawAcc * retention + raw * dt;
  double sample = s.sawAcc * s.kernelLo.ampAdjust;

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
  return 22;
}
