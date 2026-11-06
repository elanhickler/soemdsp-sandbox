# Parameter consumption audit — inventory

Generated 2026-11-06 from `native_modules/graph_engine/graph_engine.cpp` (script: read before the per-sample loop = once per block).

## The rule

- Parameter **smoothing** only chases the knob (mouse / host / preset) toward its target: `Control.out` never includes MOD.
- **Modulation** is added after smoothing, unsmoothed. Live audio-rate MOD (ParamModEdge) is stamped every sample by `control_frame()`.
- So a continuous parameter read **once per block** (`control_effective` before the sample loop) breaks two things: the knob chase steps at block rate (zipper), and audio-rate modulation is sampled once per block (staircase).
- Correct: call `control_frame(g, node, f)` each sample and read inside the loop, or `control_audio(g, c, f)`.
- Allowed per block: discrete choices (Mode, Stages, Waveform, Seed, timing choices), setup params, cyan / additive-chain params (APP_POLICY: block-rate by design), and video modules (Vectorscope Transform, Rotate 3D to 2D, Raster RGB, ...): their params are not meant to be sample accurate.

## Result (2026-11-06)

- Closed. 43 review rows: 18 fixed (stale continuous reads moved after `control_frame`), 22 fine as written (guarded fast paths, choice slots, deliberate block rate), 3 video modules per-block by design.
- 20 choice-only rows confirmed: every per-block slot is pushed as a discrete choice.
- Fixed: alias_sine, antisaw, archimedes, surge_oscillator, basic_shape, scientific_iir, sinc, crossover, mid_side_encode, bradley2a, snowflake, clock, trigger_divider, clock_divider, metallic_ratio, random_clock, trigger_counter, delayed_trigger.
- New modules: read continuous params after `control_frame()` inside the loop, or guard a per-block fast path with `node_needs_sample_accurate_controls`.

## Totals

- 223 module process functions; reads inside sample loops all follow `control_frame()` (OK).
- 43 modules read at least one **continuous-looking** slot per block → review.
- 20 modules read only discrete-looking slots per block → likely OK, confirm.
- 18 additive-chain modules → per block by design (cyan).

Not every pre-loop read is a bug: a read guarded by a fast path that only runs when nothing is chasing and no MOD is active (`node_has_active_chase` false, no ParamModEdge) is correct, and so is a pre-loop read that the loop re-reads per sample. Those rows end up `ok-intentional` after a look.

Slot names are the engine's generic Control slots (`shape`, `center`, `width`, … mean different params per module); `:N` is the line of the first per-block read.

## 1. Review: continuous-looking slots read per block

Status per row: `?` unreviewed, `fix` stale continuous read, `ok-discrete` slot is really a choice, `ok-intentional` deliberate block rate (say why).

