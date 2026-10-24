// soemdsp-native-module: noise_gate
// soemdsp-native-label: Noise Gate
// soemdsp-native-target: noiseGate
// soemdsp-native-kind: dynamics
//
// Downward gate with Open/Close hysteresis. Attack / Hold / Release on gain.
// Peak detect: |SC| if sidechain wired, else max(|L|, |R|). No look-ahead.
// Close is clamped to <= Open. Range is the closed gain floor (dB).
// Gain jack is 0 closed … 1 open, independent of Range.
// Env jack is the detect peak clamped 0…1.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 16;

enum {
  kClosed = 0,
  kOpening = 1,
  kOpen = 2,
  kHolding = 3,
  kClosing = 4
};

struct State {
  bool active;
  int phase;
  double gain;
  double holdLeft;
  double lastOut;
  double lastLeft;
  double lastRight;
  double lastGainJack;
  double lastEnv;
};

static State gPool[kMaxInstances];

static inline bool at_open(double gain) {
  return gain >= 1.0 - 1e-9;
}

static inline bool at_floor(double gain, double rangeAmp) {
  return gain <= rangeAmp + 1e-9;
}

}  // namespace

extern "C" int soemdsp_noise_gate_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.phase = kClosed;
      s.gain = 0.0;
      s.holdLeft = 0.0;
      s.lastOut = 0.0;
      s.lastLeft = 0.0;
      s.lastRight = 0.0;
      s.lastGainJack = 0.0;
      s.lastEnv = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_noise_gate_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_noise_gate_sample(
  int handle,
  double left,
  double right,
  double sidechain,
  int hasSidechain,
  double openDb,
  double closeDb,
  double attackMs,
  double holdMs,
  double releaseMs,
  double rangeDb,
  double sampleRate,
  double amplitude
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) {
    const double x = safe(left);
    const double y = safe(right);
    return 0.5 * (x + y);
  }
  State& st = gPool[handle - 1];
  const double rate = sampleRate > 1.0 ? sampleRate : 44100.0;
  const double lIn = safe(left);
  const double rIn = safe(right);
  const double peak = hasSidechain
    ? dsp_fabs(safe(sidechain))
    : maxd(dsp_fabs(lIn), dsp_fabs(rIn));
  const double env = peak;

  double openD = safe(openDb);
  double closeD = safe(closeDb);
  if (closeD > openD) closeD = openD;
  const double openAmp = db_to_amp(openD);
  const double closeAmp = db_to_amp(closeD);
  double rangeD = safe(rangeDb);
  if (rangeD > 0.0) rangeD = 0.0;
  const double rangeAmp = db_to_amp(rangeD);

  const double attMs = maxd(0.0, safe(attackMs));
  double relMs = safe(releaseMs);
  if (!(relMs * 0.0 == 0.0)) relMs = 80.0;
  if (relMs < 0.0) relMs = 0.0;
  const double attCoeff = one_pole_coeff(attMs * 0.001, rate);
  const double relCoeff = one_pole_coeff(relMs * 0.001, rate);
  const double holdSamples = maxd(0.0, safe(holdMs)) * 0.001 * rate;

  if (st.phase == kClosed) {
    st.gain = rangeAmp;
    if (env >= openAmp) {
      if (attCoeff >= 1.0) {
        st.gain = 1.0;
        st.phase = kOpen;
      } else {
        st.phase = kOpening;
        st.gain = one_pole_step(st.gain, 1.0, attCoeff);
        if (at_open(st.gain)) {
          st.gain = 1.0;
          st.phase = kOpen;
        }
      }
    }
  } else if (st.phase == kOpening) {
    if (env < closeAmp) {
      st.phase = kClosing;
      st.gain = one_pole_step(st.gain, rangeAmp, relCoeff);
      if (relCoeff >= 1.0 || at_floor(st.gain, rangeAmp)) {
        st.gain = rangeAmp;
        st.phase = kClosed;
      }
    } else {
      st.gain = one_pole_step(st.gain, 1.0, attCoeff);
      if (attCoeff >= 1.0 || at_open(st.gain)) {
        st.gain = 1.0;
        st.phase = kOpen;
      }
    }
  } else if (st.phase == kOpen) {
    st.gain = 1.0;
    if (env < closeAmp) {
      st.holdLeft = holdSamples;
      if (holdSamples <= 0.0) {
        st.phase = kClosing;
      } else {
        st.phase = kHolding;
      }
    }
  } else if (st.phase == kHolding) {
    st.gain = 1.0;
    if (env >= openAmp) {
      st.phase = kOpen;
      st.holdLeft = 0.0;
    } else {
      st.holdLeft -= 1.0;
      if (st.holdLeft <= 0.0) st.phase = kClosing;
    }
  } else {
    if (env >= openAmp) {
      st.phase = kOpening;
      st.gain = one_pole_step(st.gain, 1.0, attCoeff);
      if (attCoeff >= 1.0 || at_open(st.gain)) {
        st.gain = 1.0;
        st.phase = kOpen;
      }
    } else {
      st.gain = one_pole_step(st.gain, rangeAmp, relCoeff);
      if (relCoeff >= 1.0 || at_floor(st.gain, rangeAmp)) {
        st.gain = rangeAmp;
        st.phase = kClosed;
      }
    }
  }

  if (!(st.gain * 0.0 == 0.0) || st.gain < 0.0) st.gain = 0.0;
  if (st.gain > 1.0) st.gain = 1.0;

  double amp = safe(amplitude);
  if (!(amp * 0.0 == 0.0) || amp < 0.0) amp = 1.0;
  double dL = lIn * st.gain * amp;
  double dR = rIn * st.gain * amp;
  if (!(dL * 0.0 == 0.0)) dL = 0.0;
  if (!(dR * 0.0 == 0.0)) dR = 0.0;

  double jack = 1.0;
  const double span = 1.0 - rangeAmp;
  if (span > 1e-12) {
    jack = (st.gain - rangeAmp) / span;
    if (jack < 0.0) jack = 0.0;
    if (jack > 1.0) jack = 1.0;
  }

  st.lastLeft = dL;
  st.lastRight = dR;
  st.lastGainJack = jack;
  st.lastEnv = env > 1.0 ? 1.0 : env;
  st.lastOut = 0.5 * (dL + dR);
  return st.lastOut;
}

extern "C" double soemdsp_noise_gate_left(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastLeft;
}

extern "C" double soemdsp_noise_gate_right(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastRight;
}

extern "C" double soemdsp_noise_gate_gain(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastGainJack;
}

extern "C" double soemdsp_noise_gate_env(int handle) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  return gPool[handle - 1].lastEnv;
}

extern "C" int soemdsp_noise_gate_version() {
  return 1;
}
