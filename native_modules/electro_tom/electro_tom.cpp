// soemdsp-native-module: electro_tom
// soemdsp-native-label: Electro Tom
// soemdsp-native-target: electroTom
// soemdsp-native-kind: drum
//
// Electro Tom (docs/DRUM_PACK_PLAN.md §4, Argi go 2026-10-19): one tom voice,
// Trigger + Reset in, Tom L + Tom R + Env out. One fixed shared param set:
//   tune (Hz), bend (oct), tone (0..1), bodyDecay (s T60), noise (0..1),
//   amplitude (0..1). Low / mid / high is the free Tune.
// Algorithms (choiceIds): 0 tr808, 1 tr909, 2 simmons.
//   808: pinged 2-pole resonator; pitch sits Bend oct above Tune scaled by the
//        decaying body level ("tonk"); low-passed noise (Tone = cutoff) on a
//        1.3x longer envelope. Retrigger adds onto the ring.
//   909: three phase-reset rounded triangles (1 : 1.5 : 2.21), VCO1 clipper
//        hardness = Tone (sine -> square); ENV-4 sweep Bend oct over a fixed
//        50 ms; low-passed tom noise on a 30 ms envelope.
//   Simmons: SDS-V sine, Bend oct drop over 0.5 x Body Decay, noise through a
//        resonant lowpass (Tone = cutoff), shared VCA, shared click.
// Hit model as Electro Snare: Trigger latches v = |height|; Reset rewinds
// everything, reseeds the noise and re-strikes at v (silent before the first
// Trigger); same sample: Reset first, then Trigger.
// Stereo: tonal body identical L/R; noise per channel (own seed, own filter);
// click shared. Noise 0 gives bit-identical L / R.
// Env = (eBody + noise eNoise) / (1 + noise): peaks at v, excludes Amplitude.
// The ring keeps its state when the pitch falls, which raises its amplitude by
// fHit / f; the body is scaled by f / fHit (fHit = pitch at the last ping) so
// the hit stays near v.
// Params arrive clamped to their slider ranges (no second clamp here).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/tpt_svf.h>
#include <soemdsp/drum/drum_parts.h>

