// Extracted from node-live-audio-worklet-core.js (Phase D mechanical split).
// Method: postModuleScopeSnapshot — load after core class, before registerProcessor.

NodeLiveAudioProcessor.prototype.postModuleScopeSnapshot = function postModuleScopeSnapshot() {
    const values = [];
    const transfer = [];
    const engineSampleRate = Math.max(1, nodeGraphFiniteNumber(this.engineSampleRate, nodeGraphFiniteNumber(sampleRate, 44100)));
    const rates = this.scopeCaptureRates || Object.create(null);
    const captureRateForKey = (key) => {
      const raw = String(key || "");
      const colon = raw.indexOf(":");
      const nodeKey = colon >= 0 ? raw.slice(0, colon) : raw;
      const writeHz = Number(rates[nodeKey]);
      const stride = typeof this.visualWriteStride === "function"
        ? this.visualWriteStride(writeHz, engineSampleRate)
        : ((!Number.isFinite(writeHz) || writeHz <= 0 || writeHz >= engineSampleRate)
          ? 1
          : Math.max(1, Math.floor(engineSampleRate / writeHz)));
      return {
        sampleRate: engineSampleRate / stride,
        sampleStride: stride,
      };
    };
    for (const [nodeId, samples] of this.scopeBuffers) {
      if (!(samples instanceof Float32Array)) {
        continue;
      }
      const capacity = samples.length;
      if (!capacity) {
        continue;
      }
      const writeIndex = nodeGraphFiniteNumber(samples.nodeGraphScopeWriteIndex);
      const totalWritten = nodeGraphFiniteNumber(samples.nodeGraphScopeTotalWritten);
      const totalPosted = nodeGraphFiniteNumber(samples.nodeGraphScopeTotalPosted);
      // Only ship samples written since the last post (was: full ring + wipe Map).
      const freshCount = Math.min(capacity, Math.max(0, totalWritten - totalPosted));
      if (freshCount <= 0) {
        continue;
      }
      const ordered = new Float32Array(freshCount);
      const start = (writeIndex - freshCount + capacity) % capacity;
      for (let index = 0; index < freshCount; index += 1) {
        ordered[index] = samples[(start + index) % capacity] || 0;
      }
      const nextPosted = totalPosted + freshCount;
      samples.nodeGraphScopeTotalPosted = nextPosted;
      const rateMeta = captureRateForKey(nodeId);
      values.push([nodeId, ordered, {
        absoluteFrame: nextPosted,
        sampleRate: rateMeta.sampleRate,
        sampleStride: rateMeta.sampleStride,
        sourceSampleRate: engineSampleRate,
        startFrame: Math.max(0, nextPosted - freshCount),
      }]);
      transfer.push(ordered.buffer);
    }
    for (const [key, state] of this.visualInputBuffers || []) {
      const length = Math.min(nodeGraphFiniteNumber(state?.length), state?.capacity || state?.buffer?.length || 0);
      if (!state?.buffer?.length || length <= 0) {
        continue;
      }
      const absoluteFrame = Math.max(0, Math.floor(nodeGraphFiniteNumber(state.absoluteFrame)));
      const postedFrame = Math.max(0, Math.floor(nodeGraphFiniteNumber(state.postedFrame)));
      // Visual rings write every engine sample (same as oscillator faces).
      // absoluteFrame counts written samples — sampleRate is the write rate.
      const sampleStride = Math.max(1, Math.round(nodeGraphFiniteNumber(state.sampleStride, 1)));
      const sourceSampleRate = Math.max(
        1,
        nodeGraphFiniteNumber(state.sourceSampleRate, engineSampleRate),
      );
      const writeSampleRate = Math.max(
        1,
        nodeGraphFiniteNumber(state.writeSampleRate, (sourceSampleRate / sampleStride))
          || (engineSampleRate / sampleStride),
      );
      const freshCount = postedFrame > 0
        ? Math.max(0, absoluteFrame - postedFrame)
        : Math.min(length, Math.ceil(writeSampleRate / 30));
      const count = Math.min(length, freshCount);
      if (count <= 0) {
        continue;
      }
      const ordered = new Float32Array(count);
      const start = ((nodeGraphFiniteNumber(state.writeIndex)) - count + state.capacity) % state.capacity;
      for (let index = 0; index < count; index += 1) {
        ordered[index] = state.buffer[(start + index) % state.capacity] || 0;
      }
      values.push([key, ordered, {
        absoluteFrame,
        sampleRate: writeSampleRate,
        sampleStride,
        sourceSampleRate,
        startFrame: absoluteFrame - count,
      }]);
      transfer.push(ordered.buffer);
      state.postedFrame = absoluteFrame;
    }
    // Data-plane relay: any dataOutputs port (Hypersaw's Phases/
    // Amplitudes/Pans today, more later) piggybacks on this same
    // periodic "scope" message instead of the per-sample signal graph --
    // see public/node-graph-data-bus.js for the receiving/read side.
    // Efficient product never runs the JS hypersaw evaluator — pull phases
    // from the graph-hosted native instance first.
    if (typeof this.syncNativeHypersawPublish === "function") {
      try { this.syncNativeHypersawPublish(); } catch (_e) { /* keep prior publish */ }
    }
    if (typeof this.syncNativeRobinSupersawPublish === "function") {
      try { this.syncNativeRobinSupersawPublish(); } catch (_e) { /* keep prior publish */ }
    }
    if (typeof this.syncNativeHyperpluckPublish === "function") {
      try { this.syncNativeHyperpluckPublish(); } catch (_e) { /* keep prior publish */ }
    }
    if (typeof this.syncNativeEnsemblePublish === "function") {
      try { this.syncNativeEnsemblePublish(); } catch (_e) { /* keep prior publish */ }
    }
    if (typeof this.syncNativeSoftpopPublish === "function") {
      try { this.syncNativeSoftpopPublish(); } catch (_e) { /* keep prior publish */ }
    }
    if (typeof this.syncNativeEffectiveHzPublish === "function") {
      try { this.syncNativeEffectiveHzPublish(); } catch (_e) { /* keep prior publish */ }
    }
    const dataPorts = [];
    // Filter faces: native effective Hz while ƒ is wired (-1 = follow knob).
    if (this.effectiveHzPublish) {
      for (const [nodeId, hz] of this.effectiveHzPublish) {
        dataPorts.push([nodeId, "EffectiveHz", hz]);
        const lo = this.effectiveLoHzPublish?.get(nodeId);
        if (lo !== undefined) dataPorts.push([nodeId, "EffectiveLoHz", lo]);
      }
    }
    if (this.softpopPublish) {
      for (const [nodeId, snap] of this.softpopPublish) {
        dataPorts.push([nodeId, "SoftpopBins", snap.bins]);
        dataPorts.push([nodeId, "SoftpopInfo", snap.info]);
      }
    }
    if (this.hypersaw2States) {
      for (const [nodeId, state] of this.hypersaw2States) {
        // Always push Phases (including []) so a silent Meta voice can clear
        // the bus and freeze the last face pixels instead of redrawing stale stems.
        if (Array.isArray(state?.lastVoicePhases)) {
          dataPorts.push([nodeId, "Phases", state.lastVoicePhases]);
        }
        if (Array.isArray(state?.lastVoiceAmplitudes) && state.lastVoiceAmplitudes.length) {
          dataPorts.push([nodeId, "Amplitudes", state.lastVoiceAmplitudes]);
        }
        if (Array.isArray(state?.lastVoicePans) && state.lastVoicePans.length) {
          dataPorts.push([nodeId, "Pans", state.lastVoicePans]);
        }
      }
    }
    if (this.robinSupersawStates) {
      for (const [nodeId, state] of this.robinSupersawStates) {
        if (Array.isArray(state?.lastVoicePhases) && state.lastVoicePhases.length) {
          dataPorts.push([nodeId, "Phases", state.lastVoicePhases]);
        }
        if (Array.isArray(state?.lastVoiceAmplitudes) && state.lastVoiceAmplitudes.length) {
          dataPorts.push([nodeId, "Amplitudes", state.lastVoiceAmplitudes]);
        }
        if (Array.isArray(state?.lastVoicePans) && state.lastVoicePans.length) {
          dataPorts.push([nodeId, "Pans", state.lastVoicePans]);
        }
      }
    }
    if (this.hyperpluckStates) {
      for (const [nodeId, state] of this.hyperpluckStates) {
        if (Array.isArray(state?.lastVoicePhases) && state.lastVoicePhases.length) {
          dataPorts.push([nodeId, "Phases", state.lastVoicePhases]);
        }
        if (Array.isArray(state?.lastVoiceAmplitudes) && state.lastVoiceAmplitudes.length) {
          dataPorts.push([nodeId, "Amplitudes", state.lastVoiceAmplitudes]);
        }
        if (Array.isArray(state?.lastVoicePans) && state.lastVoicePans.length) {
          dataPorts.push([nodeId, "Pans", state.lastVoicePans]);
        }
      }
    }
    if (this.ensemblePublish) {
      for (const [nodeId, snap] of this.ensemblePublish) {
        if (Array.isArray(snap?.phases)) {
          dataPorts.push([nodeId, "Phases", snap.phases]);
          if (Array.isArray(snap?.amplitudes) && snap.amplitudes.length) {
            dataPorts.push([nodeId, "Amplitudes", snap.amplitudes]);
          }
          if (Array.isArray(snap?.pans) && snap.pans.length) {
            dataPorts.push([nodeId, "Pans", snap.pans]);
          }
          continue;
        }
        if (Array.isArray(snap?.delays)) {
          dataPorts.push([nodeId, "Delays", snap.delays]);
        }
        if (Array.isArray(snap?.pans) && snap.pans.length) {
          dataPorts.push([nodeId, "Pans", snap.pans]);
        }
      }
    }
    for (const [nodeId, state] of this.videoscopeStates) {
      this.videoscopeCollectDisplayData(nodeId, state, dataPorts);
    }
    for (const [nodeId, state] of this.spectrogramStates || []) {
      // Analysis throw must not kill process() — that mutes Output for good.
      try {
        this.spectrogramCollectDisplayData(nodeId, state, dataPorts);
      } catch (_e) { /* keep audio; face keeps last hop */ }
    }
    // Pull Yellow Graph planes from native WASM for face relay.
    if (typeof this.syncNativeYellowGraphPublish === "function") {
      try { this.syncNativeYellowGraphPublish(); } catch (_e) { /* keep prior publish */ }
    }
    // Yellow Graph relay (Additive Generator / Effect / Out faces).
    if (this.additiveGraphPublish && this.additiveGraphPublish.size) {
      for (const [nodeId, graph] of this.additiveGraphPublish) {
        if (!graph || !graph.ratio) continue;
        const panArr = graph.pan && graph.pan.length
          ? Array.from(graph.pan)
          : null;
        // WhiteNoise recipes for face animation (no walks — display reseeds locally).
        const packNoise = (n) => (n && typeof n === "object"
          ? { mode: n.mode, amount: n.amount, seed: n.seed ?? 1 }
          : null);
        const noisePack = {
          ...(packNoise(graph.ratioNoise) ? { ratioNoise: packNoise(graph.ratioNoise) } : {}),
          ...(packNoise(graph.phaseNoise) ? { phaseNoise: packNoise(graph.phaseNoise) } : {}),
          ...(packNoise(graph.panNoise) ? { panNoise: packNoise(graph.panNoise) } : {}),
          ...(packNoise(graph.ampNoise) ? { ampNoise: packNoise(graph.ampNoise) } : {}),
        };
        const displayPhaseArr = graph.displayPhase && graph.displayPhase.length
          ? Array.from(graph.displayPhase)
          : null;
        const payload = {
          harmonics: graph.harmonics,
          ratio: Array.from(graph.ratio),
          phase: Array.from(graph.phase || []),
          amplitude: Array.from(graph.amplitude || []),
          ...(panArr ? { pan: panArr } : {}),
          ...(displayPhaseArr ? { displayPhase: displayPhaseArr } : {}),
          ...noisePack,
          frequencyHz: graph.frequencyHz,
          masterPhase: graph.masterPhase,
          masterAmp: graph.masterAmp,
        };
        dataPorts.push([nodeId, "Graph", payload]);
        if (graph.frequencyHz != null) {
          dataPorts.push([nodeId, "GraphView", { ...payload }]);
        }
      }
    }
    if (!values.length && !dataPorts.length) {
      return false;
    }
    const message = {
      ...(dataPorts.length ? { dataPorts } : {}),
      patchFingerprint: this.patchFingerprint,
      sampleRate: engineSampleRate,
      sessionId: this.sessionId,
      type: "scope",
      values,
    };
    // Transfer sample buffers so the audio thread does not structured-clone them.
    // Keep scopeBuffers Map + rings — wiping the Map every post was GC + dropout fuel.
    // One combined frame batch: this scope snapshot + any held meter /
    // visualControls parts (see docs/FRAME_BATCH_FORMAT.md).
    this.postFrameBatch(message, transfer);
    return true;
};

