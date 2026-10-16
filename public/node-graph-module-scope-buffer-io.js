// Live scope buffer + visual-input buffer I/O peeled from module-scopes.js (Phase D).
// Load after module-scopes.js. Extract-only.

function nodeGraphScope2dSourceFrameCount(sampleRate, fps, validLength) {
  const safeSampleRate = Math.max(1, nodeGraphFiniteNumber(sampleRate, 44100));
  const safeFps = Math.max(1, nodeGraphFiniteNumber(fps, 60));
  const safeValidLength = Math.max(0, Math.floor(nodeGraphFiniteNumber(validLength)));
  return Math.min(safeValidLength, Math.max(1, Math.ceil(safeSampleRate / safeFps)));
}

function nodeGraphScopeBufferRecentSampleCount(buffer) {
  if (!buffer || !Object.prototype.hasOwnProperty.call(buffer, "nodeGraphScopeRecentSampleCount")) {
    return null;
  }
  return Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeRecentSampleCount)));
}

function nodeGraphScopeAvailableSampleCount(buffer) {
  if (!buffer?.length) {
    return 0;
  }
  const retainedSamples = Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeRetainedSampleCount));
  if (retainedSamples > 0) {
    return Math.min(buffer.length, retainedSamples);
  }
  const absoluteFrame = Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeAbsoluteFrame));
  return absoluteFrame > 0
    ? Math.min(buffer.length, absoluteFrame)
    : buffer.length;
}

function nodeGraphScopeSampleRate(buffer) {
  // Prefer the rate of *samples in the buffer* (after any visual/scope hop).
  const bufferRate = Number(buffer?.nodeGraphScopeSampleRate);
  if (Number.isFinite(bufferRate) && bufferRate > 0) {
    // Safety: if metadata still claims engine rate but stride > 1, fix it.
    // (Older worklets posted visual rings as engineRate + stride 1.)
    const stride = Number(buffer?.nodeGraphScopeSampleStride);
    const source = Number(buffer?.nodeGraphScopeSourceSampleRate);
    if (
      Number.isFinite(stride) && stride > 1.5
      && Number.isFinite(source) && source > 0
      && Math.abs(bufferRate - source) < 1
    ) {
      return source / stride;
    }
    return bufferRate;
  }
  const source = Number(buffer?.nodeGraphScopeSourceSampleRate);
  const stride = Number(buffer?.nodeGraphScopeSampleStride);
  if (Number.isFinite(source) && source > 0 && Number.isFinite(stride) && stride > 0) {
    return source / Math.max(1, stride);
  }
  const stateRate = Number(nodeGraphModuleScopeState.sampleRate);
  if (Number.isFinite(stateRate) && stateRate > 0) {
    return stateRate;
  }
  const appRate = Number(nodeGraphMvp?.sampleRate);
  return Number.isFinite(appRate) && appRate > 0 ? appRate : 44100;
}

function nodeGraphScopeContiguousSampleCount(buffer) {
  const recentSamples = nodeGraphScopeBufferRecentSampleCount(buffer);
  if (recentSamples !== null) {
    return Math.min(buffer?.length || 0, recentSamples);
  }
  return nodeGraphScopeAvailableSampleCount(buffer);
}

