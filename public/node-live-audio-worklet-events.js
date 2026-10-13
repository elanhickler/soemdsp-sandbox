// Extracted from node-live-audio-worklet-core.js (Phase D — events + connections).
// Load after core class, before registerProcessor.

NodeLiveAudioProcessor.prototype.setInputWireBreakTrigger = function setInputWireBreakTrigger(nodeId, port) {
    if (!nodeId || !port) return;
    this.inputWireBreakTriggers.set(this.inputKey(nodeId, port), 1);
    // Efficient native graph: mixInputPort is skipped, so also queue a one-shot
    // live-port poke consumed on the next process_block.
    if (
      this.efficientProduct
      && this.nativeGraphCompiled
      && this.nativeGraphHandle
      && this.nativeGraph?.soemdsp_graph_poke_input
    ) {
      try {
        const hash = this.fnv1aHash32(String(nodeId));
        const node = this.nodes?.get?.(String(nodeId));
        const type = String(node?.type || "");
        const portId = typeof this.mapNativeGraphDstPortId === "function"
          ? this.mapNativeGraphDstPortId(port, type)
          : 0;
        if (hash && portId != null) {
          this.nativeGraph.soemdsp_graph_poke_input(this.nativeGraphHandle, hash, portId | 0, 1);
        }
      } catch (_e) {
        /* keep JS-path trigger even if native poke fails */
      }
    }
};

NodeLiveAudioProcessor.prototype.setSpeed = function setSpeed(speed, options) {
    const value = Number(speed);
    const next = Number.isFinite(value) ? Math.max(0, value) : 1;
    const wasStopped = !(Number(this.speedMultiplier) > 0);
    this.speedMultiplier = next;
    if (options?.restartSequencer === true || (wasStopped && next > 0)) {
      this._seqTickFrac = 0;
      this._sequencerEngineSec = 0;
      this._sequencerNeedsRewind = true;
      this._vmReconcileFp = undefined;
      if (
        this.nativeGraphCompiled
        && this.nativeGraphHandle
        && this.nativeGraph?.soemdsp_graph_rewind_master
      ) {
        try {
          this.nativeGraph.soemdsp_graph_rewind_master(this.nativeGraphHandle);
        } catch (_e) { /* keep play */ }
      }
    }
    // Pause→Play (speed 0→>0) without tearing down the worklet: snap osc phases
    // to 0 so PolyBLEP does not resume at a leftover phase.
    if (wasStopped && next > 0 && this.phases instanceof Map) {
      for (const id of this.phases.keys()) {
        this.phases.set(id, 0);
      }
      if (this.triangleStates instanceof Map) {
        for (const id of this.triangleStates.keys()) {
          this.triangleStates.set(id, 0);
        }
      }
      if (this.polyBlepStates instanceof Map) {
        for (const state of this.polyBlepStates.values()) {
          if (state?.nativeHandle && this.nativePolyBlep?.soemdsp_polyblep_reset) {
            try { this.nativePolyBlep.soemdsp_polyblep_reset(state.nativeHandle); } catch (_e) { /* ignore */ }
          }
        }
      }
    }
};

NodeLiveAudioProcessor.prototype.setSpeedLimit = function setSpeedLimit(limit) {
    const value = Number(limit);
    this.speedLimit = Number.isFinite(value) && value > 0 ? value : 22050;
    if (typeof this.applyNativeGraphSpeedLimit === "function") {
      this.applyNativeGraphSpeedLimit();
    }
};

NodeLiveAudioProcessor.prototype.speedLimitHz = function speedLimitHz() {
    const value = Number(this.speedLimit);
    return Number.isFinite(value) && value > 0 ? value : 22050;
};

/**
 * Absolute-Hz ƒ jack when wired; null if unwired.
 * Mirrors nodeGraphResolveAbsHzJack / nodeGraphReadFInputHz.
 */
NodeLiveAudioProcessor.prototype.readFInputHz = function readFInputHz(mixInput, nodeId, _port = "f") {
    const hasInput = this.boundHasInput
      || ((id, port) => this.hasInputPort(id, port));
    if (typeof nodeGraphResolveAbsHzJack === "function") {
      return nodeGraphResolveAbsHzJack(hasInput, mixInput, nodeId);
    }
    if (typeof hasInput === "function" && typeof mixInput === "function" && nodeId && hasInput(nodeId, "f")) {
      return mixInput(nodeId, "f");
    }
    return null;
};

/**
 * Wired ƒ = absolute Hz; else pitch pitches the Frequency / cutoff knob.
 * Worklet twin of nodeGraphFrequencyHzFromKnobOrF.
 */
NodeLiveAudioProcessor.prototype.frequencyHzFromKnobOrF = function frequencyHzFromKnobOrF(
  knobHz,
  mixInput,
  nodeId,
) {
    if (typeof nodeGraphFrequencyHzFromKnobOrF === "function") {
      const hasInput = this.boundHasInput
        || ((id, port) => this.hasInputPort(id, port));
      return nodeGraphFrequencyHzFromKnobOrF(knobHz, hasInput, mixInput, nodeId);
    }
    const jack = this.readFInputHz(mixInput, nodeId);
    if (jack != null) {
      const n = Number(jack);
      return Number.isFinite(n) ? n : 0;
    }
    const k = Number(knobHz);
    return Number.isFinite(k) ? k : 0;
};