| Module | Line | Continuous-looking slots read per block | Discrete slots also read | Status |
|---|---|---|---|---|
| polyblep | 5697 | `amplitude` :5723, `frequency` :5732 | lfoStyle, timingMode, waveform | ok-intentional: fast path guarded by node_needs_sample_accurate_controls; loop re-reads Morph/Amp/Phase |
| ladder | 5846 | `resonance` :5851, `amplitude` :5873, `frequency` :5877 | mode, stages | ok-intentional: fast path guarded; pre-loop Amp/Res re-read per sample in the loop |
| reverb | 6074 | `mix` :6091, `diffusionSize` :6092, `diffusionAmount` :6093, `delaySize` :6094, `recycle` :6095, `lfoAmplitude` :6096, `lfoBaseSpeed` :6097, `lfoVariation` :6098 | lfoStyle, mode, seed | ok-intentional: fast path guarded; loop sets params per sample |
| attenuverter | 6206 | `amplitude` :6211, `offset` :6211 |  | ok-intentional: fast path guarded; loop reads per sample |
| range | 6274 | `inLow` :6281, `inHigh` :6282, `outLow` :6283, `outHigh` :6284 |  | ok-intentional: fast path guarded; loop reads per sample |
| pitch_manager | 6558 | `frequency` :6574 |  | ok-intentional: fast path guarded; loop reads per sample |
| fm | 6666 | `center` :6684, `amplitude` :6685, `offset` :6686 | mode, stages | ok-intentional: fast path guarded; loop reads per sample |
| clock | 6794 | `frequency` :6799, `phaseParam` :6800, `center` :6801, `shape` :6802, `amplitude` :6803 |  | fixed 2026-11-06 (reads moved after control_frame): Rate, Phase, Pulse Start, Pulse End, Level stale in the loop (Rate MOD = clock FM, steps per block). Level is latched per gate/cycle by the DSP, so it can only change at gate starts |
| trigger_divider | 6820 | `amplitude` :6827 | stages, timeNumerator | fixed 2026-11-06 (reads moved after control_frame): Pulse Time and Level stale in the loop; Division discrete |
| clock_divider | 6849 | `shape` :6855, `amplitude` :6856 | stages | fixed 2026-11-06 (reads moved after control_frame): Duty and Amplitude stale in the loop; Division discrete |
| alias_sine | 6878 | `frequency` :6881, `amplitude` :6882 |  | fixed 2026-11-06 (reads moved after control_frame): Frequency and Amplitude read once, used stale in the loop |
| antisaw | 7115 | `shape` :7120, `amplitude` :7121 | stages | fixed 2026-11-06 (reads moved after control_frame): Tilt (shape) and Amplitude stale in the loop; Reflections (stages) discrete. Verified at 1 kHz. Note: silent at defaults by design (only partials above Nyquist sound; 110 Hz x 64 reflections never crosses) |
| archimedes | 7136 | `width` :7154, `amplitude` :7158 | stages | fixed 2026-11-06 (reads moved after control_frame): Amplitude stale in the loop; Dither (width) is an integer 0..63, ok-discrete |
| surge_oscillator | 8105 | `width` :8112, `amplitude` :8113 | waveform | fixed 2026-11-06 (reads moved after control_frame): Sync Freq (width) and Amplitude stale in the loop |
| dsf_oscillator | 8442 | `amplitude` :8450 | waveform | ok-intentional: pre-loop value is overwritten per sample after control_frame |
| hypersaw2 | 8505 | `phaseParam` :8520, `shape` :8522, `width` :8523, `resonance` :8524, `lfoBaseSpeed` :8525, `lfoVariation` :8526, `center` :8527, `lfoRate` :8528, `offset` :8531, `pan` :8533, `feedback` :8534, `amplitude` :8535 | lfoStyle, mode, oversample, seed, stages, waveform | ok-intentional: fast path only when no live ports, no MOD, no chase |
| sinc | 8650 | `phaseParam` :8656 | mode, stages | fixed 2026-11-06 (reads moved after control_frame): Phase stale in the loop; Lobes and Band Limit discrete |
| bradley2a | 8675 | `width` :8687, `shape` :8688, `lfoRate` :8689, `lfoAmplitude` :8690, `lfoBaseSpeed` :8691, `mix` :8692, `lpfFrequency` :8693, `diffusionSize` :8694, `diffusionAmount` :8695, `feedback` :8696, `level` :8698, `phaseParam` :8699, `recycle` :8700, `amplitude` :8701 | timeNumerator | fixed 2026-11-06 (reads moved after control_frame): all 15 continuous params (Freq Translate, jitter, amp, interference, harmonics, hits, impulse, Amplitude) stale in the loop |
| ellipsoid | 8740 | `center` :8753 | mode, oversample | ok-discrete: center is the AA mode; Phase/Morph/Amp read per sample |
| ellipsoid_osc | 8847 | `center` :8853 |  | ok-discrete: center is the AA mode (Off/Limit/Dither); other params read per sample |
| snowflake | 8931 | `width` :8940, `shape` :8941, `center` :8942, `phaseParam` :8943, `amplitude` :8944 | mode, stages | fixed 2026-11-06 (reads moved after control_frame): Angle, Direction, Spin, Phase, Amplitude stale in the loop; Pattern and Iterations discrete |
| scientific_iir | 9074 | `width` :9092, `resonance` :9093 | mode, stages | fixed 2026-11-06 (reads moved after control_frame): Bandwidth (width) and Ripple (resonance) stale in the loop |
| active_filter | 9705 | `shape` :9713 | stages, timingMode, waveform | ok-discrete: shape is LP Slope (0..4); cutoffs and Res read per sample |
| basic_shape | 11185 | `phaseParam` :11192, `shape` :11193, `amplitude` :11194, `center` :11197 | mode, waveform | fixed 2026-11-06 (reads moved after control_frame): Phase, Morph (shape) and Amplitude stale in the loop; Polarity (center) and Motion (mode) discrete |
| soem_reverb | 11395 | `mix` :11406, `delaySize` :11407, `recycle` :11408, `diffusionSize` :11410, `diffusionAmount` :11411, `lfoAmplitude` :11413, `lfoBaseSpeed` :11414, `lfoVariation` :11415, `saturate` :11420, `lpfFrequency` :11421, `hpfFrequency` :11422, `frequency` :11423, `gainDb` :11424, `resonance` :11425, `width` :11426, `center` :11427, `feedback` :11428, `offsetMs` :11429 | lfoStyle, mode, seed, stages, timingMode, waveform | ok-intentional: fast path guarded; loop sets params per sample |
| helmholtz_pitch | 11467 | `center` :11474 | stages | ok-intentional: Threshold is a detector setting pushed once per block with Window Size |
| pll | 11494 | `frequency` :11512, `lpfFrequency` :11515 | mode, stages | ok-intentional: fast path guarded; loop sets params per sample |
| formula_noise | 12516 | `center` :12523, `width` :12526 | mode, seed, stages | ok-intentional: Start is a seek position, Quantize is a choice; Speed and Amp per sample |
| metallic_ratio | 13572 | `width` :13573 |  | fixed 2026-11-06 (reads moved after control_frame): Index stale; ratio computed once per block |
| harmonic_series | 13585 | `width` :13589, `center` :13590, `frequency` :13591 |  | ok-intentional: fast path guarded; loop reads per sample |
| random_clock | 13637 | `center` :13641, `shape` :13644, `offsetMs` :13645, `amplitude` :13646 | seed, timeDenominator, timeNumerator | fixed 2026-11-06 (reads moved after control_frame): Threshold, Min/Max time, Duty, Trigger Time, Level stale in the loop; Seed discrete |
| trigger_counter | 13670 | `center` :13675, `width` :13677, `amplitude` :13679 | stages, timeNumerator | fixed 2026-11-06 (reads moved after control_frame): Threshold, Increment, Pulse Time, Level stale in the loop; Count Max discrete |
| delayed_trigger | 13700 | `center` :13705, `amplitude` :13708 | timeDenominator, timeNumerator | fixed 2026-11-06 (reads moved after control_frame): Threshold, Delay, Pulse Time, Level stale in the loop |
| mid_side_encode | 13728 | `gainDb` :13733, `gainLeftDb` :13734 |  | fixed 2026-11-06 (reads moved after control_frame): Mid and Side gain stale in the loop |
| vectorscope_transform | 13747 | `laneBias[0]` :13752 |  | ok-intentional: video module, per-block params by design |
| rotate_3d_to_2d | 13765 | `laneBias[0]` :13772, `laneBias[1]` :13773, `laneBias[2]` :13774 |  | ok-intentional: video module, per-block params by design |
| crossover | 13799 | `amplitude` :13807 |  | fixed 2026-11-06 (reads moved after control_frame): Amplitude stale in the loop; crossover freqs already per sample |
| robin_oscillator | 14225 | `phaseParam` :14240, `frequency` :14241, `amplitude` :14243, `width` :14246 | mode, waveform | ok-intentional: fast path guarded; loop reads per sample |
| robin_sinusoid | 14288 | `phaseParam` :14300, `frequency` :14301, `amplitude` :14302 |  | ok-intentional: fast path guarded; loop reads per sample |
| robin_supersaw | 14347 | `amplitude` :14365, `width` :14366, `shape` :14368, `center` :14370, `offset` :14373, `lfoRate` :14375, `lfoAmplitude` :14376, `lpfFrequency` :14377, `feedback` :14379 | lfoStyle, mode, oversample, stages, timeDenominator, timeNumerator, waveform | ok-intentional: fast path guarded; per-sample path calls run_block(1) after control_frame |
| hyperpluck | 14432 | `amplitude` :14451, `width` :14452, `center` :14455, `shape` :14457 | mode, stages, waveform | ok-intentional: fast path guarded (plus Phase Multiply active); per-sample path after control_frame |
| noise_generator | 14508 | `c` :14512, `offset` :14523, `width` :14524, `shape` :14525, `amplitude` :14526 | seed | ok-intentional: fast path guarded; loop reads per sample |
| raster_rgb | 14561 | `laneVol[0]` :14569, `laneBias[0]` :14570, `center` :14571, `phaseParam` :14572 |  | ok-intentional: video module, per-block params by design |

