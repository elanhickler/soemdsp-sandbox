// soemdsp-native-module: audio_player
// soemdsp-native-label: Music Player
// soemdsp-native-target: audioPlayer
// soemdsp-native-kind: player
//
// Port of public/modules/audioPlayer/audio-player-worklet-evaluator.js
// audioPlayerSample. PCM is planar float L/R; JS fills via l_ptr/r_ptr after
// set_pcm (phosphillator-style). Full tracks allocate with memory.grow
// (APP_POLICY §2b) — same as JS peel holding the whole file in RAM.
// Transport 0–5: Reset / Stop / Pause / Loop / Play / Loop All
// (5 is play-once at this kernel; playlist wrap is host-side).
// Playback interpolation (stages / interpolation param):
//   0 Square        - zero-order hold
//   1 Linear        - two-point lerp
//   2 Sinc          - windowed sinc (Blackman, K=16), same kernel as 1D Plot
//   3 PolyBLEP      - ZOH staircase with 2-sample polyBLEP residuals
//   7 Tape           - sinc then speed-scaled tilt (shared spectral_tilt).
//                     Depth d = clamp(log2(1/|speed|)/Range, 0, 1);
//                     slope_eff = Tilt*d, tone_eff = Tone*d. d==0 bypasses
//                     the cascade (crossfaded, 8 ms) so 1x matches Sinc.
// Retired 4 Jitter / 5 Dither / 6 Both load as Sinc (2).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/filter/spectral_tilt.h>

#include <stddef.h>
#include <stdint.h>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 4;
// Safety refuse only — ~30 min @ 48 kHz. Actual RAM is sized to the loaded file.
static const int kMaxFrames = 48000 * 60 * 30;
static const size_t kWasmPage = 65536;
static const int kMaxFreeNodes = 32;
static const double kMinSpan = 0.000001;

struct FreeNode {
  FreeNode* next;
  int floats;
  float* data;
};

struct State {
  bool active;
  float* pcmL;
  float* pcmR;
  int pcmFrames;
  int pcmChannels;
  bool pcmROwned;
  double pcmRate;
  double phase;
  double lastReset;
  int transportMode;
  bool completed;
  bool hasRange;
  double lastStartPhase;
  double lastEndPhase;
  double lastLeft;
  double lastRight;
  double lastPhase;
  double lastTrigger;
  bool hasLastFrame;
  double lastFrameIndex;
  spectral_tilt::State tape;
  spectral_tilt::Channel tapeL;
  spectral_tilt::Channel tapeR;
  double tapeWet;
};

static State gPool[kMaxInstances];
static FreeNode gFreeNodes[kMaxFreeNodes];
static int gFreeNodeUsed = 0;
static FreeNode* gFreeList = nullptr;

static const char kMetadataJson[] =
  "{"
    "\"module\":\"audio_player\","
    "\"label\":\"Music Player\","
    "\"targetType\":\"audioPlayer\","
    "\"kind\":\"player\""
  "}";

// Grow from the current end of linear memory so this does not share the
// ping_pong __heap_base bump cursor. Freelist recycles prior uploads.
#if defined(__wasm__)
static float* pcm_grow_alloc(int floats) {
  if (floats < 1) return nullptr;
  const size_t bytes = (size_t)floats * sizeof(float);
  const size_t pages = (bytes + kWasmPage - 1) / kWasmPage;
  if (pages < 1) return nullptr;
  const size_t oldBytes = (size_t)__builtin_wasm_memory_size(0) * kWasmPage;
  if (__builtin_wasm_memory_grow(0, pages) < 0) return nullptr;
  float* data = (float*)oldBytes;
  for (int i = 0; i < floats; i += 1) data[i] = 0.0f;
  return data;
}
#else
static float* pcm_grow_alloc(int floats) {
  (void)floats;
  return nullptr;
}
#endif

static float* pcm_malloc(int floats) {
  if (floats < 1) return nullptr;
  FreeNode** cursor = &gFreeList;
  while (*cursor) {
    FreeNode* node = *cursor;
    if (node->floats >= floats) {
      *cursor = node->next;
      float* data = node->data;
      const int leftover = node->floats - floats;
      if (leftover > 0 && gFreeNodeUsed < kMaxFreeNodes) {
        FreeNode* rest = &gFreeNodes[gFreeNodeUsed++];
        rest->next = gFreeList;
        rest->floats = leftover;
        rest->data = data + floats;
        gFreeList = rest;
      }
      for (int i = 0; i < floats; i += 1) data[i] = 0.0f;
      return data;
    }
    cursor = &node->next;
  }
  return pcm_grow_alloc(floats);
}

