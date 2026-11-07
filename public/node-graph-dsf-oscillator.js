// Offline / Render Sample host for dsfOscillator — same native core as worklet.
// APP_POLICY §2/§5: no JS DSF twin. Silence until dsf_oscillator.wasm is ready.

const nodeGraphDsfOscillatorWasm = { promise: null, exports: null, failed: false };

function nodeGraphDsfOscillatorLoadWasm() {
  if (nodeGraphDsfOscillatorWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return;
  }
  nodeGraphDsfOscillatorWasm.promise = fetch("/native_modules/dsf_oscillator/dsf_oscillator.wasm?v=dsf-v35-1")
    .then((response) => {
      if (!response.ok) throw new Error(`dsf_oscillator wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((result) => {
      nodeGraphDsfOscillatorWasm.exports = result.instance.exports;
    })
    .catch(() => {
      nodeGraphDsfOscillatorWasm.failed = true;
    });
}

function createNodeGraphDsfOscillatorState() {
  return { nativeHandle: 0 };
}

function destroyNodeGraphDsfOscillatorNativeState(state) {
  const wasm = nodeGraphDsfOscillatorWasm.exports;
  if (state?.nativeHandle && wasm?.soemdsp_dsf_oscillator_destroy) {
    wasm.soemdsp_dsf_oscillator_destroy(state.nativeHandle);
    state.nativeHandle = 0;
  }
}

// options: { frequencyHz, sampleRate, waveform, morph, pulseWidth, blend, phase, level, partials }
// morphing: { morphing, symmetry, width, rotate, slice, spacing, oddEven }
function nodeGraphDsfOscillatorSample(state, options = {}) {
  nodeGraphDsfOscillatorLoadWasm();
  const wasm = nodeGraphDsfOscillatorWasm.exports;
  if (!wasm?.soemdsp_dsf_oscillator_create || !wasm?.soemdsp_dsf_oscillator_sample) {
    return { Out: 0 };
  }
  if (!state.nativeHandle) {
    state.nativeHandle = wasm.soemdsp_dsf_oscillator_create();
  }
  if (!state.nativeHandle) {
    return { Out: 0 };
  }
  const sr = Number(options.sampleRate) > 1 ? Number(options.sampleRate) : 48000;
  if (options.morphing && typeof wasm.soemdsp_dsf_oscillator_sample_morph === "function") {
    wasm.soemdsp_dsf_oscillator_sample_morph(
      state.nativeHandle,
      nodeGraphFiniteNumber(options.frequencyHz),
      sr,
      nodeGraphFiniteNumber(options.morph),
      nodeGraphFiniteNumber(options.symmetry),
      nodeGraphFiniteNumber(options.width),
      nodeGraphFiniteNumber(options.rotate),
      nodeGraphFiniteNumber(options.slice),
      nodeGraphFiniteNumber(options.phase),
      nodeGraphFiniteNumber(options.level),
      nodeGraphFiniteNumber(options.spacing, 1),
      nodeGraphFiniteNumber(options.oddEven),
    );
  } else {
    wasm.soemdsp_dsf_oscillator_sample(
      state.nativeHandle,
      nodeGraphFiniteNumber(options.frequencyHz),
      sr,
      Math.round(nodeGraphFiniteNumber(options.waveform)),
      nodeGraphFiniteNumber(options.morph),
      Number(options.pulseWidth) ?? 0.5,
      Number(options.blend) ?? 0.5,
      nodeGraphFiniteNumber(options.phase),
      nodeGraphFiniteNumber(options.level),
      nodeGraphFiniteNumber(options.partials, 20000),
    );
  }
  return { Out: nodeGraphFiniteNumber(wasm.soemdsp_dsf_oscillator_out(state.nativeHandle)) };
}

// Reconstruct a phase-aligned cycle from the native audio samples. This is
// interpolation of the signal, not a second DSF waveform implementation.
function nodeGraphDsfOscillatorPreviewCycle(params, count) {
  nodeGraphDsfOscillatorLoadWasm();
  const wasm = nodeGraphDsfOscillatorWasm.exports;
  if (!wasm?.soemdsp_dsf_oscillator_create || !wasm?.soemdsp_dsf_oscillator_sample) return null;

  const absFrequency = Math.abs(nodeGraphFiniteNumber(params.frequency));
  const sampleRate = nodeGraphDsfSampleRate();
  const output = new Float64Array(Math.max(16, Math.min(8192, count | 0)));
  if (!(absFrequency > 0)) return output;

  // At sub-audio rates, bound the face's period while leaving audio untouched.
  const previewRate = Math.max(2, Math.min(sampleRate, absFrequency * 32768));
  const step = Math.min(0.5, absFrequency / previewRate) * 0.9999;
  const leakTarget = Math.max(0.0005, 2 * Math.PI * absFrequency / (20 * previewRate));
  const warmup = Math.max(1024, Math.min(32768, Math.ceil(8 / leakTarget) + 512));
  const taps = 16;
  // Sample index 0 is native phase (warmup + 1) * step. Locate an exact
  // phase-zero crossing with enough samples on both sides for reconstruction.
  const crossingTurn = Math.ceil((warmup + taps + 3) * step);
  const crossing = crossingTurn / step - warmup - 1;
  const captureCount = Math.ceil(crossing + 1 / step + taps + 3);
  const handle = wasm.soemdsp_dsf_oscillator_create();
  if (!handle) return null;
  const captured = new Float64Array(captureCount);
  const morphing = params.morphing === true;
  try {
    wasm.soemdsp_dsf_oscillator_reset(handle);
    for (let i = 0; i < warmup + captureCount; i += 1) {
      if (morphing) {
        wasm.soemdsp_dsf_oscillator_sample_morph(
          handle, absFrequency, previewRate, params.morph, params.symmetry,
          params.width, params.rotate, params.slice, 0, 1,
          params.spacing, params.oddEven,
        );
      } else {
        wasm.soemdsp_dsf_oscillator_sample(
          handle, absFrequency, previewRate, Math.round(params.waveform),
          params.morph, params.pulseWidth, params.blend, 0, 1, params.partials,
        );
      }
      if (i >= warmup) captured[i - warmup] = wasm.soemdsp_dsf_oscillator_out(handle);
    }
  } finally {
    wasm.soemdsp_dsf_oscillator_destroy(handle);
  }

  for (let i = 0; i < output.length; i += 1) {
    const position = crossing + i / ((output.length - 1) * step);
    const center = Math.floor(position);
    let value = 0;
    for (let sample = center - taps + 1; sample <= center + taps; sample += 1) {
      const distance = position - sample;
      if (sample < 0 || sample >= captured.length || Math.abs(distance) >= taps) continue;
      const sinc = Math.abs(distance) < 1e-9 ? 1 : Math.sin(Math.PI * distance) / (Math.PI * distance);
      const angle = Math.PI * distance / taps;
      const window = 0.42 + 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
      value += captured[sample] * sinc * window;
    }
    output[i] = value;
  }
  return output;
}