/**
 * Clamp signed Hz to ±Speed Limit.
 * Second arg ignored (legacy ƒ×Frequency multiply removed — wired ƒ cancels the knob).
 */
NodeLiveAudioProcessor.prototype.resolveFrequencyHz = function resolveFrequencyHz(baseHz, _fHzOrNull) {
    const maxHz = this.speedLimitHz();
    const base = Number(baseHz);
    if (!Number.isFinite(base)) return 0;
    if (base > maxHz) return maxHz;
    if (base < -maxHz) return -maxHz;
    return base;
};

NodeLiveAudioProcessor.prototype.effectiveSampleRate = function effectiveSampleRate() {
    const speedMul = Math.max(0, this.speedMultiplier ?? 1);
    const host = this.engineSampleRate || sampleRate || 44100;
    return speedMul > 0 ? host / speedMul : 0;
};

NodeLiveAudioProcessor.prototype.createImpulseButtonState = function createImpulseButtonState() {
    return {
      amplitude: 1,
      pulseSamples: 0,
    };
};

NodeLiveAudioProcessor.prototype.setImpulseButtonTrigger = function setImpulseButtonTrigger(nodeId, amplitude) {
    if (!nodeId) return;
    const state = this.impulseButtonStates.get(nodeId) || this.createImpulseButtonState();
    // Short audible click (~20 ms), same family as other UI trigger pulses.
    const pulse = typeof this.gameTriggerPulseSamples === "function"
      ? this.gameTriggerPulseSamples()
      : Math.max(1, Math.round((this.engineSampleRate || sampleRate || 44100) * 0.02));
    state.pulseSamples = Math.max(0, nodeGraphFiniteNumber(state.pulseSamples)) + pulse;
    const normalized = Number(amplitude);
    state.amplitude = Number.isFinite(normalized) ? Math.max(0, Math.min(1, normalized)) : 1;
    this.impulseButtonStates.set(nodeId, state);
};

NodeLiveAudioProcessor.prototype.createBugButtonState = function createBugButtonState() {
    return {
      down: 0,
      downPulseSamples: 0,
      hover: 0,
      upPulseSamples: 0,
      x: 0,
      y: 0,
    };
};

NodeLiveAudioProcessor.prototype.setBugButtonInteraction = function setBugButtonInteraction(message = {}) {
    const nodeId = String(message.nodeId || "");
    if (!nodeId) return;
    const state = this.bugButtonStates.get(nodeId) || this.createBugButtonState();
    if (message.down !== undefined) state.down = message.down ? 1 : 0;
    if (message.hover !== undefined) state.hover = message.hover ? 1 : 0;
    if (Number.isFinite(Number(message.x))) state.x = Number(message.x);
    if (Number.isFinite(Number(message.y))) state.y = Number(message.y);
    if (message.downPulse) state.downPulseSamples += 1;
    if (message.upPulse) state.upPulseSamples += 1;
    this.bugButtonStates.set(nodeId, state);
};

