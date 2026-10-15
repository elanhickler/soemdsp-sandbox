// soemdsp-native-module: sidechain
// soemdsp-native-label: Sidechain
// soemdsp-native-target: sidechain
// soemdsp-native-kind: dynamics
// soemdsp-native-lib: https://github.com/elanhickler/soemdsp-sandbox/blob/master/docs/SIDECHAIN_PLAN.md
//
// Sidechain: moves a Dry/Wet crossfade under a key, using Pump Limiter's
// detector + hard-knee gain computer + gain smoother
// (native_modules/pumping_limiter/pumping_limiter.cpp), plus a Hold countdown.
// MODULE-LOCAL COPY of the Pump Limiter maths: there is no shared dynamics
// helper in library/include/soemdsp, and adding one needs Argi's APP_POLICY 19
// approval (docs/SIDECHAIN_PLAN.md, Q6). With Hold 0 the gain path is the
// same arithmetic as Pump Limiter's (look-ahead Off, Input Gain 0).
//
// Per sample:
//   pairs     Dry L/R and Wet L/R each fall back to mono: a lone side feeds both.
//   key       Sidechain only. With neither Sidechain nor Envelope wired: env 0
//             (output holds at Mix) and the detector state resets.
//   env       one-pole mean-square follower (attack up / release down), sqrt.
//   target    env > T ? (T/env)^((R-1)/R) : 1   (hard knee, 0..1)
//   gain      toward target: attack coeff when falling; when rising it waits
//             Hold ms after the last fall (or steady), then release coeff.
//   env       duck amount = 1 - gain; when the Envelope input is wired:
//             clamp(Envelope, 0, 1), raw, per sample (Threshold / Ratio /
//             Attack / Hold / Release are bypassed).
//   mix       m = Mix + (Ducked Mix - Mix) * env   (stereo-linked)
//   out       Dry * (1 - m) + Wet * m              (equal-gain linear crossfade)
//   Envelope output = env.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

// ---------------------------------------------------------------------------
// Open design choices (docs/SIDECHAIN_PLAN.md section 9). Defaults picked for
// v1; each is one switch here so Argi can change it without touching the DSP.
// Q3/Q4 Envelope input: duck amount 0..1 used as-is (clamped, no smoothing);
// bypasses the detector and Threshold / Ratio / Attack / Hold / Release.
// Clamping uses the shared library clamp01 (soemdsp_maths); NaN reads as 0.
// Mix law (Argi 2026-10-14): equal-gain linear crossfade whose position moves
// from Mix (env 0) to Ducked Mix (env 1).
static inline double mix_amount(double mix, double duckedMix, double env) {
  const double a = clamp01((mix * 0.0 == 0.0) ? mix : 0.0);
  const double d = clamp01((duckedMix * 0.0 == 0.0) ? duckedMix : 0.0);
  return a + (d - a) * env;
}
static inline double mix_out(double dry, double wet, double m) {
  return dry * (1.0 - m) + wet * m;
}
// ---------------------------------------------------------------------------

static const int kMaxInstances = 32;

struct State {
  bool active;
  double gain;
  double meanSquare;
  double holdLeft;  // samples left before release may start
  double lastLeft;
  double lastRight;
  double lastEnv;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"sidechain\","
    "\"label\":\"Sidechain\","
    "\"targetType\":\"sidechain\","
    "\"kind\":\"dynamics\""
  "}";

static inline double finite_or(double x, double fallback) {
  return (x * 0.0 == 0.0) ? x : fallback;
}

static inline void pair(int hasL, int hasR, double l, double r, double& outL, double& outR) {
  l = finite_or(l, 0.0);
  r = finite_or(r, 0.0);
  if (hasL && !hasR) { outL = l; outR = l; return; }
  if (hasR && !hasL) { outL = r; outR = r; return; }
  outL = hasL ? l : 0.0;
  outR = hasR ? r : 0.0;
}

}  // namespace

extern "C" int soemdsp_sidechain_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.gain = 1.0;
      s.meanSquare = 0.0;
      s.holdLeft = 0.0;
      s.lastLeft = 0.0;
      s.lastRight = 0.0;
      s.lastEnv = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_sidechain_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_sidechain_reset(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return;
  State& s = gPool[handle - 1];
  s.gain = 1.0;
  s.meanSquare = 0.0;
  s.holdLeft = 0.0;
}