static void pcm_free(float* data, int floats) {
  if (!data || floats < 1) return;
  if (gFreeNodeUsed >= kMaxFreeNodes) return; // drop; peak RAM already paid
  FreeNode* node = &gFreeNodes[gFreeNodeUsed++];
  node->next = gFreeList;
  node->floats = floats;
  node->data = data;
  gFreeList = node;
}

static void pcm_release(State& st) {
  if (st.pcmL) {
    pcm_free(st.pcmL, st.pcmFrames);
  }
  if (st.pcmROwned && st.pcmR && st.pcmR != st.pcmL) {
    pcm_free(st.pcmR, st.pcmFrames);
  }
  st.pcmL = nullptr;
  st.pcmR = nullptr;
  st.pcmFrames = 0;
  st.pcmChannels = 0;
  st.pcmROwned = false;
  st.pcmRate = 44100.0;
}

static void playback_reset(State& st) {
  st.phase = 0.0;
  st.lastReset = 0.0;
  st.transportMode = -1;
  st.completed = false;
  st.hasRange = false;
  st.lastStartPhase = 0.0;
  st.lastEndPhase = 1.0;
  st.lastLeft = 0.0;
  st.lastRight = 0.0;
  st.lastPhase = 0.0;
  st.lastTrigger = 0.0;
  st.hasLastFrame = false;
  st.lastFrameIndex = 0.0;
  spectral_tilt::clear(&st.tape);
  spectral_tilt::clear_channel(&st.tapeL);
  spectral_tilt::clear_channel(&st.tapeR);
  st.tapeWet = -1.0;
}

static void resolve_range(double start, double end, double* startPhase, double* endPhase, double* span) {
  const double a = clamp(safe(start), 0.0, 1.0);
  const double b = clamp(safe(end), 0.0, 1.0);
  if (dsp_fabs(b - a) <= kMinSpan) {
    *startPhase = 0.0;
    *endPhase = 1.0;
  } else if (a < b) {
    *startPhase = a;
    *endPhase = b;
  } else {
    *startPhase = b;
    *endPhase = a;
  }
  *span = maxd(kMinSpan, *endPhase - *startPhase);
}

static const int kSincK = 16; // taps each side; matches plot-display PLOT_SINC_K