NodeLiveAudioProcessor.prototype.setConnections = function setConnections(plan, message = {}) {
    // Live OS / engine-rate updates arrive on setConnections (plan shape unchanged).
    if (typeof this.applyOversamplingFromMessage === "function") {
      this.applyOversamplingFromMessage(message);
    }
    this.patchFingerprint = message.patchFingerprint || plan?.patchFingerprint || this.patchFingerprint || "";
    this.planSerial = message.planSerial || this.planSerial || 0;
    this.sessionId = message.sessionId || this.sessionId || 0;
    this.outputNode = plan?.outputNode || this.outputNode || "output";
    this.scopeCaptureNodeIds = Array.isArray(plan?.scopeCaptureNodeIds)
      ? plan.scopeCaptureNodeIds.map((nodeId) => String(nodeId || "")).filter(Boolean)
      : this.scopeCaptureNodeIds;
    if (plan?.scopeCaptureRates && typeof plan.scopeCaptureRates === "object") {
      this.scopeCaptureRates = { ...plan.scopeCaptureRates };
    }
    this.visualSinks = (Array.isArray(plan?.visualSinks) ? plan.visualSinks : this.visualSinks).map((sink) => ({
      ...sink,
      bufferedInputs: Array.isArray(sink?.bufferedInputs) ? [...sink.bufferedInputs] : [],
      inputs: (Array.isArray(sink?.inputs) ? sink.inputs : []).map((input) => ({ ...input })),
    }));
    this.syncVisualInputBuffers();
    if (plan?.timing && typeof this.normalizePatchTiming === "function") {
      this.timing = this.normalizePatchTiming(plan.timing);
    }
    if (Number.isFinite(Number(message.pitchReferenceMidiNote))) {
      this.pitchReferenceMidiNote = Number(message.pitchReferenceMidiNote);
    }
    if (Number.isFinite(Number(message.pitchReferenceHz))) {
      this.pitchReferenceHz = Number(message.pitchReferenceHz);
    }
    if (typeof this.applyNativeGraphPitchReference === "function") {
      this.applyNativeGraphPitchReference();
    }
    if (Number.isFinite(Number(message.speedLimit))) {
      this.setSpeedLimit(message.speedLimit);
    }
    if (Number.isFinite(Number(message.displayFps))) {
      this.displayFps = Math.max(0, Math.min(240, Math.round(Number(message.displayFps))));
    }
    if (Number.isFinite(Number(message.autoSmoothingSeconds)) && typeof this.clampAutoSmoothingSeconds === "function") {
      this.autoSmoothingSeconds = this.clampAutoSmoothingSeconds(message.autoSmoothingSeconds);
    }
    const bypassed = new Set(Array.isArray(plan?.bypassedNodes) ? plan.bypassedNodes : []);
    if (Array.isArray(plan?.nodes)) {
      // Connection-only plan posts still carry runtime nodes. Apply params /
      // samplePhase here or Stop/Pause never reach the worklet when the graph
      // shape is unchanged (setPlan is skipped, setParams was coalesced away).
      if (typeof this.setParams === "function" && plan.nodes.length) {
        this.setParams(plan.nodes, message);
      }
      for (const node of plan.nodes) {
        const current = this.nodes.get(node.id);
        if (!current) {
          continue;
        }
        current.bypassed = Boolean(node.bypassed) || bypassed.has(node.id);
        if (Object.hasOwn(node, "alias")) {
          current.alias = node.alias ? String(node.alias) : undefined;
        }
        if (node.bypassSpec && typeof node.bypassSpec === "object") {
          current.bypassSpec = node.bypassSpec;
        }
        if (Object.hasOwn(node, "sequencer")) {
          current.sequencer = node.sequencer && typeof node.sequencer === "object"
            ? node.sequencer
            : null;
          this._sequencerPrevMasks?.delete?.(node.id);
        }
        if (Object.hasOwn(node, "chordMemory")) {
          current.chordMemory = node.chordMemory && typeof node.chordMemory === "object"
            ? node.chordMemory
            : null;
        }
      }
    } else {
      for (const [id, current] of this.nodes) {
        current.bypassed = bypassed.has(id);
      }
    }
    const ids = new Set([...this.nodes.keys()]);
    this.inputConnections = this.buildInputConnectionMap(plan?.connections, ids);
    this._planConnections = Array.isArray(plan?.connections) ? plan.connections.slice() : [];
    this.graphInputConnections = this.buildGraphInputConnectionMap(plan?.graphConnections, ids);
    this.modulationConnections = this.buildModulationConnectionMap(plan?.modulations, ids);
    const graphData = message.graphData || plan?.graphData;
    if (graphData) {
      this.setGraphData(graphData);
    }
    // Efficient mode: recompile only if wires/nodes changed. Bypass is a flag —
    // never clear/recreate natives (that wiped reverb/delay tails).
    if (this.efficientProduct) {
      if (typeof this.syncNativeGraphFromPlan === "function") {
        this.syncNativeGraphFromPlan();
      } else if (typeof this.compileNativeGraphFromPlan === "function") {
        this.compileNativeGraphFromPlan();
      }
    }
};

NodeLiveAudioProcessor.prototype.setGraphData = function setGraphData(graphData) {
    if (!graphData || typeof graphData !== "object") {
      return;
    }
    for (const [nodeId, graph] of Object.entries(graphData)) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.graph = graph;
      }
    }
};

NodeLiveAudioProcessor.prototype.setParams = function setParams(nodes, message = {}) {
    const patchFingerprint = message.patchFingerprint || "";
    this.patchFingerprint = patchFingerprint || this.patchFingerprint;
    this.planSerial = message.planSerial || 0;
    this.sessionId = message.sessionId || 0;
    this.autoSmoothingSeconds = this.clampAutoSmoothingSeconds(message.autoSmoothingSeconds);
    this.syncNestedAutoSmoothingSeconds(this.autoSmoothingSeconds);
    let parameterCount = 0;
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const current = this.nodes.get(node.id);
      if (!current) {
        continue;
      }
      current.params = { ...(node.params || {}) };
      current.paramMeta = { ...(node.paramMeta || {}) };
      // Module Settings voice host fields (not face params).
      if (Object.hasOwn(node, "metamodule")) {
        current.metamodule = node.metamodule && typeof node.metamodule === "object"
          ? node.metamodule
          : undefined;
      }
      // Keep drawn path in sync when params push also carries node extras.
      if (Object.hasOwn(node, "drawnPath")) {
        current.drawnPath = node.drawnPath || null;
      }
      if (Object.hasOwn(node, "sequencer")) {
        current.sequencer = node.sequencer && typeof node.sequencer === "object"
          ? node.sequencer
          : null;
        this._sequencerPrevMasks?.delete?.(node.id);
      }
      if (Object.hasOwn(node, "acidSequencer")) {
        current.acidSequencer = node.acidSequencer && typeof node.acidSequencer === "object"
          ? node.acidSequencer
          : null;
      }
      if (Object.hasOwn(node, "chordMemory")) {
        current.chordMemory = node.chordMemory && typeof node.chordMemory === "object"
          ? node.chordMemory
          : null;
      }
      if (Object.hasOwn(node, "samplePhase") && Number.isFinite(Number(node.samplePhase))) {
        current.samplePhase = Number(node.samplePhase);
      }
      if (Object.hasOwn(node, "samplePhaseSeek") && Number.isFinite(Number(node.samplePhaseSeek))) {
        current.samplePhaseSeek = Math.max(0, Math.round(Number(node.samplePhaseSeek)) || 0);
      }
      parameterCount += Object.keys(current.params || {}).length;
      if (Array.isArray(node._pendingSnapParams) && node._pendingSnapParams.length) {
        current._pendingSnapParams = node._pendingSnapParams.slice();
      }
      // Legacy JS chase only for ?product=full — efficient path is write-only.
      if (!this.efficientProduct) {
        for (const [key, value] of Object.entries(current.params || {})) {
          const smootherKey = this.parameterKey(node.id, key);
          const metadata = current.paramMeta?.[key];
          if (!this.smoothers.has(smootherKey)) {
            this.smoothers.set(smootherKey, this.createSmoother(value, metadata));
          }
          this.updateSmoother(this.smoothers.get(smootherKey), value, metadata, smootherKey);
        }
      }
    }
    if (this.efficientProduct && this.smoothers?.size) {
      this.smoothers.clear();
      this.activeSmoothers = [];
      this.activeSmootherKeys?.clear?.();
    }
    if (typeof this.applyPendingParamSnaps === "function") {
      this.applyPendingParamSnaps();
    }
    // Efficient mode: push Control targets into native graph (no recompile).
    if (this.efficientProduct && typeof this.syncNativeGraphParams === "function") {
      this.syncNativeGraphParams();
    }
    if (this.efficientProduct && typeof this.publishEfficientControllerBiasTargets === "function") {
      try {
        this.publishEfficientControllerBiasTargets();
      } catch (_e) { /* keep params */ }
    }
    if (this.efficientProduct && typeof this.syncNativeHostCvFeeders === "function") {
      try {
        this.syncNativeHostCvFeeders();
      } catch (_e) { /* keep params */ }
    }
    if (typeof this.clearPendingParamSnaps === "function") {
      this.clearPendingParamSnaps();
    }
    this.port.postMessage({
      nodeCount: this.nodes.size,
      order: [...this.order],
      parameterCount,
      patchFingerprint,
      planSerial: this.planSerial,
      sessionId: this.sessionId,
      type: "paramsApplied",
    });
};

