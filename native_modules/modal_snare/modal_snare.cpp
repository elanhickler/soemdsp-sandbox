// soemdsp-native-module: modal_snare
// soemdsp-native-label: Modal Snare
// soemdsp-native-target: modalSnare
// soemdsp-native-kind: drum
//
// Modal Snare (Argi 2026-10-20): the Modal algorithm split out of Electro Snare
// (bit-identical to Electro Snare Modal at default noise settings). Six ideal
// circular-membrane modes (Bessel ratios 01 11 21 02 31 12) pinged by Trigger,
// plus band-passed noise wires and a short noise click.
// Trigger + Reset in, Snare L + Snare R + Env out. Params:
//   tune (Hz, 01 mode), tone (0..1 strike position: level of the
//   non-axisymmetric modes), snappy (0..1 wires level), bodyDecay (s T60 of 01;
//   mode k uses / ratio), snapDecay (s T60 wires), bend (oct, ~30 ms drop),
//   amplitude (no hidden clamp: the param range governs),
//   noiseFreq (Hz wires band-pass centre), noiseQ (band-pass Q), click (click
//   level), clickDecay (ms T60), noiseTilt (-1 dark .. +1 bright one-pole tilt
//   pivoting at noiseFreq), bodyNoise (Body / Noise: -1 body only, 0 both at
//   full level = the original sound, +1 noise only; noise = wires + click;
//   linear balance: only the far side fades). Noise defaults 3000 / 1 / 0.3 / 2 / 0 = the old
//   fixed Electro Snare Modal constants.
// Hit model: Trigger (gate_hit) latches v = |height| and adds a new ping onto
// the ringing modes. Reset rewinds everything (noise reseeded) and strikes again
// at the last v (silent before the first Trigger). Same sample: Reset first.
// Stereo: noise per channel (own seed; L keeps Electro Snare's seed); odd
// angular modes (11, 31, 12) flip polarity on R; the click is shared L/R.
// Env = mix-weighted mode + wires envelope (peaks at v, excludes Amplitude).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/tpt_svf.h>
#include <soemdsp/drum/drum_parts.h>

