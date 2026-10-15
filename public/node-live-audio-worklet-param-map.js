// Parameter DOMAIN ↔ unit map + MOD normalize (Phase F).
// Pure math lives in node-graph-param-surface-helpers.js (loaded in the Blob first).

NodeLiveAudioProcessor.prototype.parameterOutputExists = function parameterOutputExists(node, port) {
  return Boolean(node?.params && Object.hasOwn(node.params, port));
};

/**
 * Parameter-row out jack is a THRU of whatever is wired into that parameter's
 * MOD input (same signal, same rate). Nothing wired = nothing sent (0).
 * Returns the MOD connections feeding nodeId.port.
 */
NodeLiveAudioProcessor.prototype.parameterThruModulations = function parameterThruModulations(nodeId, port) {
  const list = this.modulationConnections?.get?.(this.parameterKey(String(nodeId || ""), String(port || "")));
  return Array.isArray(list) ? list : [];
};

/** Real upstream sources behind a (possibly chained) parameter-out thru. */
NodeLiveAudioProcessor.prototype.parameterThruLeaves = function parameterThruLeaves(nodeId, port, depth = 0) {
  const id = String(nodeId || "");
  const p = String(port || "");
  if (!this.parameterOutputExists(this.nodes?.get?.(id), p)) {
    return [{ sourceNode: id, sourcePort: p }];
  }
  if (depth > 8) return [];
  const out = [];
  const mods = this.parameterThruModulations(id, p);
  for (let i = 0; i < mods.length; i += 1) {
    const m = mods[i];
    if (!m) continue;
    const leaves = this.parameterThruLeaves(m.sourceNode, m.sourcePort, depth + 1);
    for (let j = 0; j < leaves.length; j += 1) out.push(leaves[j]);
  }
  return out;
};

/** MOD surface: raw domain sample (Hz, level, …) — no unit clamp. */
NodeLiveAudioProcessor.prototype.normalizeParameterModulationInput = function normalizeParameterModulationInput(value, metadata = {}) {
  if (typeof nodeGraphParamNormalizeModInput === "function") {
    return nodeGraphParamNormalizeModInput(value, metadata);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

NodeLiveAudioProcessor.prototype.parameterSkewExponent = function parameterSkewExponent(metadata = {}) {
  if (typeof nodeGraphParamSkewExponent === "function") {
    return nodeGraphParamSkewExponent(metadata);
  }
  if (!metadata.nonlinearSlider) {
    return 1;
  }
  const min = Number(metadata.min);
  const max = Number(metadata.max);
  const mid = Number(metadata.mid);
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(mid)) {
    return 1;
  }
  const normalizedMid = this.clampValue((mid - min) / range, 0.000001, 0.999999);
  return Math.log(normalizedMid) / Math.log(0.5);
};

NodeLiveAudioProcessor.prototype.parameterValueToNormalizedSignal = function parameterValueToNormalizedSignal(value, metadata = {}) {
  if (typeof nodeGraphParamDomainToUnit === "function") {
    return nodeGraphParamDomainToUnit(value, metadata);
  }
  const min = Number(metadata.min);
  const max = Number(metadata.max);
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) {
    return 0;
  }
  const bounded = metadata.wraparound
    ? this.wrapValue(nodeGraphFiniteNumber(value), min, max)
    : this.clampValue(nodeGraphFiniteNumber(value), min, max);
  const normalizedValue = this.clampValue((bounded - min) / range, 0, 1);
  return this.clampValue(normalizedValue ** (1 / this.parameterSkewExponent(metadata)), 0, 1);
};

NodeLiveAudioProcessor.prototype.normalizedSignalToParameterValue = function normalizedSignalToParameterValue(signal, metadata = {}) {
  if (typeof nodeGraphParamUnitToDomain === "function") {
    return nodeGraphParamUnitToDomain(signal, metadata);
  }
  const min = Number(metadata.min);
  const max = Number(metadata.max);
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) {
    return Number.isFinite(min) ? min : 0;
  }
  const normalizedSignal = metadata.wraparound
    ? this.wrapValue(nodeGraphFiniteNumber(signal), 0, 1)
    : this.clampValue(nodeGraphFiniteNumber(signal), 0, 1);
  const normalizedValue = normalizedSignal ** this.parameterSkewExponent(metadata);
  return this.applyParameterBounds(min + range * normalizedValue, metadata);
};