NodeLiveAudioProcessor.prototype._normalizeKeyboardSignalPayload = function _normalizeKeyboardSignalPayload(
  signal,
  { pulse = false, previous = null } = {},
) {
    const source = signal && typeof signal === "object" ? signal : {};
    const prev = previous && typeof previous === "object" ? previous : {};
    // Hold last triggered midi/freq when gate drops or payload omits pitch.
    // Do not snap to middle-C (60) / A440 after a real note has been played.
    const sourceMidi = Number(source.midi);
    const prevMidi = Number(prev.midi);
    const midi = this.clampValue(
      Math.round(
        Number.isFinite(sourceMidi)
          ? sourceMidi
          : (Number.isFinite(prevMidi) ? prevMidi : 60),
      ),
      0,
      127,
    );
    const rawMidiSource = Number(source.rawMidi);
    const rawMidi = Number.isFinite(rawMidiSource)
      ? this.clampValue(Math.round(rawMidiSource), 0, 127)
      : (Number.isFinite(Number(prev.rawMidi))
        ? this.clampValue(Math.round(Number(prev.rawMidi)), 0, 127)
        : midi);
    const octave = this.clampValue(
      Math.round(Number.isFinite(Number(source.octave)) ? Number(source.octave) : (nodeGraphFiniteNumber(prev.octave))),
      -6,
      6,
    );
    const keyIndex = this.clampValue(
      Number.isFinite(Number(source.keyIndex))
        ? Number(source.keyIndex)
        : (nodeGraphFiniteNumber(prev.keyIndex)),
      0,
      24,
    );
    const keyQuantized = this.clampValue(
      Number.isFinite(Number(source.keyQuantized))
        ? Number(source.keyQuantized)
        : (Number.isFinite(Number(prev.keyQuantized)) ? Number(prev.keyQuantized) : keyIndex / 24),
      0,
      1,
    );
    const sourceFreq = Number(source.frequency);
    const prevFreq = Number(prev.frequency);
    const frequency = Math.max(
      0,
      Number.isFinite(sourceFreq) && sourceFreq > 0
        ? sourceFreq
        : (Number.isFinite(prevFreq) && prevFreq > 0
          ? prevFreq
          : 440 * (2 ** ((midi - 69) / 12))),
    );
    const velocity = this.clampValue(
      Number.isFinite(Number(source.velocity))
        ? Number(source.velocity)
        : (nodeGraphFiniteNumber(prev.velocity)),
      0,
      1,
    );
    return {
      gate: Number(source.gate) > 0 ? 1 : 0,
      x: this.clampValue(
        Number.isFinite(Number(source.x)) ? Number(source.x) : (nodeGraphFiniteNumber(prev.x, keyQuantized)),
        0,
        1,
      ),
      y: this.clampValue(
        Number.isFinite(Number(source.y)) ? Number(source.y) : (nodeGraphFiniteNumber(prev.y)),
        0,
        1,
      ),
      velocity,
      keyIndex,
      keyQuantized,
      rawMidi,
      octave,
      midi,
      pitchValue: this.clampValue(
        Number.isFinite(Number(source.pitchValue)) ? Number(source.pitchValue) : midi,
        0,
        127,
      ),
      midiNormalized: this.clampValue(
        Number.isFinite(Number(source.midiNormalized))
          ? Number(source.midiNormalized)
          : midi / 127,
        0,
        1,
      ),
      tenthVoltPerOctave: Number.isFinite(Number(source.tenthVoltPerOctave))
        ? Number(source.tenthVoltPerOctave)
        : midi / 120,
      frequency,
    };
};

