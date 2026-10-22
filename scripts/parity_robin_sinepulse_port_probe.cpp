// Probe TU for scripts/parity_robin_sinepulse.cpp: compiles the production
// native_modules/robin_sinepulse/robin_sinepulse.cpp unchanged (same source as the wasm) and exposes
// its internal state (phase accumulator, instantaneous frequency, latched fHi)
// and its wave maps so the harness can compare them with Robin's rsFreqSweeper.
#include "../native_modules/robin_sinepulse/robin_sinepulse.cpp"

// Newest hit's voice (the harness runs Voices 1, Fade Time 0: one voice).
static const Voice& probe_voice(int h) {
  const State& s = gPool[h - 1];
  return s.v[s.newest < 0 ? 0 : s.newest];
}

extern "C" double sinepulse_probe_inst_phase(int h) { return probe_voice(h).instPhase; }
extern "C" double sinepulse_probe_inst_freq(int h) { return probe_voice(h).instFreq; }
extern "C" double sinepulse_probe_fhi(int h) { return probe_voice(h).fHi; }
extern "C" double sinepulse_probe_flo(int h) { return probe_voice(h).fLo; }
extern "C" double sinepulse_probe_tri_saw(double pos01, double m) { return tri_saw(pos01, m); }
extern "C" double sinepulse_probe_wave(int wave, double pos01, double waveShape) {
  return wave_value(wave, pos01, waveShape);
}
extern "C" double sinepulse_probe_sin_lut(double turns) { return dsp_sin_turns_lut(turns); }
