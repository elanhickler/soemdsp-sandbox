// soemdsp-native-module: pumping_limiter
// soemdsp-native-label: Pump Limiter
// soemdsp-native-target: limiter
// soemdsp-native-kind: dynamics
//
// Native-only (the JS twin was removed in C-001):
// — look-ahead delay + threshold/ratio GR,
// optional sidechain detect, Env out. No autogain.
// Look-ahead: the detector uses the loudest sample from the one about to
// play through the newest sample, so gain is already down when that hit
// reaches the output. Attack 0 snaps, then a ceiling holds the output at
// Threshold (ratio alone still sits a little over it).
// Hold (ms): while GR deepens or stays put the countdown reloads to Hold;
// once the target gain rises (release would begin) the gain is held for
// Hold ms worth of samples, then the release coefficient applies. A new
// deeper peak restarts the hold. Hold 0 = previous behaviour, bit-identical.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 16;
static const int kMaxSamples = 16384;

struct State {
  bool active;
  float delayL[kMaxSamples];
  float delayR[kMaxSamples];
  float delayD[kMaxSamples];
  int pos;
  int cap;
  double gain;
  double holdLeft;  // samples left before release may start
  double meanSquare;
  bool attacking;
  double attackLeft;
  double attackGoal;
  double attackStep;
  double env;
  double lastOut;
  double lastLeft;
  double lastRight;
  double lastGain;
  double lastEnv;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"pumping_limiter\","
    "\"label\":\"Pump Limiter\","
    "\"targetType\":\"limiter\","
    "\"kind\":\"dynamics\""
  "}";

}  // namespace

