// soemdsp-native-module: electro_clap
// soemdsp-native-label: Electro Clap
// soemdsp-native-target: electroClap
// soemdsp-native-kind: drum
//
// Electro Clap (docs/DRUM_PACK_PLAN.md §5b, Argi 2026-10-19): one hand-clap
// voice, stereo. Trigger + Reset in, Clap L + Clap R + Env out. One fixed
// shared param set every algorithm reads:
//   tone (0..1), spread (0..1), decay (s T60), snappy (0..1), amplitude (0..1).
// Algorithms (choiceIds): 0 tr808, 1 tr909, 2 simple.
//
// Every algorithm is white noise -> band-pass, split into two VCAs (TR-808 /
// TR-909 service notes): a Burst VCA retriggered as a train of sawtooth
// envelopes (808 / 909: 4 bursts, the last one longer; Simple: 1) and a
// decay-only Tail VCA (the "reverb"). Out = snappy Burst + (1 - snappy) Tail.
//   Tone   = band-pass centre, 0.5x .. 2x stock (one octave either way), level
//            compensated by 1/sqrt(centre shift) (constant-Q band: noise power ~ centre).
//   Spread = burst spacing 5 .. 20 ms (exp, stock 10 / 11 ms at 0.5); Simple:
//            the single burst's length (same time scale).
//   Decay  = Tail T60.
// Hit: Trigger latches v = |height| and restarts both envelopes at v (the
// sawtooth edge is the clap attack). Reset (height ignored) clears filters and
// envelopes, reseeds the noise and re-strikes at the last v (silent before the
// first Trigger). Same sample: Reset first, then the Trigger (its height wins).
// Stereo (Argi, no width knob): the envelopes are computed once (shared); only
// the noise is per channel (own seed, own filter state). L keeps the base seed.
// Env = snappy eBurst + (1 - snappy) eTail: peaks at v on the hit sample,
// excludes Amplitude, exact 0 at rest. Params arrive clamped (no second clamp).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/tpt_svf.h>
#include <soemdsp/drum/drum_parts.h>

namespace {

using namespace soemdsp_maths;
using namespace soemdsp::drum;

static const int kMaxInstances = 64;
static const unsigned int kNoiseSeed = 0x0c1a9c1au;
enum { kAlg808 = 0, kAlg909 = 1, kAlgSimple = 2 };

// 808: one band-pass at 1 kHz feeds both VCAs (service notes). 909: burst
// band-pass 1140 Hz, Q 1.95 (schematic analysis); its tail is a separate,
// wider and higher band ("brighter"). Simple: one burst, one filter.
static const double k808Bp = 1000.0, k808Q = 1.5;
static const double k909Bp = 1140.0, k909Q = 1.95, k909TailBp = 2400.0, k909TailQ = 0.8;
static const double kSimpleBp = 1200.0, kSimpleQ = 1.0;
// Burst spacing at Spread 0.5 (808 ~10 ms, 909 ~11 ms); Spread moves it +-1 oct.
static const double k808Spacing = 0.010, k909Spacing = 0.011, kSimpleSpacing = 0.010;
static const int kBursts808 = 4, kBursts909 = 4, kBurstsSimple = 1;
// --- by-ear constants ---
static const double kSawT60 = 3.0;    // repeat bursts: T60 = 3 x spacing (~-20 dB at the next edge)
static const double kLastT60 = 6.0;   // last (or only) burst: T60 = 6 x spacing
static const double kGain808 = 2.2, kGain909Burst = 1.9, kGain909Tail = 1.2, kGainSimple = 1.8;

struct Chan {
  TptSvfState bp, bpTail;
};

struct State {
  bool active;
  double lastTrig, lastReset;
  double v;
  bool everHit;
  double eBurst, eTail;
  int burstIdx;
  double burstPos;  // seconds since the current burst edge
  HashNoise white;
  Chan ch[2];
  double envOut, rightOut;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"electro_clap\","
    "\"label\":\"Electro Clap\","
    "\"targetType\":\"electroClap\","
    "\"kind\":\"drum\""
  "}";

static void clear_voice(State& s) {
  s.eBurst = s.eTail = 0.0;
  s.burstIdx = 0;
  s.burstPos = 0.0;
  for (int c = 0; c < 2; c++) { tpt_svf_reset(s.ch[c].bp); tpt_svf_reset(s.ch[c].bpTail); }
  hash_noise_reset(s.white);
  s.envOut = s.rightOut = 0.0;
}

static void init_state(State& s) {
  s.lastTrig = s.lastReset = 0.0;
  s.v = 0.0;
  s.everHit = false;
  clear_voice(s);
}

static void strike(State& s) {
  s.eBurst = s.v;
  s.eTail = s.v;
  s.burstIdx = 0;
  s.burstPos = 0.0;
}

static inline int bursts_for(int alg) {
  return alg == kAlg808 ? kBursts808 : (alg == kAlg909 ? kBursts909 : kBurstsSimple);
}

static inline double spacing_for(int alg, double spread) {
  const double base = alg == kAlg808 ? k808Spacing : (alg == kAlg909 ? k909Spacing : kSimpleSpacing);
  return base * dsp_exp2(2.0 * spread - 1.0);
}

// One channel: noise -> band-pass(es); returns the VCA-weighted mix (no Amplitude).
static double channel_tick(State& s, int c, int alg, double sh, double wB, double wT, double sr) {
  Chan& ch = s.ch[c];
  const double n = hash_noise_at(s.white, hash_noise_seed(kNoiseSeed, c));
  const double nyq = 0.45 * sr;
  TptSvfCoeffs k;
  if (alg == kAlg909) {
    tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * mind(k909Bp * sh, nyq) / sr, k909Q);
    const double yB = tpt_svf_tick(ch.bp, k, n);
    tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * mind(k909TailBp * sh, nyq) / sr, k909TailQ);
    const double yT = tpt_svf_tick(ch.bpTail, k, n);
    return kGain909Burst * wB * yB + kGain909Tail * wT * yT;
  }
  const double fc = alg == kAlg808 ? k808Bp : kSimpleBp;
  const double q = alg == kAlg808 ? k808Q : kSimpleQ;
  tpt_svf_setup_bandpass_const_peak(k, (2.0 * kPi) * mind(fc * sh, nyq) / sr, q);
  const double y = tpt_svf_tick(ch.bp, k, n);
  return (alg == kAlg808 ? kGain808 : kGainSimple) * (wB + wT) * y;
}

}  // namespace

