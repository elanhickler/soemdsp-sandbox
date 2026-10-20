// soemdsp-native-module: resonant_envelope
// soemdsp-native-label: Resonant Envelope
// soemdsp-native-target: resonantEnvelope
// soemdsp-native-kind: envelope
//
// Two-pole envelope: TPT SVF lowpass at envelope rate.
// Decay sets the dominant time constant. Resonance sets damping
// zeta = 4 * 200^(-Resonance). Tracking scales attack, decay, and ring
// from the f input around 440 Hz. Impulse blends a rising-edge ping
// with the gate step. App Gate contract (gate_on / gate_hit, docs/GATES_TRIGGERS.md):
// on = leaves Planck silence in either sign; Peak = input height latched on the hit. Output Range Fit scales the peak to Amplitude
// and clips below 0. Raw is the filter output.
//
// Follow (optional jack): |Follow| * Amplitude is fed straight into the SVF as
// its target (no gate, no ping) -> resonant envelope follower. Attack timing is
// used while the target is above the filter output, Decay timing while below.
// If Trigger and Follow are both wired their drives add (one SVF, one sum).
// Follow unwired (followWired < 0.5 or NaN from old callers) = old behaviour.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/tpt_svf.h>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;
static const double kZetaFloor = 0.02;
static const double kAttackFloor = 0.0005;
static const double kDecayMin = 0.001;
static const double kDecayMax = 10.0;
static const double kFRef = 440.0;
static const double kTrackMin = 1.0 / 256.0;
static const double kTrackMax = 256.0;
static const double kLn200 = 5.298317366548036;
static const double kE = 2.718281828459045;

struct State {
  TptSvfState filt;
  double lastGate;
  double velocity;
  double lastY;
  double shotAttack;
  double shotDecay;
  double shotResonance;
  double shotImpulse;
  double shotAmp;
  bool hasShot;
  bool gateHigh;
  bool idle;
  bool coeffValid;
  double cAttack;
  double cDecay;
  double cZeta;
  double cImpulse;
  double cScale;
  double cSr;
  TptSvfCoeffs coeff;
  double kImpulse;
  double peakGain;
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"resonant_envelope\","
    "\"label\":\"Resonant Envelope\","
    "\"targetType\":\"resonantEnvelope\","
    "\"kind\":\"envelope\""
  "}";

static double atan_pos(double x) {
  if (!(x > 0.0)) return 0.0;
  if (x > 1.0) return kPi * 0.5 - atan_pos(1.0 / x);
  const double x2 = x * x;
  double term = x;
  double sum = x;
  for (int n = 1; n < 16; n++) {
    term *= -x2;
    sum += term / (double)(2 * n + 1);
  }
  return sum;
}

static double clamp01_param(double v, double fallback) {
  double x = safe(v);
  if (!(x * 0.0 == 0.0)) x = fallback;
  if (x < 0.0) x = 0.0;
  if (x > 1.0) x = 1.0;
  return x;
}

static double zeta_of(double resonance) {
  const double r = clamp01_param(resonance, 0.0);
  double z = 4.0 * dsp_exp(-r * kLn200);
  if (!(z * 0.0 == 0.0) || z < kZetaFloor) z = kZetaFloor;
  return z;
}

static double step_overshoot(double zeta) {
  if (!(zeta < 1.0)) return 1.0;
  const double den = sqrt_newton(1.0 - zeta * zeta);
  if (!(den > 1e-12)) return 1.0;
  const double o = 1.0 + dsp_exp((-kPi * zeta) / den);
  return (o * 0.0 == 0.0 && o > 1.0) ? o : 1.0;
}

static double impulse_height(double omega0, double zeta, double sigma) {
  if (!(omega0 > 0.0) || !(sigma > 0.0)) return 1.0;
  if (zeta >= 0.999 && zeta <= 1.001) {
    return omega0 / kE;
  }
  if (zeta > 1.0) {
    const double disc = zeta * zeta - 1.0;
    const double root = sqrt_newton(disc > 0.0 ? disc : 0.0);
    const double a = omega0 * (zeta - root);
    const double b = omega0 * (zeta + root);
    const double dt = b - a;
    if (!(dt > 1e-18) || !(a > 0.0) || !(b > a)) return omega0 / kE;
    const double t = dsp_ln(b / a) / dt;
    const double h = (omega0 * omega0 / dt) * (dsp_exp(-a * t) - dsp_exp(-b * t));
    return (h * 0.0 == 0.0 && h > 0.0) ? h : omega0 / kE;
  }
  const double one = 1.0 - zeta * zeta;
  const double wd = omega0 * sqrt_newton(one > 0.0 ? one : 0.0);
  if (!(wd > 1e-18)) return omega0 / kE;
  const double t = atan_pos(wd / sigma) / wd;
  const double h = (omega0 / sqrt_newton(one > 0.0 ? one : 1e-18))
    * dsp_exp(-sigma * t) * dsp_sin(wd * t);
  return (h * 0.0 == 0.0 && h > 0.0) ? h : omega0 / kE;
}

static void setup_coeff(State& s, double tau, double zeta, double scale, double impulse, double sr) {
  double sigma = scale / tau;
  if (!(sigma > 0.0)) sigma = scale / kDecayMax;
  double omega0;
  if (zeta >= 1.0) {
    const double disc = zeta * zeta - 1.0;
    const double root = sqrt_newton(disc > 0.0 ? disc : 0.0);
    const double slow = zeta - root;
    omega0 = sigma / (slow > 1e-9 ? slow : 1e-9);
  } else {
    omega0 = sigma / zeta;
  }
  const double cap = kTwoPi * 0.25 * sr;
  if (omega0 > cap) omega0 = cap;
  if (!(omega0 > 0.0)) omega0 = cap * 1e-6;
  const double h = impulse_height(omega0, zeta, sigma);
  double kImp = sr / h;
  if (!(kImp * 0.0 == 0.0) || kImp < 0.0) kImp = 1.0;
  const double over = step_overshoot(zeta);
  const double imp = clamp01_param(impulse, 0.0);
  double peak = (1.0 - imp) * over + imp;
  if (!(peak >= 1.0)) peak = 1.0;
  tpt_svf_setup(s.coeff, omega0 / sr, 2.0 * zeta, 1.0, 0.0, 0.0, 1.0);
  s.kImpulse = kImp;
  s.peakGain = peak;
  s.coeffValid = true;
}

static void flush_denorm(TptSvfState& st) {
  if (dsp_fabs(st.z1) < 1e-20) st.z1 = 0.0;
  if (dsp_fabs(st.z2) < 1e-20) st.z2 = 0.0;
}

}  // namespace