## 2. Likely OK: only discrete-looking slots per block

| Module | Line | Slots | Status |
|---|---|---|---|
| ping_pong | 6143 | stages, waveform | ok-discrete: HPF / LPF Poles (1-4) (pushed as a choice) |
| amp_curve | 6257 | mode | ok-discrete: Curve choice (pushed as a choice) |
| transistor_mux | 6352 | stages | ok-discrete: last index (pushed as a choice) |
| transistor | 6436 | stages | ok-discrete: last index (pushed as a choice) |
| eq_filter | 9135 | mode | ok-discrete: filter type (pushed as a choice) |
| passive_filter | 9768 | mode | ok-discrete: mode (pushed as a choice) |
| tb303_filter | 9830 | mode | ok-discrete: mode (pushed as a choice) |
| norm_chaos_filter | 9950 | mode | ok-discrete: mode (pushed as a choice) |
| flower_child_filter | 10057 | mode | ok-discrete: mode (pushed as a choice) |
| flower_child_filter_rev3 | 10085 | lfoStyle, mode | ok-discrete: mode, Dither on/off (pushed as a choice) |
| superlove_filter | 10133 | mode | ok-discrete: mode (pushed as a choice) |
| vcvrack_superlove_filter | 10160 | mode | ok-discrete: mode (pushed as a choice) |
| superlove_rev2 | 10197 | mode | ok-discrete: mode (pushed as a choice) |
| mode_resonator | 10278 | timingMode | ok-discrete: Hold (pushed as a choice) |
| comb_resonator | 10312 | mode, stages, timingMode | ok-discrete: mode, Invert, Hold (pushed as a choice) |
| delay_effect | 11354 | seed | ok-discrete: Seed (pushed as a choice) |
| pump_limiter | 13242 | mode | ok-discrete: Lookahead on/off (pushed as a choice) |
| lookahead_limiter | 13540 | mode, timingMode | ok-discrete: Lookahead, Gain Comp (pushed as a choice) |
| lut_cell | 13613 | seed | ok-discrete: Truth Table (pushed as a choice) |
| sample_hold | 13917 | seed | ok-discrete: Seed (pushed as a choice) |

