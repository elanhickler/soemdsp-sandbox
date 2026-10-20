// soemdsp-native-module: electro_kick
// soemdsp-native-label: Electro Kick
// soemdsp-native-target: electroKick
// soemdsp-native-kind: drum
//
// Electro Kick (docs/DRUM_PACK_PLAN.md §5, Argi go 2026-10-19): the classic
// machine kicks, separate from Robin Sinepulse. Trigger + Reset in, Kick L +
// Kick R + Env out. One fixed shared param set:
//   tune (Hz), bend (oct), bendTime (s T60), decay (s T60), click (0..1),
//   tone (0..1), amplitude (0..1).
// Algorithms (choiceIds): 0 tr808, 1 tr909, 2 simmons.
//   808: pinged 2-pole resonator (bridged-T stand-in), attack jump Bend oct
//        falling with Bend Time, fixed slow "sigh" (pitch +6 % at full level),
//        trigger-pulse click, Tone = output lowpass. Retrigger adds onto the ring.
//   909: phase-reset triangle soft-clipped (Tone = drive, sine -> square), pitch
//        sweep Bend oct over Bend Time, click = pulse + low-passed noise.
//   Simmons: sine with Bend / Bend Time, resonant-lowpassed noise, Tone =
//        tone <-> noise balance, shared click.
// Hit model as Electro Snare (Trigger latches v = |height|; Reset rewinds,
// reseeds and re-strikes; silent before the first Trigger; Reset first).
// Stereo: body identical L/R (mono low end); only the 909 attack noise and the
// Simmons noise are per channel (own seed, own filter). Click pulse shared.
// Env = (eBody + click eClick) / (1 + click): peaks at v, excludes Amplitude.
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
static const unsigned int kNoiseSeed = 0x6b1c5eedu;
enum { kAlg808 = 0, kAlg909 = 1, kAlgSimmons = 2 };

// --- by-ear constants ---
static const double k808Sigh = 0.06;
static const double k808ClickT60 = 0.004;
static const double k808Click = 0.6;
static const double k909ClickT60 = 0.003;
static const double k909NoiseT60 = 0.012;
static const double k909NoiseLp = 3000.0;
static const double k909Pulse = 0.5;
static const double k909Noise = 0.5;
static const double kSimQ = 2.0;
static const double kSimNoiseLp = 1500.0;
static const double kSimNoise = 1.5;
static const double kSimClickT60 = 0.002;
static const double kSimClick = 0.5;
static const double kMixTrim = 0.4;

struct State {
  bool active;
  double lastTrigger, lastReset;
  double v;
  HashNoise white;
  double p;              // bend 1 -> 0
  double eBody, eClick, eN;
  Ring2 ring;
  double fHit;           // 808 ring pitch at the last ping
  double ph;
  double lpOut;          // 808 output lowpass (mono: no noise)
  double lp[2];          // 909 noise lowpass per channel
  double lpC;            // Simmons click high-pass (shared)
  TptSvfState svf[2];
  double envOut, rightOut;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"electro_kick\","
    "\"label\":\"Electro Kick\","
    "\"targetType\":\"electroKick\","
    "\"kind\":\"drum\""
  "}";

static void clear_voice(State& s) {
  s.p = 0.0;
  s.eBody = s.eClick = s.eN = 0.0;
  ring2_reset(s.ring);
  s.fHit = 1.0;
  s.ph = 0.0;
  s.lpOut = 0.0;
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
  s.eBody = s.eClick = s.eN = s.v;
  if (alg != kAlg808) s.ph = 0.0;
}

static bool resting(const State& s) {
  return s.eBody == 0.0 && s.eClick == 0.0 && s.eN == 0.0 && ring2_resting(s.ring) && s.lpOut == 0.0;
}

}  // namespace