extern "C" int soemdsp_pumping_limiter_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      for (int n = 0; n < kMaxSamples; n += 1) {
        s.delayL[n] = 0.0f;
        s.delayR[n] = 0.0f;
        s.delayD[n] = 0.0f;
      }
      s.pos = 0;
      s.cap = kMaxSamples;
      s.gain = 1.0;
      s.holdLeft = 0.0;
      s.meanSquare = 0.0;
      s.attacking = false;
      s.attackLeft = 0.0;
      s.attackGoal = 1.0;
      s.attackStep = 0.0;
      s.env = 0.0;
      s.lastOut = 0.0;
      s.lastLeft = 0.0;
      s.lastRight = 0.0;
      s.lastGain = 1.0;
      s.lastEnv = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_pumping_limiter_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_pumping_limiter_sample(
  int handle,
  double left,
  double right,
  double sidechain,
  int hasSidechain,
  double inputGainDb,
  double thresholdDb,
  double ratio,
  double lookaheadMs,
  double lookaheadSamples,
  double attackMs,
  double holdMs,
  double releaseMs,
  double sampleRate,
  double lookaheadEnabled,
  double amplitude
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) {
    const double x = safe(left);
    const double y = safe(right);
    return 0.5 * (x + y);
  }
  State& st = gPool[handle - 1];
  const double rate = sampleRate > 1.0 ? sampleRate : 44100.0;
  const double inGain = db_to_amp(safe(inputGainDb));
  const double lIn = safe(left) * inGain;
  const double rIn = safe(right) * inGain;

  const bool laOn = safe(lookaheadEnabled) > 0.5;
  const double laFromMs = laOn ? maxd(0.0, safe(lookaheadMs)) * 0.001 * rate : 0.0;
  const double laFromSamples = laOn ? maxd(0.0, safe(lookaheadSamples)) : 0.0;
  int la = (int)(laFromMs + laFromSamples + 0.5);
  if (la < 0) la = 0;
  if (la > st.cap - 1) la = st.cap - 1;

  const double detectPeak = hasSidechain
    ? dsp_fabs(safe(sidechain))
    : maxd(dsp_fabs(lIn), dsp_fabs(rIn));
  const double attMs = maxd(0.0, safe(attackMs));
  double relMs = safe(releaseMs);
  if (!(relMs * 0.0 == 0.0)) relMs = 250.0;
  if (relMs < 1.0) relMs = 1.0;
  const double attCoeff = ms_detector_attack_coeff(attMs, rate);
  const double relCoeff = ms_detector_release_coeff(relMs, rate);

  const int pos = st.pos;
  const int cap = st.cap;
  st.delayL[pos] = (float)lIn;
  st.delayR[pos] = (float)rIn;
  int readPos = pos - la;
  readPos %= cap;
  if (readPos < 0) readPos += cap;
  // Loudest detect value from the sample about to play through the newest
  // one. Look-ahead off is exactly this sample (double, no float round trip).
  double windowPeak = detectPeak;
  if (la > 0) {
    st.delayD[pos] = (float)detectPeak;
    windowPeak = 0.0;
    int idx = readPos;
    const int nWin = la + 1;
    for (int n = 0; n < nWin; n += 1) {
      const double p = (double)st.delayD[idx];
      if (p > windowPeak) windowPeak = p;
      idx += 1;
      if (idx >= cap) idx = 0;
    }
  }

  const double env = ms_detector_step(st.meanSquare, windowPeak, attCoeff, relCoeff);
  st.env = env;

  double thresh = db_to_amp(safe(thresholdDb));
  if (thresh < 1e-6) thresh = 1e-6;
  double r = safe(ratio);
  if (!(r * 0.0 == 0.0) || r < 1.0) r = 8.0;
  if (r > 100.0) r = 100.0;

  double targetGain = hard_knee_target_gain(env, thresh, r);
  // Attack fits in the look-ahead: drop by the whole overshoot and stay
  // there. The soft ratio target sits above that, and releasing toward it
  // is the level jumping back up after the clamp.
  const double attSamples = attMs * 0.001 * rate;
  const bool holdCeiling = attSamples <= double(la) + 0.5;
  if (holdCeiling && env > thresh) {
    const double brick = thresh / env;
    if (brick < targetGain) targetGain = brick;
  }

  const double hMs = maxd(0.0, safe(holdMs));
  if (targetGain <= st.gain) {
    // Deepening or steady: (re)load the hold. targetGain == gain moves nothing.
    st.holdLeft = hMs * 0.001 * rate;
    st.gain += attCoeff * (targetGain - st.gain);
  } else if (st.holdLeft > 0.0) {
    st.holdLeft -= 1.0;  // hold the current reduction
  } else {
    st.gain += relCoeff * (targetGain - st.gain);
  }
  if (!(st.gain * 0.0 == 0.0) || st.gain < 0.0) st.gain = 0.0;
  if (st.gain > 1.0) st.gain = 1.0;

  double dL = (double)st.delayL[readPos];
  double dR = (double)st.delayR[readPos];
  st.pos = (pos + 1) % cap;

  double amp = safe(amplitude);
  if (!(amp * 0.0 == 0.0) || amp < 0.0) amp = 1.0;
  double g = st.gain;
  dL *= g;
  dR *= g;
  // Same drop, remembered. Otherwise the next sample still has the old
  // higher gain and the level jumps back up above the sample just clamped.
  if (holdCeiling) {
    const double peakOut = maxd(dsp_fabs(dL), dsp_fabs(dR));
    if (peakOut > thresh && peakOut > 0.0) {
      const double cut = thresh / peakOut;
      dL *= cut;
      dR *= cut;
      g *= cut;
      st.gain = g;
    }
  }
  dL *= amp;
  dR *= amp;
  if (!(dL * 0.0 == 0.0)) dL = 0.0;
  if (!(dR * 0.0 == 0.0)) dR = 0.0;

  st.lastLeft = dL;
  st.lastRight = dR;
  st.lastGain = g;
  st.lastEnv = env > 1.0 ? 1.0 : env;
  st.lastOut = 0.5 * (dL + dR);
  return st.lastOut;
}

extern "C" double soemdsp_pumping_limiter_left(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastLeft;
}

extern "C" double soemdsp_pumping_limiter_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastRight;
}

extern "C" double soemdsp_pumping_limiter_gain(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 1.0;
  return gPool[handle - 1].lastGain;
}

extern "C" double soemdsp_pumping_limiter_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastEnv;
}

extern "C" int soemdsp_pumping_limiter_version() { return 4; } // 4: attack finishes inside the look-ahead
extern "C" const char* soemdsp_pumping_limiter_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_pumping_limiter_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
