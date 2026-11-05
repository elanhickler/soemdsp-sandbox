// soemdsp-native-module: blit
// soemdsp-native-label: BLIT Oscillator
// soemdsp-native-target: blit
// soemdsp-native-kind: oscillator
//
// Band-Limited Impulse Train (BLIT) oscillator -- the actual Stilson &
// Smith closed-form algorithm ("Alias-Free Digital Synthesis of Classic
// Analog Waveforms", 1996), following the same structure as the Synthesis
// ToolKit's (STK) BlitSaw/BlitSquare classes (Cook & Scavone), which have
// been in production DSP use for ~25 years.
//
// v2/v3/v4 all point-sampled or reconstructed a Dirichlet kernel with a
// FLOATING-POINT harmonic count and a near-true-integrator leak, which
// turned out to be extremely sensitive to tiny numerical error (see git
// history) -- every fix uncovered a new precision-amplification bug.
//
// v5 (this version) goes back to the actual textbook algorithm instead of
// improvising a variant of it:
//   - The harmonic count m is an INTEGER, always odd, chosen as the most
//     harmonics that fit under Nyquist: m = 2*floor(period/2) + 1.
//   - The impulse: blit(phase) = sin(m*phase) / (p*sin(phase)), with phase
//     running 0..pi (not 0..2pi) and p = samples-per-period. This is a
//     closed form for a sum of m equal-amplitude harmonics -- exact, no
//     approximation, no exp()/pow() rolloff parameter to compute.
//   - DC removed by subtracting the impulse's known average (1/p) every
//     sample, then leaky-integrated with a FIXED, FAST leak (0.995, per
//     STK) -- not a near-1 "true integrator" gain, which is what kept
//     amplifying small errors into large ones in every earlier version.
// Square is formed the way the original paper itself describes: two BLIT
// saws a half-cycle apart, subtracted (the ramp cancels, the step remains).
// Triangle leaky-integrates that clean square through a gentle frequency-
// tracking one-pole (cutoff scales with the note's own frequency, gain
// tuned low enough to stay stable through 20kHz).
//
// All three verified numerically in Python against this exact formula
// before porting: flat, bounded amplitude and near-zero DC from 10Hz to
// 20kHz, no blowups, no low-frequency beat.
//
// v6:
//   - Harmonic count is continuous: Mf = max(1, p/2 - 1) harmonics, the
//     top one faded by the fractional part (closed-form crossfade of the M
//     and M+1 kernels, as DSF does), so harmonics no longer click in and
//     out as the pitch moves. The faded partial stays one harmonic below
//     Nyquist; the fundamental is always kept.
//   - Leak tracks pitch: a DC blocker at f/20 (same per-period shape at
//     every pitch). The fixed 0.995 leak drooped low notes, so the peak
//     drifted with pitch.
//   - Level: the per-sample integrator boosts frequency w by
//     (w/2)/sin(w/2) over a true integral; the output is corrected by
//     sin(w/2)/(w/2) at the fundamental. Measured peaks then stay flat
//     (saw <= 0.665, square <= 0.679 raw, 5 Hz .. 20 kHz), so fixed gains
//     keep both under 0.98 and the clamp never clips (v5 clipped up to
//     16% of square samples, which aliased).

#include <soemdsp/math/scalar_helpers.h>
using soemdsp_maths::clamp;
using soemdsp_maths::clamp11;
using soemdsp_maths::wrap_radians;
using soemdsp_maths::kPi;
using soemdsp_maths::kTwoPi;
using soemdsp_maths::kHalfPi;

namespace {

constexpr int kMaxInstances = 16;
constexpr double kBlitLeakDivisor = 20.0;  // integrator DC blocker at f / 20

// Taylor series through x^17, Horner-evaluated (~2e-8 worst-case error).
double sinApprox(double value) {
  const double x = wrap_radians(value);
  const double x2 = x * x;
  double acc = 1.0 / 355687428096000.0;       // 1/17!
  acc = -1.0 / 1307674368000.0 + x2 * acc;    // -1/15!
  acc = 1.0 / 6227020800.0 + x2 * acc;        // 1/13!
  acc = -1.0 / 39916800.0 + x2 * acc;         // -1/11!
  acc = 1.0 / 362880.0 + x2 * acc;            // 1/9!
  acc = -1.0 / 5040.0 + x2 * acc;             // -1/7!
  acc = 1.0 / 120.0 + x2 * acc;               // 1/5!
  acc = -1.0 / 6.0 + x2 * acc;                // -1/3!
  return x * (1.0 + x2 * acc);
}

double cosApprox(double value) { return sinApprox(value + kHalfPi); }

// One Stilson/Smith BLIT-saw oscillator: integer odd harmonic count m,
// closed-form impulse train, DC removed by its known average (1/p), leaky-
// integrated with a fixed fast leak. Runs its own phase 0..pi (this
// algorithm's native convention, half the usual 0..2pi audio phase) so a
// second instance can be offset by half a cycle for Square.
// Kernel with M harmonics: sin((2M+1)x) / (p sin x), x in [0, pi).
double blitKernel(double phase, double denom, double harmonics, double p) {
  const double m = 2.0 * harmonics + 1.0;
  if (denom > -1.0e-9 && denom < 1.0e-9) return m / p;  // limit at phase 0
  return sinApprox(m * phase) / (p * denom);
}

struct BlitSaw {
  double phase;
  double phaseOffset;  // in this oscillator's own pi-periodic units
  double state;

  void init(double phaseOffsetCycles) {
    phaseOffset = phaseOffsetCycles * kPi;
    phase = phaseOffset;
    state = 0.0;
  }