// nodeGraphModuleScopeCapturedScope2dBuffer → node-graph-module-scope-capture.js
// captureNodeGraphLiveModuleScopeOutput → node-graph-module-scope-capture.js
function resizeNodeGraphLiveModuleScopeBuffer(buffer, frameCapacity) {
  const capacity = Math.max(0, Math.floor(nodeGraphFiniteNumber(frameCapacity)));
  if (capacity <= 0) {
    return new Float32Array(0);
  }
  if (buffer instanceof Float32Array && buffer.length === capacity) {
    return buffer;
  }
  const next = new Float32Array(capacity);
  if (!buffer?.length) {
    return next;
  }
  const sourceStart = Math.max(0, buffer.length - capacity);
  const copyCount = Math.min(capacity, buffer.length - sourceStart);
  const targetStart = capacity - copyCount;
  next.set(buffer.subarray(sourceStart, sourceStart + copyCount), targetStart);
  next.nodeGraphScopeRetainedSampleCount = Math.min(
    copyCount,
    Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeRetainedSampleCount))),
  );
  next.nodeGraphScopeTotalSampleCount = Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeTotalSampleCount)));
  next.nodeGraphScopeBurnSweepStart = buffer.nodeGraphScopeBurnSweepStart;
  next.nodeGraphScopeBurnSweepLength = buffer.nodeGraphScopeBurnSweepLength;
  next.nodeGraphScopeBurnCrossings = buffer.nodeGraphScopeBurnCrossings;
  next.nodeGraphScopeBurnLastSample = buffer.nodeGraphScopeBurnLastSample;
  next.nodeGraphScopeBurnArmed = buffer.nodeGraphScopeBurnArmed;
  if (Number.isFinite(Number(buffer.nodeGraphScopeSampleRate)) && Number(buffer.nodeGraphScopeSampleRate) > 0) {
    next.nodeGraphScopeSampleRate = Number(buffer.nodeGraphScopeSampleRate);
  }
  if (Number.isFinite(Number(buffer.nodeGraphScopeSourceSampleRate)) && Number(buffer.nodeGraphScopeSourceSampleRate) > 0) {
    next.nodeGraphScopeSourceSampleRate = Number(buffer.nodeGraphScopeSourceSampleRate);
  }
  if (Number.isFinite(Number(buffer.nodeGraphScopeSampleStride)) && Number(buffer.nodeGraphScopeSampleStride) > 0) {
    next.nodeGraphScopeSampleStride = Number(buffer.nodeGraphScopeSampleStride);
  }
  return next;
}

// Props readers/writers keep on scope ring buffers; carried across the view
// swap in nodeGraphScopeRingAdvance (typed arrays cannot be re-offset).
const nodeGraphScopeRingCarriedProps = [
  "nodeGraphScopeAbsoluteFrame",
  "nodeGraphScopeAnalyzer",
  "nodeGraphScopeBurnArmed",
  "nodeGraphScopeBurnCrossings",
  "nodeGraphScopeBurnLastSample",
  "nodeGraphScopeBurnSweepLength",
  "nodeGraphScopeBurnSweepStart",
  "nodeGraphScopeCurrentSamplePosition",
  "nodeGraphScopeDebugSnapshot",
  "nodeGraphScopeDisableDiscontinuitySkip",
  "nodeGraphScopeDiscontinuitySkipSamples",
  "nodeGraphScopeDrawFullWindow",
  "nodeGraphScopeDrawProgress",
  "nodeGraphScopeDrawStartProgress",
  "nodeGraphScopeDrawWrap",
  "nodeGraphScopeFrameBrightness",
  "nodeGraphScopeHoldPoint",
  "nodeGraphScopeLength",
  "nodeGraphScopeLimit",
  "nodeGraphScopeMinPointSpacingPx",
  "nodeGraphScopePeriodSamples",
  "nodeGraphScopeRawValues",
  "nodeGraphScopeRecentSampleCount",
  "nodeGraphScopeRetainedSampleCount",
  "nodeGraphScopeSampleRate",
  "nodeGraphScopeSampleStride",
  "nodeGraphScopeSkipDiscontinuities",
  "nodeGraphScopeSkippedPoints",
  "nodeGraphScopeSourceFrequency",
  "nodeGraphScopeSourceSampleRate",
  "nodeGraphScopeSpectrum",
  "nodeGraphScopeStartFrame",
  "nodeGraphScopeSyncBuffer",
  "nodeGraphScopeTotalPosted",
  "nodeGraphScopeTotalSampleCount",
  "nodeGraphScopeTotalWritten",
  "nodeGraphScopeTracePadding",
  "nodeGraphScopeUniformAge",
  "nodeGraphScopeUseFullWindow",
  "nodeGraphScopeVersion",
  "nodeGraphScopeVisualPointLimit",
  "nodeGraphScopeWriteIndex",
];

function nodeGraphScopeRingAdvance(id, buffer, count) {
  const capacity = buffer.length;
  if (count >= capacity) {
    // Whole ring replaced; caller overwrites every slot.
    return buffer;
  }
  let backing = buffer.nodeGraphScopeBacking;
  let offset = buffer.nodeGraphScopeBackingOffset | 0;
  if (!(backing instanceof Float32Array) || backing.buffer !== buffer.buffer
    || offset + capacity > backing.length || backing.length < capacity) {
    const slack = Math.max(4096, capacity >> 2);
    backing = new Float32Array(capacity + slack);
    backing.set(buffer, 0);
    offset = 0;
  }
  let nextOffset = offset + count;
  if (nextOffset + capacity > backing.length) {
    // Keep the newest capacity-count samples at the front.
    backing.copyWithin(0, nextOffset, offset + capacity);
    nextOffset = 0;
  }
  const next = backing.subarray(nextOffset, nextOffset + capacity);
  for (const key of nodeGraphScopeRingCarriedProps) {
    if (key in buffer) {
      next[key] = buffer[key];
    }
  }
  next.nodeGraphScopeBacking = backing;
  next.nodeGraphScopeBackingOffset = nextOffset;
  nodeGraphModuleScopeState.buffers.set(id, next);
  return next;
}