extern "C" int soemdsp_resonant_envelope_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      tpt_svf_reset(s.filt);
      s.lastGate = 0.0;
      s.velocity = 1.0;
      s.lastY = 0.0;
      s.shotAttack = 0.01;
      s.shotDecay = 0.3;
      s.shotResonance = 0.0;
      s.shotImpulse = 0.0;
      s.shotAmp = 1.0;
      s.hasShot = false;
      s.gateHigh = false;
      s.idle = true;
      s.coeffValid = false;
      s.cAttack = 0.0;
      s.cDecay = 0.0;
      s.cZeta = 0.0;
      s.cImpulse = 0.0;
      s.cScale = 0.0;
      s.cSr = 0.0;
      s.kImpulse = 1.0;
      s.peakGain = 1.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_resonant_envelope_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" int soemdsp_resonant_envelope_is_idle(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 1;
  return gPool[handle - 1].idle ? 1 : 0;
}

extern "C" double soemdsp_resonant_envelope_sample(
  int handle,
  double input,
  double freqHz,
  double attackSec,
  double decaySec,
  double resonance,
  double impulse,
  double tracking,
  double amplitude,
  double outputRange,
  double recalculateOnTrigger,
  double sampleRate,
  double follow,
  double followWired
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  double sr = safe(sampleRate);
  if (!(sr >= 1.0)) sr = 44100.0;
  double gate = safe(input);
  if (!(gate * 0.0 == 0.0)) gate = 0.0;
  const bool rising = gate_hit(gate, &s.lastGate);
  const bool high = gate_on(gate);
  if (rising) s.velocity = gate;
  const bool latch = clamp01_param(recalculateOnTrigger, 1.0) >= 0.5;
  if (rising && latch) {
    s.shotAttack = safe(attackSec);
    s.shotDecay = safe(decaySec);
    s.shotResonance = safe(resonance);
    s.shotImpulse = safe(impulse);
    s.shotAmp = safe(amplitude);
    s.hasShot = true;
  }
  const bool useShot = latch && s.hasShot;
  double attack = useShot ? s.shotAttack : safe(attackSec);
  double decay = useShot ? s.shotDecay : safe(decaySec);
  double res = useShot ? s.shotResonance : safe(resonance);
  double imp = useShot ? s.shotImpulse : safe(impulse);
  double amp = useShot ? s.shotAmp : safe(amplitude);
  if (!(attack * 0.0 == 0.0) || attack < kAttackFloor) attack = kAttackFloor;
  if (!(decay * 0.0 == 0.0)) decay = 0.3;
  if (decay < kDecayMin) decay = kDecayMin;
  if (decay > kDecayMax) decay = kDecayMax;
  if (!(amp * 0.0 == 0.0)) amp = 0.0;
  imp = clamp01_param(imp, 0.0);
  const double zeta = zeta_of(res);
  double track = clamp01_param(tracking, 0.0);
  double hz = safe(freqHz);
  double scale = 1.0;
  if (track > 0.0 && hz > 0.0 && (hz * 0.0 == 0.0)) {
    scale = dsp_exp(track * dsp_ln(hz / kFRef));
    if (!(scale * 0.0 == 0.0)) scale = 1.0;
    if (scale < kTrackMin) scale = kTrackMin;
    if (scale > kTrackMax) scale = kTrackMax;
  }
  const bool hasFollow = safe(followWired) >= 0.5;
  double fol = hasFollow ? dsp_fabs(safe(follow)) : 0.0;
  if (!(fol * 0.0 == 0.0)) fol = 0.0;
  const double folDrive = fol * amp;
  // Attack while gated, or while the Follow target is above the filter output.
  const bool attackPhase = high || (hasFollow && folDrive > s.lastY);
  const double tau = attackPhase ? attack : decay;
  if (!s.coeffValid
      || s.gateHigh != attackPhase
      || s.cAttack != attack
      || s.cDecay != decay
      || s.cZeta != zeta
      || s.cImpulse != imp
      || s.cScale != scale
      || s.cSr != sr) {
    setup_coeff(s, tau, zeta, scale, imp, sr);
    s.gateHigh = attackPhase;
    s.cAttack = attack;
    s.cDecay = decay;
    s.cZeta = zeta;
    s.cImpulse = imp;
    s.cScale = scale;
    s.cSr = sr;
  }
  // Step holds the velocity latched on the hit; the ping fires on the hit sample only.
  const double gateLevel = high ? s.velocity : 0.0;
  const double edge = rising ? s.velocity : 0.0;
  const double drive = (1.0 - imp) * gateLevel * amp + imp * edge * s.kImpulse * amp + folDrive;
  if (!(s.filt.z1 * 0.0 == 0.0) || !(s.filt.z2 * 0.0 == 0.0)) tpt_svf_reset(s.filt);
  double y = tpt_svf_tick(s.filt, s.coeff, drive);
  flush_denorm(s.filt);
  if (!(y * 0.0 == 0.0)) {
    tpt_svf_reset(s.filt);
    y = 0.0;
  }
  s.lastY = y;
  const bool fit = !(clamp01_param(outputRange, 0.0) >= 0.5);
  double out = y;
  if (fit) {
    const double g = s.peakGain > 1e-12 ? s.peakGain : 1.0;
    out = y / g;
    if (out < 0.0) out = 0.0;
  }
  if (!(out * 0.0 == 0.0)) out = 0.0;
  const bool quiet = dsp_fabs(out) < 1e-5
    && dsp_fabs(s.filt.z1) < 1e-5
    && dsp_fabs(s.filt.z2) < 1e-5;
  s.idle = quiet && !high && !(fol >= 1e-5);
  return out;
}

extern "C" int soemdsp_resonant_envelope_version() {
  return 2;  // 2: Follow input (envelope follower). 1: initial
}

extern "C" const char* soemdsp_resonant_envelope_metadata_json() {
  return kMetadataJson;
}

extern "C" int soemdsp_resonant_envelope_metadata_json_size() {
  return (int)sizeof(kMetadataJson);
}