namespace {

using namespace soemdsp_maths;
using namespace soemdsp::drum;

static const int kMaxInstances = 64;
static const unsigned int kNoiseSeed = 0x70a5eed1u;
enum { kAlg808 = 0, kAlg909 = 1, kAlgSimmons = 2 };

// --- by-ear constants ---
static const double k808NoiseT60 = 1.3;      // x Body Decay
static const double k808Noise = 0.5;
static const double k909R2 = 1.5, k909R3 = 2.21;
static const double k909W2 = 0.6, k909W3 = 0.4;
static const double k909D2 = 0.7, k909D3 = 0.5;  // x Body Decay
static const double k909Round = 1.6;
static const double k909BendT60 = 0.05;
static const double k909NoiseT60 = 0.03;
static const double k909NoiseLp = 4000.0;
static const double k909Noise = 0.8;
static const double kSimQ = 2.0;
static const double kSimClickT60 = 0.002;
static const double kSimClick = 0.3;
static const double kSimNoise = 0.55;
static const double kMixTrim = 0.5;

struct State {
  double fOut;  // f out (Hz), this sample
  double latchA;  // Recalculate On Trigger: decay params latched on the last hit
  double latchB;
  bool latchHas;
  bool active;
  double lastTrigger, lastReset;
  double v;
  HashNoise white;
  double p;                       // bend 1 -> 0 (909 / Simmons)
  double e1, e2, e3, eN, eClick;
  Ring2 ring;
  double fHit;                    // 808 ring pitch at the last ping
  double ph1, ph2, ph3;
  double lp[2];
  double lpC;
  TptSvfState svf[2];
  double envOut, rightOut;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"electro_tom\","
    "\"label\":\"Electro Tom\","
    "\"targetType\":\"electroTom\","
    "\"kind\":\"drum\""
  "}";

static void clear_voice(State& s) {
  s.p = 0.0;
  s.e1 = s.e2 = s.e3 = s.eN = s.eClick = 0.0;
  ring2_reset(s.ring);
  s.fHit = 1.0;
  s.ph1 = s.ph2 = s.ph3 = 0.0;
  s.lp[0] = s.lp[1] = 0.0;
  s.lpC = 0.0;
  tpt_svf_reset(s.svf[0]);
  tpt_svf_reset(s.svf[1]);
  hash_noise_reset(s.white);
  s.envOut = s.rightOut = 0.0;
}

static void init_state(State& s) {
  s.lastTrigger = s.lastReset = 0.0;
  s.v = 0.0;
  clear_voice(s);
}

static void strike(State& s, int alg) {
  s.p = 1.0;
  s.e1 = s.e2 = s.e3 = s.eN = s.eClick = s.v;
  if (alg != kAlg808) s.ph1 = s.ph2 = s.ph3 = 0.0;
}

static bool resting(const State& s) {
  return s.e1 == 0.0 && s.e2 == 0.0 && s.e3 == 0.0 && s.eN == 0.0 && s.eClick == 0.0 && ring2_resting(s.ring);
}

}  // namespace

extern "C" int soemdsp_electro_tom_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      init_state(gPool[i]);
      gPool[i].latchHas = false;
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_electro_tom_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Tom L. soemdsp_electro_tom_right() / _env() are this sample's Tom R / Env.
extern "C" double soemdsp_electro_tom_sample(
  int handle,
  double trigger,
  double reset,
  double algorithm,
  double tune,
  double bend,
  double tone,
  double bodyDecay,
  double noise,
  double amplitude,
  double sampleRate,
  double recalculateOnTrigger  // 0 Off (live) / 1 On: bodyDecay latched on each hit
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  int alg = (int)(safe(algorithm) + 0.5);
  alg = alg < kAlg808 ? kAlg808 : (alg > kAlgSimmons ? kAlgSimmons : alg);

  const bool resetHit = gate_hit(safe(reset), &s.lastReset);
  const double trig = safe(trigger);
  const bool triggerHit = gate_hit(trig, &s.lastTrigger);
  bool ping = false;
  if (resetHit) {
    clear_voice(s);
    if (s.v > 0.0) { strike(s, alg); ping = true; }
  }
  if (triggerHit) {
    s.v = gate_hit_velocity();
    strike(s, alg);
    ping = true;
  }
  // Recalculate On Trigger: On latches bodyDecay on each hit, so a ringing
  // hit keeps its decay; Off (default) reads them live (unchanged behaviour).
  if (ping) { s.latchA = bodyDecay; s.latchHas = true; }
  if (safe(recalculateOnTrigger) >= 0.5 && s.latchHas) { bodyDecay = s.latchA; }
  s.fOut = mind(safe(tune), 0.45 * sr);  // f out at rest = Tune (no bend)
  if (!ping && resting(s)) {
    s.envOut = s.rightOut = 0.0;
    return 0.0;
  }

  const double nyq = 0.45 * sr;
  const double f0 = safe(tune);
  const double bendOct = safe(bend);
  const double tn = safe(tone);
  const double bd = safe(bodyDecay);
  const double nz = safe(noise);
  const double amp = safe(amplitude);
  const double vRef = s.v > 0.0 ? s.v : 1.0;
  const double pv = ping ? s.v : 0.0;
  double body = 0.0;
  double nzOut[2] = {0.0, 0.0};
  double click = 0.0;
  double env = 0.0;
  double bendT60 = k909BendT60;

  if (alg == kAlg808) {
    s.e2 = s.e3 = s.eClick = 0.0;
    s.p = 0.0;
    const double level = s.e1 / vRef;
    const double f = mind(bendOct != 0.0 ? f0 * dsp_exp2(bendOct * level) : f0, nyq);
    s.fOut = f;
    const double r = t60_coeff(bd, sr);
    if (ping) s.fHit = f;
    body = ring2_tick(s.ring, f, r, pv, sr) * (f / s.fHit);
    const double lpHz = 300.0 * dsp_exp2(tn * 4.736965594166206);  // 300 Hz -> 8 kHz
    for (int c = 0; c < 2; c++) {
      const double w = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
      nzOut[c] = k808Noise * nz * s.eN * one_pole_lp_tick(s.lp[c], w, lpHz, sr);
    }
    env = (s.e1 + nz * s.eN) / (1.0 + nz);
    s.e1 = planck_snap(s.e1 * r);
    s.eN = planck_snap(s.eN * t60_coeff(k808NoiseT60 * bd, sr));
  } else if (alg == kAlg909) {
    s.eClick = 0.0;
    const double f = bendOct != 0.0 && s.p != 0.0 ? f0 * dsp_exp2(bendOct * s.p) : f0;
    s.fOut = mind(f, nyq);
    const double drive1 = 1.0 + 7.0 * tn;
    const double o1 = tanh_approx(drive1 * tri_wave(s.ph1)) / tanh_approx(drive1);
    const double o2 = tanh_approx(k909Round * tri_wave(s.ph2)) / tanh_approx(k909Round);
    const double o3 = tanh_approx(k909Round * tri_wave(s.ph3)) / tanh_approx(k909Round);
    s.ph1 = phase_advance(s.ph1, mind(f, nyq), sr);
    s.ph2 = phase_advance(s.ph2, mind(f * k909R2, nyq), sr);
    s.ph3 = phase_advance(s.ph3, mind(f * k909R3, nyq), sr);
    const double wSum = 1.0 + k909W2 + k909W3;
    body = (o1 * s.e1 + k909W2 * o2 * s.e2 + k909W3 * o3 * s.e3) / wSum;
    for (int c = 0; c < 2; c++) {
      const double w = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
      nzOut[c] = k909Noise * nz * s.eN * one_pole_lp_tick(s.lp[c], w, k909NoiseLp, sr);
    }
    env = ((s.e1 + k909W2 * s.e2 + k909W3 * s.e3) / wSum + nz * s.eN) / (1.0 + nz);
    s.e1 = planck_snap(s.e1 * t60_coeff(bd, sr));
    s.e2 = planck_snap(s.e2 * t60_coeff(k909D2 * bd, sr));
    s.e3 = planck_snap(s.e3 * t60_coeff(k909D3 * bd, sr));
    s.eN = planck_snap(s.eN * t60_coeff(k909NoiseT60, sr));
  } else {
    bendT60 = 0.5 * bd;
    s.e2 = s.e3 = 0.0;
    const double f = bendOct != 0.0 && s.p != 0.0 ? f0 * dsp_exp2(bendOct * s.p) : f0;
    s.fOut = mind(f, nyq);
    const double osc = dsp_sin_turns_lut(s.ph1);
    s.ph1 = phase_advance(s.ph1, mind(f, nyq), sr);
    const double e = s.e1;  // shared VCA
    body = e * (1.0 - nz) * osc;
    const double lpHz = mind(300.0 * dsp_exp2(tn * 5.321928094887363), nyq);  // 300 Hz -> 12 kHz
    TptSvfCoeffs k;
    tpt_svf_setup(k, (2.0 * kPi) * lpHz / sr, 1.0 / kSimQ, 1.0, 0.0, 0.0, 1.0);
    const double n0 = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 0));
    click = kSimClick * (n0 - one_pole_lp_tick(s.lpC, n0, 3000.0, sr)) * s.eClick;  // shared L/R
    for (int c = 0; c < 2; c++) {
      const double w = (c == 0 ? n0 : hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 1)));
      const double y = tpt_svf_tick(s.svf[c], k, w);
      s.svf[c].z1 = planck_snap(s.svf[c].z1);
      s.svf[c].z2 = planck_snap(s.svf[c].z2);
      nzOut[c] = e * nz * kSimNoise * y;
    }
    env = e;
    s.eN = 0.0;
    s.e1 = planck_snap(s.e1 * t60_coeff(bd, sr));
    s.eClick = planck_snap(s.eClick * t60_coeff(kSimClickT60, sr));
  }

  hash_noise_advance(s.white);
  s.p = planck_snap(s.p * t60_coeff(bendT60, sr));
  if (silent_planck(env)) {
    clear_voice(s);
    return 0.0;
  }
  s.envOut = planck_snap(env);
  const double trim = alg == kAlgSimmons ? 1.0 : 1.0 / (1.0 + kMixTrim * nz);
  const double outL = planck_snap(amp * trim * (body + nzOut[0] + click));
  const double outR = planck_snap(amp * trim * (body + nzOut[1] + click));
  s.rightOut = (outR * 0.0 == 0.0) ? outR : 0.0;
  return (outL * 0.0 == 0.0) ? outL : 0.0;
}

extern "C" double soemdsp_electro_tom_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].rightOut;
}

extern "C" double soemdsp_electro_tom_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

// f out (white jack, Hz): body pitch in Hz (Tune x Bend sweep, as played).
extern "C" double soemdsp_electro_tom_f(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].fOut;
}

extern "C" int soemdsp_electro_tom_version() { return 4; } // 4: f out (soemdsp_electro_tom_f, Hz: body pitch in Hz (Tune x Bend sweep, as played)). // 3: Ring2 rotating phasor (no energy pumped by bend retriggers). 2: Recalculate On Trigger (bodyDecay latched on hit)
extern "C" const char* soemdsp_electro_tom_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_electro_tom_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