function pushNodeGraphLiveModuleScopeSamples(nodeId, values, metadata = null) {
  const id = String(nodeId || "");
  if (!id) {
    return;
  }
  const frameCapacity = nodeGraphLiveModuleScopeFrameCapacity();
  nodeGraphModuleScopeState.frames = frameCapacity;
  let buffer = nodeGraphModuleScopeState.buffers.get(id);
  if (!buffer || buffer.length !== frameCapacity) {
    buffer = resizeNodeGraphLiveModuleScopeBuffer(buffer, frameCapacity);
    nodeGraphModuleScopeState.buffers.set(id, buffer);
  }
  // Hot path (perf, softpop patch): scope posts arrive as Float32Array chunks
  // into a 10 s ring, many per frame. Spreading each chunk into a JS array and
  // mapping every sample through the object-aware scalar reader was the top
  // main-thread cost. Write numeric typed arrays straight in; keep the generic
  // reader for plain arrays (which may hold objects).
  const isList = Array.isArray(values) || ArrayBuffer.isView(values);
  const sampleCount = isList ? values.length : 1;
  const count = Math.min(buffer.length, sampleCount);
  if (count <= 0) {
    return;
  }
  // Sliding window over an oversized backing store instead of shifting the
  // whole ring per post. Live rings hold 10 s (441k floats) and the worklet
  // posts ~27 snapshots/s for ~50 scope keys, so copyWithin(0, count) moved
  // ~2.5 GB/s on the main thread (softpop patch: ~35% of main thread, FPS
  // ~35). Now each post only writes its new samples; the backing is compacted
  // once per `slack` samples and the Map entry is swapped to the new view.
  buffer = nodeGraphScopeRingAdvance(id, buffer, count);
  const start = sampleCount - count;
  const dest = buffer.length - count;
  if (!isList) {
    buffer[dest] = nodeGraphModuleScopeScalarValue(values) || 0;
  } else if (values instanceof Float32Array) {
    // One native copy into the ring (no per-sample JS copy). Float32 only:
    // that copy is bit-identical to the element-wise store.
    buffer.set(start === 0 && count === values.length ? values : values.subarray(start, start + count), dest);
    // Same result as the scalar reader: non-finite and NaN become 0. Read-only
    // scan; v - v is NaN only for NaN / +-Infinity.
    const end = dest + count;
    for (let index = dest; index < end; index += 1) {
      const v = buffer[index];
      if (v - v !== 0) {
        buffer[index] = 0;
      }
    }
  } else if (ArrayBuffer.isView(values) && !(values instanceof DataView)) {
    for (let index = 0; index < count; index += 1) {
      const v = Number(values[start + index]);
      // Same result as the scalar reader: non-finite and NaN become 0.
      buffer[dest + index] = Number.isFinite(v) ? v : 0;
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      buffer[dest + index] = nodeGraphModuleScopeScalarValue(values[start + index]) || 0;
    }
  }
  buffer.nodeGraphScopeRecentSampleCount = count;
  buffer.nodeGraphScopeTotalSampleCount = Math.max(
    0,
    Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeTotalSampleCount)),
  ) + count;
  buffer.nodeGraphScopeRetainedSampleCount = Math.min(
    buffer.length,
    Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeRetainedSampleCount))) + count,
  );
  if (metadata && typeof metadata === "object") {
    const absoluteFrame = Number(metadata.absoluteFrame);
    const startFrame = Number(metadata.startFrame);
    const sampleRate = Number(metadata.sampleRate);
    const sourceSampleRate = Number(metadata.sourceSampleRate);
    const sampleStride = Number(metadata.sampleStride);
    if (Number.isFinite(absoluteFrame)) {
      buffer.nodeGraphScopeAbsoluteFrame = absoluteFrame;
    }
    if (Number.isFinite(startFrame)) {
      buffer.nodeGraphScopeStartFrame = startFrame;
    }
    if (Number.isFinite(sampleRate) && sampleRate > 0) {
      buffer.nodeGraphScopeSampleRate = sampleRate;
    }
    if (Number.isFinite(sourceSampleRate) && sourceSampleRate > 0) {
      buffer.nodeGraphScopeSourceSampleRate = sourceSampleRate;
    }
    if (Number.isFinite(sampleStride) && sampleStride > 0) {
      buffer.nodeGraphScopeSampleStride = sampleStride;
    }
  }
  // Scope-ring posts (Output Instant Waterfall) often omit absoluteFrame. Drive a
  // monotonic cursor from totalSampleCount so 1D Phosphor undrawn-window and
  // Instant Waterfall never stall on a missing/stale abs frame.
  const totalSamples = Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeTotalSampleCount)));
  if (totalSamples > 0) {
    const prevAbs = Number(buffer.nodeGraphScopeAbsoluteFrame);
    if (!Number.isFinite(prevAbs) || totalSamples > prevAbs) {
      buffer.nodeGraphScopeAbsoluteFrame = totalSamples;
      buffer.nodeGraphScopeStartFrame = Math.max(0, totalSamples - count);
    }
  }
  nodeGraphModuleScopeState.versionSerial = (nodeGraphFiniteNumber(nodeGraphModuleScopeState.versionSerial)) + 1;
  buffer.nodeGraphScopeVersion = nodeGraphModuleScopeState.versionSerial;
  // Invalidate Instant Waterfall draw cache for this node so the next RAF paints
  // new ring samples (Output stereo keys are "id:Left" / "id:Right").
  const baseId = id.includes(":") ? id.split(":")[0] : id;
  if (baseId && nodeGraphModuleScopeState.waterfallDrawCache) {
    nodeGraphModuleScopeState.waterfallDrawCache.delete(baseId);
  }
}

