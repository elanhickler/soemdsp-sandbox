// Offline / Render Sample host for dsfOscillator — same native core as worklet.
// APP_POLICY §2/§5: no JS DSF twin. Silence until dsf_oscillator.wasm is ready.

const nodeGraphDsfOscillatorWasm = { promise: null, exports: null, failed: false };

function nodeGraphDsfOscillatorLoadWasm() {
  if (nodeGraphDsfOscillatorWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return;
  }
  nodeGraphDsfOscillatorWasm.promise = fetch("/native_modules/dsf_oscillator/dsf_oscillator.wasm?v=dsf-morph-spacing-1")
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

// options: { frequencyHz, sampleRate, waveform, morph, pulseWidth, blend, phase, level }
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
    );
  }
  return { Out: nodeGraphFiniteNumber(wasm.soemdsp_dsf_oscillator_out(state.nativeHandle)) };
}