  // periodSamples = 1/|dt|; direction +1 forward, −1 through-zero reverse.
  double update(double periodSamples, double direction = 1.0) {
    const double p = periodSamples > 1.0e-6 ? periodSamples : 1.0e-6;
    // Continuous harmonic count, top partial one harmonic below Nyquist.
    double harmonics = 0.5 * p - 1.0;
    if (harmonics < 1.0) harmonics = 1.0;
    const double lo = __builtin_floor(harmonics);
    const double frac = harmonics - lo;
    const double c2 = 1.0 / p;

    const double denom = sinApprox(phase);
    double tmp = blitKernel(phase, denom, lo, p);
    if (frac > 0.0) tmp += (blitKernel(phase, denom, lo + 1.0, p) - tmp) * frac;
    tmp += state - c2;
    // DC blocker at f/20: the same leak per period at every pitch.
    const double leak = 1.0 - (kTwoPi / kBlitLeakDivisor) / p;
    state = tmp * (leak > 0.0 ? leak : 0.0);

    const double dir = direction < 0.0 ? -1.0 : 1.0;
    phase += dir * (kPi / p);
    phase = wrap_radians(phase, kPi);

    return tmp;
  }
};

struct SlotState {
  BlitSaw sawA;   // phase offset 0 -- feeds Saw directly.
  BlitSaw sawB;   // phase offset 0.5 cycle -- subtracted to form Square.
  double triState;
  bool initialized;
};

struct BlitState {
  bool active;
  // Slot layout matches the PolyBLEP taps: 0 = selected/out, 1 = saw,
  // 2 = ramp, 3 = square, 4 = tri. Each slot tracks its own filter state
  // independently even though they all follow the same phase.
  SlotState slots[5];
  double out;
  double saw;
  double ramp;
  double square;
  double tri;
  double sine;
};

static BlitState gPool[kMaxInstances];

constexpr double kSawGain = 1.47;       // raw saw peak <= 0.665 -> under 0.98.
constexpr double kSquareGain = 1.44;    // raw square peak <= 0.679 -> under 0.98.
constexpr double kTriTrackGain = 2.0;   // frequency-tracking one-pole gain.

void initSlot(SlotState& slot) {
  slot.sawA.init(0.0);
  slot.sawB.init(0.5);
  slot.triState = 0.0;
  slot.initialized = true;
}

// waveform: 0 Saw, 1 Ramp, 2 Square, 3 Triangle, 4 Sine (matches PolyBLEP)
// phaseIncrement is signed cycles/sample — negative = through-zero reverse.
double oscillatorSample(BlitState& s, int slotIndex, double phase, double phaseIncrement, int waveform) {
  SlotState& slot = s.slots[slotIndex];
  if (!slot.initialized) initSlot(slot);
  const double phaseIncMag = phaseIncrement < 0.0 ? -phaseIncrement : phaseIncrement;
  const double dt = clamp(phaseIncMag, 1.0e-6, 0.5);
  const double periodSamples = 1.0 / dt;
  const double direction = phaseIncrement < 0.0 ? -1.0 : 1.0;

  // Integrator level correction at the fundamental: sin(w/2) / (w/2).
  const double halfW = kPi / periodSamples;
  const double comp = sinApprox(halfW) / halfW;
  const double sawA = slot.sawA.update(periodSamples, direction) * comp;
  const double sawB = slot.sawB.update(periodSamples, direction) * comp;
  const double sawARaw = sawA * kSawGain;
  const double squareRaw = (sawA - sawB) * kSquareGain;

  switch (waveform) {
    case 1:
      return -clamp11(sawARaw);
    case 2: {
      return clamp11(squareRaw);
    }
    case 3: {
      const double sqOut = clamp11(squareRaw);
      // Integrate with signed dt so reverse also reverses the triangle slope.
      const double signedDt = direction * dt;
      slot.triState += signedDt * kTriTrackGain * (sqOut - slot.triState);
      return clamp11(slot.triState);
    }
    case 4:
      return sinApprox(phase);
    case 0:
    default:
      return clamp11(sawARaw);
  }
}

}  // namespace

extern "C" int soemdsp_blit_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      gPool[i] = BlitState{};
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_blit_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_blit_reset(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  BlitState& s = gPool[handle - 1];
  for (int i = 0; i < 5; i++) {
    initSlot(s.slots[i]);
  }
}

extern "C" void soemdsp_blit_sample(
  int handle,
  double phase,
  double phaseIncrement,
  int waveform,
  double level
) {
  if (handle < 1 || handle > kMaxInstances) return;
  BlitState& s = gPool[handle - 1];
  const int safeWaveform = waveform < 0 ? 0 : (waveform > 4 ? 4 : waveform);
  s.out    = oscillatorSample(s, 0, phase, phaseIncrement, safeWaveform) * level;
  s.saw    = oscillatorSample(s, 1, phase, phaseIncrement, 0) * level;
  s.ramp   = oscillatorSample(s, 2, phase, phaseIncrement, 1) * level;
  s.square = oscillatorSample(s, 3, phase, phaseIncrement, 2) * level;
  s.tri    = oscillatorSample(s, 4, phase, phaseIncrement, 3) * level;
  s.sine   = sinApprox(phase) * level;
}

extern "C" double soemdsp_blit_out(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].out;
}

extern "C" double soemdsp_blit_saw(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].saw;
}

extern "C" double soemdsp_blit_ramp(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].ramp;
}

extern "C" double soemdsp_blit_square(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].square;
}

extern "C" double soemdsp_blit_tri(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].tri;
}

extern "C" double soemdsp_blit_sine(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].sine;
}

extern "C" int soemdsp_blit_version() {
  return 6;
}