function pushNodeGraphLiveModuleScopeSnapshot(values, options = {}) {
  if (!values) {
    return;
  }
  // Pause/visual freeze: keep capture rings as they were. In-flight worklet
  // posts after speed 0 (or a re-arm that rebuilt empty rings) used to shift
  // silence into the 2D Trace window and wipe the last Lissajous.
  if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) {
    return;
  }
  if (typeof scopePaintIsEnginePlaying === "function" && !scopePaintIsEnginePlaying()) {
    return;
  }
  const patchFingerprint = String(options.patchFingerprint || nodeGraphPatchFingerprint());
  if (nodeGraphModuleScopeState.mode !== "live") {
    beginNodeGraphLiveModuleScopeCapture({
      nodes: [],
      order: values instanceof Map ? [...values.keys()] : values.map?.((entry) => entry?.[0]) || [],
      patchFingerprint,
    });
  }
  if (nodeGraphModuleScopeState.patchFingerprint !== patchFingerprint) {
    updateNodeGraphLiveModuleScopeFingerprint(patchFingerprint);
  }
  if (Number.isFinite(Number(options.sampleRate)) && Number(options.sampleRate) > 0) {
    nodeGraphModuleScopeState.sampleRate = Number(options.sampleRate);
  }
  const defaultSampleRate = Number(options.sampleRate);
  const defaultSourceSampleRate = Number(options.sourceSampleRate);
  const defaultSampleStride = Number(options.sampleStride);
  const defaultMetadata = {
    sampleRate: Number.isFinite(defaultSampleRate) && defaultSampleRate > 0 ? defaultSampleRate : null,
    sourceSampleRate: Number.isFinite(defaultSourceSampleRate) && defaultSourceSampleRate > 0 ? defaultSourceSampleRate : null,
    sampleStride: Number.isFinite(defaultSampleStride) && defaultSampleStride > 0 ? defaultSampleStride : null,
  };
  const entries = values instanceof Map ? values.entries() : values;
  for (const entry of entries || []) {
    if (!entry) {
      continue;
    }
    const entryMetadata = entry[2] && typeof entry[2] === "object" ? entry[2] : null;
    // No per-entry merge object when the entry carries no metadata of its own.
    const metadata = entryMetadata
      ? { ...defaultMetadata, ...entryMetadata }
      : defaultMetadata;
    pushNodeGraphLiveModuleScopeSamples(entry[0], entry[1], metadata);
  }
  notifyNodeGraphModuleScopeSnapshotListeners();
  // Soft schedule only — force bypasses display FPS (see paint-gate.js).
  if (typeof scopePaintOnSampleSnapshot === "function") {
    scopePaintOnSampleSnapshot();
  } else if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw();
  }
}