static int clip_index(int v, int lo, int hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Map a tap index into the play region. Looping wraps (click-free periodic
// extension). One-shot clamps so we do not bleed samples outside the span.
static int map_pcm_index(int i, int frames, int looping, int startI, int endI) {
  if (frames <= 0) return 0;
  int lo = clip_index(startI, 0, frames - 1);
  int hi = clip_index(endI, 0, frames - 1);
  if (hi < lo) {
    const int tmp = lo;
    lo = hi;
    hi = tmp;
  }
  if (looping) {
    const int n = hi - lo + 1;
    if (n <= 1) return lo;
    int rel = i - lo;
    rel %= n;
    if (rel < 0) rel += n;
    return lo + rel;
  }
  return clip_index(i, lo, hi);
}

static double sinc_blackman(double x) {
  if (dsp_fabs(x) < 1.0e-9) return 1.0;
  if (dsp_fabs(x) >= (double)kSincK) return 0.0;
  const double u = x / (double)kSincK;
  const double win = 0.42 + 0.5 * dsp_cos(kPi * u) + 0.08 * dsp_cos(2.0 * kPi * u);
  return (dsp_sin(kPi * x) / (kPi * x)) * win;
}

// mode: 0 Square, 1 Linear, 2 Sinc, 3 PolyBLEP; 7 Tape is remapped to Sinc here.
static const int kPolyblepMaxDt = 16;

static double blep_after(double t, double dt) {
  if (!(dt > 1.0e-12) || t < 0.0 || t >= dt) return 0.0;
  const double u = t / dt;
  return u + u - u * u - 1.0;
}

static double blep_before(double t, double dt) {
  if (!(dt > 1.0e-12) || t <= 0.0 || t >= dt) return 0.0;
  const double u = -t / dt;
  return u * u + u + u + 1.0;
}

static double read_pcm(
  const float* buf,
  int frames,
  double index,
  int mode,
  int looping,
  int startI,
  int endI,
  double frameIncrement
) {
  if (!buf || frames <= 0) return 0.0;
  if (!(index * 0.0 == 0.0)) return 0.0;
  const int i = (int)dsp_floor(index);
  const double t = index - (double)i;
  if (mode <= 0) {
    return (double)buf[map_pcm_index(i, frames, looping, startI, endI)];
  }
  if (mode == 1) {
    const double a = (double)buf[map_pcm_index(i, frames, looping, startI, endI)];
    const double b = (double)buf[map_pcm_index(i + 1, frames, looping, startI, endI)];
    return a + (b - a) * t;
  }
  if (mode == 3) {
    const double dt = dsp_fabs(frameIncrement);
    if (!(dt > 1.0e-12)) {
      return (double)buf[map_pcm_index(i, frames, looping, startI, endI)];
    }
    if (dt > (double)kPolyblepMaxDt) {
      const double a = (double)buf[map_pcm_index(i, frames, looping, startI, endI)];
      const double b = (double)buf[map_pcm_index(i + 1, frames, looping, startI, endI)];
      return a + (b - a) * t;
    }
    auto sample_at = [&](int idx) -> double {
      return (double)buf[map_pcm_index(idx, frames, looping, startI, endI)];
    };
    double y = sample_at(i);
    int span = (int)dsp_floor(dt) + 1;
    if (span < 1) span = 1;
    if (span > kPolyblepMaxDt) span = kPolyblepMaxDt;
    if (frameIncrement >= 0.0) {
      for (int k = i; k >= i - span; k -= 1) {
        const double dist = index - (double)k;
        if (dist < 0.0 || dist >= dt) continue;
        y += 0.5 * (sample_at(k) - sample_at(k - 1)) * blep_after(dist, dt);
      }
      for (int k = i + 1; k <= i + 1 + span; k += 1) {
        const double dist = (double)k - index;
        if (dist <= 0.0 || dist >= dt) continue;
        y += 0.5 * (sample_at(k) - sample_at(k - 1)) * blep_before(dist, dt);
      }
    } else {
      for (int k = i + 1; k <= i + 1 + span; k += 1) {
        const double dist = (double)k - index;
        if (dist < 0.0 || dist >= dt) continue;
        y += 0.5 * (sample_at(k - 1) - sample_at(k)) * blep_after(dist, dt);
      }
      for (int k = i; k >= i - span; k -= 1) {
        const double dist = index - (double)k;
        if (dist <= 0.0 || dist >= dt) continue;
        y += 0.5 * (sample_at(k - 1) - sample_at(k)) * blep_before(dist, dt);
      }
    }
    if (!(y * 0.0 == 0.0)) return 0.0;
    return y;
  }
  double acc = 0.0;
  for (int m = -kSincK + 1; m <= kSincK; m += 1) {
    const double h = sinc_blackman(t - (double)m);
    if (h == 0.0) continue;
    acc += (double)buf[map_pcm_index(i + m, frames, looping, startI, endI)] * h;
  }
  return acc;
}

static State* slot(int handle) {
  if (handle < 1 || handle > kMaxInstances) return nullptr;
  State& st = gPool[handle - 1];
  if (!st.active) return nullptr;
  return &st;
}

}  // namespace



static void tape_clear(State& st) {
  st.hasLastFrame = false;
  st.lastFrameIndex = 0.0;
  spectral_tilt::clear(&st.tape);
  spectral_tilt::clear_channel(&st.tapeL);
  spectral_tilt::clear_channel(&st.tapeR);
  st.tapeWet = -1.0;
}

static double tape_clamp_tilt(double tilt) {
  double n = safe(tilt);
  if (!(n * 0.0 == 0.0)) n = -6.0;
  if (n > 0.0) n = 0.0;
  if (n < -24.0) n = -24.0;
  return n;
}

static double tape_clamp_tone(double tone) {
  double n = safe(tone);
  if (!(n * 0.0 == 0.0)) n = -6.0;
  if (n > 1.0) n = 1.0;
  if (n < -6.0) n = -6.0;
  return n;
}

static double tape_clamp_range(double range) {
  double n = safe(range);
  if (!(n * 0.0 == 0.0)) n = 1.0;
  if (n < 0.25) n = 0.25;
  if (n > 6.0) n = 6.0;
  return n;
}

static double tape_depth(double speed, double range) {
  const double r = tape_clamp_range(range);
  double s = dsp_fabs(safe(speed));
  if (!(s * 0.0 == 0.0) || s < 1.0e-12) return 1.0;
  if (s >= 1.0) return 0.0;
  double d = -dsp_ln(s) * 1.44269504088896340736 / r;
  if (d < 0.0) d = 0.0;
  if (d > 1.0) d = 1.0;
  return d;
}

static double tape_cutoff_hz(double speed, double pcmRate, double engineRate) {
  const double srcNyq = 0.5 * (pcmRate > 1.0 ? pcmRate : 44100.0);
  const double outSr = engineRate > 1.0 ? engineRate : 44100.0;
  const double outNyq = 0.5 * outSr;
  double cutoff = srcNyq * dsp_fabs(speed);
  if (cutoff > outNyq) cutoff = outNyq;
  return cutoff;
}

static double tape_knee_hz(double speed, double pcmRate, double engineRate, double tone) {
  const double cutoff = tape_cutoff_hz(speed, pcmRate, engineRate);
  double knee = cutoff * dsp_exp(tape_clamp_tone(tone) * 0.693147180559945309417);
  if (knee < 1.0) knee = 1.0;
  const double outSr = engineRate > 1.0 ? engineRate : 44100.0;
  const double maxKnee = 0.45 * outSr;
  if (knee > maxKnee) knee = maxKnee;
  return knee;
}

extern "C" int soemdsp_audio_player_create() {
  for (int i = 0; i < kMaxInstances; i += 1) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.pcmL = nullptr;
      s.pcmR = nullptr;
      s.pcmFrames = 0;
      s.pcmChannels = 0;
      s.pcmROwned = false;
      s.pcmRate = 44100.0;
      playback_reset(s);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_audio_player_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  pcm_release(s);
  s.active = false;
}

extern "C" void soemdsp_audio_player_clear_pcm(int handle) {
  State* st = slot(handle);
  if (!st) return;
  pcm_release(*st);
  playback_reset(*st);
}

// Allocates planar L/R (or mono L with R aliased) and zeros them. JS then
// writes floats at l_ptr/r_ptr. Returns 1 on success; 0 refuses (no truncate).
extern "C" int soemdsp_audio_player_set_pcm(int handle, int frames, double sampleRate, int channels) {
  State* st = slot(handle);
  if (!st) return 0;
  if (frames < 2 || frames > kMaxFrames || channels < 1) return 0;
  pcm_release(*st);
  playback_reset(*st);
  float* left = pcm_malloc(frames);
  if (!left) return 0;
  float* right = left;
  bool rightOwned = false;
  if (channels >= 2) {
    right = pcm_malloc(frames);
    if (!right) {
      pcm_free(left, frames);
      return 0;
    }
    rightOwned = true;
  }
  st->pcmL = left;
  st->pcmR = right;
  st->pcmFrames = frames;
  st->pcmChannels = channels >= 2 ? 2 : 1;
  st->pcmROwned = rightOwned;
  const double rate = safe(sampleRate);
  st->pcmRate = rate > 1.0 ? rate : 44100.0;
  return 1;
}

extern "C" int soemdsp_audio_player_l_ptr(int handle) {
  State* st = slot(handle);
  if (!st || !st->pcmL) return 0;
  return (int)(long long)st->pcmL;
}

extern "C" int soemdsp_audio_player_r_ptr(int handle) {
  State* st = slot(handle);
  if (!st || !st->pcmR) return 0;
  return (int)(long long)st->pcmR;
}

extern "C" int soemdsp_audio_player_max_frames() {
  return kMaxFrames;
}

extern "C" double soemdsp_audio_player_sample(
  int handle,
  double reset,
  double speedCv,
  double phaseCv,
  int hasPhase,
  double transportMode,
  double speedParam,
  double start,
  double end,
  double amplitude,
  double phaseOffset,
  double phaseSkip,
  double playlistScrub,
  double antialias,
  double engineSampleRate,
  double tone,
  double tilt,
  double range
) {
  int interp = (int)dsp_floor(safe(antialias) + 0.5);
  if (interp < 0) interp = 0;
  if (interp > 7) interp = 7;
  if (interp >= 4 && interp <= 6) interp = 2;
  State* stPtr = slot(handle);
  if (!stPtr) return 0.0;
  State& st = *stPtr;

  double startPhase = 0.0;
  double endPhase = 1.0;
  double span = 1.0;
  resolve_range(start, end, &startPhase, &endPhase, &span);

  if (!st.hasRange) {
    st.phase = startPhase;
    st.completed = false;
    st.hasRange = true;
  } else if (st.lastStartPhase != startPhase || st.lastEndPhase != endPhase) {
    if (!(st.phase * 0.0 == 0.0) || st.phase < startPhase || st.phase > endPhase) {
      st.phase = startPhase;
    }
    st.completed = false;
  }
  st.lastStartPhase = startPhase;
  st.lastEndPhase = endPhase;

  int mode = (int)dsp_floor(safe(transportMode) + 0.5);
  if (mode < 0) mode = 0;
  if (mode > 5) mode = 5;
  if (st.transportMode != mode) {
    st.completed = false;
    st.transportMode = mode;
  }
  const bool transportReset = mode <= 0;
  const bool transportStopped = mode == 1;
  const bool transportLooping = mode == 3;
  const bool transportPlayOnce = mode >= 4;

  const double resetV = safe(reset);
  const bool resetEdge = gate_hit(resetV, &st.lastReset);
  if (resetEdge || transportReset || transportStopped) {
    st.phase = startPhase;
    st.completed = false;
    tape_clear(st);
  }
  st.lastReset = resetV;

  if (!st.pcmL || st.pcmFrames <= 1) {
    st.lastLeft = 0.0;
    st.lastRight = 0.0;
    st.lastPhase = 0.0;
    st.lastTrigger = 0.0;
    return 0.0;
  }

  const double speed = safe(speedParam) + safe(speedCv);
  const double engineRate = safe(engineSampleRate) > 1.0 ? safe(engineSampleRate) : 44100.0;
  const double sampleRateRatio = st.pcmRate / engineRate;
  const double increment = (speed * sampleRateRatio) / (double)st.pcmFrames;
  const bool phaseConnected = hasPhase != 0;
  const double offsetSum = safe(phaseOffset) + safe(phaseSkip) + safe(playlistScrub);
  const double basePhase = phaseConnected ? clamp(safe(phaseCv), 0.0, 1.0) : st.phase;
  const double audible = basePhase + offsetSum;
  // Play-once completes on the audible playhead. Rewind/seek inside the
  // region must keep playing (internal phase hitting 1 used to complete
  // while the playhead sat at 0).
  if (st.completed && (transportPlayOnce || transportLooping) && !phaseConnected) {
    if (speed >= 0.0 && audible < endPhase - 1.0e-12) {
      st.completed = false;
    } else if (speed < 0.0 && audible > startPhase + 1.0e-12) {
      st.completed = false;
    }
  }
  const bool playing = (transportPlayOnce || transportLooping) && !st.completed;
  const double boundedPhase = transportLooping
    ? wrap(audible, startPhase, startPhase + span)
    : clamp(audible, startPhase, endPhase);

  const double frameIndex = boundedPhase * (double)(st.pcmFrames - 1);
  const int startI = (int)dsp_floor(startPhase * (double)(st.pcmFrames - 1) + 1.0e-12);
  const int endI = (int)dsp_floor(endPhase * (double)(st.pcmFrames - 1) + 1.0e-12);
  const int looping = transportLooping ? 1 : 0;
  const double frameIncrement = increment * (double)(st.pcmFrames - 1);
  if (st.hasLastFrame) {
    const double expected = st.lastFrameIndex + frameIncrement;
    const double err = dsp_fabs(frameIndex - expected);
    const double spanFrames = (double)(endI - startI + 1);
    const bool loopWrap = looping && err > 0.5 * (spanFrames > 1.0 ? spanFrames : 1.0);
    if (err > 8.0 && !loopWrap) tape_clear(st);
  }
  st.lastFrameIndex = frameIndex;
  st.hasLastFrame = true;
  int readMode = interp == 7 ? 2 : interp;
  double leftS = read_pcm(st.pcmL, st.pcmFrames, frameIndex, readMode, looping, startI, endI, frameIncrement);
  double rightS = read_pcm(st.pcmR ? st.pcmR : st.pcmL, st.pcmFrames, frameIndex, readMode, looping, startI, endI, frameIncrement);
  if (interp == 7) {
    const double depth = tape_depth(speed, range);
    const double slopeEff = tape_clamp_tilt(tilt) * depth;
    const double toneEff = tape_clamp_tone(tone) * depth;
    const double cutoff = tape_cutoff_hz(speed, st.pcmRate, engineRate);
    spectral_tilt::update(
      &st.tape,
      tape_knee_hz(speed, st.pcmRate, engineRate, toneEff),
      slopeEff,
      engineRate,
      spectral_tilt::kStyleKnee,
      spectral_tilt::kLevelMatched,
      1.0,
      cutoff
    );
    const double wetTarget = depth > 0.0 ? 1.0 : 0.0;
    const double fadeA = 1.0 - dsp_exp(-1.0 / (spectral_tilt::kSmoothS * engineRate));
    if (!(st.tapeWet * 0.0 == 0.0) || st.tapeWet < 0.0) {
      st.tapeWet = wetTarget;
    } else {
      st.tapeWet += fadeA * (wetTarget - st.tapeWet);
    }
    if (st.tapeWet < 1.0e-12) {
      st.tapeWet = 0.0;
    } else {
      const double leftW = spectral_tilt::process(&st.tape, &st.tapeL, leftS);
      const double rightW = spectral_tilt::process(&st.tape, &st.tapeR, rightS);
      if (st.tapeWet > 1.0 - 1.0e-12) {
        leftS = leftW;
        rightS = rightW;
      } else {
        leftS = leftS + st.tapeWet * (leftW - leftS);
        rightS = rightS + st.tapeWet * (rightW - rightS);
      }
    }
  } else if (st.tape.ready) {
    tape_clear(st);
  }
  double amp = safe(amplitude);
  if (!(amp * 0.0 == 0.0) || amp < 0.0) amp = 1.0;
  const double left = playing ? leftS * amp : 0.0;
  const double right = playing ? rightS * amp : 0.0;

  double done = 0.0;
  if (!phaseConnected && playing) {
    const double nextAudible = audible + increment;
    if (transportLooping) {
      const double normalizedNext = (nextAudible - startPhase) / span;
      done = (normalizedNext < 0.0 || normalizedNext >= 1.0) ? 1.0 : 0.0;
      st.phase = wrap(nextAudible, startPhase, startPhase + span) - offsetSum;
    } else if (speed >= 0.0 && nextAudible >= endPhase) {
      st.phase = endPhase - offsetSum;
      st.completed = true;
      done = 1.0;
    } else if (speed < 0.0 && nextAudible <= startPhase) {
      st.phase = startPhase - offsetSum;
      st.completed = true;
      done = 1.0;
    } else {
      st.phase = nextAudible - offsetSum;
    }
  } else if (!phaseConnected && (transportReset || transportStopped)) {
    st.phase = startPhase;
  } else if (phaseConnected) {
    st.phase = clamp(safe(phaseCv), 0.0, 1.0);
  }

  st.lastLeft = left;
  st.lastRight = right;
  st.lastPhase = boundedPhase;
  st.lastTrigger = done;
  return 0.5 * (left + right);
}

extern "C" double soemdsp_audio_player_left(int handle) {
  State* st = slot(handle);
  return st ? st->lastLeft : 0.0;
}

extern "C" double soemdsp_audio_player_right(int handle) {
  State* st = slot(handle);
  return st ? st->lastRight : 0.0;
}

extern "C" double soemdsp_audio_player_phase(int handle) {
  State* st = slot(handle);
  return st ? st->lastPhase : 0.0;
}

extern "C" double soemdsp_audio_player_trigger(int handle) {
  State* st = slot(handle);
  return st ? st->lastTrigger : 0.0;
}

extern "C" int soemdsp_audio_player_version() { return 2; }
extern "C" const char* soemdsp_audio_player_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_audio_player_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