/** Event-queue key for the hardware MIDI keyboard (one per patch). */
NodeLiveAudioProcessor.KEYBOARD_MIDI_EVENT_ID = "\u0000midiKeyboard";

NodeLiveAudioProcessor.prototype.setMidiKeyboardSignal = function setMidiKeyboardSignal(signal, atFrame) {
    // Hardware MIDI device signal (MIDI module only).
    const previous = this.midiKeyboardSignal;
    this.midiKeyboardSignal = this._normalizeKeyboardSignalPayload(signal, {
      pulse: true,
      previous,
    });
    this.queueKeyboardEvent(
      NodeLiveAudioProcessor.KEYBOARD_MIDI_EVENT_ID,
      previous,
      this.midiKeyboardSignal,
      signal,
      atFrame,
    );
};

/**
 * Keyboard Gate/Trigger events. Main stamps each one with the audio clock
 * (atFrame, host-rate sample frame). The worklet queues them per keyboard and
 * writes them into the Gate/Trigger sample blocks at their exact offset.
 * A late event lands on sample 0 of the next block. Nothing is dropped, and
 * a Trigger is one sample per strike: there is no held pulse flag.
 */
NodeLiveAudioProcessor.prototype.queueKeyboardEvent = function queueKeyboardEvent(id, previous, next, raw, atFrame) {
  const key = String(id || "");
  if (!key) return;
  if (!this._keyboardEventState) this._keyboardEventState = new Map();
  let st = this._keyboardEventState.get(key);
  if (!st) {
    st = { gate: 0, vel: 0, queue: [], plan: null };
    this._keyboardEventState.set(key, st);
  }
  const wasDown = Number(previous?.gate) > 0;
  const gate = Number(next?.gate) > 0 ? 1 : 0;
  const vel = Number(next?.velocity) || 0;
  // A new key while one is held (MIDI legato, Grid Keyboard slide) strikes again.
  const restrike = wasDown && gate === 1
    && Number(raw?.gatePulse) > 0
    && Number(previous?.rawMidi) !== Number(next?.rawMidi);
  // Trigger-only strike (Keyboard right-click sweep): Gate stays low, one Trigger.
  const triggerOnly = gate === 0 && !wasDown && Number(raw?.gatePulse) > 0;
  const pulse = (gate === 1 && (!wasDown || restrike)) || triggerOnly ? 1 : 0;
  if (gate === (wasDown ? 1 : 0) && !pulse) return;
  const f = Number(atFrame);
  st.queue.push({ frame: Number.isFinite(f) && f >= 0 ? Math.round(f) : -1, gate, pulse, vel });
};

/** Event state for a Keyboard / Grid Keyboard / MIDI keyboard node, or null. */
NodeLiveAudioProcessor.prototype.keyboardEventStateFor = function keyboardEventStateFor(srcId) {
  const id = String(srcId || "");
  const type = String(this.nodes?.get?.(id)?.type || "");
  const key = type === "keyboardController" ? NodeLiveAudioProcessor.KEYBOARD_MIDI_EVENT_ID : id;
  return this._keyboardEventState?.get?.(key) || null;
};

/**
 * Turn queued events due in [startFrame, startFrame + hostFrames) into this
 * quantum's plan: gate edges and trigger strikes at engine-rate offsets
 * (host offset * ratio when oversampling). Later events stay queued.
 */
NodeLiveAudioProcessor.prototype.prepareKeyboardEventBlock = function prepareKeyboardEventBlock(startFrame, hostFrames, ratio) {
  const states = this._keyboardEventState;
  if (!states || !states.size) return;
  const end = startFrame + hostFrames;
  // A stamp more than a second ahead is a clock mismatch: play it now.
  const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
  const farFuture = end + rate;
  states.forEach((st) => {
    const plan = { startGate: st.gate, startVel: st.vel, edges: [], pulses: [] };
    let last = 0;
    let n = 0;
    while (n < st.queue.length) {
      const ev = st.queue[n];
      if (ev.frame >= end && ev.frame < farFuture) break;
      const hostOff = ev.frame >= startFrame && ev.frame < end ? ev.frame - startFrame : 0;
      const off = Math.max(last, hostOff * ratio);
      last = off;
      plan.edges.push({ off, gate: ev.gate, vel: ev.vel });
      if (ev.pulse) plan.pulses.push({ off, vel: ev.vel });
      st.gate = ev.gate;
      st.vel = ev.vel;
      n += 1;
    }
    if (n) st.queue.splice(0, n);
    st.plan = plan;
  });
};

NodeLiveAudioProcessor.prototype.setKeyboardModuleSignal = function setKeyboardModuleSignal(nodeId, signal, atFrame) {
  // One Keyboard / Grid Keyboard face pointer signal. null = that keyboard is gone.
  const id = String(nodeId || "");
  if (!id) return;
  if (!signal || typeof signal !== "object") {
    this.keyboardSignalByNode.delete(id);
    this._keyboardEventState?.delete?.(id);
    return;
  }
  const previous = this.keyboardSignalByNode.get(id);
  const next = this._normalizeKeyboardSignalPayload(signal, {
    pulse: false,
    previous,
  });
  this.keyboardSignalByNode.set(id, next);
  this.queueKeyboardEvent(id, previous, next, signal, atFrame);
};

