// soemdsp-native-module: electro_snare
// soemdsp-native-label: Electro Snare
// soemdsp-native-target: electroSnare
// soemdsp-native-kind: drum
//
// Electro Snare (docs/SNARE_PLAN.md, Argi go 2026-10-19): one snare voice,
// Trigger + Reset in, Snare L + Snare R + Env out, an Algorithm choice and one fixed set
// of eight shared params every algorithm reads (no per-algorithm params):
//   tune (Hz), tone (0..1), snappy (0..1), bodyDecay (s T60),
//   snapDecay (s T60), bend (oct), amplitude (0..1).
// Algorithms (choiceIds): 0 tr808, 1 tr909, 2 simmons, 3 modal, 4 fm.
//
// Hit model: Trigger (gate_hit) latches v = |height| and strikes. 808 / Modal
// add the new ping onto the ringing resonators; 909 / Simmons / FM reset the
// oscillator phases. Reset (gate_hit, height ignored) rewinds the hit: every
// resonator, filter, phase and envelope back to the start, noise reseeded,
// then strikes again at the last latched v (v = 0 before the first Trigger,
// so Reset is silent). Same sample: Reset first, then Trigger.
// Stereo (Argi 2026-10-19): everything noise-like is decorrelated per
// channel, the clean tonal body is identical L/R. Wire noise: one hash
// generator per channel (own seed; L keeps the original seed, so Snare L is
// bit-identical to the old mono Snare) with its own filter state. Modal: the
// non-axisymmetric membrane modes (11, 31, 12: odd angular order) flip polarity
// on R, like two pickups on opposite sides of the head; their level is Tone,
// so Tone 0 is identical L/R. FM: R's modulator is inverted (index sign), so
// the high-index noisy sidebands decorrelate; Tone 0 (index 0) is identical.
// Click transients (Simmons / Modal) are one shared click, identical L/R.
// Reset reseeds both generators (bit-exact restart).
// Env = overall amplitude envelope (mix-weighted component envelopes,
// peaks at v, excludes Amplitude). T60 everywhere: r = exp(-ln(1000)/(T60 sr)).
//
// Shared drum parts (docs/DRUM_PACK_PLAN.md Q1, Argi 2026-10-19): Ring2, the
// hash noise counter and the small helpers come from
// library/include/soemdsp/drum/drum_parts.h (bit-identical to the old local copies).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/tpt_svf.h>
#include <soemdsp/drum/drum_parts.h>

