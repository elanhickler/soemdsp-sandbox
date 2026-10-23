// soemdsp-native-module: electro_hat
// soemdsp-native-label: Electro Hat
// soemdsp-native-target: electroHat
// soemdsp-native-kind: drum
//
// Electro Hat (docs/DRUM_PACK_PLAN.md §3, Argi go 2026-10-19): one hi-hat
// voice, stereo from the start. Trigger (label Closed) + Open + Reset in,
// Hat L + Hat R + Env out. One fixed shared param set every algorithm reads:
//   tune (x), tone (0..1), closedDecay (s T60), openDecay (s T60),
//   metal (0..1), amplitude (0..1).
// Algorithms (choiceIds): 0 tr808, 1 tr606, 2 fm, 3 noise.
//
// Choke (one voice): Open hit restarts the VCA at v with Open Decay; Closed
// restarts it with Closed Decay and replaces a ringing open hat. A hit while
// the VCA is still ringing ramps from the current level to v over 1 ms
// (declick), then decays. Closed + Open on the same sample: Closed wins.
// Reset (height ignored) rewinds every phase, filter and envelope, reseeds the
// noise and re-strikes the last hit (closed or open) at the last v; silent
// before the first hit. Same sample: Reset first, then the hit.
// Oscillators are free-running (a hit does not reset them); they start at a
// fixed phase spread on create / Reset, and pause while the voice rests.
// Stereo (Argi Q6, 2026-10-19: no width knob): the metal / FM oscillators
// are one shared bank (identical L/R); only the white noise is per channel
// (own seed, own filter state). Metal 1 on 808 / 606 / FM is bit-identical L/R.
// Env = the VCA (peaks at v on a fresh hit, excludes Amplitude, exact 0 at rest).
// Params arrive clamped to their slider ranges (no second clamp here).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/tpt_svf.h>
#include <soemdsp/drum/drum_parts.h>