NodeLiveAudioProcessor.prototype.setMidiKeyboardPlayKeysBitmask = function setMidiKeyboardPlayKeysBitmask(mask) {
  this.midiKeyboardPlayMask = typeof noteMaskEnsure === "function"
    ? noteMaskEnsure(mask)
    : (mask instanceof Uint8Array ? mask : new Uint8Array(128));
};

NodeLiveAudioProcessor.prototype.setChordMemoryLatch = function setChordMemoryLatch(slotsByNode, playMaskByNode, momentaryByNode) {
  if (typeof nodeGraphChordMemoryApplyLiveLatch === "function") {
    nodeGraphChordMemoryApplyLiveLatch(slotsByNode, playMaskByNode, momentaryByNode);
  }
};

/** One keyboard's gold Arp Keys latch (mask + per-key velocities). null mask = that keyboard is gone. */
NodeLiveAudioProcessor.prototype.setKeyboardArpLatch = function setKeyboardArpLatch(nodeId, mask, velocities) {
  const id = String(nodeId || "");
  if (!id) return;
  if (!(mask instanceof Uint8Array)) {
    this.keyboardArpByNode.delete(id);
    return;
  }
  const vels = new Uint8Array(128);
  if (velocities instanceof Uint8Array) vels.set(velocities.subarray(0, 128));
  this.keyboardArpByNode.set(id, {
    mask: typeof noteMaskEnsure === "function" ? noteMaskEnsure(mask) : new Uint8Array(mask),
    velocities: vels,
  });
};

/** MIDI module Polyphony Midi Note + Velocity table (128 bytes). */
NodeLiveAudioProcessor.prototype.setPolyphonyVelocities = function setPolyphonyVelocities(source, velocities) {
  if (String(source || "") !== "midi") return;
  const n = typeof POLYPHONY_NOTE_COUNT === "number" ? POLYPHONY_NOTE_COUNT : 128;
  const table = velocities instanceof Uint8Array
    ? new Uint8Array(velocities)
    : new Uint8Array(n);
  if (table.length < n) {
    const full = new Uint8Array(n);
    full.set(table);
    this.midiPolyphonyVelocities = full;
    return;
  }
  this.midiPolyphonyVelocities = table.subarray(0, n);
};

/** Ensure combined-wasm VoiceManager handle exists. */
NodeLiveAudioProcessor.prototype.ensureVoiceManager = function ensureVoiceManager() {
  const native = this.nativeGraph;
  if (!native?.soemdsp_voice_manager_create) return 0;
  if (this._voiceManagerHandle > 0) return this._voiceManagerHandle;
  const h = native.soemdsp_voice_manager_create() | 0;
  this._voiceManagerHandle = h > 0 ? h : 0;
  return this._voiceManagerHandle;
};

NodeLiveAudioProcessor.prototype.vmLog = function vmLog(msg) {
  if (!Array.isArray(this._vmActLog)) this._vmActLog = [];
  this._vmActLog.push(String(msg || ""));
};

NodeLiveAudioProcessor.prototype.vmNoteOn = function vmNoteOn(note, velocity01) {
  const native = this.nativeGraph;
  const h = this.ensureVoiceManager();
  if (!(h > 0) || !native?.soemdsp_voice_manager_note_on) return;
  const n = Math.round(Number(note)) | 0;
  const vel = Number(velocity01) || 0;
  const already = native.soemdsp_voice_manager_note_is_on?.(h, n) | 0;
  native.soemdsp_voice_manager_note_on(h, n, vel);
  this.vmLog?.(already ? `on ${n} (already)` : `on ${n}`);
};

NodeLiveAudioProcessor.prototype.vmNoteOff = function vmNoteOff(note) {
  const native = this.nativeGraph;
  const h = this.ensureVoiceManager();
  if (!(h > 0) || !native?.soemdsp_voice_manager_note_off) return;
  const n = Math.round(Number(note)) | 0;
  const was = native.soemdsp_voice_manager_note_is_on?.(h, n) | 0;
  native.soemdsp_voice_manager_note_off(h, n);
  this.vmLog?.(was ? `off ${n}` : `off ${n} (already)`);
};

NodeLiveAudioProcessor.prototype.vmAllNotesOff = function vmAllNotesOff() {
  const native = this.nativeGraph;
  const h = this._voiceManagerHandle | 0;
  if (!(h > 0) || !native?.soemdsp_voice_manager_all_notes_off) return;
  native.soemdsp_voice_manager_all_notes_off(h);
};

NodeLiveAudioProcessor.prototype.normalizeExternalButtonEventName = function normalizeExternalButtonEventName(name) {
    const key = String(name || "").trim().toLowerCase();
    if (key === "mousedown" || key === "pointerdown") return "down";
    if (key === "mouseup" || key === "pointerup") return "up";
    if (key === "mouseenter" || key === "pointerenter") return "enter";
    if (key === "mouseleave" || key === "pointerleave") return "leave";
    return ["click", "hover", "down", "up", "enter", "leave"].includes(key) ? key : "";
};

NodeLiveAudioProcessor.prototype.setExternalButtonEvent = function setExternalButtonEvent(name) {
    const key = this.normalizeExternalButtonEventName(name);
    if (!key) return;
    const samples = Math.max(1, Math.round(Math.max(1, this.engineSampleRate || sampleRate) * 0.02));
    this.externalButtonEvents.set(key, Math.max(nodeGraphFiniteNumber(this.externalButtonEvents.get(key)), samples));
};