// ---- Frame batch (docs/FRAME_BATCH_FORMAT.md) --------------------------------
// The main thread used to get three independent message streams (scope at
// display FPS, meter at 60 Hz, visualControls at 30 Hz). They now travel in
// one { type: "frameBatch" } envelope per display frame; the page ingests it
// once per requestAnimationFrame via nodeGraphReceiveFrameBatch().
const FRAME_BATCH_VERSION = 1;
const FRAME_BATCH_HOLD_SECONDS = 0.05;

NodeLiveAudioProcessor.prototype.postFrameBatch = function postFrameBatch(scope = null, transfer = null) {
    const held = this.heldFrameParts || null;
    this.heldFrameParts = null;
    const batch = {
      type: "frameBatch",
      version: FRAME_BATCH_VERSION,
      sessionId: this.sessionId,
      scope: scope || null,
      meter: held?.meter || null,
      visualControls: held?.visualControls || null,
    };
    if (transfer && transfer.length) {
      this.port.postMessage(batch, transfer);
    } else {
      this.port.postMessage(batch);
    }
};

// kind: "meter" (counters reset after each post, so never dropped: a second
// meter before the flush makes the part an array) or "visualControls"
// (latest state wins).
NodeLiveAudioProcessor.prototype.postFramePart = function postFramePart(kind, body) {
    const fps = Number(this.displayFps);
    if (!(fps > 0)) {
      // No display frames: nothing to ride along with.
      this.port.postMessage(body);
      return;
    }
    const held = this.heldFrameParts || (this.heldFrameParts = {
      meter: null,
      visualControls: null,
      sinceFrame: typeof currentFrame === "number" ? currentFrame : 0,
    });
    if (kind === "meter") {
      held.meter = held.meter
        ? (Array.isArray(held.meter) ? [...held.meter, body] : [held.meter, body])
        : body;
    } else {
      held[kind] = body;
    }
};

NodeLiveAudioProcessor.prototype.flushHeldFrameParts = function flushHeldFrameParts(force = false) {
    const held = this.heldFrameParts;
    if (!held) {
      return;
    }
    const now = typeof currentFrame === "number" ? currentFrame : 0;
    const rate = Math.max(1, Number(sampleRate) || 44100);
    if (force || (now - held.sinceFrame) >= rate * FRAME_BATCH_HOLD_SECONDS) {
      this.postFrameBatch(null, null);
    }
};