namespace {

using namespace soemdsp_maths;
using namespace soemdsp::drum;

static const int kMaxInstances = 64;
static const int kOsc = 6;
static const unsigned int kNoiseSeed = 0x4a7e5eedu;
enum { kAlg808 = 0, kAlg606 = 1, kAlgFm = 2, kAlgNoise = 3 };

// 808 metal bank (TR-808 service notes / Werner-Abel-Smith 2014), Hz.
static const double k808Hz[kOsc] = {205.3, 304.4, 369.6, 522.7, 540.0, 800.0};
// 606: units vary; picked by ear (higher, tighter cluster).
static const double k606Hz[kOsc] = {245.0, 306.0, 365.0, 415.0, 437.0, 619.0};
static const double kDuty = 0.48;
static const double kPhaseL[kOsc] = {0.0, 0.17, 0.34, 0.51, 0.68, 0.85};
// --- by-ear constants ---
static const double kDeclickS = 0.001;
static const double k808Bp = 7100.0, k808BpQ = 1.2, k808Hp = 6000.0, k808Gain = 4.4;
static const double k606Bp = 9000.0, k606BpQ = 0.7, k606Hp = 6500.0, k606HpQ = 2.5, k606Gain = 1.8;
// FM: carrier + 1.4142 modulator, ring-modulated by a pulse pair, high-passed.
static const double kFmCar = 1047.0, kFmModRatio = 1.4142, kFmRing1 = 1616.0, kFmRing2 = 2393.0;
static const double kFmIndexLo = 2.0, kFmIndexHi = 12.0, kFmHp = 4000.0, kFmGain = 0.62;
static const double kNoiseMix = 0.3;  // white noise level vs the metal source (Metal < 1)
static const double kNoiseBp = 8000.0, kNoiseHpRatio = 0.5, kNoiseGain = 0.75;

struct Chan {
  TptSvfState bp, hp;
};

struct State {
  double fOut;  // f out (Hz), this sample
  double latchA;  // Recalculate On Trigger: decay params latched on the last hit
  double latchB;
  bool latchHas;
  bool active;
  double lastClosed, lastOpen, lastReset;
  double v;
  bool open;                   // last hit was open
  bool everHit;
  double vca;
  double rampFrom;
  int rampLeft, rampLen;
  HashNoise white;
  BlepSquare sq[kOsc];         // shared metal bank
  double phC, phM;             // FM carrier / modulator (shared)
  Chan ch[2];
  double envOut, rightOut;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"electro_hat\","
    "\"label\":\"Electro Hat\","
    "\"targetType\":\"electroHat\","
    "\"kind\":\"drum\""
  "}";

static void rewind_oscillators(State& s) {
  for (int k = 0; k < kOsc; k++) blep_square_reset(s.sq[k], kPhaseL[k]);
  s.phC = 0.0;
  s.phM = 0.0;
}

static void clear_voice(State& s) {
  s.vca = 0.0;
  s.rampFrom = 0.0;
  s.rampLeft = s.rampLen = 0;
  for (int c = 0; c < 2; c++) { tpt_svf_reset(s.ch[c].bp); tpt_svf_reset(s.ch[c].hp); }
  hash_noise_reset(s.white);
  s.envOut = s.rightOut = 0.0;
}

static void init_state(State& s) {
  s.lastClosed = s.lastOpen = s.lastReset = 0.0;
  s.v = 0.0;
  s.open = false;
  s.everHit = false;
  clear_voice(s);
  rewind_oscillators(s);
}

static void strike(State& s, double sr) {
  if (s.vca == 0.0) {
    s.vca = s.v;
    s.rampLeft = 0;
  } else {
    s.rampFrom = s.vca;
    s.rampLen = (int)(kDeclickS * sr + 0.5);
    if (s.rampLen < 1) s.rampLen = 1;
    s.rampLeft = s.rampLen;
  }
}

static inline double octave_shift(double tone) { return dsp_exp2(2.0 * tone - 1.0); }  // 0.5x .. 2x

// f out: the main filter centre each algorithm plays (the voice has no single
// pitch): 808 / 606 band-pass centre x Tone shift, FM high-pass corner x Tone
// shift, Noise band-pass centre (Tune x 8 kHz). Nyquist-limited as played.
static inline double hat_center_hz(int alg, double tune, double tone, double sr) {
  const double nyq = 0.45 * sr;
  if (alg == kAlg808) return mind(k808Bp * octave_shift(tone), nyq);
  if (alg == kAlg606) return mind(k606Bp * octave_shift(tone), nyq);
  if (alg == kAlgFm) return mind(kFmHp * octave_shift(tone), nyq);
  return mind(kNoiseBp * tune, nyq);
}

// Shared tonal source (metal bank / FM), identical L/R.
static double metal_tick(State& s, int alg, double tune, double tone, double sr) {
  const double nyq = 0.45 * sr;
  if (alg == kAlg808 || alg == kAlg606) {
    const double* hz = alg == kAlg808 ? k808Hz : k606Hz;
    double sum = 0.0;
    for (int i = 0; i < kOsc; i++) sum += blep_square_tick(s.sq[i], hz[i] * tune, kDuty, sr);
    return sum * (1.0 / kOsc);
  }
  if (alg == kAlgFm) {
    const double index = kFmIndexLo + (kFmIndexHi - kFmIndexLo) * tone;
    const double fc = kFmCar * tune;
    const double modv = dsp_sin_turns_lut(s.phM);
    const double car = dsp_sin_turns_lut(s.phC + index * modv * (1.0 / (2.0 * kPi)));
    s.phC = phase_advance(s.phC, mind(fc, nyq), sr);
    s.phM = phase_advance(s.phM, mind(fc * kFmModRatio, nyq), sr);
    return car * blep_square_tick(s.sq[0], kFmRing1 * tune, kDuty, sr)
      * blep_square_tick(s.sq[1], kFmRing2 * tune, kDuty, sr);
  }
  return 0.0;
}

static double channel_tick(State& s, int c, int alg, double metalSrc, double tune, double tone, double metal, double sr) {
  Chan& ch = s.ch[c];
  const double n = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
  const double nyq = 0.45 * sr;
  TptSvfCoeffs k;
  if (alg == kAlg808 || alg == kAlg606) {
    const double src = metal * metalSrc + (1.0 - metal) * kNoiseMix * n;
    const double sh = octave_shift(tone);
    if (alg == kAlg808) {
      tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * mind(k808Bp * sh, nyq) / sr, k808BpQ);
      const double b = tpt_svf_tick(ch.bp, k, src);
      tpt_svf_setup(k, (2.0 * kPi) * mind(k808Hp * sh, nyq) / sr, 1.4142135623730951, 0.0, 0.0, 1.0, 1.0);
      return k808Gain * tpt_svf_tick(ch.hp, k, b);
    }
    tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * mind(k606Bp * sh, nyq) / sr, k606BpQ);
    const double b = tpt_svf_tick(ch.bp, k, src);
    tpt_svf_setup(k, (2.0 * kPi) * mind(k606Hp * sh, nyq) / sr, 1.0 / k606HpQ, 0.0, 0.0, 1.0, 1.0);
    return k606Gain * tpt_svf_tick(ch.hp, k, b);
  }
  if (alg == kAlgFm) {
    const double src = metal * metalSrc + (1.0 - metal) * kNoiseMix * n;
    tpt_svf_setup(k, (2.0 * kPi) * mind(kFmHp * octave_shift(tone), nyq) / sr, 1.4142135623730951, 0.0, 0.0, 1.0, 1.0);
    return kFmGain * tpt_svf_tick(ch.hp, k, src);
  }
  // Noise: white -> band-pass (Tune x 8 kHz, Q from Tone) -> high-pass.
  const double fcN = mind(kNoiseBp * tune, nyq);
  tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * fcN / sr, 0.5 + 4.5 * tone);
  const double b = tpt_svf_tick(ch.bp, k, n);
  const double src = metal * b + (1.0 - metal) * n;
  tpt_svf_setup(k, (2.0 * kPi) * (kNoiseHpRatio * fcN) / sr, 1.4142135623730951, 0.0, 0.0, 1.0, 1.0);
  return kNoiseGain * tpt_svf_tick(ch.hp, k, src);
}

}  // namespace