NodeLiveAudioProcessor.prototype.externalButtonEventPulse = function externalButtonEventPulse(name) {
    const remaining = nodeGraphFiniteNumber(this.externalButtonEvents.get(name));
    if (remaining <= 0) {
      this.externalButtonEvents.delete(name);
      return 0;
    }
    this.externalButtonEvents.set(name, remaining - 1);
    return 1;
};

NodeLiveAudioProcessor.prototype.wireBreakGateSamples = function wireBreakGateSamples() {
    return Math.max(1, Math.round(Math.max(1, this.engineSampleRate || sampleRate) * 0.52));
};

NodeLiveAudioProcessor.prototype.gameTriggerPulseSamples = function gameTriggerPulseSamples() {
    return Math.max(1, Math.round(Math.max(1, this.engineSampleRate || sampleRate) * 0.02));
};

NodeLiveAudioProcessor.prototype.setWireBreakEvent = function setWireBreakEvent() {
    const event = this.wireBreakEvent && typeof this.wireBreakEvent === "object"
      ? this.wireBreakEvent
      : { pulseSamples: 0, gateSamples: 0 };
    event.pulseSamples = Math.max(nodeGraphFiniteNumber(event.pulseSamples), this.gameTriggerPulseSamples());
    event.gateSamples = Math.max(nodeGraphFiniteNumber(event.gateSamples), this.wireBreakGateSamples());
    this.wireBreakEvent = event;
};

NodeLiveAudioProcessor.prototype.wireBreakEventSample = function wireBreakEventSample() {
    const event = this.wireBreakEvent && typeof this.wireBreakEvent === "object"
      ? this.wireBreakEvent
      : { pulseSamples: 0, gateSamples: 0 };
    const pulseSamples = Math.max(0, nodeGraphFiniteNumber(event.pulseSamples));
    const gateSamples = Math.max(0, nodeGraphFiniteNumber(event.gateSamples));
    event.pulseSamples = Math.max(0, pulseSamples - 1);
    event.gateSamples = Math.max(0, gateSamples - 1);
    this.wireBreakEvent = event;
    return {
      Pulse: pulseSamples > 0 ? 1 : 0,
      Gate: gateSamples > 0 ? 1 : 0,
    };
};

NodeLiveAudioProcessor.prototype.setWireConnectEvent = function setWireConnectEvent() {
    const event = this.wireConnectEvent && typeof this.wireConnectEvent === "object"
      ? this.wireConnectEvent
      : { pulseSamples: 0 };
    event.pulseSamples = Math.max(nodeGraphFiniteNumber(event.pulseSamples), this.gameTriggerPulseSamples());
    this.wireConnectEvent = event;
};

NodeLiveAudioProcessor.prototype.wireConnectEventSample = function wireConnectEventSample() {
    const event = this.wireConnectEvent && typeof this.wireConnectEvent === "object"
      ? this.wireConnectEvent
      : { pulseSamples: 0 };
    const pulseSamples = Math.max(0, nodeGraphFiniteNumber(event.pulseSamples));
    event.pulseSamples = Math.max(0, pulseSamples - 1);
    this.wireConnectEvent = event;
    return { Pulse: pulseSamples > 0 ? 1 : 0 };
};

NodeLiveAudioProcessor.prototype.setWireDisconnectEvent = function setWireDisconnectEvent() {
    const event = this.wireDisconnectEvent && typeof this.wireDisconnectEvent === "object"
      ? this.wireDisconnectEvent
      : { pulseSamples: 0 };
    event.pulseSamples = Math.max(nodeGraphFiniteNumber(event.pulseSamples), this.gameTriggerPulseSamples());
    this.wireDisconnectEvent = event;
};

NodeLiveAudioProcessor.prototype.wireDisconnectEventSample = function wireDisconnectEventSample() {
    const event = this.wireDisconnectEvent && typeof this.wireDisconnectEvent === "object"
      ? this.wireDisconnectEvent
      : { pulseSamples: 0 };
    const pulseSamples = Math.max(0, nodeGraphFiniteNumber(event.pulseSamples));
    event.pulseSamples = Math.max(0, pulseSamples - 1);
    this.wireDisconnectEvent = event;
    return { Pulse: pulseSamples > 0 ? 1 : 0 };
};

NodeLiveAudioProcessor.prototype.setShootingStarExplosionEvent = function setShootingStarExplosionEvent(speed = null) {
    const event = this.shootingStarExplosionEvent && typeof this.shootingStarExplosionEvent === "object"
      ? this.shootingStarExplosionEvent
      : { pulseSamples: 0, speed: null };
    event.pulseSamples = Math.max(0, nodeGraphFiniteNumber(event.pulseSamples)) + 1;
    const normalizedSpeed = Number(speed);
    event.speed = Number.isFinite(normalizedSpeed) ? normalizedSpeed : null;
    this.shootingStarExplosionEvent = event;
};

NodeLiveAudioProcessor.prototype.nativeShootingStarExplosionPower = function nativeShootingStarExplosionPower(speed, lowRange = 0, highRange = 1) {
    if (
      !this.nativeShootingStarExplosionReady
      || !this.nativeShootingStarExplosion?.soemdsp_shooting_star_explosion_power
    ) {
      throw new Error("native Shooting Star Explosion not ready");
    }
    const low = nodeGraphFiniteNumber(lowRange);
    const high = nodeGraphFiniteNumber(highRange);
    return this.safeFilterNumber(
      this.nativeShootingStarExplosion.soemdsp_shooting_star_explosion_power(
        Number.isFinite(speed) ? speed : -1,
        low,
        high,
      ),
      null,
    );
};