// captureNodeGraphLiveModuleScopeFrame → node-graph-module-scope-capture.js
function createNodeGraphVisualInputBuffer(capacity = nodeGraphBufferedInputSampleLimit) {
  const safeCapacity = normalizeNodeGraphVisualInputBufferCapacity(capacity);
  return {
    absoluteFrame: 0,
    buffer: new Float32Array(safeCapacity),
    capacity: safeCapacity,
    length: 0,
    writeIndex: 0,
  };
}

function normalizeNodeGraphVisualInputBufferCapacity(capacity = nodeGraphBufferedInputSampleLimit) {
  return Math.max(1, Math.round(nodeGraphFiniteNumber(capacity, nodeGraphBufferedInputSampleLimit)));
}

function resizeNodeGraphVisualInputBufferState(state, capacity = nodeGraphBufferedInputSampleLimit) {
  const safeCapacity = normalizeNodeGraphVisualInputBufferCapacity(capacity);
  if (!state || state.capacity !== safeCapacity || !(state.buffer instanceof Float32Array)) {
    const next = createNodeGraphVisualInputBuffer(safeCapacity);
    if (!state?.buffer?.length || !state?.length) {
      return next;
    }
    const oldLength = Math.min(nodeGraphFiniteNumber(state.length), state.capacity || state.buffer.length);
    const copyCount = Math.min(oldLength, safeCapacity);
    const chronological = new Float32Array(copyCount);
    const first = ((nodeGraphFiniteNumber(state.writeIndex)) - oldLength + (state.capacity || state.buffer.length)) % (state.capacity || state.buffer.length);
    for (let index = 0; index < copyCount; index += 1) {
      const oldIndex = (first + oldLength - copyCount + index) % (state.capacity || state.buffer.length);
      chronological[index] = state.buffer[oldIndex] || 0;
    }
    next.buffer.set(chronological, 0);
    next.length = copyCount;
    next.writeIndex = copyCount % safeCapacity;
    next.absoluteFrame = Math.max(nodeGraphFiniteNumber(state.absoluteFrame), copyCount);
    return next;
  }
  return state;
}

function syncNodeGraphVisualInputBuffers(runtime) {
  if (!runtime) {
    return;
  }
  runtime.visualInputBuffers ||= new Map();
  const expected = new Map();
  for (const sink of runtime.visualSinks || []) {
    const nodeId = String(sink?.nodeId || "");
    if (!nodeId) {
      continue;
    }
    for (const input of sink.inputs || []) {
      if (!input?.buffered) {
        continue;
      }
      const port = String(input.port || "").trim();
      if (!port) {
        continue;
      }
      expected.set(`${nodeId}:${port}`, normalizeNodeGraphVisualInputBufferCapacity(sink.bufferSampleLimit));
    }
  }
  for (const [key, capacity] of expected) {
    const current = runtime.visualInputBuffers.get(key);
    if (!current || current.capacity !== capacity) {
      runtime.visualInputBuffers.set(key, resizeNodeGraphVisualInputBufferState(current, capacity));
    }
  }
  for (const key of [...runtime.visualInputBuffers.keys()]) {
    if (!expected.has(key)) {
      runtime.visualInputBuffers.delete(key);
    }
  }
}

function writeNodeGraphVisualInputBufferSample(runtime, nodeId, port, value, capacity = nodeGraphBufferedInputSampleLimit) {
  if (!runtime || !nodeId || !port) {
    return;
  }
  runtime.visualInputBuffers ||= new Map();
  const safeCapacity = normalizeNodeGraphVisualInputBufferCapacity(capacity);
  const key = `${nodeId}:${port}`;
  let state = runtime.visualInputBuffers.get(key);
  if (!state || state.capacity !== safeCapacity) {
    state = resizeNodeGraphVisualInputBufferState(state, safeCapacity);
    runtime.visualInputBuffers.set(key, state);
  }
  state.buffer[state.writeIndex] = nodeGraphModuleScopeScalarValue(value);
  state.writeIndex = (state.writeIndex + 1) % state.capacity;
  state.length = Math.min(state.capacity, state.length + 1);
  state.absoluteFrame += 1;
}

function writeVisualInputBufferSample(runtime, nodeId, port, value, capacity = nodeGraphBufferedInputSampleLimit) {
  writeNodeGraphVisualInputBufferSample(runtime, nodeId, port, value, capacity);
}