namespace {

using namespace soemdsp_maths;
using namespace soemdsp::drum;

static const int kMaxInstances = 64;
static const unsigned int kNoiseSeed = 0x5eed5a7eu;  // L (original); R = hash_noise_seed(kNoiseSeed, 1)
// Odd angular order (11, 31, 12): opposite pickup sees the mode inverted.
static const bool kModeOdd[6] = {false, true, false, false, true, true};
static const int kModes = 6;
// Ideal circular membrane (Bessel zeros / 2.405): 01 11 21 02 31 12.
static const double kModeRatio[kModes] = {1.0, 1.593, 2.136, 2.295, 2.653, 2.917};
static const bool kModeAxisym[kModes] = {true, false, false, true, false, false};

enum { kAlg808 = 0, kAlg909 = 1, kAlgSimmons = 2, kAlgModal = 3, kAlgFm = 4 };

// --- by-ear constants (docs/SNARE_PLAN.md "Fixed constants") ---
static const double k808Ratio = 1.93;      // high / low resonator
static const double k808DecayRatio = 0.31; // high / low T60
static const double k808NoiseHp = 1000.0;
static const double k808NoiseLp = 8000.0;
static const double k808BendT60 = 0.02;
static const double k808Wires = 0.8;
static const double k909Ratio = 1.72;      // VCO2 / VCO1
static const double k909Decay2 = 0.6;      // VCO2 T60 / VCO1 T60
static const double k909Round = 1.6;       // triangle -> sine soft-clip drive
static const double k909NoiseHp = 2500.0;
static const double k909Env5T60 = 0.015;
static const double k909BendT60 = 0.02;
static const double k909Wires = 0.9;
static const double kSimQ = 2.0;
static const double kSimClickT60 = 0.002;
static const double kSimClick = 0.4;
static const double kSimWires = 1.2;
static const double kModalBp = 3000.0;
static const double kModalBendT60 = 0.03;
static const double kModalClickT60 = 0.002;
static const double kModalClick = 0.3;
static const double kModalWires = 1.6;
static const double kFmRatio = 1.4;
static const double kFmIndexMax = 8.0;
static const double kFmNoiseHp = 1000.0;
static const double kFmBendT60 = 0.02;
static const double kFmWires = 0.8;
static const double kMixTrim = 0.6;     // output trim per unit Snappy (808 / 909 / Modal / FM)

struct State {
  bool active;
  double lastTrigger, lastReset;
  double v;            // latched velocity
  HashNoise white;      // noise counter (shared; seed per channel)
  double p;            // bend offset 1 -> 0
  double eA, eB, eC, eN, eClick;       // component envelopes
  double eMode[kModes];
  Ring2 ringL, ringH;
  Ring2 mode[kModes];
  double ph1, ph2;     // oscillator phases (turns)
  double lpA[2], lpB[2]; // per-channel noise one-pole states
  double lpC;            // shared click high-pass state
  TptSvfState svf[2];    // per-channel noise SVF
  double envOut;
  double rightOut;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"electro_snare\","
    "\"label\":\"Electro Snare\","
    "\"targetType\":\"electroSnare\","
    "\"kind\":\"drum\""
  "}";

static void clear_voice(State& s) {
  s.p = 0.0;
  s.eA = s.eB = s.eC = s.eN = s.eClick = 0.0;
  for (int k = 0; k < kModes; k++) { s.eMode[k] = 0.0; s.mode[k].y1 = s.mode[k].y2 = 0.0; }
  s.ringL.y1 = s.ringL.y2 = s.ringH.y1 = s.ringH.y2 = 0.0;
  s.ph1 = s.ph2 = 0.0;
  s.lpA[0] = s.lpA[1] = s.lpB[0] = s.lpB[1] = 0.0;
  s.lpC = 0.0;
  tpt_svf_reset(s.svf[0]);
  tpt_svf_reset(s.svf[1]);
  hash_noise_reset(s.white);
  s.envOut = 0.0;
  s.rightOut = 0.0;
}

static void init_state(State& s) {
  s.lastTrigger = 0.0;
  s.lastReset = 0.0;
  s.v = 0.0;
  clear_voice(s);
}

// Start a hit at velocity v. resonant: add pings (808 / Modal); else phase reset.
static void strike(State& s, int alg) {
  s.p = 1.0;
  s.eA = s.eB = s.eC = s.eN = s.eClick = s.v;
  for (int k = 0; k < kModes; k++) s.eMode[k] = s.v;
  if (alg == kAlg909 || alg == kAlgSimmons || alg == kAlgFm) {
    s.ph1 = 0.0;
    s.ph2 = 0.0;
  }
}

static bool resting(const State& s) {
  if (s.eA != 0.0 || s.eB != 0.0 || s.eC != 0.0 || s.eN != 0.0 || s.eClick != 0.0) return false;
  if (s.ringL.y1 != 0.0 || s.ringL.y2 != 0.0 || s.ringH.y1 != 0.0 || s.ringH.y2 != 0.0) return false;
  for (int k = 0; k < kModes; k++) {
    if (s.eMode[k] != 0.0 || s.mode[k].y1 != 0.0 || s.mode[k].y2 != 0.0) return false;
  }
  return true;
}

}  // namespace

extern "C" int soemdsp_electro_snare_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      init_state(gPool[i]);
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_electro_snare_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Snare L. soemdsp_electro_snare_right() / _env() are this sample's
// Snare R / Env.
extern "C" double soemdsp_electro_snare_sample(
  int handle,
  double trigger,
  double reset,
  double algorithm,
  double tune,
  double tone,
  double snappy,
  double bodyDecay,
  double snapDecay,
  double bend,
  double amplitude,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  int alg = (int)(safe(algorithm) + 0.5);
  alg = alg < kAlg808 ? kAlg808 : (alg > kAlgFm ? kAlgFm : alg);

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
  if (!ping && resting(s)) {
    s.envOut = 0.0;
    s.rightOut = 0.0;
    return 0.0;
  }

  const double f0 = clamp(safe(tune), 1.0, 0.45 * sr);
  const double tn = clamp(safe(tone), 0.0, 1.0);
  const double sn = clamp(safe(snappy), 0.0, 1.0);
  const double bd = clamp(safe(bodyDecay), 0.001, 10.0);
  const double nd = clamp(safe(snapDecay), 0.001, 10.0);
  const double bendOct = clamp(safe(bend), 0.0, 8.0);
  const double amp = clamp(safe(amplitude), 0.0, 1.0);
  const double pv = ping ? s.v : 0.0;
  const double bendMul = (s.p != 0.0 && bendOct != 0.0) ? dsp_exp2(bendOct * s.p) : 1.0;
  const double f = f0 * bendMul;
  const double vRef = s.v > 0.0 ? s.v : 1.0;

  double body = 0.0;
  double bodyR = 0.0;  // R body where it differs (Modal / FM noise-like parts)
  bool bodyStereo = false;
  double wires[2] = {0.0, 0.0};
  double env = 0.0;
  double bendT60 = k808BendT60;

  if (alg == kAlg808) {
    s.eC = s.eClick = 0.0;
    const double rL = t60_coeff(bd, sr);
    const double rH = t60_coeff(k808DecayRatio * bd, sr);
    const double yL = ring2_tick(s.ringL, f, rL, pv, sr);
    const double yH = ring2_tick(s.ringH, f * k808Ratio, rH, pv, sr);
    body = (1.0 - tn) * yL + tn * yH;
    for (int c = 0; c < 2; c++) {
      const double n = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
      const double hp = n - one_pole_lp_tick(s.lpA[c], n, k808NoiseHp, sr);
      const double nz = one_pole_lp_tick(s.lpB[c], hp, k808NoiseLp, sr);
      wires[c] = k808Wires * nz * s.eN * sn;
    }
    env = ((1.0 - tn) * s.eA + tn * s.eB + sn * s.eN) / (1.0 + sn);
    s.eA = planck_snap(s.eA * rL);
    s.eB = planck_snap(s.eB * rH);
    s.eN = planck_snap(s.eN * t60_coeff(nd, sr));
  } else if (alg == kAlg909) {
    bendT60 = k909BendT60;
    s.eC = 0.0;
    const double norm = 1.0 / tanh_approx(k909Round);
    const double o1 = tanh_approx(k909Round * tri_wave(s.ph1)) * norm;
    const double o2 = tanh_approx(k909Round * tri_wave(s.ph2)) * norm;
    s.ph1 = phase_advance(s.ph1, f, sr);
    s.ph2 = phase_advance(s.ph2, f * k909Ratio, sr);
    body = 0.5 * (o1 * s.eA + o2 * s.eB);
    const double lpHz = 2000.0 * dsp_exp2(tn * 2.584962500721156);  // 2 kHz -> 12 kHz
    for (int c = 0; c < 2; c++) {
      const double n = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
      const double lp = one_pole_lp_tick(s.lpA[c], n, lpHz, sr);
      const double hp = lp - one_pole_lp_tick(s.lpB[c], lp, k909NoiseHp, sr);
      wires[c] = k909Wires * sn * (lp * s.eN + hp * s.eClick);
    }
    env = (s.eA + s.eB + sn * s.eN) / (2.0 + sn);
    s.eA = planck_snap(s.eA * t60_coeff(bd, sr));
    s.eB = planck_snap(s.eB * t60_coeff(k909Decay2 * bd, sr));
    s.eN = planck_snap(s.eN * t60_coeff(nd, sr));
    s.eClick = planck_snap(s.eClick * t60_coeff(k909Env5T60, sr));
  } else if (alg == kAlgSimmons) {
    bendT60 = 0.5 * bd;
    s.eB = s.eC = 0.0;
    const double osc = dsp_sin_turns_lut(s.ph1);
    s.ph1 = phase_advance(s.ph1, f, sr);
    TptSvfCoeffs k;
    const double lpHz = mind(300.0 * dsp_exp2(tn * 5.321928094887363), 0.45 * sr);  // 300 Hz -> 12 kHz
    tpt_svf_setup(k, (2.0 * kPi) * lpHz / sr, 1.0 / kSimQ, 1.0, 0.0, 0.0, 1.0);
    const double nShare = s.eN / vRef;  // inner noise envelope, 1 -> 0
    const double e = s.eA;              // shared VCA
    body = e * (1.0 - sn) * osc;
    const double n0 = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 0));
    const double click = kSimClick * (n0 - one_pole_lp_tick(s.lpC, n0, 3000.0, sr)) * s.eClick;  // shared L/R
    for (int c = 0; c < 2; c++) {
      const double nz = tpt_svf_tick(s.svf[c], k, (c == 0 ? n0 : hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 1))));
      s.svf[c].z1 = planck_snap(s.svf[c].z1);
      s.svf[c].z2 = planck_snap(s.svf[c].z2);
      wires[c] = e * sn * kSimWires * nz * nShare + click;
    }
    env = e * ((1.0 - sn) + sn * nShare);
    s.eA = planck_snap(s.eA * t60_coeff(bd, sr));
    s.eN = planck_snap(s.eN * t60_coeff(nd, sr));
    s.eClick = planck_snap(s.eClick * t60_coeff(kSimClickT60, sr));
  } else if (alg == kAlgModal) {
    bendT60 = kModalBendT60;
    s.eA = s.eB = s.eC = 0.0;
    double wSum = 0.0;
    double eSum = 0.0;
    for (int m = 0; m < kModes; m++) {
      const double w = kModeAxisym[m] ? 1.0 : tn;
      const double rr = t60_coeff(bd / kModeRatio[m], sr);
      const double y = ring2_tick(s.mode[m], f * kModeRatio[m], rr, pv, sr);
      body += w * y;
      bodyR += kModeOdd[m] ? -w * y : w * y;
      wSum += w;
      eSum += w * s.eMode[m];
      s.eMode[m] = planck_snap(s.eMode[m] * rr);
    }
    body /= wSum;
    bodyR /= wSum;
    bodyStereo = true;
    eSum /= wSum;
    TptSvfCoeffs k;
    tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * mind(kModalBp, 0.45 * sr) / sr, 1.0);
    const double n0 = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 0));
    const double click = kModalClick * (n0 - one_pole_lp_tick(s.lpC, n0, 3000.0, sr)) * s.eClick;  // shared L/R
    for (int c = 0; c < 2; c++) {
      const double bp = tpt_svf_tick(s.svf[c], k, (c == 0 ? n0 : hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 1))));
      s.svf[c].z1 = planck_snap(s.svf[c].z1);
      s.svf[c].z2 = planck_snap(s.svf[c].z2);
      wires[c] = kModalWires * bp * s.eN * sn + click;
    }
    env = (eSum + sn * s.eN) / (1.0 + sn);
    s.eN = planck_snap(s.eN * t60_coeff(nd, sr));
    s.eClick = planck_snap(s.eClick * t60_coeff(kModalClickT60, sr));
  } else {
    bendT60 = kFmBendT60;
    s.eB = s.eC = s.eClick = 0.0;
    const double ec = s.eA / vRef;  // index follows the body envelope
    const double index = kFmIndexMax * tn * ec;
    const double modv = dsp_sin_turns_lut(s.ph2);
    const double pm = index * modv * (1.0 / (2.0 * kPi));
    const double car = dsp_sin_turns_lut(s.ph1 + pm);
    // R: inverted modulator. Index 0 -> pm 0 -> identical carrier.
    const double carR = pm != 0.0 ? dsp_sin_turns_lut(s.ph1 - pm) : car;
    s.ph1 = phase_advance(s.ph1, f, sr);
    s.ph2 = phase_advance(s.ph2, f * kFmRatio, sr);
    body = car * s.eA;
    bodyR = carR * s.eA;
    bodyStereo = true;
    for (int c = 0; c < 2; c++) {
      const double n = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
      const double hp = n - one_pole_lp_tick(s.lpA[c], n, kFmNoiseHp, sr);
      wires[c] = kFmWires * hp * s.eN * sn;
    }
    env = (s.eA + sn * s.eN) / (1.0 + sn);
    s.eA = planck_snap(s.eA * t60_coeff(bd, sr));
    s.eN = planck_snap(s.eN * t60_coeff(nd, sr));
  }

  hash_noise_advance(s.white);
  if (alg != kAlgModal) for (int m = 0; m < kModes; m++) s.eMode[m] = 0.0;
  s.p = planck_snap(s.p * t60_coeff(bendT60, sr));
  // Rest: once Env is below Planck the hit is over; drop every tail too, so
  // Snare and Env both sit at exact 0 (downstream gates re-arm).
  if (silent_planck(env)) {
    clear_voice(s);
    s.envOut = 0.0;
    s.rightOut = 0.0;
    return 0.0;
  }
  s.envOut = planck_snap(env);
  // Mix trim: body peaks at v, so scale body + wires back toward v as Snappy
  // adds noise (Simmons already balances noise against tone).
  const double trim = (alg == kAlgSimmons) ? 1.0 : 1.0 / (1.0 + kMixTrim * sn);
  const double outL = planck_snap(amp * trim * (body + wires[0]));
  const double outR = planck_snap(amp * trim * ((bodyStereo ? bodyR : body) + wires[1]));
  s.rightOut = (outR * 0.0 == 0.0) ? outR : 0.0;
  return (outL * 0.0 == 0.0) ? outL : 0.0;
}

extern "C" double soemdsp_electro_snare_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].rightOut;
}

extern "C" double soemdsp_electro_snare_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

extern "C" int soemdsp_electro_snare_version() { return 2; }  // 2: stereo Snare L / Snare R
extern "C" const char* soemdsp_electro_snare_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_electro_snare_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