// wiredMask bits: 1 Dry L, 2 Dry R, 4 Wet L, 8 Wet R, 16 Sidechain, 32 Envelope.
// Returns Left; soemdsp_sidechain_right / _envelope read this sample's Right / env.
extern "C" double soemdsp_sidechain_sample(
  int handle,
  double dryLeft,
  double dryRight,
  double wetLeft,
  double wetRight,
  double sidechain,
  double envelope,
  int wiredMask,
  double thresholdDb,
  double ratio,
  double attackMs,
  double holdMs,
  double releaseMs,
  double mix,
  double duckedMix,
  double sampleRate
) {
  double dL, dR, wL, wR;
  pair(wiredMask & 1, wiredMask & 2, dryLeft, dryRight, dL, dR);
  pair(wiredMask & 4, wiredMask & 8, wetLeft, wetRight, wL, wR);
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) {
    return mix_out(dL, wL, mix_amount(mix, duckedMix, 0.0));
  }
  State& st = gPool[handle - 1];
  const double rate = sampleRate > 1.0 ? sampleRate : 44100.0;

  double env;
  if (wiredMask & 32) {
    env = clamp01(finite_or(envelope, 0.0));
  } else if (!(wiredMask & 16)) {
    // Argi 2026-10-14: only the Sidechain input keys the ducking.
    st.gain = 1.0;
    st.meanSquare = 0.0;
    st.holdLeft = 0.0;
    env = 0.0;
  } else {
    // Pump Limiter detector (module-local copy, see header).
    const double detectPeak = dsp_fabs(finite_or(sidechain, 0.0));
    const double instantPower = detectPeak * detectPeak;
    const double attMs = maxd(0.0, finite_or(attackMs, 5.0));
    double relMs = finite_or(releaseMs, 250.0);
    if (relMs < 1.0) relMs = 1.0;
    const double attCoeff = attMs <= 0.0 ? 1.0 : 1.0 - dsp_exp(-1.0 / maxd(1.0, attMs * 0.001 * rate));
    const double relCoeff = 1.0 - dsp_exp(-1.0 / maxd(1.0, relMs * 0.001 * rate));

    if (instantPower > st.meanSquare) {
      st.meanSquare += attCoeff * (instantPower - st.meanSquare);
    } else {
      st.meanSquare += relCoeff * (instantPower - st.meanSquare);
    }
    if (st.meanSquare < 1e-30) st.meanSquare = 0.0;
    const double level = st.meanSquare > 0.0 ? dsp_exp(0.5 * dsp_ln(st.meanSquare)) : 0.0;

    double thresh = db_to_amp(finite_or(thresholdDb, -18.0));
    if (thresh < 1e-6) thresh = 1e-6;
    double r = finite_or(ratio, 8.0);
    if (r < 1.0) r = 1.0;
    if (r > 100.0) r = 100.0;

    double targetGain = 1.0;
    if (level > thresh) {
      const double grExp = (r - 1.0) / r;
      const double ratioLin = thresh / level;
      targetGain = ratioLin > 0.0 ? dsp_exp(grExp * dsp_ln(ratioLin)) : 0.0;
    }
    if (!(targetGain * 0.0 == 0.0) || targetGain < 0.0) targetGain = 0.0;
    if (targetGain > 1.0) targetGain = 1.0;

    // Hold: reset the countdown while GR deepens or holds; release waits for 0.
    double hMs = finite_or(holdMs, 0.0);
    if (hMs < 0.0) hMs = 0.0;
    if (targetGain <= st.gain) {
      st.holdLeft = hMs * 0.001 * rate;
      st.gain += attCoeff * (targetGain - st.gain);
    } else if (st.holdLeft > 0.0) {
      st.holdLeft -= 1.0;
    } else {
      st.gain += relCoeff * (targetGain - st.gain);
    }
    if (!(st.gain * 0.0 == 0.0) || st.gain < 0.0) st.gain = 0.0;
    if (st.gain > 1.0) st.gain = 1.0;
    env = 1.0 - st.gain;
  }
  const double m = mix_amount(mix, duckedMix, env);

  double outL = mix_out(dL, wL, m);
  double outR = mix_out(dR, wR, m);
  if (!(outL * 0.0 == 0.0)) outL = 0.0;
  if (!(outR * 0.0 == 0.0)) outR = 0.0;
  st.lastLeft = outL;
  st.lastRight = outR;
  st.lastEnv = env;
  return outL;
}

extern "C" double soemdsp_sidechain_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastRight;
}

extern "C" double soemdsp_sidechain_envelope(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastEnv;
}

extern "C" int soemdsp_sidechain_version() { return 2; }
extern "C" const char* soemdsp_sidechain_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_sidechain_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
