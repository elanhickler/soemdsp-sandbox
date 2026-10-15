// Test probe for scripts/test_softpop_oscillator.mjs and
// scripts/test_softpop_filter.mjs (not shipped). Built with
// -DSOFTPOP_PROBE_FILTER=0 (Softpop Oscillator) or 1 (Softpop Filter) and
// linked with that module's .cpp. Renders blocks of the module's outputs /
// probes into a planar buffer and runs long level loops in wasm.
#ifndef SOFTPOP_PROBE_FILTER
#define SOFTPOP_PROBE_FILTER 0
#endif

#if SOFTPOP_PROBE_FILTER
#define SP_FN(name) soemdsp_softpop_filter_##name
#else
#define SP_FN(name) soemdsp_softpop_oscillator_##name
#endif

extern "C" int SP_FN(create)();
extern "C" void SP_FN(destroy)(int handle);
extern "C" void SP_FN(reset)(int handle);
#if SOFTPOP_PROBE_FILTER
extern "C" double SP_FN(sample)(int handle, double freqHz, double inL, double inR, double useInput,
  double width, double pitchModCents, double ampMod, double amplitude, double color,
  double seedValue, double sampleRate);
#else
extern "C" double SP_FN(sample)(int handle, double freqHz, double source, double morph,
  double pitchModCents, double ampMod, double amplitude, double color,
  double seedValue, double sampleRate);
#endif
extern "C" double SP_FN(left)(int handle);
extern "C" double SP_FN(right)(int handle);
extern "C" double SP_FN(probe)(int handle, int which);

namespace {
const int kCap = 1 << 23;
double gBuf[kCap];
const int kInCap = 1 << 20;
double gIn[kInCap];   // per-sample Hz (useIn bit 0)
double gInL[kInCap];  // Filter external input L (useIn bit 1)
double gInR[kInCap];  // Filter external input R (useIn bit 1)
double gStats[8];
struct Params {
  double freq, source, morph, width, pitch, ampMod, amp, color, seed, sr;
} gP = {440.0, 0.0, 0.5, 0.3, 0.0, 0.0, 1.0, 0.0, 1.0, 48000.0};

double step(int h, double freq, bool audio, double l, double r) {
#if SOFTPOP_PROBE_FILTER
  return SP_FN(sample)(h, freq, l, r, audio ? 1.0 : 0.0, gP.width, gP.pitch, gP.ampMod,
                       gP.amp, gP.color, gP.seed, gP.sr);
#else
  (void)audio; (void)l; (void)r;
  return SP_FN(sample)(h, freq, gP.source, gP.morph, gP.pitch, gP.ampMod,
                       gP.amp, gP.color, gP.seed, gP.sr);
#endif
}

double channel(int h, int c, double mono) {
  switch (c) {
    case 0: return mono;
    case 1: return SP_FN(left)(h);
    case 2: return SP_FN(right)(h);
    default: return SP_FN(probe)(h, c - 3);
  }
}
}  // namespace

extern "C" double* tp_buf() { return gBuf; }
extern "C" int tp_cap() { return kCap; }
extern "C" double* tp_in() { return gIn; }
extern "C" double* tp_in_l() { return gInL; }
extern "C" double* tp_in_r() { return gInR; }
extern "C" int tp_in_cap() { return kInCap; }
extern "C" double* tp_stats() { return gStats; }
extern "C" int tp_create() { return SP_FN(create)(); }
extern "C" void tp_destroy(int h) { SP_FN(destroy)(h); }
extern "C" void tp_reset(int h) { SP_FN(reset)(h); }

// Same argument list for both modules (the Filter ignores source / morph).
extern "C" void tp_set(double freq, double source, double morph, double width, double pitch,
                       double ampMod, double amp, double color, double seed, double sr) {
  gP = Params{freq, source, morph, width, pitch, ampMod, amp, color, seed, sr};
}

// Render n frames. mask bit c selects channel c: 0 Mono, 1 L, 2 R, 3.. probe(c-3)
// (3/4 n_pitch L/R, 5/6 n_amp, 7/8 N_audio, 9/10 fInst, 11 Q, 12/13 CV,
// Oscillator 14/15 pitch L/R as MIDI note). Planar: the k-th selected channel lands at
// gBuf[k*n + i]. useIn bit 0: per-sample Hz from gIn; bit 1 (Filter): external
// input from gInL / gInR.
extern "C" int tp_render(int h, int n, int mask, int useIn) {
  int chans[20];
  int nc = 0;
  for (int c = 0; c < 20; c += 1) if (mask & (1 << c)) chans[nc++] = c;
  if (n * nc > kCap || (useIn && n > kInCap)) return -1;
  const bool hz = (useIn & 1) != 0;
  const bool audio = (useIn & 2) != 0;
  for (int i = 0; i < n; i += 1) {
    const double mono = step(h, hz ? gIn[i] : gP.freq, audio, audio ? gInL[i] : 0.0, audio ? gInR[i] : 0.0);
    for (int k = 0; k < nc; k += 1) gBuf[k * n + i] = channel(h, chans[k], mono);
  }
  return nc;
}

// Level loop: warm frames discarded, then n frames. Stats: 0 mean L^2,
// 1 mean R^2, 2 mean Mono^2, 3 mean L, 4 non-finite count, 5 max |L|,|R|.
extern "C" void tp_level(int h, int warm, int n) {
  for (int i = 0; i < warm; i += 1) step(h, gP.freq, false, 0.0, 0.0);
  double sl = 0.0, sr = 0.0, sm = 0.0, s1 = 0.0, bad = 0.0, mx = 0.0;
  for (int i = 0; i < n; i += 1) {
    const double m = step(h, gP.freq, false, 0.0, 0.0);
    const double l = SP_FN(left)(h);
    const double r = SP_FN(right)(h);
    if (!(l - l == 0.0) || !(r - r == 0.0) || !(m - m == 0.0)) { bad += 1.0; continue; }
    sl += l * l; sr += r * r; sm += m * m; s1 += l;
    const double al = l < 0.0 ? -l : l;
    const double ar = r < 0.0 ? -r : r;
    if (al > mx) mx = al;
    if (ar > mx) mx = ar;
  }
  gStats[0] = sl / n; gStats[1] = sr / n; gStats[2] = sm / n; gStats[3] = s1 / n;
  gStats[4] = bad; gStats[5] = mx;
}