namespace {

using namespace soemdsp_maths;
using namespace soemdsp::drum;

static const int kMaxInstances = 64;
static const unsigned int kNoiseSeed = 0x5eed5a7eu;  // same as Electro Snare
static const int kModes = 6;
static const double kModeRatio[kModes] = {1.0, 1.593, 2.136, 2.295, 2.653, 2.917};
static const bool kModeAxisym[kModes] = {true, false, false, true, false, false};
static const bool kModeOdd[kModes] = {false, true, false, false, true, true};
static const double kBendT60 = 0.03;
static const double kWires = 1.6;
static const double kMixTrim = 0.6;

struct State {
  double fOut;  // f out (Hz), this sample
  double latchA;  // Recalculate On Trigger: decay params latched on the last hit
  double latchB;
  double latchC;  // Body / Noise latched on the last hit
  double latchTune, latchTone, latchSnappy;  // Tune / Tone / Snappy latched on the last hit
  bool latchHas;
  bool active;
  double lastTrigger, lastReset;
  double v;
  HashNoise white;
  double p;
  double eN, eClick;
  double eMode[kModes];
  Ring2 mode[kModes];
  double lpT[2];       // per-channel tilt one-pole
  double lpC;          // shared click high-pass state
  TptSvfState svf[2];
  double envOut;
  double rightOut;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"modal_snare\","
    "\"label\":\"Modal Snare\","
    "\"targetType\":\"modalSnare\","
    "\"kind\":\"drum\""
  "}";

static void clear_voice(State& s) {
  s.p = 0.0;
  s.eN = s.eClick = 0.0;
  for (int k = 0; k < kModes; k++) { s.eMode[k] = 0.0; s.mode[k].y1 = s.mode[k].y2 = 0.0; }
  s.lpT[0] = s.lpT[1] = 0.0;
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

static void strike(State& s) {
  s.p = 1.0;
  s.eN = s.eClick = s.v;
  for (int k = 0; k < kModes; k++) s.eMode[k] = s.v;
}

static bool resting(const State& s) {
  if (s.eN != 0.0 || s.eClick != 0.0) return false;
  for (int k = 0; k < kModes; k++) {
    if (s.eMode[k] != 0.0 || s.mode[k].y1 != 0.0 || s.mode[k].y2 != 0.0) return false;
  }
  return true;
}

}  // namespace

extern "C" int soemdsp_modal_snare_create() {
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

extern "C" void soemdsp_modal_snare_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Snare L. soemdsp_modal_snare_right() / _env() are this sample's R / Env.
extern "C" double soemdsp_modal_snare_sample(
  int handle,
  double trigger,
  double reset,
  double tune,
  double tone,
  double snappy,
  double bodyDecay,
  double snapDecay,
  double bend,
  double amplitude,
  double noiseFreq,
  double noiseQ,
  double click,
  double clickDecayMs,
  double noiseTilt,
  double sampleRate,
  double recalculateOnTrigger,  // 0 Off (live) / 1 On: bodyDecay / snapDecay / bodyNoise / tune / tone / snappy latched on each hit
  double bodyNoise  // Body / Noise: -1 body only, 0 both (unchanged), +1 noise (wires + click) only
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;

  const bool resetHit = gate_hit(safe(reset), &s.lastReset);
  const bool triggerHit = gate_hit(safe(trigger), &s.lastTrigger);
  bool ping = false;
  if (resetHit) {
    clear_voice(s);
    if (s.v > 0.0) { strike(s); ping = true; }
  }
  if (triggerHit) {
    s.v = gate_hit_velocity();
    strike(s);
    ping = true;
  }
  // Recalculate On Trigger: On latches bodyDecay, snapDecay, bodyNoise, tune, tone and snappy on each hit, so a ringing
  // hit keeps its decay; Off (default) reads them live (unchanged behaviour).
  if (ping) { s.latchA = bodyDecay; s.latchB = snapDecay; s.latchC = bodyNoise; s.latchTune = tune; s.latchTone = tone; s.latchSnappy = snappy; s.latchHas = true; }
  if (safe(recalculateOnTrigger) >= 0.5 && s.latchHas) { bodyDecay = s.latchA; snapDecay = s.latchB; bodyNoise = s.latchC; tune = s.latchTune; tone = s.latchTone; snappy = s.latchSnappy; }
  s.fOut = clamp(safe(tune), 1.0, 0.45 * sr);  // f out at rest = Tune (no bend)
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
  const double amp = safe(amplitude);
  const double nf = mind(clamp(safe(noiseFreq), 20.0, 20000.0), 0.45 * sr);
  const double nq = clamp(safe(noiseQ), 0.1, 50.0);
  const double clk = safe(click);
  const double clkT60 = clamp(safe(clickDecayMs), 0.01, 1000.0) / 1000.0;
  const double tilt = clamp(safe(noiseTilt), -1.0, 1.0);
  const double bn = clamp(safe(bodyNoise), -1.0, 1.0);
  const double gBody = bn > 0.0 ? 1.0 - bn : 1.0;
  const double gNoise = bn < 0.0 ? 1.0 + bn : 1.0;
  const double pv = ping ? s.v : 0.0;
  const double bendMul = (s.p != 0.0 && bendOct != 0.0) ? dsp_exp2(bendOct * s.p) : 1.0;
  const double f = f0 * bendMul;
  s.fOut = f;

  double body = 0.0, bodyR = 0.0, wSum = 0.0, eSum = 0.0;
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
  eSum /= wSum;
  TptSvfCoeffs k;
  tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * nf / sr, nq);
  const double n0 = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 0));
  const double clickV = clk * (n0 - one_pole_lp_tick(s.lpC, n0, 3000.0, sr)) * s.eClick;  // shared L/R
  double wires[2];
  for (int c = 0; c < 2; c++) {
    const double bp = tpt_svf_tick(s.svf[c], k, (c == 0 ? n0 : hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, 1))));
    s.svf[c].z1 = planck_snap(s.svf[c].z1);
    s.svf[c].z2 = planck_snap(s.svf[c].z2);
    // Tilt: one-pole split at noiseFreq; +1 doubles the highs, -1 keeps only the lows; 0 = plain band-pass.
    const double hpT = bp - one_pole_lp_tick(s.lpT[c], bp, nf, sr);
    const double bpT = (tilt != 0.0) ? bp + tilt * hpT : bp;
    wires[c] = kWires * bpT * s.eN * sn + clickV;
  }
  const double env = (eSum + sn * s.eN) / (1.0 + sn);
  // Liveness keeps the full env (a faded side still rings); Env out follows the balance.
  const double envMix = (gBody * eSum + gNoise * sn * s.eN) / (1.0 + sn);
  s.eN = planck_snap(s.eN * t60_coeff(nd, sr));
  s.eClick = planck_snap(s.eClick * t60_coeff(clkT60, sr));

  hash_noise_advance(s.white);
  s.p = planck_snap(s.p * t60_coeff(kBendT60, sr));
  if (silent_planck(env)) {
    clear_voice(s);
    return 0.0;
  }
  s.envOut = planck_snap(envMix);
  const double trim = 1.0 / (1.0 + kMixTrim * sn);
  const double outL = planck_snap(amp * trim * (gBody * body + gNoise * wires[0]));
  const double outR = planck_snap(amp * trim * (gBody * bodyR + gNoise * wires[1]));
  s.rightOut = (outR * 0.0 == 0.0) ? outR : 0.0;
  return (outL * 0.0 == 0.0) ? outL : 0.0;
}

extern "C" double soemdsp_modal_snare_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].rightOut;
}

extern "C" double soemdsp_modal_snare_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

// f out (white jack, Hz): fundamental mode pitch in Hz (Tune x Bend sweep, as played).
extern "C" double soemdsp_modal_snare_f(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].fOut;
}

extern "C" int soemdsp_modal_snare_version() { return 7; } // 7: f out (soemdsp_modal_snare_f, Hz: fundamental mode pitch in Hz (Tune x Bend sweep, as played)). // 6: Recalculate On Trigger also latches Tune / Tone / Snappy. 5: Recalculate On Trigger also latches Body / Noise. 4: Body / Noise balance (bodyNoise, last arg). 3: Ring2 rotating phasor (no energy pumped by bend retriggers). 2: Recalculate On Trigger (bodyDecay / snapDecay latched on hit)
extern "C" const char* soemdsp_modal_snare_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_modal_snare_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