extern "C" int soemdsp_electro_clap_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      init_state(gPool[i]);
      gPool[i].active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_electro_clap_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// Returns Clap L. soemdsp_electro_clap_right() / _env() are this sample's Clap R / Env.
extern "C" double soemdsp_electro_clap_sample(
  int handle,
  double trigger,
  double reset,
  double algorithm,
  double tone,
  double spread,
  double decay,
  double snappy,
  double amplitude,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];
  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  int alg = (int)(safe(algorithm) + 0.5);
  alg = alg < kAlg808 ? kAlg808 : (alg > kAlgSimple ? kAlgSimple : alg);

  const bool resetHit = gate_hit(safe(reset), &s.lastReset);
  const double tr = safe(trigger);
  const bool trigHit = gate_hit(tr, &s.lastTrig);
  bool hit = false;
  if (resetHit) {
    clear_voice(s);
    if (!trigHit && s.everHit && s.v > 0.0) { strike(s); hit = true; }
  }
  if (trigHit) {
    s.v = dsp_fabs(tr);
    s.everHit = true;
    strike(s);
    hit = true;
  }
  if (!hit && s.eBurst == 0.0 && s.eTail == 0.0) {
    s.envOut = s.rightOut = 0.0;
    return 0.0;
  }

  // Envelopes (shared L/R), this sample's values.
  const double sn = safe(snappy);
  const double wB = sn * s.eBurst;
  const double wT = (1.0 - sn) * s.eTail;
  const double e = wB + wT;
  const double tn = safe(tone);
  const double sh = dsp_exp2(2.0 * tn - 1.0);
  const double toneGain = dsp_exp2(0.5 - tn);  // 1 / sqrt(sh)
  const double yL = toneGain * channel_tick(s, 0, alg, sh, wB, wT, sr);
  const double yR = toneGain * channel_tick(s, 1, alg, sh, wB, wT, sr);
  hash_noise_advance(s.white);

  // Advance the envelopes to the next sample.
  const int nB = bursts_for(alg);
  const double spacing = spacing_for(alg, safe(spread));
  s.burstPos += 1.0 / sr;
  if (s.burstIdx < nB - 1 && s.burstPos >= spacing) {
    s.burstIdx++;
    s.burstPos = 0.0;
    s.eBurst = s.v;
  } else {
    const double t60 = (s.burstIdx < nB - 1 ? kSawT60 : kLastT60) * spacing;
    s.eBurst = planck_snap(s.eBurst * t60_coeff(t60, sr));
  }
  s.eTail = planck_snap(s.eTail * t60_coeff(safe(decay), sr));
  if (s.eBurst == 0.0 && s.burstIdx >= nB - 1 && s.eTail == 0.0) {
    // Voice rests: restart the filters from exact 0 (Planck-clean).
    for (int c = 0; c < 2; c++) { tpt_svf_reset(s.ch[c].bp); tpt_svf_reset(s.ch[c].bpTail); }
  }
  if (e == 0.0 || silent_planck(e)) {
    s.envOut = s.rightOut = 0.0;
    return 0.0;
  }
  s.envOut = e;
  const double amp = safe(amplitude);
  const double outL = planck_snap(amp * yL);
  const double outR = planck_snap(amp * yR);
  s.rightOut = (outR * 0.0 == 0.0) ? outR : 0.0;
  return (outL * 0.0 == 0.0) ? outL : 0.0;
}

extern "C" double soemdsp_electro_clap_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].rightOut;
}

extern "C" double soemdsp_electro_clap_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].envOut;
}

extern "C" int soemdsp_electro_clap_version() { return 1; }
extern "C" const char* soemdsp_electro_clap_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_electro_clap_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