## 3. By design: additive chain (cyan, block rate)

| Module | Line | Slots |
|---|---|---|
| additive_osc | 7195 | amplitude, center, lpfFrequency, stages, waveform, width |
| additive_generator | 7361 | mode, phaseParam, shape, stages, waveform |
| additive_bubble | 7480 | frequency, mode, phaseParam, resonance, shape |
| additive_linear_filter | 7593 | frequency, mode, phaseParam, shape, waveform |
| additive_analog_filter | 7610 | frequency, mode, phaseParam, shape |
| additive_ladder_filter | 7627 | frequency, mode, resonance, shape |
| additive_frequency_skew | 7644 | inHigh, inLow, mode, shape |
| additive_sync | 7658 | frequency, mode, phaseParam, resonance, shape, width |
| additive_quantize_freq | 7710 | mode, seed, timingMode, width |
| additive_quantize_phase | 7726 | mode, phaseParam, seed |
| additive_pan | 7741 | amplitude, center, frequency, mix, pan, phaseParam, shape, width |
| additive_phase_entry | 7766 | mode |
| additive_blaster | 7779 | amplitude, center, oversample, phaseParam, resonance, shape, timingMode, waveform, width |
| additive_diffusor | 7819 | amplitude, frequency, seed |
| additive_noisy_freq | 7840 | amplitude, frequency, mode, seed |
| additive_noisy_phase | 7861 | amplitude, frequency, mode, seed |
| additive_noisy_pan | 7882 | amplitude, frequency, mode, seed |
| additive_noisy_amp | 7903 | amplitude, frequency, mode, seed |