extern "C" int soemdsp_electro_kick_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      init_state(gPool[i]);
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_electro_kick_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Kick L. soemdsp_electro_kick_right() / _env() are this sample's Kick R / Env.
extern "C" double soemdsp_electro_kick_sample(
  int handle,
  double trigger,
  double reset,
  double algorithm,
  double tune,
  double bend,
  double bendTime,
  double decay,
  double click,
  double tone,
  double amplitude,
  double sampleRate
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
    s.v = dsp_fabs(trig);
    strike(s, alg);
    ping = true;
  }
  if (!ping && resting(s)) {
    s.envOut = s.rightOut = 0.0;
    return 0.0;
  }

  const double nyq = 0.45 * sr;
  const double f0 = safe(tune);
  const double bendOct = safe(bend);
  const double bt = safe(bendTime);
  const double dc = safe(decay);
  const double ck = safe(click);
  const double tn = safe(tone);
  const double amp = safe(amplitude);
  const double vRef = s.v > 0.0 ? s.v : 1.0;
  const double pv = ping ? s.v : 0.0;
  const double bendMul = (bendOct != 0.0 && s.p != 0.0) ? dsp_exp2(bendOct * s.p) : 1.0;
  double out[2] = {0.0, 0.0};
  double env = 0.0;

  if (alg == kAlg808) {
    s.eN = 0.0;
    const double r = t60_coeff(dc, sr);
    const double f = mind(f0 * bendMul * (1.0 + k808Sigh * (s.eBody / vRef)), nyq);
    if (ping) s.fHit = f;
    const double body = ring2_tick(s.ring, f, r, pv, sr) * (f / s.fHit);
    const double pulse = k808Click * ck * s.eClick;
    const double lpHz = 200.0 * dsp_exp2(tn * 6.643856189774724);  // 200 Hz -> 20 kHz
    const double y = one_pole_lp_tick(s.lpOut, body + pulse, lpHz, sr);
    out[0] = out[1] = y;
    env = (s.eBody + ck * s.eClick) / (1.0 + ck);
    s.eBody = planck_snap(s.eBody * r);
    s.eClick = planck_snap(s.eClick * t60_coeff(k808ClickT60, sr));
  } else if (alg == kAlg909) {
    const double f = mind(f0 * bendMul, nyq);
    const double drive = 1.2 + 6.0 * tn;
    const double body = s.eBody * tanh_approx(drive * tri_wave(s.ph)) / tanh_approx(drive);
    s.ph = phase_advance(s.ph, f, sr);
    const double pulse = k909Pulse * s.eClick;
    for (int c = 0; c < 2; c++) {
      const double w = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
      const double nz = k909Noise * s.eN * one_pole_lp_tick(s.lp[c], w, k909NoiseLp, sr);
      out[c] = body + ck * (pulse + nz);
    }
    env = (s.eBody + ck * s.eClick) / (1.0 + ck);
    s.eBody = planck_snap(s.eBody * t60_coeff(dc, sr));
    s.eClick = planck_snap(s.eClick * t60_coeff(k909ClickT60, sr));
    s.eN = planck_snap(s.eN * t60_coeff(k909NoiseT60, sr));
  } else {
    s.eN = 0.0;
    const double f = mind(f0 * bendMul, nyq);
    const double osc = dsp_sin_turns_lut(s.ph);
    s.ph = phase_advance(s.ph, f, sr);
    const double e = s.eBody;
    TptSvfCoeffs k;
    tpt_svf_setup(k, (2.0 * kPi) * mind(kSimNoiseLp, nyq) / sr, 1.0 / kSimQ, 1.0, 0.0, 0.0, 1.0);
    const double n0 = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 0));
    const double clk = kSimClick * ck * (n0 - one_pole_lp_tick(s.lpC, n0, 3000.0, sr)) * s.eClick;  // shared
    for (int c = 0; c < 2; c++) {
      const double w = (c == 0 ? n0 : hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 1)));
      const double y = tn != 0.0 ? tpt_svf_tick(s.svf[c], k, w) : 0.0;
      s.svf[c].z1 = planck_snap(s.svf[c].z1);
      s.svf[c].z2 = planck_snap(s.svf[c].z2);
      out[c] = e * ((1.0 - tn) * osc + tn * kSimNoise * y) + clk;
    }
    env = (e + ck * s.eClick) / (1.0 + ck);
    s.eBody = planck_snap(s.eBody * t60_coeff(dc, sr));
    s.eClick = planck_snap(s.eClick * t60_coeff(kSimClickT60, sr));
  }

  hash_noise_advance(s.white);
  s.p = planck_snap(s.p * t60_coeff(bt, sr));
  if (silent_planck(env)) {
    clear_voice(s);
    return 0.0;
  }
  s.envOut = planck_snap(env);
  const double trim = 1.0 / (1.0 + kMixTrim * ck);
  const double outL = planck_snap(amp * trim * out[0]);
  const double outR = planck_snap(amp * trim * out[1]);
  s.rightOut = (outR * 0.0 == 0.0) ? outR : 0.0;
  return (outL * 0.0 == 0.0) ? outL : 0.0;
}

extern "C" double soemdsp_electro_kick_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].rightOut;
}

extern "C" double soemdsp_electro_kick_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

extern "C" int soemdsp_electro_kick_version() { return 1; }
extern "C" const char* soemdsp_electro_kick_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_electro_kick_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