NodeLiveAudioProcessor.prototype.shootingStarExplosionEventSample = function shootingStarExplosionEventSample(lowRange = 0, highRange = 1) {
    const event = this.shootingStarExplosionEvent && typeof this.shootingStarExplosionEvent === "object"
      ? this.shootingStarExplosionEvent
      : { pulseSamples: 0 };
    const pulseSamples = Math.max(0, nodeGraphFiniteNumber(event.pulseSamples));
    const speed = Number(event.speed);
    const power = this.nativeShootingStarExplosionPower(speed, lowRange, highRange);
    event.pulseSamples = Math.max(0, pulseSamples - 1);
    this.shootingStarExplosionEvent = event;
    return { Pulse: pulseSamples > 0 ? power : 0 };
};

NodeLiveAudioProcessor.prototype.windowReopenGateSamples = function windowReopenGateSamples() {
    return Math.max(1, Math.round(Math.max(1, this.engineSampleRate || sampleRate) * 1));
};

NodeLiveAudioProcessor.prototype.setWindowReopenEvent = function setWindowReopenEvent() {
    const samples = this.windowReopenGateSamples();
    this.windowReopenEvent = {
      gateSamples: samples,
      pulseSamples: this.gameTriggerPulseSamples(),
      totalSamples: samples,
    };
};

NodeLiveAudioProcessor.prototype.windowReopenEventSample = function windowReopenEventSample() {
    const event = this.windowReopenEvent && typeof this.windowReopenEvent === "object"
      ? this.windowReopenEvent
      : { pulseSamples: 0, gateSamples: 0, totalSamples: 0 };
    const pulseSamples = Math.max(0, nodeGraphFiniteNumber(event.pulseSamples));
    const gateSamples = Math.max(0, nodeGraphFiniteNumber(event.gateSamples));
    const totalSamples = Math.max(1, nodeGraphFiniteNumber(event.totalSamples, nodeGraphFiniteNumber(gateSamples, 1)));
    const progress = gateSamples > 0 ? 1 - gateSamples / totalSamples : 1;
    const sine = gateSamples > 0 ? Math.sin(Math.PI * Math.max(0, Math.min(1, progress))) : 0;
    event.pulseSamples = Math.max(0, pulseSamples - 1);
    event.gateSamples = Math.max(0, gateSamples - 1);
    this.windowReopenEvent = event;
    return {
      Pulse: pulseSamples > 0 ? 1 : 0,
      Gate: gateSamples > 0 ? 1 : 0,
      Sine: sine,
    };
};

NodeLiveAudioProcessor.prototype.buildConnectionMap = function buildConnectionMap(items, ids, keyForItem) {
    const map = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      if (!ids.has(item.sourceNode) || !ids.has(item.destinationNode)) {
        continue;
      }
      const key = keyForItem(item);
      const list = map.get(key) || [];
      list.push({ ...item });
      map.set(key, list);
    }
    return map;
};

NodeLiveAudioProcessor.prototype.buildInputConnectionMap = function buildInputConnectionMap(connections, ids) {
    return this.buildConnectionMap(
      connections,
      ids,
      (connection) => this.inputKey(connection.destinationNode, connection.destinationPort),
    );
};

NodeLiveAudioProcessor.prototype.buildModulationConnectionMap = function buildModulationConnectionMap(modulations, ids) {
    return this.buildConnectionMap(
      modulations,
      ids,
      (modulation) => this.parameterKey(modulation.destinationNode, modulation.destinationParam),
    );
};

NodeLiveAudioProcessor.prototype.buildGraphInputConnectionMap = function buildGraphInputConnectionMap(graphConnections, ids) {
    return this.buildConnectionMap(
      graphConnections,
      ids,
      (connection) => this.graphInputKey(connection.destinationNode, connection.destinationGraphInput),
    );
};

NodeLiveAudioProcessor.prototype.inputKey = function inputKey(node, port) {
    return `${node}.${port}`;
};

NodeLiveAudioProcessor.prototype.graphInputKey = function graphInputKey(node, graphInput) {
    return `${node}.${graphInput}`;
};

NodeLiveAudioProcessor.prototype.parameterKey = function parameterKey(node, parameter) {
    return `${node}.${parameter}`;
};

NodeLiveAudioProcessor.prototype.stableSeed = function stableSeed(text) {
    let seed = 0x12345678;
    for (const character of String(text)) {
      seed = (Math.imul(seed ^ character.charCodeAt(0), 16777619)) >>> 0;
    }
    return seed || 0x12345678;
};

NodeLiveAudioProcessor.prototype.wrapValue = function wrapValue(value, min, max) {
    const range = max - min;
    if (!Number.isFinite(range) || range <= 0) {
      return min;
    }
    return min + ((((value - min) % range) + range) % range);
};

NodeLiveAudioProcessor.prototype.clampValue = function clampValue(value, min, max) {
    const number = Number(value);
    const reason = this.badValueReason(number);
    if (reason) {
      this.badNumberCount += 1;
      if (!this.lastBadValueNodeId) {
        this.lastBadValueReason = reason;
        this.lastBadValueSource = "";
      }
      return 0;
    }
    return Math.max(min, Math.min(max, number));
};