extern "C" int soemdsp_electro_hat_create() {
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

extern "C" void soemdsp_electro_hat_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Hat L. soemdsp_electro_hat_right() / _env() are this sample's Hat R / Env.
extern "C" double soemdsp_electro_hat_sample(
  int handle,
  double closed,
  double open,
  double reset,
  double algorithm,
  double tune,
  double tone,
  double closedDecay,
  double openDecay,
  double metal,
  double amplitude,
  double sampleRate,
  double recalculateOnTrigger  // 0 Off (live) / 1 On: closedDecay / openDecay latched on each hit
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  int alg = (int)(safe(algorithm) + 0.5);
  alg = alg < kAlg808 ? kAlg808 : (alg > kAlgNoise ? kAlgNoise : alg);

  const bool resetHit = gate_hit(safe(reset), &s.lastReset);
  const double cl = safe(closed);
  const double op = safe(open);
  const bool closedHit = gate_hit(cl, &s.lastClosed);
  const bool openHit = gate_hit(op, &s.lastOpen);
  bool hit = false;
  if (resetHit) {
    clear_voice(s);
    rewind_oscillators(s);
    // A hit on this same sample strikes fresh below (its height wins).
    if (!closedHit && !openHit && s.everHit && s.v > 0.0) { strike(s, sr); hit = true; }
  }
  if (closedHit || openHit) {
    s.v = dsp_fabs(closedHit ? cl : op);
    s.open = !closedHit;  // Closed wins on the same sample
    s.everHit = true;
    strike(s, sr);
    hit = true;
  }
  // Recalculate On Trigger: On latches closedDecay and openDecay on each hit, so a ringing
  // hit keeps its decay; Off (default) reads them live (unchanged behaviour).
  if (hit) { s.latchA = closedDecay; s.latchB = openDecay; s.latchHas = true; }
  if (safe(recalculateOnTrigger) >= 0.5 && s.latchHas) { closedDecay = s.latchA; openDecay = s.latchB; }
  s.fOut = hat_center_hz(alg, safe(tune), safe(tone), sr);  // f out: main filter centre
  if (!hit && s.vca == 0.0) {
    s.envOut = s.rightOut = 0.0;
    return 0.0;
  }

  // Envelope this sample (declick ramp, then T60 decay).
  if (s.rampLeft > 0) {
    s.vca = s.rampFrom + (s.v - s.rampFrom) * ((double)(s.rampLen - s.rampLeft) / (double)s.rampLen);
  }
  const double e = s.vca;
  const double tu = safe(tune);
  const double tn = safe(tone);
  const double mt = safe(metal);
  const double amp = safe(amplitude);
  const double ms = metal_tick(s, alg, tu, tn, sr);
  // Metal 1 (808 / 606 / FM): no noise reaches the filters, so when R's filter
  // state already equals L's, R would compute exactly L. Run the filters once;
  // R copies L's output and state (bit-identical). Otherwise (noise in the mix,
  // or R's tail still differs after Metal moved to 1) R runs its own filters.
  const Chan& c0 = s.ch[0];
  const Chan& c1 = s.ch[1];
  const bool sameState = c0.bp.z1 == c1.bp.z1 && c0.bp.z2 == c1.bp.z2
    && c0.hp.z1 == c1.hp.z1 && c0.hp.z2 == c1.hp.z2;
  const double yL = channel_tick(s, 0, alg, ms, tu, tn, mt, sr);
  double yR;
  if (alg != kAlgNoise && mt == 1.0 && sameState) {
    yR = yL;
    s.ch[1] = s.ch[0];
  } else {
    yR = channel_tick(s, 1, alg, ms, tu, tn, mt, sr);
  }
  hash_noise_advance(s.white);
  if (s.rampLeft > 0) {
    s.rampLeft--;
    if (s.rampLeft == 0) s.vca = s.v;
  } else {
    s.vca = planck_snap(s.vca * t60_coeff(s.open ? safe(openDecay) : safe(closedDecay), sr));
  }
  if (e == 0.0 || silent_planck(e)) {
    clear_voice(s);
    return 0.0;
  }
  s.envOut = e;
  const double outL = planck_snap(amp * e * yL);
  const double outR = planck_snap(amp * e * yR);
  s.rightOut = (outR * 0.0 == 0.0) ? outR : 0.0;
  return (outL * 0.0 == 0.0) ? outL : 0.0;
}

extern "C" double soemdsp_electro_hat_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].rightOut;
}

extern "C" double soemdsp_electro_hat_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

// f out (white jack, Hz): main filter centre in Hz (808 / 606 band-pass, FM high-pass, Noise band-pass).
extern "C" double soemdsp_electro_hat_f(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].fOut;
}

extern "C" int soemdsp_electro_hat_version() { return 3; } // 3: f out (soemdsp_electro_hat_f, Hz: main filter centre in Hz (808 / 606 band-pass, FM high-pass, Noise band-pass)).  // 2: Recalculate On Trigger (closedDecay / openDecay latched on hit)
extern "C" const char* soemdsp_electro_hat_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_electro_hat_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
